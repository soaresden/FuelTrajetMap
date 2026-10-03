/* Réglages de déploiement.
 * dataBase : URL (avec / final) du site publié qui sert data/<pays>.json tenu à jour par la GitHub Action,
 * par ex. 'https://soaresden.github.io/fuelmap/'. Utile surtout dans l'APK, dont les fichiers embarqués vieillissent.
 * Vide = fichiers locaux, puis API officielles en direct (Espagne, Portugal, Andorre). */
window.FUELMAP_CONFIG = { dataBase: 'https://soaresden.github.io/FuelTrajetMap/', version: '1.5.8' }; // version : même numéro que versionName dans apk/android/app/build.gradle
