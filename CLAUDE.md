# CLAUDE.md : Ma Barre

> Nom provisoire : renomme le projet quand tu auras trouvé un vrai nom.

## Le projet

Une application Windows 11 qui affiche une barre en haut de l'écran, au centre, façon « Dynamic Island ».
Repliée, c'est une petite pilule (musique en cours + heure). Au survol ou au clic, elle se déplie en un panneau avec :
la musique, l'heure et la date, six raccourcis (VS Code, Téléchargements, Navigateur, Claude, Terminal, Réglages),
le volume et le micro. Tout est personnalisable : deux couleurs, la transparence, les raccourcis.

## Qui fait quoi

**Tu écris 100 % du code.** L'utilisateur ne code pas et ne veut pas coder : son rôle est de lancer l'appli, de la tester
sur son PC Windows et de te dire ce qui va ou ne va pas.

- **Ne lui demande jamais de modifier un fichier** ni d'écrire du code. Si quelque chose doit changer, fais-le toi-même.
- Prends les décisions techniques toi-même, avec des choix par défaut raisonnables. Ne lui pose des questions que sur ce qu'il est
  seul à savoir (ses goûts, ses applis, le chemin d'un programme sur son PC si tu ne peux pas le trouver).
- Installe toi-même les dépendances et lance toi-même les commandes quand tu le peux.
- Parle **en français**, court et simple. À la fin de chaque phase, donne-lui seulement : la commande pour lancer l'appli,
  ce qu'il doit voir ou essayer (une petite liste), et ce qu'il doit te répondre.
- S'il te signale un problème, corrige-le sans lui demander de toucher au code.
- Commentaires du code en français.

## Technique

- **Electron** + **HTML / CSS / JavaScript** simples. Pas de framework (React, Vue…), pas de TypeScript, pas de bundler pour l'instant.
- Node.js LTS. Commandes : `npm install`, `npm start`.
- **Le moins de dépendances possible.** Avant d'en ajouter une, explique pourquoi et demande son accord.
- Cible : Windows 11 uniquement.

### Organisation des fichiers

```
main.js          processus principal : fenêtre, raccourci clavier, actions Windows (ouvrir une appli, volume…)
preload.js       pont sécurisé entre la fenêtre et main.js (contextBridge)
src/index.html   la structure de la barre
src/styles.css   tout le style (couleurs en variables CSS)
src/app.js       le comportement de l'interface
assets/fonts/    les polices, en local
config par défaut  raccourcis, couleurs, transparence ; la config de l'utilisateur est enregistrée dans app.getPath('userData')
```

### Sécurité (non négociable)

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- La fenêtre ne parle à `main.js` que par quelques fonctions précises exposées dans `preload.js`.
- Jamais de commande shell construite à partir d'un texte venant de l'interface. Utiliser `shell.openPath`, `shell.openExternal`
  ou `spawn` avec des arguments fixes. Vérifier les chemins lus dans la config avant de les lancer.

## Design (maquette « 1 · Minimal » validée)

Fidélité à la maquette : c'est la référence. Une capture est fournie par l'utilisateur.

**Couleurs** (variables CSS, modifiables dans les réglages)
- `--c1` couleur 1 : `#8AB4FF` (musique, barre de progression, volume, pochette)
- `--c2` couleur 2 : `#FFB86B` (bouton lecture, « : » de l'horloge, survol des tuiles, heure dans la pilule, micro coupé)
- Fond du panneau : `rgba(10,10,11, 1 - transparence)` ; transparence réglable de 0 à 70 %, 12 % par défaut (35 % jugé trop transparent par l’utilisateur), avec flou derrière
  (décidé en phase 3 : capture de l'écran derrière la fenêtre à l'ouverture par un script PowerShell resté ouvert
  (`helpers/windows.ps1`, qui gère aussi le volume et le micro ; `desktopCapturer` bloquait le processus principal ~0,35 s et faisait saccader), floutée dans un canvas ; l'acrylique floute tout le
  rectangle de la fenêtre, `setShape` ne le découpe pas, et `backdrop-filter` / `filter` ne floutent pas le bureau)
- Cartes intérieures : `rgba(255,255,255,0.06)` ; bordure du panneau : `rgba(255,255,255,0.1)`
- Texte : `#F4F4F5` ; texte secondaire : `#B4B4BC` ; texte sur les couleurs : `#0A0A0B`

**Polices** (fichiers en local dans `assets/fonts/`, licences libres OFL)
- **Bricolage Grotesque** : horloge (60 px, graisse 800, interlettrage -0.05em) et titre du morceau (19 px, 700)
- **Uncut Sans** : tout le texte courant (github.com/kaspernordkvist/uncut_sans)
- **JetBrains Mono** : petites étiquettes en majuscules (10,5 px, interlettrage 0.14em : EN COURS, RACCOURCIS, VOLUME), chiffres, date

**Formes**
- Panneau : 680 px de large, padding 18 px, coins 32 px. Pilule : 40 px de haut, coins arrondis complets.
- Haut du panneau : carte musique à gauche, carte horloge (190 px) à droite. Puis 6 tuiles de 88 px (coins 20 px) numérotées 01 à 06,
  puis la ligne volume + micro.
- Boutons d'au moins 44 × 44 px. Icônes : traits simples (style Lucide).

**Animations**
- Ouverture : la pilule s'étire jusqu'au panneau (un seul fond découpé par `clip-path`, ~0,65 s, sans rebond) ; le contenu apparaît ensuite,
  et le flou arrive en fondu depuis le fond sombre (choix de l'utilisateur en phase 3, à la place du « scale » depuis 0.35 × 0.15).
- Tuiles au survol : montent de 4 px, contour en couleur 2, l'icône grossit (×1,2) en penchant de -8° et passe en couleur 2. Au clic : s'enfoncent (×0,94).
- Précédent / suivant : l'icône glisse de 3 px dans sa direction au survol.
- Bouton lecture : grossit au survol ; pendant la lecture, une onde en couleur 2 pulse autour.
- Égaliseur : barres qui dansent pendant la lecture, figées en pause.
- Respecter `prefers-reduced-motion` (couper les animations).

## Fonctionnalités, par phases

Enchaîne les tâches d'une phase sans t'arrêter. Une phase est terminée quand l'appli se lance sans erreur
et que l'utilisateur a validé à l'écran ce qui ne peut être vérifié que sur son PC (rendu, transparence, son, musique).

1. **Fenêtre** : sans cadre, transparente, toujours au-dessus, absente de la barre des tâches, centrée en haut de l'écran principal.
2. **Interface statique** fidèle à la maquette, avec les polices et animations de survol.
3. **Pilule ↔ panneau** : ouverture au survol/clic, fermeture quand la souris s'en va. Quand la barre est repliée,
   les clics autour doivent traverser la fenêtre (`setIgnoreMouseEvents`).
4. **Raccourci clavier global** (Alt+Maj+Espace par défaut ; Ctrl+Alt+Espace est déjà pris sur le PC de l'utilisateur, sans doute par l'appli Claude) pour ouvrir/fermer.
5. **Raccourcis d'applis** : lancer VS Code, ouvrir Téléchargements, le navigateur par défaut, Claude (appli de bureau, sinon claude.ai),
   Windows Terminal. Les vraies icônes viennent de `app.getFileIcon()`. Raccourcis définis dans la config.
6. **Auto-masquage** (option) : la barre glisse hors de l'écran, revient quand la souris touche le haut.
7. **Volume et micro** : lire et régler le volume système, couper le micro.
8. **Musique** : titre/artiste en cours, lecture/pause, suivant/précédent (Spotify, navigateur…). C'est la partie la plus technique :
   chercher dans la documentation la solution la plus simple et fiable, et l'expliquer avant de la coder.
9. **Réglages** : panneau pour les deux couleurs, la transparence, les raccourcis, l'auto-masquage ; enregistrés et rechargés au démarrage.
10. **Finitions** : lancement au démarrage de Windows (option), création d'un installateur `.exe`.

Hors périmètre pour l'instant : l'API Claude (pas de clé API), Mac/Linux.

## Méthode de travail (agent-skills)

Utilise les skills du plugin **agent-skills** :

- **Avant de coder** : `spec-driven-development` → écrire `SPEC.md` à partir de ce fichier (tout y est déjà : ne pose pas de
  questions sauf blocage réel), puis `planning-and-task-breakdown` → `PLAN.md` avec de petites tâches et leurs critères de réussite.
- **Construction** : `/build auto` phase par phase (l'utilisateur teste entre deux phases).
- **Pendant** : `incremental-implementation` (une tâche à la fois, l'appli doit toujours se lancer),
  `frontend-ui-engineering` pour l'interface, `source-driven-development` pour toute API Electron ou Windows
  (vérifier dans la doc officielle, ne pas deviner), `security-and-hardening` pour le pont `preload.js` et le lancement de programmes,
  `debugging-and-error-recovery` quand quelque chose casse.
- **Tests** : `test-driven-development` pour la logique (lecture/écriture de la config, validation des chemins, calculs de couleur/transparence).
  Pas besoin de tests pour du pur style.
- **Git** : `git-workflow-and-versioning`, un commit clair par tâche terminée, messages en français.
- **Fin de phase** : `code-review-and-quality` sur ce qui a été fait, puis `code-simplification` si le code devient compliqué.
- **À la fin** : `shipping-and-launch` pour l'installateur.

Mets à jour ce fichier si une décision importante change (et dis-le à l'utilisateur).
