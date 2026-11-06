// Pruebas de supabase/functions/drive-legajos (node t/drive-oauth.test.ts). Google y la base SIMULADOS; datos ficticios.
import assert from 'node:assert';
import { manejar, _limpiarCache } from '../supabase/functions/drive-legajos/index.ts';
let ok = 0, malas = 0;
async function t(n: string, fn: () => Promise<void>) { try { await fn(); ok++; console.log('ok  ' + n); } catch (e: any) { malas++; console.error('FALLA ' + n + '\n   ' + (e && e.stack || e)); } }
const T = 'aaaaaaaa-0000-0000-0000-00000000000a', ADMIN = '11111111-1111-1111-1111-111111111111', LEG = 'L-261101-ABCDEF', SUPA = 'https://proy.supabase.co';
const env = (x: Record<string, any> = {}) => (k: string) => ({ SUPABASE_URL: SUPA, SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'srv', GOOGLE_OAUTH_CLIENT_ID: 'cid.apps.googleusercontent.com', GOOGLE_OAUTH_CLIENT_SECRET: 'secreto-de-prueba', ALLOWED_ORIGINS: 'https://raveholding.github.io', SITE_URL: 'https://raveholding.github.io/Cannabismatica', ...x } as any)[k];
const R = (o: any, st = 200) => new Response(typeof o === 'string' ? o : JSON.stringify(o), { status: st });
function mundo(o: { rol?: string; sinConexion?: boolean; rtInvalido?: boolean } = {}) {
  const w: any = { files: [] as any[], n: 0, subidas: 0, tokens: 0, guardado: null as any, borrado: false, raiz: null as string | null, log: [] as string[] };
  w.con = o.sinConexion ? null : { token: 'rt-guardado-123456789012345', cuenta: 'ong@gmail.com', raiz: null };
  w.fetch = async (url: string, init: any = {}) => {
    const u = new URL(url), H = init.headers || {};
    w.log.push((init.method || 'GET') + ' ' + u.host + u.pathname);
    if (u.host === 'proy.supabase.co') {
      const fn = u.pathname.split('/').pop(), a = init.body ? JSON.parse(init.body) : {};
      if (fn === 'miembro_actual') { assert.strictEqual(H.authorization, 'Bearer jwt'); return R({ user_id: ADMIN, rol: o.rol || 'admin', tenant: { id: T, nombre: 'Fundación Ejemplo' } }); }
      assert.ok(H.apikey === 'srv' || H.apikey === 'sb_secret_x'); assert.ok(H.authorization === 'Bearer srv' || (H.apikey === 'sb_secret_x' && !H.authorization));
      if (fn === 'drive_leer') return R(w.con ? { ...w.con, raiz: w.raiz } : null);
      if (fn === 'drive_set_raiz') { w.raiz = a.p_raiz; return R(null); }
      if (fn === 'drive_guardar_token') { w.guardado = a; return R(null); }
      if (fn === 'drive_borrar') { w.borrado = true; w.con = null; return R(null); }
    }
    if (u.host === 'oauth2.googleapis.com') {
      const p = new URLSearchParams(init.body || '');
      if (u.pathname === '/revoke') return R({});
      if (p.get('grant_type') === 'refresh_token') { w.tokens++; return o.rtInvalido ? R({ error: 'invalid_grant' }, 400) : R({ access_token: 'at-1', expires_in: 3600 }); }
      if (p.get('grant_type') === 'authorization_code') {
        assert.strictEqual(p.get('redirect_uri'), SUPA + '/functions/v1/drive-legajos');
        const idt = 'x.' + Buffer.from(JSON.stringify({ email: 'ong@gmail.com' })).toString('base64url') + '.y';
        return p.get('code') === 'sin-offline' ? R({ access_token: 'a', scope: 'openid email https://www.googleapis.com/auth/drive.file', id_token: idt })
          : R({ access_token: 'a', refresh_token: 'rt-nuevo-123456789012345', scope: 'openid email https://www.googleapis.com/auth/drive.file', id_token: idt });
      }
    }
    if (u.host === 'www.googleapis.com') {
      assert.strictEqual(H.authorization, 'Bearer at-1');
      const id = (s: string) => 'G' + String(++w.n).padStart(12, '0');
      if (u.pathname.startsWith('/upload/')) {
        const txt = new TextDecoder().decode(init.body); const meta = JSON.parse(txt.slice(txt.indexOf('{'), txt.indexOf('}\r\n') + 1));
        w.subidas++; const f = { id: id(''), ...meta, webViewLink: 'https://drive.google.com/file/d/X/view', md5Checksum: 'md5' }; w.files.push(f); return R(f);
      }
      const m = /\/files\/([^/]+)$/.exec(u.pathname);
      if (m) { const f = w.files.find((x: any) => x.id === m[1]); return f ? R({ id: f.id, trashed: !!f.trashed }) : R({}, 404); }
      if ((init.method || 'GET') === 'POST') { const meta = JSON.parse(init.body); const f = { id: id(''), ...meta, webViewLink: 'https://drive.google.com/drive/folders/F' }; w.files.push(f); return R(f); }
      const qq = u.searchParams.get('q') || '';
      return R({ files: w.files.filter((f: any) => {
        let mm; if ((mm = /'([^']+)' in parents/.exec(qq)) && !(f.parents || []).includes(mm[1])) return false;
        if ((mm = /mimeType = '([^']+)'/.exec(qq)) && f.mimeType !== mm[1]) return false;
        for (const x of qq.matchAll(/appProperties has \{ key='([^']+)' and value='([^']+)' \}/g)) if ((f.appProperties || {})[x[1]] !== x[2]) return false;
        return !f.trashed; }) });
    }
    throw new Error('red no simulada ' + url);
  };
  return w;
}
const post = (b: any, jwt = 'jwt') => new Request('https://fn/drive-legajos', { method: 'POST', headers: { authorization: 'Bearer ' + jwt, origin: 'https://raveholding.github.io' }, body: JSON.stringify(b) });
const pdf = new TextEncoder().encode('%PDF-1.4 ficticio');
const b64 = Buffer.from(pdf).toString('base64');
const hash = Buffer.from(await crypto.subtle.digest('SHA-256', pdf)).toString('hex');
const subir = (x: any = {}) => ({ accion: 'subir', legajo: LEG, dni: '99100001', nombre: LEG + '_REPROCANN_20261101_v1_' + hash.slice(0, 8) + '.pdf', mime: 'application/pdf', tipo: 'REPROCANN', version: 1, hash, b64, ...x });
const run = async (w: any, b: any, e = env()) => { const r = await manejar(post(b), { env: e, fetch: w.fetch }); return { st: r.status, j: await r.json() }; };

