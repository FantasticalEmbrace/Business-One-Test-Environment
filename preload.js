const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  openFile: (filters) => ipcRenderer.invoke('dialog:open-file', { filters }),
  onEvent: (callback) => {
    ipcRenderer.on('bridge-event', (event, data) => callback(data));
  },
  isElectron: true,
  loadPos: (url, bounds) => ipcRenderer.invoke('pos:load', url, bounds),
  resizePos: (bounds) => ipcRenderer.invoke('pos:resize', bounds),
  clearPos: () => ipcRenderer.invoke('pos:clear'),
  onPosResizeRequest: (callback) => {
    ipcRenderer.on('pos-resize-request', () => callback());
  },
  getStatus: () => ipcRenderer.invoke('bridge:status'),
  startDevice: (id, options) => ipcRenderer.invoke('bridge:start-device', id, options),
  stopDevice: (id) => ipcRenderer.invoke('bridge:stop-device', id),
  listDevices: () => ipcRenderer.invoke('bridge:list-devices'),
  getDeviceInfo: (id) => ipcRenderer.invoke('bridge:device-info', id),
  getDeviceLogs: (id, limit) => ipcRenderer.invoke('bridge:device-logs', id, limit),
  clearDeviceLogs: (id) => ipcRenderer.invoke('bridge:clear-logs', id),
  scanBarcode: (barcode) => ipcRenderer.invoke('bridge:scan-barcode', barcode),
});
