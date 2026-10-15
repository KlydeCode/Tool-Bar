const { app, BrowserWindow, Menu, dialog, globalShortcut, ipcMain, net, screen, shell } = require('electron');
const crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { levelArg, micFromAnswer, percentFromLevel } = require('./lib/audio');
const { calendarUrl, eventsBetween, weekStart } = require('./lib/calendar');
const { loadConfig, saveConfig } = require('./lib/config');
const { parseMedia } = require('./lib/media');
const { isPackageName, packageIconFile, resolveShortcut, shortcutFileName } = require('./lib/launch');
const { topCenter } = require('./lib/position');
const { parseApps, searchApps } = require('./lib/search');
const { MAX_TILES, cleanSettings } = require('./lib/settings');

// Taille fixe, en grande partie transparente (les clics la traversent) ; pilule et panneaux sont dessinés dedans.
const WIDTH = 1400; // panneau (680 px) centré + panneau Agenda (340 px) à sa droite, de chaque côté
const HEIGHT = 700; // jusqu'à 3 rangées de tuiles + la recherche

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
  // Version installée : le script est sorti de l'archive app.asar (asarUnpack), que PowerShell ne sait pas lire.
  const script = path.join(__dirname, 'helpers', 'windows.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  helper = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', script,
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

// Choix d'une appli, d'un fichier ou d'un dossier pour une tuile, avec la fenêtre de Windows.
const PICKERS = {
  app: { title: 'Choisir une appli', properties: ['openFile'], filters: [{ name: 'Applis et raccourcis', extensions: ['exe', 'lnk', 'appref-ms'] }] },
  file: { title: 'Choisir un fichier', properties: ['openFile'] },
  folder: { title: 'Choisir un dossier', properties: ['openDirectory'] },
};
async function pickTarget(_event, kind) {
  if (!Object.hasOwn(PICKERS, kind)) return null;
  picking = true;
  try {
    const result = await dialog.showOpenDialog(win, PICKERS[kind]);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  } finally {
    picking = false;
  }
}

// ---------- Agenda ----------
// Agendas iCal : liens (Google, Outlook, iCloud…) relus toutes les 15 minutes, ou fichiers .ics importés.
// Une copie de chaque agenda est gardée dans userData/calendars/<id>.ics (marche aussi hors ligne).
const CALENDAR_REFRESH = 15 * 60 * 1000;
const CALENDAR_MAX_SIZE = 5 * 1024 * 1024; // un agenda plus gros est refusé
const calendarErrors = new Map(); // identifiant → message de la dernière mise à jour ratée

function calendarFile(id) {
  return path.join(app.getPath('userData'), 'calendars', `${id}.ics`);
}

function readCalendar(id) {
  try {
    return fs.readFileSync(calendarFile(id), 'utf8');
  } catch {
    return '';
  }
}

function writeCalendar(id, text) {
  fs.mkdirSync(path.dirname(calendarFile(id)), { recursive: true });
  fs.writeFileSync(calendarFile(id), text);
}

// Nom donné par l'agenda lui-même (Google, Outlook, iCloud le fournissent), sinon ''.
function calendarName(text) {
  return /^X-WR-CALNAME:(.+)$/m.exec(text)?.[1].trim().slice(0, 40) ?? '';
}

function checkCalendarText(text) {
  if (text.length > CALENDAR_MAX_SIZE) throw new Error('Agenda trop gros (plus de 5 Mo).');
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("Ce n'est pas un agenda iCal.");
  return text;
}

async function downloadCalendar(url) {
  const response = await net.fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Le lien répond « ${response.status} ».`);
  return checkCalendarText(await response.text());
}

async function refreshCalendar(calendar) {
  if (!calendar.url) return;
  try {
    writeCalendar(calendar.id, await downloadCalendar(calendar.url));
    calendarErrors.delete(calendar.id);
  } catch (error) {
    calendarErrors.set(calendar.id, error.message);
  }
}

function refreshCalendars() {
  return Promise.all(config.calendars.map(refreshCalendar));
}

// Événements de la semaine qui contient « startMs », tous agendas confondus.
function getWeek(_event, startMs) {
  if (!Number.isFinite(startMs)) return null;
  const from = weekStart(new Date(startMs));
  const to = new Date(from);
  to.setDate(to.getDate() + 7);
  const events = config.calendars
    .flatMap((calendar, index) => eventsBetween(readCalendar(calendar.id), from, to).map((e) => ({ ...e, calendar: index })))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  return { start: from.getTime(), events };
}

function getCalendars() {
  return config.calendars.map((c) => ({ id: c.id, name: c.name, type: c.url ? 'url' : 'file', error: calendarErrors.get(c.id) ?? '' }));
}

function saveCalendars(event, calendars) {
  return saveSettings(event, { ...config, calendars });
}

async function addCalendarUrl(event, input) {
  const url = calendarUrl(input);
  if (!url) return { ok: false, error: 'Lien refusé : il doit commencer par https:// ou webcal://', settings: config };
  if (config.calendars.length >= 10) return { ok: false, error: '10 agendas au maximum.', settings: config };
  const id = crypto.randomBytes(8).toString('hex');
  try {
    writeCalendar(id, await downloadCalendar(url));
  } catch (error) {
    return { ok: false, error: error.message || 'Lien impossible à charger.', settings: config };
  }
  return saveCalendars(event, [...config.calendars, { id, name: calendarName(readCalendar(id)) || new URL(url).hostname.replace(/^www\./, ''), url }]);
}

async function importCalendar(event) {
  if (config.calendars.length >= 10) return { ok: false, error: '10 agendas au maximum.', settings: config };
  picking = true;
  let result;
  try {
    result = await dialog.showOpenDialog(win, { title: 'Importer un agenda', properties: ['openFile'], filters: [{ name: 'Agenda iCal', extensions: ['ics'] }] });
  } finally {
    picking = false;
  }
  if (result.canceled || !result.filePaths[0]) return { ok: true, settings: config };
  const file = result.filePaths[0];
  const id = crypto.randomBytes(8).toString('hex');
  try {
    if (fs.statSync(file).size > CALENDAR_MAX_SIZE) throw new Error('Agenda trop gros (plus de 5 Mo).');
    writeCalendar(id, checkCalendarText(fs.readFileSync(file, 'utf8')));
  } catch (error) {
    return { ok: false, error: error.message || 'Fichier illisible.', settings: config };
  }
  return saveCalendars(event, [...config.calendars, { id, name: calendarName(readCalendar(id)) || path.basename(file, path.extname(file)), file: true }]);
}

function removeCalendar(event, id) {
  const calendar = config.calendars.find((c) => c.id === id);
  if (!calendar) return { ok: false, error: 'Agenda introuvable.', settings: config };
  fs.rmSync(calendarFile(calendar.id), { force: true }); // notre copie seulement, jamais le fichier d'origine
  calendarErrors.delete(calendar.id);
  return saveCalendars(event, config.calendars.filter((c) => c !== calendar));
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
    const type = shortcut.type; // déjà vérifié par cleanSettings
    if (type === 'startapp') return { name, type, icon: await appIcon(await startAppIndex(shortcut.appId)) };
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

// ---------- Applis du PC (recherche) ----------
// Liste du menu Démarrer, gardée ici et dans le script (mêmes numéros), relue toutes les 5 minutes au plus.
const APPS_MAX_AGE = 5 * 60 * 1000;
let apps = [];
let appsAt = 0;
let appsLoading = null;
const appIcons = new Map(); // identifiant de l'appli → icône

function loadApps(force = false) {
  if (!force && apps.length && Date.now() - appsAt < APPS_MAX_AGE) return Promise.resolve(apps);
  appsLoading ??= ask('apps').then((line) => {
    const list = parseApps(line);
    if (list.length) {
      apps = list;
      appsAt = Date.now();
    }
    return apps;
  }).finally(() => {
    appsLoading = null;
  });
  return appsLoading;
}

function isAppIndex(index) {
  return Number.isInteger(index) && index >= 0 && index < apps.length;
}

async function appIcon(index) {
  if (!isAppIndex(index)) return null;
  const { id } = apps[index];
  if (!appIcons.has(id)) {
    const base64 = await ask(`app-icon ${index}`);
    if (!base64) return null;
    appIcons.set(id, `data:image/png;base64,${base64}`);
  }
  return appIcons.get(id);
}

// Lance une appli du menu Démarrer par son identifiant Windows (argument unique, pas de commande).
function openStartApp(id) {
  spawn('explorer.exe', [`shell:AppsFolder\\${id}`], { detached: true, stdio: 'ignore' }).unref();
}

async function searchPcApps(_event, query) {
  if (typeof query !== 'string' || query.length > 100) return [];
  await loadApps();
  return searchApps(apps, query).map(({ index }) => ({ id: apps[index].id, name: apps[index].name }));
}

// L'interface désigne une appli par son identifiant Windows : sa position dans la liste peut changer
// quand la liste est relue (appli installée ou désinstallée entre-temps).
async function findApp(id) {
  return typeof id === 'string' ? startAppIndex(id) : -1;
}

async function launchApp(_event, id) {
  const index = await findApp(id);
  if (index === -1) return false;
  openStartApp(apps[index].id);
  return true;
}

// Ajoute l'appli trouvée en tuile (juste avant la tuile Réglages si elle est en dernier).
async function pinApp(event, id) {
  const index = await findApp(id);
  if (index === -1) return { ok: false, error: 'Appli introuvable.', settings: config };
  if (config.shortcuts.length >= MAX_TILES) return { ok: false, error: `${MAX_TILES} tuiles au maximum.`, settings: config };
  const tile = { name: apps[index].name.slice(0, 40), type: 'startapp', appId: apps[index].id };
  const shortcuts = [...config.shortcuts];
  const last = shortcuts.length - 1;
  shortcuts.splice(shortcuts[last]?.type === 'settings' ? last : shortcuts.length, 0, tile);
  return saveSettings(event, { ...config, shortcuts });
}

// Fichier de l'appli : son .exe (applis classiques) ou son dossier (Microsoft Store), sinon ''.
async function appPath(index) {
  const found = await ask(`app-path ${index}`);
  return found && path.win32.isAbsolute(found) && fs.existsSync(found) ? found : '';
}

// Raccourci .lnk sur le Bureau ; « Spotify (2).lnk » si « Spotify.lnk » existe déjà.
function createDesktopShortcut(name, { exe, appId }) {
  const desktop = app.getPath('desktop');
  const base = shortcutFileName(name);
  let file = path.join(desktop, `${base}.lnk`);
  for (let n = 2; fs.existsSync(file); n++) file = path.join(desktop, `${base} (${n}).lnk`);
  const options = exe
    ? { target: exe, icon: exe, iconIndex: 0 }
    // Appli du Microsoft Store : lancée comme depuis le menu Démarrer.
    : { target: path.join(process.env.SystemRoot ?? 'C:\\Windows', 'explorer.exe'), args: `shell:AppsFolder\\${appId}` };
  return shell.writeShortcutLink(file, 'create', options);
}

// Clic droit sur un résultat de recherche : menu Windows. Se résout quand le menu se ferme.
async function appMenu(event, appId) {
  const index = await findApp(appId);
  if (index === -1) return null;
  const { id, name } = apps[index];
  const file = await appPath(index);
  // Un .exe classique se lance directement ; ceux du Microsoft Store (WindowsApps) passent par leur identifiant.
  const exe = /\.exe$/i.test(file) && !/\\WindowsApps\\/i.test(file) ? file : '';
  let result = null;
  const menu = Menu.buildFromTemplate([
    {
      label: 'Ouvrir',
      click: () => {
        openStartApp(id);
        result = { ok: true, opened: true, settings: config };
      },
    },
    { type: 'separator' },
    // Promesse gardée telle quelle : la réponse du menu attend la fin de l'ajout.
    { label: 'Créer un raccourci dans la barre', click: () => { result = pinApp(event, id); } },
    {
      label: 'Créer un raccourci sur le Bureau',
      click: () => {
        const ok = createDesktopShortcut(name, { exe, appId: id });
        result = { ok, error: ok ? '' : 'Raccourci impossible à créer.', settings: config, desktop: ok };
      },
    },
    { type: 'separator' },
    {
      label: "Ouvrir l'emplacement du fichier",
      enabled: Boolean(file) && !/\\WindowsApps\\/i.test(file),
      click: () => shell.showItemInFolder(file),
    },
  ]);
  picking = true; // le menu ouvert ne doit pas refermer la barre
  return new Promise((resolve) => menu.popup({
    window: win,
    callback: () => setTimeout(() => {
      picking = false;
      resolve(result);
    }, 0),
  }));
}

// Tuile « startapp » : l'identifiant doit toujours exister dans la liste de Windows.
async function startAppIndex(appId) {
  let index = (await loadApps()).findIndex((a) => a.id === appId);
  if (index === -1) index = (await loadApps(true)).findIndex((a) => a.id === appId);
  return index;
}

async function launchShortcut(_event, index) {
  if (!Number.isInteger(index) || index < 0 || index >= config.shortcuts.length) return false;
  const shortcut = config.shortcuts[index];
  if (shortcut.type === 'startapp') {
    const found = await startAppIndex(shortcut.appId);
    if (found === -1) return false;
    openStartApp(apps[found].id);
    return true;
  }
  const target = resolveTarget(shortcut);
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
// L'appli s'appelait « Ma Barre » : ses réglages et ses agendas sont repris une fois par Island.
function migrateOldSettings() {
  const old = path.join(app.getPath('appData'), 'ma-barre');
  const now = app.getPath('userData');
  if (fs.existsSync(path.join(now, 'config.json')) || !fs.existsSync(path.join(old, 'config.json'))) return;
  try {
    fs.mkdirSync(now, { recursive: true });
    fs.copyFileSync(path.join(old, 'config.json'), path.join(now, 'config.json'));
    if (fs.existsSync(path.join(old, 'calendars'))) fs.cpSync(path.join(old, 'calendars'), path.join(now, 'calendars'), { recursive: true });
  } catch (error) {
    console.error('Anciens réglages non repris :', error);
  }
}

// Lancement au démarrage de Windows : seulement pour la version installée
// (avec « npm start », Windows lancerait Electron seul, sans la barre).
function getStartup() {
  return { available: app.isPackaged, enabled: app.isPackaged && app.getLoginItemSettings().openAtLogin };
}

function setStartup(_event, on) {
  if (app.isPackaged && typeof on === 'boolean') app.setLoginItemSettings({ openAtLogin: on });
  return getStartup();
}

function start() {
  app.on('second-instance', () => app.quit());
  app.whenReady().then(() => {
    migrateOldSettings();
    loadSettings();
    createWindow();
    startHelper(); // prêt avant le premier survol
    loadApps(); // liste des applis prête pour la première recherche
    refreshCalendars();
    setInterval(refreshCalendars, CALENDAR_REFRESH);
    registerShortcut(config.toggleShortcut);

    for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) {
      screen.on(event, placeWindow);
    }
  });

  ipcMain.on('bar:quit', () => app.quit());
  ipcMain.handle('bar:backdrop', captureBackdrop);
  ipcMain.handle('bar:settings', uiSettings);
  ipcMain.handle('bar:startup', getStartup);
  ipcMain.handle('bar:set-startup', setStartup);
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
  ipcMain.handle('bar:search-apps', searchPcApps);
  ipcMain.handle('bar:app-icon', async (_event, id) => appIcon(await findApp(id)));
  ipcMain.handle('bar:launch-app', launchApp);
  ipcMain.handle('bar:pin-app', pinApp);
  ipcMain.handle('bar:app-menu', appMenu);
  ipcMain.handle('bar:week', getWeek);
  ipcMain.handle('bar:calendars', getCalendars);
  ipcMain.handle('bar:add-calendar', addCalendarUrl);
  ipcMain.handle('bar:import-calendar', importCalendar);
  ipcMain.handle('bar:remove-calendar', removeCalendar);
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
