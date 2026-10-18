/* Cannabismatica I+D · Sistema VB ONG · nube (parte 2): ingreso, alta del primer administrador, usuarios, pantalla Nube, respaldo cifrado y arranque.
   Va después de todos los módulos: reemplaza lo que en la versión de prueba era local. Sin config.js (url/clave) no hace nada. */
(function (g) {
  'use strict';
  var CM = g.CM, N = CM.nube;
  if (!N || !N.activa) return;
  var I = N._i, rpc = I.rpc, authCall = I.authCall, esc = CM.esc, U = CM.U, $ = U.$, fl = U.fl, opt = U.opt, fail = U.fail, VIEWS = CM.VIEWS;
  var render = function () { CM.render(); };
  function pageH(t, p, extra) { return '<div class="page-h"><div><h1>' + esc(t) + '</h1><p>' + p + '</p></div>' + (extra || '') + '</div>'; }
  function ruta() { return (g.location.hash || '#/m').replace(/^#\/?/, '').split('/')[0]; }

  /* =================================================================
     caja por equipo (cada dispositivo tiene su propia caja; las donaciones se asignan a quien las registró)
     ================================================================= */
  CM.siguienteCaja = function () {
    var eq = CM.db._s.eq || 1, n = CM.db.cajas.filter(function (c) { return c.nro === eq; }).length + 1;
    return { id: 'CJ-' + eq + '-' + String(n).padStart(5, '0'), nro: eq };
  };
  CM.cajaAbierta = function () {
    var eq = CM.db._s.eq || 1, c = CM.db.cajas.filter(function (x) { return x.estado === 'abierta' && x.nro === eq; });
    return c.length ? c[c.length - 1] : null;
  };
  function aportesDeCaja(caja) {
    var cerrados = {};
    CM.db.cajas.forEach(function (c) { if (c.estado === 'cerrada' && c.cierre) c.cierre.movs.forEach(function (m) { if (m.ref) cerrados[m.ref] = 1; }); });
    return CM.db.aportes.filter(function (a) { return a.estado === 'registrado' && a.fecha >= caja.fecha && !cerrados[a.id] && (a.eq == null || a.eq === caja.nro); }).map(function (a) {
      return { id: 'AP-' + a.id, ts: a.ts, tipo: 'ingreso', cent: a.cent, medio: a.medio, rubroId: 'R-01', rubroN: 'Donaciones voluntarias', motivo: a.concepto + ' · ' + (a.dni ? 'Legajo ' + CM.legDe(a.dni) : 'donante sin identificar'), user: a.user, ref: a.id, derivado: true, fc: !!a.comp };
    });
  }
  CM.cajaMovs = function (caja) {
    if (caja.estado === 'cerrada' && caja.cierre) return caja.cierre.movs;
    var man = CM.db.cmovs.filter(function (m) { return m.caja === caja.id; });
    return man.concat(aportesDeCaja(caja)).sort(function (a, b) { return a.ts.localeCompare(b.ts); });
  };

  /* =================================================================
     claves
     ================================================================= */
  function genClave() {
    var L = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ', D = '23456789', a = new Uint32Array(12), i, out = [];
    g.crypto.getRandomValues(a);
    for (i = 0; i < 9; i++) out.push(L.charAt(a[i] % L.length));
    for (i = 9; i < 12; i++) out.push(D.charAt(a[i] % D.length));
    for (i = out.length - 1; i > 0; i--) { var j = a[i] % (i + 1), t = out[i]; out[i] = out[j]; out[j] = t; }
    return out.join('');
  }
  function claveOk(p) { return typeof p === 'string' && p.length >= 8 && p.length <= 72 && /[A-Za-z]/.test(p) && /[0-9]/.test(p); }
  function devId() {
    var d = I.lsGet('cmv3_dev');
    if (!d || d.length < 16) { d = I.rndHex(16); I.lsSet('cmv3_dev', d); }
    return d;
  }
  function etiqueta() { var ua = String(g.navigator.userAgent || ''); return /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Equipo'; }

  /* =================================================================
     ingreso
     ================================================================= */
  function emailKey(c) { return 'cmv3_u_' + CM.sha256('u|' + c); }
  function abrirBase(clave, me, eq) {
    var s = N.ses, uid = s.uid;
    return I.idbGet('db_' + uid).then(function (blob) {
      function fresco() {
        var salt = g.crypto.getRandomValues(new Uint8Array(16));
        return I.derivar(clave, salt).then(function (k) { s.key = k; s.salt = salt; I.dbVacia(); return false; });
      }
      if (!blob || !blob.c) return fresco();
      return I.derivar(clave, I.unb64(blob.s)).then(function (k) {
        return I.descifrar(k, blob).then(function (db) {
          if (!db || !db._s || db._s.v !== 3) return fresco();
          s.key = k; s.salt = I.unb64(blob.s); CM.db = db; return true;
        }, function () { return fresco(); });
      });
    }).then(function (recuperada) {
      var db = CM.db; db._s.eq = eq; db._s.uid = uid;
      N.aplicarMe(me);
      I.normalizar(); I.alinearContadores();
      N.anon = false; N.online = true; N.err = ''; N.dirty = false;
      I.lsSet(emailKey(s.correo), uid);
      I.guardarLocal();
      N.setIntervalo(); I.ping(); I.ciclo();
    });
  }
  function iniciar(j, correo, clave) {
    N.ses = { at: j.access_token, rt: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000, uid: j.user && j.user.id, correo: correo, me: null };
    return rpc('miembro_actual', {}).then(function (me) {
      if (!me) { var e = new Error('sin_miembro'); e.sinMiembro = true; throw e; }
      N.ses.me = { nombre: me.nombre, correo: me.correo, rol: me.rol, cambiar: !!me.cambiar };
      return rpc('equipo_num', { p_device: devId(), p_etiqueta: etiqueta() }).then(function (eq) { return abrirBase(clave, me, eq); });
    }).catch(function (e) { N.ses = null; throw e; });
  }
  function desbloquearOffline(correo, clave) {
    var uid = I.lsGet(emailKey(correo)), e0 = new Error('sin_datos_locales'); e0.localErr = 'Sin conexión: este equipo todavía no tiene tus datos guardados. Conectate a internet para ingresar la primera vez.';
    if (!uid) return Promise.reject(e0);
    return I.idbGet('db_' + uid).then(function (blob) {
      if (!blob || !blob.c) throw e0;
      return I.derivar(clave, I.unb64(blob.s)).then(function (k) {
        return I.descifrar(k, blob).then(function (db) {
          var ult = db._s && db._s.ult || 0, lim = I.OFFLINE_MAX_DIAS * 86400000;
          if (!db._s || db._s.v !== 3 || !db._s.me) throw e0;
          if (Date.now() - ult > lim) { var e2 = new Error('vencido'); e2.localErr = 'Pasaron más de ' + I.OFFLINE_MAX_DIAS + ' días sin conexión: conectate a internet para volver a ingresar.'; throw e2; }
          N.ses = { at: null, rt: db._s.rt || null, exp: 0, uid: uid, correo: correo, me: db._s.me, key: k, salt: I.unb64(blob.s) };
          CM.db = db; N.anon = false; N.online = false; N.err = 'Sin conexión'; N.dirty = false;
          I.normalizar(); I.alinearContadores();
          CM.db.cfg.rol = db._s.me.rol; CM.db.cfg.operador = db._s.me.nombre;
          N.setIntervalo(); I.ping(); try { N.pend = I.diferencias().length; } catch (e) { N.pend = 0; }
          I.ciclo();
        }, function () { var e3 = new Error('credenciales'); e3.status = 400; throw e3; });
      });
    });
  }
  var fallos = { n: 0, hasta: 0 };
  N.login = function (correo, clave) {
    correo = String(correo || '').trim().toLowerCase();
    return authCall('token?grant_type=password', { email: correo, password: clave }).then(function (j) { fallos.n = 0; return iniciar(j, correo, clave); }, function (e) {
      if (e && e.red) return desbloquearOffline(correo, clave);
      throw e;
    });
  };
  function msgLogin(e) {
    if (e && e.localErr) return e.localErr;
    if (e && e.sinMiembro) return 'Tu usuario no está habilitado en esta organización. Consultá con la administración.';
    var st = e && e.status;
    if (st === 400 || st === 401 || st === 422) { fallos.n++; if (fallos.n >= 5) { fallos.hasta = Date.now() + 60000; fallos.n = 0; } return 'Correo o clave incorrectos.'; }
    if (st === 429) return 'Demasiados intentos. Esperá unos minutos y probá de nuevo.';
    if (e && e.red) return 'No hay conexión con el servidor.';
    return 'No pudimos ingresar. Probá de nuevo en un momento.';
  }
  CM.forms.acceso = function (f) {
    var correo = f.elements.correo.value.trim(), clave = f.elements.clave.value;
    if (!correo || !clave) return fail(f, correo ? 'clave' : 'correo', 'Escribí el correo y la clave.');
    if (Date.now() < fallos.hasta) return fail(f, 'clave', 'Demasiados intentos. Esperá un minuto.');
    var btn = f.querySelector('button[type=submit]'); if (btn) btn.disabled = true;
    N.login(correo, clave).then(function () { g.location.hash = '#/inicio'; render(); }, function (e) {
      if (btn) btn.disabled = false; fail(f, 'clave', msgLogin(e));
    });
  };
  CM.forms['setup'] = function (f) {
    var e = f.elements, cod = e.cod.value.replace(/\s+/g, '').toUpperCase(), nom = e.nombre.value.trim(), cor = e.correo.value.trim().toLowerCase(), c1 = e.c1.value, c2 = e.c2.value;
    if (cod.length < 8) return fail(f, 'cod', 'Escribí el código de configuración que te dio Rave Holding.');
    if (nom.length < 3) return fail(f, 'nombre', 'Escribí tu nombre y apellido.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cor)) return fail(f, 'correo', 'Revisá el correo.');
    if (!claveOk(c1)) return fail(f, 'c1', 'La clave necesita al menos 8 caracteres, con letras y números.');
    if (c1 !== c2) return fail(f, 'c2', 'Las dos claves no coinciden.');
    var btn = f.querySelector('button[type=submit]'); if (btn) btn.disabled = true;
    rpc('bootstrap', { p_codigo: cod, p_correo: cor, p_nombre: nom, p_clave: c1, p_ong: e.ong.value.trim() }, true).then(function () {
      N.needSetup = false;
      return N.login(cor, c1).then(function () { g.location.hash = '#/inicio'; render(); CM.toast('Listo: la cuenta de administración está creada.'); });
    }).catch(function (er) {
      if (btn) btn.disabled = false;
      fail(f, 'cod', I.msgErr(er) || (er && er.red ? 'No hay conexión con el servidor.' : 'No se pudo completar la configuración.'));
    });
  };

  VIEWS.acceso = function () {
    var cfg = CM.db.menu.pub, ya = CM.usuarioActual && CM.usuarioActual();
    if (ya) return '<div class="pubpage"><div class="card login"><h1>Ya ingresaste</h1><p>Sesión de <b>' + esc(ya.nombre) + '</b> (' + esc(CM.ROLES[ya.rol]) + ').</p><div class="row"><a class="btn pri" href="#/inicio">Ir al sistema</a><button class="btn" data-act="salir">Salir</button></div></div></div>';
    var logo = '<div style="text-align:center"><img src="assets/logo.png" alt="Cannabismatica" style="max-width:220px;height:auto"></div>';
    var pie = '<p class="hint" style="margin-top:12px">Desarrollado por <b>Rave Holding</b> · <a href="https://wa.me/5493875143900?text=' + encodeURIComponent('Hola Rave Holding, necesito ayuda para ingresar al sistema de Cannabismatica') + '" target="_blank" rel="noopener noreferrer">Necesito ayuda</a></p>';
    if (N.needSetup) {
      return '<div class="pubpage"><div class="card login">' + logo + '<h1>Primera configuración</h1><p class="hint">Es la primera vez que se usa el sistema. Con el <b>código de configuración</b> que te dio Rave Holding creás la cuenta de administración. El código sirve una sola vez.</p>' +
        '<form data-form="setup" class="f" autocomplete="off" novalidate>' + fl('Código de configuración *', '<input class="in" name="cod" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX">') +
        fl('Nombre de la organización', '<input class="in" name="ong" value="Fundación Cannabismatica Investigación y Desarrollo">') + fl('Tu nombre y apellido *', '<input class="in" name="nombre" autocomplete="name">') +
        fl('Tu correo (es tu usuario) *', '<input class="in" type="email" name="correo" autocomplete="username" inputmode="email" autocapitalize="none" spellcheck="false">') +
        fl('Elegí tu clave (mínimo 8, con letras y números) *', '<input class="in" type="password" name="c1" autocomplete="new-password">') + fl('Repetí la clave *', '<input class="in" type="password" name="c2" autocomplete="new-password">') +
        '<div class="note warn">Guardá tu clave en un lugar seguro. Sin ella no se pueden abrir los datos de este equipo si no hay internet.</div><p class="err" role="alert" data-err></p><button class="btn pri" type="submit">Crear cuenta de administración</button><a class="btn sm" href="#/m">Volver al menú</a></form>' + pie + '</div></div>';
    }
    return '<div class="pubpage"><div class="card login">' + logo + '<h1>Acceso del equipo</h1><p class="hint">Ingresá con tu correo y tu clave. Si no tenés usuario, pedíselo a la administración de la fundación.</p>' +
      '<form data-form="acceso" class="f" autocomplete="on" novalidate>' + fl('Correo', '<input class="in" type="email" name="correo" autocomplete="username" inputmode="email" autocapitalize="none" spellcheck="false">') +
      fl('Clave', '<span class="pwrow"><input class="in" type="password" name="clave" autocomplete="current-password"><button type="button" class="btn sm" data-act="ver-clave" aria-pressed="false">Mostrar</button></span>') +
      '<p class="err" role="alert" data-err></p><button class="btn pri" type="submit">Ingresar</button><div class="row" style="justify-content:space-between"><button type="button" class="btn sm" data-act="olvide">Olvidé mi contraseña</button><a class="btn sm" href="#/m">Volver al menú</a></div></form>' +
      '<p class="hint" style="margin-top:10px">Tus datos se guardan cifrados en este equipo. Por seguridad, la sesión se cierra sola después de ' + Math.round(((g.CM_CFG && g.CM_CFG.inactividadMin) || 15)) + ' minutos sin uso.</p>' + pie + '</div></div>';
  };
  CM.acts['acceso-usar'] = function () { /* no hay usuarios de prueba en la versión con nube */ };
  CM.acts.salir = function () { N.salir('manual'); };
  CM.logout = function () { N.salir('manual'); };

  /* ---------- mi clave ---------- */
  CM.modalClave = function (forzada) {
    CM.modal.open({ title: forzada ? 'Elegí tu clave propia' : 'Cambiar mi clave', body: (forzada ? '<div class="note warn">Ingresaste con una clave temporal: elegí una propia para seguir.</div>' : '') + '<form id="fCL" data-form="mi-clave" class="f" autocomplete="off" novalidate>' + fl('Clave actual', '<input class="in" type="password" name="act" autocomplete="current-password">') + fl('Clave nueva (mínimo 8, con letras y números)', '<input class="in" type="password" name="n1" autocomplete="new-password">') + fl('Repetí la clave nueva', '<input class="in" type="password" name="n2" autocomplete="new-password">') + '<p class="err" role="alert" data-err></p></form>', footer: (forzada ? '<button class="btn" type="button" data-act="salir">Salir</button>' : '<button class="btn" data-act="modal-close">Cancelar</button>') + '<button class="btn pri" type="submit" form="fCL">Guardar clave</button>' });
  };
  CM.acts['mi-clave'] = function () { CM.modalClave(false); };
  CM.forms['mi-clave'] = function (f) {
    var s = N.ses; if (!s) return; var e = f.elements;
    if (!e.act.value) return fail(f, 'act', 'Escribí la clave actual.');
    if (!claveOk(e.n1.value)) return fail(f, 'n1', 'La clave nueva necesita al menos 8 caracteres, con letras y números.');
    if (e.n1.value !== e.n2.value) return fail(f, 'n2', 'Las dos claves nuevas no coinciden.');
    if (e.n1.value === e.act.value) return fail(f, 'n1', 'Elegí una clave distinta de la actual.');
    if (!N.online || !s.at) return fail(f, 'act', 'Para cambiar la clave hace falta conexión a internet.');
    var btn = f.querySelector('button[type=submit]') || document.querySelector('button[form=fCL]'); if (btn) btn.disabled = true;
    var nueva = e.n1.value, salt = g.crypto.getRandomValues(new Uint8Array(16));
    authCall('token?grant_type=password', { email: s.correo, password: e.act.value }).then(function (j) {
      s.at = j.access_token; s.rt = j.refresh_token; s.exp = Date.now() + (j.expires_in || 3600) * 1000;
      return authCall('user', { password: nueva }, 'PUT', true);
    }).then(function () { return rpc('clave_cambiada', {}); }).then(function () { return I.derivar(nueva, salt); }).then(function (k) {
      s.key = k; s.salt = salt; s.me.cambiar = false; CM.audit('Cambio de clave', s.me.nombre); I.guardarLocal();
      CM.modal.close(true); render(); CM.toast('Clave cambiada.');
    }).catch(function (er) {
      if (btn) btn.disabled = false;
      var st = er && er.status;
      fail(f, st === 400 || st === 401 ? 'act' : 'n1', st === 400 || st === 401 ? 'La clave actual no es correcta.' : st === 422 ? 'El servidor no aceptó esa clave: probá con una más larga.' : (er && er.red ? 'No hay conexión con el servidor.' : 'No se pudo cambiar la clave.'));
    });
  };

  /* ---------- barra superior: persona, rol y estado de la nube ---------- */
  CM.rolSel = function () {
    var chip = $('#userChip'), u = CM.usuarioActual && CM.usuarioActual();
    if (chip) {
      chip.hidden = !u;
      chip.innerHTML = u ? '<span class="uc-n"><b>' + esc(u.nombre) + '</b><small>' + esc(CM.ROLES[u.rol]) + '</small></span><button type="button" class="btn sm" data-act="mi-clave">Mi clave</button><button type="button" class="btn sm" data-act="salir">Salir</button>' : '';
    }
    N.chip();
  };
  N.chip = function () {
    var el = $('#syncChip'); if (!el) return;
    if (N.anon || !N.ses) { el.hidden = true; return; }
    var t, c = 'pill p-ok';
    if (N.enCurso) { t = '☁ Sincronizando…'; c = 'pill p-info'; }
    else if (!N.online) { t = '☁ Sin conexión' + (N.pend ? ' · ' + N.pend + ' por subir' : ''); c = 'pill p-warn'; }
    else if (N.err) { t = '☁ ' + N.err; c = 'pill p-bad'; }
    else if (N.dirty) { t = '☁ Subiendo cambios…'; c = 'pill p-info'; }
    else { t = '☁ Sincronizado'; }
    el.hidden = false; el.className = c; el.textContent = t;
  };

  /* ---------- menú público para visitantes ---------- */
  var m0 = VIEWS.m;
  VIEWS.m = function (r) {
    if (N.anon && !N.menuIntento) return '<div class="pubpage"><div class="card" style="margin:40px auto;max-width:420px;text-align:center"><p>Cargando…</p></div></div>';
    if (N.anon && !N.menuOk && !N.menuCache && !N.needSetup) return '<div class="pubpage"><div class="card" style="margin:40px auto;max-width:460px;text-align:center"><h1>No pudimos cargar el menú</h1><p class="hint">Revisá tu conexión y probá de nuevo.</p><button class="btn pri" data-act="menu-reintentar">Reintentar</button></div></div>';
    return m0(r);
  };
  CM.acts['menu-reintentar'] = function () { N.menuIntento = false; render(); N.cargarMenu().then(function () { N.menuIntento = true; render(); }); };
  var cm0 = N.cargarMenu;
  N.cargarMenu = function () {
    return cm0().then(function () { N.menuIntento = true; N.menuCache = !!I.lsGet('cmv3_menu'); });
  };

  /* =================================================================
     usuarios y permisos (servidor)
     ================================================================= */
  function cargarUsuarios() {
    return rpc('usuarios_listar', {}).then(function (l) { CM.db.users = (l || []).map(function (u) { return { id: u.id, nombre: u.nombre, correo: u.correo, rol: u.rol, activo: u.activo, cambiar: u.cambiar }; }); N.usT = Date.now(); });
  }
  VIEWS.usuarios = function () {
    if (!N.usT || Date.now() - N.usT > 30000) {
      if (!N.usCarg) { N.usCarg = true; cargarUsuarios().then(function () { N.usCarg = false; if (ruta() === 'usuarios' && !CM.modal.isOpen()) render(); }, function () { N.usCarg = false; N.usT = Date.now(); N.usErr = true; if (ruta() === 'usuarios' && !CM.modal.isOpen()) render(); }); }
    }
    var db = CM.db, rl = Object.keys(CM.ROLES), esAdmin = CM.can('usuarios', 'admin');
    return pageH('Usuarios y permisos', 'Quién puede hacer qué. Los permisos se controlan en el servidor: aunque alguien modifique la pantalla, el servidor no le entrega ni le acepta lo que su rol no permite.',
      esAdmin ? '<button class="btn pri" data-act="us-nuevo">' + CM.icon('plus') + 'Nuevo usuario</button>' : '') +
      (N.usErr ? '<div class="note warn" style="margin-bottom:12px">No se pudo actualizar la lista de usuarios (¿sin conexión?). Se muestra la última copia.</div>' : '') +
      '<section class="card"><h2>Usuarios</h2><div class="tw"><table><thead><tr><th>Usuario</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>' + (db.users.length ? db.users.map(function (u) {
        return '<tr' + (u.activo ? '' : ' class="anulada"') + '><td><b>' + esc(u.nombre) + '</b></td><td>' + esc(u.correo) + '</td><td>' + esc(CM.ROLES[u.rol] || u.rol) + '</td><td>' + (u.activo ? '<span class="pill p-ok">Activo</span>' : '<span class="pill p-mu">Baja</span>') + (u.cambiar ? ' <span class="pill p-warn">Debe elegir su clave</span>' : '') + '</td><td class="acts">' + (esAdmin ? '<button class="btn sm" data-act="us-edit" data-id="' + esc(u.id) + '">Editar</button><button class="btn sm" data-act="us-clave" data-id="' + esc(u.id) + '">Clave temporal</button>' : '') + '</td></tr>';
      }).join('') : '<tr><td colspan="5"><div class="empty">Cargando…</div></td></tr>') + '</tbody></table></div></section>' +
      '<section class="card" style="margin-top:14px"><h2>Matriz de permisos</h2><p class="hint">Niveles: sólo ver · operar (cargar) · editar · administrar (anular, cerrar, configurar). El administrador siempre puede todo, para no quedar bloqueado.</p><form data-form="perms"><div class="tw"><table><thead><tr><th>Módulo</th>' + rl.map(function (r) { return '<th>' + esc(CM.ROLES[r]) + '</th>'; }).join('') + '</tr></thead><tbody>' + CM.MODS.map(function (m) {
        return '<tr><td>' + esc(m[1]) + '</td>' + rl.map(function (r) {
          if (r === 'admin') return '<td><span class="pill p-ok">Administrar</span></td>';
          return '<td><label class="sr" for="pm_' + r + '_' + m[0] + '">' + esc(m[1] + ' · ' + CM.ROLES[r]) + '</label><select id="pm_' + r + '_' + m[0] + '" class="in sm" name="' + r + '|' + m[0] + '"' + (esAdmin ? '' : ' disabled') + '>' + CM.LVL.map(function (l) { return opt(l, CM.LVL_L[l], ((db.perms[r] || {})[m[0]] || '') === l); }).join('') + '</select></td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>' + (esAdmin ? '<div class="row" style="margin-top:12px"><button class="btn pri" type="submit">Guardar permisos</button><button class="btn" type="button" data-act="perms-reset">Restaurar valores por defecto</button></div>' : '') + '</form><p class="hint">Un cambio de rol, de permisos o una baja se aplica a todos los equipos en pocos segundos.</p></section>';
  };
  CM.forms.perms = function (f) {
    if (!CM.need('usuarios', 'admin')) return;
    var p = {}; ['supervisor', 'mostrador', 'operador'].forEach(function (r) { p[r] = {}; });
    Array.prototype.forEach.call(f.elements, function (el) { if (el.name && el.name.indexOf('|') > -1) { var x = el.name.split('|'); p[x[0]][x[1]] = el.value; } });
    rpc('perms_guardar', { p_perms: p }).then(function () { CM.db.perms = Object.assign({ admin: CM.db.perms.admin }, p); CM.toast('Permisos guardados.'); render(); }, function (e) { CM.toast(I.msgErr(e) || 'No se pudieron guardar los permisos.', true); });
  };
  CM.acts['perms-reset'] = function () {
    if (!CM.need('usuarios', 'admin')) return;
    CM.modal.open({ title: 'Restaurar permisos', body: '<p>Se vuelven a poner los permisos por defecto de cada rol. ¿Seguro?</p>', footer: '<button class="btn" data-act="modal-close">Cancelar</button><button class="btn bad" data-act="perms-reset-ok">Sí, restaurar</button>' });
  };
  CM.acts['perms-reset-ok'] = function () {
    CM.modal.close(true);
    var d = CM.permsDefault(), p = {}; ['supervisor', 'mostrador', 'operador'].forEach(function (r) { p[r] = d[r]; });
    rpc('perms_guardar', { p_perms: p }).then(function () { CM.db.perms = d; render(); CM.toast('Permisos restaurados.'); }, function (e) { CM.toast(I.msgErr(e) || 'No se pudo restaurar.', true); });
  };
  function modalUs(u) {
    var edit = !!u;
    CM.modal.open({ title: edit ? 'Editar usuario' : 'Nuevo usuario', body: '<form id="fUS" data-form="usuario" class="f" autocomplete="off" novalidate><input type="hidden" name="id" value="' + esc(edit ? u.id : '') + '">' + fl('Nombre *', '<input class="in" name="nombre" value="' + esc(edit ? u.nombre : '') + '">') + (edit ? '<p class="hint" style="margin:0">Correo: <b>' + esc(u.correo) + '</b> (no se puede cambiar; para otro correo se crea un usuario nuevo)</p>' : fl('Correo *', '<input class="in" type="email" name="correo" autocapitalize="none" spellcheck="false">')) + fl('Rol', '<select class="in" name="rol">' + Object.keys(CM.ROLES).map(function (r) { return opt(r, CM.ROLES[r], edit ? u.rol === r : r === 'operador'); }).join('') + '</select>') + (edit ? '<label class="chk"><input type="checkbox" name="activo"' + (u.activo ? ' checked' : '') + '><span>Activo (si se desmarca, pierde el acceso en todos los equipos)</span></label>' : '') + '<p class="err" role="alert" data-err></p></form>', footer: '<button class="btn" data-act="modal-close">Cancelar</button><button class="btn pri" type="submit" form="fUS">Guardar</button>' });
  }
  CM.acts['us-nuevo'] = function () { if (CM.need('usuarios', 'admin')) modalUs(null); };
  CM.acts['us-edit'] = function (t) { if (CM.need('usuarios', 'admin')) modalUs(CM.db.users.filter(function (x) { return x.id === t.getAttribute('data-id'); })[0]); };
  function mostrarClave(titulo, nombre, correo, clave) {
    CM.modal.open({ title: titulo, body: '<p>Persona: <b>' + esc(nombre) + '</b>' + (correo ? ' · ' + esc(correo) : '') + '</p><p>Clave temporal: <code style="font-size:1.25rem;user-select:all">' + esc(clave) + '</code></p><div class="note info">Se muestra una sola vez: anotala y pasásela a la persona por un medio seguro. Al ingresar tiene que elegir una clave propia.</div>', footer: '<button class="btn pri" data-act="modal-close">Listo</button>' });
  }
  CM.forms.usuario = function (f) {
    if (!CM.need('usuarios', 'admin')) return;
    var e = f.elements, n = e.nombre.value.trim(), btn = f.querySelector('button[type=submit]') || document.querySelector('button[form=fUS]');
    if (n.length < 3) return fail(f, 'nombre', 'Escribí el nombre (mínimo 3 letras).');
    var u = e.id.value ? CM.db.users.filter(function (x) { return x.id === e.id.value; })[0] : null;
    if (btn) btn.disabled = true;
    var p;
    if (u) p = rpc('usuario_actualizar', { p_user: u.id, p_nombre: n, p_rol: e.rol.value, p_activo: e.activo.checked }).then(function () { CM.modal.close(true); return cargarUsuarios().then(render); });
    else {
      var c = e.correo.value.trim().toLowerCase(), tmp = genClave();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c)) { if (btn) btn.disabled = false; return fail(f, 'correo', 'Revisá el correo.'); }
      p = rpc('usuario_crear', { p_correo: c, p_nombre: n, p_rol: e.rol.value, p_clave: tmp }).then(function () { CM.modal.close(true); return cargarUsuarios().then(function () { render(); mostrarClave('Usuario creado', n, c, tmp); }); });
    }
    p.catch(function (er) { if (btn) btn.disabled = false; fail(f, 'nombre', I.msgErr(er) || (er && er.red ? 'No hay conexión con el servidor.' : 'No se pudo guardar.')); });
  };
  CM.acts['us-clave'] = function (t) {
    if (!CM.need('usuarios', 'admin')) return;
    var u = CM.db.users.filter(function (x) { return x.id === t.getAttribute('data-id'); })[0]; if (!u) return;
    CM.modal.open({ title: 'Clave temporal', body: '<p>Se genera una clave temporal para <b>' + esc(u.nombre) + '</b>. Se cierran sus sesiones abiertas y, al ingresar, tiene que elegir una clave propia.</p>', footer: '<button class="btn" data-act="modal-close">Cancelar</button><button class="btn pri" data-act="us-clave-ok" data-id="' + esc(u.id) + '">Generar clave temporal</button>' });
  };
  CM.acts['us-clave-ok'] = function (t) {
    if (!CM.need('usuarios', 'admin')) return;
    var id = t.getAttribute('data-id'), u = CM.db.users.filter(function (x) { return x.id === id; })[0], tmp = genClave();
    rpc('usuario_reset_clave', { p_user: id, p_clave: tmp }).then(function () { cargarUsuarios().then(render); mostrarClave('Clave temporal', u ? u.nombre : '', u ? u.correo : '', tmp); }, function (er) { CM.toast(I.msgErr(er) || 'No se pudo generar la clave.', true); });
  };
  CM.acts['us-actuar'] = function () { /* sin simulación de usuarios con la nube */ };

  /* =================================================================
     pantalla Nube
     ================================================================= */
  function hhmm(ts) { if (!ts) return '—'; var d = new Date(ts); return CM.fmtFecha(d.toISOString().slice(0, 10)) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  VIEWS.nube = function () {
    var s = CM.db._s, pend = 0; try { pend = I.diferencias().length; } catch (e) { pend = 0; }
    var est = N.enCurso ? '<span class="pill p-info">Sincronizando…</span>' : !N.online ? '<span class="pill p-warn">Sin conexión</span>' : N.err ? '<span class="pill p-bad">' + esc(N.err) + '</span>' : '<span class="pill p-ok">Conectada</span>';
    var rech = s.rech || [], esAdmin = CM.can('nube', 'admin');
    return pageH('Nube', 'Sincronización entre equipos, respaldo y estado de la conexión. Los datos viven en un servidor en <b>São Paulo (Brasil)</b> y una copia cifrada queda en cada equipo.', '<button class="btn pri" data-act="nube-sync">' + CM.icon('swap') + 'Sincronizar ahora</button>') +
      '<div class="grid g3"><div class="card kpi"><div class="l">Conexión con la nube</div><div class="v" style="font-size:1.2rem;padding:6px 0">' + est + '</div><div class="s">Última sincronización: ' + esc(hhmm(s.ult)) + '</div></div>' +
      '<div class="card kpi"><div class="l">Cambios por subir</div><div class="v">' + pend + '</div><div class="s">' + (pend ? 'Se suben solos al haber conexión' : 'Todo está en la nube') + '</div></div>' +
      '<div class="card kpi"><div class="l">Este equipo</div><div class="v" style="font-size:1.2rem;padding:6px 0">Equipo ' + esc(s.eq || 1) + '</div><div class="s">Caja propia · datos cifrados en este navegador</div></div></div>' +
      (rech.length ? '<section class="card" style="margin-top:14px"><div class="row sp"><h2>Cambios que el servidor no aceptó</h2><button class="btn sm" data-act="nube-rech-ok">Entendido, limpiar la lista</button></div><p class="hint">Pasa, por ejemplo, si dos equipos vendieron el mismo stock a la vez o si cambió tu permiso. El sistema ya volvió a mostrar la versión del servidor.</p><div class="tw"><table><thead><tr><th>Cuándo</th><th>Qué</th><th>Motivo</th></tr></thead><tbody>' + rech.slice(0, 20).map(function (r) { return '<tr><td>' + esc(hhmm(r.ts)) + '</td><td>' + esc(r.col + ' · ' + r.id) + '</td><td>' + esc(r.txt) + '</td></tr>'; }).join('') + '</tbody></table></div></section>' : '') +
      '<div class="grid g2" style="margin-top:14px"><section class="card"><h2>Cómo funciona</h2><ul class="tl">' + ['Cada persona ingresa con su correo y su clave; los permisos los controla el servidor.', 'Los cambios se guardan primero en este equipo (cifrados) y se suben solos cada pocos segundos.', 'Sin internet se puede seguir trabajando; al volver la conexión se sincroniza. Pasados ' + I.OFFLINE_MAX_DIAS + ' días sin conexión hay que volver a ingresar en línea.', 'El stock y las cajas cerradas los vigila el servidor: no puede quedar stock negativo y un cierre sellado no se modifica.', 'Si alguien da de baja a una persona, pierde el acceso en todos los equipos.'].map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></section>' +
      '<section class="card"><h2>Respaldo cifrado</h2><p style="color:var(--mu)">Descargá una copia cifrada de los datos de este equipo con una contraseña de respaldo que elegís vos (distinta de tu clave de ingreso). Sin esa contraseña el archivo no se puede abrir.</p><div class="row">' + (esAdmin ? '<button class="btn pri" data-act="bk-cifrado">' + CM.icon('dl') + 'Descargar respaldo cifrado</button><button class="btn" data-act="bk-verificar">' + CM.icon('shield') + 'Verificar un respaldo</button>' : '<span class="pill p-mu">Sólo la administración</span>') + '</div>' +
      '<div class="note info" style="margin-top:12px">Con la nube activa los respaldos <b>no se restauran desde esta pantalla</b> (se pisarían datos de otros equipos). Si hace falta recuperar información, Rave Holding restaura desde las copias del servidor <b>[VERIFICAR el plan de Supabase contratado]</b>.</div></section></div>';
  };
  CM.acts['nube-sync'] = function () { if (!N.online) { CM.toast('Sin conexión: se va a sincronizar solo cuando vuelva.', true); } N.sincronizar().then(function () { render(); }); };
  CM.acts['nube-rech-ok'] = function () { CM.db._s.rech = []; N.dirty = true; I.guardarLocal(); render(); };
  CM.acts['bk-bajar'] = function () { CM.toast('Usá «Descargar respaldo cifrado» en la pantalla Nube.', true); };
  CM.acts['bk-cifrado'] = function () {
    if (!CM.need('nube', 'admin')) return;
    CM.modal.open({ title: 'Respaldo cifrado', body: '<form id="fBK" data-form="bk-cifrado" class="f" autocomplete="off" novalidate><p class="hint" style="margin:0">Elegí una contraseña de respaldo (mínimo 10 caracteres). Guardala aparte: sin ella no se puede abrir el archivo.</p>' + fl('Contraseña de respaldo *', '<input class="in" type="password" name="p1" autocomplete="new-password">') + fl('Repetila *', '<input class="in" type="password" name="p2" autocomplete="new-password">') + '<p class="err" role="alert" data-err></p></form>', footer: '<button class="btn" data-act="modal-close">Cancelar</button><button class="btn pri" type="submit" form="fBK">Descargar</button>' });
  };
  CM.forms['bk-cifrado'] = function (f) {
    var e = f.elements; if (e.p1.value.length < 10) return fail(f, 'p1', 'Mínimo 10 caracteres.'); if (e.p1.value !== e.p2.value) return fail(f, 'p2', 'No coinciden.');
    var o = JSON.parse(JSON.stringify(CM.db)); delete o._s; delete o.users; o.__bk = { v: 3, ts: new Date().toISOString(), equipo: CM.db._s.eq };
    N._cifrar(e.p1.value, o).then(function (blob) {
      CM.audit('Respaldo cifrado', 'Descarga de respaldo cifrado'); CM.save();
      CM.descargar('respaldo_cifrado_cannabismatica_' + CM.hoy() + '.json', JSON.stringify(blob), 'application/json'); CM.modal.close(true); CM.toast('Respaldo descargado. Guardá la contraseña aparte.');
    }, function () { fail(f, 'p1', 'No se pudo cifrar el respaldo en este navegador.'); });
  };
  CM.acts['bk-verificar'] = function () {
    if (!CM.need('nube', 'admin')) return;
    CM.modal.open({ title: 'Verificar un respaldo', body: '<form id="fBV" data-form="bk-verificar" class="f" autocomplete="off" novalidate><p class="hint" style="margin:0">Comprueba que el archivo se abre con su contraseña y muestra qué contiene. No cambia ningún dato.</p>' + fl('Archivo de respaldo *', '<input class="in" type="file" name="arch" accept=".json,application/json">') + fl('Contraseña de respaldo *', '<input class="in" type="password" name="p1" autocomplete="off">') + '<p class="err" role="alert" data-err></p><div id="bvRes"></div></form>', footer: '<button class="btn" data-act="modal-close">Cerrar</button><button class="btn pri" type="submit" form="fBV">Verificar</button>' });
  };
  CM.forms['bk-verificar'] = function (f) {
    var e = f.elements, a = e.arch.files && e.arch.files[0]; if (!a) return fail(f, 'arch', 'Elegí el archivo.'); if (!e.p1.value) return fail(f, 'p1', 'Escribí la contraseña.');
    var fr = new g.FileReader();
    fr.onload = function () {
      var blob; try { blob = JSON.parse(fr.result); } catch (x) { return fail(f, 'arch', 'El archivo no es un respaldo.'); }
      if (!blob || blob.v !== 3 || !blob.c) return fail(f, 'arch', 'El archivo no es un respaldo cifrado de este sistema.');
      N._descifrar(e.p1.value, blob).then(function (o) {
        var r = $('#bvRes', f); if (r) r.innerHTML = '<div class="note ok">Respaldo correcto: ' + Object.keys(o.pacientes || {}).length + ' pacientes, ' + (o.lotes || []).length + ' lotes, ' + (o.aportes || []).length + ' donaciones, ' + (o.cajas || []).length + ' cajas. Fecha: ' + esc(o.__bk ? CM.fmtFecha(String(o.__bk.ts).slice(0, 10)) : '') + '.</div>';
        var er = $('[data-err]', f); if (er) er.textContent = '';
      }, function () { fail(f, 'p1', 'La contraseña no es correcta o el archivo está dañado.'); });
    };
    fr.readAsText(a);
  };

  /* =================================================================
     ajustes, auditoría, vaciar y reglas de la versión con nube
     ================================================================= */
  var aj0 = VIEWS.ajustes;
  VIEWS.ajustes = function (r) {
    var h = aj0(r);
    h = h.replace(/name="operador" value="([^"]*)" required/, 'name="operador" value="$1" readonly');
    h = h.replace(/Operador actual \(queda en la auditoría\)/, 'Operador actual (es tu usuario)');
    h = h.replace(/<section class="card" style="margin-top:14px"><h2>Sobre esta versión de prueba<\/h2>[\s\S]*<\/section>\s*$/, '<section class="card" style="margin-top:14px"><h2>Sobre esta versión</h2><ul style="margin:0;padding-left:20px;color:var(--mu)"><li>Los datos se guardan en la nube (servidor en São Paulo, Brasil) y cifrados en cada equipo.</li><li>La Factura C es una <b>simulación</b> sin validez fiscal: no se conecta con ARCA.</li><li>Normativa (Ley 27.350, vigencias del REPROCANN, exención de la ONG, tratamiento de datos de salud) <b>[VERIFICAR con asesor legal y fuentes oficiales]</b>.</li></ul>' + (CM.can('ajustes', 'admin') ? '<div class="row" style="margin-top:14px"><button class="btn bad" data-act="vaciar">' + CM.icon('trash') + 'Empezar de cero (borrar los datos cargados)</button></div>' : '') + '</section>');
    return h;
  };
  var f0 = CM.forms.ajustes;
  CM.forms.ajustes = function (f) { f0(f); if (N.ses) { CM.db.cfg.operador = N.ses.me.nombre; } };
  var au0 = VIEWS.auditoria;
  VIEWS.auditoria = function (r) {
    var h = au0(r);
    h = h.replace(/<details style="margin-top:14px"><summary>Prueba de integridad<\/summary>[\s\S]*?<\/details>/, '');
    h = h.replace('Cada registro se encadena con el anterior mediante un hash SHA-256: si alguien altera uno, la verificación lo detecta.', 'Cada equipo encadena sus registros con un hash SHA-256; el servidor además agrega su propio registro de usuarios, claves y permisos.');
    return h;
  };
  CM.acts['aud-alterar'] = function () {}; CM.acts['aud-reparar'] = function () {};
  CM.acts['reset-demo'] = function () {}; CM.acts['reset-ok'] = function () {};
  CM.acts['imp-deshacer'] = function () { CM.toast('Con la nube activa no se puede deshacer una importación desde acá: pedile ayuda a Rave Holding.', true); };

  var COLS_VACIAR = ['pacientes', 'lotes', 'movs', 'disp', 'aportes', 'comps', 'seg', 'cajas', 'cmovs', 'fichas', 'sellos', 'cupones', 'cuponUsos', 'membresias', 'insumos', 'imovs', 'cultivos', 'cultReg', 'm_altas', 'm_solic', 'm_turnos', 'm_hcs', 'tareas', 'staff'];
  CM.acts['vaciar'] = function () {
    if (!CM.need('ajustes', 'admin')) return;
    CM.modal.open({ title: 'Empezar de cero', body: '<form id="fVC" data-form="vaciar" class="f" autocomplete="off" novalidate><div class="note bad"><b>Esto borra los datos cargados en la nube y en todos los equipos</b>: pacientes, lotes, dispensaciones, donaciones, comprobantes, cajas, cultivo, tareas y personal. Se conservan usuarios, permisos, ajustes, rubros y el menú. No se puede deshacer.</div>' + fl('Para confirmar, escribí BORRAR', '<input class="in" name="conf" autocomplete="off">') + '<p class="err" role="alert" data-err></p></form>', footer: '<button class="btn" data-act="modal-close">Cancelar</button><button class="btn bad" type="submit" form="fVC">Borrar los datos</button>' });
  };
  CM.forms.vaciar = function (f) {
    if (!CM.need('ajustes', 'admin')) return;
    if (f.elements.conf.value.trim() !== 'BORRAR') return fail(f, 'conf', 'Escribí BORRAR en mayúsculas para confirmar.');
    var btn = document.querySelector('button[form=fVC]'); if (btn) btn.disabled = true;
    rpc('sync_vaciar', {}).then(function () {
      var d = CM.db, s = d._s;
      d.pacientes = {}; ['lotes', 'movs', 'disp', 'aportes', 'comps', 'seg', 'cajas', 'cmovs', 'fichas', 'sellos', 'cupones', 'cuponUsos', 'membresias', 'insumos', 'imovs', 'cultivos', 'cultReg', 'tareas', 'staff'].forEach(function (k) { d[k] = []; });
      d.menu.altas = []; d.menu.solicitudes = []; d.menu.turnos = []; d.menu.hcs = []; d.cfg.ejemplo = false; s.res = [];
      Object.keys(s.h).forEach(function (k) { if (COLS_VACIAR.indexOf(k.split('|')[0]) > -1) { delete s.h[k]; delete s.sv[k]; } });
      CM.audit('Empezar de cero', 'Se borraron los datos cargados (pacientes, lotes, donaciones, cajas, cultivo, tareas, personal)'); CM.save();
      CM.modal.close(true); g.location.hash = '#/inicio'; render(); CM.toast('Listo: los datos cargados se borraron.');
    }, function (er) { if (btn) btn.disabled = false; fail(f, 'conf', I.msgErr(er) || 'No se pudo borrar (¿sin conexión?).'); });
  };
  CM.acts['vaciar-ok'] = function () {};

  /* =================================================================
     arranque
     ================================================================= */
  CM.afterRender = (function (prev) {
    return function (r) { if (prev) prev(r); N.chip(); };
  })(CM.afterRender);
  N.instalarFormsPublicos();
  CM.boot = function () {
    CM.init();
    if (!/^#\/(m|acceso)/.test(g.location.hash || '')) g.location.hash = '#/m';
    render();
    var p1 = N.cargarMenu().then(function () { render(); });
    N.verSetup().then(function () { if (ruta() === 'acceso') render(); });
    return p1;
  };
  g.addEventListener('beforeunload', function () { if (N.ses) I.guardarLocal(); });
})(window);
