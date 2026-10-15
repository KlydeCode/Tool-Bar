const { isPackageName } = require('./launch');
const { FONTS } = require('./themes');
const { calendarUrl } = require('./calendar');

// Réglages venant de l'interface ou du fichier : chaque champ invalide reprend sa valeur par défaut.
// C'est la seule porte d'entrée vers la config enregistrée.

const MAX_TILES = 18; // Réglages compris (3 rangées de 6)
const SETTINGS_TILE = { name: 'Réglages', type: 'settings' };
const MODIFIERS = ['Control', 'Alt', 'Shift', 'Super'];
const CONTROL_CHARS = /[\u0000-\u001f]/;

function isColor(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

// Raccourci clavier global : 1 à 3 touches de modification (dont Ctrl, Alt ou Win) + une touche simple.
function isAccelerator(value) {
  if (typeof value !== 'string') return false;
  const parts = value.split('+');
  const key = parts.pop();
  const mods = new Set(parts);
  return /^(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|Space)$/.test(key)
    && parts.length >= 1 && parts.length <= 3 && mods.size === parts.length
    && parts.every((m) => MODIFIERS.includes(m))
    && (mods.has('Control') || mods.has('Alt') || mods.has('Super'));
}

function isUrl(value, protocols) {
  if (typeof value !== 'string' || value.length > 500) return false;
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function isText(value, max) {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !CONTROL_CHARS.test(value);
}

function cleanTile(tile) {
  if (!tile || typeof tile !== 'object') return null;
  if (tile.type === 'settings') return SETTINGS_TILE;
  const name = (typeof tile.name === 'string' ? tile.name.trim().slice(0, 40) : '') || 'Raccourci';
  if (tile.type === 'url') return isUrl(tile.url, ['https:', 'http:']) ? { name, type: 'url', url: tile.url } : null;
  // Appli du menu Démarrer (trouvée par la recherche) : lancée par son identifiant Windows.
  if (tile.type === 'startapp') return isText(tile.appId, 300) ? { name, type: 'startapp', appId: tile.appId } : null;
  if (!['app', 'file', 'folder'].includes(tile.type)) return null;
  if (!Array.isArray(tile.paths) || tile.paths.length < 1 || tile.paths.length > 5 || !tile.paths.every((p) => isText(p, 300))) return null;
  const clean = { name, type: tile.type, paths: [...tile.paths] };
  if (isUrl(tile.fallbackUrl, ['https:'])) clean.fallbackUrl = tile.fallbackUrl;
  if (isPackageName(tile.icon?.package) && isText(tile.icon?.file, 300)) clean.icon = { package: tile.icon.package, file: tile.icon.file };
  return clean;
}

// Tuiles dans l'ordre choisi ; la tuile Réglages existe toujours, une seule fois.
function cleanTiles(tiles) {
  let list = tiles.map(cleanTile).filter(Boolean);
  const first = list.findIndex((t) => t.type === 'settings');
  list = list.filter((t, i) => t.type !== 'settings' || i === first);
  if (first === -1) list.push(SETTINGS_TILE);
  // Trop de tuiles : on retire les dernières, jamais la tuile Réglages.
  while (list.length > MAX_TILES) {
    const last = list.findLastIndex((t) => t.type !== 'settings');
    list.splice(last, 1);
  }
  return list;
}

// Agenda : un lien (https) relu régulièrement, ou un fichier .ics importé (copié dans userData/calendars/<id>.ics).
// L'identifiant sert de nom de fichier : lettres minuscules et chiffres seulement.
const MAX_CALENDARS = 10;

function cleanCalendar(calendar) {
  if (!calendar || typeof calendar !== 'object' || !/^[a-z0-9]{8,32}$/.test(calendar.id ?? '')) return null;
  const name = (typeof calendar.name === 'string' ? calendar.name.trim().slice(0, 40) : '') || 'Agenda';
  if (calendar.file === true) return { id: calendar.id, name, file: true };
  const url = calendarUrl(calendar.url);
  return url ? { id: calendar.id, name, url } : null;
}

function cleanSettings(input, defaults) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const pick = (key, ok) => (ok(raw[key]) ? raw[key] : defaults[key]);
  return {
    bg: pick('bg', isColor).toLowerCase(),
    surface: pick('surface', isColor).toLowerCase(),
    c1: pick('c1', isColor).toLowerCase(),
    c2: pick('c2', isColor).toLowerCase(),
    transparency: pick('transparency', (v) => Number.isInteger(v) && v >= 0 && v <= 70),
    font: pick('font', (v) => FONTS.some((f) => f.id === v)),
    autoHide: pick('autoHide', (v) => typeof v === 'boolean'),
    toggleShortcut: pick('toggleShortcut', isAccelerator),
    shortcuts: Array.isArray(raw.shortcuts) ? cleanTiles(raw.shortcuts) : defaults.shortcuts,
    calendars: Array.isArray(raw.calendars) ? raw.calendars.map(cleanCalendar).filter(Boolean).slice(0, MAX_CALENDARS) : defaults.calendars,
  };
}

module.exports = { cleanSettings, isAccelerator, MAX_TILES };
