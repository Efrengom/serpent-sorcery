// Offline play for the installed game. The page itself is fetched fresh when online (so a new
// deploy is picked up at once) and from the cache when offline; built assets have hashed names,
// so they are served from the cache once fetched. Fonts are refreshed in the background.
const CACHE = 'serpent-sorcery-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
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
  const cache = () => caches.open(CACHE);
  const keep = (res) => {
    if (res.ok || res.type === 'opaque') {
      const copy = res.clone();
      cache().then((c) => c.put(req, copy));
    }
    return res;
  };
  if (req.mode === 'navigate') {
    // The page: network first, the cached page when offline.
    event.respondWith(fetch(req).then(keep).catch(() => caches.match(req).then((r) => r ?? caches.match('/'))));
    return;
  }
  if (url.origin === location.origin) {
    // Hashed assets, sounds and icons: the cache first.
    event.respondWith(caches.match(req).then((hit) => hit ?? fetch(req).then(keep)));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    // Fonts: whatever is cached now, refreshed for next time.
    event.respondWith(
      caches.match(req).then((hit) => {
        const fresh = fetch(req).then(keep).catch(() => hit);
        return hit ?? fresh;
      }),
    );
  }
});
