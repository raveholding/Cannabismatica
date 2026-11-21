/* Sistema VB ONG · Promociones de la dispensa, configurables por la administración · 2026-11-21
   Pedido del dueño: «en dispensa se debe poder modificar o agregar las promociones a medida y gusto».
   · Colección «promos» (en la nube: escritura sólo con nivel administrador, validado en el servidor).
   · Tipos: «N + M» (cada N unidades, M sin aporte: el 5+1 de siempre), porcentaje, aporte especial por unidad y monto fijo.
   · Condiciones opcionales: cantidad mínima, preparados (aceite, flor…), genéticas/lotes por nombre, vigencia y días de la semana.
   · Regla de oro: una promoción por producto, nunca se acumulan. Por defecto se aplica la que más descuenta; el operador
     puede elegir otra o «Sin promoción» en cada renglón, y el descuento se puede cambiar a mano (la donación es voluntaria).
   · Las promociones no se borran: se pausan o se archivan (las donaciones viejas conservan el nombre con que se aplicaron).
   · Mientras la administración no cargue ninguna, rige la 5+1 de siempre. */
(function (g) {
  'use strict';
  var CM = g.CM, esc = CM.esc, U = CM.U, fl = U.fl, fail = U.fail, money = function (c) { return CM.fmtMoney(c); };
  var DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  var TIPOS = { nm: 'Cada N, M sin aporte', pct: 'Porcentaje', precio: 'Aporte especial por unidad', monto: 'Monto fijo' };
  function def() { return { id: 'PR-5MAS1', nombre: '5+1', tipo: 'nm', base: 5, extra: 1, min: 0, prods: [], gens: [], desde: '', hasta: '', dias: [], activo: true, archivada: false, hist: [], creada: { ts: '', user: 'Sistema (la de siempre)' } }; }
  function arr() { if (!Array.isArray(CM.db.promos)) CM.db.promos = []; return CM.db.promos; }
  CM.promosLista = function () { var a = arr(); return a.length ? a : [def()]; };
  CM.promo = function (id) { return CM.promosLista().filter(function (p) { return p.id === id; })[0] || null; };
  function hoyLocal() { return CM.hoy ? CM.hoy() : new Date().toISOString().slice(0, 10); }
  function diaSem(iso) { var p = String(iso).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]).getDay(); }

  /* ¿aplica a este renglón? devuelve '' o el motivo por el que no */
  CM.promoNoAplica = function (p, lote, cant, hoy) {
    hoy = hoy || hoyLocal();
    if (!p || p.archivada) return 'archivada';
    if (!p.activo) return 'pausada';
    if (p.desde && hoy < p.desde) return 'empieza el ' + CM.fmtFecha(p.desde);
    if (p.hasta && hoy > p.hasta) return 'venció el ' + CM.fmtFecha(p.hasta);
    if (p.dias && p.dias.length && p.dias.indexOf(diaSem(hoy)) < 0) return 'sólo ' + p.dias.map(function (d) { return DIAS[d]; }).join(', ');
    if (p.min > 0 && !(cant >= p.min)) return 'desde ' + CM.fmtNum(p.min) + ' unidades';
    if (p.prods && p.prods.length && (!lote || p.prods.indexOf(lote.prod) < 0)) return 'otro preparado';
    if (p.gens && p.gens.length) {
      var n1 = lote ? CM.norm(lote.nombre || '') : '', n2 = lote ? CM.norm(lote.genVar || '') : '';
      if (!p.gens.some(function (x) { var q = CM.norm(x); return q && (q === n1 || q === n2); })) return 'otra genética';
    }
    return '';
  };
  /* descuento de una promoción sobre sug × cant (en centavos) */
  CM.promoDescuento = function (p, sug, cant) {
    var sub = Math.round(sug * cant), libres = 0, d = 0;
    if (p.tipo === 'nm') { var grupo = (p.base || 0) + (p.extra || 0); libres = grupo > 0 ? Math.floor(cant / grupo + 1e-9) * (p.extra || 0) : 0; d = Math.round(libres * sug); }
    else if (p.tipo === 'pct') d = Math.round(sub * Math.min(100, Math.max(0, p.pct || 0)) / 100);
    else if (p.tipo === 'precio') d = p.precio >= 0 ? Math.max(0, sub - Math.round(p.precio * cant)) : 0;
    else if (p.tipo === 'monto') d = Math.max(0, p.monto || 0);
    return { desc: Math.min(sub, d), libres: libres };
  };
  /* sel: '' = la que más descuenta; id = esa (si aplica) */
  CM.mejorPromo = function (sug, cant, lote, sel) {
    if (!(sug > 0) || !(cant > 0)) return null;
    var mejor = null;
    CM.promosLista().forEach(function (p) {
      if (sel && p.id !== sel) return;
      if (CM.promoNoAplica(p, lote, cant)) return;
      var r = CM.promoDescuento(p, sug, cant);
      if (r.desc > 0 && (!mejor || r.desc > mejor.desc)) mejor = { p: p, desc: r.desc, libres: r.libres };
    });
    return mejor;
  };
  /* arma el selector del renglón (conserva la elección) */
  CM.promoOpciones = function (sel, sug, cant, lote) {
    var v = sel.value, h = '<option value="">Automática (la que más conviene)</option><option value="-">Sin promoción</option>', hay = false;
    CM.promosLista().forEach(function (p) {
      if (CM.promoNoAplica(p, lote, cant)) return;
      var r = sug > 0 && cant > 0 ? CM.promoDescuento(p, sug, cant) : { desc: 0 };
      hay = true; h += '<option value="' + esc(p.id) + '">' + esc(p.nombre) + (r.desc > 0 ? ' (− ' + esc(money(r.desc)) + ')' : ' (no descuenta con esta cantidad)') + '</option>';
    });
    if (sel._h !== h) { sel.innerHTML = h; sel._h = h; }
    sel.value = v; if (sel.value !== v) sel.value = '';
    sel.disabled = !hay && v !== '-';
  };
  function describe(p) {
    var t = p.tipo === 'nm' ? 'Cada ' + p.base + ', ' + p.extra + ' sin aporte (llevando ' + (p.base + p.extra) + ' aporta por ' + p.base + ')' :
      p.tipo === 'pct' ? p.pct + ' % menos' : p.tipo === 'precio' ? money(p.precio) + ' por unidad' : money(p.monto) + ' menos por producto';
    var c = [];
    if (p.min > 0) c.push('desde ' + CM.fmtNum(p.min) + ' u.');
    if (p.prods && p.prods.length) c.push(p.prods.map(function (k) { return (CM.PRODUCTOS[k] || {}).n || k; }).join(', '));
    if (p.gens && p.gens.length) c.push('genéticas: ' + p.gens.join(', '));
    if (p.dias && p.dias.length) c.push(p.dias.map(function (d) { return DIAS[d]; }).join(' '));
    if (p.desde || p.hasta) c.push((p.desde ? 'desde ' + CM.fmtFecha(p.desde) : '') + (p.hasta ? ' hasta ' + CM.fmtFecha(p.hasta) : ''));
    return t + (c.length ? ' · ' + c.join(' · ') : '');
  }
  CM.promoDescribe = describe;
  function puede() { return CM.can('dispensaciones', 'admin'); }

  /* ---------- listado (modal) ---------- */
  CM.acts.promos = function () {
    if (!CM.need('dispensaciones', 'ver')) return;
    var adm = puede(), ls = CM.promosLista(), verArch = !!CM._promosArch;
    var vis = ls.filter(function (p) { return verArch || !p.archivada; }), nArch = ls.filter(function (p) { return p.archivada; }).length;
    var h = '<p class="hint" style="margin:0 0 10px">Se aplican solas al dispensar (la que más descuenta; nunca se suman dos en el mismo producto). En cada renglón el operador puede elegir otra o «Sin promoción». ' +
      (adm ? 'Las promociones no se borran: se pausan o se archivan.' : 'Sólo la administración puede crearlas o cambiarlas.') + '</p>' +
      (vis.length ? '<div class="tw"><table><thead><tr><th>Promoción</th><th>Cómo funciona</th><th>Estado</th>' + (adm ? '<th></th>' : '') + '</tr></thead><tbody>' + vis.map(function (p) {
        var na = CM.promoNoAplica(p, null, 1e9), est = p.archivada ? '<span class="pill">Archivada</span>' : !p.activo ? '<span class="pill p-warn">Pausada</span>' : /venció|empieza/.test(na) ? '<span class="pill p-warn">' + esc(na) + '</span>' : '<span class="pill p-ok">Activa</span>';
        return '<tr><td><b>' + esc(p.nombre) + '</b></td><td>' + esc(describe(p)) + '</td><td>' + est + '</td>' + (adm ? '<td><div class="row" style="flex-wrap:nowrap">' +
          (p.archivada ? '<button class="btn sm" data-act="promo-estado" data-id="' + esc(p.id) + '" data-e="restaurar">Restaurar</button>' :
            '<button class="btn sm" data-act="promo-ed" data-id="' + esc(p.id) + '" aria-label="Editar ' + esc(p.nombre) + '">' + CM.icon('edit') + 'Editar</button>' +
            '<button class="btn sm" data-act="promo-estado" data-id="' + esc(p.id) + '" data-e="' + (p.activo ? 'pausar' : 'activar') + '">' + (p.activo ? 'Pausar' : 'Activar') + '</button>' +
            '<button class="btn sm bad" data-act="promo-estado" data-id="' + esc(p.id) + '" data-e="archivar">Archivar</button>') + '</div></td>' : '') + '</tr>';
      }).join('') + '</tbody></table></div>' : '<p class="hint">No hay promociones activas: las dispensas van sin descuento automático.</p>') +
      (nArch ? '<p><button class="btn sm" data-act="promos-arch">' + (verArch ? 'Ocultar archivadas' : 'Ver archivadas (' + nArch + ')') + '</button></p>' : '');
    CM.modal.open({ title: 'Promociones de la dispensa', wide: true, body: h,
      footer: '<button class="btn" data-act="modal-close">Cerrar</button>' + (adm ? '<button class="btn pri" data-act="promo-ed" data-id="">' + CM.icon('plus') + 'Nueva promoción</button>' : '') });
  };
  CM.acts['promos-arch'] = function () { CM._promosArch = !CM._promosArch; CM.modal.close(true); CM.acts.promos(); };

  /* materializa la promoción por defecto la primera vez que se toca algo */
  function materializar() { var a = arr(); if (!a.length) { var d = def(); d.creada = { ts: new Date().toISOString(), user: 'Sistema (la de siempre)' }; a.push(d); } return a; }
  function snap(p) { var o = {}; Object.keys(p).forEach(function (k) { if (k !== 'hist') o[k] = p[k]; }); return JSON.parse(JSON.stringify(o)); }
  function nuevoId() { var c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = '', b = new Uint8Array(6); (g.crypto || g.msCrypto).getRandomValues(b); for (var i = 0; i < 6; i++) s += c[b[i] % c.length]; return 'PR-' + s; }

  CM.acts['promo-estado'] = function (t) {
    if (!puede()) return CM.toast('Sólo la administración cambia las promociones.', true);
    var a = materializar(), p = a.filter(function (x) { return x.id === t.getAttribute('data-id'); })[0], e = t.getAttribute('data-e'); if (!p) return;
    var antes = snap(p);
    if (e === 'pausar') p.activo = false; else if (e === 'activar') p.activo = true;
    else if (e === 'archivar') { p.archivada = true; p.activo = false; } else if (e === 'restaurar') { p.archivada = false; }
    (p.hist = p.hist || []).push({ ts: new Date().toISOString(), user: CM.db.cfg.operador, accion: e, antes: antes });
    CM.audit('Promoción ' + (e === 'pausar' ? 'pausada' : e === 'activar' ? 'activada' : e === 'archivar' ? 'archivada' : 'restaurada'), p.id + ' · ' + p.nombre);
    CM.save(); CM.modal.close(true); CM.acts.promos(); CM.toast('Promoción «' + p.nombre + '» ' + (e === 'pausar' ? 'pausada' : e === 'activar' ? 'activada' : e === 'archivar' ? 'archivada' : 'restaurada') + '.');
  };

  /* ---------- alta / edición ---------- */
  function genOpciones() { var v = {}; (CM.db.lotes || []).forEach(function (l) { if (l.nombre) v[l.nombre] = 1; if (l.genVar) v[l.genVar] = 1; }); return Object.keys(v).sort(); }
  function cents(c) { return c > 0 ? String(c / 100).replace('.', ',') : c === 0 ? '0' : ''; }
  CM.acts['promo-ed'] = function (t) {
    if (!puede()) return CM.toast('Sólo la administración crea o cambia promociones.', true);
    var id = t.getAttribute('data-id') || '', p = id ? CM.promo(id) : null;
    p = p || { nombre: '', tipo: 'nm', base: 5, extra: 1, pct: '', precio: '', monto: '', min: 0, prods: [], gens: [], desde: '', hasta: '', dias: [], activo: true };
    var gens = genOpciones();
    var body = '<form id="fPR" data-form="promo-ed" class="f" autocomplete="off" novalidate><input type="hidden" name="pid" value="' + esc(id) + '">' +
      '<div class="f f2">' + fl('Nombre *', '<input class="in" name="nombre" maxlength="40" value="' + esc(p.nombre) + '" placeholder="Ej.: 5+1, Martes 10 %, Socio frecuente">') +
      fl('Tipo *', '<select class="in" name="tipo" data-pr-tipo>' + Object.keys(TIPOS).map(function (k) { return U.opt(k, TIPOS[k], p.tipo === k); }).join('') + '</select>') + '</div>' +
      '<div class="f f2" data-pr-t="nm">' + fl('Cada (unidades que aportan) *', '<input class="in num" name="base" inputmode="numeric" value="' + esc(p.base || '') + '" placeholder="5">') + fl('Sin aporte (de regalo) *', '<input class="in num" name="extra" inputmode="numeric" value="' + esc(p.extra || '') + '" placeholder="1">') + '</div>' +
      '<div class="f f2" data-pr-t="pct">' + fl('Porcentaje de descuento *', '<input class="in num" name="pct" inputmode="decimal" value="' + esc(p.pct || '') + '" placeholder="10">') + '<div></div></div>' +
      '<div class="f f2" data-pr-t="precio">' + fl('Aporte especial por unidad (en pesos) *', '<input class="in num" name="precio" inputmode="decimal" value="' + esc(cents(p.precio)) + '" placeholder="0">') + '<div></div></div>' +
      '<div class="f f2" data-pr-t="monto">' + fl('Monto que se descuenta por producto (en pesos) *', '<input class="in num" name="monto" inputmode="decimal" value="' + esc(cents(p.monto)) + '" placeholder="0">') + '<div></div></div>' +
      '<fieldset><legend>Condiciones (opcionales)</legend><div class="f f3">' + fl('Desde cantidad', '<input class="in num" name="min" inputmode="decimal" value="' + esc(p.min || '') + '" placeholder="Sin mínimo">') +
      fl('Vigente desde', '<input class="in" type="date" name="desde" value="' + esc(p.desde || '') + '">') + fl('Vigente hasta', '<input class="in" type="date" name="hasta" value="' + esc(p.hasta || '') + '">') + '</div>' +
      '<div class="fl"><span>Preparados (ninguno marcado = todos)</span><div class="row">' + Object.keys(CM.PRODUCTOS).map(function (k) { return '<label class="chk"><input type="checkbox" name="prod" value="' + esc(k) + '"' + (p.prods.indexOf(k) >= 0 ? ' checked' : '') + '><span>' + esc(CM.PRODUCTOS[k].n) + '</span></label>'; }).join('') + '</div></div>' +
      fl('Genéticas o lotes por nombre (separados por coma; vacío = todos)', '<input class="in" name="gens" list="prGens" maxlength="300" value="' + esc((p.gens || []).join(', ')) + '"><datalist id="prGens">' + gens.map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') + '</datalist>') +
      '<div class="fl"><span>Días de la semana (ninguno = todos)</span><div class="row">' + DIAS.map(function (d, i) { return '<label class="chk"><input type="checkbox" name="dia" value="' + i + '"' + ((p.dias || []).indexOf(i) >= 0 ? ' checked' : '') + '><span>' + d + '</span></label>'; }).join('') + '</div></div></fieldset>' +
      '<label class="chk"><input type="checkbox" name="activo"' + (p.activo !== false ? ' checked' : '') + '><span>Activa</span></label>' +
      (id ? fl('Motivo del cambio', '<input class="in" name="motivo" maxlength="120" placeholder="Ej.: promo de diciembre">') : '') +
      '<p class="hint" data-pr-ej aria-live="polite" style="margin:0"></p><p class="err" role="alert" data-err></p></form>';
    CM.modal.open({ title: id ? 'Editar promoción' : 'Nueva promoción', wide: true, body: body,
      footer: '<button class="btn" type="button" data-act="promos">Volver</button><button class="btn pri" type="submit" form="fPR">Guardar</button>' });
    var f = document.getElementById('fPR'); if (f) verTipo(f);
  };
  function leerForm(f) {
    var e = f.elements, tipo = e.tipo.value, p = { tipo: tipo };
    p.nombre = e.nombre.value.trim().replace(/\s+/g, ' ');
    if (p.nombre.length < 2) return { err: 'Escribí un nombre para la promoción.', campo: 'nombre' };
    if (!TIPOS[tipo]) return { err: 'Elegí el tipo.', campo: 'tipo' };
    if (tipo === 'nm') {
      p.base = parseInt(e.base.value, 10); p.extra = parseInt(e.extra.value, 10);
      if (!(p.base >= 1 && p.base <= 999)) return { err: 'Indicá cada cuántas unidades (un número entero, por ejemplo 5).', campo: 'base' };
      if (!(p.extra >= 1 && p.extra <= 99)) return { err: 'Indicá cuántas van sin aporte (por ejemplo 1).', campo: 'extra' };
    } else if (tipo === 'pct') {
      p.pct = CM.parseCant(e.pct.value); if (isNaN(p.pct) || p.pct <= 0 || p.pct > 100) return { err: 'El porcentaje va de 0,01 a 100.', campo: 'pct' };
    } else if (tipo === 'precio') {
      p.precio = CM.parseMonto(e.precio.value); if (isNaN(p.precio) || p.precio < 0) return { err: 'Escribí el aporte especial por unidad (puede ser 0).', campo: 'precio' };
    } else {
      p.monto = CM.parseMonto(e.monto.value); if (isNaN(p.monto) || p.monto <= 0) return { err: 'Escribí el monto a descontar.', campo: 'monto' };
    }
    p.min = e.min.value.trim() ? CM.parseCant(e.min.value) : 0; if (isNaN(p.min) || p.min < 0) return { err: 'La cantidad mínima no es válida.', campo: 'min' };
    p.desde = e.desde.value || ''; p.hasta = e.hasta.value || '';
    if (p.desde && !/^\d{4}-\d{2}-\d{2}$/.test(p.desde)) return { err: 'La fecha «desde» no es válida.', campo: 'desde' };
    if (p.hasta && !/^\d{4}-\d{2}-\d{2}$/.test(p.hasta)) return { err: 'La fecha «hasta» no es válida.', campo: 'hasta' };
    if (p.desde && p.hasta && p.hasta < p.desde) return { err: '«Hasta» es anterior a «desde».', campo: 'hasta' };
    p.prods = Array.prototype.filter.call(f.querySelectorAll('[name="prod"]'), function (x) { return x.checked && CM.PRODUCTOS[x.value]; }).map(function (x) { return x.value; });
    p.dias = Array.prototype.filter.call(f.querySelectorAll('[name="dia"]'), function (x) { return x.checked; }).map(function (x) { return +x.value; });
    p.gens = e.gens.value.split(',').map(function (x) { return x.trim().replace(/\s+/g, ' ').slice(0, 60); }).filter(Boolean).slice(0, 30);
    p.activo = e.activo.checked;
    return { p: p };
  }
  function verTipo(f) {
    var t = f.elements.tipo.value;
    Array.prototype.forEach.call(f.querySelectorAll('[data-pr-t]'), function (x) { x.style.display = x.getAttribute('data-pr-t') !== t ? 'none' : ''; });
    var r = leerForm(f), ej = f.querySelector('[data-pr-ej]');
    if (!ej) return;
    if (r.err) { ej.textContent = ''; return; }
    var q = r.p.tipo === 'nm' ? r.p.base + r.p.extra : Math.max(r.p.min || 0, 6), d = CM.promoDescuento(r.p, 100000, q);
    ej.textContent = 'Ejemplo: con aporte sugerido de $ 1.000 por unidad y ' + CM.fmtNum(q) + ' unidades (' + money(100000 * q) + '), descuenta ' + money(d.desc) + ' y queda en ' + money(100000 * q - d.desc) + '.';
  }
  document.addEventListener('input', function (ev) { var f = ev.target && ev.target.form; if (f && f.id === 'fPR') verTipo(f); });
  document.addEventListener('change', function (ev) { var f = ev.target && ev.target.form; if (f && f.id === 'fPR') verTipo(f); });

  CM.forms['promo-ed'] = function (f) {
    if (!puede()) return fail(f, '', 'Sólo la administración crea o cambia promociones.');
    var r = leerForm(f); if (r.err) return fail(f, r.campo, r.err);
    var a = materializar(), id = f.elements.pid.value, p = id ? a.filter(function (x) { return x.id === id; })[0] : null, np = r.p;
    var otra = a.filter(function (x) { return !x.archivada && x !== p && CM.norm(x.nombre) === CM.norm(np.nombre); })[0];
    if (otra) return fail(f, 'nombre', 'Ya hay una promoción con ese nombre.');
    var mot = f.elements.motivo ? f.elements.motivo.value.trim() : '';
    if (p) {
      var antes = snap(p);
      Object.keys(np).forEach(function (k) { p[k] = np[k]; });
      ['base', 'extra', 'pct', 'precio', 'monto'].forEach(function (k) { if (!(k in np)) delete p[k]; });
      (p.hist = p.hist || []).push({ ts: new Date().toISOString(), user: CM.db.cfg.operador, accion: 'editar', antes: antes, motivo: mot });
      CM.audit('Promoción editada', p.id + ' · ' + p.nombre + ' · ' + describe(p) + (mot ? ' · motivo: ' + mot : ''));
    } else {
      p = np; p.id = nuevoId(); p.archivada = false; p.hist = []; p.creada = { ts: new Date().toISOString(), user: CM.db.cfg.operador };
      a.push(p); CM.audit('Promoción creada', p.id + ' · ' + p.nombre + ' · ' + describe(p));
    }
    CM.save(); CM.modal.close(true); CM.acts.promos(); CM.toast('Promoción «' + p.nombre + '» guardada.');
  };

  /* botón en Dispensaciones */
  var v0 = CM.VIEWS && CM.VIEWS.dispensaciones;
  function engancharVista() {
    var V = CM.VIEWS; if (!V || !V.dispensaciones || V.dispensaciones._promo) return;
    var orig = V.dispensaciones;
    V.dispensaciones = function (r) {
      var out = orig(r), k = '<button class="btn pri" data-act="dispensar" data-dni="">', i = out.indexOf(k);
      if (i < 0) return out;
      var j = out.indexOf('</button></div>', i);
      if (j < 0) return out;
      var activas = CM.promosLista().filter(function (p) { return p.activo && !p.archivada; }).length;
      return out.slice(0, i) + '<div class="row"><button class="btn" data-act="promos">Promociones' + (activas ? ' <span class="pill p-ok">' + activas + '</span>' : '') + '</button>' + out.slice(i, j) + '</button></div></div>' + out.slice(j + 15);
    };
    V.dispensaciones._promo = true;
  }
  engancharVista(); if (!v0) document.addEventListener('DOMContentLoaded', engancharVista);
})(window);
