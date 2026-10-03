/*
 * Journal de diagnostic côté page. FM.log('…') garde les 300 dernières lignes en mémoire, les écrit dans la console
 * (dans la voiture, la console remonte au journal Android) et, dans l'appli Android, les pousse au plugin Diag.
 * Erreurs JS et promesses rejetées sont capturées. Le bouton « Envoyer le journal » (Véhicules → Données) fabrique
 * le zip côté Android (journal fichier + logcat + état) et ouvre le partage ; sur le web, il télécharge le journal JS.
 */
(function () {
  'use strict';
  var ring = [], MAXL = 300, plugin = null, t0 = Date.now();
  function P() { if (plugin === null) { try { plugin = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Diag) || false; } catch (e) { plugin = false; } } return plugin; }
  function stamp() { var d = new Date(); return d.toTimeString().slice(0, 8) + '.' + ('00' + d.getMilliseconds()).slice(-3); }
  function log(msg) {
    var line = stamp() + ' ' + msg; ring.push(line); if (ring.length > MAXL) ring.shift();
    try { console.log('[FM] ' + msg); } catch (e) { }
    try { if (P() && !/[?&]aa=1/.test(location.search)) P().log({ message: msg }); } catch (e) { }
  }
  function marker(what) { log('=========== ' + what + ' ==========='); try { if (P()) P().marker({ what: what }); } catch (e) { } }
  function snapshot() {
    var A = window.__fuelmapAPI, st = A && A.state, out = { page: location.search || '/', up: Math.round((Date.now() - t0) / 1000) + ' s', size: innerWidth + 'x' + innerHeight, ua: navigator.userAgent, now: new Date().toString() };
    try {
      if (A) {
        out.fix = A.fix || null; out.stations = A.stations.length; out.zoom = A.map.getZoom(); out.center = A.map.getCenter();
        out.car = A.car(); out.route = A.route ? { from: A.route.from, to: A.route.to, D: A.route.D, stops: A.route.plan ? A.route.plan.stops.map(function (s) { return { pos: s.pos, ville: s.station.s.ville, buyL: s.buyL }; }) : null } : null;
        if (st) out.state = { theme: st.theme, fuel: st.fuel, startE: st.startE, arrivalE: st.arrivalE, corridor: st.corridor, alert: st.alert, lastRoute: st.lastRoute, shortage: st.shortage, fillLog: st.fillLog, fillups: (st.fillups || []).length, places: (st.places || []).length, cars: (st.cars || []).length };
      }
      if (window.__fuelmapCar && window.__fuelmapCar.state) out.carUi = window.__fuelmapCar.state();
    } catch (e) { out.snapshotError = String(e); }
    out.jsLog = ring.slice();
    return out;
  }
  function exportDiag() {
    var version = (window.FUELMAP_CONFIG || {}).version || '?', snap = JSON.stringify(snapshot(), null, 1);
    marker('export du journal demandé');
    if (P()) return P().export({ version: version, state: snap }).then(function (r) { log('journal exporté : ' + (r && r.file)); return r; });
    var blob = new Blob(['FuelMap ' + version + '\n\n' + snap], { type: 'text/plain' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'fuelmap-diag.txt'; document.body.appendChild(a); a.click(); setTimeout(function () { a.remove(); URL.revokeObjectURL(a.href); }, 1000);
    return Promise.resolve({ file: a.download });
  }
  window.addEventListener('error', function (e) { log('ERREUR JS : ' + (e.message || e) + ' @ ' + (e.filename || '').split('/').pop() + ':' + e.lineno); });
  window.addEventListener('unhandledrejection', function (e) { log('PROMESSE REJETÉE : ' + (e.reason && (e.reason.message || e.reason))); });
  // événements de l'appli
  var lastFixLog = 0;
  document.addEventListener('fuelmap:stations', function () { var A = window.__fuelmapAPI; log('stations chargées : ' + (A ? A.stations.length : '?')); });
  document.addEventListener('fuelmap:fix', function () { var A = window.__fuelmapAPI, f = A && A.fix; if (Date.now() - lastFixLog < 60000) return; lastFixLog = Date.now(); if (f) log('GPS ' + f.lat.toFixed(5) + ',' + f.lon.toFixed(5) + (f.speed != null ? ' ' + Math.round(f.speed * 3.6) + ' km/h' : '')); });
  document.addEventListener('fuelmap:route', function (e) { var A = window.__fuelmapAPI, R = A && A.route; log(e.detail && e.detail.error ? 'trajet : ERREUR ' + e.detail.error : R && R.plan ? 'trajet : ' + Math.round(R.D) + ' km, ' + R.plan.stops.length + ' arrêt(s)' + (R.to ? ' → ' + R.to.label : '') : 'trajet : (pas de plan)'); });
  document.addEventListener('fuelmap:tab', function (e) { log('onglet ' + e.detail); });
  document.addEventListener('fuelmap:fillups', function () { log('plein enregistré'); });
  document.addEventListener('visibilitychange', function () { log(document.hidden ? 'page masquée' : 'page visible'); });
  document.addEventListener('click', function (e) {
    var t = e.target.closest('button, a, [data-sid], [data-mode]'); if (!t) return;
    var id = t.id ? '#' + t.id : '', d = t.dataset ? Object.keys(t.dataset).slice(0, 2).map(function (k) { return k + '=' + t.dataset[k]; }).join(' ') : '';
    log('clic ' + t.tagName.toLowerCase() + id + (d ? ' [' + d + ']' : '') + (t.className && typeof t.className === 'string' ? ' .' + t.className.split(' ')[0] : '') + ' « ' + (t.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40) + ' »');
  }, true);
  log('page démarrée ' + (location.search || '/') + ' ' + innerWidth + 'x' + innerHeight);
  window.FM = { log: log, marker: marker, snapshot: snapshot, export: exportDiag, lines: function () { return ring.slice(); } };
  document.addEventListener('click', function (e) { if (e.target.closest('#diagBtn')) { var b = e.target.closest('#diagBtn'); b.disabled = true; b.textContent = '⏳ Préparation du journal…'; exportDiag().then(function () { b.textContent = '🐞 Envoyer le journal de diagnostic'; b.disabled = false; }, function (err) { b.textContent = '⚠️ ' + (err && err.message || err); b.disabled = false; }); } });
})();
