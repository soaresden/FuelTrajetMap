/*
 * Carnet de pleins. Quand la voiture démarre (vitesse nulle) à moins de 80 m d'une station, on demande :
 *   « Tu es à <station> ? Tu as pris du SP98 à 1,990 € ? » → Oui / Autre carburant / Pas de plein
 *   « Combien as-tu payé ? » → pavé numérique → litres déduits du prix → enregistré dans state.fillups.
 * Même écran sur le téléphone (feuille en bas) et dans la voiture (dans la colonne de gauche).
 * Le carnet (onglet Véhicules) liste les pleins : date, station, carburant, litres, montant, prix au litre.
 * Un plein peut aussi être noté à la main depuis la fiche d'une station (📒 J'ai fait le plein ici).
 */
(function () {
  'use strict';
  var A = null, F = null, sheet = null, cur = null, RADIUS_M = 80, COOLDOWN_MS = 3 * 3600 * 1000;
  function ready() { A = A || window.__fuelmapAPI; F = F || window.__fuelmap; return !!(A && F); }
  function st() { var s = A.state; if (!s.fillups) s.fillups = []; return s; }
  function esc(x) { return A.esc(String(x == null ? '' : x)); }
  function fuelName(fi) { return A.FUELS[fi].label; }
  function amountText(digits) { return (digits || '0').replace('.', ',') + ' €'; }

  // ---- détection : à l'arrêt, tout près d'une station
  function nearest(fix) {
    var d = 0.002, dl = d / Math.cos(fix.lat * Math.PI / 180), best = null;
    A.stationsInBounds(fix.lat - d, fix.lon - dl, fix.lat + d, fix.lon + dl).forEach(function (s) {
      var m = A.haversine(fix.lat, fix.lon, s.lat, s.lon) * 1000; if (m <= RADIUS_M && (!best || m < best.m)) best = { s: s, m: m };
    });
    return best;
  }
  function maybeAsk() {
    if (!ready() || !A.stations.length || cur || A.state.fillLog === false) return;
    var f = A.fix; if (!f || (f.speed != null && f.speed > 2)) return;
    var n = nearest(f); if (!n) return;
    var s = st(), last = s.fillAsk;
    if (last && String(last.sid) === String(n.s.id) && Date.now() - last.ts < COOLDOWN_MS) return;
    if (s.fillups.some(function (x) { return String(x.sid) === String(n.s.id) && Date.now() - x.ts < COOLDOWN_MS; })) return;
    s.fillAsk = { sid: n.s.id, ts: Date.now() }; A.save();
    open(n.s, true);
  }

  // ---- écran
  function ensure() {
    if (sheet) return sheet;
    sheet = document.createElement('div'); sheet.id = 'fillSheet'; sheet.hidden = true; document.body.appendChild(sheet);
    sheet.addEventListener('click', function (e) {
      var t;
      if (e.target.closest('[data-fill-no]')) { close(); return; }
      if (e.target.closest('[data-fill-yes]')) { cur.step = 'paid'; render(); return; }
      if (e.target.closest('[data-fill-other]')) { cur.step = 'fuel'; render(); return; }
      if ((t = e.target.closest('[data-fill-fuel]'))) { cur.fi = +t.getAttribute('data-fill-fuel'); cur.price = cur.s.p[cur.fi]; cur.step = 'paid'; render(); return; }
      if ((t = e.target.closest('[data-key]'))) { key(t.getAttribute('data-key')); return; }
      if (e.target.closest('[data-fill-next]')) { cur.paid = parseFloat(cur.digits) || 0; if (!(cur.paid > 0)) return; cur.step = 'km'; cur.digits = ''; render(); return; }
      if (e.target.closest('[data-fill-save]')) { saveFill(); return; }
    });
    return sheet;
  }
  function key(k) {
    var d = cur.digits;
    if (k === 'back') d = d.slice(0, -1);
    else if (k === '.') { if (d.indexOf('.') < 0) d = (d || '0') + '.'; }
    else { if (d.indexOf('.') >= 0 && d.length - d.indexOf('.') > 2) return; if (d === '0') d = ''; if (d.replace('.', '').length >= (cur.step === 'km' ? 7 : 6)) return; d += k; }
    cur.digits = d; render();
  }
  function open(s, auto) {
    if (!ready()) return;
    var c = A.car(), fi = A.FUEL_INDEX[c.fuel], fis = A.fuelsFor(c.fuel), k = s.p[fi] > 0 ? fi : A.pick(s, fis);
    if (k < 0) { for (var i = 0; i < A.FUELS.length; i++) if (s.p[i] > 0) { k = i; break; } }
    cur = { s: s, fi: k, price: k >= 0 ? s.p[k] : 0, step: k >= 0 ? 'ask' : 'fuel', digits: '', auto: !!auto };
    ensure().hidden = false; render();
  }
  function close() { cur = null; if (sheet) sheet.hidden = true; }
  function render() {
    if (!cur) return;
    var s = cur.s, h = '<div class="fs-head"><span>⛽ ' + (cur.auto ? 'Tu viens de faire le plein ?' : 'Noter un plein') + '</span><button class="fs-x" data-fill-no>✕</button></div>' +
      '<div class="fs-station"><b>' + A.brandName(s) + esc(A.titleCase(s.ville)) + '</b><br><small>' + esc(A.titleCase(s.adr)) + '</small></div>';
    if (cur.step === 'ask') {
      h += '<p class="fs-q">Tu as pris du <b>' + fuelName(cur.fi) + '</b> à <b>' + A.price3(cur.price) + ' €</b> ?</p>' +
        '<div class="fs-row"><button class="fs-btn yes" data-fill-yes>✅ Oui</button><button class="fs-btn" data-fill-other>⛽ Autre carburant</button></div>' +
        '<button class="fs-btn ghost" data-fill-no>Pas de plein, merci</button>';
    } else if (cur.step === 'fuel') {
      h += '<p class="fs-q">Quel carburant ?</p><div class="fs-fuels">';
      for (var i = 0; i < A.FUELS.length; i++) if (s.p[i] > 0) h += '<button class="fs-btn' + (i === cur.fi ? ' yes' : '') + '" data-fill-fuel="' + i + '">' + fuelName(i) + '<small>' + A.price3(s.p[i]) + ' €</small></button>';
      h += '</div><button class="fs-btn ghost" data-fill-no>Annuler</button>';
    } else if (cur.step === 'km') {
      var km = parseInt(cur.digits, 10) || 0, lastKm = lastOdometer(), gap = lastKm && km > lastKm ? km - lastKm : 0;
      h += '<p class="fs-q">Kilométrage au compteur ? <small>facultatif — sert aux stats (km parcourus, conso réelle)' + (lastKm ? ' · dernier relevé : ' + A.num(lastKm) + ' km' : '') + '</small></p>' +
        '<div class="fs-amount"><b>' + (cur.digits ? A.num(km) : '—') + ' km</b><small>' + (gap ? '+ ' + A.num(gap) + ' km' : '&nbsp;') + '</small></div>' +
        '<div class="fs-pad">' + ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'].map(function (k) { return k === '' ? '<span></span>' : '<button data-key="' + k + '">' + (k === 'back' ? '⌫' : k) + '</button>'; }).join('') + '</div>' +
        '<div class="fs-row"><button class="fs-btn ghost" data-fill-save>Passer</button><button class="fs-btn yes big" data-fill-save' + (km > 0 ? '' : ' disabled') + '>💾 Enregistrer</button></div>';
    } else {
      var paid = parseFloat(cur.digits) || 0, liters = cur.price > 0 ? paid / cur.price : 0;
      h += '<p class="fs-q">Combien as-tu payé ? <small>' + fuelName(cur.fi) + ' à ' + A.price3(cur.price) + ' €</small></p>' +
        '<div class="fs-amount"><b>' + amountText(cur.digits) + '</b><small>' + (liters > 0 ? '≈ ' + A.num(liters, 1) + ' L' : '&nbsp;') + '</small></div>' +
        '<div class="fs-pad">' + ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'].map(function (k) { return '<button data-key="' + k + '">' + (k === 'back' ? '⌫' : k === '.' ? ',' : k) + '</button>'; }).join('') + '</div>' +
        '<button class="fs-btn yes big" data-fill-next' + (paid > 0 ? '' : ' disabled') + '>Suivant ›</button>';
    }
    sheet.innerHTML = '<div class="fs-card">' + h + '</div>';
  }
  function lastOdometer() { var c = A.car(), best = 0; st().fillups.forEach(function (x) { if (x.km && (!c.id || x.car === c.id) && x.km > best) best = x.km; }); return best; }
  function saveFill() {
    var paid = cur.paid || parseFloat(cur.digits) || 0; if (!(paid > 0)) return;
    var km = cur.step === 'km' ? parseInt(cur.digits, 10) || null : null;
    var s = cur.s, c = A.car(), liters = cur.price > 0 ? paid / cur.price : null;
    st().fillups.push({ ts: Date.now(), km: km, sid: s.id, name: (s.brand ? s.brand + ' ' : '') + A.titleCase(s.ville), adr: A.titleCase(s.adr), lat: s.lat, lon: s.lon, fuel: A.FUELS[cur.fi].key, fi: cur.fi, price: cur.price, paid: Math.round(paid * 100) / 100, liters: liters == null ? null : Math.round(liters * 100) / 100, car: c.id || null, carName: c.name || '' });
    A.save(); close();
    try { A.toast && A.toast('📒 Plein noté : ' + (liters ? A.num(liters, 1) + ' L de ' : '') + fuelName(cur ? cur.fi : 0) + ' pour ' + amountText(String(paid))); } catch (e) { }
    document.dispatchEvent(new CustomEvent('fuelmap:fillups'));
    renderLog();
  }

  // ---- carnet (onglet Véhicules du téléphone)
  function renderLog() {
    var el = document.getElementById('fillLog'); if (!el || !ready()) return;
    var list = st().fillups.slice().sort(function (a, b) { return b.ts - a.ts; }), on = A.state.fillLog !== false;
    var sw = '<div class="field check" style="margin:0 0 10px"><label><input type="checkbox" id="fillLogOn"' + (on ? ' checked' : '') + '> Me demander « tu viens de faire le plein ? » au démarrage près d\'une station</label></div>';
    if (!list.length) { el.innerHTML = sw + '<p class="hint">Aucun plein noté. ' + (on ? 'Au démarrage de la voiture près d\'une station, FuelMap te demande combien tu as payé ; tu' : 'Tu') + ' peux aussi noter un plein depuis la fiche d\'une station (📒).</p>'; return; }
    var L = 0, E = 0, n = 0, kmTot = 0, lTot = 0, eTot = 0; list.forEach(function (x) { if (x.liters) { L += x.liters; n++; } E += x.paid; });
    // km parcourus et conso : entre deux relevés de compteur du même véhicule (les litres du plein le plus récent couvrent la distance précédente, pleins complets supposés)
    var byCar = {}; list.slice().reverse().forEach(function (x) { var k = x.car || '-'; if (x.km) { var p = byCar[k]; if (p && x.km > p.km && x.liters) { x._km = x.km - p.km; x._cons = x.liters / x._km * 100; kmTot += x._km; lTot += x.liters; eTot += x.paid; } byCar[k] = x; } });
    var h = sw + '<div class="fl-stats"><span><b>' + list.length + '</b> plein' + (list.length > 1 ? 's' : '') + '</span><span><b>' + A.num(L) + '</b> L</span><span><b>' + A.num(E) + '</b> €</span>' + (L > 0 ? '<span><b>' + A.price3(E / L) + '</b> €/L</span>' : '') +
      (kmTot > 0 ? '<span><b>' + A.num(kmTot) + '</b> km</span><span><b>' + A.num(lTot / kmTot * 100, 1) + '</b> L/100</span><span><b>' + A.num(eTot / kmTot * 100, 1) + '</b> €/100 km</span>' : '') + '</div>';
    h += list.map(function (x, i) {
      var d = new Date(x.ts), when = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      var prev = list[i + 1], gap = prev ? Math.round((x.ts - prev.ts) / 86400000) : null;
      return '<div class="fl-row"><div class="fl-l"><b>' + esc(x.name) + '</b><small>' + esc(when) + (x.carName ? ' · ' + esc(x.carName) : '') + (x.km ? ' · ' + A.num(x.km) + ' km' : '') + (x._km ? ' · <b>' + A.num(x._km) + ' km</b> en ' + gap + ' j · <b>' + A.num(x._cons, 1) + ' L/100</b>' : gap != null ? ' · ' + gap + ' j après le précédent' : '') + '</small></div>' +
        '<div class="fl-r"><b>' + A.num(x.paid) + ' €</b><small>' + (x.liters ? A.num(x.liters, 1) + ' L · ' : '') + fuelName(x.fi) + ' ' + A.price3(x.price) + '</small></div><button class="fl-del" data-fill-del="' + x.ts + '" title="Supprimer">🗑️</button></div>';
    }).join('');
    el.innerHTML = h;
  }
  document.addEventListener('change', function (e) { if (e.target && e.target.id === 'fillLogOn' && ready()) { A.state.fillLog = e.target.checked; A.save(); renderLog(); } });
  document.addEventListener('click', function (e) {
    var t;
    if ((t = e.target.closest('[data-fill-del]'))) { if (!ready()) return; var ts = +t.getAttribute('data-fill-del'); st().fillups = st().fillups.filter(function (x) { return x.ts !== ts; }); A.save(); renderLog(); return; }
    if ((t = e.target.closest('[data-fill]'))) { if (!ready()) return; var s = A.stations.filter(function (x) { return String(x.id) === t.getAttribute('data-fill'); })[0]; if (s) { try { A.map.closePopup(); } catch (err) { } open(s, false); } }
  });
  document.addEventListener('fuelmap:tab', function (e) { if (e.detail === 'cars') renderLog(); });
  document.addEventListener('fuelmap:fix', maybeAsk);
  document.addEventListener('fuelmap:stations', maybeAsk);
  window.__fuelmapFill = { open: open, close: close, ask: maybeAsk, renderLog: renderLog, get current() { return cur; } };
})();
