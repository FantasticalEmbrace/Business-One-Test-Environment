const { app, BrowserWindow, BrowserView, ipcMain, dialog } = require('electron');
const path = require('path');
const bridge = require('./bridge-service');

if (process.platform === 'win32') {
  app.setAppUserModelId('com.businessone.testenvironment');
}

let mainWindow;
let posView = null;

function sendBridgeEvent(data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('bridge-event', data);
  }
}

bridge.setEventSink(sendBridgeEvent);

function appIconPath() {
  if (app.isPackaged) {
    const packaged = path.join(process.resourcesPath, 'icon.ico');
    if (require('fs').existsSync(packaged)) return packaged;
  }
  return path.join(__dirname, 'assets', 'icon.ico');
}

function destroyPosView() {
  if (!posView || !mainWindow) return;
  try {
    mainWindow.removeBrowserView(posView);
    if (posView.webContents && !posView.webContents.isDestroyed()) {
      posView.webContents.destroy();
    }
  } catch {
    // ignore teardown races
  }
  posView = null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Business One Test Environment',
    icon: appIconPath(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    autoHideMenuBar: true,
    frame: true,
    backgroundColor: '#f8fafc',
  });

  mainWindow.loadFile('business-one-test-environment.html');

  mainWindow.on('resize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pos-resize-request');
    }
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    destroyPosView();
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  bridge.shutdownAll();
});

ipcMain.handle('dialog:open-file', async (event, { filters }) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: filters || [
      { name: 'Executables', extensions: ['exe'] },
      { name: 'APK Files', extensions: ['apk'] },
      { name: 'IPA Files', extensions: ['ipa'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('pos:load', async (_event, url, bounds) => {
  if (!mainWindow) return { ok: false, error: 'No window' };
  const target = String(url || '').trim();
  if (!target) return { ok: false, error: 'Missing URL' };

  if (!posView) {
    posView = new BrowserView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    mainWindow.addBrowserView(posView);
    posView.setAutoResize({ width: false, height: false });
  }

  if (bounds) {
    posView.setBounds({
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.max(200, Math.round(bounds.width)),
      height: Math.max(200, Math.round(bounds.height)),
    });
  }

  try {
    await posView.webContents.loadURL(target);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('pos:resize', async (_event, bounds) => {
  if (!posView || !bounds) return { ok: false };
  posView.setBounds({
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(200, Math.round(bounds.width)),
    height: Math.max(200, Math.round(bounds.height)),
  });
  return { ok: true };
});

ipcMain.handle('pos:clear', async () => {
  destroyPosView();
  return { ok: true };
});

ipcMain.handle('bridge:status', async () => bridge.getStatus());
ipcMain.handle('bridge:start-device', async (_event, id, options) => bridge.startDevice(id, options || {}));
ipcMain.handle('bridge:stop-device', async (_event, id) => bridge.stopDevice(id));
ipcMain.handle('bridge:list-devices', async () => bridge.listDevices());
ipcMain.handle('bridge:device-info', async (_event, id) => bridge.getDeviceInfo(id));
ipcMain.handle('bridge:device-logs', async (_event, id, limit) => bridge.getDeviceLogs(id, limit || 100));
ipcMain.handle('bridge:clear-logs', async (_event, id) => bridge.clearDeviceLogs(id));
ipcMain.handle('bridge:scan-barcode', async (_event, barcode) => bridge.scanBarcode(barcode));
