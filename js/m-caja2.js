/* Sistema VB ONG · Caja v2: cambio en efectivo, caja principal, traspasos, consolidado y cortes X / Z · 2026-11-11
   Adaptado del Sistema RAVE (V26 · 4.14 cajas flexibles, V26.49 cortes X/Z) sin cambiar cómo trabaja hoy la ONG:
   · Cada equipo sigue teniendo SU caja (abrir, movimientos, arqueo, cierre sellado). Nada de eso cambia.
   · CAMBIO: una donación con «Recibido» mayor al total suma por el medio recibido y agrega una salida de efectivo
     «Cambio entregado» (renglón derivado, no editable). El arqueo cierra y la salida queda justificada.
   · CAJA PRINCIPAL (tesorería, opcional): una caja que no es de ningún equipo; recibe y envía efectivo por TRASPASOS.
     Un traspaso es un único registro (colección ctransf, sólo se agrega) entre dos cajas abiertas. NO es ingreso ni egreso:
     sólo mueve el efectivo esperado de cada caja (no hay doble conteo). Se corrige con un traspaso inverso vinculado.
   · CONSOLIDADO: lectura de todas las cajas abiertas (de todos los equipos) y de la principal. No mueve nada.
   · CORTE X: foto del turno sin cerrar la caja (colección cortesx, sólo se agrega), numerada X-<caja>-<n>, imprimible.
   · CORTE Z: el cierre sellado de siempre lleva su número correlativo por caja (Z-<equipo>-<n>) dentro del sello.
   Requiere supabase/07-caja-traspasos-cortes.sql en la nube. */
