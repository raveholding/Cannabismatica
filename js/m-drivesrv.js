/* Sistema VB ONG · Google Drive de la ONG por SERVIDOR (Gmail común) · 2026-11-01
   - Un administrador conecta el Drive de la ONG UNA sola vez («Conectar Google Drive de la ONG»).
     Desde ese momento cualquier equipo, con cualquier rol, crea carpetas y sube documentos sin conectar nada.
   - El permiso de Google lo guarda el servidor (bóveda de Supabase); este equipo nunca ve tokens.
   - Carpetas: «Legajos · <ONG>» en el Drive de la ONG y adentro una por legajo ({legajo}_{DNI} o _SD).
     La ONG puede mover la carpeta «Legajos · …» a donde quiera dentro de su Drive: el sistema la sigue encontrando.
   - Sin nube (modo local) este módulo no hace nada y queda la conexión manual de siempre. */
(function (g) {
  'use strict';
  var CM = g.CM, esc = CM.esc, N = CM.nube;
  if (!N || !N.activa) return;
  var render = function () { if (CM.render) CM.render(); };
  var S = CM.driveSrv = { cargado: false, configurado: false, conectado: false, cuenta: '', raiz: '', ts: 0, busy: false, msg: '', bad: false };

  CM.nubeFn = function (fn, body) { return N._fn(fn, body); };
  function haySesion() { return !!(N.ses && N.ses.at && N.ses.me); }

  /* ---------- estado ---------- */
  CM.driveSrvEstado = function (forzar) {
    if (!haySesion()) return Promise.resolve(S);
    if (!forzar && S.cargado && Date.now() - S.ts < 5 * 60000) return Promise.resolve(S);
    return N._fn('drive-legajos', { accion: 'estado' }).then(function (r) {
      var antes = S.conectado;
      S.cargado = true; S.ts = Date.now(); S.configurado = !!r.configurado; S.conectado = !!r.conectado; S.cuenta = r.cuenta || ''; S.raiz = /^https:\/\/drive\.google\.com\//.test(r.raiz || '') ? r.raiz : '';
      if (antes !== S.conectado) render();
      return S;
    }, function () { S.fallo = Date.now(); return S; });   // falla momentánea (red o arranque de la función): se reintenta en segundos, sin mostrar «pendiente de configuración»
  };
  /* apenas alguien ingresa, se consulta el Drive de la ONG (antes recién al minuto y mientras tanto aparecía el aviso del Client ID) */
  var login0 = N.login;
  if (login0) N.login = function () { return login0.apply(N, arguments).then(function (r) { CM.driveSrvEstado(true).then(render); return r; }); };

  /* ---------- modo: servidor cuando el Drive de la ONG está conectado ---------- */
  var modo0 = CM.driveModo;
  CM.driveModo = function () {
    if (S.conectado) return 'servidor';
    if (haySesion() && !S.cargado) return 'verificando';
    var m = modo0 ? modo0() : 'pendiente';
    return m === 'servidor' ? 'pendiente' : m;
  };

  /* ---------- carpetas automáticas ---------- */
  function sinCarpeta(p) { return p && p.leg && !p.driveId && !(p.drive1 && p.drive1 !== 'https://drive.google.com/drive/my-drive'); }
  function pendientes() { return Object.keys(CM.db.pacientes || {}).map(function (k) { return CM.db.pacientes[k]; }).filter(sinCarpeta); }
  CM.driveSrvCarpeta = function (p) {
    var doc = CM.docPac ? CM.docPac(p) : null;
    return N._fn('drive-legajos', { accion: 'carpeta', legajo: p.leg, dni: doc && doc.num || '' }).then(function (r) {
      if (!r || !r.ok || !/^[A-Za-z0-9_-]{10,120}$/.test(r.carpeta || '')) throw new Error('El servidor no confirmó la carpeta.');
      p.driveId = r.carpeta;
      if (!p.drive1 || p.drive1 === 'https://drive.google.com/drive/my-drive') p.drive1 = /^https:\/\/drive\.google\.com\//.test(r.url || '') ? r.url : 'https://drive.google.com/drive/folders/' + r.carpeta;
      if (r.creada) CM.audit('Drive: carpeta de legajo creada', 'Legajo ' + p.leg);
      CM.save();
      return r;
    });
  };
  function lote(max) {
    var l = pendientes().slice(0, max || 10), ok = 0, mal = 0, ult = '';
    if (!l.length || S.busy) return Promise.resolve({ ok: 0, mal: 0, ult: '' });
    S.busy = true;
    return l.reduce(function (pr, p) {
      return pr.then(function () { return CM.driveSrvCarpeta(p).then(function () { ok++; }, function (e) { mal++; ult = e.message || ''; if (e && (e.codigo === 'reconectar' || e.codigo === 'sin_conectar')) { S.conectado = false; throw e; } }); });
    }, Promise.resolve()).catch(function () { /* se cortó: falta reconectar */ }).then(function () { S.busy = false; return { ok: ok, mal: mal, ult: ult }; });
  }
  setInterval(function () {
    if (!haySesion()) return;
    CM.driveSrvEstado(false).then(function () { if (S.conectado && CM.can('pacientes', 'oper') && pendientes().length) lote(10).then(function (r) { if (r.ok) render(); }); });
  }, 60000);
  setInterval(function () { if (haySesion() && !S.cargado) CM.driveSrvEstado(true).then(function () { if (S.cargado) render(); }); }, 10000);
  setTimeout(function () { CM.driveSrvEstado(true).then(render); }, 1500);

  /* en modo servidor, «pendiente» del legajo = sin carpeta (la hoja de Google es del modo manual) */
  var pend0 = CM.legajoPend;
  CM.legajoPend = function () { return S.conectado ? pendientes() : (pend0 ? pend0() : []); };
  var lote0 = CM.acts['legajo-lote'];
  CM.acts['legajo-lote'] = function (t) {
    if (!CM.need('pacientes', 'oper')) return;
    if (S.conectado) return loteSrv();
    /* antes de decidir, se pregunta al servidor: puede que el Drive de la ONG ya esté conectado */
    CM.toast('Verificando el Drive de la ONG…');
    CM.driveSrvEstado(true).then(function () {
      if (S.conectado) return loteSrv();
      if (CM.db.ong && CM.db.ong.driveClientId && lote0) return lote0(t);   // conexión manual por navegador (si la ONG la configuró)
      render();
      CM.toast(!S.cargado ? 'No pudimos consultar el Drive de la ONG. Probá de nuevo en unos segundos.' : S.configurado ? 'El Drive de la ONG no está conectado: un administrador tiene que tocar «Conectar Google Drive de la ONG».' : 'Falta terminar la configuración de Google en el servidor.', true);
    });
  };
  function loteSrv() {
    var n = pendientes().length; S.msg = 'Creando ' + n + ' carpeta(s)…'; S.bad = false; render();
    lote(200).then(function (r) { S.msg = r.ok + ' carpeta(s) creada(s).' + (r.mal ? ' ' + r.mal + ' con error: ' + r.ult : ''); S.bad = r.mal > 0; render(); });
  }
  CM.acts['drive-crear-srv'] = function (t) {
    var p = CM.paciente(t.getAttribute('data-dni')); if (!p || !CM.need('pacientes', 'oper')) return;
    CM.toast('Creando la carpeta del legajo…');
    CM.driveSrvCarpeta(p).then(function () { render(); CM.toast('Carpeta creada en el Drive de la ONG.'); }, function (e) { CM.toast(e.message || 'No se pudo crear la carpeta.', true); });
  };

  /* ---------- conectar / desconectar (sólo administrador) ---------- */
  CM.acts['drive-srv-conectar'] = function () {
    if (!CM.need('pacientes', 'admin')) return;
    N._fn('drive-legajos', { accion: 'conectar' }).then(function (r) {
      if (r && r.sim && N.sim) return N.sim.conectar();    // ejemplo sin Google real (js/m-drivesim.js)
      if (!r || !/^https:\/\/accounts\.google\.com\//.test(r.url || '')) throw new Error('Respuesta inesperada.');
      CM.audit('Drive: conexión iniciada', 'Se abrió la autorización de Google');
      g.location.href = r.url;
    }).catch(function (e) { CM.toast(e.message || 'No se pudo iniciar la conexión.', true); });
  };
  CM.acts['drive-srv-desconectar'] = function () {
    if (!CM.need('pacientes', 'admin')) return;
    CM.modal.open({ title: 'Desconectar Google Drive', body: '<p>Los equipos dejan de crear carpetas y subir documentos hasta que un administrador vuelva a conectar. Las carpetas y archivos que ya están en Drive <b>no se borran</b>.</p>',
      footer: '<button class="btn" type="button" data-act="modal-close">Cancelar</button><button class="btn bad" data-act="drive-srv-desconectar2">Desconectar</button>' });
  };
  CM.acts['drive-srv-desconectar2'] = function () {
    CM.modal.close(true);
    N._fn('drive-legajos', { accion: 'desconectar' }).then(function () { S.conectado = false; S.cuenta = ''; render(); CM.toast('Google Drive desconectado.'); }, function (e) { CM.toast(e.message || 'No se pudo desconectar.', true); });
  };

  /* tarjeta en Pacientes (debajo del resumen de legajos) */
  /* carpeta principal de la ONG en Drive (la de AppSheet: data › Cannabismatica). Se puede cambiar en la tarjeta (administración). */
  var PRINCIPAL_DEF = 'https://drive.google.com/drive/folders/1kWh3o1lPdFarEbX9VUDNcox6zMjjbVIj';
  CM.drivePrincipal = function () {
    var u = CM.db && CM.db.ong && CM.db.ong.drivePrincipal;
    return u && /^https:\/\/drive\.google\.com\//.test(u) ? u : PRINCIPAL_DEF;
  };
  CM.acts['drive-principal-editar'] = function () {
    if (!CM.need('pacientes', 'admin')) return;
    CM.modal.open({ title: 'Carpeta principal de la ONG', body: '<form id="fDP" data-form="drive-principal" class="f" novalidate>' + CM.U.fl('Enlace de la carpeta principal en Google Drive', '<input class="in" name="url" inputmode="url" value="' + esc(CM.drivePrincipal()) + '">') + '<p class="hint">Es la carpeta que abre el botón «Abrir Drive de la ONG». Copiá el enlace desde Drive (Compartir › Copiar enlace).</p><p class="err" role="alert" data-err></p></form>',
      footer: '<button class="btn" type="button" data-act="modal-close">Cancelar</button><button class="btn pri" type="submit" form="fDP">Guardar</button>' });
  };
  CM.forms['drive-principal'] = function (f) {
    var u = f.elements.url.value.trim();
    if (!/^https:\/\/drive\.google\.com\/(drive\/(u\/\d+\/)?folders\/|drive\/my-drive)/.test(u)) return CM.U.fail(f, 'url', 'Pegá el enlace de una carpeta de Google Drive (https://drive.google.com/drive/folders/…).');
    CM.db.ong.drivePrincipal = u.split('?')[0]; CM.audit('Carpeta principal de Drive', u.split('?')[0]); CM.save(); CM.modal.close(true); render(); CM.toast('Carpeta principal guardada.');
    return false;
  };
  CM.driveSrvHtml = function () {
    if (!haySesion()) return '';
    var admin = CM.can('pacientes', 'admin');
    if (!S.cargado) return '<section class="card" style="margin-bottom:14px"><div class="row sp"><h2 style="margin:0">Google Drive de la ONG</h2><span class="pill p-info">Verificando…</span></div></section>';
    var h = '<section class="card" style="margin-bottom:14px"><div class="row sp"><h2 style="margin:0">Google Drive de la ONG</h2>' +
      (S.conectado ? '<span class="pill p-ok">Conectado' + (S.cuenta ? ' · ' + esc(S.cuenta) : '') + '</span>' : S.configurado ? '<span class="pill p-warn">Sin conectar</span>' : '<span class="pill p-warn">Pendiente de configuración</span>') + '</div>' +
      (N.sim ? '<div class="note warn" role="note" style="margin-top:8px"><b>Ejemplo, sin Google real:</b> así se ve en el sistema con nube. Las carpetas y los archivos son de ejemplo y sus enlaces no abren nada.</div>' : '');
    if (S.conectado) {
      h += '<p class="hint" style="margin:8px 0">Las carpetas de los legajos y los documentos se guardan solos desde cualquier equipo. Nadie tiene que conectar nada.</p>' +
        (S.msg ? '<div class="note ' + (S.bad ? 'bad' : 'ok') + '" role="status">' + esc(S.msg) + '</div>' : '') +
        '<div class="row"><a class="btn pri" href="' + esc(CM.drivePrincipal()) + '" target="_blank" rel="noopener noreferrer">' + CM.icon('link') + 'Abrir Drive de la ONG</a>' +
        (S.raiz ? '<a class="btn" href="' + esc(S.raiz) + '" target="_blank" rel="noopener noreferrer">' + CM.icon('link') + 'Carpeta de legajos</a>' : '') +
        (admin ? '<button class="btn sm" data-act="drive-principal-editar">Cambiar carpeta principal</button><button class="btn sm" data-act="drive-srv-desconectar">Desconectar</button>' : '') + '</div>' +
        (admin && S.raiz ? '<p class="hint" style="margin:8px 0 0">Para que los legajos queden dentro de la carpeta principal, en Drive arrastrá una sola vez la carpeta «Legajos · …» adentro de «Cannabismatica». El sistema la sigue usando igual.</p>' : '');
    } else if (!S.configurado) {
      h += '<p class="hint" style="margin:8px 0">Falta terminar la configuración de Google en el servidor (credenciales de la ONG). Mientras tanto los documentos quedan guardados en cada equipo como «pendientes de subir».</p>';
    } else {
      h += '<p class="hint" style="margin:8px 0">' + (admin ? 'Conectalo <b>una sola vez</b> con la cuenta de Google de la ONG: desde ese momento todos los equipos guardan carpetas y documentos solos.' : 'Un administrador tiene que conectar el Drive de la ONG una sola vez. Mientras tanto los documentos quedan guardados en este equipo como «pendientes de subir».') + '</p>' +
        (admin ? '<button class="btn pri" data-act="drive-srv-conectar">' + CM.icon('drive') + 'Conectar Google Drive de la ONG</button>' : '');
    }
    return h + '</section>';
  };
  var banner0 = CM.legajoBanner;
  CM.legajoBanner = function () { return CM.driveSrvHtml() + (banner0 ? banner0() : ''); };

  /* ---------- vuelta desde Google ---------- */
  (function () {
    var m = /[?&]drive=([a-z_]+)/.exec(g.location.search || ''); if (!m) return;
    var txt = { ok: 'Google Drive de la ONG conectado. Desde ahora las carpetas y documentos se guardan solos.', cancelado: 'Se canceló la conexión con Google.', vencido: 'La conexión tardó demasiado: probá de nuevo.',
      sin_permiso_offline: 'Google no entregó el permiso permanente. Probá de nuevo y aceptá todos los permisos.', sin_drive: 'No se aceptó el permiso de Drive. Probá de nuevo y tildá el acceso a Drive.', error: 'No se pudo completar la conexión con Google.' }[m[1]] || 'Conexión con Google terminada.';
    try { g.history.replaceState(null, '', g.location.pathname + (g.location.hash || '#/pacientes')); } catch (e) { /* nada */ }
    setTimeout(function () { CM.toast(txt, m[1] !== 'ok'); CM.driveSrvEstado(true).then(render); }, 1500);
  })();

  /* =================================================================
     Planilla de cultivo por el servidor: con la nube activa se guarda en el mismo Drive de la ONG
     (carpeta «Planillas de cultivo · ONG»), sin Client ID ni conexión en cada equipo.
     ================================================================= */
  var gc0 = CM.driveGuardarCiclo, dh0 = CM.driveHtml, dg0 = CM.acts['drv-guardar'];
  var ec = { msg: '', bad: false, busy: false };
  function modoSrv() { return !!(N && N.activa && haySesion()); }
  function b64utf8(t) { var b = new TextEncoder().encode(t), s = '', i, k = 0x8000; for (i = 0; i < b.length; i += k) s += String.fromCharCode.apply(null, b.subarray(i, i + k)); return g.btoa(s); }
  CM.driveGuardarCiclo = function (c) {
    if (!modoSrv()) return gc0 ? gc0(c) : Promise.reject(new Error('Drive no disponible.'));
    var texto = CM.cultivoCsv(c), hash = CM.sha256(texto), huella = hash.slice(0, 12), drv = c.drive = c.drive || { versiones: [] };
    var ya = drv.versiones.filter(function (v) { return v.huella === huella; })[0];
    if (ya) return Promise.resolve({ repetido: true, nombre: ya.nombre });
    var ver = drv.versiones.length + 1, nombre = CM.cultivoNombreBase(c) + '_' + CM.hoy().replace(/-/g, '') + '_v' + ver + '_' + huella + '.csv';
    return N._fn('drive-legajos', { accion: 'planilla', ciclo: c.id, cicloNombre: c.nombre, nombre: nombre, version: ver, hash: hash, b64: b64utf8(texto) }).then(function (r) {
      if (!r || !r.ok || !r.archivo) throw new Error((r && r.error) || 'No se pudo guardar en Drive.');
      if (r.repetido) return { repetido: true, nombre: r.archivo.nombre };
      drv.versiones.push({ ver: ver, nombre: r.archivo.nombre, id: r.archivo.id, huella: huella, ts: new Date().toISOString(), user: CM.db.cfg.operador, link: r.archivo.webViewLink || '' });
      drv.carpetaId = r.carpeta; drv.carpetaUrl = r.carpetaUrl || '';
      CM.audit('Drive: planilla guardada', c.id + ' · ' + r.archivo.nombre); CM.save();
      return { nuevo: true, nombre: r.archivo.nombre };
    }, function (e) {
      if (e && e.status === 400 && /desconocida/i.test(e.message || '')) throw new Error('Falta actualizar la función del servidor «drive-legajos» (guardado de planillas). Avisale al desarrollador.');
      throw e;
    });
  };
  CM.driveHtml = function (c) {
    if (!modoSrv()) return dh0 ? dh0(c) : '';
    var drv = c.drive || { versiones: [] }, oper = CM.can('cultivo', 'oper');
    var estado = !S.cargado ? '<span class="pill p-info">Verificando…</span>' : S.conectado ? '<span class="pill p-ok">Conectado' + (S.cuenta ? ' · ' + esc(S.cuenta) : '') + '</span>' : '<span class="pill p-warn">Sin conectar</span>';
    var vs = drv.versiones.length ? '<div class="tw" style="margin-top:8px"><table><thead><tr><th>Versión</th><th>Archivo en Drive (nombre único)</th><th>Guardado</th><th>Por</th></tr></thead><tbody>' + drv.versiones.slice().reverse().map(function (v) {
      return '<tr><td>v' + v.ver + '</td><td>' + (v.link && /^https:\/\//.test(v.link) ? '<a href="' + esc(v.link) + '" target="_blank" rel="noopener noreferrer">' + esc(v.nombre) + '</a>' : esc(v.nombre)) + '</td><td>' + esc(CM.fmtFecha(v.ts.slice(0, 10))) + '</td><td>' + esc(v.user) + '</td></tr>';
    }).join('') + '</tbody></table></div>' : '';
    return '<div class="card flat" style="margin-top:14px"><div class="row sp"><h3 style="margin:0">' + CM.icon('drive') + ' Google Drive de la ONG</h3>' + estado + '</div>' +
      '<p class="hint" style="margin:6px 0">Guarda una copia de la planilla en el Drive de la ONG (carpeta «Planillas de cultivo»). Cada guardado crea un <b>archivo nuevo con nombre único</b> (ciclo + fecha + versión + huella): nunca pisa ni duplica. Nadie tiene que conectar nada en este equipo.</p>' +
      (S.cargado && !S.conectado ? '<div class="note warn">El Drive de la ONG no está conectado: un administrador tiene que tocar «Conectar Google Drive de la ONG» en Pacientes.</div>' : '') +
      (ec.msg ? '<div class="note ' + (ec.bad ? 'bad' : 'ok') + '" role="status">' + esc(ec.msg) + '</div>' : '') +
      '<div class="row">' + (oper ? '<button class="btn pri" data-act="drv-guardar" data-id="' + esc(c.id) + '"' + (ec.busy || !S.conectado ? ' disabled' : '') + '>' + CM.icon('up') + 'Guardar en Drive</button>' : '') +
      (drv.carpetaUrl ? '<a class="btn" href="' + esc(drv.carpetaUrl) + '" target="_blank" rel="noopener noreferrer">' + CM.icon('link') + 'Abrir carpeta del ciclo</a>' : '') +
      '<a class="btn" href="' + esc(CM.drivePrincipal()) + '" target="_blank" rel="noopener noreferrer">' + CM.icon('link') + 'Abrir Drive de la ONG</a></div>' + vs + '</div>';
  };
  CM.acts['drv-guardar'] = function (t) {
    if (!modoSrv()) return dg0 && dg0(t);
    var c = CM.cultivo(t.getAttribute('data-id')); if (!c || !CM.need('cultivo', 'oper') || ec.busy) return;
    ec = { msg: 'Guardando en Drive…', bad: false, busy: true }; render();
    CM.driveGuardarCiclo(c).then(function (r) {
      ec = { msg: r.repetido ? 'Esta versión ya estaba guardada en Drive (' + r.nombre + '). No se duplicó nada.' : 'Guardado en Drive como ' + r.nombre + '.', bad: false, busy: false };
    }).catch(function (e) { ec = { msg: (e && e.message) || 'No se pudo guardar en Drive.', bad: true, busy: false }; }).then(function () { render(); });
  };
})(window);
