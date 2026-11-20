import { contextBridge, ipcRenderer } from 'electron';

export interface OverlayCommandMessage {
  command: 'CMD_STOP_RECORDING' | 'CMD_TAKE_SCREENSHOT' | 'CMD_PAUSE_RECORDING' | 'CMD_RESUME_RECORDING' | 'CMD_REQUEST_STATE';
  payload?: any;
}

export interface ElectronAPI {
  isElectron: boolean;
  platform: string;

  // External Links (WhatsApp Desktop / URLs)
  openExternal: (url: string) => Promise<void>;

  // Power Save Blocker (prevent display sleep during recording)
  startPowerSaveBlocker: () => Promise<number>;
  stopPowerSaveBlocker: () => Promise<void>;

  // Overlay Click-Through Toggling
  setIgnoreMouseEvents: (ignore: boolean, options?: { forward: boolean }) => void;

  // Overlay Window Management & IPC Synchronization
  overlay: {
    show: (params?: { caseId?: string | null; caseNumber?: string | null; contactPhone?: string | null; contactName?: string | null }) => Promise<void>;
    hide: (target?: string) => Promise<void>;
    move: (deltaX: number, deltaY: number) => void;
    sendState: (state: any) => void;
    onState: (callback: (state: any) => void) => () => void;
    sendCommand: (command: string, payload?: any) => void;
    onCommand: (callback: (cmd: OverlayCommandMessage) => void) => () => void;
    sendToast: (message: string) => void;
    onToast: (callback: (msg: string) => void) => () => void;
  };

  // Crash-Safe Disk Streaming
  diskStream: {
    start: (params: { caseId: string; recordingId: string; caseNumber?: string }) => Promise<{ success: boolean; filePath: string }>;
    writeChunk: (recordingId: string, chunkBuffer: ArrayBuffer, meta?: any) => Promise<{ success: boolean; bytesWritten: number }>;
    finish: (recordingId: string) => Promise<{ success: boolean; filePath: string; totalBytes: number }>;
  };
}

const electronAPI: ElectronAPI = {
  isElectron: true,
  platform: process.platform,

  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),

  startPowerSaveBlocker: () => ipcRenderer.invoke('power-save-blocker-start'),
  stopPowerSaveBlocker: () => ipcRenderer.invoke('power-save-blocker-stop'),

  setIgnoreMouseEvents: (ignore: boolean, options?: { forward: boolean }) => {
    ipcRenderer.send('overlay-ignore-mouse-events', ignore, options);
  },

  overlay: {
    show: (params) => ipcRenderer.invoke('overlay-show', params),
    hide: (target) => ipcRenderer.invoke('overlay-hide', target),
    move: (deltaX, deltaY) => ipcRenderer.send('overlay-window-move', { deltaX, deltaY }),
    sendState: (state) => ipcRenderer.send('overlay-state-sync', state),
    onState: (callback) => {
      const handler = (_: any, data: any) => callback(data);
      ipcRenderer.on('overlay-state-sync', handler);
      return () => {
        ipcRenderer.removeListener('overlay-state-sync', handler);
      };
    },
    sendCommand: (command, payload) => {
      ipcRenderer.send('overlay-command', { command, payload });
    },
    onCommand: (callback) => {
      const handler = (_: any, data: OverlayCommandMessage) => callback(data);
      ipcRenderer.on('overlay-command', handler);
      return () => {
        ipcRenderer.removeListener('overlay-command', handler);
      };
    },
    sendToast: (message) => ipcRenderer.send('overlay-toast', message),
    onToast: (callback) => {
      const handler = (_: any, data: string) => callback(data);
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
