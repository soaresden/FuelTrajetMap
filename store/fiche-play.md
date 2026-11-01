# Fiche Play Store — FuelMap (`fr.soaresden.fuelmap`)

Tout ce qu'il faut copier-coller dans la Play Console, rubrique par rubrique. Les images se fabriquent avec
`node tests/captures-store.mjs` (voir en bas).

---

## 1. Présence sur le Play Store › Fiche principale

**Nom de l'application** (30 caractères max) — 29 :

```
FuelMap – prix des carburants
```

**Brève description** (80 max) — 77 :

```
Prix des carburants en direct, arrêts optimisés sur ton trajet, Android Auto.
```

**Description complète** (4 000 max) — environ 3 050 :

```
FuelMap affiche les prix des carburants de toutes les stations autour de toi et calcule où t'arrêter sur un trajet pour payer le moins cher, selon ta voiture. Sans compte, sans publicité.

⛽ LA CARTE DES PRIX
• Prix de toutes les stations de France, et aussi d'Espagne, du Portugal, d'Andorre et d'Italie
• Carte de chaleur : vert = pas cher, rouge = cher, prix écrits sur la carte
• Prix minimum, moyen et maximum de la zone affichée, et moyenne nationale
• Gazole, SP95, SP95-E10, SP98, E85 et GPL, avec les carburants compatibles avec ta voiture
• Stations en rupture barrées, horaires d'ouverture, enseignes, historique des prix
• Indice de confiance « il y a du carburant ? » d'après l'heure du dernier prix déclaré : pratique en période de pénurie

🧭 LE TRAJET OPTIMISÉ
Indique ton niveau de carburant, ton départ et ton arrivée : FuelMap choisit les arrêts et le nombre de litres à mettre à chaque arrêt pour que le trajet te coûte le moins cher, en tenant compte du détour et d'une réserve de sécurité. Tu peux changer ou retirer un arrêt : le coût est recalculé.

📍 AUTOUR DE MOI
Les stations classées par coût réel du plein (prix du carburant + trajet aller-retour), par note ou par fiabilité du prix, autour de ta position, d'une adresse ou de tes lieux (maison, travail…).

🚗 DANS LA VOITURE (ANDROID AUTO)
• La carte des prix en plein écran sur l'écran de la voiture
• Guidage vocal vers la station ou sur tout un trajet avec plusieurs arrêts carburant
• Destination en un toucher : maison, travail, lieux enregistrés, rendez-vous de l'agenda
• Prix revérifiés à l'approche d'un arrêt
• Écran pensé pour la conduite : peu d'éléments, grands boutons, blocage temporaire si l'on touche trop l'écran en roulant

📒 CARNET ET BLOC-NOTES
• Carnet de pleins : montant, litres, station, date ; consommation réelle entre deux relevés
• Bloc-notes : une note dictée dans la voiture (appel, adresse, rappel), relue sur le téléphone

🎨 À TON GOÛT
12 thèmes clairs et foncés, et la couleur de ta voiture pour le curseur de position.

🔒 TES DONNÉES RESTENT CHEZ TOI
Pas de compte, pas de publicité, pas de pisteur. Tes véhicules, pleins, notes et lieux restent sur ton téléphone. Tu choisis toi-même un dossier de sauvegarde : rien n'est envoyé chez Google ni chez nous.

ℹ️ SOURCES ET INDÉPENDANCE
FuelMap est une application indépendante. Elle n'est liée à aucun gouvernement, ministère ou organisme public et ne les représente pas. Les prix viennent des données ouvertes publiées par les stations auprès des administrations :
• France : prix-carburants.gouv.fr — https://www.prix-carburants.gouv.fr/ (données sur data.economie.gouv.fr, licence ouverte Etalab)
• Espagne : Ministerio para la Transición Ecológica — https://geoportalgasolineras.es/
• Portugal : DGEG — https://precoscombustiveis.dgeg.gov.pt/
• Andorre : Govern d'Andorra
• Italie : MIMIT — https://www.mimit.gov.it/ (licence IODL 2.0)
Les prix sont déclarés par les gérants : un écart avec la pompe reste possible. Itinéraires : OSRM et OpenStreetMap. Adresses : Géoplateforme IGN et Photon.
```

**Graphiques**

| Élément | Fichier (après `node tests/captures-store.mjs`) | Exigence du Play |
|---|---|---|
| Icône de l'application | `icons/icon-512.png` (déjà prêt) | PNG 512×512, 1 Mo max |
| Image de présentation | `store/captures/banniere-1024x500.jpg` | 1024×500, JPEG ou PNG sans transparence |
| Captures téléphone (2 à 8) | `store/captures/tel-*.jpg` (5) + `voiture-*.jpg` (6) | côtés 320 à 3 840 px, grand côté < 2 × petit |

