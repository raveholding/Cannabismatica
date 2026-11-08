/* Sistema VB ONG · Service worker: abre más rápido el link (sobre todo la segunda vez y con señal débil).
   - Archivos con versión (?v=…): se guardan y se sirven desde el equipo (cambian de nombre cuando hay una versión nueva).
   - La página (index.html), config.js e imágenes: primero la red (para tener siempre lo último); si no hay red o tarda más de 4 s, lo guardado.
   - NUNCA toca pedidos a otros sitios (Supabase, Google): datos y sesiones van siempre directo al servidor. */
var CACHE = 'vbong-v2';
self.addEventListener('install', function (e) { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
function guardar(req, res) { if (res && res.ok && res.type === 'basic') { var c = res.clone(); caches.open(CACHE).then(function (ca) { ca.put(req, c); }); } return res; }
self.addEventListener('fetch', function (e) {
  var req = e.request, u = new URL(req.url);
  if (req.method !== 'GET' || u.origin !== self.location.origin) return;
  if (u.search.indexOf('v=') >= 0 && /\.(js|css)$/.test(u.pathname)) {
    e.respondWith(caches.match(req).then(function (r) { return r || fetch(req).then(function (res) { return guardar(req, res); }); }));
    return;
  }
  e.respondWith(new Promise(function (ok) {
    var listo = false, t = setTimeout(function () { caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(function (r) { if (r && !listo) { listo = true; ok(r); } }); }, 4000);
    fetch(req).then(function (res) { clearTimeout(t); guardar(req, res); if (!listo) { listo = true; ok(res); } }, function () {
      clearTimeout(t); caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(function (r) { if (!listo) { listo = true; ok(r || Response.error()); } });
    });
  }));
});
