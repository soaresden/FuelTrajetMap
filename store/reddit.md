# Faire connaître FuelMap sur Reddit

Brouillons prêts à copier-coller. Chiffres relevés le 1er novembre 2026 dans `data/fr.json` (prix publiés par l'État, mis à jour
depuis moins de 3 jours) : à refaire le jour du post (voir « Recalculer les chiffres » en bas).

## Avant de poster

- **Le bon ordre** : la version Android n'est pas encore publique (tests internes). Google exige un **test fermé de 14 jours avec
  au moins 12 testeurs** avant la production. Reddit sert donc d'abord à trouver ces 12 testeurs (post n° 2), et à faire essayer la
  version web, utilisable tout de suite par tout le monde, iPhone compris (post n° 1).
- **Test fermé ouvert à tous** : Play Console › Tests › Test fermé › Testeurs › **Groupe Google** (ex. `fuelmap-testeurs@googlegroups.com`,
  inscription libre). Les gens rejoignent le groupe, puis ouvrent le lien d'inscription au test. Pas besoin de récupérer leurs e-mails.
- **Lire les règles de chaque subreddit** avant de poster (encart à droite / « À propos ») : beaucoup interdisent la pub, ou la limitent
  à un fil dédié ou à un jour de la semaine. Si c'est interdit, on ne poste pas : un post supprimé ou un bannissement coûte plus cher.
- **Toujours dire qu'on est le développeur.** Pas de faux compte « j'ai trouvé une super appli », pas d'avis arrangés : Reddit le
  repère vite et ça tue l'appli.
- **Un subreddit à la fois**, quelques jours d'écart. Le même texte posté partout le même jour est pris pour du spam (filtre automatique).
- **Compte** : un compte tout neuf sans « karma » est souvent bloqué par les filtres. Utilise ton compte habituel, ou participe un peu
  avant (commentaires utiles) pendant quelques jours.
- **Images** : un post avec 3 ou 4 captures attire bien plus qu'un texte seul. Dans `store/captures/` : `tel-1-carte.jpg`,
  `tel-3-trajet-arrets.jpg`, `voiture-1-carte.jpg`, `voiture-4-arrets.jpg`.
- **Être là après** : répondre aux commentaires pendant les 2-3 premières heures (c'est ce qui fait monter le post), le soir en semaine
  ou le dimanche.
- **Annoncer le payant franchement** : Reddit déteste découvrir un abonnement après coup. Le gratuit fait déjà l'essentiel, c'est
  un bon argument : le dire tout de suite.

## Où poster

| Subreddit | Langue | Pour quoi | Post |
|---|---|---|---|
| r/france | FR | le grand public, l'essence moins chère | n° 1 (vérifier les règles sur l'auto-promotion) |
| r/vosfinances | FR | économies au quotidien | n° 1, en insistant sur les chiffres (règles strictes : vérifier) |
| r/AndroidClosedTesting, r/TestersCommunity | EN | trouver les 12 testeurs du test fermé | n° 2 |
| r/AndroidAuto | EN | l'écran voiture maison | n° 3 (France, Espagne, Portugal, Italie seulement : le dire) |
| r/SideProject, r/androidapps | EN | projet perso, retours de développeurs | n° 3 adapté |

---

## Post n° 1 — grand public (r/france, r/vosfinances)

