import { recognizerLogger as logger } from '../../../configuration/LoggerConfig';
import * as NetworkWSInterface from '../../networkHelper/websocket/networkWSInterface';
import * as CryptoHelper from '../../CryptoHelper';

/**
 * A CDK v3 websocket dialog have this sequence :
 * ---------- Client ------------------------------------- Server ----------------------------------
 * init (send the applicationKey) ================>
 *                                       <=========== hmacChallenge
 * answerToHmacChallenge (send the hmac) =========>
 *                                       <=========== init
 * start (send the parameters and first strokes ) ===============>
 *                                       <=========== recognition with instance id
 * continue (send the other strokes ) ============>
 *                                       <=========== recognition
 */

function buildInitInput(options) {
  return {
    type: 'applicationKey',
    applicationKey: options.recognitionParams.server.applicationKey
  };
}

function answerToHmacChallengeCallback(serverMessage, options, applicationKey) {
  return {
    type: 'hmac',
    applicationKey,
    challenge: serverMessage.data.challenge,
    hmac: CryptoHelper.computeHmac(serverMessage.data.challenge, options.recognitionParams.server.applicationKey, options.recognitionParams.server.hmacKey)
  };
}

function simpleCallBack(payload, error) {
  logger.error('This is something unexpected in current recognizer. Not the type of message we should have here.');
  logger.debug('payload', payload);
  logger.debug('error', error);
}

function updateInstanceId(recognizerContext, message) {
  const recognizerContextReference = recognizerContext;
  if (recognizerContextReference.instanceId && recognizerContextReference.instanceId !== message.data.instanceId) {
    logger.error(`Instance id switch from ${recognizerContextReference.instanceId} to ${message.data.instanceId} this is suspicious`);
  }
  recognizerContextReference.instanceId = message.data.instanceId;
  logger.debug('Cdkv3WSRecognizer memorizing instance id', message.data.instanceId);
}

function onResult(recognizerContext, message) {
  logger.debug('Cdkv3WSRecognizer success', message);
  const recognitionContext = recognizerContext.recognitionContexts.shift();
  const modelReference = recognitionContext.model;
  logger.debug('Cdkv3WSRecognizer update model', message);
  modelReference.rawResult = message.data;
  // Giving back the hand to the InkPaper by resolving the promise.
  recognitionContext.recognitionPromiseCallbacks.resolve(modelReference);
}

/**
 * This function bind the right behaviour when a message is receive by the websocket.
 * @param {DestructuredPromise} destructuredPromise
 * @param {RecognizerContext} recognizerContext Current recognizer context
 * @param {Options} options Current configuration
 * @return {function} Callback to handle WebSocket results
 */
export function buildWebSocketCallback(destructuredPromise, recognizerContext, options) {
  return (message) => {
    // Handle websocket messages
    const applicationKey = options.recognitionParams.server.applicationKey;
    logger.debug('Handling', message.type, message);

    switch (message.type) {
      case 'open' :
        NetworkWSInterface.send(recognizerContext.websocket, buildInitInput(options));
        break;
      case 'message' :
        logger.debug('Receiving message', message.data.type);
        switch (message.data.type) {
          case 'hmacChallenge' :
            NetworkWSInterface.send(recognizerContext.websocket, answerToHmacChallengeCallback(message, options, applicationKey));
            break;
          case 'init' :
            destructuredPromise.resolve('Init done');
            break;
          case 'reset' :
            logger.debug('Websocket reset done');
            break;
          case 'mathResult' :
          case 'textResult' :
            updateInstanceId(recognizerContext, message);
            onResult(recognizerContext, message);
            break;
          default :
            simpleCallBack(message);
            destructuredPromise.reject();
        }
        break;
      case 'close' :
        logger.debug('Websocket close done');
        break;
      default :
        simpleCallBack(message);
    }
  };
}
