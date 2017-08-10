import JsonCSS from 'json-css';
import { recognizerLogger as logger } from '../../../configuration/LoggerConfig';
import Constants from '../../../configuration/Constants';
import * as InkModel from '../../../model/InkModel';
import * as RecognizerContext from '../../../model/RecognizerContext';
import * as Cdkv4WSWebsocketBuilder from './Cdkv4WSBuilder';
import * as CdkWSRecognizerUtil from '../CdkWSRecognizerUtil';

export { close } from '../CdkWSRecognizerUtil';


/* eslint-disable no-undef */
function getDPI(element) {
  // const startDpi = 56;
  // for (let dpi = startDpi; dpi < 2000; dpi++) {
  //   if (window.matchMedia(`(max-resolution: ${dpi}dpi)`).matches === true) {
  //     return dpi;
  //   }
  // }
  // return startDpi;
  return 96;
}

/* eslint-enable no-undef */

/**
 * Recognizer configuration
 * @type {RecognizerInfo}
 */
export const IInkWebSocketV4Configuration = {
  types: [Constants.RecognitionType.MATH, Constants.RecognitionType.TEXT, Constants.RecognitionType.DIAGRAM, Constants.RecognitionType.NEBO],
  protocol: Constants.Protocol.WEBSOCKET,
  apiVersion: 'V4',
  availableTriggers: {
    exportContent: [Constants.Trigger.POINTER_UP, Constants.Trigger.DEMAND],
    addStrokes: [Constants.Trigger.POINTER_UP]
  }
};

/**
 * Get the configuration supported by this recognizer
 * @return {RecognizerInfo}
 */
export function getInfo() {
  return IInkWebSocketV4Configuration;
}

export function buildNewContentPackageInput(configuration, element) {
  return {
    type: 'newContentPackage',
    applicationKey: configuration.recognitionParams.server.applicationKey,
    xDpi: getDPI(element),
    yDpi: getDPI(element),
    viewSizeHeight: element.clientHeight,
    viewSizeWidth: element.clientWidth
  };
}

export function buildRestoreIInkSessionInput(configuration, element, sessionId) {
  return {
    type: 'restoreIInkSession',
    iinkSessionId: sessionId,
    applicationKey: configuration.recognitionParams.server.applicationKey,
    xDpi: getDPI(element),
    yDpi: getDPI(element),
    viewSizeHeight: element.clientHeight,
    viewSizeWidth: element.clientWidth
  };
}

export function buildNewContentPart(configuration) {
  return {
    type: 'newContentPart',
    contentType: configuration.recognitionParams.type,
    mimeTypes: (configuration.triggers.exportContent !== Constants.Trigger.DEMAND) ?
      configuration.recognitionParams.v4[`${configuration.recognitionParams.type.toLowerCase()}`].mimeTypes : undefined
  };
}

export function buildOpenContentPart(configuration, partId) {
  return {
    type: 'openContentPart',
    id: partId,
    mimeTypes: (configuration.triggers.exportContent !== Constants.Trigger.DEMAND) ?
      configuration.recognitionParams.v4[`${configuration.recognitionParams.type.toLowerCase()}`].mimeTypes : undefined
  };
}

export function buildConfiguration(configuration) {
  return Object.assign({ type: 'configuration' }, configuration.recognitionParams.v4);
}

function buildAddStrokes(recognizerContext, model) {
  const strokes = InkModel.extractPendingStrokes(model, recognizerContext.lastPositions.lastSentPosition + 1);
  if (strokes.length > 0) {
    InkModel.updateModelSentPosition(model);
    return {
      type: 'addStrokes',
      strokes: strokes.map(stroke => Object.assign({}, {
        id: stroke.id,
        pointerType: stroke.pointerType,
        pointerId: stroke.pointerId,
        x: stroke.x,
        y: stroke.y,
        t: stroke.t,
        p: stroke.p
      }))
    };
  }
  return undefined;
}

function buildUndo() {
  return {
    type: 'undo'
  };
}

function buildRedo() {
  return {
    type: 'redo'
  };
}

function buildClear() {
  return {
    type: 'clear'
  };
}

