// Pune Map service worker — offline app shell + library cache, runtime tile cache.
// Bump CACHE_VERSION whenever index.html or assets change to force an update.
const CACHE_VERSION = 'pune-map-v2';
const SHELL_CACHE = CACHE_VERSION + '-shell';
const TILE_CACHE = CACHE_VERSION + '-tiles';
const TILE_LIMIT = 600; // cap cached tiles so storage doesn't balloon on old phones

// App shell + the (heavy) map libraries. Caching these is the main speed win:
// after the first load they come from disk, not the network.
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  'https://unpkg.com/@geoman-io/leaflet-geoman-free@2.18.3/dist/leaflet-geoman.css',
  'https://unpkg.com/@geoman-io/leaflet-geoman-free@2.18.3/dist/leaflet-geoman.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      // addAll fails the whole install if one cross-origin asset hiccups,
      // so add them individually and ignore the odd failure.
      .then(cache => Promise.all(SHELL_ASSETS.map(url =>
        cache.add(url).catch(() => null)
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => !k.startsWith(CACHE_VERSION)).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

function isTile(url) {
  return /tile\.openstreetmap\.org|basemaps\.cartocdn\.com/.test(url);
}

async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length > max) {
    // drop oldest entries (FIFO) until under the cap
    for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = req.url;

  // Map tiles: cache-first, fall back to network, then store (stale-while-revalidate-ish).
  if (isTile(url)) {
    e.respondWith(
      caches.open(TILE_CACHE).then(async cache => {
        const hit = await cache.match(req);
        const fetchPromise = fetch(req).then(resp => {
          if (resp && resp.status === 200) {
            cache.put(req, resp.clone());
            trimCache(TILE_CACHE, TILE_LIMIT);
          }
          return resp;
        }).catch(() => hit);
        return hit || fetchPromise;
      })
    );
    return;
  }

  // App shell + libs: cache-first (instant load), update cache in background.
  e.respondWith(
    caches.match(req).then(hit => {
      const fetchPromise = fetch(req).then(resp => {
        if (resp && resp.status === 200 && (url.startsWith(self.location.origin) || url.includes('unpkg.com'))) {
          const clone = resp.clone();
          caches.open(SHELL_CACHE).then(c => c.put(req, clone));
        }
        return resp;
      }).catch(() => hit);
      return hit || fetchPromise;
    })
  );
});
