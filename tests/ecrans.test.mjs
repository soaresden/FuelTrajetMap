// Tests d'écran automatiques : à lancer avant chaque livraison.
//   cd tests && npm install   (une fois : installe playwright-core, ~2 Mo, sans navigateur)
//   node tests/ecrans.test.mjs
// Utilise Microsoft Edge déjà installé sur le PC. Sert le dépôt sur un petit serveur local, ouvre l'appli aux tailles réelles
// (voiture plein écran 1193×480, écran partagé avec le lecteur 780×715, écran étroit 850×480, téléphone 375×812), passe par
// chaque écran et vérifie : aucun chevauchement entre éléments, rien hors de l'écran, rien sous les boutons d'Android Auto.
// Captures dans tests/captures/. Code de sortie 1 si un problème est trouvé.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'captures');
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
}).listen(0);
const BASE = `http://localhost:${server.address().port}/`;

const VOITURE = { v: 2, cars: [{ id: 'c1', name: 'Ma 208', fuel: 'e10', tank: 50, cons: 6.5, reserve: 5, color: '#1c2b4b' }], activeCar: 'c1', fuel: 'e10', theme: 'nuit',
  places: [{ name: 'Nantes', label: 'Nantes, Loire-Atlantique', lat: 47.2184, lon: -1.5536 }], favs: [], startE: 3, view: { lat: 47.39, lon: 0.69, zoom: 12 } };
const problems = [];
const fail = (where, msg) => { problems.push(`${where} : ${msg}`); console.log(`  ✗ ${msg}`); };

const browser = await chromium.launch({ channel: 'msedge' });

async function openPage(w, h, url) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('pageerror', (e) => problems.push(`${url} ${w}×${h} : erreur JS « ${e.message} »`));
  await page.addInitScript((st) => { if (!sessionStorage.getItem('init')) { localStorage.clear(); localStorage.setItem('fuelmap.v1', JSON.stringify(st)); sessionStorage.setItem('init', '1'); } }, VOITURE);
  await page.goto(BASE + url);
  await page.waitForFunction(() => window.__fuelmapAPI && window.__fuelmapAPI.stations.length > 100, null, { timeout: 60000 });
  return page;
}

// rectangles visibles des éléments surveillés, et contrôles de chevauchement
async function check(page, name, sels, extra = {}) {
  console.log(`• ${name}`);
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, name.replace(/[^\w-]+/g, '_') + '.png') });
  const r = await page.evaluate((sels) => {
    const out = {};
    sels.forEach((s) => document.querySelectorAll(s).forEach((el, i) => {
      const cs = getComputedStyle(el); if (el.hidden || cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return;
      const b = el.getBoundingClientRect(); if (b.width < 2 || b.height < 2) return; out[s + (i ? '#' + i : '')] = [b.left, b.top, b.right, b.bottom];
    }));
    return { rects: out, w: innerWidth, h: innerHeight };
  }, sels);
  const R = r.rects, keys = Object.keys(R), allow = extra.allow || [];
  for (const k of keys) { const [l, t, rr, b] = R[k]; if (l < -1 || t < -1 || rr > r.w + 1 || b > r.h + 1) fail(name, `${k} sort de l'écran (${l | 0},${t | 0} → ${rr | 0},${b | 0})`); }
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const a = R[keys[i]], b = R[keys[j]];
    if (allow.some(([x, y]) => (keys[i].startsWith(x) && keys[j].startsWith(y)) || (keys[i].startsWith(y) && keys[j].startsWith(x)))) continue;
    if (a[0] < b[2] - 1 && a[2] > b[0] + 1 && a[1] < b[3] - 1 && a[3] > b[1] + 1) fail(name, `${keys[i]} chevauche ${keys[j]}`);
  }
  if (extra.hostStrip) { const hs = [r.w - 430, 0, r.w, 78]; for (const k of keys) { const a = R[k]; if (a[0] < hs[2] && a[2] > hs[0] && a[1] < hs[3] && a[3] > hs[1]) fail(name, `${k} passe sous les boutons d'Android Auto (en haut à droite)`); } }
}