**Titre** (au choix) :
- J'ai fait une appli gratuite qui trouve l'essence la moins chère sur ton trajet (et te dit où t'arrêter)
- 20 à 35 centimes d'écart par litre dans la même ville : j'ai fait une carte pour ne plus payer le prix fort

**Texte** :

```
Salut à tous,

Je développe seul, sur mon temps libre, FuelMap : une carte des prix des carburants, avec un calcul des
arrêts les moins chers sur un trajet.

Pourquoi : ce matin (1er novembre), dans une même ville, l'écart entre la station la moins chère et la plus
chère allait de 20 à 35 centimes par litre (Tours, Nantes, Lyon, Toulouse, Lille). Sur un plein de 50 L,
ça fait 10 à 17 € de différence.

Ce que ça fait :
• Carte de toutes les stations avec le prix de ton carburant écrit dessus, les moins chères entourées en vert
• Trajet optimisé : tu donnes ton départ, ton arrivée et le niveau de ton réservoir, l'appli te dit où
  t'arrêter et combien mettre pour payer le moins possible sur tout le trajet
• Autour de moi / pénurie : les stations proches qui ont VRAIMENT du carburant (prix récents)
• Historique des prix de chaque station (France)
• Carnet de pleins, notes, et une alerte « il y a de l'essence » en cas de pénurie
• France, et aussi Espagne, Portugal, Andorre, Italie (pratique pour les vacances)

Les prix viennent des données officielles de l'État (prix-carburants.gouv.fr), comme dans les autres applis.

Côté vie privée : pas de compte, pas de pub, pas de serveur à moi. Tes véhicules, ton carnet et tes notes
restent sur ton téléphone (sauvegarde dans un dossier que tu choisis).

Ça marche tout de suite dans le navigateur, iPhone compris :
https://soaresden.github.io/FuelTrajetMap/

L'appli Android arrive sur le Play Store. Il me manque des testeurs pour la sortie publique : si ça te tente,
le lien du test est ici : [LIEN DU TEST FERMÉ]

Tout le gratuit reste gratuit (carte, trajet optimisé, autour de moi, carnet…). Il y a un abonnement
optionnel, FuelMap Plus (2,99 €/mois, 7 jours d'essai), pour l'écran Android Auto dans la voiture et
quelques options en plus : c'est ce qui me permet de continuer.

Tous les retours sont bienvenus, surtout les critiques : c'est fait pour être utilisé.
```

---

## Post n° 2 — recrutement des testeurs (r/AndroidClosedTesting, r/TestersCommunity)

**Titre** : [Closed testing] FuelMap – fuel price map & cheapest stops on your route (France, Spain, Portugal, Italy) – need 12 testers

**Texte** :

```
Hi! I'm the solo developer of FuelMap, a fuel price map with a route optimizer: it tells you where to
stop and how much to fill up to pay the least on a whole trip. It uses official government price data
(France, Spain, Portugal, Andorra, Italy).

Google requires 12 testers for 14 days before I can publish it. If you can help:
1. Join the group: [LIEN DU GROUPE GOOGLE]
2. Join the test: [LIEN DU TEST FERMÉ]
3. Install it and keep it for 14 days (opening it now and then is enough)

No account, no ads, no tracking. Happy to test your app in return: drop your link in the comments.
Feedback welcome (the app is in French, English is on my list).
```

> Dans ces subreddits, l'usage est l'échange : tester l'appli de ceux qui testent la tienne. Prévoir un peu de temps pour ça.

---

## Post n° 3 — Android Auto (r/AndroidAuto)

**Titre** : I built my own Android Auto navigation screen for a fuel price app (cheapest stops on your route, speed limits, live map)

**Texte** :

```
Solo dev here. FuelMap shows fuel prices on a map and plans the cheapest refuelling stops on a trip.
I wanted it in the car, so I built a full Android Auto screen:

• Full-screen map with prices, 2D/3D view, north-up or heading-up
• Turn-by-turn guidance through the fuel stops, with voice and the maneuver card in the car's own UI
• Your speed and the road's speed limit (OpenStreetMap)
• Station details, price history, "shortage" mode to find stations that still have fuel
• Works in split screen next to your music

Countries: France, Spain, Portugal, Andorra, Italy (official price data). The app is in French for now.

The phone app is free; the Android Auto screen is part of an optional subscription (7-day free trial).
It's in closed testing before release: [LIEN DU TEST FERMÉ]

Questions about building a NAVIGATION-category car app with a custom map surface are welcome,
it was quite a journey (VirtualDisplay + WebView, host insets, gestures without coordinates…).
```

> Le dernier paragraphe attire les développeurs du sub : bien pour les commentaires, et donc pour la visibilité.

---

## Réponses prêtes aux questions qui reviendront

- **« Encore une appli de prix, il y en a déjà plein »** : la plupart montrent les prix autour de toi. FuelMap calcule où s'arrêter
  sur un trajet entier et combien mettre à chaque arrêt, en tenant compte du réservoir et de la consommation.
- **« Pourquoi un abonnement ? »** : la carte, le trajet optimisé, le mode voiture du téléphone et le carnet sont gratuits, sans pub.
  L'abonnement couvre l'écran Android Auto, le plus long à faire, et finance le temps passé.
- **« Les prix sont-ils fiables ? »** : ce sont ceux que les stations déclarent à l'État. L'appli affiche l'âge de chaque prix, et le
  mode Pénurie écarte les prix trop vieux.
- **« Et mes données ? »** : pas de compte, pas de pub, aucun serveur à moi. La position sert sur le téléphone et n'est envoyée,
  sans identifiant, qu'aux services de carte, d'adresses et d'itinéraires au moment où ils servent (politique de confidentialité :
  https://soaresden.github.io/FuelTrajetMap/privacy.html).
- **« iPhone ? »** : pas d'appli iPhone, mais la version web marche dans Safari. Bouton Partager › « Sur l'écran d'accueil » pour
  l'avoir comme une appli.
- **« Les radars ? »** : l'appli signale des zones de radar, jamais l'emplacement exact (interdit en France depuis 2012), comme Waze.

## À ne pas faire

- Écrire « la moins chère du marché » ou promettre une économie précise : l'écart dépend des jours et des villes. Donner des
  exemples datés, comme ci-dessus.
- Citer Waze ou Google Maps comme « en mieux » : on reste factuel.
- Mettre un lien de parrainage ou un code promo dans le premier post.

## Recalculer les chiffres le jour du post

```
curl -s https://soaresden.github.io/FuelTrajetMap/data/fr.json -o fr.json
node -e "const j=require('./fr.json'),t=Math.floor(Date.now()/864e5);for(const c of ['TOURS','NANTES','LYON','TOULOUSE','LILLE']){const v=j.list.filter(s=>(s.ville||'').toUpperCase()===c&&s.p[0]>0&&s.m[0]>=t-3).map(s=>s.p[0]);console.log(c,'gazole',Math.min(...v),'→',Math.max(...v),'écart',Math.round((Math.max(...v)-Math.min(...v))*100),'cts')}"
```
