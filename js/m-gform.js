/* Sistema VB ONG · Formularios de Google del sistema anterior → sistema · 2026-11-12
   Caso real: un paciente completó el «Formulario de Ingreso» de Google (el de la época de AppSheet, que sigue publicado en redes
   y en la web). Sus respuestas van a la planilla de Google de la ONG, que el sistema no leía: el paciente «no aparecía».
   Ahora el sistema LEE esa planilla (sólo lectura, nunca escribe en ella) y nadie queda afuera:
   · Un administrador la elige UNA vez con el selector de Google (con la cuenta de la ONG ya conectada).
   · Cada 10 minutos, mientras alguien del equipo con permiso sobre Pacientes tenga el sistema abierto (y al tocar
     «Traer respuestas ahora»), el servidor lee las hojas «Respuestas de formulario…» y el sistema:
       – Formulario de ingreso: si el documento no existe, crea el paciente con legajo único y lo deja como SOLICITUD pendiente
         de verificar (bandeja de Solicitudes + campana), igual que el formulario del menú. Si ya existe, no lo pisa: sólo completa
         datos vacíos (teléfono, correo, domicilio…) y lo deja anotado.
       – Formulario de seguimiento: lo agrega al seguimiento médico del paciente (si se lo encuentra por documento).
   · Es idempotente: cada respuesta tiene una clave (hoja + marca temporal + documento) y no se carga dos veces,
     aunque dos equipos lean al mismo tiempo (misma clave interna del paciente).
   · Sólo se leen respuestas desde la fecha elegida (por defecto, desde el 01/11/2026: lo anterior ya vino en la migración). */