// ---- écran voiture
const CAR = ['#carRail', '#carSteps', '#carPane.open', '#carChip', '#carRefresh', '#carFavs', '#carNext', '#carView', '#carTown', '#carGuide', '#toast:not([hidden])'];
for (const [w, h, label, stable, insets] of [[1193, 480, 'voiture', [26, 26, 13, 26], [95, 26, 13, 26]], [850, 480, 'voiture étroite', [26, 0, 13, 0], [95, 0, 13, 0]], [780, 715, 'écran partagé', [26, 0, 13, 0], [95, 0, 13, 0]]]) {
  const page = await openPage(w, h, 'index.html?car=1&aa=1');
  await page.evaluate(([s, i]) => { __fuelmap.carStable(...s); __fuelmap.carInsets(...i); __fuelmap.fix = { lat: 47.3941, lon: 0.6848, speed: 0 }; document.dispatchEvent(new CustomEvent('fuelmap:fix'));
    const A = __fuelmapAPI; A.state.favs = A.stations.filter((x) => A.haversine(47.394, 0.685, x.lat, x.lon) < 6 && A.pick(x, A.fuelsFor('e10')) >= 0).slice(0, 3).map((s) => String(s.id)); A.save();
    __fuelmapCar.setStep('map', 'map'); A.map.setView([47.39, 0.69], 11.5); }, [stable, insets]);
  const run = async (name, fn) => { await page.evaluate(fn); await check(page, `${label} ${w}×${h} — ${name}`, CAR, { hostStrip: true }); };
  await run('carte au repos', () => __fuelmapCar.setStep('map', 'map'));
  await run('liste des stations', () => __fuelmapCar.setStep('list', 'map'));
  await run('fiche station', () => { const A = __fuelmapAPI; __fuelmapCar.pick(A.stations.filter((x) => A.pick(x, A.fuelsFor('e10')) >= 0 && A.haversine(47.39, 0.69, x.lat, x.lon) < 5)[0]); });
  await run('trajet destination', () => __fuelmapCar.setStep('dest', 'route'));
  await run('trajet réservoir', () => __fuelmapCar.setDest({ label: 'Nantes, Loire-Atlantique', lat: 47.2184, lon: -1.5536 }));
  await run('pénurie', () => __fuelmapCar.setStep('list', 'shortage'));
  await run('ma voiture', () => __fuelmapCar.setStep('setup', 'car'));
  await run('thèmes', () => __fuelmapCar.setStep('pick', 'theme'));
  await run('message', () => { __fuelmapCar.setStep('map', 'map'); __fuelmapAPI.toast('✅ Prix actualisés'); });
  await page.evaluate(() => { __fuelmapCar.goTo(47.40, 0.70, 'Essai'); });
  await page.waitForFunction(() => __fuelmapCar.state().nav, null, { timeout: 20000 }).catch(() => fail(label, 'le guidage ne démarre pas'));
  await page.evaluate(([s, i]) => { __fuelmap.carStable(s[0], s[1], s[2], 430); __fuelmap.carInsets(i[0], i[1], i[2], 430); }, [stable, insets]); // cartes de l'hôte à gauche
  await check(page, `${label} ${w}×${h} — guidage`, CAR.filter((s) => s !== '#carRail'), { hostStrip: false });
  await page.evaluate(() => __fuelmapCar.stopGuide());
  await page.close();
}

// ---- téléphone
{
  const page = await openPage(375, 812, 'index.html');
  await page.evaluate(() => { __fuelmapAPI.map.setView([47.39, 0.69], 12.5); });
  const PH = ['#topbar', '#statbar .stat', '.leaflet-control-zoom', '.leaflet-control-attribution', '#mapButtons', '#tabs', '#hud'];
  await check(page, 'téléphone 375×812 — carte', PH, { allow: [['#statbar .stat', '#statbar .stat']] });
  await page.evaluate(() => document.getElementById('carBtn').click());
  await check(page, 'téléphone 375×812 — mode voiture', PH, { allow: [['#statbar .stat', '#statbar .stat']] });
  await page.close();
}

await browser.close(); server.close();
console.log(problems.length ? `\n❌ ${problems.length} problème(s) :\n - ${problems.join('\n - ')}` : '\n✅ Aucun chevauchement, rien hors de l\'écran.');
process.exit(problems.length ? 1 : 0);
