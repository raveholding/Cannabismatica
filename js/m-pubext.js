/* Sistema VB · Bloques comunes del menú público (igual en todos los sistemas VB; cada uno con su marca)
   - Club: «Así se ve tu tarjeta» (tarjeta de ejemplo con la meta de sellos y el beneficio).
   - Ubicación, mapa, reseñas y redes en paneles: mapa embebido de Google, «Cómo llegar», «Dejar / ver reseñas»
     (nunca reseñas inventadas) y redes con ícono, nombre y usuario.
   - Información legal: textos plegables (plantillas [VERIFICAR] con asesor legal) y Botón de arrepentimiento
     (apagado por defecto en una ONG: lo enciende el administrador si su asesor lo indica).
   Todo se edita en Administración → Menú público y pasa por borrador → publicación. Ningún dato personal. */
(function (g) {
  'use strict';
  var CM = g.CM, esc = CM.esc;

  /* ---------- textos legales base (plantillas para una ONG de salud) ---------- */
  function legalBase(c) {
    var nm = c.nombre || 'la organización', ad = [c.direccion, c.localidad].filter(Boolean).join(', '), wa = c.wa || '';
    return [
      { id: 'privacidad', on: true, title: 'Privacidad y datos de salud', titleEn: 'Privacy and health data', text:
'**¿Quién trata tus datos?**\n' + nm + ', ' + ad + '. Contacto: WhatsApp ' + wa + '. [Completar razón social, CUIT y número de inscripción de la base de datos].\n\n' +
'**¿Para qué?**\nPara tu legajo, tu historia clínica, el trámite REPROCANN, los turnos, las dispensaciones y las donaciones. Los datos de salud son datos sensibles: sólo los ve el equipo autorizado de la fundación y nunca se venden ni se ceden (Ley 25.326 [VERIFICAR con asesor legal]).\n\n' +
'**Tus derechos**\nPodés pedir ver, corregir o borrar tus datos escribiéndonos por WhatsApp. La Agencia de Acceso a la Información Pública (AAIP) es el órgano de control de la Ley 25.326.\n\n' +
'**Terceros que ve tu navegador**\nEste menú muestra un mapa de Google y usa tipografías de Google Fonts: Google puede recibir tu dirección IP al cargarlos. No usamos cookies publicitarias ni píxeles de seguimiento.' },
      { id: 'salud', on: true, title: 'Historia clínica, consentimiento y REPROCANN', titleEn: 'Medical record, consent and REPROCANN', text:
'**Marco legal**\nLa fundación acompaña a pacientes dentro del marco de la Ley 27.350 de investigación médica y científica del uso medicinal de la planta de cannabis y del Registro del Programa de Cannabis (REPROCANN) [VERIFICAR normativa vigente].\n\n' +
'**Consentimiento informado**\nAntes de cualquier dispensación se firma un consentimiento informado. Los formularios de este menú son una solicitud: el equipo verifica los datos antes de incorporarlos al legajo.\n\n' +
'**Menores de edad**\nLas solicitudes de menores las presenta su madre, padre o tutor/a legal [VERIFICAR con asesor legal].' },
      { id: 'donaciones', on: true, title: 'Donaciones voluntarias y servicios', titleEn: 'Voluntary donations and services', text:
'**Donaciones**\nLos importes que ves son donaciones voluntarias sugeridas para sostener las actividades de la fundación: no son precios de venta. Podés consultar por cualquier servicio aunque no puedas donar.\n\n' +
'**Comprobantes**\nCuando corresponda se emite el comprobante que exige la normativa fiscal [VERIFICAR con contador].' },
      { id: 'club', on: true, title: 'Club de socios/as', titleEn: 'Members club', text:
'**Participación**\nEl alta al club es voluntaria y para mayores de 18 años. Cada finalidad (club, comunicaciones, estadísticas) se acepta por separado y se puede revocar en cualquier momento.\n\n' +
'**Tarjeta**\nLa tarjeta de sellos es personal. Los beneficios y sus condiciones los define la fundación y pueden cambiar con aviso previo.' },
      { id: 'wifi', on: true, title: 'Wi-Fi para invitados', titleEn: 'Guest Wi-Fi', text:
'La red de invitados es gratuita, separada de la red de gestión y puede tener límites de uso. Al usarla te comprometés a no realizar actividades ilegales. [VERIFICAR texto con asesor legal].' },
      { id: 'arrepentimiento', on: true, title: 'Botón de arrepentimiento y defensa del consumidor', titleEn: 'Withdrawal button and consumer protection', text:
'**Botón de arrepentimiento**\nSi contrataste un servicio a distancia (por WhatsApp o canales digitales) podés revocarlo dentro de los 10 días corridos, sin costo (Ley 24.240, art. 34, y Resolución 424/2020 [VERIFICAR vigencia y alcance para una organización sin fines de lucro]).\n\n' +
'**Cómo pedirlo**\nTocá «Botón de arrepentimiento»: se abre WhatsApp con el pedido redactado. Te respondemos con un código de trámite.' }
    ];
  }
  CM.legalBase = legalBase;

  /* ---------- valores por defecto (no pisa nada cargado) ---------- */
  var fill0 = CM.menuFill;
  CM.menuFill = function (c) {
    c = fill0(c); if (!c) return c;
    c.club = c.club || { activo: true, version: 'v1.0' };
    if (c.club.meta === undefined) c.club.meta = (CM.db && CM.db.cfg && CM.db.cfg.sellosMeta) || 8;
    if (c.club.premio === undefined) c.club.premio = { es: 'Beneficio para socios/as que define la fundación', en: 'Member benefit set by the foundation' };
    if (c.club.tarjeta === undefined) c.club.tarjeta = true;
    c.ubic = c.ubic || { consulta: '', resena: '' };
    if (c.ubic.mapa === undefined) c.ubic.mapa = true;
    if (c.ubic.verResenas === undefined) c.ubic.verResenas = '';
    (c.redes || []).forEach(function (r) { if (r.handle === undefined) r.handle = ''; });
    if (!c.legal) c.legal = { arrep: false, docs: legalBase(c) };
    var ids = {}; c.legal.docs.forEach(function (d) { ids[d.id] = 1; });
    legalBase(c).forEach(function (d) { if (!ids[d.id]) c.legal.docs.push(d); });
    c.bloques = c.bloques || {};
    if (c.bloques.legal === undefined) c.bloques.legal = true;
    c.orden = c.orden || [];
    if (c.orden.indexOf('legal') < 0) c.orden.push('legal');
    return c;
  };

  /* ---------- utilidades ---------- */
  function md(t) { // **negrita** y párrafos; todo escapado
    return String(t || '').split(/\n{2,}/).map(function (p) {
      return '<p>' + esc(p).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }
  var ICO = { // íconos genéricos (no logos de marca)
    Instagram: '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="1" fill="currentColor"/>',
    WhatsApp: '<path d="M4 20l1.3-3.8A8 8 0 1 1 8.2 19z"/><path d="M9 9.5c.3 2 2.2 4 4.5 4.6"/>',
    Facebook: '<circle cx="12" cy="12" r="8.5"/><path d="M13.5 8.5h-1a1.5 1.5 0 0 0-1.5 1.5v8M9.5 12.5h4.5"/>',
    TikTok: '<path d="M14 4v10.5a3.5 3.5 0 1 1-3.5-3.5"/><path d="M14 4c.5 2.3 2 3.6 4.5 3.8"/>',
    YouTube: '<rect x="3" y="6" width="18" height="12" rx="4"/><path d="M10.5 9.5v5l4-2.5z" fill="currentColor"/>',
    X: '<path d="M5 5l14 14M19 5L5 19"/>',
    web: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.4 2.5 14.6 0 17M12 3.5c-2.5 2.4-2.5 14.6 0 17"/>'
  };
  function icoRed(label) { return '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICO[label] || ICO.web) + '</svg>'; }
  var T = {
    es: { tarj: 'Así se ve tu tarjeta', ej: 'ejemplo', socio: 'Socio/a N.º 0007', falta: 'Te faltan {n} sellos para:', tarjD: 'Cada visita suma un sello. La tarjeta se entrega en la sede cuando tu alta queda confirmada.',
      donde: 'Dónde estamos', llegar: 'Cómo llegar', mapa: 'Mapa de la ubicación', res: 'Tu opinión nos ayuda', resD: 'Contanos cómo fue tu experiencia en Google.', dejar: 'Dejar mi reseña', ver: 'Ver reseñas',
      redes: 'Seguinos', redesD: 'Novedades, talleres y actividades.', legal: 'Información legal', legalD: 'Todo lo que tenés que saber sobre tus datos, tu tratamiento y tus derechos.', nota: 'Texto vigente en español.',
      arrep: '↩ Botón de arrepentimiento', arrepMsg: 'Botón de arrepentimiento: quiero revocar el servicio contratado. Servicio/fecha: ____ Nombre: ____ (dentro de los 10 días corridos).' },
    en: { tarj: 'This is what your card looks like', ej: 'sample', socio: 'Member #0007', falta: '{n} stamps left for:', tarjD: 'Every visit earns a stamp. The card is handed out at the venue once your membership is confirmed.',
      donde: 'Where we are', llegar: 'Get directions', mapa: 'Location map', res: 'Your opinion helps us', resD: 'Tell us about your experience on Google.', dejar: 'Leave a review', ver: 'See reviews',
      redes: 'Follow us', redesD: 'News, workshops and activities.', legal: 'Legal information', legalD: 'Everything you need to know about your data, your treatment and your rights.', nota: 'The legally binding text is the Spanish version.',
      arrep: '↩ Withdrawal button', arrepMsg: 'Withdrawal button: I want to revoke the contracted service. Service/date: ____ Name: ____ (within 10 calendar days).' }
  };

  CM.pubExt = {
    /* tarjeta de ejemplo del Club */
    clubCard: function (c, L) {
      if (!c.club || c.club.tarjeta === false) return '';
      var t = T[L] || T.es, meta = Math.max(3, Math.min(20, parseInt(c.club.meta, 10) || 8)), llenos = Math.max(1, Math.min(meta - 1, Math.round(meta * 0.6))), cells = '';
      for (var i = 1; i <= meta; i++) cells += '<i class="' + (i <= llenos ? 'on' : '') + '" aria-hidden="true">' + (i <= llenos ? '✓' : i) + '</i>';
      var premio = (c.club.premio && (c.club.premio[L] || c.club.premio.es)) || '';
      return '<div class="pubx-card" role="img" aria-label="' + esc(t.tarj + ' (' + t.ej + '): ' + llenos + ' / ' + meta) + '"><div class="pubx-card-h"><b>' + esc(c.nombre || '') + '</b><span class="pill">' + esc(t.ej) + '</span></div>' +
        '<small>' + esc(t.socio) + ' · ' + llenos + '/' + meta + '</small><div class="pubx-stamps" style="grid-template-columns:repeat(' + Math.min(5, meta) + ',1fr)">' + cells + '</div>' +
        (premio ? '<div class="pubx-reward">' + esc(t.falta.replace('{n}', meta - llenos)) + ' ' + esc(premio) + '</div>' : '') + '</div><p class="hint" style="margin:8px 0 0">' + esc(t.tarjD) + '</p>';
    },
    clubTitulo: function (L) { return (T[L] || T.es).tarj; },
    /* paneles: mapa + reseñas + redes */
    info: function (c, L, wa, hrs, telTxt) {
      var t = T[L] || T.es, q = encodeURIComponent(c.ubic.consulta || [c.direccion, c.localidad].filter(Boolean).join(' '));
      var rs = c.ubic.resena ? CM.urlHttps(c.ubic.resena) : null, vr = c.ubic.verResenas ? CM.urlHttps(c.ubic.verResenas) : null;
      var mapa = c.ubic.mapa !== false && q ? '<div class="pubx-map"><iframe title="' + esc(t.mapa) + '" src="https://www.google.com/maps?q=' + q + '&amp;output=embed" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe></div>' : '';
      var h = '<div class="pubx-info"><section class="pub-s pubx-panel pubx-mappanel" id="pub-ubic" aria-labelledby="pubUb">' + mapa + '<div class="pubx-body"><h2 id="pubUb">' + CM.icon('pin') + esc(t.donde) + '</h2>' +
        '<p><b>' + esc(c.direccion || '') + (c.localidad ? ', ' + esc(c.localidad) : '') + '</b></p>' + (hrs ? '<p class="pub-hrs">' + esc(hrs) + '</p>' : '') +
        '<p><a href="' + esc(wa) + '" target="_blank" rel="noopener noreferrer">WhatsApp ' + esc(telTxt) + '</a>' + (c.email ? ' · <a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>' : '') + '</p>' +
        '<a class="btn pri pubx-btn" href="https://www.google.com/maps/search/?api=1&amp;query=' + q + '" target="_blank" rel="noopener noreferrer">' + esc(t.llegar) + '</a></div></section>';
      if (rs || vr) h += '<section class="pub-s pubx-panel pubx-review" aria-labelledby="pubRv"><div class="pubx-stars" aria-hidden="true">★★★★★</div><h2 id="pubRv">' + esc(t.res) + '</h2><p class="hint">' + esc(t.resD) + '</p>' +
        (rs ? '<a class="btn pri pubx-btn" href="' + esc(rs) + '" target="_blank" rel="noopener noreferrer">' + esc(t.dejar) + '</a>' : '') + (vr ? '<a class="btn pubx-btn" href="' + esc(vr) + '" target="_blank" rel="noopener noreferrer">' + esc(t.ver) + '</a>' : '') + '</section>';
      return h + '</div>';
    },
    redes: function (c, L, urlRed) {
      var t = T[L] || T.es;
      var rr = (c.redes || []).filter(function (r) { return r.activa; }).map(function (r) {
        var u = r.url === 'wa' ? 'https://wa.me/' + c.wa : urlRed(r.label, r.url); if (!u) return '';
        var hd = r.handle || (r.url === 'wa' ? '+' + c.wa : (String(r.url).match(/\.com\/@?([^/?#]+)/) || [])[1] ? '@' + String(r.url).match(/\.com\/@?([^/?#]+)/)[1] : '');
        return '<li><a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + icoRed(r.label) + '<span><b>' + esc(r.label) + '</b>' + (hd ? '<small>' + esc(hd) + '</small>' : '') + '</span></a></li>';
      }).join('');
      return rr ? '<section class="pub-s pubx-panel" id="pub-redes" aria-labelledby="pubRs"><h2 id="pubRs">' + esc(t.redes) + '</h2><p class="hint">' + esc(t.redesD) + '</p><ul class="pubx-social">' + rr + '</ul></section>' : '';
    },
    /* información legal + botón de arrepentimiento */
    legal: function (c, L, a) {
      var t = T[L] || T.es, lg = c.legal || { docs: [] };
      var docs = lg.docs.filter(function (d) { return d.on !== false && (d.id !== 'wifi' || (c.bloques.wifi && c.wifi && c.wifi.ssid)) && (d.id !== 'arrepentimiento' || lg.arrep); });
      if (!docs.length && !lg.arrep) return '';
      return '<section class="pub-s" id="pub-legal" aria-labelledby="pubLg"><h2 id="pubLg">' + CM.icon('doc') + esc(t.legal) + '</h2><p class="hint">' + esc(t.legalD) + '</p>' +
        docs.map(function (d) { return '<details class="pubx-legal"><summary>' + esc(L === 'en' ? (d.titleEn || d.title) : d.title) + '</summary><div class="pubx-legal-b">' + (L === 'en' ? '<p class="hint">' + esc(t.nota) + '</p>' : '') + md(d.text) + '</div></details>'; }).join('') +
        (lg.arrep ? '<button type="button" class="pubx-arrep" ' + a + '="pub-arrep">' + esc(t.arrep) + '</button>' : '') + '</section>';
    },
    arrepMsg: function (L) { return (T[L] || T.es).arrepMsg; },
    tituloLegal: function (L) { return (T[L] || T.es).legal; }
  };
})(window);
