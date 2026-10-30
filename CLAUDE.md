# FuelTrajetMap / FuelMap — mémoire du projet pour Claude Code

Réponds et commente **en français**. Denis (pseudo Soaresden) développe seul ; il teste dans sa vraie voiture et renvoie
le journal de diagnostic (zip). Il n'est pas développeur Android de métier : explique les choix, pas de jargon gratuit.

## Ce que c'est

Carte des prix carburants (France + ES/PT/AD/IT) + optimiseur d'arrêts sur un trajet + appli Android (Capacitor) avec un
écran **Android Auto** maison. PWA statique servie par GitHub Pages (`https://soaresden.github.io/FuelTrajetMap/`),
données reconstruites toutes les 3 h par la GitHub Action (`tools/build-data.mjs` → `data/`). Aucun serveur à nous.

```
index.html, css/app.css, sw.js         page unique + service worker (cache « fuelmap-vNN », à incrémenter à chaque livraison)
js/config.js                           { dataBase, version }  ← version affichée (v1.5.8 en haut à droite) = versionName Android
js/app.js                              cœur : carte Leaflet, données, trajet, proximité, alertes, thèmes, API interne window.__fuelmapAPI
js/car.js                              écran Android Auto (?aa=1) : rail + panneau, Stations / Trajet / Pénurie, guidage
js/fillup.js                           carnet de pleins (question au démarrage près d'une station, pavé, km, stats)
js/diag.js                             journal côté page (FM.log), export du zip de diagnostic
js/sources.js, js/optimizer.js         chargement/normalisation des données ; algorithme d'arrêts (testé : tests/optimizer.test.js)
js/themes.js, js/update.js             12 thèmes ; mise à jour obligatoire (version-min.json)
tools/build-data.mjs                   génère data/<pays>.json, brands, hist, fr-habits.json (habitudes de mise à jour)
apk/                                   projet Capacitor ; apk/android = projet Gradle (Java) ; apk/dhu = écran de voiture virtuel
apk/android/app/src/main/java/fr/soaresden/fuelmap/
  MainActivity.java                    Capacitor + mise à jour in-app Play + plugins (FuelAlert, Diag)
  auto/FuelCarAppService.java          session Android Auto (catégorie NAVIGATION), permission localisation, NavigationManager
  auto/MapScreen.java                  NavigationTemplate : boutons Y aller/Arrêter, 📍, 🔍, 🐞 ; fiche de manœuvre + ETA
  auto/CarWebSurface.java              la page web dessinée sur l'écran voiture (VirtualDisplay + Presentation + WebView)
  auto/SearchScreen.java, CarVoice.java  recherche d'adresse (clavier/voix de l'hôte) ; synthèse vocale du guidage
  alert/                               alerte carburant (WorkManager 15 min) ; diag/ journal fichier + export zip
.plus-archive/                         (ignoré par git) code de l'offre payante « Plus » mis de côté + NOTES.md / NOTES-carnet.md
```

## Règles non négociables

- **versionCode jamais réutilisé** : le Play Console grille un code dès qu'un AAB est téléversé, même en brouillon.
  Dernier utilisé : **46 (1.5.8)**. Chaque livraison = code +1 ET bump de `versionName` dans `apk/android/app/build.gradle`,
  de `version` dans `js/config.js`, et du nom de cache dans `sw.js`. Les trois ensemble, toujours.
- Chaque livraison fournit : APK **release** (signé avec la clé d'upload, s'installe par-dessus), AAB (Play), et un commit.
  Les `*.apk`/`*.aab` sont ignorés par git ; ils vivent dans `apk/`.
