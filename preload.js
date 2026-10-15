const { contextBridge, ipcRenderer } = require('electron');

// Seules ces fonctions sont visibles depuis l'interface (window.bar).
contextBridge.exposeInMainWorld('bar', {
  quit: () => ipcRenderer.send('bar:quit'),
  setInteractive: (on) => ipcRenderer.send('bar:interactive', on === true),
  getBackdrop: () => ipcRenderer.invoke('bar:backdrop'),
  // Seulement des signaux sans données : l'interface ne reçoit jamais l'objet « event ».
  onToggle: (callback) => ipcRenderer.on('bar:toggle', () => callback()),
  onClose: (callback) => ipcRenderer.on('bar:close', () => callback()),
});
