/*
 * FuelMap Plus — abonnement Google Play (produit « fuelmap_plus », offre d'essai gratuit de 7 jours, codes promo de la Play Console).
 * Quatre états : 'off'   interrupteur coupé (js/config.js → plus: false) : tout est ouvert, rien n'est affiché ;
 *                'free'  pas d'abonnement : voile + cadenas sur les fonctions Plus, rappel « Plus » de temps en temps (téléphone, à l'arrêt) ;
 *                'trial' abonnement dans ses 7 premiers jours d'essai : tout ouvert, badge doré « Trial » ;
 *                'plus'  abonné : tout ouvert, badge doré « Plus ».
 * Fonctions Plus : l'écran Android Auto ('auto'), les icônes du curseur hors flèche / citadine / scooter ('icons'), l'analyse du
 * carnet ('stats' : km, conso réelle, €/100 km). Le reste est gratuit.
 * Mode test (pour voir les voiles sans abonnement) : toucher 5 fois le numéro de version en haut → Gratuit / Trial / Plus / normal.
 * L'état est recopié pour l'écran voiture (localStorage « fuelmap-plus ») et pour Android Auto côté Android (Preferences « license »).
 */
(function () {
  'use strict';
  var C = window.Capacitor, isApp = !!(C && C.getPlatform && C.getPlatform() === 'android');
  var PLUS_ON = !!((window.FUELMAP_CONFIG || {}).plus);
  var $ = function (id) { return document.getElementById(id); };
  var PRODUCT = 'fuelmap_plus', TRIAL_MS = 7 * 86400000, HOUR = 3600000;
  var FREE_ICONS = ['arrow', 'citadine', 'scooter'];
  var store = null, owned = false, offers = [], initOk = false, cached = null, pending = null;
  var ls = function (k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { } return null; };
  var carScreen = /[?&]aa=1/.test(location.search);

  function testMode() { var t = ls('fuelmap-plustest'); return t === 'free' || t === 'trial' || t === 'plus' ? t : null; }
  function trialStart() { return +ls('fuelmap-trialstart') || 0; }
  function status() {
    var t = testMode(); if (t) return t;
    if (carScreen) { try { var s = JSON.parse(ls('fuelmap-plus') || 'null'); if (s && s.status) return s.status; } catch (e) { } return 'off'; } // la page de la voiture lit ce que le téléphone a écrit
    if (!isApp || !PLUS_ON) return 'off';
    if (!owned) return 'free';
    return trialStart() && Date.now() - trialStart() < TRIAL_MS ? 'trial' : 'plus';
  }
  function has(feature) { return status() !== 'free'; }
  function freeIcon(k) { return FREE_ICONS.indexOf(k || 'arrow') >= 0; }
  function trialDays() { return Math.max(1, Math.ceil((trialStart() + TRIAL_MS - Date.now()) / 86400000)); }
  function badge() { var s = status(); return s === 'trial' ? '<span class="pbadge" title="Essai FuelMap Plus : encore ' + trialDays() + ' j">Trial</span>' : '<span class="pbadge">Plus</span>'; }
  function veil() { return '<span class="pveil"><span class="ppad">🔒</span>' + '<span class="pbadge">Plus</span></span>'; }

  // l'état part vers l'écran voiture (même stockage) et vers Android Auto (Preferences, autre processus)
  function publish() {
    var s = status(); ls('fuelmap-plus', JSON.stringify({ status: s, trialEnd: trialStart() ? trialStart() + TRIAL_MS : 0, ts: Date.now() }));
    if (isApp && C.Plugins && C.Plugins.Preferences) try { C.Plugins.Preferences.set({ key: 'license', value: JSON.stringify({ owned: s !== 'free', status: s, until: Date.now() + 32 * 86400000, ts: Date.now() }) }); } catch (e) { }
    document.documentElement.setAttribute('data-plus', s);
    var vb = $('verBadge'); if (vb) vb.innerHTML = s === 'trial' || s === 'plus' ? badge() : '';
    document.dispatchEvent(new CustomEvent('fuelmap:plus', { detail: s }));
    renderCard();
  }

  // ---------------------------------------------------------------- écran d'abonnement (et rappel)
  var WHY = {
    auto: '🚗 FuelMap sur l\'écran de la voiture (Android Auto) fait partie de FuelMap Plus.',
    icons: '🏎️ Ce curseur fait partie de FuelMap Plus (la flèche, la citadine et le scooter restent gratuits).',
    stats: '📈 L\'analyse du carnet (consommation réelle, €/100 km, kilomètres) fait partie de FuelMap Plus.',
    promo: '⭐ Passe à FuelMap Plus : 7 jours d\'essai gratuit.'
  };
  function paywall(show, why) {
    var el = $('plus'); if (!el) return;
    el.hidden = !show; if (!show) return;
    $('plusWhy').textContent = WHY[why] || WHY.promo; renderOffers();
  }
  function phaseText(ph) {
    var per = { P1W: 'semaine', P1M: 'mois', P1Y: 'an', P3M: '3 mois', P6M: '6 mois' }[ph.billingPeriod] || ph.billingPeriod;
    if (ph.paymentMode === 'FreeTrial') return ph.billingPeriod === 'P1W' ? '7 jours gratuits' : 'essai gratuit ' + per;
    return ph.price + ' / ' + per;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function renderOffers() {
    var box = $('plusOffers'); if (!box) return;
    if (!isApp) { box.innerHTML = '<p class="hint">L\'abonnement se prend dans l\'appli Android (Google Play).</p>'; return; }
    if (!offers.length) { box.innerHTML = '<p class="hint">' + (store ? '⏳ Chargement des offres Google Play…' : 'Google Play indisponible : vérifie ta connexion et que l\'appli vient bien du Play Store.') + '</p>'; return; }
    box.innerHTML = offers.map(function (o, i) {
      var ph = o.pricingPhases || [], yearly = /annuel|year|P1Y/i.test(o.id + ' ' + ph.map(function (p) { return p.billingPeriod; }).join(' '));
      return '<button class="' + (yearly ? 'primary' : 'secondary') + ' plus-offer" data-offer="' + i + '">' + (yearly ? '📅 Annuel' : '🗓️ Mensuel') + ' · ' + esc(ph.map(phaseText).join(' puis ')) + '</button>';
    }).join('');
  }
  // la page demande une fonction Plus : on l'exécute si elle est ouverte, sinon écran d'abonnement (puis exécution après l'achat)
  function require(feature, fn) { if (has(feature)) return fn && fn(); pending = fn || null; paywall(true, feature); }

  // ---------------------------------------------------------------- Google Play
  function refresh() {
    var p = store.get(PRODUCT, CdvPurchase.Platform.GOOGLE_PLAY);
    owned = !!(p && p.owned);
    offers = p && p.offers ? p.offers.filter(function (o) { return o.canPurchase !== false; }) : [];
    if (!initOk && !owned && cached && cached.owned && cached.until > Date.now()) owned = true; // hors ligne : on garde l'accès déjà acquis
    publish(); renderOffers();
    if (owned) { paywall(false); if (pending) { var fn = pending; pending = null; fn(); } }
  }
  function initStore() {
    if (!window.CdvPurchase) return;
    store = CdvPurchase.store; store.verbosity = CdvPurchase.LogLevel.WARNING;
    store.register([{ id: PRODUCT, type: CdvPurchase.ProductType.PAID_SUBSCRIPTION, platform: CdvPurchase.Platform.GOOGLE_PLAY }]);
    store.when().productUpdated(refresh).approved(function (t) { t.verify(); }).verified(function (r) { r.finish(); refresh(); }).receiptUpdated(refresh);
    store.error(function (e) { if (e && e.code !== CdvPurchase.ErrorCode.PAYMENT_CANCELLED) toast('Google Play : ' + (e.message || e.code)); });
    store.initialize([CdvPurchase.Platform.GOOGLE_PLAY]).then(function (errs) { initOk = !(errs && errs.length); refresh(); });
  }
  function toast(msg) { if (window.__fuelmapAPI && window.__fuelmapAPI.toast) window.__fuelmapAPI.toast(msg); }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-offer]');
    if (b && offers[+b.getAttribute('data-offer')]) {
      var o = offers[+b.getAttribute('data-offer')], trial = (o.pricingPhases || []).some(function (p) { return p.paymentMode === 'FreeTrial'; });
      o.order().then(function (err) {
        if (err) { if (err.code !== CdvPurchase.ErrorCode.PAYMENT_CANCELLED) toast('Achat impossible : ' + (err.message || err.code)); return; }
        if (trial && !trialStart()) ls('fuelmap-trialstart', String(Date.now())); // l'essai commence : badge « Trial » pendant 7 jours
      });
      return;
    }
    if (e.target.closest('[data-plusopen]')) { paywall(true, e.target.closest('[data-plusopen]').getAttribute('data-plusopen')); return; }
    if (e.target.closest('#plusRestore')) { if (store) store.restorePurchases().then(function () { refresh(); if (!owned) toast('Aucun abonnement trouvé pour ce compte Google'); }); return; }
    if (e.target.closest('#plusManage')) { if (store) store.manageSubscriptions(CdvPurchase.Platform.GOOGLE_PLAY); return; }
    if (e.target.closest('#plusCode')) { try { window.open('https://play.google.com/redeem', '_system'); } catch (err) { } return; } // codes promo de la Play Console
    if (e.target.closest('#plusClose') || e.target.closest('#plusLater') || e.target.id === 'plus') { pending = null; paywall(false); return; }
  });

  // ---------------------------------------------------------------- carte « FuelMap Plus » (onglet Véhicules)
  function renderCard() {
    var el = $('plusCard'); if (!el) return; var s = status();
    el.hidden = s === 'off'; if (s === 'off') return;
    el.className = 'pcard ' + s;
    el.innerHTML = s === 'free' ? '<div class="ph"><span class="pbadge">Plus</span><b>FuelMap Plus</b></div><p>L\'écran de la voiture (Android Auto), 12 curseurs de plus et l\'analyse du carnet. <b>7 jours d\'essai gratuit.</b></p><button class="primary" data-plusopen="promo">Découvrir FuelMap Plus</button>'
      : s === 'trial' ? '<div class="ph"><span class="pbadge">Trial</span><b>Essai FuelMap Plus</b></div><p>Tout est débloqué pendant encore <b>' + trialDays() + ' jour' + (trialDays() > 1 ? 's' : '') + '</b>. L\'abonnement continue ensuite, sauf résiliation dans le Play Store.</p><button class="secondary" id="plusManage">Gérer l\'abonnement</button>'
        : '<div class="ph"><span class="pbadge">Plus</span><b>FuelMap Plus</b></div><p>Merci ! Tout est débloqué.</p><button class="secondary" id="plusManage">Gérer l\'abonnement</button>';
  }

  // ---------------------------------------------------------------- rappel « Plus » : téléphone seulement, à l'arrêt, au plus une fois par heure
  function upsell() {
    if (carScreen || status() !== 'free' || document.hidden) return;
    var A = window.__fuelmapAPI; if (!A || !A.state || !A.state.cars || !A.state.cars.length) return; // pas pendant l'accueil
    var f = A.fix; if (f && f.speed != null && f.speed * 3.6 > 8) return; // en roulant : jamais
    if (!$('plus') || !$('plus').hidden || ($('onboard') && !$('onboard').hidden)) return;
    var last = +ls('fuelmap-upsell') || 0, first = +ls('fuelmap-firstrun') || 0;
    if (!first) { ls('fuelmap-firstrun', String(Date.now())); return; }
    if (Date.now() - first < HOUR || Date.now() - last < HOUR) return;
    ls('fuelmap-upsell', String(Date.now())); paywall(true, 'promo');
  }

  // ---------------------------------------------------------------- mode test : 5 touchers sur le numéro de version
  var taps = [];
  document.addEventListener('click', function (e) {
    if (!e.target.closest('#ver, .cbrand small')) return;
    var now = Date.now(); taps = taps.filter(function (t) { return now - t < 3000; }); taps.push(now); if (taps.length < 5) return; taps = [];
    var order = [null, 'free', 'trial', 'plus'], cur = testMode(), next = order[(order.indexOf(cur) + 1) % order.length];
    ls('fuelmap-plustest', next); if (next === 'trial' && !trialStart()) ls('fuelmap-trialstart', String(Date.now() - 2 * 86400000));
    if (!next) ls('fuelmap-trialstart', null);
    toast('Mode test FuelMap Plus : ' + (next === 'free' ? 'Gratuit (voiles)' : next === 'trial' ? 'Trial' : next === 'plus' ? 'Plus' : 'normal'));
    publish();
  });

  // ---------------------------------------------------------------- mise à jour obligatoire (inchangé)
  function checkVersion() {
    var base = (window.FUELMAP_CONFIG || {}).dataBase; if (!isApp || !base || !C.Plugins.App) return;
    Promise.all([C.Plugins.App.getInfo(), fetch(base + 'version-min.json', { cache: 'no-store' }).then(function (r) { return r.json(); })]).then(function (r) {
      var build = +r[0].build, min = +(r[1] && r[1].android);
      if (min && build && build < min) { var el = $('update'); if (!el) return; el.hidden = false; $('updateText').textContent = 'Ta version (' + r[0].version + ') n\'est plus prise en charge : les données ou les calculs ont changé. Installe la mise à jour pour continuer.'; $('updateBtn').onclick = function () { window.open('market://details?id=fr.soaresden.fuelmap', '_system'); }; }
    }).catch(function () { });
  }

  var started = false;
  function start() {
    if (started) return; started = true;
    var go = function () { if (isApp && PLUS_ON && !carScreen) initStore(); publish(); };
    if (isApp && C.Plugins && C.Plugins.Preferences) C.Plugins.Preferences.get({ key: 'license' }).then(function (r) { try { cached = r && r.value ? JSON.parse(r.value) : null; } catch (e) { } }).catch(function () { }).then(go); else go();
  }
  document.addEventListener('deviceready', start);
  setTimeout(start, isApp ? 4000 : 0);
  setInterval(upsell, 60000);
  window.addEventListener('storage', function (e) { if (e.key === 'fuelmap-plus' || e.key === 'fuelmap-plustest') publish(); }); // l'autre écran a changé l'état
  window.__fuelmapPlus = { status: status, has: has, freeIcon: freeIcon, badge: badge, veil: veil, require: require, paywall: paywall, refresh: function () { if (store) refresh(); else publish(); } };
})();
