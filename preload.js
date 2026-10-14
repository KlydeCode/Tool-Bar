const { contextBridge, ipcRenderer } = require('electron');

// Seules ces fonctions sont visibles depuis l'interface (window.bar).
contextBridge.exposeInMainWorld('bar', {
  quit: () => ipcRenderer.send('bar:quit'),
  setInteractive: (on) => ipcRenderer.send('bar:interactive', on === true),
});
