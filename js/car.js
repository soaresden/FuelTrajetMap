/*
 * Écran Android Auto (page ouverte avec ?aa=1) : une interface dédiée, pensée pour l'écran de la voiture.
 *   - Colonne de gauche : « Stations » (celles de la zone affichée sur la carte, du moins cher au plus cher, ou l'inverse)
 *     ou « Trajet » (départ = la voiture, destination choisie en deux touchers, niveau de carburant, arrêts proposés).
 *     La liste défile au doigt (les gestes de l'hôte sont renvoyés ici par CarWebSurface : scroll/fling).
 *   - À droite : la carte, et rien d'autre. Un toucher sur une ligne centre la carte sur la station et « Y aller » la vise.
 * Pas de clavier dans la page : chercher une adresse passe par l'écran de recherche de l'hôte (bouton 🔍), qui rappelle setDest().
 */
(function () {
  'use strict';
  if (!/[?&]aa=1/.test(location.search)) return;
  var A = null, F = null, pane = document.getElementById('carPane'), mode = 'stations', selected = null, timer = null;
  var sortAsc = true, dest = null, computing = false, routeErr = null, lastX = -1, selMarker = null, listEl = null, scrollKeep = 0;
  var open = false, rail = document.createElement('nav'); rail.id = 'carRail'; rail.hidden = true; document.body.appendChild(rail);
  try { var mem = JSON.parse(localStorage.getItem('fuelmap-carui') || 'null'); if (mem) { open = !!mem.open; if (mem.mode) mode = mem.mode; } } catch (e) { }
  function remember() { try { localStorage.setItem('fuelmap-carui', JSON.stringify({ open: open, mode: mode })); } catch (e) { } }
  var MODES = [['stations', '⛽', 'Stations'], ['route', '🧭', 'Trajet'], ['shortage', '🚨', 'Pénurie']];
  function renderRail() {
    rail.innerHTML = MODES.map(function (m) { return '<button class="' + (open && mode === m[0] ? 'on' : '') + '" data-rail="' + m[0] + '" aria-label="' + m[2] + '"><span>' + m[1] + '</span><small>' + m[2] + '</small></button>'; }).join('') +
      (open ? '<button class="cclose" data-rail="close" aria-label="Replier">‹</button>' : '');
    document.documentElement.classList.toggle('carpane-open', open);
    pane.classList.toggle('open', open);
  }
  function setOpen(o, m) {
    if (m && m !== mode) { mode = m; selected = null; scrollKeep = 0; }
    open = o; remember(); renderRail(); if (open) render();
    try { window.FM && window.FM.log('voiture : panneau ' + (open ? 'ouvert ' + mode : 'replié')); } catch (e) { }
  }

  function ready() { A = window.__fuelmapAPI; F = window.__fuelmap; return !!(A && F); }
  function origin() { var f = A.fix; return f ? { lat: f.lat, lon: f.lon } : { lat: A.map.getCenter().lat, lon: A.map.getCenter().lng }; }
  function name(s) { return (s.id === 'dest' || s.id === 'ext') ? A.esc(s.ville) : A.brandName(s) + A.esc(A.titleCase(s.ville)); }
  function dot(level) { return '<i class="cdot c' + level + '"></i>'; }
  function dur(dm) { dm = Math.round(dm); return dm >= 60 ? Math.floor(dm / 60) + ' h ' + ('0' + dm % 60).slice(-2) : dm + ' min'; }

  // ---- stations de la zone affichée : ouvertes, sans rupture, colorées du vert (moins cher) au rouge (plus cher)
  function viewStations() {
    var c = A.car(), fis = A.fuelsFor(c.fuel), o = origin(), b = A.map.getBounds();
    var list = A.stationsInBounds(b.getSouth(), b.getWest(), b.getNorth(), b.getEast()).map(function (s) {
      var k = A.pick(s, fis); if (k < 0) return null;
      var op = A.opening(s); if (op && !op.open) return null;
      return { s: s, k: k, p: s.p[k], d: A.haversine(o.lat, o.lon, s.lat, s.lon), conf: A.confidence(s, k), op: op };
    }).filter(Boolean);
    if (list.length > 40) { list.sort(function (a, b) { return a.d - b.d; }); list = list.slice(0, 40); } // zone trop large : les 40 plus proches
    var ps = list.map(function (x) { return x.p; }).sort(function (a, b) { return a - b; }), lo = ps[0] || 0, hi = ps[ps.length - 1] || 1;
    if (ps.length > 6) { lo = ps[Math.floor(ps.length * 0.05)]; hi = ps[Math.floor(ps.length * 0.95)]; }
    if (hi - lo < 0.02) { lo -= 0.01; hi += 0.01; }
    list.forEach(function (x) { x.t = (x.p - lo) / (hi - lo); });
    list.sort(function (a, b) { return (sortAsc ? a.p - b.p : b.p - a.p) || a.d - b.d; });
    return list;
  }
  // ---- pénurie : autour de la voiture (20 km), ouvertes, sans rupture déclarée, classées par la note (fraîcheur, proximité, prix)
  function shortageStations() {
    var c = A.car(), fis = A.fuelsFor(c.fuel), o = origin(), d = 20 / 111, dl = d / Math.cos(o.lat * Math.PI / 180);
    var list = A.stationsInBounds(o.lat - d, o.lon - dl, o.lat + d, o.lon + dl).map(function (s) {
      var k = A.pick(s, fis); if (k < 0) return null;
      var conf = A.confidence(s, k); if (!conf || conf.level < 0) return null;
      var op = A.opening(s); if (op && !op.open) return null;
      var dist = A.haversine(o.lat, o.lon, s.lat, s.lon); if (dist > 20) return null;
      var sc = A.score(s, fis, dist); if (!sc) return null;
      var auto = A.isAutoUpdate(s, k), fresh = auto ? Math.min(sc.fresh, 1.5) : sc.fresh; // poussé à heure fixe : ça ne dit rien de la cuve
      return { s: s, k: k, p: s.p[k], d: dist, conf: conf, op: op, auto: auto, sc: { total: Math.max(0, Math.min(10, fresh + sc.near + sc.price)), fresh: fresh, near: sc.near, price: sc.price } };
    }).filter(Boolean);
    list.sort(function (a, b) { return b.sc.total - a.sc.total || a.d - b.d; });
    return list.slice(0, 40);
  }
  function stationRow(x, extra, right) {
    var s = x.s, k = x.k, fi = A.FUEL_INDEX[A.car().fuel], col = x.t == null ? '' : ' style="--pc:' + A.colorFor(x.t) + '"';
    return '<button class="crow' + (selected && String(selected.id) === String(s.id) ? ' on' : '') + (x.t != null ? ' tinted' : '') + '" data-sid="' + s.id + '"' + col + '>' +
      '<div class="l1"><span class="nm">' + name(s) + '</span><span class="pr">' + A.price3(s.p[k]) + '</span></div>' +
      '<div class="l2"><span>' + (extra || A.num(x.d, 1) + ' km') + (k !== fi ? ' · ' + A.FUELS[k].label : '') + '</span><span>' + dot(x.conf.level) + (right || A.whenText(s, k)) + (x.op && x.op.until ? ' · 🕒 ' + x.op.until : x.op && x.op.a24 ? ' · 24/24' : '') + '</span></div></button>';
  }

  // ---- trajet : départ = la voiture, destination choisie ici (favoris, dernier trajet du téléphone, recherche de l'hôte)
  function destChoices() {
    var out = [], seen = {}, add = function (ico, label, p, tag) { var key = (+p.lat).toFixed(3) + ',' + (+p.lon).toFixed(3); if (seen[key]) return; seen[key] = 1; out.push({ ico: ico, label: label, p: p, tag: tag }); };
    var lr = A.state.lastRoute; if (lr && lr.to && Date.now() - lr.ts < 7 * 86400000) add('📱', lr.to.label, lr.to, 'Dernier trajet');
    (A.state.places || []).forEach(function (p) { add('⭐', p.name || p.label, p, p.label !== p.name ? p.label : ''); });
    return out;
  }
  function routeRows() {
    var R = A.route; if (!R || !R.plan) return null;
    var f = A.fix, pr = f ? A.progressKm(R, f) : null, out = [], passed = 0;
    if (pr && pr.off > 2) pr = null; // loin de la route (pas encore partie, détour) : l'avancement n'est pas fiable, on garde tous les arrêts
    R.plan.stops.forEach(function (st, i) {
      if (pr && st.pos <= pr.km + 0.5) { passed++; return; }
      var s = st.station.s, k = st.station.fi;
      out.push({ s: s, k: k, d: pr ? st.pos - pr.km : st.pos, conf: A.confidence(s, k), op: A.opening(s), st: st, idx: i });
    });
    return { list: out, passed: passed, total: R.plan.stops.length, R: R };
  }
  function bars() {
    var e = A.state.startE, c = A.car(), h = '<div class="cbars"><span class="lb">⛽ Réservoir</span><div class="cb">';
    for (var i = 1; i <= 8; i++) h += '<button data-e="' + i + '" class="' + (i <= e ? 'on' + (e <= 2 ? ' low' : '') : '') + '"></button>';
    return h + '</div><span class="val">' + A.eighths(e) + ' · ≈ ' + A.num(c.tank * e / 8) + ' L</span></div>';
  }

  var t0 = Date.now();
  function noGps() { return Date.now() - t0 < 12000 ? '<p class="cmsg">⏳ En attente du GPS…</p>' : '<p class="cmsg">📍 Pas de position.<br><small>Sur le téléphone, ouvre FuelMap et autorise la localisation (ou Paramètres → Applis → FuelMap → Autorisations), puis reviens ici.</small></p>'; }
  function render() {
    if (!ready() || pane.hidden) return;
    if (!open) { renderRail(); return; }
    var c = A.car(), body = '', head = '';
    if (listEl) scrollKeep = listEl.scrollTop;
    if (mode === 'shortage') {
      var sh = shortageStations();
      if (!A.stations.length) body = '<p class="cmsg">⏳ Chargement des prix…</p>';
      else if (!A.fix) body = noGps();
      else if (!sh.length) body = '<p class="cmsg">Aucune station ' + A.FUELS[A.FUEL_INDEX[c.fuel]].label + ' ouverte sans rupture à moins de 20 km.</p>';
      else {
        if (!selected || !sh.some(function (x) { return String(x.s.id) === String(selected.id); })) select(sh[0].s, false);
        body = sh.map(function (x, i) { return stationRow(x, (i === 0 ? '👉 ' : '') + A.num(x.d, 1) + ' km · <b class="csc">' + A.num(x.sc.total, 1) + '/10</b>', (x.auto ? '🤖 màj auto ' : A.esc(x.conf.label) + ' · ') + A.whenText(x.s, x.k)); }).join('');
      }
      head = '<div class="chead"><span>🚨 Où il y a du carburant <small>màj · km · prix</small></span></div>';
    } else if (mode === 'stations') {
      var vs = viewStations();
      if (!A.stations.length) body = '<p class="cmsg">⏳ Chargement des prix…</p>';
      else if (!vs.length) body = '<p class="cmsg">Aucune station ' + A.FUELS[A.FUEL_INDEX[c.fuel]].label + ' ouverte avec un prix récent dans la zone affichée.<br><small>Déplace ou dézoome la carte.</small></p>';
      else {
        if (!selected || !vs.some(function (x) { return String(x.s.id) === String(selected.id); })) select(vs[0].s, false);
        body = vs.map(function (x) { return stationRow(x); }).join('');
      }
      head = '<div class="chead"><span>' + (vs.length ? vs.length + ' station' + (vs.length > 1 ? 's' : '') + ' <small>dans la zone</small>' : '<small>Zone affichée</small>') + '</span><button class="csort" data-sort>' + (sortAsc ? '💶 Prix ↑' : '💶 Prix ↓') + '</button></div>';
    } else {
      head = '<div class="cfrom">📍 <b>Ma position</b> → ' + (dest ? '<b>' + A.esc(String(dest.label).split(',')[0]) + '</b><button class="cx" data-nodest>✕</button>' : '<span class="muted">destination ?</span>') + '</div>' + bars();
      if (!dest) {
        var ch = destChoices();
        body = '<button class="crow cchoice" data-search><div class="l1"><span class="nm">🔍 Chercher une adresse</span></div><div class="l2"><span>Clavier ou voix, via Android Auto</span></div></button>' +
          ch.map(function (x, i) { return '<button class="crow cchoice" data-dest="' + i + '"><div class="l1"><span class="nm">' + x.ico + ' ' + A.esc(String(x.label).split(',')[0]) + '</span></div><div class="l2"><span>' + A.esc(x.tag || x.label) + '</span></div></button>'; }).join('') +
          (ch.length ? '' : '<p class="cmsg"><small>Ajoute des favoris ⭐ dans FuelMap sur le téléphone : ils apparaissent ici.</small></p>');
        pane._choices = ch;
      } else if (computing) body = '<p class="cmsg">⏳ Calcul du trajet et des arrêts…</p>';
      else if (routeErr) body = '<p class="cmsg">⚠️ ' + A.esc(routeErr) + '<br><small>Touche ✕ et choisis une autre destination.</small></p>';
      else {
        var rr = routeRows();
        if (!rr) body = noGps();
        else {
          var R = rr.R, dm = R.durMin;
          body = '<div class="ctrip">🏁 ' + A.num(R.D) + ' km · ' + dur(dm) + ' · ' + (rr.total ? rr.total + ' arrêt' + (rr.total > 1 ? 's' : '') : 'sans arrêt') + ' · arrivée ≈ ' + A.num(R.plan.arrivalL) + ' L</div>';
          if (!rr.list.length) body += '<p class="cmsg">' + (rr.total ? '🏁 Arrêts faits, plus rien de prévu.' : '✅ Pas besoin de s\'arrêter.') + '</p>';
          else {
            if (!selected || !rr.list.some(function (x) { return String(x.s.id) === String(selected.id); })) select(rr.list[0].s, false);
            body += rr.list.map(function (x, i) { return stationRow(x, (i === 0 ? 'Prochain · ' : '') + 'km ' + A.num(x.st.pos) + ' · mets ' + A.num(x.st.buyL, x.st.buyL < 10 ? 1 : 0) + ' L'); }).join('');
          }
        }
      }
    }
    if (!selected && selMarker) { try { selMarker.remove(); } catch (e) { } selMarker = null; }
    if (!selected && mode === 'route' && dest && !computing) { // pas d'arrêt : « Y aller » (bouton de l'hôte) vise la destination
      try { if (window.AndroidAuto && window.AndroidAuto.setTarget) window.AndroidAuto.setTarget(dest.lat, dest.lon, String(dest.label).split(',')[0]); } catch (e) { }
    }
    pane.innerHTML = head + '<div class="clist">' + body + '</div>';
    listEl = pane.querySelector('.clist'); listEl.scrollTop = scrollKeep;
    renderRail();
  }

  // ---- carte de station (sur la carte) : prix, fraîcheur, distance, « Y aller » + Maps sur le téléphone
  var popup = null;
  function card(s) {
    var k = A.pick(s, A.fuelsFor(A.car().fuel)), o = origin(), conf = k >= 0 ? A.confidence(s, k) : null, op = A.opening(s);
    var html = '<div class="cpop"><div class="t"><span>' + name(s) + '</span>' + (k >= 0 ? '<span class="pr">' + A.price3(s.p[k]) + '</span>' : '') + '</div>' +
      '<div class="s">' + A.esc(A.titleCase(s.adr)) + ' · ' + A.num(A.haversine(o.lat, o.lon, s.lat, s.lon), 1) + ' km' + (k >= 0 ? '<br>' + A.FUELS[k].label + ' · ' + dot(conf.level) + A.esc(conf.label) + ' · ' + A.whenText(s, k) : '') + (op && !op.open ? '<br>🔒 fermée' : op && op.until ? '<br>🕒 ouverte jusqu\'à ' + op.until : '') + '</div>' +
      '<div class="b"><button class="go" data-go="' + s.id + '">🧭 Y aller</button><button data-maps="' + s.id + '" title="Google Maps sur le téléphone">📱 Maps</button></div></div>';
    if (!popup) popup = L.popup({ offset: [0, -8], maxWidth: 320, autoPan: true, closeButton: false, autoPanPaddingTopLeft: [(open ? pane.getBoundingClientRect().width : 0) + 20, 110], autoPanPaddingBottomRight: [20, 20] });
    popup.options.autoPanPaddingTopLeft = L.point((open ? pane.getBoundingClientRect().width : 0) + 20, 110);
    popup.setLatLng([s.lat, s.lon]).setContent(html).openOn(A.map);
  }
  function select(s, fly) {
    selected = s; try { if (fly && window.FM) window.FM.log('voiture : station choisie ' + s.id + ' ' + s.ville); } catch (e) { }
    try {
      if (!selMarker) selMarker = L.marker([s.lat, s.lon], { icon: L.divIcon({ className: '', html: '<div class="csel-marker"></div>', iconSize: [34, 34], iconAnchor: [17, 17] }), interactive: false, zIndexOffset: 1000 }).addTo(A.map);
      else selMarker.setLatLng([s.lat, s.lon]);
    } catch (e) { }
    try { if (window.AndroidAuto && window.AndroidAuto.setTarget) { var k = A.pick(s, A.fuelsFor(A.car().fuel)); window.AndroidAuto.setTarget(s.lat, s.lon, (s.brand ? s.brand + ' ' : '') + A.titleCase(s.ville) + (k >= 0 ? ' · ' + A.price3(s.p[k]) + ' €' : '')); } } catch (e) { }
    if (fly) { A.setFollow(false); A.map.setView(shifted([s.lat, s.lon], Math.max(A.map.getZoom(), 13)), Math.max(A.map.getZoom(), 13), { animate: false }); card(s); }
  }

  // ---- guidage FuelMap : itinéraire jusqu'à la station dessiné sur la carte, distance et temps restants, la carte suit la voiture
  var guide = null, guideLayer = null, guideBox = document.createElement('div'); guideBox.id = 'carGuide'; guideBox.hidden = true; document.body.appendChild(guideBox);
  guideBox.addEventListener('click', function (e) { if (e.target.closest('[data-stopguide]')) stopGuide(); });
  function go(s) {
    var f = A.fix; if (!f) { A.toast('📍 Pas de position GPS'); return; }
    try { window.FM && window.FM.log('voiture : Y aller ' + s.id + ' ' + s.ville); } catch (e) { }
    var k = A.pick(s, A.fuelsFor(A.car().fuel)), label = name(s) + (k >= 0 ? ' · ' + A.price3(s.p[k]) + ' €' : '');
    stopGuide(); try { A.map.closePopup(); } catch (e) { }
    guide = { s: s, label: label, pts: null, cum: null, D: 0, min: 0 }; guideBox.hidden = false; guideBox.innerHTML = '<div><div class="d">⏳ Itinéraire…</div><div class="n">' + label + '</div></div><button data-stopguide>✕</button>';
    A.osrmRoute([{ lat: f.lat, lon: f.lon }, { lat: s.lat, lon: s.lon }], true).then(function (r) {
      if (!guide || guide.s !== s) return;
      var pts = A.decodePolyline(r.geometry), cum = [0];
      for (var i = 1; i < pts.length; i++) cum.push(cum[i - 1] + A.haversine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
      guide.pts = pts; guide.cum = cum; guide.D = r.distance / 1000; guide.min = r.duration / 60;
      guideLayer = L.layerGroup([L.polyline(pts, { color: '#061a12', weight: 11, opacity: .55, lineCap: 'round' }), L.polyline(pts, { className: 'cguide-line', weight: 6, opacity: .95, lineCap: 'round' })]).addTo(A.map);
      setOpen(false); A.setFollow(true); A.map.setView([f.lat, f.lon], 15, { animate: false }); updateGuide();
    }).catch(function (err) { A.toast('⚠️ ' + (err.message || 'itinéraire impossible')); stopGuide(); });
  }
  function updateGuide() {
    if (!guide || !guide.pts) return;
    var f = A.fix, best = Infinity, km = 0; if (!f) return;
    for (var i = 0; i < guide.pts.length; i += 2) { var d = A.haversine(f.lat, f.lon, guide.pts[i][0], guide.pts[i][1]); if (d < best) { best = d; km = guide.cum[i]; } }
    var left = Math.max(0, guide.D - km), mins = guide.min * (guide.D > 0 ? left / guide.D : 1), direct = A.haversine(f.lat, f.lon, guide.s.lat, guide.s.lon);
    if (direct < 0.08) { guideBox.innerHTML = '<div><div class="d">🏁 Tu y es</div><div class="n">' + guide.label + '</div></div><button data-stopguide>✕</button>'; return; }
    guideBox.innerHTML = '<div><div class="d">' + (left < 1 ? Math.round(left * 1000) + ' m' : A.num(left, 1) + ' km') + '<small>' + (mins < 1 ? '< 1 min' : Math.round(mins) + ' min') + (best > 0.3 ? ' · hors itinéraire' : '') + '</small></div><div class="n">➡ ' + guide.label + '</div></div><button data-stopguide>✕</button>';
    if (best > 0.5) reroute();
  }
  var rerouteAt = 0;
  function reroute() { if (Date.now() - rerouteAt < 20000 || !guide) return; rerouteAt = Date.now(); var s = guide.s; try { window.FM && window.FM.log('voiture : recalcul de l\'itinéraire'); } catch (e) { } go(s); }
  function stopGuide() { guide = null; guideBox.hidden = true; if (guideLayer) { try { guideLayer.remove(); } catch (e) { } guideLayer = null; } }
  function phoneMaps(s) { try { if (window.AndroidAuto && window.AndroidAuto.openMaps) { window.AndroidAuto.openMaps(s.lat, s.lon, name(s).replace(/<[^>]+>/g, '')); return; } } catch (e) { } location.href = 'geo:' + s.lat + ',' + s.lon + '?q=' + s.lat + ',' + s.lon; }
  document.addEventListener('click', function (e) {
    var t; if ((t = e.target.closest('[data-go]'))) { var s = A.stations.filter(function (x) { return String(x.id) === t.getAttribute('data-go'); })[0]; if (s) go(s); }
    else if ((t = e.target.closest('[data-maps]'))) { var s2 = A.stations.filter(function (x) { return String(x.id) === t.getAttribute('data-maps'); })[0]; if (s2) phoneMaps(s2); }
  });
  // le panneau recouvre la gauche de la carte : on décale le centre pour que le point soit visible à droite
  function shifted(ll, z) {
    var cover = open ? pane.getBoundingClientRect().right - A.map.getContainer().getBoundingClientRect().left : 0; if (cover <= 0) return ll;
    return A.map.unproject(A.map.project(L.latLng(ll), z).subtract([cover / 2, 0]), z);
  }

  // ---- trajet : calcul depuis la position de la voiture (recalculé à chaque changement de destination ou de niveau)
  function compute() {
    var f = A.fix;
    if (!dest || !f || !A.stations.length) { schedule(); return; }
    F.setPlace('from', { label: 'Ma position', lat: f.lat, lon: f.lon, gps: true }); F.setPlace('to', dest);
    computing = true; routeErr = null; selected = null; render();
    F.compute();
  }
  function setDest(p) { try { window.FM && window.FM.log('voiture : destination ' + (p ? p.label + ' (' + p.lat + ',' + p.lon + ')' : 'effacée')); } catch (e) { } dest = p ? { label: p.label, lat: +p.lat, lon: +p.lon } : null; selected = null; routeErr = null; setOpen(true, 'route'); if (dest) compute(); else render(); }

  pane.addEventListener('click', function (e) {
    var t;
    if (e.target.closest('[data-sort]')) { sortAsc = !sortAsc; scrollKeep = 0; render(); return; }
    if (e.target.closest('[data-nodest]')) { setDest(null); return; }
    if (e.target.closest('[data-search]')) { try { if (window.AndroidAuto && window.AndroidAuto.search) window.AndroidAuto.search(); else render(); } catch (err) { } return; }
    if ((t = e.target.closest('[data-dest]'))) { var ch = pane._choices[+t.getAttribute('data-dest')]; if (ch) setDest(ch.p); return; }
    if ((t = e.target.closest('[data-e]'))) { var v = +t.getAttribute('data-e'); if (v === A.state.startE) v--; A.state.startE = Math.max(0, Math.min(8, v)); A.save(); if (dest) compute(); else render(); return; }
    if ((t = e.target.closest('[data-sid]'))) { var s = A.stations.filter(function (x) { return String(x.id) === t.getAttribute('data-sid'); })[0]; if (s) { select(s, true); render(); } }
  });
  rail.addEventListener('click', function (e) {
    var b = e.target.closest('[data-rail]'); if (!b) return; var m = b.getAttribute('data-rail');
    if (m === 'close' || (open && m === mode)) setOpen(false); else setOpen(true, m);
  });
  document.addEventListener('pointerdown', function (e) { lastX = e.clientX; }, true);
  document.addEventListener('touchstart', function (e) { if (e.touches[0]) lastX = e.touches[0].clientX; }, true);

  // ---- gestes renvoyés par l'hôte Android Auto (CarWebSurface). L'hôte ne dit pas où le doigt est posé :
  // panneau ouvert → le geste fait défiler la liste ; panneau replié → il déplace la carte. Jamais les deux.
  var pdx = 0, pdy = 0, panRaf = 0, panEnd = null;
  function panMap(dx, dy) {
    pdx += dx; pdy += dy;
    if (!panRaf) panRaf = requestAnimationFrame(function () {
      panRaf = 0; var m = A.map, off = L.point(pdx, pdy); pdx = pdy = 0;
      A.setFollow(false);
      if (m._rawPanBy) { m._rawPanBy(off); m.fire('move'); } else m.panBy(off, { animate: false }); // un seul redessin complet, à la fin du geste
      clearTimeout(panEnd); panEnd = setTimeout(function () { m.fire('moveend'); }, 120);
    });
  }
  function scroller() { var fs = document.querySelector('#fillSheet:not([hidden]) .fs-card'); return fs || (open ? listEl : null); }
  function scroll(dx, dy) { var el = scroller(); if (el) el.scrollTop += dy; else panMap(dx, dy); }
  function fling(vx, vy) { var el = scroller(); if (el) el.scrollBy({ top: -vy / 4, behavior: 'smooth' }); else panMap(-vx / 8, -vy / 8); }
  // pincer : l'hôte envoie des facteurs minuscules (1,02…) et la carte zoome par niveaux entiers → on cumule jusqu'à un cran
  var pinch = 1, pinchTimer = null;
  function zoom(scale, x, y) {
    if (!(scale > 0)) return;
    pinch *= scale; clearTimeout(pinchTimer); pinchTimer = setTimeout(function () { pinch = 1; }, 600);
    var steps = pinch >= 1.35 ? 1 : pinch <= 1 / 1.35 ? -1 : 0; if (!steps) return;
    pinch = 1;
    var r = A.map.getContainer().getBoundingClientRect(), z = A.map.getZoom() + steps;
    A.setFollow(false); A.map.setZoomAround(L.point(x - r.left, y - r.top), Math.max(A.map.getMinZoom(), Math.min(A.map.getMaxZoom(), z)), { animate: false });
  }

  function schedule() { clearTimeout(timer); timer = setTimeout(render, 150); }
  function start() {
    if (!ready()) { setTimeout(start, 200); return; }
    document.documentElement.setAttribute('data-carui', '');
    pane.hidden = false; rail.hidden = false; renderRail();
    var centered = false, center = function () { // au premier point GPS : la carte sur la voiture
      if (centered) return; var f = A.fix;
      if (f) { centered = true; A.map.setView(shifted([f.lat, f.lon], 13), 13); }
    };
    center(); render();
    document.addEventListener('fuelmap:stations', function () { schedule(); if (dest && !A.route && !computing && !routeErr) compute(); });
    document.addEventListener('fuelmap:fix', function () { center(); updateGuide(); if (dest && !A.route && !computing && !routeErr) compute(); else if (mode !== 'shortage' || !listEl || listEl.scrollTop < 10) schedule(); });
    document.addEventListener('fuelmap:route', function (e) { computing = false; routeErr = e.detail && e.detail.error || null; selected = null; schedule(); });
    A.map.on('moveend', function () { if (mode === 'stations') schedule(); });
    window.addEventListener('resize', schedule);
    setInterval(render, 60000); // les âges « il y a x h » vieillissent
    setTimeout(function () { if (!A.fix) render(); }, 12500);
    // dernier trajet préparé sur le téléphone : on le reprend d'office, depuis la voiture
    var lr = A.state.lastRoute; if (lr && lr.to && Date.now() - lr.ts < 12 * 3600 * 1000) { dest = { label: lr.to.label, lat: +lr.to.lat, lon: +lr.to.lon }; setOpen(true, 'route'); compute(); }
  }
  start();
  function state() { return { guide: guide ? guide.label : null, open: open, mode: mode, dest: dest, selected: selected ? { id: selected.id, ville: selected.ville } : null, computing: computing, routeErr: routeErr, sortAsc: sortAsc, lastX: lastX, pane: pane.getBoundingClientRect().width, listScroll: listEl ? listEl.scrollTop : null, rows: pane.querySelectorAll('.crow').length }; }
  function dump() { try { window.FM && window.FM.log('écran voiture : ' + JSON.stringify(state()) + ' | carte zoom ' + A.map.getZoom() + ' centre ' + JSON.stringify(A.map.getCenter()) + ' | GPS ' + JSON.stringify(A.fix)); } catch (e) { } }
  function goTarget() { // bouton « Y aller » de l'hôte
    if (selected) { go(selected); return true; }
    if (dest) { var fake = { id: 'dest', lat: dest.lat, lon: dest.lon, ville: String(dest.label).split(',')[0], adr: '', p: [], brand: '' }; go(fake); return true; }
    A.toast('Touche une station d\'abord'); return false;
  }
  function target() { // ce que « Y aller » doit viser : la station choisie, sinon la destination du trajet
    if (selected) { var k = A.pick(selected, A.fuelsFor(A.car().fuel)); return { lat: selected.lat, lon: selected.lon, label: (selected.brand ? selected.brand + ' ' : '') + A.titleCase(selected.ville) + (k >= 0 ? ' · ' + A.price3(selected.p[k]) + ' €' : '') }; }
    if (dest) return { lat: dest.lat, lon: dest.lon, label: String(dest.label).split(',')[0] };
    return null;
  }
  window.__fuelmapCar = { render: render, select: select, setDest: setDest, scroll: scroll, fling: fling, zoom: zoom, state: state, dump: dump, setOpen: setOpen, target: target, go: goTarget, goTo: function (lat, lon, label) { go({ id: 'ext', lat: +lat, lon: +lon, ville: label || 'Destination', adr: '', p: [], brand: '' }); }, stopGuide: stopGuide };
})();
