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
    }, function () { S.cargado = true; S.ts = Date.now(); return S; });   // función no disponible: queda «pendiente», la nube sigue bien
  };

  /* ---------- modo: servidor cuando el Drive de la ONG está conectado ---------- */
  var modo0 = CM.driveModo;
  CM.driveModo = function () {
    if (S.conectado) return 'servidor';
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
  setTimeout(function () { CM.driveSrvEstado(true); }, 4000);

  /* en modo servidor, «pendiente» del legajo = sin carpeta (la hoja de Google es del modo manual) */
  var pend0 = CM.legajoPend;
  CM.legajoPend = function () { return S.conectado ? pendientes() : (pend0 ? pend0() : []); };
  var lote0 = CM.acts['legajo-lote'];
  CM.acts['legajo-lote'] = function (t) {
    if (!S.conectado) return lote0 && lote0(t);
    if (!CM.need('pacientes', 'oper')) return;
    var n = pendientes().length; S.msg = 'Creando ' + n + ' carpeta(s)…'; S.bad = false; render();
    lote(200).then(function (r) { S.msg = r.ok + ' carpeta(s) creada(s).' + (r.mal ? ' ' + r.mal + ' con error: ' + r.ult : ''); S.bad = r.mal > 0; render(); });
  };
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
  CM.driveSrvHtml = function () {
    if (!haySesion()) return '';
    var admin = CM.can('pacientes', 'admin');
    if (!S.cargado) return '';
    var h = '<section class="card" style="margin-bottom:14px"><div class="row sp"><h2 style="margin:0">Google Drive de la ONG</h2>' +
      (S.conectado ? '<span class="pill p-ok">Conectado' + (S.cuenta ? ' · ' + esc(S.cuenta) : '') + '</span>' : S.configurado ? '<span class="pill p-warn">Sin conectar</span>' : '<span class="pill p-warn">Pendiente de configuración</span>') + '</div>' +
      (N.sim ? '<div class="note warn" role="note" style="margin-top:8px"><b>Ejemplo, sin Google real:</b> así se ve en el sistema con nube. Las carpetas y los archivos son de ejemplo y sus enlaces no abren nada.</div>' : '');
    if (S.conectado) {
      h += '<p class="hint" style="margin:8px 0">Las carpetas de los legajos y los documentos se guardan solos desde cualquier equipo. Nadie tiene que conectar nada.</p>' +
        (S.msg ? '<div class="note ' + (S.bad ? 'bad' : 'ok') + '" role="status">' + esc(S.msg) + '</div>' : '') +
        '<div class="row">' + (S.raiz ? '<a class="btn" href="' + esc(S.raiz) + '" target="_blank" rel="noopener noreferrer">' + CM.icon('link') + 'Abrir la carpeta de legajos</a>' : '') +
        (admin ? '<button class="btn sm" data-act="drive-srv-desconectar">Desconectar</button>' : '') + '</div>';
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
})(window);
