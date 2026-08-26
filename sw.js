/* Daftary offline-support service worker.
   Bump SW_VERSION whenever you want to force every open copy of the app to
   pick up a fresh index.html sooner (it changes the cache name, which the
   activate handler uses to clear out the old one). */
const SW_VERSION = 'v34';
const CACHE = 'daftari-' + SW_VERSION;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.add(self.registration.scope)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if(e.request.method !== 'GET') return;
  /* network-first, and force an actual network round-trip with cache:'no-store' —
     a plain fetch() still consults the browser's own HTTP cache under its default
     mode, which was quietly serving stale index.html even though this handler
     looked like it was always going to the network first. Falls back to the
     Cache Storage copy only when there's truly no connection. */
  e.respondWith(
    fetch(e.request, {cache:'no-store'}).then(res => {
      if(res && res.ok){ caches.open(CACHE).then(c => c.put(e.request, res.clone())); }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
