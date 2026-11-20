const { contextBridge, ipcRenderer } = require('electron');

const electronAPI = {
  isElectron: true,
  platform: process.platform,

  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  startPowerSaveBlocker: () => ipcRenderer.invoke('power-save-blocker-start'),
  stopPowerSaveBlocker: () => ipcRenderer.invoke('power-save-blocker-stop'),

  setIgnoreMouseEvents: (ignore, options) => {
    ipcRenderer.send('overlay-ignore-mouse-events', ignore, options);
  },

  overlay: {
    show: (params) => ipcRenderer.invoke('overlay-show', params),
    hide: (target) => ipcRenderer.invoke('overlay-hide', target),
    move: (deltaX, deltaY) => ipcRenderer.send('overlay-window-move', { deltaX, deltaY }),
    sendState: (state) => ipcRenderer.send('overlay-state-sync', state),
    onState: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('overlay-state-sync', handler);
      return () => {
        ipcRenderer.removeListener('overlay-state-sync', handler);
      };
    },
    sendCommand: (command, payload) => {
      ipcRenderer.send('overlay-command', { command, payload });
    },
    onCommand: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('overlay-command', handler);
      return () => {
        ipcRenderer.removeListener('overlay-command', handler);
      };
    },
    sendToast: (message) => ipcRenderer.send('overlay-toast', message),
    onToast: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('overlay-toast', handler);
      return () => {
        ipcRenderer.removeListener('overlay-toast', handler);
      };
    },
  },

  diskStream: {
    start: (params) => ipcRenderer.invoke('disk-stream-start', params),
    writeChunk: (recordingId, chunkBuffer, meta) =>
      ipcRenderer.invoke('disk-stream-write-chunk', { recordingId, buffer: chunkBuffer, meta }),
    finish: (recordingId) => ipcRenderer.invoke('disk-stream-finish', { recordingId }),
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
