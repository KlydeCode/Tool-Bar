const { isPackageName } = require('./launch');

// Réglages venant de l'interface ou du fichier : chaque champ invalide reprend sa valeur par défaut.
// C'est la seule porte d'entrée vers la config enregistrée.

const MAX_TILES = 5; // + la tuile Réglages, toujours en dernier
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

function isHttpsUrl(value) {
  if (typeof value !== 'string' || value.length > 500) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function isPath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 300 && !CONTROL_CHARS.test(value);
}

function cleanTile(tile) {
  if (!tile || typeof tile !== 'object') return null;
  const name = (typeof tile.name === 'string' ? tile.name.trim().slice(0, 40) : '') || 'Raccourci';
  if (tile.type === 'url') return isHttpsUrl(tile.url) ? { name, type: 'url', url: tile.url } : null;
  if (tile.type !== 'app' && tile.type !== 'folder') return null;
  if (!Array.isArray(tile.paths) || tile.paths.length < 1 || tile.paths.length > 5 || !tile.paths.every(isPath)) return null;
  const clean = { name, type: tile.type, paths: [...tile.paths] };
  if (isHttpsUrl(tile.fallbackUrl)) clean.fallbackUrl = tile.fallbackUrl;
  if (isPackageName(tile.icon?.package) && isPath(tile.icon?.file)) clean.icon = { package: tile.icon.package, file: tile.icon.file };
  return clean;
}

function cleanSettings(input, defaults) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const pick = (key, ok) => (ok(raw[key]) ? raw[key] : defaults[key]);
  const tiles = Array.isArray(raw.shortcuts)
    ? raw.shortcuts.filter((t) => t?.type !== 'settings').map(cleanTile).filter(Boolean).slice(0, MAX_TILES).concat(SETTINGS_TILE)
    : defaults.shortcuts;
  return {
    c1: pick('c1', isColor).toLowerCase(),
    c2: pick('c2', isColor).toLowerCase(),
    transparency: pick('transparency', (v) => Number.isInteger(v) && v >= 0 && v <= 70),
    autoHide: pick('autoHide', (v) => typeof v === 'boolean'),
    toggleShortcut: pick('toggleShortcut', isAccelerator),
    shortcuts: tiles,
  };
}

module.exports = { cleanSettings, isAccelerator };
