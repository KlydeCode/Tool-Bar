const { app, BrowserWindow, dialog, globalShortcut, ipcMain, screen, shell } = require('electron');
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { levelArg, micFromAnswer, percentFromLevel } = require('./lib/audio');
const { loadConfig, saveConfig } = require('./lib/config');
const { parseMedia } = require('./lib/media');
const { isPackageName, packageIconFile, resolveShortcut } = require('./lib/launch');
const { topCenter } = require('./lib/position');
const { cleanSettings } = require('./lib/settings');

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
  // Panneau ouvert au clavier puis clic ailleurs : on le referme (sauf pendant le choix d'un fichier).
  win.on('blur', () => {
    if (!picking) win.webContents.send('bar:close');
  });
}

// Raccourci global (réglable, Alt+Maj+Espace par défaut) : ouvre ou ferme la barre depuis n'importe quelle appli.
// (Ctrl+Alt+Espace était prévu mais il est déjà pris, sans doute par l'appli Claude.)
function registerShortcut(accelerator) {
  const ok = globalShortcut.register(accelerator, () => {
    // Le focus permet de fermer avec Échap ; la barre se referme si on clique ailleurs.
    win.focus();
    win.webContents.send('bar:toggle');
  });
  if (!ok) console.error(`Raccourci ${accelerator} déjà utilisé par une autre appli.`);
  return ok;
}

// ---------- Script Windows (helpers/windows.ps1) ----------
// Un petit script PowerShell lancé une fois et resté ouvert fait la capture du fond, le volume
// et le micro. Les demandes ne contiennent que des nombres préparés ici, jamais du texte de l'interface.
// (desktopCapturer bloquait le processus principal ~0,35 s à chaque survol : souris et animation saccadées.)
let helper = null;
const pending = [];

function startHelper() {
  // shortcut: le script est lu depuis le dossier du projet ; pour l'installateur (phase 10), le sortir de l'archive asar.
  helper = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(__dirname, 'helpers', 'windows.ps1'),
  ], { windowsHide: true });
  readline.createInterface({ input: helper.stdout }).on('line', (line) => pending.shift()?.(line));
  const stop = () => {
    helper = null;
    pending.splice(0).forEach((resolve) => resolve(''));
  };
  helper.on('error', (error) => {
    console.error('Script Windows impossible à lancer :', error);
    stop();
  });
  helper.on('exit', stop);
  // Écrire vers un script arrêté ne doit pas faire planter l'appli.
  helper.stdin.on('error', () => {});
}

// Envoie une demande au script ; réponse '' en cas d'erreur ou sans réponse à temps.
function ask(request) {
  if (!helper) startHelper();
  return new Promise((resolve) => {
    pending.push(resolve);
    helper.stdin.write(`${request}\n`);
    // Large : au démarrage, le script met une ou deux secondes à se préparer.
    setTimeout(() => resolve(''), 4000);
  });
}

// Capture de l'écran derrière la fenêtre, floutée ensuite sous le panneau (voir app.js).
// (Windows ne floute pas ce qui est derrière une fenêtre transparente, et l'acrylique
// floute tout le rectangle de la fenêtre, pas seulement le panneau arrondi.)
const BACKDROP_SCALE = 0.25; // l'image est floutée : une petite capture suffit

async function captureBackdrop() {
  if (!win) return null;
  const b = win.getBounds();
  // La barre s'exclut de la capture le temps de la prendre.
  win.setContentProtection(true);
  try {
    const base64 = await ask(`capture ${b.x} ${b.y} ${b.width} ${b.height} ${BACKDROP_SCALE}`);
    return base64 ? `data:image/jpeg;base64,${base64}` : null;
  } finally {
    win.setContentProtection(false);
  }
}

// ---------- Volume et micro ----------
async function getAudio() {
  const volume = percentFromLevel(await ask('volume'));
  const micMuted = micFromAnswer(await ask('mic'));
  return { volume, micMuted };
}

async function setVolume(_event, percent) {
  const level = levelArg(percent);
  return level !== null && (await ask(`volume-set ${level}`)) === 'ok';
}

async function setMicMuted(_event, muted) {
  if (typeof muted !== 'boolean') return false;
  return (await ask(`mic-set ${muted ? 1 : 0}`)) === 'ok';
}

// ---------- Musique ----------
// Morceau en cours de n'importe quelle appli qui se déclare à Windows (Spotify, Deezer, Apple Music, navigateurs…).
const MEDIA_ACTIONS = ['play', 'next', 'prev'];

async function getMedia() {
  return parseMedia(await ask('media'));
}

async function getMediaArt() {
  const base64 = await ask('media-art');
  return base64 ? `data:image/jpeg;base64,${base64}` : null;
}

async function mediaControl(_event, action) {
  if (!MEDIA_ACTIONS.includes(action)) return false;
  return (await ask(`media-${action}`)) === 'ok';
}

// ---------- Réglages ----------
// config.default.json + userData/config.json, toujours nettoyés par cleanSettings (lib/settings.js).
const DEFAULTS = require('./config.default.json');
let config = null;
let picking = false; // une fenêtre de choix de fichier est ouverte

function configFile() {
  return path.join(app.getPath('userData'), 'config.json');
}

