/* Sistema VB ONG · Diseño V27 (2026-11-12), adaptado de Sistema VB V27.2 (demo Di Parma) sin cambiar colores ni logo:
   · Menú lateral por secciones plegables (Gestión · Comunidad · Sistema). Se recuerda en cada equipo; la sección de la
     pantalla abierta siempre queda desplegada. Con la sección cerrada, el título muestra la suma de sus avisos.
   · Números de aviso en cada entrada del menú (REPROCANN, stock, caja, pedidos de RR. HH., solicitudes del menú).
   · Botón principal «Registrar dispensación» [F1] arriba del menú (y flotante en el celular), sólo si el rol puede dispensar.
   · Campana de avisos en la barra con el total; al tocarla se abre la lista (antes eran fichas que apretaban el buscador).
   · Menú público: doble clic (o doble toque) sobre el logo abre el acceso del equipo. */
(function (g) {
  'use strict';
  var CM = g.CM, esc = CM.esc, d = document;
  var LS = 'cmv3_navg';
  function leer() { try { return JSON.parse(g.localStorage.getItem(LS) || '{}') || {}; } catch (e) { return {}; } }
  function guardar(o) { try { g.localStorage.setItem(LS, JSON.stringify(o)); } catch (e) { /* sin almacenamiento */ } }
  var MAPA = { rep: 'reprocann', repp: 'reprocann', stock: 'trazabilidad', agot: 'trazabilidad', rh: 'personal', caja: 'caja' };
  function avisos() { try { return CM.uxAvisos ? CM.uxAvisos() : []; } catch (e) { return []; } }

  /* ---------- menú lateral ---------- */
  function badges(nav, av) {
    var por = {};
    av.forEach(function (a) { var k = MAPA[a.k]; if (!k) return; por[k] = por[k] || { n: 0, c: 'warn' }; por[k].n += a.n; if (a.c === 'bad') por[k].c = 'bad'; });
    Object.keys(por).forEach(function (k) {
      var a = nav.querySelector('a[href="#/' + k + '"]'); if (!a || a.querySelector('.nav-badge')) return;
      a.insertAdjacentHTML('beforeend', '<span class="nav-badge ' + por[k].c + '" aria-label="' + por[k].n + ' aviso' + (por[k].n > 1 ? 's' : '') + '">' + por[k].n + '</span>');
    });
  }
  function grupos(nav) {
    if (nav.querySelector('.nav-g')) return;
    var est = leer(), cur = null;
    [].slice.call(nav.children).forEach(function (el) {
      if (el.classList.contains('nav-h')) {
        var t = el.textContent.trim(), id = 'navg-' + CM.norm(t).replace(/[^a-z0-9]+/g, '-');
        var w = d.createElement('div'); w.className = 'nav-g'; w.setAttribute('data-g', t);
        w.innerHTML = '<button type="button" class="nav-gh" data-act="nav-g" data-g="' + esc(t) + '" aria-expanded="true" aria-controls="' + id + '"><span>' + esc(t) + '</span><span class="nav-gn" hidden></span>' + CM.icon('up') + '</button><div class="nav-gl" id="' + id + '" role="group" aria-label="' + esc(t) + '"></div>';
        el.parentNode.replaceChild(w, el); cur = w.querySelector('.nav-gl'); return;
      }
      if (cur && el.tagName === 'A') cur.appendChild(el);
    });
    [].forEach.call(nav.querySelectorAll('.nav-g'), function (w) {
      var t = w.getAttribute('data-g'), activo = !!w.querySelector('a[aria-current="page"]'), ab = activo || est[t] !== false;
      w.classList.toggle('cerr', !ab); w.querySelector('.nav-gh').setAttribute('aria-expanded', String(ab));
      var n = 0, bad = false; [].forEach.call(w.querySelectorAll('.nav-badge'), function (b) { n += +b.textContent || 0; if (!b.classList.contains('warn')) bad = true; });
      var gn = w.querySelector('.nav-gn'); gn.hidden = !n || ab; gn.textContent = n; gn.className = 'nav-gn' + (bad ? '' : ' warn');
    });
  }
  CM.acts['nav-g'] = function (t) {
    var w = t.closest('.nav-g'), k = t.getAttribute('data-g'), est = leer(), ab = w.classList.contains('cerr');
    if (!ab && w.querySelector('a[aria-current="page"]')) { CM.toast('Esta sección tiene la pantalla abierta: queda desplegada.'); return; }
    est[k] = ab; guardar(est); w.classList.toggle('cerr', !ab); t.setAttribute('aria-expanded', String(ab));
    var gn = w.querySelector('.nav-gn'); gn.hidden = ab || !(+gn.textContent);
  };

  /* ---------- botón principal: Registrar dispensación [F1] ---------- */
  function puedeDispensar() { return !d.body.classList.contains('pub') && CM.can && CM.can('dispensaciones', 'oper') && (!CM.sesionOk || CM.sesionOk()); }
  function cta() {
    var side = d.querySelector('aside.side'), nav = d.getElementById('nav'), b = d.getElementById('sideCta');
    if (!puedeDispensar()) { if (b) b.remove(); return; }
    if (b || !side || !nav) return;
    side.insertBefore(Object.assign(d.createElement('button'), { type: 'button', id: 'sideCta', className: 'side-cta', innerHTML: CM.icon('flask') + '<span>Registrar dispensación</span><kbd>F1</kbd>' }), nav);
    d.getElementById('sideCta').setAttribute('data-act', 'ux-f1'); d.getElementById('sideCta').setAttribute('aria-keyshortcuts', 'F1');
  }
  CM.acts['ux-f1'] = function () { if (!puedeDispensar()) return; CM.acts.dispensar({ getAttribute: function () { var m = /^#\/paciente\/(\d+)/.exec(g.location.hash); return m ? m[1] : ''; } }); };
  d.addEventListener('keydown', function (e) {
    if (e.key !== 'F1' || e.ctrlKey || e.altKey || e.metaKey) return;
    if (!puedeDispensar()) return; e.preventDefault();
    if (CM.modal && CM.modal.isOpen()) return; CM.acts['ux-f1']();
  });

  /* ---------- campana de avisos ---------- */
  function campana() {
    var box = d.getElementById('uxAvisos'); if (!box) return;
    var bt = d.getElementById('uxBell');
    if (!bt) {
      bt = d.createElement('button'); bt.type = 'button'; bt.id = 'uxBell'; bt.className = 'btn sm ux-bell'; bt.setAttribute('data-act', 'ux-bell'); bt.setAttribute('aria-expanded', 'false'); bt.setAttribute('aria-controls', 'uxAvisos'); bt.setAttribute('aria-haspopup', 'true');
      box.parentNode.insertBefore(bt, box); box.classList.add('ux-pop'); box.hidden = true;
      new MutationObserver(function () { pintarCampana(); }).observe(box, { childList: true });
    }
    pintarCampana();
  }
  function pintarCampana() {
    var bt = d.getElementById('uxBell'), box = d.getElementById('uxAvisos'); if (!bt || !box) return;
    var av = d.body.classList.contains('pub') ? [] : [].slice.call(box.querySelectorAll('.ux-av')), n = av.reduce(function (a, x) { var b = x.querySelector('b'); return a + (+(b && b.textContent) || 0); }, 0), bad = av.some(function (x) { return x.classList.contains('bad'); });
    bt.hidden = d.body.classList.contains('pub');
    bt.innerHTML = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2Z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg><span class="sr">Avisos</span>' + (n ? '<b class="ux-bn' + (bad ? '' : ' warn') + '">' + (n > 99 ? '99+' : n) + '</b>' : '');
    bt.setAttribute('aria-label', n ? n + ' aviso' + (n > 1 ? 's' : '') + ' pendientes' : 'Sin avisos pendientes');
    if (!box.querySelector('.ux-pop-h')) box.insertAdjacentHTML('afterbegin', '<div class="ux-pop-h"><b>Avisos</b><small>' + (av.length ? 'Tocá uno para ir a resolverlo' : '') + '</small></div>' + (av.length ? '' : '<p class="hint ux-pop-v">No hay avisos pendientes. 🎉</p>'));
  }
  function cerrarPop() { var b = d.getElementById('uxBell'), p = d.getElementById('uxAvisos'); if (p && !p.hidden) { p.hidden = true; if (b) b.setAttribute('aria-expanded', 'false'); } }
  CM.acts['ux-bell'] = function () {
    var b = d.getElementById('uxBell'), p = d.getElementById('uxAvisos'); if (!p) return;
    var ab = p.hidden; if (ab && CM.uxPintarAvisos) try { CM.uxPintarAvisos(); } catch (e) { /* nada */ } p.hidden = !ab; b.setAttribute('aria-expanded', String(ab));
    if (ab) { var f = p.querySelector('button'); if (f) f.focus(); }
  };
  d.addEventListener('click', function (e) {
    var p = d.getElementById('uxAvisos'); if (!p || p.hidden) return;
    if (e.target.closest('#uxBell')) return;
    if (e.target.closest('#uxAvisos [data-act]') || !e.target.closest('#uxAvisos')) setTimeout(cerrarPop, 0);
  }, true);
  d.addEventListener('keydown', function (e) { if (e.key === 'Escape') { var p = d.getElementById('uxAvisos'); if (p && !p.hidden) { cerrarPop(); var b = d.getElementById('uxBell'); if (b) b.focus(); e.stopPropagation(); } } }, true);

  /* ---------- menú público: doble clic o doble toque en el logo ---------- */
  var ult = 0, logo0 = CM.acts['pub-logo'];
  CM.acts['pub-logo'] = function (t, ev) {
    var cfg = CM.db.menu && CM.db.menu.pub; if (!cfg || !cfg.oculto || !cfg.oculto.activo) return;
    if (!d.body.classList.contains('pub')) return;   /* en la vista previa del administrador no navega */
    var now = Date.now();
    if (now - ult < 450) { ult = 0; CM.pub.toques = []; g.location.hash = '#/acceso'; return; }
    ult = now; if (logo0) logo0(t, ev);
  };

  CM.afterRender = (function (prev) {
    return function (r) {
      if (prev) prev(r);
      try { var nav = d.getElementById('nav'); if (nav) { badges(nav, avisos()); grupos(nav); } cta(); campana(); cerrarPop(); } catch (e) { /* nunca bloquear la pantalla por un adorno */ }
    };
  })(CM.afterRender);
  setInterval(function () { try { var nav = d.getElementById('nav'); if (!nav || d.body.classList.contains('pub')) return; [].forEach.call(nav.querySelectorAll('.nav-badge:not([data-sol])'), function (b) { if (!b.closest('a[href="#/solicitudes"]')) b.remove(); }); badges(nav, avisos()); [].forEach.call(nav.querySelectorAll('.nav-g'), function (w) { var n = 0; [].forEach.call(w.querySelectorAll('.nav-badge'), function (b) { n += +b.textContent || 0; }); var gn = w.querySelector('.nav-gn'); gn.textContent = n; gn.hidden = !n || !w.classList.contains('cerr'); }); } catch (e) { /* nada */ } }, 20000);
})(window);
