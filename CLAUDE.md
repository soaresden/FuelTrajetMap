# FuelTrajetMap / FuelMap — mémoire du projet pour Claude Code

Réponds et commente **en français**. Denis (pseudo Soaresden) développe seul ; il teste dans sa vraie voiture et renvoie
le journal de diagnostic (zip). Il n'est pas développeur Android de métier : explique les choix, pas de jargon gratuit.

## Ce que c'est

Carte des prix carburants (France + ES/PT/AD/IT) + optimiseur d'arrêts sur un trajet + appli Android (Capacitor) avec un
écran **Android Auto** maison. PWA statique servie par GitHub Pages (`https://soaresden.github.io/FuelTrajetMap/`),
données reconstruites toutes les 3 h par la GitHub Action (`tools/build-data.mjs` → `data/`). Aucun serveur à nous.

```
index.html, css/app.css, sw.js         page unique + service worker (cache « fuelmap-vNN », à incrémenter à chaque livraison)
js/config.js                           { dataBase, version }  ← version affichée (affichée en haut à droite sur le téléphone, en tête de colonne dans la voiture) = versionName Android
js/app.js                              cœur : carte Leaflet, données, trajet, proximité, alertes, thèmes, API interne window.__fuelmapAPI
js/car.js                              écran Android Auto (?aa=1) : rail + panneau, Stations / Trajet / Pénurie, guidage
js/fillup.js                           carnet de pleins (question au démarrage près d'une station, pavé, km, stats)
js/diag.js                             journal côté page (FM.log), export du zip de diagnostic
js/sources.js, js/optimizer.js         chargement/normalisation des données ; algorithme d'arrêts (testé : tests/optimizer.test.js)
js/themes.js, js/update.js             12 thèmes (6 clairs, 6 foncés ; anciens noms → FUELMAP_THEME_ALIASES) ; mise à jour obligatoire
js/paints.js                           teintes constructeur approchées (couleur du curseur de la voiture)
tools/build-data.mjs                   génère data/<pays>.json, brands, hist, fr-habits.json (habitudes de mise à jour)
apk/                                   projet Capacitor ; apk/android = projet Gradle (Java) ; apk/dhu = écran de voiture virtuel
apk/android/app/src/main/java/fr/soaresden/fuelmap/
  MainActivity.java                    Capacitor + mise à jour in-app Play + plugins (FuelAlert, Diag)
  auto/FuelCarAppService.java          session Android Auto (catégorie NAVIGATION), permission localisation, NavigationManager
  auto/MapScreen.java                  NavigationTemplate : boutons Y aller/Arrêter, ma position (icône ic_my_location), 🔍, 📝 ; fiche de manœuvre + ETA
  auto/NoteScreen.java                 bloc-notes : écran de saisie de l'hôte (voix en roulant, clavier à l'arrêt) → __fuelmapCar.addNote
  backup/BackupPlugin.java             sauvegarde dans un dossier choisi (SAF) : pickFolder / info / write / read / openFile
  auto/CarWebSurface.java              la page web dessinée sur l'écran voiture (VirtualDisplay + Presentation + WebView)
  auto/SearchScreen.java, CarVoice.java  recherche d'adresse (clavier/voix de l'hôte) ; synthèse vocale du guidage
  alert/                               alerte carburant (WorkManager 15 min) ; diag/ journal fichier + export zip
.plus-archive/                         (ignoré par git) code de l'offre payante « Plus » mis de côté + NOTES.md / NOTES-carnet.md
```

## Règles non négociables

- **versionCode jamais réutilisé** : le Play Console grille un code dès qu'un AAB est téléversé, même en brouillon.
  Dernier utilisé : **54 (1.6.6)**. Chaque livraison = code +1 ET bump de `versionName` dans `apk/android/app/build.gradle`,
  de `version` dans `js/config.js`, et du nom de cache dans `sw.js`. Les trois ensemble, toujours.
