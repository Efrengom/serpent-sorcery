// Offline play for the installed game. Installing a build fetches every file it made (the list
// below is filled in by the build; see vite.config.ts), fonts included, so the whole game, the
// parts loaded on demand too, plays offline from its first launch. The page itself is fetched
// fresh when online (so a new deploy is picked up at once) and from the cache when offline.
const BUILD = { version: 'dev', files: [] };
const CACHE = `serpent-sorcery-${BUILD.version}`;
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll([...new Set([...SHELL, ...BUILD.files])]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  // Every older cache goes: earlier builds' files, and the Google Fonts cache from before the
  // fonts were part of the build.
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const keep = (res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  };
  if (req.mode === 'navigate') {
    // The page: network first, the cached page when offline.
    event.respondWith(fetch(req).then(keep).catch(() => caches.match(req).then((r) => r ?? caches.match('/'))));
    return;
  }
  // Hashed assets, fonts, sounds and icons: the cache first.
  event.respondWith(caches.match(req).then((hit) => hit ?? fetch(req).then(keep)));
});
