/* FuelMap PWA — carte des prix + optimiseur de pleins. Aucun backend : tout tourne dans le navigateur. */
(function () {
  'use strict';

  // ------------------------------------------------------------------ constantes
  var FUELS = [
    { key: 'gazole', label: 'Gazole', gov: 'Gazole' },
    { key: 'sp95', label: 'SP95', gov: 'SP95' },
    { key: 'e10', label: 'SP95-E10', gov: 'E10' },
    { key: 'sp98', label: 'SP98', gov: 'SP98' },
    { key: 'e85', label: 'E85', gov: 'E85' },
    { key: 'gplc', label: 'GPLc', gov: 'GPLc' }
  ];
  var FUEL_INDEX = {}; FUELS.forEach(function (f, i) { FUEL_INDEX[f.key] = i; });
  // Qui peut le plus peut le moins : un moteur prévu pour le SP95-E10 accepte aussi SP95 et SP98 ; un moteur SP95 accepte le SP98.
  var COMPAT = { e10: ['e10', 'sp95', 'sp98'], sp95: ['sp95', 'sp98'], sp98: ['sp98'], gazole: ['gazole'], e85: ['e85'], gplc: ['gplc'] };
  function fuelsFor(key) { return COMPAT[key].map(function (k) { return FUEL_INDEX[k]; }); }
  var OSRM = 'https://router.project-osrm.org/route/v1/driving/';
  var PHOTON = 'https://photon.komoot.io/api/';
  var GEOCODERS = ['https://data.geopf.fr/geocodage/search', 'https://api-adresse.data.gouv.fr/search/'];
  var DATA_TTL_MS = 10 * 60 * 1000;
  var DETOUR_FACTOR = 1.35;      // route réelle vs vol d'oiseau
  var EXIT_OVERHEAD_KM = 1.0;    // sortie / retour sur l'axe pour une station hors autoroute
  var DAY = 86400000;

  var $ = function (id) { return document.getElementById(id); };
  var isWide = function () { return document.documentElement.classList.contains('wide'); };
  // Disposition « grand écran » (colonne à gauche) : largeur ≥ 900 px, ou zone visible ≥ 900 px sur Android Auto (voir carInsets)
  var safe = { t: 0, r: 0, b: 0, l: 0 }, wideMQ = window.matchMedia('(min-width: 900px)');
  function applyLayout() {
    var wide = (innerWidth - safe.l - safe.r) >= 900 && (wideMQ.matches || safe.l + safe.r > 0);
    var was = isWide(); document.documentElement.classList.toggle('wide', wide);
    if (was !== wide && window.__fuelmapLayoutChanged) window.__fuelmapLayoutChanged(wide);
  }
  applyLayout(); wideMQ.addEventListener ? wideMQ.addEventListener('change', applyLayout) : wideMQ.addListener(applyLayout);

  // ------------------------------------------------------------------ état persistant
  var STORE_KEY = 'fuelmap.v1', STATE_VERSION = 2;
  var state = {
    cars: [], activeCar: null, fuel: 'e10', theme: 'dark', places: [],
    v: STATE_VERSION, favs: [], brand: '', neighbours: true, startE: 4, arrivalE: 2, arrivalAny: true, corridor: 15, shortage: false, alert: null, stopCost: 2, maxAge: 7, only24: false,
    view: { lat: 46.6, lon: 2.4, zoom: 6 }
  };
  try {
    var saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      // nouvelle version des réglages par défaut : on garde véhicules, lieux, thème et vue, on réinitialise le reste
      var keep = saved.v === STATE_VERSION ? Object.keys(saved) : ['cars', 'activeCar', 'fuel', 'theme', 'places', 'view', 'neighbours', 'favs', 'brand'];
      keep.forEach(function (k) { if (saved[k] !== undefined) state[k] = saved[k]; });
      state.v = STATE_VERSION;
    }
  } catch (e) { /* stockage indisponible : on garde les valeurs par défaut */ }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { }
    // APK : l'écran Android Auto (Java) lit le véhicule actif dans les préférences natives
    try { var P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences; if (P) P.set({ key: 'car', value: JSON.stringify(car()) }); } catch (e) { }
  }
  var NO_CAR = { id: null, name: '—', fuel: 'e10', tank: 50, cons: 7, reserve: 5 };
  function startPct() { return state.startE * 12.5; }
  function car() { return state.cars.filter(function (c) { return c.id === state.activeCar; })[0] || state.cars[0] || NO_CAR; }

  // ------------------------------------------------------------------ petit cache IndexedDB
  var idb = {
    open: function () {
      return new Promise(function (res, rej) {
        if (!window.indexedDB) return rej(new Error('no idb'));
        var r = indexedDB.open('fuelmap', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      });
    },
    get: function (key) {
      return idb.open().then(function (db) {
        return new Promise(function (res, rej) {
          var q = db.transaction('kv').objectStore('kv').get(key);
          q.onsuccess = function () { res(q.result); }; q.onerror = function () { rej(q.error); };
        });
      }).catch(function () { return null; });
    },
    set: function (key, val) {
      return idb.open().then(function (db) {
        return new Promise(function (res) {
          var tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(val, key);
          tx.oncomplete = res; tx.onerror = res;
        });
      }).catch(function () { });
    }
  };

  // ------------------------------------------------------------------ utilitaires
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function titleCase(s) { return String(s || '').toLowerCase().replace(/(^|[\s\-'’])([a-zà-ÿ])/g, function (m, a, b) { return a + b.toUpperCase(); }); }
  function eur(v, d) { return v.toLocaleString('fr-FR', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d }) + ' €'; }
  function num(v, d) { return v.toLocaleString('fr-FR', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }
  function price3(p) { return p.toFixed(3).replace('.', ','); }
  function haversine(aLat, aLon, bLat, bLon) {
    var R = 6371, dLat = (bLat - aLat) * Math.PI / 180, dLon = (bLon - aLon) * Math.PI / 180;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  // Indice de confiance « il y a du carburant ? » : la seule donnée officielle est l'heure du dernier prix déclaré par le gérant.
  // Un prix tout frais = un gérant actif qui vend ; une rupture déclarée = à sec. Entre les deux, on ne sait pas.
  function ageHours(s, fi) { return s.t && s.t[fi] ? Math.max(0, (Date.now() / 60000 - s.t[fi]) / 60) : ageDays(s, fi) * 24; }
  var CONF = [ // seuil (heures), libellé, teinte 0 (vert) → 1 (rouge)
    { h: 6, label: 'très probable', short: '🟢 prix mis à jour il y a moins de 6 h', t: 0 },
    { h: 24, label: 'probable', short: '🟡 prix mis à jour aujourd\'hui', t: 0.35 },
    { h: 72, label: 'incertain', short: '🟠 dernier prix il y a 1 à 3 jours', t: 0.65 },
    { h: Infinity, label: 'inconnu', short: '⚪ pas de nouvelle depuis plus de 3 jours', t: 0.85 }
  ];
  function confidence(s, fi) {
    if (s.r & (1 << fi)) return { level: -1, label: 'rupture déclarée', short: '⊘ rupture déclarée par la station', t: 1 };
    var h = ageHours(s, fi); for (var i = 0; i < CONF.length; i++) if (h <= CONF[i].h) return { level: 3 - i, label: CONF[i].label, short: CONF[i].short, t: CONF[i].t, hours: h };
  }
  // Boutons « Y aller ». Android (appli ou navigateur) : un seul bouton, un lien geo: — le téléphone propose lui-même
  // Waze / Google Maps / autre (ou ouvre celle par défaut). Android Auto : idem, via l'appli de navigation de la voiture.
  // Ailleurs (PC, iPhone) : les deux liens web.
  var ONE_NAV = document.documentElement.hasAttribute('data-aa') || /Android/i.test(navigator.userAgent);
  function navLinks(s, cls) { // cls : classe du bouton principal ('primary') ou '' pour la liste de liens
    var label = (s.brand ? s.brand + ' ' : '') + titleCase(s.ville), ll = s.lat + ',' + s.lon;
    if (ONE_NAV) return '<a class="' + cls + '" href="' + (document.documentElement.hasAttribute('data-aa') ? 'https://waze.com/ul?ll=' + ll + '&navigate=yes' : 'geo:' + ll + '?q=' + ll + '(' + encodeURIComponent(label) + ')') + '">🧭 Y aller</a>';
    return '<a class="' + cls + '" target="_blank" rel="noopener" href="https://waze.com/ul?ll=' + ll + '&navigate=yes">' + (cls ? '🚗 ' : '') + 'Waze</a>' +
      '<a class="' + (cls ? 'secondary' : '') + '" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=' + ll + '">' + (cls ? 'Maps' : 'Google Maps') + '</a>';
  }
  // FuelMap Plus (appli Android) : trajet optimisé, mode voiture et Android Auto. Sur le web, tout est ouvert.
  function gate(feature, fn) { var P = window.__fuelmapPlus; if (!P || P.owned) return fn(); P.require(feature, fn); }
  // Date + heure exacte du dernier prix (France : à la minute ; ailleurs : le jour)
  function whenText(s, fi, long) {
    if (!(s.t && s.t[fi])) { var a = ageDays(s, fi); return long ? ageText(a) : ageLabel(a); }
    var d = new Date(s.t[fi] * 60000), now = new Date(), hm = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    var sameDay = d.toDateString() === now.toDateString(), yest = new Date(now - DAY).toDateString() === d.toDateString();
    var day = sameDay ? (long ? "aujourd'hui" : 'auj.') : yest ? 'hier' : (long ? 'le ' : '') + d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    return day + (long ? ' à ' : ' ') + hm;
  }
  function shortAge(h) { return h < 1 ? '<1 h' : h < 24 ? Math.round(h) + ' h' : h < 48 ? 'hier' : Math.round(h / 24) + ' j'; }
  function agoText(h) { return h < 1 ? "il y a moins d'une heure" : h < 24 ? 'il y a ' + Math.round(h) + ' h' : h < 48 ? 'hier' : 'il y a ' + Math.round(h / 24) + ' j'; }
  function ageDays(s, fi) { return s.m[fi] ? Math.max(0, Math.floor(Date.now() / DAY) - s.m[fi]) : 9999; }
  function ageText(d) { return d === 0 ? 'prix du jour' : d === 1 ? "prix d'hier" : "prix d'il y a " + d + ' j'; }
  function ageLabel(d) { return d === 0 ? "auj." : d === 1 ? 'hier' : d > 999 ? '—' : d + ' j'; }
  function inRupture(s, fis) { var any = false; for (var i = 0; i < fis.length; i++) { if (usable(s, fis[i])) return false; if (s.r & (1 << fis[i])) any = true; } return any; } // rupture déclarée et rien d'autre de compatible
  function usable(s, fi) { return s.p[fi] > 0 && !(s.r & (1 << fi)) && ageDays(s, fi) <= state.maxAge && (!state.brand || s.brand === state.brand); }
  function pickAny(s, fis) { var keep = state.brand, k; state.brand = ''; k = pick(s, fis); state.brand = keep; return k; } // sans le filtre d'enseigne
  function pick(s, fis) { var best = -1; for (var i = 0; i < fis.length; i++) if (usable(s, fis[i]) && (best < 0 || s.p[fis[i]] < s.p[best])) best = fis[i]; return best; } // carburant compatible le moins cher
  function displayFuels() { return state.fuel === car().fuel && state.cars.length ? fuelsFor(state.fuel) : [FUEL_INDEX[state.fuel]]; }
  function hmin(min) { var h = Math.floor(min / 60), m = Math.round(min % 60); return h ? h + ' h ' + (m < 10 ? '0' : '') + m : m + ' min'; }
  var toastTimer;
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3500); }
  var loaderTimer;
  function loader(text, kind, retry) { // kind : undefined = en cours, 'err' = échec (reste affiché, bouton Réessayer), 'ok' = succès bref
    var el = $('loader'); clearTimeout(loaderTimer);
    el.hidden = !text; el.className = kind || ''; if (!text) return;
    $('loaderText').textContent = text; $('loaderSpin').hidden = !!kind;
    $('loaderRetry').hidden = !retry; $('loaderRetry').onclick = retry || null;
    if (kind === 'ok') loaderTimer = setTimeout(function () { el.hidden = true; }, 2500);
  }
  function debounce(fn, ms) { var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); }; }

  // ------------------------------------------------------------------ données stations
  var stations = [], grid = new Map(), dataTs = 0;
  function cellKey(lat, lon) { return Math.floor(lat * 10) * 10000 + Math.floor((lon + 20) * 10); }

  var byCountry = {}, countryState = {}; // countryState[cc] = 'loading' | 'ok' | 'none'
  var brandMap = null;
  function loadBrands() { // les données de l'État n'ont pas l'enseigne : table id → enseigne tirée d'OpenStreetMap par tools/build-data.mjs
    var bases = [(window.FUELMAP_CONFIG || {}).dataBase, ''].filter(function (b, i) { return b || i === 1; });
    var tryBase = function (i) { return fetch(bases[i] + 'data/fr-brands.json').then(function (r) { if (!r.ok) throw new Error('absent'); return r.json(); }).catch(function (e) { if (i + 1 < bases.length) return tryBase(i + 1); throw e; }); };
    return idb.get('brands').then(function (c) {
      if (c && c.map) { brandMap = c.map; if (byCountry.fr) setStations(byCountry.fr, dataTs); if (Date.now() - c.saved < 7 * DAY) return; }
      return tryBase(0).then(function (j) { brandMap = j.map; idb.set('brands', { map: j.map, saved: Date.now() }); if (byCountry.fr) setStations(byCountry.fr, dataTs); });
    }).catch(function () { });
  }
  function setStations(frList, ts) { frList.forEach(function (x) { x.cc = 'fr'; x.brand = (brandMap && brandMap[x.id]) || ''; }); byCountry.fr = frList; dataTs = ts; rebuild(); }
  function rebuild() {
    var list = []; Object.keys(byCountry).forEach(function (cc) { if (cc === 'fr' || state.neighbours) list = list.concat(byCountry[cc]); });
    stations = list; grid = new Map();
    for (var i = 0; i < list.length; i++) {
      var k = cellKey(list[i].lat, list[i].lon), c = grid.get(k);
      if (c) c.push(list[i]); else grid.set(k, [list[i]]);
    }
    updateDataInfo(); refreshMap(); if (typeof updateHud === 'function') updateHud();
  }
  function stationsInBounds(s, w, n, e) {
    var out = [], cells = (Math.floor(n * 10) - Math.floor(s * 10) + 1) * (Math.floor(e * 10) - Math.floor(w * 10) + 1), i;
    if (cells > 2500) {
      for (i = 0; i < stations.length; i++) { var t = stations[i]; if (t.lat >= s && t.lat <= n && t.lon >= w && t.lon <= e) out.push(t); }
      return out;
    }
    for (var cy = Math.floor(s * 10); cy <= Math.floor(n * 10); cy++) for (var cx = Math.floor((w + 20) * 10); cx <= Math.floor((e + 20) * 10); cx++) {
      var c = grid.get(cy * 10000 + cx); if (!c) continue;
      for (i = 0; i < c.length; i++) { var u = c[i]; if (u.lat >= s && u.lat <= n && u.lon >= w && u.lon <= e) out.push(u); }
    }
    return out;
  }
  // Pays voisins : chargés seulement quand la carte ou un trajet les touche. D'abord data/<cc>.json (préparé par
  // la GitHub Action, léger), sinon l'API officielle en direct quand elle autorise le navigateur (ES, PT, AD).
  var FOREIGN_TTL = 3 * 3600 * 1000, PREBUILT_MAX_AGE = 26 * 3600 * 1000;
  function adopt(cc, list) {
    list.forEach(function (x) { x.brand = FuelSources.normBrand(x.brand); });
    byCountry[cc] = list; countryState[cc] = 'ok'; rebuild();
  }
  function loadCountry(cc) {
    if (countryState[cc]) return countryState[cc] === 'loading' ? countryState[cc + 'P'] : Promise.resolve();
    var src = FuelSources[cc]; countryState[cc] = 'loading'; loader('⏳ Prix ' + src.name + '…');
    var p = idb.get('cc:' + cc).then(function (c) {
      if (c && c.list && Date.now() - c.saved < FOREIGN_TTL) return c;
      var bases = [(window.FUELMAP_CONFIG || {}).dataBase, ''].filter(function (b, i) { return b || i === 1; });
      var tryBase = function (i) { return fetch(bases[i] + 'data/' + cc + '.json').then(function (r) { if (!r.ok) throw new Error('absent'); return r.json(); }).catch(function (e) { if (i + 1 < bases.length) return tryBase(i + 1); throw e; }); };
      return tryBase(0)
        .then(function (j) { if (src.live && Date.now() - j.ts > PREBUILT_MAX_AGE) throw new Error('périmé'); return j; })
        .catch(function () {
          if (!src.live) throw new Error('données ' + src.name + ' non publiées (voir README : GitHub Action)');
          return Promise.all(src.urls.map(function (u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return src.text ? r.text() : r.json(); }); }))
            .then(function (payloads) { return { ts: Date.now(), list: src.parse.apply(null, payloads) }; });
        })
        .then(function (j) { j.saved = Date.now(); idb.set('cc:' + cc, { ts: j.ts, saved: j.saved, list: j.list }); return j; })
        .catch(function (err) { if (c && c.list) return c; throw err; }); // à défaut : vieux cache
    }).then(function (j) { adopt(cc, j.list); loader(null); if (nearActive()) renderNear(); })
      .catch(function (err) { countryState[cc] = 'none'; loader(null); toast(src.name + ' : ' + err.message); });
    countryState[cc + 'P'] = p; return p;
  }
  function ensureCountries(south, west, north, east) {
    if (!state.neighbours) return Promise.resolve();
    return Promise.all(Object.keys(FuelSources).filter(function (cc) { if (cc === 'fr' || !FuelSources[cc].bbox) return false; var b = FuelSources[cc].bbox; return b[0] < north && b[2] > south && b[1] < east && b[3] > west; }).map(loadCountry));
  }

  function fetchJsonProgress(url, label, silent) { // lit le flux pour afficher les Ko reçus
    var ctrl = new AbortController(), timer = setTimeout(function () { ctrl.abort(); }, 60000);
    return fetch(url, { signal: ctrl.signal }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      if (!r.body || !r.body.getReader || !window.TextDecoder) return r.json();
      var reader = r.body.getReader(), dec = new TextDecoder(), text = '', got = 0;
      return (function pump() {
        return reader.read().then(function (c) {
          if (c.done) return JSON.parse(text + dec.decode());
          got += c.value.length; text += dec.decode(c.value, { stream: true });
          if (!silent) loader('⏳ ' + label + ' ' + num(got / 1024) + ' Ko');
          return pump();
        });
      })();
    }).then(function (j) { clearTimeout(timer); return j; }, function (e) { clearTimeout(timer); throw e.name === 'AbortError' ? new Error('délai dépassé') : e; });
  }
  function fetchData(silent) {
    if (!silent) loader('⏳ Chargement des prix…');
    var src = FuelSources.fr, bases = [(window.FUELMAP_CONFIG || {}).dataBase, ''].filter(function (b, i) { return b || i === 1; });
    function fallback(i, firstErr) { // data/fr.json : copie publiée par la GitHub Action, puis copie embarquée
      if (i >= bases.length) throw firstErr;
      return fetch(bases[i] + 'data/fr.json').then(function (r) { if (!r.ok) throw new Error('absent'); return r.json(); })
        .then(function (j) { return { list: j.list, ts: j.ts, stale: true }; }, function () { return fallback(i + 1, firstErr); });
    }
    return fetchJsonProgress(src.urls[0], 'Chargement des prix…', silent)
      .then(function (rows) { return { list: src.parse(rows), ts: Date.now() }; })
      .catch(function (err) { return fallback(0, err); })
      .then(function (d) {
        if (d.stale && stations.length && dataTs >= d.ts) throw new Error('source officielle injoignable');
        setStations(d.list, d.ts); idb.set('stations', { ts: d.stale ? 0 : d.ts, list: d.list });
        if (d.stale) loader('⚠️ Source officielle injoignable — prix du ' + new Date(d.ts).toLocaleDateString('fr-FR'), 'err', function () { fetchData(false); });
        else if (!silent) loader('✅ ' + num(d.list.length) + ' stations chargées', 'ok'); else loader(null);
        if (nearActive()) renderNear();
      })
      .catch(function (err) {
        if (stations.length) { loader(null); if (!silent) toast('Actualisation impossible (' + err.message + ') — prix en cache affichés'); }
        else loader('⚠️ Impossible de charger les prix : ' + err.message, 'err', function () { fetchData(false); });
      });
  }
  function updateDataInfo() {
    if (!dataTs) return;
    var fi = FUEL_INDEX[state.fuel], n = 0; stations.forEach(function (s) { if (s.p[fi] > 0) n++; });
    var abroad = Object.keys(byCountry).filter(function (cc) { return cc !== 'fr'; }).map(function (cc) { return FuelSources[cc].name + ' ' + num(byCountry[cc].length); }).join(', ');
    $('dataInfo').textContent = (abroad ? 'Pays voisins chargés : ' + abroad + '. ' : '') + num(stations.length) + ' stations, dont ' + num(n) + ' en ' + FUELS[fi].label + '. Dernière actualisation : ' + new Date(dataTs).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) + '.';
  }

  // ------------------------------------------------------------------ carte
  var map = L.map('map', { zoomControl: false, preferCanvas: true, minZoom: 5, maxZoom: 18 })
    .setView([state.view.lat, state.view.lon], state.view.zoom);
  L.control.zoom({ position: 'bottomleft' }).addTo(map);
  var tiles = null;
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.theme);
    document.querySelector('meta[name=theme-color]').setAttribute('content', state.theme === 'dark' ? '#0e1116' : '#f3f5f8');
    if (!tiles) useTiles(0);
  }
  var TILE_SOURCES = [
    { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', att: '© contributeurs OpenStreetMap' },
    { url: 'https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', att: '© contributeurs OpenStreetMap · OSM France', sub: 'abc' },
    { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', att: 'Tiles © Esri' }
  ];
  function useTiles(i) { // si un fournisseur refuse les tuiles (erreurs sans aucun succès), on passe au suivant
    if (tiles) map.removeLayer(tiles);
    var src = TILE_SOURCES[i], ok = 0, ko = 0;
    tiles = L.tileLayer(src.url, { maxZoom: 19, subdomains: src.sub || 'abc', className: 'base-tiles', attribution: src.att + ' · prix : sources officielles FR · ES · PT · AD · IT' }).addTo(map);
    tiles.on('tileload', function () { ok++; });
    tiles.on('tileerror', function () { if (++ko >= 6 && !ok && i + 1 < TILE_SOURCES.length) useTiles(i + 1); });
  }
  applyTheme();

  function colorFor(t) { t = Math.max(0, Math.min(1, t)); return 'hsl(' + Math.round(140 - 140 * t) + ',78%,' + (state.theme === 'dark' ? 48 : 40) + '%)'; }

  // Couche canvas maison : un seul <canvas>, redessiné à chaque fin de déplacement. 10 000 stations ≈ quelques ms.
  var StationLayer = L.Layer.extend({
    onAdd: function (m) {
      this._canvas = L.DomUtil.create('canvas', 'station-canvas leaflet-zoom-animated');
      m.getPane('overlayPane').appendChild(this._canvas);
      m.on('moveend resize', this.redraw, this); m.on('zoomanim', this._anim, this);
      this.redraw();
    },
    onRemove: function (m) { L.DomUtil.remove(this._canvas); m.off('moveend resize', this.redraw, this); m.off('zoomanim', this._anim, this); },
    _anim: function (e) {
      if (!this._bounds) return;
      var scale = this._map.getZoomScale(e.zoom, this._zoom);
      var offset = this._map._latLngBoundsToNewLayerBounds(this._bounds, e.zoom, e.center).min;
      L.DomUtil.setTransform(this._canvas, offset, scale);
    },
    redraw: function () {
      var m = this._map; if (!m) return;
      var size = m.getSize(), pad = size.multiplyBy(0.15).round();
      var tl = m.containerPointToLayerPoint([0, 0]).subtract(pad), full = size.add(pad.multiplyBy(2));
      var dpr = Math.min(window.devicePixelRatio || 1, 2), c = this._canvas;
      c.width = full.x * dpr; c.height = full.y * dpr; c.style.width = full.x + 'px'; c.style.height = full.y + 'px';
      L.DomUtil.setPosition(c, tl);
      this._zoom = m.getZoom();
      this._bounds = L.latLngBounds(m.layerPointToLatLng(tl), m.layerPointToLatLng(tl.add(full)));
      var ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this._hits = drawStations(ctx, m, tl, full, this._bounds, this._zoom);
    },
    hit: function (layerPoint) {
      var best = null, bd = 22 * 22, h = this._hits || [];
      for (var i = 0; i < h.length; i++) { var dx = h[i].x - layerPoint.x, dy = h[i].y - layerPoint.y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = h[i].s; } }
      return best;
    }
  });

  // Heatmap de PRIX (pas de densité) : moyenne pondérée gaussienne des prix voisins, calculée sur une
  // grille grossière puis agrandie avec lissage. Vert fluo = pas cher, rouge = cher.
  var HEAT_LUT = (function () {
    var stops = [[0, 57, 255, 20], [0.28, 170, 255, 0], [0.5, 255, 225, 0], [0.75, 255, 130, 0], [1, 255, 20, 20]], lut = new Uint8Array(256 * 3);
    for (var i = 0; i < 256; i++) {
      var t = i / 255, k = 1; while (k < stops.length - 1 && stops[k][0] < t) k++;
      var a = stops[k - 1], b = stops[k], u = (t - a[0]) / (b[0] - a[0]);
      for (var c = 0; c < 3; c++) lut[i * 3 + c] = Math.round(a[c + 1] + (b[c + 1] - a[c + 1]) * u);
    }
    return lut;
  })();
  var heatCanvas = document.createElement('canvas');
  function drawHeat(ctx, pts, full, zoom) {
    var cell = 6, gw = Math.ceil(full.x / cell), gh = Math.ceil(full.y / cell);
    var R = Math.max(26, Math.min(120, 22 + (zoom - 5) * 11)), rc = Math.ceil(R / cell), sigma2 = 2 * Math.pow(R / cell / 2.3, 2);
    var size = 2 * rc + 1, kernel = new Float32Array(size * size), x, y;
    for (y = -rc; y <= rc; y++) for (x = -rc; x <= rc; x++) { var d2 = x * x + y * y; kernel[(y + rc) * size + x + rc] = d2 > rc * rc ? 0 : Math.exp(-d2 / sigma2); }
    var sw = new Float32Array(gw * gh), swt = new Float32Array(gw * gh);
    for (var i = 0; i < pts.length; i++) {
      var cx = Math.round(pts[i].x / cell), cy = Math.round(pts[i].y / cell), t = pts[i].t;
      if (cx < -rc || cy < -rc || cx >= gw + rc || cy >= gh + rc) continue;
      for (y = -rc; y <= rc; y++) { var gy = cy + y; if (gy < 0 || gy >= gh) continue;
        for (x = -rc; x <= rc; x++) { var gx = cx + x; if (gx < 0 || gx >= gw) continue;
          var w = kernel[(y + rc) * size + x + rc]; if (!w) continue; var idx = gy * gw + gx; sw[idx] += w; swt[idx] += w * t; } }
    }
    var boost = zoom < 8 ? 2.1 : zoom < 10 ? 1.7 : 1.35;
    heatCanvas.width = gw; heatCanvas.height = gh;
    var hctx = heatCanvas.getContext('2d'), img = hctx.createImageData(gw, gh), px = img.data, maxA = (state.theme === 'dark' ? 175 : 150) * (routeCtx ? 0.5 : 1); // plus discret sous un trajet
    for (i = 0; i < gw * gh; i++) {
      if (sw[i] < 0.03) continue;
      var li = Math.max(0, Math.min(255, Math.round((0.5 + (swt[i] / sw[i] - 0.5) * boost) * 255))) * 3; // contraste renforcé : la moyenne écrase les écarts
      px[i * 4] = HEAT_LUT[li]; px[i * 4 + 1] = HEAT_LUT[li + 1]; px[i * 4 + 2] = HEAT_LUT[li + 2];
      px[i * 4 + 3] = Math.min(1, sw[i] / 0.55) * maxA;
    }
    hctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(heatCanvas, 0, 0, gw * cell, gh * cell);
  }
  function lutColor(t) { var li = Math.max(0, Math.min(255, Math.round(t * 255))) * 3; return 'rgb(' + HEAT_LUT[li] + ',' + HEAT_LUT[li + 1] + ',' + HEAT_LUT[li + 2] + ')'; }

  var routeCtx = null; // trajet courant : { candidates:Set, ... }
  var viewStats = null;

  function drawStations(ctx, m, tl, full, bounds, zoom) {
    var fi = FUEL_INDEX[state.fuel], fis = displayFuels(), hits = [];
    var list = routeCtx ? routeCtx.candidateStations : stationsInBounds(bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast());
    // statistiques sur la zone réellement visible
    var vb = m.getBounds(), good = [], stale = [], rupt = [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i], k = pick(s, fis);
      if (k >= 0) { s._p = s.p[k]; good.push(s); continue; }
      if (state.brand && s.brand !== state.brand) continue;
      if (inRupture(s, fis)) rupt.push(s); else if (fis.some(function (f) { return s.p[f] > 0; })) stale.push(s); // prix trop ancien
    }
    var inView = good.filter(function (s) { return vb.contains([s.lat, s.lon]); });
    var prices = inView.map(function (s) { return s._p; }).sort(function (a, b) { return a - b; });
    var lo = 0, hi = 1, med = 0.5;
    if (prices.length) {
      med = prices[Math.floor(prices.length / 2)];
      lo = prices[Math.floor(prices.length * 0.05)]; hi = prices[Math.min(prices.length - 1, Math.floor(prices.length * 0.95))];
      if (med - lo < 0.01) lo = med - 0.01;
      if (hi - med < 0.01) hi = med + 0.01;
      var minS = inView[0], maxS = inView[0];
      inView.forEach(function (s) { if (s._p < minS._p) minS = s; if (s._p > maxS._p) maxS = s; });
      viewStats = { n: inView.length, min: minS, max: maxS, med: med };
    } else viewStats = { n: 0 };
    viewStats.rupt = rupt.filter(function (s) { return vb.contains([s.lat, s.lon]); }).length;
    viewStats.fresh = inView.filter(function (s) { return ageHours(s, pick(s, fis)) <= 6; }).length;
    renderStats();

    function tone(p) { return p <= med ? 0.5 * (p - lo) / (med - lo) : 0.5 + 0.5 * (p - med) / (hi - med); }
    function pt(s) { var p = m.latLngToLayerPoint([s.lat, s.lon]); return { x: p.x - tl.x, y: p.y - tl.y, lx: p.x, ly: p.y }; }
    ctx.clearRect(0, 0, full.x, full.y);

    if (zoom >= 10) {
      ctx.strokeStyle = state.theme === 'dark' ? 'rgba(160,170,185,.7)' : 'rgba(90,100,115,.7)'; ctx.lineWidth = 1.5;
      stale.forEach(function (s) { var p = pt(s); ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, 6.2832); ctx.stroke(); hits.push({ x: p.lx, y: p.ly, s: s }); });
    }
    if (zoom >= 9) { // ⊘ rouge : rupture déclarée sur le carburant (toujours visible : c'est l'info qui compte quand ça manque)
      var rr = zoom < 11 ? 5 : 7;
      rupt.forEach(function (s) {
        var p = pt(s); hits.push({ x: p.lx, y: p.ly, s: s });
        ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, 6.2832); ctx.moveTo(p.x - rr * 0.7, p.y + rr * 0.7); ctx.lineTo(p.x + rr * 0.7, p.y - rr * 0.7);
        ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.lineWidth = 4.5; ctx.stroke(); ctx.strokeStyle = '#ff5d5d'; ctx.lineWidth = 2.2; ctx.stroke();
      });
    }
    good.sort(function (a, b) { return a._p - b._p; });
    var pills = [], dots = [], usePills = zoom >= 10.5, occ = {}, heatPts = [];
    var shortage = state.shortage;
    good.forEach(function (s) {
      var p = pt(s); p.s = s; p.t = shortage ? confidence(s, pick(s, fis)).t : Math.max(0, Math.min(1, tone(s._p))); hits.push({ x: p.lx, y: p.ly, s: s }); heatPts.push(p);
      if (usePills) {
        var gx = Math.floor(p.x / 50), gy = Math.floor(p.y / 24), free = true, a, b;
        for (a = -1; a <= 1 && free; a++) for (b = -1; b <= 1; b++) { var o = occ[(gx + a) + ':' + (gy + b)]; if (o && Math.abs(o.x - p.x) < 50 && Math.abs(o.y - p.y) < 22) { free = false; break; } }
        if (free) { occ[gx + ':' + gy] = p; pills.push(p); return; }
      }
      dots.push(p);
    });
    drawHeat(ctx, heatPts, full, zoom); syncFresh(good, fis, zoom);
    var dark = state.theme === 'dark';
    if (zoom >= 8) { // points discrets : la couleur est portée par la heatmap
      var r = zoom < 9.5 ? 2 : zoom < 10.5 ? 3 : 4;
      for (i = dots.length - 1; i >= 0; i--) {
        var d = dots[i]; ctx.beginPath(); ctx.arc(d.x, d.y, r, 0, 6.2832);
        ctx.fillStyle = dark ? 'rgba(255,255,255,.92)' : 'rgba(20,25,35,.9)'; ctx.fill();
        ctx.strokeStyle = dark ? 'rgba(0,0,0,.7)' : 'rgba(255,255,255,.9)'; ctx.lineWidth = 1; ctx.stroke();
      }
    }
    if (state.favs.length) { // ★ au-dessus des stations favorites
      ctx.font = '700 17px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 3;
      good.concat(stale, rupt).forEach(function (s) { if (!isFav(s)) return; var p = pt(s); ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.strokeText('★', p.x, p.y - 17); ctx.fillStyle = '#ffd60a'; ctx.fillText('★', p.x, p.y - 17); });
    }
    ctx.font = '700 12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (i = pills.length - 1; i >= 0; i--) {
      var q = pills[i], w = 48, h = 21, x = q.x - w / 2, y = q.y - h / 2;
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, 10.5); else ctx.rect(x, y, w, h);
      ctx.fillStyle = dark ? 'rgba(12,15,20,.92)' : 'rgba(255,255,255,.96)'; ctx.fill();
      ctx.strokeStyle = lutColor(q.t); ctx.lineWidth = 2.2; ctx.stroke();
      ctx.fillStyle = dark ? '#fff' : '#15202b'; ctx.fillText(shortage ? shortAge(ageHours(q.s, pick(q.s, fis))) : price3(q.s._p), q.x, q.y + 0.5);
    }
    return hits;
  }

  var freshLayer = L.layerGroup().addTo(map), freshShown = '';
  function syncFresh(list, fis, zoom) { // halo animé sur les prix tout frais (≤ 2 h) : visibles d'un coup d'œil
    var vb = map.getBounds(), c = map.getCenter(), fresh = zoom >= 9 ? list.filter(function (s) { var k = pick(s, fis); return k >= 0 && ageHours(s, k) <= 2 && vb.contains([s.lat, s.lon]); }) : [];
    fresh.sort(function (a, b) { return Math.hypot(a.lat - c.lat, a.lon - c.lng) - Math.hypot(b.lat - c.lat, b.lon - c.lng); }); fresh = fresh.slice(0, 80);
    var key = fresh.map(function (s) { return s.id; }).join(','); if (key === freshShown) return; freshShown = key;
    freshLayer.clearLayers();
    fresh.forEach(function (s) { freshLayer.addLayer(L.marker([s.lat, s.lon], { icon: L.divIcon({ className: '', html: '<div class="fresh-ring"></div>', iconSize: [40, 40], iconAnchor: [20, 20] }), interactive: false, zIndexOffset: -100 })); });
  }
  var pulse = { min: null, max: null };
  function setPulse(kind, s) {
    if (!s) { if (pulse[kind]) { map.removeLayer(pulse[kind]); pulse[kind] = null; } return; }
    if (!pulse[kind]) pulse[kind] = L.marker([s.lat, s.lon], { icon: L.divIcon({ className: '', html: '<div class="pulse ' + kind + '"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), zIndexOffset: kind === 'min' ? 600 : 500 })
      .on('click', function () { if (viewStats && viewStats[kind]) openStation(viewStats[kind], false); }).addTo(map);
    else pulse[kind].setLatLng([s.lat, s.lon]);
  }
  function brandPill() { return '<span class="stat brand' + (state.brand ? ' on' : '') + '" data-brandpick>🏷️ ' + esc(state.brand || 'Enseignes') + '</span>'; }
  function renderStats() {
    var el = $('statbar'), v = viewStats, fi = FUEL_INDEX[state.fuel];
    setPulse('min', v && v.n > 1 && !routeCtx ? v.min : null); setPulse('max', v && v.n > 1 && !routeCtx && v.max._p > v.min._p + 0.0005 ? v.max : null);
    var ruptPill = v && v.rupt ? '<span class="stat rupt" title="Ruptures déclarées par les stations (prix-carburants.gouv.fr)">⊘ <b>' + num(v.rupt) + '</b> en rupture</span>' : '';
    var modePill = '<span class="stat mode' + (state.shortage ? ' on' : '') + '" data-shortage title="Colorer la carte selon la fraîcheur des prix plutôt que leur niveau">' + (state.shortage ? '⛽ Pénurie : fraîcheur' : '⛽ Pénurie ?') + '</span>';
    if (!v || !v.n) { el.innerHTML = stations.length ? brandPill() + modePill + '<span class="stat">Aucun prix ' + FUELS[fi].label + ' récent dans cette zone</span>' + ruptPill : ''; return; }
    if (state.shortage) { el.innerHTML = brandPill() + modePill + '<span class="stat min">🟢 <b>' + num(v.fresh) + '</b> mise' + (v.fresh > 1 ? 's' : '') + ' à jour < 6 h<span class="wide-only"> · ' + num(v.n) + ' stations</span></span>' + ruptPill; return; }
    el.innerHTML = brandPill() + modePill +
      '<span class="stat min" data-go="min">▼ <b>' + price3(v.min._p) + '</b> ' + esc(titleCase(v.min.ville)) + '</span>' +
      '<span class="stat">médiane <b>' + price3(v.med) + '</b><span class="wide-only"> · ' + num(v.n) + ' stations</span></span>' +
      '<span class="stat max" data-go="max">▲ <b>' + price3(v.max._p) + '</b></span>' + ruptPill;
  }
  $('statbar').addEventListener('click', function (e) {
    if (e.target.closest('[data-brandpick]')) return; // géré plus bas
    if (e.target.closest('[data-shortage]')) { state.shortage = !state.shortage; save(); refreshMap(); toast(state.shortage ? 'Carte colorée par fraîcheur du prix : vert = mis à jour il y a moins de 6 h, rouge = ancien ou rupture' : 'Carte colorée par prix'); if (currentTab === 'near') renderNear(); if (typeof updateHud === 'function') updateHud(); return; }
    var t = e.target.closest('[data-go]'); if (!t || !viewStats || !viewStats.n) return;
    openStation(viewStats[t.getAttribute('data-go')], true);
  });

  var layer = new StationLayer().addTo(map);
  function refreshMap() { layer.redraw(); }
  map.on('moveend', debounce(function () { if (map.getZoom() >= 7) { var b = map.getBounds(); ensureCountries(b.getSouth(), b.getWest(), b.getNorth(), b.getEast()); } }, 400));
  map.on('click', function (e) { var s = layer.hit(e.layerPoint); if (s) openStation(s, false); else if (!isWide() && !$('panel').classList.contains('hidden')) $('panel').classList.add('collapsed'); });
  map.on('moveend', debounce(function () { var c = map.getCenter(); state.view = { lat: +c.lat.toFixed(4), lon: +c.lng.toFixed(4), zoom: map.getZoom() }; save(); }, 800));

  function fillInfo(s, fi) {
    var c = car(), liters = Math.max(0, c.tank * (1 - startPct() / 100));
    return { liters: liters, cost: liters * s.p[fi] };
  }
  function openStation(s, fly) {
    var cfi = pick(s, displayFuels()), rows = ''; if (cfi < 0) cfi = FUEL_INDEX[state.fuel];
    var order = FUELS.map(function (f, i) { return i; }).sort(function (a, b) { return (s.t && s.t[b] || s.m[b] * 1440 || 0) - (s.t && s.t[a] || s.m[a] * 1440 || 0); }); // prix le plus récent en premier
    order.forEach(function (i) { var f = FUELS[i];
      var a = ageDays(s, i), rupt = s.r & (1 << i);
      if (!(s.p[i] > 0) && !rupt) return;
      if (i === FUEL_INDEX.e10 && s.e5) return; // prix repris du SP95-E5 : déjà affiché sur sa ligne
      var rd = rupt && s.rd && s.rd[i] ? Math.max(0, Math.floor(Date.now() / DAY) - s.rd[i]) : -1;
      rows += '<tr class="' + (i === cfi || (s.e5 && cfi === FUEL_INDEX.e10 && i === FUEL_INDEX.sp95) ? 'sel' : '') + (rupt ? ' rupt' : '') + '"><td>' + f.label + (rupt ? ' <span class="badge bad">⊘ rupture' + (rd >= 0 ? (rd === 0 ? " depuis auj." : rd === 1 ? ' depuis hier' : ' depuis ' + rd + ' j') : '') + '</span>' : '') + '</td><td>' + (s.p[i] > 0 ? price3(s.p[i]) + ' €' : '—') + '</td><td' + (a > 14 ? ' style="color:var(--warn)"' : '') + '>' + (s.p[i] > 0 ? whenText(s, i) : ageLabel(a)) + '</td></tr>';
    });
    var sc = score(s, displayFuels(), mePos ? haversine(mePos.lat, mePos.lon, s.lat, s.lon) : null), conf = cfi >= 0 && s.p[cfi] > 0 ? confidence(s, cfi) : null;
    var html = '<div class="pop"><h3>' + brandName(s) + esc(titleCase(s.ville)) + (s.hw ? '<span class="badge">Autoroute</span>' : '') + (s.a24 ? '<span class="badge">24/24</span>' : '') + '</h3>' +
      '<div class="addr">' + esc(titleCase(s.adr)) + ', ' + esc(s.cp) + (s.cc !== 'fr' ? ' · ' + FuelSources[s.cc].name : '') + '</div>' +
      (sc ? '<div class="scoreline">' + scoreBadge(sc) + '<span>' + scoreDetail(sc) + '</span></div>' : '') +
      (conf ? '<div class="conf c' + conf.level + '">' + (conf.hours != null ? conf.short.slice(0, 2) + ' ' + FUELS[cfi].label + ' mis à jour <b>' + whenText(s, cfi, true) + '</b> (' + agoText(conf.hours) + (conf.level === 3 ? ', moins de 6 h' : '') + ')' : conf.short) + ' · carburant <b>' + conf.label + '</b></div>' : '') + '<table>' + rows + '</table>';
    var carFi = FUEL_INDEX[car().fuel];
    if (s.p[carFi] > 0) { var fi2 = fillInfo(s, carFi); html += '<div class="fill">' + esc(car().name) + ' : ' + num(fi2.liters) + ' L de ' + FUELS[carFi].label + ' pour faire le plein ≈ <b>' + eur(fi2.cost) + '</b></div>'; }
    html += '<div class="links"><button data-fav="' + s.id + '">' + (isFav(s) ? '★ Favori' : '☆ Favori') + '</button>' + (s.cc === 'fr' ? '<button data-hist="' + s.id + '">📈 Historique</button>' : '') + navLinks(s, '') +
      (routeCtx && routeCtx.plan
        ? (routeCtx.plan.stops.some(function (st) { return st.station.s === s; }) ? '<button data-stop="' + s.id + '">🗑️ Ne plus m\'arrêter ici</button>'
          : routeCtx.cands.some(function (cd) { return cd.s === s; }) ? '<button data-stop="' + s.id + '">➕ M\'arrêter ici</button>' : '')
        : '<button data-dest="' + s.id + '">🏁 Trajet jusqu\'ici</button>') + '</div></div>';
    if (fly) map.setView([s.lat, s.lon], Math.max(map.getZoom(), 13));
    L.popup({ offset: [0, -6], maxWidth: 300, autoPanPaddingTopLeft: [10, 130 + safe.t], autoPanPaddingBottomRight: [10, popupBottomPad()] }).setLatLng([s.lat, s.lon]).setContent(html).openOn(map);
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-dest]'); if (!b) return;
    var s = stations.filter(function (x) { return String(x.id) === b.getAttribute('data-dest'); })[0]; if (!s) return;
    setPlace('to', { label: titleCase(s.adr) + ', ' + titleCase(s.ville), lat: s.lat, lon: s.lon }); map.closePopup(); showTab('route');
  });

  // ------------------------------------------------------------------ carburant, véhicule, thème
  function renderFuelChips() {
    $('fuelChips').innerHTML = FUELS.map(function (f) { return '<button class="chip' + (f.key === state.fuel ? ' on' : '') + '" role="tab" data-fuel="' + f.key + '">' + f.label + '</button>'; }).join('');
    var c = car(); $('vehicleBtn').textContent = '🚗 ' + c.name;
    var on = $('fuelChips').querySelector('.on'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  $('fuelChips').addEventListener('click', function (e) {
    var b = e.target.closest('[data-fuel]'); if (!b) return;
    state.fuel = b.getAttribute('data-fuel'); save(); renderFuelChips(); updateDataInfo();
    if (routeCtx) clearRoute(true);
    refreshMap(); if (nearActive()) renderNear();
  });
  $('vehicleBtn').addEventListener('click', function () { showTab('cars'); });
  $('themeBtn').addEventListener('click', function () { state.theme = state.theme === 'dark' ? 'light' : 'dark'; save(); applyTheme(); refreshMap(); });

  // ------------------------------------------------------------------ géolocalisation
  var meMarker = null, mePos = null;
  function locate() {
    return new Promise(function (res, rej) {
      if (!navigator.geolocation) return rej(new Error('Géolocalisation indisponible'));
      navigator.geolocation.getCurrentPosition(function (p) {
        mePos = { lat: p.coords.latitude, lon: p.coords.longitude };
        if (!meMarker) meMarker = L.marker([mePos.lat, mePos.lon], { icon: L.divIcon({ className: '', html: '<div class="me-marker"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), interactive: false }).addTo(map);
        else meMarker.setLatLng([mePos.lat, mePos.lon]);
        res(mePos);
      }, function (err) { rej(new Error(err.code === 1 ? 'Position refusée par le navigateur' : 'Position introuvable')); }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
    });
  }
  $('locateBtn').addEventListener('click', function () { locate().then(function (p) { map.setView([p.lat, p.lon], 12); }).catch(function (e) { toast(e.message); }); });

  // ------------------------------------------------------------------ mode voiture : gros contrôles, suivi GPS, prochaine station
  var carMode = false, follow = false, watchId = null, lastFix = null, hudTimer = null;
  function setCarMode(on, silent) {
    carMode = on; document.documentElement.toggleAttribute('data-car', on);
    $('carBtn').style.borderColor = on ? 'var(--accent)' : ''; $('followBtn').hidden = !on; $('hud').hidden = !on;
    if (on) { startWatch(); setFollow(true); updateHud(); if (!silent) toast('🚗 Mode voiture : suivi GPS et prochaine station en bas de la carte'); }
    else { setFollow(false); stopWatch(); }
    setTimeout(function () { map.invalidateSize(); refreshMap(); }, 250);
  }
  function setFollow(on) { follow = on; $('followBtn').style.borderColor = on ? 'var(--accent)' : ''; if (on && lastFix) map.setView([lastFix.lat, lastFix.lon], Math.max(map.getZoom(), 12)); }
  function startWatch() {
    if (watchId != null || !navigator.geolocation) return;
    watchId = navigator.geolocation.watchPosition(function (p) {
      lastFix = mePos = { lat: p.coords.latitude, lon: p.coords.longitude, speed: p.coords.speed };
      if (!meMarker) meMarker = L.marker([mePos.lat, mePos.lon], { icon: L.divIcon({ className: '', html: '<div class="me-marker"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), interactive: false }).addTo(map);
      else meMarker.setLatLng([mePos.lat, mePos.lon]);
      if (follow) map.panTo([mePos.lat, mePos.lon], { animate: true });
      clearTimeout(hudTimer); hudTimer = setTimeout(updateHud, 300);
    }, function () { }, { enableHighAccuracy: true, maximumAge: 5000 });
  }
  function stopWatch() { if (watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(watchId); watchId = null; }
  function progressKm(R, p) { // avancement du GPS le long du trajet planifié (projection sur le point le plus proche)
    var best = Infinity, km = 0;
    for (var i = 0; i < R.pts.length; i += 2) { var d = haversine(p.lat, p.lon, R.pts[i][0], R.pts[i][1]); if (d < best) { best = d; km = R.cum[i]; } }
    return { km: km, off: best };
  }
  function updateHud() {
    if (!carMode) return;
    var el = $('hud'), c = car(), fis = fuelsFor(c.fuel), fi = FUEL_INDEX[c.fuel], html = '';
    if (!lastFix) { el.innerHTML = '<div class="k">🛰️ En attente du GPS…</div><div class="d">Autorise la position pour voir la prochaine station.</div>'; return; }
    var s = null, k = -1, why = '', dist = 0, R = routeCtx;
    if (R && R.plan && R.plan.stops.length) {
      var pr = progressKm(R, lastFix), st = null;
      for (var i = 0; i < R.plan.stops.length; i++) if (R.plan.stops[i].pos > pr.km + 0.5) { st = R.plan.stops[i]; break; }
      if (st) { s = st.station.s; k = st.station.fi; dist = st.pos - pr.km; why = '⛽ Prochain arrêt prévu · km ' + num(st.pos) + ' · mets ' + num(st.buyL, st.buyL < 10 ? 1 : 0) + ' L'; }
      else if (pr.off < 5) why = '🏁 Plus d\'arrêt prévu jusqu\'à l\'arrivée';
    }
    if (!s) {
      var liters = Math.max(5, c.tank * (1 - startPct() / 100)), d = 15 / 111, dl = d / Math.cos(lastFix.lat * Math.PI / 180), best = null;
      stationsInBounds(lastFix.lat - d, lastFix.lon - dl, lastFix.lat + d, lastFix.lon + dl).forEach(function (x) {
        var kk = pick(x, fis); if (kk < 0) return; var dd = haversine(lastFix.lat, lastFix.lon, x.lat, x.lon); if (dd > 15) return;
        var real = (liters + 2 * dd * DETOUR_FACTOR * c.cons / 100) * x.p[kk]; if (!best || real < best.real) best = { s: x, k: kk, d: dd, real: real };
      });
      if (best) { s = best.s; k = best.k; dist = best.d * DETOUR_FACTOR; why = why || '💰 Meilleur plein à moins de 15 km (' + num(liters) + ' L)'; }
    }
    if (!s) { el.innerHTML = '<div class="k">' + (why || '⛽ Aucune station ' + FUELS[fi].label + ' à moins de 15 km') + '</div>'; return; }
    html = '<div class="k">' + why + '</div><div class="t">' + brandName(s) + esc(titleCase(s.ville)) + '</div>' +
      '<div class="p">' + price3(s.p[k]) + ' <small>€/L ' + FUELS[k].label + ' · ' + whenText(s, k) + '</small></div>' +
      '<div class="d conf c' + confidence(s, k).level + '">' + confidence(s, k).short + '</div>' +
      '<div class="d">📍 ' + esc(titleCase(s.adr)) + ' · ≈ ' + num(dist) + ' km' + (lastFix.speed > 1 ? ' · ' + num(lastFix.speed * 3.6) + ' km/h' : '') + '</div>' +
      '<div class="row">' + navLinks(s, 'primary') +
      '<button class="secondary" data-hudshow="' + s.id + '">🗺️</button></div>';
    el.innerHTML = html;
    try { if (window.AndroidAuto && window.AndroidAuto.setTarget) window.AndroidAuto.setTarget(s.lat, s.lon, (s.brand ? s.brand + ' ' : '') + titleCase(s.ville) + ' · ' + price3(s.p[k]) + ' €'); } catch (e) { }
  }
  // Gestes relayés par Android Auto (écran de la voiture) et zone visible hors bandeaux de l'hôte
  function carPan(dx, dy) { setFollow(false); map.panBy([dx, dy], { animate: false }); }
  function carZoom(scale, fx, fy) { setFollow(false); map.setZoomAround(L.point(fx, fy), map.getZoom() + Math.log(scale) / Math.LN2, { animate: false }); }
  function carInsets(t, r, b, l) { // zone de la page non couverte par l'hôte Android Auto (sa carte d'infos, ses boutons)
    safe = { t: t, r: r, b: b, l: l }; var st = document.documentElement.style;
    st.setProperty('--safe-t', t + 'px'); st.setProperty('--safe-b', b + 'px'); st.setProperty('--safe-l', l + 'px'); st.setProperty('--safe-r', r + 'px');
    applyLayout(); map.invalidateSize(); if (routeCtx && routeCtx.bounds) setTimeout(fitRoute, 100);
  }
  $('hud').addEventListener('click', function (e) { var b = e.target.closest('[data-hudshow]'); if (!b) return; var s = stations.filter(function (x) { return String(x.id) === b.getAttribute('data-hudshow'); })[0]; if (s) { setFollow(false); openStation(s, true); } });
  $('carBtn').addEventListener('click', function () { if (carMode) { state.carMode = false; save(); setCarMode(false); return; } gate('car', function () { state.carMode = true; save(); setCarMode(true); }); });
  $('followBtn').addEventListener('click', function () { setFollow(!follow); if (follow && !lastFix) locate().then(function (p) { lastFix = p; setFollow(true); }).catch(function (e) { toast(e.message); }); });
  map.on('dragstart', function () { if (follow) setFollow(false); });

  // ------------------------------------------------------------------ onglets / panneau
  var currentTab = 'map';
  function showTab(name) {
    currentTab = name;
    document.querySelectorAll('#tabs button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === name); });
    var p = $('panel');
    if (name === 'map') { p.classList.add('hidden'); p.classList.remove('collapsed'); if (isWide()) { showTab('route'); } return; }
    p.classList.remove('hidden', 'collapsed');
    document.querySelectorAll('#panel .tab').forEach(function (t) { t.hidden = t.getAttribute('data-tab') !== name; });
    if (name === 'near') renderNear();
    if (name === 'cars') renderCars();
    $('panelBody').scrollTop = 0;
  }
  function nearActive() { return currentTab === 'near'; }
  $('tabs').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) showTab(b.getAttribute('data-tab')); });
  (function () {
    var panel = $('panel'), handle = $('panelHandle'), startY = null, base = 0, moved = false;
    function closedOffset() { return panel.offsetHeight - 34; }
    function down(ev) { if (isWide()) return; startY = (ev.touches ? ev.touches[0] : ev).clientY; base = panel.classList.contains('collapsed') ? closedOffset() : 0; moved = false; panel.classList.add('dragging'); }
    function move(ev) {
      if (startY == null) return; var dy = (ev.touches ? ev.touches[0] : ev).clientY - startY; if (Math.abs(dy) > 6) moved = true;
      panel.style.transform = 'translateY(' + Math.max(0, Math.min(closedOffset(), base + dy)) + 'px)'; if (ev.cancelable) ev.preventDefault();
    }
    function up(ev) {
      if (startY == null) return; var dy = ((ev.changedTouches ? ev.changedTouches[0] : ev).clientY) - startY; startY = null;
      panel.classList.remove('dragging'); panel.style.transform = '';
      var collapse = moved ? (dy > 40 ? true : dy < -40 ? false : panel.classList.contains('collapsed')) : !panel.classList.contains('collapsed'); // simple toucher = bascule
      panel.classList.toggle('collapsed', collapse); fitRoute();
    }
    // Pointer Events : un seul flux pour le doigt et la souris (pas de double déclenchement toucher + clic émulé)
    handle.addEventListener('pointerdown', function (ev) { try { handle.setPointerCapture(ev.pointerId); } catch (e) { } down(ev); });
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
  })();
  function popupBottomPad() { var h = $('hud'); return (carMode && h && !h.hidden ? h.offsetHeight + 30 : 80) + safe.b; }
  function fitRoute() { if (routeCtx && routeCtx.bounds) map.fitBounds(routeCtx.bounds, panelPadding()); }
  function panelPadding() {
    if (isWide()) return { paddingTopLeft: [30, 110 + safe.t], paddingBottomRight: [30, 30 + safe.b] }; // la carte commence après la colonne
    var p = $('panel'), open = !p.classList.contains('hidden') && !p.classList.contains('collapsed');
    return { paddingTopLeft: [30, 120 + safe.t], paddingBottomRight: [30, (open ? p.offsetHeight : 26) + 70 + safe.b] };
  }

  // ------------------------------------------------------------------ pastille d'enseigne, favoris, note
  // Pas de logos de marques (ils appartiennent aux enseignes) : une pastille à initiales, couleur tirée du nom.
  // Un fichier icons/brands/<slug>.png|svg|webp déposé par l'utilisateur remplace la pastille (l'appli ne fournit aucun logo).
  // Couleurs dominantes des enseignes [fond, texte] ; à défaut, une teinte tirée du nom.
  var BRAND_COLORS = { 'totalenergies': ['#E30613', '#fff'], 'intermarche': ['#C8102E', '#fff'], 'carrefour': ['#004E9F', '#fff'], 'systeme-u': ['#003B7A', '#fff'], 'e-leclerc': ['#0066B3', '#F7941D'],
    'esso': ['#0033A0', '#fff'], 'avia': ['#D2001C', '#fff'], 'auchan': ['#E0001A', '#fff'], 'eni': ['#FFD200', '#111'], 'netto': ['#FFD500', '#D4001A'], 'bp': ['#009B3A', '#FFE600'], 'dyneff': ['#003DA5', '#fff'],
    'shell': ['#FBCE07', '#DD1D21'], 'elan': ['#0072BC', '#fff'], 'vito': ['#00843D', '#fff'], 'casino': ['#00693E', '#fff'], 'cora': ['#E30613', '#fff'], 'repsol': ['#FF8200', '#fff'], 'cepsa': ['#D50032', '#fff'],
    'galp': ['#F36F21', '#fff'], 'q8': ['#003A70', '#FFD100'], 'ip': ['#003DA5', '#FFD100'], 'tamoil': ['#003DA5', '#fff'], 'prio': ['#E4002B', '#fff'], 'ballenoil': ['#00A3E0', '#fff'], 'plenergy': ['#78BE20', '#fff'],
    'petroprix': ['#E4002B', '#fff'], 'alcampo': ['#E0001A', '#fff'], 'eroski': ['#E30613', '#fff'] };
  var logoState = {}; // slug → 'png' | 'svg' | 'webp' | false | 'probing'
  function brandSlug(name) { return name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function probeLogo(slug, exts) {
    if (!exts.length) { logoState[slug] = false; return; }
    var img = new Image();
    img.onload = function () { logoState[slug] = exts[0]; document.querySelectorAll('.bb[data-slug="' + slug + '"]').forEach(function (el) { el.outerHTML = logoImg(slug); }); };
    img.onerror = function () { probeLogo(slug, exts.slice(1)); };
    img.src = 'icons/brands/' + slug + '.' + exts[0];
  }
  function logoImg(slug) { return '<img class="bl" src="icons/brands/' + slug + '.' + logoState[slug] + '" alt="">'; }
  function brandBadge(name) {
    if (!name) return '';
    var slug = brandSlug(name);
    if (logoState[slug] === undefined) { logoState[slug] = 'probing'; probeLogo(slug, ['png', 'svg', 'webp']); }
    else if (logoState[slug] && logoState[slug] !== 'probing') return logoImg(slug);
    var w = name.replace(/[^A-Za-zÀ-ÿ0-9 ]/g, ' ').trim().split(/\s+/), ini = (w.length > 1 ? w[0][0] + w[1][0] : name.replace(/[^A-Za-zÀ-ÿ0-9]/g, '').slice(0, 2)).toUpperCase(), h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    var col = BRAND_COLORS[slug];
    return '<span class="bb" data-slug="' + slug + '" style="background:' + (col ? col[0] + ';color:' + col[1] : 'hsl(' + h + ',52%,36%)') + '" aria-hidden="true">' + esc(ini) + '</span>';
  }
  function brandName(s) { return s.brand ? brandBadge(s.brand) + esc(s.brand) + ' · ' : ''; }
  function isFav(s) { return state.favs.indexOf(String(s.id)) >= 0; }
  function toggleFav(s) { var id = String(s.id), i = state.favs.indexOf(id); if (i >= 0) state.favs.splice(i, 1); else state.favs.push(id); save(); refreshMap(); if (nearActive()) renderNear(); return i < 0; }

  // Note /10 : d'abord l'heure du dernier prix (5 pts), puis la proximité (2 pts, quand on connaît la distance), puis le prix (3 pts).
  function score(s, fis, distKm) {
    var k = pickAny(s, fis); if (k < 0) return null;
    var p = s.p[k], d = 25 / 111, dl = d / Math.cos(s.lat * Math.PI / 180), cheaper = 0, same = 0, n = 0;
    stationsInBounds(s.lat - d, s.lon - dl, s.lat + d, s.lon + dl).forEach(function (o) { var ko = pickAny(o, fis); if (ko < 0) return; n++; if (o.p[ko] > p + 0.0005) cheaper++; else if (Math.abs(o.p[ko] - p) <= 0.0005) same++; });
    var price = n >= 4 ? 3 * (cheaper + 0.5 * (same - 1)) / Math.max(1, n - 1) : 1.5;          // part des voisines plus chères
    var h = ageHours(s, k), fresh = h < 1 ? 5 : h <= 6 ? 4.5 : h <= 12 ? 3.5 : h <= 24 ? 2.5 : h <= 48 ? 1.5 : h <= 72 ? 0.8 : Math.max(0, 0.5 * (1 - h / 24 / 10));
    var mask = 0; fis.forEach(function (f) { if (s.p[f] > 0) mask |= (1 << f); }); if (s.r & mask) fresh = Math.min(fresh, 1); // rupture déclarée sur un carburant compatible
    var near = distKm == null ? null : 2 * Math.max(0, 1 - Math.max(0, distKm - 1) / 14);       // 2 pts à moins d'1 km, 0 à 15 km
    var total = near == null ? (fresh + price) * 10 / 8 : fresh + price + near;
    return { total: Math.max(0, Math.min(10, total)), price: price, fresh: fresh, near: near, hours: h, n: n, k: k };
  }
  function scoreDetail(sc) { return 'fraîcheur ' + num(sc.fresh, 1) + '/5' + (sc.near != null ? ' · proximité ' + num(sc.near, 1) + '/2' : '') + ' · prix ' + num(sc.price, 1) + '/3'; }
  function scoreBadge(sc) { if (!sc) return ''; var t = sc.total, col = t >= 7 ? 'var(--accent)' : t >= 4.5 ? 'var(--warn)' : 'var(--bad)'; return '<span class="score" style="border-color:' + col + '">' + (t >= 7 ? '👍' : t >= 4.5 ? '👌' : '👎') + ' ' + num(t, 1) + '<small>/10</small></span>'; }

  // ------------------------------------------------------------------ fenêtre modale
  function openModal(html) { $('modalBody').innerHTML = html; $('modal').hidden = false; $('modal').querySelector('.sheet').scrollTop = 0; }
  function closeModal() { $('modal').hidden = true; $('modalBody').innerHTML = ''; }
  $('modalClose').addEventListener('click', closeModal);
  $('modal').addEventListener('click', function (e) { if (e.target === this) closeModal(); });

  // ------------------------------------------------------------------ filtre par enseigne
  var brandSort = 'avg';
  function openBrandPicker() {
    var fis = displayFuels(), agg = {};
    stations.forEach(function (s) { if (!s.brand) return; var k = pickAny(s, fis); if (k < 0) return; var a = agg[s.brand] || (agg[s.brand] = { n: 0, sum: 0, min: Infinity }); a.n++; a.sum += s.p[k]; if (s.p[k] < a.min) a.min = s.p[k]; });
    var names = Object.keys(agg).filter(function (n) { return agg[n].n >= 3; });
    names.sort(brandSort === 'avg' ? function (a, b) { return agg[a].sum / agg[a].n - agg[b].sum / agg[b].n; } : brandSort === 'min' ? function (a, b) { return agg[a].min - agg[b].min; } : function (a, b) { return agg[b].n - agg[a].n; });
    openModal('<h3>🏷️ Filtrer par enseigne</h3><p class="hint">' + FUELS[FUEL_INDEX[state.fuel]].label + ' · prix récents, toutes zones chargées. Le filtre s\'applique à la carte, à « Proximité » et aux arrêts d\'un trajet. ' + (brandMap ? '' : 'Les enseignes françaises ne sont pas encore chargées. ') + 'Enseignes françaises : OpenStreetMap.</p>' +
      '<div class="seg"><button data-bsort="avg" class="' + (brandSort === 'avg' ? 'on' : '') + '">Prix moyen</button><button data-bsort="min" class="' + (brandSort === 'min' ? 'on' : '') + '">Prix mini</button><button data-bsort="n" class="' + (brandSort === 'n' ? 'on' : '') + '">Nb de stations</button></div>' +
      '<div class="brand-list"><button data-brand="" class="' + (state.brand ? '' : 'on') + '"><span>Toutes les enseignes</span></button>' +
      names.slice(0, 60).map(function (n) { var a = agg[n]; return '<div class="brow"><button data-brand="' + esc(n) + '" class="' + (n === state.brand ? 'on' : '') + '"><span>' + brandBadge(n) + esc(n) + '<small> · ' + num(a.n) + '</small></span><span class="bp">min <b>' + price3(a.min) + '</b> · moy <b>' + price3(a.sum / a.n) + '</b></span></button></div>'; }).join('') + '</div>');
  }
  function setBrand(b) {
    state.brand = b; save(); closeModal(); $('brandBtn2').textContent = b ? '🏷️ ' + b + ' uniquement' : 'Toutes les enseignes';
    if (routeCtx) { clearRoute(true); toast('Filtre modifié — relance « Proposer mes arrêts »'); }
    refreshMap(); if (nearActive()) renderNear();
  }
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-brandpick]')) { openBrandPicker(); return; }
    var bs = e.target.closest('[data-bsort]'); if (bs) { brandSort = bs.getAttribute('data-bsort'); openBrandPicker(); return; }
    var b = e.target.closest('[data-brand]'); if (b) { setBrand(b.getAttribute('data-brand')); return; }
    var h = e.target.closest('[data-help]'); if (h) { e.preventDefault(); openFuelHelp(); return; }
    var fb = e.target.closest('[data-fav]'); if (fb) { var fs = stations.filter(function (x) { return String(x.id) === fb.getAttribute('data-fav'); })[0]; if (fs) { var on = toggleFav(fs); fb.textContent = on ? '★ Favori' : '☆ Favori'; toast(on ? '★ Ajoutée aux favoris (onglet Proximité → Favoris)' : 'Retirée des favoris'); } return; }
    var hb = e.target.closest('[data-hist]'); if (hb) { var st = stations.filter(function (x) { return String(x.id) === hb.getAttribute('data-hist'); })[0]; if (st) openHistory(st); }
  });

  // ------------------------------------------------------------------ historique des prix d'une station (France)
  var histCache = {};
  function loadHistory(dep) {
    if (histCache[dep]) return histCache[dep];
    var bases = [(window.FUELMAP_CONFIG || {}).dataBase, ''].filter(function (b, i) { return b || i === 1; });
    var tryBase = function (i) { return fetch(bases[i] + 'data/hist/' + dep + '.json').then(function (r) { if (!r.ok) throw new Error('absent'); return r.json(); }).catch(function (e) { if (i + 1 < bases.length) return tryBase(i + 1); throw e; }); };
    return (histCache[dep] = tryBase(0).catch(function (e) { delete histCache[dep]; throw e; }));
  }
  function openHistory(s) {
    openModal('<h3>📈 ' + brandName(s) + esc(titleCase(s.ville)) + '</h3><p class="hint">' + esc(titleCase(s.adr)) + '</p><div class="hist" id="histBox"><p class="hint">⏳ Chargement de l\'historique…</p></div>');
    loadHistory(String(s.cp).slice(0, 2)).then(function (shard) {
      var h = shard.s[s.id]; if (!$('histBox')) return;
      if (!h) { $('histBox').innerHTML = '<p class="hint">Pas d\'historique pour cette station.</p>'; return; }
      var fuels = Object.keys(h).map(Number).sort(), cur = displayFuels().filter(function (k) { return h[k]; })[0]; if (cur == null) cur = fuels[0];
      (function show(fi) {
        $('histBox').innerHTML = '<div class="hist-tabs">' + fuels.map(function (k) { return '<button class="chip' + (k === fi ? ' on' : '') + '" data-hf="' + k + '">' + FUELS[k].label + '</button>'; }).join('') + '</div>' + historyChart(s, fi, h[fi], shard);
        $('histBox').querySelectorAll('[data-hf]').forEach(function (b) { b.addEventListener('click', function () { show(+b.getAttribute('data-hf')); }); });
        wireHistoryHover();
      })(cur);
    }).catch(function () { if ($('histBox')) $('histBox').innerHTML = '<p class="hint">Historique indisponible : il est préparé par la mise à jour automatique du site (voir README).</p>'; });
  }
  var histPts = null;
  function historyChart(s, fi, flat, shard) {
    var today = Math.floor(Date.now() / DAY), from = today - (shard.days || 180), pts = [];
    for (var i = 0; i < flat.length; i += 2) pts.push({ d: Math.max(flat[i], from), v: flat[i + 1] / 1000 });
    if (s.p[fi] > 0 && s.m[fi] && Math.abs(s.p[fi] - pts[pts.length - 1].v) > 0.0005) pts.push({ d: s.m[fi], v: s.p[fi] }); // prix en direct, plus récent que l'archive
    var lo = Infinity, hi = -Infinity; pts.forEach(function (p) { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; });
    var pad = Math.max(0.01, (hi - lo) * 0.12), y0 = lo - pad, y1 = hi + pad, W = 600, H = 200, L = 46, R = 8, T = 8, B = 22;
    var x = function (d) { return L + (d - from) / (today - from) * (W - L - R); }, y = function (v) { return T + (y1 - v) / (y1 - y0) * (H - T - B); };
    var path = '', k; for (k = 0; k < pts.length; k++) path += (k ? 'H' + x(pts[k].d).toFixed(1) + 'V' : 'M' + x(pts[k].d).toFixed(1) + ' ') + y(pts[k].v).toFixed(1); // courbe en escalier : un prix vaut jusqu'au changement suivant
    path += 'H' + x(today).toFixed(1);
    var grid = '', ticks = 4; for (k = 0; k <= ticks; k++) { var v = y0 + (y1 - y0) * k / ticks; grid += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text class="axis" x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + v.toFixed(2).replace('.', ',') + '</text>'; }
    var months = ''; for (var d = from; d <= today; d++) { var dt = new Date(d * DAY); if (dt.getUTCDate() === 1) months += '<text class="axis" x="' + x(d) + '" y="' + (H - 6) + '" text-anchor="middle">' + dt.toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' }) + '</text>'; }
    histPts = { pts: pts, x: x, y: y, from: from, today: today, W: W, L: L, R: R, T: T, H: H, B: B };
    var last = pts[pts.length - 1].v, first = pts[0].v, avg = 0, span = 0;
    for (k = 0; k < pts.length; k++) { var w = (k + 1 < pts.length ? pts[k + 1].d : today + 1) - pts[k].d; avg += pts[k].v * w; span += w; } avg /= span || 1;
    var rows = pts.slice().reverse().slice(0, 40).map(function (p) { return '<tr><td>' + new Date(p.d * DAY).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) + '</td><td>' + price3(p.v) + ' €</td></tr>'; }).join('');
    return '<div class="tip" id="histTip">' + FUELS[fi].label + ' · aujourd\'hui <b>' + price3(last) + ' €</b> · touche la courbe pour lire un jour</div>' +
      '<svg id="histSvg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Prix du ' + FUELS[fi].label + ' sur 6 mois">' + grid + months +
      '<path class="area" d="' + path + 'V' + (H - B) + 'H' + x(pts[0].d).toFixed(1) + 'Z"/><path class="line" d="' + path + '" vector-effect="non-scaling-stroke"/>' +
      '<line class="cross" id="histCross" y1="' + T + '" y2="' + (H - B) + '" x1="-9" x2="-9"/><circle class="pt" id="histDot" r="5" cx="-9" cy="-9"/></svg>' +
      '<div class="kpis"><div>Plus bas<b>' + price3(lo) + ' €</b></div><div>Moyenne<b>' + price3(avg) + ' €</b></div><div>Plus haut<b>' + price3(hi) + ' €</b></div></div>' +
      '<p class="hint">Sur 6 mois : ' + (last > first ? '🔺 +' : '🔻 −') + num(Math.abs(last - first) * 100, 1) + ' centimes · ' + (pts.length - 1) + ' changements de prix. Source : archives prix-carburants.gouv.fr.</p>' +
      '<details><summary>Voir les valeurs</summary><table>' + rows + '</table></details>';
  }
  function wireHistoryHover() {
    var svg = $('histSvg'), P = histPts; if (!svg || !P) return;
    var move = function (ev) {
      var r = svg.getBoundingClientRect(), cx = (ev.touches ? ev.touches[0] : ev).clientX, px = (cx - r.left) / r.width * P.W;
      var d = Math.round(P.from + (px - P.L) / (P.W - P.L - P.R) * (P.today - P.from)); d = Math.max(P.pts[0].d, Math.min(P.today, d));
      var cur = P.pts[0]; P.pts.forEach(function (p) { if (p.d <= d) cur = p; });
      $('histCross').setAttribute('x1', P.x(d)); $('histCross').setAttribute('x2', P.x(d)); $('histDot').setAttribute('cx', P.x(d)); $('histDot').setAttribute('cy', P.y(cur.v));
      $('histTip').innerHTML = new Date(d * DAY).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' }) + ' · <b>' + price3(cur.v) + ' €</b>';
    };
    svg.addEventListener('mousemove', move); svg.addEventListener('touchstart', move, { passive: true }); svg.addEventListener('touchmove', move, { passive: true });
  }

  // ------------------------------------------------------------------ aide : quel carburant ?
  function openFuelHelp() {
    var med = FUELS.map(function (f, i) { var a = []; (byCountry.fr || []).forEach(function (s) { if (s.p[i] > 0 && ageDays(s, i) <= 7) a.push(s.p[i]); }); a.sort(function (x, y) { return x - y; }); return a.length ? a[Math.floor(a.length / 2)] : 0; });
    var pr = function (k) { var v = med[FUEL_INDEX[k]]; return v ? ' <span class="badge">médiane ' + price3(v) + ' €</span>' : ''; };
    openModal('<h3>⛽ Quel carburant choisir ?</h3><p>Regarde l\'étiquette dans la trappe à carburant ou le manuel : c\'est elle qui fait foi.</p><ul>' +
      '<li><b>SP95-E10</b>' + pr('e10') + ' — essence avec jusqu\'à 10 % d\'éthanol. Accepté par presque toutes les voitures essence depuis 2000. En général le moins cher des sans-plomb ; consomme à peine plus (≈ 1 à 2 %).</li>' +
      '<li><b>SP95</b> (E5)' + pr('sp95') + ' — même indice d\'octane (95), 5 % d\'éthanol maximum. Pour les moteurs non compatibles E10 (anciennes, certaines motos).</li>' +
      '<li><b>SP98</b> (E5)' + pr('sp98') + ' — indice d\'octane 98. Utile seulement si le constructeur le demande (moteurs sportifs, certaines turbo). Sinon tu paies plus cher pour rien.</li>' +
      '<li><b>E85</b>' + pr('e85') + ' — 65 à 85 % d\'éthanol. Seulement pour les voitures flexfuel ou équipées d\'un boîtier homologué. Consomme ≈ 20 à 25 % de plus, mais reste nettement moins cher au kilomètre.</li>' +
      '<li><b>Gazole</b> (B7)' + pr('gazole') + ' — moteurs diesel uniquement.</li><li><b>GPLc</b>' + pr('gplc') + ' — voitures équipées GPL uniquement.</li></ul>' +
      '<p><b>Dans l\'appli :</b> choisis le carburant le plus « bas » que ta voiture accepte. Si tu choisis SP95-E10, les trajets te proposeront aussi du SP95 ou du SP98 quand ils sont moins chers ou les seuls disponibles (à l\'étranger par exemple) ; l\'inverse n\'est jamais fait.</p>' +
      '<p><b>⊘ Ruptures :</b> une station qui déclare ne plus avoir ton carburant apparaît barrée en rouge sur la carte et dans les listes, et n\'est jamais proposée sur un trajet. Cette information vient des gérants eux-mêmes (prix-carburants.gouv.fr) : en période de pénurie, tous ne la mettent pas à jour, une station non barrée peut donc quand même être à sec. Un prix mis à jour aujourd\'hui est le meilleur indice qu\'il y a du carburant.</p>');
  }

  // ------------------------------------------------------------------ véhicules
  function renderCars() {
    $('carList').innerHTML = state.cars.map(function (c) {
      var active = c.id === state.activeCar, range = Math.round((c.tank - c.reserve) / c.cons * 100);
      return '<div class="card car' + (active ? ' active' : '') + '"><div><div class="name">' + esc(c.name) + '</div><div class="sub">' + FUELS[FUEL_INDEX[c.fuel]].label + ' · ' + num(c.tank) + ' L · ' + num(c.cons, 1) + ' L/100 · réserve ' + num(c.reserve, 1) + ' L · ≈ ' + num(range) + ' km utiles</div></div>' +
        '<div class="btns">' + (active ? '' : '<button class="use" data-use="' + c.id + '">Utiliser</button>') + '<button data-edit="' + c.id + '">Modifier</button>' + (state.cars.length > 1 ? '<button data-del="' + c.id + '">✕</button>' : '') + '</div></div>';
    }).join('');
  }
  function useCar(id) { state.activeCar = id; state.fuel = car().fuel; save(); renderFuelChips(); renderCars(); updateSliders(); updateDataInfo(); if (routeCtx) clearRoute(true); refreshMap(); }
  function openCarForm(c) {
    $('carForm').hidden = false; $('carId').value = c ? c.id : '';
    $('carName').value = c ? c.name : ''; $('carFuel').value = c ? c.fuel : state.fuel;
    $('carTank').value = c ? c.tank : 50; $('carCons').value = c ? c.cons : 6.5; $('carReserve').value = c ? c.reserve : 5;
    $('carName').focus();
  }
  $('carFuel').innerHTML = FUELS.map(function (f) { return '<option value="' + f.key + '">' + f.label + '</option>'; }).join('');
  $('carList').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var id = b.getAttribute('data-use') || b.getAttribute('data-edit') || b.getAttribute('data-del');
    if (b.hasAttribute('data-use')) { useCar(id); toast('Véhicule actif : ' + car().name); }
    else if (b.hasAttribute('data-edit')) openCarForm(state.cars.filter(function (c) { return c.id === id; })[0]);
    else if (b.hasAttribute('data-del')) { state.cars = state.cars.filter(function (c) { return c.id !== id; }); if (state.activeCar === id) useCar(state.cars[0].id); save(); renderCars(); }
  });
  $('addCar').addEventListener('click', function () { openCarForm(null); });
  $('carCancel').addEventListener('click', function () { $('carForm').hidden = true; });
  $('carForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var tank = +$('carTank').value, c = { id: $('carId').value || 'c' + Date.now(), name: $('carName').value.trim() || 'Véhicule', fuel: $('carFuel').value, tank: tank, cons: +$('carCons').value, reserve: Math.min(+$('carReserve').value || 0, tank / 2) };
    var idx = state.cars.map(function (x) { return x.id; }).indexOf(c.id);
    if (idx >= 0) state.cars[idx] = c; else state.cars.push(c);
    $('carForm').hidden = true; useCar(c.id);
  });

  // ------------------------------------------------------------------ premier lancement : véhicule obligatoire
  var obFuel = null;
  function showOnboarding() {
    $('onboard').hidden = false;
    $('obFuel').innerHTML = FUELS.map(function (f) { return '<button type="button" class="chip" data-f="' + f.key + '">' + f.label + '</button>'; }).join('');
  }
  $('obFuel').addEventListener('click', function (e) {
    var b = e.target.closest('[data-f]'); if (!b) return; obFuel = b.getAttribute('data-f');
    this.querySelectorAll('.chip').forEach(function (x) { x.classList.toggle('on', x === b); }); $('obErr').hidden = true;
  });
  $('obForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var tank = parseFloat(String($('obTank').value).replace(',', '.')), cons = parseFloat(String($('obCons').value).replace(',', '.'));
    var err = !$('obName').value.trim() ? 'Donne un nom à ton véhicule.' : !obFuel ? 'Choisis le carburant de ton véhicule.' : !(tank >= 5) ? 'Indique la contenance du réservoir.' : !(cons >= 1) ? 'Indique la consommation.' : null;
    if (err) { $('obErr').textContent = err; $('obErr').hidden = false; return; }
    var c = { id: 'c' + Date.now(), name: $('obName').value.trim() || 'Ma voiture', fuel: obFuel, tank: tank, cons: cons, reserve: Math.max(2, Math.min(8, Math.round(tank * 0.1))) };
    state.cars = [c]; $('onboard').hidden = true; useCar(c.id); map.invalidateSize();
    toast('✅ ' + c.name + ' enregistré — la carte affiche le ' + FUELS[FUEL_INDEX[c.fuel]].label);
    if (!stations.length && $('loader').hidden) fetchData(false);
  });

  // ------------------------------------------------------------------ saisie du trajet
  var places = { from: null, to: null, near: null };
  function setPlace(which, p) { places[which] = p; $(which + 'Input').value = p ? p.label : ''; renderPlaceChips(); if (which === 'near' && p) { map.setView([p.lat, p.lon], Math.max(map.getZoom(), 11)); renderNear(); } }
  function geocodeFr(q, signal) {
    function tryOne(i) {
      return fetch(GEOCODERS[i] + '?q=' + encodeURIComponent(q) + '&limit=5&autocomplete=1', { signal: signal })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (j) { return (j.features || []).map(function (f) { return { label: f.properties.label, ctx: f.properties.context || '', lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], town: f.properties.type === 'municipality' }; }); })
        .catch(function (err) { if (err.name === 'AbortError' || i + 1 >= GEOCODERS.length) throw err; return tryOne(i + 1); });
    }
    return tryOne(0);
  }
  function geocodeEurope(q, signal) { // Photon (OpenStreetMap) pour les adresses hors de France
    return fetch(PHOTON + '?q=' + encodeURIComponent(q) + '&limit=5&lang=fr&bbox=-10,35,19,52', { signal: signal })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        return (j.features || []).filter(function (f) { return f.properties.countrycode !== 'FR'; }).map(function (f) {
          var p = f.properties, name = [p.name, p.street && (p.housenumber ? p.housenumber + ' ' : '') + p.street].filter(Boolean).join(', ');
          return { label: name + (p.city && p.city !== p.name ? ', ' + p.city : ''), ctx: [p.state, p.country].filter(Boolean).join(', '), lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], town: /^(city|district|county|state)$/.test(p.type) || /^(city|town|village)$/.test(p.osm_value) };
        });
      });
  }
  function geocode(q, signal) {
    var none = function (err) { if (err && err.name === 'AbortError') throw err; return []; };
    return Promise.all([geocodeFr(q, signal).catch(none), state.neighbours ? geocodeEurope(q, signal).catch(none) : []]).then(function (r) {
      // ordre : communes françaises, villes étrangères, puis rues et lieux-dits des deux côtés ; doublons retirés
      var seen = {}, all = r[0].filter(function (x) { return x.town; }).concat(r[1].filter(function (x) { return x.town; }), r[0].filter(function (x) { return !x.town; }), r[1].filter(function (x) { return !x.town; }));
      return all.filter(function (x) { var k = x.label + '|' + x.ctx; if (seen[k]) return false; seen[k] = 1; return true; }).slice(0, 7);
    });
  }
  function wireSuggest(which) {
    var input = $(which + 'Input'), list = $(which + 'Suggest'), ctrl = null, items = [];
    var run = debounce(function () {
      var q = input.value.trim(); if (q.length < 3) { list.innerHTML = ''; return; }
      if (ctrl) ctrl.abort(); ctrl = new AbortController();
      geocode(q, ctrl.signal).then(function (res) {
        items = res; list.innerHTML = res.map(function (r, i) { return '<li data-i="' + i + '">' + esc(r.label) + '<small>' + esc(r.ctx) + '</small></li>'; }).join('');
      }).catch(function () { });
    }, 220);
    input.addEventListener('input', function () { places[which] = null; run(); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && items.length) { setPlace(which, items[0]); list.innerHTML = ''; input.blur(); } });
    list.addEventListener('mousedown', function (e) { e.preventDefault(); });
    list.addEventListener('click', function (e) { var li = e.target.closest('li'); if (!li) return; setPlace(which, items[+li.getAttribute('data-i')]); list.innerHTML = ''; });
    input.addEventListener('blur', function () { setTimeout(function () { list.innerHTML = ''; }, 150); });
  }
  wireSuggest('from'); wireSuggest('to'); wireSuggest('near');
  $('fromGps').addEventListener('click', function () { locate().then(function (p) { setPlace('from', { label: 'Ma position', lat: p.lat, lon: p.lon, gps: true }); }).catch(function (e) { toast(e.message); }); });
  $('swapBtn').addEventListener('click', function () { var a = places.from, b = places.to, ta = $('fromInput').value, tb = $('toInput').value; places.from = b; places.to = a; $('fromInput').value = tb; $('toInput').value = ta; renderPlaceChips(); });

  function renderPlaceChips() {
    var html = state.places.map(function (p, i) { return '<button class="chip" data-place="' + i + '">★ ' + esc(p.name) + '<span class="x" data-rm="' + i + '">✕</span></button>'; }).join('');
    ['from', 'to'].forEach(function (w) {
      var p = places[w]; if (!p || p.gps) return;
      if (state.places.some(function (x) { return Math.abs(x.lat - p.lat) < 1e-4 && Math.abs(x.lon - p.lon) < 1e-4; })) return;
      html += '<button class="chip" data-star="' + w + '">☆ mémoriser ' + (w === 'from' ? 'le départ' : "l'arrivée") + '</button>';
    });
    $('placeChips').innerHTML = html;
  }
  $('placeChips').addEventListener('click', function (e) {
    var rm = e.target.closest('[data-rm]');
    if (rm) { state.places.splice(+rm.getAttribute('data-rm'), 1); save(); renderPlaceChips(); return; }
    var star = e.target.closest('[data-star]');
    if (star) { var p = places[star.getAttribute('data-star')]; state.places.push({ name: p.label.split(/[,\d]/)[0].trim().slice(0, 18) || p.label.slice(0, 18), label: p.label, lat: p.lat, lon: p.lon }); save(); renderPlaceChips(); return; }
    var b = e.target.closest('[data-place]'); if (!b) return;
    var pl = state.places[+b.getAttribute('data-place')];
    setPlace(!places.from && !$('fromInput').value ? 'from' : 'to', { label: pl.label, lat: pl.lat, lon: pl.lon });
  });

  function renderBars(id, value) {
    var low = value <= 1 ? ' vlow' : value <= 2 ? ' low' : '', html = '';
    for (var i = 1; i <= 8; i++) html += '<button type="button" data-e="' + i + '" class="' + (i <= value ? 'on' + low : '') + '" aria-label="' + i + '/8"></button>';
    $(id).innerHTML = html;
  }
  function eighths(e) { return e === 0 ? 'vide' : e === 8 ? 'plein' : e === 4 ? '½' : e === 2 ? '¼' : e === 6 ? '¾' : e + '/8'; }
  function updateSliders() {
    var c = car();
    renderBars('startBars', state.startE); renderBars('arrivalBars', state.arrivalE);
    $('startOut').textContent = eighths(state.startE) + ' · ≈ ' + num(c.tank * state.startE / 8) + ' L';
    $('arrivalOut').textContent = eighths(state.arrivalE) + ' · ≈ ' + num(c.tank * state.arrivalE / 8) + ' L';
    $('arrivalAny').checked = !!state.arrivalAny; $('arrivalField').hidden = !!state.arrivalAny;
  }
  function wireBars(id, key, max) {
    var el = $(id), set = function (e) { e = Math.max(0, Math.min(max, e)); if (state[key] !== e) { state[key] = e; save(); updateSliders(); } };
    var fromEvent = function (ev) { var r = el.getBoundingClientRect(), x = (ev.touches ? ev.touches[0] : ev).clientX; return Math.ceil((x - r.left) / r.width * 8); };
    el.addEventListener('click', function (ev) { var b = ev.target.closest('[data-e]'); if (!b) return; var e = +b.getAttribute('data-e'); set(e === state[key] ? e - 1 : e); }); // re-toucher la dernière barre l'éteint
    el.addEventListener('touchmove', function (ev) { set(fromEvent(ev)); ev.preventDefault(); }, { passive: false });
  }
  wireBars('startBars', 'startE', 8); wireBars('arrivalBars', 'arrivalE', 7);
  $('arrivalAny').addEventListener('change', function () { state.arrivalAny = this.checked; save(); updateSliders(); });
  [['corridor', 'corridor'], ['stopCost', 'stopCost'], ['maxAge', 'maxAge']].forEach(function (p) {
    $(p[0]).value = String(state[p[1]]);
    $(p[0]).addEventListener('change', function () { state[p[1]] = +this.value; save(); if (p[0] === 'maxAge') refreshMap(); });
  });
  $('only24').checked = !!state.only24;
  $('only24').addEventListener('change', function () { state.only24 = this.checked; save(); });

  // ------------------------------------------------------------------ itinéraire + appariement des stations
  function decodePolyline(str) {
    var i = 0, lat = 0, lon = 0, out = [];
    while (i < str.length) {
      for (var k = 0; k < 2; k++) {
        var shift = 0, result = 0, b;
        do { b = str.charCodeAt(i++) - 63; result |= (b & 31) << shift; shift += 5; } while (b >= 32);
        var d = (result & 1) ? ~(result >> 1) : (result >> 1);
        if (k === 0) lat += d; else lon += d;
      }
      out.push([lat / 1e5, lon / 1e5]);
    }
    return out;
  }
  function osrmRoute(points, full) {
    var url = OSRM + points.map(function (p) { return p.lon.toFixed(5) + ',' + p.lat.toFixed(5); }).join(';') + '?overview=' + (full ? 'full' : 'false') + '&geometries=polyline';
    return fetch(url).then(function (r) { if (!r.ok) throw new Error('itinéraire HTTP ' + r.status); return r.json(); })
      .then(function (j) { if (j.code !== 'Ok' || !j.routes.length) throw new Error('aucun itinéraire trouvé'); return j.routes[0]; });
  }
  function matchStations(pts, cum, corridorKm, pred) {
    var best = new Map(), KM_LAT = 111.32;
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1], kmLon = KM_LAT * Math.cos(a[0] * Math.PI / 180);
      var dLat = corridorKm / KM_LAT, dLon = corridorKm / kmLon;
      var bx = (b[1] - a[1]) * kmLon, by = (b[0] - a[0]) * KM_LAT, L2 = bx * bx + by * by;
      var cy0 = Math.floor((Math.min(a[0], b[0]) - dLat) * 10), cy1 = Math.floor((Math.max(a[0], b[0]) + dLat) * 10);
      var cx0 = Math.floor((Math.min(a[1], b[1]) - dLon + 20) * 10), cx1 = Math.floor((Math.max(a[1], b[1]) + dLon + 20) * 10);
      for (var cy = cy0; cy <= cy1; cy++) for (var cx = cx0; cx <= cx1; cx++) {
        var cell = grid.get(cy * 10000 + cx); if (!cell) continue;
        for (var k = 0; k < cell.length; k++) {
          var s = cell[k]; if (!pred(s)) continue;
          var x = (s.lon - a[1]) * kmLon, y = (s.lat - a[0]) * KM_LAT;
          var t = L2 ? (x * bx + y * by) / L2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
          var dx = x - t * bx, dy = y - t * by, d = Math.sqrt(dx * dx + dy * dy);
          if (d > corridorKm) continue;
          var cur = best.get(s);
          if (!cur || d < cur.off) best.set(s, { off: d, pos: cum[i] + t * (cum[i + 1] - cum[i]) });
        }
      }
    }
    return best;
  }

  var routeLayers = L.layerGroup().addTo(map);
  function clearRoute(keepInputs) {
    routeCtx = null; routeLayers.clearLayers(); $('routeResult').innerHTML = ''; $('routeMsg').hidden = true;
    if (!keepInputs) { setPlace('from', null); setPlace('to', null); }
    refreshMap(); updateHud();
  }
  function routeMsg(text, err) { var m = $('routeMsg'); m.hidden = !text; m.className = 'msg' + (err ? ' err' : ''); m.innerHTML = text || ''; }

  function resolvePlace(which) {
    if (places[which]) return Promise.resolve(places[which]);
    var q = $(which + 'Input').value.trim();
    if (q.length < 3) return Promise.reject(new Error(which === 'from' ? 'Indique un point de départ' : 'Indique une destination'));
    return geocode(q).then(function (r) { if (!r.length) throw new Error('Adresse introuvable : ' + q); setPlace(which, r[0]); return r[0]; });
  }

  var DETOUR_EUR_PER_KM = 0.15; // « prix » du temps perdu en détour (≈ 9 €/h à 60 km/h), pour ne pas traverser la campagne pour 30 centimes

  var pendingStops = null; // identifiants d'arrêts à réappliquer après un calcul (trajet préparé sur le téléphone)
  function restoreLastRoute() {
    var lr = state.lastRoute; if (!lr || !lr.from || !lr.to || Date.now() - lr.ts > 12 * 3600 * 1000) return false;
    setPlace('from', lr.from); setPlace('to', lr.to); state.startE = lr.startE; updateSliders(); pendingStops = lr.stops; computeRoute(); return true;
  }
  function computeRoute() {
    if (!state.cars.length) { showOnboarding(); return; }
    if (!stations.length) { toast('⏳ Les prix ne sont pas encore chargés'); return; }
    var btn = $('goBtn'); btn.disabled = true; btn.textContent = '⏳ Calcul de l\'itinéraire…'; routeMsg(null); $('routeResult').innerHTML = '';
    var c = car(), fi = FUEL_INDEX[c.fuel], fis = fuelsFor(c.fuel), t0 = performance.now();
    if (state.fuel !== c.fuel) { state.fuel = c.fuel; renderFuelChips(); }
    Promise.all([resolvePlace('from'), resolvePlace('to')]).then(function (pl) {
      return osrmRoute([pl[0], pl[1]], true).then(function (route) { return { from: pl[0], to: pl[1], route: route }; });
    }).then(function (r) {
      r.pts = decodePolyline(r.route.geometry);
      var s = 90, w = 180, n = -90, e = -180; r.pts.forEach(function (p) { if (p[0] < s) s = p[0]; if (p[0] > n) n = p[0]; if (p[1] < w) w = p[1]; if (p[1] > e) e = p[1]; });
      btn.textContent = '⏳ Recherche des stations…';
      return ensureCountries(s - 0.3, w - 0.3, n + 0.3, e + 0.3).then(function () { return r; });
    }).then(function (r) {
      var pts = r.pts, D = r.route.distance / 1000, cum = cumulative(pts, D);
      var pred = function (s) { return pick(s, fis) >= 0 && (!state.only24 || s.a24); };
      var notes = [], result = null, cands = [], usedCorridor = state.corridor;
      var base = { distanceKm: D, tankL: c.tank, consumption: c.cons, reserveL: c.reserve, startFuelL: c.tank * state.startE / 8, stopCost: state.stopCost, detourCostPerKm: DETOUR_EUR_PER_KM,
        arrivalFuelL: state.arrivalAny ? c.reserve : Math.max(c.reserve, c.tank * state.arrivalE / 8) };
      var corridors = [state.corridor, 25, 40].filter(function (v, i2) { return i2 === 0 || v > state.corridor; });
      for (var ci = 0; ci < corridors.length && !(result && result.feasible); ci++) {
        usedCorridor = corridors[ci];
        var m = matchStations(pts, cum, usedCorridor, pred); cands = [];
        m.forEach(function (v, s) {
          var k = pick(s, fis);
          cands.push({ s: s, id: s.id, fi: k, pos: v.pos, off: v.off, price: s.p[k], detourKm: 2 * v.off * DETOUR_FACTOR + (s.hw && v.off < 0.4 ? 0 : EXIT_OVERHEAD_KM) });
        });
        var input = Object.assign({}, base, { stations: FuelOptimizer.thin(cands, D, 260, 4) });
        result = FuelOptimizer.optimize(input);
        if (!result.feasible && base.arrivalFuelL > c.reserve) {
          var relaxed = FuelOptimizer.optimize(Object.assign({}, input, { arrivalFuelL: c.reserve }));
          if (relaxed.feasible) { result = relaxed; base.arrivalFuelL = c.reserve; notes.push("Impossible d'arriver avec " + eighths(state.arrivalE) + ' du réservoir : proposition calculée pour simplement arriver.'); }
        }
      }
      if (usedCorridor !== state.corridor && result.feasible) notes.push('Pas assez de stations à moins de ' + state.corridor + ' km de la route : recherche élargie à ' + usedCorridor + ' km.');
      cands.sort(function (a, b) { return a.pos - b.pos; });
      routeCtx = { from: r.from, to: r.to, pts: pts, cum: cum, D: D, durMin: r.route.duration / 60, cands: cands, candidateStations: cands.map(function (x) { return x.s; }),
        best: result, plan: null, real: null, token: 0, openAlt: null, modified: false, fitted: false,
        naive: FuelOptimizer.baseline(Object.assign({}, base, { stations: cands })), car: c, fi: fi, base: base, notes: notes, ms: performance.now() - t0 };
      var ps = pendingStops; pendingStops = null;
      if (ps) { var chosen = ps.map(function (id) { return cands.filter(function (cd) { return String(cd.id) === id; })[0]; }).filter(Boolean); if (chosen.length === ps.length && setPlan(chosen, false).feasible) return; }
      if (result.feasible) setPlan(result.stops.map(function (st) { return st.station; }), true);
      else { drawRoute(); renderRoute(); }
    }).catch(function (err) { routeMsg('⚠️ ' + esc(err.message || 'Erreur'), true); })
      .then(function () { btn.disabled = false; btn.textContent = '🚀 Proposer mes arrêts'; });
  }
  $('goBtn').addEventListener('click', function () { gate('route', computeRoute); });

  function cumulative(pts, totalKm) { // km cumulés le long de la géométrie, recalés sur la distance annoncée par le routeur
    var cum = [0]; for (var i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
    var k = cum[cum.length - 1] > 0 ? totalKm / cum[cum.length - 1] : 1; return cum.map(function (v) { return v * k; });
  }

  // Applique une suite d'arrêts (la proposition, ou celle que l'utilisateur a modifiée). Renvoie l'évaluation.
  function setPlan(list, isBest) {
    var R = routeCtx, ev = FuelOptimizer.evaluate(R.base, list);
    if (!ev.feasible) return ev;
    R.plan = ev; R.modified = !isBest; R.real = null; R.openAlt = null; R.token++;
    state.lastRoute = { ts: Date.now(), from: R.from, to: R.to, stops: list.map(function (cd) { return String(cd.id); }), startE: state.startE }; save(); // repris sur l'écran de la voiture
    drawRoute(); renderRoute(); refineWithStops(); updateHud();
    return ev;
  }
  function planStations() { return routeCtx.plan.stops.map(function (st) { return st.station; }); }
  function tryPlan(list, failText) {
    var before = routeCtx.plan.fuelCost, ev = setPlan(list, false);
    if (!ev.feasible) { toast('⛔ ' + failText); return false; }
    var d = ev.fuelCost - before; toast((Math.abs(d) < 0.005 ? '= même coût' : d > 0 ? '🔺 + ' + eur(d) : '🔻 − ' + eur(-d)) + ' · total ' + eur(ev.fuelCost));
    return true;
  }
  function alternativesFor(k) {
    var R = routeCtx, list = planStations(), prev = k > 0 ? list[k - 1].pos : 0, next = k < list.length - 1 ? list[k + 1].pos : R.D, out = [];
    R.cands.forEach(function (cd) {
      if (cd.pos <= prev || cd.pos >= next || list.indexOf(cd) >= 0) return;
      var trial = list.slice(); trial[k] = cd; var ev = FuelOptimizer.evaluate(R.base, trial);
      if (ev.feasible) out.push({ cand: cd, cost: ev.fuelCost, delta: ev.fuelCost - R.plan.fuelCost });
    });
    return out.sort(function (a, b) { return (a.cost + a.cand.detourKm * DETOUR_EUR_PER_KM) - (b.cost + b.cand.detourKm * DETOUR_EUR_PER_KM); }).slice(0, 12);
  }

  // ---- dessin : trajet d'origine en fond, trajet réel (via les arrêts) coloré selon le niveau du réservoir
  var LEVEL_COLORS = { ok: '#34d058', mid: '#ffd60a', low: '#ff8a00', out: '#ff3b30' };
  function levelColor(L, c) { return L < c.reserve - 0.05 ? LEVEL_COLORS.out : L < c.tank * 0.25 ? LEVEL_COLORS.low : L < c.tank * 0.5 ? LEVEL_COLORS.mid : LEVEL_COLORS.ok; }
  function coloredLine(pts, cum, levelAt, c, group) {
    L.polyline(pts, { color: '#fff', weight: 9.5, opacity: 0.95, interactive: false }).addTo(group);
    L.polyline(pts, { color: '#10151c', weight: 7, opacity: 1, interactive: false }).addTo(group);
    var run = [pts[0]], cur = null;
    for (var i = 1; i < pts.length; i++) {
      var col = levelColor(levelAt((cum[i - 1] + cum[i]) / 2), c);
      if (cur && col !== cur) { L.polyline(run, { color: cur, weight: 5, opacity: 1, interactive: false }).addTo(group); run = [pts[i - 1]]; }
      cur = col; run.push(pts[i]);
    }
    if (cur) L.polyline(run, { color: cur, weight: 5, opacity: 1, interactive: false }).addTo(group);
  }
  function plannedLevel(R) { // niveau estimé le long du trajet d'origine, d'après le plan
    var xs = [0], ys = [R.base.startFuelL];
    (R.plan ? R.plan.stops : []).forEach(function (st) { xs.push(st.pos, st.pos); ys.push(st.arriveL, st.departL); });
    xs.push(R.D); ys.push(R.plan ? R.plan.arrivalL : R.base.startFuelL - R.D * R.car.cons / 100);
    return function (km) { for (var i = xs.length - 2; i >= 0; i--) if (km >= xs[i]) { var w = xs[i + 1] - xs[i]; return w > 0 ? ys[i] + (ys[i + 1] - ys[i]) * (km - xs[i]) / w : ys[i + 1]; } return ys[0]; };
  }
  function realLevel(R) { // niveau le long du trajet RÉEL : distances vraies entre les arrêts
    var starts = [0], levels = [R.base.startFuelL], acc = 0, lpk = R.car.cons / 100;
    R.real.legsKm.forEach(function (km, i) { acc += km; if (i < R.plan.stops.length) { starts.push(acc); levels.push(R.plan.stops[i].departL); } });
    return function (km) { for (var i = starts.length - 1; i >= 0; i--) if (km >= starts[i]) return levels[i] - (km - starts[i]) * lpk; return levels[0]; };
  }
  function drawRoute() {
    var R = routeCtx; routeLayers.clearLayers();
    if (R.real) {
      L.polyline(R.pts, { color: state.theme === 'dark' ? '#aab4c4' : '#5b6878', weight: 4, opacity: 0.85, dashArray: '2 9', lineCap: 'round', interactive: false }).addTo(routeLayers); // trajet d'origine, toujours visible
      coloredLine(R.real.pts, R.real.cum, realLevel(R), R.car, routeLayers);
    } else coloredLine(R.pts, R.cum, plannedLevel(R), R.car, routeLayers);
    L.marker([R.from.lat, R.from.lon], { icon: L.divIcon({ className: '', html: '<div class="end-marker"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), interactive: false }).addTo(routeLayers);
    L.marker([R.to.lat, R.to.lon], { icon: L.divIcon({ className: '', html: '<div class="end-marker to"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), interactive: false }).addTo(routeLayers);
    (R.plan ? R.plan.stops : []).forEach(function (st, i) {
      var s = st.station.s;
      L.marker([s.lat, s.lon], { icon: L.divIcon({ className: '', html: '<span class="stop-marker">⛽ ' + (i + 1) + ' · ' + price3(st.price) + '</span>', iconSize: [0, 0] }), zIndexOffset: 1000 })
        .on('click', function () { openStation(s, false); }).addTo(routeLayers);
    });
    if (!R.fitted) { R.fitted = true; R.bounds = L.latLngBounds(R.pts); if (!isWide()) $('panel').classList.add('collapsed'); fitRoute(); setTimeout(function () { if (routeCtx === R && !isWide()) { $('panel').classList.remove('collapsed'); var sm = document.querySelector('#routeResult .summary'); if (sm) $('panelBody').scrollTop = sm.offsetTop - 8; } }, 1500); }
    refreshMap();
  }

  function gaugeSvg(R) {
    var res = R.plan, c = R.car, W = 600, H = 120, x = function (km) { return (km / R.D) * W; }, y = function (l) { return H - 6 - (Math.max(0, l) / c.tank) * (H - 12); };
    var pts = [[0, R.base.startFuelL]];
    res.stops.forEach(function (s) { pts.push([s.pos, s.arriveL]); pts.push([s.pos, s.departL]); });
    pts.push([R.D, res.arrivalL]);
    var path = pts.map(function (p, i) { return (i ? 'L' : 'M') + x(p[0]).toFixed(1) + ' ' + y(p[1]).toFixed(1); }).join(' ');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Niveau de carburant le long du trajet">' +
      '<path d="' + path + ' L' + W + ' ' + H + ' L0 ' + H + ' Z" fill="var(--accent)" opacity=".16"/>' +
      '<path d="' + path + '" fill="none" stroke="var(--accent)" stroke-width="2.5" vector-effect="non-scaling-stroke"/>' +
      '<line x1="0" x2="' + W + '" y1="' + y(c.reserve) + '" y2="' + y(c.reserve) + '" stroke="var(--bad)" stroke-dasharray="5 5" stroke-width="1.5" vector-effect="non-scaling-stroke"/>' +
      '<line x1="0" x2="' + W + '" y1="' + y(c.tank) + '" y2="' + y(c.tank) + '" stroke="var(--line)" stroke-width="1" vector-effect="non-scaling-stroke"/></svg>';
  }
  function stationTitle(s) { return brandName(s) + esc(titleCase(s.ville)) + (s.cc !== 'fr' ? '<span class="badge">' + s.cc.toUpperCase() + '</span>' : '') + (s.hw ? '<span class="badge">Autoroute</span>' : '') + (s.a24 ? '<span class="badge">24/24</span>' : ''); }

  function renderRoute() {
    var R = routeCtx, res = R.plan, c = R.car, fuelLabel = FUELS[R.fi].label + (fuelsFor(c.fuel).length > 1 ? ' ou compatible' : ''), html = '', keepScroll = $('panelBody').scrollTop;
    routeMsg(R.notes.length ? R.notes.map(esc).join('<br>') : null);
    if (!R.best.feasible) {
      routeMsg('⛔ Trajet infaisable avec ce véhicule : aucune station ' + fuelLabel + ' atteignable après le km ' + num(R.best.reachedKm || 0) + ' (même en cherchant jusqu\'à 40 km de la route). Essaie avec plus de carburant au départ, des prix plus anciens autorisés, ou sans le filtre 24/24.', true);
      return;
    }
    var detours = res.stops.reduce(function (a, s) { return a + s.detourKm; }, 0), consumed = (R.D + detours) * c.cons / 100;
    var saving = R.naive.feasible ? R.naive.fuelCost - res.fuelCost : null, dBest = res.fuelCost - R.best.fuelCost;
    if (saving > 0.5 && !R.counted) { R.counted = true; var sv = state.savings || (state.savings = { total: 0, n: 0, since: Date.now() }); sv.total += saving; sv.n++; save(); }
    html += '<div class="summary"><div class="big"><div><div class="k">💶 Carburant à acheter</div><div class="v">' + eur(res.fuelCost) + '</div></div>' +
      (R.modified
        ? '<div><div class="k">✏️ Par rapport au conseil</div><div class="v" style="color:' + (dBest > 0.005 ? 'var(--bad)' : 'var(--accent)') + '">' + (Math.abs(dBest) < 0.005 ? '=' : (dBest > 0 ? '+ ' : '− ') + eur(Math.abs(dBest))) + '</div></div>'
        : '<div><div class="k">💰 Économie estimée</div><div class="v save">' + (saving != null && saving > 0.5 ? '− ' + eur(saving) : '—') + '</div></div>') + '</div>' +
      '<div class="facts"><span>🛣️ <b>' + num(R.D) + ' km</b> · <b>' + hmin(R.durMin) + '</b></span>' +
      (R.real ? '<span>↪️ avec les arrêts : <b>+' + num(Math.max(0, R.real.distKm - R.D), 1) + ' km</b>, +' + num(Math.max(0, R.real.durMin - R.durMin)) + ' min</span>' : '') +
      '<span>⛽ <b>' + res.stops.length + '</b> arrêt' + (res.stops.length > 1 ? 's' : '') + '</span><span><b>' + num(consumed, 1) + ' L</b> consommés</span><span>🏁 arrivée avec <b>' + num(res.arrivalL) + ' L</b></span><span>' + R.cands.length + ' stations ' + fuelLabel + ' comparées</span></div>';
    if (saving != null && saving > 0.5) html += '<div class="facts">💡 ' + (R.modified ? 'Ton plan' : 'Ce plan') + ' économise ' + eur(saving) + ' par rapport à un plein complet à la première station sur la route quand il reste ¼ du réservoir (' + eur(R.naive.fuelCost) + ', à carburant restant égal).</div>';
    html += '<div class="gauge">' + gaugeSvg(R) + '<div class="cap"><span>départ · ' + num(R.base.startFuelL) + ' L</span><span>— — réserve ' + num(c.reserve, 1) + ' L</span><span>arrivée</span></div></div>' +
      '<div class="legend"><span><i style="background:' + LEVEL_COLORS.ok + '"></i>plus de ½</span><span><i style="background:' + LEVEL_COLORS.mid + '"></i>¼ à ½</span><span><i style="background:' + LEVEL_COLORS.low + '"></i>moins de ¼</span><span><i style="background:' + LEVEL_COLORS.out + '"></i>dans la réserve</span><span><i style="background:#aab4c4"></i>pointillé : trajet d\'origine</span></div></div>';

    html += '<p class="hint">👇 Ce sont des <b>propositions</b> : change ou retire un arrêt, ou touche une station sur la carte pour t\'y arrêter. Le coût et le trajet sont recalculés.</p>';
    html += '<ol class="timeline"><li><span class="dot">A</span><div class="tl-head"><b>📍 ' + esc(R.from.label) + '</b><span class="tl-km">km 0</span></div><div class="tl-sub">' + esc(c.name) + ' · ' + num(R.base.startFuelL) + ' L dans le réservoir</div></li>';
    if (!res.stops.length) html += '<li><span class="dot">✓</span><div class="tl-head"><b>Aucun arrêt nécessaire</b></div><div class="tl-sub">Tu as assez de carburant pour arriver. Tu peux quand même ajouter un arrêt en touchant une station sur la carte.</div></li>';
    res.stops.forEach(function (st, i) {
      var s = st.station.s, a = ageDays(s, st.station.fi), last = i === res.stops.length - 1;
      var what = st.buyL < 0.05 ? 'Rien à mettre ici : cet arrêt est inutile 🤷' :
        (st.full ? 'Fais le <strong>plein complet</strong> : ' : 'Mets seulement ') + '<strong>' + num(st.buyL, st.buyL < 10 ? 1 : 0) + ' L</strong> de ' + FUELS[st.station.fi].label + ' à ' + price3(st.price) + ' € → <strong>' + eur(st.cost) + '</strong>';
      html += '<li><span class="dot stop">' + (i + 1) + '</span><div class="tl-head"><b>' + stationTitle(s) + '</b><span class="tl-km">km ' + num(st.pos) + '</span></div>' +
        '<div class="tl-sub">' + esc(titleCase(s.adr)) + ' · à ' + num(st.station.off, 1) + ' km de la route · ' + (a > 5 ? '<span class="badge old">' + ageText(a) + '</span>' : ageText(a)) + '</div>' +
        '<div class="action">' + what + '<br><span class="tl-sub">réservoir : ' + num(st.arriveL, 1) + ' L → ' + num(st.departL, 1) + ' L' + (st.full || st.buyL < 0.05 ? '' : last ? ' (juste ce qu\'il faut pour arriver avec ' + num(res.arrivalL) + ' L)' : ' (appoint : moins cher plus loin)') + '</span></div>' +
        '<div class="links"><button data-alt="' + i + '">🔁 Changer</button><button data-del="' + i + '">🗑️ Retirer</button><button data-show="' + i + '">🗺️ Voir</button>' + navLinks(s, '') + '</div>';
      if (R.openAlt === i) {
        var alts = alternativesFor(i);
        html += '<div class="alts"><h4>Autres stations possibles pour cet arrêt — différence sur le coût total :</h4>' + (alts.length ? alts.map(function (al, n) {
          var cs = al.cand.s, d = al.delta;
          return '<div class="alt" data-pick="' + i + ':' + n + '"><div class="nm">' + stationTitle(cs) + '</div><div class="dl ' + (d > 0.005 ? 'up' : 'down') + '">' + (Math.abs(d) < 0.005 ? '=' : (d > 0 ? '+ ' : '− ') + eur(Math.abs(d))) + '</div>' +
            '<div class="sb">' + scoreBadge(score(cs, fuelsFor(R.car.fuel))) + ' km ' + num(al.cand.pos) + ' · à ' + num(al.cand.off, 1) + ' km de la route · ' + (al.cand.fi !== R.fi ? FUELS[al.cand.fi].label + ' · ' : '') + ageLabel(ageDays(cs, al.cand.fi)) + '</div><div class="pr">' + price3(al.cand.price) + ' €/L</div></div>';
        }).join('') : '<div class="sb">Aucune autre station ne permet de tenir jusqu\'à l\'arrêt suivant.</div>') + '</div>';
        R.altCache = alts;
      }
      html += '</li>';
    });
    html += '<li><span class="dot">B</span><div class="tl-head"><b>🏁 ' + esc(R.to.label) + '</b><span class="tl-km">km ' + num(R.D) + '</span></div><div class="tl-sub">Arrivée avec ' + num(res.arrivalL) + ' L</div></li></ol>';
    var gm = 'https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=' + R.from.lat + ',' + R.from.lon + '&destination=' + R.to.lat + ',' + R.to.lon;
    if (res.stops.length) gm += '&waypoints=' + res.stops.map(function (st) { return st.station.s.lat + ',' + st.station.s.lon; }).join('%7C');
    html += (R.modified ? '<button class="secondary" id="resetPlan" style="margin-bottom:8px">↩️ Revenir à la proposition conseillée (' + eur(R.best.fuelCost) + ')</button>' : '') +
      '<a class="primary" style="display:block;text-align:center;text-decoration:none" target="_blank" rel="noopener" href="' + gm + '">🧭 Ouvrir ce trajet dans Google Maps</a>' +
      '<button class="secondary" id="clearRoute" style="margin-top:8px">✖️ Effacer le trajet</button>';
    $('routeResult').innerHTML = html;
    $('panelBody').scrollTop = keepScroll;
  }
  $('routeResult').addEventListener('click', function (e) {
    var R = routeCtx; if (!R) return;
    if (e.target.id === 'clearRoute') { clearRoute(false); return; }
    if (e.target.id === 'resetPlan') { setPlan(R.best.stops.map(function (st) { return st.station; }), true); return; }
    var b;
    if ((b = e.target.closest('[data-pick]'))) { var kv = b.getAttribute('data-pick').split(':'), list = planStations(); list[+kv[0]] = R.altCache[+kv[1]].cand; tryPlan(list, 'Impossible avec cette station'); return; }
    if ((b = e.target.closest('[data-alt]'))) { var k = +b.getAttribute('data-alt'); R.openAlt = R.openAlt === k ? null : k; renderRoute(); return; }
    if ((b = e.target.closest('[data-del]'))) { var l2 = planStations(); l2.splice(+b.getAttribute('data-del'), 1); tryPlan(l2, 'Sans cet arrêt, tu tombes en panne avant le suivant'); return; }
    if ((b = e.target.closest('[data-show]'))) { var s = R.plan.stops[+b.getAttribute('data-show')].station.s; if (!isWide()) $('panel').classList.add('collapsed'); openStation(s, true); }
  });
  // depuis la bulle d'une station : s'y arrêter / ne plus s'y arrêter
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-stop]'); if (!b || !routeCtx || !routeCtx.plan) return;
    var id = b.getAttribute('data-stop'), list = planStations(), idx = -1;
    list.forEach(function (cd, i) { if (String(cd.id) === id) idx = i; });
    if (idx >= 0) { list.splice(idx, 1); if (tryPlan(list, 'Sans cet arrêt, tu tombes en panne avant le suivant')) map.closePopup(); return; }
    var cd = routeCtx.cands.filter(function (x) { return String(x.id) === id; })[0]; if (!cd) return;
    list.push(cd); if (tryPlan(list, 'Impossible de s\'arrêter ici avec ce plan')) map.closePopup();
  });

  // Recalcule l'itinéraire RÉEL en passant par les arrêts retenus ; le trajet d'origine reste affiché en fond.
  function refineWithStops() {
    var R = routeCtx, token = R.token; if (!R.plan || !R.plan.stops.length) return;
    var pts = [R.from].concat(R.plan.stops.map(function (st) { return st.station.s; }), [R.to]);
    osrmRoute(pts, true).then(function (route) {
      if (routeCtx !== R || R.token !== token) return;
      var g = decodePolyline(route.geometry), distKm = route.distance / 1000;
      R.real = { pts: g, cum: cumulative(g, distKm), distKm: distKm, durMin: route.duration / 60, legsKm: route.legs.map(function (l) { return l.distance / 1000; }) };
      var level = realLevel(R), acc = 0, worst = null;
      R.real.legsKm.forEach(function (km, i) { acc += km; var l = level(acc - 0.001); if (l < R.car.reserve - 0.5 && (!worst || l < worst.l)) worst = { l: l, i: i }; });
      R.notes = R.notes.filter(function (n) { return n.indexOf('🟠') !== 0; });
      if (worst) R.notes.push('🟠 Avec les distances réelles, tu entames la réserve avant ' + (worst.i < R.plan.stops.length ? "l'arrêt " + (worst.i + 1) : "l'arrivée") + ' (≈ ' + num(Math.max(0, worst.l), 1) + ' L restants). Prends quelques litres de plus à l\'arrêt précédent.');
      drawRoute(); renderRoute();
    }).catch(function () { });
  }

  // ------------------------------------------------------------------ proximité
  var nearMode = 'gps';
  $('nearMode').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; nearMode = b.getAttribute('data-v'); this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); }); $('nearAddr').hidden = nearMode !== 'addr'; if (nearMode === 'addr' && !places.near) { $('nearInput').focus(); } renderNear(); });
  $('nearConf').addEventListener('change', renderNear);
  $('nearRadius').addEventListener('change', renderNear); $('nearSort').addEventListener('change', renderNear);
  // Origine courante de Proximité (ma position / centre / favoris / adresse), sans ouvrir la liste
  function nearOrigin() {
    var center = { lat: map.getCenter().lat, lon: map.getCenter().lng, label: 'du centre de la carte' };
    if (nearMode === 'gps') return (mePos ? Promise.resolve(mePos) : locate()).then(function (p) { return { lat: p.lat, lon: p.lon, label: 'de ma position' }; });
    if (nearMode === 'addr') return Promise.resolve(places.near ? { lat: places.near.lat, lon: places.near.lon, label: 'de ' + places.near.label } : null);
    return Promise.resolve(center);
  }
  var FuelAlert = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.FuelAlert;
  function alertStatus() {
    var el = $('alertStatus'), a = state.alert; if (!el) return;
    el.className = 'hint' + (a ? ' on' : ''); el.textContent = a ? '🔔 Alerte active : ' + FUELS[FUEL_INDEX[a.fuel]].label + ' à moins de ' + a.radiusKm + ' km ' + a.label + '.' : 'Aucune alerte active.';
    $('alertOff').hidden = !a;
  }
  if (FuelAlert) {
    $('alertBox').hidden = false; alertStatus();
    $('alertOn').addEventListener('click', function () { gate('alert', function () {
      nearOrigin().then(function (o) {
        if (!o) { toast('Choisis une adresse d\'abord'); return; }
        var c = car(), a = { lat: +o.lat.toFixed(5), lon: +o.lon.toFixed(5), radiusKm: +$('alertRadius').value, fuel: c.fuel, fuels: fuelsFor(c.fuel).map(function (i) { return FUELS[i].key; }), label: o.label, since: Date.now() };
        return window.Capacitor.Plugins.Preferences.set({ key: 'alert', value: JSON.stringify(a) }).then(function () { return FuelAlert.enable(); }).then(function () { state.alert = a; save(); alertStatus(); toast('Alerte activée : tu seras prévenu dès qu\'une station à moins de ' + a.radiusKm + ' km met son prix à jour'); });
      }).catch(function (e) { toast(e && e.message ? e.message : 'Activation impossible'); });
    }); });
    $('alertOff').addEventListener('click', function () { FuelAlert.disable().then(function () { state.alert = null; save(); alertStatus(); toast('Alerte désactivée'); }); });
    $('alertTest').addEventListener('click', function () { if (!state.alert) { toast('Active d\'abord l\'alerte'); return; } FuelAlert.test().then(function () { toast('Vérification lancée : notification dans quelques secondes s\'il y a eu une mise à jour dans les 6 dernières heures'); }); });
  }
  function renderNear() {
    var listEl = $('nearList'), favMode = nearMode === 'fav';
    if (!stations.length) { listEl.innerHTML = '<p class="hint">⏳ Chargement des prix…</p>'; return; }
    $('nearRadius').parentNode.style.visibility = favMode ? 'hidden' : '';
    var center = { lat: map.getCenter().lat, lon: map.getCenter().lng };
    var origin = nearMode === 'gps' ? (mePos ? Promise.resolve(mePos) : locate()) : nearMode === 'addr' ? Promise.resolve(places.near || null) : Promise.resolve(favMode && mePos ? mePos : center);
    if (nearMode === 'addr' && !places.near) { listEl.innerHTML = '<p class="hint">Saisis une ville ou une adresse ci-dessus.</p>'; return; }
    origin.then(function (o) {
      var c = car(), fi = FUEL_INDEX[state.fuel], fis = displayFuels(), radius = +$('nearRadius').value, sort = $('nearSort').value, minConf = +$('nearConf').value;
      var liters = Math.max(5, c.tank * (1 - startPct() / 100)), dLat = radius / 111, dLon = radius / (111 * Math.cos(o.lat * Math.PI / 180));
      var pool = favMode ? stations.filter(isFav) : stationsInBounds(o.lat - dLat, o.lon - dLon, o.lat + dLat, o.lon + dLon);
      var items = pool.map(function (s) {
        var k = favMode ? pickAny(s, fis) : pick(s, fis), rupt = k < 0 && inRupture(s, fis);
        if (k < 0) return favMode || rupt ? { s: s, k: -1, p: Infinity, d: haversine(o.lat, o.lon, s.lat, s.lon), real: Infinity, age: 9999, rupt: rupt } : null; // les ruptures restent listées : c'est l'info utile
        var d = haversine(o.lat, o.lon, s.lat, s.lon), trip = 2 * d * DETOUR_FACTOR * c.cons / 100;
        return { s: s, k: k, p: s.p[k], d: d, real: (liters + trip) * s.p[k], age: ageDays(s, k) };
      }).filter(function (x) { return x && (favMode || x.d <= radius) && (!minConf || x.rupt || (x.k >= 0 && confidence(x.s, x.k).level >= minConf)); });
      $('nearHint').textContent = FUELS[fi].label + ' · coût réel = plein de ' + num(liters) + ' L (' + c.name + ', ' + eighths(state.startE) + ') + carburant de l\'aller-retour.';
      if (!items.length) { listEl.innerHTML = '<p class="hint">' + (favMode ? 'Aucune station favorite : ouvre une station sur la carte et touche « ☆ Favori ».' : minConf ? 'Aucune station assez fiable dans ce rayon : élargis le rayon ou baisse la fiabilité minimale.' : 'Aucune station avec un prix récent dans ce rayon.') + '</p>'; return; }
      var nRupt = items.filter(function (x) { return x.rupt; }).length; if (nRupt) $('nearHint').textContent += ' ⊘ ' + nRupt + ' station' + (nRupt > 1 ? 's' : '') + ' en rupture déclarée.';
      if (minConf) $('nearHint').textContent += ' Seules les stations ' + (minConf >= 3 ? 'mises à jour depuis moins de 6 h' : 'mises à jour aujourd\'hui') + ' sont listées.';
      if (sort === 'reliable') $('nearHint').textContent += ' Tri : les plus fiables d\'abord, puis la moins chère.';
      var priced = items.filter(function (x) { return x.k >= 0; }), nearest = priced.slice().sort(function (a, b) { return a.d - b.d; })[0];
      if (sort === 'score' || items.length <= 80) items.forEach(function (x) { x.sc = x.k >= 0 ? score(x.s, fis, x.d) : null; });
      if (state.shortage && sort === 'real') sort = 'reliable'; // en pénurie, ce qui compte c'est d'en trouver
      var lvl = function (x) { return x.k >= 0 ? confidence(x.s, x.k).level : -1; };
      items.sort(sort === 'reliable' ? function (a, b) { return lvl(b) - lvl(a) || a.real - b.real; } : sort === 'price' ? function (a, b) { return a.p - b.p; } : sort === 'dist' ? function (a, b) { return a.d - b.d; } : sort === 'fresh' ? function (a, b) { return ageHours(a.s, a.k) - ageHours(b.s, b.k) || a.p - b.p; } :
        sort === 'score' ? function (a, b) { return (b.sc ? b.sc.total : -1) - (a.sc ? a.sc.total : -1); } : function (a, b) { return a.real - b.real; });
      var bestReal = priced.slice().sort(function (a, b) { return a.real - b.real; })[0];
      listEl.innerHTML = items.slice(0, 30).map(function (x) {
        var diff = nearest && x.k >= 0 ? nearest.real - x.real : 0, sc = x.sc === undefined && x.k >= 0 ? score(x.s, fis, x.d) : x.sc, fresh = x.k >= 0 && ageHours(x.s, x.k) <= 2;
        return '<div class="card' + (x === bestReal ? ' best' : '') + (fresh ? ' fresh' : '') + '" data-sid="' + x.s.id + '"><div><b>' + (isFav(x.s) ? '★ ' : '') + brandName(x.s) + esc(titleCase(x.s.ville)) + '</b>' + (x.s.a24 ? '<span class="badge">24/24</span>' : '') + '</div><div class="price">' + (x.k >= 0 ? price3(x.p) : '—') + '</div>' +
          '<div class="sub">' + esc(titleCase(x.s.adr)) + ' · ' + num(x.d, 1) + ' km · ' + (x.k < 0 ? (x.rupt ? '<span style="color:var(--bad)">⊘ rupture déclarée</span>' : 'pas de prix récent') : (x.k !== fi ? FUELS[x.k].label + ' <small>(compatible, moins cher ici)</small> · ' : '') + '<span class="when' + (fresh ? ' fresh' : '') + '"' + (x.age > 3 ? ' style="color:var(--warn)"' : '') + '>🕒 ' + whenText(x.s, x.k) + '</span>' + (state.shortage || sort === 'reliable' || minConf ? ' · <b class="c' + confidence(x.s, x.k).level + '">' + confidence(x.s, x.k).label + '</b>' : '')) + '</div>' +
          '<div class="real">' + scoreBadge(sc) + (x.k >= 0 ? ' ' + eur(x.real) + (x !== nearest && diff > 0.3 ? ' · <span style="color:var(--accent)">−' + eur(diff) + '</span>' : '') : '') + '</div></div>';
      }).join('');
    }).catch(function (e) { listEl.innerHTML = '<p class="hint">' + esc(e.message) + ' — choisis « Centre de la carte ».</p>'; });
  }
  $('nearList').addEventListener('click', function (e) {
    var cd = e.target.closest('[data-sid]'); if (!cd) return;
    var s = stations.filter(function (x) { return String(x.id) === cd.getAttribute('data-sid'); })[0]; if (!s) return;
    if (!isWide()) $('panel').classList.add('collapsed');
    openStation(s, true);
  });

  // ------------------------------------------------------------------ démarrage
  $('neighbours').checked = !!state.neighbours;
  $('neighbours').addEventListener('change', function () { state.neighbours = this.checked; save(); rebuild(); if (this.checked) map.fire('moveend'); });
  $('refreshData').addEventListener('click', function () { fetchData(false).then(function () { toast('Prix actualisés'); }); });
  $('brandBtn2').textContent = state.brand ? '🏷️ ' + state.brand + ' uniquement' : 'Toutes les enseignes';
  loadBrands();
  renderFuelChips(); updateSliders(); renderPlaceChips(); showTab(isWide() ? 'route' : 'map');
  if (/[?&]car=1/.test(location.search) || state.carMode) setCarMode(true, true);
  var onAA = /[?&]aa=1/.test(location.search);
  if (onAA) { // écran Android Auto : pas de clavier, on reprend le trajet préparé sur le téléphone
    document.documentElement.setAttribute('data-aa', '');
    var onceLoaded = function () { if (stations.length) { if (state.cars.length) restoreLastRoute(); } else setTimeout(onceLoaded, 500); }; setTimeout(onceLoaded, 800);
    if (!state.cars.length) toast('Renseigne ton véhicule dans FuelMap sur le téléphone');
    console.log('FuelMap Android Auto : ' + innerWidth + 'x' + innerHeight + ', ' + state.cars.length + ' véhicule(s)');
  } else if (!state.cars.length) showOnboarding();

  idb.get('stations').then(function (cached) {
    if (cached && cached.list && cached.list.length) {
      setStations(cached.list, cached.ts); loader(null);
      if (Date.now() - cached.ts > DATA_TTL_MS) fetchData(true);
    } else fetchData(false);
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && dataTs && Date.now() - dataTs > DATA_TTL_MS) fetchData(true); });

  if (!window.Capacitor && !onAA && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(function () { });
  }

  window.__fuelmapLayoutChanged = function (wide) { showTab(wide ? 'route' : 'map'); setTimeout(function () { map.invalidateSize(); }, 50); };
  window.__fuelmapSavings = function () { return state.savings || null; };
  function openFromUrl(url) { // notification d'alerte → fiche de la station
    var m = /fuelmap:\/\/station\/(\d+)/.exec(url || ''); if (!m) return;
    var tryOpen = function (n) { var s = stations.filter(function (x) { return String(x.id) === m[1]; })[0]; if (s) { showTab('map'); openStation(s, true); } else if (n < 40) setTimeout(function () { tryOpen(n + 1); }, 500); };
    tryOpen(0);
  }
  try { var AppP = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App; if (AppP) { AppP.addListener('appUrlOpen', function (e) { openFromUrl(e.url); }); AppP.getLaunchUrl().then(function (r) { if (r && r.url) openFromUrl(r.url); }); } } catch (e) { }
  window.__fuelmap = { carPan: carPan, carZoom: carZoom, carInsets: carInsets, restoreLastRoute: restoreLastRoute, setCarMode: setCarMode, updateHud: updateHud, get fix() { return lastFix; }, set fix(p) { lastFix = mePos = p; updateHud(); }, setPlan: setPlan, alternativesFor: alternativesFor, tryPlan: tryPlan, state: state, compute: computeRoute, setPlace: setPlace, get route() { return routeCtx; }, get count() { return stations.length; }, get stations() { return stations; }, map: map, openStation: openStation }; // pour les tests
})();
