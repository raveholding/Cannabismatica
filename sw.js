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

/* Portero digital (2026-11-12): botones de la notificación del timbre.
   «Ya voy» responde al portero (y a la visita del timbre por QR) sin abrir nada; «Abrir portero» abre el portero;
   tocar la notificación lleva al sistema. Sólo publica en los temas que el propio sistema puso en la notificación. */
self.addEventListener('notificationclick', function (e) {
  var n = e.notification, x = n.data || {}; n.close();
  if (!x.id) return;
  if (e.action === 'voy' && x.reply) {
    var post = function (u, b) { return /^https:\/\/ntfy\.sh\/[\w%-]+$/.test(u) ? fetch(u, { method: 'POST', body: JSON.stringify(b) }).then(function (r) { return r.ok; }, function () { return false; }) : Promise.resolve(false); };
    e.waitUntil(Promise.all([post(x.reply, { type: 'reply', id: x.id, code: 'voy' }), x.replyQr ? post(x.replyQr, { type: 'reply', id: x.id, code: 'voy', text: '¡Ya vamos! Aguardá un momento.' }) : null]).then(function () {
      return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) { cs.forEach(function (c) { c.postMessage({ portero: { respondida: true, id: x.id, code: 'voy' } }); }); });
    }));
    return;
  }
  if (e.action === 'abrir' && /^https:\/\//.test(x.url || '')) { e.waitUntil(self.clients.openWindow(x.url)); return; }
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) {
    var c = cs.filter(function (w) { return w.url.indexOf(self.registration.scope) === 0; })[0];
    return c ? c.focus() : self.clients.openWindow(self.registration.scope);
  }));
});
