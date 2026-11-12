/* Sistema VB ONG · Impresora térmica directa (ESC/POS), corte del papel y cajón de dinero · 2026-11-11
   Adaptado del Sistema RAVE (V26.49, 4.34 H2/H4) a la ONG:
   · Conexión desde Periféricos y ticket: USB (WebUSB), puerto serie / USB-serie (Web Serial) o Bluetooth (Web Bluetooth),
     en Chrome o Edge. El navegador pide elegir el dispositivo una vez; después se reconecta solo en ese equipo.
     Sin impresora conectada, todo se imprime con el diálogo del navegador como hasta ahora.
   · Corte del papel: parcial (GS V 66), total (GS V 65) o sin corte. Texto en página de códigos PC850 (acentos y ñ).
   · Cajón: pulso ESC p por la impresora (pin 2 o 5). Se abre después de una donación con efectivo (o siempre / nunca,
     según Configuración del ticket) y con el botón «Abrir cajón» de la caja. Cada apertura queda en la auditoría.
   [VERIFICAR con la impresora y el cajón reales: pendiente de prueba física] */
(function (g) {
  'use strict';
  var CM = g.CM, esc = CM.esc, U = CM.U, fl = U.fl, opt = U.opt, VIEWS = CM.VIEWS, n = g.navigator;
  var render = function () { CM.render(); };
  var DEV = { kind: '', name: '', h: null };     /* conexión viva (sólo en memoria de este equipo) */
  var LS = 'cmv3_tk_dev';

  CM.tkCfg = function () {
    var t = (CM.db.cfg && CM.db.cfg.ticket) || {};
    return { ancho: t.ancho === 58 ? 58 : 80, corte: t.corte === 'total' || t.corte === 'no' ? t.corte : 'parcial', cajon: t.cajon === 'siempre' || t.cajon === 'no' ? t.cajon : 'efectivo', pin: t.pin === 5 ? 5 : 2 };
  };
  CM.tkConectada = function () { return !!DEV.h; };
  CM.tkNombre = function () { return DEV.h ? DEV.name : ''; };

  /* ---------- codificación ---------- */
  var PC850 = { 'á': 0xA0, 'é': 0x82, 'í': 0xA1, 'ó': 0xA2, 'ú': 0xA3, 'ñ': 0xA4, 'Ñ': 0xA5, 'ü': 0x81, 'Ü': 0x9A, '¿': 0xA8, '¡': 0xAD, 'º': 0xA7, 'ª': 0xA6, 'Á': 0xB5, 'É': 0x90, 'Í': 0xD6, 'Ó': 0xE0, 'Ú': 0xE9, '°': 0xF8, '·': 0xFA, '×': 0x9E };
  function enc(s) {
    var o = []; String(s).split('').forEach(function (ch) {
      var c = ch.charCodeAt(0);
      if (c < 128) o.push(c); else if (PC850[ch] != null) o.push(PC850[ch]); else if (ch === '−' || ch === '–' || ch === '—') o.push(45); else if (ch === '…') o.push(46, 46, 46); else if (ch === '$') o.push(36); else o.push(63);
    });
    return o;
  }
  function cutBytes() { var c = CM.tkCfg().corte; return c === 'no' ? [10, 10, 10, 10] : [10, 10, 10, 0x1d, 0x56, c === 'total' ? 0x41 : 0x42, 0]; }
  function drawerBytes() { return [0x1b, 0x70, CM.tkCfg().pin === 5 ? 1 : 0, 0x19, 0xfa]; }
  CM.escposTexto = function (texto) {
    var W = CM.tkCfg().ancho === 58 ? 32 : 42, o = [0x1b, 0x40, 0x1b, 0x74, 0x02];
    String(texto).split('\n').forEach(function (l) {
      if (!l.length) { o.push(10); return; }
      for (var i = 0; i < l.length; i += W) { enc(l.slice(i, i + W)).forEach(function (b) { o.push(b); }); o.push(10); }
    });
    cutBytes().forEach(function (b) { o.push(b); });
    return new Uint8Array(o);
  };

  /* ---------- envío ---------- */
  function enviar(bytes) {
    var h = DEV.h; if (!h) return Promise.reject(new Error('No hay impresora conectada'));
    if (DEV.kind === 'usb') { var p = Promise.resolve(); for (var i = 0; i < bytes.length; i += 1024) (function (s) { p = p.then(function () { return h.dev.transferOut(h.ep, s); }); })(bytes.slice(i, i + 1024)); return p; }
    if (DEV.kind === 'serial') { var w = h.port.writable.getWriter(); return w.write(bytes).then(function () { w.releaseLock(); }, function (e) { w.releaseLock(); throw e; }); }
    if (DEV.kind === 'ble') { var q = Promise.resolve(); for (var j = 0; j < bytes.length; j += 100) (function (s) { q = q.then(function () { return h.ch.writeValueWithoutResponse(s); }).then(function () { return new Promise(function (r) { setTimeout(r, 20); }); }); })(bytes.slice(j, j + 100)); return q; }
    return Promise.reject(new Error('Conexión no soportada'));
  }
  /* imprime texto plano: por la térmica si está conectada; si no, con el diálogo del navegador */
  CM.ticketImprimir = function (titulo, texto) {
    if (DEV.h) return enviar(CM.escposTexto(texto)).then(function () { CM.audit('Impresión', titulo + ' · ' + DEV.name); CM.save(); CM.toast('Enviado a ' + DEV.name + '.'); }, function (e) { CM.toast('No se pudo imprimir en la térmica: ' + (e.message || e) + '. Se abre la impresión del navegador.', true); CM.imprimir('<pre class="tk tkp tk' + CM.tkCfg().ancho + '">' + esc(texto) + '</pre>'); });
    CM.imprimir('<pre class="tk tkp tk' + CM.tkCfg().ancho + '">' + esc(texto) + '</pre>');
    return Promise.resolve();
  };
  CM.abrirCajon = function (motivo, silencioso) {
    if (!DEV.h) { if (!silencioso) CM.toast('El cajón se abre a través de la impresora térmica: conectala en Periféricos y ticket.', true); return Promise.resolve(false); }
    return enviar(new Uint8Array([0x1b, 0x40].concat(drawerBytes()))).then(function () { CM.audit('Cajón abierto', (motivo || 'sin donación') + ' · ' + (CM.db.cfg.operador || '')); CM.save(); if (!silencioso) CM.toast('Cajón abierto (queda en la auditoría).'); return true; }, function (e) { CM.toast('No se pudo abrir el cajón: ' + (e.message || e), true); return false; });
  };
  /* después de registrar una donación: abre el cajón si corresponde */
  CM.cajonTrasDonacion = function (a) {
    var c = CM.tkCfg().cajon; if (!a || c === 'no' || !DEV.h) return;
    var ef = CM.partesAporte(a).some(function (x) { return x.m === 'efectivo' && x.a > 0; }) || a.cambio > 0;
    if (c === 'siempre' || ef) CM.abrirCajon('donación ' + a.id, true);
  };

  /* ---------- conexión ---------- */
  function usbAbrir(dev) {
    return dev.open().then(function () { return dev.configuration === null ? dev.selectConfiguration(1) : null; }).then(function () {
      var ep = null, ifn = null;
      dev.configuration.interfaces.forEach(function (i) { var a = i.alternates[0]; if (ifn !== null && a.interfaceClass !== 7) return; var out = a.endpoints.filter(function (e) { return e.direction === 'out'; })[0]; if (out && (ifn === null || a.interfaceClass === 7)) { ep = out.endpointNumber; ifn = i.interfaceNumber; } });
      if (ifn === null) throw new Error('el dispositivo no tiene salida de datos');
      return dev.claimInterface(ifn).then(function () { return { dev: dev, ep: ep }; });
    });
  }
  function listo(kind, name, h, idGuardado) { DEV.kind = kind; DEV.name = name; DEV.h = h; try { g.localStorage.setItem(LS, JSON.stringify({ kind: kind, id: idGuardado || '' })); } catch (e) { /* sin almacenamiento */ } render(); }
  CM.acts['tk-usb'] = function () {
    if (!n.usb) return CM.toast('Este navegador no tiene WebUSB: usá Chrome o Edge en una computadora o Android.', true);
    n.usb.requestDevice({ filters: [] }).then(function (dev) {
      return usbAbrir(dev).then(function (h) { listo('usb', ((dev.manufacturerName || '') + ' ' + (dev.productName || 'Impresora USB')).trim(), h, dev.vendorId + ':' + dev.productId); CM.audit('Impresora térmica conectada', DEV.name + ' (USB)'); CM.save(); CM.toast('Impresora conectada: ' + DEV.name); });
    }).catch(function (e) { if (e && e.name === 'NotFoundError') return; CM.toast('No se pudo abrir por USB: ' + (e.message || e) + '. Si Windows ya usa la impresora con su driver, probá «Puerto serie» o imprimí con el navegador.', true); });
  };
  CM.acts['tk-serie'] = function () {
    if (!n.serial) return CM.toast('Este navegador no tiene Web Serial: usá Chrome o Edge en una computadora.', true);
    var baud = +(document.getElementById('tkBaud') || { value: 9600 }).value || 9600;
    n.serial.requestPort().then(function (port) { return port.open({ baudRate: baud }).then(function () { listo('serial', 'Impresora (serie ' + baud + ')', { port: port }, String(baud)); CM.audit('Impresora térmica conectada', 'puerto serie ' + baud); CM.save(); CM.toast('Puerto conectado.'); }); })
      .catch(function (e) { if (e && e.name === 'NotFoundError') return; CM.toast('No se pudo abrir el puerto: ' + (e.message || e), true); });
  };
  CM.acts['tk-ble'] = function () {
    if (!n.bluetooth) return CM.toast('Este navegador no tiene Web Bluetooth (en iPhone/iPad no existe).', true);
    n.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2'] }).then(function (dev) {
      return dev.gatt.connect().then(function (srv) { return srv.getPrimaryServices(); }).then(function (ss) {
        var p = Promise.resolve(null);
        ss.forEach(function (s) { p = p.then(function (ch) { return ch || s.getCharacteristics().then(function (cs) { return cs.filter(function (c) { return c.properties.writeWithoutResponse || c.properties.write; })[0] || null; }); }); });
        return p;
      }).then(function (ch) { if (!ch) throw new Error('no tiene canal de escritura'); listo('ble', dev.name || 'Impresora Bluetooth', { ch: ch }); CM.audit('Impresora térmica conectada', DEV.name + ' (Bluetooth)'); CM.save(); });
    }).catch(function (e) { if (e && e.name === 'NotFoundError') return; CM.toast('No se pudo conectar por Bluetooth: ' + (e.message || e) + ' [VERIFICAR compatibilidad del modelo]', true); });
  };
  CM.acts['tk-quitar'] = function () {
    try { if (DEV.kind === 'usb') DEV.h.dev.close(); if (DEV.kind === 'serial') DEV.h.port.close(); } catch (e) { /* ya cerrada */ }
    DEV.kind = ''; DEV.name = ''; DEV.h = null; try { g.localStorage.removeItem(LS); } catch (e) { /* nada */ } render();
  };
  CM.acts['tk-probar'] = function () {
    var w = CM.tkCfg().ancho === 58 ? 32 : 42, r = '-'.repeat(w);
    CM.ticketImprimir('Ticket de prueba', ['FUNDACION CANNABISMATICA I+D', r, 'Prueba de impresora térmica', 'Ancho: ' + CM.tkCfg().ancho + ' mm (' + w + ' caracteres)', 'Acentos: á é í ó ú ñ Ñ ¿ ¡', 'Corte: ' + CM.tkCfg().corte, r, 'Desarrollado por VINCULAR BUSINESS'].join('\n'));
  };
  CM.acts['tk-cajon'] = function () { if (!CM.need('caja', 'oper')) return; CM.abrirCajon('sin donación'); };
  /* reconexión automática a lo que el navegador ya tiene permitido en este equipo */
  function reconectar() {
    var s = null; try { s = JSON.parse(g.localStorage.getItem(LS) || 'null'); } catch (e) { s = null; }
    if (!s) return;
    if (s.kind === 'usb' && n.usb && n.usb.getDevices) n.usb.getDevices().then(function (ds) { var d = ds.filter(function (x) { return x.vendorId + ':' + x.productId === s.id; })[0]; if (d) usbAbrir(d).then(function (h) { listo('usb', ((d.manufacturerName || '') + ' ' + (d.productName || 'Impresora USB')).trim(), h, s.id); }).catch(function () { /* queda sin conectar */ }); });
    if (s.kind === 'serial' && n.serial && n.serial.getPorts) n.serial.getPorts().then(function (ps) { if (ps[0]) ps[0].open({ baudRate: +s.id || 9600 }).then(function () { listo('serial', 'Impresora (serie ' + (+s.id || 9600) + ')', { port: ps[0] }, s.id); }).catch(function () { /* ocupado */ }); });
  }
  setTimeout(reconectar, 1500);

  /* ---------- configuración y tarjeta en Periféricos ---------- */
  CM.forms['tk-cfg'] = function (f) {
    if (!CM.need('perifericos', 'edit')) return;
    var e = f.elements;
    CM.db.cfg.ticket = { ancho: +e.ancho.value === 58 ? 58 : 80, corte: e.corte.value, cajon: e.cajon.value, pin: +e.pin.value === 5 ? 5 : 2 };
    CM.audit('Ajustes del ticket', 'ancho ' + CM.db.cfg.ticket.ancho + ' mm · corte ' + CM.db.cfg.ticket.corte + ' · cajón ' + CM.db.cfg.ticket.cajon + ' (pin ' + CM.db.cfg.ticket.pin + ')');
    CM.save(); render(); CM.toast('Ajustes del ticket guardados.');
  };
  function tarjeta() {
    var c = CM.tkCfg();
    return '<section class="card" style="margin-top:14px" id="tkCard"><div class="row sp"><h2>Impresora térmica directa, corte y cajón</h2>' + (DEV.h ? '<span class="pill p-ok">Conectada: ' + esc(DEV.name) + '</span>' : '<span class="pill p-mu">Sin conectar (se usa la impresión del navegador)</span>') + '</div>' +
      '<p class="hint" style="margin:4px 0 10px">Conectá la impresora de tickets una vez en este equipo. Los cortes X, los cierres y los tickets salen directo, con corte de papel; el cajón se abre por la impresora. <b>Pendiente de prueba física</b> con el modelo real.</p>' +
      '<div class="row"><button class="btn" data-act="tk-usb">' + CM.icon('plug') + 'USB</button><label class="sr" for="tkBaud">Velocidad del puerto serie</label><select id="tkBaud" class="in fx" style="max-width:120px">' + [9600, 19200, 38400, 57600, 115200].map(function (b) { return opt(String(b), b + ' baudios', b === 9600); }).join('') + '</select><button class="btn" data-act="tk-serie">Puerto serie</button><button class="btn" data-act="tk-ble">Bluetooth</button>' +
      (DEV.h ? '<button class="btn" data-act="tk-probar">' + CM.icon('print') + 'Imprimir prueba</button><button class="btn" data-act="tk-cajon">Abrir cajón</button><button class="btn sm" data-act="tk-quitar">Desconectar</button>' : '') + '</div>' +
      '<form class="f" data-form="tk-cfg" style="margin-top:12px" autocomplete="off"><div class="f f2">' +
      fl('Ancho del papel', '<select class="in" name="ancho">' + opt('80', '80 mm (42 caracteres)', c.ancho === 80) + opt('58', '58 mm (32 caracteres)', c.ancho === 58) + '</select>') +
      fl('Corte del papel', '<select class="in" name="corte">' + opt('parcial', 'Parcial', c.corte === 'parcial') + opt('total', 'Total', c.corte === 'total') + opt('no', 'Sin corte (avanza papel)', c.corte === 'no') + '</select>') +
      fl('Abrir el cajón', '<select class="in" name="cajon">' + opt('efectivo', 'Después de una donación con efectivo', c.cajon === 'efectivo') + opt('siempre', 'Después de toda donación', c.cajon === 'siempre') + opt('no', 'Nunca automáticamente', c.cajon === 'no') + '</select>') +
      fl('Pin del cajón', '<select class="in" name="pin">' + opt('2', 'Pin 2 (el más común)', c.pin === 2) + opt('5', 'Pin 5', c.pin === 5) + '</select>') + '</div>' +
      '<div class="row"><button class="btn pri" type="submit">Guardar ajustes del ticket</button></div></form></section>';
  }
  var vp = VIEWS.perifericos;
  if (vp) VIEWS.perifericos = function () { var h = vp.apply(this, arguments), i = h.indexOf('<div class="grid g2" style="margin-top:14px">'); return i > 0 ? h.slice(0, i) + tarjeta() + h.slice(i) : h + tarjeta(); };
  /* el botón «Imprimir ticket» de Periféricos usa la térmica si está conectada */
  var tkp = CM.acts['tk-print'];
  CM.acts['tk-print'] = function (t) { var pre = document.querySelector('.tkwrap pre.tk'); if (DEV.h && pre) return CM.ticketImprimir('Ticket', pre.textContent); return tkp && tkp(t); };
})(window);
