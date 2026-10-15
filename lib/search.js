// Recherche dans les applis du PC (liste du menu Démarrer, voir helpers/windows.ps1).

const MAX_RESULTS = 12;

// « Paramètres » et « parametres » doivent se trouver pareil.
function normalize(text) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

// Réponse JSON du script → [{ name, id }] ; tout ce qui n'a pas la bonne forme est ignoré.
function parseApps(line) {
  let raw;
  try {
    raw = JSON.parse(line);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a) => typeof a?.name === 'string' && a.name && typeof a.id === 'string' && a.id)
    .map((a) => ({ name: a.name.slice(0, 100), id: a.id.slice(0, 300) }));
}

// Renvoie [{ index }] dans la liste d'origine, les meilleurs d'abord :
// nom qui commence par la recherche, puis un mot qui commence par elle, puis le reste.
function searchApps(apps, query, limit = MAX_RESULTS) {
  const q = normalize(query);
  if (!q) return [];
  return apps
    .map((app, index) => {
      const name = normalize(app.name);
      const at = name.indexOf(q);
      if (at === -1) return null;
      const rank = at === 0 ? 0 : /[\s'’\-.(]/.test(name[at - 1]) ? 1 : 2;
      return { index, rank, length: name.length };
    })
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank || a.length - b.length || a.index - b.index)
    .slice(0, limit)
    .map(({ index }) => ({ index }));
}

module.exports = { searchApps, parseApps };
