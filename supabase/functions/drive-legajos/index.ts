// Sistema VB ONG · Función de servidor «drive-legajos» (Supabase Edge Function, Deno) · 2026-11-01
// Google Drive de la ONG SIN conectar en cada equipo, apta para Gmail común:
//   una persona ADMINISTRADORA autoriza una sola vez («Conectar Google Drive de la ONG»); el servidor guarda
//   el permiso (refresh token) cifrado en la bóveda de Supabase y desde ahí crea las carpetas y sube los archivos
//   para cualquier equipo. El navegador nunca recibe tokens de Google.
// Permiso pedido a Google: «drive.file» (sólo ve y toca lo que crea este sistema) + correo de la cuenta.
//
// POST (Authorization: Bearer <JWT del usuario>, JSON):
//   { accion: 'estado' }                         → cualquier miembro activo
//   { accion: 'conectar' }                       → admin: devuelve la dirección de Google para autorizar
//   { accion: 'desconectar' }                    → admin: revoca y borra el permiso
//   { accion: 'carpeta', legajo, dni }           → crea o reutiliza Legajos/{legajo}_{DNI|SD}
//   { accion: 'subir', legajo, dni, nombre, mime, tipo, version, hash, b64 } → sube a la carpeta del legajo
//   { accion: 'picker' }                       → admin: datos públicos para abrir el selector de Google
//   { accion: 'vincular', items:[{fileId,nombre,legajo,dni}] } → admin: acceso directo al archivo anterior en la carpeta del legajo
//   { accion: 'formularios', archivo }         → admin/supervisor/mostrador: lee las hojas «Respuestas de formulario…» de la planilla
//        de respuestas de los Formularios de Google (elegida una vez con el selector), exportándola como .xlsx con la API de Drive
//        (no hace falta habilitar la API de Sheets). Sólo lectura; nunca escribe en la planilla.
//   { accion: 'planilla', ciclo, cicloNombre, nombre, version, hash, b64 }  → sube la planilla de cultivo (CSV)
//        a «Planillas de cultivo · ONG / {ciclo} · {nombre}»; nunca pisa: archivo nuevo por versión, mismo contenido = no repite
// GET ?code&state (vuelta desde Google): guarda el permiso y vuelve al sistema.
// Secretos: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, ALLOWED_ORIGINS, SITE_URL, GOOGLE_PICKER_API_KEY, GOOGLE_PROJECT_NUMBER
//           (SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY los provee Supabase).
// «Verify JWT» APAGADO: la vuelta de Google no trae sesión; cada acción POST valida el JWT acá.

type Env = (k: string) => string | undefined;
export type Fetch = (url: string, init?: any) => Promise<Response>;
export type Deps = { env: Env; fetch: Fetch; ahora?: () => number };

const SCOPES = 'openid email https://www.googleapis.com/auth/drive.file';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const CARPETA = 'application/vnd.google-apps.folder';
const MAX = 10 * 1024 * 1024;
const MIMES: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' };
const ROLES = ['admin', 'supervisor', 'mostrador', 'operador'];
const RE_LEG = /^L-\d{6}-[2-9A-HJKMNP-Z]{6}$/;
const RE_ID = /^[A-Za-z0-9_-]{10,120}$/;
const RE_CICLO = /^CU-[A-Z0-9-]{4,24}$/;
const MAX_CSV = 5 * 1024 * 1024;
const MAX_FILAS = 3000;

class Falla extends Error { status: number; codigo: string; constructor(status: number, codigo: string, msg: string) { super(msg); this.status = status; this.codigo = codigo; } }

