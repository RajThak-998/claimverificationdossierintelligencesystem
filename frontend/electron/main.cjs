const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  desktopCapturer,
  session,
  powerSaveBlocker,
  shell,
} = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let overlayWindow = null;
let powerSaveBlockerId = null;

// Active disk streams for crash-safe recording
const activeDiskStreams = new Map();

// Ensure recordings directory exists in temp folder
function getRecordingsDir() {
  const dir = path.join(app.getPath('temp'), 'claim-verification-recordings');
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      console.warn('Failed to create temp recordings directory:', err);
    }
  }
  return dir;
}

/**
 * Creates the primary application dashboard window.
 */
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Claim Verification Dossier Intelligence System',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  // Windows WhatsApp Desktop Interceptor:
  // Prevents main window from navigating or reloading when clicking WhatsApp links.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (
      url.startsWith('whatsapp://') ||
      url.startsWith('https://wa.me/') ||
      url.includes('web.whatsapp.com') ||
      url.startsWith('http:') ||
      url.startsWith('https:')
    ) {
      shell.openExternal(url).catch((err) => {
        console.error('Failed to open external link:', err);
      });
      return { action: 'deny' };
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (
      url.startsWith('whatsapp://') ||
      url.startsWith('https://wa.me/') ||
      url.includes('web.whatsapp.com')
    ) {
      event.preventDefault();
      shell.openExternal(url).catch((err) => {
        console.error('Failed to open WhatsApp externally:', err);
      });
      return;
    }

    const currentOrigin = mainWindow ? mainWindow.webContents.getURL() : null;
    if (currentOrigin) {
      try {
        if (!url.startsWith(new URL(currentOrigin).origin)) {
          event.preventDefault();
          shell.openExternal(url);
        }
      } catch {}
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.close();
    }
  });

  // Load app (development server or production build)
  const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';
  const startUrl = process.env.ELECTRON_START_URL || 'http://localhost:3000';

  if (isDev) {
    mainWindow.loadURL(startUrl).catch(() => {
      const distPath = path.join(__dirname, '../dist/index.html');
      if (fs.existsSync(distPath)) {
        mainWindow && mainWindow.loadFile(distPath);
      }
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  return mainWindow;
}

/**
 * Creates the frameless, transparent, always-on-top overlay window (/call-overlay).
 */
function createOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    return overlayWindow;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { x, y, width, height } = primaryDisplay.workArea;

  overlayWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    type: 'toolbar', // Windows WS_EX_TOOLWINDOW - prevents background WhatsApp from minimizing
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    focusable: false, // Keeps focus pinned on WhatsApp Desktop call window!
    acceptFirstMouse: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  // Pins window above native Windows WhatsApp Desktop at all times
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true);

  // Click-through by default on transparent canvas
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });

  const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';
  const startUrl = process.env.ELECTRON_START_URL || 'http://localhost:3000';

  if (isDev) {
    overlayWindow.loadURL(`${startUrl}#/call-overlay`).catch(() => {
      const distPath = path.join(__dirname, '../dist/index.html');
      if (fs.existsSync(distPath)) {
        overlayWindow && overlayWindow.loadFile(distPath, { hash: '/call-overlay' });
      }
    });
  } else {
    overlayWindow.loadFile(path.join(__dirname, '../dist/index.html'), { hash: '/call-overlay' });
  }

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });

  return overlayWindow;
}

// ═══════════════════════════════════════════════════════════════════════
// OS-Level Screen & System Audio (Loopback) - Zero-Prompt Capture
// ═══════════════════════════════════════════════════════════════════════
function setupDisplayMediaHandler() {
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      if (sources && sources.length > 0) {
        callback({
          video: sources[0],
          audio: 'loopback', // Windows loopback system audio capture
        });
        return;
      }
    } catch (err) {
      console.error('Error in setDisplayMediaRequestHandler:', err);
    }
    callback({});
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (['media', 'display-capture', 'notifications', 'audio', 'video'].includes(permission)) {
      return callback(true);
    }
    callback(true);
  });

  session.defaultSession.setPermissionCheckHandler(() => true);
}