await t('estado: conectado, cuenta y sin tokens en la respuesta', async () => {
  _limpiarCache(); const w = mundo(); const { st, j } = await run(w, { accion: 'estado' });
  assert.strictEqual(st, 200); assert.ok(j.conectado && j.configurado && j.cuenta === 'ong@gmail.com');
  assert.ok(!JSON.stringify(j).includes('rt-guardado'));
});
await t('conectar: sólo admin; URL de Google con drive.file, offline, consentimiento y state firmado', async () => {
  const w = mundo(); const { j } = await run(w, { accion: 'conectar' }); const u = new URL(j.url);
  assert.strictEqual(u.host, 'accounts.google.com'); assert.strictEqual(u.searchParams.get('access_type'), 'offline'); assert.strictEqual(u.searchParams.get('prompt'), 'consent');
  assert.ok(u.searchParams.get('scope')!.includes('drive.file') && !/auth\/drive( |$)/.test(u.searchParams.get('scope')!));
  assert.strictEqual(u.searchParams.get('redirect_uri'), SUPA + '/functions/v1/drive-legajos');
  assert.strictEqual((await run(mundo({ rol: 'supervisor' }), { accion: 'conectar' })).st, 403);
});
await t('conectar sin credenciales de Google en el servidor → 503 «Pendiente de configuración»', async () => {
  const r = await run(mundo(), { accion: 'conectar' }, env({ GOOGLE_OAUTH_CLIENT_SECRET: undefined }));
  assert.strictEqual(r.st, 503); assert.match(r.j.error, /Pendiente de configuración/);
});
await t('vuelta de Google: guarda el permiso con el comercio y el admin del state, y vuelve al sistema', async () => {
  const w = mundo({ sinConexion: true }); const { j } = await run(w, { accion: 'conectar' }); const st = new URL(j.url).searchParams.get('state')!;
  const r = await manejar(new Request(SUPA + '/functions/v1/drive-legajos?code=c1&state=' + encodeURIComponent(st)), { env: env(), fetch: w.fetch });
  assert.strictEqual(r.status, 302); assert.match(r.headers.get('location')!, /drive=ok#\/pacientes$/);
  assert.deepStrictEqual([w.guardado.p_tenant, w.guardado.p_uid, w.guardado.p_token, w.guardado.p_cuenta], [T, ADMIN, 'rt-nuevo-123456789012345', 'ong@gmail.com']);
});
await t('vuelta con state alterado, vencido, cancelada o sin permiso «offline»: no guarda nada', async () => {
  const w = mundo({ sinConexion: true }); const { j } = await run(w, { accion: 'conectar' }); const st = new URL(j.url).searchParams.get('state')!;
  const [p, f] = st.split('.'); const otro = Buffer.from(JSON.stringify({ t: 'bbbbbbbb-0000-0000-0000-00000000000b', u: ADMIN, e: Date.now() + 1e6 })).toString('base64url');
  for (const [qs, esp] of [['code=c&state=' + otro + '.' + f, 'error'], ['error=access_denied&state=' + st, 'cancelado'], ['code=sin-offline&state=' + encodeURIComponent(st), 'sin_permiso_offline']]) {
    const r = await manejar(new Request(SUPA + '/functions/v1/drive-legajos?' + qs), { env: env(), fetch: w.fetch });
    assert.match(r.headers.get('location')!, new RegExp('drive=' + esp));
  }
  const viejo = await manejar(new Request(SUPA + '/functions/v1/drive-legajos?code=c&state=' + encodeURIComponent(st)), { env: env(), fetch: w.fetch, ahora: () => Date.now() + 11 * 60000 });
  assert.match(viejo.headers.get('location')!, /drive=vencido/);
  assert.strictEqual(w.guardado, null);
});
await t('carpeta: crea «Legajos · ONG» y {legajo}_{DNI} una sola vez, desde cualquier equipo', async () => {
  _limpiarCache(); const w = mundo({ rol: 'operador' });
  const a = (await run(w, { accion: 'carpeta', legajo: LEG, dni: '99100001' })).j, b2 = (await run(w, { accion: 'carpeta', legajo: LEG, dni: '99100001' })).j;
  assert.ok(a.creada && !b2.creada && a.carpeta === b2.carpeta);
  assert.deepStrictEqual(w.files.map((f: any) => f.name).sort(), ['L-261101-ABCDEF_99100001', 'Legajos · Fundación Ejemplo']);
  assert.ok(w.raiz && w.tokens === 1);
});
await t('sin DNI la carpeta es {legajo}_SD; si borraron la raíz en Drive se crea otra', async () => {
  _limpiarCache(); const w = mundo();
  await run(w, { accion: 'carpeta', legajo: LEG }); w.files.forEach((f: any) => { f.trashed = true; });
  const r = (await run(w, { accion: 'carpeta', legajo: LEG })).j;
  assert.ok(r.creada); assert.strictEqual(w.files.filter((f: any) => f.name === LEG + '_SD').length, 2);
});
await t('subir: va a la carpeta del legajo con huella; repetir no duplica', async () => {
  _limpiarCache(); const w = mundo({ rol: 'mostrador' });
  const a = (await run(w, subir())).j, b2 = (await run(w, subir())).j;
  assert.ok(a.ok && !a.repetido && b2.repetido && w.subidas === 1);
  const f = w.files.find((x: any) => x.id === a.archivo.id), cp = w.files.find((x: any) => x.name === LEG + '_99100001');
  assert.deepStrictEqual(f.parents, [cp.id]); assert.strictEqual(f.appProperties.vbongHash, hash);
});
await t('subir: huella distinta, tipo no permitido, nombre ajeno o legajo inválido → rechazado sin tocar Drive', async () => {
  _limpiarCache(); const w = mundo();
  assert.strictEqual((await run(w, subir({ hash: 'f'.repeat(64) }))).st, 422);
  assert.strictEqual((await run(w, subir({ mime: 'text/html' }))).st, 422);
  assert.strictEqual((await run(w, subir({ nombre: 'otro.pdf' }))).st, 422);
  assert.strictEqual((await run(w, subir({ legajo: "x' or '1" }))).st, 400);
  assert.strictEqual(w.subidas, 0);
});
await t('sin conectar → 503 claro; permiso revocado en Google → 409 «volver a conectar»', async () => {
  _limpiarCache();
  const a = await run(mundo({ sinConexion: true }), { accion: 'carpeta', legajo: LEG }); assert.strictEqual(a.st, 503); assert.strictEqual(a.j.codigo, 'sin_conectar');
  const b2 = await run(mundo({ rtInvalido: true }), { accion: 'carpeta', legajo: LEG }); assert.strictEqual(b2.st, 409); assert.strictEqual(b2.j.codigo, 'reconectar');
});
await t('desconectar: sólo admin; revoca en Google y borra el permiso', async () => {
  _limpiarCache();
  assert.strictEqual((await run(mundo({ rol: 'mostrador' }), { accion: 'desconectar' })).st, 403);
  const w = mundo(); await run(w, { accion: 'desconectar' });
  assert.ok(w.borrado && w.log.some((l: string) => l.includes('/revoke')));
});
await t('sin sesión 401; sesión sin miembro 403; CORS sólo al sitio; archivo > 10 MB 413', async () => {
  const w = mundo();
  assert.strictEqual((await manejar(new Request('https://fn', { method: 'POST', body: '{}' }), { env: env(), fetch: w.fetch })).status, 401);
  const r = await manejar(new Request('https://fn', { method: 'OPTIONS', headers: { origin: 'https://malo.example' } }), { env: env(), fetch: w.fetch });
  assert.strictEqual(r.headers.get('access-control-allow-origin'), null);
  assert.strictEqual((await run(w, subir({ b64: Buffer.alloc(10 * 1024 * 1024 + 10).toString('base64') }))).st, 413);
});
await t('con claves nuevas de Supabase (sb_secret_…) la clave de servicio va sólo en «apikey»', async () => {
  _limpiarCache(); const r = await run(mundo(), { accion: 'estado' }, env({ SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x' })); assert.strictEqual(r.st, 200);
});
await t('planilla de cultivo: carpeta «Planillas de cultivo», un archivo por contenido (no repite), sin pisar', async () => {
  _limpiarCache(); const w = mundo();
  const csv = new TextEncoder().encode('fecha;temp\n2026-10-19;24\n'); const h = Buffer.from(await crypto.subtle.digest('SHA-256', csv)).toString('hex');
  const pl = (x: any = {}) => ({ accion: 'planilla', ciclo: 'CU-261019-AB12C', cicloNombre: 'Sala 1', nombre: 'CU-261019-AB12C_20261106_v1_' + h.slice(0, 12) + '.csv', version: 1, hash: h, b64: Buffer.from(csv).toString('base64'), ...x });
  const a = await run(w, pl()); assert.strictEqual(a.st, 200, JSON.stringify(a.j)); assert.ok(a.j.archivo.id && !a.j.repetido);
  const raiz = w.files.find((f: any) => f.appProperties && f.appProperties.vbongKey === 'cultivo-raiz'); assert.ok(raiz && /^Planillas de cultivo/.test(raiz.name));
  const cf = w.files.find((f: any) => f.appProperties && f.appProperties.vbongKey === 'cultivo|CU-261019-AB12C'); assert.deepStrictEqual(cf.parents, [raiz.id]);
  const b2 = await run(w, pl()); assert.ok(b2.j.repetido); assert.strictEqual(w.subidas, 1);
  assert.strictEqual(w.files.filter((f: any) => f.appProperties && f.appProperties.vbongKey === 'cultivo-raiz').length, 1);
  assert.strictEqual((await run(w, pl({ hash: 'f'.repeat(64) }))).st, 422);
  assert.strictEqual((await run(w, pl({ ciclo: "x' or '1" }))).st, 400);
  assert.strictEqual((await run(w, pl({ nombre: 'algo.exe' }))).st, 422);
  assert.strictEqual((await run(mundo({ sinConexion: true }), pl())).st, 503);
});
console.log('\n' + ok + ' pruebas correctas' + (malas ? ' · ' + malas + ' FALLAS' : '')); if (malas) process.exit(1);
