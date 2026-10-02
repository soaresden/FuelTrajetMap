/* Réglages de déploiement.
 * dataBase : URL (avec / final) du site publié qui sert data/<pays>.json tenu à jour par la GitHub Action,
 * par ex. 'https://soaresden.github.io/fuelmap/'. Utile surtout dans l'APK, dont les fichiers embarqués vieillissent.
 * Vide = fichiers locaux, puis API officielles en direct (Espagne, Portugal, Andorre). */
window.FUELMAP_CONFIG = {
  dataBase: 'https://soaresden.github.io/FuelTrajetMap/',
  plus: false // true = abonnement FuelMap Plus actif dans l'appli Android (trajet, mode voiture, Android Auto, alerte) ; false = tout ouvert
};