- `apk/android/keystore/` (clé d'upload + keystore.properties) **ne va jamais dans git**. `.plus-archive/` non plus.
- Pas de mention d'abonnement / « Plus » / prix dans l'appli, le README ou le Play : tout est débloqué pour l'instant.
  Le découpage futur gratuit / Plus est documenté dans `.plus-archive/NOTES.md` et `NOTES-carnet.md`.
- README : exemples avec des lieux et un véhicule fictifs (« Ma 208 », Tours → Nantes), jamais les données perso de Denis.
- Heures publiées par l'État = heure de Paris, mais l'API ODS leur colle « +00:00 » à tort : on parse en local (`localMs`,
  `Europe/Paris` côté Java). Ne pas « corriger » ça.

## Construire / tester

- PC : `apk\construire-apk.bat` (Node + SDK Android 36 + JDK 21). Pour un APK release signé : `cd apk\android && gradlew.bat assembleRelease bundleRelease`
  (le signing release s'active si `keystore/keystore.properties` existe).
- À la main : copier `index.html sw.js js css icons vendor manifest.webmanifest privacy.html version-min.json` dans `apk/www/`,
  `npx cap sync android`, puis Gradle. Le dossier `apk/www/` est ignoré par git.
- Données locales pour tester : `node tools/build-data.mjs` (cibles : fr es pt ad it brands hist).
- Test unitaire : `node tests/optimizer.test.js`. Les tests d'écran se faisaient avec Playwright contre `index.html?car=1&aa=1`
  en 1193×480 (taille de l'écran de la voiture de Denis), insets hôte : visible Rect(26,95-1167,467), stable Rect(26,26-1167,467).
- Écran voiture virtuel : `apk\dhu\lancer-dhu-ma-voiture.bat` (1193×480) ou `lancer-dhu.bat` (1280×720). Téléphone en USB,
  débogage USB, Android Auto → paramètres développeur → « Démarrer le serveur de l'unité principale » (à refaire à chaque fois),
  « Sources inconnues » coché pour voir un APK installé à la main.
- Journal : bouton 🐞 dans la voiture (repère + état de l'écran), puis sur le téléphone Véhicules → « Envoyer le journal de
  diagnostic » → zip (journal.txt = notre fichier tournant, logcat.txt, etat-appli.json, appareil.txt). C'est la source de vérité
  pour tout ce qui se passe dans la voiture ; lire `journal.txt` en filtrant `icons/brands` (bruit) et chercher `MARQUEUR`.

## Android Auto : ce qu'on a appris (ne pas refaire les mêmes erreurs)

- Catégorie **NAVIGATION** + `NavigationTemplate` : seul moyen d'avoir la carte plein écran sans la « vignette » de l'hôte.
  Conséquence : `startCarApp(ACTION_NAVIGATE)` nous est **renvoyé à nous-mêmes** (on est l'appli de nav courante), et lancer
  Google Maps sur le téléphone est soit refusé (BAL / display de la voiture), soit invisible dans la voiture. D'où le guidage
  maison : itinéraire OSRM avec `steps=true`, fiche de manœuvre et ETA fournis à l'hôte via `RoutingInfo`/`TravelEstimate`/
  `NavigationManager.updateTrip`, voix via `CarVoice` (TTS, canal guidage). Le bouton 📱 Maps reste en option.
- La page est dessinée dans un `VirtualDisplay` (flags PRESENTATION | OWN_CONTENT_ONLY, résolution exacte de la surface) +
  `Presentation` + `WebView`. Quand l'hôte retire la surface, **ne jamais déplacer la WebView** : on fait `display.setSurface(null)`
  puis `setSurface(nouvelle)` au retour. Déplacer la vue → petit carré en haut à gauche, reste noir. Fenêtre : fond sombre,
  `FLAG_HARDWARE_ACCELERATED`.
- Les gestes de l'hôte (`onScroll/onFling/onScale`) n'ont **pas de position** → tout passe par JS (`__fuelmapCar.scroll/fling/zoom`) :
  panneau ouvert = la liste défile, replié = la carte bouge ; jamais de faux MotionEvent pour un glisser (ça « clique au travers »).
  `onScale` envoie des facteurs minuscules : on les cumule jusqu'à un cran de zoom. Les taps restent des `onClick(x,y)` rejoués.
- Déplacement de carte fluide : `map._rawPanBy` + `fire('move')` groupés par rAF, un seul `moveend` 120 ms après la fin du geste
  (le canvas des pastilles se redessine sur `moveend`, c'est lui qui coûte).
- L'hôte cache ses boutons du haut après ~5 s et les ré-affiche au toucher : la zone **visible** change ; la colonne de gauche se
  cale sur la zone **stable** (`onStableAreaChanged` → `--stable-*`) et ne doit pas bouger. Seule la carte suit `--safe-*`.
- Contraintes du strip NAVIGATION : 4 actions max, 1 primaire (fond coloré uniquement sur FLAG_PRIMARY, sinon crash « erreur inattendue »).
- Permission localisation : après une (ré)installation elle est à zéro → la page n'a pas de GPS et tout paraît cassé. La session
  demande via `CarContext.requestPermissions` (invite sur le téléphone) ; le téléphone demande aussi à l'ouverture.
- `@JavascriptInterface` : le pont page→Android a déjà « perdu » des appels (cible Y aller périmée). Pour ce qui compte, Android
  **interroge la page** au moment voulu (`surface.eval(...)`) plutôt que de mémoriser.
- Les listes de l'hôte sont limitées (~6 lignes) : c'est pourquoi les listes sont dans la page, pas dans des templates.

## Écran voiture (js/car.js) — comportement attendu

Rail de 3 boutons à gauche (⛽ Stations : stations de la zone affichée, vert→rouge, tri prix ; 🧭 Trajet : départ = ma
position, destination par favoris / dernier trajet / 🔍 hôte, réservoir en 8 barres, arrêts proposés ; 🚨 Pénurie : autour
de la voiture, note fraîcheur-distance-prix avec les pushs automatiques (Total 00:01) fortement pénalisés). Panneau repliable vers
la gauche, lignes denses, défilement. Toucher une ligne = carte de station sur la carte (prix, fraîcheur, horaires, 🧭 Y aller).
Y aller (bouton de l'hôte ou de la carte) = guidage : vue derrière la flèche (carte tournée au cap et inclinée en CSS, flèche
fixe au tiers bas, zoom selon la vitesse), instructions, voix, recalcul si > 500 m hors itinéraire, ⏹ Arrêter. État et
journalisation : `__fuelmapCar.state()/dump()`. Plein : question « tu viens de faire le plein ? » (fillup.js) dans la colonne.

## Play Store

Compte développeur vérifié, appli `fr.soaresden.fuelmap`, tests internes actifs (famille via lien). AAB signé avec la clé
d'upload (Play App Signing). Risque connu pour la production : la catégorie NAVIGATION est examinée de près par Google.
Le README décrit la publication.

## Pistes en attente (par priorité ressentie)

1. Valider dans la voiture : fiche de manœuvre acceptée par l'hôte, voix dans les enceintes, vue tournée fluide (sinon alléger la nappe de couleur).
2. Remontée utilisateur (« cette station est fermée / plus d'essence ») : nécessite un petit backend (Cloudflare Worker proposé), en attente du compte.
3. Carnet de pleins : export CSV, rappel kilométrage ; puis découpage gratuit / Plus (voir `.plus-archive`).
4. Statistiques de conduite (conso réelle déjà calculée entre deux relevés de compteur).
5. Historique GitHub : les commits d'avant la 1.2 mentionnant « Plus » existent encore sur le dépôt distant ; re-squash possible si Denis le souhaite.
