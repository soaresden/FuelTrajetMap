/*
 * Mise à jour obligatoire (appli Android) : version-min.json sur le site ({ "android": versionCode minimal }).
 * En dessous, écran bloquant vers le Play Store. Sans effet sur le site web.
 */
(function () {
  'use strict';
  var C = window.Capacitor;
  if (!(C && C.getPlatform && C.getPlatform() === 'android' && C.Plugins && C.Plugins.App)) return;
  var PACKAGE = 'fr.soaresden.fuelmap', base = (window.FUELMAP_CONFIG || {}).dataBase; if (!base) return;
  Promise.all([C.Plugins.App.getInfo(), fetch(base + 'version-min.json', { cache: 'no-store' }).then(function (r) { return r.json(); })]).then(function (r) {
    var build = +r[0].build, min = +(r[1] && r[1].android);
    if (!(min && build && build < min)) return;
    var el = document.getElementById('update'); if (!el) return;
    el.hidden = false;
    document.getElementById('updateText').textContent = 'Ta version (' + r[0].version + ') n\'est plus prise en charge : les données ou les calculs ont changé. Installe la mise à jour pour continuer.';
    document.getElementById('updateBtn').onclick = function () { window.open('market://details?id=' + PACKAGE, '_system'); };
  }).catch(function () { });
})();
