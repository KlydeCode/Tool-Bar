const { contextBridge, ipcRenderer } = require('electron');

// Seules ces fonctions sont visibles depuis l'interface (window.bar).
contextBridge.exposeInMainWorld('bar', {
  quit: () => ipcRenderer.send('bar:quit'),
  setInteractive: (on) => ipcRenderer.send('bar:interactive', on === true),
  getBackdrop: () => ipcRenderer.invoke('bar:backdrop'),
  getSettings: () => ipcRenderer.invoke('bar:settings'),
  getShortcuts: () => ipcRenderer.invoke('bar:shortcuts'),
  // Seulement le numéro de la tuile : main.js retrouve la cible dans la config.
  launch: (index) => ipcRenderer.invoke('bar:launch', index),
  // Seulement des signaux sans données : l'interface ne reçoit jamais l'objet « event ».
  onToggle: (callback) => ipcRenderer.on('bar:toggle', () => callback()),
  onClose: (callback) => ipcRenderer.on('bar:close', () => callback()),
});
