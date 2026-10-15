# Plan d'implémentation : Ma Barre

> Référence : `SPEC.md`. Ce fichier contient le plan **et** la liste des tâches. Il remplace `tasks/plan.md` et `tasks/todo.md`.
> On coche chaque tâche quand elle est finie. Chaque phase se termine par un point de contrôle validé par l'utilisateur.

## Vue d'ensemble

Une appli Electron. `main.js` gère la fenêtre et les actions Windows, `preload.js` expose quelques fonctions, et `src/` contient l'interface.
La logique pure (config, chemins, couleurs, position) vit dans `lib/` et est testée avec `node:test`.

## Décisions d'architecture

- **Une seule fenêtre** à la taille du panneau déplié (680 px + marge pour l'ombre). La pilule est dessinée dedans. Quand elle est repliée, `setIgnoreMouseEvents(true, { forward: true })`
  laisse passer les clics tout en recevant le survol. On évite ainsi de redimensionner la fenêtre, ce qui provoque des saccades sous Windows.
- **Transparence** : `transparent: true` + `backgroundColor: '#00000000'`, et le flou est fait en CSS (`backdrop-filter`). `backgroundMaterial: 'acrylic'` sera essayé en phase 2 :
  il floute tout le rectangle de la fenêtre, pas seulement le panneau arrondi, donc il ne sera gardé que si le rendu est propre.
- **Position** : `screen.getPrimaryDisplay().workArea`, centrée en x, et recalculée quand la configuration des écrans change.
- **Config** : `config.default.json` est fusionné avec `userData/config.json` dans `lib/config.js`. Fonctions pures, testées.
- **Pont preload** : uniquement des fonctions nommées (`bar.launch(id)`, `bar.setVolume(n)`…), jamais d'`ipcRenderer` brut.
- **Tests** : `node --test`, sans dépendance.

## Liste des tâches

### Phase 1 : Fenêtre

- [x] **Tâche 1.1 : Squelette npm + Electron**
  - Acceptation : `package.json` (nom, `main`, scripts `start` et `test`), Electron installé en devDependency, `.gitignore` à jour (`node_modules/`, `out/`, `dist/`).
  - Vérif. : `npm install` sans erreur ; `npx electron --version` affiche une version.
  - Fichiers : `package.json`, `.gitignore`. Taille : XS.

- [x] **Tâche 1.2 : Calcul de la position (testé)**
  - Acceptation : `lib/position.js` exporte `topCenter(workArea, width)`, qui renvoie `{ x, y }` entiers et centrés en haut de la zone de travail, y compris sur un écran décalé (x négatif).
  - Vérif. : `npm test` passe (au moins 3 cas).
  - Fichiers : `lib/position.js`, `test/position.test.js`. Taille : S.

- [x] **Tâche 1.3 : Fenêtre de la barre**
  - Acceptation : `main.js` crée une `BrowserWindow` sans cadre, transparente, non redimensionnable, `alwaysOnTop` (niveau `screen-saver`), `skipTaskbar`, sans ombre native,
    avec `contextIsolation`, `sandbox`, sans `nodeIntegration`. Elle est placée par `topCenter` et replacée quand l'affichage change. Une seule instance (`requestSingleInstanceLock`).
    `preload.js` est vide pour l'instant mais branché. `src/index.html` affiche une pilule provisoire (fond sombre, coins ronds) pour voir la fenêtre.
    CSP stricte dans `index.html`.
  - Vérif. : `npm start` sans erreur dans la console ; la pilule apparaît en haut au centre, au-dessus des autres fenêtres, sans bouton dans la barre des tâches. (Validé par l'utilisateur.)
  - Fichiers : `main.js`, `preload.js`, `src/index.html`, `src/styles.css`. Taille : M.

- [x] **Tâche 1.4 : Quitter proprement**
  - Acceptation : clic droit sur la pilule (provisoire, jusqu'aux réglages) ou Ctrl+C dans le terminal pour quitter l'appli. Sans icône dans la barre des tâches, il faut un moyen de la fermer.
  - Vérif. : un clic droit ferme l'appli et le processus se termine.
  - Fichiers : `main.js`, `preload.js`, `src/app.js`, `src/index.html`. Taille : S.

**Point de contrôle 1** : `npm test` passe, `npm start` sans erreur, l'utilisateur valide la fenêtre (position, au-dessus, transparente, absente de la barre des tâches).

### Phase 2 : Interface statique

- [x] 2.1 Polices locales (Bricolage Grotesque, Uncut Sans, JetBrains Mono, OFL) dans `assets/fonts/` + `@font-face`. Vérif. : les polices s'affichent (DevTools > Computed).
- [x] 2.2 Variables CSS (couleurs, rayons, transparence). Le fond est calculé en CSS (`calc(1 - var(--transparency))`) ; la validation des valeurs (testée) passe en phase 9, avec les réglages.
- [x] 2.3 Carte musique + carte horloge (heure et date réelles, mises à jour chaque minute). Vérif. : comparaison avec la maquette.
- [x] 2.4 Six tuiles de raccourcis (icônes Lucide en SVG inline) + animations de survol et de clic. Vérif. : visuelle.
- [x] 2.5 Ligne volume + micro (statique), animations du bouton lecture et de l'égaliseur, `prefers-reduced-motion`. Vérif. : visuelle.
- [x] 2.6 Essai de `backgroundMaterial: 'acrylic'` : rejeté (floute tout le rectangle de la fenêtre, même avec `setShape`). Remplacé en phase 3 par une capture de l'écran floutée dans un canvas.

**Point de contrôle 2** : l'utilisateur compare avec `maquette.png`.

### Phase 3 : Pilule ↔ panneau

Retours de la phase 2 corrigés ici : transparence par défaut passée de 35 % à 12 % (trop transparent), égaliseur figé là où il s'arrête en pause.

Retours de la phase 3 : flou derrière le panneau ouvert (capture de l'écran à l'ouverture par `helpers/capture.ps1`, un script PowerShell lancé une fois — `desktopCapturer` saccadait — + `setContentProtection` le temps de la capture, floutée dans un canvas, panneau à 30 % de transparence par-dessus) ; pilule sans musique = heure seule ; animations plus douces et un peu plus lentes (ouverture 0,7 s, fermeture 0,5 s).


- [x] 3.1 Pilule repliée (musique + heure en couleur 2), dépliage animé (scale 0.35×0.15 → 1, 0,55 s, rebond).
- [x] 3.2 Ouverture au survol et au clic, fermeture quand la souris sort (petit délai), avec la flèche ˄ de la carte horloge ou avec Échap.
- [x] 3.3 Clics traversants quand la barre est repliée : `setIgnoreMouseEvents(true, {forward:true})`, basculé selon la zone survolée (pont preload `bar.setInteractive(bool)`).

**Point de contrôle 3** : survol, clic et clics traversants validés.

### Phase 4 : Raccourci global
- [x] 4.1 `globalShortcut` Alt+Maj+Espace (Ctrl+Alt+Espace déjà pris), qui ouvre ou ferme la barre (bascule envoyée à l'interface) ; message dans la console si le raccourci est déjà pris.

### Phase 5 : Raccourcis d'applis

Choix : « Navigateur » ouvre une adresse web (le navigateur par défaut est choisi par Windows ; le registre n'était pas fiable). Claude et Terminal sont lancés par leurs alias Windows (`claude-desktop.exe`, `wt.exe`) ; leur vraie icône est lue dans le dossier du paquet Microsoft Store. La tuile Réglages ne fait rien avant la phase 9.

- [x] 5.1 `lib/config.js` : config par défaut + fusion avec la config de l'utilisateur, lecture et écriture sûres (testé).
- [x] 5.2 `lib/launch.js` : validation des cibles (chemin existant, `.exe` ou dossier ; URL en `https:` uniquement) (testé).
- [x] 5.3 IPC `bar.launch(id)` → `shell.openPath` / `shell.openExternal` / `spawn` avec des arguments fixes. Détection de VS Code, de Claude Desktop et de Windows Terminal.
- [x] 5.4 Vraies icônes via `app.getFileIcon()` (repli : icône Lucide).

### Phase 6 : Auto-masquage
- [x] 6.1 Option de config (`autoHide`, désactivée par défaut ; à tester avec `npm start -- --auto-hide` en attendant la phase 9) ; la barre glisse hors de l'écran et une bande de 2 px en haut la fait revenir.

### Phase 7 : Volume et micro

Choix : API Core Audio de Windows (`IAudioEndpointVolume`) appelée depuis `helpers/windows.ps1` (C# compilé par `Add-Type`), le même script resté ouvert que la capture du fond. Aucune dépendance.

- [x] 7.1 Recherche dans la doc (API Windows Core Audio : PowerShell en arguments fixes ou petit binaire) ; choix expliqué, et accord demandé si une dépendance est nécessaire.
- [x] 7.2 Lecture et réglage du volume système, coupure du micro.

### Phase 8 : Musique

Choix (expliqué à l'utilisateur) : API Windows des contrôles multimédias (`GlobalSystemMediaTransportControlsSessionManager`), appelée depuis `helpers/windows.ps1` et relue chaque seconde. Marche avec toute appli qui se déclare à Windows (Spotify, Deezer, Apple Music, navigateurs). Pochette d'album ou miniature YouTube (case élargie en 16:9). Position masquée quand elle est inconnue ou trop ancienne.

- [x] 8.1 Recherche (Windows `GlobalSystemMediaTransportControlsSessionManager`) ; explication à l'utilisateur avant de coder.
- [x] 8.2 Titre, artiste, état ; lecture/pause, suivant, précédent.

### Phase 9 : Réglages

La tuile 06 ouvre les réglages dans le panneau : couleurs, transparence (du panneau ouvert sur le flou), masquage automatique, raccourci clavier, les 5 tuiles (nom, appli / dossier / site web), réglages par défaut, quitter la barre (remplace le clic droit provisoire). Tout passe par `lib/settings.js` avant d'être enregistré (écriture sûre) et appliqué en direct.

- [x] 9.1 Panneau de réglages (couleurs, transparence, raccourcis, auto-masquage), enregistrés dans `userData` et appliqués en direct.

### Ajouts avant l'installateur (demandés par l'utilisateur)
- [x] Pictogramme de dossier simple pour les tuiles dossier.
- [x] Tuiles : jusqu'à 18, ordre libre, types appli / fichier / dossier / site / appli du PC (testé).
- [x] Panneau : tuiles construites depuis la config, glisser-déposer pour les déplacer ; fenêtre agrandie (700 px) pour 3 rangées.
- [x] Réglages : ajouter, supprimer, monter / descendre une tuile.
- [x] Recherche d'applis du PC : liste du menu Démarrer + icônes par `helpers/windows.ps1`, recherche sans accents (testée), lancer, épingler.
- [x] Thèmes de 4 couleurs (fond, cartes, couleur 1, couleur 2) tirés des palettes envoyées ; pastilles dans les réglages (testés : couleurs valides, texte lisible).
- [x] Choix de police : Minimal, Pixel art, Littéraire (polices OFL locales).

### Phase 10 : Finitions
- [ ] 10.1 Lancement au démarrage (`app.setLoginItemSettings`).
- [ ] 10.2 Installateur `.exe` (outil à valider) + `shipping-and-launch`.

## Risques et parades

| Risque | Impact | Parade |
|--------|--------|--------|
| Fenêtre transparente + flou mal rendu sous Windows | Moyen | Flou en CSS par défaut ; acrylique seulement si le rendu est propre (2.6). |
| Clics traversants + survol (`forward`) peu fiables | Élevé | Vérifié tôt (phase 3), en suivant la doc officielle Electron. |
| Musique et volume sans API Node native | Élevé | Recherche dédiée (7.1, 8.1) avant de coder ; accord pour toute dépendance. |
| Raccourci global déjà pris par une autre appli | Faible | Message clair ; raccourci modifiable en phase 9. |

## Questions ouvertes

- Méthode pour la musique (8.1) et le volume (7.1) : réponse après recherche.
- Outil d'installateur (10.2).
