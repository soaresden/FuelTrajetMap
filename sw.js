/* Service worker FuelMap : coquille de l'appli en cache (démarrage instantané, hors-ligne),
   tuiles de carte en cache plafonné. Les prix sont gérés par l'appli elle-même (IndexedDB). */
var VERSION = 'fuelmap-v48';
var SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/config.js', 'js/diag.js', 'js/themes.js', 'js/optimizer.js', 'js/sources.js', 'js/car.js', 'js/fillup.js', 'js/update.js', 'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'icons/icon.svg', 'icons/icon-192.png', 'manifest.webmanifest'];
var TILES = 'fuelmap-tiles', TILE_MAX = 600;

self.addEventListener('install', function (e) { e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); })); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) { return Promise.all(keys.filter(function (k) { return k !== VERSION && k !== TILES; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin === location.origin) {
    // coquille : réseau d'abord si rapide, sinon cache (l'appli marche hors-ligne et se met à jour seule)
    e.respondWith(fetch(e.request).then(function (r) { var copy = r.clone(); caches.open(VERSION).then(function (c) { c.put(e.request, copy); }); return r; }).catch(function () { return caches.match(e.request, { ignoreSearch: true }); }));
    return;
  }
  if (/tile\.openstreetmap\.org$/.test(url.hostname)) {
    e.respondWith(caches.open(TILES).then(function (c) {
      return c.match(e.request).then(function (hit) {
        if (hit) return hit;
        return fetch(e.request).then(function (r) {
          if (r.ok || r.type === 'opaque') { c.put(e.request, r.clone()); c.keys().then(function (k) { if (k.length > TILE_MAX) for (var i = 0; i < k.length - TILE_MAX; i++) c.delete(k[i]); }); }
          return r;
        });
      });
    }));
  }
});
