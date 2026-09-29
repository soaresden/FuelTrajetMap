// node tests/optimizer.test.js — compare l'optimiseur à une recherche exhaustive sur des cas aléatoires.
const { optimize, baseline, evaluate } = require('../js/optimizer.js');

function brute(input) {
  // Données entières, consommation 100 L/100 km => 1 L/km : tous les niveaux sont entiers.
  const R = input.reserveL, U = input.tankL - R, f0 = Math.max(0, input.startFuelL - R), target = Math.max(R, input.arrivalFuelL) - R;
  const st = input.stations.slice().sort((a, b) => a.pos - b.pos);
  const n = st.length, DEST = n + 1;
  const pos = [0, ...st.map(s => s.pos), input.distanceKm];
  const det = [0, ...st.map(s => s.detourKm), 0];
  const price = [0, ...st.map(s => s.price), 0];
  const best = Array.from({ length: DEST + 1 }, () => new Array(U + 1).fill(Infinity));
  best[0][f0] = 0;
  for (let i = 0; i <= n; i++) for (let f = 0; f <= U; f++) {
    const c = best[i][f]; if (c === Infinity) continue;
    for (let j = i + 1; j <= DEST; j++) {
      if (pos[j] - pos[i] <= 0 && j !== DEST) continue;
      const need = pos[j] - pos[i] + (det[i] + det[j]) / 2;
      const fee = j === DEST ? 0 : input.stopCost + det[j] * (input.detourCostPerKm || 0);
      const maxBuy = i === 0 ? 0 : U - f;
      for (let b = 0; b <= maxBuy; b++) {
        const nf = f + b - need; if (nf < 0) continue;
        if (j === DEST && nf < target) continue;
        const nc = c + b * price[i] + fee;
        if (nc < best[j][nf]) best[j][nf] = nc;
      }
    }
  }
  return Math.min(...best[DEST]);
}

let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));

let evalChecked = 0, checked = 0, infeasible = 0, worst = 0, naiveWins = 0;
for (let t = 0; t < 4000; t++) {
  const tank = ri(25, 60), reserve = ri(0, 4), D = ri(20, 160), n = ri(0, 10);
  const input = {
    distanceKm: D, tankL: tank, consumption: 100, reserveL: reserve,
    startFuelL: ri(reserve, tank), arrivalFuelL: ri(0, Math.floor(tank / 2)),
    stopCost: [0, 0, 1, 3][ri(0, 3)], detourCostPerKm: [0, 0.25][ri(0, 1)],
    stations: Array.from({ length: n }, (_, k) => ({ id: k, pos: ri(1, D - 1), detourKm: 2 * ri(0, 3), price: ri(80, 250) / 100 }))
  };
  const b = brute(input), o = optimize(input);
  if (b === Infinity) {
    infeasible++;
    if (o.feasible) { console.error('FAUX POSITIF', JSON.stringify(input)); process.exit(1); }
    continue;
  }
  if (!o.feasible) { console.error('FAUX NÉGATIF', JSON.stringify(input), b); process.exit(1); }
  const fees = list => list.reduce((a, x) => a + input.stopCost + x.detourKm * input.detourCostPerKm, 0);
  const total = o.fuelCost + fees(o.stops);
  // l'optimiseur retire les arrêts à 0 L : il peut donc être légèrement MEILLEUR que la référence, jamais pire
  if (total > b + 1e-6) { console.error('SOUS-OPTIMAL', total, b, JSON.stringify(input), JSON.stringify(o.stops)); process.exit(1); }
  worst = Math.max(worst, b - total);
  // cohérence de la simulation : jamais sous la réserve, jamais au-dessus du réservoir
  for (const s of o.stops) {
    if (s.arriveL < reserve - 1e-6 || s.departL > tank + 1e-6) { console.error('NIVEAU INVALIDE', s, JSON.stringify(input)); process.exit(1); }
  }
  // la stratégie naïve (pleins complets) ne doit jamais acheter moins cher que l'optimum à carburant équivalent
  const bl = baseline(input);
  if (bl.feasible && input.stopCost === 0 && !input.detourCostPerKm && bl.fuelCost < o.fuelCost - 1e-6) naiveWins++;
  // evaluate() sur les arrêts de l'optimum doit redonner le même coût ; sur une suite quelconque, jamais moins cher que l'optimum
  const ev = evaluate(input, o.stops.map(x => x.station));
  if (!ev.feasible || Math.abs(ev.fuelCost - o.fuelCost) > 1e-6) { console.error('EVALUATE ≠ OPTIMUM', ev, o.fuelCost, JSON.stringify(input)); process.exit(1); }
  const subset = input.stations.filter(() => rnd() < 0.5), ev2 = evaluate(input, subset);
  if (ev2.feasible) {
    evalChecked++;
    if (ev2.fuelCost + fees(ev2.stops) < total - 1e-6) { console.error('EVALUATE < OPTIMUM', ev2.fuelCost, total, JSON.stringify(input)); process.exit(1); }
    // et doit être l'optimum de SA suite : comparaison à la recherche exhaustive restreinte à ces stations, arrêts tous obligatoires non vérifiable → borne basse seulement
    const lb = brute({ ...input, stations: subset, stopCost: 0, detourCostPerKm: 0 });
    if (ev2.fuelCost < lb - 1e-6) { console.error('EVALUATE sous la borne', ev2.fuelCost, lb); process.exit(1); }
  }
  checked++;
}
console.log(`(info) cas où la référence naïve « gagne » grâce au remboursement du surplus : ${naiveWins}`);
console.log(`evaluate() : ${evalChecked} suites imposées vérifiées`);
console.log(`OK — ${checked} cas faisables identiques à la recherche exhaustive, ${infeasible} cas infaisables détectés (écart max en faveur de l'optimiseur : ${worst.toFixed(4)} €)`);

// Cas d'école : station chère proche, station bon marché plus loin => appoint puis plein.
const demo = optimize({
  distanceKm: 900, tankL: 45, consumption: 7, reserveL: 5, startFuelL: 10, arrivalFuelL: 5, stopCost: 0,
  stations: [
    { id: 'chere', pos: 50, detourKm: 0, price: 2.4 },
    { id: 'bonmarche', pos: 180, detourKm: 2, price: 1.9 },
    { id: 'moyenne', pos: 600, detourKm: 1, price: 2.1 }
  ]
});
console.log(demo.stops.map(s => `${s.station.id}: +${s.buyL.toFixed(1)} L (${s.cost.toFixed(2)} €)`).join(' | '), '→ total', demo.fuelCost.toFixed(2), '€');
