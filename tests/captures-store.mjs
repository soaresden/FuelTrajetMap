// Captures haute définition pour la fiche Play Store, avec des données fictives (« Ma 208 », Tours → Nantes).
//   cd tests && npm install   (une fois : playwright-core, sans navigateur)
//   node tests/captures-store.mjs
// Utilise Microsoft Edge (comme ecrans.test.mjs) et Internet (prix, itinéraires). Résultat dans store/captures/ :
//   tel-1…4.jpg      téléphone 1080×1920 (portrait 9:16)
//   voiture-1…6.jpg  écran Android Auto 1920×1080 (paysage 16:9, taille d'écran de voiture courante 1280×720)
//   banniere-1024x500.jpg   image de présentation (store/banniere.html)
// JPEG = sans transparence, comme le demande le Play.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'store', 'captures');
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
}).listen(0);
const BASE = `http://localhost:${server.address().port}/`;

const now = Date.now(), H = 3600e3, D = 24 * H;
const TOURS = { lat: 47.3941, lon: 0.6848 }, NANTES = { label: 'Nantes, Loire-Atlantique', lat: 47.2184, lon: -1.5536 };
const ETAT = {
  v: 2, cars: [{ id: 'c1', name: 'Ma 208', fuel: 'e10', tank: 50, cons: 6.5, reserve: 5, color: '#1f4fa3' }], activeCar: 'c1', fuel: 'e10', theme: 'nuit',
  places: [{ name: 'Maison', kind: 'home', label: 'Tours', lat: TOURS.lat, lon: TOURS.lon }, { name: 'Travail', kind: 'work', label: NANTES.label, lat: NANTES.lat, lon: NANTES.lon },
    { name: 'Angers', label: 'Angers, Maine-et-Loire', lat: 47.4736, lon: -0.5541 }],
  favs: [], startE: 2, view: { lat: 47.39, lon: 0.69, zoom: 12 }, noteStyle: 'plain',
  notes: [{ ts: now - H, text: 'Rappeler le garage demain 9 h', place: 'Tours', style: 'postit', color: '#fff59d' },
    { ts: now - D, text: 'Code portail : voir avec Paul', place: 'Angers', style: 'seyes' },
    { ts: now - 2 * D, text: 'Pneus à regonfler avant les vacances', place: '', style: 'lined' }],
  fillups: [{ ts: now - 5 * D, name: 'TotalEnergies Tours', paid: 62.4, liters: 31.2, fuel: 'e10', car: 'c1', price: 2.0 }]
};

const browser = await chromium.launch({ channel: 'msedge' });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function openPage(w, h, scale, url) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  page.on('pageerror', (e) => console.log(`  ⚠️ erreur JS : ${e.message}`));
  await page.addInitScript((st) => { if (!sessionStorage.getItem('init')) { localStorage.clear(); localStorage.setItem('fuelmap.v1', JSON.stringify(st)); sessionStorage.setItem('init', '1'); } }, ETAT);
  await page.goto(BASE + url);
  await page.waitForFunction(() => window.__fuelmapAPI && window.__fuelmapAPI.stations.length > 100, null, { timeout: 90000 });
  await page.evaluate((p) => { __fuelmap.fix = { lat: p.lat, lon: p.lon, speed: 0 }; document.dispatchEvent(new CustomEvent('fuelmap:fix')); }, TOURS);
  return page;
}
async function shot(page, name, wait = 1500) { await pause(wait); await page.screenshot({ path: path.join(OUT, name), type: 'jpeg', quality: 90 }); console.log(`  ✓ ${name}`); }

