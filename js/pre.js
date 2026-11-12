/* Sistema VB ONG · Pedido anticipado del menú público.
   Se ejecuta apenas llega este archivo, mientras el resto del sistema todavía se descarga:
   así el menú viaja en paralelo y no espera a que arranque todo. Sólo usa la clave PUBLICABLE (la misma de config.js). */
/* preferencias de este equipo (tema, menú plegado, sección de Configuración).
   GitHub Pages comparte el almacenamiento entre todos los sistemas publicados en el mismo dominio: si otro sistema lo llenó,
   localStorage rechaza escribir. Entonces se guarda en una cookie propia de esta carpeta (unos pocos bytes) y, si tampoco,
   queda en memoria mientras la pestaña esté abierta. Así el tema nunca «se rompe». */
(function (g) {
  var mem = {}, ck = 'cmp_', ruta = String(g.location.pathname).replace(/[^\/]*$/, '') || '/';
  function leerCookie(k) { var m = new RegExp('(?:^|; )' + ck + k + '=([^;]*)').exec(g.document.cookie || ''); return m ? decodeURIComponent(m[1]) : null; }
  g.cmPref = {
    get: function (k) {
      if (Object.prototype.hasOwnProperty.call(mem, k)) return mem[k];
      var v = null; try { v = g.localStorage.getItem(k); } catch (e) { /* sin almacenamiento */ }
      if (v == null) try { v = leerCookie(k); } catch (e) { /* sin cookies */ }
      return v;
    },
    set: function (k, v) {
      mem[k] = v; var ok = false;
      try { g.localStorage.setItem(k, v); ok = true; } catch (e) { /* lleno o bloqueado */ }
      try { if (!ok && String(v).length < 1500) g.document.cookie = ck + k + '=' + encodeURIComponent(v) + '; path=' + ruta + '; max-age=31536000; SameSite=Lax' + (g.location.protocol === 'https:' ? '; Secure' : ''); else if (ok) g.document.cookie = ck + k + '=; path=' + ruta + '; max-age=0'; } catch (e) { /* sin cookies */ }
    }
  };
  try { var v = g.cmPref.get('cmv3_tema'); if (v === 'sistema') v = g.matchMedia && g.matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro'; else if (v !== 'oscuro') v = 'claro'; g.document.documentElement.setAttribute('data-tema', v); } catch (e) { /* nada */ }
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
