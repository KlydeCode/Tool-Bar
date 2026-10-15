# Spec : Ma Barre

> Source : `CLAUDE.md` (décisions validées) et `maquette.png` (design « 1 · Minimal », référence visuelle).

## Objectif

Une barre façon « Dynamic Island » pour Windows 11, en haut au centre de l'écran principal.
Repliée : une pilule (musique en cours + heure). Au survol, au clic ou avec Alt+Maj+Espace, elle se déplie
en un panneau : musique, heure et date, six raccourcis, volume et micro. Couleurs, transparence et raccourcis sont personnalisables.

**Utilisateur** : une seule personne, qui ne code pas. Elle lance l'appli (`npm start`), teste sur son PC et dit ce qui va ou pas.

**Succès** : l'appli se lance sans erreur, ressemble à la maquette, et chaque phase ci-dessous est validée à l'écran par l'utilisateur.

## Hypothèses

1. Windows 11, un seul écran « principal » pris en compte (les autres écrans sont ignorés).
2. Node.js LTS déjà installé (v24 constaté). Electron est la seule dépendance d'exécution.
3. Tests avec `node:test` (intégré à Node) : aucune dépendance de test.
4. Polices téléchargées depuis leurs dépôts officiels (licence OFL) et versionnées dans `assets/fonts/`.
5. La musique (phase 8) sera choisie après recherche dans la doc ; la solution sera expliquée avant d'être codée.

## Stack technique

- Electron (dernière version stable) + HTML / CSS / JavaScript simples.
- Pas de framework, pas de TypeScript, pas de bundler.
- Ajouter toute autre dépendance seulement après accord de l'utilisateur.

## Commandes

```
Installer : npm install
Lancer    : npm start
Tester    : npm test          (node --test)
```

Phase 10 : `npm run dist` pour créer l'installateur `.exe` (outil choisi à ce moment-là, avec l'accord de l'utilisateur).

## Structure du projet

```
main.js            processus principal : fenêtre, raccourci global, actions Windows
preload.js         pont sécurisé (contextBridge) : quelques fonctions précises seulement
src/index.html     structure de la barre
src/styles.css     tout le style (couleurs en variables CSS)
src/app.js         comportement de l'interface
lib/               logique testable sans Electron (config, validation des chemins, couleurs)
test/              tests node:test (*.test.js)
assets/fonts/      polices locales (OFL)
config.default.json  config par défaut ; la config utilisateur va dans app.getPath('userData')
```

## Style de code

- JavaScript moderne (CommonJS côté `main`, script classique côté `src`), 2 espaces, point-virgule.
- Noms en anglais pour le code, **commentaires en français**, seulement pour expliquer le « pourquoi ».
- Fonctions courtes, pas d'abstraction « pour plus tard ».

```js
// Centre la barre en haut de l'écran principal (zone de travail, hors barre des tâches Windows).
function topCenter(workArea, width) {
  return { x: Math.round(workArea.x + (workArea.width - width) / 2), y: workArea.y };
}
```

## Design (rappel de la maquette)

- Couleurs : `--c1 #8AB4FF`, `--c2 #FFB86B`, fond `rgba(10,10,11, 1 - transparence)` (12 % par défaut, de 0 à 70 %), avec du flou.
  Cartes : `rgba(255,255,255,.06)`, bordure : `rgba(255,255,255,.1)`, texte : `#F4F4F5` / `#B4B4BC`, texte sur couleur : `#0A0A0B`.
- Polices : Bricolage Grotesque (horloge 60 px/800, titre 19 px/700), Uncut Sans (texte), JetBrains Mono (étiquettes 10,5 px, majuscules, +0,14em).
- Panneau de 680 px, padding 18, coins de 32. Pilule de 40 px de haut. Carte horloge de 190 px. Tuiles de 88 px (coins 20) numérotées 01 à 06. Boutons d'au moins 44 px. Icônes style Lucide.
- Animations : dépliage scale(0.35, 0.15) → 1 en ~0,55 s avec rebond ; effets de survol et de clic des tuiles, boutons précédent/suivant, onde du bouton lecture, égaliseur ;
  tout est coupé si `prefers-reduced-motion`.

## Fonctionnalités et critères de réussite (par phase)

| # | Phase | Critère de réussite (vérifié par l'utilisateur sauf mention) |
|---|-------|-------------------------------------------------------------|
| 1 | Fenêtre | Fenêtre sans cadre, fond transparent, toujours au-dessus, absente de la barre des tâches, centrée en haut de l'écran principal. Se lance sans erreur. |
| 2 | Interface statique | Rendu fidèle à la maquette (polices, couleurs, tailles), effets de survol des tuiles et boutons. |
| 3 | Pilule ↔ panneau | Se déplie au survol ou au clic et se replie quand la souris part. Repliée, les clics à côté de la pilule traversent la fenêtre. |
| 4 | Raccourci global | Alt+Maj+Espace ouvre et ferme la barre. |
| 5 | Raccourcis d'applis | Les tuiles lancent VS Code, Téléchargements, le navigateur, Claude (appli, sinon claude.ai), Windows Terminal, avec les vraies icônes. Chemins vérifiés (test). |
| 6 | Auto-masquage | Option : la barre glisse hors de l'écran et revient quand la souris touche le haut. |
| 7 | Volume et micro | Le curseur lit et règle le volume système ; le bouton micro coupe le micro (couleur 2 quand il est coupé). |
| 8 | Musique | Titre et artiste affichés ; lecture/pause, précédent et suivant fonctionnent (Spotify, navigateur). |
| 9 | Réglages | Couleurs, transparence, raccourcis et auto-masquage modifiables, enregistrés et rechargés au redémarrage (config testée). |
| 10 | Finitions | Option de lancement au démarrage de Windows ; installateur `.exe` qui s'installe et se lance. |

Hors périmètre : API Claude, Mac et Linux.

## Stratégie de test

- `node:test`, fichiers `test/*.test.js`, lancés par `npm test`.
- Tests unitaires pour la logique de `lib/` : lecture, écriture et fusion de la config, validation des chemins, calculs de couleur et de transparence, position de la fenêtre.
- Pas de test automatique pour le pur style ni pour le rendu Windows : l'utilisateur les vérifie en fin de phase.
- Avant chaque commit : `npm test` passe et `npm start` se lance sans erreur dans la console.

## Limites

- **Toujours** : `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` ; un commit clair en français par tâche ;
  écrire 100 % du code soi-même ; vérifier les API Electron et Windows dans la doc officielle.
- **Demander d'abord** : toute nouvelle dépendance ; tout changement de décision de `CLAUDE.md`.
- **Jamais** : construire une commande shell à partir d'un texte de l'interface (utiliser `shell.openPath`, `shell.openExternal`, `spawn` avec des arguments fixes) ;
  lancer un chemin de la config sans l'avoir validé ; demander à l'utilisateur de modifier du code.

## Questions ouvertes

- Phase 8 : quelle méthode pour lire la musique en cours ? (recherche à faire, puis explication à l'utilisateur avant de coder)
- Phase 10 : quel outil pour l'installateur ? (une dépendance de développement à faire accepter à ce moment-là)
