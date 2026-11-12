/* Sistema VB ONG · Experiencia de uso y diseño dinámico · 2026-11-11
   Adaptado del Sistema RAVE (V26.61 rediseño UX · V26.66 modo claro/oscuro) sin cambiar colores ni logo de Cannabismatica:
   · Tema Claro · Oscuro · Sistema (botón en la barra y en Configuración → Apariencia). Se guarda en cada equipo.
   · Menú agrupado: «Gestión de caja» es UNA entrada con pestañas (Caja · Cajas y traspasos · Arqueo y cierre · Cajas cerradas).
     Las rutas de siempre (#/caja, #/cierre, #/cajas-cerradas, #/cajas-tr) siguen funcionando.
   · Buscador universal (Ctrl + K o el botón «Buscar»): pacientes, lotes, personal, pantallas y acciones rápidas, tolerante a
     errores de tipeo (sin acentos, con letras cambiadas).
   · Avisos en la barra: REPROCANN vencidos o por vencer, stock bajo o agotado, solicitudes del menú, pedidos de RR. HH. y
     días con donaciones sin caja cerrada. Se actualizan solos y respetan los permisos.
   · Indicadores con mini gráficos de los últimos 14 días, tablas ordenables tocando el encabezado, transiciones suaves
     (respetando «reducir movimiento») y campos con error más visibles. */
