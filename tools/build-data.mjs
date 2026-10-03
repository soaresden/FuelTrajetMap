#!/usr/bin/env node
/*
 * Prépare les fichiers de data/ lus par l'appli (format compact), depuis les sources officielles de js/sources.js.
 *   fr es pt ad it   prix par station → data/<pays>.json   (indispensable pour l'Italie : pas de CORS)
 *   brands           enseignes des stations françaises (absentes des données de l'État) → data/fr-brands.json
 *                    Source : OpenStreetMap (ODbL), dont les stations portent l'identifiant officiel « ref:FR:prix-carburants ».
 *   hist             historique des prix France, 180 jours → data/hist/<département>.json, et habitudes de mise à jour
 *                    (90 jours) → data/fr-habits.json : par station, nombre de mises à jour, heure la plus fréquente et sa
 *                    part (≥ 60 % = mise à jour automatique à heure fixe, ex. TotalEnergies 00:01), répartition par heure.
 *                    Source : archive annuelle de prix-carburants.gouv.fr (≈ 30 Mo zippés ; nécessite la commande `unzip`).
 * Usage : node tools/build-data.mjs [cibles…]      (Node >= 18, aucune dépendance ; sans argument : tout)
 * Tourne dans .github/workflows/pages.yml. Une cible qui échoue garde son fichier précédent.
 */
