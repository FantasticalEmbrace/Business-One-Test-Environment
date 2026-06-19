const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  openFile: (filters) => ipcRenderer.invoke('dialog:open-file', { filters }),
  onEvent: (callback) => {
    ipcRenderer.on('bridge-event', (event, data) => callback(data));
  },
});
