/* FuelMap — vitesse, limitation de la route et zones de danger (radars), pour l'écran de la voiture.
 *
 * Limitation : la voie OpenStreetMap la plus proche dans le sens de la marche, demandée au serveur Valhalla de FOSSGIS (/locate,
 * gratuit, sans clé, ~0,1 s). On garde la forme de la voie : tant que la voiture reste dessus, pas de nouvelle requête.
 * Rien n'est inventé : sans limitation dans OpenStreetMap, rien n'est affiché.
 *
 * Radars : data/radars.json (carte officielle radars.securite-routiere.gouv.fr, refaite par la GitHub Action).
 * En France, signaler l'emplacement d'un radar est interdit depuis 2012 : comme Waze ou Coyote, on n'annonce que des « zones de
 * danger » qui contiennent le radar quelque part (pas forcément au milieu) — 300 m en ville, 2 km sur route, 4 km sur autoroute.
 * Sur l'itinéraire du guidage, la zone clignote sur la route en rouge et bleu (gyrophare) ; hors guidage, seul le bandeau la signale.
 * Annonce : « Zone de radar » (choix de Denis).
 */
(function () {
  'use strict';
  var VALHALLA = 'https://valhalla1.openstreetmap.de/locate';
  var KM_LAT = 111.32, toR = Math.PI / 180;
  function log(m) { try { window.FM && window.FM.log(m); } catch (e) { } }

  // ---- radars : chargés une fois, rangés dans une grille de 0,05° (≈ 5 km) pour ne regarder que ceux du coin
  var radars = null, grid = null, loading = null;
  function load() {
    if (radars || loading) return loading || Promise.resolve(radars);
    var bases = [(window.FUELMAP_CONFIG || {}).dataBase, ''].filter(function (b, i) { return b || i === 1; });
    var tryBase = function (i) { return fetch(bases[i] + 'data/radars.json').then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).catch(function (e) { if (i + 1 < bases.length) return tryBase(i + 1); throw e; }); };
    loading = tryBase(0).then(function (j) {
      radars = j.r || []; grid = new Map();
      radars.forEach(function (r, i) { var k = cell(r[0], r[1]), c = grid.get(k); if (!c) grid.set(k, c = []); c.push(i); });
      log('zones de danger : ' + radars.length + ' radars chargés'); return radars;
    }).catch(function (e) { loading = null; log('zones de danger : radars indisponibles (' + e.message + ')'); return null; });
    return loading;
  }
  function cell(lat, lon) { return Math.floor(lat * 20) * 100000 + Math.floor((lon + 20) * 20); }
  function near(lat, lon, km) { // indices des radars dans un carré de ±km autour du point
    if (!grid) return [];
    var out = [], dLat = km / KM_LAT, dLon = km / (KM_LAT * Math.cos(lat * toR));
    for (var y = Math.floor((lat - dLat) * 20); y <= Math.floor((lat + dLat) * 20); y++)
      for (var x = Math.floor((lon - dLon + 20) * 20); x <= Math.floor((lon + dLon + 20) * 20); x++) { var c = grid.get(y * 100000 + x); if (c) out.push.apply(out, c); }
    return out;
  }
  // Où se trouve le radar dans sa zone : une fraction fixe pour chaque radar (entre la moitié et 90 % de la zone), pour que
  // l'alerte arrive bien avant lui sans dire où il est.
  function frac(r) { var h = Math.abs(Math.sin(r[0] * 12.9898 + r[1] * 78.233) * 43758.5453); return 0.5 + 0.4 * (h - Math.floor(h)); }
  // Longueur de la zone : 4 km sur autoroute, 300 m en ville (radar feu rouge ou urbain, ou route à 50 et moins), sinon 2 km.
  function zoneLen(type, motorway, kmh) { if (motorway) return 4000; if (type === 2 || type === 6) return 300; if (kmh && kmh <= 50) return 300; return 2000; }

  // ---- zones sur l'itinéraire : pts [[lat,lon]], cum (km le long de l'itinéraire), seg(i) → { kmh, motorway } du tronçon i
  function routeZones(pts, cum, seg) {
    if (!radars || !pts || pts.length < 2) return [];
    var best = new Map(), M = 0.035; // à moins de 35 m de la route (les deux sens d'une 2×2 voies sont à 20-40 m l'un de l'autre)
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1], kmLon = KM_LAT * Math.cos(a[0] * toR);
      var bx = (b[1] - a[1]) * kmLon, by = (b[0] - a[0]) * KM_LAT, L2 = bx * bx + by * by;
      var cand = near((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.sqrt(L2) / 2 + M);
      for (var k = 0; k < cand.length; k++) {
        var r = radars[cand[k]], x = (r[1] - a[1]) * kmLon, y = (r[0] - a[0]) * KM_LAT;
        var t = L2 > 0 ? Math.max(0, Math.min(1, (x * bx + y * by) / L2)) : 0, dx = x - t * bx, dy = y - t * by, d = Math.sqrt(dx * dx + dy * dy);
        if (d > M) continue;
        var o = best.get(cand[k]); if (!o || d < o.d) best.set(cand[k], { d: d, at: (cum[i] + t * (cum[i + 1] - cum[i])) * 1000, i: i });
      }
    }
    var D = cum[cum.length - 1] * 1000, zones = [];
    best.forEach(function (o, id) {
      var r = radars[id], s = seg(o.i) || {}, L = zoneLen(r[2], s.motorway, s.kmh), f = frac(r);
      zones.push({ a: Math.max(0, o.at - f * L), b: Math.min(D, o.at + (1 - f) * L) });
    });
    zones.sort(function (p, q) { return p.a - q.a; });
    var merged = []; // zones qui se touchent → une seule
    zones.forEach(function (z) { var l = merged[merged.length - 1]; if (l && z.a <= l.b + 100) l.b = Math.max(l.b, z.b); else merged.push({ a: z.a, b: z.b }); });
    return merged;
  }
  // morceau de l'itinéraire entre deux distances (m), pour le peindre
  function slice(pts, cum, a, b) {
    var out = [], am = a / 1000, bm = b / 1000;
    function at(i, v) { var u = cum[i + 1] > cum[i] ? (v - cum[i]) / (cum[i + 1] - cum[i]) : 0; return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u]; }
    for (var i = 0; i < pts.length - 1; i++) {
      if (cum[i + 1] < am) continue; if (cum[i] > bm) break;
      if (!out.length) out.push(cum[i] < am ? at(i, am) : pts[i]);
      if (cum[i + 1] > bm) { out.push(at(i, bm)); break; }
      out.push(pts[i + 1]);
    }
    return out;
  }
  // façon gyrophare : toute la zone passe du rouge au bleu et inversement, deux fois par seconde (liseré sombre dessous, pour la voir
  // sur tous les fonds de carte)
  var lit = [], blinkOn = false, blinkT = 0;
  function paint(layer, pts, cum, zones) {
    zones.forEach(function (z) {
      var p = slice(pts, cum, z.a, z.b); if (p.length < 2) return;
      layer.addLayer(L.polyline(p, { color: '#0b0f1a', weight: 14, opacity: .6, lineCap: 'butt', interactive: false }));
      var l = L.polyline(p, { color: '#e3262f', weight: 10, opacity: 1, lineCap: 'butt', interactive: false }); layer.addLayer(l); lit.push(l);
    });
    if (lit.length && !blinkT) blinkT = setInterval(function () {
      lit = lit.filter(function (l) { return !!l._map; }); // zones d'un guidage terminé : oubliées
      if (!lit.length) { clearInterval(blinkT); blinkT = 0; return; }
      blinkOn = !blinkOn; lit.forEach(function (l) { l.setStyle({ color: blinkOn ? '#1e5bff' : '#e3262f' }); });
    }, 500);
  }

  // ---- hors guidage : un radar devant soi (cône de ±25° autour du cap, à moins de 80 m de côté), dans la longueur de sa zone
  function freeZone(f, heading, motorway, kmhLimit) {
    if (!radars || !f || heading == null) return null;
    var cand = near(f.lat, f.lon, 4.2), kmLon = KM_LAT * Math.cos(f.lat * toR), best = null;
    for (var k = 0; k < cand.length; k++) {
      var r = radars[cand[k]], x = (r[1] - f.lon) * kmLon, y = (r[0] - f.lat) * KM_LAT, d = Math.sqrt(x * x + y * y) * 1000;
      var L = zoneLen(r[2], motorway, kmhLimit), fr = frac(r), brg = Math.atan2(x, y) / toR, diff = Math.abs(((brg - heading) % 360 + 540) % 360 - 180);
      var ahead = diff < 25 && d * Math.sin(diff * toR) < 80 && d <= fr * L, behind = diff > 155 && d <= (1 - fr) * L;
      if ((ahead || behind) && (!best || d < best.d)) best = { id: cand[k], d: d, left: ahead ? d + (1 - fr) * L : (1 - fr) * L - d };
    }
    return best;
  }

  // ---- limitation de vitesse de la voie où l'on roule
  var lim = { value: null, motorway: false, name: '', shape: null, at: 0, busy: false, fails: 0 };
  function decode6(str) {
    var i = 0, lat = 0, lon = 0, out = [];
    while (i < str.length) {
      var b, sh = 0, res = 0; do { b = str.charCodeAt(i++) - 63; res |= (b & 31) << sh; sh += 5; } while (b >= 32); lat += res & 1 ? ~(res >> 1) : res >> 1;
      sh = 0; res = 0; do { b = str.charCodeAt(i++) - 63; res |= (b & 31) << sh; sh += 5; } while (b >= 32); lon += res & 1 ? ~(res >> 1) : res >> 1;
      out.push([lat / 1e6, lon / 1e6]);
    }
    return out;
  }
  function offShape(f, P) { // distance (m) de la voiture à la voie mémorisée
    if (!P || P.length < 2) return Infinity;
    var kmLon = KM_LAT * Math.cos(f.lat * toR), best = Infinity;
    for (var i = 0; i < P.length - 1; i++) {
      var ax = (P[i][1] - f.lon) * kmLon, ay = (P[i][0] - f.lat) * KM_LAT, bx = (P[i + 1][1] - f.lon) * kmLon, by = (P[i + 1][0] - f.lat) * KM_LAT;
      var vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy, t = L2 > 0 ? Math.max(0, Math.min(1, -(ax * vx + ay * vy) / L2)) : 0;
      var dx = ax + t * vx, dy = ay + t * vy; best = Math.min(best, Math.sqrt(dx * dx + dy * dy) * 1000);
    }
    return best;
  }
  function limitFor(f, heading) {
    if (!f) return lim;
    var now = Date.now(), on = offShape(f, lim.shape) < 22;
    if (!on && lim.shape && now - lim.at > 12000) { lim.value = null; lim.tunnel = false; } // sortie de la voie connue et pas de réponse depuis : on n'affiche rien plutôt qu'une limite fausse
    var wait = lim.fails ? Math.min(60000, 5000 * lim.fails) : 3000;
    if (!lim.busy && (!on || now - lim.at > 90000) && now - lim.at > wait) query(f, heading);
    return lim;
  }
  function query(f, heading) {
    lim.busy = true; lim.at = Date.now();
    var loc = { lat: +f.lat.toFixed(6), lon: +f.lon.toFixed(6), radius: 30 };
    if (heading != null && !isNaN(heading)) { loc.heading = Math.round((heading + 360) % 360); loc.heading_tolerance = 50; }
    var ctl = window.AbortController ? new AbortController() : null, to = ctl ? setTimeout(function () { ctl.abort(); }, 6000) : 0;
    fetch(VALHALLA, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locations: [loc], costing: 'auto', verbose: true }), signal: ctl ? ctl.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        clearTimeout(to); lim.busy = false; lim.fails = 0;
        var es = (j && j[0] && j[0].edges) || [];
        if (heading != null) es.sort(function (p, q) { return angle(p.heading, heading) - angle(q.heading, heading); });
        var e = es[0]; if (!e) { lim.shape = null; lim.value = null; return; }
        var info = e.edge_info || {}, v = +info.speed_limit, cls = (e.edge && e.edge.classification && e.edge.classification.classification) || '';
        lim.value = v > 0 && v < 200 ? v : null; lim.motorway = cls === 'motorway'; lim.tunnel = !!(e.edge && e.edge.tunnel); lim.name = (info.names || [])[0] || '';
        lim.shape = info.shape ? decode6(info.shape) : null; lim.at = Date.now();
      })
      .catch(function (err) { clearTimeout(to); lim.busy = false; lim.fails++; if (lim.fails === 1 || lim.fails % 10 === 0) log('limitation : serveur indisponible (' + (err.name === 'AbortError' ? 'trop lent' : err.message) + ')'); });
  }
  function angle(a, b) { if (a == null) return 180; return Math.abs(((a - b) % 360 + 540) % 360 - 180); }

  window.FuelSafety = { load: load, routeZones: routeZones, paint: paint, freeZone: freeZone, limitFor: limitFor, ready: function () { return !!radars; } };
})();
