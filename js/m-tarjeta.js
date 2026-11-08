/* Sistema VB ONG · Tarjeta del Club (SISTEMA_VB_ONGF 4.25 · 4.27.3 · 4.27.4), portado de Sistema VB V26.3–V26.58
   - Cada paciente/socio tiene una tarjeta: identificador secreto (80 bits) + clave (120 bits) + N.º de socio, en su ficha (data.club).
   - Celular (#/mitarjeta): tarjeta a pantalla completa con QR y código de 4 cifras que cambian cada 2 minutos; los sellos los pide
     al servidor (pub_club_estado) apenas se abre y cada 30 s. El enlace personal (#/tarjeta/<id>.<clave>) viaja en el «#»: nunca
     llega a ningún servidor; se guarda en el celular (localStorage + IndexedDB).
   - Mostrador: sella por QR del celular (un solo uso), por QR impreso/etiqueta (fijo), por código de 8 cifras (N.º de socio + código)
     o por DNI. Siempre 1 sello por día por paciente.
   - Reemitir cambia identificador y clave: la tarjeta, el QR y el enlace anteriores dejan de servir. Baja: revoca todo.
   - La tarjeta vieja (CM-S|DNI|firma fija) ya no se acepta: la firma era copiable. Se reemite desde Fidelización. */
