const { app, BrowserWindow, globalShortcut, ipcMain, screen, shell } = require('electron');
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { loadConfig } = require('./lib/config');
const { isPackageName, packageIconFile, resolveShortcut } = require('./lib/launch');
const { topCenter } = require('./lib/position');

// Taille fixe = panneau déplié (680 px) + marge ; la pilule est dessinée dedans.
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
  // Panneau ouvert au clavier puis clic ailleurs : on le referme.
  win.on('blur', () => win.webContents.send('bar:close'));
}

// Raccourci global : ouvre ou ferme la barre depuis n'importe quelle appli.
// (Ctrl+Alt+Espace était prévu mais il est déjà pris, sans doute par l'appli Claude.)
const TOGGLE_SHORTCUT = 'Alt+Shift+Space';

function registerShortcut() {
  const ok = globalShortcut.register(TOGGLE_SHORTCUT, () => {
    // Le focus permet de fermer avec Échap ; la barre se referme si on clique ailleurs.
    win.focus();
    win.webContents.send('bar:toggle');
  });
  if (!ok) console.error(`Raccourci ${TOGGLE_SHORTCUT} déjà utilisé par une autre appli.`);
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
  const stop = () => {
    capturer = null;
    pending.splice(0).forEach((resolve) => resolve(''));
  };
  capturer.on('error', (error) => {
    console.error('Script de capture impossible à lancer :', error);
    stop();
  });
  capturer.on('exit', stop);
  // Écrire vers un script arrêté ne doit pas faire planter l'appli.
  capturer.stdin.on('error', () => {});
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

// ---------- Raccourcis d'applis ----------
// Définis dans config.default.json, remplaçables par userData/config.json (réglages en phase 9).
const MAX_TILES = 6;
let shortcuts = [];

function loadShortcuts() {
  const file = path.join(app.getPath('userData'), 'config.json');
  shortcuts = loadConfig(file, require('./config.default.json')).shortcuts.slice(0, MAX_TILES);
}

function resolveTarget(shortcut) {
  return resolveShortcut(shortcut, {
    env: { ...process.env, DOWNLOADS: app.getPath('downloads') },
    // lstat et non stat : les alias d'applis Windows (wt.exe, claude-desktop.exe) sont des liens que stat ne lit pas.
    exists: (p) => {
      try {
        fs.lstatSync(p);
        return true;
      } catch {
        return false;
      }
    },
  });
}

// Dossier d'installation d'une appli du Microsoft Store (nom vérifié, passé en argument séparé).
function packageDir(name) {
  if (!isPackageName(name)) return Promise.resolve('');
  return new Promise((resolve) => {
    execFile('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      '& { (Get-AppxPackage -Name $args[0] | Select-Object -First 1).InstallLocation }', name,
    ], { windowsHide: true, timeout: 5000 }, (error, stdout) => resolve(error ? '' : stdout.trim()));
  });
}

async function iconPath(shortcut) {
  if (shortcut?.type !== 'app') return null;
  if (shortcut.icon) {
    const file = packageIconFile(await packageDir(shortcut.icon.package), shortcut.icon.file);
    if (file) return file;
  }
  return resolveTarget(shortcut)?.path ?? null;
}

// Nom, type et vraie icône (applis uniquement) de chaque tuile, pour l'interface.
async function describeShortcuts() {
  return Promise.all(shortcuts.map(async (shortcut) => {
    const name = typeof shortcut?.name === 'string' ? shortcut.name.slice(0, 40) : '';
    const type = shortcut?.type === 'settings' ? 'settings' : 'launch';
    const file = await iconPath(shortcut);
    let icon = null;
    if (file) {
      try {
        icon = (await app.getFileIcon(file, { size: 'large' })).toDataURL();
      } catch {
        // Pas d'icône : l'interface garde son pictogramme.
      }
    }
    return { name, type, icon };
  }));
}

async function launchShortcut(_event, index) {
  if (!Number.isInteger(index) || index < 0 || index >= shortcuts.length) return false;
  const target = resolveTarget(shortcuts[index]);
  if (!target) {
    console.error(`Raccourci ${index + 1} : cible introuvable ou refusée.`);
    return false;
  }
  if (target.url) {
    await shell.openExternal(target.url);
    return true;
  }
  const error = await shell.openPath(target.path);
  if (error) console.error(`Raccourci ${index + 1} : ${error}`);
  return !error;
}

// Une seule barre à la fois : un deuxième lancement s'arrête tout de suite.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    loadShortcuts();
    createWindow();
    startCapturer(); // prêt avant le premier survol
    registerShortcut();

    for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) {
      screen.on(event, placeWindow);
    }
  });

  ipcMain.on('bar:quit', () => app.quit());
  ipcMain.handle('bar:backdrop', captureBackdrop);
  ipcMain.handle('bar:shortcuts', describeShortcuts);
  ipcMain.handle('bar:launch', launchShortcut);
  ipcMain.on('bar:interactive', (_event, on) => {
    win?.setIgnoreMouseEvents(on !== true, { forward: true });
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    capturer?.kill();
  });
}
