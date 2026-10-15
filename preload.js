const { contextBridge, ipcRenderer } = require('electron');

// Seules ces fonctions sont visibles depuis l'interface (window.bar).
contextBridge.exposeInMainWorld('bar', {
  quit: () => ipcRenderer.send('bar:quit'),
  setInteractive: (on) => ipcRenderer.send('bar:interactive', on === true),
  getBackdrop: () => ipcRenderer.invoke('bar:backdrop'),
  getSettings: () => ipcRenderer.invoke('bar:settings'),
  // Réglages vérifiés par main.js ; réponse { ok, error?, settings }.
  saveSettings: (settings) => ipcRenderer.invoke('bar:save-settings', settings),
  resetSettings: () => ipcRenderer.invoke('bar:reset-settings'),
  // « app », « file » ou « folder » : ouvre la fenêtre de choix de Windows, renvoie le chemin ou null.
  pickTarget: (kind) => ipcRenderer.invoke('bar:pick', kind),
  getShortcuts: () => ipcRenderer.invoke('bar:shortcuts'),
  getAudio: () => ipcRenderer.invoke('bar:audio'),
  setVolume: (percent) => ipcRenderer.invoke('bar:volume', percent),
  setMicMuted: (muted) => ipcRenderer.invoke('bar:mic', muted),
  getMedia: () => ipcRenderer.invoke('bar:media'),
  getMediaArt: () => ipcRenderer.invoke('bar:media-art'),
  // « play » (lecture/pause), « next » ou « prev » seulement.
  mediaControl: (action) => ipcRenderer.invoke('bar:media-control', action),
  // Seulement le numéro de la tuile : main.js retrouve la cible dans la config.
  launch: (index) => ipcRenderer.invoke('bar:launch', index),
  // Applis du PC : recherche par texte, puis tout se fait avec le numéro du résultat.
  searchApps: (query) => ipcRenderer.invoke('bar:search-apps', query),
  getAppIcon: (index) => ipcRenderer.invoke('bar:app-icon', index),
  launchApp: (index) => ipcRenderer.invoke('bar:launch-app', index),
  pinApp: (index) => ipcRenderer.invoke('bar:pin-app', index),
  // Seulement des signaux sans données : l'interface ne reçoit jamais l'objet « event ».
  onToggle: (callback) => ipcRenderer.on('bar:toggle', () => callback()),
  onClose: (callback) => ipcRenderer.on('bar:close', () => callback()),
});
