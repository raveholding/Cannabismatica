/* Sistema VB ONG · Editar, agregar y borrar donde corresponde · 2026-11-12
   Pedido de la fundación: «se tiene que poder editar, agregar o borrar genéticas, y en la mayoría de las situaciones que
   corresponda». Sin romper la trazabilidad (Ley 27.350 / auditoría interna):
   · Genéticas de un espacio, ciclos de cultivo, lotes y cupones: «Borrar» los da de BAJA (quedan ocultos, con quién, cuándo
     y motivo, y se pueden RESTAURAR). El servidor no acepta borrados físicos de estas colecciones, a propósito.
   · No se puede borrar lo que ya tiene historia trazable: un lote con dispensaciones, un ciclo con registros o con lotes,
     una genética con lotes cosechados. En esos casos el sistema explica la alternativa (ajuste a 0, cerrar, «Cosechada»).
   · Editar guarda siempre el valor anterior y el motivo.
   · Menú público (borrador): ítems, frases (no las leyendas legales obligatorias) y fechas de agenda se borran del borrador;
     lo publicado queda en el historial de versiones.
   Lo que ya tenía su forma propia no cambia: dispensaciones y donaciones se anulan, los registros de cultivo se corrigen o
   anulan, las cajas cerradas no se tocan. */
