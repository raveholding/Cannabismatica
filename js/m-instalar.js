/* Sistema VB ONG · Instalar el sistema (sólo para el equipo) · 2026-11-13
   Botón «Instalar el sistema» para quienes usan el panel: queda como una app en la computadora o el celular (ícono propio,
   ventana sin barra del navegador) y abre directo en el ingreso del equipo.
   · NO se ofrece a pacientes: en el menú público no aparece el botón y se evita el aviso automático del navegador.
   · Chrome / Edge / Android: usa el instalador del navegador. iPhone / iPad (Safari) y otros: muestra los pasos.
   · Dónde: en el menú lateral (computadora), un aviso que se puede cerrar en Inicio y en Configuración → Sistema y apariencia.
   · Si ya está instalado (se abrió como app), no se muestra nada. */
(function (g) {
  'use strict';
  var CM = g.CM, esc = CM.esc, d = document, nav = g.navigator;
  var evento = null, LS = 'cmv3_inst_no';
  function instalada() { try { return g.matchMedia('(display-mode: standalone)').matches || g.matchMedia('(display-mode: window-controls-overlay)').matches || nav.standalone === true; } catch (e) { return false; } }
  function ios() { return /iphone|ipad|ipod/i.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1); }
  function equipo() { return d.body && !d.body.classList.contains('pub') && (!CM.sesionOk || CM.sesionOk()); }
  function disponible() { return !instalada() && (!!evento || ios() || !!g.__cmInstalarSiempre); }
  CM.instalar = { disponible: disponible, instalada: instalada };

  /* el navegador avisa que se puede instalar: lo guardamos y NO dejamos que muestre su cartel (los pacientes no lo ven) */
  g.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); evento = e; pintar(); });
  g.addEventListener('appinstalled', function () { evento = null; CM.toast && CM.toast('Sistema instalado en este equipo.'); if (CM.audit && equipo()) CM.audit('Sistema instalado', 'En este equipo (' + (ios() ? 'iPhone/iPad' : /android/i.test(nav.userAgent) ? 'Android' : 'computadora') + ')'); pintar(); });

  CM.acts['inst-app'] = function () {
    if (instalada()) return CM.toast('El sistema ya está instalado en este equipo.');
    if (evento) {
      var ev = evento; evento = null;
      ev.prompt();
      (ev.userChoice || Promise.resolve({})).then(function (r) { if (r && r.outcome !== 'accepted') evento = ev; pintar(); });
      return;
    }
    var pasos = ios()
      ? '<ol class="inst-pasos"><li>Abrí el sistema en <b>Safari</b>.</li><li>Tocá <b>Compartir</b> (el cuadrado con la flecha hacia arriba).</li><li>Elegí <b>«Agregar a inicio»</b> y confirmá con <b>Agregar</b>.</li></ol>'
      : '<ol class="inst-pasos"><li>Abrí el sistema en <b>Google Chrome</b> o <b>Microsoft Edge</b>.</li><li>En la barra de direcciones tocá el ícono <b>Instalar</b> (o el menú ⋮ → <b>«Instalar Cannabismática»</b> / <b>«Agregar a la pantalla principal»</b>).</li><li>Confirmá con <b>Instalar</b>.</li></ol>';
    CM.modal.open({ title: 'Instalar el sistema en este equipo', body: '<p style="margin:0 0 8px">Queda como una app: con su ícono, en una ventana propia y abriendo directo en el ingreso del equipo.</p>' + pasos +
      '<p class="hint" style="margin:8px 0 0">Es sólo para el equipo de la fundación. Los datos siguen en la nube: instalarlo no guarda nada distinto en el equipo y cada uno entra con su usuario.</p>',
      footer: '<button class="btn pri" type="button" data-act="modal-close">Entendido</button>' });
  };
  CM.acts['inst-no'] = function () { if (g.cmPref) g.cmPref.set(LS, '1'); var av = d.querySelector('.inst-aviso'); if (av) av.remove(); };

  function aviso() {
    if (!disponible() || (g.cmPref && g.cmPref.get(LS) === '1')) return '';
    return '<div class="note info inst-aviso" role="note"><span>📲 <b>Instalá el sistema en este equipo:</b> se abre como una app, con su ícono y directo en el ingreso.</span>' +
      '<span class="row" style="flex-wrap:nowrap"><button class="btn sm pri" data-act="inst-app">Instalar</button><button class="btn sm" data-act="inst-no">Ahora no</button></span></div>';
  }
  function tarjeta() {
    var est = instalada() ? '<span class="pill p-ok">Instalado: lo estás usando como app</span>' : disponible() ? '<span class="pill p-info">Se puede instalar</span>' : '<span class="pill p-mu">Este navegador no ofrece instalarlo</span>';
    return '<section class="card" id="instCfg" style="margin-top:14px"><h2>Instalar el sistema</h2><p class="hint" style="margin:0 0 8px">Para el equipo de la fundación (no para pacientes): el sistema queda como una app en la computadora o el celular y abre directo en el ingreso.</p>' +
      '<div class="row">' + est + (instalada() ? '' : '<button class="btn pri" data-act="inst-app">' + CM.icon('plus') + 'Instalar en este equipo</button>') + '</div></section>';
  }
  function pintar() {
    var side = d.querySelector('aside.side'), b = d.getElementById('sideInst');
    var ver = equipo() && disponible();
    if (!ver) { if (b) b.remove(); } else if (side && !b) {
      var x = d.createElement('button'); x.type = 'button'; x.id = 'sideInst'; x.className = 'side-inst'; x.setAttribute('data-act', 'inst-app');
      x.innerHTML = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg><span>Instalar el sistema</span>';
      var pie = side.querySelector(':scope > .foot'); if (pie) side.insertBefore(x, pie); else side.appendChild(x);
    }
    var av = d.querySelector('.inst-aviso'); if (av && !disponible()) av.remove();
  }
  var vIni = CM.VIEWS.inicio;
  CM.VIEWS.inicio = function () { var h = vIni.apply(this, arguments); return equipo() ? aviso() + h : h; };
  var vAj = CM.VIEWS.ajustes;
  CM.VIEWS.ajustes = function () { var h = vAj.apply(this, arguments), i = h.indexOf('<section class="card" style="margin-top:14px"><h2>Sobre esta versión'); return i > 0 ? h.slice(0, i) + tarjeta() + h.slice(i) : h + tarjeta(); };
  CM.afterRender = (function (prev) { return function (r) { if (prev) prev(r); try { pintar(); } catch (e) { /* nada */ } }; })(CM.afterRender);
})(window);