// ═══════════════════════════════════════════════════════════════════════
// IPC Handlers: Overlay, Disk Streaming, PowerSaveBlocker, Shell
// ═══════════════════════════════════════════════════════════════════════
function registerIpcHandlers() {
  // External URLs (WhatsApp Desktop app)
  ipcMain.handle('open-external', async (_event, url) => {
    if (!url) return;
    await shell.openExternal(url);
  });

  // Power save blocker (prevents OS sleep during calls)
  ipcMain.handle('power-save-blocker-start', () => {
    if (powerSaveBlockerId === null || !powerSaveBlocker.isStarted(powerSaveBlockerId)) {
      powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep');
    }
    return powerSaveBlockerId;
  });

  ipcMain.handle('power-save-blocker-stop', () => {
    if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
      powerSaveBlocker.stop(powerSaveBlockerId);
      powerSaveBlockerId = null;
    }
  });

  // Dynamic click-through toggle for frameless transparent overlay
  ipcMain.on('overlay-ignore-mouse-events', (event, ignore, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      win.setIgnoreMouseEvents(ignore, options);
    }
  });

  // Show / Hide overlay
  ipcMain.handle('overlay-show', (_event, params) => {
    const win = overlayWindow && !overlayWindow.isDestroyed() ? overlayWindow : createOverlayWindow();
    win.showInactive();
    if (params) {
      win.webContents.send('overlay-state-sync', params);
    }
  });

  ipcMain.handle('overlay-hide', () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.hide();
    }
  });

  // Relay state from main window to overlay window
  ipcMain.on('overlay-state-sync', (_event, state) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('overlay-state-sync', state);
    }
  });

  // Relay actions from overlay window to main window (STOP, CAPTURE, etc.)
  ipcMain.on('overlay-command', (_event, message) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('overlay-command', message);
    }
  });

  // Relay snapshot toast feedback to overlay window
  ipcMain.on('overlay-toast', (_event, message) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('overlay-toast', message);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // Crash-Safe Disk Streaming (Node.js fs.createWriteStream)
  // ═══════════════════════════════════════════════════════════════════
  ipcMain.handle('disk-stream-start', async (_event, { caseId, recordingId }) => {
    try {
      const recDir = getRecordingsDir();
      const sanitizedCase = (caseId || 'case').replace(/[^a-zA-Z0-9_-]/g, '_');
      const sanitizedRec = (recordingId || `rec_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `${sanitizedCase}_${sanitizedRec}_${Date.now()}.webm`;
      const filePath = path.join(recDir, filename);

      const stream = fs.createWriteStream(filePath, { flags: 'a' });
      activeDiskStreams.set(recordingId, {
        stream,
        filePath,
        bytesWritten: 0,
        caseId,
        recordingId,
        startedAt: Date.now(),
      });

      return { success: true, filePath };
    } catch (err) {
      console.error('Failed to start disk stream:', err);
      return { success: false, filePath: '', error: err.message };
    }
  });

  ipcMain.handle('disk-stream-write-chunk', async (_event, { recordingId, buffer }) => {
    const active = activeDiskStreams.get(recordingId);
    if (!active) {
      return { success: false, bytesWritten: 0, error: 'No active disk stream found for recordingId' };
    }

    try {
      const nodeBuf = Buffer.from(buffer);
      active.stream.write(nodeBuf);
      active.bytesWritten += nodeBuf.length;
      return { success: true, bytesWritten: active.bytesWritten };
    } catch (err) {
      console.error('Failed to write disk chunk:', err);
      return { success: false, bytesWritten: active.bytesWritten, error: err.message };
    }
  });

  ipcMain.handle('disk-stream-finish', async (_event, { recordingId }) => {
    const active = activeDiskStreams.get(recordingId);
    if (!active) {
      return { success: false, filePath: '', totalBytes: 0 };
    }

    return new Promise((resolve) => {
      active.stream.end(() => {
        const result = {
          success: true,
          filePath: active.filePath,
          totalBytes: active.bytesWritten,
        };
        activeDiskStreams.delete(recordingId);
        resolve(result);
      });
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════
// App Initialization
// ═══════════════════════════════════════════════════════════════════════
app.whenReady().then(() => {
  setupDisplayMediaHandler();
  registerIpcHandlers();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
    powerSaveBlocker.stop(powerSaveBlockerId);
    powerSaveBlockerId = null;
  }

  activeDiskStreams.forEach((item) => {
    try {
      item.stream.end();
    } catch {}
  });
  activeDiskStreams.clear();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});
