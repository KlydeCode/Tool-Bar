// Recherche dans les applis du PC (liste du menu Démarrer, donnée par Rust).

export interface StartApp {
  name: string;
  id: string;
}

const MAX_RESULTS = 12;

// « Paramètres » et « parametres » doivent se trouver pareil.
function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

// Les meilleurs d'abord : nom qui commence par la recherche, puis un mot qui commence par elle, puis le reste.
export function searchApps(apps: StartApp[], query: string, limit = MAX_RESULTS): StartApp[] {
  const q = normalize(query);
  if (!q) return [];
  return apps
    .map((app, index) => {
      const name = normalize(app.name);
      const at = name.indexOf(q);
      if (at === -1) return null;
      const rank = at === 0 ? 0 : /[\s'’\-.(]/.test(name[at - 1]) ? 1 : 2;
      return { app, index, rank, length: name.length };
    })
    .filter((r) => r !== null)
    .sort((a, b) => a.rank - b.rank || a.length - b.length || a.index - b.index)
    .slice(0, limit)
    .map((r) => r.app);
}
