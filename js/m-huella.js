/* Sistema VB ONG · Lector de huellas digitales en cada legajo (ZKTeco ZK9500 y compatibles) · 2026-11-21
   SISTEMA_VB_ONGF 4.28.2. El navegador no puede hablar solo con un lector USB: en la PC del lector corre el AGENTE LOCAL
   (tools/agente-huellas, «vbong-huellas.exe»), que usa el software oficial de ZKTeco (libzkfp.dll) y escucha sólo en 127.0.0.1.
   · Detección automática: cuando la función está activa, el sistema busca el agente cada 10 s y muestra si el lector está
     conectado; al enchufarlo se reconoce solo (el agente lo reabre).
   · Emparejamiento una vez por navegador: el agente muestra un código en ESA PC y se escribe acá. Desde ahí cada pedido y
     cada respuesta van firmados con HMAC-SHA256 (sello de tiempo y número de un solo uso): una respuesta falsificada se rechaza.
   · En el legajo sólo se guarda: referencia, hash de la plantilla, dedo, fecha, equipo y el CONSENTIMIENTO. Nunca la imagen.
     La plantilla queda cifrada (DPAPI de Windows) en la PC del lector, y la comparación 1:N la hace el software de ZKTeco ahí.
   · Apagado por defecto. Para activarlo, la administración confirma la revisión legal (dato biométrico, Ley 25.326 [VERIFICAR]).
   · Siempre hay alternativa: nombre, legajo o documento. Sin agente o sin lector no se bloquea nada. */