(function (g) {
  'use strict';
  var CM = g.CM, esc = CM.esc, U = CM.U, fail = U.fail, VIEWS = CM.VIEWS, fl = U.fl;
  var render = function () { CM.render(); };
  var ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', VENT = 120000, LS = 'cm_mitarjeta';
  function ahora() { return typeof g.__now === 'number' ? g.__now : Date.now(); }
  function azar(n) { var a = new Uint8Array(n), s = ''; (g.crypto || g.msCrypto).getRandomValues(a); for (var i = 0; i < n; i++) s += ABC[a[i] & 31]; return s; }
  function pad4(n) { return String(n).padStart(4, '0'); }
  CM.clubVentana = function (t) { return Math.floor((t == null ? ahora() : t) / VENT); };
  CM.clubCodigo = function (sec, w) { return pad4(parseInt(CM.sha256('cm2|' + sec + '|' + w).slice(0, 8), 16) % 10000); };
  function pacs() { return Object.keys(CM.db.pacientes).map(function (k) { return CM.db.pacientes[k]; }); }
  function porId(id) { return pacs().filter(function (p) { return p.club && p.club.id === id; })[0] || null; }
  function porNum(n) { return pacs().filter(function (p) { return p.club && !p.club.baja && p.club.num === n; })[0] || null; }
  function sigNum() { var mx = 0; pacs().forEach(function (p) { var n = p.club && parseInt(p.club.num, 10); if (n > mx) mx = n; }); return pad4(mx + 1); }
  CM.clubDe = function (dni) { var p = CM.paciente(dni); return p && p.club && !p.club.baja ? p.club : null; };

  /* ---------- emitir / reemitir / baja ---------- */
  CM.clubEmitir = function (dni, motivo) {
    var p = CM.paciente(dni); if (!p) return { err: 'No encontré a ese paciente.' };
    var prev = p.club || null, re = !!(prev && prev.id);
    p.club = { id: azar(16), sec: azar(24), num: (prev && prev.num) || sigNum(), v: ((prev && prev.v) || 0) + 1, ts: new Date().toISOString(), user: CM.db.cfg.operador, baja: false };
    CM.audit(re ? 'Tarjeta del Club reemitida' : 'Tarjeta del Club emitida', 'Legajo ' + CM.legDe(dni) + ' · socio N.º ' + p.club.num + ' · versión ' + p.club.v + (motivo ? ' · ' + motivo : '') + (re ? ' · la anterior deja de servir' : ''));
    return { ok: p.club };
  };
  CM.clubBaja = function (dni, motivo) {
    var p = CM.paciente(dni); if (!p || !p.club) return { err: 'Ese paciente no tiene tarjeta.' };
    p.club = { num: p.club.num, v: p.club.v, baja: true, ts: new Date().toISOString(), user: CM.db.cfg.operador };
    CM.audit('Tarjeta del Club dada de baja', 'Legajo ' + CM.legDe(dni) + ' · socio N.º ' + p.club.num + ' · ' + motivo);
    return { ok: true };
  };
  CM.clubEnlace = function (c) { return g.location.href.split('#')[0] + '#/tarjeta/' + c.id + '.' + c.sec; };

  /* ---------- lectura en el mostrador ---------- */
  var leer0 = CM.leerTokenSello;
  CM.leerTokenSello = function (txt) {
    var s = String(txt || '').trim(), m, p, w;
    if (/^CM-S\|/i.test(s)) return { err: 'Es una tarjeta vieja (su firma se podía copiar): ya no se acepta. Reemitila desde Fidelización → Tarjeta.' };
    if ((m = /^CM2\|([A-Z2-9]{16})\|(\d{4})$/.exec(s))) {
      p = porId(m[1]);
      if (!p) return { err: 'Esa tarjeta no existe o fue reemitida / dada de baja.' };
      w = CM.clubVentana();
      var okw = [w, w - 1].filter(function (x) { return CM.clubCodigo(p.club.sec, x) === m[2]; })[0];
      if (okw == null) return { err: 'El código del QR venció: pedile a la persona que muestre la tarjeta de nuevo.' };
      if (usado(p.club.id + ':' + okw)) return { err: 'Ese QR ya se usó. Esperá a que cambie (cada 2 minutos).' };
      return { dni: p.dni, cw: p.club.id + ':' + okw, medio: 'QR del celular' };
    }
    if ((m = /^CM2N\|([A-Z2-9]{16})$/.exec(s))) {
      p = porId(m[1]);
      if (!p) return { err: 'Esa tarjeta impresa no existe o fue reemitida / dada de baja.' };
      return { dni: p.dni, medio: 'tarjeta impresa' };
    }
    return leer0 ? leer0(s) : null;
  };
  function usado(cw) { return CM.db.sellos.some(function (x) { return x.cw === cw; }); }
  CM.leerCodigoClub = function (txt) {
    var d = String(txt || '').replace(/\D/g, '');
    if (d.length !== 8) return { err: 'El código de la tarjeta tiene 8 números: N.º de socio (4) + código (4).' };
    var p = porNum(d.slice(0, 4)); if (!p) return { err: 'No hay una tarjeta activa con el N.º de socio ' + d.slice(0, 4) + '.' };
    var w = CM.clubVentana(), okw = [w, w - 1].filter(function (x) { return CM.clubCodigo(p.club.sec, x) === d.slice(4); })[0];
    if (okw == null) return { err: 'El código no coincide o venció (cambia cada 2 minutos).' };
    if (usado(p.club.id + ':' + okw)) return { err: 'Ese código ya se usó. Esperá a que cambie.' };
    return { dni: p.dni, cw: p.club.id + ':' + okw, medio: 'código de 8 cifras' };
  };
  /* sella dejando la marca del código usado (un solo uso) y el medio en la auditoría */
  CM.sellarLeido = function (r, motivo) {
    var s = CM.otorgarSello(r.dni, motivo || 'Participación en taller');
    if (s.err) return s;
    if (r.cw) s.ok.cw = r.cw;
    s.ok.medio = r.medio || '';
    CM.audit('Sello otorgado', 'Legajo ' + CM.legDe(r.dni) + ' · ' + s.ok.id + ' · medio: ' + (r.medio || 'mostrador'));
    CM.save(); return s;
  };
  CM.forms['sello-cod'] = function (f) {
    if (!CM.need('fidelizacion', 'oper')) return;
    var r = CM.leerCodigoClub(f.elements.cod.value);
    if (r.err) return fail(f, 'cod', r.err);
    var s = CM.sellarLeido(r, 'Participación en taller');
    if (s.err) return fail(f, 'cod', s.err);
    render(); CM.toast('Sello otorgado a ' + U.nombreCorto(U.nombreDe(r.dni)) + '.');
  };

  /* ---------- tarjeta impresa y administración ---------- */
  function puedeAdm() { return CM.can('fidelizacion', 'edit') && CM.can('pacientes', 'oper'); }   /* la tarjeta vive en la ficha: el servidor pide permiso de escritura en Pacientes */
  function impresa(p) {
    var c = p.club, s = CM.saldoSellos(p.dni), meta = CM.db.cfg.sellosMeta || 8, cells = '';
    for (var i = 0; i < meta; i++) cells += '<span class="' + (i < Math.min(s, meta) ? 'on' : '') + '">' + (i < Math.min(s, meta) ? '★' : '') + '</span>';
    return '<div class="tarj"><div class="tj-h"><img src="assets/logo.png" alt="Cannabismatica"></div><div class="tj-b"><div class="tj-n">' + esc(U.nombreCorto(p.nombre)) + '</div><div class="tj-d">Socio/a N.º ' + esc(c.num) + '</div><div class="tj-s">' + cells + '</div></div><div class="tj-q">' + CM.qrSvg('CM2N|' + c.id) + '</div><div class="tj-f">Desarrollado por VINCULAR BUSINESS</div></div>';
  }
  CM.acts['sello-tarjeta'] = function (t) { modalTarjeta(t.getAttribute('data-dni')); };
  function modalTarjeta(dni) {
    var p = CM.paciente(dni); if (!p) return;
    var c = CM.clubDe(dni), adm = puedeAdm();
    if (!c) {
      CM.modal.open({ title: 'Tarjeta del Club', body: '<p><b>' + esc(U.nombreCorto(p.nombre)) + '</b> ' + (p.club && p.club.baja ? 'tiene la tarjeta dada de baja.' : 'todavía no tiene tarjeta del Club.') + '</p><p class="hint">Al emitirla se le asigna un N.º de socio y un enlace personal para ver la tarjeta en el celular.</p>',
        footer: '<button class="btn" data-act="modal-close">Cerrar</button>' + (adm ? '<button class="btn pri" data-act="club-emitir" data-dni="' + esc(dni) + '">Emitir tarjeta</button>' : '') });
      return;
    }
    CM.modal.open({ title: 'Tarjeta del Club · socio N.º ' + c.num, wide: true,
      body: '<div class="tarj-wrap">' + impresa(p) + '</div><p class="hint">Tamaño 85,6 × 54 mm. El QR impreso es fijo (sirve también como etiqueta): lo protege el límite de 1 sello por día y se anula al reemitir. En el celular el QR cambia cada 2 minutos y es de un solo uso.</p>' +
        (adm ? '<div class="card flat"><b>Tarjeta en el celular</b><p class="hint" style="margin:4px 0 8px">Enviale a la persona su enlace personal. <b>Es una llave:</b> quien lo tenga ve la tarjeta y puede usarla. Mandalo sólo a su propio WhatsApp.</p><div class="row"><button class="btn" data-act="club-enlace" data-dni="' + esc(dni) + '">Copiar enlace</button>' +
          (p.tel ? '<button class="btn" data-act="club-wa" data-dni="' + esc(dni) + '">Enviar por WhatsApp</button>' : '') + '</div></div>' : ''),
      footer: '<button class="btn" data-act="modal-close">Cerrar</button>' + (adm ? '<button class="btn" data-act="club-reemitir" data-dni="' + esc(dni) + '">Reemitir</button><button class="btn bad" data-act="club-baja" data-dni="' + esc(dni) + '">Dar de baja</button>' : '') +
        '<button class="btn pri" data-act="tarj-print" data-dni="' + esc(dni) + '">' + CM.icon('print') + 'Imprimir</button>' });
  }
  CM.acts['tarj-print'] = function (t) { var p = CM.paciente(t.getAttribute('data-dni')); if (p && CM.clubDe(p.dni)) CM.imprimir('<div class="tarj-wrap print">' + impresa(p) + '</div>'); };
  CM.acts['club-emitir'] = function (t) {
    if (!puedeAdm()) return CM.toast('Tu rol no puede emitir tarjetas.', true);
    var dni = t.getAttribute('data-dni'), r = CM.clubEmitir(dni, '');
    if (r.err) return CM.toast(r.err, true);
    CM.save(); render(); modalTarjeta(dni); CM.toast('Tarjeta emitida: socio N.º ' + r.ok.num + '.');
  };
  CM.acts['club-reemitir'] = function (t) {
    var dni = t.getAttribute('data-dni');
    CM.modal.open({ title: 'Reemitir tarjeta', body: '<form id="fCR" data-form="club-reemitir" class="f" novalidate><input type="hidden" name="dni" value="' + esc(dni) + '"><div class="note warn">La tarjeta impresa, el QR y el enlace anteriores <b>dejan de servir</b>. El N.º de socio y los sellos se conservan.</div>' + fl('Motivo *', '<input class="in" name="motivo" placeholder="Ej.: perdió el celular">') + '<p class="err" role="alert" data-err></p></form>',
      footer: '<button class="btn" type="button" data-act="modal-close">Cancelar</button><button class="btn pri" type="submit" form="fCR">Reemitir</button>' });
  };
  CM.forms['club-reemitir'] = function (f) {
    if (!puedeAdm()) return; var e = f.elements, m = e.motivo.value.trim();
    if (m.length < 3) return fail(f, 'motivo', 'Escribí el motivo.');
    var r = CM.clubEmitir(e.dni.value, m); if (r.err) return fail(f, 'motivo', r.err);
    CM.save(); render(); modalTarjeta(e.dni.value); CM.toast('Tarjeta reemitida. La anterior ya no sirve.');
  };
  CM.acts['club-baja'] = function (t) {
    var dni = t.getAttribute('data-dni');
    CM.modal.open({ title: 'Dar de baja la tarjeta', body: '<form id="fCB" data-form="club-baja" class="f" novalidate><input type="hidden" name="dni" value="' + esc(dni) + '"><p style="margin:0">El QR, el código y el enlace dejan de servir. Los sellos y el historial se conservan.</p>' + fl('Motivo *', '<input class="in" name="motivo">') + '<p class="err" role="alert" data-err></p></form>',
      footer: '<button class="btn" type="button" data-act="modal-close">Cancelar</button><button class="btn bad" type="submit" form="fCB">Dar de baja</button>' });
  };
  CM.forms['club-baja'] = function (f) {
    if (!puedeAdm()) return; var e = f.elements, m = e.motivo.value.trim();
    if (m.length < 3) return fail(f, 'motivo', 'Escribí el motivo.');
    var r = CM.clubBaja(e.dni.value, m); if (r.err) return fail(f, 'motivo', r.err);
    CM.save(); CM.modal.close(true); render(); CM.toast('Tarjeta dada de baja.');
  };
  CM.acts['club-enlace'] = function (t) {
    var dni = t.getAttribute('data-dni'), c = CM.clubDe(dni); if (!c || !puedeAdm()) return;
    var u = CM.clubEnlace(c);
    CM.audit('Enlace de tarjeta copiado', 'Legajo ' + CM.legDe(dni) + ' · socio N.º ' + c.num); CM.save();
    (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(function () { CM.toast('Enlace copiado. Mandalo sólo a la persona.'); }, function () { g.prompt('Copiá el enlace personal:', u); });
  };
  CM.acts['club-wa'] = function (t) {
    var dni = t.getAttribute('data-dni'), p = CM.paciente(dni), c = CM.clubDe(dni); if (!c || !p || !puedeAdm()) return;
    var tel = String(p.tel || '').replace(/\D/g, ''); if (tel.length === 10) tel = '549' + tel;
    CM.audit('Enlace de tarjeta enviado por WhatsApp', 'Legajo ' + CM.legDe(dni) + ' · socio N.º ' + c.num); CM.save();
    g.open('https://wa.me/' + tel + '?text=' + encodeURIComponent('Hola ' + U.nombreCorto(p.nombre).split(' ')[0] + ', esta es tu tarjeta del Club de ' + (CM.db.menu.pub.nombre || 'la fundación') + '. Abrila y guardala en tu celular (es personal, no la compartas): ' + CM.clubEnlace(c)), '_blank', 'noopener');
  };

  /* Fidelización: columna con el N.º de socio y formulario de código de 8 cifras */
  var fid0 = VIEWS.fidelizacion;
  VIEWS.fidelizacion = function () {
    var h = fid0();
    if (CM.fid.tab !== 'sellos') return h;
    var form = '<section class="card" style="margin-top:14px"><h2>Sellar con el código de la tarjeta</h2><form data-form="sello-cod" class="row" autocomplete="off" novalidate><label class="sr" for="selCod">Código de 8 números</label><input id="selCod" class="in" name="cod" inputmode="numeric" maxlength="9" placeholder="N.º de socio + código (8 números)" style="max-width:280px"><button class="btn pri" type="submit">Sellar</button><p class="err" role="alert" data-err style="flex-basis:100%"></p></form><p class="hint">Lo muestra la tarjeta en el celular y cambia cada 2 minutos. También podés escanear el QR o buscar por DNI arriba.</p></section>';
    var i = h.indexOf('<section class="card" style="margin-top:14px"><h2>Saldo de cada paciente</h2>');
    return i > 0 ? h.slice(0, i) + form + h.slice(i) : h + form;
  };

  /* ---------- el celular: guardar la tarjeta y mostrarla ---------- */
  function idbGuardar(v) {
    try { var rq = g.indexedDB.open('cm_tarjeta', 1); rq.onupgradeneeded = function () { rq.result.createObjectStore('t'); }; rq.onsuccess = function () { try { var tx = rq.result.transaction('t', 'readwrite'); tx.objectStore('t').put(v, 'k'); } catch (e) { /* nada */ } }; } catch (e) { /* nada */ }
  }
  function idbLeer(cb) {
    try { var rq = g.indexedDB.open('cm_tarjeta', 1); rq.onupgradeneeded = function () { rq.result.createObjectStore('t'); }; rq.onsuccess = function () { try { var q = rq.result.transaction('t').objectStore('t').get('k'); q.onsuccess = function () { cb(q.result || null); }; q.onerror = function () { cb(null); }; } catch (e) { cb(null); } }; rq.onerror = function () { cb(null); }; } catch (e) { cb(null); }
  }
  function guardada() { try { var v = JSON.parse(g.localStorage.getItem(LS) || 'null'); return v && /^[A-Z2-9]{16}$/.test(v.id) && /^[A-Z2-9]{24}$/.test(v.sec) ? v : null; } catch (e) { return null; } }
  function guardar(v) { try { g.localStorage.setItem(LS, JSON.stringify(v)); } catch (e) { /* nada */ } idbGuardar(v); try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* nada */ } }
  CM.miTarjetaGuardada = guardada;

  VIEWS.tarjeta = function (r) {
    var m = /^([A-Z2-9]{16})\.([A-Z2-9]{24})$/.exec(String((r && r.a) || ''));
    if (m) { guardar({ id: m[1], sec: m[2] }); setTimeout(function () { try { g.history.replaceState(null, '', g.location.href.split('#')[0] + '#/mitarjeta'); } catch (e) { /* nada */ } render(); }, 0); }
    return '<div class="pubpage"><div class="card" style="margin:40px auto;max-width:460px;text-align:center"><p>' + (m ? 'Guardando tu tarjeta…' : 'El enlace de la tarjeta no es válido.') + '</p><a class="btn" href="#/m">Ir al menú</a></div></div>';
  };
  function premioMenu() { var c = CM.db.menu && CM.db.menu.pub && CM.db.menu.pub.club; return (c && c.premio && c.premio.es) || ''; }
  var est = { id: '', d: null, err: '', t: 0, cargando: false }, tick = null;
  function pedirEstado(c) {
    var N = CM.nube;
    if (!(N && N.activa)) {   /* sin nube (demo): se calcula con los datos del equipo */
      var p = porId(c.id); est.d = p ? { ok: true, socio: true, num: p.club.num, sellos: CM.saldoSellos(p.dni), meta: CM.db.cfg.sellosMeta || 8, premio: premioMenu() } : { ok: true, socio: false };
      est.id = c.id; est.t = ahora(); return Promise.resolve();
    }
    if (est.cargando) return Promise.resolve(); est.cargando = true;
    return N._rpc('pub_club_estado', { p_id: c.id }, true).then(function (r) { est.d = r; est.err = ''; est.id = c.id; est.t = ahora(); }, function () { est.err = 'Sin conexión: los sellos pueden no estar al día.'; })
      .then(function () { est.cargando = false; });
  }
  VIEWS.mitarjeta = function () {
    var c = guardada();
    if (!c) {
      idbLeer(function (v) { if (v && v.id && !guardada()) { guardar(v); render(); } });
      var wa = String((CM.db.menu.pub && CM.db.menu.pub.wa) || '').replace(/\D/g, '');
      return '<div class="pubpage"><div class="card mitj-vacia"><h1>Mi tarjeta</h1><p>Este celular todavía no tiene tu tarjeta del Club. Pedile al equipo de la fundación tu enlace personal y abrilo acá.</p>' +
        (wa ? '<a class="btn pri" target="_blank" rel="noopener noreferrer" href="https://wa.me/' + esc(wa) + '?text=' + encodeURIComponent('Hola, quiero recibir mi tarjeta del Club en el celular.') + '">Pedir mi tarjeta por WhatsApp</a>' : '') + '<a class="btn" href="#/m">Volver al menú</a></div></div>';
    }
    if (!(CM.nube && CM.nube.activa)) pedirEstado(c);   /* demo: se calcula al instante con los datos del equipo */
    else if (est.id !== c.id || ahora() - est.t > 30000) pedirEstado(c).then(function () { if ((g.location.hash || '').indexOf('mitarjeta') >= 0) render(); });
    var d = est.id === c.id ? est.d : null, w = CM.clubVentana(), cod = CM.clubCodigo(c.sec, w), restan = Math.max(0, Math.ceil(((w + 1) * VENT - ahora()) / 1000));
    if (d && d.ok && d.socio === false) return '<div class="pubpage"><div class="card mitj-vacia"><h1>Tarjeta sin validez</h1><p>Esta tarjeta fue reemitida o dada de baja. Pedile al equipo tu enlace nuevo.</p><button class="btn" data-act="mitj-olvidar">Quitar de este celular</button> <a class="btn" href="#/m">Volver al menú</a></div></div>';
    var meta = d && d.meta ? d.meta : 8, s = d && d.sellos != null ? Math.max(0, +d.sellos) : null, cells = '';
    for (var i = 0; i < meta; i++) cells += '<span class="' + (s != null && i < Math.min(s, meta) ? 'on' : '') + '">' + (s != null && i < Math.min(s, meta) ? '★' : '') + '</span>';
    return '<div class="mitj"><div class="mitj-c"><img src="assets/logo.png" alt="Cannabismatica" class="mitj-logo"><div class="mitj-num">' + (d && d.num ? 'Socio/a N.º ' + esc(d.num) : 'Tarjeta del Club') + '</div>' +
      '<div class="tj-s mitj-s" role="img" aria-label="' + (s == null ? 'Sellos sin datos' : s + ' de ' + meta + ' sellos') + '">' + cells + '</div><p class="mitj-t">' + (s == null ? 'Consultando tus sellos…' : s + ' / ' + meta + ' sellos') + (d && d.premio ? '<br><small>Al completar: ' + esc(d.premio) + '</small>' : '') + '</p>' +
      '<div class="mitj-qr">' + CM.qrSvg('CM2|' + c.id + '|' + cod) + '</div><div class="mitj-cod" aria-label="Código para sellar">' + esc(d && d.num ? d.num : '····') + ' ' + esc(cod) + '</div><p class="mitj-t"><small>Cambia en ' + restan + ' s · mostralo en el mostrador para sumar tu sello (1 por día)</small></p>' +
      (est.err ? '<p class="mitj-err">' + esc(est.err) + '</p>' : '') + '<div class="row" style="justify-content:center"><button class="btn sm" data-act="mitj-actualizar">Actualizar</button><a class="btn sm" href="#/m">Menú</a></div>' +
      '<p class="mitj-t"><small>Es personal: no compartas tu enlace. Para tenerla a mano, agregá esta página a la pantalla de inicio.</small></p></div></div>';
  };
  CM.acts['mitj-actualizar'] = function () { est.t = 0; render(); };
  CM.acts['mitj-olvidar'] = function () { try { g.localStorage.removeItem(LS); } catch (e) { /* nada */ } idbGuardar(null); est = { id: '', d: null, err: '', t: 0 }; render(); };
  CM.afterRender = (function (prev) {
    return function (r) {
      if (prev) prev(r);
      if (tick) { clearInterval(tick); tick = null; }
      if (r.v === 'mitarjeta') tick = setInterval(function () { if ((g.location.hash || '').indexOf('mitarjeta') < 0) { clearInterval(tick); tick = null; return; } render(); }, 5000);
    };
  })(CM.afterRender);
})(window);
