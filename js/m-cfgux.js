/* Sistema VB ONG · Configuración dinámica · 2026-11-12 (adaptado de Sistema VB V27.7, demo Di Parma)
   La pantalla de Configuración era una columna larga. Esto NO cambia ni duplica ningún ajuste: toma lo que dibuja el sistema
   (los mismos campos, los mismos «Guardar» y las mismas validaciones) y lo ordena en:
   · un buscador «¿Qué querés cambiar?» (tecla /), sin importar tildes, que resalta el campo encontrado;
   · un índice por secciones con la cantidad de ajustes (en el celular, fichas horizontales);
   · tarjetas plegables con un resumen de una línea (la primera de cada sección, abierta);
   · «Sin guardar» en la tarjeta y en el índice, barra de Guardar fija mientras haya cambios y aviso al cerrar la pestaña;
   · si una validación falla en otra sección, se abre esa sección y la tarjeta del campo;
   · atajos a los otros ajustes del sistema (sólo los que el rol puede abrir). */
(function (g) {
  'use strict';
  var CM = g.CM, esc = CM.esc, d = document;
  var SECS = [
    { k: 'ong', t: 'La fundación', s: 'Datos de la ONG y formularios de Google', ic: 'home', m: /datos de la ong|formularios/i },
    { k: 'disp', t: 'Dispensa y REPROCANN', s: 'Reglas de la dispensación, bloqueos y topes', ic: 'flask', m: /dispensa|reprocann|tope/i },
    { k: 'din', t: 'Donaciones y facturación', s: 'Factura C, documento del receptor y rubros', ic: 'cash', m: /factura|rubro|donaci|caja/i },
    { k: 'sis', t: 'Sistema y apariencia', s: 'Módulos activos, tema y datos del sistema', ic: 'gear', m: /.*/ }
  ];
  var LINKS = [['usuarios', 'Usuarios y permisos', 'Quién entra y qué puede hacer'], ['perifericos', 'Periféricos y ticket', 'Impresora, cajón y ticket'], ['menu-publico', 'Menú público', 'Textos, servicios y acceso oculto'],
    ['nube', 'Nube', 'Sincronización y respaldo'], ['integraciones', 'Integraciones', 'Drive, ARCA y otros servicios'], ['personal', 'Ajustes de RR. HH.', 'Niveles, recargos y geocerca', 'rhcfg'],
    ['fidelizacion', 'Fidelización', 'Sellos, cupones y planes'], ['importexport', 'Importar / Exportar', 'Planillas y respaldo'], ['auditoria', 'Auditoría', 'Historial encadenado de cambios']];
  var ST = { sec: 'ong', q: '', open: {}, dirty: {} }, items = [];
  try { ST.sec = g.sessionStorage.getItem('cmv3_cfgsec') || 'ong'; } catch (e) { /* sin almacenamiento */ }
  function norm(s) { return CM.norm(String(s || '')); }
  function secDe(t) { for (var i = 0; i < SECS.length; i++) if (SECS[i].m.test(t)) return SECS[i].k; return 'sis'; }
  function resumen(body) {
    var ins = [].slice.call(body.querySelectorAll('input,select,textarea')).filter(function (i) { return i.type !== 'hidden'; }), chk = ins.filter(function (i) { return i.type === 'checkbox'; });
    var p = body.querySelector('p.hint,p'), help = p ? p.textContent.replace(/\s+/g, ' ').trim() : '', bits = [];
    if (ins.length - chk.length > 0) bits.push((ins.length - chk.length) + ' campo' + (ins.length - chk.length > 1 ? 's' : ''));
    if (chk.length) bits.push(chk.filter(function (i) { return i.checked; }).length + ' de ' + chk.length + ' opciones activas');
    if (help.length > 100) help = help.slice(0, 100) + '…';
    return help && !/^\s*$/.test(help) && !bits.length ? help : bits.join(' · ') || help;
  }
  function hacerItem(card, h2, nodos, i) {
    var t = h2.textContent.trim(), id = card.id || 'cfg' + i + '-' + norm(t).replace(/[^a-z0-9]+/g, '-').slice(0, 30);
    var body = d.createElement('div'); body.className = 'cfg-body'; body.id = id + '-b';
    nodos.forEach(function (n) { body.appendChild(n); });
    var head = d.createElement('button'); head.type = 'button'; head.className = 'cfg-head'; head.setAttribute('aria-expanded', 'false'); head.setAttribute('aria-controls', body.id);
    head.innerHTML = '<span class="cfg-ht"><b>' + esc(t) + '</b><small>' + esc(resumen(body)) + '</small></span><span class="cfg-dirty" hidden>Sin guardar</span><span class="cfg-chev" aria-hidden="true">' + CM.icon('right') + '</span>';
    card.classList.add('cfg-card'); card.id = id; card.appendChild(head); card.appendChild(body);
    var it = { c: card, t: t, sec: secDe(t), form: card.closest('form') || card.querySelector('form') };
    head.addEventListener('click', function () { ST.open[t] = !card.classList.contains('open'); pintar(); });
    var sucio = function (ev) { if (ev.target.closest && ev.target.closest('.cfg-head')) return; if (!ev.target.matches || !ev.target.matches('input,select,textarea')) return; ST.dirty[t] = 1; pintar(); };
    card.addEventListener('input', sucio); card.addEventListener('change', sucio);
    return it;
  }
  function mejorar() {
    var main = d.getElementById('main'); if (!main || main.querySelector('.cfg-wrap')) return;
    var cards = [].slice.call(main.children).filter(function (c) { return c.classList.contains('card') && !c.classList.contains('dev-card') && c.querySelector('h2'); });
    if (cards.length < 2) return;
    ST.dirty = {}; items = [];
    cards.forEach(function (c) {
      var hs = [].slice.call(c.children).filter(function (x) { return x.tagName === 'H2'; });
      if (hs.length > 1) {
        /* un formulario con varios títulos: cada título es una tarjeta; el «Guardar» queda en una barra fija del formulario */
        c.classList.add('cfg-form'); c.classList.remove('card');
        var kids = [].slice.call(c.childNodes), grupos = [], cur = null, pie = [], enPie = false;
        kids.forEach(function (n) {
          if (n.nodeType === 1 && n.matches('p[data-err]')) enPie = true;
          if (enPie) { pie.push(n); return; }
          if (n.nodeType === 1 && n.tagName === 'H2') { cur = { h: n, n: [] }; grupos.push(cur); return; }
          if (cur) cur.n.push(n); else pie.unshift(n);
        });
        grupos.forEach(function (gr) {
          var cd = d.createElement('div'); cd.className = 'card'; gr.h.remove(); gr.n.forEach(function (n) { if (n.style) n.style.marginTop = ''; });
          c.appendChild(cd); var it = hacerItem(cd, gr.h, gr.n, items.length); it.form = c; items.push(it);
        });
        var f = d.createElement('div'); f.className = 'cfg-foot'; pie.forEach(function (n) { f.appendChild(n); });
        f.insertAdjacentHTML('afterbegin', '<span class="cfg-foot-msg">Los cambios de estas tarjetas se guardan juntos.</span>');
        c.appendChild(f);
      } else {
        var h = c.querySelector('h2'), resto = [];
        h.remove();   /* si el título estaba en una fila con botones, la fila queda en el cuerpo */
        [].slice.call(c.childNodes).forEach(function (n) { resto.push(n); });
        if (c.style) c.style.marginTop = '';
        items.push(hacerItem(c, h, resto, items.length));
      }
    });
    var secs = SECS.filter(function (s) { return items.some(function (i) { return i.sec === s.k; }); });
    if (!secs.some(function (s) { return s.k === ST.sec; })) ST.sec = secs[0].k;
    var links = LINKS.filter(function (l) { return d.querySelector('#nav a[href="#/' + l[0] + '"]') && (!l[3] || CM.can('rrhh', 'admin')); });
    var wrap = d.createElement('div'); wrap.className = 'cfg-wrap';
    wrap.innerHTML = '<div class="cfg-search">' + CM.icon('search') + '<label class="sr" for="cfgQ">Buscar un ajuste</label><input id="cfgQ" type="search" autocomplete="off" placeholder="¿Qué querés cambiar? Ej.: CUIT, tope, formulario, tema, rubro…" value="' + esc(ST.q) + '"><kbd>/</kbd></div>' +
      '<div class="cfg-grid"><nav class="cfg-nav" aria-label="Secciones de la configuración">' + secs.map(function (s) {
        return '<button type="button" class="cfg-sec" data-cfgsec="' + s.k + '" aria-current="false"><span class="cfg-sic">' + CM.icon(s.ic) + '</span><span class="cfg-st"><b>' + esc(s.t) + '</b><small>' + esc(s.s) + '</small></span><span class="cfg-n" data-cfgn="' + s.k + '"></span></button>';
      }).join('') + (links.length ? '<div class="cfg-more"><span class="hint">Otros ajustes del sistema</span>' + links.map(function (l) { return '<a class="cfg-link" href="#/' + l[0] + '"' + (l[3] ? ' data-rhtab="' + l[3] + '"' : '') + '><b>' + esc(l[1]) + '</b><small>' + esc(l[2]) + '</small></a>'; }).join('') + '</div>' : '') +
      '</nav><section class="cfg-main" aria-live="polite"><div class="cfg-mhead"><div><h2 id="cfgT"></h2><p class="hint" id="cfgD"></p></div><div class="row"><button type="button" class="btn sm" data-cfgall="1">Abrir todo</button><button type="button" class="btn sm" data-cfgall="0">Cerrar todo</button></div></div>' +
      '<div class="cfg-list"></div><p class="cfg-empty empty" hidden>No hay ajustes con ese texto. Probá con otra palabra o mirá «Otros ajustes del sistema».</p></section></div>';
    main.insertBefore(wrap, cards[0]);
    var list = wrap.querySelector('.cfg-list');
    cards.forEach(function (c) { list.appendChild(c); });
    secs.forEach(function (s) { var f = items.filter(function (i) { return i.sec === s.k && i.c.querySelector('.cfg-body input:not([type=hidden]),.cfg-body select,.cfg-body textarea'); })[0] || items.filter(function (i) { return i.sec === s.k; })[0]; if (f && ST.open[f.t] === undefined) ST.open[f.t] = true; });
    wrap.addEventListener('click', function (e) {
      var b = e.target.closest('[data-cfgsec]');
      if (b) { ST.sec = b.getAttribute('data-cfgsec'); ST.q = ''; d.getElementById('cfgQ').value = ''; try { g.sessionStorage.setItem('cmv3_cfgsec', ST.sec); } catch (x) { /* nada */ } pintar(); if (g.innerWidth < 900) wrap.querySelector('.cfg-main').scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
      var a = e.target.closest('[data-cfgall]'); if (a) { var v = a.getAttribute('data-cfgall') === '1'; items.forEach(function (i) { if (visible(i)) ST.open[i.t] = v; }); pintar(); return; }
      var l = e.target.closest('[data-rhtab]'); if (l && CM.per) CM.per.tab = l.getAttribute('data-rhtab');
    });
    var q = d.getElementById('cfgQ');
    q.addEventListener('input', function () { ST.q = q.value; pintar(); });
    q.addEventListener('keydown', function (e) { if (e.key === 'Escape') { q.value = ''; ST.q = ''; pintar(); } });
    /* validación que falla en una tarjeta cerrada u otra sección: se abre */
    list.addEventListener('submit', function (e) {
      var f = e.target; setTimeout(function () {
        if (!d.body.contains(f)) return; var bad = f.querySelector('[aria-invalid="true"]'); if (!bad) return;
        var it = items.filter(function (i) { return i.c.contains(bad); })[0]; if (!it) return;
        ST.q = ''; q.value = ''; ST.sec = it.sec; ST.open[it.t] = true; pintar(); try { bad.focus(); bad.scrollIntoView({ block: 'center' }); } catch (x) { /* nada */ }
      }, 0);
    }, true);
    pintar();
  }
  function visible(i) {
    var q = norm(ST.q).trim(); if (!q) return i.sec === ST.sec;
    var txt = norm(i.t + ' ' + i.c.textContent + ' ' + [].slice.call(i.c.querySelectorAll('input,textarea')).map(function (x) { return x.placeholder || ''; }).join(' '));
    return q.split(/\s+/).every(function (w) { return txt.indexOf(w) >= 0; });
  }
  function pintar() {
    var q = norm(ST.q).trim(), vis = 0;
    items.forEach(function (i) {
      var v = visible(i), op = q ? v : !!ST.open[i.t]; i.c.hidden = !v; if (v) vis++;
      i.c.classList.toggle('open', op); i.c.querySelector('.cfg-head').setAttribute('aria-expanded', String(op));
      i.c.querySelector('.cfg-dirty').hidden = !ST.dirty[i.t]; i.c.classList.toggle('dirty', !!ST.dirty[i.t]);
      [].forEach.call(i.c.querySelectorAll('.cfg-hit'), function (x) { x.classList.remove('cfg-hit'); });
      if (q && v) [].forEach.call(i.c.querySelectorAll('label'), function (l) { var t = norm(l.textContent); if (q.split(/\s+/).every(function (w) { return t.indexOf(w) >= 0; })) l.classList.add('cfg-hit'); });
    });
    /* formularios partidos: la barra de Guardar se ve si alguna de sus tarjetas está a la vista; resalta si hay cambios */
    [].forEach.call(d.querySelectorAll('.cfg-form'), function (f) {
      var its = items.filter(function (i) { return i.form === f; }), alguna = its.some(function (i) { return !i.c.hidden; }), dn = its.some(function (i) { return ST.dirty[i.t]; });
      f.hidden = !alguna; var ft = f.querySelector('.cfg-foot'); if (!ft) return; ft.classList.toggle('dirty', dn);
      var m = ft.querySelector('.cfg-foot-msg'); if (m) m.textContent = dn ? 'Sin guardar: ' + its.filter(function (i) { return ST.dirty[i.t]; }).map(function (i) { return i.t; }).join(', ') + '.' : '«Guardar» guarda juntas estas ' + its.length + ' tarjetas.';
    });
    [].forEach.call(d.querySelectorAll('.cfg-sec'), function (b) {
      var k = b.getAttribute('data-cfgsec'), on = !q && k === ST.sec, n = b.querySelector('.cfg-n'), dn = items.filter(function (i) { return i.sec === k && ST.dirty[i.t]; }).length;
      b.classList.toggle('on', on); b.setAttribute('aria-current', on ? 'page' : 'false');
      n.textContent = dn ? dn + ' sin guardar' : items.filter(function (i) { return i.sec === k; }).length; n.classList.toggle('warn', !!dn);
    });
    var s = SECS.filter(function (x) { return x.k === ST.sec; })[0] || SECS[0], t = d.getElementById('cfgT'), de = d.getElementById('cfgD');
    if (t) t.textContent = q ? 'Resultados para «' + ST.q.trim() + '»' : s.t;
    if (de) de.textContent = q ? vis + ' ajuste' + (vis === 1 ? '' : 's') + ' encontrado' + (vis === 1 ? '' : 's') : s.s;
    var em = d.querySelector('.cfg-empty'); if (em) em.hidden = !!vis;
  }
  CM.cfgUx = { estado: ST, items: function () { return items; } };
  CM.afterRender = (function (prev) {
    return function (r) { if (prev) prev(r); if (r && r.v === 'ajustes') { try { mejorar(); } catch (e) { if (g.console) g.console.warn('cfg-ux', e); } } else items = []; };
  })(CM.afterRender);
  d.addEventListener('keydown', function (e) {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || /INPUT|TEXTAREA|SELECT/.test((d.activeElement || {}).tagName || '') || (CM.modal && CM.modal.isOpen())) return;
    var q = d.getElementById('cfgQ'); if (q) { e.preventDefault(); q.focus(); }
  });
  g.addEventListener('beforeunload', function (e) { if (d.getElementById('cfgQ') && Object.keys(ST.dirty).length) { e.preventDefault(); e.returnValue = ''; } });
})(window);
