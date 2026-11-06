/* Sistema VB ONG · Migración desde AppSheet (uso único, sólo administración)
   Toma el paquete revisado (vbong-migracion-appsheet, armado fuera del sistema desde la planilla original de AppSheet)
   y lo incorpora a la base: pacientes, lotes, dispensaciones históricas, donaciones, seguimientos y documentos.
   Reglas:
   - Paso 1 «Probar (sin guardar)» calcula todo sobre una copia y muestra los totales; no toca la base.
   - No duplica: los pacientes que ya están (mismo DNI) se completan sólo en los campos vacíos; un registro
     que ya existe (mismo identificador de AppSheet) no se vuelve a cargar. Repetir la migración no duplica nada.
   - Stock: las dispensaciones históricas quedan marcadas «migrada» y NO mueven stock (los lotes arrancan en 0).
   - Las donaciones históricas no entran en la caja abierta ni piden Factura C.
   - Todo queda en la auditoría. Para volver atrás: «Empezar de cero» (respaldo previo recomendado). */
(function (g) {
  'use strict';
  var CM = g.CM, esc = CM.esc, VIEWS = CM.VIEWS;
  var TIPO = 'vbong-migracion-appsheet';
  var st = { paq: null, err: '', plan: null, hecho: null, archivo: '' };
  function render() { CM.render(); }
  function money(c) { return CM.fmtMoney(c); }
  function n(x) { return CM.fmtNum ? CM.fmtNum(x) : String(x); }

  function validar(p) {
    if (!p || p.tipo !== TIPO || p.version !== 1 || !p.datos) return 'El archivo no es un paquete de migración de AppSheet.';
    var d = p.datos, k = ['pacientes', 'lotes', 'disp', 'aportes', 'seg', 'legDocs'];
    for (var i = 0; i < k.length; i++) if (!Array.isArray(d[k[i]])) return 'Al paquete le falta «' + k[i] + '».';
    var t = p.totales || {};
    for (i = 0; i < k.length; i++) if (t[k[i]] !== d[k[i]].length) return 'Los totales del paquete no coinciden (' + k[i] + '): el archivo está incompleto o fue modificado.';
    var cent = d.aportes.reduce(function (s, a) { return s + (a.cent || 0); }, 0);
    if (cent !== t.aportesCent) return 'La suma de donaciones no coincide con la del paquete: el archivo fue modificado.';
    var refs = {}; d.pacientes.forEach(function (x) { refs[x.ref] = 1; });
    var lotes = {}; d.lotes.forEach(function (x) { lotes[x.id] = 1; });
    var malo = d.disp.filter(function (x) { return !refs[x.ref] || !lotes[x.lote]; }).length + d.aportes.filter(function (x) { return !refs[x.ref]; }).length +
      d.seg.filter(function (x) { return !refs[x.ref]; }).length + d.legDocs.filter(function (x) { return !refs[x.ref]; }).length;
    if (malo) return malo + ' registro(s) del paquete apuntan a pacientes o lotes que no están en el paquete.';
    return '';
  }

  function docNum(p) { var dc = CM.docPac(p); return dc && dc.num ? dc.num : ''; }

  /* arma el plan sobre la base dada (real o copia) y, si aplicar=true, la modifica */
  function ejecutar(db, d, aplicar) {
    var plan = { pacNuevos: 0, pacCompletados: 0, pacIguales: 0, lotesNuevos: 0, lotesYa: 0, disp: 0, dispYa: 0, aportes: 0, aportesYa: 0, cent: 0, seg: 0, segYa: 0, docs: 0, docsYa: 0, completados: [] };
    var porDoc = {}; Object.keys(db.pacientes).forEach(function (k) { var x = docNum(db.pacientes[k]); if (x) porDoc[x] = k; });
    var porLegAnt = {}; Object.keys(db.pacientes).forEach(function (k) { var la = db.pacientes[k].legAnterior; if (la) porLegAnt[la] = k; });
    var mapa = {};
    var CAMPOS = ['nac', 'tel', 'email', 'dir', 'cp', 'obraSocial', 'ocupacion', 'motivo', 'dudas', 'codSeg', 'consentimiento'];
    d.pacientes.forEach(function (x) {
      var k = (x.doc && porDoc[x.doc.num]) || (x.legAnterior && porLegAnt[x.legAnterior]);
      if (k) {
        mapa[x.ref] = k;
        var p = db.pacientes[k], cambia = [];
        CAMPOS.forEach(function (c) { if (x[c] && !p[c]) { cambia.push(c); if (aplicar) p[c] = x[c]; } });
        if (x.historiaCompleta && !p.historiaCompleta) { cambia.push('historia clínica'); if (aplicar) p.historiaCompleta = true; }
        if (x.legAnterior && !p.legAnterior) { if (aplicar) p.legAnterior = x.legAnterior; }
        if (cambia.length) { plan.pacCompletados++; plan.completados.push(p.nombre + ' (' + cambia.join(', ') + ')'); } else plan.pacIguales++;
        if (aplicar && cambia.length) p.migNota = ((p.migNota ? p.migNota + ' ' : '') + 'Completado con datos de AppSheet: ' + cambia.join(', ') + '.').slice(0, 600);
        return;
      }
      plan.pacNuevos++;
      if (!aplicar) { mapa[x.ref] = 'nuevo:' + x.ref; return; }
      var saveDb = CM.db; CM.db = db;
      try {
        var np = CM.nuevoPaciente({ nombre: x.nombre, doc: x.doc, tel: x.tel, nac: x.nac, email: x.email, dir: x.dir, cp: x.cp, obraSocial: x.obraSocial, ocupacion: x.ocupacion,
          motivo: x.motivo, dudas: x.dudas, historiaCompleta: x.historiaCompleta, consentimiento: x.consentimiento, origen: x.origen || 'migración AppSheet', revisar: !!x.revisar });
      } finally { CM.db = saveDb; }
      np.codSeg = x.codSeg || ''; np.alta = x.alta || np.alta; np.legAnterior = x.legAnterior || ''; np.estadoAnterior = x.estadoAnterior || '';
      np.migNota = x.migNota || ''; np.mig = true;
      if (np.posibleDup) delete np.posibleDup;
      mapa[x.ref] = np.dni;
      if (x.doc) porDoc[x.doc.num] = np.dni;
    });
    function ya(arr, id) { for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return true; return false; }
    var idx = {}; ['lotes', 'disp', 'aportes', 'seg', 'legDocs'].forEach(function (c) { idx[c] = {}; (db[c] || []).forEach(function (r) { idx[c][r.id] = 1; }); });
    function sinRef(r) { var o = {}; Object.keys(r).forEach(function (k) { if (k !== 'ref') o[k] = r[k]; }); return o; }
    d.lotes.forEach(function (l) {
      if (idx.lotes[l.id]) { plan.lotesYa++; return; }
      plan.lotesNuevos++;
      if (aplicar) { var o = sinRef(l); o.ingreso = o.ingreso || CM.hoy(); db.lotes.push(o); }
    });
    [['disp', 'disp', 'dispYa'], ['aportes', 'aportes', 'aportesYa'], ['seg', 'seg', 'segYa'], ['legDocs', 'docs', 'docsYa']].forEach(function (c) {
      if (!db[c[0]]) db[c[0]] = [];
      d[c[0]].forEach(function (r) {
        if (idx[c[0]][r.id]) { plan[c[2]]++; return; }
        plan[c[1]]++;
        if (c[0] === 'aportes') plan.cent += r.cent;
        if (!aplicar) return;
        var o = sinRef(r); o.dni = mapa[r.ref];
        if (c[0] === 'legDocs') { o.user = 'Migración AppSheet'; }
        db[c[0]].push(o);
      });
    });
    void ya;
    return plan;
  }

  function copiaBase() { return JSON.parse(JSON.stringify(CM.db)); }

  function listo() {
    if (CM.nube && CM.nube.activa && !(CM.nube.ultSync > 0)) return 'Esperá a que termine la primera sincronización (chip «Sincronizado» arriba) y volvé a intentar.';
    return '';
  }

  CM.acts['mig-probar'] = function () {
    if (!st.paq) return;
    var w = listo(); if (w) { CM.toast(w, true); return; }
    st.plan = ejecutar(copiaBase(), st.paq.datos, false); st.hecho = null; render();
  };
  CM.acts['mig-aplicar'] = function () {
    if (!st.paq || !st.plan) return;
    var p = st.plan;
    CM.modal.open({ title: 'Confirmar migración', body: '<p>Se van a incorporar <b>' + n(p.pacNuevos) + '</b> pacientes nuevos (y completar ' + n(p.pacCompletados) + '), <b>' + n(p.disp) + '</b> dispensaciones históricas, <b>' + n(p.aportes) + '</b> donaciones por <b>' + esc(money(p.cent)) + '</b>, ' + n(p.seg) + ' seguimientos y ' + n(p.docs) + ' documentos.</p><div class="note info">El stock no cambia (las dispensaciones históricas no mueven stock). Repetir la migración no duplica nada.</div>',
      footer: '<button class="btn" type="button" data-act="modal-close">Cancelar</button><button class="btn pri" data-act="mig-aplicar-ok">Sí, migrar</button>' });
  };
  CM.acts['mig-aplicar-ok'] = function () {
    if (!st.paq) return;
    var w = listo(); if (w) { CM.modal.close(true); CM.toast(w, true); return; }
    var antes = copiaBase(), plan;
    try {
      plan = ejecutar(CM.db, st.paq.datos, true);
    } catch (e) {
      Object.keys(antes).forEach(function (k) { CM.db[k] = antes[k]; });   // todo o nada
      CM.modal.close(true); CM.toast('No se migró nada: ' + (e && e.message ? e.message : 'error inesperado') + '.', true); return;
    }
    if (!CM.db.cfg.migraciones) CM.db.cfg.migraciones = [];
    CM.db.cfg.migraciones.push({ ts: new Date().toISOString(), hash: st.paq.hash, archivo: st.archivo, generado: st.paq.generado, pacNuevos: plan.pacNuevos, disp: plan.disp, aportes: plan.aportes, cent: plan.cent, seg: plan.seg, docs: plan.docs });
    CM.audit('Migración desde AppSheet', plan.pacNuevos + ' pacientes nuevos, ' + plan.pacCompletados + ' completados, ' + plan.disp + ' dispensaciones, ' + plan.aportes + ' donaciones (' + money(plan.cent) + '), ' + plan.seg + ' seguimientos, ' + plan.docs + ' documentos · paquete ' + String(st.paq.hash).slice(0, 12));
    CM.save();
    st.hecho = plan; st.plan = null; CM.modal.close(true); render();
    CM.toast('Migración aplicada. Se está subiendo a la nube: no cierres la sesión hasta que el chip diga «Sincronizado».');
  };
  CM.acts['mig-reset'] = function () { st = { paq: null, err: '', plan: null, hecho: null, archivo: '' }; render(); };

  g.document.addEventListener('change', function (ev) {
    var t = ev.target; if (!t || t.id !== 'migFile' || !t.files || !t.files[0]) return;
    var f = t.files[0]; t.value = '';
    if (f.size > 25 * 1024 * 1024) { st.err = 'El archivo es demasiado grande.'; render(); return; }
    var fr = new FileReader();
    fr.onload = function () {
      var p = null; try { p = JSON.parse(fr.result); } catch (e) { /* inválido */ }
      var e = validar(p);
      st = { paq: e ? null : p, err: e, plan: null, hecho: null, archivo: f.name };
      render();
    };
    fr.readAsText(f);
  });

  function cuadro() {
    var esAdmin = CM.db.cfg.rol === 'admin' || (CM.usuarioActual && (CM.usuarioActual() || {}).rol === 'admin');
    if (!esAdmin) return '';
    var h = '<section class="card" style="margin-top:14px"><div class="row sp"><h2>Migración desde AppSheet</h2>' + (st.paq ? '<button class="btn sm" data-act="mig-reset">Elegir otro archivo</button>' : '') + '</div>';
    var prev = CM.db.cfg.migraciones || [];
    if (prev.length) h += '<div class="note ok">Ya se aplicó ' + prev.length + ' vez/veces (última: ' + esc(CM.fmtFH ? CM.fmtFH(prev[prev.length - 1].ts) : prev[prev.length - 1].ts) + '). Volver a aplicarla sólo agrega lo que falte; no duplica.</div>';
    if (!st.paq) {
      h += '<p style="color:var(--mu)">Subí el paquete de migración (<b>.json</b>) preparado a partir de la planilla de AppSheet. Primero se prueba sin guardar.</p>' +
        '<label class="btn pri" for="migFile" style="cursor:pointer">' + CM.icon('plus') + 'Elegir paquete de migración</label><input type="file" id="migFile" accept=".json,application/json" class="sr">';
      if (st.err) h += '<div class="note bad" style="margin-top:10px">' + esc(st.err) + '</div>';
      return h + '</section>';
    }
    var t = st.paq.totales;
    h += '<p class="hint">Archivo: ' + esc(st.archivo) + ' · armado el ' + esc(String(st.paq.generado).replace('T', ' ').slice(0, 16)) + ' UTC · huella ' + esc(String(st.paq.hash).slice(0, 12)) + '</p>' +
      '<div class="tw"><table><thead><tr><th>En el paquete</th><th class="n">Cantidad</th></tr></thead><tbody>' +
      [['Pacientes', t.pacientes], ['Lotes / preparados', t.lotes], ['Dispensaciones históricas', t.disp], ['Donaciones', t.aportes + ' · ' + money(t.aportesCent)], ['Seguimientos médicos', t.seg], ['Documentos (vínculo a la carpeta de AppSheet)', t.legDocs]]
        .map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td class="n">' + esc(String(r[1])) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    if (st.hecho) {
      var p0 = st.hecho;
      return h + '<div class="note ok" style="margin-top:12px"><b>Migración aplicada.</b> ' + n(p0.pacNuevos) + ' pacientes nuevos, ' + n(p0.pacCompletados) + ' completados, ' + n(p0.disp) + ' dispensaciones, ' + n(p0.aportes) + ' donaciones (' + esc(money(p0.cent)) + '), ' + n(p0.seg) + ' seguimientos, ' + n(p0.docs) + ' documentos. Esperá a que el chip diga «Sincronizado».</div></section>';
    }
    if (!st.plan) return h + '<div class="row" style="margin-top:12px"><button class="btn pri" data-act="mig-probar">Probar (sin guardar)</button></div></section>';
    var p = st.plan;
    h += '<h3 style="margin-top:14px">Resultado de la prueba (no se guardó nada)</h3><div class="tw"><table><thead><tr><th></th><th class="n">Se agregan</th><th class="n">Ya estaban (no se duplican)</th></tr></thead><tbody>' +
      '<tr><td>Pacientes</td><td class="n">' + n(p.pacNuevos) + '</td><td class="n">' + n(p.pacCompletados + p.pacIguales) + (p.pacCompletados ? ' (' + n(p.pacCompletados) + ' se completan)' : '') + '</td></tr>' +
      '<tr><td>Lotes</td><td class="n">' + n(p.lotesNuevos) + '</td><td class="n">' + n(p.lotesYa) + '</td></tr>' +
      '<tr><td>Dispensaciones</td><td class="n">' + n(p.disp) + '</td><td class="n">' + n(p.dispYa) + '</td></tr>' +
      '<tr><td>Donaciones</td><td class="n">' + n(p.aportes) + ' · ' + esc(money(p.cent)) + '</td><td class="n">' + n(p.aportesYa) + '</td></tr>' +
      '<tr><td>Seguimientos</td><td class="n">' + n(p.seg) + '</td><td class="n">' + n(p.segYa) + '</td></tr>' +
      '<tr><td>Documentos</td><td class="n">' + n(p.docs) + '</td><td class="n">' + n(p.docsYa) + '</td></tr></tbody></table></div>' +
      (p.completados.length ? '<details style="margin-top:8px"><summary>Pacientes que ya estaban y se completan (' + p.completados.length + ')</summary><ul>' + p.completados.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></details>' : '') +
      '<div class="note info" style="margin-top:10px">El stock de los lotes queda en 0 (cargá el ingreso real en Trazabilidad). Las donaciones históricas no entran en la caja abierta.</div>' +
      '<div class="row" style="margin-top:12px"><button class="btn" data-act="mig-probar">Probar de nuevo</button><button class="btn pri" data-act="mig-aplicar"' + (p.pacNuevos + p.disp + p.aportes + p.seg + p.docs + p.lotesNuevos + p.pacCompletados ? '' : ' disabled') + '>Migrar ahora</button></div>';
    return h + '</section>';
  }
  var ie0 = VIEWS.importexport;
  if (ie0) VIEWS.importexport = function () { return ie0.apply(this, arguments) + cuadro(); };
  CM._migra = { validar: validar, ejecutar: ejecutar };
})(window);
