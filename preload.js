'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bote', {
    getPorts: () => ipcRenderer.invoke('bridge:getPorts'),
    getState: () => ipcRenderer.invoke('bridge:getState'),
    launchApp: (exePath, args, cwd) => ipcRenderer.invoke('bridge:launchApp', exePath, args, cwd),
    selectExe: () => ipcRenderer.invoke('bridge:selectExe'),
    selectApk: () => ipcRenderer.invoke('bridge:selectApk'),
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
    isElectron: true
});