function buildConvert() {
  return {
    type: 'convert'
  };
}

function buildZoom(value) {
  return {
    type: 'zoom',
    zoom: value
  };
}

function buildResize(element) {
  return {
    type: 'changeViewSize',
    height: element.clientHeight,
    width: element.clientWidth
  };
}

function buildExport(configuration, partId) {
  return {
    type: 'export',
    partId,
    mimeTypes: configuration.recognitionParams.v4[`${configuration.recognitionParams.type.toLowerCase()}`].mimeTypes
  };
}

function buildImport(partId, mimetype, data) {
  return {
    type: 'import',
    partId,
    mimetype,
    data
  };
}

function buildWaitForIdle() {
  return {
    type: 'waitForIdle'
  };
}

export function buildSetPenStyle(penStyle) {
  if (penStyle) {
    const css = new JsonCSS().toCSS({ css: penStyle });
    return {
      type: 'setPenStyle',
      style: css.substring(6, css.length - 3) // FIXME Ugly hack to parse JSON to CSS inline
    };
  }
  return {
    type: 'setPenStyle',
    style: ''
  };
}

export function buildSetTheme(theme) {
  return {
    type: 'setTheme',
    theme: new JsonCSS().toCSS(theme)
  };
}

const iinkCallback = (model, err, res, callback) => {
  const modelReference = InkModel.updateModelReceivedPosition(model);
  if (res) {
    if (res.updates !== undefined) {
      if (modelReference.recognizedSymbols) {
        modelReference.recognizedSymbols.push(...res.updates);
      } else {
        modelReference.recognizedSymbols = [...res.updates];
      }
    }
    if (res.exports !== undefined) {
      modelReference.rawResults.exports = res;
      modelReference.exports = res.exports;
      return callback(err, modelReference, Constants.EventType.EXPORTED);
    }

    if ((res.canUndo !== undefined) || (res.canRedo !== undefined)) {
      return callback(err, modelReference, Constants.EventType.CHANGED);
    }

    if (res.type === 'partChanged') {
      return callback(err, modelReference, Constants.EventType.LOADED);
    }
  }
  return callback(err, modelReference);
};

/**
 * Initialize recognition
 * @param {RecognizerContext} recognizerContext Current recognizer context
 * @param {Model} model Current model
 * @param {RecognizerCallback} callback
 */
export function init(recognizerContext, model, callback) {
  const recognizerContextRef = RecognizerContext.setRecognitionContext(recognizerContext, {
    model: InkModel.updateModelSentPosition(model, model.lastPositions.lastReceivedPosition),
    callback: (err, res) => iinkCallback(model, err, res, callback)
  });
  CdkWSRecognizerUtil.init('/api/v4.0/iink/document', recognizerContextRef, Cdkv4WSWebsocketBuilder.buildWebSocketCallback, init)
    .catch((err) => {
      if (RecognizerContext.shouldAttemptImmediateReconnect(recognizerContext) && recognizerContext.reconnect) {
        logger.info('Attempting a reconnect', recognizerContext.currentReconnectionCount);
        recognizerContext.reconnect(recognizerContext, model, callback);
      } else {
        logger.error('Unable to reconnect', err);
        iinkCallback(model, err, undefined, callback);
      }
    });
}

/**
 * Create a new content part
 * @param {RecognizerContext} recognizerContext Current recognition context
 * @param {Model} model Current model
 * @param {RecognizerCallback} callback
 */
export function newContentPart(recognizerContext, model, callback) {
  const recognizerContextRef = RecognizerContext.setRecognitionContext(recognizerContext, {
    model,
    callback: (err, res) => iinkCallback(model, err, res, callback)
  });
  CdkWSRecognizerUtil.sendMessage(recognizerContextRef, buildNewContentPart, recognizerContext.editor.configuration)
    .catch(exception => CdkWSRecognizerUtil.retry(newContentPart, recognizerContext, model, callback));
}

/**
 * Open the recognizer context content part
 * @param {RecognizerContext} recognizerContext Current recognition context
 * @param {Model} model Current model
 * @param {RecognizerCallback} callback
 */
