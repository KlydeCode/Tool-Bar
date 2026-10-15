const fs = require('node:fs');
const path = require('node:path');

// Config = valeurs par défaut + ce que contient le fichier de l'utilisateur.
// Un fichier absent ou abîmé ne doit jamais empêcher la barre de démarrer.
function loadConfig(file, defaults) {
  let user = {};
  try {
    user = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Config illisible, valeurs par défaut utilisées :', error.message);
  }
  if (!user || typeof user !== 'object' || Array.isArray(user)) user = {};
  return {
    ...defaults,
    ...user,
    shortcuts: Array.isArray(user.shortcuts) ? user.shortcuts : defaults.shortcuts,
  };
}

// Écrit dans un fichier temporaire puis le renomme : une coupure en plein enregistrement
// ne peut pas laisser un fichier à moitié écrit (et donc tous les réglages perdus).
function saveConfig(file, config) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
  fs.renameSync(tmp, file);
}

module.exports = { loadConfig, saveConfig };
