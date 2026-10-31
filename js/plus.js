/*
 * FuelMap Plus — abonnement Google Play (produit « fuelmap_plus », offre d'essai gratuit de 7 jours, codes promo de la Play Console).
 * Quatre états : 'off'   interrupteur coupé (js/config.js → plus: false) : tout est ouvert, rien n'est affiché ;
 *                'free'  pas d'abonnement : voile + cadenas sur les fonctions Plus, rappel « Plus » de temps en temps (téléphone, à l'arrêt) ;
 *                'trial' abonnement dans ses 7 premiers jours d'essai : tout ouvert, badge doré « Trial » ;
 *                'plus'  abonné : tout ouvert, badge doré « Plus ».
 * Fonctions Plus : l'écran Android Auto ('auto'), les icônes du curseur hors flèche / citadine / scooter ('icons'), l'analyse du
 * carnet ('stats' : km, conso réelle, €/100 km), les thèmes perso clair / sombre ('themes'). Le reste est gratuit (dont la bascule automatique jour / nuit).
 * Codes bêta (Plus permanent, sans Google) : « 🎟️ J'ai un code » → l'empreinte SHA-256 du code est comparée à la liste BETA ci-dessous
 *   (les codes eux-mêmes ne sont pas dans le dépôt : .plus-archive/codes-beta.txt). Retirer une empreinte = révoquer le code.
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

  var BETA = ["cc9a391ab695f6cb2e22cf825df697c0c11b5b356c7cfd9d5ec8378ae16dde20", "094ff7db804b916b0757d4bc9e69292c87e8e75bd0b139397b0f3f9fbfab02de", "ff31613e79bbbb4b89896c44072dd650c08ef13b6f0a2b26b5ce47189667f050", "90fa952ca1f3aa22973c9273fe9e142ad7aa4a11e10192b5de4dc49c6ed68d62", "dd798bdd87a0765df69054f56bc26fb6f172c4ad50bbd3d2c346bc64e17412ca", "bbf091acb1386e77904b367fc16b679708b4bfd85ae9f6a8a8085e205164b5f2", "c82080c317391bb4bc40c02f7f53cc749a8f1fa61e637f4db8da005ed34d8142", "31dd172652c0125650f4519c9ad615191e3bb1ebf16166a71fc66633e49845b4", "063501d3d7d84801c97099408c8dd971885bae7346fecfd9359db26736f4d57d", "841f01b3382cb055d768dd73377084a44fa8c5bbf490cf5302d0d84ec6a572dc", "e0b02201e73d726e3645ca99d4de6025ac65a83d735265f05f2aa5f2d2565955", "834e2b09be0cc616f9a01913431331fa9c470cac57a0fb63fa71583375fd5853", "15a4936812b3658a288ea1f1abd98261a884f7f74b351b72e8d51a2d90c53dc9", "9fff094cbfa16846ac964c6f19b3411616fd822514ec58063fc5f5f822f15e6d", "7c5707feb2d3bf374c635f877626a230b1f62834b57e512b382de6bda30631bf", "5ec0662a851711abfb98a8ea89069adba032e05e0b2ddbdff7263c2c8f2446bc", "de1a916c6830c613a2939cf0a1d12574be352c04f03a8aabc67b3ecf38c81681", "25a7d69418c81e7e0a894f157fdd00ffb362bd8d0fe7b80e43dca92c7c444e81", "869a5aa91841061acefb8ea1deb8f941a99e41fd18c7bec2ba782435e53b2222", "288fb1403873b8b86d78d65388ab1558bd7740ea878dcbfc81603a9a10df3682", "e1b5b7fda88bbfd141cad8142061d50bae6b4ee6c2fd8ae9540913527800f315", "4f32233adf67715c03ee2db1e6ba170cae7b006f1e2228008aea40f4af1c69b5", "2343316ecae36ecae57ed1d77e3f3137d1fb9ab665ed3db1cf51f3bd67ba4c12", "17af30505ff51c77155f2c67d0bac8b645ac95c9dcc669f3bf433df2c82a2d74", "9229da0e370e127b536de3872eb21fd0ceeeeacc3936dc9587a5a6aa4ea45d0d", "54d0ed6d1199cdbfbb602eb56a6d0ef682f10c94e2afd7bbc437bc23ee3cd4cc", "a836fc049aa2578815d83434a0751695345ba07a427d02c4622e4b8ef99e268b", "d78ecae44def44f43803521d3631eb675ffefcc070d615f5375962eca2c9c904", "aaaf19aeae668842a201aff65ad186a9260f71904bbc647afebe288af9c4edca", "3c1a32e27658a10c395d7cd6727021ccfa327d96696ad55c0854cbc5437cb6d9"];
  function beta() { return BETA.indexOf(ls('fuelmap-beta')) >= 0; } // code bêta accepté sur ce téléphone
  function testMode() { var t = ls('fuelmap-plustest'); return t === 'free' || t === 'trial' || t === 'plus' ? t : null; }
  function trialStart() { return +ls('fuelmap-trialstart') || 0; }
  function status() {
    var t = testMode(); if (t) return t;
    if (carScreen) { try { var s = JSON.parse(ls('fuelmap-plus') || 'null'); if (s && s.status) return s.status; } catch (e) { } return 'off'; } // la page de la voiture lit ce que le téléphone a écrit
    if (!isApp || !PLUS_ON) return 'off';
    if (beta()) return 'plus';
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
    themes: '🎨 Les thèmes perso (tes couleurs, en clair et en sombre) font partie de FuelMap Plus.',
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
    if (e.target.closest('#plusCode')) { var cb = $('plusCodeBox'); cb.hidden = !cb.hidden; if (!cb.hidden) $('plusCodeIn').focus(); return; }
    if (e.target.closest('#plusCodeOk')) { checkCode($('plusCodeIn').value); return; }
    if (e.target.closest('#plusClose') || e.target.closest('#plusLater') || e.target.id === 'plus') { pending = null; paywall(false); return; }
  });

  // ---------------------------------------------------------------- codes : bêta FuelMap (permanent) ou, sinon, code promo Google Play
  function norm(c) { var n = String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return /^FM[A-Z0-9]{12}$/.test(n) ? n.slice(2) : n; }
  function sha256(t) { return crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)).then(function (b) { return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); }); }
  function checkCode(raw) {
    var n = norm(raw); if (n.length < 8) { toast('Code trop court'); return; }
    sha256('fuelmap-beta:' + n).then(function (h) {
      if (BETA.indexOf(h) >= 0) { ls('fuelmap-beta', h); $('plusCodeIn').value = ''; $('plusCodeBox').hidden = true; paywall(false); publish(); toast('🎉 Code accepté : FuelMap Plus est débloqué, merci de tester !'); if (pending) { var fn = pending; pending = null; fn(); } return; }
      toast('Code inconnu de FuelMap : on essaie sur Google Play'); try { window.open('https://play.google.com/redeem?code=' + encodeURIComponent(n), '_system'); } catch (e) { }
    }).catch(function () { toast('Vérification du code impossible sur cet appareil'); });
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target && e.target.id === 'plusCodeIn') { e.preventDefault(); checkCode(e.target.value); } });

  // ---------------------------------------------------------------- carte « FuelMap Plus » (onglet Véhicules)
  function renderCard() {
    var el = $('plusCard'); if (!el) return; var s = status();
    el.hidden = s === 'off'; if (s === 'off') return;
    el.className = 'pcard ' + s;
    el.innerHTML = s === 'free' ? '<div class="ph"><span class="pbadge">Plus</span><b>FuelMap Plus</b></div><p>L\'écran de la voiture (Android Auto), 12 curseurs de plus, tes thèmes perso et l\'analyse du carnet. <b>7 jours d\'essai gratuit.</b></p><button class="primary" data-plusopen="promo">Découvrir FuelMap Plus</button>'
      : s === 'trial' ? '<div class="ph"><span class="pbadge">Trial</span><b>Essai FuelMap Plus</b></div><p>Tout est débloqué pendant encore <b>' + trialDays() + ' jour' + (trialDays() > 1 ? 's' : '') + '</b>. L\'abonnement continue ensuite, sauf résiliation dans le Play Store.</p><button class="secondary" id="plusManage">Gérer l\'abonnement</button>'
        : beta() ? '<div class="ph"><span class="pbadge">Plus</span><b>FuelMap Plus · bêta-testeur</b></div><p>Accès offert, sans limite de durée. Merci de tester FuelMap !</p>'
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
