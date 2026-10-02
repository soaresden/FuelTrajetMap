/*
 * FuelMap Plus — abonnement Google Play dans l'appli Android (7 jours d'essai, puis 0,50 €/mois ou 4,99 €/an),
 * et mise à jour obligatoire. Sans effet sur le site web : la page ne fait rien hors de l'appli Capacitor.
 *
 * Abonnement : produit Google Play « fuelmap_plus » (deux forfaits de base : « mensuel » et « annuel », chacun avec une
 * offre d'essai gratuit de 7 jours ; c'est Google qui tient le compte, un essai par compte Google, quel que soit le
 * nombre de réinstallations). Vérifié à chaque lancement via cordova-plugin-purchase (Billing Library 9) ; l'état est
 * écrit dans les Preferences (clé « license ») pour Android Auto, qui tourne dans un autre processus.
 * Mise à jour : version-min.json sur le site ({ "android": versionCode minimal }) → écran bloquant vers le Play Store.
 */
(function () {
  'use strict';
  var C = window.Capacitor;
  var isApp = !!(C && C.getPlatform && C.getPlatform() === 'android');
  if (!isApp) return;
  var PLUS_ON = !!((window.FUELMAP_CONFIG || {}).plus); // abonnement désactivé pour l'instant (js/config.js) : tout est ouvert, seule la mise à jour obligatoire reste
  var $ = function (id) { return document.getElementById(id); };
  var PRODUCT = 'fuelmap_plus', PACKAGE = 'fr.soaresden.fuelmap', MONTH = 32 * 86400000;
  var store = null, owned = false, offers = [];

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function saveLicense() {
    try { C.Plugins.Preferences.set({ key: 'license', value: JSON.stringify({ owned: owned, until: Date.now() + MONTH, ts: Date.now() }) }); } catch (e) { }
  }

  // ---------------------------------------------------------------- écran d'abonnement
  var pending = null, FEATURES = { route: '🧭 Le trajet optimisé (où s\'arrêter et combien mettre) fait partie de FuelMap Plus.', car: '🚗 Le mode voiture (grand affichage, suivi GPS, prochain arrêt) fait partie de FuelMap Plus.', auto: '🚘 FuelMap sur l\'écran Android Auto fait partie de FuelMap Plus.', alert: '🔔 L\'alerte « il y a de l\'essence près de moi » fait partie de FuelMap Plus.' };
  function paywall(show, feature) {
    var el = $('plus'); if (!el) return;
    el.hidden = !show;
    if (show) { $('plusWhy').textContent = FEATURES[feature] || ''; renderSavings(); renderOffers(); }
  }
  function renderSavings() {
    var sv = window.__fuelmapSavings && window.__fuelmapSavings(), el = $('plusSavings'); if (!el) return;
    el.hidden = !(sv && sv.total > 1);
    if (sv && sv.total > 1) el.textContent = '💰 L\'optimiseur t\'a déjà fait économiser ' + sv.total.toFixed(2).replace('.', ',') + ' € sur ' + sv.n + ' trajet' + (sv.n > 1 ? 's' : '') + ' : l\'abonnement annuel est remboursé en un plein.';
  }
  // Appelé par la page quand une fonction Plus est demandée : on l'exécute si abonné, sinon écran d'abonnement, puis exécution dès l'achat.
  function require(feature, fn) { if (owned || !PLUS_ON) return fn(); pending = fn; paywall(true, feature); }
  function phaseText(ph) {
    var per = { P1W: 'semaine', P1M: 'mois', P1Y: 'an', P3M: '3 mois', P6M: '6 mois' }[ph.billingPeriod] || ph.billingPeriod;
    if (ph.paymentMode === 'FreeTrial') return ph.billingPeriod === 'P1W' ? '7 jours gratuits' : 'essai gratuit ' + per;
    return ph.price + ' / ' + per;
  }
  function renderOffers() {
    var box = $('plusOffers'); if (!box) return;
    if (!offers.length) { box.innerHTML = '<p class="hint">' + (store ? '⏳ Chargement des offres Google Play…' : 'Google Play indisponible : vérifie ta connexion et que l\'appli vient bien du Play Store.') + '</p>'; return; }
    box.innerHTML = offers.map(function (o, i) {
      var phases = (o.pricingPhases || []).map(phaseText), yearly = /annuel|year|P1Y/i.test(o.id + ' ' + (o.pricingPhases || []).map(function (p) { return p.billingPeriod; }).join(' '));
      return '<button class="' + (yearly ? 'primary' : 'secondary') + ' plus-offer" data-offer="' + i + '">' + (yearly ? '📅 Annuel' : '🗓️ Mensuel') + ' · ' + esc(phases.join(' puis ')) + (yearly ? ' <small>(moins d\'un litre par an)</small>' : '') + '</button>';
    }).join('');
  }
  var initOk = false, cached = null; // état écrit au lancement précédent : sert si Google Play ne répond pas (hors ligne)
  function refresh() {
    var p = store.get(PRODUCT, CdvPurchase.Platform.GOOGLE_PLAY);
    owned = !!(p && p.owned);
    offers = p && p.offers ? p.offers.filter(function (o) { return o.canPurchase !== false; }) : [];
    if (!initOk && !owned && cached && cached.owned && cached.until > Date.now()) { owned = true; renderOffers(); return; } // hors ligne : on garde l'accès, sans prolonger la licence
    saveLicense(); renderOffers();
    if (owned) { paywall(false); if (pending) { var fn = pending; pending = null; fn(); } }
  }
  function initStore() {
    if (!window.CdvPurchase) return;
    store = CdvPurchase.store;
    store.verbosity = CdvPurchase.LogLevel.WARNING;
    store.register([{ id: PRODUCT, type: CdvPurchase.ProductType.PAID_SUBSCRIPTION, platform: CdvPurchase.Platform.GOOGLE_PLAY }]);
    store.when()
      .productUpdated(refresh)
      .approved(function (t) { t.verify(); })
      .verified(function (r) { r.finish(); refresh(); })
      .receiptUpdated(refresh);
    store.error(function (e) { if (e && e.code !== CdvPurchase.ErrorCode.PAYMENT_CANCELLED) toastPlus('Google Play : ' + (e.message || e.code)); });
    store.initialize([CdvPurchase.Platform.GOOGLE_PLAY]).then(function (errs) { initOk = !(errs && errs.length); refresh(); });
  }
  function toastPlus(msg) { var t = $('toast'); if (!t) return; t.textContent = msg; t.hidden = false; setTimeout(function () { t.hidden = true; }, 4000); }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-offer]');
    if (b && offers[+b.getAttribute('data-offer')]) { offers[+b.getAttribute('data-offer')].order().then(function (err) { if (err && err.code !== CdvPurchase.ErrorCode.PAYMENT_CANCELLED) toastPlus('Achat impossible : ' + (err.message || err.code)); }); return; }
    if (e.target.closest('#plusRestore')) { if (store) store.restorePurchases().then(function () { refresh(); if (!owned) toastPlus('Aucun abonnement trouvé pour ce compte Google'); }); return; }
    if (e.target.closest('#plusManage')) { if (store) store.manageSubscriptions(CdvPurchase.Platform.GOOGLE_PLAY); return; }
    if (e.target.closest('#plusClose') || e.target.closest('#plusLater') || e.target.id === 'plus') { pending = null; paywall(false); return; }
  });

  // ---------------------------------------------------------------- mise à jour obligatoire
  function checkVersion() {
    var base = (window.FUELMAP_CONFIG || {}).dataBase; if (!base || !C.Plugins.App) return;
    Promise.all([C.Plugins.App.getInfo(), fetch(base + 'version-min.json', { cache: 'no-store' }).then(function (r) { return r.json(); })]).then(function (r) {
      var build = +r[0].build, min = +(r[1] && r[1].android);
      if (min && build && build < min) {
        var el = $('update'); if (!el) return;
        el.hidden = false; $('updateText').textContent = 'Ta version (' + r[0].version + ') n\'est plus prise en charge : les données ou les calculs ont changé. Installe la mise à jour pour continuer.';
        $('updateBtn').onclick = function () { window.open('market://details?id=' + PACKAGE, '_system'); };
      }
    }).catch(function () { });
  }

  var started = false;
  function start() {
    if (started) return; started = true;
    var go = function () { if (PLUS_ON) initStore(); else { owned = true; saveLicense(); } checkVersion(); };
    try { C.Plugins.Preferences.get({ key: 'license' }).then(function (r) { cached = r && r.value ? JSON.parse(r.value) : null; }).catch(function () { }).then(go); } catch (e) { go(); }
  }
  document.addEventListener('deviceready', start);
  setTimeout(start, 4000); // au cas où l'événement Cordova ne vienne pas
  window.__fuelmapPlus = { get owned() { return owned || !PLUS_ON; }, require: require, refresh: refresh, paywall: paywall };
})();
