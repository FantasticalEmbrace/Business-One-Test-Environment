'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { BridgeService } = require('./bridge-service');

let mainWindow = null;
let bridge = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1024,
        minHeight: 700,
        title: 'Business One Test Environment',
        backgroundColor: '#1f82ff',
        icon: path.join(__dirname, 'assets', 'icon.ico'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        }
    });

    mainWindow.loadFile('index.html');
    mainWindow.setMenuBarVisibility(false);

    if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    bridge = new BridgeService();
    const ports = bridge.start();

    ipcMain.handle('bridge:getPorts', () => ports);
    ipcMain.handle('bridge:getState', () => ({
        devices: bridge.deviceSnapshot(),
        networkSim: bridge.networkSim,
        posConfig: bridge.posConfig
    }));
    ipcMain.handle('bridge:launchApp', (_e, exePath, args, cwd) => {
        bridge._launchWindowsApp(exePath, args, cwd);
    });
    ipcMain.handle('bridge:selectExe', async () => {
        const { dialog } = require('electron');
        const result = await dialog.showOpenDialog(mainWindow, {
            title: 'Select POS executable',
            filters: [{ name: 'Executables', extensions: ['exe'] }],
            properties: ['openFile']
        });
        return result.canceled ? null : result.filePaths[0];
    });
    ipcMain.handle('bridge:selectApk', async () => {
        const { dialog } = require('electron');
        const result = await dialog.showOpenDialog(mainWindow, {
            title: 'Select Android APK',
            filters: [{ name: 'APK', extensions: ['apk'] }],
            properties: ['openFile']
        });
        return result.canceled ? null : result.filePaths[0];
    });
    ipcMain.handle('shell:openExternal', (_e, url) => shell.openExternal(url));

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (bridge) bridge.stop();
    if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
    if (bridge) bridge.stop();
});