(function (g) {
  'use strict';
  var CM = g.CM, esc = CM.esc, U = CM.U, fl = U.fl, N = CM.nube;
  var render = function () { if (CM.render) CM.render(); };
  var ST = CM.gform = { busy: false, msg: '', bad: false, ult: 0, sinFicha: [] };
  var DESDE_DEF = '2026-11-01', CADA = 10 * 60000;

  function cfg() { return (CM.db.ong && CM.db.ong.gform) || null; }
  function nube() { return !!(N && N.activa && N.ses && N.ses.me); }
  function puede() { return CM.can('pacientes', 'oper') && nube() && ['admin', 'supervisor', 'mostrador'].indexOf(N.ses.me.rol) >= 0; }
  function n(s) { return CM.norm(String(s || '')).replace(/\s+/g, ' ').trim(); }
  function limpio(s, k) { return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, k || 200); }
  function vacio(s) { return !s || /^[-–.]+$/.test(s) || /^(no|ninguna?|n\/a|na)$/i.test(s); }

  /* fechas como las devuelve Google («12/11/2026 14:54:56», «10/10/1997» o ISO) */
  function fecha(s) {
    s = String(s || '').trim(); var m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return m[1] + '-' + m[2] + '-' + m[3];
    if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s))) return m[3] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0');
    return '';
  }
  function tel10(s) { var d = CM.soloDigitos(s).replace(/^0+/, ''); if (/^549\d{10}$/.test(d)) d = d.slice(3); else if (/^54\d{10}$/.test(d)) d = d.slice(2); if (/^\d{10}$/.test(d)) return d; return ''; }
  function lista(s) { return String(s || '').split(/,\s*(?=[A-ZÁÉÍÓÚÑ¿])/).map(function (x) { return limpio(x, 120); }).filter(Boolean); }

  /* columnas por el texto del encabezado (los formularios se pueden reordenar sin romper nada) */
  function columnas(head, reglas) {
    var h = head.map(n), out = {};
    Object.keys(reglas).forEach(function (k) { for (var i = 0; i < h.length; i++) if (reglas[k].test(h[i]) && !Object.keys(out).some(function (o) { return out[o] === i; })) { out[k] = i; break; } });
    return out;
  }
  var R_ING = { ts: /^marca temporal/, nombre: /nombre y apellido|apellido y nombre|nombre completo/, nac: /nacimiento/, dni: /^dni|documento/, dir: /direccion|domicilio/, cp: /postal/, tel: /telefono|whatsapp|celular/,
    email: /e-?mail|correo/, obra: /obra social/, rep: /seguimiento.*reprocann|reprocann|cod\.? de seguimiento/, ocup: /labor|ocupacion|trabajo/, dudas: /dudas|consultas|comentarios/, motivo: /motivo/ };
  var R_SEG = { ts: /^marca temporal/, nombre: /nombre/, dni: /^dni|documento/, objetivos: /sintoma|patologia|objetivo/, vias: /vias de adm/, productos: /productos/, quim: /quimiotipo/, mejoras: /mejoras/,
    efectos: /efectos/, dejo: /dejo de realizar/, nueva: /mejoro o comenzo/, tipoAct: /que tipo de actividad/, habitos: /habitos/, comentario: /comentario/, genetica: /genetica/ };
  function tipoHoja(head) { var h = head.map(n).join('|'); if (/mejoras/.test(h) && /efectos/.test(h)) return 'seg'; if (/nacimiento/.test(h) && /(nombre y apellido|nombre completo|apellido y nombre)/.test(h)) return 'ing'; return ''; }
  function clave(hoja, ts, dni) { return 'GF-' + CM.sha256(hoja + '|' + ts + '|' + dni).slice(0, 20); }
  function hcDe(k) { return (CM.db.menu.hcs || []).filter(function (x) { return x.nonce === k; })[0]; }

  /* ---------- formulario de ingreso ---------- */
  function ingreso(titulo, filas, desde, res) {
    var c = columnas(filas[0] || [], R_ING); if (c.nombre == null || c.ts == null) return;
    filas.slice(1).forEach(function (f) {
      var v = function (k) { return c[k] == null ? '' : limpio(f[c[k]], 300); };
      var ts = v('ts'), dia = fecha(ts); if (!dia || dia < desde) return;
      var nombre = limpio(v('nombre'), 120), dniTxt = CM.soloDigitos(v('dni')), k = clave(titulo, ts, dniTxt);
      if (nombre.length < 3) return;
      if (hcDe(k)) return;                                             /* ya cargada (en este u otro equipo) */
      var vd = dniTxt ? CM.validarDoc('DNI', dniTxt) : { ok: false }, doc = vd.ok ? vd.doc : null;
      var ex = doc ? CM.resolverPac(doc.num) : null;
      var datos = { tel: tel10(v('tel')), email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v('email')) ? v('email').slice(0, 120) : '', nac: fecha(v('nac')), dir: v('dir').slice(0, 200), cp: CM.soloDigitos(v('cp')).slice(0, 8), obraSocial: vacio(v('obra')) ? '' : v('obra').slice(0, 80), ocupacion: v('ocup').slice(0, 80) };
      if (datos.nac && (datos.nac > CM.hoy() || datos.nac < '1900-01-01')) datos.nac = '';
      if (ex) {
        /* ya tiene ficha: no se pisa nada; sólo se completan los datos que estén vacíos */
        var comp = Object.keys(datos).filter(function (x) { return datos[x] && !ex[x]; });
        comp.forEach(function (x) { ex[x] = datos[x]; });
        CM.db.menu.hcs.push({ id: 'HC-' + k, ts: dia + 'T12:00:00', leg: ex.leg, pac: ex.dni, nombre: nombre, estado: 'existente', nonce: k, origen: 'Formulario de Google', completo: comp });
        CM.audit('Formulario de Google: ya tenía ficha', 'Legajo ' + ex.leg + (comp.length ? ' · se completaron: ' + comp.join(', ') : ' · sin cambios'));
        res.exist++; return;
      }
      var cod = v('rep'), rep = vacio(cod) ? { estado: 'sin', vence: null, carnet: false } : { estado: 'tramite', vence: null, carnet: false };
      var nk0 = CM.claveNueva; CM.claveNueva = function () { var x = '88' + String(parseInt(CM.sha256('k|' + k).slice(0, 12), 16) % 1e11).padStart(11, '0'); return CM.db.pacientes[x] ? nk0() : x; };
      var p;
      try {
        p = CM.nuevoPaciente({ nombre: nombre, tel: datos.tel, doc: doc, nac: datos.nac, email: datos.email, dir: datos.dir, cp: datos.cp, obraSocial: datos.obraSocial, ocupacion: datos.ocupacion,
          motivo: v('motivo').slice(0, 300), dudas: v('dudas').slice(0, 300), historiaCompleta: true, reprocann: rep, origen: 'Formulario de Google', revisar: true });
      } finally { CM.claveNueva = nk0; }
      if (!vacio(cod)) { p.codSeg = cod.slice(0, 40); p.repDeclarado = 'código de seguimiento ' + cod.slice(0, 40) + ' (a verificar)'; }
      if (dniTxt && !doc) p.docDeclarado = dniTxt.slice(0, 15);
      CM.db.menu.hcs.push({ id: 'HC-' + k, ts: dia + 'T12:00:00', leg: p.leg, pac: p.dni, nombre: nombre, estado: 'pendiente', dup: p.posibleDup || '', nonce: k, origen: 'Formulario de Google' });
      CM.audit('Solicitud de historia clínica (Formulario de Google)', 'Legajo ' + p.leg + ' · pendiente de verificación' + (doc ? '' : ' · documento a revisar'));
      res.nuevos.push(p.leg);
    });
  }
  /* ---------- formulario de seguimiento ---------- */
  function seguimiento(titulo, filas, desde, res) {
    var c = columnas(filas[0] || [], R_SEG); if (c.dni == null || c.ts == null) return;
    filas.slice(1).forEach(function (f) {
      var v = function (k) { return c[k] == null ? '' : limpio(f[c[k]], 600); };
      var ts = v('ts'), dia = fecha(ts); if (!dia || dia < desde) return;
      var dni = CM.soloDigitos(v('dni')), k = clave(titulo, ts, dni), id = 'S-' + k;
      if ((CM.db.seg || []).some(function (s) { return s.id === id; })) return;
      var p = dni.length >= 6 ? CM.resolverPac(dni) : null;
      if (!p) { res.sinFicha.push({ dia: dia, nombre: limpio(v('nombre'), 60), dni: dni }); return; }
      CM.db.seg.push({ id: id, dni: p.dni, fecha: dia, objetivos: lista(v('objetivos')), otro: '', vias: lista(v('vias')), productos: lista(v('productos')), genetica: limpio(v('genetica'), 80), quim: lista(v('quim')),
        mejoras: lista(v('mejoras')), efectos: lista(v('efectos')), dejo: limpio(v('dejo'), 120), nueva: limpio(v('nueva'), 200), tipoAct: limpio(v('tipoAct'), 200), habitos: lista(v('habitos')), comentario: limpio(v('comentario'), 600), origen: 'Formulario de Google' });
      CM.audit('Seguimiento médico (Formulario de Google)', 'Legajo ' + p.leg + ' · ' + dia);
      res.seg++;
    });
  }
  /* procesa la respuesta del servidor (exportado para las pruebas) */
  CM.gformProcesar = function (r, desde) {
    var res = { nuevos: [], exist: 0, seg: 0, sinFicha: [] };
    (r.hojas || []).forEach(function (h) {
      var filas = h.filas || [], t = tipoHoja(filas[0] || []);
      if (t === 'ing') ingreso(h.titulo, filas, desde, res); else if (t === 'seg') seguimiento(h.titulo, filas, desde, res);
    });
    return res;
  };

  /* ---------- lectura (servidor) ---------- */
  CM.gformLeer = function (manual) {
    var c = cfg(); if (!c || !c.archivo || !puede() || ST.busy) return Promise.resolve(null);
    ST.busy = true; if (manual) { ST.msg = 'Leyendo los formularios…'; ST.bad = false; render(); }
    return N._fn('drive-legajos', { accion: 'formularios', archivo: c.archivo }).then(function (r) {
      var res = CM.gformProcesar(r, c.desde || DESDE_DEF);
      ST.ult = Date.now(); ST.sinFicha = res.sinFicha; ST.bad = false;
      ST.msg = (res.nuevos.length ? res.nuevos.length + ' paciente(s) nuevo(s) desde el formulario (legajos ' + res.nuevos.join(', ') + '), pendientes de verificar. ' : '') +
        (res.exist ? res.exist + ' respuesta(s) de personas que ya tenían ficha (no se pisó nada). ' : '') + (res.seg ? res.seg + ' seguimiento(s) médico(s) agregado(s). ' : '') +
        (!res.nuevos.length && !res.exist && !res.seg ? 'Sin respuestas nuevas.' : '');
      if (res.nuevos.length || res.exist || res.seg) { CM.save(); if (!manual && res.nuevos.length) CM.toast(res.nuevos.length + ' solicitud(es) nueva(s) desde el Formulario de Google.'); }
      return res;
    }, function (e) { ST.bad = true; ST.msg = (e && e.message) || 'No se pudieron leer los formularios.'; return null; }).then(function (x) { ST.busy = false; render(); return x; });
  };
  CM.acts['gf-leer'] = function () { CM.gformLeer(true); };
  CM.acts['gf-elegir'] = function () {
    if (!CM.need('pacientes', 'admin') || ST.busy) return;
    if (!CM.pickerElegir) return CM.toast('El selector de Google no está disponible.', true);
    ST.busy = true; ST.msg = 'Abriendo el selector de Google…'; ST.bad = false; render();
    CM.pickerElegir({ hojas: true, uno: true, titulo: 'Elegí la planilla de RESPUESTAS de los Formularios de Google' }).then(function (el) {
      ST.busy = false;
      if (!el || !el.length) { ST.msg = 'No elegiste ninguna planilla.'; render(); return; }
      var ant = cfg() || {};
      CM.db.ong.gform = { archivo: el[0].id, nombre: limpio(el[0].name, 120), desde: ant.desde || DESDE_DEF, ts: new Date().toISOString(), user: CM.db.cfg.operador };
      CM.audit('Formularios de Google vinculados', 'Planilla «' + CM.db.ong.gform.nombre + '» · se leen respuestas desde ' + CM.fmtFecha(CM.db.ong.gform.desde));
      CM.save(); return CM.gformLeer(true);
    }).catch(function (e) { ST.busy = false; ST.bad = true; ST.msg = (e && e.message) || 'No se pudo abrir el selector.'; render(); });
  };
  CM.acts['gf-desde'] = function () {
    if (!CM.need('pacientes', 'admin')) return; var c = cfg(); if (!c) return;
    CM.modal.open({ title: 'Leer respuestas desde', body: '<form id="fGFD" data-form="gf-desde" class="f" novalidate>' + fl('Fecha desde la que se cargan las respuestas', '<input class="in" type="date" name="d" value="' + esc(c.desde || DESDE_DEF) + '" max="' + CM.hoy() + '">') +
      '<p class="hint" style="margin:0">Las respuestas anteriores ya vinieron con la migración del sistema anterior. Las ya cargadas no se repiten.</p><p class="err" role="alert" data-err></p></form>',
      footer: '<button class="btn" type="button" data-act="modal-close">Cancelar</button><button class="btn pri" type="submit" form="fGFD">Guardar</button>' });
  };
  CM.forms['gf-desde'] = function (f) {
    var v = f.elements.d.value; if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || v > CM.hoy()) return U.fail(f, 'd', 'Fecha inválida.');
    cfg().desde = v; CM.audit('Formularios de Google', 'Se leen respuestas desde ' + CM.fmtFecha(v)); CM.save(); CM.modal.close(true); CM.gformLeer(true);
  };
  CM.acts['gf-quitar'] = function () {
    if (!CM.need('pacientes', 'admin')) return; delete CM.db.ong.gform; CM.audit('Formularios de Google', 'Planilla desvinculada (lo ya cargado queda)'); CM.save(); render();
  };

  /* ---------- tarjeta en Solicitudes ---------- */
  function tarjeta() {
    if (!nube() || !CM.can('pacientes', 'oper')) return '';
    var c = cfg(), adm = CM.can('pacientes', 'admin'), con = CM.driveSrv && CM.driveSrv.conectado;
    return '<section class="card" style="margin-bottom:14px"><div class="row sp"><h2 style="margin:0">Formularios de Google</h2>' + (c ? '<span class="pill p-ok">Se leen solos cada 10 min</span>' : '<span class="pill p-warn">Sin vincular</span>') + '</div>' +
      '<p class="hint" style="margin:8px 0">El «Formulario de Ingreso» y el «Formulario de Seguimiento» de Google (los del sistema anterior) siguen recibiendo respuestas. ' +
      (c ? 'El sistema lee la planilla <b>' + esc(c.nombre) + '</b> desde el ' + esc(CM.fmtFecha(c.desde || DESDE_DEF)) + ': cada persona nueva aparece acá como solicitud pendiente de verificar y los seguimientos van a la ficha.' : 'Para que nadie quede afuera, un administrador elige una vez la planilla de respuestas («CANNABISMATICA», hojas «Respuestas de formulario 1 y 2»).') + '</p>' +
      (ST.msg ? '<div class="note ' + (ST.bad ? 'bad' : 'ok') + '" role="status">' + esc(ST.msg) + (ST.ult ? ' <small>(' + new Date(ST.ult).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) + ')</small>' : '') + '</div>' : '') +
      (ST.sinFicha.length ? '<div class="note warn">Seguimientos de personas sin ficha en el sistema (revisá el documento): ' + ST.sinFicha.map(function (x) { return esc(x.nombre || 'sin nombre') + ' · DNI ' + esc(x.dni || '—') + ' · ' + esc(CM.fmtFecha(x.dia)); }).join('; ') + '</div>' : '') +
      '<div class="row">' + (c ? '<button class="btn pri" data-act="gf-leer"' + (ST.busy ? ' disabled' : '') + '>' + CM.icon('undo') + 'Traer respuestas ahora</button>' : '') +
      (adm ? (con ? '<button class="btn' + (c ? '' : ' pri') + '" data-act="gf-elegir"' + (ST.busy ? ' disabled' : '') + '>' + CM.icon('drive') + (c ? 'Cambiar planilla' : 'Elegir la planilla de respuestas') + '</button>' : '<span class="hint">Primero hay que conectar el Google Drive de la ONG (Pacientes → Google Drive).</span>') +
        (c ? '<button class="btn" data-act="gf-desde">Desde ' + esc(CM.fmtFecha(c.desde || DESDE_DEF)) + '</button><button class="btn" data-act="gf-quitar">Desvincular</button>' : '') : '') + '</div></section>';
  }
  var vSol = CM.VIEWS.solicitudes;
  CM.VIEWS.solicitudes = function () { var h = vSol.apply(this, arguments), i = h.indexOf('<div class="note info">Cada solicitud'); return i > 0 ? h.slice(0, i) + tarjeta() + h.slice(i) : h + tarjeta(); };

  /* ---------- automático ---------- */
  var ultAuto = 0;
  function auto() { if (Date.now() - ultAuto < CADA || !cfg() || !puede()) return; ultAuto = Date.now(); CM.gformLeer(false); }
  g.setInterval(function () { try { auto(); } catch (e) { /* nada */ } }, 60000);
  CM.afterRender = (function (prev) { return function (r) { if (prev) prev(r); g.setTimeout(function () { try { auto(); } catch (e) { /* nada */ } }, 4000); }; })(CM.afterRender);
})(window);
