const path = require('node:path');

// Remplace %VARIABLE% par sa valeur (sans tenir compte de la casse, comme Windows).
function expandEnv(text, env) {
  return text.replace(/%([^%]+)%/g, (match, name) => {
    const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
    return key === undefined ? match : env[key];
  });
}

function isWebUrl(url, protocols = ['https:', 'http:']) {
  try {
    return protocols.includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

// Extensions acceptées pour une tuile « Appli » (programme ou raccourci Windows).
const APP_EXTENSIONS = ['.exe', '.lnk', '.appref-ms'];

// Transforme un raccourci de la config en cible sûre à ouvrir : { path } ou { url }, sinon null.
// Rien n'est exécuté ici : main.js ouvre la cible avec shell.openPath / shell.openExternal.
// (Les applis du menu Démarrer, type « startapp », sont lancées à part par main.js.)
function resolveShortcut(shortcut, { env, exists }) {
  if (!shortcut || typeof shortcut !== 'object') return null;
  if (shortcut.type === 'url') return isWebUrl(shortcut.url) ? { url: shortcut.url } : null;
  if (!['app', 'file', 'folder'].includes(shortcut.type)) return null;

  for (const raw of Array.isArray(shortcut.paths) ? shortcut.paths : []) {
    if (typeof raw !== 'string') continue;
    const candidate = expandEnv(raw, env);
    if (candidate.includes('%') || !path.win32.isAbsolute(candidate)) continue;
    if (shortcut.type === 'app' && !APP_EXTENSIONS.includes(path.win32.extname(candidate).toLowerCase())) continue;
    if (exists(candidate)) return { path: path.win32.normalize(candidate) };
  }
  return isWebUrl(shortcut.fallbackUrl, ['https:']) ? { url: shortcut.fallbackUrl } : null;
}

// Applis du Microsoft Store (Claude, Terminal) : l'alias lancé n'a qu'une icône générique,
// la vraie est dans le dossier d'installation du paquet.
function isPackageName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9.]+$/.test(name);
}

function packageIconFile(installDir, file) {
  if (!installDir || typeof file !== 'string' || path.win32.isAbsolute(file)) return null;
  const full = path.win32.join(installDir, file);
  return full.startsWith(path.win32.join(installDir, path.win32.sep)) ? full : null;
}

module.exports = { isPackageName, packageIconFile, resolveShortcut };
