const fs = require('node:fs');

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

module.exports = { loadConfig };