/* ---------- utilidades ---------- */
const te = new TextEncoder();
function b64u(b: Uint8Array | string) { const u = typeof b === 'string' ? te.encode(b) : b; let s = ''; for (const x of u) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function deB64u(s: string) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
function hex(b: ArrayBuffer) { return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join(''); }
async function hmac(clave: string, dato: string) { const k = await crypto.subtle.importKey('raw', te.encode(clave), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return b64u(new Uint8Array(await crypto.subtle.sign('HMAC', k, te.encode(dato)))); }
function q(s: string) { return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; }
function limpio(s: string, n: number) { return String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n); }

/* ---------- planilla de Google exportada como .xlsx (sólo Drive API; no requiere la API de Sheets) ---------- */
async function inflar(b: Uint8Array) {
  const ds = new (globalThis as any).DecompressionStream('deflate-raw');
  const out = new Response(new Blob([b]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}
export async function leerZip(z: Uint8Array) {
  const dv = new DataView(z.buffer, z.byteOffset, z.byteLength), td = new TextDecoder();
  let e = -1; for (let i = z.length - 22; i >= Math.max(0, z.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Falla(422, 'xlsx', 'La planilla exportada no se pudo leer.');
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
  const files: Record<string, Uint8Array> = {};
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const met = dv.getUint16(p + 10, true), cs = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = td.decode(z.subarray(p + 46, p + 46 + nl));
    const ini = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true), data = z.subarray(ini, ini + cs);
    if (/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(name)) files[name] = met === 8 ? await inflar(data) : met === 0 ? data : new Uint8Array();
    p += 46 + nl + xl + cl;
  }
  return files;
}
function ent(s: string) { return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, c) => c[0] === '#' ? String.fromCodePoint(c[1] === 'x' || c[1] === 'X' ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10)) : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as any)[c.toLowerCase()]); }
function textos(x: string) { let o = ''; for (const m of x.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) o += m[1]; return ent(o); }
function colN(r: string) { const l = (/^[A-Z]+/.exec(r) || [''])[0]; let n = 0; for (const ch of l) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; }
export async function leerXlsx(bytes: Uint8Array, filtro: (t: string) => boolean, maxFilas: number) {
  const f = await leerZip(bytes), td = new TextDecoder(), txt = (k: string) => f[k] ? td.decode(f[k]) : '';
  const sst = [...txt('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textos(m[1]));
  const rels: Record<string, string> = {}; for (const m of txt('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)) { const id = /\bId="([^"]+)"/.exec(m[0]), tg = /\bTarget="([^"]+)"/.exec(m[0]); if (id && tg) rels[id[1]] = tg[1].replace(/^\/?(xl\/)?/, 'xl/'); }
  const out: { titulo: string; filas: string[][] }[] = [];
  for (const m of txt('xl/workbook.xml').matchAll(/<sheet\b[^>]*\/?>/g)) {
    const nom = /\bname="([^"]*)"/.exec(m[0]), rid = /\br:id="([^"]+)"/.exec(m[0]); if (!nom || !rid) continue;
    const titulo = ent(nom[1]); if (!filtro(titulo)) continue;
    const xml = txt(rels[rid[1]] || ''), filas: string[][] = [];
    for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      if (filas.length > maxFilas) break;
      const fila: string[] = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const at = c[1], ref = /\br="([A-Z]+)\d+"/.exec(at), t = (/\bt="([^"]+)"/.exec(at) || ['', 'n'])[1], body = c[2] || '';
        if (!ref) continue; const i = colN(ref[1]); if (i > 25) continue;
        const v = (/<v>([\s\S]*?)<\/v>/.exec(body) || ['', ''])[1];
        const val = t === 's' ? (sst[Number(v)] || '') : t === 'inlineStr' ? textos(body) : t === 'b' ? (v === '1' ? 'TRUE' : 'FALSE') : ent(v);
        while (fila.length < i) fila.push(''); fila[i] = String(val).slice(0, 2000);
      }
      filas.push(fila);
    }
    out.push({ titulo, filas });
  }
  return out;
}

/* ---------- base (PostgREST) ---------- */
function base(d: Deps) {
  const url = (d.env('SUPABASE_URL') || '').replace(/\/$/, '');
  const anon = d.env('SUPABASE_ANON_KEY') || '', srv = d.env('SUPABASE_SERVICE_ROLE_KEY') || '';
  async function rpc(fn: string, args: unknown, jwt?: string) {
    const h: Record<string, string> = { apikey: jwt ? anon : srv, 'content-type': 'application/json' };
    if (jwt) h.authorization = 'Bearer ' + jwt;
    else if (!/^sb_/.test(srv)) h.authorization = 'Bearer ' + srv;   // claves nuevas (sb_secret_…) van sólo en «apikey»
    const r = await d.fetch(`${url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: h, body: JSON.stringify(args || {}) });
    const t = await r.text(); let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { /* nada */ }
    if (!r.ok) throw new Falla(r.status === 401 ? 401 : 502, 'base', (j && j.message) || 'Error de la base (' + r.status + ')');
    return j;
  }
  return { url, rpc };
}

/* ---------- Google ---------- */
const cacheTok = new Map<string, { at: string; vence: number }>();
export function _limpiarCache() { cacheTok.clear(); }
async function tokenAcceso(d: Deps, tenant: string, rt: string) {
  const ahora = (d.ahora || Date.now)();
  const c = cacheTok.get(tenant); if (c && c.vence - 60000 > ahora) return c.at;
  const r = await d.fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: d.env('GOOGLE_OAUTH_CLIENT_ID') || '', client_secret: d.env('GOOGLE_OAUTH_CLIENT_SECRET') || '', refresh_token: rt, grant_type: 'refresh_token' }).toString() });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    cacheTok.delete(tenant);
    if (j && j.error === 'invalid_grant') throw new Falla(409, 'reconectar', 'Google ya no acepta el permiso de la ONG (se revocó o venció). Un administrador tiene que volver a conectar Google Drive.');
    throw new Falla(502, 'google', 'Google no respondió al pedir acceso (' + r.status + ').');
  }
  cacheTok.set(tenant, { at: j.access_token, vence: ahora + (j.expires_in || 3600) * 1000 });
  return j.access_token as string;
}
async function g(d: Deps, at: string, url: string, init: any = {}) {
  const r = await d.fetch(url, { ...init, headers: { authorization: 'Bearer ' + at, ...(init.json ? { 'content-type': 'application/json' } : {}), ...(init.headers || {}) }, body: init.json ? JSON.stringify(init.json) : init.body });
  if (r.status === 404) return null;
  if (!r.ok) {
    const st = r.status, t = await r.text().catch(() => '');
    if (st === 403 && /storageQuota|quotaExceeded/i.test(t)) throw new Falla(507, 'cuota', 'El Drive de la ONG no tiene espacio libre.');
    if (st === 429 || (st === 403 && /rateLimit/i.test(t))) throw new Falla(429, 'limite', 'Google limitó los pedidos: probá de nuevo en unos minutos.');
    if (st === 401) throw new Falla(409, 'reconectar', 'Google rechazó el acceso: hay que volver a conectar Google Drive.');
    throw new Falla(502, 'google', 'Error de Google Drive (' + st + ').');
  }
  return r.status === 204 ? {} : r.json();
}
async function buscar(d: Deps, at: string, consulta: string) {
  const j: any = await g(d, at, `${DRIVE}?q=${encodeURIComponent(consulta)}&pageSize=10&fields=${encodeURIComponent('files(id,name,webViewLink,md5Checksum,parents)')}`);
  return (j && j.files) || [];
}
async function raizLegajos(d: Deps, at: string, tenant: string, actual: string | null, nombreOng: string) {
  if (actual && RE_ID.test(actual)) {
    const f: any = await g(d, at, `${DRIVE}/${actual}?fields=id,trashed`);
    if (f && !f.trashed) return actual;
  }
  const ya = await buscar(d, at, `mimeType = ${q(CARPETA)} and appProperties has { key='vbong' and value='legajos-raiz' } and trashed = false`);
  const id = ya.length ? ya[0].id : (await g(d, at, `${DRIVE}?fields=id`, { method: 'POST', json: { name: 'Legajos · ' + limpio(nombreOng || 'ONG', 60), mimeType: CARPETA, appProperties: { vbong: 'legajos-raiz' } } }) as any).id;
  await base(d).rpc('drive_set_raiz', { p_tenant: tenant, p_raiz: id });
  return id as string;
}
async function carpetaPaciente(d: Deps, at: string, raiz: string, legajo: string, dni: string) {
  const ya = await buscar(d, at, `${q(raiz)} in parents and mimeType = ${q(CARPETA)} and appProperties has { key='vbongLegajo' and value=${q(legajo)} } and trashed = false`);
  if (ya.length > 1) throw new Falla(409, 'duplicada', 'Hay más de una carpeta para el legajo ' + legajo + ': revisalo en Drive.');
  if (ya.length) return { id: ya[0].id as string, url: (ya[0].webViewLink || 'https://drive.google.com/drive/folders/' + ya[0].id) as string, creada: false };
  const doc = String(dni || '').replace(/\D/g, '');
  const f: any = await g(d, at, `${DRIVE}?fields=id,webViewLink`, { method: 'POST', json: { name: legajo + '_' + (doc.length >= 6 && doc.length <= 11 ? doc : 'SD'), mimeType: CARPETA, parents: [raiz], appProperties: { vbongLegajo: legajo } } });
  return { id: f.id as string, url: (f.webViewLink || 'https://drive.google.com/drive/folders/' + f.id) as string, creada: true };
}

async function carpetaPorClave(d: Deps, at: string, clave: string, nombre: string, parent?: string) {
  const ya = await buscar(d, at, `mimeType = ${q(CARPETA)} and appProperties has { key='vbongKey' and value=${q(clave)} } and trashed = false`);
  if (ya.length) return { id: ya[0].id as string, url: (ya[0].webViewLink || 'https://drive.google.com/drive/folders/' + ya[0].id) as string };
  const f: any = await g(d, at, `${DRIVE}?fields=id,webViewLink`, { method: 'POST', json: { name: nombre, mimeType: CARPETA, ...(parent ? { parents: [parent] } : {}), appProperties: { vbong: '1', vbongKey: clave } } });
  return { id: f.id as string, url: (f.webViewLink || 'https://drive.google.com/drive/folders/' + f.id) as string };
}
async function subirPlanilla(d: Deps, at: string, b: any, nombreOng: string) {
  const ciclo = String(b.ciclo || '');
  if (!RE_CICLO.test(ciclo)) throw new Falla(400, 'datos', 'Ciclo inválido.');
  let bytes: Uint8Array; try { bytes = deB64u(String(b.b64 || '').replace(/\+/g, '-').replace(/\//g, '_')); } catch { throw new Falla(422, 'datos', 'Planilla ilegible.'); }
  if (!bytes.length || bytes.length > MAX_CSV) throw new Falla(413, 'datos', 'La planilla está vacía o supera los 5 MB.');
  const hash = hex(await crypto.subtle.digest('SHA-256', bytes));
  if (b.hash && b.hash !== hash) throw new Falla(422, 'datos', 'La planilla llegó distinta de como salió del equipo: no se guardó.');
  const nombre = limpio(b.nombre, 140);
  if (!/\.csv$/i.test(nombre)) throw new Falla(422, 'datos', 'Nombre de archivo inválido.');
  const raiz = await carpetaPorClave(d, at, 'cultivo-raiz', 'Planillas de cultivo · ' + limpio(nombreOng || 'ONG', 60));
  const cf = await carpetaPorClave(d, at, 'cultivo|' + ciclo, limpio(ciclo + ' · ' + String(b.cicloNombre || ''), 120), raiz.id);
  const ya = await buscar(d, at, `${q(cf.id)} in parents and appProperties has { key='vbongHash' and value=${q(hash)} } and trashed = false`);
  let f: any = ya[0];
  if (!f) {
    const bnd = '----vbong' + hash.slice(0, 16);
    const meta = JSON.stringify({ name: nombre, parents: [cf.id], mimeType: 'text/csv', appProperties: { vbong: '1', vbongHash: hash, vbongCiclo: ciclo, vbongVersion: String(Number(b.version) || 1) } });
    const a = te.encode(`--${bnd}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${bnd}\r\nContent-Type: text/csv; charset=UTF-8\r\n\r\n`), z = te.encode(`\r\n--${bnd}--`);
    const cuerpo = new Uint8Array(a.length + bytes.length + z.length); cuerpo.set(a, 0); cuerpo.set(bytes, a.length); cuerpo.set(z, a.length + bytes.length);
    f = await g(d, at, `${UPLOAD}?uploadType=multipart&fields=id,name,webViewLink`, { method: 'POST', body: cuerpo, headers: { 'content-type': 'multipart/related; boundary=' + bnd } });
  }
  return { ok: true, carpeta: cf.id, carpetaUrl: cf.url, archivo: { id: f.id, nombre: f.name || nombre, webViewLink: f.webViewLink || 'https://drive.google.com/file/d/' + f.id + '/view' }, repetido: !!ya.length, hash };
}

/* ---------- HTTP ---------- */
function cors(origen: string | null, env: Env) {
  const ok = (env('ALLOWED_ORIGINS') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const h: Record<string, string> = { 'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info', 'access-control-allow-methods': 'POST, OPTIONS', vary: 'origin' };
  if (origen && ok.includes(origen)) h['access-control-allow-origin'] = origen;
  return h;
}
const json = (c: unknown, s: number, h: Record<string, string>) => new Response(JSON.stringify(c), { status: s, headers: { ...h, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
function volver(d: Deps, estado: string) {
  const site = (d.env('SITE_URL') || '').replace(/\/$/, '');
  if (!/^https:\/\//.test(site)) return new Response('Listo. Ya podés cerrar esta pestaña y volver al sistema.', { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  return new Response(null, { status: 302, headers: { location: `${site}/?drive=${encodeURIComponent(estado)}#/pacientes`, 'cache-control': 'no-store' } });
}

async function vuelta(req: Request, d: Deps) {
  const u = new URL(req.url), code = u.searchParams.get('code'), state = u.searchParams.get('state') || '';
  if (u.searchParams.get('error')) return volver(d, 'cancelado');
  const sec = d.env('GOOGLE_OAUTH_CLIENT_SECRET') || '';
  const [p, firma] = state.split('.');
  if (!code || !p || !firma || !sec || (await hmac(sec + ':state', p)) !== firma) return volver(d, 'error');
  let st: any; try { st = JSON.parse(new TextDecoder().decode(deB64u(p))); } catch { return volver(d, 'error'); }
  if (!st || !st.t || !st.u || st.e < (d.ahora || Date.now)()) return volver(d, 'vencido');
  const B = base(d);
  const r = await d.fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: d.env('GOOGLE_OAUTH_CLIENT_ID') || '', client_secret: sec, redirect_uri: B.url + '/functions/v1/drive-legajos', grant_type: 'authorization_code' }).toString() });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.refresh_token) return volver(d, 'sin_permiso_offline');
  if (!String(j.scope || '').includes('drive.file')) return volver(d, 'sin_drive');
  let cuenta = '';
  try { cuenta = String(JSON.parse(new TextDecoder().decode(deB64u(String(j.id_token).split('.')[1]))).email || ''); } catch { /* nada */ }
  try { await B.rpc('drive_guardar_token', { p_tenant: st.t, p_token: j.refresh_token, p_cuenta: cuenta, p_uid: st.u, p_scopes: String(j.scope || '') }); }
  catch { return volver(d, 'error'); }
  cacheTok.delete(st.t);
  return volver(d, 'ok');
}

