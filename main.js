const { app, BrowserWindow, desktopCapturer, ipcMain, screen } = require('electron');
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

// Capture de l'écran derrière la fenêtre, floutée ensuite en CSS sous le panneau.
// (Windows ne floute pas ce qui est derrière une fenêtre transparente, et l'acrylique
// floute tout le rectangle de la fenêtre, pas seulement le panneau arrondi.)
async function captureBackdrop() {
  if (!win) return null;
  const display = screen.getPrimaryDisplay();
  const sf = display.scaleFactor;
  // La barre s'exclut de la capture le temps de la prendre.
  win.setContentProtection(true);
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: display.size.width * sf, height: display.size.height * sf },
    });
    const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
    if (!source) return null;
    const b = win.getBounds();
    const image = source.thumbnail.crop({
      x: Math.round((b.x - display.bounds.x) * sf),
      y: Math.round((b.y - display.bounds.y) * sf),
      width: Math.round(b.width * sf),
      height: Math.round(b.height * sf),
    });
    return `data:image/jpeg;base64,${image.toJPEG(80).toString('base64')}`;
  } catch (error) {
    console.error('Capture du fond impossible :', error);
    return null;
  } finally {
    win.setContentProtection(false);
  }
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
  ipcMain.handle('bar:backdrop', captureBackdrop);
  ipcMain.on('bar:interactive', (_event, on) => {
    win?.setIgnoreMouseEvents(on !== true, { forward: true });
  });
  app.on('window-all-closed', () => app.quit());
}
