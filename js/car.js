/*
 * Écran Android Auto (page ouverte avec ?aa=1), pensé façon Waze / Google Maps : la carte d'abord, le reste par étapes.
 *   - Colonne étroite à gauche : ⛽ Carte, 🧭 Trajet, 🚨 Pénurie, 🎨 Thème, puis le zoom + / −.
 *   - Chaque mode est un petit parcours dont les étapes s'affichent en bulles en haut
 *     (Trajet : Destination › Réservoir › Arrêts › Guidage). Le contenu de l'étape tient dans une carte flottante à gauche.
 *   - ⛽ Carte : les prix sont écrits sur la carte ; le bouton du bas « N stations » ouvre la liste triée par prix.
 *   - Guidage FuelMap (OSRM) : itinéraire qui passe par les arrêts carburant jusqu'à la destination, voix, fiche de manœuvre de l'hôte.
 *   - En roulant, trop de touchers d'affilée → écran bloqué 3 s (« les yeux sur la route »), comme Waze / Google Maps.
 * Pas de clavier dans la page : chercher une adresse passe par l'écran de recherche de l'hôte (🔍), qui rappelle setDest().
 */
(function () {
  'use strict';
  if (!/[?&]aa=1/.test(location.search)) return;
  var A = null, F = null, pane = document.getElementById('carPane'), timer = null;
  function el(id, tag) { var e = document.createElement(tag || 'div'); e.id = id; e.hidden = true; document.body.appendChild(e); return e; }
  var rail = el('carRail', 'nav'), steps = el('carSteps'), chip = el('carChip', 'button'), nextBox = el('carNext'), lockBox = el('carLock'), favBox = el('carFavs'), viewBox = el('carView'), townBox = el('carTown'), refreshBox = el('carRefresh', 'button');
  refreshBox.setAttribute('aria-label', 'Actualiser les prix'); refreshBox.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3.5v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><rect x="8.6" y="8" width="4.6" height="8" rx=".8" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="9.7" y="9.2" width="2.4" height="2" fill="currentColor"/><path d="M13.2 10l1.7 1.4v3.1a.7.7 0 0 0 1.4 0V11" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  refreshBox.addEventListener('click', function () { log('voiture : actualisation des prix'); A.refreshPrices().then(schedule); });
  function log(m) { try { window.FM && window.FM.log(m); } catch (e) { } }

  var MODES = [['map', '⛽', 'Stations'], ['route', '🧭', 'Trajet'], ['shortage', '🚨', 'Pénurie'], ['car', '🚗', 'Ma voiture'], ['theme', '🎨', 'Thème']];
  var FLOWS = {
    map: [['map', 'Carte'], ['list', 'Liste'], ['station', 'Station'], ['guide', 'Guidage']],
    route: [['dest', 'Destination'], ['fuel', 'Réservoir'], ['stops', 'Arrêts'], ['guide', 'Guidage']],
    shortage: [['list', 'Autour de moi'], ['station', 'Station'], ['guide', 'Guidage']],
    car: [['setup', 'Réglages']],
    theme: [['pick', 'Couleurs']]
  };
  var mode = 'map', step = 'map', selected = null, sortAsc = true, dest = null, computing = false, routeErr = null, routeReady = false, wantRoute = false;
  var selMarker = null, listEl = null, scrollKeep = 0, lastX = -1;

  function ready() { A = window.__fuelmapAPI; F = window.__fuelmap; return !!(A && F); }
  function origin() { var f = A.fix; return f ? { lat: f.lat, lon: f.lon } : { lat: A.map.getCenter().lat, lon: A.map.getCenter().lng }; }
  function name(s) { return (s.id === 'dest' || s.id === 'ext') ? A.esc(s.ville) : A.brandName(s) + A.esc(A.titleCase(s.ville)); }
  function plainName(s) { return (s.brand ? s.brand + ' ' : '') + (s.id === 'dest' || s.id === 'ext' ? s.ville : A.titleCase(s.ville)); }
  function short(label) { return String(label).split(',')[0]; }
  function dot(level) { return '<i class="cdot c' + level + '"></i>'; }
  function dur(dm) { dm = Math.round(dm); return dm >= 60 ? Math.floor(dm / 60) + ' h ' + ('0' + dm % 60).slice(-2) : dm + ' min'; }
  function km(d) { return d < 1 ? Math.round(d * 1000 / 10) * 10 + ' m' : A.num(d, d < 10 ? 1 : 0) + ' km'; }
  function idx(st) { var fl = FLOWS[mode]; for (var i = 0; i < fl.length; i++) if (fl[i][0] === st) return i; return 0; }
  function panelStep() { return step !== 'map' && step !== 'guide'; } // étapes qui ont une carte flottante à gauche

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
      '<div class="l1"><span class="nm">' + name(s) + '</span><span class="pr">' + A.price3(s.p[k]) + ' €</span></div>' +
      '<div class="l2"><span>' + (extra || A.num(x.d, 1) + ' km') + (k !== fi ? ' · ' + A.FUELS[k].label : '') + '</span><span>' + dot(x.conf.level) + (right || A.whenText(s, k)) + (x.op && x.op.until ? ' · 🕒 ' + x.op.until : x.op && x.op.a24 ? ' · 24/24' : '') + '</span></div></button>';
  }

  // ---- trajet : départ = la voiture, destination choisie ici (favoris, dernier trajet du téléphone, recherche de l'hôte)
  function destChoices() {
    var out = [], seen = {}, add = function (ico, label, p, tag) { var key = (+p.lat).toFixed(3) + ',' + (+p.lon).toFixed(3); if (seen[key]) return; seen[key] = 1; out.push({ ico: ico, label: label, p: p, tag: tag }); };
    var lr = A.state.lastRoute; if (lr && lr.to && Date.now() - lr.ts < 7 * 86400000) add('📱', lr.to.label, lr.to, 'Dernier trajet');
    (A.state.places || []).forEach(function (p) { add('⭐', p.name || p.label, p, p.label !== p.name ? p.label : ''); });
    return out;
  }
  // agenda du téléphone : rendez-vous des 7 prochains jours qui ont un lieu → destination en un toucher
  var agendaEv = [];
  function agendaRows() {
    if (!(window.AndroidAuto && window.AndroidAuto.agenda)) return '';
    var r = null; try { r = JSON.parse(window.AndroidAuto.agenda()); } catch (e) { }
    if (!r) return '';
    if (!r.perm) return '<button class="crow cchoice" data-askagenda><div class="l1"><span class="nm">📅 Mon agenda</span></div><div class="l2"><span>Toucher pour l\'autoriser (question sur le téléphone)</span></div></button>';
    agendaEv = r.events || [];
    return agendaEv.map(function (x, i) { return '<button class="crow cchoice" data-agenda="' + i + '"><div class="l1"><span class="nm">📅 ' + A.esc(x.title || 'Rendez-vous') + '</span></div><div class="l2"><span>' + A.esc(A.agendaWhen(x)) + ' · ' + A.esc(x.where) + '</span></div></button>'; }).join('');
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
  function tripHead() { return '<span class="cfrom">📍 Ma position → ' + (dest ? '<b>' + A.esc(short(dest.label)) + '</b>' : '<span class="muted">destination ?</span>') + '</span>'; }
  function fuelBars() {
    var e = A.state.startE, c = A.car(), h = '<p class="cq">Il reste combien dans le réservoir ?</p><div class="cbars">';
    for (var i = 1; i <= 8; i++) h += '<button data-e="' + i + '" class="' + (i <= e ? 'on' + (e <= 2 ? ' low' : '') : '') + '" aria-label="' + i + '/8"></button>';
    return h + '</div><div class="cval"><span>vide</span><b>' + A.eighths(e) + ' · ≈ ' + A.num(c.tank * e / 8) + ' L</b><span>plein</span></div>';
  }

  var t0 = Date.now();
  function noGps() { return Date.now() - t0 < 12000 ? '<p class="cmsg">⏳ En attente du GPS…</p>' : '<p class="cmsg">📍 Pas de position.<br><small>Sur le téléphone, ouvre FuelMap et autorise la localisation (ou Paramètres → Applis → FuelMap → Autorisations), puis reviens ici.</small></p>'; }

  // ---- dessin : colonne, bulles d'étapes, carte flottante, bouton « N stations », bandeau du prochain arrêt
  function renderRail() {
    rail.innerHTML = '<div class="cbrand"><img src="icons/icon.svg" alt=""><b>FuelMap</b><small>v' + ((window.FUELMAP_CONFIG || {}).version || '') + '</small></div>' + MODES.map(function (m) { return '<button class="' + (mode === m[0] ? 'on' : '') + '" data-rail="' + m[0] + '" aria-label="' + m[2] + '">' + m[1] + '</button>'; }).join('') +
      '<span class="sp"></span><button class="cz" data-rail="zin" aria-label="Zoomer">＋</button><button class="cz" data-rail="zout" aria-label="Dézoomer">−</button>';
  }
  function renderSteps() {
    var fl = FLOWS[mode], cur = idx(step), md = MODES.filter(function (m) { return m[0] === mode; })[0];
    steps.hidden = !panelStep(); if (steps.hidden) return;
    steps.innerHTML = '<span class="cmode">' + md[1] + ' ' + md[2] + '</span>' + (fl.length > 1 ? fl.map(function (f, i) {
      var can = i < cur || (f[0] === 'guide' && guide && guide.gmode === mode);
      return (i ? '<i>›</i>' : '') + '<button class="cstep' + (i < cur ? ' done' : i === cur ? ' on' : '') + '"' + (can ? ' data-step="' + f[0] + '"' : ' disabled') + '>' + (i < cur ? '✓' : i + 1) + ' ' + f[1] + '</button>';
    }).join('') : '') + '<button class="cstx" data-step="close" aria-label="Fermer">✕</button>';
    // Les boutons de l'hôte, en haut à droite, prennent ≈ 430 px. Pas la place (écran partagé avec le lecteur) : version compacte
    // « ‹ 2/4 Réservoir ✕ » (le mode se voit dans la colonne) ; et seulement si même ça ne tient pas, les bulles passent dessous.
    var room = innerWidth - steps.getBoundingClientRect().left - 430;
    if (steps.scrollWidth > room && fl.length > 1) steps.innerHTML = (cur > 0 ? '<button class="cstep cback" data-step="' + fl[cur - 1][0] + '" aria-label="Étape précédente">‹</button>' : '') +
      '<span class="cstep on">' + (cur + 1) + '/' + fl.length + ' ' + fl[cur][1] + '</span><button class="cstx" data-step="close" aria-label="Fermer">✕</button>';
    document.documentElement.classList.toggle('csteps-low', steps.scrollWidth > room);
  }
  function renderChip() {
    chip.hidden = refreshBox.hidden = !(mode === 'map' && step === 'map'); if (chip.hidden) return;
    if (!A.stations.length) { chip.innerHTML = '⏳ Chargement des prix…'; return; }
    var vs = viewStations(); if (!vs.length) { chip.innerHTML = '🔍 Aucune station ici · dézoome'; return; }
    var min = vs.reduce(function (a, b) { return b.p < a.p ? b : a; });
    var max = vs.reduce(function (a, b) { return b.p > a.p ? b : a; }), mean = vs.reduce(function (a, b) { return a + b.p; }, 0) / vs.length, fr = A.franceAvg();
    var old = A.staleDays();
    chip.innerHTML = (old >= 2 ? '<b class="mx">⚠️ ' + old + ' j</b> · ' : '') + (vs.length >= 40 ? '40+' : vs.length) + ' station' + (vs.length > 1 ? 's' : '') + ' · ▼ <b>' + A.price3(min.p) + ' €</b><span class="cxa"> · moy. ' + A.price3(mean) + ' €</span><span class="cxb"> · ▲ <b class="mx">' + A.price3(max.p) + ' €</b></span>' + (fr ? '<span class="cxc"> · <small>🇫🇷 ' + A.price3(fr) + ' €</small></span>' : '') + ' <span class="ar">›</span>';
    // pas la place (écran étroit, favorites à droite) : on retire 🇫🇷, puis la moyenne, puis le max — jamais le nombre ni le moins cher
    chip.classList.remove('t1', 't2', 't3');
    ['t1', 't2', 't3'].some(function (t) { if (chip.scrollWidth <= chip.clientWidth + 1) return true; chip.classList.add(t); return false; });
  }
  // ---- stations favorites (⭐ sur le téléphone) : en bas à droite quand la carte est au repos, prix et heure de mise à jour
  function renderFavs() {
    var ids = A.state.favs || [], show = mode === 'map' && step === 'map' && ids.length && A.stations.length;
    favBox.hidden = !show; document.documentElement.classList.toggle('cfavs', !!show); if (!show) return;
    var fis = A.fuelsFor(A.car().fuel), o = origin(), want = {}; ids.forEach(function (id) { want[id] = 1; });
    var list = A.stations.filter(function (s) { return want[String(s.id)]; }).map(function (s) { var k = A.pick(s, fis); return { s: s, k: k, d: A.haversine(o.lat, o.lon, s.lat, s.lon) }; });
    list.sort(function (a, b) { return a.d - b.d; });
    // une ligne par favorite (nom, prix, âge du prix) ; repliable d'un toucher sur l'en-tête pour libérer la carte (choix mémorisé)
    var narrow = innerWidth < 600; // écran vraiment étroit : favorites repliées d'office
    var folded = favFolded || narrow;
    document.documentElement.classList.toggle('cfavs-up', narrow); // pas la place à côté du bouton du bas : les favorites passent au-dessus
    favBox.classList.toggle('folded', folded);
    favBox.innerHTML = '<button class="fh" data-favfold>⭐ Mes favorites' + (folded ? ' (' + list.length + ') ▸' : ' ▾') + '</button>' + (folded ? '' : list.slice(0, 3).map(function (x) {
      var s = x.s, k = x.k;
      return '<button data-fav="' + s.id + '"><span class="nm">' + name(s) + '</span>' + (k >= 0 ? '<span class="pr">' + A.price3(s.p[k]) + ' €</span><span class="wh">' + dot(A.confidence(s, k).level) + A.shortAge(A.ageHours(s, k)) + '</span>' : '<span class="pr">—</span><span class="wh"></span>') + '</button>';
    }).join(''));
  }
  var favFolded = false; try { favFolded = localStorage.getItem('fuelmap-carfavs') === '0'; } catch (e) { }
  favBox.addEventListener('click', function (e) { if (e.target.closest('[data-favfold]')) { favFolded = !favFolded; try { localStorage.setItem('fuelmap-carfavs', favFolded ? '0' : '1'); } catch (err) { } render(); return; } var b = e.target.closest('[data-fav]'); if (!b) return; var s = A.stations.filter(function (x) { return String(x.id) === b.getAttribute('data-fav'); })[0]; if (s) pick(s); });
  function render() {
    if (!ready() || pane.hidden && rail.hidden) return;
    if (listEl) scrollKeep = listEl.scrollTop;
    var all = mode !== 'route'; if (all !== !!window.__carShowAll) { window.__carShowAll = all; A.refreshMap(); } // hors trajet : toutes les stations sur la carte, pas seulement celles du trajet
    renderRail(); renderSteps(); renderFavs(); renderChip(); saveSession();
    if (!chip.hidden && !favBox.hidden) { // on mesure : si le bouton du bas touche les favorites, elles passent au-dessus (quelle que soit la largeur d'écran)
      var cr = chip.getBoundingClientRect(), fr = favBox.getBoundingClientRect();
      if (cr.right > fr.left - 6 && cr.bottom > fr.top + 2 && cr.top < fr.bottom - 2) { document.documentElement.classList.add('cfavs-up'); renderChip(); }
    }
    nextBox.hidden = viewBox.hidden = !(guide && step === 'guide');
    // en haut à gauche : la commune, puis la taille de la zone affichée (largeur ↔, hauteur ↕), puis les favorites dessous
    var sc = !nav.on && A.map ? viewSize() : '';
    townBox.hidden = !(town.name || sc) || panelStep();
    townBox.innerHTML = (town.name ? '<b>📍 ' + A.esc(town.name) + '</b>' : '') + (sc ? '<small><i class="crect"></i>' + sc + '</small>' : '');
    if (!favBox.hidden) { // favorites juste sous la commune (colonne de gauche, stable, jamais sous les boutons de l'hôte)
      var tb = townBox.hidden ? null : townBox.getBoundingClientRect();
      favBox.style.top = Math.round((tb && tb.height ? tb.bottom : rail.getBoundingClientRect().top + 6) + 8) + 'px';
    }
    viewBox.innerHTML = '<button data-view="2"' + (view3d ? '' : ' class="on"') + '>2D</button><button data-view="3"' + (view3d ? ' class="on"' : '') + '>3D</button>';
    var show = panelStep(); pane.classList.toggle('open', show);
    var wide = show && step === 'setup' && !wheel && innerWidth >= 900; document.documentElement.classList.toggle('cpane-wide', wide); // Ma voiture : deux colonnes, tout tient sans défiler
    var pl = (nav.on ? Math.max(rail.getBoundingClientRect().right, 0) : rail.getBoundingClientRect().right) + 8; // carte flottante sous les boutons de l'hôte si elle atteint leur zone
    document.documentElement.classList.toggle('cpane-low', show && pl + (wide ? 620 : 330) > innerWidth - 430); document.documentElement.classList.toggle('carpane-open', show);
    if (!selected && selMarker) { try { selMarker.remove(); } catch (e) { } selMarker = null; window.__carSel = null; A.refreshMap(); } // plus de station choisie : plus de marqueur
    if (!show) { listEl = null; return; }
    var c = A.car(), head = '', body = '', foot = '', fuelLabel = A.FUELS[A.FUEL_INDEX[c.fuel]].label;
    if (step === 'list' && mode === 'map') {
      var vs = viewStations();
      if (!A.stations.length) body = '<p class="cmsg">⏳ Chargement des prix…</p>';
      else if (!vs.length) body = '<p class="cmsg">Aucune station ' + fuelLabel + ' ouverte avec un prix récent dans la zone affichée.<br><small>Déplace ou dézoome la carte.</small></p>';
      else body = vs.map(function (x) { return stationRow(x); }).join('');
      head = '<span>' + (vs.length ? vs.length + ' station' + (vs.length > 1 ? 's' : '') + ' <small>dans la zone</small>' : '<small>Zone affichée</small>') + '</span><button class="csort" data-sort>' + (sortAsc ? '💶 Prix ↑' : '💶 Prix ↓') + '</button>';
    } else if (step === 'list') { // pénurie
      var sh = shortageStations();
      if (!A.stations.length) body = '<p class="cmsg">⏳ Chargement des prix…</p>';
      else if (!A.fix) body = noGps();
      else if (!sh.length) body = '<p class="cmsg">Aucune station ' + fuelLabel + ' ouverte sans rupture à moins de 20 km.</p>';
      else body = sh.map(function (x, i) { return stationRow(x, (i === 0 ? '👉 ' : '') + A.num(x.d, 1) + ' km · <b class="csc">' + A.num(x.sc.total, 1) + '/10</b>', (x.auto ? '🤖 màj auto ' : A.esc(x.conf.label) + ' · ') + A.whenText(x.s, x.k)); }).join('');
      head = '<span>Où il y a du carburant <small>fraîcheur · km · prix</small></span>';
    } else if (step === 'station' && selected) {
      var s = selected, k = A.pick(s, A.fuelsFor(c.fuel)), o = origin(), conf = k >= 0 ? A.confidence(s, k) : null, op = A.opening(s);
      head = '<span class="nm">' + name(s) + '</span>';
      body = '<div class="ccard"><div class="big">' + (k >= 0 ? A.price3(s.p[k]) + ' <small>€/L ' + A.FUELS[k].label + '</small>' + p98Side(s, k) : '—') + '</div>' + (k >= 0 ? fillLine(s, k) : '') +
        '<div class="ln"><i>📍</i><span>' + A.esc(A.titleCase(s.adr)) + ' · ' + km(A.haversine(o.lat, o.lon, s.lat, s.lon)) + '</span></div>' +
        (conf ? '<div class="ln"><i>' + dot(conf.level) + '</i><span>' + A.esc(conf.label) + ' · ' + A.whenText(s, k) + '</span></div>' : '') +
        (op ? '<div class="ln"><i>' + (op.open ? '🕒' : '🔒') + '</i><span>' + (!op.open ? 'fermée' : op.a24 ? '24/24' : op.until ? 'ouverte jusqu\'à ' + op.until : 'ouverte') + '</span></div>' : '') + '</div>' +
        sp98Tip(s, k) +
        (k >= 0 ? '<div class="cchart" data-chart="' + s.id + ':' + k + '">' + (charts[s.id + ':' + k] || '<small>⏳ historique des prix…</small>') + '</div>' : '');
      if (k >= 0 && !charts[s.id + ':' + k]) loadChart(s, k);
      // trajet guidé en cours vers une destination : cette station remplace le prochain arrêt (ou s'ajoute), la destination est gardée
      var trip = guide && !guide.fin.s, nstop = trip ? guide.wps.filter(function (w) { return w.stop && !w.done; })[0] : null;
      foot = trip ? '<button class="cbig" data-swap>⛽ ' + (nstop ? 'Remplacer l’arrêt ' + A.esc(nstop.plain) : 'Ajouter cet arrêt au trajet') + '</button><button class="csub" data-go>🧭 Y aller directement</button>'
        : '<button class="cbig" data-go>🧭 Y aller</button>';
    } else if (step === 'dest') {
      var ch = destChoices();
      head = '<span>Où va-t-on ?</span>';
      body = '<button class="crow cchoice" data-search><div class="l1"><span class="nm">🔍 Chercher une adresse</span></div><div class="l2"><span>Clavier ou voix, via Android Auto</span></div></button>' + agendaRows() +
        ch.map(function (x, i) { return '<button class="crow cchoice" data-dest="' + i + '"><div class="l1"><span class="nm">' + x.ico + ' ' + A.esc(short(x.label)) + '</span></div><div class="l2"><span>' + A.esc(x.tag || x.label) + '</span></div></button>'; }).join('') +
        (ch.length ? '' : '<p class="cmsg"><small>Ajoute des favoris ⭐ dans FuelMap sur le téléphone : ils apparaissent ici.</small></p>');
      pane._choices = ch;
    } else if (step === 'fuel') {
      head = tripHead(); body = fuelBars();
      foot = '<button class="cbig" data-calc>⛽ Proposer mes arrêts</button>';
    } else if (step === 'stops') {
      head = tripHead();
      var rr = routeReady ? routeRows() : null;
      if (computing) body = '<p class="cmsg">⏳ Calcul du trajet et des arrêts…</p>';
      else if (routeErr) body = '<p class="cmsg">⚠️ ' + A.esc(routeErr) + '<br><small>Touche « Destination » en haut pour en choisir une autre.</small></p>';
      else if (!routeReady) body = !A.stations.length ? '<p class="cmsg">⏳ Chargement des prix…</p>' : noGps();
      else if (!rr) body = '<p class="cmsg">⛔ Trajet impossible avec ce niveau de carburant : aucune station atteignable à temps.<br><small>Touche « Réservoir » en haut pour corriger le niveau.</small></p>';
      else {
        var R = rr.R;
        body = '<div class="ctrip">🏁 ' + A.num(R.D) + ' km · ' + dur(R.durMin) + ' · ' + (rr.total ? rr.total + ' arrêt' + (rr.total > 1 ? 's' : '') : 'sans arrêt') + ' · arrivée ≈ ' + A.num(R.plan.arrivalL) + ' L</div>';
        if (!rr.list.length) body += '<p class="cmsg">' + (rr.total ? '🏁 Arrêts faits, plus rien de prévu.' : '✅ Pas besoin de s\'arrêter : le réservoir suffit.') + '</p>';
        else body += rr.list.map(function (x, i) { return stationRow(x, (i === 0 ? 'Prochain · ' : '') + 'km ' + A.num(x.st.pos) + ' · mets ' + A.num(x.st.buyL, x.st.buyL < 10 ? 1 : 0) + ' L'); }).join('');
        foot = '<button class="cbig" data-trip>▶ Démarrer le guidage</button>';
      }
    } else if (step === 'setup') {
      var cars = A.state.cars, cc = A.car();
      if (!cars.length) body = '<p class="cmsg">Ajoute ton véhicule dans FuelMap sur le téléphone (onglet Véhicules) : il apparaîtra ici.</p>';
      else {
        var adj = function (label, val, key) { return '<div class="cadj"><span>' + label + '</span><button data-adj="' + key + '" data-d="-1" aria-label="Moins">−</button><b>' + val + '</b><button data-adj="' + key + '" data-d="1" aria-label="Plus">＋</button></div>'; };
        var custom = cc.color && !COLORS.some(function (p) { return p[1] === cc.color; });
        head = '<span>🚗 ' + A.esc(cc.name) + '</span>';
        var fills = (A.state.fillups || []).slice().sort(function (x, y) { return y.ts - x.ts; }), nNotes = (A.state.notes || []).length;
        var carnet = '<div class="ctg">📒 Carnet de pleins</div>' + (fills.length ? fills.slice(0, 3).map(function (x) { var d = new Date(x.ts); return '<div class="cfl"><span>' + d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' · ' + A.esc(x.name) + '</span><b>' + A.num(x.paid) + ' €' + (x.liters ? ' <small>' + A.num(x.liters, 1) + ' L</small>' : '') + '</b></div>'; }).join('') : '<div class="cnote">Aucun plein noté.</div>') +
          '<button class="copt cfillnow" data-fillnow>➕ J’ai fait le plein</button>' + (nNotes ? '<div class="cnote">📝 ' + nNotes + ' note' + (nNotes > 1 ? 's' : '') + ' — à relire sur le téléphone (Véhicules)</div>' : '');
        body = '<div class="c2col"><div>' + carnet + (cars.length > 1 ? '<div class="ctg">Véhicule</div><div class="cgrid">' + cars.map(function (x) { return '<button class="copt' + (x.id === cc.id ? ' on' : '') + '" data-usecar="' + x.id + '">' + A.esc(x.name) + '</button>'; }).join('') + '</div>' : '') +
          '<div class="ctg">Carburant préféré</div><div class="cgrid">' + A.FUELS.map(function (f) { return '<button class="copt fuel' + (f.key === cc.fuel ? ' on' : '') + '" style="--fc:' + f.color + ';--fi:' + f.ink + '" data-cfuel="' + f.key + '">' + (f.short || f.label) + '</button>'; }).join('') + '</div>' +
          (A.fuelsFor(cc.fuel).indexOf(A.FUEL_INDEX.sp98) >= 0 && cc.fuel !== 'sp98' ? '<div class="ctg">Prendre le SP98 s’il coûte à peine plus</div><div class="cgrid">' + [[0, 'Non'], [0.02, '≤ 2 cts'], [0.05, '≤ 5 cts']].map(function (o) { return '<button class="copt' + ((+cc.prefer98 || 0) === o[0] ? ' on' : '') + '" data-p98="' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</div>' : '') +
          '</div><div>' + '<div class="cseg"><button class="copt' + (cc.consMode === 'km' ? '' : ' on') + '" data-consmode="l">Réservoir connu</button><button class="copt' + (cc.consMode === 'km' ? ' on' : '') + '" data-consmode="km">Autonomie</button></div>' +
          adj('Consommation', A.num(cc.cons, 1) + ' L/100', 'cons') +
          (cc.consMode === 'km' ? adj('Par plein ≈', A.num(Math.round((cc.tank - cc.reserve) * 100 / cc.cons / 10) * 10) + ' km', 'range') + '<div class="cnote">→ environ ' + A.num(cc.tank - cc.reserve) + ' L utilisés entre deux pleins</div>'
            : adj('Réservoir', A.num(cc.tank) + ' L', 'tank')) +
          '<div class="ctg">Couleur du curseur</div><div class="ccols">' + COLORS.map(function (p) { return '<button class="ccol' + (p[1] === cc.color ? ' on' : '') + '" data-ccolor="' + p[1] + '" data-cname="' + A.esc(p[0]) + '" style="background:' + p[1] + '" aria-label="' + A.esc(p[0]) + '"></button>'; }).join('') +
          '<button class="ccol cperso' + (custom ? ' on' : '') + '" data-wheelopen aria-label="Couleur perso"' + (custom ? ' style="--cc:' + cc.color + '"' : '') + '></button></div></div></div>';
        if (wheel) { // roue chromatique : teinte et intensité sur la roue, clair / foncé sur la barre ; appliqué au curseur à chaque toucher
          var wx = 50 + 50 * wheel.s * Math.sin(wheel.h * Math.PI / 180), wy = 50 - 50 * wheel.s * Math.cos(wheel.h * Math.PI / 180), hx = hslHex(wheel.h, wheel.s, wheel.l);
          head = '<span>🎨 Couleur perso</span>';
          body = '<div class="cwheelbox"><div class="cwheel" data-wheel style="--wl:' + Math.round(wheel.l * 100) + '%"><i style="left:' + wx + '%;top:' + wy + '%;background:' + hx + '"></i></div>' +
            '<div class="cwside"><div class="ctg">Clair / foncé</div><div class="clight" data-light style="background:linear-gradient(90deg,' + hslHex(wheel.h, wheel.s, 0.12) + ',' + hslHex(wheel.h, wheel.s, 0.5) + ',' + hslHex(wheel.h, wheel.s, 0.88) + ')"><i style="left:' + ((wheel.l - 0.12) / 0.76 * 100) + '%"></i></div>' +
            '<div class="cwprev"><span style="background:' + hx + '"></span><b>' + hx + '</b></div></div></div>';
          foot = '<button class="cbig" data-wheelok>✓ Garder cette couleur</button>';
        }
      }
    } else if (step === 'pick') {
      var T = A.themes || {};
      head = '<span>Couleurs de l\'appli et de la carte</span>';
      var thm = function (dark) { return '<div class="cthemes">' + Object.keys(T).filter(function (k2) { return !!T[k2].dark === dark; }).map(function (k2) { var t = T[k2], on = k2 === A.state.theme; return '<button class="cth' + (on ? ' on' : '') + '" data-theme="' + k2 + '" style="background:' + t.bg + ';color:' + t.text + ';border-color:' + (on ? t.accent : t.line) + '"><i style="background:' + t.accent + '"></i>' + t.emoji + ' ' + t.name + '</button>'; }).join('') + '</div>'; };
      body = '<div class="ctg">☀️ Clairs</div>' + thm(false) + '<div class="ctg">🌙 Foncés</div>' + thm(true);
    }
    pane.innerHTML = (head ? '<div class="chead">' + head + '</div>' : '') + '<div class="clist">' + body + '</div>' + (foot ? '<div class="cfoot">' + foot + '</div>' : '');
    listEl = pane.querySelector('.clist'); listEl.scrollTop = scrollKeep;
  }

  // L'écran voiture est recréé quand sa taille change (passage en écran partagé avec le lecteur de musique…) : on mémorise
  // en continu le mode, l'étape, la destination et le guidage en cours, et la page reprend là où elle en était.
  var SESSION = 'fuelmap-carsession', pendingGuide = null, resumeQuiet = false;
  function saveSession() {
    try {
      var g = guide ? { gmode: guide.gmode, back: guide.back, wps: remaining().map(function (w) { return { lat: w.lat, lon: w.lon, plain: w.plain, price: w.price, stop: w.stop, sid: w.s ? w.s.id : null }; }) } : null;
      localStorage.setItem(SESSION, JSON.stringify({ t: Date.now(), mode: mode, step: step, dest: dest, wantStops: routeReady || computing || wantRoute, sel: selected ? selected.id : null, guide: g }));
    } catch (e) { }
  }
  function restoreSession() { // vrai si un écran récent (< 10 min) a été repris
    var S = null; try { S = JSON.parse(localStorage.getItem(SESSION) || 'null'); } catch (e) { }
    if (!S || Date.now() - S.t > 10 * 60000 || !FLOWS[S.mode]) return false;
    mode = S.mode; step = S.step === 'guide' && !S.guide ? FLOWS[mode][0][0] : S.step; dest = S.dest || null;
    if (S.sel != null) { var s = A.stations.filter(function (x) { return String(x.id) === String(S.sel); })[0]; if (s) select(s, false); else if (step === 'station') step = FLOWS[mode][0][0]; }
    if (dest && S.wantStops && (step === 'stops' || S.guide)) wantRoute = true; // les arrêts sont recalculés depuis la position actuelle
    if (S.guide && S.guide.wps.length) {
      mode = S.guide.back.mode; step = S.guide.back.step;
      pendingGuide = S.guide.wps.map(function (w) { var st = w.sid != null ? A.stations.filter(function (x) { return String(x.id) === String(w.sid); })[0] || { id: w.sid } : null; return { lat: w.lat, lon: w.lon, plain: w.plain, price: w.price, stop: w.stop, s: st }; });
    }
    log('voiture : écran repris (' + mode + ' › ' + step + (pendingGuide ? ', guidage' : '') + ')');
    return true;
  }
  function resumeGuide() { if (!pendingGuide || !A.fix) return; var w = pendingGuide; pendingGuide = null; resumeQuiet = true; go(w); resumeQuiet = false; }
  // couleurs du curseur : les 9 teintes de voiture les plus courantes, puis la roue chromatique pour le reste
  var COLORS = [['Blanc', '#f2f2f0'], ['Noir', '#111214'], ['Gris', '#6f7477'], ['Argent', '#b8bbbd'], ['Rouge', '#c0151f'], ['Bleu', '#1f4fa3'], ['Bleu marine', '#1c2b4b'], ['Vert', '#2f7a43'], ['Jaune', '#f0c419']];
  var wheel = null; // { h: 0-360, s: 0-1, l: 0-1 } quand la roue est ouverte
  function hslHex(h, s, l) { var k = function (n) { return (n + h / 30) % 12; }, a = s * Math.min(l, 1 - l), f = function (n) { return l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)); }; return '#' + [f(0), f(8), f(4)].map(function (v) { return ('0' + Math.round(v * 255).toString(16)).slice(-2); }).join(''); }
  function hexHsl(hx) {
    var r = parseInt(hx.slice(1, 3), 16) / 255, g = parseInt(hx.slice(3, 5), 16) / 255, b = parseInt(hx.slice(5, 7), 16) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn, h = 0, s = 0;
    if (d) { s = d / (1 - Math.abs(2 * l - 1)); h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360; }
    return { h: h, s: Math.min(1, s), l: Math.max(0.12, Math.min(0.88, l)) };
  }
  // à droite du prix : le SP98 entre parenthèses, quand la voiture l'accepte et que la station en vend
  function p98Side(s, k) { var k98 = A.FUEL_INDEX.sp98; return k !== k98 && A.fuelsFor(A.car().fuel).indexOf(k98) >= 0 && s.p[k98] > 0 ? ' <small class="c98">(SP98 ' + A.price3(s.p[k98]) + ')</small>' : ''; }
  // ce que coûte le plein complet, et ce qu'il faut pour compléter d'après le niveau indiqué (Trajet › Réservoir)
  function fillLine(s, k) {
    var c = A.car(), left = c.tank * (A.state.startE || 0) / 8, need = Math.max(0, c.tank - left), p = s.p[k];
    return '<div class="ln cfill"><i>⛽</i><span>Plein ' + A.num(c.tank) + ' L ≈ <b>' + A.num(c.tank * p, 2) + ' €</b> · compléter ' + A.num(need) + ' L ≈ <b>' + A.num(need * p, 2) + ' €</b> <small>(reste ≈ ' + A.num(left) + ' L)</small></span></div>';
  }
  // SP98 comparé au carburant retenu, quand la voiture l'accepte : « à ce prix, tu peux prendre du 98 » (écart ≤ 3 cts)
  function sp98Tip(s, k) {
    var c = A.car(), k98 = A.FUEL_INDEX.sp98;
    if (k < 0 || k === k98 || A.fuelsFor(c.fuel).indexOf(k98) < 0 || !(s.p[k98] > 0) || A.ageHours(s, k98) > 24 * 7) return '';
    var d = s.p[k98] - s.p[k], liters = Math.max(10, c.tank * (1 - (A.state.startE || 0) / 8)), extra = d * liters;
    return '<div class="ln ctip"><i>💡</i><span>SP98 à ' + A.price3(s.p[k98]) + ' € : ' + (d >= 0 ? '+' : '−') + A.price3(Math.abs(d)) + ' €/L, soit ' + (d >= 0 ? '+' : '−') + A.num(Math.abs(extra), 2) + ' € sur ' + A.num(liters) + ' L' +
      (d <= 0.03 ? ' · <b>à ce prix, tu peux prendre du 98</b>' : '') + '</span></div>';
  }
  // ---- fiche station : 30 jours de prix — la station (couleur du texte), la moyenne à moins de 10 km (rouge), × = prix déclaré
  var charts = {};
  function loadChart(s, k) {
    var key = s.id + ':' + k; charts[key] = '<small>⏳ historique des prix…</small>';
    A.histSeries(s, k, 30).then(function (r) { charts[key] = r ? chartSvg(r) : '<small>Pas d’historique pour cette station.</small>'; }, function () { charts[key] = '<small>Historique indisponible.</small>'; })
      .then(function () { var el = pane.querySelector('[data-chart="' + key + '"]'); if (el) el.innerHTML = charts[key]; });
  }
  function chartSvg(r) {
    var W = 300, H = 92, L = 34, R = 6, T = 6, B = 14, vals = r.own.concat(r.avg).filter(function (v) { return v; });
    if (vals.length < 2) return '<small>Pas assez d’historique.</small>';
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), pad = Math.max(0.01, (hi - lo) * 0.15); lo -= pad; hi += pad;
    var n = r.own.length, x = function (i) { return L + (W - L - R) * i / (n - 1); }, y = function (v) { return T + (H - T - B) * (1 - (v - lo) / (hi - lo)); };
    var path = function (a) { var d = '', on = false; a.forEach(function (v, i) { if (v == null) { on = false; return; } d += (on ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); on = true; }); return d; };
    var marks = r.marks.map(function (p) { var X = x(p[0] - r.from), Y = y(p[1]); return '<path d="M' + (X - 3.5) + ' ' + (Y - 3.5) + 'L' + (X + 3.5) + ' ' + (Y + 3.5) + 'M' + (X + 3.5) + ' ' + (Y - 3.5) + 'L' + (X - 3.5) + ' ' + (Y + 3.5) + '" class="cx"/>'; }).join('');
    var last = r.own[n - 1], la = r.avg[n - 1], diff = last && la ? last - la : null;
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="csvg" role="img" aria-label="Prix sur 30 jours">' +
      '<text x="' + (L - 4) + '" y="' + (T + 8) + '" class="ax" text-anchor="end">' + A.price3(hi - pad) + '</text><text x="' + (L - 4) + '" y="' + (H - B) + '" class="ax" text-anchor="end">' + A.price3(lo + pad) + '</text>' +
      '<text x="' + L + '" y="' + (H - 2) + '" class="ax">il y a 30 j</text><text x="' + (W - R) + '" y="' + (H - 2) + '" class="ax" text-anchor="end">auj.</text>' +
      (r.n ? '<path d="' + path(r.avg) + '" class="avg"/>' : '') + '<path d="' + path(r.own) + '" class="own"/>' + marks + '</svg>' +
      '<div class="cleg"><span><i class="own"></i>cette station</span>' + (r.n ? '<span><i class="avg"></i>moy. ' + r.n + ' stations à 10 km</span>' : '') + '<span>× prix déclaré</span></div>' +
      (diff != null ? '<div class="cdiff">Aujourd’hui ' + A.price3(last) + ' € · alentour ' + A.price3(la) + ' € <b class="' + (diff > 0.005 ? 'up' : diff < -0.005 ? 'dn' : '') + '">(' + (diff >= 0 ? '+' : '−') + A.price3(Math.abs(diff)) + ' €)</b></div>' : '');
  }
  function setStep(st, m) {
    if (st !== 'setup') wheel = null;
    if (st === 'map' && (m || mode) === 'map') selected = null; // retour à la carte au repos : plus de station sélectionnée (ni son marqueur)
    if (m && m !== mode) { mode = m; scrollKeep = 0; }
    if (st !== step) scrollKeep = 0;
    step = st; render();
    if (nav.on) { navGeometry(); followCar(true); }
    log('voiture : ' + mode + ' › ' + step);
  }
  function startOf(m) { // où l'on arrive en touchant un bouton de la colonne
    if (m === 'map') return 'list';
    if (m === 'route') return !dest ? 'dest' : routeReady || computing ? 'stops' : 'fuel';
    return FLOWS[m][0][0];
  }
  function closeMode() { if (guide) setStep('guide', guide.gmode); else { selected = null; setStep('map', 'map'); } }

  // ---- station choisie : marqueur, cible du bouton « Y aller » de l'hôte, carte centrée à droite de la carte flottante
  function select(s, fly) {
    selected = s; window.__carSel = s; A.refreshMap(); // la station choisie a toujours sa pastille (son cadre ne doit pas entourer un point)
    try {
      if (!selMarker) selMarker = L.marker([s.lat, s.lon], { icon: L.divIcon({ className: '', html: '<div class="csel-marker"></div>', iconSize: [0, 0], iconAnchor: [0, 0] }), interactive: false, zIndexOffset: 1000 }).addTo(A.map);
      else selMarker.setLatLng([s.lat, s.lon]);
    } catch (e) { }
    try { if (window.AndroidAuto && window.AndroidAuto.setTarget) { var k = A.pick(s, A.fuelsFor(A.car().fuel)); window.AndroidAuto.setTarget(s.lat, s.lon, plainName(s) + (k >= 0 ? ' · ' + A.price3(s.p[k]) + ' €' : '')); } } catch (e) { }
    if (fly && !nav.on) { A.setFollow(false); var z = Math.max(A.map.getZoom(), 13); A.map.setView(shifted([s.lat, s.lon], z), z, { animate: false }); }
  }
  function pick(s) { // station touchée (ligne de liste ou pastille sur la carte)
    log('voiture : station choisie ' + s.id + ' ' + s.ville);
    if (mode === 'route' && step === 'stops') { select(s, true); render(); return; } // arrêt du trajet : on le montre, on reste dans le trajet
    if (mode !== 'shortage') mode = 'map';
    selected = s; setStep('station'); select(s, true);
  }
  // le panneau recouvre la gauche de la carte : on décale le centre pour que le point soit visible à droite
  function shifted(ll, z) {
    var cover = panelStep() ? pane.getBoundingClientRect().right - A.map.getContainer().getBoundingClientRect().left : 0; if (cover <= 0) return ll;
    return A.map.unproject(A.map.project(L.latLng(ll), z).subtract([cover / 2, 0]), z);
  }

  // ---- guidage FuelMap : itinéraire par les arrêts (OSRM, instructions), temps restant, voix ; la carte suit la voiture, façon navigation.
  // Dans Android Auto, la fiche de manœuvre et l'arrivée sont dessinées par l'hôte (pont AndroidAuto.setRouting) ; ailleurs, par la page.
  var guide = null, guideLayer = null, guideBox = el('carGuide');
  guideBox.addEventListener('click', function (e) { if (e.target.closest('[data-stopguide]')) stopGuide(); });
  nextBox.addEventListener('click', function (e) { if (e.target.closest('[data-skip]')) skipStop(); });
  var ARROWS = { 'depart': '🚗', 'straight': '⬆', 'slight-left': '↖', 'slight-right': '↗', 'left': '⬅', 'right': '➡', 'sharp-left': '↙', 'sharp-right': '↘', 'uturn-left': '⤺', 'uturn-right': '⤻', 'roundabout': '🔄', 'exit-roundabout': '🔄', 'merge-left': '↰', 'merge-right': '↱', 'merge': '⤴', 'on-ramp-left': '↰', 'on-ramp-right': '↱', 'off-ramp-left': '↰', 'off-ramp-right': '↱', 'fork-left': '↖', 'fork-right': '↗', 'arrive': '🏁', 'arrive-left': '🏁', 'arrive-right': '🏁' };
  function side(mod) { return /left|gauche/.test(mod || '') ? 'left' : /right|droite/.test(mod || '') ? 'right' : ''; }
  function kind(m) { // code de manœuvre (commun page / Android) à partir d'OSRM
    var t = m.type, mod = m.modifier || '', sd = side(mod);
    if (t === 'depart') return 'depart';
    if (t === 'arrive') return sd ? 'arrive-' + sd : 'arrive';
    if (t === 'roundabout' || t === 'rotary' || t === 'roundabout turn') return 'roundabout';
    if (t === 'exit roundabout' || t === 'exit rotary') return 'exit-roundabout';
    if (t === 'merge') return sd ? 'merge-' + sd : 'merge';
    if (t === 'on ramp') return 'on-ramp-' + (sd || 'right');
    if (t === 'off ramp') return 'off-ramp-' + (sd || 'right');
    if (t === 'fork') return 'fork-' + (sd || 'right');
    if (/uturn/.test(mod)) return 'uturn-' + (sd || 'left');
    if (/sharp/.test(mod)) return 'sharp-' + sd;
    if (/slight/.test(mod)) return 'slight-' + sd;
    if (sd) return sd;
    return 'straight';
  }
  // Panneaux : numéro de sortie (« 12 ») et directions (« A 10: Paris, Orléans ») fournis par OSRM — ce qu'on veut entendre pour
  // ne pas rater la sortie, surtout quand on ne voit rien (tunnel, échangeur).
  function signs(st) {
    var d = String(st.destinations || '').split(':'), refs = d.length > 1 ? d[0].replace(/\s+/g, '') : '', towns = (d.length > 1 ? d[1] : d[0]).split(',').map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 2);
    return { exitNo: String(st.exits || '').split(';')[0].trim(), dir: towns.length ? ', direction ' + towns.join(', ') : refs ? ', direction ' + refs : '' };
  }
  function cueText(k, m, road, sg) {
    sg = sg || {}; var dir = sg.dir || '';
    var r = dir || (road ? ' sur ' + road : ''), ex = m.exit ? (m.exit === 1 ? '1re' : m.exit + 'e') + ' sortie' : '';
    if (/^off-ramp/.test(k)) return 'Prenez la sortie' + (sg.exitNo ? ' ' + sg.exitNo : '') + (k.slice(-4) === 'left' ? ' à gauche' : ' à droite') + (dir || (road ? ' vers ' + road : ''));
    if (/^(on-ramp|fork|merge)/.test(k) && dir) return (/^on-ramp/.test(k) ? 'Prenez la bretelle' : /^fork/.test(k) ? (k.slice(-4) === 'left' ? 'Restez à gauche' : 'Restez à droite') : 'Rejoignez la voie') + dir;
    switch (k) {
      case 'depart': return 'C\'est parti' + r;
      case 'straight': return 'Continuez tout droit' + r;
      case 'left': return 'Tournez à gauche' + r; case 'right': return 'Tournez à droite' + r;
      case 'slight-left': return 'Serrez à gauche' + r; case 'slight-right': return 'Serrez à droite' + r;
      case 'sharp-left': return 'Tournez franchement à gauche' + r; case 'sharp-right': return 'Tournez franchement à droite' + r;
      case 'uturn-left': case 'uturn-right': return 'Faites demi-tour';
      case 'roundabout': return 'Au rond-point, ' + (ex || 'sortez') + r;
      case 'exit-roundabout': return 'Sortez du rond-point' + r;
      case 'merge': case 'merge-left': case 'merge-right': return 'Rejoignez la voie' + r;
      case 'on-ramp-left': case 'on-ramp-right': return 'Prenez la bretelle' + (k.slice(-4) === 'left' ? ' à gauche' : ' à droite') + r;
      case 'off-ramp-left': case 'off-ramp-right': return 'Prenez la sortie' + (k.slice(-4) === 'left' ? ' à gauche' : ' à droite') + r;
      case 'fork-left': return 'Restez à gauche' + r; case 'fork-right': return 'Restez à droite' + r;
      case 'arrive-left': return 'Vous êtes arrivé, à gauche'; case 'arrive-right': return 'Vous êtes arrivé, à droite'; case 'arrive': return 'Vous êtes arrivé';
    }
    return 'Continuez' + r;
  }
  function lower(t) { return t.charAt(0).toLowerCase() + t.slice(1); }
  function distText(m) { return m < 1000 ? Math.max(10, Math.round(m / 10) * 10) + ' m' : A.num(m / 1000, m < 10000 ? 1 : 0) + ' km'; }
  function distSpeech(m) { return m < 1000 ? Math.max(10, Math.round(m / 10) * 10) + ' mètres' : (m < 10000 ? A.num(m / 1000, 1) : A.num(m / 1000, 0)).replace(',', ' virgule ') + ' kilomètres'; }
  function speak(text) { try { if (window.AndroidAuto && window.AndroidAuto.speak) { window.AndroidAuto.speak(text); return; } if (window.speechSynthesis) { var u = new SpeechSynthesisUtterance(text); u.lang = 'fr-FR'; speechSynthesis.speak(u); } } catch (e) { } }
  function hostRouting() { return !!(window.AndroidAuto && window.AndroidAuto.setRouting); }

  function wpOf(s, stop) { var k = A.pick(s, A.fuelsFor(A.car().fuel)); return { lat: s.lat, lon: s.lon, s: s, stop: !!stop, plain: plainName(s), price: k >= 0 ? A.price3(s.p[k]) : '' }; }
  // Guidage vers une suite de points : les arrêts carburant (stop) puis le point final (station ou destination du trajet).
  function go(wps, keep) {
    var f = A.fix; if (!f) { A.toast('📍 Pas de position GPS'); return; }
    if (!wps.length) return;
    var back = guide ? guide.back : { mode: mode, step: step === 'guide' ? FLOWS[mode][0][0] : step }, gmode = guide ? guide.gmode : mode;
    log('voiture : guidage → ' + wps.map(function (w) { return w.plain; }).join(' › '));
    var spoken = keep && guide ? guide.spoken : resumeQuiet ? { start: 1 } : {}; // reprise après recréation : pas de nouvelle annonce
    stopGuide(true);
    var g = guide = { wps: wps, fin: wps[wps.length - 1], back: back, gmode: gmode, pts: null, cum: null, D: 0, min: 0, steps: [], spoken: spoken, lastKey: '', idx: 0 };
    if (!hostRouting()) { guideBox.hidden = false; guideBox.innerHTML = '<div class="gi">⏳</div><div class="gt"><div class="d">Itinéraire…</div><div class="n">' + A.esc(g.fin.plain) + '</div></div><button data-stopguide>✕</button>'; }
    mode = gmode; setStep('guide');
    A.osrmRoute([{ lat: f.lat, lon: f.lon }].concat(wps), true, true).then(function (r) {
      if (guide !== g) return;
      var pts = A.decodePolyline(r.geometry), cum = [0];
      for (var i = 1; i < pts.length; i++) cum.push(cum[i - 1] + A.haversine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
      var scale = cum[cum.length - 1] > 0 ? (r.distance / 1000) / cum[cum.length - 1] : 1; cum = cum.map(function (v) { return v * scale; });
      g.pts = pts; g.cum = cum; g.D = r.distance / 1000; g.min = r.duration / 60;
      var acc = 0, legEnd = 0;
      (r.legs || []).forEach(function (leg, li) {
        var wp = wps[li], last = li === wps.length - 1;
        (leg.steps || []).forEach(function (st) {
          var o = { kind: kind(st.maneuver), m: st.maneuver, road: st.name || '', at: acc, dist: st.distance, wp: li }, sg = signs(st);
          o.cue = /^arrive/.test(o.kind) && !last ? 'Arrêt carburant, ' + wp.plain + (side(st.maneuver.modifier) === 'left' ? ', à gauche' : side(st.maneuver.modifier) === 'right' ? ', à droite' : '') : cueText(o.kind, st.maneuver, o.road, sg);
          g.steps.push(o); acc += st.distance;
        });
        legEnd += leg.distance; if (wp) wp.atM = legEnd; acc = legEnd;
      });
      var ac = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2fd27a';
      guideLayer = L.layerGroup([L.polyline(pts, { color: '#061a12', weight: 11, opacity: .55, lineCap: 'round' }), L.polyline(pts, { color: ac, weight: 6, opacity: .95, lineCap: 'round' })]).addTo(A.map);
      wps.forEach(function (w) { if (w.stop) guideLayer.addLayer(L.marker([w.lat, w.lon], { icon: L.divIcon({ className: '', html: '<div class="cstop-marker">⛽</div>', iconSize: [30, 30], iconAnchor: [15, 15] }), interactive: false })); });
      A.setFollow(false); followCar(true);
      if (!g.spoken.start) {
        g.spoken.start = 1; var nx = nextStep(0), ns = wps.filter(function (w) { return w.stop; }).length;
        if (nx) { g.spoken['a' + nx.at] = 1; g.spoken['b' + nx.at] = 1; }
        speak('Itinéraire calculé, ' + distSpeech(g.D * 1000) + (ns ? ', ' + ns + ' arrêt' + (ns > 1 ? 's' : '') + ' carburant' : '') + '. ' + (nx ? (nx.at > 120 ? 'Dans ' + distSpeech(nx.at) + ', ' + lower(nx.cue) : nx.cue) : ''));
      }
      updateGuide(true);
    }).catch(function (err) { A.toast('⚠️ ' + (err.message || 'itinéraire impossible')); if (guide === g) stopGuide(); });
  }
  function nextStep(progM) { for (var i = 0; i < guide.steps.length; i++) if (guide.steps[i].kind !== 'depart' && guide.steps[i].at > progM - 15) return guide.steps[i]; return null; }
  function progress(f) { // avancement le long de l'itinéraire, sans sauter en arrière (aller-retour vers une station par la même route)
    var P = guide.pts, n = P.length, best = Infinity, bi = guide.idx, i, d;
    for (i = Math.max(0, guide.idx - 20); i < Math.min(n, guide.idx + 400); i++) { d = A.haversine(f.lat, f.lon, P[i][0], P[i][1]); if (d < best) { best = d; bi = i; } }
    if (best > 0.3) for (i = 0; i < n; i++) { d = A.haversine(f.lat, f.lon, P[i][0], P[i][1]); if (d < best) { best = d; bi = i; } }
    guide.idx = bi; return { km: guide.cum[bi], off: best };
  }
  function nextWp() { for (var i = 0; i < guide.wps.length; i++) if (!guide.wps[i].done) return guide.wps[i]; return null; }
  function updateGuide(force, vf) { // vf : position estimée (tunnel), sinon la position GPS
    if (!guide || !guide.pts) return;
    var f = vf || A.fix; if (!f) return;
    var g = guide, pr = progress(f), progM = pr.km * 1000, leftKm = Math.max(0, g.D - pr.km), mins = g.min * (g.D > 0 ? leftKm / g.D : 1);
    g.wps.forEach(function (w, i) { // arrêts atteints (ou dépassés sur la route) ; le dernier point = arrivée
      if (w.done) return; var dd = A.haversine(f.lat, f.lon, w.lat, w.lon);
      if (dd < 0.08 || (w.stop && w.atM != null && progM > w.atM + 150)) {
        w.done = true;
        if (w.stop && dd < 0.15) { speak('Vous êtes à votre arrêt carburant, ' + w.plain + '. Le guidage reprendra quand vous repartirez.'); log('voiture : arrêt atteint ' + w.plain); }
      }
    });
    var nw = nextWp(), arrived = !nw, nx = nextStep(progM), toNext = nx ? Math.max(0, nx.at - progM) : 0, off = pr.off > 0.3;
    var info = { kind: arrived ? 'arrive' : nx ? nx.kind : 'straight', cue: arrived ? 'Vous êtes arrivé' : nx ? nx.cue : 'Continuez', road: nx ? nx.road : '', exit: nx && nx.m.exit || 0, distM: Math.round(toNext), remainKm: leftKm, remainMin: mins, etaMs: Date.now() + mins * 60000, label: g.fin.plain, off: off };
    // voix : annonce à ~400 m puis à ~60 m de chaque manœuvre, une seule fois chacune
    if (nx && !arrived) { var key = nx.at; if (toNext < 450 && !g.spoken['a' + key]) { g.spoken['a' + key] = 1; if (toNext > 120) speak('Dans ' + distSpeech(toNext) + ', ' + lower(nx.cue)); } if (toNext < 70 && !g.spoken['b' + key]) { g.spoken['b' + key] = 1; speak(nx.cue); } }
    if (arrived && !g.spoken.end) { g.spoken.end = 1; speak('Vous êtes arrivé à ' + g.fin.plain + '.'); setTimeout(function () { if (guide === g) stopGuide(); }, 20000); }
    var sig = info.kind + '|' + Math.round(info.distM / 10) + '|' + Math.round(info.remainMin) + '|' + (off ? 1 : 0) + '|' + (nw ? nw.plain + Math.round((nw.atM - progM) / 100) : '');
    if (force || sig !== g.lastKey) {
      g.lastKey = sig;
      try { if (hostRouting()) window.AndroidAuto.setRouting(JSON.stringify(info)); } catch (e) { }
      if (!hostRouting()) {
        guideBox.hidden = false;
        guideBox.innerHTML = '<div class="gi">' + (ARROWS[info.kind] || '⬆') + '</div><div class="gt"><div class="d">' + (arrived ? 'Tu y es' : distText(info.distM)) + (off ? ' <small>hors itinéraire</small>' : '') + '</div><div class="n">' + A.esc(info.cue) + '</div><div class="e">' + km(leftKm) + ' · ' + (mins < 1 ? '< 1 min' : dur(mins)) + ' · arrivée ' + new Date(info.etaMs).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + '</div></div><button data-stopguide>✕</button>';
      }
      var stops = g.wps.filter(function (w) { return w.stop; });
      nextBox.innerHTML = !nw ? '🏁 <b>' + A.esc(g.fin.plain) + '</b>' :
        (nw.s ? '⛽ ' + (nw.stop ? 'Arrêt ' + (stops.indexOf(nw) + 1) + '/' + stops.length + ' · ' : '') + '<b>' + A.esc(nw.plain) + '</b>' + (nw.price ? ' · ' + nw.price + (nw.price.indexOf('⚠') < 0 ? ' €' : '') : '') : '🏁 <b>' + A.esc(nw.plain) + '</b>') +
        (nw.atM != null ? ' · ' + km(Math.max(0, nw.atM - progM) / 1000) : '') + (nw.stop ? '<button data-skip>⏭ Passer</button>' : '');
    }
    if (force || !g.savedAt || Date.now() - g.savedAt > 15000) { g.savedAt = Date.now(); saveSession(); }
    followCar(false, vf);
    if (vf) return; // position estimée : on ne recalcule jamais dessus
    approachCheck(g, nw, progM);
    g.realKm = pr.km;
    // hors itinéraire : recalcul seulement après 3 positions de suite à plus de 500 m, et pas sur une position imprécise (sortie de tunnel)
    if (pr.off > 0.5 && !arrived && !(f.acc > 80)) { g.offN = (g.offN || 0) + 1; if (g.offN >= 3) reroute(); } else g.offN = 0;
  }
  // Tunnel : plus de position GPS depuis 4 s alors qu'on roulait → on avance sur l'itinéraire à la dernière vitesse connue (jusqu'à
  // 2 min), pour que la flèche, les instructions et la voix continuent. Le GPS reprend la main dès qu'il revient.
  var lastFixAt = Date.now();
  setInterval(function () {
    var g = guide, f = A && A.fix; if (!g || !g.pts || !f || g.realKm == null) return;
    var dt = (Date.now() - lastFixAt) / 1000, v = f.speed || 0; if (dt < 4 || dt > 120 || v < 3) return;
    var target = g.realKm + v * dt / 1000, P = g.pts, C = g.cum, j = g.idx;
    while (j < C.length - 1 && C[j] < target) j++;
    var i = Math.max(0, j - 1), u = C[j] > C[i] ? Math.min(1, Math.max(0, (target - C[i]) / (C[j] - C[i]))) : 0;
    var toR = Math.PI / 180, a = P[i], b = P[j], dLon = (b[1] - a[1]) * toR, hd = (Math.atan2(Math.sin(dLon) * Math.cos(b[0] * toR), Math.cos(a[0] * toR) * Math.sin(b[0] * toR) - Math.sin(a[0] * toR) * Math.cos(b[0] * toR) * Math.cos(dLon)) / toR + 360) % 360;
    if (!g.drLogged) { // GPS perdu : on le dit, et on rappelle la prochaine manœuvre (sortie, direction) pour ne pas la rater
      g.drLogged = 1; log('voiture : GPS perdu, position estimée sur l’itinéraire');
      var nx = nextStep(g.realKm * 1000);
      if (nx && !/^arrive/.test(nx.kind)) speak('GPS perdu. N’oubliez pas : ' + (nx.at - g.realKm * 1000 > 150 ? 'dans ' + distSpeech(nx.at - g.realKm * 1000) + ', ' + lower(nx.cue) : lower(nx.cue)) + '.');
      else speak('GPS perdu, position estimée.');
    }
    updateGuide(false, { lat: a[0] + (b[0] - a[0]) * u, lon: a[1] + (b[1] - a[1]) * u, speed: v, heading: hd, dr: true });
  }, 1000);
  // À l'approche d'un arrêt carburant (< 15 km) : les prix sont relus toutes les 5 min. Rupture déclarée → alerte écran + voix
  // (on peut alors prendre une autre station et « Remplacer l'arrêt ») ; prix changé → on le dit. Une seule alerte par station.
  function approachCheck(g, nw, progM) {
    if (!nw || !nw.s || !nw.s.id || nw.atM == null || nw.atM - progM > 15000) return;
    if (g.checkAt && Date.now() - g.checkAt < 5 * 60000) return;
    g.checkAt = Date.now(); g.warned = g.warned || {};
    A.refreshQuiet().then(function () {
      if (guide !== g || nw.done) return;
      var s2 = A.stations.filter(function (x) { return String(x.id) === String(nw.s.id); })[0]; if (!s2) return;
      var k = A.pick(s2, A.fuelsFor(A.car().fuel)), conf = k >= 0 ? A.confidence(s2, k) : null, id = String(s2.id);
      log('voiture : vérification à l’approche de ' + nw.plain + ' → ' + (k < 0 ? 'pas de prix' : A.price3(s2.p[k]) + ' ' + (conf ? conf.label : '')));
      if ((k < 0 || (conf && conf.level < 0)) && !g.warned[id]) {
        g.warned[id] = 1; speak('Attention : rupture de carburant déclarée à ' + nw.plain + '. Choisissez une autre station avec Pénurie.');
        A.toast('⚠️ Rupture déclarée à ' + nw.plain + ' : 🚨 Pénurie pour une autre station'); nw.price = '⚠️ rupture'; g.lastKey = '';
      } else if (k >= 0 && nw.price && nw.price !== A.price3(s2.p[k]) && nw.price.indexOf('⚠') < 0) {
        var old = nw.price; nw.price = A.price3(s2.p[k]); g.lastKey = '';
        speak('Le prix a changé à ' + nw.plain + ' : ' + nw.price.replace(',', ' euros ') + '.'); A.toast('ℹ️ ' + nw.plain + ' : ' + old + ' € → ' + nw.price + ' €');
      }
    }).catch(function () { });
  }
  var rerouteAt = 0;
  function remaining() { return guide.wps.filter(function (w) { return !w.done; }); }
  function reroute() { if (Date.now() - rerouteAt < 20000 || !guide) return; rerouteAt = Date.now(); log('voiture : recalcul de l\'itinéraire'); speak('Recalcul de l\'itinéraire'); go(remaining(), true); }
  function skipStop() {
    if (!guide) return; var nw = nextWp(); if (!nw || !nw.stop) return;
    nw.done = true; log('voiture : arrêt passé ' + nw.plain); speak('Arrêt passé.'); go(remaining(), true);
  }
  function stopGuide(silent) {
    var had = guide; guide = null; guideBox.hidden = true; nextBox.hidden = true; if (guideLayer) { try { guideLayer.remove(); } catch (e) { } guideLayer = null; }
    if (silent) return;
    navOff();
    if (had) {
      try { if (window.AndroidAuto && window.AndroidAuto.stopRouting) window.AndroidAuto.stopRouting(); } catch (e) { }
      log('voiture : guidage arrêté');
      setStep(had.back.step, had.back.mode);
    }
  }
  function goTrip() { // trajet : par les arrêts restants, puis la destination
    if (!dest) return;
    var rr = routeReady ? routeRows() : null, wps = rr ? rr.list.map(function (x) { return wpOf(x.s, true); }) : [];
    wps.push({ lat: dest.lat, lon: dest.lon, s: null, stop: false, plain: short(dest.label), price: '' });
    mode = 'route'; go(wps);
  }

  // ---- vue navigation : la carte devient un grand carré centré sur la voiture, tourné dans le sens de la marche et incliné (CSS) ;
  // la voiture est dessinée par une flèche fixe au tiers bas de l'écran. Le carré déborde de l'écran : rien ne manque quand il tourne.
  var arrow = el('carArrow');
  // vue du guidage : 3D = carte inclinée (on voit loin devant), 2D = à plat ; toujours tournée dans le sens de la marche. Choix mémorisé.
  var view3d = true; try { view3d = localStorage.getItem('fuelmap-car3d') !== '0'; } catch (e) { }
  function applyView() { document.documentElement.style.setProperty('--nav-tilt', view3d ? '32deg' : '0deg'); }
  applyView();
  viewBox.addEventListener('click', function (e) { var b = e.target.closest('[data-view]'); if (!b) return; view3d = b.getAttribute('data-view') === '3'; try { localStorage.setItem('fuelmap-car3d', view3d ? '1' : '0'); } catch (err) { } applyView(); render(); log('voiture : vue ' + (view3d ? '3D' : '2D')); });
  var nav = { on: false, heading: 0, freeUntil: 0 };
  function navGeometry() {
    // Pendant le guidage, l'hôte pose ses cartes (manœuvre, temps restant) à gauche et annonce une zone libre qui commence à leur droite :
    // la colonne est masquée, la carte couvre tout l'écran et la flèche se place au milieu de la partie libre.
    var root = document.documentElement, st = root.style, cs = getComputedStyle(root), px = function (v) { return parseFloat(cs.getPropertyValue(v)) || 0; };
    var left = Math.max(px('--stable-l'), px('--safe-l')), right = innerWidth - Math.max(px('--stable-r'), px('--safe-r')), h = innerHeight;
    if (!rail.hidden && rail.getBoundingClientRect().width) left = Math.max(left, rail.getBoundingClientRect().right); // colonne flottante
    if (panelStep()) left = Math.max(left, pane.getBoundingClientRect().right); // une étape est ouverte : la flèche reste visible à sa droite
    var cx = left + Math.max(0, right - left) / 2, cy = h * 0.66, R = Math.max(Math.hypot(cx, cy), Math.hypot(innerWidth - cx, cy), Math.hypot(cx, h - cy), Math.hypot(innerWidth - cx, h - cy));
    var S = Math.ceil(2 * R * 1.2); // le carré tourné et incliné doit couvrir tout l'écran, coins compris
    st.setProperty('--nav-s', S + 'px'); st.setProperty('--nav-x', Math.round(cx - S / 2) + 'px'); st.setProperty('--nav-y', Math.round(cy - S / 2) + 'px');
    arrow.style.left = cx + 'px'; arrow.style.top = cy + 'px';
  }
  function navOn() {
    if (nav.on) return; nav.on = true; nav.freeUntil = 0;
    document.documentElement.classList.add('carnav'); navGeometry(); arrow.hidden = false;
    A.map.invalidateSize({ animate: false }); window.addEventListener('resize', navGeometry);
  }
  function navOff() {
    if (!nav.on) return; nav.on = false; window.__mapRotation = 0;
    document.documentElement.classList.remove('carnav'); arrow.hidden = true; window.removeEventListener('resize', navGeometry);
    document.documentElement.style.removeProperty('--nav-rot');
    var f = A.fix; A.map.invalidateSize({ animate: false }); if (f) A.map.setView(shifted([f.lat, f.lon], 14), 14, { animate: false });
  }
  function routeBearing(f) { // cap de la route au niveau de la voiture (quand le GPS n'en donne pas : arrêt, vitesse faible)
    if (!guide || !guide.pts) return null;
    var P = guide.pts, bi = guide.idx, a = P[bi], b = P[Math.min(P.length - 1, bi + 3)]; if (a === b) { if (bi === 0) return null; a = P[bi - 1]; b = P[bi]; }
    var toR = Math.PI / 180, dLon = (b[1] - a[1]) * toR, y = Math.sin(dLon) * Math.cos(b[0] * toR), x = Math.cos(a[0] * toR) * Math.sin(b[0] * toR) - Math.sin(a[0] * toR) * Math.cos(b[0] * toR) * Math.cos(dLon);
    return (Math.atan2(y, x) / toR + 360) % 360;
  }
  function setHeading(h) {
    if (h == null || isNaN(h)) return;
    var cur = nav.heading, delta = ((h - cur) % 360 + 540) % 360 - 180; // plus court chemin, pour que la transition CSS ne fasse pas un tour complet
    nav.heading = cur + delta; window.__mapRotation = nav.heading * Math.PI / 180;
    document.documentElement.style.setProperty('--nav-rot', (-nav.heading) + 'deg');
  }
  function followCar(force, vf) {
    var f = vf || A.fix; if (!f || !guide) return;
    if (!nav.on) navOn();
    var kmh = f.speed != null ? f.speed * 3.6 : 0, hd = f.heading != null && !isNaN(f.heading) && kmh > 6 ? f.heading : routeBearing(f);
    setHeading(hd);
    if (Date.now() < nav.freeUntil) return; // l'utilisateur a déplacé ou zoomé la carte : on la lui laisse quelques secondes
    var m = A.map, z = kmh > 80 ? 14 : kmh > 45 ? 15 : 16, c = L.latLng(f.lat, f.lon);
    if (force || m.getZoom() !== z) m.setView(c, z, { animate: false }); else m.panTo(c, { animate: true, duration: 0.5, easeLinearity: 1 });
  }
  function recenter() { nav.freeUntil = 0; if (guide) followCar(true); else { A.setFollow(true); A.locate().catch(function () { }); } }

  // ---- trajet : calcul depuis la position de la voiture, une fois la destination et le niveau de carburant donnés
  function compute() {
    var f = A.fix; wantRoute = true; routeReady = false; routeErr = null;
    if (!A.state.cars.length) { routeErr = 'Aucun véhicule : renseigne-le dans FuelMap sur le téléphone.'; render(); return; }
    if (!dest || !f || !A.stations.length) { render(); return; } // repris à l'arrivée du GPS ou des prix
    F.setPlace('from', { label: 'Ma position', lat: f.lat, lon: f.lon, gps: true }); F.setPlace('to', dest);
    computing = true; selected = null; render();
    F.compute();
  }
  function setDest(p) {
    log('voiture : destination ' + (p ? p.label + ' (' + p.lat + ',' + p.lon + ')' : 'effacée'));
    dest = p ? { label: p.label, lat: +p.lat, lon: +p.lon } : null; selected = null; routeErr = null; routeReady = false; wantRoute = false;
    setStep(dest ? 'fuel' : 'dest', 'route'); // avant de partir : le niveau du réservoir
  }

  pane.addEventListener('click', function (e) {
    var t;
    if (e.target.closest('[data-sort]')) { sortAsc = !sortAsc; scrollKeep = 0; render(); return; }
    if (e.target.closest('[data-search]')) { try { if (window.AndroidAuto && window.AndroidAuto.search) window.AndroidAuto.search(); else A.toast('Recherche disponible dans la voiture'); } catch (err) { } return; }
    if (e.target.closest('[data-askagenda]')) { try { window.AndroidAuto.askAgenda(); } catch (err) { } return; }
    if ((t = e.target.closest('[data-agenda]'))) {
      var ev = agendaEv[+t.getAttribute('data-agenda')]; if (!ev) return; var l2 = t.querySelector('.l2 span'); l2.textContent = '⏳ Recherche du lieu…';
      A.findPlace(ev.where).then(function (p) { log('voiture : destination agenda ' + ev.where); setDest(p); }).catch(function (err) { l2.textContent = '⚠️ ' + err.message; });
      return;
    }
    if ((t = e.target.closest('[data-dest]'))) { var ch = pane._choices[+t.getAttribute('data-dest')]; if (ch) setDest(ch.p); return; }
    if ((t = e.target.closest('[data-e]'))) { var v = +t.getAttribute('data-e'); if (v === A.state.startE) v--; A.state.startE = Math.max(0, Math.min(8, v)); A.save(); render(); return; }
    if (e.target.closest('[data-calc]')) { setStep('stops'); compute(); return; }
    if (e.target.closest('[data-trip]')) { goTrip(); return; }
    if (e.target.closest('[data-swap]') && selected && guide) { // remplace le prochain arrêt du trajet (ou l'ajoute avant la destination)
      var rem = remaining(), ix = -1, nw = wpOf(selected, true); rem.some(function (w, i) { if (w.stop) { ix = i; return true; } return false; });
      if (ix >= 0) rem.splice(ix, 1, nw); else rem.splice(rem.length - 1, 0, nw);
      log('voiture : nouvel arrêt ' + nw.plain); speak('Nouvel arrêt carburant : ' + nw.plain + '.'); go(rem, true); return;
    }
    if (e.target.closest('[data-go]')) { if (selected) go([wpOf(selected)]); return; }
    if ((t = e.target.closest('[data-usecar]'))) { A.useCar(t.getAttribute('data-usecar')); render(); return; }
    if (e.target.closest('[data-fillnow]')) { // plein noté depuis la voiture : la station la plus proche (moins de 2 km)
      var o2 = origin(), near = A.stations.map(function (x) { return { s: x, d: A.haversine(o2.lat, o2.lon, x.lat, x.lon) }; }).filter(function (x) { return x.d < 2; }).sort(function (x, y) { return x.d - y.d; })[0];
      if (near && window.__fuelmapFill) window.__fuelmapFill.open(near.s, false); else A.toast('Aucune station à moins de 2 km'); return;
    }
    if ((t = e.target.closest('[data-p98]'))) { A.updateCar({ prefer98: +t.getAttribute('data-p98') }); render(); return; }
    if ((t = e.target.closest('[data-consmode]'))) { A.updateCar({ consMode: t.getAttribute('data-consmode') }); render(); return; }
    if ((t = e.target.closest('[data-cfuel]'))) { A.updateCar({ fuel: t.getAttribute('data-cfuel') }); render(); return; }
    if ((t = e.target.closest('[data-adj]'))) {
      var cc = A.car(), d = +t.getAttribute('data-d'), key = t.getAttribute('data-adj');
      if (key === 'range') { var r0 = Math.round((cc.tank - cc.reserve) * 100 / cc.cons / 10) * 10, r1 = Math.max(100, Math.min(2500, r0 + d * 10)); A.updateCar({ tank: Math.round((r1 * cc.cons / 100 + cc.reserve) * 10) / 10 }); render(); return; } // km par plein → carburant utilisable → réservoir
      if (key === 'cons') A.updateCar({ cons: Math.round(Math.max(1, Math.min(40, cc.cons + d * 0.1)) * 10) / 10 });
      else A.updateCar({ tank: Math.max(5, Math.min(200, Math.round(cc.tank) + d)), reserve: Math.min(cc.reserve, (Math.round(cc.tank) + d) / 2) });
      render(); return;
    }
    if (e.target.closest('[data-wheelopen]')) { wheel = hexHsl(A.car().color || '#3b82f6'); render(); return; }
    if (e.target.closest('[data-wheelok]')) { wheel = null; render(); return; }
    if ((t = e.target.closest('[data-wheel]')) || (t = e.target.closest('[data-light]'))) {
      var r = t.getBoundingClientRect();
      if (t.hasAttribute('data-wheel')) { var dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2); wheel.h = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360; wheel.s = Math.min(1, Math.hypot(dx, dy) / (r.width / 2)); }
      else wheel.l = 0.12 + 0.76 * Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      A.updateCar({ color: hslHex(wheel.h, wheel.s, wheel.l), paint: 'Couleur perso' }); render(); return;
    }
    if ((t = e.target.closest('[data-ccolor]'))) { A.updateCar({ color: t.getAttribute('data-ccolor'), paint: t.getAttribute('data-cname') }); render(); return; }
    if ((t = e.target.closest('[data-theme]'))) { A.setTheme(t.getAttribute('data-theme')); render(); return; }
    if ((t = e.target.closest('[data-sid]'))) { var s = A.stations.filter(function (x) { return String(x.id) === t.getAttribute('data-sid'); })[0]; if (s) pick(s); }
  });
  steps.addEventListener('click', function (e) {
    var b = e.target.closest('[data-step]'); if (!b) return; var st = b.getAttribute('data-step');
    if (st === 'close') closeMode(); else setStep(st);
  });
  chip.addEventListener('click', function () { if (A.stations.length && viewStations().length) setStep('list'); });
  rail.addEventListener('click', function (e) {
    var b = e.target.closest('[data-rail]'); if (!b) return; var m = b.getAttribute('data-rail');
    if (m === 'zin' || m === 'zout') { zoomBy(m === 'zin' ? 1 : -1); return; }
    if (m === mode && panelStep()) closeMode(); else setStep(startOf(m), m);
  });

  // ---- « les yeux sur la route » : en roulant, plus de 6 touchers ou gestes en 10 s → écran bloqué 3 s, avec une barre qui se vide
  var lock = { until: 0, hits: [], lastGesture: 0, test: false };
  function driving() { var f = A && A.fix; return lock.test || !!(f && f.speed != null && f.speed * 3.6 > 8); }
  function locked() { return Date.now() < lock.until; }
  function spend() { // compte une action ; false = refusée (écran bloqué)
    if (locked()) return false;
    if (!A || !driving()) return true;
    var now = Date.now(); lock.hits = lock.hits.filter(function (t) { return now - t < 10000; }); lock.hits.push(now);
    if (lock.hits.length > 6) { lock.hits = []; lock.until = now + 3000; lockShow(); return false; }
    return true;
  }
  function gesture() { var now = Date.now(), fresh = now - lock.lastGesture > 700; lock.lastGesture = now; return fresh ? spend() : !locked(); } // un glisser = une action, pas une par événement
  function lockShow() {
    log('voiture : écran bloqué 3 s (trop de touchers en roulant)');
    lockBox.innerHTML = '<div><b>🚗 Les yeux sur la route</b><small>L\'écran se débloque dans un instant</small><span class="bar"><i></i></span></div>'; lockBox.hidden = false;
    setTimeout(function () { lockBox.hidden = true; }, 3000);
  }
  document.addEventListener('click', function (e) { if (!spend()) { e.stopPropagation(); e.preventDefault(); } }, true);
  document.addEventListener('pointerdown', function (e) { // repère visuel du toucher : on voit tout de suite que l'écran a réagi
    lastX = e.clientX; if (locked()) return;
    var r = document.createElement('i'); r.className = 'ctap'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; document.body.appendChild(r);
    setTimeout(function () { r.remove(); }, 450);
  }, true);

  // ---- gestes renvoyés par l'hôte Android Auto (CarWebSurface). L'hôte ne dit pas où le doigt est posé :
  // une liste est affichée → le glisser la fait défiler ; sinon il déplace la carte. Le pincer zoome toujours la carte.
  var pdx = 0, pdy = 0, panRaf = 0, panEnd = null;
  function panMap(dx, dy) {
    if (nav.on) { var a = nav.heading * Math.PI / 180, rx = dx * Math.cos(a) - dy * Math.sin(a), ry = dx * Math.sin(a) + dy * Math.cos(a); dx = rx; dy = ry; nav.freeUntil = Date.now() + 8000; }
    pdx += dx; pdy += dy;
    if (!panRaf) panRaf = requestAnimationFrame(function () {
      panRaf = 0; var m = A.map, off = L.point(pdx, pdy); pdx = pdy = 0;
      A.setFollow(false);
      if (m._rawPanBy) { m._rawPanBy(off); m.fire('move'); } else m.panBy(off, { animate: false }); // un seul redessin complet, à la fin du geste
      clearTimeout(panEnd); panEnd = setTimeout(function () { m.fire('moveend'); }, 120);
    });
  }
  function scroller() {
    var fs = document.querySelector('#fillSheet:not([hidden]) .fs-card'); if (fs) return fs;
    return panelStep() && listEl && listEl.scrollHeight > listEl.clientHeight + 4 ? listEl : null;
  }
  function scroll(dx, dy) { if (!gesture()) return; var e = scroller(); if (e) e.scrollTop += dy; else panMap(dx, dy); }
  function fling(vx, vy) { if (!gesture()) return; var e = scroller(); if (e) e.scrollBy({ top: -vy / 4, behavior: 'smooth' }); else panMap(-vx / 8, -vy / 8); }
  // Pincer continu, comme le pincer tactile de Leaflet : la carte suit le doigt image par image (map._move « pinch »),
  // puis se cale au quart de niveau à la fin du geste. Le point sous les doigts reste en place.
  var pz = null, pzRaf = 0, pzEnd = null;
  function zoom(scale, x, y) {
    if (!(scale > 0) || !gesture()) return;
    var m = A.map;
    if (!pz) {
      var dpr = window.devicePixelRatio || 1, r = m.getContainer().getBoundingClientRect();
      var p = nav.on || x == null ? m.getSize().divideBy(2) : L.point(x / dpr - r.left, y / dpr - r.top); // carte tournée : on zoome autour du centre
      pz = { z: m.getZoom(), p: p, ll: m.containerPointToLatLng(p) };
      A.setFollow(false); if (m._stop) m._stop(); m._moveStart(true, false);
    }
    if (nav.on) nav.freeUntil = Date.now() + 8000;
    pz.z = Math.max(m.getMinZoom(), Math.min(m.getMaxZoom(), pz.z + Math.log(scale) / Math.LN2));
    if (!pzRaf) pzRaf = requestAnimationFrame(function () {
      pzRaf = 0; if (!pz) return;
      var c = m.unproject(m.project(pz.ll, pz.z).subtract(pz.p.subtract(m.getSize().divideBy(2))), pz.z);
      m._move(c, pz.z, { pinch: true, round: false });
    });
    clearTimeout(pzEnd); pzEnd = setTimeout(endPinch, 220);
  }
  function endPinch() { if (!pz) return; var m = A.map, z = pz.z; pz = null; cancelAnimationFrame(pzRaf); pzRaf = 0; m._resetView(m.getCenter(), m._limitZoom(z)); } // comme la fin d'un pincer Leaflet
  function zoomBy(d) { var m = A.map; if (nav.on) nav.freeUntil = Date.now() + 8000; A.setFollow(false); m.setZoom(Math.round(m.getZoom()) + d); }

  // ---- la commune où l'on est (en haut à gauche de la carte) : pour se repérer d'un coup d'œil. Demandée au service d'adresses
  // tous les ~600 m (Géoplateforme IGN, puis l'ancienne API Adresse, puis Photon hors de France).
  var town = { name: '', at: null, t: 0, busy: false };
  function updateTown() {
    var f = A.fix; if (!f || town.busy) return;
    if (town.at && A.haversine(f.lat, f.lon, town.at.lat, town.at.lon) < 0.6 && Date.now() - town.t < 300000) return;
    town.busy = true; town.at = { lat: f.lat, lon: f.lon }; town.t = Date.now();
    var q = '?lon=' + f.lon.toFixed(5) + '&lat=' + f.lat.toFixed(5) + '&limit=1';
    var fr = function (base) { return fetch(base + q).then(function (r) { return r.json(); }).then(function (j) { var p = j.features && j.features[0] && j.features[0].properties; if (!p || !p.city) throw new Error('vide'); return p.city; }); };
    fr('https://data.geopf.fr/geocodage/reverse').catch(function () { return fr('https://api-adresse.data.gouv.fr/reverse/'); })
      .catch(function () { return fetch('https://photon.komoot.io/reverse' + q + '&lang=fr').then(function (r) { return r.json(); }).then(function (j) { var p = j.features && j.features[0] && j.features[0].properties; return p ? p.city || p.town || p.village || p.name || '' : ''; }); })
      .then(function (n) { if (n && n !== town.name) { town.name = n; log('voiture : commune ' + n); render(); } }, function () { })
      .then(function () { town.busy = false; });
  }
  function viewSize() { // « ↔ 25 km · ↕ 15 km » : ce que couvre la carte affichée
    var b = A.map.getBounds(), c = b.getCenter(), w = A.haversine(c.lat, b.getWest(), c.lat, b.getEast()), h = A.haversine(b.getNorth(), c.lng, b.getSouth(), c.lng);
    var f = function (d) { return d < 10 ? A.num(d, 1) : A.num(d, 0); };
    return '↔ ' + f(w) + ' km · ↕ ' + f(h) + ' km';
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(render, 150); }
  function start() {
    if (!ready()) { setTimeout(start, 200); return; }
    var m = A.map, root = document.documentElement;
    root.setAttribute('data-carui', '');
    m.options.zoomSnap = 0.25; // pincer : on garde le niveau choisi au quart près au lieu de sauter d'un niveau entier
    pane.hidden = false; rail.hidden = false;
    // Espace vide au démarrage : la page naît parfois avant que l'écran virtuel ait sa taille définitive, et la carte garde
    // l'ancienne taille. On la recale dès que son cadre change, quelle qu'en soit la cause.
    var sizes = 0;
    try { new ResizeObserver(function () { var c = m.getContainer(); if (sizes++ < 6) log('voiture : cadre carte ' + c.clientWidth + '×' + c.clientHeight + ' (fenêtre ' + innerWidth + '×' + innerHeight + ')'); m.invalidateSize({ animate: false }); if (nav.on) navGeometry(); }).observe(m.getContainer()); } catch (e) { }
    var centered = false, center = function () { // au premier point GPS : la carte sur la voiture
      if (centered) return; var f = A.fix;
      if (f) { centered = true; m.setView(shifted([f.lat, f.lon], 13), 13); }
    };
    center();
    document.addEventListener('fuelmap:stations', function () { schedule(); if (wantRoute && !computing && !routeReady && !routeErr) compute(); });
    document.addEventListener('fuelmap:fix', function () {
      lastFixAt = Date.now(); if (guide) guide.drLogged = 0;
      center(); resumeGuide(); updateGuide(); updateTown();
      if (wantRoute && !computing && !routeReady && !routeErr) compute();
      else if (step === 'list' && (!listEl || listEl.scrollTop < 10)) schedule();
    });
    document.addEventListener('fuelmap:route', function (e) {
      if (computing) {
        computing = false; routeErr = e.detail && e.detail.error || null; routeReady = !routeErr; wantRoute = false; selected = null; render();
        var R = A.route; if (routeReady && R && R.bounds && !guide) A.map.fitBounds(R.bounds, { paddingTopLeft: [pane.getBoundingClientRect().right - m.getContainer().getBoundingClientRect().left + 30, 70], paddingBottomRight: [40, 30] }); // le trajet à droite de la carte flottante
      }
      schedule();
    });
    m.on('moveend', function () { if (mode === 'map' && (step === 'map' || step === 'list')) schedule(); });
    window.addEventListener('resize', schedule);
    document.addEventListener('fuelmap:state', schedule); // réglages changés sur le téléphone (véhicule, couleur, thème…)
    document.addEventListener('fuelmap:insets', function () { if (nav.on) navGeometry(); }); // l'hôte déplace sa zone libre (début / fin du guidage) sans redimensionner la page
    setInterval(render, 60000); // les âges « il y a x h » vieillissent
    setTimeout(function () { if (!A.fix) render(); }, 12500);
    // trajet préparé sur le téléphone il y a peu : on le propose d'office, en commençant par le niveau du réservoir
    var lr = A.state.lastRoute;
    if (restoreSession()) { if (wantRoute) compute(); }
    else if (lr && lr.to && Date.now() - lr.ts < 3 * 3600 * 1000) { dest = { label: lr.to.label, lat: +lr.to.lat, lon: +lr.to.lon }; mode = 'route'; step = 'fuel'; }
    render(); resumeGuide();
  }
  start();
  function state() { return { mode: mode, step: step, guide: guide ? guide.wps.map(function (w) { return (w.done ? '✓' : '') + w.plain; }).join(' › ') : null, nav: nav.on ? Math.round(nav.heading) + '°' : null, dest: dest, selected: selected ? { id: selected.id, ville: selected.ville } : null, computing: computing, routeReady: routeReady, routeErr: routeErr, sortAsc: sortAsc, lastX: lastX, locked: locked(), listScroll: listEl ? listEl.scrollTop : null, rows: pane.querySelectorAll('.crow').length, zoom: A ? A.map.getZoom() : null, size: innerWidth + '×' + innerHeight }; }
  function dump() { try { log('écran voiture : ' + JSON.stringify(state()) + ' | carte zoom ' + A.map.getZoom() + ' centre ' + JSON.stringify(A.map.getCenter()) + ' taille ' + JSON.stringify(A.map.getSize()) + ' | GPS ' + JSON.stringify(A.fix)); } catch (e) { } }
  function goTarget() { // bouton « Y aller » de l'hôte : suit l'étape en cours
    if (mode === 'route' && dest && step !== 'guide') { goTrip(); return true; }
    if (selected) { go([wpOf(selected)]); return true; }
    if (dest) { goTrip(); return true; }
    A.toast('Choisis une station ou un trajet d\'abord'); return false;
  }
  function target() { // ce que « Y aller » doit viser : la station choisie, sinon la destination du trajet
    if (selected) { var k = A.pick(selected, A.fuelsFor(A.car().fuel)); return { lat: selected.lat, lon: selected.lon, label: plainName(selected) + (k >= 0 ? ' · ' + A.price3(selected.p[k]) + ' €' : '') }; }
    if (dest) return { lat: dest.lat, lon: dest.lon, label: short(dest.label) };
    return null;
  }
  function addNote(text) { // note dictée (bouton 📝 de l'hôte) : heure, position, commune
    if (!ready() || !A.addNote(text, town.name)) return;
    log('voiture : note dictée (' + String(text).length + ' caractères)'); A.toast('📝 Note enregistrée'); render();
  }
  window.__fuelmapCar = { render: render, select: select, pick: pick, setDest: setDest, scroll: scroll, fling: fling, zoom: zoom, state: state, dump: dump, setStep: setStep, target: target, go: goTarget, goTo: function (lat, lon, label) { go([{ lat: +lat, lon: +lon, s: null, stop: false, plain: label || 'Destination', price: '' }]); }, recenter: recenter, stopGuide: stopGuide, skipStop: skipStop, addNote: addNote, lockTest: function (on) { lock.test = !!on; }, __pts: function () { return guide && guide.pts; } };
})();
