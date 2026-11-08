/* Sistema VB ONG · Documentos del sistema anterior (AppSheet) → carpeta de cada legajo · 2026-11-08
   El permiso del sistema en Google es «drive.file»: sólo ve lo que crea él o lo que alguien ELIGE en el selector oficial
   de Google (Picker). Por eso los 124 documentos viejos no se pueden vincular solos.
   Flujo: un ADMINISTRADOR abre el selector con la MISMA cuenta de Google conectada, elige los archivos de la carpeta
   «Documentos_Files_» de AppSheet (se pueden elegir muchos de una vez), el equipo los empareja por nombre con los documentos
   «Sistema anterior · por vincular» de cada legajo y el servidor crea un ACCESO DIRECTO en la carpeta del legajo.
   El archivo original no se mueve ni se modifica (AppSheet sigue igual). El token del selector vive sólo en memoria
   y es de corta duración; los datos del selector (ID de cliente, clave de API restringida, N.º de proyecto) son públicos. */
(function (g) {
  'use strict';
  var CM = g.CM, esc = CM.esc, N = CM.nube;
  if (!N || !N.activa) return;
  var render = function () { if (CM.render) CM.render(); };
  var GSI = 'https://accounts.google.com/gsi/client', GAPI = 'https://apis.google.com/js/api.js';
  var ST = { busy: false, msg: '', bad: false };

  function cargar(src) {
    return new Promise(function (ok, mal) {
      if (document.querySelector('script[src="' + src + '"]')) { var t = 0, iv = setInterval(function () { if ((src === GSI ? g.google && g.google.accounts : g.gapi) || ++t > 100) { clearInterval(iv); ok(); } }, 100); return; }
      var s = document.createElement('script'); s.src = src; s.async = true; s.onload = function () { ok(); }; s.onerror = function () { mal(new Error('No se pudo cargar el selector de Google (revisá la conexión).')); };
      document.head.appendChild(s);
    });
  }
  function pendientes() { return (CM.db.legDocs || []).filter(function (d) { return d.estado === 'anterior' && d.legacyId && !d.driveFileId; }); }
  CM.anterioresPendientes = function () { return pendientes().length; };

  function abrirPicker(cfg) {
    return Promise.all([cargar(GSI), cargar(GAPI)]).then(function () {
      return new Promise(function (ok, mal) { g.gapi.load('picker', { callback: ok, onerror: function () { mal(new Error('No se pudo abrir el selector de Google.')); } }); });
    }).then(function () {
      return new Promise(function (ok, mal) {
        var tc = g.google.accounts.oauth2.initTokenClient({ client_id: cfg.clientId, scope: 'https://www.googleapis.com/auth/drive.file', hint: cfg.cuenta || undefined,
          callback: function (r) { if (r && r.access_token) ok(r.access_token); else mal(new Error('Google no dio el permiso.')); }, error_callback: function () { mal(new Error('Se cerró la ventana de Google.')); } });
        tc.requestAccessToken({ prompt: '' });
      });
    }).then(function (tok) {
      return new Promise(function (ok) {
        var P = g.google.picker;
        var vista = new P.DocsView(P.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(false).setMode(P.DocsViewMode.LIST);
        var pk = new P.PickerBuilder().setOAuthToken(tok).setDeveloperKey(cfg.apiKey).setAppId(cfg.appId).addView(vista)
          .enableFeature(P.Feature.MULTISELECT_ENABLED).setMaxItems(200).setLocale('es').setTitle('Elegí los documentos del sistema anterior')
          .setCallback(function (d) {
            if (d[P.Response.ACTION] === P.Action.PICKED) ok((d[P.Response.DOCUMENTS] || []).map(function (x) { return { id: x[P.Document.ID], name: x[P.Document.NAME] }; }));
            else if (d[P.Response.ACTION] === P.Action.CANCEL) ok([]);
          }).build();
        pk.setVisible(true);
      });
    });
  }
  /* empareja lo elegido con los documentos pendientes (mismo nombre de archivo) */
  CM.emparejarAnteriores = function (elegidos) {
    var porNombre = {}; pendientes().forEach(function (d) { (porNombre[d.legacyId] = porNombre[d.legacyId] || []).push(d); });
    var items = [], sobran = [];
    elegidos.forEach(function (f) {
      var ds = porNombre[f.name];
      if (!ds) { sobran.push(f.name); return; }
      ds.forEach(function (d) { var p = CM.paciente(d.dni); if (p && p.leg) items.push({ doc: d, fileId: f.id, nombre: f.name, legajo: p.leg, dni: (CM.docPac && CM.docPac(p) || {}).num || '' }); });
    });
    return { items: items, sobran: sobran };
  };
  function enviar(items) {
    var ok = 0, mal = [], i = 0;
    function paso() {
      var lote = items.slice(i, i + 20); i += 20;
      if (!lote.length) return Promise.resolve();
      return N._fn('drive-legajos', { accion: 'vincular', items: lote.map(function (x) { return { fileId: x.fileId, nombre: x.nombre, legajo: x.legajo, dni: x.dni }; }) }).then(function (r) {
        (r.items || []).forEach(function (y, k) {
          var x = lote[k]; if (!x || y.fileId !== x.fileId) return;
          if (y.ok) { x.doc.driveFileId = x.fileId; x.doc.url = /^https:\/\/drive\.google\.com\//.test(y.url || '') ? y.url : 'https://drive.google.com/file/d/' + x.fileId + '/view'; x.doc.estado = 'vinculado'; x.doc.vinc = { ts: new Date().toISOString(), user: CM.db.cfg.operador }; ok++; }
          else mal.push(x.nombre + ': ' + (y.error || 'error'));
        });
        CM.save(); ST.msg = 'Vinculando… ' + ok + ' de ' + items.length; render();
        return paso();
      });
    }
    return paso().then(function () { return { ok: ok, mal: mal }; });
  }
  CM.acts['anteriores-vincular'] = function () {
    if (!CM.need('pacientes', 'admin') || ST.busy) return;
    if (!pendientes().length) return CM.toast('No quedan documentos del sistema anterior por vincular.');
    ST.busy = true; ST.msg = 'Abriendo el selector de Google…'; ST.bad = false; render();
    N._fn('drive-legajos', { accion: 'picker' }).then(function (cfg) {
      return abrirPicker(cfg).then(function (el) {
        if (!el.length) { ST.msg = 'No elegiste archivos.'; return; }
        var m = CM.emparejarAnteriores(el);
        if (!m.items.length) { ST.msg = 'Ninguno de los ' + el.length + ' archivos elegidos coincide con un documento pendiente (se compara el nombre del archivo).'; ST.bad = true; return; }
        return enviar(m.items).then(function (r) {
          CM.audit('Drive: documentos del sistema anterior vinculados', r.ok + ' vinculados' + (r.mal.length ? ', ' + r.mal.length + ' con error' : '') + (m.sobran.length ? ', ' + m.sobran.length + ' elegidos sin coincidencia' : ''));
          CM.save();
          ST.msg = r.ok + ' documento(s) vinculado(s) a su legajo.' + (m.sobran.length ? ' ' + m.sobran.length + ' archivo(s) elegido(s) no coinciden con ningún documento pendiente.' : '') + (r.mal.length ? ' Con error: ' + r.mal.slice(0, 3).join(' · ') + (r.mal.length > 3 ? '…' : '') : '');
          ST.bad = !!r.mal.length;
        });
      });
    }).catch(function (e) { ST.msg = (e && e.message) || 'No se pudo completar.'; ST.bad = true; })
      .then(function () { ST.busy = false; render(); });
  };

  /* tarjeta en Pacientes, debajo de la de Google Drive */
  var dsh0 = CM.driveSrvHtml;
  CM.driveSrvHtml = function () {
    var h = dsh0 ? dsh0() : '', n = pendientes().length;
    if (!h || !CM.driveSrv || !CM.driveSrv.conectado || !CM.can('pacientes', 'admin') || (!n && !ST.msg)) return h;
    var card = '<section class="card" style="margin-bottom:14px"><div class="row sp"><h2 style="margin:0">Documentos del sistema anterior</h2><span class="pill ' + (n ? 'p-warn' : 'p-ok') + '">' + n + ' por vincular</span></div>' +
      '<p class="hint" style="margin:8px 0">Por seguridad, Google sólo deja que el sistema vea los archivos que elijas vos. Tocá el botón, entrá con <b>' + esc(CM.driveSrv.cuenta || 'la cuenta conectada') + '</b>, abrí la carpeta <b>Documentos_Files_</b> de AppSheet y elegí todos los archivos (podés marcar muchos a la vez). El sistema los empareja por nombre y crea un acceso directo en la carpeta de cada legajo. Los originales no se mueven.</p>' +
      (ST.msg ? '<div class="note ' + (ST.bad ? 'bad' : 'ok') + '" role="status">' + esc(ST.msg) + '</div>' : '') +
      (n ? '<button class="btn pri" data-act="anteriores-vincular"' + (ST.busy ? ' disabled' : '') + '>' + CM.icon('drive') + 'Elegir documentos en Google Drive</button>' : '') + '</section>';
    return h + card;
  };
})(window);
