/* Sistema VB ONG · REPROCANN desde los documentos del legajo · 2026-11-12
   Pedido de la fundación: si el REPROCANN ya está cargado (documento en el legajo), el paciente tiene que figurar con el
   REPROCANN vigente y sus fechas; y donde se completa el REPROCANN tiene que estar el acceso a la carpeta de documentos.
   · El sistema anterior (AppSheet) no tenía fechas: se toman del NOMBRE del documento cuando lo dice
     («activo 2029/03» → 31/03/2029 · «credencial enero 2027» → 31/01/2027 · «activo 2029» o «Reprocann 29» → 31/12/2029).
     Sin fecha en el nombre: queda «Válido · falta fecha». Siempre marcado «a verificar» hasta que alguien lo revise y guarde.
   · Herramienta en REPROCANN → «Completar desde los documentos»: muestra la lista antes de aplicar; todo queda en la auditoría
     y en el historial del paciente. Sólo toca pacientes que figuran «Sin REPROCANN».
   · Al subir un documento de tipo REPROCANN a un paciente sin REPROCANN, se pide el vencimiento y queda vigente.
   · El formulario de REPROCANN del paciente y su tarjeta en la ficha muestran los documentos REPROCANN y la carpeta. */
(function (g) {
  'use strict';
  var CM = g.CM, esc = CM.esc, U = CM.U, fl = U.fl, VIEWS = CM.VIEWS;
  var render = function () { CM.render(); };
  var MESES = { ene: 1, enero: 1, feb: 2, febrero: 2, mar: 3, marzo: 3, abr: 4, abril: 4, may: 5, mayo: 5, jun: 6, junio: 6, jul: 7, julio: 7, ago: 8, agosto: 8, sep: 9, sept: 9, set: 9, septiembre: 9, setiembre: 9, oct: 10, octubre: 10, nov: 11, noviembre: 11, dic: 12, diciembre: 12 };
  function finMes(y, m) { return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); }
  function anioOk(y) { return y >= 2024 && y <= 2045; }

  /* vencimiento a partir del nombre del documento (o de su descripción) */
  CM.repFechaDeNombre = function (txt, fechaDoc) {
    var s = CM.norm(String(txt || '')).replace(/[^a-z0-9/.\- ]+/g, ' '), m, r = null;
    if ((m = /\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](20\d{2})\b/.exec(s)) && +m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31 && anioOk(+m[3])) r = { vence: m[3] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0'), prec: 'día' };
    else if ((m = /\b(20\d{2})[\/.\-](\d{1,2})\b/.exec(s)) && +m[2] >= 1 && +m[2] <= 12 && anioOk(+m[1])) r = { vence: finMes(+m[1], +m[2]), prec: 'mes' };
    else if ((m = /\b(\d{1,2})[\/.\-](20\d{2})\b/.exec(s)) && +m[1] >= 1 && +m[1] <= 12 && anioOk(+m[2])) r = { vence: finMes(+m[2], +m[1]), prec: 'mes' };
    else if ((m = /\b(ene|enero|feb|febrero|mar|marzo|abr|abril|may|mayo|jun|junio|jul|julio|ago|agosto|sep|sept|set|septiembre|setiembre|oct|octubre|nov|noviembre|dic|diciembre)\.?\s*(?:de\s*|del\s*)?(20\d{2}|\d{2})\b/.exec(s))) { var y = +m[2] < 100 ? 2000 + +m[2] : +m[2]; if (anioOk(y)) r = { vence: finMes(y, MESES[m[1]]), prec: 'mes' }; }
    if (!r && (m = /\b(20\d{2})\b/.exec(s)) && anioOk(+m[1])) r = { vence: m[1] + '-12-31', prec: 'año' };
    if (!r && (m = /\b(?:reprocann|repro|activo|activa|vigente|hasta|vence)\s+(\d{2})\b/.exec(s)) && anioOk(2000 + +m[1])) r = { vence: (2000 + +m[1]) + '-12-31', prec: 'año' };
    if (r && fechaDoc && r.vence < String(fechaDoc).slice(0, 10)) return null;   /* una fecha anterior a la del documento no es un vencimiento */
    return r;
  };
  function docsRep(dni) { return (CM.db.legDocs || []).filter(function (d) { return d.dni === dni && d.tipo === 'REPROCANN' && !d.baja && d.estado !== 'borrado'; }); }
  function urlDoc(d) { return d.url || (d.driveFileId ? 'https://drive.google.com/file/d/' + d.driveFileId + '/view' : d.fileId ? 'https://drive.google.com/file/d/' + d.fileId + '/view' : ''); }
  function fechaDoc(d) { return String(d.fecha || d.ts || '').slice(0, 10); }

  /* plan: pacientes «Sin REPROCANN» que tienen documento REPROCANN */
  CM.repDocsPlan = function () {
    var out = [];
    Object.keys(CM.db.pacientes || {}).forEach(function (k) {
      var p = CM.db.pacientes[k], e = CM.estadoRep(p.reprocann); if (e.k !== 'sin') return;
      var ds = docsRep(p.dni); if (!ds.length) return;
      var mejor = null, doc = ds[0];
      ds.forEach(function (d) { var f = CM.repFechaDeNombre(d.nombre + ' ' + (d.desc || ''), fechaDoc(d)); if (f && (!mejor || f.vence > mejor.vence)) { mejor = f; doc = d; } });
      if (!mejor) doc = ds.slice().sort(function (a, b) { return fechaDoc(b).localeCompare(fechaDoc(a)); })[0];
      out.push({ dni: p.dni, leg: p.leg, doc: doc, docs: ds.length, vence: mejor ? mejor.vence : null, prec: mejor ? mejor.prec : '' });
    });
    return out.sort(function (a, b) { return String(a.leg).localeCompare(String(b.leg)); });
  };
  function aplicar(p, x, user, motivo) {
    var antes = p.reprocann ? JSON.parse(JSON.stringify(p.reprocann)) : null;
    p.reprocann = { estado: 'valido', vence: x.vence || null, carnet: !!(antes && antes.carnet), aVerif: true, origen: { doc: x.doc.id, nombre: x.doc.nombre, prec: x.prec || '' } };
    (p.repHist = p.repHist || []).push({ ts: new Date().toISOString(), user: user, antes: antes, motivo: motivo });
  }
  CM.acts['rep-docs'] = function () {
    if (!CM.need('reprocann', 'edit')) return;
    var plan = CM.repDocsPlan();
    if (!plan.length) return CM.toast('No hay pacientes «Sin REPROCANN» con documento REPROCANN cargado.');
    var conF = plan.filter(function (x) { return x.vence; }).length;
    CM.modal.open({
      title: 'Completar REPROCANN desde los documentos', wide: true,
      body: '<p style="margin:0">Hay <b>' + plan.length + '</b> paciente(s) que figuran «Sin REPROCANN» pero tienen el documento cargado en el legajo. Van a quedar <b>Válidos</b>, marcados <b>«a verificar»</b>: <b>' + conF + '</b> con el vencimiento que dice el nombre del documento y <b>' + (plan.length - conF) + '</b> con «falta fecha».</p>' +
        '<div class="tw" style="margin-top:10px;max-height:46vh;overflow:auto"><table><thead><tr><th>Legajo</th><th>Documento</th><th>Vencimiento detectado</th><th></th></tr></thead><tbody>' + plan.map(function (x) {
          var u = urlDoc(x.doc);
          return '<tr><td>' + esc(x.leg || '—') + '</td><td>' + esc(x.doc.nombre) + (x.docs > 1 ? '<br><small class="hint">' + x.docs + ' documentos REPROCANN</small>' : '') + '</td><td>' + (x.vence ? esc(CM.fmtFecha(x.vence)) + ' <small class="hint">(por ' + esc(x.prec) + ')</small>' : '<span class="pill p-warn">Falta fecha</span>') + '</td><td>' + (u ? '<a class="btn sm" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">Abrir</a>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="note warn" style="margin-top:10px">Las fechas salen del nombre del archivo (lo que escribió quien lo cargó en el sistema anterior). Revisá cada paciente con el documento abierto y guardá la fecha real: al guardar se quita «a verificar». <b>[VERIFICAR en reprocann.msal.gob.ar]</b></div>',
      footer: '<button class="btn" data-act="modal-close">Cancelar</button><button class="btn pri" data-act="rep-docs-ok">Aplicar a ' + plan.length + ' paciente(s)</button>'
    });
  };
  CM.acts['rep-docs-ok'] = function () {
    if (!CM.need('reprocann', 'edit')) return;
    var plan = CM.repDocsPlan(), u = CM.db.cfg.operador;
    plan.forEach(function (x) { aplicar(CM.db.pacientes[x.dni], x, u, 'Completado desde el documento ' + x.doc.id); });
    var conF = plan.filter(function (x) { return x.vence; }).length;
    CM.audit('REPROCANN completado desde documentos', plan.length + ' paciente(s) → Válido «a verificar» · ' + conF + ' con vencimiento tomado del nombre del documento · ' + (plan.length - conF) + ' sin fecha · legajos ' + plan.map(function (x) { return x.leg; }).join(', '));
    CM.save(); CM.modal.close(true); render(); CM.toast(plan.length + ' paciente(s) con REPROCANN vigente «a verificar».');
  };

  /* ---------- estado: «a verificar» y «falta fecha» ---------- */
  var est0 = CM.estadoRep;
  CM.estadoRep = function (r) { var o = est0(r); if (r && r.aVerif) o.aVerif = true; if (o.k === 'valido' && !o.vence) o.faltaFecha = true; return o; };
  var reg0 = CM.reglasDispensar;
  CM.reglasDispensar = function (p) {
    var res = reg0(p), e = CM.estadoRep(p.reprocann);
    if (e.k === 'valido' && (e.aVerif || e.faltaFecha)) res.msgs.push({ t: 'warn', m: 'REPROCANN cargado desde el documento del legajo: ' + (e.faltaFecha ? 'falta la fecha de vencimiento' : 'verificá la fecha') + ' en «REPROCANN del paciente».' });
    return res;
  };

  /* ---------- documentos y carpeta (formulario y ficha) ---------- */
  CM.repDocsHtml = function (dni, compacto) {
    var p = CM.paciente(dni); if (!p) return '';
    var ds = docsRep(dni).sort(function (a, b) { return fechaDoc(b).localeCompare(fechaDoc(a)); }), cu = CM.carpetaUrl ? CM.carpetaUrl(p) : '';
    return '<div class="card flat rep-docs"' + (compacto ? ' style="margin-top:12px"' : '') + '><div class="row sp"><b>Documentos del REPROCANN (' + ds.length + ')</b><div class="row">' +
      (cu ? '<a class="btn sm" href="' + esc(cu) + '" target="_blank" rel="noopener noreferrer">' + CM.icon('link') + 'Abrir carpeta del legajo</a>' : '') +
      '<a class="btn sm" href="#/paciente/' + esc(dni) + '" data-act="rep-ir-docs" data-dni="' + esc(dni) + '">Ver todos los documentos</a></div></div>' +
      (ds.length ? '<ul class="rep-dl">' + ds.map(function (d) { var u = urlDoc(d), f = CM.repFechaDeNombre(d.nombre, fechaDoc(d)); return '<li><span>' + esc(d.nombre) + ' <small class="hint">· ' + esc(CM.fmtFecha(fechaDoc(d))) + (f ? ' · dice vencimiento ' + esc(CM.fmtFecha(f.vence)) : '') + '</small></span>' + (u ? '<a class="btn sm" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">Abrir</a>' : '<span class="pill p-mu">' + esc(d.estado || '') + '</span>') + (f && !compacto ? '<button type="button" class="btn sm" data-act="rep-usar-fecha" data-v="' + esc(f.vence) + '">Usar esta fecha</button>' : '') + '</li>'; }).join('') + '</ul>' : '<p class="hint" style="margin:6px 0 0">Todavía no hay documento REPROCANN en el legajo. Se sube desde la ficha → «Documentos y escaneos».</p>') + '</div>';
  };
  CM.acts['rep-usar-fecha'] = function (t) { var f = t.closest('form'); if (!f) return; f.elements.vence.value = t.getAttribute('data-v'); if (f.elements.estado.value === 'sin') f.elements.estado.value = 'valido'; CM.toast('Fecha cargada: revisala con el documento y guardá.'); };
  CM.acts['rep-ir-docs'] = function (t) {
    var dni = t.getAttribute('data-dni'); CM.modal.close(true);
    var ir = function () { var el = document.getElementById('pacDocs'); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.focus({ preventScroll: true }); } };
    if (location.hash === '#/paciente/' + dni) ir(); else { location.hash = '#/paciente/' + dni; setTimeout(ir, 250); }
  };
  /* en el formulario «REPROCANN del paciente»: documentos y carpeta a mano */
  var repEdit0 = CM.acts['rep-edit'];
  CM.acts['rep-edit'] = function (t) {
    repEdit0(t);
    var f = document.getElementById('fRP'), dni = t.getAttribute('data-dni'); if (!f || !dni) return;
    var p = CM.paciente(dni), e = CM.estadoRep(p && p.reprocann);
    var extra = (e.aVerif ? '<div class="note warn" style="margin:0">Cargado desde el documento del legajo' + (p.reprocann.origen && p.reprocann.origen.nombre ? ' («' + esc(p.reprocann.origen.nombre) + '»)' : '') + ': revisá la fecha con el documento y guardá para quitar «a verificar».</div>' : '') + CM.repDocsHtml(dni, false);
    var err = f.querySelector('[data-err]'); if (err) err.insertAdjacentHTML('beforebegin', extra); else f.insertAdjacentHTML('beforeend', extra);
  };
  /* al guardar a mano se quita «a verificar» y queda el historial */
  var rep0 = CM.forms.rep;
  CM.forms.rep = function (f) {
    var dni = f.elements.dni.value, p = dni ? CM.paciente(dni) : null, antes = p && p.reprocann ? JSON.parse(JSON.stringify(p.reprocann)) : null, hist = p ? (p.repHist || []).slice() : null;
    rep0(f);
    if (p && p.reprocann && JSON.stringify(p.reprocann) !== JSON.stringify(antes)) { p.repHist = hist; p.repHist.push({ ts: new Date().toISOString(), user: CM.db.cfg.operador, antes: antes, motivo: 'Actualizado a mano' + (antes && antes.aVerif ? ' (verificado)' : '') }); CM.save(); }
  };
  /* tarjeta de la ficha: pill y documentos */
  var vPac = VIEWS.paciente;
  VIEWS.paciente = function (r) {
    var h = vPac.apply(this, arguments), dni = CM.soloDigitos(r.a), p = CM.paciente(dni); if (!p) return h;
    var e = CM.estadoRep(p.reprocann), i = h.indexOf('<h2>REPROCANN del paciente</h2>'); if (i < 0) return h;
    var fin = h.indexOf('</section>', i); if (fin < 0) return h;
    var add = (e.aVerif || e.faltaFecha ? '<div class="note warn" style="margin-top:10px">' + (e.faltaFecha ? 'Falta la fecha de vencimiento: está en el documento del legajo.' : 'Fecha tomada del nombre del documento: verificala.') + ' <button class="btn sm" data-act="rep-edit" data-dni="' + esc(dni) + '">Revisar y guardar</button></div>' : '') + CM.repDocsHtml(dni, true);
    return h.slice(0, fin) + add + h.slice(fin);
  };
  /* la pill («a verificar» / «falta fecha») la arma app.js con los datos de CM.estadoRep */

  /* ---------- REPROCANN → herramienta ---------- */
  var vRep = VIEWS.reprocann;
  if (vRep) VIEWS.reprocann = function () {
    var h = vRep.apply(this, arguments);
    if (!CM.can('reprocann', 'edit')) return h;
    var n = CM.repDocsPlan().length, av = Object.keys(CM.db.pacientes).filter(function (k) { var e = CM.estadoRep(CM.db.pacientes[k].reprocann); return e.k === 'valido' && (e.aVerif || e.faltaFecha); }).length;
    if (!n && !av) return h;
    var card = '<section class="card" style="margin:0 0 14px"><div class="row sp"><div><h2 style="margin:0">REPROCANN desde los documentos del legajo</h2><p class="hint" style="margin:4px 0 0">' +
      (n ? n + ' paciente(s) figuran «Sin REPROCANN» pero tienen el documento cargado. ' : '') + (av ? av + ' paciente(s) vigentes «a verificar» (fecha tomada del documento o sin fecha).' : '') + '</p></div>' +
      (n ? '<button class="btn pri" data-act="rep-docs">Completar desde los documentos</button>' : '') + '</div></section>';
    var j = h.indexOf('</div>', h.indexOf('class="page-h"')); j = h.indexOf('</div>', j + 6);
    return j > 0 ? h.slice(0, j + 6) + card + h.slice(j + 6) : card + h;
  };

  /* ---------- al subir un documento REPROCANN ---------- */
  document.addEventListener('change', function (ev) {
    var t = ev.target; if (!t.form || t.form.id !== 'fDC' || t.name !== 'tipo') return;
    var f = t.form, box = f.querySelector('[data-rep-vence]');
    if (t.value === 'REPROCANN' && !box) f.querySelector('[data-err]').insertAdjacentHTML('beforebegin', '<div data-rep-vence>' + fl('Vence (si lo dice el REPROCANN)', '<input class="in" type="date" name="vence">') + '<p class="hint" style="margin:0">Si el paciente figura «Sin REPROCANN», queda Válido con esta fecha (o con la que diga la descripción).</p></div>');
    if (t.value !== 'REPROCANN' && box) box.remove();
  });
  var sub0 = CM.forms['doc-subir'];
  CM.forms['doc-subir'] = function (f) {
    var e = f.elements, tipo = e.tipo.value, vence = e.vence ? e.vence.value : '', desc = e.desc ? e.desc.value : '';
    var dni = (document.querySelector('#docFile') || {}).getAttribute ? document.querySelector('#docFile').getAttribute('data-dni') : '';
    var p = dni ? CM.paciente(dni) : null, sin = p && CM.estadoRep(p.reprocann).k === 'sin';
    if (vence && !/^\d{4}-\d{2}-\d{2}$/.test(vence)) return U.fail(f, 'vence', 'Fecha inválida.');
    var r = sub0(f);
    if (document.getElementById('fDC')) return r;   /* no pasó la validación */
    if (tipo === 'REPROCANN' && sin && CM.can('reprocann', 'edit')) {
      var fx = vence ? { vence: vence, prec: 'día' } : CM.repFechaDeNombre(desc, CM.hoy());
      aplicar(p, { vence: fx ? fx.vence : null, prec: fx ? fx.prec : '', doc: { id: 'nuevo', nombre: desc || 'REPROCANN' } }, CM.db.cfg.operador, 'Documento REPROCANN subido');
      if (vence) delete p.reprocann.aVerif;
      CM.audit('REPROCANN del paciente', 'Legajo ' + p.leg + ' → Válido' + (fx ? ' hasta ' + CM.fmtFecha(fx.vence) : ' (falta fecha)') + ' · al subir el documento'); CM.save(); render();
    }
    return r;
  };
})(window);
