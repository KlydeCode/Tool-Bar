const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const readline = require('node:readline');
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

// Capture de l'écran derrière la fenêtre, floutée ensuite sous le panneau (voir app.js).
// (Windows ne floute pas ce qui est derrière une fenêtre transparente, et l'acrylique
// floute tout le rectangle de la fenêtre, pas seulement le panneau arrondi.)
// Faite par un petit script PowerShell qui reste ouvert : desktopCapturer bloquait le
// processus principal ~0,35 s à chaque survol, ce qui faisait saccader la souris et l'animation.
const BACKDROP_SCALE = 0.25; // l'image est floutée : une petite capture suffit
let capturer = null;
const pending = [];

function startCapturer() {
  // shortcut: le script est lu depuis le dossier du projet ; pour l'installateur (phase 10), le sortir de l'archive asar.
  capturer = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(__dirname, 'helpers', 'capture.ps1'),
  ], { windowsHide: true });
  readline.createInterface({ input: capturer.stdout }).on('line', (line) => pending.shift()?.(line));
  capturer.on('error', (error) => console.error('Script de capture introuvable :', error));
  capturer.on('exit', () => {
    capturer = null;
    pending.splice(0).forEach((resolve) => resolve(''));
  });
}

function grabScreen(x, y, width, height) {
  if (!capturer) startCapturer();
  return new Promise((resolve) => {
    pending.push(resolve);
    capturer.stdin.write(`${x} ${y} ${width} ${height} ${BACKDROP_SCALE}\n`);
    // Si le script ne répond pas, le panneau reste simplement sans flou.
    setTimeout(() => resolve(''), 2000);
  });
}

async function captureBackdrop() {
  if (!win) return null;
  const b = win.getBounds();
  // La barre s'exclut de la capture le temps de la prendre.
  win.setContentProtection(true);
  try {
    const base64 = await grabScreen(b.x, b.y, b.width, b.height);
    return base64 ? `data:image/jpeg;base64,${base64}` : null;
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
    startCapturer(); // prêt avant le premier survol

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
  app.on('will-quit', () => capturer?.kill());
}