export async function manejar(req: Request, d: Deps): Promise<Response> {
  if (req.method === 'GET') return vuelta(req, d);
  const h = cors(req.headers.get('origin'), d.env);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido.' }, 405, h);
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ ok: false, error: 'Falta la sesión.' }, 401, h);
  let b: any;
  try { const t = await req.text(); if (t.length > Math.ceil(MAX * 4 / 3) + 8192) return json({ ok: false, error: 'El archivo supera los 10 MB.' }, 413, h); b = JSON.parse(t || '{}'); }
  catch { return json({ ok: false, error: 'Pedido inválido.' }, 400, h); }
  try {
    const B = base(d);
    const me: any = await B.rpc('miembro_actual', {}, jwt);   // el comercio y el rol salen de la sesión, nunca del pedido
    if (!me || !me.tenant || !ROLES.includes(me.rol)) return json({ ok: false, error: 'Sin acceso a este sistema.' }, 403, h);
    const tenant = String(me.tenant.id), uid = String(me.user_id);
    const configurado = !!(d.env('GOOGLE_OAUTH_CLIENT_ID') && d.env('GOOGLE_OAUTH_CLIENT_SECRET'));
    const con: any = await B.rpc('drive_leer', { p_tenant: tenant });

    if (b.accion === 'estado') {
      return json({ ok: true, configurado, conectado: !!(con && con.token), cuenta: con && con.cuenta || '', raiz: con && con.raiz ? 'https://drive.google.com/drive/folders/' + con.raiz : '' }, 200, h);
    }
    if (b.accion === 'conectar') {
      if (me.rol !== 'admin') return json({ ok: false, error: 'Sólo un administrador puede conectar Google Drive.' }, 403, h);
      if (!configurado) return json({ ok: false, error: 'Pendiente de configuración: faltan las credenciales de Google en el servidor.', codigo: 'config' }, 503, h);
      const p = b64u(JSON.stringify({ t: tenant, u: uid, e: (d.ahora || Date.now)() + 10 * 60000, n: b64u(crypto.getRandomValues(new Uint8Array(12))) }));
      const state = p + '.' + await hmac(d.env('GOOGLE_OAUTH_CLIENT_SECRET') + ':state', p);
      const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ client_id: d.env('GOOGLE_OAUTH_CLIENT_ID')!, redirect_uri: B.url + '/functions/v1/drive-legajos',
        response_type: 'code', scope: SCOPES, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false', state }).toString();
      return json({ ok: true, url }, 200, h);
    }
    if (b.accion === 'desconectar') {
      if (me.rol !== 'admin') return json({ ok: false, error: 'Sólo un administrador puede desconectar Google Drive.' }, 403, h);
      if (con && con.token) await d.fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(con.token), { method: 'POST' }).catch(() => null);
      await B.rpc('drive_borrar', { p_tenant: tenant, p_uid: uid }); cacheTok.delete(tenant);
      return json({ ok: true }, 200, h);
    }
    if (b.accion === 'planilla') {
      if (!configurado || !con || !con.token) return json({ ok: false, error: 'Google Drive de la ONG sin conectar: un administrador tiene que conectarlo una vez.', codigo: 'sin_conectar' }, 503, h);
      const at0 = await tokenAcceso(d, tenant, con.token);
      return json(await subirPlanilla(d, at0, b, me.tenant.nombre), 200, h);
    }
    if (b.accion === 'formularios') {
      // Formularios de Google del sistema anterior (ingreso y seguimiento): el sistema LEE las respuestas para que nadie quede afuera.
      if (!['admin', 'supervisor', 'mostrador'].includes(me.rol)) return json({ ok: false, error: 'Sin permiso para leer los formularios.' }, 403, h);
      if (!configurado || !con || !con.token) return json({ ok: false, error: 'Google Drive de la ONG sin conectar: un administrador tiene que conectarlo una vez.', codigo: 'sin_conectar' }, 503, h);
      const fid = String(b.archivo || '');
      if (!RE_ID.test(fid)) return json({ ok: false, error: 'Planilla inválida.' }, 400, h);
      const at2 = await tokenAcceso(d, tenant, con.token);
      const meta: any = await g(d, at2, `${DRIVE}/${fid}?fields=id,name,mimeType,trashed`);
      if (!meta || meta.trashed) return json({ ok: false, error: 'El sistema no tiene acceso a esa planilla: un administrador tiene que elegirla con el selector, con la cuenta conectada.', codigo: 'no_acceso' }, 404, h);
      if (meta.mimeType !== 'application/vnd.google-apps.spreadsheet') return json({ ok: false, error: 'Eso no es una planilla de Google.', codigo: 'sin_respuestas' }, 422, h);
      // se exporta como .xlsx con la API de Drive (la misma que ya usa el sistema) y se leen sólo las hojas de respuestas
      const rx = await d.fetch(`${DRIVE}/${fid}/export?mimeType=${encodeURIComponent('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}`, { headers: { authorization: 'Bearer ' + at2 } });
      if (!rx.ok) { const st = rx.status; if (st === 401) throw new Falla(409, 'reconectar', 'Google rechazó el acceso: hay que volver a conectar Google Drive.'); throw new Falla(502, 'google', 'Google no dejó exportar la planilla (' + st + ').'); }
      const bytes = new Uint8Array(await rx.arrayBuffer());
      if (!bytes.length || bytes.length > 10 * 1024 * 1024) return json({ ok: false, error: 'La planilla está vacía o es demasiado grande.' }, 413, h);
      const hojas = (await leerXlsx(bytes, (t) => /^(respuestas de formulario|form responses)/i.test(t), MAX_FILAS)).slice(0, 6);
      if (!hojas.length) return json({ ok: false, error: 'Esa planilla no tiene hojas de respuestas de formulario.', codigo: 'sin_respuestas' }, 422, h);
      return json({ ok: true, titulo: limpio(meta.name || '', 120), hojas }, 200, h);
    }
    if (b.accion === 'picker') {
      // datos PÚBLICOS para abrir el selector de Google (Picker) en el navegador: ID de cliente, clave de API del navegador
      // (restringida por dominio en Google Cloud) y N.º de proyecto. Ningún token ni secreto.
      if (me.rol !== 'admin') return json({ ok: false, error: 'Sólo un administrador puede vincular documentos del sistema anterior.' }, 403, h);
      const key = d.env('GOOGLE_PICKER_API_KEY') || '', app = d.env('GOOGLE_PROJECT_NUMBER') || '';
      if (!configurado || !key || !/^\d{6,20}$/.test(app)) return json({ ok: false, error: 'Pendiente de configuración: falta la clave del selector de Google en el servidor.', codigo: 'config' }, 503, h);
      if (!con || !con.token) return json({ ok: false, error: 'Google Drive de la ONG sin conectar: un administrador tiene que conectarlo una vez.', codigo: 'sin_conectar' }, 503, h);
      return json({ ok: true, clientId: d.env('GOOGLE_OAUTH_CLIENT_ID'), apiKey: key, appId: app, cuenta: con.cuenta || '' }, 200, h);
    }
    if (b.accion === 'vincular') {
      // archivos del sistema anterior elegidos con el Picker (con la misma cuenta conectada): se crea un ACCESO DIRECTO en la carpeta
      // del legajo (el original no se mueve ni se toca: AppSheet sigue funcionando). Idempotente por archivo.
      if (me.rol !== 'admin') return json({ ok: false, error: 'Sólo un administrador puede vincular documentos.' }, 403, h);
      if (!configurado || !con || !con.token) return json({ ok: false, error: 'Google Drive de la ONG sin conectar.', codigo: 'sin_conectar' }, 503, h);
      const items = Array.isArray(b.items) ? b.items.slice(0, 25) : [];
      if (!items.length) return json({ ok: false, error: 'No hay archivos para vincular.' }, 400, h);
      const at1 = await tokenAcceso(d, tenant, con.token);
      const raiz1 = await raizLegajos(d, at1, tenant, con.raiz, me.tenant.nombre);
      const out: any[] = [];
      for (const it of items) {
        const fid = String(it && it.fileId || ''), leg = String(it && it.legajo || ''), nom = String(it && it.nombre || '');
        try {
          if (!RE_ID.test(fid) || !RE_LEG.test(leg)) throw new Falla(400, 'datos', 'Datos inválidos.');
          const f: any = await g(d, at1, `${DRIVE}/${fid}?fields=id,name,mimeType,webViewLink,trashed`);
          if (!f || f.trashed) throw new Falla(404, 'no_acceso', 'El sistema no tiene acceso a ese archivo: elegilo en el selector con la cuenta conectada.');
          if (nom && f.name !== nom) throw new Falla(409, 'otro_archivo', 'El archivo elegido no coincide con el documento del legajo.');
          const cp1 = await carpetaPaciente(d, at1, raiz1, leg, String(it.dni || ''));
          const ya1 = await buscar(d, at1, `${q(cp1.id)} in parents and appProperties has { key='vbongLegacy' and value=${q(fid)} } and trashed = false`);
          if (!ya1.length) await g(d, at1, `${DRIVE}?fields=id`, { method: 'POST', json: { name: limpio(f.name, 140), mimeType: 'application/vnd.google-apps.shortcut', parents: [cp1.id], shortcutDetails: { targetId: fid }, appProperties: { vbong: '1', vbongLegacy: fid, vbongLegajo: leg } } });
          out.push({ fileId: fid, ok: true, url: f.webViewLink || 'https://drive.google.com/file/d/' + fid + '/view', carpetaUrl: cp1.url, repetido: !!ya1.length });
        } catch (e: any) {
          if (e instanceof Falla && (e.codigo === 'reconectar' || e.codigo === 'limite' || e.codigo === 'cuota')) throw e;
          out.push({ fileId: fid, ok: false, error: e instanceof Falla ? e.message : 'Error inesperado.' });
        }
      }
      return json({ ok: true, items: out }, 200, h);
    }
    if (b.accion !== 'carpeta' && b.accion !== 'subir') return json({ ok: false, error: 'Acción desconocida.' }, 400, h);
    if (!RE_LEG.test(String(b.legajo || ''))) return json({ ok: false, error: 'Legajo inválido.' }, 400, h);
    if (!configurado || !con || !con.token) return json({ ok: false, error: 'Google Drive de la ONG sin conectar: un administrador tiene que conectarlo una vez.', codigo: 'sin_conectar' }, 503, h);
    const at = await tokenAcceso(d, tenant, con.token);
    const raiz = await raizLegajos(d, at, tenant, con.raiz, me.tenant.nombre);
    const cp = await carpetaPaciente(d, at, raiz, b.legajo, String(b.dni || ''));
    if (b.accion === 'carpeta') return json({ ok: true, carpeta: cp.id, url: cp.url, creada: cp.creada }, 200, h);

    const mime = String(b.mime || '');
    if (!MIMES[mime]) return json({ ok: false, error: 'Sólo PDF o fotos.' }, 422, h);
    let bytes: Uint8Array; try { bytes = deB64u(String(b.b64 || '').replace(/\+/g, '-').replace(/\//g, '_')); } catch { return json({ ok: false, error: 'Archivo ilegible.' }, 422, h); }
    if (!bytes.length || bytes.length > MAX) return json({ ok: false, error: 'El archivo está vacío o supera los 10 MB.' }, 413, h);
    const hash = hex(await crypto.subtle.digest('SHA-256', bytes));
    if (b.hash && b.hash !== hash) return json({ ok: false, error: 'El archivo llegó distinto de como salió del equipo: no se guardó.' }, 422, h);
    const nombre = limpio(b.nombre, 120);
    if (!nombre.startsWith(b.legajo + '_')) return json({ ok: false, error: 'Nombre de archivo inválido.' }, 422, h);
    const ya = await buscar(d, at, `${q(cp.id)} in parents and appProperties has { key='vbongHash' and value=${q(hash)} } and trashed = false`);
    let f: any = ya[0];
    if (!f) {
      const bnd = '----vbong' + hash.slice(0, 16);
      const meta = JSON.stringify({ name: nombre, parents: [cp.id], mimeType: mime, appProperties: { vbong: '1', vbongHash: hash, vbongLegajo: b.legajo, vbongTipo: limpio(b.tipo, 40), vbongVersion: String(Number(b.version) || 1) } });
      const a = te.encode(`--${bnd}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${bnd}\r\nContent-Type: ${mime}\r\n\r\n`), z = te.encode(`\r\n--${bnd}--`);
      const cuerpo = new Uint8Array(a.length + bytes.length + z.length); cuerpo.set(a, 0); cuerpo.set(bytes, a.length); cuerpo.set(z, a.length + bytes.length);
      f = await g(d, at, `${UPLOAD}?uploadType=multipart&fields=id,name,webViewLink,md5Checksum`, { method: 'POST', body: cuerpo, headers: { 'content-type': 'multipart/related; boundary=' + bnd } });
    }
    return json({ ok: true, carpeta: cp.id, carpetaUrl: cp.url, archivo: { id: f.id, webViewLink: f.webViewLink || 'https://drive.google.com/file/d/' + f.id + '/view', md5Checksum: f.md5Checksum || null }, repetido: !!ya.length, hash }, 200, h);
  } catch (e: any) {
    if (e instanceof Falla) return json({ ok: false, error: e.message, codigo: e.codigo }, e.status, h);
    return json({ ok: false, error: 'Error inesperado.' }, 500, h);
  }
}

const D: any = (globalThis as any).Deno;
if (D && D.serve) D.serve((req: Request) => manejar(req, { env: (k) => D.env.get(k), fetch: fetch }));