function loadSettings() {
  config = cleanSettings(loadConfig(configFile(), DEFAULTS), DEFAULTS);
}

// Tout ce qui est dans la config peut être montré à l'interface (couleurs, tuiles…).
function uiSettings() {
  return config;
}

// Enregistre de nouveaux réglages venant de l'interface, après vérification. Le raccourci clavier
// n'est changé que s'il est libre ; en cas d'échec, les anciens réglages restent en place.
function saveSettings(_event, input) {
  const next = cleanSettings(input, DEFAULTS);
  const shortcutChanged = next.toggleShortcut !== config.toggleShortcut;
  if (shortcutChanged) {
    globalShortcut.unregister(config.toggleShortcut);
    if (!registerShortcut(next.toggleShortcut)) {
      registerShortcut(config.toggleShortcut);
      return { ok: false, error: 'Ce raccourci clavier est déjà utilisé par une autre appli.', settings: config };
    }
  }
  try {
    saveConfig(configFile(), next);
  } catch (error) {
    console.error('Réglages non enregistrés :', error);
    if (shortcutChanged) {
      globalShortcut.unregister(next.toggleShortcut);
      registerShortcut(config.toggleShortcut);
    }
    return { ok: false, error: "Impossible d'enregistrer les réglages.", settings: config };
  }
  config = next;
  return { ok: true, settings: config };
}

function resetSettings(event) {
  return saveSettings(event, DEFAULTS);
}

// Choix d'une appli (.exe) ou d'un dossier pour une tuile, avec la fenêtre de Windows.
async function pickTarget(_event, kind) {
  if (kind !== 'app' && kind !== 'folder') return null;
  picking = true;
  try {
    const result = await dialog.showOpenDialog(win, kind === 'app'
      ? { title: 'Choisir une appli', properties: ['openFile'], filters: [{ name: 'Applications', extensions: ['exe'] }] }
      : { title: 'Choisir un dossier', properties: ['openDirectory'] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  } finally {
    picking = false;
  }
}

// ---------- Raccourcis d'applis ----------
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
  // Seules les applis ont leur vraie icône ; dossiers et sites gardent un pictogramme simple.
  if (shortcut?.type !== 'app') return null;
  if (shortcut.icon) {
    const file = packageIconFile(await packageDir(shortcut.icon.package), shortcut.icon.file);
    if (file) return file;
  }
  return resolveTarget(shortcut)?.path ?? null;
}

// Nom, type et vraie icône (applis uniquement) de chaque tuile, pour l'interface.
async function describeShortcuts() {
  return Promise.all(config.shortcuts.map(async (shortcut) => {
    const name = typeof shortcut?.name === 'string' ? shortcut.name.slice(0, 40) : '';
    const type = shortcut.type; // déjà vérifié par cleanSettings : app, folder, url ou settings
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
  if (!Number.isInteger(index) || index < 0 || index >= config.shortcuts.length) return false;
  const target = resolveTarget(config.shortcuts[index]);
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

// ---------- Démarrage ----------
function start() {
  app.on('second-instance', () => app.quit());
  app.whenReady().then(() => {
    loadSettings();
    createWindow();
    startHelper(); // prêt avant le premier survol
    registerShortcut(config.toggleShortcut);

    for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) {
      screen.on(event, placeWindow);
    }
  });

  ipcMain.on('bar:quit', () => app.quit());
  ipcMain.handle('bar:backdrop', captureBackdrop);
  ipcMain.handle('bar:settings', uiSettings);
  ipcMain.handle('bar:save-settings', saveSettings);
  ipcMain.handle('bar:reset-settings', resetSettings);
  ipcMain.handle('bar:pick', pickTarget);
  ipcMain.handle('bar:audio', getAudio);
  ipcMain.handle('bar:volume', setVolume);
  ipcMain.handle('bar:mic', setMicMuted);
  ipcMain.handle('bar:media', getMedia);
  ipcMain.handle('bar:media-art', getMediaArt);
  ipcMain.handle('bar:media-control', mediaControl);
  ipcMain.handle('bar:shortcuts', describeShortcuts);
  ipcMain.handle('bar:launch', launchShortcut);
  ipcMain.on('bar:interactive', (_event, on) => {
    win?.setIgnoreMouseEvents(on !== true, { forward: true });
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    helper?.kill();
  });
}

// Une seule barre à la fois. Un nouveau lancement remplace l'ancienne : celle-ci se ferme
// (« second-instance »), la nouvelle attend qu'elle soit partie puis démarre avec le code à jour.
// (Avant, le nouveau lancement s'arrêtait et on testait l'ancienne version sans le savoir.)
const LOCK_RETRY = 200; // ms
const LOCK_TIMEOUT = 5000; // ms

if (app.requestSingleInstanceLock()) {
  start();
} else {
  const startedAt = Date.now();
  const retry = setInterval(() => {
    if (app.requestSingleInstanceLock()) {
      clearInterval(retry);
      start();
    } else if (Date.now() - startedAt > LOCK_TIMEOUT) {
      clearInterval(retry);
      console.error('Une autre barre est déjà ouverte et ne se ferme pas.');
      app.quit();
    }
  }, LOCK_RETRY);
}
