const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('node:path');
const { topCenter } = require('./lib/position');

// Taille fixe = panneau déplié (680 px) + marge pour l'ombre ; la pilule est dessinée dedans.
const WIDTH = 720;
const HEIGHT = 440;

let win = null;

function placeWindow() {
  const { x, y } = topCenter(screen.getPrimaryDisplay().workArea, WIDTH);
  win.setBounds({ x, y, width: WIDTH, height: HEIGHT });
}

function createWindow() {
  win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    // Essai (tâche 2.6) : effet acrylique de Windows 11 seulement avec « npm run start:acrylic ».
    ...(process.env.BAR_ACRYLIC && { backgroundMaterial: 'acrylic' }),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // Niveau « screen-saver » : reste au-dessus même de la barre des tâches Windows.
  win.setAlwaysOnTop(true, 'screen-saver');
  placeWindow();
  // Au départ, les clics traversent la fenêtre ; « forward » garde le survol pour détecter la pilule.
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => win.showInactive());
}

// Une seule barre à la fois : un deuxième lancement s'arrête tout de suite.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    createWindow();
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) {
      screen.on(event, placeWindow);
    }
  });

  ipcMain.on('bar:quit', () => app.quit());
  ipcMain.on('bar:interactive', (_event, on) => {
    win?.setIgnoreMouseEvents(on !== true, { forward: true });
  });
  app.on('window-all-closed', () => app.quit());
}
