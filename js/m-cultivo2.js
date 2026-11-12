/* Sistema VB ONG · Cultivo: lote por genética y trazabilidad completa · 2026-11-11
   Pedido de la fundación: varias genéticas en una sala y que CADA genética siga su trazabilidad completa:
     sala (ciclo) → genética → lote → dispensación → paciente (legajo).
   · «Cosecha → lote» en cada genética: crea el lote con su ciclo Y su genética, ingresa el stock y (opcional) marca la
     genética como cosechada. Se puede cosechar en partes: cada parte es un lote nuevo de esa genética.
   · «Genética de un lote» (Trazabilidad / Stock): vincula un lote existente a una genética de un ciclo, con motivo e historial.
   · La dispensación guarda la genética del lote (además del ciclo). Los registros diarios siguen siendo de la sala y
     pueden indicar a qué genética se refieren.
   · En cada genética se ve qué lotes salieron, cuánto se dispensó y a cuántos pacientes; «Ver trazabilidad» muestra la cadena. */
(function (g) {
  'use strict';
  var CM = g.CM, esc = CM.esc, U = CM.U, fl = U.fl, opt = U.opt, fail = U.fail;
  var render = function () { CM.render(); };
  function nf(v) { return CM.fmtNum(v); }
  function cantTxt(c, u) { return U.cantTxt ? U.cantTxt(c, u) : nf(c) + ' ' + u; }
  function gen(c, gid) { return ((c && c.geneticas) || []).filter(function (x) { return x.id === gid; })[0] || null; }
  function yymm() { var h = CM.hoy(); return h.slice(2, 4) + h.slice(5, 7); }

  /* ---------- trazabilidad de una genética ---------- */
  CM.trazGen = function (c, x) {
    var lotes = (CM.db.lotes || []).filter(function (l) { return l.cu === c.id && l.gen === x.id; }), ids = {};
    lotes.forEach(function (l) { ids[l.id] = 1; });
    var disp = (CM.db.disp || []).filter(function (d) { return !d.anulada && (d.gen === x.id || ids[d.lote]); });
    var pac = {}, porU = {}, ing = 0;
    disp.forEach(function (d) { pac[d.dni] = 1; porU[d.unidad] = (porU[d.unidad] || 0) + d.cant; });
    lotes.forEach(function (l) { ing += (CM.db.movs || []).filter(function (m) { return m.lote === l.id && m.tipo === 'ingreso'; }).reduce(function (a, m) { return a + m.cant; }, 0); });
    return { lotes: lotes, disp: disp, pacientes: Object.keys(pac).length, porU: porU, ingreso: ing };
  };
  CM.trazGenCelda = function (c, x) {
    var t = CM.trazGen(c, x);
    if (!t.lotes.length) return '<span class="hint">Sin lotes todavía</span>';
    var dsp = Object.keys(t.porU).map(function (u) { return cantTxt(Math.round(t.porU[u] * 100) / 100, u); }).join(' + ') || '0';
    return '<small>' + t.lotes.map(function (l) { return esc(l.id); }).join(', ') + '</small><br><b>' + esc(dsp) + '</b> dispensado' + (t.pacientes ? ' a ' + t.pacientes + ' paciente' + (t.pacientes > 1 ? 's' : '') : '') +
      ' <button class="btn sm" data-act="gen-traz" data-id="' + esc(c.id) + '" data-g="' + esc(x.id) + '">Ver trazabilidad</button>';
  };
  CM.acts['gen-traz'] = function (t) {
    var c = CM.cultivo(t.getAttribute('data-id')), x = gen(c, t.getAttribute('data-g')); if (!c || !x) return;
    var tz = CM.trazGen(c, x);
    var lt = tz.lotes.map(function (l) { var ing = (CM.db.movs || []).filter(function (m) { return m.lote === l.id && m.tipo === 'ingreso'; }).reduce(function (a, m) { return a + m.cant; }, 0); return '<tr><td><b>' + esc(l.id) + '</b><br><small class="hint">' + esc(l.nombre) + '</small></td><td>' + esc(CM.PRODUCTOS[l.prod] ? CM.PRODUCTOS[l.prod].n : l.prod) + '</td><td>' + esc(CM.fmtFecha(l.ingreso)) + '</td><td class="n">' + esc(cantTxt(ing, l.unidad)) + '</td><td class="n"><b>' + esc(cantTxt(CM.stockLote(l.id), l.unidad)) + '</b></td></tr>'; }).join('');
    var dt = tz.disp.slice().sort(function (a, b) { return String(b.ts).localeCompare(String(a.ts)); }).map(function (d) { return '<tr><td>' + esc(CM.fmtFecha(d.fecha)) + '</td><td>' + esc(d.id) + '</td><td>' + esc(CM.legDe(d.dni) || '—') + '</td><td>' + esc(d.lote) + '</td><td class="n">' + esc(cantTxt(d.cant, d.unidad)) + '</td></tr>'; }).join('');
    CM.modal.open({
      title: 'Trazabilidad · ' + x.variedad, wide: true,
      body: '<ol class="traz"><li><small>Sala / ciclo</small><b>' + esc(c.nombre) + '</b><span class="hint">' + esc(c.id) + ' · inicio ' + esc(CM.fmtFecha(c.inicio)) + '</span></li><li><small>Genética</small><b>' + esc(x.variedad) + '</b><span class="hint">' + esc((x.tipo || 'sin tipo') + ' · ' + (x.plantas == null ? '—' : x.plantas) + ' plantas · ' + (x.estado || '')) + '</span></li>' +
        '<li><small>Lotes</small><b>' + tz.lotes.length + '</b><span class="hint">ingresó ' + esc(nf(tz.ingreso)) + '</span></li><li><small>Dispensaciones</small><b>' + tz.disp.length + '</b><span class="hint">' + tz.pacientes + ' paciente(s)</span></li></ol>' +
        '<h3>Lotes de esta genética</h3>' + (lt ? '<div class="tw"><table><thead><tr><th>Lote</th><th>Preparado</th><th>Ingreso</th><th class="n">Ingresó</th><th class="n">Disponible</th></tr></thead><tbody>' + lt + '</tbody></table></div>' : '<p class="hint">Sin lotes.</p>') +
        '<h3 style="margin-top:14px">Dispensaciones</h3>' + (dt ? '<div class="tw"><table><thead><tr><th>Fecha</th><th>N.º</th><th>Legajo</th><th>Lote</th><th class="n">Cantidad</th></tr></thead><tbody>' + dt + '</tbody></table></div>' : '<p class="hint">Todavía no se dispensó.</p>') +
        '<p class="hint">Para resguardar los datos de salud se muestra sólo el legajo del paciente.</p>',
      footer: '<button class="btn" data-act="modal-close">Cerrar</button><button class="btn pri" data-act="gen-traz-csv" data-id="' + esc(c.id) + '" data-g="' + esc(x.id) + '">' + CM.icon('dl') + 'Exportar CSV</button>'
    });
  };
  CM.acts['gen-traz-csv'] = function (t) {
    var c = CM.cultivo(t.getAttribute('data-id')), x = gen(c, t.getAttribute('data-g')); if (!c || !x) return;
    var tz = CM.trazGen(c, x);
    CM.descargar('trazabilidad_' + CM.norm(x.variedad).replace(/[^a-z0-9]+/g, '_') + '_' + CM.hoy() + '.csv', CM.csv(['Ciclo', 'Sala', 'Genética', 'Lote', 'Dispensación', 'Fecha', 'Legajo', 'Cantidad', 'Unidad'],
      tz.disp.map(function (d) { return [c.id, c.nombre, x.variedad, d.lote, d.id, d.fecha, CM.legDe(d.dni) || '', String(d.cant).replace('.', ','), d.unidad]; })));
  };

  /* ---------- cosecha → lote de la genética ---------- */
  CM.acts['gen-cosecha'] = function (t) {
    if (!CM.need('trazabilidad', 'edit')) return;
    var c = CM.cultivo(t.getAttribute('data-id')), x = gen(c, t.getAttribute('data-g')); if (!c || !x) return;
    var sug = CM.sugPorNombre ? CM.sugPorNombre(x.variedad) : 0;
    CM.modal.open({
      title: 'Cosecha de ' + x.variedad + ' → lote',
      body: '<form id="fGC" data-form="gen-cosecha" class="f" autocomplete="off" novalidate><input type="hidden" name="cu" value="' + esc(c.id) + '"><input type="hidden" name="gid" value="' + esc(x.id) + '">' +
        '<div class="note info">Sala <b>' + esc(c.nombre) + '</b> (' + esc(c.id) + ') · genética <b>' + esc(x.variedad) + '</b>. El lote queda vinculado a los dos: cada dispensación de ese lote sabe de qué genética y de qué sala salió.</div>' +
        '<div class="f f2">' + fl('Tipo de preparado *', '<select class="in" name="prod">' + Object.keys(CM.PRODUCTOS).map(function (k) { return opt(k, CM.PRODUCTOS[k].n + ' (' + CM.PRODUCTOS[k].un + ')', k === 'flores'); }).join('') + '</select>') +
        fl('Nombre del lote *', '<input class="in" name="nombre" maxlength="80" value="' + esc(x.variedad) + '">') + '</div>' +
        '<div class="f f2">' + fl('Cantidad que ingresa (peso seco / unidades) *', '<input class="in num" name="cant" inputmode="decimal" placeholder="0">') + fl('Quimiotipo', '<input class="in" name="quim" placeholder="Q1, Q2, Q3…">') + '</div>' +
        '<div class="f f2">' + fl('Aporte sugerido por unidad', '<input class="in num" name="sug" inputmode="decimal" placeholder="0"' + (sug ? ' value="' + esc(String(sug / 100).replace('.', ',')) + '"' : '') + '>') + fl('Aviso de stock bajo desde', '<input class="in num" name="min" inputmode="decimal" placeholder="' + esc(String(CM.db.cfg.stockBajoDefault)) + '">') + '</div>' +
        '<label class="chk"><input type="checkbox" name="marcar"' + (x.estado === 'Cosechada' ? '' : ' checked') + '><span>Marcar la genética como «Cosechada» (destildalo si es una cosecha parcial)</span></label>' +
        '<p class="err" role="alert" data-err></p></form>',
      footer: '<button class="btn" type="button" data-act="modal-close">Cancelar</button><button class="btn pri" type="submit" form="fGC">Crear lote</button>'
    });
  };
  CM.forms['gen-cosecha'] = function (f) {
    if (f.dataset.busy || !CM.need('trazabilidad', 'edit')) return;
    var e = f.elements, c = CM.cultivo(e.cu.value), x = gen(c, e.gid.value); if (!c || !x) return;
    var nombre = e.nombre.value.trim().replace(/\s+/g, ' '), cant = CM.parseCant(e.cant.value), prod = e.prod.value, P = CM.PRODUCTOS[prod];
    if (!P) return fail(f, 'prod', 'Elegí el tipo de preparado.');
    if (nombre.length < 2) return fail(f, 'nombre', 'Escribí el nombre del lote.');
    if (isNaN(cant) || cant <= 0) return fail(f, 'cant', 'Escribí una cantidad mayor que cero (hasta 2 decimales).');
    if (P.unidad !== 'g' && Math.round(cant) !== cant) return fail(f, 'cant', 'Los frascos y las unidades son enteros.');
    var sug = e.sug.value.trim() ? CM.parseMonto(e.sug.value) : 0; if (isNaN(sug) || sug < 0) return fail(f, 'sug', 'El aporte sugerido no es un importe válido.');
    var min = e.min.value.trim() ? CM.parseCant(e.min.value) : CM.db.cfg.stockBajoDefault; if (isNaN(min)) return fail(f, 'min', 'Valor inválido.');
    f.dataset.busy = '1';
    var ab = CM.norm(nombre).replace(/[^a-z0-9]/g, '').slice(0, 3).toUpperCase() || 'LOT', id = 'L-' + yymm() + '-' + ab, n = 1;
    while (CM.lote(id)) { n++; id = 'L-' + yymm() + '-' + ab + n; }
    CM.db.lotes.push({ id: id, prod: prod, nombre: nombre, quim: e.quim.value.trim() || '—', unidad: P.unidad, min: min, ingreso: CM.hoy(), cu: c.id, gen: x.id, genVar: x.variedad, sug: sug || 0 });
    CM.addMov(id, 'ingreso', cant, '', 'Cosecha de ' + x.variedad + ' · ' + c.id);
    (x.lotes = x.lotes || []).push(id);
    if (e.marcar.checked && x.estado !== 'Cosechada') { (x.hist = x.hist || []).push({ ts: new Date().toISOString(), user: CM.db.cfg.operador, motivo: 'Cosecha → lote ' + id, antes: { estado: x.estado } }); x.estado = 'Cosechada'; }
    CM.audit('Cosecha → lote', id + ' · ' + c.id + ' · genética ' + x.variedad + ' · ' + cantTxt(cant, P.unidad));
    CM.save(); CM.modal.close(true); render(); CM.toast('Lote ' + id + ' creado desde ' + x.variedad + '.');
  };

  /* ---------- genética de un lote existente ---------- */
  function opcionesGen(sel) {
    var out = '';
    (CM.db.cultivos || []).slice().sort(function (a, b) { return String(b.inicio).localeCompare(String(a.inicio)); }).forEach(function (c) {
      var gs = (c.geneticas || []).filter(function (x) { return x.estado !== 'Descartada'; }); if (!gs.length) return;
      out += '<optgroup label="' + esc(c.nombre + ' · ' + c.id) + '">' + gs.map(function (x) { return opt(c.id + '|' + x.id, x.variedad + ' · ' + c.nombre, sel === c.id + '|' + x.id); }).join('') + '</optgroup>';
    });
    return out;
  }
  CM.acts['lote-gen'] = function () {
    if (!CM.need('trazabilidad', 'edit')) return;
    var gs = opcionesGen('');
    if (!gs) return CM.toast('Todavía no hay genéticas cargadas en ningún ciclo de cultivo.', true);
    CM.modal.open({
      title: 'Genética de un lote',
      body: '<form id="fLG" data-form="lote-gen" class="f" autocomplete="off" novalidate>' +
        fl('Lote *', '<select class="in" name="lote"><option value="">Elegí un lote…</option>' + CM.db.lotes.map(function (l) { return opt(l.id, l.nombre + ' · ' + l.id + (l.genVar ? ' · ' + l.genVar : ' · sin genética')); }).join('') + '</select>') +
        fl('Genética (sala · variedad) *', '<select class="in" name="gen"><option value="">Elegí la genética…</option>' + gs + '</select>') +
        fl('Motivo (obligatorio si el lote ya tenía genética)', '<input class="in" name="motivo" maxlength="120">') +
        '<p class="hint" style="margin:0">Asigna el ciclo y la genética de origen a las <b>próximas</b> dispensaciones del lote. Las ya registradas conservan su origen.</p><p class="err" role="alert" data-err></p></form>',
      footer: '<button class="btn" type="button" data-act="modal-close">Cancelar</button><button class="btn pri" type="submit" form="fLG">Guardar</button>'
    });
  };
  CM.forms['lote-gen'] = function (f) {
    if (!CM.need('trazabilidad', 'edit')) return;
    var e = f.elements, l = CM.lote(e.lote.value); if (!l) return fail(f, 'lote', 'Elegí un lote.');
    var p = String(e.gen.value).split('|'), c = CM.cultivo(p[0]), x = gen(c, p[1]); if (!c || !x) return fail(f, 'gen', 'Elegí la genética.');
    if (l.cu === c.id && l.gen === x.id) return fail(f, 'gen', 'El lote ya tiene esa genética.');
    var mot = e.motivo.value.trim(); if (l.gen && mot.length < 4) return fail(f, 'motivo', 'Escribí el motivo del cambio.');
    (l.cuHist = l.cuHist || []).push({ ts: new Date().toISOString(), user: CM.db.cfg.operador, antes: l.cu || '', despues: c.id, antesGen: l.genVar || '', despuesGen: x.variedad, motivo: mot || 'Asignación de genética' });
    l.cu = c.id; l.gen = x.id; l.genVar = x.variedad;
    if ((x.lotes = x.lotes || []).indexOf(l.id) < 0) x.lotes.push(l.id);
    CM.audit('Lote: genética de origen', l.id + ' · ' + c.id + ' · ' + x.variedad + (mot ? ' · ' + mot : ''));
    CM.save(); CM.modal.close(true); render(); CM.toast('Genética del lote actualizada.');
  };
  /* si se cambia el ciclo de un lote, la genética anterior ya no corresponde */
  var lc0 = CM.forms['lote-ciclo'];
  if (lc0) CM.forms['lote-ciclo'] = function (f) {
    var l = CM.lote(f.elements.lote.value), antes = l ? l.cu : null;
    lc0(f);
    if (l && l.cu !== antes && l.gen) { delete l.gen; delete l.genVar; CM.save(); render(); }
  };
})(window);