(function (g) {
  'use strict';
  var CM = g.CM, esc = CM.esc, U = CM.U, fl = U.fl, opt = U.opt, fail = U.fail;
  var render = function () { CM.render(); };
  function ahora() { return new Date().toISOString(); }
  function quien() { return CM.db.cfg.operador; }
  function sel(arr, id) { return (arr || []).filter(function (x) { return x.id === id; })[0] || null; }
  var MOT = fl('Motivo *', '<input class="in" name="motivo" maxlength="120" placeholder="Ej.: cargado por error">');

  /* ---------- confirmación con motivo (una sola, para todo) ---------- */
  var pendiente = null;
  function confirmar(o) {
    pendiente = o.ok;
    CM.modal.open({ title: o.titulo, body: '<form id="fCR" data-form="crud-ok" class="f" autocomplete="off" novalidate>' + (o.cuerpo || '') + (o.sinMotivo ? '' : MOT) + '<p class="err" role="alert" data-err></p></form>',
      footer: '<button class="btn" type="button" data-act="modal-close">Cancelar</button><button class="btn ' + (o.peligro === false ? 'pri' : 'bad') + '" type="submit" form="fCR">' + esc(o.boton || 'Borrar') + '</button>' });
  }
  function bloqueo(titulo, msg) { CM.modal.open({ title: titulo, body: '<div class="note warn" style="margin:0">' + msg + '</div>', footer: '<button class="btn pri" type="button" data-act="modal-close">Entendido</button>' }); }
  CM.forms['crud-ok'] = function (f) {
    var m = f.elements.motivo ? f.elements.motivo.value.trim() : '';
    if (f.elements.motivo && m.length < 4) return fail(f, 'motivo', 'Escribí el motivo (queda en la auditoría).');
    var fn = pendiente; pendiente = null; if (!fn) return;
    if (fn(m, f) === false) { pendiente = fn; return; }
    CM.save(); CM.modal.close(true); render();
  };
  function bajasHtml(titulo, arr, fila) {
    if (!arr.length) return '';
    return '<details class="crud-bajas" style="margin-top:10px"><summary class="hint">' + esc(titulo) + ' (' + arr.length + ')</summary><div class="tw"><table><tbody>' + arr.map(fila).join('') + '</tbody></table></div></details>';
  }
  function bajaTxt(b) { return b ? esc(CM.fmtFH ? CM.fmtFH(b.ts) : String(b.ts).slice(0, 10)) + ' · ' + esc(b.user || '') + ' · ' + esc(b.motivo || '') : ''; }

  /* =================================================================
     GENÉTICAS de un espacio de cultivo
     ================================================================= */
  function lotesDeGen(c, x) { return CM.lotesVivos().filter(function (l) { return l.cu === c.id && l.gen === x.id; }); }
  CM.acts['gen-borrar'] = function (t) {
    var c = CM.cultivo(t.getAttribute('data-id')); if (!c || !CM.need('cultivo', 'oper')) return;
    var x = sel(c.geneticas, t.getAttribute('data-g')); if (!x) return;
    if (c.estado !== 'activo') return CM.toast('El ciclo está cerrado.', true);
    var ls = lotesDeGen(c, x);
    if (ls.length) return bloqueo('No se puede borrar «' + esc(x.variedad) + '»', 'Esta genética ya tiene lotes cosechados (' + ls.map(function (l) { return esc(l.id); }).join(', ') + '): borrarla rompería la trazabilidad. Si ya no está en el espacio, editala y marcala <b>Cosechada</b> o <b>Descartada</b>.');
    confirmar({ titulo: 'Borrar la genética «' + x.variedad + '»', cuerpo: '<p style="margin:0">Se quita de «' + esc(c.nombre) + '» (' + (x.plantas || 0) + ' plantas). Queda en «Genéticas borradas» con el motivo y se puede restaurar.</p>',
      ok: function (m) { x.borrada = { ts: ahora(), user: quien(), motivo: m }; CM.audit('Cultivo: genética borrada', c.id + ' · ' + x.variedad + ' · ' + m); CM.toast('Genética borrada.'); } });
  };
  CM.acts['gen-restaurar'] = function (t) {
    var c = CM.cultivo(t.getAttribute('data-id')); if (!c || !CM.need('cultivo', 'oper')) return;
    var x = sel(c.geneticas, t.getAttribute('data-g')); if (!x || !x.borrada) return;
    if ((c.geneticas || []).some(function (y) { return y !== x && !y.borrada && CM.norm(y.variedad) === CM.norm(x.variedad) && ['Cosechada', 'Descartada'].indexOf(y.estado) < 0; })) return CM.toast('Ya hay una «' + x.variedad + '» activa en este espacio: editá esa.', true);
    (x.hist = x.hist || []).push({ ts: ahora(), user: quien(), motivo: 'Restaurada (estaba borrada: ' + x.borrada.motivo + ')', antes: { borrada: true } });
    delete x.borrada; CM.audit('Cultivo: genética restaurada', c.id + ' · ' + x.variedad); CM.save(); render(); CM.toast('Genética restaurada.');
  };
  CM.genBorradasHtml = function (c, arr, puede) {
    return bajasHtml('Genéticas borradas', arr, function (x) { return '<tr><td><b>' + esc(x.variedad) + '</b> · ' + (x.plantas || 0) + ' plantas<br><small class="hint">' + bajaTxt(x.borrada) + '</small></td><td>' + (puede ? '<button class="btn sm" data-act="gen-restaurar" data-id="' + esc(c.id) + '" data-g="' + esc(x.id) + '">' + CM.icon('undo') + 'Restaurar</button>' : '') + '</td></tr>'; });
  };

  /* =================================================================
     CICLOS de cultivo
     ================================================================= */
  CM.acts['cu-editar'] = function (t) {
    var c = CM.cultivo(t.getAttribute('data-id')); if (!c || !CM.need('cultivo', 'edit')) return;
    var regs = CM.cultivoRegs ? CM.cultivoRegs(c.id, false) : [], primero = regs.length ? regs.map(function (r) { return r.fecha; }).sort()[0] : CM.hoy();
    CM.modal.open({ title: 'Editar ciclo · ' + c.id, body: '<form id="fCE" data-form="cu-editar" class="f" autocomplete="off" novalidate><input type="hidden" name="id" value="' + esc(c.id) + '">' +
      fl('Nombre del ciclo *', '<input class="in" name="nombre" maxlength="80" value="' + esc(c.nombre) + '">') + fl('Lote o sala *', '<input class="in" name="lote" maxlength="80" value="' + esc(c.lote) + '">') +
      fl('Fecha de inicio (día 1) *', '<input class="in" type="date" name="inicio" value="' + esc(c.inicio) + '" max="' + esc(primero < CM.hoy() ? primero : CM.hoy()) + '">') +
      (regs.length ? '<p class="hint" style="margin:-4px 0 0">Con registros cargados, el inicio no puede ser posterior al primer registro (' + CM.fmtFecha(primero) + '). Los días y semanas de los registros ya cargados no cambian.</p>' : '') +
      fl('Notas', '<input class="in" name="notas" maxlength="200" value="' + esc(c.notas || '') + '">') + MOT + '<p class="err" role="alert" data-err></p></form>',
      footer: '<button class="btn" type="button" data-act="modal-close">Cancelar</button><button class="btn pri" type="submit" form="fCE">Guardar cambios</button>' });
  };
  CM.forms['cu-editar'] = function (f) {
    var e = f.elements, c = CM.cultivo(e.id.value); if (!c || !CM.need('cultivo', 'edit')) return;
    var d = { nombre: e.nombre.value.trim().replace(/\s+/g, ' '), lote: e.lote.value.trim().replace(/\s+/g, ' '), inicio: e.inicio.value, notas: e.notas.value.trim() };
    if (d.nombre.length < 3) return fail(f, 'nombre', 'Escribí el nombre del ciclo (3 letras o más).');
    if (d.lote.length < 2) return fail(f, 'lote', 'Escribí el lote o la sala.');
    var regs = CM.cultivoRegs ? CM.cultivoRegs(c.id, false) : [], primero = regs.length ? regs.map(function (r) { return r.fecha; }).sort()[0] : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.inicio) || d.inicio > CM.hoy() || (primero && d.inicio > primero)) return fail(f, 'inicio', primero ? 'El inicio no puede ser posterior al primer registro (' + CM.fmtFecha(primero) + ').' : 'La fecha de inicio no puede ser futura.');
    if (Object.keys(d).every(function (k) { return d[k] === (c[k] || ''); })) return fail(f, 'nombre', 'No cambió nada.');
    var m = e.motivo.value.trim(); if (m.length < 4) return fail(f, 'motivo', 'Escribí el motivo del cambio.');
    var antes = {}; Object.keys(d).forEach(function (k) { antes[k] = c[k] || ''; c[k] = d[k]; });
    (c.edHist = c.edHist || []).push({ ts: ahora(), user: quien(), motivo: m, antes: antes });
    CM.audit('Cultivo: ciclo editado', c.id + ' · ' + d.nombre + ' · ' + d.lote + ' · ' + m); CM.save(); CM.modal.close(true); render(); CM.toast('Ciclo actualizado.');
  };
  CM.acts['cu-borrar'] = function (t) {
    var c = CM.cultivo(t.getAttribute('data-id')); if (!c || !CM.need('cultivo', 'admin')) return;
    var regs = CM.cultivoRegs ? CM.cultivoRegs(c.id, false) : [], ls = CM.lotesVivos().filter(function (l) { return l.cu === c.id; });
    if (regs.length || ls.length) return bloqueo('No se puede borrar el ciclo ' + esc(c.id), 'Tiene ' + (regs.length ? regs.length + ' registro(s) en la planilla' : '') + (regs.length && ls.length ? ' y ' : '') + (ls.length ? ls.length + ' lote(s) con este origen (' + ls.map(function (l) { return esc(l.id); }).join(', ') + ')' : '') + ': borrarlo rompería la trazabilidad. Si terminó, usá <b>Cerrar ciclo</b>; si un dato está mal, <b>Editar ciclo</b>.');
    confirmar({ titulo: 'Borrar el ciclo ' + c.id, cuerpo: '<p style="margin:0">«' + esc(c.nombre) + '» no tiene registros ni lotes. Queda en «Ciclos borrados» con el motivo y se puede restaurar.</p>',
      ok: function (m) { c.baja = { ts: ahora(), user: quien(), motivo: m }; if (CM.cu && CM.cu.sel === c.id) CM.cu.sel = ''; CM.audit('Cultivo: ciclo borrado', c.id + ' · ' + c.nombre + ' · ' + m); CM.toast('Ciclo borrado.'); } });
  };
  CM.acts['cu-restaurar'] = function (t) {
    var c = CM.cultivo(t.getAttribute('data-id')); if (!c || !c.baja || !CM.need('cultivo', 'admin')) return;
    (c.edHist = c.edHist || []).push({ ts: ahora(), user: quien(), motivo: 'Restaurado (estaba borrado: ' + c.baja.motivo + ')', antes: { baja: true } });
    delete c.baja; if (CM.cu) CM.cu.sel = c.id; CM.audit('Cultivo: ciclo restaurado', c.id); CM.save(); render(); CM.toast('Ciclo restaurado.');
  };
  CM.ciclosBajasHtml = function () {
    var arr = (CM.db.cultivos || []).filter(function (c) { return c.baja; }), adm = CM.can('cultivo', 'admin');
    return bajasHtml('Ciclos borrados', arr, function (c) { return '<tr><td><b>' + esc(c.nombre) + '</b> · ' + esc(c.id) + '<br><small class="hint">' + bajaTxt(c.baja) + '</small></td><td>' + (adm ? '<button class="btn sm" data-act="cu-restaurar" data-id="' + esc(c.id) + '">' + CM.icon('undo') + 'Restaurar</button>' : '') + '</td></tr>'; });
  };

  /* =================================================================
     LOTES de preparados
     ================================================================= */
  CM.acts['lote-editar'] = function (t) {
    var l = CM.lote(t.getAttribute('data-id')); if (!l || !CM.need('trazabilidad', 'edit')) return;
    CM.modal.open({ title: 'Editar lote · ' + l.id, body: '<form id="fLE" data-form="lote-editar" class="f" autocomplete="off" novalidate><input type="hidden" name="id" value="' + esc(l.id) + '">' +
      '<p class="hint" style="margin:0">' + esc(CM.PRODUCTOS[l.prod] ? CM.PRODUCTOS[l.prod].n : l.prod) + ' · ingresó el ' + CM.fmtFecha(l.ingreso) + '. El código del lote no cambia (está en etiquetas y dispensaciones). La cantidad se corrige con «Ajustar stock».</p>' +
      fl('Nombre / genética *', '<input class="in" name="nombre" maxlength="80" value="' + esc(l.nombre) + '">') +
      '<div class="f f2">' + fl('Quimiotipo', '<input class="in" name="quim" maxlength="20" value="' + esc(l.quim === '—' ? '' : l.quim) + '">') + fl('Aviso de stock bajo desde', '<input class="in num" name="min" inputmode="decimal" value="' + esc(String(l.min).replace('.', ',')) + '">') + '</div>' +
      MOT + '<p class="hint" style="margin:0">Las dispensaciones ya registradas conservan el nombre con el que se hicieron.</p><p class="err" role="alert" data-err></p></form>',
      footer: '<button class="btn" type="button" data-act="modal-close">Cancelar</button><button class="btn pri" type="submit" form="fLE">Guardar cambios</button>' });
  };
  CM.forms['lote-editar'] = function (f) {
    var e = f.elements, l = CM.lote(e.id.value); if (!l || !CM.need('trazabilidad', 'edit')) return;
    var d = { nombre: e.nombre.value.trim().replace(/\s+/g, ' '), quim: e.quim.value.trim() || '—', min: e.min.value.trim() === '' ? 0 : CM.parseCant(e.min.value) };
    if (d.nombre.length < 2) return fail(f, 'nombre', 'Escribí el nombre o genética.');
    if (isNaN(d.min) || d.min < 0) return fail(f, 'min', 'Valor inválido.');
    if (d.nombre === l.nombre && d.quim === l.quim && d.min === l.min) return fail(f, 'nombre', 'No cambió nada.');
    var m = e.motivo.value.trim(); if (m.length < 4) return fail(f, 'motivo', 'Escribí el motivo del cambio.');
    var antes = { nombre: l.nombre, quim: l.quim, min: l.min }; l.nombre = d.nombre; l.quim = d.quim; l.min = d.min;
    (l.edHist = l.edHist || []).push({ ts: ahora(), user: quien(), motivo: m, antes: antes });
    CM.audit('Lote editado', l.id + ' · ' + antes.nombre + ' → ' + d.nombre + (antes.quim !== d.quim ? ' · quimiotipo ' + d.quim : '') + (antes.min !== d.min ? ' · mínimo ' + d.min : '') + ' · ' + m);
    CM.save(); CM.modal.close(true); render(); CM.toast('Lote actualizado.');
  };
  CM.acts['lote-borrar'] = function (t) {
    var l = CM.lote(t.getAttribute('data-id')); if (!l || !CM.need('trazabilidad', 'edit')) return;
    var ds = (CM.db.disp || []).filter(function (d) { return d.lote === l.id; });
    if (ds.length) return bloqueo('No se puede borrar el lote ' + esc(l.id), 'Tiene ' + ds.length + ' dispensación(es) registrada(s): por trazabilidad el lote tiene que seguir existiendo. Si no se va a usar más, dejá el stock en 0 con <b>Ajustar stock</b> (queda «Agotado» y no se puede elegir al dispensar).');
    var s = CM.stockLote(l.id);
    confirmar({ titulo: 'Borrar el lote ' + l.id, cuerpo: '<p style="margin:0">«' + esc(l.nombre) + '» no tiene dispensaciones.' + (s > 0 ? ' Su stock (' + esc(U.cantTxt(s, l.unidad)) + ') sale con un movimiento de baja.' : '') + ' Queda en «Lotes dados de baja» y se puede restaurar.</p>',
      ok: function (m) { if (s > 0) CM.addMov(l.id, 'ajuste', -s, '', 'Baja del lote: ' + m); l.baja = { ts: ahora(), user: quien(), motivo: m, stock: s }; CM.audit('Lote dado de baja', l.id + ' · ' + l.nombre + (s > 0 ? ' · -' + s + ' ' + l.unidad : '') + ' · ' + m); CM.toast('Lote dado de baja.'); } });
  };
  CM.acts['lote-restaurar'] = function (t) {
    var l = CM.lote(t.getAttribute('data-id')); if (!l || !l.baja || !CM.need('trazabilidad', 'edit')) return;
    if (l.baja.stock > 0) CM.addMov(l.id, 'ingreso', l.baja.stock, '', 'Restauración del lote (vuelve el stock dado de baja)');
    (l.edHist = l.edHist || []).push({ ts: ahora(), user: quien(), motivo: 'Restaurado (estaba de baja: ' + l.baja.motivo + ')', antes: { baja: true } });
    delete l.baja; CM.audit('Lote restaurado', l.id + ' · ' + l.nombre); CM.save(); render(); CM.toast('Lote restaurado.');
  };
  CM.lotesBajasHtml = function () {
    var arr = (CM.db.lotes || []).filter(function (l) { return l.baja; }), ed = CM.can('trazabilidad', 'edit');
    return bajasHtml('Lotes dados de baja', arr, function (l) { return '<tr><td><b>' + esc(l.id) + '</b> · ' + esc(l.nombre) + '<br><small class="hint">' + bajaTxt(l.baja) + '</small></td><td>' + (ed ? '<button class="btn sm" data-act="lote-restaurar" data-id="' + esc(l.id) + '">' + CM.icon('undo') + 'Restaurar</button>' : '') + '</td></tr>'; });
  };

  /* =================================================================
     CUPONES
     ================================================================= */
  CM.acts['cupon-editar'] = function (t) {
    var c = sel(CM.db.cupones, t.getAttribute('data-id')); if (!c || !CM.need('fidelizacion', 'edit')) return;
    var usos = CM.usosCupon ? CM.usosCupon(c.cod) : 0;
    CM.modal.open({ title: 'Editar cupón · ' + c.cod, body: '<form id="fCE2" data-form="cupon-editar" class="f" autocomplete="off" novalidate><input type="hidden" name="id" value="' + esc(c.id) + '">' +
      (usos ? '<p class="hint" style="margin:0">Ya se usó ' + usos + ' vez/veces: el código no se puede cambiar (está en los canjes).</p>' : fl('Código * (letras y números)', '<input class="in" name="cod" maxlength="20" style="text-transform:uppercase" value="' + esc(c.cod) + '">')) +
      '<div class="f f2">' + fl('Tipo de bonificación', '<select class="in" name="tipo">' + opt('pct', 'Porcentaje (%)', c.tipo === 'pct') + opt('monto', 'Monto fijo ($)', c.tipo === 'monto') + '</select>') + fl('Valor *', '<input class="in num" name="valor" inputmode="decimal" value="' + esc(c.tipo === 'pct' ? String(c.valor) : String(c.valor / 100).replace('.', ',')) + '">') + '</div>' +
      '<div class="f f2">' + fl('Vigente desde', '<input class="in" type="date" name="desde" value="' + esc(c.desde) + '">') + fl('Vigente hasta', '<input class="in" type="date" name="hasta" value="' + esc(c.hasta) + '">') + '</div>' +
      '<div class="f f2">' + fl('Máximo de usos en total', '<input class="in num" name="max" inputmode="numeric" placeholder="Sin límite" value="' + (c.max || '') + '">') + fl('Usos por paciente', '<input class="in num" name="porPac" inputmode="numeric" value="' + (c.porPac == null ? 1 : c.porPac) + '">') + '</div>' +
      fl('Descripción', '<input class="in" name="desc" value="' + esc(c.desc || '') + '">') + MOT + '<p class="err" role="alert" data-err></p></form>',
      footer: '<button class="btn" type="button" data-act="modal-close">Cancelar</button><button class="btn pri" type="submit" form="fCE2">Guardar cambios</button>' });
  };
  CM.forms['cupon-editar'] = function (f) {
    var e = f.elements, c = sel(CM.db.cupones, e.id.value); if (!c || !CM.need('fidelizacion', 'edit')) return;
    var cod = e.cod ? e.cod.value.trim().toUpperCase() : c.cod;
    if (!/^[A-Z0-9]{3,20}$/.test(cod)) return fail(f, 'cod', 'El código debe tener de 3 a 20 letras o números.');
    if (cod !== c.cod && CM.cupon(cod)) return fail(f, 'cod', 'Ya existe un cupón con ese código.');
    var val = e.tipo.value === 'pct' ? CM.parseCant(e.valor.value) : CM.parseMonto(e.valor.value);
    if (isNaN(val) || val <= 0) return fail(f, 'valor', 'Valor inválido.');
    if (e.tipo.value === 'pct' && val >= 100) return fail(f, 'valor', 'El porcentaje tiene que ser menor que 100.');
    if (!e.desde.value || !e.hasta.value || e.hasta.value < e.desde.value) return fail(f, 'hasta', 'Revisá las fechas de vigencia.');
    var max = e.max.value.trim() ? parseInt(e.max.value, 10) : 0, pp = e.porPac.value.trim() ? parseInt(e.porPac.value, 10) : 1;
    if (isNaN(max) || isNaN(pp) || max < 0 || pp < 0) return fail(f, 'max', 'Los usos deben ser números enteros.');
    var m = e.motivo.value.trim(); if (m.length < 4) return fail(f, 'motivo', 'Escribí el motivo del cambio.');
    var antes = { cod: c.cod, tipo: c.tipo, valor: c.valor, desde: c.desde, hasta: c.hasta, max: c.max, porPac: c.porPac, desc: c.desc };
    c.cod = cod; c.tipo = e.tipo.value; c.valor = val; c.desde = e.desde.value; c.hasta = e.hasta.value; c.max = max; c.porPac = pp; c.desc = e.desc.value.trim();
    (c.edHist = c.edHist || []).push({ ts: ahora(), user: quien(), motivo: m, antes: antes });
    CM.audit('Cupón editado', antes.cod + (cod !== antes.cod ? ' → ' + cod : '') + ' · ' + m); CM.save(); CM.modal.close(true); render(); CM.toast('Cupón actualizado.');
  };
  CM.acts['cupon-borrar'] = function (t) {
    var c = sel(CM.db.cupones, t.getAttribute('data-id')); if (!c || !CM.need('fidelizacion', 'edit')) return;
    var usos = CM.usosCupon ? CM.usosCupon(c.cod) : 0;
    confirmar({ titulo: 'Borrar el cupón ' + c.cod, cuerpo: '<p style="margin:0">Deja de poder canjearse.' + (usos ? ' Sus ' + usos + ' canje(s) quedan registrados.' : '') + ' Queda en «Cupones borrados» y se puede restaurar.</p>',
      ok: function (m) { c.baja = { ts: ahora(), user: quien(), motivo: m, estado: c.estado }; c.estado = 'pausado'; CM.audit('Cupón borrado', c.cod + ' · ' + m); CM.toast('Cupón borrado.'); } });
  };
  CM.acts['cupon-restaurar'] = function (t) {
    var c = sel(CM.db.cupones, t.getAttribute('data-id')); if (!c || !c.baja || !CM.need('fidelizacion', 'edit')) return;
    if (CM.cupon(c.cod)) return CM.toast('Ya hay otro cupón activo con el código ' + c.cod + ': cambiale el código a ese primero.', true);
    c.estado = c.baja.estado || 'activo'; delete c.baja; CM.audit('Cupón restaurado', c.cod); CM.save(); render(); CM.toast('Cupón restaurado.');
  };
  CM.cuponesBajasHtml = function () {
    var arr = (CM.db.cupones || []).filter(function (c) { return c.baja; });
    return bajasHtml('Cupones borrados', arr, function (c) { return '<tr><td><b>' + esc(c.cod) + '</b><br><small class="hint">' + bajaTxt(c.baja) + '</small></td><td><button class="btn sm" data-act="cupon-restaurar" data-id="' + esc(c.id) + '">' + CM.icon('undo') + 'Restaurar</button></td></tr>'; });
  };
  /* un cupón borrado no se puede canjear aunque alguien escriba su código */
  var cup0 = CM.cupon;
  if (cup0) CM.cupon = function (cod) { var c = cup0.apply(this, arguments); return c && c.baja ? null : c; };

  /* =================================================================
     MENÚ PÚBLICO (borrador): ítems, frases y fechas de agenda
     ================================================================= */
  var MP = { items: ['el ítem', function (x) { return x.es && x.es.n; }], frases: ['la frase', function (x) { return x.es; }], agenda: ['la fecha', function (x) { return CM.fmtFecha(x.fecha) + ' ' + (x.hora || ''); }] };
  CM.acts['mp-borrar'] = function (t) {
    if (!CM.need('menu', 'edit')) return;
    var k = t.getAttribute('data-k'), d = CM.db.menu.draft, arr = d[k], x = sel(arr, t.getAttribute('data-id')); if (!x || !MP[k]) return;
    if (k === 'frases' && x.obligatoria) return bloqueo('Leyenda legal obligatoria', 'Las leyendas legales obligatorias no se borran: se pueden desactivar con el motivo.');
    if (k === 'items') { var fs = (d.agenda || []).filter(function (a) { return a.item === x.id; }); if (fs.length) return bloqueo('No se puede borrar el ítem', 'Tiene ' + fs.length + ' fecha(s) en la agenda: borralas primero (pestaña Agenda) o, si sólo querés que no se vea, usá <b>Ocultar</b>.'); }
    var nom = String(MP[k][1](x) || x.id).slice(0, 80);
    confirmar({ titulo: 'Borrar ' + MP[k][0] + ' del menú', cuerpo: '<p style="margin:0">«' + esc(nom) + '» se quita del <b>borrador</b>. Lo publicado no cambia hasta que publiques; las versiones anteriores quedan en el historial.</p>', sinMotivo: true,
      ok: function () { d[k] = arr.filter(function (y) { return y !== x; }); CM.audit('Menú público (borrador)', 'Borrado ' + MP[k][0] + ': ' + nom); CM.toast('Borrado del borrador.'); } });
  };
})(window);
