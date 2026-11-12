/* Sistema VB ONG · Caja: detalle de cada operación (SISTEMA_VB_ONGF 4.24.1, versión ONG)
   Una sola vista (CM.opDetalle) que abre cualquier movimiento de una caja abierta o cerrada:
   encabezado, la donación con sus medios (mixta = un renglón por medio), la dispensación vinculada (mínimo necesario),
   correcciones (contraasientos), historial de cambios y la auditoría de esa operación.
   Sólo lectura: no edita nada. El cierre sellado se muestra tal como quedó. */
(function (g) {
  'use strict';
  var CM = g.CM, esc = CM.esc, money = CM.fmtMoney;
  var TIPO = { ingreso: 'Ingreso', egreso: 'Egreso', retiro: 'Retiro', reintegro: 'Reintegro', 'tr-ent': 'Traspaso recibido', 'tr-sal': 'Traspaso enviado' };
  function medioL(k) { return (CM.MEDIOS && CM.MEDIOS[k]) || k || '—'; }
  function fila(k, v) { return '<div><small>' + esc(k) + '</small><b>' + v + '</b></div>'; }

  function buscarMov(movId, cajaId) {
    var caja = CM.db.cajas.filter(function (c) { return c.id === cajaId; })[0];
    if (!caja) return null;
    var m = CM.cajaMovs(caja).filter(function (x) { return x.id === movId; })[0];
    return m ? { caja: caja, m: m } : null;
  }
  function auditDe(ids) {
    return (CM.db.audit || []).filter(function (a) { var d = String(a.detalle || ''); return ids.some(function (i) { return i && d.indexOf(i) >= 0; }); })
      .sort(function (a, b) { return String(a.ts).localeCompare(String(b.ts)); });
  }

  CM.opDetalle = function (movId, cajaId) {
    if (!CM.need('caja', 'ver')) return;
    var r = buscarMov(movId, cajaId);
    if (!r) { CM.toast('No se encontró la operación.', true); return; }
    var m = r.m, caja = r.caja, cerrada = caja.estado === 'cerrada';
    var a = m.derivado && m.ref ? CM.db.aportes.filter(function (x) { return x.id === m.ref; })[0] : null;
    var h = '<div class="kv">' + fila('Operación', esc(m.id)) + fila('Fecha y hora', esc(CM.fmtFH(m.ts))) + fila('Caja', esc(caja.id) + (cerrada ? ' · cerrada' : ' · abierta')) +
      fila('Tipo', esc(TIPO[m.tipo] || m.tipo) + (a ? ' · donación' : '')) + fila('Rubro financiero', esc(m.rubroN || '—')) + fila('Medio', esc(medioL(m.medio))) +
      fila('Importe', (m.tipo === 'ingreso' || m.tipo === 'tr-ent' ? '' : '− ') + esc(money(m.cent))) + fila('Registró', esc(m.user || '—')) + '</div>';
    if (m.motivo) h += '<p style="margin:10px 0 0"><b>Detalle:</b> ' + esc(m.motivo) + '</p>';
    var ids = [m.id];
    if (a) {
      ids.push(a.id);
      var q = CM.quienDe(a), partes = CM.partesAporte(a), c = a.comp ? CM.comp(a.comp) : null;
      h += '<h3>Donación ' + esc(a.id) + '</h3><div class="kv">' + fila('Fecha', esc(CM.fmtFecha(a.fecha))) +
        fila(q.pac ? 'Paciente' : 'Donante', (q.pac ? 'Legajo ' + esc(CM.legDe(a.dni)) + ' · ' : '') + esc(CM.U.nombreCorto ? CM.U.nombreCorto(q.nom) : q.nom)) +
        fila('Concepto', esc(a.concepto)) + fila('Importe total', esc(money(a.cent))) + fila('Estado', esc(a.estado)) +
        fila('Comprobante', c ? esc((c.tipo === 'FC' ? 'Factura C ' : 'Nota de crédito C ') + c.pv + '-' + c.nro) + (c.anulado ? ' (anulada)' : '') : 'Comprobante interno') + '</div>';
      h += '<div class="tw"><table><thead><tr><th>Medio</th><th class="n">Importe</th><th>En esta caja</th></tr></thead><tbody>' + partes.map(function (x, i) {
        var mid = 'AP-' + a.id + (partes.length > 1 ? '-' + (i + 1) : '');
        return '<tr' + (mid === m.id ? ' class="sel"' : '') + '><td>' + esc(medioL(x.m)) + '</td><td class="n">' + esc(money(x.a)) + '</td><td>' + (x.m === 'efectivo' ? 'Suma al efectivo esperado' : 'Se concilia aparte') + '</td></tr>';
      }).join('') + '</tbody></table></div>' + (partes.length > 1 ? '<p class="hint">Donación mixta: entra a la caja como un movimiento por medio.</p>' : '');
      if (a.obs) h += '<p><b>Observación:</b> ' + esc(a.obs) + '</p>';
      if (a.disp) {
        var d = CM.db.disp.filter(function (x) { return x.id === a.disp; })[0];
        ids.push(a.disp);
        if (d && CM.can('dispensaciones', 'ver')) h += '<h3>Dispensación vinculada</h3><div class="kv">' + fila('N.º', esc(d.id)) + fila('Preparado', esc(d.nombre)) + fila('Cantidad', esc(CM.fmtNum(d.cant) + ' ' + (d.unidad || ''))) + fila('Lote', esc(d.lote) + (d.cu ? ' · ciclo ' + esc(d.cu) : '')) + fila('Entregó', esc(d.user || '—')) + (d.anulada ? fila('Estado', 'Anulada') : '') + '</div>';
        else if (d) h += '<p class="hint">Tiene una dispensación vinculada (' + esc(d.id) + '). Tu rol no ve su detalle.</p>';
      }
      if (a.hist && a.hist.length) h += '<h3>Cambios</h3><ul class="tl">' + a.hist.map(function (x) { return '<li><b>' + esc(CM.fmtFH(x.ts)) + '</b> · ' + esc(x.user) + ' · antes: ' + esc(medioL(x.antes.medio)) + ' ' + esc(money(x.antes.cent)) + ' · motivo: ' + esc(x.motivo) + '</li>'; }).join('') + '</ul>';
    }
    var corr = (CM.db.cmovs || []).filter(function (x) { return x.ref && x.ref === m.id; });
    var base = m.ref && !m.derivado ? (CM.db.cmovs || []).filter(function (x) { return x.id === m.ref; })[0] : null;
    if (corr.length || base) {
      h += '<h3>Correcciones</h3><ul class="tl">' + (base ? '<li>Este movimiento es un contraasiento de <b>' + esc(base.id) + '</b> (' + esc(TIPO[base.tipo]) + ' ' + esc(money(base.cent)) + ')</li>' : '') +
        corr.map(function (x) { ids.push(x.id); return '<li>Corregido por <b>' + esc(x.id) + '</b> · ' + esc(CM.fmtFH(x.ts)) + ' · ' + esc(TIPO[x.tipo]) + ' ' + esc(money(x.cent)) + ' · ' + esc(x.motivo) + '</li>'; }).join('') + '</ul>';
    }
    var au = auditDe(ids);
    h += '<h3>Auditoría de esta operación</h3>' + (au.length ? '<ul class="tl">' + au.map(function (x) { return '<li><b>' + esc(CM.fmtFH(x.ts)) + '</b> · ' + esc(x.user || '') + ' · ' + esc(x.accion || '') + '</li>'; }).join('') + '</ul>' : '<p class="hint">Sin eventos de auditoría con esta referencia.</p>');
    if (cerrada) h += '<div class="note info">La caja está cerrada y sellada: esta operación se muestra como quedó en el cierre.</div>';
    CM.modal.open({ title: 'Detalle de la operación', wide: true, body: h,
      footer: (cerrada ? '<button class="btn" data-act="cc-ver" data-id="' + esc(caja.id) + '">Volver al cierre</button>' : '') + '<button class="btn pri" data-act="modal-close">Cerrar</button>' });
  };
  CM.acts['op-det'] = function (t) { CM.opDetalle(t.getAttribute('data-id'), t.getAttribute('data-caja')); };
})(window);
