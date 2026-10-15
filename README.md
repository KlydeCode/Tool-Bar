# Island

Une barre façon « Dynamic Island » pour Windows 11, en haut au centre de l'écran.
Repliée, c'est une pilule (musique en cours + heure). Au survol, au clic ou avec **Alt+Maj+Espace**, elle se déplie :
musique, heure, recherche d'applis, raccourcis, volume et micro, et un agenda (clic sur l'horloge).

## Installer

Télécharger `Island-Setup-1.0.0.exe` (page *Releases* du dépôt) et le lancer.
L'installateur n'est pas signé : Windows peut afficher « Windows a protégé votre ordinateur » → **Informations complémentaires** → **Exécuter quand même**.

Island s'installe pour l'utilisateur (pas besoin d'être administrateur), avec un raccourci dans le menu Démarrer et sur le Bureau.
Désinstallation : Paramètres Windows > Applications.

## Développer

```
npm install
npm start        # lance la barre
npm test         # tests de la logique (node:test)
npm run dist     # crée l'installateur dans dist/
```

Electron + HTML / CSS / JavaScript simples. Détails : `CLAUDE.md` (règles du projet), `SPEC.md`, `PLAN.md`.
Polices sous licence OFL (`assets/fonts/`). Seules dépendances : `ical.js` (agenda) et, pour construire, `electron` et `electron-builder`.
