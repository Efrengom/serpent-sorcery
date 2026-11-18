// Offline play for the installed game. Installing a build fetches every file it made (the list
// below is filled in by the build; see vite.config.ts), so the whole game, the parts loaded on
// demand included, plays offline from its first launch. The page itself is fetched fresh when
// online (so a new deploy is picked up at once) and from the cache when offline. Fonts keep a
// cache of their own across builds and are refreshed in the background.
const BUILD = { version: 'dev', files: [] };
const CACHE = `serpent-sorcery-${BUILD.version}`;
const FONTS = 'serpent-sorcery-fonts';
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
  // An older build's files go; the fonts stay.
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== FONTS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const keep = (name) => (res) => {
    if (res.ok || res.type === 'opaque') {
      const copy = res.clone();
      caches.open(name).then((c) => c.put(req, copy));
    }
    return res;
  };
  if (req.mode === 'navigate') {
    // The page: network first, the cached page when offline.
    event.respondWith(fetch(req).then(keep(CACHE)).catch(() => caches.match(req).then((r) => r ?? caches.match('/'))));
    return;
  }
  if (url.origin === location.origin) {
    // Hashed assets, sounds and icons: the cache first.
    event.respondWith(caches.match(req).then((hit) => hit ?? fetch(req).then(keep(CACHE))));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    // Fonts: whatever is cached now, refreshed for next time.
    event.respondWith(
      caches.match(req).then((hit) => {
        const fresh = fetch(req).then(keep(FONTS)).catch(() => hit);
        return hit ?? fresh;
      }),
    );
  }
});