(function (g) {
  'use strict';
  var CM = g.CM, esc = CM.esc, U = CM.U, fl = U.fl;
  var LS = 'vbong_huella_par', VERSION_CONS = 'H1-2026-11-21';
  var CONSENT = 'Acepto que la ONG registre una plantilla de mi huella digital (no la imagen) sólo para identificarme al retirar mi tratamiento. ' +
    'La plantilla queda cifrada en la computadora del lector y no se comparte con terceros. Puedo pedir que se borre cuando quiera, ' +
    'y siempre puedo identificarme con mi nombre, legajo o documento.';
  var H = CM.huella = { st: null, ts: 0, buscando: false };
  function cfg() { var c = CM.db.cfg.huella; return c && typeof c === 'object' ? c : {}; }
  function activa() { return !!cfg().on; }
  function puerto() { var p = +cfg().puerto; return p >= 1024 && p <= 65535 ? p : 52181; }
  function base() { return 'http://127.0.0.1:' + puerto(); }
  function par() { try { var o = JSON.parse(localStorage.getItem(LS) || 'null'); return o && o.clave ? o : null; } catch (e) { return null; } }
  function guardarPar(o) { try { if (o) localStorage.setItem(LS, JSON.stringify(o)); else localStorage.removeItem(LS); } catch (e) { /* sin almacenamiento */ } }
  function b64bytes(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); }
  function nonce() { var b = new Uint8Array(16); g.crypto.getRandomValues(b); return hex(b); }
  var keyCache = { k: null, c: '' };
  function llave(cl) {
    if (keyCache.c === cl && keyCache.k) return Promise.resolve(keyCache.k);
    return g.crypto.subtle.importKey('raw', b64bytes(cl), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']).then(function (k) { keyCache = { k: k, c: cl }; return k; });
  }
  function hmac(cl, txt) { return llave(cl).then(function (k) { return g.crypto.subtle.sign('HMAC', k, new TextEncoder().encode(txt)); }).then(hex); }
  function conTiempo(p, ms) { return Promise.race([p, new Promise(function (_, mal) { setTimeout(function () { mal(new Error('tiempo')); }, ms); })]); }

  /* ---------- comunicación con el agente ---------- */
  H.estado = function () {
    return conTiempo(fetch(base() + '/estado', { cache: 'no-store' }), 2500).then(function (r) { return r.json(); })
      .then(function (s) { return s && s.agente === 'vbong-huellas' ? s : null; }, function () { return null; });
  };
  H.pedir = function (ruta, cuerpo) {
    var p = par(); if (!p) return Promise.reject(new Error('Este navegador no está emparejado con el lector. Andá a Periféricos → Lector de huellas → Emparejar.'));
    var body = JSON.stringify(cuerpo || {}), ts = String(Date.now()), n = nonce();
    return hmac(p.clave, ['POST', ruta, ts, n, body].join('\n')).then(function (f) {
      return conTiempo(fetch(base() + ruta, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-VB-Ts': ts, 'X-VB-Nonce': n, 'X-VB-Firma': f }, body: body }), 8000);
    }).then(function (r) {
      return r.text().then(function (t) {
        var fr = r.headers.get('X-VB-Firma') || '';
        return hmac(p.clave, n + '\n' + t).then(function (esp) {
          var j = null; try { j = JSON.parse(t); } catch (e) { /* respuesta no JSON */ }
          if (r.status === 401) { var e1 = new Error((j && j.mensaje) || 'El lector no reconoce este navegador: volvé a emparejarlo.'); e1.codigo = 'no_emparejado'; throw e1; }
          if (fr !== esp) throw new Error('La respuesta del lector no tiene una firma válida: se descartó.');
          if (!r.ok) throw new Error((j && j.error) || 'El lector respondió con un error.');
          return j;
        });
      });
    }, function (e) { if (e && e.message === 'tiempo') throw new Error('El agente del lector no responde.'); throw e && /fetch|network|Failed/i.test(e.message) ? new Error('No se encuentra el agente del lector en esta PC.') : e; });
  };
  /* espera un trabajo (enrolar / identificar) informando el progreso */
  H.esperar = function (id, alPaso) {
    var t0 = Date.now();
    return new Promise(function (ok, mal) {
      (function vuelta() {
        if (H._cancel) { H._cancel = false; H.pedir('/cancelar', {}).then(function () {}, function () {}); return mal(new Error('Cancelado.')); }
        H.pedir('/trabajo', { id: id }).then(function (j) {
          if (alPaso) alPaso(j);
          if (j.estado === 'listo') return ok(j.resultado || {});
          if (j.estado === 'error' || j.estado === 'cancelado') { var e = new Error(j.mensaje || 'No se pudo leer la huella.'); e.res = j.resultado; return mal(e); }
          if (Date.now() - t0 > 120000) return mal(new Error('Se agotó el tiempo de lectura.'));
          setTimeout(vuelta, 350);
        }, mal);
      })();
    });
  };

  /* ---------- detección automática ---------- */
  H.detectar = function () {
    if (H.buscando) return Promise.resolve(H.st);
    H.buscando = true;
    return H.estado().then(function (s) {
      var antes = JSON.stringify(H.st && [H.st.lector, H.st.sdk, H.st.emparejado]);
      H.st = s; H.ts = Date.now(); H.buscando = false;
      if (antes !== JSON.stringify(s && [s.lector, s.sdk, s.emparejado])) pintarEstados();
      return s;
    });
  };
  function txtEstado() {
    var s = H.st, p = par();
    if (!s) return { cls: 'p-mu', t: 'Agente no detectado en esta PC' };
    if (!s.sdk) return { cls: 'p-warn', t: 'Falta el software de ZKTeco' };
    if (!s.lector) return { cls: 'p-warn', t: 'Lector desconectado' };
    if (!s.emparejado || !p) return { cls: 'p-warn', t: 'Lector conectado · falta emparejar' };
    return { cls: 'p-ok', t: 'Lector listo' + (s.simulado ? ' (SIMULADO)' : '') };
  }
  H.listo = function () { var s = H.st; return !!(s && s.sdk && s.lector && s.emparejado && par()); };
  function chip() { var e = txtEstado(); return '<span class="pill ' + e.cls + '" data-hu-st>' + esc(e.t) + '</span>'; }
  function pintarEstados() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-hu-st]'), function (x) { var e = txtEstado(); x.className = 'pill ' + e.cls; x.textContent = e.t; });
    Array.prototype.forEach.call(document.querySelectorAll('[data-hu-btn]'), function (b) { b.disabled = !H.listo(); });
    if (location.hash.indexOf('#/perifericos') === 0 && !document.querySelector('#modalRoot .modal') && CM.render) CM.render();
  }
  setInterval(function () { if (activa() && document.visibilityState === 'visible' && CM.db && CM.db.cfg && CM.db.cfg.operador) H.detectar(); }, 10000);
  setTimeout(function () { if (activa()) H.detectar(); }, 1500);

  /* ---------- referencias ---------- */
  CM.huellaRef = function (p) { return p.leg && /^[A-Za-z0-9_-]{3,40}$/.test(p.leg) ? p.leg : 'D' + CM.sha256('huella|' + p.dni).slice(0, 20); };
  CM.pacPorHuella = function (ref) {
    var ks = Object.keys(CM.db.pacientes);
    for (var i = 0; i < ks.length; i++) { var p = CM.db.pacientes[ks[i]]; if (p && p.huella && p.huella.ref === ref && !p.baja) return p; }
    return null;
  };

  /* ---------- Periféricos: tarjeta del lector ---------- */
  function tarjeta() {
    var adm = CM.can('perifericos', 'admin') || CM.can('ajustes', 'admin'), c = cfg(), s = H.st, p = par();
    var h = '<section class="card" style="margin-top:14px"><div class="row sp"><h2 style="margin:0">Lector de huellas digitales</h2>' + (activa() ? chip() : '<span class="pill p-mu">Apagado</span>') + '</div>' +
      '<p class="hint">Compatible con ZKTeco <b>ZK9500</b> (y ZK4500, SLK20R, Live20R) con el software oficial de ZKTeco. La huella sirve para encontrar el legajo al dispensar; nunca reemplaza al nombre, legajo o documento. <b>Pendiente de prueba física con el lector real.</b></p>';
    if (!activa()) {
      return h + (adm ? '<div class="note warn">Es un dato biométrico (sensible). Antes de activarlo: revisión legal de la ONG (Ley 25.326 [VERIFICAR con asesor/a]) y consentimiento firmado de cada paciente, que el sistema pide al registrar la huella.</div>' +
        '<form class="f" data-form="huella-on" style="margin-top:10px"><label class="chk"><input type="checkbox" name="legal"><span>La ONG hizo la revisión legal y usará el consentimiento que pide el sistema.</span></label><p class="err" role="alert" data-err></p><div class="row"><button class="btn pri" type="submit">Activar lector de huellas</button></div></form>' :
        '<p class="hint">Lo activa la administración.</p>') + '</section>';
    }
    h += '<div class="kv">' +
      '<div><small>Agente en esta PC</small><b>' + (s ? 'Detectado · versión ' + esc(s.version) + ' · ' + esc(s.equipo) : 'No detectado') + '</b></div>' +
      '<div><small>Software de ZKTeco</small><b>' + (s ? (s.sdk ? 'Instalado' : 'Falta instalarlo') : '—') + '</b></div>' +
      '<div><small>Lector</small><b>' + (s ? (s.lector ? 'Conectado' + (s.info && s.info.dpi ? ' · ' + esc(s.info.ancho) + '×' + esc(s.info.alto) + ' · ' + esc(s.info.dpi) + ' dpi' : '') : 'No se detecta') : '—') + '</b></div>' +
      '<div><small>Este navegador</small><b>' + (p && s && s.emparejado ? 'Emparejado con ' + esc(p.equipo || s.equipo) : 'Sin emparejar') + '</b></div>' +
      '<div><small>Huellas guardadas en esta PC</small><b>' + (s ? esc(s.plantillas) : '—') + '</b></div></div>' +
      '<div class="row" style="margin-top:12px"><button class="btn" data-act="hu-buscar">Buscar el lector ahora</button>' +
      (s ? '<button class="btn pri" data-act="hu-emparejar">' + (p && s.emparejado ? 'Volver a emparejar' : 'Emparejar este navegador') + '</button>' : '') +
      (H.listo() ? '<button class="btn" data-act="hu-probar">Probar: identificar una huella</button>' : '') +
      (adm ? '<button class="btn bad" data-act="hu-off">Apagar</button>' : '') + '</div>' +
      '<details style="margin-top:12px"' + (s ? '' : ' open') + '><summary><b>Cómo se instala (una sola vez por PC)</b></summary><ol class="hint" style="margin:8px 0 0;padding-left:20px">' +
      '<li>Enchufá el lector y instalá el software oficial de ZKTeco («ZKFinger SDK for Windows» o el driver del ZK9500) desde <a href="https://www.zkteco.com/en/ZKFingerSDKforWindows/ZKFinger-SDK-for-Windows" target="_blank" rel="noopener noreferrer">zkteco.com</a>.</li>' +
      '<li>Descargá en la misma carpeta el <a href="descargas/vbong-huellas.exe" download>agente del lector</a> (Windows de 64 bits; <a href="descargas/vbong-huellas-32bits.exe" download>32 bits</a>) y el <a href="descargas/Instalar%20agente%20de%20huellas.cmd" download>instalador</a>. Ejecutá el instalador: copia el agente a tu usuario y lo deja arrancando solo con Windows (no pide administrador). Windows puede avisar que el programa no está firmado: «Más información» → «Ejecutar de todas formas».</li>' +
      '<li>Volvé a esta pantalla: el lector aparece solo. Tocá «Emparejar este navegador», mirá el código que aparece en la PC y escribilo acá. Si el navegador pregunta si el sitio puede acceder a dispositivos de la red local, respondé «Permitir».</li></ol></details></section>';
    return h;
  }
  var vPer = CM.VIEWS.perifericos;
  if (vPer) CM.VIEWS.perifericos = function () {
    var out = vPer.apply(this, arguments);
    if (activa() && !H.ts) setTimeout(H.detectar, 0);
    return out + tarjeta();
  };
  CM.forms['huella-on'] = function (f) {
    if (!(CM.can('perifericos', 'admin') || CM.can('ajustes', 'admin'))) return U.fail(f, '', 'Sólo la administración lo activa.');
    if (!f.elements.legal.checked) return U.fail(f, 'legal', 'Confirmá la revisión legal para activarlo.');
    CM.db.cfg.huella = { on: true, puerto: puerto(), legal: { ts: new Date().toISOString(), user: CM.db.cfg.operador, version: VERSION_CONS } };
    CM.audit('Lector de huellas activado', 'Revisión legal confirmada por ' + CM.db.cfg.operador + ' · consentimiento ' + VERSION_CONS);
    CM.save(); H.detectar().then(function () { CM.render(); }); CM.render(); CM.toast('Lector de huellas activado. Buscando el agente en esta PC…');
  };
  CM.acts['hu-off'] = function () {
    if (!(CM.can('perifericos', 'admin') || CM.can('ajustes', 'admin'))) return;
    var c = cfg(); c.on = false; CM.db.cfg.huella = c;
    CM.audit('Lector de huellas apagado', 'Las huellas guardadas en las PC no se borran'); CM.save(); CM.render();
  };
  CM.acts['hu-buscar'] = function () { H.detectar().then(function (s) { CM.render(); CM.toast(s ? (s.lector ? 'Lector encontrado.' : 'Agente encontrado; el lector no está conectado.') : 'No se encontró el agente en esta PC.', !s); }); };
  CM.acts['hu-emparejar'] = function () {
    if (!CM.need('perifericos', 'oper')) return;
    fetch(base() + '/emparejar/iniciar', { method: 'POST', cache: 'no-store' }).then(function (r) { return r.json(); }).then(function () {
      CM.modal.open({ title: 'Emparejar el lector de huellas', body: '<form id="fHE" data-form="hu-emparejar" class="f" autocomplete="off" novalidate><p style="margin:0">En la pantalla de <b>esta PC</b> apareció una ventana con un código de 6 números. Escribilo acá (vence en 5 minutos).</p>' +
        fl('Código', '<input class="in num" name="codigo" inputmode="numeric" maxlength="6" placeholder="000000" style="font-size:22px;letter-spacing:4px">') + '<p class="err" role="alert" data-err></p></form>',
        footer: '<button class="btn" type="button" data-act="modal-close">Cancelar</button><button class="btn pri" type="submit" form="fHE">Emparejar</button>' });
    }, function () { CM.toast('No se encuentra el agente del lector en esta PC.', true); });
  };
  CM.forms['hu-emparejar'] = function (f) {
    var c = f.elements.codigo.value.replace(/\D/g, '');
    if (c.length !== 6) return U.fail(f, 'codigo', 'Son 6 números.');
    fetch(base() + '/emparejar/confirmar', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigo: c }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        if (!x.ok || !x.j.clave) return U.fail(f, 'codigo', (x.j && x.j.error) || 'Código incorrecto.');
        guardarPar({ clave: x.j.clave, equipo: x.j.equipo || '', ts: new Date().toISOString() }); keyCache = { k: null, c: '' };
        CM.audit('Lector de huellas emparejado', 'Equipo ' + (x.j.equipo || '') + ' · navegador de ' + CM.db.cfg.operador);
        CM.save(); CM.modal.close(true); H.detectar().then(function () { CM.render(); }); CM.toast('Lector emparejado con este navegador.');
      }, function () { U.fail(f, '', 'No se encuentra el agente del lector.'); });
  };

  /* ---------- modal de lectura (progreso) ---------- */
  function modalLectura(titulo, texto) {
    CM.modal.open({ title: titulo, body: '<div class="hu-lect" style="text-align:center;padding:10px"><div style="font-size:54px" aria-hidden="true">☝</div><p data-hu-msg aria-live="polite" style="font-size:18px;font-weight:700">' + esc(texto) + '</p><p class="hint" data-hu-paso></p></div>',
      footer: '<button class="btn" type="button" data-act="hu-cancelar">Cancelar</button>' });
  }
  function progreso(j) {
    var m = document.querySelector('[data-hu-msg]'), p = document.querySelector('[data-hu-paso]');
    if (m) m.textContent = j.mensaje || ''; if (p) p.textContent = j.pasos > 1 ? 'Lectura ' + j.paso + ' de ' + j.pasos : '';
  }
  CM.acts['hu-cancelar'] = function () { H._cancel = true; CM.modal.close(true); };

  /* identificar: devuelve el paciente (o null). Con o.caja (elemento) muestra el progreso ahí, sin abrir otra ventana. */
  CM.huellaIdentificar = function (o) {
    o = o || {};
    if (!H.listo()) return Promise.reject(new Error('El lector no está listo: ' + txtEstado().t + '.'));
    var caja = o.caja, prog = caja ? function (j) { caja.textContent = j.mensaje || ''; } : progreso;
    if (caja) caja.textContent = 'Apoyá el dedo en el lector'; else modalLectura('Identificar por huella', 'Apoyá el dedo en el lector');
    function fin() { if (caja) caja.textContent = ''; else CM.modal.close(true); }
    return H.pedir('/identificar', {}).then(function (j) { return H.esperar(j.trabajo, prog); }).then(function (r) {
      fin();
      if (!r.ok) { CM.audit('Huella: sin coincidencia', 'Equipo ' + (r.equipo || (H.st && H.st.equipo) || '')); return null; }
      var p = CM.pacPorHuella(r.ref);
      CM.audit('Huella: paciente identificado', (p ? 'Legajo ' + (p.leg || '—') : 'referencia sin legajo') + ' · equipo ' + (r.equipo || ''));
      if (p && p.huella && p.huella.hash && r.hash && p.huella.hash !== r.hash) CM.toast('Atención: la huella de esta PC no coincide con la registrada en el legajo (se volvió a registrar en otro equipo).', true);
      return p || { sinLegajo: true };
    }, function (e) { fin(); throw e; });
  };
  CM.acts['hu-probar'] = function () {
    CM.huellaIdentificar().then(function (p) {
      CM.toast(!p ? 'No se encontró esa huella en esta PC.' : p.sinLegajo ? 'La huella está en esta PC pero no en un legajo activo.' : 'Huella reconocida: ' + (CM.U.nombreCorto ? CM.U.nombreCorto(p.nombre) : p.nombre) + ' (legajo ' + (p.leg || '—') + ').', !p || p.sinLegajo);
    }, function (e) { CM.toast(e.message, true); });
  };

  /* ---------- ficha del paciente ---------- */
  var vPac = CM.VIEWS.paciente;
  if (vPac) CM.VIEWS.paciente = function (r) {
    var h = vPac.apply(this, arguments);
    if (!activa()) return h;
    var p = CM.paciente(CM.soloDigitos(r.a)); if (!p) return h;
    var x = p.huella, puede = CM.can('pacientes', 'oper');
    var card = '<section class="card" style="margin-top:14px"><div class="row sp"><h2 style="margin:0">Huella digital</h2>' + chip() + '</div>' +
      (x ? '<div class="kv" style="margin-top:8px"><div><small>Estado</small><b>Registrada</b></div><div><small>Dedo</small><b>' + esc(x.dedo || '—') + '</b></div><div><small>Fecha</small><b>' + esc(CM.fmtFH(x.ts)) + '</b></div><div><small>Equipo</small><b>' + esc(x.equipo || '—') + '</b></div><div><small>Consentimiento</small><b>' + esc(CM.fmtFH(x.consent && x.consent.ts)) + ' · ' + esc(x.consent && x.consent.user || '') + '</b></div></div>' :
        '<p class="hint" style="margin:8px 0">Sin huella registrada. Con la huella, al dispensar se encuentra el legajo apoyando el dedo.</p>') +
      (puede ? '<div class="row" style="margin-top:10px"><button class="btn' + (x ? '' : ' pri') + '" data-act="hu-enrolar" data-dni="' + esc(p.dni) + '" data-hu-btn' + (H.listo() ? '' : ' disabled') + '>' + (x ? 'Volver a registrar' : 'Registrar huella') + '</button>' +
        (x ? '<button class="btn bad" data-act="hu-quitar" data-dni="' + esc(p.dni) + '">Quitar huella</button>' : '') + '</div>' : '') +
      (H.listo() ? '' : '<p class="hint" style="margin:6px 0 0">Para registrar hace falta el lector conectado y emparejado en esta PC (Periféricos → Lector de huellas).</p>') + '</section>';
    var i = h.indexOf('</section>'); if (i < 0) return h + card;
    return h.slice(0, i + 10) + card + h.slice(i + 10);
  };
  var DEDOS = ['Índice derecho', 'Pulgar derecho', 'Medio derecho', 'Índice izquierdo', 'Pulgar izquierdo', 'Medio izquierdo', 'Otro'];
  CM.acts['hu-enrolar'] = function (t) {
    if (!CM.need('pacientes', 'oper')) return;
    var p = CM.paciente(t.getAttribute('data-dni')); if (!p) return;
    if (!H.listo()) return CM.toast('El lector no está listo: ' + txtEstado().t + '.', true);
    CM.modal.open({ title: 'Registrar huella · ' + (CM.U.nombreCorto ? CM.U.nombreCorto(p.nombre) : p.nombre), body: '<form id="fHU" data-form="hu-enrolar" class="f" autocomplete="off" novalidate><input type="hidden" name="dni" value="' + esc(p.dni) + '">' +
      '<div class="card flat"><b>Consentimiento del paciente</b><p style="margin:6px 0 0">' + esc(CONSENT) + '</p><p class="hint" style="margin:6px 0 0">Versión ' + VERSION_CONS + '. Leéselo al paciente; si no está de acuerdo, no se registra.</p></div>' +
      '<label class="chk"><input type="checkbox" name="acepta"><span>El paciente leyó y aceptó el consentimiento</span></label>' +
      fl('Dedo', '<select class="in" name="dedo">' + DEDOS.map(function (d) { return U.opt(d, d, d === 'Índice derecho'); }).join('') + '</select>') +
      '<p class="hint">Se lee 3 veces el mismo dedo. Apoyalo entero y levantalo entre lectura y lectura.</p><p class="err" role="alert" data-err></p></form>',
      footer: '<button class="btn" type="button" data-act="modal-close">Cancelar</button><button class="btn pri" type="submit" form="fHU">Empezar la lectura</button>' });
  };
  CM.forms['hu-enrolar'] = function (f) {
    if (!CM.need('pacientes', 'oper')) return;
    var p = CM.paciente(f.elements.dni.value); if (!p) return;
    if (!f.elements.acepta.checked) return U.fail(f, 'acepta', 'Sin el consentimiento del paciente no se registra la huella.');
    var dedo = f.elements.dedo.value, ref = CM.huellaRef(p), cons = { ts: new Date().toISOString(), user: CM.db.cfg.operador, version: VERSION_CONS };
    modalLectura('Registrar huella', 'Apoyá el dedo en el lector (1 de 3)');
    H.pedir('/enrolar', { ref: ref, dedo: dedo }).then(function (j) { return H.esperar(j.trabajo, progreso); }).then(function (r) {
      if (r.ref !== ref || !/^[0-9a-f]{64}$/.test(r.hash || '')) throw new Error('El lector devolvió un resultado inesperado.');
      var antes = p.huella;
      if (antes) (p.huellaHist = p.huellaHist || []).push({ ts: new Date().toISOString(), user: CM.db.cfg.operador, accion: 'reemplazada', hash: antes.hash, equipo: antes.equipo });
      p.huella = { ref: ref, hash: r.hash, dedo: dedo, ts: r.ts || new Date().toISOString(), user: CM.db.cfg.operador, equipo: r.equipo || '', consent: cons };
      CM.audit('Huella registrada', 'Legajo ' + (p.leg || '—') + ' · ' + dedo + ' · equipo ' + (r.equipo || '') + ' · consentimiento ' + VERSION_CONS);
      CM.save(); CM.modal.close(true); CM.render(); CM.toast('Huella registrada en el legajo.');
    }, function (e) {
      CM.modal.close(true);
      var otro = e.res && e.res.codigo === 'huella_de_otro' ? CM.pacPorHuella(e.res.ref) : null;
      CM.toast(otro ? 'Esa huella ya está registrada en el legajo ' + (otro.leg || '—') + '. No se registró.' : e.message, true);
    });
  };
  CM.acts['hu-quitar'] = function (t) {
    if (!CM.need('pacientes', 'oper')) return;
    var p = CM.paciente(t.getAttribute('data-dni')); if (!p || !p.huella) return;
    CM.modal.open({ title: 'Quitar la huella', body: '<form id="fHQ" data-form="hu-quitar" class="f" novalidate><input type="hidden" name="dni" value="' + esc(p.dni) + '"><p style="margin:0">Se borra la huella de esta PC y del legajo (el paciente revoca el consentimiento). Las dispensas anteriores no cambian.</p>' +
      fl('Motivo *', '<input class="in" name="motivo" maxlength="120" placeholder="Ej.: lo pidió el paciente">') + '<p class="err" role="alert" data-err></p></form>',
      footer: '<button class="btn" type="button" data-act="modal-close">Cancelar</button><button class="btn bad" type="submit" form="fHQ">Quitar huella</button>' });
  };
  CM.forms['hu-quitar'] = function (f) {
    if (!CM.need('pacientes', 'oper')) return;
    var p = CM.paciente(f.elements.dni.value), mot = f.elements.motivo.value.trim(); if (!p || !p.huella) return;
    if (mot.length < 3) return U.fail(f, 'motivo', 'Escribí el motivo.');
    var x = p.huella;
    function cerrar(enPc) {
      (p.huellaHist = p.huellaHist || []).push({ ts: new Date().toISOString(), user: CM.db.cfg.operador, accion: 'quitada', hash: x.hash, equipo: x.equipo, motivo: mot, enPc: enPc });
      p.huella = null;
      CM.audit('Huella quitada', 'Legajo ' + (p.leg || '—') + ' · ' + mot + (enPc ? '' : ' · PENDIENTE borrar en el equipo ' + (x.equipo || '')));
      CM.save(); CM.modal.close(true); CM.render();
      CM.toast(enPc ? 'Huella quitada del legajo y de esta PC.' : 'Huella quitada del legajo. No se pudo borrar de la PC del lector (' + (x.equipo || '?') + '): borrala desde esa PC.', !enPc);
    }
    if (!H.listo()) return cerrar(false);
    H.pedir('/borrar', { ref: x.ref }).then(function () { cerrar(true); }, function () { cerrar(false); });
  };

  /* ---------- dispensa: identificar por huella ---------- */
  var vd0 = CM.acts.dispensar;
  if (vd0) CM.acts.dispensar = function (t) {
    vd0.apply(this, arguments);
    if (!activa()) return;
    var inp = document.getElementById('dsDni'); if (!inp) return;
    var box = inp.closest('.fl') || inp.parentNode;
    box.insertAdjacentHTML('afterend', '<div class="row" style="margin:-4px 0 6px"><button type="button" class="btn" data-act="hu-ds" data-hu-btn' + (H.listo() ? '' : ' disabled') + '>☝ Identificar con huella</button><button type="button" class="btn sm" data-act="hu-ds-cancelar" hidden>Cancelar</button>' + chip() + '<b data-hu-ds-msg aria-live="polite"></b></div>');
    if (!H.ts || Date.now() - H.ts > 8000) H.detectar();
  };
  CM.acts['hu-ds'] = function (t) {
    var f = document.getElementById('fDS'); if (!f || t.dataset.busy) return;
    var caja = f.querySelector('[data-hu-ds-msg]'), cancel = f.querySelector('[data-act=hu-ds-cancelar]');
    t.dataset.busy = '1'; t.disabled = true; if (cancel) cancel.hidden = false;
    CM.huellaIdentificar({ caja: caja }).then(function (p) { volver(p); }, function (e) { volver(null, e); });
    function volver(p, e) {
      delete t.dataset.busy; t.disabled = !H.listo(); if (cancel) cancel.hidden = true;
      var inp = document.getElementById('dsDni');
      if (p && !p.sinLegajo && inp) { inp.value = p.leg || p.dni; inp.dispatchEvent(new Event('input', { bubbles: true })); CM.toast('Paciente identificado por huella.'); }
      else CM.toast(e ? e.message : p && p.sinLegajo ? 'La huella no está asociada a un legajo activo. Buscalo por nombre o documento.' : 'No se encontró esa huella. Buscalo por nombre, legajo o documento.', true);
    }
  };
  CM.acts['hu-ds-cancelar'] = function () { H._cancel = true; };
})(window);