export function openContentPart(recognizerContext, model, callback) {
  const recognizerContextRef = RecognizerContext.setRecognitionContext(recognizerContext, {
    model,
    callback: (err, res) => iinkCallback(model, err, res, callback)
  });
  CdkWSRecognizerUtil.sendMessage(recognizerContextRef, buildOpenContentPart, recognizerContext.editor.configuration, recognizerContext.currentPartId)
    .catch(exception => CdkWSRecognizerUtil.retry(openContentPart, recognizerContext, model, callback));
}

/**
 * Add strokes to the model
 * @param {RecognizerContext} recognizerContext Current recognition context
 * @param {Model} model Current model
 * @param {RecognizerCallback} callback
 */
export function addStrokes(recognizerContext, model, callback) {
  const recognizerContextRef = RecognizerContext.setRecognitionContext(recognizerContext, {
    model,
    callback: (err, res) => iinkCallback(model, err, res, callback)
  });
  CdkWSRecognizerUtil.sendMessage(recognizerContextRef, buildAddStrokes, recognizerContext, model)
    .catch(exception => CdkWSRecognizerUtil.retry(addStrokes, recognizerContext, model, callback));
}

/**
 * Undo last action
 * @param {RecognizerContext} recognizerContext Current recognition context
 * @param {Model} model Current model
 * @param {RecognizerCallback} callback
 */
export function undo(recognizerContext, model, callback) {
  const recognizerContextRef = RecognizerContext.setRecognitionContext(recognizerContext, {
    model,
    callback: (err, res) => iinkCallback(model, err, res, callback)
  });
  CdkWSRecognizerUtil.sendMessage(recognizerContextRef, buildUndo)
    .catch(exception => CdkWSRecognizerUtil.retry(undo, recognizerContext, model, callback));
}

/**
 * Redo last action
 * @param {RecognizerContext} recognizerContext Current recognition context
 * @param {Model} model Current model
 * @param {RecognizerCallback} callback
 */
export function redo(recognizerContext, model, callback) {
  const recognizerContextRef = RecognizerContext.setRecognitionContext(recognizerContext, {
    model,
    callback: (err, res) => iinkCallback(model, err, res, callback)
  });
  CdkWSRecognizerUtil.sendMessage(recognizerContextRef, buildRedo)
    .catch(exception => CdkWSRecognizerUtil.retry(redo, recognizerContext, model, callback));
}

/**
 * Clear action
 * @param {RecognizerContext} recognizerContext Current recognition context
 * @param {Model} model Current model
 * @param {RecognizerCallback} callback
 */
export function clear(recognizerContext, model, callback) {
  const recognizerContextRef = RecognizerContext.setRecognitionContext(recognizerContext, {
    model,
    callback: (err, res) => iinkCallback(model, err, res, callback)
  });
  CdkWSRecognizerUtil.sendMessage(recognizerContextRef, buildClear)
    .catch(exception => CdkWSRecognizerUtil.retry(clear, recognizerContext, model, callback));
}

/**
 * Convert action
 * @param {RecognizerContext} recognizerContext Current recognition context
 * @param {Model} model Current model
 * @param {RecognizerCallback} callback
 */
export function convert(recognizerContext, model, callback) {
  const recognizerContextRef = RecognizerContext.setRecognitionContext(recognizerContext, {
    model,
    callback: (err, res) => iinkCallback(model, err, res, callback)
  });
  CdkWSRecognizerUtil.sendMessage(recognizerContextRef, buildConvert)
    .catch(exception => CdkWSRecognizerUtil.retry(convert, recognizerContext, model, callback));
}

/**
 * Export action
 * @param {RecognizerContext} recognizerContext Current recognition context
 * @param {Model} model Current model
 * @param {RecognizerCallback} callback
 */
export function exportContent(recognizerContext, model, callback) {
  const recognizerContextRef = RecognizerContext.setRecognitionContext(recognizerContext, {
    model,
    callback: (err, res) => iinkCallback(model, err, res, callback)
  });
  CdkWSRecognizerUtil.sendMessage(recognizerContextRef, buildExport, recognizerContext.editor.configuration, recognizerContext.currentPartId)
    .catch(exception => CdkWSRecognizerUtil.retry(exportContent, recognizerContext, model, callback));
}

