/* Sistema VB ONG · Portero digital de Cannabismática integrado · 2026-11-12
   El portero (raveholding.github.io/PorteroCannabismatica) avisa por ntfy cuando tocan el timbre (en la puerta o por QR desde
   el celular de la visita), cuando hay una emergencia o una alerta. Este módulo escucha esos avisos en el sistema:
   · suena y aparece una alerta en CUALQUIER pantalla (aunque estés en otra sección o con un formulario abierto), sin cortar lo que hacés;
   · con la pestaña en segundo plano también avisa con una notificación del equipo (si se la habilita) que trae los botones
     «Ya voy» y «Abrir portero»;
   · se responde desde la alerta (Ya voy · Un momento · No podemos): la respuesta aparece y se escucha en la pantalla del portero
     y en el celular de la visita (timbre por QR). Si otra persona ya respondió, la alerta lo muestra y deja de sonar;
   · «Abrir portero» abre el portero en otra pestaña (no abre la cerradura: eso sigue siendo con PIN, tarjeta, pase o el pulsador).
   La configuración (tema del canal) la carga un administrador en Configuración → Portero digital y vale para todos los equipos;
   «Sonar en este equipo» y las notificaciones del equipo se eligen en cada computadora o celular.
   El tema funciona como contraseña del canal: no sale del sistema ni va a la auditoría. */
