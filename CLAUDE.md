# CLAUDE.md : Island

> Nom choisi par l'utilisateur à la version 1.0 (avant : « Ma Barre »). Version actuelle : 2.0.0
> (réécriture Electron → Tauri 2 : Rust + TypeScript, demandée par l'utilisateur ; la 1.0 Electron reste sur `main`).

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

- **Tauri 2** : **Rust** pour la fenêtre et les actions Windows, **TypeScript** + HTML / CSS pour l'interface.
  Pas de framework (React, Vue…), pas de bundler : `tsc` compile `ui/ts/` vers `ui/js/` (modules ES).
- Node.js LTS + Rust (MSVC). Commandes : `npm install`, `npm start` (= `tauri dev`), `npm test` (Node + `cargo test`), `npm run dist`.
- **Le moins de dépendances possible.** Avant d'en ajouter une, explique pourquoi et demande son accord.
- Cible : Windows 11 uniquement.

### Organisation des fichiers

```
src-tauri/src/main.rs      fenêtre, souris traversante, raccourci clavier, commandes appelées par l'interface
src-tauri/src/settings.rs  vérification des réglages (seule porte d'entrée vers la config enregistrée)
src-tauri/src/launch.rs    vérification des cibles des tuiles avant lancement
src-tauri/windows.ps1      script PowerShell resté ouvert : capture du fond, volume, micro, musique, applis, icônes
ui/index.html, styles.css  la structure et tout le style (couleurs en variables CSS)
ui/ts/bar.ts               le pont vers Rust (seules commandes disponibles) ; ui/ts/app.ts : le comportement
ui/fonts/                  les polices, en local
config.default.json        réglages par défaut ; ceux de l'utilisateur sont dans %APPDATA%\com.klydecode.island
```

### Sécurité (non négociable)

- La fenêtre ne parle à Rust que par les commandes de `main.rs` (`ui/ts/bar.ts`) ; permissions Tauri réduites à
  `core:event:default` (capabilities), CSP stricte dans `tauri.conf.json`. Rust vérifie chaque valeur reçue.
- Jamais de commande shell construite à partir d'un texte venant de l'interface. Utiliser le module `opener` de Tauri
  ou `Command` avec des arguments fixes. Vérifier les chemins lus dans la config avant de les lancer.
  Vers `windows.ps1` : des nombres, ou des textes déjà vérifiés et encodés en base64 (lus comme données).

## Design (maquette « 1 · Minimal » validée)

Fidélité à la maquette : c'est la référence. Une capture est fournie par l'utilisateur.

**Couleurs** (variables CSS, modifiables dans les réglages)
- `--c1` couleur 1 : `#8AB4FF` (musique, barre de progression, volume, pochette)
- `--c2` couleur 2 : `#FFB86B` (bouton lecture, « : » de l'horloge, survol des tuiles, heure dans la pilule, micro coupé)
- Fond : `rgba(10,10,11, 1 - transparence)`. Pilule et panneau sans flou : 12 % (35 % jugé trop transparent par l’utilisateur).
  Panneau ouvert sur le flou : transparence réglable de 0 à 70 %, 30 % par défaut (phase 9)
  (décidé en phase 3 : capture de l'écran derrière la fenêtre à l'ouverture par un script PowerShell resté ouvert
  (`src-tauri/windows.ps1`, qui gère aussi le volume, le micro et la musique ; `desktopCapturer` bloquait le processus principal ~0,35 s et faisait saccader), floutée dans un canvas ; l'acrylique floute tout le
  rectangle de la fenêtre, `setShape` ne le découpe pas, et `backdrop-filter` / `filter` ne floutent pas le bureau)
- Cartes intérieures : `rgba(255,255,255,0.06)` ; bordure du panneau : `rgba(255,255,255,0.1)`
- Texte : `#F4F4F5` ; texte secondaire : `#B4B4BC` ; texte sur les couleurs : `#0A0A0B`

**Polices** (fichiers en local dans `ui/fonts/`, licences libres OFL)
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
   les clics autour doivent traverser la fenêtre (Rust suit le curseur et active `set_ignore_cursor_events` hors des zones envoyées par l'interface).
4. **Raccourci clavier global** (Alt+Maj+Espace par défaut ; Ctrl+Alt+Espace est déjà pris sur le PC de l'utilisateur, sans doute par l'appli Claude) pour ouvrir/fermer.
5. **Raccourcis d'applis** : lancer VS Code, ouvrir Téléchargements, le navigateur par défaut, Claude (appli de bureau, sinon claude.ai),
   Windows Terminal. Les vraies icônes viennent de `app.getFileIcon()`. Raccourcis définis dans la config.
6. **Auto-masquage** (option) : la barre glisse hors de l'écran, revient quand la souris touche le haut.
7. **Volume et micro** : lire et régler le volume système, couper le micro.
8. **Musique** : titre/artiste en cours, lecture/pause, suivant/précédent (Spotify, navigateur…). C'est la partie la plus technique :
   chercher dans la documentation la solution la plus simple et fiable, et l'expliquer avant de la coder.
9. **Réglages** : panneau pour les deux couleurs, la transparence, les raccourcis, l'auto-masquage ; enregistrés et rechargés au démarrage.
10. **Finitions** : lancement au démarrage de Windows (option, version installée seulement), création d'un installateur `.exe`
    (en 2.0 : `tauri build`, NSIS par utilisateur, non signé ; `npm run dist` → `src-tauri/target/release/bundle/nsis/` ;
    réglages d'Island 1.x et de « Ma Barre » repris au premier lancement).

Ajouts demandés après la phase 9 (avant l'installateur) :
- **Tuiles libres** : jusqu'à 18 (3 rangées de 6), déplaçables (glisser-déposer dans le panneau, flèches dans les réglages),
  ajout / suppression ; cible = appli (.exe, .lnk), fichier, dossier, site (http/https) ou appli trouvée par la recherche.
  Dossiers : simple pictogramme de dossier.
- **Recherche d'applis du PC** dans le panneau (liste du menu Démarrer via `Get-StartApps`, icônes via Windows) ;
  Entrée lance, flèches pour choisir, épingle pour ajouter en tuile. Alt+Maj+Espace ouvre la barre avec le curseur dans la recherche.
  Clic droit sur un résultat : petit menu dans le panneau (HTML depuis la 2.0) (ouvrir, créer un raccourci dans la barre ou sur le Bureau, ouvrir l'emplacement du fichier).
- **Thèmes** (`ui/ts/themes.ts`) : 5 thèmes de 4 couleurs (fond, cartes, couleur 1, couleur 2) tirés des palettes Lospec
  envoyées par l'utilisateur (Minimal, Pastel Landscape, Mighty Retro Zero, Spaceship 25, Apollo) ; chaque couleur reste modifiable.
- **Police** au choix : Minimal (Bricolage / Uncut Sans / JetBrains Mono), Pixel art (Pixelify Sans / Silkscreen, tailles
  choisies pour rester nettes), Littéraire (Fraunces). Toutes en OFL, dans `ui/fonts/`.
- **Agenda** : clic sur l'horloge → panneau qui se déplie à droite du panneau principal (fenêtre élargie à 1400 px,
  transparente). Une semaine à la fois (‹ › et « Aujourd'hui »), en lecture seule. Sources : liens iCal (https ou webcal,
  relus toutes les 15 min, sans connexion à un compte) ou fichiers .ics importés ; copie dans `userData/calendars/`.
  Lecture avec `ical.js` (Mozilla, seule dépendance ajoutée, accord de l'utilisateur). Pas de rappels ni d'affichage dans la pilule.

Hors périmètre pour l'instant : l'API Claude (pas de clé API), Mac/Linux.

## Méthode de travail (agent-skills)

Utilise les skills du plugin **agent-skills** :

- **Avant de coder** : `spec-driven-development` → écrire `SPEC.md` à partir de ce fichier (tout y est déjà : ne pose pas de
  questions sauf blocage réel), puis `planning-and-task-breakdown` → `PLAN.md` avec de petites tâches et leurs critères de réussite.
- **Construction** : `/build auto` phase par phase (l'utilisateur teste entre deux phases).
- **Pendant** : `incremental-implementation` (une tâche à la fois, l'appli doit toujours se lancer),
  `frontend-ui-engineering` pour l'interface, `source-driven-development` pour toute API Tauri ou Windows
  (vérifier dans la doc officielle, ne pas deviner), `security-and-hardening` pour les commandes de `main.rs` et le lancement de programmes,
  `debugging-and-error-recovery` quand quelque chose casse.
- **Tests** : `test-driven-development` pour la logique (lecture/écriture de la config, validation des chemins, calculs de couleur/transparence).
  Pas besoin de tests pour du pur style.
- **Git** : `git-workflow-and-versioning`, un commit clair par tâche terminée, messages en français.
- **Fin de phase** : `code-review-and-quality` sur ce qui a été fait, puis `code-simplification` si le code devient compliqué.
- **À la fin** : `shipping-and-launch` pour l'installateur.

Mets à jour ce fichier si une décision importante change (et dis-le à l'utilisateur).

<!-- HANGAR:START - generated, do not edit by hand -->

## Shared task board (Hangar.AI)

This project is driven from Hangar.AI. Several agents work **in parallel** in separate
terminals on this same directory. A shared kanban board is the source of truth for
who is doing what. Reach it through the MCP tools prefixed `board_`.

### Hard rule

**Never start work on a task without claiming it first.** Another agent may already
be on it. `board_claim_task` fails when the task is taken — when that happens, do not
retry it, pick a different one.

### Expected loop

1. **On startup**, call `board_list_tasks` to see the current state of the work.
2. **To pick work**, call `board_next_task`. It returns the highest-priority free task
   whose dependencies are all done. Do not pick arbitrarily from the todo column, or
   you may start work that is still blocked.
3. **Claim it** with `board_claim_task`. It moves to `doing` automatically.
   - If the call fails, go back to step 2.
4. **Do the work.**
5. **Report** with `board_comment_task`: decisions made, files touched, problems hit.
   This is the only channel other agents have to learn what you did.
6. **Finish** with `board_update_task`, setting `column` to `review` if the work needs
   a second pair of eyes, or `done` otherwise.
   - If you give up, call `board_update_task` with `release: true` so the task returns
     to the pool instead of sitting blocked under your name.

### Splitting work

When you find work beyond your current task, do not silently pile it into the same
change: create tasks with `board_create_task` so other agents can pick them up.

- Use `depends_on` with the ids of prerequisite tasks. `board_next_task` relies on it
  to never hand out work that cannot start yet.
- Use `priority` (integer, higher is more urgent) for work that unblocks others.

### Waiting on something outside the board

When a task cannot go on because of a package release, a person's decision or a date,
call `board_block_task` with a `reason` (and `recheck`, the day to look again), not a
comment: the task returns to `todo`, nobody picks it up, and the next agent does not
repeat your check. If it was your task, stop there and do not deliver. Once the wait
is over, `board_unblock_task`; a `human_only` block is lifted by the person alone.

### Columns

| Column   | Meaning |
|----------|---------|
| `todo`   | ready to be picked up |
| `doing`  | someone is working on it |
| `review` | finished, waiting for a review |
| `done`   | accepted - unblocks tasks that depend on it |

### Staying out of each other's way

Before editing a central file, check with `board_list_tasks` that no other agent holds
a `doing` task covering the same area. If one does, leave a comment on their task
rather than editing the same files at the same time.

### Talking to the agent next door

Claude Code sessions in Hangar.AI are named after their pane and its workspace, for
example `Ava (Shop)`. A pane's first name is unique across every workspace, so `Ava` is
one agent and the workspace in brackets tells you which project it works on. When another
agent needs to know something now (you changed a file it is working on, you answered its
question), message it directly with `SendMessage` to that name; `/list-agents` shows who
is reachable. The board stays the record: write the same thing there if it matters beyond
this moment.

### Showing a 3D model

To show the user a 3D model, open it with `model_show` rather than giving them a path, and
check your own work with `model_snapshot`, which returns a picture of it.

### Showing a file, or sending it to the phone

To show the user a render, screenshot, recording, report, Markdown, PDF or HTML page, open
it with `preview_show {path, title?}` rather than giving them a path: it opens as a pane
of the workspace's grid, beside the terminals. An HTML page runs isolated, so inline its scripts and styles
(its own `.js` and `.css` files do not load). Call `preview_close` once you are done, so it
does not keep a part of their screen.

To send a file to the user's phone (Hangar Mobile), use `phone_share {path, caption?}`, when
they ask for it or a result is clearly worth it, never for routine output.

### Opening a kit's tab

A kit enabled on this workspace can bring small tabs that take params, such as one showing a
CI run for its id. `kit_tab_list` says which there are, `kit_tab_open {kit, tab, params?, reveal?}`
opens one as a pane of the grid too, without taking the keyboard from anyone, and
`kit_tab_close {kit, tab, params?}` closes it.

## Global memory

You also have a **persistent global memory**, reached through the MCP tools prefixed
`memory_`. It is shared by every workspace, every project and every agent, and it
survives across sessions: what you write there, the next agent reads. The origin
(workspace, agent) is recorded for you.

### Read before you dig

**At the start of a task, call `memory_search`** with the project name and the subject you
are about to touch. Another agent may already have paid the price of finding this out —
do not re-discover what is already written down. `memory_list` gives a compact index,
`memory_read` pulls one entry in full.

### Write the moment you learn

Call `memory_write` as soon as a durable, reusable fact appears, not at the end of the
task. Worth keeping:

- architecture decisions **and the reason behind them**
- environment or build traps: the flag that is required, the command that hangs, the
  version that breaks things
- project conventions that are not obvious from a quick read
- preferences the user stated explicitly

Do not write: task progress, which belongs in `board_comment_task`; anything readable
from the code or the git history; ephemeral details of the current conversation.

### How to write an entry

- **Title** short, stable, searchable. `memory_write` upserts on the title
  (case-insensitive), so reuse the same title to update a fact instead of stacking a
  near-duplicate next to it.
- **Content** brief and factual — actionable by someone arriving with no context.
- **Tags** must include the project name. The memory is global, so an entry that does not
  carry its own project context is noise everywhere else.

### Hygiene

When a fact turns out to be false, correct it with `memory_update` or drop it with
`memory_delete`. Never leave two entries contradicting each other: the next agent has no
way to tell which one is still true.

<!-- HANGAR:END -->