/**
 * Import action
 * @param {RecognizerContext} recognizerContext Current recognition context
 * @param {Model} model Current model
 * @param {String} mimetype Import mimetype
 * @param {Object} data Import data
 * @param {RecognizerCallback} callback
 */
export function importContent(recognizerContext, model, mimetype, data, callback) {
  const recognizerContextRef = RecognizerContext.setRecognitionContext(recognizerContext, {
    model,
    callback: (err, res) => iinkCallback(model, err, res, callback)
  });
  CdkWSRecognizerUtil.sendMessage(recognizerContextRef, buildImport, recognizerContext.currentPartId, mimetype, data)
    .catch(exception => CdkWSRecognizerUtil.retry(importContent, recognizerContext, model, mimetype, data, callback));
}

/**
 * WaitForIdle action
 * @param {RecognizerContext} recognizerContext Current recognition context
 * @param {Model} model Current model
 * @param {RecognizerCallback} callback
 */
export function waitForIdle(recognizerContext, model, callback) {
  const recognizerContextRef = RecognizerContext.setRecognitionContext(recognizerContext, {
    model,
    callback: (err, res) => iinkCallback(model, err, res, callback)
  });
  CdkWSRecognizerUtil.sendMessage(recognizerContextRef, buildWaitForIdle)
    .catch(exception => CdkWSRecognizerUtil.retry(waitForIdle, recognizerContext, model, callback));
}

/**
 * Resize
 * @param {RecognizerContext} recognizerContext Current recognition context
 * @param {Model} model Current model
 * @param {Element} element Current element
 * @param {RecognizerCallback} callback
 */
export function resize(recognizerContext, model, element, callback) {
  const recognizerContextRef = RecognizerContext.setRecognitionContext(recognizerContext, {
    model,
    callback: (err, res) => iinkCallback(model, err, res, callback)
  });
  CdkWSRecognizerUtil.sendMessage(recognizerContextRef, buildResize, element)
    .catch(exception => CdkWSRecognizerUtil.retry(resize, recognizerContext, model, callback));
}

/**
 * Zoom action
 * @param {RecognizerContext} recognizerContext Current recognition context
 * @param {Model} model Current model
 * @param {Number} value=10 Zoom value
 * @param {RecognizerCallback} callback
 */
export function zoom(recognizerContext, model, value = 10, callback) {
  const recognizerContextRef = RecognizerContext.setRecognitionContext(recognizerContext, {
    model,
    callback: (err, res) => iinkCallback(model, err, res, callback)
  });
  CdkWSRecognizerUtil.sendMessage(recognizerContextRef, buildZoom, value)
    .catch(exception => CdkWSRecognizerUtil.retry(zoom, recognizerContext, model, callback));
}

/**
 * SetPenStyle action
 * @param {RecognizerContext} recognizerContext Current recognition context
 * @param {Model} model Current model
 * @param {PenStyle} penStyle Current penStyle
 * @param {RecognizerCallback} callback
 */
export function setPenStyle(recognizerContext, model, penStyle, callback) {
  const recognizerContextRef = RecognizerContext.setRecognitionContext(recognizerContext, {
    model,
    callback: (err, res) => iinkCallback(model, err, res, callback)
  });
  CdkWSRecognizerUtil.sendMessage(recognizerContextRef, buildSetPenStyle, penStyle)
    .catch(exception => CdkWSRecognizerUtil.retry(setPenStyle, recognizerContext, model, callback));
}

/**
 * SetTheme action
 * @param {RecognizerContext} recognizerContext Current recognition context
 * @param {Model} model Current model
 * @param {Theme} theme Current theme
 * @param {RecognizerCallback} callback
 */
export function setTheme(recognizerContext, model, theme, callback) {
  const recognizerContextRef = RecognizerContext.setRecognitionContext(recognizerContext, {
    model,
    callback: (err, res) => iinkCallback(model, err, res, callback)
  });
  CdkWSRecognizerUtil.sendMessage(recognizerContextRef, buildSetTheme, theme)
    .catch(exception => CdkWSRecognizerUtil.retry(setTheme, recognizerContext, model, callback));
}