Pas d'emplacement Android Auto dans la Console (seulement Android Automotive) : tout passe par les **8 captures téléphone**,
portrait et paysage mélangés. Ordre retenu : 1 `tel-1-carte`, 2 `voiture-1-carte`, 3 `tel-2-trajet-carte`, 4 `voiture-4-arrets`,
5 `voiture-5-guidage`, 6 `voiture-2-station`, 7 `tel-4-proximite`, 8 `tel-5-notes`. Pas de captures voiture dans les emplacements
« tablette » (Google y attend l'appli sur tablette).

**Coordonnées** : e-mail de contact (obligatoire, visible publiquement), site web `https://soaresden.github.io/FuelTrajetMap/`.

---

## 2. Paramètres de la fiche

- **Catégorie** : Application › **Cartes et navigation**
- **Tags** (5 max, choisis dans la liste de la Console) : Cartes et navigation, Auto et véhicules, Voyages et infos locales,
  Entretien de véhicules. Éviter « Finances personnelles » (range l'appli avec les banques) et les tags secondaires.
- Mail, site, politique de confidentialité : voir ci-dessus et § 3.

---

## 3. Règles › Contenu de l'application

**Règles de confidentialité** : `https://soaresden.github.io/FuelTrajetMap/privacy.html`

**Accès à l'application** : « Toutes les fonctionnalités sont disponibles sans accès particulier » (pas de compte).

**Annonces** : Non, l'application ne contient pas d'annonces.

**Classification du contenu** (questionnaire IARC) : catégorie « Toutes les autres applications » ; violence, sexualité,
langage, substances, jeux d'argent : Non partout. « Les utilisateurs peuvent-ils interagir ou échanger du contenu ? » : Non.
« Contenu en ligne » : Oui (prix, fond de carte, photos Wikimedia de « Trouver ma couleur »). « L'application partage-t-elle la
position de l'utilisateur avec d'autres utilisateurs ? » : Non. **Achats d'articles numériques : OUI depuis la 1.7.1** (abonnement FuelMap Plus ;
« Achats in-app » apparaît alors dans la classification, c'est normal). → résultat attendu : PEGI 3 / Tout public, sans élément interactif.

**Public cible** : 16-17 ans et 18 ans et plus (conduite accompagnée, permis B dès 17 ans). Pas de moins de 13 ans : les
règles « Familles » ne s'appliquent pas. « L'application pourrait-elle attirer involontairement des enfants ? » : Non.

**Applications d'actualités** : Non. **Applications de santé** : Non. **Services financiers** : Non.
**Application gouvernementale** : Non (application indépendante ; la description le dit et cite les sources).

### Sécurité des données

Réponses générales :
- Votre application collecte-t-elle ou partage-t-elle des types de données requis ? → **Oui** (la position et les adresses
  partent vers les services d'itinéraire et d'adresses quand l'utilisateur le demande).
- Toutes les données sont-elles chiffrées en transit ? → **Oui** (HTTPS partout).
- Comptes : « Mon appli ne permet pas aux utilisateurs de créer un compte » ; connexion avec des comptes créés ailleurs : **Non**.
- Suppression des données : **Oui** — tout est sur le téléphone (désinstaller efface tout) ; un journal de diagnostic envoyé est
  supprimé sur demande par e-mail. Lien si demandé : `https://soaresden.github.io/FuelTrajetMap/privacy.html#suppression`

Types de données à cocher :

| Type | Collecté | Partagé | Éphémère | Obligatoire ? | Finalité |
|---|---|---|---|---|---|
| Position › **Position exacte** | Oui | Non | **Oui** | Facultatif (on peut taper une adresse) | Fonctionnalités de l'appli |
| Position › **Position approximative** (si l'utilisateur choisit « approximative » dans la demande d'Android) | Oui | Non | **Oui** | Facultatif | Fonctionnalités de l'appli |
| Infos personnelles › **Adresse** (adresses tapées, lieux, lieu d'un rendez-vous choisi) | Oui | Non | **Oui** | Facultatif | Fonctionnalités de l'appli |
| Infos et performances de l'appli › **Journaux de plantage** et **Diagnostics** | Oui | Non | Non | Facultatif (seulement si l'utilisateur appuie sur « Envoyer le journal ») | Analyse |

Pourquoi « non partagé » : l'envoi vers les services d'itinéraire / d'adresses (OSRM, IGN, Photon) se fait parce que
l'utilisateur demande un trajet ou cherche une adresse — c'est l'exception « action de l'utilisateur » des règles Google.

Ne pas cocher : agenda (lu sur le téléphone, seul le lieu choisi part, déjà couvert par « Adresse »), fichiers (la
sauvegarde reste dans le dossier choisi), photos (l'analyse de couleur se fait sur le téléphone), identifiants, contacts,
activité, finances, santé, messages.

### Autorisations sensibles

Aucune déclaration spéciale : pas de position en arrière-plan, pas de SMS / journal d'appels, pas de service au premier
plan. Localisation (au premier plan), notifications et agenda (lecture) sont des autorisations courantes.

---

## 4. Android Auto

Configuration avancée › **Facteurs de forme** › Ajouter › **Android Auto** (accepter les conditions). Il faut une version
contenant l'écran voiture sur un canal de test — c'est le cas. Google examine alors l'appli selon ses règles de qualité
pour les voitures avant la sortie publique (catégorie **navigation**, la plus surveillée) :
- guidage étape par étape avec fiche de manœuvre et temps restant : ✔ (FuelMap a son propre guidage) ;
- pas de clavier en roulant : ✔ (saisie de l'hôte : voix en roulant, clavier à l'arrêt) ;
- pas de vidéo ni de texte long en roulant : ✔ (notes masquées en roulant) ;
- verrouillage si trop de touchers : ✔.
Si la revue refuse la catégorie navigation, repli possible en « points d'intérêt » (carte d'infos de l'hôte par-dessus).

---

## 5. Version (Tests → Test interne, puis Production)

AAB : `apk/FuelMap-1.7.6.aab` (versionCode 64). **Nom de la version** : `1.7.6`

**Notes de version** (500 max) :

```
<fr-FR>
• Voiture : ta vitesse et la limitation de la route (rouge si tu dépasses)
• Zones de radar : bandeau, voix, zone clignotante rouge / bleu
• Thème auto : aussi sous les tunnels
• Guidage : colonne pleine hauteur, vitesse au-dessus de 2D / 3D
• Carte qui suit ta voiture, nord en haut ou sens de la marche
• FuelMap Plus, 7 jours d'essai : l'écran de la voiture, curseurs, carnet
• Bêta-testeurs : saisis ton code dans FuelMap Plus › « J'ai un code »
</fr-FR>
```

**Sortie en production** (compte personnel créé après nov. 2023) : test fermé d'au moins **14 jours avec 12 testeurs**
inscrits, puis demande d'accès à la production.

---

## Fabriquer les images (sur le PC)

```
cd tests
npm install
cd ..
node tests/captures-store.mjs
```

Edge s'ouvre en arrière-plan, charge l'appli avec une voiture fictive (« Ma 208 », Tours → Nantes) et range les images dans
`store/captures/` : 5 captures téléphone en 1080×1920, 6 captures voiture en 1920×1080, et la bannière 1024×500
(`store/banniere.html`). Il faut Internet (prix et itinéraires) ; compter une à deux minutes.

---

## Le jour où FuelMap Plus est en vente (interrupteur `plus: true`)

Ce qui est déjà dans l'appli depuis la 1.7.0, mais éteint : voiles + cadenas, badge « Plus » / « Trial », écran d'abonnement,
panneau « Fonctionnalité Plus » dans la voiture. Avant d'allumer :

1. **Console › Paramètres › Profil de paiement** : créer le profil marchand (vérification par Google, quelques jours).
2. **Monétiser › Produits › Abonnements** : ID `fuelmap_plus` (doit être exactement celui-là), deux forfaits de base
   (mensuel, annuel), chacun avec une **offre d'essai gratuit de 7 jours** (« nouveaux clients »).
3. **Paramètres › Test des licences** : ajouter les comptes Gmail des testeurs (achats de test gratuits).
4. **Promotions › Codes promo** : codes pour les bêta-testeurs (ils les saisissent via « 🎟️ J'ai un code » dans l'appli → Play Store).
5. `js/config.js` : `plus: true`, nouvelle version (code +1), AAB.
6. Fiche : **Classification du contenu › Achats d'articles numériques : Oui** ; la description peut alors mentionner « FuelMap Plus
   (abonnement avec essai gratuit de 7 jours) : écran de la voiture, curseurs, analyse du carnet » ; la mention « gratuit » reste
   vraie pour l'installation. La politique de confidentialité a déjà son paragraphe « Abonnement ».
7. Sécurité des données : rien à ajouter pour le paiement (géré par Google Play, l'appli ne voit pas les moyens de paiement).
