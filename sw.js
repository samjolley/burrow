// Bump CACHE on every deploy. Keep it in lockstep with BUILD in index.html.
const CACHE = 'burrow-v1';

// VERIFIED shell list. A single 404 rejects the entire install.
// ponytail: three entries. Do not add the manifest or the PNGs "for completeness" —
// the OS fetches icons at install time while online, and each extra entry is
// another way for cache.addAll to reject and leave the app broken offline.
const SHELL = ['./', './index.html', './state.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k.startsWith('burrow-') && k !== CACHE)  // OUR caches only:
          .map((k) => caches.delete(k))                           // github.io is a shared origin.
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  // ponytail: network-first for everything same-origin. One strategy, no per-asset
  // routing. Online you always get the deployed version; offline you get the shell.
  // This kills the "old cache-first worker keeps serving v1" failure outright.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) =>
          hit || (req.mode === 'navigate' ? caches.match('./') : undefined)
        )
      )
  );
});