(function (g) {
  'use strict';
  var CM = g.CM, esc = CM.esc, U = CM.U, VIEWS = CM.VIEWS, d = document;
  var render = function () { CM.render(); };

  /* =================================================================
     TEMA
     ================================================================= */
  var LS = 'cmv3_tema', mq = g.matchMedia ? g.matchMedia('(prefers-color-scheme: dark)') : null;
  CM.temaPref = function () { try { var v = g.cmPref ? g.cmPref.get(LS) : g.localStorage.getItem(LS); return v === 'oscuro' || v === 'sistema' ? v : 'claro'; } catch (e) { return 'claro'; } };   /* sin elección: claro, como siempre */
  CM.temaAplicar = function () { var p = CM.temaPref(), t = p === 'sistema' ? (mq && mq.matches ? 'oscuro' : 'claro') : p; d.documentElement.setAttribute('data-tema', t); var b = d.getElementById('btnTema'); if (b) { b.innerHTML = iconTema(p) + '<span>' + { claro: 'Claro', oscuro: 'Oscuro', sistema: 'Sistema' }[p] + '</span>'; b.setAttribute('aria-label', 'Tema: ' + p + '. Cambiar'); } return t; };
  CM.temaPoner = function (v) { try { if (g.cmPref) g.cmPref.set(LS, v); else g.localStorage.setItem(LS, v); } catch (e) { /* sin almacenamiento */ } CM.temaAplicar(); };
  if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (CM.temaPref() === 'sistema') CM.temaAplicar(); });
  function iconTema(p) { return '<svg class="i" viewBox="0 0 24 24" aria-hidden="true">' + (p === 'oscuro' ? '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>' : p === 'claro' ? '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>' : '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>') + '</svg>'; }
  CM.acts['tema-ciclo'] = function () { var o = ['claro', 'oscuro', 'sistema'], p = CM.temaPref(); CM.temaPoner(o[(o.indexOf(p) + 1) % 3]); CM.toast('Tema: ' + { claro: 'claro', oscuro: 'oscuro', sistema: 'el del sistema' }[CM.temaPref()] + '.'); };
  CM.acts['tema-set'] = function (t) { CM.temaPoner(t.getAttribute('data-v')); render(); };

  /* barra superior: buscar, avisos y tema */
  function prepararBarra() {
    var top = d.querySelector('header.top'); if (!top || d.getElementById('btnTema')) return;
    var grow = top.querySelector('.grow');
    var bs = d.createElement('button'); bs.type = 'button'; bs.className = 'btn sm ux-k'; bs.setAttribute('data-act', 'ux-buscar'); bs.innerHTML = CM.icon('search') + '<span>Buscar</span><kbd>Ctrl K</kbd>'; bs.setAttribute('aria-label', 'Buscar en todo el sistema (Ctrl + K)');
    var av = d.createElement('div'); av.id = 'uxAvisos'; av.className = 'ux-avisos'; av.setAttribute('role', 'status'); av.setAttribute('aria-live', 'polite');
    var bt = d.createElement('button'); bt.type = 'button'; bt.id = 'btnTema'; bt.className = 'btn sm ux-tema'; bt.setAttribute('data-act', 'tema-ciclo');
    if (grow) { grow.parentNode.insertBefore(bs, grow); grow.parentNode.insertBefore(av, grow.nextSibling); av.parentNode.insertBefore(bt, av.nextSibling); } else { top.appendChild(bs); top.appendChild(av); top.appendChild(bt); }
    CM.temaAplicar();
  }

  /* =================================================================
     MENÚ AGRUPADO: Gestión de caja con pestañas
     ================================================================= */
  var GRUPO_CAJA = [['caja', 'Caja actual', 'caja'], ['cajas-tr', 'Cajas y traspasos', 'caja'], ['cierre', 'Arqueo y cierre', 'cierre'], ['cajas-cerradas', 'Cajas cerradas', 'cerradas']];
  (function () {
    var N = CM.NAV, quitar = { 'cajas-tr': 1, cierre: 1, 'cajas-cerradas': 1 };
    for (var i = N.length - 1; i >= 0; i--) if (quitar[N[i][0]]) N.splice(i, 1);
    N.forEach(function (n) { if (n[0] === 'caja') n[1] = 'Gestión de caja'; });
  })();
  /* la entrada «Gestión de caja» aparece si el rol ve alguna de las cuatro */
  var vis0 = CM.visible;
  CM.visible = function (n) { if (n[0] === 'caja') return GRUPO_CAJA.some(function (x) { return vis0(['', '', '', x[2]]); }); return vis0(n); };
  function tabsCaja(cur) {
    return '<div class="tabs ux-grp" role="tablist" aria-label="Gestión de caja">' + GRUPO_CAJA.filter(function (x) { return !CM.can || CM.can(x[2], 'ver'); }).map(function (x) { return '<a role="tab" href="#/' + x[0] + '" aria-selected="' + (x[0] === cur) + '"' + (x[0] === cur ? ' aria-current="page"' : '') + '>' + esc(x[1]) + '</a>'; }).join('') + '</div>';
  }
  GRUPO_CAJA.forEach(function (x) { var v0 = VIEWS[x[0]]; if (!v0) return; VIEWS[x[0]] = function () { return tabsCaja(x[0]) + v0.apply(this, arguments); }; });

  /* =================================================================
     BUSCADOR UNIVERSAL (Ctrl + K)
     ================================================================= */
  function norm(s) { return CM.norm(String(s || '')).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function lev1(a, b) {   /* distancia ≤ 1 (una letra de más, de menos, cambiada o dos letras invertidas) */
    if (a === b) return true; var la = a.length, lb = b.length; if (Math.abs(la - lb) > 1) return false;
    var i = 0; while (i < la && i < lb && a[i] === b[i]) i++;
    if (la === lb) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
    return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
  }
  CM.uxPuntaje = function (q, texto) {
    q = norm(q); var t = norm(texto); if (!q || !t) return 0;
    if (t === q) return 100; if (t.indexOf(q) === 0) return 90; if (t.indexOf(' ' + q) >= 0) return 80; if (t.indexOf(q) >= 0) return 70;
    var pal = t.split(' '), qs = q.split(' '), ok = 0;
    qs.forEach(function (w) { if (pal.some(function (p) { return p.indexOf(w) === 0 || (w.length >= 4 && lev1(w, p.slice(0, w.length))) || (w.length >= 4 && lev1(w, p)); })) ok++; });
    return ok === qs.length ? 50 + Math.min(10, q.length) : 0;
  };
  var ACCIONES = [
    ['Nueva dispensación', 'flask', function () { CM.acts.dispensar({ getAttribute: function () { return ''; } }); }, 'dispensaciones'],
    ['Registrar donación', 'heart', function () { CM.acts.aporte({ getAttribute: function () { return ''; } }); }, 'aportes'],
    ['Nuevo paciente', 'users', function () { if (CM.acts['nuevo-paciente']) CM.acts['nuevo-paciente']({ getAttribute: function () { return ''; } }); }, 'pacientes'],
    ['Abrir caja', 'cash', function () { g.location.hash = '#/caja'; setTimeout(function () { if (CM.acts['caja-abrir'] && !CM.cajaAbierta()) CM.acts['caja-abrir'](); }, 120); }, 'caja'],
    ['Corte X de la caja', 'doc', function () { var c = CM.cajaAbierta(); if (!c) return CM.toast('No hay caja abierta.', true); CM.acts['cx-corte']({ getAttribute: function () { return c.id; } }); }, 'caja'],
    ['Traspaso entre cajas', 'swap', function () { CM.acts['tr-nuevo']({ getAttribute: function () { return (CM.cajaAbierta() || {}).id || ''; } }); }, 'caja'],
    ['Nuevo lote', 'box', function () { g.location.hash = '#/trazabilidad'; setTimeout(function () { CM.acts['lote-nuevo'](); }, 120); }, 'trazabilidad'],
    ['Fichar (modo kiosco)', 'key', function () { g.location.hash = '#/kiosco'; }, 'personal'],
    ['Pedir vacaciones o licencia', 'cal', function () { CM.acts['rh-ped-nuevo'](); }, 'personal'],
    ['Cambiar tema claro / oscuro', 'gear', function () { CM.acts['tema-ciclo'](); }, '']
  ];
  var SUBP = [['personal', 'equipo', 'Legajos del personal'], ['personal', 'pedidos', 'Vacaciones y pedidos'], ['personal', 'liq', 'Liquidación interna', 'rrhh'], ['personal', 'portal', 'Mi portal'], ['personal', 'calendario', 'Calendario del equipo'], ['personal', 'horas', 'Planilla de horas']];
  function resultados(q) {
    var out = [], db = CM.db;
    if (!CM.can || CM.can('pacientes', 'ver')) Object.keys(db.pacientes || {}).forEach(function (k) {
      var p = db.pacientes[k], doc = CM.docCorto ? CM.docCorto(p) : '', s = Math.max(CM.uxPuntaje(q, p.nombre), CM.uxPuntaje(q, p.leg || ''), q.replace(/\D/g, '').length >= 4 && String(doc).replace(/\D/g, '').indexOf(q.replace(/\D/g, '')) >= 0 ? 85 : 0);
      if (s) out.push({ s: s + 2, t: 'Paciente', n: p.nombre, d: (p.leg || '') + (doc ? ' · ' + doc : ''), h: '#/paciente/' + p.dni, i: 'users' });
    });
    if (!CM.can || CM.can('trazabilidad', 'ver')) CM.lotesVivos().forEach(function (l) { var s = Math.max(CM.uxPuntaje(q, l.nombre), CM.uxPuntaje(q, l.id), CM.uxPuntaje(q, l.genVar || '')); if (s) out.push({ s: s, t: 'Lote', n: l.nombre, d: l.id + ' · quedan ' + CM.fmtNum(CM.stockLote(l.id)) + ' ' + l.unidad, h: '#/trazabilidad', i: 'box' }); });
    if (!CM.can || CM.can('personal', 'ver')) (db.staff || []).forEach(function (e) { var s = CM.uxPuntaje(q, e.nombre); if (s) out.push({ s: s, t: 'Personal', n: e.nombre, d: e.cargo || '', fn: function () { CM.per.tab = 'equipo'; g.location.hash = '#/personal'; setTimeout(function () { CM.acts['rh-legajo'] && CM.acts['rh-legajo']({ getAttribute: function () { return e.id; } }); }, 150); }, i: 'clock' }); });
    CM.NAV.forEach(function (n) { if (n[0] === '-' || !CM.visible(n)) return; var s = CM.uxPuntaje(q, n[1]); if (s) out.push({ s: s - 1, t: 'Pantalla', n: n[1], d: '', h: '#/' + n[0], i: n[2] }); });
    GRUPO_CAJA.forEach(function (x) { if (CM.can && !CM.can(x[2], 'ver')) return; var s = CM.uxPuntaje(q, x[1]); if (s) out.push({ s: s - 1, t: 'Pantalla', n: x[1], d: 'Gestión de caja', h: '#/' + x[0], i: 'cash' }); });
    SUBP.forEach(function (x) { if (CM.can && !CM.can(x[3] || x[0], 'ver')) return; var s = CM.uxPuntaje(q, x[2]); if (s) out.push({ s: s - 1, t: 'Pantalla', n: x[2], d: 'Personal y RR. HH.', fn: function () { CM.per.tab = x[1]; if (g.location.hash === '#/personal') render(); else g.location.hash = '#/personal'; }, i: 'clock' }); });
    ACCIONES.forEach(function (a) { if (a[3] && CM.can && !CM.can(a[3], 'oper')) return; var s = CM.uxPuntaje(q, a[0]); if (s) out.push({ s: s - 3, t: 'Acción', n: a[0], d: '', fn: a[2], i: a[1] }); });
    return out.sort(function (a, b) { return b.s - a.s || String(a.n).localeCompare(String(b.n)); }).slice(0, 12);
  }
  CM.uxResultados = resultados;
  var UX = { sel: 0, res: [] };
  CM.acts['ux-buscar'] = function () {
    CM.modal.open({ title: 'Buscar en todo el sistema', body: '<label class="sr" for="uxQ">Qué buscás</label><input id="uxQ" class="in ux-q" autocomplete="off" placeholder="Paciente, legajo, DNI, lote, persona, pantalla o acción…" role="combobox" aria-expanded="true" aria-controls="uxRes"><ul id="uxRes" class="ux-res" role="listbox"></ul><p class="hint" style="margin:8px 0 0">↑ ↓ para moverte · Enter para abrir · Esc para cerrar. Tolera errores de tipeo.</p>', footer: '' });
    UX.sel = 0; UX.res = []; pintar('');
    setTimeout(function () { var i = d.getElementById('uxQ'); if (i) i.focus(); }, 30);
  };
  function pintar(q) {
    var ul = d.getElementById('uxRes'); if (!ul) return;
    UX.res = q.trim().length >= 2 ? resultados(q) : ACCIONES.filter(function (a) { return !a[3] || !CM.can || CM.can(a[3], 'oper'); }).slice(0, 6).map(function (a) { return { t: 'Acción', n: a[0], d: '', fn: a[2], i: a[1] }; });
    if (UX.sel >= UX.res.length) UX.sel = 0;
    ul.innerHTML = UX.res.length ? UX.res.map(function (r, i) { return '<li role="option" id="uxo' + i + '" aria-selected="' + (i === UX.sel) + '" data-act="ux-ir" data-i="' + i + '">' + CM.icon(r.i || 'search') + '<span><b>' + esc(r.n) + '</b>' + (r.d ? '<small>' + esc(r.d) + '</small>' : '') + '</span><em>' + esc(r.t) + '</em></li>'; }).join('') : '<li class="hint">Sin resultados. Probá con otra palabra.</li>';
    var inp = d.getElementById('uxQ'); if (inp) inp.setAttribute('aria-activedescendant', UX.res.length ? 'uxo' + UX.sel : '');
  }
  function ir(i) { var r = UX.res[i]; if (!r) return; CM.modal.close(true); if (r.fn) r.fn(); else if (r.h) { if (g.location.hash === r.h) render(); else g.location.hash = r.h; } }
  CM.acts['ux-ir'] = function (t) { ir(+t.getAttribute('data-i')); };
  d.addEventListener('input', function (ev) { if (ev.target.id === 'uxQ') { UX.sel = 0; pintar(ev.target.value); } });
  d.addEventListener('keydown', function (ev) {
    if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'k' || ev.key === 'K')) { if (d.body.classList.contains('pub') || (CM.sesionOk && !CM.sesionOk())) return; ev.preventDefault(); CM.acts['ux-buscar'](); return; }
    if (ev.target && ev.target.id === 'uxQ') {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); UX.sel = Math.min(UX.res.length - 1, UX.sel + 1); pintar(ev.target.value); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); UX.sel = Math.max(0, UX.sel - 1); pintar(ev.target.value); }
      else if (ev.key === 'Enter') { ev.preventDefault(); ir(UX.sel); }
    }
  });

  /* =================================================================
     AVISOS EN LA BARRA
     ================================================================= */
  CM.uxAvisos = function () {
    var db = CM.db, h = CM.hoy(), out = [], can = function (m) { return !CM.can || CM.can(m, 'ver'); };
    if (can('reprocann') && CM.estadoRep) {
      var venc = 0, prox = 0; Object.keys(db.pacientes || {}).forEach(function (k) { var e = CM.estadoRep(db.pacientes[k].reprocann); if (e.k === 'vencido') venc++; else if (e.k === 'valido' && e.prox) prox++; });
      if (venc) out.push({ k: 'rep', c: 'bad', n: venc, t: 'REPROCANN vencido' + (venc > 1 ? 's' : ''), h: '#/reprocann' });
      if (prox) out.push({ k: 'repp', c: 'warn', n: prox, t: 'REPROCANN por vencer', h: '#/reprocann' });
    }
    if (can('trazabilidad') && CM.stockLote) {
      var bajo = 0, ago = 0; CM.lotesVivos().forEach(function (l) { var s = CM.stockLote(l.id), ing = (db.movs || []).some(function (m) { return m.lote === l.id && m.tipo === 'ingreso'; }); if (!ing) return; if (s <= 0) ago++; else if (s <= (l.min || 0)) bajo++; });
      if (bajo) out.push({ k: 'stock', c: 'warn', n: bajo, t: 'Stock bajo', h: '#/trazabilidad' });
      if (ago && CM.lotesVivos().length - ago < 3) out.push({ k: 'agot', c: 'bad', n: ago, t: 'Lote' + (ago > 1 ? 's' : '') + ' agotado' + (ago > 1 ? 's' : ''), h: '#/trazabilidad' });
    }
    if (can('pacientes') && CM.solicitudesPendientes) { var s = CM.solicitudesPendientes(); if (s) out.push({ k: 'sol', c: 'bad', n: s, t: 'Solicitud' + (s > 1 ? 'es' : '') + ' del menú', h: '#/solicitudes', pulso: true }); }
    if (CM.can && CM.can('rrhh', 'edit')) { var r = (db.rhsol || []).filter(function (p) { return /^pendiente/.test(p.estado); }).length; if (r) out.push({ k: 'rh', c: 'warn', n: r, t: 'Pedido' + (r > 1 ? 's' : '') + ' de RR. HH.', fn: 'pedidos' }); }
    if (can('cerradas') && CM.diasSinCaja) { var dsc = CM.diasSinCaja().length; if (dsc) out.push({ k: 'caja', c: 'warn', n: dsc, t: 'Día' + (dsc > 1 ? 's' : '') + ' sin caja cerrada', h: '#/cajas-cerradas' }); }
    void h; return out;
  };
  function pintarAvisos() {
    var box = d.getElementById('uxAvisos'); if (!box) return;
    if (d.body.classList.contains('pub')) { box.innerHTML = ''; return; }
    var av = CM.uxAvisos();
    box.innerHTML = av.map(function (a) { return '<button type="button" class="ux-av ' + a.c + (a.pulso ? ' pulso' : '') + '" data-act="ux-aviso" data-k="' + a.k + '" title="' + esc(a.t) + '"><b>' + a.n + '</b><span>' + esc(a.t) + '</span></button>'; }).join('');
  }
  CM.uxPintarAvisos = pintarAvisos;
  CM.acts['ux-aviso'] = function (t) { var a = CM.uxAvisos().filter(function (x) { return x.k === t.getAttribute('data-k'); })[0]; if (!a) return; if (a.fn) { CM.per.tab = a.fn; if (g.location.hash === '#/personal') render(); else g.location.hash = '#/personal'; } else if (g.location.hash === a.h) render(); else g.location.hash = a.h; };
  setInterval(function () { try { pintarAvisos(); } catch (e) { /* datos a medio sincronizar */ } }, 20000);

  /* =================================================================
     MINI GRÁFICOS (últimos 14 días) en los indicadores
     ================================================================= */
  CM.uxSpark = function (vals, titulo) {
    var w = 120, h = 32, max = Math.max.apply(null, vals.concat([1])), n = vals.length, pts = vals.map(function (v, i) { return [Math.round(i * (w - 4) / Math.max(1, n - 1)) + 2, Math.round(h - 3 - (v / max) * (h - 8))]; });
    var path = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0] + ' ' + p[1]; }).join(' '), ult = pts[pts.length - 1];
    return '<svg class="ux-spark" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(titulo) + '"><path class="a" d="' + path + ' L' + ult[0] + ' ' + (h - 1) + ' L2 ' + (h - 1) + ' Z"/><path class="l" d="' + path + '"/><circle cx="' + ult[0] + '" cy="' + ult[1] + '" r="2.6"/></svg>';
  };
  function serie(arr, campo, filtro) {
    var hoy = CM.hoy(), v = []; for (var i = 13; i >= 0; i--) { var f = CM.addDays(hoy, -i); v.push(arr.filter(function (x) { return x.fecha === f && (!filtro || filtro(x)); }).reduce(function (a, x) { return a + (campo ? x[campo] || 0 : 1); }, 0)); }
    return v;
  }
  function sparks(r) {
    var m = d.getElementById('main'); if (!m) return;
    var db = CM.db, mapa = [];
    if (r.v === 'inicio') mapa = [['Dispensaciones del mes', serie(db.disp || [], '', function (x) { return !x.anulada; }), 'Dispensaciones por día, últimos 14 días'], ['Donaciones voluntarias del mes', serie(db.aportes || [], 'cent', function (x) { return x.estado === 'registrado'; }), 'Donaciones por día, últimos 14 días']];
    if (r.v === 'dashboard') mapa = [['Donaciones', serie(db.aportes || [], 'cent', function (x) { return x.estado === 'registrado'; }), 'Donaciones por día, últimos 14 días'], ['Dispensaciones', serie(db.disp || [], '', function (x) { return !x.anulada; }), 'Dispensaciones por día, últimos 14 días']];
    if (!mapa.length) return;
    m.querySelectorAll('.kpi').forEach(function (k) { var l = k.querySelector('.l'); if (!l || k.querySelector('.ux-spark')) return; var x = mapa.filter(function (y) { return l.textContent.indexOf(y[0]) === 0; })[0]; if (x) k.insertAdjacentHTML('beforeend', CM.uxSpark(x[1], x[2])); });
  }

  /* =================================================================
     TABLAS ORDENABLES
     ================================================================= */
  function valorCelda(td) {
    var t = (td.getAttribute('data-v') || td.textContent || '').trim();
    var f = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(t); if (f) { var y = f[3].length === 2 ? '20' + f[3] : f[3]; return { n: +(y + f[2].padStart(2, '0') + f[1].padStart(2, '0')) }; }
    var m = t.replace(/[^\d,.\-−]/g, '').replace('−', '-'); if (/\d/.test(m) && /^[−\-$\s\d.,%]+[a-zA-Záéíóú .]*$/.test(t.replace(/\s+/g, ' ').slice(0, 30))) { var v = CM.parseMonto ? CM.parseMonto(m.replace(/^-/, '')) : parseFloat(m); if (!isNaN(v)) return { n: /^[−-]/.test(t) ? -v : v }; }
    return { s: CM.norm(t) };
  }
  function ordenables() {
    var m = d.getElementById('main'); if (!m) return;
    m.querySelectorAll('table').forEach(function (tb) {
      if (tb.hasAttribute('data-nosort') || tb.dataset.ux) return; tb.dataset.ux = '1';
      var th = tb.tHead && tb.tHead.rows.length === 1 ? tb.tHead.rows[0].cells : null, body = tb.tBodies[0];
      if (!th || !body || body.rows.length < 3) return;
      if (Array.prototype.some.call(body.rows, function (r) { return r.cells.length !== th.length || r.classList.contains('tot'); })) return;
      Array.prototype.forEach.call(th, function (h, i) {
        if (!h.textContent.trim()) return;
        h.classList.add('ux-th'); h.setAttribute('aria-sort', 'none'); h.tabIndex = 0; h.title = 'Ordenar por ' + h.textContent.trim();
        function ord() {
          var asc = h.getAttribute('aria-sort') !== 'ascending';
          Array.prototype.forEach.call(th, function (x) { if (x.classList.contains('ux-th')) x.setAttribute('aria-sort', 'none'); });
          h.setAttribute('aria-sort', asc ? 'ascending' : 'descending');
          var rows = Array.prototype.slice.call(body.rows);
          rows.sort(function (a, b) { var x = valorCelda(a.cells[i]), y = valorCelda(b.cells[i]), r = x.n != null && y.n != null ? x.n - y.n : String(x.s != null ? x.s : x.n).localeCompare(String(y.s != null ? y.s : y.n), 'es', { numeric: true }); return asc ? r : -r; });
          rows.forEach(function (r) { body.appendChild(r); });
        }
        h.addEventListener('click', ord); h.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ord(); } });
      });
    });
  }

  /* =================================================================
     APARIENCIA en Configuración
     ================================================================= */
  var vAj = VIEWS.ajustes;
  if (vAj) VIEWS.ajustes = function () {
    var h = vAj.apply(this, arguments), p = CM.temaPref();
    var card = '<section class="card" style="margin-top:14px" id="uxApar"><h2>Apariencia</h2><p class="hint" style="margin:4px 0 10px">Se guarda en este equipo: cada computadora o celular puede tener el suyo. «Sistema» sigue el modo del equipo.</p><div class="tabs" role="group" aria-label="Tema">' +
      [['claro', 'Claro'], ['oscuro', 'Oscuro'], ['sistema', 'Sistema']].map(function (x) { return '<button type="button" data-act="tema-set" data-v="' + x[0] + '" aria-pressed="' + (p === x[0]) + '">' + iconTema(x[0]) + esc(x[1]) + '</button>'; }).join('') + '</div><p class="hint" style="margin:10px 0 0">Atajos: <kbd>Ctrl</kbd> + <kbd>K</kbd> busca en todo el sistema; tocando el encabezado de una tabla se ordena.</p></section>';
    var i = h.indexOf('<form class="card f" data-form="cfg-mods"');
    return i > 0 ? h.slice(0, i) + card + h.slice(i) : h + card;
  };

  /* =================================================================
     después de cada pantalla
     ================================================================= */
  CM.afterRender = (function (prev) {
    return function (r) {
      if (prev) prev(r);
      prepararBarra(); CM.temaAplicar();
      if (GRUPO_CAJA.some(function (x) { return x[0] === r.v; })) { var a = d.querySelector('#nav a[href="#/caja"]'); if (a) a.setAttribute('aria-current', 'page'); }
      try { pintarAvisos(); sparks(r); ordenables(); } catch (e) { /* nunca bloquear la pantalla por un adorno */ }
      var m = d.getElementById('main'); if (m) { m.classList.remove('ux-in'); void m.offsetWidth; m.classList.add('ux-in'); }
    };
  })(CM.afterRender);
  CM.temaAplicar();
})(window);