// ---- téléphone : 405×720 points × 2,667 = 1080×1920
console.log('• Téléphone');
{
  const page = await openPage(405, 720, 1080 / 405, 'index.html');
  const tab = (t) => page.evaluate((t) => [...document.querySelectorAll(`[data-tab="${t}"]`)].pop().click(), t);
  await tab('map'); await page.evaluate(() => __fuelmapAPI.map.setView([47.39, 0.69], 12.5));
  await shot(page, 'tel-1-carte.jpg', 2500);
  await tab('route');
  await page.evaluate((n) => { __fuelmap.setPlace('from', { label: 'Tours', lat: 47.3941, lon: 0.6848 }); __fuelmap.setPlace('to', n); __fuelmap.compute(); }, NANTES);
  await page.waitForFunction(() => document.querySelector('#routeResult .summary'), null, { timeout: 60000 });
  await page.evaluate(() => { document.getElementById('panel').classList.add('collapsed'); });
  await shot(page, 'tel-2-trajet-carte.jpg', 2500);
  await page.evaluate(() => { const p = document.getElementById('panel'); p.classList.remove('collapsed'); const pb = document.getElementById('panelBody'); pb.scrollTop = document.getElementById('routeResult').offsetTop - 70; });
  await shot(page, 'tel-3-trajet-arrets.jpg');
  await tab('near');
  await page.evaluate(() => { const pb = document.getElementById('panelBody'); pb.scrollTop = document.getElementById('nearList').offsetTop - 10; });
  await shot(page, 'tel-4-proximite.jpg');
  await tab('cars');
  await page.evaluate(() => { const h = document.getElementById('notesList').previousElementSibling.previousElementSibling; const pb = document.getElementById('panelBody'); pb.scrollTop = h.offsetTop - 10; });
  await shot(page, 'tel-5-notes.jpg');
  await page.close();
}

// ---- voiture : 1280×720 points × 1,5 = 1920×1080
console.log('• Android Auto');
{
  const page = await openPage(1280, 720, 1.5, 'index.html?car=1&aa=1');
  await page.evaluate(() => {
    __fuelmap.carStable(26, 26, 13, 26); __fuelmap.carInsets(26, 26, 13, 26);
    const A = __fuelmapAPI; A.state.favs = A.stations.filter((x) => A.haversine(47.394, 0.685, x.lat, x.lon) < 6 && A.pick(x, A.fuelsFor('e10')) >= 0).slice(0, 3).map((s) => String(s.id)); A.save();
    __fuelmapCar.setStep('map', 'map'); A.map.setView([47.39, 0.69], 12.5);
  });
  await shot(page, 'voiture-1-carte.jpg', 3000);
  await page.evaluate(() => { // une station proche qui affiche aussi le SP98 (comparaison) et l'historique
    const A = __fuelmapAPI, k98 = A.FUEL_INDEX.sp98, fis = A.fuelsFor('e10');
    const s = A.stations.filter((x) => { const k = A.pick(x, fis); return k >= 0 && k !== k98 && x.p[k98] > 0 && A.haversine(47.39, 0.69, x.lat, x.lon) < 8 && A.ageHours(x, k) < 72; })[0] || A.stations.filter((x) => A.pick(x, fis) >= 0 && A.haversine(47.39, 0.69, x.lat, x.lon) < 8)[0];
    __fuelmapCar.pick(s);
  });
  await shot(page, 'voiture-2-station.jpg', 4000);
  await page.evaluate(() => __fuelmapCar.setStep('dest', 'route'));
  await shot(page, 'voiture-3-destination.jpg');
  await page.evaluate((n) => __fuelmapCar.setDest(n), NANTES);
  await page.evaluate(() => document.querySelector('#carPane [data-calc]').click());
  await page.waitForFunction(() => __fuelmapCar.state().routeReady || __fuelmapCar.state().routeErr, null, { timeout: 60000 });
  await shot(page, 'voiture-4-arrets.jpg', 2500);
  await page.evaluate(() => document.querySelector('#carPane [data-trip]') && document.querySelector('#carPane [data-trip]').click());
  await page.waitForFunction(() => __fuelmapCar.state().nav, null, { timeout: 60000 });
  await pause(2500); await page.evaluate(() => __fuelmapCar.render());
  await shot(page, 'voiture-5-guidage.jpg');
  await page.evaluate(() => { __fuelmapCar.stopGuide(); });
  await pause(800); await page.evaluate(() => __fuelmapCar.setStep('setup', 'car'));
  await shot(page, 'voiture-6-ma-voiture.jpg');
  await page.close();
}

// ---- image de présentation 1024×500 (montre la capture voiture faite juste avant)
console.log('• Image de présentation');
{
  const page = await browser.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
  await page.goto(BASE + 'store/banniere.html'); await pause(1200);
  await page.screenshot({ path: path.join(OUT, 'banniere-1024x500.jpg'), type: 'jpeg', quality: 92 }); console.log('  ✓ banniere-1024x500.jpg');
  await page.close();
}

await browser.close(); server.close();
console.log(`\nCaptures dans ${OUT}`);
