const { contextBridge, ipcRenderer } = require('electron');

// No generic invoke/send, paths, revisions or dialog options from the renderer.
const invokeNoArgs = (channel) => (...args) => {
  if (args.length) return Promise.reject(new TypeError('This method accepts no arguments'));
  return ipcRenderer.invoke(channel);
};

contextBridge.exposeInMainWorld('apparent', Object.freeze({
  readRuntimeState: invokeNoArgs('apparent:read-runtime-state'),
  startCapture: invokeNoArgs('apparent:start-capture'),
  finishCapture: invokeNoArgs('apparent:finish-capture'),
  cancelCapture: invokeNoArgs('apparent:cancel-capture'),
  readCaptureLocation: invokeNoArgs('apparent:read-capture-location'),
  changeCaptureLocation: invokeNoArgs('apparent:change-capture-location'),
  resetCaptureLocation: invokeNoArgs('apparent:reset-capture-location'),
  readRetention: invokeNoArgs('apparent:read-retention'),
  saveRetention: (...args) => {
    if (args.length !== 1 || !['week', 'month', 'forever'].includes(args[0])) {
      return Promise.reject(new TypeError('Invalid retention preset'));
    }
    return ipcRenderer.invoke('apparent:save-retention', args[0]);
  },
  resetRetention: invokeNoArgs('apparent:reset-retention'),
  readCaptureUsage: invokeNoArgs('apparent:read-capture-usage'),
}));