(function (g) {
  'use strict';
  var CM = g.CM, esc = CM.esc, U = CM.U, $ = U.$, fl = U.fl, opt = U.opt, fail = U.fail, VIEWS = CM.VIEWS;
  var render = function () { CM.render(); };
  function money(c) { return CM.fmtMoney(c); }
  function arr(k) { if (!Array.isArray(CM.db[k])) CM.db[k] = []; return CM.db[k]; }
  function nubeEq() { var N = CM.nube; return N && N.activa && !N.anon && CM.db._s ? (CM.db._s.eq || 1) : null; }
  function pageH(t, p, extra) { return '<div class="page-h"><div><h1>' + esc(t) + '</h1>' + (p ? '<p>' + p + '</p>' : '') + '</div>' + (extra || '') + '</div>'; }
  function caja(id) { return CM.db.cajas.filter(function (c) { return c.id === id; })[0] || null; }
  function aporte(id) { return CM.db.aportes.filter(function (a) { return a.id === id; })[0] || null; }
  CM.cajaNombre = function (c) { if (typeof c === 'string') c = caja(c) || { id: c }; return c.principal ? 'Caja principal (' + c.id + ')' : 'Caja ' + (c.nro != null ? 'del equipo ' + c.nro + ' ' : '') + '(' + c.id + ')'; };

  /* ---------- cuál es la caja de este equipo / la principal ---------- */
  CM.cajaAbierta = function () {
    var eq = nubeEq(), c = CM.db.cajas.filter(function (x) { return x.estado === 'abierta' && !x.principal && (eq == null || x.nro === eq); });
    return c.length ? c[c.length - 1] : null;
  };
  CM.cajaPrincipal = function () { var c = CM.db.cajas.filter(function (x) { return x.estado === 'abierta' && x.principal; }); return c.length ? c[c.length - 1] : null; };
  CM.cajasAbiertas = function () { return CM.db.cajas.filter(function (x) { return x.estado === 'abierta'; }); };

  /* ---------- movimientos: cambio y traspasos ---------- */
  var movsBase = CM.cajaMovs;
  CM.cajaMovs = function (cj) {
    if (cj.estado === 'cerrada' && cj.cierre) return cj.cierre.movs;
    var ms = movsBase(cj), out = [], vistos = {};
    if (cj.principal) ms = ms.filter(function (m) { return !(m.derivado && /^AP-/.test(m.id)); });   /* la principal no recibe donaciones directas */
    ms.forEach(function (m) {
      if (m.derivado && m.ref && /^AP-/.test(m.id)) {
        var a = aporte(m.ref);
        if (a && a.cambio > 0 && !vistos[a.id] && m.medio === (a.cmMedio || a.medio)) {
          vistos[a.id] = a; var n = {}; Object.keys(m).forEach(function (k) { n[k] = m[k]; });
          n.cent = m.cent + a.cambio; n.motivo = m.motivo + ' · recibido ' + money(n.cent); out.push(n); return;
        }
      }
      out.push(m);
    });
    Object.keys(vistos).forEach(function (id) {
      var a = vistos[id];
      out.push({ id: 'CB-' + a.id, ts: a.ts, tipo: 'egreso', cent: a.cambio, medio: 'efectivo', rubroId: 'R-CB', rubroN: 'Cambio entregado', motivo: 'Cambio de la donación ' + a.id + ' (recibido ' + money(a.recibido) + (a.cmMedio && a.cmMedio !== 'efectivo' ? ' por ' + (CM.MEDIOS[a.cmMedio] || a.cmMedio).toLowerCase() : '') + ')', user: a.user, ref: a.id, derivado: true, fc: !!a.comp });
    });
    arr('ctransf').forEach(function (t) {
      if (t.de === cj.id) out.push({ id: 'TS-' + t.id, ts: t.ts, tipo: 'tr-sal', cent: t.cent, medio: 'efectivo', rubroId: 'R-TR', rubroN: 'Traspaso entre cajas', motivo: 'A ' + CM.cajaNombre(t.a) + ' · ' + t.motivo, user: t.user, ref: t.id, derivado: true });
      if (t.a === cj.id) out.push({ id: 'TE-' + t.id, ts: t.ts, tipo: 'tr-ent', cent: t.cent, medio: 'efectivo', rubroId: 'R-TR', rubroN: 'Traspaso entre cajas', motivo: 'Desde ' + CM.cajaNombre(t.de) + ' · ' + t.motivo, user: t.user, ref: t.id, derivado: true });
    });
    return out.sort(function (a, b) { return String(a.ts).localeCompare(String(b.ts)); });
  };
  /* totales: los traspasos no son ingresos ni egresos; el cambio es una salida de efectivo que no resta de las donaciones */
  CM.totCaja = function (cj, movs) {
    movs = movs || CM.cajaMovs(cj);
    var t = { inicial: cj.inicial, porMedio: {}, ingresos: 0, egresos: 0, ingEf: 0, egEf: 0, esperadoEf: 0, conFC: 0, sinFC: 0, trIn: 0, trOut: 0, cambio: 0 };
    movs.forEach(function (m) {
      if (m.tipo === 'tr-ent') { t.trIn += m.cent; return; }
      if (m.tipo === 'tr-sal') { t.trOut += m.cent; return; }
      if (m.tipo === 'ingreso') {
        t.ingresos += m.cent; t.porMedio[m.medio] = (t.porMedio[m.medio] || 0) + m.cent;
        if (m.medio === 'efectivo') t.ingEf += m.cent;
        if (m.derivado || m.ref) { if (m.fc) t.conFC += m.cent; else t.sinFC += m.cent; }
      } else {
        t.egresos += m.cent; if (m.medio === 'efectivo') t.egEf += m.cent;
        if (/^CB-/.test(m.id)) { t.cambio += m.cent; if (m.fc) t.conFC -= m.cent; else t.sinFC -= m.cent; }
      }
    });
    t.esperadoEf = t.inicial + t.ingEf - t.egEf + t.trIn - t.trOut;
    return t;
  };
  /* corte Z: número correlativo por caja, dentro del sello */
  function zSiguiente(cj) {
    var k = cj.principal ? 'P' : String(cj.nro != null ? cj.nro : 1);
    var n = CM.db.cajas.filter(function (c) { return c.cierre && c.cierre.z && c.cierre.z.split('-')[1] === k; }).length + 1;
    return 'Z-' + k + '-' + n;
  }
  var cerrarBase = CM.cerrarCaja;
  CM.cerrarCaja = function (cj, dec, obs, ts) {
    var z = zSiguiente(cj), c = cerrarBase(cj, dec, obs, ts), t = CM.totCaja(cj, c.movs);
    c.z = z; if (t.trIn) c.trIn = t.trIn; if (t.trOut) c.trOut = t.trOut; if (cj.principal) c.principal = true;
    c.hash = CM.hashCierre(c);
    return c;
  };
  /* movimientos manuales en una caja determinada (la principal) */
  var addBase = CM.addCMov;
  CM.addCMov = function (o) {
    if (!o.caja) return addBase(o);
    var cj = caja(o.caja); if (!cj || cj.estado !== 'abierta') return { err: 'Esa caja no está abierta.' };
    var prev = CM.cajaAbierta; CM.cajaAbierta = function () { return cj; };
    try { return addBase(o); } finally { CM.cajaAbierta = prev; }
  };

  /* ---------- botones extra en Caja y Z en los cierres ---------- */
  var vCaja = VIEWS.caja;
  VIEWS.caja = function () {
    var h = vCaja.apply(this, arguments), ab = CM.cajaAbierta();
    if (!ab) return h + '<p class="hint" style="margin-top:12px"><a href="#/cajas-tr">Cajas y traspasos</a>: caja principal, traspasos y consolidado de todos los equipos.</p>';
    var extra = '<button class="btn" data-act="cx-corte" data-caja="' + esc(ab.id) + '">' + CM.icon('doc') + 'Corte X</button>' +
      '<button class="btn" data-act="tr-nuevo" data-de="' + esc(ab.id) + '">' + CM.icon('swap') + 'Traspaso</button>' +
      (CM.abrirCajon ? '<button class="btn" data-act="tk-cajon">' + CM.icon('cash') + 'Abrir cajón</button>' : '') + '<a class="btn" href="#/cajas-tr">Cajas y traspasos</a>';
    var marca = '<button class="btn" data-act="caja-mov" data-tipo="reintegro">Reintegro</button>';
    h = h.indexOf(marca) >= 0 ? h.replace(marca, marca + extra) : h + '<div class="row" style="margin:14px 0">' + extra + '</div>';
    var t = CM.totCaja(ab);
    if (t.trIn || t.trOut || t.cambio) h += '<div class="note info" style="margin-top:14px">En esta caja: ' + [t.trIn ? 'traspasos recibidos ' + money(t.trIn) : '', t.trOut ? 'traspasos enviados ' + money(t.trOut) : '', t.cambio ? 'cambio entregado en efectivo ' + money(t.cambio) : ''].filter(Boolean).join(' · ') + '. Los traspasos no cuentan como ingresos ni egresos: sólo mueven el efectivo esperado.</div>';
    return h + cortesLista(ab.id);
  };
  var vCierre = VIEWS.cierre;
  VIEWS.cierre = function () {
    var h = vCierre.apply(this, arguments), ab = CM.cajaAbierta(); if (!ab) return h;
    var t = CM.totCaja(ab), extra = (t.trIn || t.trOut ? '<div><small>Traspasos (recibidos − enviados)</small><b>' + esc(money(t.trIn - t.trOut)) + '</b></div>' : '') + (t.cambio ? '<div><small>Cambio entregado</small><b>' + esc(money(t.cambio)) + '</b></div>' : '') + '<div><small>Se cierra como</small><b>' + esc(zSiguiente(ab)) + '</b></div>';
    return h.replace('<div><small>Efectivo esperado</small><b id="arEsp"', extra + '<div><small>Efectivo esperado</small><b id="arEsp"');
  };

  /* ---------- corte X ---------- */
  function textoCorte(x) {
    var L = [], W = CM.tkCfg ? (CM.tkCfg().ancho === 58 ? 32 : 42) : 42, r = '-'.repeat(W);
    function lr(a, b) { a = String(a); b = String(b); var s = W - a.length - b.length; return s > 0 ? a + ' '.repeat(s) + b : a.slice(0, Math.max(0, W - b.length - 1)) + ' ' + b; }
    L.push('FUNDACION CANNABISMATICA I+D', 'CORTE X ' + x.n + ' (no cierra la caja)', CM.fmtFH(x.ts), x.user, CM.cajaNombre(x.caja), r);
    L.push(lr('Fondo inicial', money(x.inicial)), lr('Donaciones (' + x.nDon + ')', money(x.donaciones)), lr('Otros ingresos', money(x.ingresos - x.donaciones)));
    if (Object.keys(x.porMedio || {}).length) L.push('Ingresos por medio (con lo recibido):');
    Object.keys(x.porMedio || {}).forEach(function (k) { L.push(lr('  ' + (CM.MEDIOS[k] || k), money(x.porMedio[k]))); });
    L.push(lr('Egresos y retiros', money(x.egresos - x.cambio)));
    if (x.cambio) L.push(lr('Cambio entregado', money(x.cambio)));
    if (x.trIn || x.trOut) L.push(lr('Traspasos recibidos', money(x.trIn)), lr('Traspasos enviados', money(x.trOut)));
    L.push(r, lr('EFECTIVO ESPERADO', money(x.esperadoEf)), r, 'Desarrollado por VINCULAR BUSINESS');
    return L.join('\n');
  }
  CM.acts['cx-corte'] = function (t) {
    if (!CM.need('caja', 'oper')) return;
    var cj = caja(t.getAttribute('data-caja')); if (!cj || cj.estado !== 'abierta') return CM.toast('No hay caja abierta.', true);
    var ms = CM.cajaMovs(cj), tt = CM.totCaja(cj, ms), don = ms.filter(function (m) { return m.tipo === 'ingreso' && /^AP-/.test(m.id); });
    var k = arr('cortesx').filter(function (x) { return x.caja === cj.id; }).length + 1;
    var x = { id: CM.nextId('CX'), n: 'X-' + (cj.principal ? 'P' : cj.nro != null ? cj.nro : 1) + '-' + cj.id.split('-').pop() + '-' + k, k: k, caja: cj.id, fecha: CM.hoy(), ts: new Date().toISOString(), user: CM.db.cfg.operador,
      inicial: cj.inicial, ingresos: tt.ingresos, egresos: tt.egresos, donaciones: don.reduce(function (a, m) { return a + m.cent; }, 0) - tt.cambio, nDon: {}, porMedio: tt.porMedio, cambio: tt.cambio, trIn: tt.trIn, trOut: tt.trOut, esperadoEf: tt.esperadoEf };
    var refs = {}; don.forEach(function (m) { refs[m.ref] = 1; }); x.nDon = Object.keys(refs).length;
    x.texto = textoCorte(x); x.hash = CM.sha256(JSON.stringify(x));
    arr('cortesx').push(x); CM.audit('Corte X', x.n + ' · ' + cj.id + ' · efectivo esperado ' + money(x.esperadoEf)); CM.save(); render();
    verCorte(x);
  };
  function verCorte(x) {
    CM.modal.open({ title: 'Corte X ' + x.n, body: '<pre class="tk tk' + (CM.tkCfg ? CM.tkCfg().ancho : 80) + '" style="margin:0 auto">' + esc(x.texto) + '</pre><p class="hint">Es una foto del turno: la caja sigue abierta. Queda guardado y se puede reimprimir.</p>', footer: '<button class="btn" data-act="modal-close">Cerrar</button><button class="btn pri" data-act="cx-print" data-id="' + esc(x.id) + '">' + CM.icon('print') + 'Imprimir</button>' });
  }
  CM.acts['cx-ver'] = function (t) { var x = arr('cortesx').filter(function (y) { return y.id === t.getAttribute('data-id'); })[0]; if (x) verCorte(x); };
  CM.acts['cx-print'] = function (t) { var x = arr('cortesx').filter(function (y) { return y.id === t.getAttribute('data-id'); })[0]; if (x) CM.ticketImprimir ? CM.ticketImprimir('Corte X ' + x.n, x.texto) : CM.imprimir('<pre class="tk tkp">' + esc(x.texto) + '</pre>'); };
  function cortesLista(cajaId) {
    var L = arr('cortesx').filter(function (x) { return !cajaId || x.caja === cajaId; }).slice().sort(function (a, b) { return String(b.ts).localeCompare(String(a.ts)); }).slice(0, 10);
    if (!L.length) return '';
    return '<section class="card" style="margin-top:14px"><h2>Cortes X ' + (cajaId ? 'de esta caja' : 'recientes') + '</h2><div class="tw"><table><thead><tr><th>N.º</th><th>Hora</th><th>Caja</th><th>Usuario</th><th class="n">Efectivo esperado</th><th></th></tr></thead><tbody>' + L.map(function (x) {
      return '<tr><td>' + esc(x.n) + '</td><td>' + esc(CM.fmtFH(x.ts)) + '</td><td>' + esc(x.caja) + '</td><td>' + esc(x.user) + '</td><td class="n">' + esc(money(x.esperadoEf)) + '</td><td><button class="btn sm" data-act="cx-ver" data-id="' + esc(x.id) + '">Ver</button></td></tr>';
    }).join('') + '</tbody></table></div></section>';
  }

  /* ---------- traspasos ---------- */
  CM.acts['tr-nuevo'] = function (t) {
    if (!CM.need('caja', 'oper')) return;
    var abiertas = CM.cajasAbiertas(); if (abiertas.length < 2) return CM.toast('Para un traspaso tiene que haber dos cajas abiertas (por ejemplo, la de este equipo y la principal).', true);
    var de = t.getAttribute('data-de') || '', mias = abiertas.filter(function (c) { return c.principal || c === CM.cajaAbierta(); });
    CM.modal.open({
      title: 'Traspaso de efectivo entre cajas',
      body: '<form id="fTR" data-form="tr" class="f" autocomplete="off" novalidate><div class="f f2">' +
        fl('Desde *', '<select class="in" name="de">' + mias.map(function (c) { return opt(c.id, CM.cajaNombre(c) + ' · esperado ' + money(CM.totCaja(c).esperadoEf), c.id === de); }).join('') + '</select>') +
        fl('Hacia *', '<select class="in" name="a"><option value="">Elegí la caja…</option>' + abiertas.map(function (c) { return opt(c.id, CM.cajaNombre(c) + (c.apUser ? ' · ' + c.apUser : '')); }).join('') + '</select>') + '</div>' +
        fl('Importe en efectivo (en pesos) *', '<input class="in num" name="importe" inputmode="decimal" placeholder="0" style="font-size:20px">') +
        fl('Motivo *', '<input class="in" name="motivo" maxlength="120" placeholder="Ej.: retiro del día a la caja principal">') +
        '<p class="hint" style="margin:0">No es un ingreso ni un egreso: el efectivo pasa de una caja a la otra. No se edita ni se borra; si hay un error se hace el traspaso inverso.</p><p class="err" role="alert" data-err></p></form>',
      footer: '<button class="btn" type="button" data-act="modal-close">Cancelar</button><button class="btn pri" type="submit" form="fTR">Registrar traspaso</button>'
    });
  };
  CM.forms.tr = function (f) {
    if (f.dataset.busy || !CM.need('caja', 'oper')) return;
    var e = f.elements, de = caja(e.de.value), a = caja(e.a.value), cent = CM.parseMonto(e.importe.value), mot = e.motivo.value.trim();
    if (!de || de.estado !== 'abierta') return fail(f, 'de', 'La caja de origen tiene que estar abierta.');
    if (!a || a.estado !== 'abierta') return fail(f, 'a', 'Elegí una caja de destino abierta.');
    if (a.id === de.id) return fail(f, 'a', 'Elegí una caja distinta de la de origen.');
    if (isNaN(cent) || cent <= 0) return fail(f, 'importe', 'Escribí un importe mayor que cero.');
    var disp = CM.totCaja(de).esperadoEf; if (cent > disp) return fail(f, 'importe', 'La caja de origen tiene ' + money(disp) + ' de efectivo esperado: no alcanza.');
    if (mot.length < 4) return fail(f, 'motivo', 'Escribí el motivo.');
    f.dataset.busy = '1';
    var t = { id: CM.nextId('TR'), fecha: CM.hoy(), ts: new Date().toISOString(), de: de.id, a: a.id, cent: cent, motivo: mot, user: CM.db.cfg.operador, ref: e.ref ? e.ref.value : '' };
    arr('ctransf').push(t); CM.audit('Traspaso entre cajas', t.id + ' · ' + de.id + ' → ' + a.id + ' · ' + money(cent) + ' · ' + mot);
    CM.save(); CM.modal.close(true); render(); CM.toast('Traspaso registrado.');
  };
  CM.acts['tr-revertir'] = function (t) {
    if (!CM.need('caja', 'edit')) return;
    var x = arr('ctransf').filter(function (y) { return y.id === t.getAttribute('data-id'); })[0]; if (!x) return;
    if (arr('ctransf').some(function (y) { return y.ref === x.id; })) return CM.toast('Ese traspaso ya fue revertido.', true);
    var de = caja(x.a), a = caja(x.de);
    if (!de || de.estado !== 'abierta' || !a || a.estado !== 'abierta') return CM.toast('Para revertirlo las dos cajas tienen que seguir abiertas. Si alguna ya cerró, hacé un traspaso nuevo con el motivo.', true);
    CM.modal.open({ title: 'Revertir traspaso ' + x.id, body: '<form id="fTRR" data-form="tr" class="f" novalidate><input type="hidden" name="de" value="' + esc(de.id) + '"><input type="hidden" name="a" value="' + esc(a.id) + '"><input type="hidden" name="ref" value="' + esc(x.id) + '"><input type="hidden" name="importe" value="' + esc(String(x.cent / 100).replace('.', ',')) + '">' +
      '<p style="margin:0">Se registra un traspaso inverso de <b>' + esc(money(x.cent)) + '</b> desde ' + esc(CM.cajaNombre(de)) + ' hacia ' + esc(CM.cajaNombre(a)) + '. El original no se borra.</p>' + fl('Motivo de la reversión *', '<input class="in" name="motivo" maxlength="120">') + '<p class="err" role="alert" data-err></p></form>',
      footer: '<button class="btn" data-act="modal-close">Cancelar</button><button class="btn pri" type="submit" form="fTRR">Revertir</button>' });
  };

  /* ---------- caja principal ---------- */
  CM.acts['cp-abrir'] = function () {
    if (!CM.need('cierre', 'admin')) return;
    if (CM.cajaPrincipal()) return CM.toast('La caja principal ya está abierta.', true);
    CM.modal.open({ title: 'Abrir caja principal', body: '<form id="fCP" data-form="cp-abrir" class="f" autocomplete="off" novalidate><p style="margin:0;color:var(--mu)">La caja principal (tesorería) no es de ningún equipo: recibe el efectivo de las cajas por traspasos y se arquea y cierra aparte.</p>' + fl('Fondo inicial en efectivo (en pesos) *', '<input class="in num" name="ini" inputmode="decimal" placeholder="0" style="font-size:20px">') + '<p class="err" role="alert" data-err></p></form>', footer: '<button class="btn" type="button" data-act="modal-close">Cancelar</button><button class="btn pri" type="submit" form="fCP">Abrir</button>' });
  };
  CM.forms['cp-abrir'] = function (f) {
    if (!CM.need('cierre', 'admin')) return;
    if (CM.cajaPrincipal()) return fail(f, 'ini', 'Ya está abierta.');
    var c = CM.parseMonto(f.elements.ini.value); if (isNaN(c)) return fail(f, 'ini', 'Escribí el fondo inicial (0 si empieza vacía).');
    var n = CM.db.cajas.filter(function (x) { return x.principal; }).length + 1, id = 'CJ-P-' + String(n).padStart(5, '0');
    while (caja(id)) { n++; id = 'CJ-P-' + String(n).padStart(5, '0'); }
    CM.db.cajas.push({ id: id, nro: 0, principal: true, fecha: CM.hoy(), estado: 'abierta', apTs: new Date().toISOString(), apUser: CM.db.cfg.operador, inicial: c, cierre: null });
    CM.audit('Apertura de caja principal', id + ' · fondo ' + money(c)); CM.save(); CM.modal.close(true); render(); CM.toast('Caja principal abierta.');
  };
  CM.acts['cp-mov'] = function (t) {
    if (!CM.need('caja', 'oper')) return;
    var cp = CM.cajaPrincipal(); if (!cp) return;
    var tipo = t.getAttribute('data-tipo'), rs = CM.rubrosPara(tipo), TIT = { ingreso: 'Ingreso', egreso: 'Egreso', retiro: 'Retiro', reintegro: 'Reintegro' };
    CM.modal.open({ title: TIT[tipo] + ' · caja principal', body: '<form id="fCPM" data-form="cp-mov" class="f" autocomplete="off" novalidate><input type="hidden" name="tipo" value="' + esc(tipo) + '">' +
      fl('Rubro financiero * (obligatorio)', '<select class="in" name="rubro"><option value="">Elegí un rubro…</option>' + rs.map(function (r) { return opt(r.id, r.n); }).join('') + '</select>') +
      fl('Importe (en pesos) *', '<input class="in num" name="importe" inputmode="decimal" placeholder="0" style="font-size:20px">') + fl(tipo === 'ingreso' ? 'Detalle (opcional)' : 'Motivo *', '<input class="in" name="motivo">') + '<p class="err" role="alert" data-err></p></form>',
      footer: '<button class="btn" type="button" data-act="modal-close">Cancelar</button><button class="btn pri" type="submit" form="fCPM">Registrar</button>' });
  };
  CM.forms['cp-mov'] = function (f) {
    var cp = CM.cajaPrincipal(); if (!cp) return;
    var e = f.elements, cent = CM.parseMonto(e.importe.value);
    if (isNaN(cent) || cent <= 0) return fail(f, 'importe', 'Escribí un importe mayor que cero.');
    var r = CM.addCMov({ caja: cp.id, tipo: e.tipo.value, cent: cent, rubroId: e.rubro.value, motivo: e.motivo.value });
    if (r.err) return fail(f, /rubro/i.test(r.err) ? 'rubro' : (/motivo/i.test(r.err) ? 'motivo' : 'importe'), r.err);
    CM.audit('Movimiento de caja principal', e.tipo.value + ' · ' + money(cent) + ' · rubro ' + r.ok.rubroN + ' · ' + r.ok.id); CM.save(); CM.modal.close(true); render(); CM.toast('Movimiento registrado.');
  };
  CM.acts['cp-cerrar'] = function () {
    if (!CM.need('cierre', 'admin')) return;
    var cp = CM.cajaPrincipal(); if (!cp) return;
    var t = CM.totCaja(cp);
    CM.modal.open({ title: 'Arqueo y cierre de la caja principal', body: '<form id="fCPC" data-form="cp-cerrar" class="f" autocomplete="off" novalidate><div class="kv"><div><small>Efectivo esperado</small><b>' + esc(money(t.esperadoEf)) + '</b></div><div><small>Se cierra como</small><b>' + esc(zSiguiente(cp)) + '</b></div></div>' +
      fl('Efectivo contado (en pesos) *', '<input class="in num" name="tot" inputmode="decimal" placeholder="0" style="font-size:20px">') + fl('Observaciones (obligatorias si hay diferencia)', '<textarea class="in" name="obs"></textarea>') +
      '<div class="note warn">El cierre se congela con un sello SHA-256: no se puede editar ni borrar.</div><p class="err" role="alert" data-err></p></form>', footer: '<button class="btn" type="button" data-act="modal-close">Cancelar</button><button class="btn pri" type="submit" form="fCPC">' + CM.icon('lock') + 'Cerrar y sellar</button>' });
  };
  CM.forms['cp-cerrar'] = function (f) {
    if (!CM.need('cierre', 'admin')) return;
    var cp = CM.cajaPrincipal(); if (!cp) return;
    var dec = CM.parseMonto(f.elements.tot.value), obs = f.elements.obs.value.trim(); if (isNaN(dec)) return fail(f, 'tot', 'Escribí el efectivo contado (0 si no hay).');
    var esp = CM.totCaja(cp).esperadoEf; if (dec !== esp && obs.length < 4) return fail(f, 'obs', 'Hay diferencia de ' + money(Math.abs(dec - esp)) + ': explicá el motivo.');
    var c = CM.cerrarCaja(cp, dec, obs);
    CM.audit('Cierre de caja principal', cp.id + ' · ' + c.z + ' · declarado ' + money(dec) + ' · dif ' + money(c.dif) + ' · sello ' + c.hash.slice(0, 12));
    CM.save(); CM.modal.close(true); render(); CM.toast('Caja principal cerrada y sellada (' + c.z + ').');
  };

  /* ---------- pantalla: Cajas y traspasos ---------- */
  function filaCaja(c) {
    var t = CM.totCaja(c);
    return '<tr><td><b>' + esc(c.principal ? 'Caja principal' : 'Equipo ' + (c.nro != null ? c.nro : '—')) + '</b><br><small class="hint">' + esc(c.id) + '</small></td><td>' + esc(c.apUser || '—') + '<br><small class="hint">' + esc(CM.fmtFH(c.apTs || c.fecha)) + '</small></td><td class="n">' + esc(money(c.inicial)) + '</td><td class="n">' + esc(money(t.ingresos)) + '</td><td class="n">' + esc(money(t.egresos)) + '</td><td class="n">' + (t.trIn || t.trOut ? esc(money(t.trIn - t.trOut)) : '—') + '</td><td class="n"><b>' + esc(money(t.esperadoEf)) + '</b></td></tr>';
  }
  VIEWS['cajas-tr'] = function () {
    var ab = CM.cajasAbiertas(), cp = CM.cajaPrincipal(), tot = { ini: 0, ing: 0, egr: 0, esp: 0 };
    ab.forEach(function (c) { var t = CM.totCaja(c); tot.ini += c.inicial; tot.ing += t.ingresos; tot.egr += t.egresos; tot.esp += t.esperadoEf; });
    var consol = ab.length ? '<div class="tw"><table><thead><tr><th>Caja</th><th>Abrió</th><th class="n">Fondo</th><th class="n">Ingresos</th><th class="n">Egresos</th><th class="n">Traspasos</th><th class="n">Efectivo esperado</th></tr></thead><tbody>' + ab.map(filaCaja).join('') +
      '<tr class="tot"><td colspan="2"><b>Total de cajas abiertas</b></td><td class="n">' + esc(money(tot.ini)) + '</td><td class="n">' + esc(money(tot.ing)) + '</td><td class="n">' + esc(money(tot.egr)) + '</td><td class="n">—</td><td class="n"><b>' + esc(money(tot.esp)) + '</b></td></tr></tbody></table></div>' : U.tablaVacia('No hay cajas abiertas.');
    var cpH;
    if (!cp) cpH = '<section class="card"><div class="row sp"><h2>Caja principal</h2><button class="btn pri" data-act="cp-abrir">' + CM.icon('plus') + 'Abrir caja principal</button></div><p class="hint" style="margin:0">Opcional. Sirve para juntar el efectivo de las cajas de cada equipo (por traspasos) y llevar la tesorería aparte, con su propio arqueo y cierre sellado.</p></section>';
    else {
      var t = CM.totCaja(cp), ms = CM.cajaMovs(cp);
      cpH = '<section class="card"><div class="row sp"><h2>Caja principal · ' + esc(cp.id) + '</h2><div class="row"><button class="btn sm" data-act="cp-mov" data-tipo="ingreso">Ingreso</button><button class="btn sm" data-act="cp-mov" data-tipo="egreso">Egreso</button><button class="btn sm" data-act="cp-mov" data-tipo="retiro">Retiro</button><button class="btn sm" data-act="tr-nuevo" data-de="' + esc(cp.id) + '">' + CM.icon('swap') + 'Traspaso</button><button class="btn sm" data-act="cx-corte" data-caja="' + esc(cp.id) + '">Corte X</button><button class="btn sm pri" data-act="cp-cerrar">' + CM.icon('lock') + 'Arqueo y cierre</button></div></div>' +
        '<div class="grid g4" style="margin-top:10px"><div class="card kpi"><div class="l">Fondo inicial</div><div class="v">' + esc(money(cp.inicial)) + '</div><div class="s">Abrió ' + esc(cp.apUser) + '</div></div><div class="card kpi"><div class="l">Traspasos recibidos</div><div class="v">' + esc(money(t.trIn)) + '</div><div class="s">Enviados ' + esc(money(t.trOut)) + '</div></div><div class="card kpi"><div class="l">Ingresos / egresos</div><div class="v">' + esc(money(t.ingresos - t.egresos)) + '</div><div class="s">' + esc(money(t.ingresos)) + ' − ' + esc(money(t.egresos)) + '</div></div><div class="card kpi"><div class="l">Efectivo esperado</div><div class="v">' + esc(money(t.esperadoEf)) + '</div><div class="s">Para el arqueo</div></div></div>' +
        (ms.length ? '<div class="tw" style="margin-top:10px"><table><thead><tr><th>Hora</th><th>Tipo</th><th>Rubro</th><th>Detalle</th><th class="n">Importe</th><th></th></tr></thead><tbody>' + ms.map(function (m) { return '<tr><td>' + esc(CM.fmtHora(m.ts)) + '</td><td>' + esc({ ingreso: 'Ingreso', egreso: 'Egreso', retiro: 'Retiro', reintegro: 'Reintegro', 'tr-ent': 'Traspaso recibido', 'tr-sal': 'Traspaso enviado' }[m.tipo] || m.tipo) + '</td><td>' + esc(m.rubroN) + '</td><td>' + esc(m.motivo) + '</td><td class="n">' + (m.tipo === 'ingreso' || m.tipo === 'tr-ent' ? '' : '− ') + esc(money(m.cent)) + '</td><td><button class="btn sm" data-act="op-det" data-id="' + esc(m.id) + '" data-caja="' + esc(cp.id) + '">Ver</button></td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="hint">Todavía no hay movimientos.</p>') + '</section>';
    }
    var trs = arr('ctransf').slice().sort(function (a, b) { return String(b.ts).localeCompare(String(a.ts)); }).slice(0, 30);
    var trH = trs.length ? '<div class="tw"><table><thead><tr><th>N.º</th><th>Fecha</th><th>Desde</th><th>Hacia</th><th class="n">Importe</th><th>Motivo</th><th>Usuario</th><th></th></tr></thead><tbody>' + trs.map(function (x) {
      var rev = arr('ctransf').some(function (y) { return y.ref === x.id; });
      return '<tr><td>' + esc(x.id) + (x.ref ? '<br><small class="hint">revierte ' + esc(x.ref) + '</small>' : '') + '</td><td>' + esc(CM.fmtFH(x.ts)) + '</td><td>' + esc(x.de) + '</td><td>' + esc(x.a) + '</td><td class="n">' + esc(money(x.cent)) + '</td><td>' + esc(x.motivo) + '</td><td>' + esc(x.user) + '</td><td>' + (rev ? '<span class="pill p-mu">Revertido</span>' : x.ref ? '' : '<button class="btn sm" data-act="tr-revertir" data-id="' + esc(x.id) + '">Revertir</button>') + '</td></tr>';
    }).join('') + '</tbody></table></div>' : U.tablaVacia('Todavía no hay traspasos.');
    return pageH('Cajas y traspasos', 'Caja principal, traspasos de efectivo entre cajas y consolidado de todos los equipos. El consolidado es de lectura: no mueve dinero.',
      '<div class="row"><button class="btn pri" data-act="tr-nuevo" data-de="' + esc((CM.cajaAbierta() || cp || {}).id || '') + '">' + CM.icon('swap') + 'Nuevo traspaso</button><a class="btn" href="#/caja">Caja de este equipo</a></div>') +
      cpH + '<section class="card" style="margin-top:14px"><h2>Consolidado de cajas abiertas</h2>' + consol + '<p class="hint">Los traspasos no suman como ingresos ni egresos (no hay doble conteo): sólo mueven el efectivo esperado de cada caja.</p></section>' +
      '<section class="card" style="margin-top:14px"><h2>Traspasos</h2>' + trH + '</section>' + cortesLista('');
  };
})(window);
