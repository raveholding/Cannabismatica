/* Sistema VB ONG · Recursos humanos completo · 2026-11-11
   Adaptado del Sistema RAVE (V26.64 · RRHH) a la fundación, sin quitar nada de «Personal y fichaje»:
   · LEGAJOS: datos de contacto, ingreso, modalidad, responsable, jornada (horario, días, tolerancia) y vacaciones en la ficha
     de personal (colección staff). Los datos PRIVADOS (CUIL, remuneración, documentos con vencimiento, notas) van aparte en
     la colección rhpriv, que sólo leen quienes tienen el permiso nuevo «Recursos humanos» (rrhh). Los operadores no los ven.
   · FICHAJE OMNICANAL: PIN en modo kiosco (#/kiosco, PIN guardado con hash), QR con la cámara (BarcodeDetector) o lector USB,
     tarjeta NFC real (Web NFC en Chrome Android) vinculada por su número, y desde el celular con ubicación (geocerca).
     Los carnets QR se firman con un secreto de la fundación (no con la clave de la demo). Huella y rostro: NO (datos biométricos).
   · CALENDARIO del equipo: presentes, vacaciones y licencias aprobadas, feriados.
   · VACACIONES Y PEDIDOS (colección rhsol): vacaciones, licencias, permisos, cambio de turno, adelantos; aprobación en 1 o 2
     niveles (nivel 1: rrhh «edit»; nivel 2: rrhh «admin»); nadie aprueba su propio pedido; saldo de vacaciones del año.
   · LIQUIDACIÓN INTERNA (colección rhliq, sólo se agrega): horas, horas extra, tardanzas, ausencias, adelantos y deducciones
     configurables. NO es el recibo de haberes legal ni inventa alícuotas: todo [VERIFICAR con el contador].
   · MI PORTAL: cada persona vinculada a su usuario ve sus fichadas, horas, saldo de vacaciones, sus pedidos y su carnet.
   Requiere supabase/08-rrhh.sql en la nube. */