(function (g) {
  'use strict';
  var CM = g.CM, esc = CM.esc, d = document, U = CM.U, fl = U.fl;
  var SERVIDOR = 'https://ntfy.sh', URL_DEF = 'https://raveholding.github.io/PorteroCannabismatica/';
  var RESP = { voy: 'Ya voy', momento: 'Un momento', nopuede: 'No podemos' };
  var RESP_VISITA = { voy: '¡Ya vamos! Aguardá un momento.', momento: 'Estamos atendiendo: en unos minutos te recibimos.', nopuede: 'Ahora no podemos atenderte. Disculpá las molestias.' };
  var TEMA_OK = /^[\w-]{10,64}$/;
  var P = CM.portero = { es: null, clave: '', estado: 'apagado', vistos: {}, alertas: [], ultimoMsg: 0 };

  function cfg() { var o = (CM.db && CM.db.ong) || {}; return o.portero || {}; }
  function prefEq(k, def) { var v = g.cmPref ? g.cmPref.get('cmv3_port_' + k) : null; return v == null ? def : v === '1'; }
  function setPrefEq(k, v) { if (g.cmPref) g.cmPref.set('cmv3_port_' + k, v ? '1' : '0'); }
  function base() { return SERVIDOR; }
  function activo() { var c = cfg(); return !!(c.on && TEMA_OK.test(c.topic || '') && prefEq('eq', true)); }
  function enPanel() { return d.body && !d.body.classList.contains('pub') && (!CM.sesionOk || CM.sesionOk()); }

  /* ---------- sonido (Web Audio: no necesita archivos) ---------- */
  var AC = null;
  function ac() { if (!AC) { try { AC = new (g.AudioContext || g.webkitAudioContext)(); } catch (e) { AC = null; } } if (AC && AC.state === 'suspended') try { AC.resume(); } catch (e) { /* nada */ } return AC; }
  ['pointerdown', 'keydown'].forEach(function (ev) { d.addEventListener(ev, function () { if (activo()) ac(); }, { passive: true }); });
  function tono(notas, vol) {
    var c = ac(); if (!c) return; var t0 = c.currentTime + 0.02;
    notas.forEach(function (n) { var o = c.createOscillator(), gn = c.createGain(); o.type = n[3] || 'sine'; o.frequency.value = n[0]; gn.gain.setValueAtTime(0.0001, t0 + n[1]); gn.gain.exponentialRampToValueAtTime(vol || 0.28, t0 + n[1] + 0.02); gn.gain.exponentialRampToValueAtTime(0.0001, t0 + n[1] + n[2]); o.connect(gn).connect(c.destination); o.start(t0 + n[1]); o.stop(t0 + n[1] + n[2] + 0.05); });
  }
  function sonar(a) {
    if (a.urg) tono([[988, 0, 0.22, 'square'], [740, 0.25, 0.22, 'square'], [988, 0.5, 0.22, 'square'], [740, 0.75, 0.22, 'square']], 0.22);
    else tono([[659, 0, 0.9], [523, 0.45, 1.2]], 0.3);   /* «din-don» */
    if (g.navigator.vibrate) try { g.navigator.vibrate(a.urg ? [300, 120, 300, 120, 300] : [200, 100, 200]); } catch (e) { /* nada */ }
  }

  /* ---------- conexión al canal ---------- */
  function temas() { var c = cfg(), t = [c.topic, c.topic + '-c']; if (TEMA_OK.test(c.qr || '')) t.push(c.qr, c.qr + '-r'); return t; }
  function conectar() {
    var quiere = activo() && enPanel() && !!g.EventSource, clave = quiere ? temas().join(',') : '';
    if (clave === P.clave) return; P.clave = clave;
    if (P.es) { P.es.close(); P.es = null; }
    if (!quiere) { P.estado = 'apagado'; pintarEstado(); return; }
    P.estado = 'conectando'; pintarEstado();
    var es = P.es = new g.EventSource(base() + '/' + temas().map(encodeURIComponent).join(',') + '/sse?since=60s');
    es.onopen = function () { g.clearTimeout(P.tErr); P.tErr = 0; P.estado = 'ok'; pintarEstado(); };
    /* EventSource reconecta solo: sólo se avisa si pasan unos segundos sin volver a conectar */
    es.onerror = function () { if (P.es !== es || P.tErr) return; P.tErr = g.setTimeout(function () { P.tErr = 0; if (P.es === es && es.readyState !== 1) { P.estado = 'reconectando'; pintarEstado(); } }, 6000); };
    es.onmessage = function (ev) { try { recibir(JSON.parse(ev.data)); } catch (e) { /* mensaje ajeno */ } };
  }
  CM.porteroConectar = conectar;
  function cuerpo(m) { try { var p = JSON.parse(m.message); return p && typeof p === 'object' ? p : null; } catch (e) { return null; } }
  function recibir(m) {
    if (!m || (m.event && m.event !== 'message') || !m.id || P.vistos[m.id]) return;
    P.vistos[m.id] = 1; P.ultimoMsg = Date.now();
    if (m.time && Date.now() / 1000 - m.time > 120) return;   /* lo viejo no vuelve a sonar */
    var c = cfg(), p = cuerpo(m), ev = c.ev || {};
    if (m.topic === c.topic + '-c' || m.topic === c.qr + '-r') { if (p && p.type === 'reply' && p.id) respondida(p.id, p.code, p.text); return; }
    if (m.topic === c.qr) { if (p && p.type === 'ring' && ev.timbre !== false) nueva({ id: String(p.id || m.id).slice(0, 40), via: 'qr', tit: '🔔 Timbre' + (p.msg ? ' · ' + String(p.msg).slice(0, 60) : ''), txt: (p.name ? String(p.name).slice(0, 40) + ' está' : 'Hay alguien') + ' en la puerta (tocó desde su celular).', resp: true }); return; }
    if (m.topic !== c.topic) return;
    var tit = String(m.title || '').slice(0, 120), txt = String(m.message || '').slice(0, 300), acts = m.actions || [], rid = '';
    acts.some(function (a) { try { var b = JSON.parse(a.body || '{}'); if (b.type === 'reply' && b.id) { rid = String(b.id).slice(0, 40); return true; } } catch (e) { /* nada */ } return false; });
    if (/^🔔/.test(tit) || rid) { if (ev.timbre !== false) nueva({ id: rid || m.id, via: 'puerta', tit: tit || '🔔 Timbre', txt: txt.replace(/\s*Respond[ée] con los botones\.?$/, ''), resp: !!rid }); return; }
    if (/^✅/.test(tit)) { CM.toast('Portero: ' + tit.replace(/^✅\s*/, '') + ' — el aviso llegó al sistema.'); return; }
    var urg = (m.priority || 3) >= 5 || /^🚨/.test(tit);
    if (urg ? ev.alertas !== false : ev.otros !== false) nueva({ id: m.id, via: 'alerta', tit: tit || 'Aviso del portero', txt: txt, resp: false, urg: urg });
  }

  /* ---------- alertas en pantalla ---------- */
  function caja() { var b = d.getElementById('porteroAlertas'); if (!b) { b = d.createElement('div'); b.id = 'porteroAlertas'; b.className = 'pt-box'; b.setAttribute('aria-live', 'assertive'); d.body.appendChild(b); } return b; }
  function nueva(a) {
    if (P.alertas.some(function (x) { return x.id === a.id; })) return;   /* el mismo timbre por QR llega dos veces: una sola alerta */
    a.ts = Date.now(); a.hora = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }); a.estado = 'sonando';
    P.alertas.unshift(a); if (P.alertas.length > 5) P.alertas.length = 5;
    if (prefEq('son', true)) { sonar(a); a.rep = 1; a.timer = g.setInterval(function () { if (a.estado !== 'sonando' || a.rep >= (a.urg ? 10 : 6)) { g.clearInterval(a.timer); return; } a.rep++; sonar(a); }, a.urg ? 2500 : 4000); }
    a.fin = g.setTimeout(function () { quitar(a.id); }, a.urg ? 15 * 60000 : 4 * 60000);
    if (CM.audit) CM.audit('Portero', (a.urg ? 'Alerta: ' : a.via === 'alerta' ? 'Aviso: ' : 'Timbre: ') + a.tit.replace(/^\W+\s*/, ''));
    notificar(a); pintar();
  }
  function quitar(id) { P.alertas = P.alertas.filter(function (a) { if (a.id === id) { g.clearInterval(a.timer); g.clearTimeout(a.fin); return false; } return true; }); pintar(); }
  function respondida(id, code, text) {
    var a = P.alertas.filter(function (x) { return x.id === id; })[0]; if (!a) return;
    a.estado = 'resp'; a.resTxt = RESP[code] || text || 'Respondido'; a.resPor = a.resPor || 'otra persona'; g.clearInterval(a.timer);
    g.clearTimeout(a.fin); a.fin = g.setTimeout(function () { quitar(id); }, 25000); pintar();
  }
  function pintar() {
    var b = caja(), url = cfg().url || URL_DEF;
    b.innerHTML = P.alertas.map(function (a) {
      return '<section class="pt-al' + (a.urg ? ' urg' : '') + (a.estado === 'resp' ? ' resp' : '') + '" role="alertdialog" aria-labelledby="pt-t-' + esc(a.id) + '" data-id="' + esc(a.id) + '">' +
        '<div class="pt-h"><span class="pt-ic" aria-hidden="true">' + (a.urg ? '🚨' : a.via === 'alerta' ? '⚠️' : '🔔') + '</span><b id="pt-t-' + esc(a.id) + '">' + esc(a.tit.replace(/^[🔔🚨⚠️✅]\s*/u, '')) + '</b><small>' + esc(a.hora) + (a.via === 'qr' ? ' · por QR' : '') + '</small>' +
        '<button type="button" class="pt-x" data-act="pt-cerrar" data-id="' + esc(a.id) + '" aria-label="Cerrar el aviso">×</button></div>' +
        '<p>' + esc(a.txt) + '</p>' +
        (a.estado === 'resp' ? '<p class="pt-ok">✓ Respondió ' + esc(a.resPor) + ': <b>' + esc(a.resTxt) + '</b></p>' : '') +
        '<div class="pt-b">' + (a.resp && a.estado !== 'resp' ? Object.keys(RESP).map(function (k) { return '<button type="button" class="btn sm' + (k === 'voy' ? ' pri' : '') + '" data-act="pt-resp" data-id="' + esc(a.id) + '" data-c="' + k + '">' + RESP[k] + '</button>'; }).join('') : '') +
        '<a class="btn sm" href="' + esc(url) + '" target="portero_cnb" rel="noopener" data-act="pt-abrir" data-id="' + esc(a.id) + '">Abrir portero ↗</a>' +
        (a.estado === 'sonando' && prefEq('son', true) ? '<button type="button" class="btn sm" data-act="pt-silenciar" data-id="' + esc(a.id) + '">Silenciar</button>' : '') + '</div></section>';
    }).join('');
  }
  function publicar(tema, obj) { return g.fetch(base() + '/' + encodeURIComponent(tema), { method: 'POST', body: JSON.stringify(obj) }).then(function (r) { return r.ok; }, function () { return false; }); }
  function responder(id, code) {
    var a = P.alertas.filter(function (x) { return x.id === id; })[0], c = cfg(); if (!a || !RESP[code]) return Promise.resolve(false);
    a.estado = 'enviando'; g.clearInterval(a.timer); pintar();
    var envs = [publicar(c.topic + '-c', { type: 'reply', id: id, code: code })];
    if (a.via === 'qr' && TEMA_OK.test(c.qr || '')) envs.push(publicar(c.qr + '-r', { type: 'reply', id: id, code: code, text: RESP_VISITA[code] }));   /* llega a la visita aunque el portero esté apagado */
    return Promise.all(envs).then(function (r) {
      var ok = r.some(Boolean);
      if (ok) { a.resPor = (CM.db.cfg && CM.db.cfg.operador) || 'vos'; respondida(id, code); CM.audit('Portero', 'Respuesta al timbre: ' + RESP[code]); CM.save(); }
      else { a.estado = 'sonando'; pintar(); CM.toast('No se pudo responder: revisá la conexión a internet.', true); }
      return ok;
    });
  }
  CM.porteroResponder = responder;
  CM.acts['pt-resp'] = function (t) { responder(t.getAttribute('data-id'), t.getAttribute('data-c')); };
  CM.acts['pt-cerrar'] = function (t) { quitar(t.getAttribute('data-id')); };
  CM.acts['pt-silenciar'] = function (t) { var a = P.alertas.filter(function (x) { return x.id === t.getAttribute('data-id'); })[0]; if (a) { a.estado = 'silencio'; g.clearInterval(a.timer); pintar(); } };
  CM.acts['pt-abrir'] = function (t) { var a = P.alertas.filter(function (x) { return x.id === t.getAttribute('data-id'); })[0]; if (a && a.estado === 'sonando') { a.estado = 'silencio'; g.clearInterval(a.timer); } g.open(cfg().url || URL_DEF, 'portero_cnb', 'noopener'); pintar(); };

  /* ---------- notificación del equipo (pestaña en segundo plano o minimizada) ---------- */
  function notificar(a) {
    if (!('Notification' in g) || g.Notification.permission !== 'granted' || !prefEq('not', true)) return;
    if (!d.hidden && d.hasFocus && d.hasFocus()) return;   /* con el sistema a la vista alcanza la alerta */
    var c = cfg(), op = { body: a.txt, tag: 'portero-' + a.id, renotify: true, requireInteraction: true, icon: 'assets/icon-192.png', badge: 'assets/favicon.png',
      data: { id: a.id, via: a.via, url: c.url || URL_DEF, reply: a.resp ? base() + '/' + encodeURIComponent(c.topic + '-c') : '', replyQr: a.via === 'qr' && TEMA_OK.test(c.qr || '') ? base() + '/' + encodeURIComponent(c.qr + '-r') : '' } };
    if (g.navigator.serviceWorker && g.navigator.serviceWorker.controller) {
      op.actions = (a.resp ? [{ action: 'voy', title: 'Ya voy' }] : []).concat([{ action: 'abrir', title: 'Abrir portero' }]);
      g.navigator.serviceWorker.ready.then(function (r) { r.showNotification(a.tit, op); }).catch(function () { /* nada */ });
      return;
    }
    try { var n = new g.Notification(a.tit, op); n.onclick = function () { try { g.focus(); } catch (e) { /* nada */ } n.close(); }; } catch (e) { /* nada */ }
  }
  /* el service worker avisa cuando se respondió o se tocó la notificación */
  if (g.navigator.serviceWorker) g.navigator.serviceWorker.addEventListener('message', function (ev) {
    var x = ev.data && ev.data.portero; if (!x) return;
    if (x.respondida) { var a = P.alertas.filter(function (y) { return y.id === x.id; })[0]; if (a) { a.resPor = (CM.db.cfg && CM.db.cfg.operador) || 'vos'; respondida(x.id, x.code); } }
  });

  /* ---------- estado y configuración ---------- */
  function pintarEstado() {
    var e = d.getElementById('ptEstado'); if (!e) return;
    var t = { ok: ['p-ok', 'Escuchando el portero en este equipo'], conectando: ['p-warn', 'Conectando…'], reconectando: ['p-warn', 'Sin conexión: reintentando'], apagado: ['p-mu', activo() ? 'Apagado' : (cfg().on && TEMA_OK.test(cfg().topic || '') ? 'Apagado en este equipo' : 'Sin configurar')] }[P.estado] || ['p-mu', ''];
    e.className = 'pill ' + t[0]; e.textContent = t[1];
  }
  function leerPorteroLocal() { try { var s = JSON.parse(g.localStorage.getItem('cnb_set') || 'null'); if (!s) return null; return { topic: (s.notif && s.notif.ntfy && s.notif.ntfy.topic) || '', qr: (s.qr && s.qr.topic) || '', ntfyOn: !!(s.notif && s.notif.ntfy && s.notif.ntfy.on), server: (s.notif && s.notif.ntfy && s.notif.ntfy.server) || '' }; } catch (e) { return null; } }
  function cfgCard() {
    var c = cfg(), ev = c.ev || {}, adm = CM.can('ajustes', 'admin'), loc = adm ? leerPorteroLocal() : null, perm = 'Notification' in g ? g.Notification.permission : 'no';
    return '<section class="card" id="ptCfg" style="margin-top:14px"><h2>Portero digital</h2>' +
      '<p class="hint" style="margin:0 0 6px">Cuando tocan el timbre del portero (en la puerta o por QR) o hay una emergencia, el sistema suena y muestra una alerta en cualquier pantalla, con <b>Ya voy · Un momento · No podemos</b> y <b>Abrir portero</b>. Las respuestas se ven en la pantalla del portero y en el celular de la visita.</p>' +
      '<div class="row" style="margin:4px 0 8px"><span id="ptEstado" class="pill p-mu" role="status"></span></div>' +
      (adm ? '<form class="f" data-form="portero-cfg" autocomplete="off" novalidate>' +
        '<label class="chk"><input type="checkbox" name="on"' + (c.on ? ' checked' : '') + '><span>Recibir el portero en el sistema (todos los equipos del personal)</span></label>' +
        '<div class="f f2">' + fl('Tema de avisos del portero (Panel del portero → Avisos al celular)', '<input class="in" name="topic" maxlength="64" spellcheck="false" autocapitalize="off" value="' + esc(c.topic || '') + '" placeholder="cnb-…">') +
        fl('Tema del timbre por QR (opcional: Panel del portero → Timbre por QR)', '<input class="in" name="qr" maxlength="64" spellcheck="false" autocapitalize="off" value="' + esc(c.qr || '') + '" placeholder="cnb-…">') + '</div>' +
        fl('Dirección del portero (para «Abrir portero»)', '<input class="in" name="url" value="' + esc(c.url || URL_DEF) + '">') +
        '<fieldset class="f"><legend>Qué avisa el sistema</legend><label class="chk"><input type="checkbox" name="evT"' + (ev.timbre !== false ? ' checked' : '') + '><span>Timbre (en la puerta y por QR)</span></label><label class="chk"><input type="checkbox" name="evA"' + (ev.alertas !== false ? ' checked' : '') + '><span>Emergencias y alerta silenciosa</span></label><label class="chk"><input type="checkbox" name="evO"' + (ev.otros !== false ? ' checked' : '') + '><span>Otros avisos (intentos fallidos, fuera de horario)</span></label></fieldset>' +
        '<p class="hint" style="margin:0">Servidor de avisos: ' + SERVIDOR + ' (el mismo que usa el portero de fábrica). El tema funciona como una contraseña: sólo lo ve el personal del sistema. El portero tiene que tener activadas las «Notificaciones push» y quedar encendido con internet.</p>' +
        (loc && TEMA_OK.test(loc.topic) && loc.topic !== c.topic ? '<div class="note info">En este navegador está configurado el portero. <button type="button" class="btn sm" data-act="pt-traer">Traer sus temas</button></div>' : '') +
        '<p class="err" role="alert" data-err></p><div class="row"><button class="btn pri" type="submit">Guardar portero</button></div></form>' : '<p class="hint">El tema del portero lo carga un administrador.</p>') +
      '<div class="card flat" style="margin-top:10px"><b>En este equipo</b><div class="row" style="margin-top:8px">' +
        '<button type="button" class="btn sm" data-act="pt-eq" aria-pressed="' + prefEq('eq', true) + '">' + (prefEq('eq', true) ? '✓ Recibir el portero acá' : 'No recibir acá') + '</button>' +
        '<button type="button" class="btn sm" data-act="pt-son" aria-pressed="' + prefEq('son', true) + '">' + (prefEq('son', true) ? '🔊 Con sonido' : '🔇 Sin sonido') + '</button>' +
        (perm === 'no' ? '' : perm === 'granted' ? '<button type="button" class="btn sm" data-act="pt-not" aria-pressed="' + prefEq('not', true) + '">' + (prefEq('not', true) ? '✓ Notificaciones del equipo' : 'Notificaciones apagadas') + '</button>' : perm === 'denied' ? '<span class="hint">Las notificaciones están bloqueadas en este navegador (se habilitan desde el candado de la barra de direcciones).</span>' : '<button type="button" class="btn sm" data-act="pt-perm">Activar notificaciones del equipo</button>') +
        '<button type="button" class="btn sm" data-act="pt-prueba">Probar alerta (sólo acá)</button></div>' +
        '<p class="hint" style="margin:8px 0 0">Para que suene, el sistema tiene que estar abierto (puede quedar en otra pestaña o minimizado). Con las notificaciones del equipo activadas, el aviso aparece aunque estés en otro programa y trae «Ya voy» y «Abrir portero».</p></div></section>';
  }
  var vAj = CM.VIEWS.ajustes;
  CM.VIEWS.ajustes = function () { var h = vAj.apply(this, arguments), i = h.indexOf('<section class="card" style="margin-top:14px"><h2>Sobre esta versión'); return i > 0 ? h.slice(0, i) + cfgCard() + h.slice(i) : h + cfgCard(); };
  CM.acts['pt-traer'] = function () {
    var l = leerPorteroLocal(), f = d.querySelector('form[data-form="portero-cfg"]'); if (!l || !f) return;
    f.elements.topic.value = l.topic; if (TEMA_OK.test(l.qr)) f.elements.qr.value = l.qr; f.elements.on.checked = true;
    f.elements.topic.dispatchEvent(new Event('input', { bubbles: true }));
    CM.toast(l.ntfyOn ? 'Temas cargados: revisá y guardá.' : 'Temas cargados. Ojo: en el portero las «Notificaciones push» están apagadas; activalas en su panel.', !l.ntfyOn);
  };
  CM.forms['portero-cfg'] = function (f) {
    if (!CM.need('ajustes', 'admin')) return;
    var e = f.elements, t = e.topic.value.trim(), q = e.qr.value.trim(), u = e.url.value.trim() || URL_DEF;
    if (e.on.checked && !TEMA_OK.test(t)) return U.fail(f, 'topic', 'El tema tiene entre 10 y 64 letras, números, guiones o guiones bajos (copialo del panel del portero).');
    if (q && !TEMA_OK.test(q)) return U.fail(f, 'qr', 'El tema del QR tiene entre 10 y 64 letras, números o guiones.');
    if (q && q === t) return U.fail(f, 'qr', 'El tema del QR es distinto del de avisos.');
    if (!/^https:\/\/[^\s"'<>]+$/.test(u)) return U.fail(f, 'url', 'La dirección del portero empieza con https://');
    CM.db.ong.portero = { on: e.on.checked, topic: t, qr: q, url: u, server: SERVIDOR, ev: { timbre: e.evT.checked, alertas: e.evA.checked, otros: e.evO.checked } };
    CM.audit('Portero', 'Configuración del portero ' + (e.on.checked ? 'activada' : 'desactivada') + (q ? ' · con timbre por QR' : ''));   /* el tema no va a la auditoría */
    CM.save(); CM.toast('Portero guardado.'); CM.render();
  };
  CM.acts['pt-eq'] = function () { setPrefEq('eq', !prefEq('eq', true)); conectar(); CM.render(); };
  CM.acts['pt-son'] = function () { setPrefEq('son', !prefEq('son', true)); if (prefEq('son', true)) tono([[659, 0, 0.5], [523, 0.3, 0.7]], 0.25); CM.render(); };
  CM.acts['pt-not'] = function () { setPrefEq('not', !prefEq('not', true)); CM.render(); };
  CM.acts['pt-perm'] = function () { if (!('Notification' in g)) return; g.Notification.requestPermission().then(function (r) { if (r === 'granted') { setPrefEq('not', true); CM.toast('Notificaciones activadas en este equipo.'); } CM.render(); }); };
  CM.acts['pt-prueba'] = function () { ac(); nueva({ id: 'prueba-' + Date.now().toString(36), via: 'prueba', tit: '🔔 Timbre · Prueba', txt: 'Así se ve y suena el aviso del portero en este equipo. Los botones de respuesta no envían nada en la prueba.', resp: false }); };

  CM.afterRender = (function (prev) { return function (r) { if (prev) prev(r); try { conectar(); pintarEstado(); if (!enPanel()) { P.alertas.forEach(function (a) { g.clearInterval(a.timer); }); P.alertas = []; pintar(); } } catch (e) { /* nunca bloquear la pantalla */ } }; })(CM.afterRender);
  g.setInterval(function () { try { conectar(); } catch (e) { /* nada */ } }, 15000);
  g.addEventListener('online', function () { P.clave = ''; conectar(); });
})(window);
