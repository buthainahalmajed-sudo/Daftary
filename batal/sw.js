/* خدمة العمل بدون إنترنت — نفس أسلوب دفتري.
   ارفعي SW_VERSION لما تبين كل الأجهزة المفتوحة تسحب نسخة جديدة من index.html. */
const SW_VERSION = 'v4';
const CACHE = 'batal-' + SW_VERSION;

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
  if (e.request.method !== 'GET') return;
  /* الشبكة أولًا مع تجاوز كاش المتصفح، والكاش احتياط لو ما فيه اتصال */
  e.respondWith(
    fetch(e.request, { cache: 'no-store' }).then(res => {
      if (res && res.ok) { caches.open(CACHE).then(c => c.put(e.request, res.clone())); }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
