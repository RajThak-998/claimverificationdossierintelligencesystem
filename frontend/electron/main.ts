import {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  desktopCapturer,
  session,
  powerSaveBlocker,
  shell,
} from 'electron';
import * as path from 'path';
import * as fs from 'fs';

let mainWindow: BrowserWindow | null = null;
let recOverlayWindow: BrowserWindow | null = null;
let capOverlayWindow: BrowserWindow | null = null;
let recWindowPos: { x: number; y: number } | null = null;
let capWindowPos: { x: number; y: number } | null = null;
let powerSaveBlockerId: number | null = null;

// Active disk streams for crash-safe recording
interface ActiveDiskStream {
  stream: fs.WriteStream;
  filePath: string;
  bytesWritten: number;
  caseId: string;
  recordingId: string;
  startedAt: number;
}
const activeDiskStreams = new Map<string, ActiveDiskStream>();

// Ensure recordings directory exists in temp folder
function getRecordingsDir(): string {
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
function createMainWindow(): BrowserWindow {
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

    const currentOrigin = mainWindow?.webContents.getURL();
    if (currentOrigin && !url.startsWith(new URL(currentOrigin).origin)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (recOverlayWindow && !recOverlayWindow.isDestroyed()) {
      recOverlayWindow.close();
    }
    if (capOverlayWindow && !capOverlayWindow.isDestroyed()) {
      capOverlayWindow.close();
    }
  });

  // Load app (development server or production build)
  const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';
  const startUrl = process.env.ELECTRON_START_URL || 'http://localhost:3000';

  if (isDev) {
    mainWindow.loadURL(startUrl).catch(() => {
      // If dev server not yet responding, retry or load local dist
      const distPath = path.join(__dirname, '../dist/index.html');
      if (fs.existsSync(distPath)) {
        mainWindow?.loadFile(distPath);
      }
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  return mainWindow;
}

/**
 * Creates the compact, frameless, always-on-top Recording / Stop overlay window.
 */
function createRecOverlayWindow(): BrowserWindow {
  if (recOverlayWindow && !recOverlayWindow.isDestroyed()) {
    return recOverlayWindow;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const workArea = primaryDisplay.workArea;

  const defaultX = Math.max(workArea.x + 20, Math.floor(workArea.x + workArea.width / 2) - 250);
  const defaultY = Math.max(workArea.y + 20, workArea.y + workArea.height - 80);

  const initialX = recWindowPos ? recWindowPos.x : defaultX;
  const initialY = recWindowPos ? recWindowPos.y : defaultY;

  recOverlayWindow = new BrowserWindow({
    width: 240,
    height: 56,
    minWidth: 240,
    maxWidth: 240,
    minHeight: 56,
    maxHeight: 56,
    useContentSize: true,
    x: initialX,
    y: initialY,
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

  recOverlayWindow.setAlwaysOnTop(true, 'screen-saver');
  recOverlayWindow.setVisibleOnAllWorkspaces(true);

  const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';
  const startUrl = process.env.ELECTRON_START_URL || 'http://localhost:3000';

  if (isDev) {
    recOverlayWindow.loadURL(`${startUrl}#/call-overlay?mode=rec`).catch(() => {
      const distPath = path.join(__dirname, '../dist/index.html');
      if (fs.existsSync(distPath)) {
        recOverlayWindow?.loadFile(distPath, { hash: '/call-overlay?mode=rec' });
      }
    });
  } else {
    recOverlayWindow.loadFile(path.join(__dirname, '../dist/index.html'), { hash: '/call-overlay?mode=rec' });
  }

  recOverlayWindow.on('closed', () => {
    recOverlayWindow = null;
  });

  return recOverlayWindow;
}

/**
 * Creates the compact, frameless, always-on-top Screenshot Capture overlay window.
 */
function createCapOverlayWindow(): BrowserWindow {
  if (capOverlayWindow && !capOverlayWindow.isDestroyed()) {
    return capOverlayWindow;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const workArea = primaryDisplay.workArea;

  const defaultX = Math.max(workArea.x + 20, Math.floor(workArea.x + workArea.width / 2) + 20);
  const defaultY = Math.max(workArea.y + 20, workArea.y + workArea.height - 80);

  const initialX = capWindowPos ? capWindowPos.x : defaultX;
  const initialY = capWindowPos ? capWindowPos.y : defaultY;

  capOverlayWindow = new BrowserWindow({
    width: 180,
    height: 56,
    minWidth: 180,
    maxWidth: 180,
    minHeight: 56,
    maxHeight: 56,
    useContentSize: true,
    x: initialX,
    y: initialY,
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

  capOverlayWindow.setAlwaysOnTop(true, 'screen-saver');
  capOverlayWindow.setVisibleOnAllWorkspaces(true);

  const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';
  const startUrl = process.env.ELECTRON_START_URL || 'http://localhost:3000';

  if (isDev) {
    capOverlayWindow.loadURL(`${startUrl}#/call-overlay?mode=cap`).catch(() => {
      const distPath = path.join(__dirname, '../dist/index.html');
      if (fs.existsSync(distPath)) {
        capOverlayWindow?.loadFile(distPath, { hash: '/call-overlay?mode=cap' });
      }
    });
  } else {
    capOverlayWindow.loadFile(path.join(__dirname, '../dist/index.html'), { hash: '/call-overlay?mode=cap' });
  }

  capOverlayWindow.on('closed', () => {
    capOverlayWindow = null;
  });

  return capOverlayWindow;
}

// ═══════════════════════════════════════════════════════════════════════
// OS-Level Screen & System Audio (Loopback) - Zero-Prompt Capture
// ═══════════════════════════════════════════════════════════════════════
function setupDisplayMediaHandler() {
  // Automatically select primary screen and enable Windows loopback audio
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

  // Auto-grant permissions for seamless zero-prompt experience
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
  ipcMain.handle('open-external', async (_event, url: string) => {
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

  // Move overlay window dynamically when dragged by user
  ipcMain.on('overlay-window-move', (event, { deltaX, deltaY }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      const isRec = win === recOverlayWindow;
      const targetWidth = isRec ? 240 : 180;
      const targetHeight = 56;

      const [currentX, currentY] = win.getPosition();
      const newX = Math.round(currentX + deltaX);
      const newY = Math.round(currentY + deltaY);

      // Explicitly lock width and height so Windows DPI scaling never inflates the window!
      win.setBounds({
        x: newX,
        y: newY,
        width: targetWidth,
        height: targetHeight,
      });

      if (isRec) {
        recWindowPos = { x: newX, y: newY };
      } else if (win === capOverlayWindow) {
        capWindowPos = { x: newX, y: newY };
      }
    }
  });

  // Dynamic click-through toggle for frameless transparent overlay (backwards compatible)
  ipcMain.on('overlay-ignore-mouse-events', (event, ignore: boolean, options?: { forward: boolean }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      win.setIgnoreMouseEvents(ignore, options);
    }
  });

  // Show / Hide compact overlay windows
  ipcMain.handle('overlay-show', (_event, params) => {
    const recWin = recOverlayWindow && !recOverlayWindow.isDestroyed() ? recOverlayWindow : createRecOverlayWindow();
    const capWin = capOverlayWindow && !capOverlayWindow.isDestroyed() ? capOverlayWindow : createCapOverlayWindow();

    recWin.showInactive();
    capWin.showInactive();

    if (params) {
      recWin.webContents.send('overlay-state-sync', params);
      capWin.webContents.send('overlay-state-sync', params);
    }
  });

  ipcMain.handle('overlay-hide', (_event, target?: string) => {
    if (target === 'rec' && recOverlayWindow && !recOverlayWindow.isDestroyed()) {
      recOverlayWindow.hide();
      return;
    }
    if (target === 'cap' && capOverlayWindow && !capOverlayWindow.isDestroyed()) {
      capOverlayWindow.hide();
      return;
    }
    if (recOverlayWindow && !recOverlayWindow.isDestroyed()) {
      recOverlayWindow.hide();
    }
    if (capOverlayWindow && !capOverlayWindow.isDestroyed()) {
      capOverlayWindow.hide();
    }
  });

  // Relay state from main window to overlay windows
  ipcMain.on('overlay-state-sync', (_event, state) => {
    if (recOverlayWindow && !recOverlayWindow.isDestroyed()) {
      recOverlayWindow.webContents.send('overlay-state-sync', state);
    }
    if (capOverlayWindow && !capOverlayWindow.isDestroyed()) {
      capOverlayWindow.webContents.send('overlay-state-sync', state);
    }
  });

  // Relay actions from overlay window to main window (START, STOP, CAPTURE, etc.)
  ipcMain.on('overlay-command', (_event, message) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('overlay-command', message);
    }
  });

  // Relay snapshot toast feedback to overlay window
  ipcMain.on('overlay-toast', (_event, message: string) => {
    if (capOverlayWindow && !capOverlayWindow.isDestroyed()) {
      capOverlayWindow.webContents.send('overlay-toast', message);
    }
    if (recOverlayWindow && !recOverlayWindow.isDestroyed()) {
      recOverlayWindow.webContents.send('overlay-toast', message);
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
    } catch (err: any) {
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
    } catch (err: any) {
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
  // Clean up any pending power save blockers
  if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
    powerSaveBlocker.stop(powerSaveBlockerId);
    powerSaveBlockerId = null;
  }

  // End any lingering disk streams
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