(function (g) {
  'use strict';
  var CM = g.CM, esc = CM.esc, U = CM.U, $ = U.$, fl = U.fl, flr = U.flr, opt = U.opt, fail = U.fail, VIEWS = CM.VIEWS;
  var render = function () { CM.render(); };
  function money(c) { return CM.fmtMoney(c); }
  function arr(k) { if (!Array.isArray(CM.db[k])) CM.db[k] = []; return CM.db[k]; }
  function emp(id) { return (CM.db.staff || []).filter(function (e) { return e.id === id; })[0] || null; }
  function priv(id) { return arr('rhpriv').filter(function (x) { return x.id === id; })[0] || null; }
  function privDe(id) { var p = priv(id); if (!p) { p = { id: id, cuil: '', remun: { tipo: 'mensual', monto: 0 }, docs: [], notas: '' }; arr('rhpriv').push(p); } return p; }
  function nomE(e) { return e ? String(e.nombre || '').replace(/\s*\((ficticio|ficticia)\)/i, '') : '—'; }
  function pageH(t, p, extra) { return '<div class="page-h"><div><h1>' + esc(t) + '</h1>' + (p ? '<p>' + p + '</p>' : '') + '</div>' + (extra || '') + '</div>'; }
  function hm(min) { return CM.fmtHM ? CM.fmtHM(min) : Math.floor(min / 60) + ' h ' + (min % 60) + ' min'; }
  function hhmm2min(s) { var m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return m ? (+m[1]) * 60 + (+m[2]) : null; }
  function minLocal(ts) { var h = CM.fmtHora(ts); return hhmm2min(h); }
  function diaSemana(f) { var d = new Date(f + 'T12:00:00Z').getUTCDay(); return d === 0 ? 7 : d; }   /* 1 = lunes … 7 = domingo */
  var DIAS = ['', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];

  /* ---------- permiso nuevo: Recursos humanos ---------- */
  if (!CM.MODS.some(function (m) { return m[0] === 'rrhh'; })) CM.MODS.push(['rrhh', 'Recursos humanos (legajos privados, aprobaciones y liquidación)']);
  var init0 = CM.init;
  CM.init = function () {
    init0();
    var db = CM.db, ch = false;
    if (db.perms) Object.keys(db.perms).forEach(function (r) { if (db.perms[r].rrhh === undefined) { db.perms[r].rrhh = r === 'supervisor' ? 'edit' : r === 'admin' ? 'admin' : ''; ch = true; } });
    if (ch) CM.save();
  };

  /* ---------- ajustes de RR. HH. (cfg.rh) ---------- */
  CM.rhCfg = function () {
    var r = (CM.db.cfg && CM.db.cfg.rh) || {};
    return { niveles: r.niveles === 2 ? 2 : 1, tol: r.tol >= 0 ? r.tol : 10, recargo: r.recargo >= 0 ? r.recargo : 50, extraMin: r.extraMin >= 0 ? r.extraMin : 15, descAus: r.descAus !== false,
      deducciones: Array.isArray(r.deducciones) ? r.deducciones : [], feriados: Array.isArray(r.feriados) ? r.feriados : [], geo: r.geo || { on: false, lat: null, lng: null, radio: 150 }, sec: r.sec || '' };
  };
  function guardarCfg(o) { var c = CM.rhCfg(); Object.keys(o).forEach(function (k) { c[k] = o[k]; }); CM.db.cfg.rh = c; }
  /* carnets firmados con el secreto de la fundación (si todavía no hay, se sigue aceptando la firma de la demo) */
  var firma0 = CM.firmaEmp;
  CM.firmaEmp = function (id) { var s = CM.rhCfg().sec; return s ? CM.sha256('cm-rh|' + s + '|' + id).slice(0, 10) : firma0(id); };
  var fichar0 = CM.fichar;
  CM.fichar = function (entrada, fuente) {
    var s = String(entrada || '').trim();
    var m = /^EMP-([A-Z0-9]+)-([0-9a-f]{8,10})$/i.exec(s);
    if (m) {   /* los id de personal pueden tener minúsculas: se busca tal cual y, si no, en mayúsculas (carnets viejos) */
      var e0 = emp(m[1]) || emp(m[1].toUpperCase());
      if (!e0 || CM.firmaEmp(e0.id) !== m[2].toLowerCase()) return { err: 'Firma inválida: la tarjeta o el QR no es auténtico (o es de antes de cambiar el secreto). No se registró nada.' };
      s = e0.dni;
    }
    var n = nfcNorm(s), porNfc = n && (CM.db.staff || []).filter(function (e) { return e.nfc && e.nfc === n; })[0];
    if (porNfc) { s = porNfc.dni; fuente = fuente && /NFC/.test(fuente) ? fuente : 'Tarjeta NFC'; }
    return fichar0(s, fuente);
  };
  function nfcNorm(s) { s = String(s || '').replace(/[:\s-]/g, '').toUpperCase(); return /^[0-9A-F]{6,20}$/.test(s) && !/^\d{6,9}$/.test(s) ? s : (/^\d{10,20}$/.test(s) ? s : ''); }

  /* ---------- reglas de jornada ---------- */
  function jornada(e) { var h = e.hor || {}; return { ent: h.ent || '', sal: h.sal || '', dias: Array.isArray(h.dias) && h.dias.length ? h.dias : [1, 2, 3, 4, 5], tol: h.tol != null ? h.tol : CM.rhCfg().tol }; }
  function minEsperados(e) { var j = jornada(e), a = hhmm2min(j.ent), b = hhmm2min(j.sal); return a != null && b != null && b > a ? b - a : 480; }
  function pedidosAprob(e, f) { return arr('rhsol').filter(function (p) { return p.emp === e.id && p.estado === 'aprobado' && p.desde && p.desde <= f && (p.hasta || p.desde) >= f && p.tipo !== 'adelanto' && p.tipo !== 'turno'; }); }
  CM.rhDia = function (e, f) {
    var fs = (CM.db.fichas || []).filter(function (x) { return x.emp === e.id && x.fecha === f; }).sort(function (a, b) { return a.ts.localeCompare(b.ts); });
    var j = jornada(e), lab = j.dias.indexOf(diaSemana(f)) >= 0 && CM.rhCfg().feriados.indexOf(f) < 0 && (!e.ingreso || f >= e.ingreso);
    var trab = CM.minutosDia(e.id, f), ent = fs.filter(function (x) { return x.tipo === 'entrada'; })[0], tarde = 0, ped = pedidosAprob(e, f)[0] || null;
    var ref = hhmm2min(j.ent); if (ent && ref != null) { var mi = minLocal(ent.ts); if (mi != null && mi > ref + j.tol) tarde = mi - ref; }
    var esp = minEsperados(e), extra = lab && trab > esp + CM.rhCfg().extraMin ? trab - esp : (!lab && trab > 0 ? trab : 0);
    return { fichas: fs, laborable: lab, trab: trab, tarde: tarde, extra: extra, ausente: lab && !!j.ent && !fs.length && !ped && f < CM.hoy(), pedido: ped };   /* sin horario cargado no se cuentan ausencias */
  };
  function diasMes(mes) { var y = +mes.slice(0, 4), m = +mes.slice(5, 7), n = new Date(Date.UTC(y, m, 0)).getUTCDate(), out = []; for (var i = 1; i <= n; i++) out.push(mes + '-' + String(i).padStart(2, '0')); return out; }
  CM.rhResumen = function (e, mes) {
    var r = { dias: 0, trab: 0, extra: 0, tardanzas: 0, minTarde: 0, ausencias: 0, licencias: 0 };
    diasMes(mes).forEach(function (f) { if (f > CM.hoy()) return; var d = CM.rhDia(e, f); if (d.trab > 0) { r.dias++; r.trab += d.trab; } r.extra += d.extra; if (d.tarde) { r.tardanzas++; r.minTarde += d.tarde; } if (d.ausente) r.ausencias++; if (d.pedido && d.laborable) r.licencias++; });
    return r;
  };
  /* vacaciones: días corridos por año según antigüedad (LCT art. 150 como referencia) [VERIFICAR con asesor/a laboral] */
  function vacAnual(e) { if (e.vacDias > 0) return e.vacDias; if (!e.ingreso) return 14; var a = CM.diffDays(e.ingreso, CM.hoy()) / 365.25; return a < 5 ? 14 : a < 10 ? 21 : a < 20 ? 28 : 35; }
  function diasCorridos(d, h) { return Math.max(1, CM.diffDays(d, h || d) + 1); }
  CM.rhVacSaldo = function (e, anio) {
    anio = anio || CM.hoy().slice(0, 4);
    var usados = arr('rhsol').filter(function (p) { return p.emp === e.id && p.tipo === 'vacaciones' && (p.estado === 'aprobado' || /^pendiente/.test(p.estado)) && String(p.desde).slice(0, 4) === anio; })
      .reduce(function (a, p) { return a + (p.estado === 'aprobado' ? diasCorridos(p.desde, p.hasta) : 0); }, 0);
    var pend = arr('rhsol').filter(function (p) { return p.emp === e.id && p.tipo === 'vacaciones' && /^pendiente/.test(p.estado) && String(p.desde).slice(0, 4) === anio; }).reduce(function (a, p) { return a + diasCorridos(p.desde, p.hasta); }, 0);
    return { anual: vacAnual(e), usados: usados, pendientes: pend, saldo: vacAnual(e) - usados };
  };

  /* ---------- quién soy (para el portal y para no aprobarse a sí mismo) ---------- */
  CM.rhYo = function () {
    var N = CM.nube, correo = N && N.ses && N.ses.correo ? String(N.ses.correo).toLowerCase() : '', op = CM.norm(CM.db.cfg.operador || '');
    return (CM.db.staff || []).filter(function (e) { return e.activo !== false && ((correo && String(e.correo || '').toLowerCase() === correo) || (!correo && op && CM.norm(nomE(e)) === op)); })[0] || null;
  };

  /* =================================================================
     PANTALLA: Personal y fichaje → Recursos humanos
     ================================================================= */
  var vPers = VIEWS.personal;
  var TABS = [['terminal', 'Terminal de fichaje'], ['equipo', 'Legajos'], ['horas', 'Planilla de horas'], ['calendario', 'Calendario'], ['pedidos', 'Vacaciones y pedidos'], ['liq', 'Liquidación'], ['portal', 'Mi portal'], ['rhcfg', 'Ajustes de RR. HH.']];
  function tabsHtml(cur) {
    var pend = arr('rhsol').filter(function (p) { return /^pendiente/.test(p.estado); }).length;
    return '<div class="tabs" role="group">' + TABS.filter(function (t) { return (t[0] !== 'liq' && t[0] !== 'rhcfg') || CM.can('rrhh', t[0] === 'rhcfg' ? 'admin' : 'ver'); }).map(function (t) {
      return '<button type="button" data-act="per-tab" data-v="' + t[0] + '" aria-pressed="' + (t[0] === cur) + '">' + esc(t[1]) + (t[0] === 'pedidos' && pend ? ' <span class="nav-badge" aria-label="' + pend + ' pendientes">' + pend + '</span>' : '') + '</button>';
    }).join('') + '</div>';
  }
  VIEWS.personal = function () {
    var f = CM.per, t = f.tab || 'terminal';
    if (!TABS.some(function (x) { return x[0] === t; }) || ((t === 'liq' || t === 'rhcfg') && !CM.can('rrhh', t === 'rhcfg' ? 'admin' : 'ver'))) t = f.tab = 'terminal';
    var head = pageH('Personal y recursos humanos', 'Legajos, fichaje, horas, vacaciones y pedidos, liquidación interna y portal de cada persona.', t === 'terminal' ? '<div class="row"><a class="btn" href="#/kiosco">' + CM.icon('key') + 'Modo kiosco (PIN)</a></div>' : '');
    var cuerpo;
    if (t === 'terminal' || t === 'horas') {
      var h = vPers.apply(this, arguments), i = h.indexOf('<div class="tabs" role="group">'), j = i >= 0 ? h.indexOf('</div>', i) + 6 : -1;
      cuerpo = j > 0 ? h.slice(j) : h;
      if (t === 'terminal') cuerpo = cuerpo.replace(/<button class="btn" type="button" data-act="fichar-nfc">[\s\S]*?<\/button>/, (CM.db.cfg.ejemplo ? '$&' : '') + '<button class="btn" type="button" data-act="rh-qr-cam">' + CM.icon('qr') + 'Leer QR con la cámara</button><button class="btn" type="button" data-act="rh-nfc-leer">Leer tarjeta NFC</button>');
      cuerpo = alertasHtml() + cuerpo;
    } else cuerpo = ({ equipo: legajosHtml, calendario: calendarioHtml, pedidos: pedidosHtml, liq: liqHtml, portal: portalHtml, rhcfg: cfgHtml })[t]();
    return head + tabsHtml(t) + cuerpo;
  };
  function alertasHtml() {
    if (!CM.can('rrhh', 'ver')) return '';
    var h = CM.hoy(), lim = CM.addDays(h, 30), av = [];
    arr('rhpriv').forEach(function (p) { var e = emp(p.id); if (!e || e.activo === false) return; (p.docs || []).forEach(function (d) { if (d.vence && d.vence <= lim) av.push(nomE(e) + ': «' + d.tipo + '» ' + (d.vence < h ? 'venció el ' : 'vence el ') + CM.fmtFecha(d.vence)); }); });
    var pend = arr('rhsol').filter(function (p) { return /^pendiente/.test(p.estado); }).length;
    if (pend) av.unshift(pend + ' pedido(s) esperando aprobación en «Vacaciones y pedidos».');
    return av.length ? '<div class="note warn" style="margin-bottom:14px"><b>Avisos de RR. HH.:</b><ul style="margin:6px 0 0;padding-left:18px">' + av.slice(0, 8).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' : '';
  }

  /* ---------- legajos ---------- */
  function legajosHtml() {
    var db = CM.db, ver = CM.can('rrhh', 'ver');
    var filas = (db.staff || []).map(function (e) {
      var j = jornada(e), vs = CM.rhVacSaldo(e), p = priv(e.id), faltan = [];
      if (!e.ingreso) faltan.push('ingreso'); if (!j.ent) faltan.push('horario'); if (!e.pinH) faltan.push('PIN'); if (ver && p && !p.cuil) faltan.push('CUIL');
      return '<tr' + (e.activo ? '' : ' class="anulada"') + '><td><b>' + esc(nomE(e)) + '</b><br><small class="hint">DNI ' + esc(e.dni) + (e.legajo ? ' · ' + esc(e.legajo) : '') + '</small></td><td>' + esc(e.cargo || '—') + '<br><small class="hint">' + esc((e.area || '') + (e.modalidad ? ' · ' + e.modalidad : '')) + '</small></td>' +
        '<td>' + (j.ent ? esc(j.ent + '–' + j.sal) + '<br><small class="hint">' + j.dias.map(function (d) { return DIAS[d]; }).join(' ') + '</small>' : '<span class="hint">Sin horario</span>') + '</td>' +
        '<td class="n">' + vs.saldo + ' de ' + vs.anual + '<br><small class="hint">días de vacaciones</small></td>' +
        '<td>' + (e.activo ? '<span class="pill p-ok">Activo/a</span>' : '<span class="pill p-mu">Baja</span>') + (faltan.length ? '<br><small class="hint">Falta: ' + esc(faltan.join(', ')) + '</small>' : '') + '</td>' +
        '<td class="acts"><button class="btn sm pri" data-act="rh-legajo" data-id="' + esc(e.id) + '">Legajo</button><button class="btn sm" data-act="emp-carnet" data-id="' + esc(e.id) + '">' + CM.icon('qr') + 'Carnet</button></td></tr>';
    }).join('');
    return '<section class="card"><div class="row sp"><h2>Legajos del equipo</h2>' + (CM.can('personal', 'edit') ? '<button class="btn pri sm" data-act="emp-nuevo">' + CM.icon('plus') + 'Alta de persona</button>' : '') + '</div>' +
      (filas ? '<div class="tw"><table><thead><tr><th>Persona</th><th>Cargo y área</th><th>Jornada</th><th class="n">Vacaciones</th><th>Estado</th><th></th></tr></thead><tbody>' + filas + '</tbody></table></div>' : U.tablaVacia('Todavía no hay personas cargadas. Usá «Alta de persona».')) +
      '<p class="hint">' + (ver ? 'La remuneración, el CUIL y los documentos se guardan aparte y sólo los ven quienes tienen el permiso «Recursos humanos».' : 'Los datos privados del legajo (remuneración, CUIL, documentos) sólo los ve RR. HH.') + '</p></section>';
  }
  CM.acts['rh-legajo'] = function (t) {
    var e = emp(t.getAttribute('data-id')); if (!e) return;
    var j = jornada(e), p = priv(e.id) || { cuil: '', remun: { tipo: 'mensual', monto: 0 }, docs: [], notas: '' }, ed = CM.can('personal', 'edit'), rv = CM.can('rrhh', 'ver'), re = CM.can('rrhh', 'edit');
    var dis = ed ? '' : ' disabled', resp = (CM.db.staff || []).filter(function (x) { return x.id !== e.id && x.activo !== false; });
    var vs = CM.rhVacSaldo(e), res = CM.rhResumen(e, CM.mesActual());
    var docs = (p.docs || []).map(function (d, i) { var h = CM.hoy(), cls = d.vence ? (d.vence < h ? 'p-bad' : d.vence <= CM.addDays(h, 30) ? 'p-warn' : 'p-ok') : 'p-mu'; return '<tr><td><b>' + esc(d.tipo) + '</b>' + (d.nombre ? '<br><small class="hint">' + esc(d.nombre) + '</small>' : '') + '</td><td>' + (d.vence ? '<span class="pill ' + cls + '">' + esc(CM.fmtFecha(d.vence)) + '</span>' : '—') + '</td><td>' + (d.url ? '<a href="' + esc(d.url) + '" target="_blank" rel="noopener">Abrir</a>' : '—') + '</td><td>' + (re ? '<button class="btn sm" data-act="rh-doc-baja" data-id="' + esc(e.id) + '" data-i="' + i + '">Quitar</button>' : '') + '</td></tr>'; }).join('');
    CM.modal.open({
      title: 'Legajo · ' + nomE(e), wide: true,
      body: '<div class="kv"><div><small>Este mes</small><b>' + esc(hm(res.trab)) + '</b></div><div><small>Tardanzas / ausencias</small><b>' + res.tardanzas + ' / ' + res.ausencias + '</b></div><div><small>Vacaciones ' + CM.hoy().slice(0, 4) + '</small><b>' + vs.saldo + ' de ' + vs.anual + ' días</b></div><div><small>Identificación</small><b>' + (e.pinH ? 'PIN ✓' : 'Sin PIN') + ' · ' + (e.nfc ? 'NFC ✓' : 'Sin NFC') + '</b></div></div>' +
        '<form id="fRL" data-form="rh-legajo" class="f" autocomplete="off" novalidate style="margin-top:12px"><input type="hidden" name="id" value="' + esc(e.id) + '">' +
        '<fieldset><legend>Datos y contacto</legend><div class="f f2">' + fl('Correo (para «Mi portal»)', '<input class="in" name="correo" type="email" value="' + esc(e.correo || '') + '"' + dis + '>') + fl('Teléfono', '<input class="in" name="tel" value="' + esc(e.tel || '') + '"' + dis + '>') + '</div>' +
        '<div class="f f2">' + fl('Domicilio', '<input class="in" name="dir" maxlength="160" value="' + esc(e.dir || '') + '"' + dis + '>') + fl('Contacto de emergencia', '<input class="in" name="emerg" maxlength="120" value="' + esc(e.emerg || '') + '" placeholder="Nombre y teléfono"' + dis + '>') + '</div>' +
        '<div class="f f2">' + fl('Fecha de ingreso', '<input class="in" type="date" name="ingreso" value="' + esc(e.ingreso || '') + '"' + dis + '>') + fl('Modalidad', '<select class="in" name="modalidad"' + dis + '>' + ['', 'Relación de dependencia', 'Monotributo', 'Voluntario/a', 'Pasantía', 'Otra'].map(function (x) { return opt(x, x || 'Sin dato', e.modalidad === x); }).join('') + '</select>') + '</div>' +
        '<div class="f f2">' + fl('N.º de legajo interno', '<input class="in" name="legajo" maxlength="20" value="' + esc(e.legajo || '') + '"' + dis + '>') + fl('Responsable directo', '<select class="in" name="resp"' + dis + '><option value="">—</option>' + resp.map(function (x) { return opt(x.id, nomE(x), e.resp === x.id); }).join('') + '</select>') + '</div></fieldset>' +
        '<fieldset><legend>Jornada</legend><div class="f f2">' + fl('Entrada', '<input class="in" type="time" name="ent" value="' + esc(j.ent) + '"' + dis + '>') + fl('Salida', '<input class="in" type="time" name="sal" value="' + esc(j.sal) + '"' + dis + '>') + '</div>' +
        '<div class="row" role="group" aria-label="Días laborables">' + [1, 2, 3, 4, 5, 6, 7].map(function (d) { return '<label class="chk"><input type="checkbox" name="d' + d + '"' + (j.dias.indexOf(d) >= 0 ? ' checked' : '') + dis + '><span>' + DIAS[d] + '</span></label>'; }).join('') + '</div>' +
        '<div class="f f2">' + fl('Tolerancia de llegada (minutos)', '<input class="in num" name="tol" inputmode="numeric" value="' + esc(String(j.tol)) + '"' + dis + '>') + fl('Días de vacaciones por año (vacío = según antigüedad)', '<input class="in num" name="vac" inputmode="numeric" value="' + esc(e.vacDias ? String(e.vacDias) : '') + '"' + dis + '>') + '</div></fieldset>' +
        (rv ? '<fieldset><legend>Datos privados (sólo RR. HH.)</legend><div class="f f2">' + fl('CUIL', '<input class="in" name="cuil" inputmode="numeric" maxlength="13" value="' + esc(p.cuil || '') + '"' + (re ? '' : ' disabled') + '>') +
          fl('Remuneración', '<div class="row" style="gap:6px;flex-wrap:nowrap"><select class="in" name="rtipo" style="max-width:150px"' + (re ? '' : ' disabled') + '>' + opt('mensual', 'Mensual', p.remun.tipo === 'mensual') + opt('hora', 'Por hora', p.remun.tipo === 'hora') + opt('ninguna', 'Sin remuneración', p.remun.tipo === 'ninguna') + '</select><input class="in num" name="rmonto" inputmode="decimal" placeholder="0" value="' + (p.remun.monto ? esc(String(p.remun.monto / 100).replace('.', ',')) : '') + '"' + (re ? '' : ' disabled') + '></div>') + '</div>' +
          fl('Notas privadas', '<textarea class="in" name="notas" maxlength="500" style="min-height:60px"' + (re ? '' : ' disabled') + '>' + esc(p.notas || '') + '</textarea>') + '</fieldset>' : '') +
        '<p class="err" role="alert" data-err></p></form>' +
        (rv ? '<section class="card flat" style="margin-top:10px"><div class="row sp"><h3 style="margin:0">Documentos del legajo</h3>' + (re ? '<button class="btn sm" data-act="rh-doc" data-id="' + esc(e.id) + '">' + CM.icon('plus') + 'Agregar documento</button>' : '') + '</div>' + (docs ? '<div class="tw"><table><thead><tr><th>Documento</th><th>Vence</th><th>Archivo</th><th></th></tr></thead><tbody>' + docs + '</tbody></table></div>' : '<p class="hint">Sin documentos. Cargá el enlace del archivo en el Drive de la fundación (DNI, contrato, apto médico, certificado de antecedentes…) con su vencimiento.</p>') + '</section>' : '') +
        '<div class="row" style="margin-top:10px">' + (ed ? '<button class="btn" data-act="rh-pin" data-id="' + esc(e.id) + '">' + CM.icon('key') + (e.pinH ? 'Cambiar PIN' : 'Asignar PIN') + '</button><button class="btn" data-act="rh-nfc" data-id="' + esc(e.id) + '">' + (e.nfc ? 'Cambiar tarjeta NFC' : 'Vincular tarjeta NFC') + '</button><button class="btn" data-act="emp-edit" data-id="' + esc(e.id) + '">Nombre, DNI, cargo y baja</button>' : '') + '</div>',
      footer: '<button class="btn" data-act="modal-close">Cerrar</button>' + (ed || re ? '<button class="btn pri" type="submit" form="fRL">Guardar legajo</button>' : '')
    });
  };
  CM.forms['rh-legajo'] = function (f) {
    var e = emp(f.elements.id.value); if (!e) return;
    var x = f.elements, ed = CM.can('personal', 'edit'), re = CM.can('rrhh', 'edit');
    if (!ed && !re) return;
    if (ed) {
      var correo = x.correo.value.trim().toLowerCase(); if (correo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) return fail(f, 'correo', 'El correo no es válido.');
      if (correo && (CM.db.staff || []).some(function (o) { return o.id !== e.id && String(o.correo || '').toLowerCase() === correo; })) return fail(f, 'correo', 'Ese correo ya está en otro legajo.');
      if ((x.ent.value && !x.sal.value) || (!x.ent.value && x.sal.value)) return fail(f, 'sal', 'Completá entrada y salida (o dejá las dos vacías).');
      if (x.ent.value && x.sal.value && hhmm2min(x.sal.value) <= hhmm2min(x.ent.value)) return fail(f, 'sal', 'La salida tiene que ser después de la entrada.');
      var tol = parseInt(x.tol.value, 10); if (isNaN(tol) || tol < 0 || tol > 120) return fail(f, 'tol', 'Tolerancia entre 0 y 120 minutos.');
      var vac = x.vac.value.trim() ? parseInt(x.vac.value, 10) : 0; if (isNaN(vac) || vac < 0 || vac > 60) return fail(f, 'vac', 'Días de vacaciones entre 0 y 60.');
      var dias = [1, 2, 3, 4, 5, 6, 7].filter(function (d) { return x['d' + d].checked; }); if (!dias.length) return fail(f, 'd1', 'Marcá al menos un día laborable.');
      e.correo = correo; e.tel = x.tel.value.trim(); e.dir = x.dir.value.trim(); e.emerg = x.emerg.value.trim(); e.ingreso = x.ingreso.value; e.modalidad = x.modalidad.value; e.legajo = x.legajo.value.trim(); e.resp = x.resp.value;
      e.hor = { ent: x.ent.value, sal: x.sal.value, dias: dias, tol: tol }; e.vacDias = vac;
    }
    if (re && x.cuil) {
      var cuil = CM.soloDigitos(x.cuil.value); if (cuil && cuil.length !== 11) return fail(f, 'cuil', 'El CUIL tiene 11 números.');
      var monto = x.rmonto.value.trim() ? CM.parseMonto(x.rmonto.value) : 0; if (isNaN(monto) || monto < 0) return fail(f, 'rmonto', 'Importe inválido.');
      var p = privDe(e.id), antes = JSON.stringify(p.remun);
      p.cuil = cuil; p.remun = { tipo: x.rtipo.value, monto: monto }; p.notas = x.notas.value.trim();
      if (antes !== JSON.stringify(p.remun)) (p.hist = p.hist || []).push({ ts: new Date().toISOString(), user: CM.db.cfg.operador, antes: JSON.parse(antes) });
    }
    CM.audit('Legajo actualizado', e.id + ' · ' + nomE(e)); CM.save(); CM.modal.close(true); render(); CM.toast('Legajo guardado.');
  };
  /* documentos (enlace al Drive de la fundación + vencimiento) */
  CM.acts['rh-doc'] = function (t) {
    if (!CM.need('rrhh', 'edit')) return; var e = emp(t.getAttribute('data-id')); if (!e) return;
    CM.modal.open({ title: 'Documento del legajo · ' + nomE(e), body: '<form id="fRD" data-form="rh-doc" class="f" autocomplete="off" novalidate><input type="hidden" name="id" value="' + esc(e.id) + '">' +
      fl('Tipo *', '<input class="in" name="tipo" list="rdTipos" maxlength="60" placeholder="Ej.: Apto médico"><datalist id="rdTipos">' + ['DNI', 'Contrato', 'Alta temprana (ARCA)', 'Apto médico', 'Certificado de antecedentes', 'Constancia de CUIL', 'Título / capacitación', 'Seguro', 'Otro'].map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') + '</datalist>') +
      '<div class="f f2">' + fl('Nombre o detalle', '<input class="in" name="nombre" maxlength="120">') + fl('Vence (si corresponde)', '<input class="in" type="date" name="vence">') + '</div>' +
      fl('Enlace del archivo (Drive de la fundación)', '<input class="in" name="url" type="url" placeholder="https://drive.google.com/…">') +
      '<p class="hint" style="margin:0">El archivo queda en el Drive de la fundación; acá se guarda el enlace, el vencimiento y quién lo cargó. Treinta días antes del vencimiento aparece el aviso.</p><p class="err" role="alert" data-err></p></form>',
      footer: '<button class="btn" type="button" data-act="modal-close">Cancelar</button><button class="btn pri" type="submit" form="fRD">Agregar</button>' });
  };
  CM.forms['rh-doc'] = function (f) {
    if (!CM.need('rrhh', 'edit')) return; var x = f.elements, e = emp(x.id.value); if (!e) return;
    var tipo = x.tipo.value.trim(); if (tipo.length < 2) return fail(f, 'tipo', 'Escribí el tipo de documento.');
    var url = x.url.value.trim(); if (url && !/^https:\/\/(drive|docs)\.google\.com\//.test(url)) return fail(f, 'url', 'Pegá un enlace de Google Drive (https://drive.google.com/…).');
    privDe(e.id).docs.push({ tipo: tipo, nombre: x.nombre.value.trim(), vence: x.vence.value, url: url, ts: new Date().toISOString(), user: CM.db.cfg.operador });
    CM.audit('Legajo: documento', e.id + ' · ' + tipo + (x.vence.value ? ' · vence ' + x.vence.value : '')); CM.save(); CM.modal.close(true); render(); CM.acts['rh-legajo']({ getAttribute: function () { return e.id; } });
  };
  CM.acts['rh-doc-baja'] = function (t) {
    if (!CM.need('rrhh', 'edit')) return; var e = emp(t.getAttribute('data-id')), p = e && priv(e.id), i = +t.getAttribute('data-i'); if (!p || !p.docs[i]) return;
    var d = p.docs.splice(i, 1)[0]; (p.docsBaja = p.docsBaja || []).push({ doc: d, ts: new Date().toISOString(), user: CM.db.cfg.operador });
    CM.audit('Legajo: documento quitado', e.id + ' · ' + d.tipo); CM.save(); CM.acts['rh-legajo']({ getAttribute: function () { return e.id; } });
  };
  /* PIN del kiosco (se guarda sólo el hash) */
  function pinHash(e, pin) { return CM.sha256('cm-pin|' + (CM.rhCfg().sec || 'demo') + '|' + e.id + '|' + pin); }
  CM.acts['rh-pin'] = function (t) {
    if (!CM.need('personal', 'edit')) return; var e = emp(t.getAttribute('data-id')); if (!e) return;
    CM.modal.open({ title: 'PIN de fichaje · ' + nomE(e), body: '<form id="fRP" data-form="rh-pin" class="f" autocomplete="off" novalidate><input type="hidden" name="id" value="' + esc(e.id) + '"><p style="margin:0">El PIN se usa en el modo kiosco junto con el DNI. Se guarda cifrado: nadie lo puede ver después.</p>' +
      '<div class="f f2">' + fl('PIN nuevo (4 a 6 números) *', '<input class="in" name="pin" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password">') + fl('Repetir PIN *', '<input class="in" name="pin2" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password">') + '</div><p class="err" role="alert" data-err></p></form>',
      footer: '<button class="btn" type="button" data-act="modal-close">Cancelar</button><button class="btn pri" type="submit" form="fRP">Guardar PIN</button>' });
  };
  CM.forms['rh-pin'] = function (f) {
    if (!CM.need('personal', 'edit')) return; var x = f.elements, e = emp(x.id.value); if (!e) return;
    if (!/^\d{4,6}$/.test(x.pin.value)) return fail(f, 'pin', 'El PIN tiene que tener entre 4 y 6 números.');
    if (/^(\d)\1+$/.test(x.pin.value) || '0123456789'.indexOf(x.pin.value) >= 0) return fail(f, 'pin', 'Elegí un PIN menos obvio (no repetido ni consecutivo).');
    if (x.pin.value !== x.pin2.value) return fail(f, 'pin2', 'Los dos PIN no coinciden.');
    e.pinH = pinHash(e, x.pin.value);
    CM.audit('Personal: PIN asignado', e.id + ' · ' + nomE(e)); CM.save(); CM.modal.close(true); render(); CM.toast('PIN guardado.');
  };
  /* tarjeta NFC: se vincula por su número (no se graba nada en la tarjeta) */
  CM.acts['rh-nfc'] = function (t) {
    if (!CM.need('personal', 'edit')) return; var e = emp(t.getAttribute('data-id')); if (!e) return;
    CM.modal.open({ title: 'Tarjeta NFC · ' + nomE(e), body: '<form id="fRN" data-form="rh-nfc" class="f" autocomplete="off" novalidate><input type="hidden" name="id" value="' + esc(e.id) + '"><p style="margin:0">Acercá la tarjeta al celular (Chrome en Android) o pasala por el lector USB con el cursor en el campo: se guarda el número de la tarjeta.</p>' +
      fl('Número de la tarjeta *', '<input class="in" name="nfc" autocomplete="off" value="' + esc(e.nfc || '') + '" placeholder="Ej.: 04:A2:5B:1C o 0123456789">') +
      ('NDEFReader' in g ? '<button class="btn" type="button" data-act="rh-nfc-capturar">Acercar tarjeta ahora</button>' : '<p class="hint">Este navegador no lee NFC: usá el lector USB.</p>') + '<p class="err" role="alert" data-err></p></form>',
      footer: '<button class="btn" type="button" data-act="modal-close">Cancelar</button>' + (e.nfc ? '<button class="btn" data-act="rh-nfc-quitar" data-id="' + esc(e.id) + '">Quitar tarjeta</button>' : '') + '<button class="btn pri" type="submit" form="fRN">Vincular</button>' });
  };
  CM.acts['rh-nfc-capturar'] = function () {
    var inp = document.querySelector('#fRN [name=nfc]'); if (!inp || !('NDEFReader' in g)) return;
    leerNfc(20000).then(function (r) { inp.value = r.serial || ''; CM.toast(r.serial ? 'Tarjeta leída.' : 'La tarjeta no informó su número.', !r.serial); }, function (e) { CM.toast('No se pudo leer: ' + (e.message || e), true); });
  };
  CM.forms['rh-nfc'] = function (f) {
    if (!CM.need('personal', 'edit')) return; var e = emp(f.elements.id.value); if (!e) return;
    var n = nfcNorm(f.elements.nfc.value); if (!n) return fail(f, 'nfc', 'Número de tarjeta inválido (hexadecimal o decimal largo; no puede ser un DNI).');
    var otro = (CM.db.staff || []).filter(function (x) { return x.id !== e.id && x.nfc === n; })[0]; if (otro) return fail(f, 'nfc', 'Esa tarjeta ya es de ' + nomE(otro) + '.');
    e.nfc = n; CM.audit('Personal: tarjeta NFC vinculada', e.id + ' · ' + nomE(e)); CM.save(); CM.modal.close(true); render(); CM.toast('Tarjeta vinculada.');
  };
  CM.acts['rh-nfc-quitar'] = function (t) { if (!CM.need('personal', 'edit')) return; var e = emp(t.getAttribute('data-id')); if (!e) return; delete e.nfc; CM.audit('Personal: tarjeta NFC quitada', e.id); CM.save(); CM.modal.close(true); render(); };
  function leerNfc(ms) {
    return new Promise(function (ok, mal) {
      var ctrl = new AbortController(), r = new g.NDEFReader(), tm = setTimeout(function () { ctrl.abort(); mal(new Error('se terminó el tiempo')); }, ms || 20000);
      r.scan({ signal: ctrl.signal }).then(function () {
        r.onreading = function (ev) {
          clearTimeout(tm); ctrl.abort(); var txt = '';
          try { (ev.message.records || []).forEach(function (rec) { if (rec.recordType === 'text' && !txt) txt = new TextDecoder(rec.encoding || 'utf-8').decode(rec.data); }); } catch (e) { txt = ''; }
          ok({ serial: nfcNorm(ev.serialNumber || ''), text: txt });
        };
        r.onreadingerror = function () { clearTimeout(tm); ctrl.abort(); mal(new Error('no se pudo leer la tarjeta')); };
      }, function (e) { clearTimeout(tm); mal(e); });
    });
  }
  function msgFicha(r) { return r.err ? r.err : (r.ok.tipo === 'entrada' ? 'Entrada' : 'Salida') + ' registrada: ' + nomE(r.emp) + ' a las ' + CM.fmtHora(r.ok.ts) + '.'; }
  function registrar(r, extra) { if (r.err) { CM.toast(r.err, true); return false; } if (extra) Object.keys(extra).forEach(function (k) { r.ok[k] = extra[k]; }); CM.audit('Fichada', nomE(r.emp) + ' · ' + r.ok.tipo + ' · ' + r.ok.metodo); CM.save(); render(); CM.toast(msgFicha(r)); return true; }
  CM.acts['rh-nfc-leer'] = function () {
    if (!CM.need('personal', 'oper')) return;
    if (!('NDEFReader' in g)) return CM.toast('Este navegador no lee NFC (sólo Chrome en Android). Con un lector USB, pasá la tarjeta con el cursor en el campo de fichaje.', true);
    CM.toast('Acercá la tarjeta al celular…');
    leerNfc(20000).then(function (x) { registrar(CM.fichar(/^EMP-/.test(x.text) ? x.text : x.serial, 'Tarjeta NFC')); }, function (e) { CM.toast('No se pudo leer la tarjeta: ' + (e.message || e), true); });
  };
  /* QR con la cámara */
  var CAM = { stream: null, timer: null };
  function camStop() { if (CAM.timer) clearInterval(CAM.timer); CAM.timer = null; if (CAM.stream) CAM.stream.getTracks().forEach(function (t) { t.stop(); }); CAM.stream = null; }
  CM.acts['rh-qr-cam'] = function () {
    if (!CM.need('personal', 'oper')) return;
    if (!('BarcodeDetector' in g) || !(g.navigator.mediaDevices && g.navigator.mediaDevices.getUserMedia)) return CM.toast('Este navegador no lee QR con la cámara: usá un lector USB (escribe el código en el campo) o Chrome en Android.', true);
    CM.modal.open({ title: 'Leer el QR del carnet', body: '<video id="rhCam" playsinline muted style="width:100%;max-height:60vh;border-radius:12px;background:#000"></video><p class="hint">Mostrá el carnet frente a la cámara.</p>', footer: '<button class="btn" data-act="rh-cam-cerrar">Cerrar</button>' });
    var det = new g.BarcodeDetector({ formats: ['qr_code'] });
    g.navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(function (s) {
      CAM.stream = s; var v = document.getElementById('rhCam'); if (!v) return camStop(); v.srcObject = s; v.play();
      CAM.timer = setInterval(function () {
        if (!document.getElementById('rhCam')) return camStop();
        det.detect(v).then(function (cs) { if (!cs.length) return; var c = cs[0].rawValue; camStop(); CM.modal.close(true); registrar(CM.fichar(c, 'QR (cámara)')); }).catch(function () { /* cuadro sin leer */ });
      }, 350);
    }, function () { CM.modal.close(true); CM.toast('No hay permiso para usar la cámara.', true); });
  };
  CM.acts['rh-cam-cerrar'] = function () { camStop(); CM.modal.close(true); };

  /* ---------- modo kiosco: DNI + PIN ---------- */
  var KI = { dni: '', fase: 'dni', msg: '', ok: false, intentos: {} };
  VIEWS.kiosco = function () {
    var val = KI.fase === 'dni' ? KI.dni : KI.pin || '', mostrar = KI.fase === 'dni' ? (val || 'DNI') : (val ? val.replace(/./g, '•') : 'PIN');
    return '<div class="kiosco" role="region" aria-label="Fichaje con PIN"><h1>Fichar entrada o salida</h1><p class="hint">' + (KI.fase === 'dni' ? 'Escribí tu DNI y tocá «Seguir».' : 'Ahora tu PIN.') + '</p>' +
      '<output class="kio-v" aria-live="polite">' + esc(mostrar) + '</output>' + (KI.msg ? '<div class="note ' + (KI.ok ? 'ok' : 'bad') + '" role="status">' + esc(KI.msg) + '</div>' : '') +
      '<div class="kio-k">' + ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'borrar', '0', 'ok'].map(function (k) { return '<button type="button" class="btn' + (k === 'ok' ? ' pri' : '') + '" data-act="kio-k" data-k="' + k + '">' + (k === 'borrar' ? '⌫' : k === 'ok' ? (KI.fase === 'dni' ? 'Seguir' : 'Fichar') : k) + '</button>'; }).join('') + '</div>' +
      '<div class="row" style="justify-content:center;margin-top:16px"><a class="btn sm" href="#/personal">Salir del kiosco</a></div></div>';
  };
  CM.TITULOS.kiosco = 'Fichaje (kiosco)';
  CM.acts['kio-k'] = function (t) {
    var k = t.getAttribute('data-k'); KI.ok = false;
    if (k === 'borrar') { if (KI.fase === 'dni') KI.dni = KI.dni.slice(0, -1); else KI.pin = (KI.pin || '').slice(0, -1); KI.msg = ''; return render(); }
    if (k !== 'ok') { if (KI.fase === 'dni' && KI.dni.length < 9) KI.dni += k; else if (KI.fase === 'pin' && (KI.pin || '').length < 6) KI.pin = (KI.pin || '') + k; KI.msg = ''; return render(); }
    if (KI.fase === 'dni') { if (KI.dni.length < 6) { KI.msg = 'Escribí tu DNI completo.'; return render(); } KI.fase = 'pin'; KI.pin = ''; KI.msg = ''; return render(); }
    var e = (CM.db.staff || []).filter(function (x) { return x.dni === KI.dni; })[0], it = KI.intentos[KI.dni] || { n: 0, hasta: 0 };
    function fin(msg, ok) { KI.msg = msg; KI.ok = ok; KI.dni = ''; KI.pin = ''; KI.fase = 'dni'; render(); }
    if (Date.now() < it.hasta) return fin('Demasiados intentos: esperá unos minutos o avisá a RR. HH.', false);
    if (!e || !e.pinH || pinHash(e, KI.pin) !== e.pinH) { it.n++; if (it.n >= 5) { it.hasta = Date.now() + 5 * 60000; it.n = 0; CM.audit('Kiosco: PIN bloqueado', 'DNI terminado en ' + KI.dni.slice(-3)); CM.save(); } KI.intentos[KI.dni] = it; return fin('DNI o PIN incorrectos.', false); }
    delete KI.intentos[KI.dni];
    var r = CM.fichar(e.dni, 'PIN (kiosco)');
    if (r.err) return fin(r.err, false);
    CM.audit('Fichada', nomE(e) + ' · ' + r.ok.tipo + ' · PIN (kiosco)'); CM.save();
    fin(msgFicha(r), true);
  };

  /* ---------- calendario del equipo ---------- */
  CM.rh = CM.rh || { mes: '', pedEst: 'pendientes', liqMes: '' };
  function calendarioHtml() {
    var mes = CM.rh.mes || CM.mesActual(), y = +mes.slice(0, 4), m = +mes.slice(5) - 1, ds = diasMes(mes), off = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7;
    var act = (CM.db.staff || []).filter(function (e) { return e.activo !== false; }), fer = CM.rhCfg().feriados, cel = '', i;
    for (i = 0; i < off; i++) cel += '<div class="cal-d vacio"></div>';
    ds.forEach(function (f) {
      var pres = act.filter(function (e) { return (CM.db.fichas || []).some(function (x) { return x.emp === e.id && x.fecha === f; }); }).length;
      var aus = act.map(function (e) { var p = pedidosAprob(e, f)[0]; return p ? nomE(e).split(' ')[0] + ' · ' + TIPOS[p.tipo] : ''; }).filter(Boolean);
      cel += '<div class="cal-d' + (fer.indexOf(f) >= 0 ? ' alerta' : pres ? ' ok' : '') + (f === CM.hoy() ? ' hoy' : '') + '"><b>' + (+f.slice(8)) + '</b>' + (fer.indexOf(f) >= 0 ? '<small>Feriado</small>' : '') + (pres ? '<small>' + pres + ' presente' + (pres > 1 ? 's' : '') + '</small>' : '') + aus.map(function (a) { return '<small class="cal-aus">' + esc(a) + '</small>'; }).join('') + '</div>';
    });
    var prev = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 7), next = new Date(Date.UTC(y, m + 1, 1)).toISOString().slice(0, 7);
    return '<section class="card"><div class="row sp" style="margin-bottom:10px"><button class="btn sm" data-act="rh-mes" data-m="' + prev + '">' + CM.icon('left') + 'Anterior</button><h2 style="margin:0">' + ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'][m] + ' ' + y + '</h2><button class="btn sm" data-act="rh-mes" data-m="' + next + '">Siguiente' + CM.icon('right') + '</button></div>' +
      '<div class="cal" role="group" aria-label="Calendario del equipo">' + ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'].map(function (d) { return '<div class="cal-h">' + d + '</div>'; }).join('') + cel + '</div>' +
      '<p class="hint">Verde: hubo fichadas · Rojo: feriado (se cargan en Ajustes de RR. HH.) · Debajo, vacaciones y licencias aprobadas.</p></section>';
  }
  CM.acts['rh-mes'] = function (t) { CM.rh.mes = t.getAttribute('data-m'); render(); };

  /* ---------- vacaciones y pedidos ---------- */
  var TIPOS = { vacaciones: 'Vacaciones', licencia: 'Licencia', permiso: 'Permiso / día', turno: 'Cambio de turno', adelanto: 'Adelanto', otro: 'Otro' };
  var EST = { pendiente: ['Pendiente', 'p-warn'], 'pendiente-2': ['Pendiente (2.º nivel)', 'p-warn'], aprobado: ['Aprobado', 'p-ok'], rechazado: ['Rechazado', 'p-bad'], cancelado: ['Cancelado', 'p-mu'] };
  function puedeAprobar(p) {
    var yo = CM.rhYo(); if (yo && yo.id === p.emp) return false;
    var n = CM.rhCfg().niveles;
    if (p.estado === 'pendiente') return CM.can('rrhh', n === 2 ? 'edit' : 'edit');
    if (p.estado === 'pendiente-2') return CM.can('rrhh', 'admin') && !(p.pasos || []).some(function (s) { return s.user === CM.db.cfg.operador; });
    return false;
  }
  function detPed(p) { return p.tipo === 'adelanto' ? money(p.monto || 0) + ' · ' + CM.fmtFecha(p.desde) : CM.fmtFecha(p.desde) + (p.hasta && p.hasta !== p.desde ? ' al ' + CM.fmtFecha(p.hasta) : '') + (p.tipo === 'vacaciones' ? ' · ' + diasCorridos(p.desde, p.hasta) + ' días' : ''); }
  function filaPed(p, conEmp) {
    var e = emp(p.emp), st = EST[p.estado] || [p.estado, ''], yo = CM.rhYo();
    return '<tr><td>' + esc(CM.fmtFecha(String(p.ts).slice(0, 10))) + '</td>' + (conEmp ? '<td>' + esc(nomE(e)) + '</td>' : '') + '<td>' + esc(TIPOS[p.tipo] || p.tipo) + '</td><td>' + esc(detPed(p)) + (p.motivo ? '<br><small class="hint">' + esc(p.motivo) + '</small>' : '') + '</td><td><span class="pill ' + st[1] + '">' + esc(st[0]) + '</span>' +
      ((p.pasos || []).length ? '<br><small class="hint">' + p.pasos.map(function (s) { return (s.decision === 'aprobado' ? '✓ ' : '✗ ') + s.user + (s.nota ? ': ' + s.nota : ''); }).map(esc).join('<br>') + '</small>' : '') + '</td><td><div class="row">' +
      (puedeAprobar(p) ? '<button class="btn sm pri" data-act="rh-ped-dec" data-id="' + esc(p.id) + '" data-d="aprobado">Aprobar</button><button class="btn sm" data-act="rh-ped-dec" data-id="' + esc(p.id) + '" data-d="rechazado">Rechazar</button>' : '') +
      (/^pendiente/.test(p.estado) && ((yo && yo.id === p.emp) || CM.can('rrhh', 'edit')) ? '<button class="btn sm" data-act="rh-ped-cancel" data-id="' + esc(p.id) + '">Cancelar</button>' : '') + '</div></td></tr>';
  }
  function pedidosHtml() {
    var f = CM.rh.pedEst || 'pendientes', todos = CM.can('rrhh', 'ver'), yo = CM.rhYo();
    var L = arr('rhsol').filter(function (p) { return todos || (yo && p.emp === yo.id); }).filter(function (p) { return f === 'todos' || (f === 'pendientes' ? /^pendiente/.test(p.estado) : p.estado === f); }).sort(function (a, b) { return String(b.ts).localeCompare(String(a.ts)); });
    var saldos = todos ? (CM.db.staff || []).filter(function (e) { return e.activo !== false; }).map(function (e) { var s = CM.rhVacSaldo(e); return '<tr><td>' + esc(nomE(e)) + '</td><td class="n">' + s.anual + '</td><td class="n">' + s.usados + '</td><td class="n">' + s.pendientes + '</td><td class="n"><b>' + s.saldo + '</b></td></tr>'; }).join('') : '';
    return '<section class="card"><div class="row sp"><h2>Vacaciones y pedidos</h2><div class="row"><label class="sr" for="rhPedEst">Estado</label><select id="rhPedEst" class="in fx">' + [['pendientes', 'Pendientes'], ['aprobado', 'Aprobados'], ['rechazado', 'Rechazados'], ['cancelado', 'Cancelados'], ['todos', 'Todos']].map(function (x) { return opt(x[0], x[1], f === x[0]); }).join('') + '</select><button class="btn pri sm" data-act="rh-ped-nuevo">' + CM.icon('plus') + 'Nuevo pedido</button></div></div>' +
      '<p class="hint" style="margin:4px 0 10px">Aprobación en ' + CM.rhCfg().niveles + ' nivel' + (CM.rhCfg().niveles > 1 ? 'es (RR. HH. y después administración)' : ' (RR. HH.)') + '. Nadie aprueba su propio pedido. Para licencias no escribas diagnósticos: el certificado va al legajo.</p>' +
      (L.length ? '<div class="tw"><table><thead><tr><th>Pedido</th>' + (todos ? '<th>Persona</th>' : '') + '<th>Tipo</th><th>Detalle</th><th>Estado</th><th></th></tr></thead><tbody>' + L.map(function (p) { return filaPed(p, todos); }).join('') + '</tbody></table></div>' : U.tablaVacia('No hay pedidos con ese filtro.')) + '</section>' +
      (saldos ? '<section class="card" style="margin-top:14px"><h2>Saldo de vacaciones ' + CM.hoy().slice(0, 4) + '</h2><div class="tw"><table><thead><tr><th>Persona</th><th class="n">Corresponden</th><th class="n">Tomados</th><th class="n">Pedidos pendientes</th><th class="n">Saldo</th></tr></thead><tbody>' + saldos + '</tbody></table></div><p class="hint">Días corridos según antigüedad (14 / 21 / 28 / 35) o lo cargado en el legajo. Referencia LCT art. 150 <b>[VERIFICAR con asesor/a laboral]</b>.</p></section>' : '');
  }
  document.addEventListener('change', function (ev) { if (ev.target.id === 'rhPedEst') { CM.rh.pedEst = ev.target.value; render(); } if (ev.target.id === 'rhLiqMes') { CM.rh.liqMes = ev.target.value; render(); } });
  CM.acts['rh-ped-nuevo'] = function () {
    if (!CM.need('personal', 'oper')) return;
    var todos = CM.can('rrhh', 'edit'), yo = CM.rhYo(), lst = todos ? (CM.db.staff || []).filter(function (e) { return e.activo !== false; }) : (yo ? [yo] : []);
    if (!lst.length) return CM.toast(todos ? 'Primero cargá al equipo en Legajos.' : 'Tu usuario no está vinculado a un legajo: pedile a RR. HH. que cargue tu correo en tu legajo.', true);
    CM.modal.open({ title: 'Nuevo pedido', body: '<form id="fRS" data-form="rh-ped" class="f" autocomplete="off" novalidate>' +
      fl('Persona *', '<select class="in" name="emp"' + (lst.length === 1 ? '' : '') + '>' + lst.map(function (e) { return opt(e.id, nomE(e), yo && yo.id === e.id); }).join('') + '</select>') +
      fl('Tipo *', '<select class="in" name="tipo" data-rs-tipo>' + Object.keys(TIPOS).map(function (k) { return opt(k, TIPOS[k]); }).join('') + '</select>') +
      '<div class="f f2">' + fl('Desde *', '<input class="in" type="date" name="desde">') + fl('Hasta', '<input class="in" type="date" name="hasta">') + '</div>' +
      '<div data-rs-monto hidden>' + fl('Monto del adelanto (en pesos) *', '<input class="in num" name="monto" inputmode="decimal" placeholder="0">') + '</div>' +
      fl('Motivo / comentario', '<input class="in" name="motivo" maxlength="160" placeholder="Sin diagnósticos médicos">') + '<p class="hint" data-rs-saldo></p><p class="err" role="alert" data-err></p></form>',
      footer: '<button class="btn" type="button" data-act="modal-close">Cancelar</button><button class="btn pri" type="submit" form="fRS">Enviar pedido</button>' });
    saldoHint();
  };
  function saldoHint() { var f = document.getElementById('fRS'); if (!f) return; var e = emp(f.elements.emp.value), t = f.elements.tipo.value; f.querySelector('[data-rs-monto]').hidden = t !== 'adelanto'; var h = f.querySelector('[data-rs-saldo]'); if (h) { if (e && t === 'vacaciones') { var s = CM.rhVacSaldo(e); h.textContent = 'Saldo de vacaciones: ' + s.saldo + ' de ' + s.anual + ' días' + (s.pendientes ? ' (' + s.pendientes + ' en pedidos pendientes)' : '') + '.'; } else h.textContent = ''; } }
  document.addEventListener('change', function (ev) { if (ev.target.form && ev.target.form.id === 'fRS') saldoHint(); });
  CM.forms['rh-ped'] = function (f) {
    if (f.dataset.busy || !CM.need('personal', 'oper')) return;
    var x = f.elements, e = emp(x.emp.value), tipo = x.tipo.value; if (!e) return fail(f, 'emp', 'Elegí la persona.');
    var yo = CM.rhYo(); if (!CM.can('rrhh', 'edit') && (!yo || yo.id !== e.id)) return fail(f, 'emp', 'Sólo podés pedir para vos.');
    if (!TIPOS[tipo]) return fail(f, 'tipo', 'Elegí el tipo.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(x.desde.value)) return fail(f, 'desde', 'Elegí la fecha.');
    var hasta = x.hasta.value || x.desde.value; if (hasta < x.desde.value) return fail(f, 'hasta', '«Hasta» no puede ser antes de «Desde».');
    var o = { id: CM.nextId('RS'), emp: e.id, tipo: tipo, desde: x.desde.value, hasta: tipo === 'adelanto' ? x.desde.value : hasta, motivo: x.motivo.value.trim().slice(0, 160), estado: 'pendiente', pasos: [], ts: new Date().toISOString(), user: CM.db.cfg.operador };
    if (tipo === 'adelanto') { var mo = CM.parseMonto(x.monto.value); if (isNaN(mo) || mo <= 0) return fail(f, 'monto', 'Escribí el monto del adelanto.'); o.monto = mo; }
    if (tipo === 'vacaciones') { var s = CM.rhVacSaldo(e, o.desde.slice(0, 4)), d = diasCorridos(o.desde, o.hasta); if (d > s.saldo - s.pendientes) return fail(f, 'hasta', 'Pide ' + d + ' días y le quedan ' + (s.saldo - s.pendientes) + ' (contando pedidos pendientes).'); }
    if (arr('rhsol').some(function (p) { return p.emp === e.id && p.tipo !== 'adelanto' && tipo !== 'adelanto' && (p.estado === 'aprobado' || /^pendiente/.test(p.estado)) && p.desde <= o.hasta && (p.hasta || p.desde) >= o.desde; })) return fail(f, 'desde', 'Ya hay un pedido para esas fechas.');
    f.dataset.busy = '1'; arr('rhsol').push(o);
    CM.audit('RR. HH.: pedido', o.id + ' · ' + nomE(e) + ' · ' + TIPOS[tipo] + ' · ' + detPed(o)); CM.save(); CM.modal.close(true); render(); CM.toast('Pedido enviado.');
  };
  CM.acts['rh-ped-dec'] = function (t) {
    var p = arr('rhsol').filter(function (x) { return x.id === t.getAttribute('data-id'); })[0], d = t.getAttribute('data-d'); if (!p) return;
    if (!puedeAprobar(p)) return CM.toast('No podés decidir este pedido (permiso de RR. HH. o es tuyo).', true);
    CM.modal.open({ title: (d === 'aprobado' ? 'Aprobar ' : 'Rechazar ') + 'pedido ' + p.id, body: '<form id="fRDc" data-form="rh-ped-dec" class="f" novalidate><input type="hidden" name="id" value="' + esc(p.id) + '"><input type="hidden" name="d" value="' + esc(d) + '"><p style="margin:0">' + esc(nomE(emp(p.emp))) + ' · ' + esc(TIPOS[p.tipo]) + ' · ' + esc(detPed(p)) + '</p>' + fl('Comentario' + (d === 'rechazado' ? ' *' : ''), '<input class="in" name="nota" maxlength="160">') + '<p class="err" role="alert" data-err></p></form>',
      footer: '<button class="btn" type="button" data-act="modal-close">Volver</button><button class="btn ' + (d === 'aprobado' ? 'pri' : 'bad') + '" type="submit" form="fRDc">' + (d === 'aprobado' ? 'Aprobar' : 'Rechazar') + '</button>' });
  };
  CM.forms['rh-ped-dec'] = function (f) {
    var p = arr('rhsol').filter(function (x) { return x.id === f.elements.id.value; })[0], d = f.elements.d.value, nota = f.elements.nota.value.trim(); if (!p || !puedeAprobar(p)) return;
    if (d === 'rechazado' && nota.length < 3) return fail(f, 'nota', 'Escribí el motivo del rechazo.');
    var nivel = p.estado === 'pendiente-2' ? 2 : 1;
    (p.pasos = p.pasos || []).push({ nivel: nivel, decision: d, user: CM.db.cfg.operador, ts: new Date().toISOString(), nota: nota });
    p.estado = d === 'rechazado' ? 'rechazado' : (nivel === 1 && CM.rhCfg().niveles === 2 ? 'pendiente-2' : 'aprobado');
    CM.audit('RR. HH.: pedido ' + (d === 'aprobado' ? 'aprobado' : 'rechazado') + ' (nivel ' + nivel + ')', p.id + ' · ' + nomE(emp(p.emp)) + (nota ? ' · ' + nota : '')); CM.save(); CM.modal.close(true); render();
    CM.toast(p.estado === 'pendiente-2' ? 'Aprobado en el primer nivel: falta administración.' : p.estado === 'aprobado' ? 'Pedido aprobado.' : 'Pedido rechazado.');
  };
  CM.acts['rh-ped-cancel'] = function (t) {
    var p = arr('rhsol').filter(function (x) { return x.id === t.getAttribute('data-id'); })[0]; if (!p || !/^pendiente/.test(p.estado)) return;
    p.estado = 'cancelado'; (p.pasos = p.pasos || []).push({ nivel: 0, decision: 'cancelado', user: CM.db.cfg.operador, ts: new Date().toISOString(), nota: '' });
    CM.audit('RR. HH.: pedido cancelado', p.id); CM.save(); render();
  };

  /* ---------- liquidación interna ---------- */
  CM.rhLiquidar = function (e, mes, ajuste) {
    var p = priv(e.id) || { remun: { tipo: 'ninguna', monto: 0 } }, c = CM.rhCfg(), r = CM.rhResumen(e, mes), hDia = minEsperados(e) / 60;
    var vh = p.remun.tipo === 'hora' ? p.remun.monto : p.remun.tipo === 'mensual' ? Math.round(p.remun.monto / (hDia * 22)) : 0;
    var base = p.remun.tipo === 'mensual' ? p.remun.monto : p.remun.tipo === 'hora' ? Math.round(p.remun.monto * r.trab / 60) : 0;
    var extras = p.remun.tipo === 'mensual' ? Math.round(r.extra / 60 * vh * (1 + c.recargo / 100)) : 0;
    var descAus = c.descAus && p.remun.tipo === 'mensual' ? Math.round(r.ausencias * p.remun.monto / 30) : 0;
    var adel = arr('rhsol').filter(function (x) { return x.emp === e.id && x.tipo === 'adelanto' && x.estado === 'aprobado' && String(x.desde).slice(0, 7) === mes; }).reduce(function (a, x) { return a + (x.monto || 0); }, 0);
    ajuste = ajuste || 0;
    var bruto = Math.max(0, base + extras - descAus + ajuste), lineas = [['Remuneración ' + (p.remun.tipo === 'hora' ? '(' + hm(r.trab) + ' × ' + money(vh) + ')' : p.remun.tipo === 'mensual' ? 'mensual' : '—'), base]];
    if (extras) lineas.push(['Horas extra (' + hm(r.extra) + ', +' + c.recargo + ' %)', extras]);
    if (descAus) lineas.push(['Ausencias sin justificar (' + r.ausencias + ' día' + (r.ausencias > 1 ? 's' : '') + ')', -descAus]);
    if (ajuste) lineas.push(['Ajuste', ajuste]);
    var ded = c.deducciones.filter(function (d) { return d.pct > 0; }).map(function (d) { return [d.n + ' (' + String(d.pct).replace('.', ',') + ' %)', -Math.round(bruto * d.pct / 100)]; });
    var totDed = ded.reduce(function (a, d) { return a - d[1]; }, 0);
    if (adel) ded.push(['Adelantos del mes', -adel]);
    return { emp: e.id, nombre: nomE(e), mes: mes, res: r, remun: p.remun, vh: vh, lineas: lineas, deducciones: ded, bruto: bruto, neto: bruto - totDed - adel, adelantos: adel };
  };
  function liqHtml() {
    if (!CM.can('rrhh', 'ver')) return '';
    var mes = CM.rh.liqMes || CM.mesActual(), act = (CM.db.staff || []).filter(function (e) { return e.activo !== false; }), meses = {};
    meses[CM.mesActual()] = 1; for (var i = 1; i < 6; i++) meses[CM.addDays(CM.mesActual() + '-01', -28 * i).slice(0, 7)] = 1;
    var rows = act.map(function (e) {
      var l = CM.rhLiquidar(e, mes), cer = arr('rhliq').filter(function (x) { return x.emp === e.id && x.mes === mes; }).sort(function (a, b) { return (b.v || 1) - (a.v || 1); })[0];
      return '<tr><td><b>' + esc(nomE(e)) + '</b><br><small class="hint">' + esc(l.remun.tipo === 'ninguna' ? 'Sin remuneración' : l.remun.tipo === 'hora' ? 'Por hora ' + money(l.remun.monto) : 'Mensual ' + money(l.remun.monto)) + '</small></td><td class="n">' + esc(hm(l.res.trab)) + '</td><td class="n">' + esc(hm(l.res.extra)) + '</td><td class="n">' + l.res.tardanzas + (l.res.minTarde ? '<br><small class="hint">' + esc(hm(l.res.minTarde)) + '</small>' : '') + '</td><td class="n">' + l.res.ausencias + '</td><td class="n">' + esc(money(l.bruto)) + '</td><td class="n"><b>' + esc(money(cer ? cer.neto : l.neto)) + '</b></td><td>' + (cer ? '<span class="pill p-ok">Cerrada' + (cer.v > 1 ? ' v' + cer.v : '') + '</span>' : '<span class="pill p-mu">Borrador</span>') + '</td><td><div class="row"><button class="btn sm" data-act="rh-liq-ver" data-id="' + esc(e.id) + '">' + (cer ? 'Ver' : 'Revisar y cerrar') + '</button></div></td></tr>';
    }).join('');
    return '<section class="card"><div class="row sp"><h2>Liquidación interna</h2><div class="row"><label class="sr" for="rhLiqMes">Mes</label><select id="rhLiqMes" class="in fx">' + Object.keys(meses).sort().reverse().map(function (m) { return opt(m, m.slice(5) + '/' + m.slice(0, 4), m === mes); }).join('') + '</select><button class="btn sm" data-act="rh-liq-csv">' + CM.icon('dl') + 'Exportar CSV</button></div></div>' +
      (rows ? '<div class="tw"><table><thead><tr><th>Persona</th><th class="n">Horas</th><th class="n">Extra</th><th class="n">Tardanzas</th><th class="n">Ausencias</th><th class="n">Bruto</th><th class="n">Neto</th><th>Estado</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' : U.tablaVacia('No hay personas activas.')) +
      '<div class="note warn" style="margin-top:10px">Liquidación <b>interna</b> para organizar los pagos: no reemplaza el recibo de haberes legal ni el libro de sueldos. Las deducciones se configuran en «Ajustes de RR. HH.» y no se inventan alícuotas: <b>[VERIFICAR con el contador]</b>.</div></section>';
  }
  CM.acts['rh-liq-ver'] = function (t) {
    if (!CM.need('rrhh', 'ver')) return;
    var e = emp(t.getAttribute('data-id')), mes = CM.rh.liqMes || CM.mesActual(); if (!e) return;
    var cer = arr('rhliq').filter(function (x) { return x.emp === e.id && x.mes === mes; }).sort(function (a, b) { return (b.v || 1) - (a.v || 1); })[0], l = cer || CM.rhLiquidar(e, mes);
    var tabla = function (L) { return L.map(function (x) { return '<tr><td>' + esc(x[0]) + '</td><td class="n">' + (x[1] < 0 ? '− ' : '') + esc(money(Math.abs(x[1]))) + '</td></tr>'; }).join(''); };
    CM.modal.open({ title: 'Liquidación ' + mes.slice(5) + '/' + mes.slice(0, 4) + ' · ' + nomE(e) + (cer ? ' · cerrada' : ''), wide: true,
      body: '<div class="kv"><div><small>Días trabajados</small><b>' + l.res.dias + '</b></div><div><small>Horas</small><b>' + esc(hm(l.res.trab)) + '</b></div><div><small>Extra</small><b>' + esc(hm(l.res.extra)) + '</b></div><div><small>Tardanzas</small><b>' + l.res.tardanzas + '</b></div><div><small>Ausencias</small><b>' + l.res.ausencias + '</b></div><div><small>Licencias / vacaciones</small><b>' + l.res.licencias + ' día(s)</b></div></div>' +
        '<div class="tw" style="margin-top:10px"><table><tbody>' + tabla(l.lineas) + '<tr class="tot"><td><b>Bruto</b></td><td class="n"><b>' + esc(money(l.bruto)) + '</b></td></tr>' + tabla(l.deducciones) + '<tr class="tot"><td><b>Neto a pagar</b></td><td class="n"><b>' + esc(money(l.neto)) + '</b></td></tr></tbody></table></div>' +
        (cer ? '<p class="hint">Cerrada por ' + esc(cer.user) + ' el ' + esc(CM.fmtFH(cer.ts)) + (cer.nota ? ' · ' + esc(cer.nota) : '') + ' · sello <code>' + esc(String(cer.hash).slice(0, 12)) + '</code>. Si hay que corregirla, se cierra una nueva versión.</p>' : '') +
        (CM.can('rrhh', 'edit') ? '<form id="fRLq" data-form="rh-liq" class="f" autocomplete="off" novalidate style="margin-top:10px"><input type="hidden" name="id" value="' + esc(e.id) + '"><div class="f f2">' + fl('Ajuste (+ / −, en pesos)', '<input class="in" name="ajuste" inputmode="decimal" placeholder="Ej.: 5000 o -2000">') + fl('Nota' + (cer ? ' (motivo de la nueva versión) *' : ''), '<input class="in" name="nota" maxlength="160">') + '</div><p class="err" role="alert" data-err></p></form>' : ''),
      footer: '<button class="btn" data-act="modal-close">Cerrar</button><button class="btn" data-act="rh-liq-print" data-id="' + esc(e.id) + '">' + CM.icon('print') + 'Imprimir</button>' + (CM.can('rrhh', 'edit') ? '<button class="btn pri" type="submit" form="fRLq">' + CM.icon('lock') + (cer ? 'Cerrar nueva versión' : 'Cerrar liquidación') + '</button>' : '') });
  };
  CM.forms['rh-liq'] = function (f) {
    if (f.dataset.busy || !CM.need('rrhh', 'edit')) return;
    var e = emp(f.elements.id.value), mes = CM.rh.liqMes || CM.mesActual(); if (!e) return;
    var aj = 0, s = f.elements.ajuste.value.trim(); if (s) { var neg = /^-/.test(s); aj = CM.parseMonto(s.replace(/^[-+]/, '')); if (isNaN(aj)) return fail(f, 'ajuste', 'Ajuste inválido.'); if (neg) aj = -aj; }
    var prev = arr('rhliq').filter(function (x) { return x.emp === e.id && x.mes === mes; }), nota = f.elements.nota.value.trim();
    if (prev.length && nota.length < 4) return fail(f, 'nota', 'Escribí el motivo de la nueva versión.');
    f.dataset.busy = '1';
    var l = CM.rhLiquidar(e, mes, aj); l.id = CM.nextId('LQ'); l.v = prev.length + 1; l.ref = prev.length ? prev[prev.length - 1].id : ''; l.ts = new Date().toISOString(); l.user = CM.db.cfg.operador; l.nota = nota; l.ajuste = aj;
    l.hash = CM.sha256(JSON.stringify([l.emp, l.mes, l.v, l.lineas, l.deducciones, l.bruto, l.neto, l.ts, l.user]));
    arr('rhliq').push(l); CM.audit('RR. HH.: liquidación cerrada', l.id + ' · ' + nomE(e) + ' · ' + mes + ' · v' + l.v + ' · neto ' + money(l.neto)); CM.save(); CM.modal.close(true); render(); CM.toast('Liquidación cerrada.');
  };
  function reciboTxt(l) {
    var L = ['FUNDACION CANNABISMATICA I+D', 'LIQUIDACION INTERNA ' + l.mes.slice(5) + '/' + l.mes.slice(0, 4) + (l.v > 1 ? ' (version ' + l.v + ')' : ''), 'NO VALIDO COMO RECIBO DE HABERES', '', 'Persona: ' + l.nombre, 'Horas: ' + hm(l.res.trab) + ' · extra ' + hm(l.res.extra) + ' · ausencias ' + l.res.ausencias, ''];
    l.lineas.concat([['BRUTO', l.bruto]]).concat(l.deducciones).concat([['NETO A PAGAR', l.neto]]).forEach(function (x) { L.push(x[0] + ': ' + (x[1] < 0 ? '- ' : '') + money(Math.abs(x[1]))); });
    L.push('', 'Firma: ______________________', 'Desarrollado por VINCULAR BUSINESS'); return L.join('\n');
  }
  CM.acts['rh-liq-print'] = function (t) {
    var e = emp(t.getAttribute('data-id')), mes = CM.rh.liqMes || CM.mesActual(); if (!e) return;
    var l = arr('rhliq').filter(function (x) { return x.emp === e.id && x.mes === mes; }).sort(function (a, b) { return (b.v || 1) - (a.v || 1); })[0] || CM.rhLiquidar(e, mes);
    CM.imprimir('<pre class="tk tkp" style="max-width:520px;white-space:pre-wrap">' + esc(reciboTxt(l)) + '</pre>');
  };
  CM.acts['rh-liq-csv'] = function () {
    if (!CM.need('rrhh', 'ver')) return; var mes = CM.rh.liqMes || CM.mesActual(), m = function (v) { return (v / 100).toFixed(2).replace('.', ','); };
    CM.descargar('liquidacion_' + mes + '.csv', CM.csv(['Persona', 'Mes', 'Estado', 'Horas', 'Horas extra', 'Tardanzas', 'Ausencias', 'Bruto', 'Deducciones y adelantos', 'Neto'], (CM.db.staff || []).filter(function (e) { return e.activo !== false; }).map(function (e) {
      var c = arr('rhliq').filter(function (x) { return x.emp === e.id && x.mes === mes; }).sort(function (a, b) { return (b.v || 1) - (a.v || 1); })[0], l = c || CM.rhLiquidar(e, mes);
      return [nomE(e), mes, c ? 'Cerrada v' + c.v : 'Borrador', hm(l.res.trab), hm(l.res.extra), l.res.tardanzas, l.res.ausencias, m(l.bruto), m(l.bruto - l.neto), m(l.neto)];
    })));
  };

  /* ---------- mi portal ---------- */
  function portalHtml() {
    var e = CM.rhYo();
    if (!e) return '<section class="card"><h2>Mi portal</h2><p>Tu usuario todavía no está vinculado a un legajo. RR. HH. tiene que cargar tu correo en tu legajo (Legajos → Legajo → «Correo»).</p></section>';
    var mes = CM.mesActual(), r = CM.rhResumen(e, mes), s = CM.rhVacSaldo(e), j = jornada(e);
    var fs = (CM.db.fichas || []).filter(function (x) { return x.emp === e.id; }).sort(function (a, b) { return b.ts.localeCompare(a.ts); }).slice(0, 12);
    var mis = arr('rhsol').filter(function (p) { return p.emp === e.id; }).sort(function (a, b) { return String(b.ts).localeCompare(String(a.ts)); }).slice(0, 10);
    var geo = CM.rhCfg().geo;
    return '<div class="grid g4"><div class="card kpi"><div class="l">Horas este mes</div><div class="v">' + esc(hm(r.trab)) + '</div><div class="s">' + r.dias + ' día(s) trabajados</div></div><div class="card kpi"><div class="l">Tardanzas / ausencias</div><div class="v">' + r.tardanzas + ' / ' + r.ausencias + '</div><div class="s">Horario ' + esc(j.ent ? j.ent + '–' + j.sal : 'sin cargar') + '</div></div><div class="card kpi"><div class="l">Vacaciones ' + CM.hoy().slice(0, 4) + '</div><div class="v">' + s.saldo + '</div><div class="s">de ' + s.anual + ' días</div></div><div class="card kpi"><div class="l">Pedidos pendientes</div><div class="v">' + mis.filter(function (p) { return /^pendiente/.test(p.estado); }).length + '</div><div class="s">Vacaciones, licencias, adelantos</div></div></div>' +
      '<div class="row" style="margin:14px 0"><button class="btn pri" data-act="rh-geo-fichar">' + CM.icon('clock') + 'Fichar desde mi celular' + (geo.on ? ' (con ubicación)' : '') + '</button><button class="btn" data-act="rh-ped-nuevo">' + CM.icon('plus') + 'Nuevo pedido</button><button class="btn" data-act="emp-carnet" data-id="' + esc(e.id) + '">' + CM.icon('qr') + 'Mi carnet</button></div>' +
      '<div class="grid g2"><section class="card"><h2>Mis últimas fichadas</h2>' + (fs.length ? '<div class="tw"><table><thead><tr><th>Fecha y hora</th><th>Tipo</th><th>Método</th></tr></thead><tbody>' + fs.map(function (x) { return '<tr><td>' + esc(CM.fmtFH(x.ts)) + '</td><td>' + (x.tipo === 'entrada' ? '<span class="pill p-ok">Entrada</span>' : '<span class="pill p-info">Salida</span>') + '</td><td>' + esc(x.metodo) + '</td></tr>'; }).join('') + '</tbody></table></div>' : U.tablaVacia('Todavía no fichaste.')) + '</section>' +
      '<section class="card"><h2>Mis pedidos</h2>' + (mis.length ? '<div class="tw"><table><thead><tr><th>Pedido</th><th>Tipo</th><th>Detalle</th><th>Estado</th><th></th></tr></thead><tbody>' + mis.map(function (p) { return filaPed(p, false); }).join('') + '</tbody></table></div>' : U.tablaVacia('Sin pedidos.')) + '</section></div>';
  }
  function distM(a, b, c, d) { var R = 6371000, r = Math.PI / 180, x = Math.sin((c - a) * r / 2), y = Math.sin((d - b) * r / 2), h = x * x + Math.cos(a * r) * Math.cos(c * r) * y * y; return Math.round(2 * R * Math.asin(Math.sqrt(h))); }
  CM.rhDist = distM;
  CM.acts['rh-geo-fichar'] = function () {
    var e = CM.rhYo(); if (!e) return CM.toast('Tu usuario no está vinculado a un legajo.', true);
    if (!CM.need('personal', 'oper')) return;
    var geo = CM.rhCfg().geo;
    if (!geo.on) return registrar(CM.fichar(e.dni, 'Celular (sin ubicación)'));
    if (!g.navigator.geolocation) return CM.toast('Este celular no informa la ubicación.', true);
    CM.toast('Buscando tu ubicación…');
    g.navigator.geolocation.getCurrentPosition(function (pos) {
      var d = distM(geo.lat, geo.lng, pos.coords.latitude, pos.coords.longitude), acc = Math.round(pos.coords.accuracy || 0);
      if (d - Math.min(acc, 100) > geo.radio) { CM.audit('Fichada rechazada (fuera de la zona)', nomE(e) + ' · a ' + d + ' m'); CM.save(); return CM.toast('Estás a ' + d + ' m de la fundación (se permite hasta ' + geo.radio + ' m). No se registró la fichada.', true); }
      registrar(CM.fichar(e.dni, 'Celular con ubicación'), { dist: d, prec: acc });   /* se guarda la distancia, no las coordenadas */
    }, function () { CM.toast('No hay permiso para usar la ubicación: activalo para fichar desde el celular.', true); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  };

  /* ---------- ajustes de RR. HH. ---------- */
  function cfgHtml() {
    var c = CM.rhCfg(), ded = c.deducciones.concat([{ n: '', pct: '' }, { n: '', pct: '' }]).slice(0, Math.max(3, c.deducciones.length + 1));
    return '<form class="card f" data-form="rh-cfg" autocomplete="off" novalidate><h2>Ajustes de RR. HH.</h2>' +
      '<div class="f f2">' + fl('Niveles de aprobación de pedidos', '<select class="in" name="niveles">' + opt('1', '1 nivel (RR. HH.)', c.niveles === 1) + opt('2', '2 niveles (RR. HH. y después administración)', c.niveles === 2) + '</select>') + fl('Tolerancia de llegada por defecto (min)', '<input class="in num" name="tol" inputmode="numeric" value="' + c.tol + '">') + '</div>' +
      '<div class="f f2">' + fl('Recargo de horas extra (%)', '<input class="in num" name="recargo" inputmode="decimal" value="' + c.recargo + '">') + fl('Minutos mínimos para contar horas extra', '<input class="in num" name="extraMin" inputmode="numeric" value="' + c.extraMin + '">') + '</div>' +
      '<label class="chk"><input type="checkbox" name="descAus"' + (c.descAus ? ' checked' : '') + '><span>Descontar ausencias sin justificar en la liquidación (sueldo ÷ 30 por día)</span></label>' +
      '<fieldset><legend>Deducciones de la liquidación interna</legend><p class="hint" style="margin:0 0 8px">Nombre y porcentaje sobre el bruto. Dejá vacío lo que no corresponda. <b>[VERIFICAR con el contador]</b></p>' + ded.map(function (d, i) { return '<div class="f f2">' + fl('Concepto ' + (i + 1), '<input class="in" name="dn' + i + '" maxlength="40" value="' + esc(d.n || '') + '">') + fl('%', '<input class="in num" name="dp' + i + '" inputmode="decimal" value="' + esc(d.pct === '' ? '' : String(d.pct).replace('.', ',')) + '">') + '</div>'; }).join('') + '<input type="hidden" name="nded" value="' + ded.length + '"></fieldset>' +
      '<fieldset><legend>Fichaje desde el celular (geocerca)</legend><label class="chk"><input type="checkbox" name="geoOn"' + (c.geo.on ? ' checked' : '') + '><span>Pedir la ubicación y aceptar sólo dentro de la zona</span></label><div class="f f2">' + fl('Latitud', '<input class="in" name="lat" inputmode="decimal" value="' + (c.geo.lat == null ? '' : c.geo.lat) + '">') + fl('Longitud', '<input class="in" name="lng" inputmode="decimal" value="' + (c.geo.lng == null ? '' : c.geo.lng) + '">') + '</div>' + fl('Radio permitido (metros)', '<input class="in num" name="radio" inputmode="numeric" value="' + (c.geo.radio || 150) + '">') + '<button class="btn sm" type="button" data-act="rh-geo-aqui">Usar mi ubicación actual</button><p class="hint">Se guarda sólo la distancia de cada fichada, no las coordenadas de la persona.</p></fieldset>' +
      fl('Feriados (uno por línea, AAAA-MM-DD)', '<textarea class="in" name="feriados" style="min-height:90px" placeholder="2026-12-08">' + esc(c.feriados.join('\n')) + '</textarea>') +
      '<fieldset><legend>Carnets</legend><p class="hint" style="margin:0 0 8px">Los QR de los carnets se firman con un secreto de la fundación. ' + (c.sec ? 'Ya hay un secreto: regenerarlo invalida todos los carnets impresos.' : 'Todavía se usa la firma de prueba: generá el secreto y reimprimí los carnets.') + '</p><button class="btn sm" type="button" data-act="rh-sec">' + (c.sec ? 'Regenerar secreto' : 'Generar secreto') + '</button></fieldset>' +
      '<p class="err" role="alert" data-err></p><div class="row"><button class="btn pri" type="submit">Guardar ajustes de RR. HH.</button></div></form>';
  }
  CM.acts['rh-geo-aqui'] = function (t) {
    var f = t.closest('form'); if (!f || !g.navigator.geolocation) return CM.toast('Este equipo no informa la ubicación.', true);
    g.navigator.geolocation.getCurrentPosition(function (p) { f.elements.lat.value = p.coords.latitude.toFixed(6); f.elements.lng.value = p.coords.longitude.toFixed(6); CM.toast('Ubicación cargada (precisión ' + Math.round(p.coords.accuracy) + ' m).'); }, function () { CM.toast('No hay permiso para la ubicación.', true); });
  };
  CM.acts['rh-sec'] = function () {
    if (!CM.need('rrhh', 'admin')) return;
    var a = new Uint32Array(4); g.crypto.getRandomValues(a); var nuevo = Array.prototype.map.call(a, function (x) { return x.toString(36); }).join('');
    var tenia = !!CM.rhCfg().sec;
    (CM.db.staff || []).forEach(function (e) { delete e.pinH; });   /* el PIN depende del secreto: hay que reasignarlo */
    guardarCfg({ sec: nuevo }); CM.audit('RR. HH.: secreto de carnets ' + (tenia ? 'regenerado' : 'generado'), 'Los carnets anteriores dejan de valer; los PIN se vuelven a asignar'); CM.save(); render();
    CM.toast('Secreto ' + (tenia ? 'regenerado' : 'generado') + '. Reimprimí los carnets y asigná los PIN de nuevo.');
  };
  CM.forms['rh-cfg'] = function (f) {
    if (!CM.need('rrhh', 'admin')) return;
    var x = f.elements, n = function (v) { return Number(String(v).replace(',', '.')); };
    var tol = parseInt(x.tol.value, 10), rec = n(x.recargo.value), em = parseInt(x.extraMin.value, 10);
    if (isNaN(tol) || tol < 0 || tol > 120) return fail(f, 'tol', 'Tolerancia entre 0 y 120.');
    if (isNaN(rec) || rec < 0 || rec > 300) return fail(f, 'recargo', 'Recargo entre 0 y 300 %.');
    if (isNaN(em) || em < 0 || em > 240) return fail(f, 'extraMin', 'Entre 0 y 240 minutos.');
    var ded = [], nd = +x.nded.value;
    for (var i = 0; i < nd; i++) { var dn = x['dn' + i].value.trim(), dp = x['dp' + i].value.trim(); if (!dn && !dp) continue; var pv = n(dp); if (!dn || isNaN(pv) || pv < 0 || pv > 50) return fail(f, 'dp' + i, 'Revisá el concepto ' + (i + 1) + ' (nombre y % entre 0 y 50).'); ded.push({ n: dn, pct: pv }); }
    var fer = x.feriados.value.split(/\s+/).filter(Boolean); if (fer.some(function (d) { return !/^\d{4}-\d{2}-\d{2}$/.test(d); })) return fail(f, 'feriados', 'Escribí cada feriado como AAAA-MM-DD, uno por línea.');
    var geo = { on: x.geoOn.checked, lat: x.lat.value.trim() ? n(x.lat.value) : null, lng: x.lng.value.trim() ? n(x.lng.value) : null, radio: parseInt(x.radio.value, 10) || 150 };
    if (geo.on && (geo.lat == null || geo.lng == null || isNaN(geo.lat) || isNaN(geo.lng) || Math.abs(geo.lat) > 90 || Math.abs(geo.lng) > 180)) return fail(f, 'lat', 'Para usar la geocerca cargá latitud y longitud (o «Usar mi ubicación actual»).');
    if (geo.radio < 20 || geo.radio > 5000) return fail(f, 'radio', 'Radio entre 20 y 5000 metros.');
    guardarCfg({ niveles: +x.niveles.value === 2 ? 2 : 1, tol: tol, recargo: rec, extraMin: em, descAus: x.descAus.checked, deducciones: ded, feriados: fer.sort(), geo: geo });
    CM.audit('RR. HH.: ajustes', 'niveles ' + x.niveles.value + ' · recargo ' + rec + ' % · ' + ded.length + ' deducción(es) · geocerca ' + (geo.on ? geo.radio + ' m' : 'no')); CM.save(); render(); CM.toast('Ajustes de RR. HH. guardados.');
  };

})(window);
