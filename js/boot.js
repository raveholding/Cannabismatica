/* Arranque: se ejecuta cuando todos los módulos ya se registraron */
(function (g) {
  'use strict';
  g.CM.boot(); g.document.documentElement.className += ' rdy';
  /* service worker (sw.js): sólo en el sitio publicado (https, no en pruebas locales) */
  try {
    if ('serviceWorker' in g.navigator && g.location.protocol === 'https:' && !/^(localhost|127\.)/.test(g.location.hostname))
      g.addEventListener('load', function () { g.navigator.serviceWorker.register('sw.js', { scope: './' }).catch(function () { /* sin caché local: anda igual */ }); });
  } catch (e) { /* nada */ }
})(window);