import { writeFile, mkdir, readFile, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const SOURCES = createRequire(import.meta.url)('../js/sources.js');
const DATA = new URL('../data/', import.meta.url), DAY = 86400000, FUEL_BY_GOV_ID = { 1: 0, 2: 1, 5: 2, 6: 3, 3: 4, 4: 5 }; // id État → index appli
const UA = { 'User-Agent': 'FuelMap data builder' };

async function get(url, text, init) {
  const r = await fetch(url, { headers: UA, ...init });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  const body = (await r.text()).replace(/^﻿/, '');
  return text ? body : JSON.parse(body);
}

async function country(cc) {
  const src = SOURCES[cc], payloads = await Promise.all(src.urls.map(u => get(u, src.text)));
  const list = src.parse(...payloads);
  await writeFile(new URL(`${cc}.json`, DATA), JSON.stringify({ cc, ts: Date.now(), list }));
  return `${list.length} stations`;
}

async function brands() {
  const q = 'data=' + encodeURIComponent('[out:json][timeout:240];area["ISO3166-1"="FR"][admin_level=2]->.fr;nwr["amenity"="fuel"](area.fr);out center tags;');
  let osm, lastErr;
  for (const host of ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.private.coffee/api/interpreter']) {
    try { osm = (await get(host, false, { method: 'POST', body: q, headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded' } })).elements; if (osm.length > 5000) break; } catch (e) { lastErr = e; }
  }
  if (!osm || osm.length < 5000) throw lastErr || new Error('réponse Overpass incomplète');
  const fr = JSON.parse(await readFile(new URL('fr.json', DATA), 'utf8')).list;
  const label = e => SOURCES.normBrand(e.tags.brand || e.tags.operator || e.tags.name), at = e => [e.lat ?? e.center?.lat, e.lon ?? e.center?.lon];
  const byRef = new Map(), grid = new Map();
  for (const e of osm) {
    if (!e.tags) continue; const [la, lo] = at(e); if (la == null) continue;
    for (const ref of String(e.tags['ref:FR:prix-carburants'] || '').split(/[;,\s]+/)) if (ref) byRef.set(ref, e);
    const k = Math.floor(la * 100) + ':' + Math.floor(lo * 100); grid.has(k) ? grid.get(k).push(e) : grid.set(k, [e]);
  }
  const map = {}; let n = 0;
  for (const s of fr) {
    let b = byRef.has(String(s.id)) ? label(byRef.get(String(s.id))) : '';
    if (!b) { // à défaut d'identifiant : la station OSM la plus proche, à moins de 200 m
      let best = 0.2;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const e of grid.get((Math.floor(s.lat * 100) + dy) + ':' + (Math.floor(s.lon * 100) + dx)) || []) {
        const [la, lo] = at(e), d = Math.hypot((la - s.lat) * 111.3, (lo - s.lon) * 111.3 * Math.cos(s.lat * Math.PI / 180));
        if (d < best && label(e)) { best = d; b = label(e); }
      }
    }
    if (b) { map[s.id] = b; n++; }
  }
  if (n < fr.length * 0.6) throw new Error(`seulement ${n} enseignes trouvées`);
  await writeFile(new URL('fr-brands.json', DATA), JSON.stringify({ ts: Date.now(), map }));
  return `${n} enseignes sur ${fr.length} stations`;
}

async function hist() {
  const DAYS = 180, since = Math.floor(Date.now() / DAY) - DAYS, now = new Date(), years = [now.getUTCFullYear()];
  if ((Date.now() - Date.UTC(years[0], 0, 1)) / DAY < DAYS) years.unshift(years[0] - 1);
  const stations = new Map(); // id → { dep, f: { fuelIdx: [jour, millièmes, jour, millièmes…] } }
  const HABIT_DAYS = 90, habitSince = Math.floor(Date.now() / DAY) - HABIT_DAYS, habits = new Map(); // id → { n, hm: Map('HH:MM' → n), h: [24] }
  for (const y of years) {
    const zip = join(tmpdir(), `fuelmap-${y}.zip`), r = await fetch(`https://donnees.roulez-eco.fr/opendata/annee/${y}`, { headers: UA });
    if (!r.ok) throw new Error(`archive ${y} → HTTP ${r.status}`);
    await pipeline(r.body, createWriteStream(zip));
    const unzip = spawn('unzip', ['-p', zip]); let cur = null, curId = null;
    unzip.on('error', e => { throw new Error('commande unzip introuvable : ' + e.message); });
    for await (const line of createInterface({ input: unzip.stdout.setEncoding('latin1'), crlfDelay: Infinity })) {
      let m = /<pdv id="(\d+)"[^>]* cp="(\w{2})/.exec(line);
      if (m) { curId = m[1]; cur = stations.get(m[1]); if (!cur) stations.set(m[1], cur = { dep: m[2], f: {} }); continue; }
      if (!cur || !(m = /<prix [^>]*id="(\d)" maj="([^"]+)" valeur="([\d.]+)"/.exec(line))) continue;
      const fi = FUEL_BY_GOV_ID[m[1]], d = Math.floor(Date.parse(m[2] + 'Z') / DAY), v = Math.round(+m[3] * 1000);
      if (d >= habitSince) { // habitudes de mise à jour (heures locales telles que publiées)
        const id = curId, hm = m[2].slice(11, 16);
        if (id) { // une mise à jour = un instant (plusieurs carburants saisis ensemble ne comptent qu'une fois)
          let hb = habits.get(id); if (!hb) habits.set(id, hb = { n: 0, hm: new Map(), h: new Array(24).fill(0), seen: new Set() });
          if (!hb.seen.has(m[2])) { hb.seen.add(m[2]); hb.n++; hb.hm.set(hm, (hb.hm.get(hm) || 0) + 1); hb.h[+hm.slice(0, 2)]++; }
        }
      }
      if (fi == null || !(v > 300 && v < 5000) || !Number.isFinite(d)) continue;
      const a = cur.f[fi] || (cur.f[fi] = []), n = a.length;
      if (n && a[n - 1] === v) continue;                                 // prix inchangé : on ne garde que les changements
      if (n && a[n - 2] === d) a[n - 1] = v;                              // plusieurs changements le même jour : le dernier
      else if (d < since && n) { a[n - 2] = d; a[n - 1] = v; }            // avant la fenêtre : un seul point d'ancrage
      else a.push(d, v);
    }
    await rm(zip, { force: true });
  }
  const shards = {}; let kept = 0;
  for (const [id, s] of stations) {
    const f = {}; for (const k in s.f) if (s.f[k].length >= 2 && s.f[k][s.f[k].length - 2] >= since - 30) f[k] = s.f[k];
    if (Object.keys(f).length) { (shards[s.dep] ||= {})[id] = f; kept++; }
  }
  if (kept < 3000) throw new Error(`seulement ${kept} stations avec historique`);
  await rm(new URL('hist/', DATA), { recursive: true, force: true }); await mkdir(new URL('hist/', DATA), { recursive: true });
  for (const dep in shards) await writeFile(new URL(`hist/${dep}.json`, DATA), JSON.stringify({ ts: Date.now(), days: DAYS, s: shards[dep] }));
  const hab = {}; let nAuto = 0;
  for (const [id, hb] of habits) {
    if (hb.n < 3) continue;
    let top = '', topN = 0; for (const [k, n] of hb.hm) if (n > topN) { top = k; topN = n; }
    const share = Math.round(100 * topN / hb.n), auto = hb.n >= 10 && share >= 60; if (auto) nAuto++;
    hab[id] = [hb.n, top, share, hb.h.map(x => Math.min(35, Math.round(x * 35 / Math.max(1, Math.max(...hb.h)))).toString(36)).join('')]; // 24 chiffres base 36 : profil horaire normalisé
  }
  await writeFile(new URL('fr-habits.json', DATA), JSON.stringify({ ts: Date.now(), days: HABIT_DAYS, map: hab }));
  return `${kept} stations, ${Object.keys(shards).length} départements ; habitudes : ${Object.keys(hab).length} stations dont ${nAuto} à heure fixe`;
}

const TARGETS = { ...Object.fromEntries(Object.keys(SOURCES).filter(k => SOURCES[k].urls).map(cc => [cc, () => country(cc)])), brands, hist };
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(TARGETS);
await mkdir(DATA, { recursive: true });
let failed = 0;
for (const t of wanted) {
  try { if (!TARGETS[t]) throw new Error('cible inconnue'); console.log(`${t}: ${await TARGETS[t]()}`); }
  catch (e) { failed++; console.error(`${t}: ÉCHEC — ${e.message} (fichier précédent conservé)`); }
}
process.exit(failed === wanted.length ? 1 : 0);
