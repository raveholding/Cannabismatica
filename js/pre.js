/* Sistema VB ONG · Pedido anticipado del menú público.
   Se ejecuta apenas llega este archivo, mientras el resto del sistema todavía se descarga:
   así el menú viaja en paralelo y no espera a que arranque todo. Sólo usa la clave PUBLICABLE (la misma de config.js). */
/* tema claro / oscuro antes de pintar (evita el destello): lo elige cada equipo en Configuración → Apariencia */
(function (g) {
  try { var v = g.localStorage.getItem('cmv3_tema'); if (v === 'sistema') v = g.matchMedia && g.matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro'; else if (v !== 'oscuro') v = 'claro'; g.document.documentElement.setAttribute('data-tema', v); } catch (e) { /* sin almacenamiento */ }
})(window);
(function (g) {
  'use strict';
  var C = g.CM_CFG || {};
  if (!C.url || !C.key || !g.fetch) return;
  try {
    g.CM_PRE_MENU = g.fetch(String(C.url).replace(/\/+$/, '') + '/rest/v1/rpc/pub_menu_obtener', {
      method: 'POST', headers: { apikey: C.key, 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store'
    }).then(function (r) {
      if (!r.ok) throw new Error('http_' + r.status);
      return r.text().then(function (t) { return t ? JSON.parse(t) : null; });
    });
    g.CM_PRE_MENU.catch(function () { /* si falla, el arranque lo vuelve a pedir */ });
  } catch (e) { g.CM_PRE_MENU = null; }
})(window);
