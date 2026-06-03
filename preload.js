const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('modemAPI', {
  // ─── Serial Port ────────────────────────────────────────────────────────────
  listPorts: () => ipcRenderer.invoke('serial:list-ports'),
  connect: (port, baudRate) => ipcRenderer.invoke('serial:connect', port, baudRate),
  disconnect: () => ipcRenderer.invoke('serial:disconnect'),
  sendCommand: (cmd) => ipcRenderer.invoke('serial:send', cmd),
  sendRaw: (data) => ipcRenderer.invoke('serial:send-raw', data),
  isConnected: () => ipcRenderer.invoke('serial:is-connected'),

  // ─── Event Listeners ───────────────────────────────────────────────────────
  onData: (callback) => {
    ipcRenderer.on('serial:data', (event, data) => callback(data));
  },
  onConnectionStatus: (callback) => {
    ipcRenderer.on('serial:connection-status', (event, status) => callback(status));
  },
  onError: (callback) => {
    ipcRenderer.on('serial:error', (event, error) => callback(error));
  },

  // ─── Window Controls ───────────────────────────────────────────────────────
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close')
});
