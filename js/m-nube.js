/* Cannabismatica I+D · Sistema VB ONG · módulo de nube (Supabase, São Paulo)
   - Ingreso con Supabase Auth (correo + clave). Las claves nunca se guardan en el navegador.
   - Datos locales cifrados (AES-GCM, llave PBKDF2-SHA256 200.000 derivada de la clave de la persona) en IndexedDB.
   - Sincronización: el servidor decide permisos por rol, stock y cierres; el cliente sólo envía cambios.
   - Formularios públicos del menú: llegan por una función anónima con límites; el equipo los incorpora.
   Si config.js no trae url/key, el sistema funciona en modo local (demo) sin tocar nada de esto. */
(function (g) {
  'use strict';
  var CM = g.CM, CFG = g.CM_CFG || {};
  var N = CM.nube = { activa: !!(CFG.url && CFG.key) };
  if (!N.activa) return;

  var esc = CM.esc, U = CM.U, fail = U.fail, fl = U.fl, opt = U.opt, $ = U.$, VIEWS = CM.VIEWS;
  var render = function () { CM.render(); };
  var URL_ = String(CFG.url).replace(/\/+$/, '');
  var INACT = (CFG.inactividadMin || 15) * 60000;
  var OFFLINE_MAX_DIAS = 7;
  var ITER = 200000;

  N.ses = null;        // { at, rt, exp, uid, correo, me, eq, key, salt, pw? (nunca) }
  N.anon = true;
  N.online = true;
  N.err = '';
  N.needSetup = false;
  N.cargandoMenu = false;
  N.ultSync = 0;
  N.enCurso = false;
  N.dirty = false;

  /* =================================================================
     utilidades
     ================================================================= */
  function cyrb53(str) {
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57, i, ch;
    for (i = 0; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  N.cyrb53 = cyrb53;
  function hashObj(o) { return cyrb53(JSON.stringify(o)); }
  function b64(buf) {
    var b = new Uint8Array(buf), s = '', i, CH = 0x8000;
    for (i = 0; i < b.length; i += CH) s += String.fromCharCode.apply(null, b.subarray(i, i + CH));
    return g.btoa(s);
  }
  function unb64(s) {
    var bin = g.atob(s), n = bin.length, a = new Uint8Array(n), i;
    for (i = 0; i < n; i++) a[i] = bin.charCodeAt(i);
    return a;
  }
  function rndHex(n) {
    var a = new Uint8Array(n); g.crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }
  function lsGet(k) { try { return g.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { g.localStorage.setItem(k, v); } catch (e) { /* sin acceso */ } }
  function lsDel(k) { try { g.localStorage.removeItem(k); } catch (e) { /* sin acceso */ } }
  function natCmp(a, b) {
    var x = String(a).match(/\d+|\D+/g) || [], y = String(b).match(/\d+|\D+/g) || [], i, n = Math.min(x.length, y.length);
    for (i = 0; i < n; i++) {
      if (x[i] === y[i]) continue;
      var dx = /^\d/.test(x[i]), dy = /^\d/.test(y[i]);
      if (dx && dy) { var d = Number(x[i]) - Number(y[i]); if (d) return d; }
      return x[i] < y[i] ? -1 : 1;
    }
    return x.length - y.length;
  }

  var ERR = {
    sin_permiso: 'No tenés permiso para esa acción.', correo_existente: 'Ya existe un usuario con ese correo.', clave_debil: 'La clave necesita al menos 8 caracteres, con letras y números.',
    correo_invalido: 'Revisá el correo.', nombre_invalido: 'Escribí el nombre (mínimo 3 letras).', rol_invalido: 'Rol inválido.', ultimo_admin: 'Tiene que quedar al menos un administrador activo.',
    codigo_invalido: 'El código de configuración no es correcto.', demasiados_intentos: 'Demasiados intentos. Esperá una hora o pedí un código nuevo a VINCULAR BUSINESS.', ya_configurado: 'El sistema ya está configurado.',
    limite: 'Se enviaron demasiadas solicitudes. Probá de nuevo en un rato.', no_existe: 'No se encontró.', stock_negativo: 'No había stock suficiente en el servidor.', caja_cerrada: 'La caja ya estaba cerrada.',
    solo_agregar: 'Ese registro no se puede modificar (sólo agregar).', no_se_borra: 'Ese registro no se puede borrar.', no_disponible: 'El servicio no está disponible.'
  };
  function msgErr(e) {
    var m = String((e && (e.code || e.message)) || e || '');
    var k = Object.keys(ERR).filter(function (x) { return m.indexOf(x) > -1; })[0];
    return k ? ERR[k] : null;
  }

  /* =================================================================
     red: Auth + PostgREST (sin librerías; sólo la clave publicable)
     ================================================================= */
  function fetchT(url, o, ms) {
    var ctl = g.AbortController ? new g.AbortController() : null, t = null;
    if (ctl) { o.signal = ctl.signal; t = setTimeout(function () { ctl.abort(); }, ms || 25000); }
    return g.fetch(url, o).then(function (r) { clearTimeout(t); return r; }, function (e) { clearTimeout(t); var er = new Error('red'); er.red = true; throw er; });
  }
  function leer(r) {
    return r.text().then(function (t) {
      var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
      if (r.status >= 200 && r.status < 300) return j;
      var er = new Error((j && (j.message || j.msg || j.error_description || j.error)) || ('http_' + r.status));
      er.status = r.status; er.code = (j && (j.message || j.msg || j.error_code)) || ''; er.body = j;
      if (r.status >= 500 || r.status === 0) er.red = true;
      throw er;
    });
  }
  function hdr(auth) {
    var h = { apikey: CFG.key, 'Content-Type': 'application/json' };
    if (auth && N.ses && N.ses.at) h.Authorization = 'Bearer ' + N.ses.at;
    return h;
  }
  function authCall(path, body, method, auth) {
    return fetchT(URL_ + '/auth/v1/' + path, { method: method || 'POST', headers: hdr(auth), body: body ? JSON.stringify(body) : undefined, cache: 'no-store' }).then(leer);
  }
  function refrescar() {
    var s = N.ses; if (!s) return Promise.reject(new Error('sin_sesion'));
    if (s.refPromise) return s.refPromise;
    s.refPromise = authCall('token?grant_type=refresh_token', { refresh_token: s.rt }).then(function (j) {
      s.at = j.access_token; s.rt = j.refresh_token; s.exp = Date.now() + (j.expires_in || 3600) * 1000;
      s.refPromise = null; progGuardar(); return j;
    }, function (e) { s.refPromise = null; throw e; });
    return s.refPromise;
  }
  function conToken(fn) {
    var s = N.ses;
    var p = (s && s.exp - Date.now() < 90000) ? refrescar() : Promise.resolve();
    return p.then(fn).catch(function (e) {
      if (e && e.status === 401 && N.ses && !e.reintento) {
        return refrescar().then(fn).catch(function (e2) { if (e2 && (e2.status === 400 || e2.status === 401 || e2.status === 403)) { cerrarPorRevocacion(); } throw e2; });
      }
      throw e;
    });
  }
  function rpc(nombre, args, anon) {
    var call = function () {
      return fetchT(URL_ + '/rest/v1/rpc/' + nombre, { method: 'POST', headers: hdr(!anon), body: JSON.stringify(args || {}), cache: 'no-store' }).then(leer);
    };
    return anon ? call() : conToken(call);
  }
  function rest(qs) {
    return conToken(function () { return fetchT(URL_ + '/rest/v1/' + qs, { method: 'GET', headers: hdr(true), cache: 'no-store' }, 40000).then(leer); });
  }
  N._rpc = rpc;

  /* =================================================================
     almacenamiento local cifrado (IndexedDB) y llave
     ================================================================= */
  var memBlobs = {};
  function idb() {
    return new Promise(function (ok, no) {
      if (!g.indexedDB) return no(new Error('sin idb'));
      var r = g.indexedDB.open('cmv3', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('b'); };
      r.onsuccess = function () { ok(r.result); };
      r.onerror = function () { no(r.error); };
    });
  }
  function idbGet(k) {
    return idb().then(function (d) { return new Promise(function (ok, no) { var t = d.transaction('b').objectStore('b').get(k); t.onsuccess = function () { ok(t.result || null); }; t.onerror = function () { no(t.error); }; }); }).catch(function () { return memBlobs[k] || null; });
  }
  function idbPut(k, v) {
    memBlobs[k] = v;
    return idb().then(function (d) { return new Promise(function (ok, no) { var tx = d.transaction('b', 'readwrite'); tx.objectStore('b').put(v, k); tx.oncomplete = function () { ok(); }; tx.onerror = function () { no(tx.error); }; }); }).catch(function () { /* queda en memoria */ });
  }
  function idbDel(k) {
    delete memBlobs[k];
    return idb().then(function (d) { return new Promise(function (ok) { var tx = d.transaction('b', 'readwrite'); tx.objectStore('b').delete(k); tx.oncomplete = function () { ok(); }; tx.onerror = function () { ok(); }; }); }).catch(function () { /* nada */ });
  }
  function derivar(pw, salt) {
    var enc = new g.TextEncoder();
    return g.crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']).then(function (km) {
      return g.crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: ITER, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }
  function cifrar(key, salt, obj) {
    var iv = g.crypto.getRandomValues(new Uint8Array(12)), enc = new g.TextEncoder();
    return g.crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(JSON.stringify(obj))).then(function (ct) {
      return { v: 3, s: b64(salt), i: b64(iv), c: b64(ct) };
    });
  }
  function descifrar(key, blob) {
    return g.crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.i) }, key, unb64(blob.c)).then(function (pt) { return JSON.parse(new g.TextDecoder().decode(pt)); });
  }
  N._cifrar = function (pw, obj) { var salt = g.crypto.getRandomValues(new Uint8Array(16)); return derivar(pw, salt).then(function (k) { return cifrar(k, salt, obj); }); };
  N._descifrar = function (pw, blob) { return derivar(pw, unb64(blob.s)).then(function (k) { return descifrar(k, blob); }); };

  var guardandoT = null, guardando = false, guardarOtra = false;
  function guardarLocal() {
    var s = N.ses; if (!s || !s.key || !CM.db) return Promise.resolve();
    if (guardando) { guardarOtra = true; return Promise.resolve(); }
    guardando = true;
    CM.db._s.rt = s.rt; CM.db._s.me = s.me;
    var copia = JSON.stringify(CM.db);
    var iv = g.crypto.getRandomValues(new Uint8Array(12));
    return g.crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, s.key, new g.TextEncoder().encode(copia)).then(function (ct) {
      return idbPut('db_' + s.uid, { v: 3, s: b64(s.salt), i: b64(iv), c: b64(ct) });
    }).catch(function () { /* se reintenta en el próximo guardado */ }).then(function () {
      guardando = false; if (guardarOtra) { guardarOtra = false; progGuardar(); }
    });
  }
  function progGuardar() { clearTimeout(guardandoT); guardandoT = setTimeout(guardarLocal, 500); }

  /* =================================================================
     base vacía (sin datos de ejemplo) y contadores sin choques entre equipos
     ================================================================= */
  function clonar(o) { return JSON.parse(JSON.stringify(o)); }
  function dbVacia() {
    var d = CM.seed();
    ['lotes', 'movs', 'disp', 'aportes', 'comps', 'seg', 'audit', 'cajas', 'cmovs', 'staff', 'fichas', 'tareas', 'sellos', 'cupones', 'cuponUsos', 'planes', 'membresias', 'insumos', 'imovs', 'cultivos', 'cultReg', 'imports', 'contactos', 'users'].forEach(function (k) { d[k] = []; });
    d.pacientes = {}; d.counters = {};
    d.org = (d.org || []).map(function (o) { o.emp = ''; return o; });
    d.cfg.ejemplo = false; d.cfg.operador = ''; d.cfg.rol = 'operador';
    d.ong.reprocann = { estado: 'sin', vence: null, nroInscripcion: '' };
    var draft = CM.menuDefault();
    draft.bloques.wifi = false; draft.wifi.clave = ''; draft.orden = draft.orden.filter(function (b) { return b !== 'wifi'; });
    d.menu = { draft: draft, pub: clonar(draft), versiones: [], altas: [], solicitudes: [], turnos: [], hcs: [] };
    d.nube = { cola: 0, ultima: '' };
    d._s = { v: 3, eq: 0, me: null, cur: 0, h: {}, sv: {}, rech: [], pubh: '', res: [], ult: 0 };
    CM.db = d;
    return d;
  }
  N.dbVacia = dbVacia;

  function alinearContadores() {
    var s = CM.db._s, eq = s.eq || 1, base = (eq - 1) * 1000000, mx = {}, c = CM.db.counters;
    Object.keys(COLS).forEach(function (col) {
      var m = COLS[col].get();
      Object.keys(m).forEach(function (id) {
        var r = /^([A-Za-z]+)-?0*(\d+)$/.exec(id);
        if (r) { var n = Number(r[2]); if (n >= base && n < base + 1000000) mx[r[1]] = Math.max(mx[r[1]] || 0, n); }
      });
    });
    var pref = ['MV', 'D', 'A', 'FCN', 'NCN', 'CP', 'S', 'AU', 'FI', 'T', 'O', 'SE', 'CU', 'MB', 'IM', 'CL', 'HC', 'TU', 'SO', 'CJ', 'CM'];
    Object.keys(c).forEach(function (k) { if (pref.indexOf(k) < 0) pref.push(k); });
    Object.keys(mx).forEach(function (k) { if (pref.indexOf(k) < 0) pref.push(k); });
    pref.forEach(function (k) { c[k] = Math.max(c[k] || 0, base, mx[k] || 0); });
  }

  /* =================================================================
     colecciones sincronizadas (mapa col -> accesos)
     ================================================================= */
  var LOCALES_CFG = { rol: 1, operador: 1, ejemplo: 1, audAlt: 1 };
  var BORRABLES = { staff: 1, tareas: 1, org: 1 };
  var COLS = {};
  function arrAcc(col, getA, setA, orden) {
    var idx = null;
    var acc = {
      col: col, orden: orden || null,
      get: function () { var o = {}, a = getA() || []; a.forEach(function (x) { if (x && x.id != null) o[x.id] = x; }); return o; },
      begin: function () { idx = {}; (getA() || []).forEach(function (x, i) { if (x && x.id != null) idx[x.id] = i; }); },
      end: function () { idx = null; },
      set: function (id, data) {
        var a = getA(); if (!a) { setA([]); a = getA(); }
        var i = idx ? idx[id] : undefined;
        if (i === undefined && !idx) { for (var k = 0; k < a.length; k++) if (a[k] && a[k].id === id) { i = k; break; } }
        if (i !== undefined) a[i] = data; else { a.push(data); if (idx) idx[id] = a.length - 1; }
      },
      del: function (id) { setA((getA() || []).filter(function (x) { return !x || x.id !== id; })); if (idx) acc.begin(); },
      sort: function () {
        var a = getA(); if (!a || a.length < 2) return;
        var o = acc.orden;
        if (o === 'ts-desc') a.sort(function (x, y) { return String(y.ts || '').localeCompare(String(x.ts || '')) || natCmp(y.id, x.id); });
        else if (o) a.sort(function (x, y) { return String(x[o] || '').localeCompare(String(y[o] || '')) || natCmp(x.id, y.id); });
        else a.sort(function (x, y) { return natCmp(x.id, y.id); });
      }
    };
    return acc;
  }
  var ARR = { lotes: 0, movs: 'ts', disp: 'ts', aportes: 'ts', comps: 0, seg: 0, audit: 'ts-desc', rubros: 0, cajas: 'apTs', cmovs: 'ts', staff: 0, fichas: 'ts', tareas: 0, org: 0, sellos: 'ts', cupones: 0, cuponUsos: 'ts', planes: 0, membresias: 0, irubros: 0, insumos: 0, imovs: 'ts', cultivos: 0, cultReg: 'ts' };
  Object.keys(ARR).forEach(function (col) {
    COLS[col] = arrAcc(col, function () { return CM.db[col]; }, function (v) { CM.db[col] = v; }, ARR[col]);
  });
  COLS.pacientes = {
    col: 'pacientes',
    get: function () { return CM.db.pacientes; },
    set: function (id, data) { CM.db.pacientes[id] = data; },
    del: function (id) { delete CM.db.pacientes[id]; },
    begin: function () {}, end: function () {}, sort: function () {}
  };
  function unoAcc(col, getO, setO, filtro) {
    return {
      col: col,
      get: function () { var o = getO(); if (!o) return {}; var v = filtro ? filtro(o) : o; return { main: v }; },
      set: function (id, data) { setO(data); },
      del: function () {}, begin: function () {}, end: function () {}, sort: function () {}
    };
  }
  COLS.cfg = unoAcc('cfg', function () { return CM.db.cfg; }, function (d) { Object.keys(d).forEach(function (k) { if (!LOCALES_CFG[k]) CM.db.cfg[k] = d[k]; }); }, function (o) { var c = {}; Object.keys(o).forEach(function (k) { if (!LOCALES_CFG[k]) c[k] = o[k]; }); return c; });
  COLS.ong = unoAcc('ong', function () { return CM.db.ong; }, function (d) { var o = CM.db.ong; Object.keys(o).forEach(function (k) { delete o[k]; }); Object.keys(d).forEach(function (k) { o[k] = d[k]; }); });
  COLS.m_draft = unoAcc('m_draft', function () { return CM.db.menu.draft; }, function (d) { CM.db.menu.draft = d; });
  COLS.m_pub = unoAcc('m_pub', function () { return CM.db.menu.pub; }, function (d) { CM.db.menu.pub = d; });
  COLS.m_vers = arrAcc('m_vers', function () { return CM.db.menu.versiones; }, function (v) { CM.db.menu.versiones = v; }, 'ts');
  COLS.m_altas = arrAcc('m_altas', function () { return CM.db.menu.altas; }, function (v) { CM.db.menu.altas = v; }, 'ts');
  COLS.m_solic = arrAcc('m_solic', function () { return CM.db.menu.solicitudes; }, function (v) { CM.db.menu.solicitudes = v; }, 'ts');
  COLS.m_turnos = arrAcc('m_turnos', function () { return CM.db.menu.turnos; }, function (v) { CM.db.menu.turnos = v; }, 'ts');
  COLS.m_hcs = arrAcc('m_hcs', function () { return CM.db.menu.hcs; }, function (v) { CM.db.menu.hcs = v; }, 'ts');
  var CATALOGOS = ['cfg', 'ong', 'rubros', 'irubros', 'm_draft', 'm_pub'];
  var DEFECTOS_SEMBRAR = ['cfg', 'ong', 'rubros', 'irubros', 'org', 'm_draft', 'm_pub'];

  function normalizar() {
    var m = CM.db.menu, eq = (CM.db._s && CM.db._s.eq) || 0;
    (m.versiones || []).forEach(function (x) { if (x.id == null) x.id = 'V' + x.v + '-' + eq; });
    ['altas', 'solicitudes', 'turnos', 'hcs'].forEach(function (k) { if (!Array.isArray(m[k])) m[k] = []; });
    ['cultivos', 'cultReg', 'staff', 'fichas', 'sellos', 'tareas', 'org', 'cupones', 'cuponUsos', 'planes', 'membresias', 'irubros', 'insumos', 'imovs', 'cmovs', 'cajas', 'comps', 'seg', 'audit', 'disp', 'aportes', 'movs', 'lotes', 'rubros', 'imports', 'contactos'].forEach(function (k) { if (!Array.isArray(CM.db[k])) CM.db[k] = []; });
    if (!CM.db.pacientes || typeof CM.db.pacientes !== 'object') CM.db.pacientes = {};
  }

  /* =================================================================
     auditoría: una cadena de hashes por equipo (entre equipos no se puede encadenar)
     ================================================================= */
  var audit0 = CM.audit;
  CM.audit = function (accion, detalle) {
    if (N.anon || !CM.db._s) return audit0(accion, detalle);
    var a = CM.db.audit, eq = CM.db._s.eq, prev = 'GENESIS', i;
    for (i = 0; i < a.length; i++) { if (a[i].dv === eq && a[i].h) { prev = a[i].h; break; } }
    var e = { id: CM.nextId('AU'), ts: new Date().toISOString(), user: CM.db.cfg.operador || 'Sistema', rol: CM.db.cfg.rol || '', accion: accion, detalle: String(detalle || '').slice(0, 300), prev: prev, dv: eq };
    e.h = CM.sha256([e.prev, e.id, e.ts, e.user, e.rol || '', e.accion, e.detalle].join('|'));
    a.unshift(e);
  };
  CM.verificarAuditoria = function () {
    var a = CM.db.audit, por = {}, malos = [], n = 0, i;
    for (i = a.length - 1; i >= 0; i--) { var e = a[i]; if (!e.h) continue; (por[e.dv == null ? 'x' : e.dv] = por[e.dv == null ? 'x' : e.dv] || []).push(e); }
    Object.keys(por).forEach(function (k) {
      var lst = por[k].sort(function (x, y) { return String(x.ts).localeCompare(String(y.ts)) || natCmp(x.id, y.id); }), prevH = null;
      lst.forEach(function (e) {
        n++;
        var h = CM.sha256([e.prev, e.id, e.ts, e.user, e.rol || '', e.accion, e.detalle].join('|'));
        if (h !== e.h) malos.push(e.id + ' (contenido)');
        else if (prevH !== null && e.prev !== prevH) malos.push(e.id + ' (cadena)');
        prevH = e.h;
      });
    });
    return { ok: !malos.length, n: n, malos: malos };
  };

  /* =================================================================
     sincronización
     ================================================================= */
  function partirKey(k) { var i = k.indexOf('|'); return [k.slice(0, i), k.slice(i + 1)]; }
  function diferencias() {
    var s = CM.db._s, out = [], vistos = {};
    Object.keys(COLS).forEach(function (col) {
      var m = COLS[col].get();
      Object.keys(m).forEach(function (id) {
        var key = col + '|' + id; vistos[key] = 1;
        var hv = hashObj(m[id]);
        if (s.h[key] !== hv) out.push({ col: col, id: id, data: m[id], h: hv, key: key });
      });
    });
    Object.keys(s.h).forEach(function (key) {
      if (vistos[key]) return;
      var p = partirKey(key); if (!COLS[p[0]]) return;
      out.push({ col: p[0], id: p[1], del: true, key: key });
    });
    return out;
  }
  N.pendientes = function () { try { return diferencias().length; } catch (e) { return 0; } };

  function aplicarFila(row, tocadas) {
    var s = CM.db._s, c = COLS[row.col]; if (!c) return;
    var key = row.col + '|' + row.id, local = c.get()[row.id];
    if (s.sv[key] !== undefined && s.sv[key] >= row.v) return;
    if (local !== undefined && s.h[key] !== undefined && hashObj(local) !== s.h[key]) { s.sv[key] = row.v; return; }   // cambio local pendiente: gana el último en llegar
    tocadas[row.col] = 1;
    if (row.borrado) { if (local !== undefined) c.del(row.id); delete s.h[key]; s.sv[key] = row.v; return; }
    c.set(row.id, row.data);
    var nuevo = c.get()[row.id];
    s.h[key] = hashObj(nuevo); s.sv[key] = row.v;
  }
  function traer() {
    var s = CM.db._s, desde = Math.max(0, (s.cur || 0) - 300), total = 0, cambios = {};
    Object.keys(COLS).forEach(function (k) { COLS[k].begin(); });
    function paso() {
      return rest('registros?select=col,id,data,v,seq,borrado&seq=gt.' + desde + '&order=seq.asc&limit=1000').then(function (rows) {
        rows.forEach(function (r) { aplicarFila(r, cambios); if (r.seq > (s.cur || 0)) s.cur = r.seq; });
        total += rows.length;
        if (rows.length >= 1000) { desde = rows[rows.length - 1].seq; return paso(); }
      });
    }
    return paso().then(function () {
      Object.keys(COLS).forEach(function (k) { COLS[k].end(); if (cambios[k]) COLS[k].sort(); });
      return { filas: total, cambios: cambios };
    }, function (e) { Object.keys(COLS).forEach(function (k) { COLS[k].end(); }); throw e; });
  }
  function restaurarDelServidor(items) {
    // vuelve a leer del servidor los registros rechazados (o los quita si nunca existieron allá)
    var s = CM.db._s;
    return Promise.all(items.map(function (it) {
      return rest('registros?select=col,id,data,v,borrado&col=eq.' + encodeURIComponent(it.col) + '&id=eq.' + encodeURIComponent(it.id)).then(function (rows) {
        var c = COLS[it.col], key = it.col + '|' + it.id;
        if (rows && rows[0] && !rows[0].borrado) { delete s.sv[key]; delete s.h[key]; c.begin(); c.set(it.id, rows[0].data); c.end(); s.h[key] = hashObj(c.get()[it.id]); s.sv[key] = rows[0].v; }
        else { if (c.get()[it.id] !== undefined) c.del(it.id); delete s.h[key]; delete s.sv[key]; }
      }).catch(function () { /* reintenta en el próximo ciclo */ });
    }));
  }
  function nombreCol(col) {
    return { movs: 'movimiento de stock', disp: 'dispensación', aportes: 'donación', comps: 'comprobante', cajas: 'caja', cmovs: 'movimiento de caja', pacientes: 'paciente', fichas: 'fichaje', sellos: 'sello', cuponUsos: 'uso de cupón' }[col] || col;
  }
  function rechazar(it, err) {
    var s = CM.db._s;
    s.rech.unshift({ ts: new Date().toISOString(), col: it.col, id: it.id, err: String(err || ''), txt: msgErr(err) || String(err || '') });
    if (s.rech.length > 50) s.rech.length = 50;
  }
  function empujar() {
    var s = CM.db._s;
    var difs = diferencias();
    if (!difs.length) return Promise.resolve({ enviados: 0, rechazados: 0 });
    var restaurar = [], enviar = [], descartarLocal = [];
    difs.forEach(function (d) {
      if (d.del && !BORRABLES[d.col]) { restaurar.push(d); return; }
      enviar.push(d);
    });
    // movimientos de stock primero: si el servidor rechaza uno, se descartan las operaciones que dependen de él
    enviar.sort(function (a, b) { return (a.col === 'movs' ? 0 : 1) - (b.col === 'movs' ? 0 : 1); });
    var stats = { enviados: 0, rechazados: 0 };
    function lote(items) {
      if (!items.length) return Promise.resolve([]);
      var cambios = items.map(function (d) { return d.del ? { col: d.col, id: d.id, del: true } : { col: d.col, id: d.id, data: d.data }; });
      return rpc('sync_push', { p_cambios: cambios }).then(function (res) {
        var rech = [];
        (res || []).forEach(function (r, i) {
          var it = items[i]; if (!it) return;
          var key = it.key;
          if (r.ok) {
            stats.enviados++;
            if (it.del) { delete s.h[key]; delete s.sv[key]; } else { s.h[key] = it.h; if (r.v) s.sv[key] = r.v; }
          } else { stats.rechazados++; rech.push({ it: it, err: r.err }); }
        });
        return rech;
      });
    }
    function en300(arr) { var out = []; for (var i = 0; i < arr.length; i += 100) out.push(arr.slice(i, i + 100)); return out; }
    var movs = enviar.filter(function (d) { return d.col === 'movs'; }), resto = enviar.filter(function (d) { return d.col !== 'movs'; });
    var rechazos = [];
    function seq(batches) { return batches.reduce(function (p, b) { return p.then(function () { return lote(b).then(function (r) { rechazos = rechazos.concat(r); }); }); }, Promise.resolve()); }
    return seq(en300(movs)).then(function () {
      // dependientes de movimientos rechazados por stock
      var malRefs = {};
      rechazos.forEach(function (r) { if (r.it.col === 'movs' && /stock_negativo/.test(r.err || '') && r.it.data && r.it.data.ref) malRefs[r.it.data.ref] = r.it.id; });
      var dispMal = {}, apMal = {};
      resto = resto.filter(function (d) {
        if (d.col === 'disp' && malRefs[d.id]) { dispMal[d.id] = 1; descartarLocal.push(d); return false; }
        return true;
      });
      resto = resto.filter(function (d) {
        if (d.col === 'aportes' && d.data && dispMal[d.data.disp]) { apMal[d.id] = 1; descartarLocal.push(d); return false; }
        return true;
      });
      resto = resto.filter(function (d) {
        if (d.col === 'comps' && d.data && apMal[d.data.aporte]) { descartarLocal.push(d); return false; }
        return true;
      });
      return seq(en300(resto));
    }).then(function () {
      var rest2 = [];
      rechazos.forEach(function (r) { rechazar(r.it, r.err); rest2.push(r.it); });
      descartarLocal.forEach(function (d) {
        rechazar(d, 'stock_negativo');
        var c = COLS[d.col]; if (c.get()[d.id] !== undefined) { c.del(d.id); }
        delete s.h[d.key]; delete s.sv[d.key];
      });
      restaurar.forEach(function (d) { rechazar(d, 'no_se_borra'); });
      if (rechazos.length || descartarLocal.length || restaurar.length) {
        N.avisoRech = true;
        CM.audit('Cambios rechazados por el servidor', (rechazos.length + descartarLocal.length + restaurar.length) + ' registro(s); ver Nube');
      }
      return restaurarDelServidor(rest2.concat(restaurar)).then(function () { return stats; });
    });
  }

  /* ---- solicitudes públicas (menú) -> registros del sistema ---- */
  function limpio(s, n) { return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n || 200); }
  function claveDeterminista(nonce) {
    var h = cyrb53('k1|' + nonce), h2 = cyrb53('k2|' + nonce), d = '', i;
    var n = parseInt(h, 36) % 1e11, m = parseInt(h2, 36) % 1e11;
    d = String((n + m) % 1e11).padStart(11, '0');
    return '88' + d;
  }
  function materializar(sol) {
    var db = CM.db, p = sol.payload || {}, hecho = false;
    if (sol.tipo === 'hc') {
      if (db.menu.hcs.some(function (x) { return x.nonce === sol.nonce; })) return true;
      var nombre = limpio(p.nombre, 120), tel = CM.soloDigitos(p.tel).slice(-10), email = limpio(p.email, 120), nac = String(p.nac || '');
      var doc = null, vd = null;
      if (p.doc && p.doc.tipo) { vd = CM.validarDoc(String(p.doc.tipo), String(p.doc.num || '')); if (!vd.ok) return false; doc = vd.doc; }
      if (nombre.length < 3 || tel.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(nac) || nac > CM.hoy() || nac < '1900-01-01' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return false;
      var nl0 = CM.nuevoLegajo, nk0 = CM.claveNueva;
      CM.nuevoLegajo = function () { return sol.leg || nl0(); };
      CM.claveNueva = function () { var k = claveDeterminista(sol.nonce); return db.pacientes[k] ? nk0() : k; };
      try {
        var rep = p.rep && p.rep.estado === 'tramite' ? { estado: 'tramite', vence: null, carnet: false } : { estado: 'sin', vence: null, carnet: false };
        var pac = CM.nuevoPaciente({ nombre: nombre, tel: tel, doc: doc, nac: nac, email: email, dir: limpio(p.dir, 200), cp: limpio(p.cp, 10), obraSocial: limpio(p.obraSocial, 80), ocupacion: limpio(p.ocupacion, 80), motivo: limpio(p.motivo, 300), dudas: limpio(p.dudas, 300), tutor: limpio(p.tutor, 120), historiaCompleta: true, consentimiento: String(sol.ts || '').slice(0, 10) || CM.hoy(), reprocann: rep, origen: 'menú público', revisar: true });
        pac.repDeclarado = limpio(p.repDeclarado, 40); pac.comerciales = !!p.comerciales;
        db.menu.hcs.push({ id: 'HC-' + sol.nonce.slice(0, 40), ts: sol.ts || new Date().toISOString(), leg: pac.leg, pac: pac.dni, nombre: nombre, estado: 'pendiente', dup: pac.posibleDup || '', nonce: sol.nonce });
        CM.audit('Solicitud de historia clínica (menú público)', 'Legajo ' + pac.leg + ' · pendiente de verificación' + (pac.posibleDup ? ' · documento repetido: posible duplicado' : ''));
        hecho = true;
      } finally { CM.nuevoLegajo = nl0; CM.claveNueva = nk0; }
      return hecho;
    }
    if (sol.tipo === 'turno') {
      var idT = 'TU-' + sol.nonce.slice(0, 40);
      if (db.menu.turnos.some(function (x) { return x.id === idT; })) return true;
      var t10 = CM.soloDigitos(p.tel10).slice(-10), ident = limpio(p.ident, 80), fecha = String(p.fecha || '');
      if (ident.length < 3 || t10.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
      var pc = CM.resolverPac ? CM.resolverPac(ident) : null;
      db.menu.turnos.push({ id: idT, ts: sol.ts || new Date().toISOString(), ident: ident, pac: pc ? pc.dni : '', tel10: t10, motivo: limpio(p.motivo, 80), fecha: fecha, franja: limpio(p.franja, 40), nota: limpio(p.nota, 200), estado: 'solicitado' });
      CM.audit('Pedido de turno (menú público)', (pc ? 'Legajo ' + pc.leg : 'sin ficha identificada') + ' · ' + fecha);
      return true;
    }
    if (sol.tipo === 'club') {
      var idC = 'CL-' + sol.nonce.slice(0, 40);
      if (db.menu.altas.some(function (x) { return x.id === idC; })) return true;
      var c10 = CM.soloDigitos(p.tel10).slice(-10), nom = limpio(p.nom, 60), ape = limpio(p.ape, 60), nc = String(p.nac || '');
      if (nom.length < 2 || ape.length < 2 || c10.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(nc) || nc > CM.hoy() || CM.edad(nc) < 18) return false;
      var ya = db.menu.altas.some(function (a) { return a.tel10 === c10; }) || Object.keys(db.pacientes).some(function (k) { return CM.soloDigitos(db.pacientes[k].tel).slice(-10) === c10; });
      if (!ya) {
        db.menu.altas.push({ id: idC, ts: sol.ts || new Date().toISOString(), nom: nom, ape: ape, nac: nc, tel10: c10, estado: 'pendiente', origen: 'menú público', cons: { club: true, comerciales: !!(p.cons && p.cons.comerciales), estadisticas: !!(p.cons && p.cons.estadisticas), version: limpio(p.cons && p.cons.version, 12) } });
        CM.audit('Alta al club (menú público)', 'Pendiente de revisión · ' + nom + ' ' + ape);
      }
      return true;
    }
    return false;
  }
  function incorporarSolicitudes() {
    if (!(CM.can('menu', 'oper') || CM.can('pacientes', 'oper'))) return Promise.resolve(0);
    return rpc('solicitudes_listar', {}).then(function (lst) {
      var n = 0, s = CM.db._s;
      (lst || []).forEach(function (sol) {
        var ok = false;
        try { ok = materializar(sol); } catch (e) { ok = false; }
        if (!ok) CM.audit('Solicitud pública descartada', 'Datos inválidos (' + sol.tipo + ')');
        else n++;
        if (s.res.indexOf(sol.id) < 0) s.res.push(sol.id);
      });
      return n;
    }, function () { return 0; });
  }
  function resolverSolicitudes() {
    var s = CM.db._s, ids = s.res.slice();
    return ids.reduce(function (p, id) {
      return p.then(function () { return rpc('solicitud_resolver', { p_id: id }).then(function () { s.res = s.res.filter(function (x) { return x !== id; }); }, function () { /* próximo ciclo */ }); });
    }, Promise.resolve());
  }
  function publicarMenu() {
    var s = CM.db._s, m = CM.db.menu;
    if (!CM.can('menu', 'edit') || !m.pub) return Promise.resolve();
    var h = hashObj(m.pub);
    if (s.pubh === h) return Promise.resolve();
    return rpc('menu_publicar', { p_data: m.pub }).then(function () { s.pubh = h; });
  }

  function sembrar(vacioCfg) {
    // primer administrador: sube el menú y la configuración base (los demás equipos las reciben por la sincronización)
    var s = CM.db._s;
    DEFECTOS_SEMBRAR.forEach(function (col) { var m = COLS[col].get(); Object.keys(m).forEach(function (id) { delete s.h[col + '|' + id]; }); });
  }
  function limpiarDefectosLocales() {
    // un equipo nuevo que se une a una organización ya configurada no debe subir sus valores por defecto
    var s = CM.db._s;
    CATALOGOS.concat(['org']).forEach(function (col) {
      if (col === 'cfg' || col === 'ong' || col === 'm_draft' || col === 'm_pub') return;
      var c = COLS[col], m = c.get();
      Object.keys(m).forEach(function (id) { if (s.sv[col + '|' + id] === undefined) c.del(id); });
    });
  }

  function aplicarMe(me) {
    var s = N.ses, antes = s.me ? s.me.rol : null, pAntes = JSON.stringify(CM.db.perms || null);
    s.me = { nombre: me.nombre, correo: me.correo, rol: me.rol, cambiar: !!me.cambiar, tenant: me.tenant && me.tenant.nombre };
    CM.db.cfg.rol = me.rol; CM.db.cfg.operador = me.nombre; CM.db.perms = me.perms || CM.db.perms;
    return (antes !== null && antes !== me.rol) || pAntes !== JSON.stringify(CM.db.perms || null);
  }
  N.aplicarMe = aplicarMe;
  function refreshMe() {
    return rpc('miembro_actual', {}).then(function (me) {
      if (!me) { cerrarPorRevocacion(); throw new Error('revocada'); }
      return aplicarMe(me);
    });
  }
  N.refreshMe = refreshMe;
  function ciclo() {
    if (N.enCurso || N.anon || !N.ses) return Promise.resolve();
    N.enCurso = true; N.estadoTxt = 'Sincronizando…'; actualizarChip();
    var s = CM.db._s, primera = !s.cur && !s.ini, rolCambio = false;
    return (N.ses.exp - Date.now() < 90000 ? refrescar() : Promise.resolve()).then(function () { return refreshMe(); }).then(function (c) { rolCambio = c; return traer(); }).then(function (r) {
      if (rolCambio) r.cambios.rol = 1;
      if (primera) {
        s.ini = true;
        if (s.sv['cfg|main'] !== undefined) limpiarDefectosLocales();
        else if (N.ses.me.rol === 'admin') sembrar();
      }
      normalizar(); alinearContadores();
      return incorporarSolicitudes().then(function () { return r; });
    }).then(function (r) {
      return empujar().then(function (st) { return { r: r, st: st }; });
    }).then(function (x) {
      return resolverSolicitudes().then(function () { return publicarMenu(); }).then(function () { return x; });
    }).then(function (x) {
      N.online = true; N.err = ''; N.ultSync = Date.now(); s.ult = N.ultSync; N.dirty = false; N.pend = 0;
      N.enCurso = false; progGuardar();
      if (N.avisoRech) { N.avisoRech = false; CM.toast('Algunos cambios no se guardaron en la nube. Mirá la sección Nube.', true); }
      refrescarVista(x.r && Object.keys(x.r.cambios).length > 0);
    }).catch(function (e) {
      N.enCurso = false;
      if (e && e.message === 'revocada') return;
      if (e && e.red) { N.online = false; N.err = 'Sin conexión'; try { N.pend = diferencias().length; } catch (e2) { /* nada */ } }
      else { N.err = msgErr(e) || 'Error de sincronización'; if (e && (e.status === 401 || e.status === 403)) { N.online = true; } }
      actualizarChip();
    }).then(function () { actualizarChip(); });
  }
  N.sincronizar = ciclo;
  var syncT = null, intT = null;
  function progSync(ms) { if (N.anon) return; clearTimeout(syncT); syncT = setTimeout(ciclo, ms == null ? 1500 : ms); }
  function refrescarVista(huboCambios) {
    if (!huboCambios) return;
    var a = document.activeElement, tag = a && a.tagName;
    if (CM.modal.isOpen() || (a && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'))) return;
    render();
  }

  /* =================================================================
     guardado, sesión, inactividad
     ================================================================= */
  CM.save = function () {
    if (N.anon || !N.ses) return;
    var eq = CM.db._s.eq;
    CM.db.aportes.forEach(function (a) { if (a.eq == null) a.eq = eq; });
    N.dirty = true; progGuardar(); progSync(1500); actualizarChip();
  };
  CM.reset = function () { /* sin datos de ejemplo en la versión con nube */ };
  CM.init = function () { dbVacia(); N.anon = true; };

  var inactT = null;
  function ping() { if (N.ses) { clearTimeout(inactT); inactT = setTimeout(function () { salir('inactividad'); }, INACT); } }
  ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach(function (ev) { g.addEventListener(ev, ping, { passive: true }); });

  CM.usuarioActual = function () {
    var s = N.ses; if (!s) return null;
    return { id: s.uid, nombre: s.me.nombre, correo: s.me.correo, rol: s.me.rol, activo: true, cambiar: !!s.me.cambiar };
  };
  CM.sesionOk = function () { return !!N.ses; };
  CM.login = function () { return { err: 'Ingreso no disponible.' }; };
  CM.logout = function () { salir('manual'); };

  function salir(motivo, sinMsg) {
    var s = N.ses; if (!s) return;
    clearTimeout(inactT); clearInterval(intT); clearTimeout(syncT);
    var fin = function () {
      N.ses = null;
      try { authCall('logout?scope=local', null, 'POST', true).catch(function () { /* nada */ }); } catch (e) { /* nada */ }
      dbVacia(); N.anon = true;
      N.cargarMenu().then(render);
      g.location.hash = '#/m'; render();
      if (!sinMsg) CM.toast(motivo === 'inactividad' ? 'Cerramos tu sesión por inactividad.' : motivo === 'revocada' ? 'Tu acceso fue modificado o dado de baja. Volvé a ingresar.' : 'Cerraste la sesión.', motivo === 'revocada');
    };
    var esp = (!N.enCurso && N.online && N.dirty) ? ciclo() : Promise.resolve();
    esp.then(function () { return guardarLocal(); }).then(fin, fin);
  }
  function cerrarPorRevocacion() { if (N.ses) salir('revocada'); }
  N.salir = salir;

  g.addEventListener('online', function () { if (N.ses) progSync(500); });
  g.addEventListener('pagehide', function () { if (N.ses) guardarLocal(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) { if (N.ses) guardarLocal(); } else if (N.ses) progSync(300); });

  /* =================================================================
     menú público para visitantes (sin sesión)
     ================================================================= */
  N.cargarMenu = function () {
    return rpc('pub_menu_obtener', {}, true).then(function (r) {
      if (r && r.data && CM.db && N.anon) { CM.db.menu.pub = r.data; CM.db.menu.draft = clonar(r.data); lsSet('cmv3_menu', JSON.stringify(r.data)); }
      N.menuOk = true;
    }, function () {
      var c = lsGet('cmv3_menu');
      if (c && CM.db && N.anon) { try { var d = JSON.parse(c); CM.db.menu.pub = d; CM.db.menu.draft = clonar(d); } catch (e) { /* nada */ } }
    });
  };
  N.verSetup = function () {
    return rpc('bootstrap_estado', {}, true).then(function (b) { N.needSetup = !b; }, function () { /* se asume configurado */ });
  };

  /* envío de formularios públicos: la visita no tiene datos; se manda a la función anónima y el equipo lo incorpora */
  function nonceNuevo() { return rndHex(12); }
  function envolverPublico(nombre, tipo, armar, desarmar) {
    var orig = CM.forms[nombre];
    CM.forms[nombre] = function (f, ev) {
      if (!N.anon) return orig(f, ev);
      var m = CM.db.menu, antes = { hcs: m.hcs.length, turnos: m.turnos.length, altas: m.altas.length };
      var r0 = CM.render; CM.render = function () {};
      try { orig(f, ev); } finally { CM.render = r0; }
      var nuevo = tipo === 'hc' ? m.hcs.length > antes.hcs : tipo === 'turno' ? m.turnos.length > antes.turnos : m.altas.length > antes.altas;
      if (!nuevo) return;
      var nonce = tipo === 'hc' ? (m.hcs[m.hcs.length - 1].nonce || nonceNuevo()) : (f.dataset.nonce = f.dataset.nonce || nonceNuevo());
      var payload = armar(f);
      var en = CM.pub.lang === 'en';
      var btn = f.querySelector('button[type=submit]'); if (btn) btn.disabled = true;
      rpc('pub_solicitud', { p_tipo: tipo, p_payload: payload, p_nonce: nonce }, true).then(function (res) {
        if (tipo === 'hc' && res && res.leg) { CM.pub.hcOk = CM.pub.hcOk || {}; CM.pub.hcOk.leg = res.leg; if (CM.pub.hcHechos) CM.pub.hcHechos[nonce] = { leg: res.leg }; }
        render();
      }, function (e) {
        desarmar(m, antes, nonce);
        if (btn) btn.disabled = false;
        var lim = /limite/.test(String(e && (e.message || e.code)));
        fail(f, tipo === 'club' ? 'nom' : tipo === 'turno' ? 'ident' : 'nom', lim ? (en ? 'Too many requests. Please try again later.' : 'Se enviaron demasiadas solicitudes. Probá de nuevo en un rato.') : (en ? 'We could not send it. Check your connection and try again.' : 'No pudimos enviarlo. Revisá la conexión y probá de nuevo.'));
      });
    };
  }
  function instalarFormsPublicos() {
    envolverPublico('pub-hc', 'hc', function () {
      var m = CM.db.menu, h = m.hcs[m.hcs.length - 1], p = CM.db.pacientes[h.pac] || {};
      return { nombre: p.nombre, tel: p.tel, doc: p.doc || null, nac: p.nac, email: p.email, dir: p.dir, cp: p.cp, obraSocial: p.obraSocial, ocupacion: p.ocupacion, motivo: p.motivo, dudas: p.dudas, tutor: p.tutor || '', repDeclarado: p.repDeclarado, comerciales: !!p.comerciales, rep: p.reprocann || null };
    }, function (m, antes, nonce) {
      var h = m.hcs.pop(); if (h) delete CM.db.pacientes[h.pac];
      CM.pub.hcOk = null; CM.pub.hcNonce = nonce; if (h && CM.pub.hcHechos) delete CM.pub.hcHechos[h.nonce];
    });
    envolverPublico('pub-turno', 'turno', function () {
      var t = CM.db.menu.turnos[CM.db.menu.turnos.length - 1];
      return { ident: t.ident, tel10: t.tel10, motivo: t.motivo, fecha: t.fecha, franja: t.franja, nota: t.nota };
    }, function (m) { m.turnos.pop(); CM.pub.turnoOk = null; });
    envolverPublico('pub-club', 'club', function () {
      var a = CM.db.menu.altas[CM.db.menu.altas.length - 1];
      return { nom: a.nom, ape: a.ape, nac: a.nac, tel10: a.tel10, cons: a.cons };
    }, function (m) { m.altas.pop(); CM.pub.enviado = false; });
  }
  N.instalarFormsPublicos = instalarFormsPublicos;

  /* resto de las pantallas y el ingreso: ver m-nube2.js */
  N._i = { rpc: rpc, authCall: authCall, refrescar: refrescar, derivar: derivar, cifrar: cifrar, descifrar: descifrar, idbGet: idbGet, idbPut: idbPut, idbDel: idbDel, guardarLocal: guardarLocal, normalizar: normalizar, alinearContadores: alinearContadores, ciclo: ciclo, progSync: progSync, ping: ping, salir: salir, lsGet: lsGet, lsSet: lsSet, lsDel: lsDel, rndHex: rndHex, b64: b64, unb64: unb64, msgErr: msgErr, cerrarPorRevocacion: cerrarPorRevocacion, dbVacia: dbVacia, clonar: clonar, hashObj: hashObj, COLS: COLS, diferencias: diferencias, ITER: ITER, OFFLINE_MAX_DIAS: OFFLINE_MAX_DIAS };
  function actualizarChip() { if (N.chip) N.chip(); }
  N.setIntervalo = function () { clearInterval(intT); intT = setInterval(function () { if (N.ses && !document.hidden) ciclo(); }, 15000); };
  N.stopIntervalo = function () { clearInterval(intT); };
})(window);
