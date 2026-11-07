# Island

Une barre façon « Dynamic Island » pour Windows 11, en haut au centre de l'écran.
Repliée, c'est une pilule (musique en cours + heure). Au survol, au clic ou avec **Alt+Maj+Espace**, elle se déplie :
musique, heure, recherche d'applis, raccourcis, volume et micro, et un agenda (clic sur l'horloge).

## Installer

Télécharger `Island_2.0.0_x64-setup.exe` (page *Releases* du dépôt) et le lancer.
L'installateur n'est pas signé : Windows peut afficher « Windows a protégé votre ordinateur » → **Informations complémentaires** → **Exécuter quand même**.

Island s'installe pour l'utilisateur (pas besoin d'être administrateur), avec un raccourci dans le menu Démarrer et sur le Bureau.
Désinstallation : Paramètres Windows > Applications.

## Développer

Il faut Node.js et Rust (avec les outils de compilation C++ de Visual Studio).

```
npm install
npm start        # lance la barre (tauri dev)
npm test         # tests : TypeScript (node:test) et Rust (cargo test)
npm run dist     # crée l'installateur dans src-tauri/target/release/bundle/nsis/
```

Tauri 2 : Rust (`src-tauri/`) + TypeScript, HTML, CSS (`ui/`). Détails : `CLAUDE.md` (règles du projet), `SPEC.md`, `PLAN.md`.
Polices sous licence OFL (`ui/fonts/` : Inter, Pixelify Sans, Silkscreen, Fraunces). Dépendances : `ical.js` (agenda), Tauri et ses modules officiels,
et côté Rust `serde_json`, `url`, `ureq` (téléchargement des agendas), `base64`.