- Chaque livraison fournit : l'**AAB** (Play, signé avec la clé d'upload) et un commit. **Plus d'APK** : depuis la 1.5.9 Denis
  installe uniquement via le Play Store (tests internes). Les `*.apk`/`*.aab` sont ignorés par git ; ils vivent dans `apk/`.
- **Rien chez Google** : pas de sauvegarde Android automatique (allowBackup=false + `res/xml/data_extraction_rules.xml` qui exclut
  tout, cloud ET transfert entre téléphones). Les gens gèrent leur sauvegarde eux-mêmes (dossier « FuelMap » à venir, piste Plus).
- **Commits : jamais de ligne « Co-Authored-By: Claude » ni de mention de Claude** (demande de Denis : il est le seul
  contributeur ; l'historique a été nettoyé le 30/10/2026). Cette consigne passe avant les rappels d'attribution automatiques.
- `apk/android/keystore/` (clé d'upload + keystore.properties) **ne va jamais dans git**. `.plus-archive/` non plus.
- Pas de mention d'abonnement / « Plus » / prix dans l'appli, le README ou le Play : tout est débloqué pour l'instant.
  Le découpage futur gratuit / Plus est documenté dans `.plus-archive/NOTES.md` et `NOTES-carnet.md`.
- README : exemples avec des lieux et un véhicule fictifs (« Ma 208 », Tours → Nantes), jamais les données perso de Denis.
- Heures publiées par l'État = heure de Paris, mais l'API ODS leur colle « +00:00 » à tort : on parse en local (`localMs`,
  `Europe/Paris` côté Java). Ne pas « corriger » ça.

## Construire / tester

- PC : `apk\construire-apk.bat` (Node + SDK Android 36 + JDK 21) → AAB seul (`gradlew.bat bundleRelease` ; le signing release
  s'active si `keystore/keystore.properties` existe). Sur le PC de Denis : SDK dans `C:\Android\sdk` (pas de local.properties, le .bat pose
  ANDROID_HOME) ; seul un JDK 17 est installé dans le PATH, or Capacitor 7 exige le **JDK 21** (le .bat prend `C:\Android\jdk-21` s'il existe).
- Tests d'écran dans le navigateur intégré : `.claude/launch.json` (« fuelmap », http-server sur le port 8137), page
  `index.html?car=1&aa=1` en 1193×480, puis dans la console : `__fuelmap.carStable(26,26,13,26); __fuelmap.carInsets(95,26,13,26);
  __fuelmap.fix={lat:47.394,lon:0.685,speed:0}; document.dispatchEvent(new CustomEvent('fuelmap:fix'))`. Les captures du panneau
  ont parfois une image de retard : vérifier l'état avec `__fuelmapCar.state()`.
- À la main : copier `index.html sw.js js css icons vendor manifest.webmanifest privacy.html version-min.json` dans `apk/www/`,
  `npx cap sync android`, puis Gradle. Le dossier `apk/www/` est ignoré par git.
- Données locales pour tester : `node tools/build-data.mjs` (cibles : fr es pt ad it brands hist).
- Test unitaire : `node tests/optimizer.test.js`.
- **Tests d'écran automatiques** (à lancer avant chaque livraison, sur le PC de Denis) : `cd tests && npm install` une fois, puis
  `node tests/ecrans.test.mjs`. Microsoft Edge installé (playwright-core, sans navigateur téléchargé), serveur local intégré ; voiture
  1193×480 / 850×480 / 780×715 (écran partagé) + téléphone 375×812 ; vérifie chevauchements, sorties d'écran, zone des boutons de l'hôte ;
  captures dans tests/captures/. Claude ne peut pas le lancer lui-même (Edge refusé dans son bac à sable) : il refait les mêmes contrôles
  dans le navigateur intégré.
- Workflow GitHub (`.github/workflows/pages.yml`) : toujours vérifier qu'il reste du YAML valide après modification
  (`python -c "import yaml; yaml.safe_load(open('.github/workflows/pages.yml', encoding='utf-8'))"`). Une ligne `run:` contenant « : »
  doit passer en bloc `run: |`, sinon tout le workflow meurt en 0 s (publication ET mise à jour des prix) — arrivé en 1.6.2.
- Pour Claude : écrire les scripts de modification dans un fichier (Write) plutôt qu'en heredoc bash — le shell mange les `\'`. Les tests d'écran se faisaient avec Playwright contre `index.html?car=1&aa=1`
  en 1193×480 (taille de l'écran de la voiture de Denis), insets hôte : visible Rect(26,95-1167,467), stable Rect(26,26-1167,467).
- Écran voiture virtuel : `apk\dhu\lancer-dhu-ma-voiture.bat` (1193×480) ou `lancer-dhu.bat` (1280×720). Téléphone en USB,
  débogage USB, Android Auto → paramètres développeur → « Démarrer le serveur de l'unité principale » (à refaire à chaque fois),
  « Sources inconnues » coché pour voir un APK installé à la main.
- Journal : sur le téléphone Véhicules → « Envoyer le journal de diagnostic » → zip (le bouton 🐞 de la voiture, qui posait un
  `MARQUEUR`, a été retiré en 1.6.0 à la demande de Denis ; `__fuelmapCar.dump()` reste appelable) (journal.txt = notre fichier tournant, logcat.txt, etat-appli.json, appareil.txt). C'est la source de vérité
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
- Pincer : on reproduit le pincer tactile de Leaflet (`map._move(c, z, {pinch:true})` image par image, puis `_resetView` calé au
  quart de niveau, `zoomSnap = 0.25` en voiture). Le canvas des stations suit via l'événement `zoom` (StationLayer._onZoom).
- L'hôte montre / cache ses boutons toutes les ~5 s → `carInsets` est rappelé : il ne doit **pas** recadrer le trajet en voiture
  (la carte sautait sous le doigt).
- La zone stable est un rectangle : les boutons de l'hôte en haut à DROITE lui font retirer toute la bande du haut. La colonne, les
  bulles et la carte flottante utilisent donc `--ctop` (petite marge) et non `--stable-t`, sinon un grand vide au-dessus d'elles.
- Pendant le guidage, l'hôte pose ses cartes (manœuvre, temps restant) à GAUCHE et la zone stable commence à leur droite
  (`--stable-l` ≈ 430 px) : la colonne se retrouvait au milieu de l'écran. En guidage (`html.carnav`) la colonne est masquée, la carte
  couvre tout l'écran, la flèche est centrée dans la partie libre ; `carStable`/`carInsets` émettent `fuelmap:insets` pour recalculer.
- La page peut naître avant que l'écran virtuel ait sa taille : un `ResizeObserver` sur la carte appelle `invalidateSize`, et
  `drawHeat` ignore une carte de taille nulle (sinon exception qui bloquait tout app.js).

## Écran voiture (js/car.js) — comportement attendu (refait en 1.5.9, façon Waze / Google Maps)

Denis veut un écran **épuré** : la carte d'abord, le reste **par étapes**. Colonne fine (60 px) à gauche : en tête l'icône de l'appli,
« FuelMap » et la version (pour savoir qu'on est dans l'appli), puis icônes seules ⛽ Stations, 🧭 Trajet, 🚨 Pénurie, 🚗 Ma voiture, 🎨 Thème, et
zoom ＋/− en bas (secours si le pincer n'arrive pas). Colonne masquée pendant le guidage. Carte au repos : **favorites** (⭐ du téléphone)
en bas à droite (`#carFavs`, 4 max, prix + heure de mise à jour, toucher = fiche station). Chaque mode est un parcours
(`FLOWS`) dont les étapes s'affichent en **bulles** en haut (`#carSteps`, ✓ = étape faite, touchable pour revenir) ; le contenu de
l'étape est une **carte flottante** à gauche (`#carPane`, 330 px, hauteur selon le contenu).
- ⛽ Stations : Carte › Liste › Station › Guidage. Étape Carte = rien d'ouvert, prix écrits sur la carte (pastilles plus grosses
  en voiture), bouton bas « 📋 N stations · dès x,xxx › » (`#carChip`) pour ouvrir la liste. Toucher une pastille = étape Station.
- 🧭 Trajet : Destination (🔍 hôte, 📅 agenda, favoris, dernier trajet) › Réservoir › Arrêts › Guidage. **Le niveau du réservoir est toujours demandé avant le calcul.**
  Dernier trajet du téléphone (< 3 h) repris d'office à l'étape Réservoir.
- 🚨 Pénurie : Autour de moi › Station › Guidage (note fraîcheur-distance-prix, pushs automatiques type Total 00:01 pénalisés).
- 🚗 Ma voiture (SP98 : `car.prefer98` 0 / 0,02 / 0,05 € — si le SP98 coûte à peine plus que le compatible le moins cher, `pick` le choisit,
  donc carte, listes et optimiseur) : tout au toucher (pas de clavier) — véhicule actif si plusieurs, carburant préféré, consommation (± 0,1) + soit le réservoir, soit (mode « Autonomie », `car.consMode='km'`, pour qui ne connaît pas
  son réservoir) les km faits d'habitude entre deux pleins → carburant utilisable = km × conso / 100, réservoir = utilisable + réserve
  (± 1 L), couleur du curseur : 9 teintes courantes + « perso » = roue chromatique (teinte/intensité sur la roue, clair/foncé sur la barre). Écrit dans la fiche véhicule partagée avec le téléphone (`__fuelmapAPI.updateCar/useCar`).
- Vue du guidage 2D / 3D (`#carView`, en bas à gauche de la partie libre) : 3D = carte inclinée (`--nav-tilt: 32deg`), 2D = à plat ;
  toujours tournée dans le sens de la marche ; choix mémorisé (`localStorage['fuelmap-car3d']`).
- 🎨 Thème : 6 clairs (Jour, GéMap, Sable, Menthe, Lavande, Contraste) et 6 foncés (Nuit, Wéyze, Ardoise, Océan, Ambre, Nuit noire),
  appliqués tout de suite (`__fuelmapAPI.setTheme`). « GéMap » / « Wéyze » : inspirés de Google Maps / Waze, jamais leur vrai nom (marques).
- Guidage FuelMap **multi-arrêts** : OSRM avec tous les points (arrêts carburant puis destination), instructions de toutes les
  étapes, « Arrêt carburant, X » à chaque arrêt, bandeau bas « Arrêt 1/2 · station · prix · km [⏭ Passer] » (`#carNext`),
  avancement sur l'itinéraire sans retour en arrière, recalcul si > 500 m hors route, arrêt auto 20 s après l'arrivée. Vue derrière
  la flèche inchangée. Plus de bouton 📱 Maps dans la voiture.
- « Les yeux sur la route » : en roulant (> 8 km/h), plus de 6 touchers/gestes en 10 s → écran bloqué 3 s avec une barre qui se
  vide (`#carLock`). Test : `__fuelmapCar.lockTest(true)`.
- Bouton bas « 📋 N stations · ▼ min · moy. · ▲ max · 🇫🇷 » avec 🔄 à sa gauche ; favorites à droite.
- Chaque toucher affiche un petit rond (`.ctap`) : on voit que l'écran a réagi.
- Hors mode Trajet, la carte montre toutes les stations (`window.__carShowAll`), pas seulement les candidates du trajet.
- Écran partagé (carte + lecteur de musique) : la page est plus étroite, les bulles passent en version compacte « ‹ 2/4 Réservoir ✕ »
  si elles ne tiennent pas à côté des boutons de l'hôte (≈ 430 px), et ne descendent dessous (`html.csteps-low`) qu'en dernier recours.
- **Reprise** : CarWebSurface recrée la page à chaque changement de taille (obligatoire : une `Presentation` se ferme si son écran
  virtuel change de taille). car.js mémorise donc en continu mode, étape, destination, station choisie et guidage (arrêts restants)
  dans `localStorage['fuelmap-carsession']` ; au démarrage, un écran de moins de 10 min est repris et le guidage relancé sans annonce.
- Étape ouverte pendant un guidage : bulles et carte flottante à droite des cartes de l'hôte (`left: --stable-l`), flèche à leur droite.
État et journalisation : `__fuelmapCar.state()/dump()`. Plein : question « tu viens de faire le plein ? » (fillup.js) à gauche.

## Téléphone

En-tête (disposition étroite) sur deux lignes : logo « FuelMap » + version, puis les 6 carburants sur toute la largeur (libellés courts
E10 / GPL via `FUELS[].short`). La voiture choisie est écrite dans l'onglet Véhicules (en bas à droite) ; plus de bouton véhicule en haut.
Barre sous l'en-tête : les prix d'abord — ▼ min, moy. (zone affichée), ▲ max, 🇫🇷 moyenne France (`franceAvg`) — puis Enseignes,
Pénurie ; sur téléphone elle passe à la ligne (jamais rien de caché sur le côté). Moins cher : cadre vert fluo animé bordé de noir
AUTOUR de la pastille (plus cher : cadre rouge fixe), le prix reste lisible. Bouton rond 🔄 = actualiser les prix (`refreshPrices`).
Carburants aux couleurs usuelles des pistolets (aucune norme) : Gazole jaune, SP95 vert, E10 vert clair, SP98 vert foncé, E85 bleu,
GPL rouge-orangé (`FUELS[].color/ink`).
Mode voiture du téléphone : le bandeau (`#hud`) reste au-dessus de la barre d'onglets, zoom / licence / boutons au-dessus du bandeau
(`--hud-h`, `--top-h` publiés par ResizeObserver). « Ma position » centre la carte et, en mode voiture, la suit (plus de bouton flèche).

## Agenda (destination sans rien écrire)

`agenda/Agenda.java` lit les rendez-vous des 7 prochains jours qui ont un lieu (permission READ_CALENDAR, demandée au premier usage) :
téléphone via le plugin Capacitor `Agenda.list()` (puce « 📅 Agenda » de l'onglet Trajet), voiture via `AndroidAuto.agenda()`
(synchrone) / `askAgenda()` (invite sur le téléphone). Le lieu touché est géocodé par `__fuelmapAPI.findPlace` (texte entier, puis
en retirant les morceaux du début : « Cabinet X, 10 rue Y, Tours » → l'adresse). Play Console : déclarer l'accès à l'agenda dans
la section « Sécurité des données » (lu sur l'appareil, seul le lieu choisi part au géocodeur ; privacy.html le dit).

## Fiabilité (1.6.2)

- Itinéraires : `OSRM_SERVERS` = démo OSRM puis FOSSGIS (routing.openstreetmap.de) en secours (12 s max chacun). Fond de carte :
  tuiles OSM (CARTO exige désormais une clé : « API KEY REQUIRED »). Solution durable = MapLibre + OpenFreeMap (piste 1b).
- Noms des villes : dessinés par l'appli (`drawTowns`) à partir des stations (ville + position moyenne), après les pastilles et sans
  jamais les recouvrir ; plus gros en voiture. Commune actuelle en voiture (`#carTown`) par géocodage inverse (~600 m).
- Réglages partagés téléphone ↔ voiture (`SHARED`) relus à chaque modification de l'autre écran (`storage`) et au retour au premier plan.
- Publication : `privacy.html` et `version-min.json` étaient ABSENTS du site (404 : politique de confidentialité du Play et mise à jour
  obligatoire cassées) → ajoutés au workflow. Dernière étape du workflow : échec (→ e-mail GitHub) si les prix français ont plus d'un
  jour ou le fichier plus de 12 h. Dans l'appli : pastille « ⚠️ prix d'il y a N j » (`staleDays`).
- Tunnels : GPS muet > 4 s en roulant → position estimée sur l'itinéraire (vitesse connue, 2 min max), annonce « GPS perdu. N'oubliez
  pas : … » ; recalcul seulement après 3 positions hors route et jamais sur position imprécise (> 80 m) ou estimée.
- Instructions : numéro de sortie et directions des panneaux (`exits` / `destinations` d'OSRM) dans le texte et la voix.
- Fiche station (voiture) : historique 30 jours en SVG — station (couleur du texte), moyenne à 10 km (rouge pointillé), × = prix déclarés.
- Cadres moins cher / plus cher : seulement autour d'une vraie pastille (zoom ≥ 10,5, pastille effectivement placée) ; redressés en guidage.
- Favorites (voiture) : une ligne par station (nom, prix, âge) ; repliables.
- Guidage : la colonne reste visible, en colonne flottante à droite des cartes de l'hôte (`--navleft`).
- Fiche station (voiture) : prix + « (SP98 x,xxx) » à droite si la voiture l'accepte ; « Plein N L ≈ … € · compléter M L ≈ … € » d'après
  le niveau Trajet › Réservoir (`state.startE`) ; ligne 💡 SP98 (« à ce prix, tu peux prendre du 98 » si écart ≤ 3 cts).
- Carnet (fillup.js) : le carburant reste modifiable sur l'écran du montant (montant conservé, litres recalculés) ; station sans prix
  connu → tous les carburants proposés, litres inconnus. Chaque plein garde date/heure, station (nom, adresse, position), carburant, prix, montant, litres, véhicule.
- Pendant un trajet guidé, la fiche station propose « ⛽ Remplacer l'arrêt X » (ou « Ajouter cet arrêt ») : la destination est gardée.
- À moins de 15 km d'un arrêt carburant : prix relus toutes les 5 min (`refreshQuiet`) ; rupture → alerte écran + voix ; prix changé → annoncé.
- En haut à gauche (carte au repos) : commune, taille de la vue « ↔ 25 km · ↕ 15 km », puis les favorites dessous (position calculée
  sous la commune, jamais à droite : Denis ne veut pas qu'elles bougent avec les boutons de l'hôte).
- Trafic / travaux : rien aujourd'hui. Travaux, fermetures, accidents = données ouvertes Bison Futé (DATEX II) récupérables par la
  GitHub Action (chantier séparé) ; trafic temps réel = services payants (TomTom, HERE), pas de source gratuite.
- Péages (à faire, chantier séparé) : grilles PDF des sociétés d'autoroute → script `tools/` → tableau entrée/sortie/prix + gares OSM.
  Les tarifs varient par tronçon (ex. A14 La Défense → A13 Rouen) : une estimation au km ne suffit pas.

## Couleur de la voiture (curseur)

Fiche véhicule (téléphone) : champ « Couleur ». Trois sources : table de teintes d'usine approchées (`js/paints.js`, ~140 entrées,
recherche tolérante FR/EN), **photo de sa voiture** (rien ne sort du téléphone), ou **photos du modèle sur Wikimedia Commons**
(API gratuite sans clé, images lisibles au pixel ; « mx5 » → « mx-5 », élargissement si trop peu de résultats). Sur la photo :
couleur dominante proposée (bas-centre de la photo, pixels presque noirs/blancs écartés sauf s'ils dominent), un toucher sur la
carrosserie l'ajuste. « 🔎 Trouver ma couleur » (ou Entrée) répond directement : sous chaque photo, sa couleur analysée et le nom
de la teinte tiré du titre Commons (« Vert Polo », « Gris Boréal »), et en tête une « couleur retenue » = moyenne du plus grand
groupe de photos concordantes (≥ 2 sur les 8 premières), sinon rien n'est affirmé. Aucune base ouverte de teintes OEM avec
hexadécimal n'existe (nuanciers des vendeurs de retouche = commerciaux, sans API). La table n'est PAS exhaustive (teintes récentes) : pour une
voiture ancienne, la photo est la bonne voie. Teintes très foncées (Vert Polo) : l'analyse auto reste approximative. Stockée dans `car.color` / `car.paint`, appliquée
via `--car` au point de position et à la flèche du guidage. Google Images écarté : clé payante exposée sans serveur, API fermée aux
nouveaux comptes, et les sites tiers interdisent la lecture des pixels.

## Play Store

Compte développeur vérifié, appli `fr.soaresden.fuelmap`, tests internes actifs (famille via lien). AAB signé avec la clé
d'upload (Play App Signing). Risque connu pour la production : la catégorie NAVIGATION est examinée de près par Google.
Le README décrit la publication.

## Pistes en attente (par priorité ressentie)

1. Valider la 1.6.1 dans la voiture (et l'écran partagé avec le lecteur) : nouvel écran par étapes, colonne en haut, guidage plein écran, favorites, pincer, toucher, verrou 3 s, guidage multi-arrêts ; et toujours fiche de
   manœuvre acceptée par l'hôte, voix dans les enceintes, vue tournée fluide (sinon alléger la nappe de couleur).
1b. Piste technique proposée : passer la carte de Leaflet à **MapLibre GL** (WebGL, tuiles vectorielles OpenFreeMap gratuites) : rotation et
   inclinaison natives pour le guidage (au lieu du carré CSS tourné), zoom continu, rendu net. Gros chantier (toute la carte de app.js) :
   à faire à part, après validation de la 1.6.1.
1c. Choix de la voix du guidage : les voix de Waze / Google Maps sont inaccessibles (données privées de ces applis, sous licence) ;
   possible en revanche : proposer les voix françaises du moteur de synthèse du téléphone (`TextToSpeech.getVoices()` dans CarVoice).
1d. FAIT en 1.6.3 (à valider sur le téléphone / dans la voiture) : carnet dans 🚗 Ma voiture (3 derniers pleins, « ➕ J'ai fait le plein » =
   station la plus proche < 2 km) ; dossier de sauvegarde (Véhicules › 💾 : « FuelMap-sauvegarde.json », remis à jour 4 s après chaque
   changement et quand l'appli passe en arrière-plan ; restaurer depuis le dossier ou un fichier ; « J'ai déjà FuelMap : restaurer » à
   l'accueil ; navigateur = exporter / importer) ; bloc-notes (`state.notes`, bouton 📝 de l'hôte, liste dans Véhicules ; 5 styles : défaut `state.noteStyle`, ou par note `note.style`
   via 🎨 (post-it : couleur au choix, `note.color`) ; simple, bloc-notes ligné, post-it, cahier 24×32 Seyès, petits carreaux ; traits en filigrane, texte posé sur les lignes grâce
   à `--bl` mesuré dans chaque note, car le pied des lettres dépend de la police du téléphone) :
   à la voix toujours ; au clavier SEULEMENT à l'arrêt dans la voiture (règles Android Auto : pas de saisie en roulant, risque de refus
   au Store) — en roulant « Gare-toi pour écrire, ou dicte » ; sans limite sur le téléphone.
   Découpage futur gratuit / Plus : voir `.plus-archive/NOTES.md` (trajet optimisé et mode voiture du téléphone restent gratuits).
1e. Taille de vue « ↔ x km · ↕ y km » sous la commune : doit TOUJOURS être celle de l'écran visible, guidage compris. Aujourd'hui elle
   reste figée sur la valeur d'avant le guidage (192 km au lieu de quelques centaines de mètres). En guidage la carte est un carré
   tourné plus grand que l'écran : calculer depuis la zone visible (pas `map.getBounds()`), et rafraîchir en roulant.
2. Remontée utilisateur (« cette station est fermée / plus d'essence ») : nécessite un petit backend (Cloudflare Worker proposé), en attente du compte.
3. Carnet de pleins : export CSV, rappel kilométrage ; puis découpage gratuit / Plus (voir `.plus-archive`).
4. Statistiques de conduite (conso réelle déjà calculée entre deux relevés de compteur).
5. Historique GitHub : les commits d'avant la 1.2 mentionnant « Plus » existent encore sur le dépôt distant ; re-squash possible si Denis le souhaite.
