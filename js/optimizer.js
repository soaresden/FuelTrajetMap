/*
 * FuelMap — optimiseur de pleins sur un trajet.
 *
 * Problème : un trajet de longueur D, des stations à la position `pos` (km depuis le
 * départ) avec un détour aller-retour `detourKm` et un prix au litre. On cherche OÙ
 * s'arrêter et COMBIEN de litres prendre à chaque arrêt pour minimiser la dépense,
 * sans jamais descendre sous la réserve et en arrivant avec le niveau demandé.
 *
 * Méthode : programmation dynamique exacte sur le « gas station problem »
 * (Khuller, Malekian, Mestre). Propriété utilisée : dans une solution optimale, à
 * chaque arrêt soit on prend juste de quoi atteindre le prochain arrêt (s'il est moins
 * cher, ou si c'est l'arrivée), soit on fait le plein complet (si le prochain est plus
 * cher). Les états sont (station, carburant à l'arrivée).
 *
 * Module sans dépendance, utilisable dans le navigateur (window.FuelOptimizer) et
 * sous Node (tests).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FuelOptimizer = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EPS = 1e-6;

  function normalize(input) {
    var tank = +input.tankL;
    var cons = +input.consumption;
    if (!(tank > 0) || !(cons > 0)) throw new Error('Réservoir et consommation doivent être > 0');
    var reserve = Math.max(0, Math.min(+input.reserveL || 0, tank * 0.5));
    var startFuel = Math.max(0, Math.min(input.startFuelL == null ? tank : +input.startFuelL, tank));
    var arrival = Math.max(reserve, Math.min(input.arrivalFuelL == null ? reserve : +input.arrivalFuelL, tank));
    var stations = (input.stations || [])
      .filter(function (s) { return s.price > 0 && s.pos >= 0 && s.pos <= input.distanceKm; })
      .map(function (s) { return { ref: s, pos: +s.pos, det: Math.max(0, +s.detourKm || 0), price: +s.price }; })
      .sort(function (a, b) { return a.pos - b.pos; });
    return {
      D: +input.distanceKm,
      U: tank - reserve,                       // capacité utile (au-dessus de la réserve)
      f0: Math.max(0, startFuel - reserve),    // carburant utile au départ
      target: arrival - reserve,               // carburant utile voulu à l'arrivée
      lpk: cons / 100,                         // litres par km
      stopCost: Math.max(0, +input.stopCost || 0),
      detourFee: Math.max(0, +input.detourCostPerKm || 0), // « prix » du temps perdu par km de détour
      reserve: reserve,
      tank: tank,
      stations: stations
    };
  }

  /** Optimum exact. */
  function optimize(input) {
    var P = normalize(input);
    var n = P.stations.length;
    var DEST = n + 1;
    // noeuds : 0 = départ, 1..n = stations, n+1 = arrivée
    var pos = [0], det = [0], price = [0];
    P.stations.forEach(function (s) { pos.push(s.pos); det.push(s.det); price.push(s.price); });
    pos.push(P.D); det.push(0); price.push(-1);

    var states = []; // states[node] = Map(key -> state)
    for (var i = 0; i <= DEST; i++) states.push(new Map());
    states[0].set(0, { node: 0, f: P.f0, cost: 0, prev: null, buy: 0 });

    function push(j, f, cost, prev, buy) {
      if (f < 0) f = 0;
      var key = Math.round(f * 20);
      var cur = states[j].get(key);
      if (!cur || cost < cur.cost - EPS) states[j].set(key, { node: j, f: f, cost: cost, prev: prev, buy: buy });
    }

    var farthest = P.f0 / P.lpk; // pour le diagnostic en cas d'échec
    for (i = 0; i <= n; i++) {
      if (!states[i].size) continue;
      // élagage des états dominés (moins de carburant ET plus cher)
      var list = Array.from(states[i].values()).sort(function (a, b) { return b.f - a.f || a.cost - b.cost; });
      var best = Infinity, kept = [];
      for (var k = 0; k < list.length; k++) {
        if (list[k].cost < best - EPS) { kept.push(list[k]); best = list[k].cost; }
      }
      if (i > 0) farthest = Math.max(farthest, pos[i] + (P.U / P.lpk));

      for (var j = i + 1; j <= DEST; j++) {
        var along = pos[j] - pos[i];
        if (along <= EPS && j !== DEST) continue;
        if (along * P.lpk > P.U + EPS) break; // hors d'atteinte même plein, et les suivants aussi
        var need = (along + (det[i] + det[j]) / 2) * P.lpk;
        var req = need + (j === DEST ? P.target : 0);
        var stopFee = j === DEST ? 0 : P.stopCost + det[j] * P.detourFee;
        for (k = 0; k < kept.length; k++) {
          var st = kept[k];
          if (i === 0) {
            // départ : pas d'achat possible
            if (req <= st.f + EPS) push(j, st.f - need, st.cost + stopFee, st, 0);
            continue;
          }
          if (req > P.U + EPS) continue;
          var buy;
          if (j === DEST || price[j] < price[i]) buy = Math.max(0, req - st.f);
          else buy = P.U - st.f;
          if (buy < 0) buy = 0;
          push(j, st.f + buy - need, st.cost + buy * price[i] + stopFee, st, buy);
        }
      }
    }

    var end = null;
    states[DEST].forEach(function (s) { if (!end || s.cost < end.cost) end = s; });
    if (!end) {
      return { feasible: false, reachedKm: Math.min(P.D, farthest), stops: [], fuelCost: 0, stopCount: 0 };
    }

    // reconstruction : `buy` porté par un état = litres achetés au noeud précédent
    var chain = [];
    for (var s = end; s; s = s.prev) chain.push(s);
    chain.reverse();
    var stops = [], fuelCost = 0;
    for (k = 1; k < chain.length; k++) {
      var at = chain[k - 1];
      var bought = chain[k].buy;
      if (at.node === 0 || bought < 0.05) continue;
      var stn = P.stations[at.node - 1];
      fuelCost += bought * stn.price;
      stops.push({
        station: stn.ref, pos: stn.pos, detourKm: stn.det, price: stn.price,
        arriveL: at.f + P.reserve, buyL: bought, departL: at.f + bought + P.reserve,
        cost: bought * stn.price, full: at.f + bought >= P.U - 0.05
      });
    }
    return {
      feasible: true, stops: stops, stopCount: stops.length, fuelCost: fuelCost,
      arrivalL: end.f + P.reserve,
      litersBought: stops.reduce(function (a, s) { return a + s.buyL; }, 0)
    };
  }

  /**
   * Stratégie « naïve » de comparaison : on roule, et quand le niveau passe sous
   * `triggerRatio` du réservoir on fait le plein complet à la première station
   * quasiment sur la route. Le carburant restant au-delà du niveau d'arrivée voulu est
   * déduit au dernier prix payé, pour comparer à dépense équivalente.
   */
  function baseline(input, opts) {
    var P = normalize(input);
    var triggerRatio = (opts && opts.triggerRatio) || 0.25;
    var onRouteKm = (opts && opts.onRouteKm) || 1.0;
    var cur = 0, f = P.f0, spent = 0, lastPrice = 0, stops = [], guard = 0;
    while (guard++ < 200) {
      var toEnd = (P.D - cur) * P.lpk + P.target;
      if (toEnd <= f + EPS) { f -= (P.D - cur) * P.lpk; break; }
      var triggerF = Math.max(0, P.tank * triggerRatio - P.reserve);
      var triggerPos = cur + Math.max(0, (f - triggerF)) / P.lpk;
      var win = P.stations.filter(function (s) {
        return s.pos > cur + EPS && ((s.pos - cur) + s.det / 2) * P.lpk <= f + EPS;
      });
      if (!win.length) return { feasible: false };
      var after = win.filter(function (s) { return s.pos >= triggerPos; });
      var pick;
      if (after.length) {
        pick = after.filter(function (s) { return s.det <= onRouteKm; })[0] ||
          after.slice().sort(function (a, b) { return a.det - b.det; })[0];
      } else pick = win[win.length - 1];
      f -= ((pick.pos - cur) + pick.det / 2) * P.lpk;
      var buy = P.U - f;
      spent += buy * pick.price; lastPrice = pick.price;
      stops.push({ station: pick.ref, pos: pick.pos, buyL: buy, price: pick.price, cost: buy * pick.price });
      f = P.U - (pick.det / 2) * P.lpk;
      cur = pick.pos;
    }
    var excess = Math.max(0, f - P.target);
    return { feasible: true, stops: stops, rawCost: spent, fuelCost: Math.max(0, spent - excess * lastPrice), stopCount: stops.length };
  }

  /**
   * Évalue une suite d'arrêts IMPOSÉE (choisie par l'utilisateur) : quantités optimales pour cette suite.
   * Règle exacte pour un parcours fixé : à chaque arrêt, viser le prochain arrêt moins cher (ou l'arrivée) ;
   * s'il est hors de portée d'un plein, faire le plein.
   */
  function evaluate(input, chosen) {
    var P = normalize(Object.assign({}, input, { stations: chosen })), st = P.stations, n = st.length;
    function leg(i, j) { // besoin en litres de l'arrêt i (−1 = départ) à l'arrêt j (n = arrivée)
      var a = i < 0 ? { pos: 0, det: 0 } : st[i], b = j >= n ? { pos: P.D, det: 0 } : st[j];
      return (b.pos - a.pos + (a.det + b.det) / 2) * P.lpk;
    }
    var f = P.f0, stops = [], fuelCost = 0;
    for (var i = 0; i < n; i++) {
      f -= leg(i - 1, i);
      if (f < -1e-4) return { feasible: false, failIndex: i, shortL: -f, stops: stops };
      if (f < 0) f = 0;
      var j = i + 1, need = leg(i, j);
      while (j < n && st[j].price >= st[i].price) { j++; need += leg(j - 1, j); }
      if (j >= n) need += P.target;
      var buy = Math.max(0, Math.min(need - f, P.U - f));
      fuelCost += buy * st[i].price;
      stops.push({ station: st[i].ref, pos: st[i].pos, detourKm: st[i].det, price: st[i].price, arriveL: f + P.reserve, buyL: buy, departL: f + buy + P.reserve, cost: buy * st[i].price, full: f + buy >= P.U - 0.05 });
      f += buy;
    }
    f -= leg(n - 1, n);
    if (f < P.target - 1e-4) return { feasible: false, failIndex: n, shortL: P.target - f, stops: stops };
    return { feasible: true, stops: stops, stopCount: n, fuelCost: fuelCost, arrivalL: f + P.reserve, litersBought: stops.reduce(function (a, s) { return a + s.buyL; }, 0) };
  }

  /** Réduit le nombre de candidats sans perdre les bonnes affaires : les `perBucket` moins chers par tronçon. */
  function thin(stations, distanceKm, maxCount, perBucket) {
    maxCount = maxCount || 240; perBucket = perBucket || 3;
    if (stations.length <= maxCount) return stations;
    var buckets = Math.max(1, Math.floor(maxCount / perBucket));
    var size = distanceKm / buckets, groups = {};
    stations.forEach(function (s) {
      var b = Math.min(buckets - 1, Math.floor(s.pos / size));
      (groups[b] = groups[b] || []).push(s);
    });
    var out = [];
    Object.keys(groups).forEach(function (b) {
      groups[b].sort(function (a, c) { return a.price - c.price || a.detourKm - c.detourKm; });
      out = out.concat(groups[b].slice(0, perBucket));
    });
    return out;
  }

  return { optimize: optimize, evaluate: evaluate, baseline: baseline, thin: thin };
});
