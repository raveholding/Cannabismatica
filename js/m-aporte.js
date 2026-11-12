/* Sistema VB ONG · Aporte sugerido, promoción 5+1 y cambio en efectivo · 2026-11-11
   Pedido de la fundación (comparando con el sistema anterior en AppSheet):
   · Cada lote (genética) tiene un APORTE SUGERIDO POR UNIDAD (por gramo, frasco o unidad). Al dispensar se calculan solos
     el subtotal (sugerido × cantidad), el descuento 5+1 (cada 5 unidades, 1 va sin aporte: 6 pagan 5, 12 pagan 10) y el total.
     Todo se puede modificar: la donación sigue siendo VOLUNTARIA (Ley 27.350); el cálculo es una sugerencia.
   · RECIBIDO y CAMBIO: si el paciente entrega más de lo que dona (billete grande en efectivo, o transfiere de más), el sistema
     registra lo recibido y el cambio que se le devuelve EN EFECTIVO. En la caja quedan dos renglones: la entrada por el medio
     recibido y la salida de efectivo «Cambio entregado». Así el arqueo cierra y queda justificado de dónde salió el efectivo.
   Se guarda en la donación: calc { sug, cant, sub, libres, desc }, recibido, cambio y cmMedio (medio que recibió de más). */
(function (g) {
  'use strict';
  var CM = g.CM, esc = CM.esc, U = CM.U, fl = U.fl, flr = U.flr, fail = U.fail, money = function (c) { return CM.fmtMoney(c); };
  var render = function () { CM.render(); };

  /* ---------- aporte sugerido de un lote ---------- */
  CM.sugLote = function (l) {
    if (!l) return 0;
    if (l.sug > 0) return l.sug;
    var n = CM.norm(l.nombre || ''), mejor = null;
    (CM.db.lotes || []).forEach(function (x) { if (x !== l && x.sug > 0 && CM.norm(x.nombre || '') === n && (!mejor || String(x.ingreso || '') > String(mejor.ingreso || ''))) mejor = x; });
    return mejor ? mejor.sug : 0;
  };
  CM.sugPorNombre = function (nombre) { return CM.sugLote({ nombre: nombre }); };
  /* 5+1: cada 5 unidades, 1 sin aporte (grupos de 6). Con decimales cuentan sólo los grupos completos. */
  CM.calcAporte = function (sug, cant) {
    sug = sug > 0 ? Math.round(sug) : 0; cant = cant > 0 ? cant : 0;
    var sub = Math.round(sug * cant), libres = Math.floor(cant / 6 + 1e-9), desc = Math.min(sub, libres * sug);
    return { sug: sug, cant: cant, sub: sub, libres: libres, desc: desc, total: sub - desc };
  };
  function cents(v) { return String(v / 100).replace('.', ','); }
  function unidadTxt(u) { return u === 'g' ? 'gramo' : u === 'frasco' ? 'frasco' : 'unidad'; }

  /* ---------- campos de la donación (dispensación con uno o varios productos) ----------
     Cada producto es un renglón [data-dsr="k"] (k = '' el primero, '_2', '_3'…) con su lote, cantidad, sugerido, 5+1 y
     subtotal. Abajo, en «Donación voluntaria», un único total (name="aporte") = suma de los renglones; se puede cambiar. */
  CM.aporteFilaHtml = function (k) {
    k = k || '';
    return '<div class="f f3 apc-fila">' + flr('Aporte sugerido por <span data-apc-un>unidad</span>', '<input class="in num" name="sug' + k + '" inputmode="decimal" placeholder="0" data-apc-in>') +
      flr('Descuento 5+1 <small class="hint">(cada 5, 1 sin aporte)</small>', '<input class="in num" name="desc' + k + '" inputmode="decimal" placeholder="0" data-apc-in>') +
      '<div class="fl"><span>Subtotal</span><output class="in ro" data-apc-sub aria-live="polite">$ 0,00</output></div></div><p class="hint" data-apc-rmsg aria-live="polite" style="margin:-2px 0 0"></p>';
  };
  CM.aporteCalcHtml = function () {
    return '<div class="apc" data-apc>' + fl('Total de la donación (se genera solo, se puede cambiar)', '<input class="in num" name="aporte" inputmode="decimal" placeholder="0" data-apc-in style="font-weight:700;font-size:20px">') +
      '<p class="hint" data-apc-msg aria-live="polite" style="margin:-2px 0 0"></p></div>';
  };
  /* Recibido / cambio: para efectivo y para cualquier medio en el que el paciente entregue de más (el cambio sale en efectivo) */
  CM.cambioHtml = function () {
    return '<div class="card flat cambio" data-cambio><div class="f f2">' +
      flr('<span data-cb-lab>Recibido en efectivo</span> <small class="hint">(opcional)</small>', '<input class="in num" name="recibido" inputmode="decimal" placeholder="Igual al total">') +
      '<div class="fl"><span>Cambio a entregar (en efectivo)</span><output class="in ro big" data-cb-out aria-live="polite">$ 0,00</output></div></div>' +
      '<div class="row" style="margin-top:6px"><button type="button" class="btn sm" data-act="cb-justo">Justo</button><span class="hint" data-cb-msg aria-live="polite"></span></div></div>';
  };

  function num(f, n) { var i = f.elements[n]; if (!i || !String(i.value).trim()) return NaN; return CM.parseMonto(i.value); }
  function setVal(f, n, c) { var i = f.elements[n]; if (i) i.value = c > 0 ? cents(c) : (c === 0 ? '0' : ''); }
  function estado(f) { if (!f._apc) f._apc = { descMan: {}, totMan: false }; return f._apc; }
  CM.dsFilas = function (f) { return Array.prototype.map.call(f.querySelectorAll('[data-dsr]'), function (r) { return r.getAttribute('data-dsr'); }); };
  /* recalcula: lote → sugerido; cantidad × sugerido → subtotal; 5+1 → descuento; suma de renglones → total */
  CM.apcRecalc = function (f, origen, kOrig) {
    var box = f && f.querySelector('[data-apc]'); if (!box) return;
    var st = estado(f), e = f.elements, total = 0, hay = false, libresTxt = [], sinSug = [];
    if (origen === 'aporte') st.totMan = true;
    CM.dsFilas(f).forEach(function (k) {
      var row = f.querySelector('[data-dsr="' + k + '"]'), l = e['lote' + k] ? CM.lote(e['lote' + k].value) : null;
      var un = row.querySelector('[data-apc-un]'); if (un) un.textContent = l ? unidadTxt(l.unidad) : 'unidad';
      if (origen === 'lote' && kOrig === k) { var s0 = CM.sugLote(l); setVal(f, 'sug' + k, s0 || NaN); if (!s0 && e['sug' + k]) e['sug' + k].value = ''; delete st.descMan[k]; }
      if (origen === 'desc' && kOrig === k) st.descMan[k] = true;
      var sug = num(f, 'sug' + k), cant = CM.parseCant(e['cant' + k] ? e['cant' + k].value : '');
      if (isNaN(sug)) sug = 0; if (isNaN(cant)) cant = 0;
      var c = CM.calcAporte(sug, cant);
      row.querySelector('[data-apc-sub]').textContent = money(c.sub);
      if (!st.descMan[k]) setVal(f, 'desc' + k, c.sub > 0 ? c.desc : NaN);
      var desc = num(f, 'desc' + k); if (isNaN(desc)) desc = 0;
      if (c.sub > 0) { hay = true; total += Math.max(0, c.sub - desc); }
      var rm = row.querySelector('[data-apc-rmsg]'), t = [];
      if (c.libres > 0 && sug > 0) { var lt = c.libres + ' ' + (l ? unidadTxt(l.unidad) : 'unidad') + (c.libres > 1 ? 's' : '') + ' sin aporte (' + money(c.libres * sug) + ')'; t.push('5+1: ' + lt + '.'); libresTxt.push(lt); }
      if (!sug && l) { t.push('Este lote no tiene aporte sugerido: se carga en Trazabilidad / Stock → «Aporte sugerido».'); sinSug.push(l.nombre); }
      if (rm) rm.innerHTML = t.join(' ');
    });
    if (!st.totMan) setVal(f, 'aporte', hay ? total : NaN);
    var tot = num(f, 'aporte'), msg = box.querySelector('[data-apc-msg]');
    if (msg) {
      var t2 = [], n = CM.dsFilas(f).length;
      if (n > 1 && hay) t2.push('Sugerido por ' + n + ' productos: ' + money(total) + '.');
      if (libresTxt.length) t2.push('5+1: ' + libresTxt.join(' · ') + '.');
      if (hay && !isNaN(tot) && tot !== total) t2.push('El total difiere del sugerido (' + money(total) + '): la donación es voluntaria. <button type="button" class="btn sm" data-act="apc-reset">Volver al sugerido</button>');
      msg.innerHTML = t2.join(' ');
    }
    CM.cambioRecalc(f);
  };
  CM.acts['apc-reset'] = function (t) { var f = t.closest('form'); if (!f) return; f._apc = { descMan: {}, totMan: false }; CM.apcRecalc(f); };

  function medioDe(f) { var m = f.elements.medio; return m ? m.value : 'efectivo'; }
  function totalDe(f) { var v = num(f, 'aporte'); if (isNaN(v)) v = num(f, 'importe'); return isNaN(v) ? 0 : v; }
  function parteEfectivo(f, total) {
    var med = medioDe(f);
    if (med === 'efectivo') return total;
    if (med !== 'mixto') return 0;
    var v = num(f, 'mx_efectivo'); return isNaN(v) ? 0 : v;
  }
  CM.cambioRecalc = function (f) {
    var box = f && f.querySelector('[data-cambio]'); if (!box) return;
    var med = medioDe(f), total = totalDe(f), lab = box.querySelector('[data-cb-lab]'), out = box.querySelector('[data-cb-out]'), msg = box.querySelector('[data-cb-msg]');
    var base = med === 'mixto' ? parteEfectivo(f, total) : total;
    lab.textContent = med === 'efectivo' || med === 'mixto' ? 'Recibido en efectivo' : 'Recibido por ' + (CM.MEDIOS[med] || med).toLowerCase();
    box.hidden = !(total > 0);
    var rec = num(f, 'recibido');
    if (isNaN(rec)) { out.textContent = money(0); msg.textContent = med === 'efectivo' ? 'Si entrega justo, dejalo vacío.' : med === 'mixto' ? 'Recibido se refiere a la parte en efectivo.' : 'Completalo sólo si transfirió de más y se le da el cambio en efectivo.'; return; }
    var cb = rec - base;
    out.textContent = cb >= 0 ? money(cb) : '—';
    msg.textContent = cb < 0 ? 'No alcanza: faltan ' + money(-cb) + '.' : cb > 0 ? 'Entregá ' + money(cb) + ' de cambio en efectivo: queda como salida justificada en la caja.' : 'Justo, sin cambio.';
  };
  CM.acts['cb-justo'] = function (t) { var f = t.closest('form'); if (!f) return; var i = f.elements.recibido; if (i) i.value = ''; CM.cambioRecalc(f); };
  /* lee recibido/cambio al confirmar. Devuelve { recibido, cambio, cmMedio } o { err, campo } */
  CM.leerCambio = function (f, total, medio, pays) {
    var rec = num(f, 'recibido');
    if (isNaN(rec)) { if (f.elements.recibido && String(f.elements.recibido.value).trim()) return { err: 'El recibido no es un importe válido.', campo: 'recibido' }; return { recibido: 0, cambio: 0, cmMedio: '' }; }
    var base = total, cmMedio = medio;
    if (medio === 'mixto') {
      var ef = (pays || []).filter(function (x) { return x.m === 'efectivo'; })[0];
      if (!ef) return { err: 'En un pago mixto, «Recibido» es la parte en efectivo: agregá el importe en efectivo o dejá el recibido vacío.', campo: 'recibido' };
      base = ef.a; cmMedio = 'efectivo';
    }
    if (rec < base) return { err: 'Lo recibido (' + money(rec) + ') no alcanza para ' + (medio === 'mixto' ? 'la parte en efectivo' : 'la donación') + ' (' + money(base) + ').', campo: 'recibido' };
    if (rec - base > 0 && medio !== 'efectivo' && medio !== 'mixto' && rec - base > base * 20 + 5000000) return { err: 'El cambio parece demasiado grande: revisá el recibido.', campo: 'recibido' };
    return { recibido: rec, cambio: rec - base, cmMedio: rec - base > 0 ? cmMedio : '' };
  };

  /* recálculo en vivo */
  document.addEventListener('input', function (ev) {
    var t = ev.target, f = t && t.form; if (!f) return;
    var mm = /^(sug|cant|desc)(_\d+)?$/.exec(t.name || '');
    if (f.querySelector('[data-apc]') && (mm || t.name === 'aporte')) CM.apcRecalc(f, t.name === 'aporte' ? 'aporte' : mm[1] === 'desc' ? 'desc' : mm[1], mm ? mm[2] || '' : '');
    else if (f.querySelector('[data-cambio]') && (t.name === 'recibido' || t.name === 'importe' || /^mx_/.test(t.name))) CM.cambioRecalc(f);
  });
  document.addEventListener('change', function (ev) {
    var t = ev.target, f = t && t.form; if (!f) return;
    var ml = /^lote(_\d+)?$/.exec(t.name || '');
    if (ml && f.querySelector('[data-apc]')) CM.apcRecalc(f, 'lote', ml[1] || '');
    if (t.name === 'medio' && f.querySelector('[data-cambio]')) CM.cambioRecalc(f);
  });

  /* ---------- detalle para tickets, comprobantes y la ficha ---------- */
  CM.aporteDetalle = function (a) {
    if (!a) return '';
    var t = [];
    if (a.calc && a.calc.sug) t.push('Sugerido ' + money(a.calc.sug) + ' × ' + CM.fmtNum(a.calc.cant) + ' = ' + money(a.calc.sub) + (a.calc.desc ? ' − 5+1 ' + money(a.calc.desc) : ''));
    (a.calcs || []).forEach(function (c) { t.push((c.nombre ? c.nombre + ': ' : '') + money(c.sug) + ' × ' + CM.fmtNum(c.cant) + ' = ' + money(c.sub) + (c.desc ? ' − 5+1 ' + money(c.desc) : '')); });
    if (a.cambio > 0) t.push('Recibido ' + money(a.recibido) + (a.cmMedio && a.cmMedio !== 'efectivo' ? ' por ' + (CM.MEDIOS[a.cmMedio] || a.cmMedio).toLowerCase() : ' en efectivo') + ' · cambio ' + money(a.cambio) + ' en efectivo');
    return t.join(' · ');
  };

  /* ---------- aporte sugerido de un lote (Trazabilidad / Stock) ---------- */
  CM.acts['lote-sug'] = function (t) {
    if (!CM.need('trazabilidad', 'edit')) return;
    var sel = t && t.getAttribute('data-id') || '';
    var ls = CM.lotesVivos().slice().sort(function (a, b) { return String(b.ingreso || '').localeCompare(String(a.ingreso || '')); });
    CM.modal.open({
      title: 'Aporte sugerido por unidad',
      body: '<form id="fLS" data-form="lote-sug" class="f" autocomplete="off" novalidate>' +
        fl('Lote *', '<select class="in" name="lote" data-ls-lote><option value="">Elegí un lote…</option>' + ls.map(function (l) { var s = CM.sugLote(l); return U.opt(l.id, l.nombre + ' · ' + l.id + ' · ' + (s ? money(s) + ' por ' + unidadTxt(l.unidad) : 'sin sugerido'), l.id === sel); }).join('') + '</select>') +
        '<div class="f f2">' + fl('Aporte sugerido por unidad (en pesos) *', '<input class="in num" name="sug" inputmode="decimal" placeholder="0">') + fl('Motivo del cambio', '<input class="in" name="motivo" maxlength="120" placeholder="Ej.: actualización mensual">') + '</div>' +
        '<label class="chk"><input type="checkbox" name="todos" checked><span>Aplicar a todos los lotes con el mismo nombre / genética</span></label>' +
        '<p class="hint" style="margin:0">Es una sugerencia para el operador: en cada dispensación se puede cambiar. El 5+1 se calcula solo (cada 5, 1 sin aporte). Cada cambio queda en la auditoría.</p><p class="err" role="alert" data-err></p></form>',
      footer: '<button class="btn" type="button" data-act="modal-close">Cancelar</button><button class="btn pri" type="submit" form="fLS">Guardar</button>'
    });
    var f = document.getElementById('fLS'); if (f && sel) { var l0 = CM.lote(sel), s0 = CM.sugLote(l0); if (s0) f.elements.sug.value = cents(s0); }
  };
  document.addEventListener('change', function (ev) {
    var t = ev.target; if (!t.hasAttribute || !t.hasAttribute('data-ls-lote')) return;
    var s = CM.sugLote(CM.lote(t.value)); t.form.elements.sug.value = s ? cents(s) : '';
  });
  CM.forms['lote-sug'] = function (f) {
    if (!CM.need('trazabilidad', 'edit')) return;
    var e = f.elements, l = CM.lote(e.lote.value); if (!l) return fail(f, 'lote', 'Elegí un lote.');
    var s = CM.parseMonto(e.sug.value); if (isNaN(s) || s < 0) return fail(f, 'sug', 'Escribí un importe válido (puede ser 0 para quitarlo).');
    var lst = e.todos.checked ? CM.db.lotes.filter(function (x) { return CM.norm(x.nombre) === CM.norm(l.nombre); }) : [l], mot = e.motivo.value.trim();
    lst.forEach(function (x) { var antes = x.sug || 0; if (antes === s) return; (x.sugHist = x.sugHist || []).push({ ts: new Date().toISOString(), user: CM.db.cfg.operador, antes: antes, despues: s, motivo: mot }); x.sug = s; });
    CM.audit('Aporte sugerido', lst.map(function (x) { return x.id; }).join(', ') + ' · ' + l.nombre + ' · ' + money(s) + ' por ' + unidadTxt(l.unidad) + (mot ? ' · ' + mot : ''));
    CM.save(); CM.modal.close(true); render(); CM.toast('Aporte sugerido actualizado (' + lst.length + ' lote' + (lst.length > 1 ? 's' : '') + ').');
  };
})(window);
