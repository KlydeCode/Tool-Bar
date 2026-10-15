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
  // Lancement au démarrage de Windows : { available, enabled }.
  getStartup: () => ipcRenderer.invoke('bar:startup'),
  setStartup: (on) => ipcRenderer.invoke('bar:set-startup', on === true),
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
  // Applis du PC : recherche par texte, puis tout se fait avec l'identifiant Windows de l'appli.
  searchApps: (query) => ipcRenderer.invoke('bar:search-apps', query),
  getAppIcon: (id) => ipcRenderer.invoke('bar:app-icon', id),
  launchApp: (id) => ipcRenderer.invoke('bar:launch-app', id),
  pinApp: (id) => ipcRenderer.invoke('bar:pin-app', id),
  // Menu du clic droit sur un résultat ; réponse quand il se ferme (null si rien n'a été choisi).
  appMenu: (id) => ipcRenderer.invoke('bar:app-menu', id),
  // Agenda : semaine (date en millisecondes), liste des agendas, ajout d'un lien, import d'un .ics, suppression.
  getWeek: (startMs) => ipcRenderer.invoke('bar:week', startMs),
  getCalendars: () => ipcRenderer.invoke('bar:calendars'),
  addCalendar: (url) => ipcRenderer.invoke('bar:add-calendar', url),
  importCalendar: () => ipcRenderer.invoke('bar:import-calendar'),
  removeCalendar: (id) => ipcRenderer.invoke('bar:remove-calendar', id),
  // Seulement des signaux sans données : l'interface ne reçoit jamais l'objet « event ».
  onToggle: (callback) => ipcRenderer.on('bar:toggle', () => callback()),
  onClose: (callback) => ipcRenderer.on('bar:close', () => callback()),
});
