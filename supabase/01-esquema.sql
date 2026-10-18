-- ======================================================================
-- Sistema VB ONG · esquema de nube (Supabase) · 01-esquema.sql  (v1)
-- Migración aditiva e idempotente. Pegar el CONTENIDO en el SQL Editor.
-- Principios: RLS en todo, escritura sólo por funciones (SECURITY DEFINER con
-- search_path fijo), permisos por rol validados en el servidor, stock calculado
-- por el servidor, cierres congelados, auditoría sólo-agregar, sin secretos.
-- ======================================================================
create extension if not exists pgcrypto with schema extensions;

-- ---------- tablas ----------
create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  perms jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.miembros (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  nombre text not null,
  correo text not null,
  rol text not null check (rol in ('admin','supervisor','mostrador','operador')),
  activo boolean not null default true,
  cambiar boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists miembros_correo_uq on public.miembros (tenant_id, lower(correo));

create table if not exists public.equipos (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  device text not null,
  num int not null,
  etiqueta text,
  created_at timestamptz not null default now(),
  primary key (tenant_id, device),
  unique (tenant_id, num)
);

create table if not exists public.setup (
  id int primary key default 1 check (id = 1),
  codigo_hash text not null,
  intentos int not null default 0,
  ventana timestamptz not null default now(),
  usado boolean not null default false
);

create sequence if not exists public.registros_seq;
create table if not exists public.registros (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  col text not null,
  id text not null,
  data jsonb not null,
  v int not null default 1,
  seq bigint not null default nextval('public.registros_seq'),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  borrado boolean not null default false,
  primary key (tenant_id, col, id)
);
create index if not exists registros_seq_idx on public.registros (tenant_id, seq);
create index if not exists registros_movs_lote_idx on public.registros (tenant_id, ((data->>'lote'))) where col = 'movs';

create table if not exists public.colecciones (
  col text primary key,
  lectura text[] not null,          -- módulos con nivel >= ver ('*' = cualquier miembro)
  escritura text[] not null,        -- módulos con nivel >= oper
  solo_agregar boolean not null default false,
  congela_cerradas boolean not null default false,
  sin_borrar boolean not null default false
);

create table if not exists public.menu_publicado (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  data jsonb not null,
  version int not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists public.solicitudes_publicas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  tipo text not null check (tipo in ('hc','turno','club')),
  payload jsonb not null,
  leg text,
  nonce text not null,
  estado text not null default 'pendiente' check (estado in ('pendiente','procesada')),
  created_at timestamptz not null default now(),
  unique (tenant_id, nonce)
);
create unique index if not exists solicitudes_leg_uq on public.solicitudes_publicas (tenant_id, leg) where leg is not null;

create table if not exists public.limites (
  clave text primary key,
  n int not null default 0,
  ventana timestamptz not null default now()
);

alter table public.tenants enable row level security;
alter table public.miembros enable row level security;
alter table public.equipos enable row level security;
alter table public.setup enable row level security;
alter table public.registros enable row level security;
alter table public.colecciones enable row level security;
alter table public.menu_publicado enable row level security;
alter table public.solicitudes_publicas enable row level security;
alter table public.limites enable row level security;

-- ---------- catálogo de colecciones y permisos mínimos ----------
insert into public.colecciones (col, lectura, escritura, solo_agregar, congela_cerradas, sin_borrar) values
 ('pacientes',  array['pacientes','dispensaciones','reprocann','aportes','fidelizacion','dashboard','trazabilidad','menu'], array['pacientes','dispensaciones','reprocann','menu','aportes'], false,false,true),
 ('lotes',      array['trazabilidad','dispensaciones','inventario','dashboard','pacientes'], array['trazabilidad','dispensaciones','inventario'], false,false,true),
 ('movs',       array['trazabilidad','dispensaciones','inventario','dashboard'], array['trazabilidad','dispensaciones','inventario'], true,false,true),
 ('disp',       array['dispensaciones','trazabilidad','dashboard','pacientes','aportes'], array['dispensaciones'], false,false,true),
 ('aportes',    array['aportes','caja','cierre','cerradas','dashboard','pacientes','dispensaciones'], array['aportes','dispensaciones','caja'], false,false,true),
 ('comps',      array['aportes','caja','cierre','cerradas','dashboard','pacientes','dispensaciones'], array['aportes','dispensaciones','caja'], false,false,true),
 ('seg',        array['pacientes','reprocann'], array['pacientes','reprocann'], false,false,true),
 ('rubros',     array['*'], array['ajustes','caja','cierre'], false,false,true),
 ('cajas',      array['caja','cierre','cerradas','dashboard','aportes'], array['caja','cierre'], false,true,true),
 ('cmovs',      array['caja','cierre','cerradas','dashboard'], array['caja','cierre'], false,false,true),
 ('staff',      array['personal','tareas','cultivo','dashboard'], array['personal'], false,false,false),
 ('fichas',     array['personal','dashboard'], array['personal'], true,false,true),
 ('tareas',     array['tareas','dashboard'], array['tareas'], false,false,false),
 ('org',        array['*'], array['tareas','personal'], false,false,false),
 ('sellos',     array['fidelizacion','pacientes','dashboard'], array['fidelizacion'], true,false,true),
 ('cupones',    array['fidelizacion','aportes','caja'], array['fidelizacion'], false,false,true),
 ('cuponUsos',  array['fidelizacion','aportes','caja'], array['fidelizacion','aportes'], true,false,true),
 ('planes',     array['fidelizacion','aportes','caja'], array['fidelizacion'], false,false,true),
 ('membresias', array['fidelizacion','aportes','caja'], array['fidelizacion'], false,false,true),
 ('irubros',    array['inventario','dashboard'], array['inventario'], false,false,true),
 ('insumos',    array['inventario','dashboard'], array['inventario'], false,false,true),
 ('imovs',      array['inventario','dashboard'], array['inventario'], true,false,true),
 ('cultivos',   array['cultivo','trazabilidad','dashboard'], array['cultivo'], false,false,true),
 ('cultReg',    array['cultivo','trazabilidad','dashboard'], array['cultivo'], false,false,true),
 ('audit',      array['auditoria'], array['*'], true,false,true),
 ('m_altas',    array['menu','fidelizacion'], array['menu','fidelizacion'], false,false,true),
 ('m_solic',    array['menu'], array['menu'], false,false,true),
 ('m_turnos',   array['menu','pacientes'], array['menu','pacientes'], false,false,true),
 ('m_hcs',      array['menu','pacientes'], array['menu','pacientes'], false,false,true),
 ('m_vers',     array['menu'], array['menu'], true,false,true),
 ('m_pub',      array['*'], array['menu'], false,false,true),
 ('m_draft',    array['menu'], array['menu'], false,false,true),
 ('cfg',        array['*'], array['ajustes'], false,false,true),
 ('ong',        array['*'], array['ajustes','menu'], false,false,true)
on conflict (col) do update set lectura = excluded.lectura, escritura = excluded.escritura,
  solo_agregar = excluded.solo_agregar, congela_cerradas = excluded.congela_cerradas, sin_borrar = excluded.sin_borrar;

-- ---------- utilidades ----------
create or replace function public.mods_validos() returns text[] language sql immutable set search_path = public as $$
  select array['pacientes','dispensaciones','aportes','reprocann','trazabilidad','cultivo','dashboard','caja','cierre','cerradas','inventario','fidelizacion','personal','tareas','menu','nube','perifericos','importexport','integraciones','usuarios','auditoria','ajustes'];
$$;

create or replace function public.clave_ok(p text) returns boolean language sql immutable set search_path = public as $$
  select p is not null and length(p) >= 8 and length(p) <= 72 and p ~ '[A-Za-z]' and p ~ '[0-9]';
$$;

-- nivel numérico del usuario en un módulo: 0 sin acceso, 1 ver, 2 oper, 3 edit, 4 admin
create or replace function public.nivel_de(p_user uuid, p_mod text) returns int
language sql stable security definer set search_path = public as $$
  select case when m.rol = 'admin' then 4
    else coalesce(array_position(array['','ver','oper','edit','admin'], t.perms->m.rol->>p_mod) - 1, 0) end
  from public.miembros m join public.tenants t on t.id = m.tenant_id
  where m.user_id = p_user and m.activo;
$$;

create or replace function public.puede(p_user uuid, p_col text, p_modo text, p_min int default null) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare c public.colecciones; mods text[]; x text; need int; ok boolean := false; rl text;
begin
  select * into c from public.colecciones where col = p_col;
  if not found then return false; end if;
  select rol into rl from public.miembros where user_id = p_user and activo;
  if rl is null then return false; end if;
  if p_modo = 'r' then mods := c.lectura; need := 1; else mods := c.escritura; need := coalesce(p_min, 2); end if;
  foreach x in array mods loop
    if x = '*' then
      if p_modo = 'r' or need <= 2 then return true; end if;
      if rl in ('admin','supervisor') then return true; end if;
    elsif public.nivel_de(p_user, x) >= need then
      return true;
    end if;
  end loop;
  return ok;
end $$;

create or replace function public.tenant_de(p_user uuid) returns uuid language sql stable security definer set search_path = public as $$
  select tenant_id from public.miembros where user_id = p_user and activo;
$$;
create or replace function public.mi_tenant() returns uuid language sql stable security definer set search_path = public as $$
  select tenant_id from public.miembros where user_id = auth.uid() and activo;
$$;
create or replace function public.puedo_leer(p_col text) returns boolean language sql stable security definer set search_path = public as $$
  select public.puede(auth.uid(), p_col, 'r');
$$;

-- ---------- RLS: lectura sólo de lo que el rol puede ver ----------
drop policy if exists registros_lee on public.registros;
create policy registros_lee on public.registros for select to authenticated using (
  tenant_id = public.mi_tenant() and public.puedo_leer(col)
);

-- ---------- auditoría del servidor (misma colección que la del cliente; sin cadena de hashes) ----------
create or replace function public._audit_srv(p_tenant uuid, p_uid uuid, p_accion text, p_detalle text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare nom text; rl text; rid text;
begin
  select nombre, rol into nom, rl from public.miembros where user_id = p_uid;
  rid := 'AU-srv-' || encode(extensions.gen_random_bytes(6), 'hex');
  insert into public.registros (tenant_id, col, id, data, updated_by)
  values (p_tenant, 'audit', rid, jsonb_build_object('id', rid, 'ts', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'user', coalesce(nom, 'Sistema'), 'rol', coalesce(rl, ''), 'accion', p_accion, 'detalle', left(coalesce(p_detalle, ''), 300), 'srv', true), p_uid);
end $$;

-- ---------- usuarios (Auth) ----------
create or replace function public._crear_auth_user(p_correo text, p_clave text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := gen_random_uuid(); e text := lower(trim(p_correo));
begin
  if exists (select 1 from auth.users where lower(email) = e) then raise exception 'correo_existente'; end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', e,
    extensions.crypt(p_clave, extensions.gen_salt('bf', 10)), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
    '', '', '', '', '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), uid, uid::text, jsonb_build_object('sub', uid::text, 'email', e, 'email_verified', true), 'email', now(), now(), now());
  return uid;
end $$;

create or replace function public.perms_defecto() returns jsonb language sql immutable set search_path = public as $$
  select '{"supervisor":{"pacientes":"edit","dispensaciones":"edit","aportes":"edit","reprocann":"edit","trazabilidad":"edit","cultivo":"edit","dashboard":"edit","caja":"admin","cierre":"admin","cerradas":"edit","inventario":"edit","fidelizacion":"edit","personal":"edit","tareas":"edit","menu":"edit","nube":"ver","perifericos":"edit","importexport":"oper","integraciones":"ver","usuarios":"ver","auditoria":"ver","ajustes":"ver"},"mostrador":{"pacientes":"oper","dispensaciones":"oper","aportes":"oper","reprocann":"ver","trazabilidad":"ver","caja":"oper","inventario":"ver","fidelizacion":"oper","personal":"oper","tareas":"oper","dashboard":"ver","perifericos":"oper","cultivo":"ver","cierre":"","cerradas":"","menu":"","nube":"","importexport":"","integraciones":"","usuarios":"","auditoria":"","ajustes":""},"operador":{"pacientes":"oper","inventario":"ver","tareas":"oper","fidelizacion":"ver","reprocann":"ver","personal":"oper","cultivo":"oper","dispensaciones":"","aportes":"","trazabilidad":"","dashboard":"","caja":"","cierre":"","cerradas":"","menu":"","nube":"","perifericos":"","importexport":"","integraciones":"","usuarios":"","auditoria":"","ajustes":""}}'::jsonb;
$$;

create or replace function public.bootstrap_estado() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tenants);
$$;

create or replace function public.bootstrap(p_codigo text, p_correo text, p_nombre text, p_clave text, p_ong text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare s public.setup; tid uuid; uid uuid;
begin
  if exists (select 1 from public.tenants) then raise exception 'ya_configurado'; end if;
  select * into s from public.setup where id = 1 for update;
  if not found or s.usado then raise exception 'codigo_invalido'; end if;
  if s.ventana < now() - interval '1 hour' then update public.setup set intentos = 0, ventana = now() where id = 1; s.intentos := 0; end if;
  if s.intentos >= 5 then raise exception 'demasiados_intentos'; end if;
  if s.codigo_hash <> encode(extensions.digest(coalesce(p_codigo, ''), 'sha256'), 'hex') then
    update public.setup set intentos = intentos + 1 where id = 1;
    raise exception 'codigo_invalido';
  end if;
  if p_correo !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'correo_invalido'; end if;
  if length(trim(coalesce(p_nombre, ''))) < 3 then raise exception 'nombre_invalido'; end if;
  if not public.clave_ok(p_clave) then raise exception 'clave_debil'; end if;
  insert into public.tenants (nombre, perms) values (left(coalesce(nullif(trim(p_ong), ''), 'ONG'), 120), public.perms_defecto()) returning id into tid;
  uid := public._crear_auth_user(p_correo, p_clave);
  insert into public.miembros (user_id, tenant_id, nombre, correo, rol, activo, cambiar)
  values (uid, tid, left(trim(p_nombre), 80), lower(trim(p_correo)), 'admin', true, false);
  update public.setup set usado = true where id = 1;
  perform public._audit_srv(tid, uid, 'Sistema configurado', 'Se creó la cuenta de administración');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.miembro_actual() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m public.miembros; t public.tenants;
begin
  select * into m from public.miembros where user_id = auth.uid() and activo;
  if not found then return null; end if;
  select * into t from public.tenants where id = m.tenant_id;
  return jsonb_build_object('user_id', m.user_id, 'tenant', jsonb_build_object('id', t.id, 'nombre', t.nombre),
    'nombre', m.nombre, 'correo', m.correo, 'rol', m.rol, 'cambiar', m.cambiar, 'perms', t.perms);
end $$;

create or replace function public.clave_cambiada() returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.miembros set cambiar = false where user_id = auth.uid() and activo;
  perform public._audit_srv(public.tenant_de(auth.uid()), auth.uid(), 'Cambio de clave', 'La persona eligió una clave propia');
end $$;

create or replace function public.usuarios_listar() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tid uuid := public.tenant_de(auth.uid());
begin
  if tid is null or public.nivel_de(auth.uid(), 'usuarios') < 1 then raise exception 'sin_permiso'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', user_id, 'nombre', nombre, 'correo', correo, 'rol', rol, 'activo', activo, 'cambiar', cambiar) order by created_at) from public.miembros where tenant_id = tid), '[]'::jsonb);
end $$;

create or replace function public.usuario_crear(p_correo text, p_nombre text, p_rol text, p_clave text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare tid uuid := public.tenant_de(auth.uid()); uid uuid;
begin
  if tid is null or public.nivel_de(auth.uid(), 'usuarios') < 4 then raise exception 'sin_permiso'; end if;
  if p_rol not in ('admin','supervisor','mostrador','operador') then raise exception 'rol_invalido'; end if;
  if p_correo !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'correo_invalido'; end if;
  if length(trim(coalesce(p_nombre, ''))) < 3 then raise exception 'nombre_invalido'; end if;
  if not public.clave_ok(p_clave) then raise exception 'clave_debil'; end if;
  uid := public._crear_auth_user(p_correo, p_clave);
  insert into public.miembros (user_id, tenant_id, nombre, correo, rol, activo, cambiar)
  values (uid, tid, left(trim(p_nombre), 80), lower(trim(p_correo)), p_rol, true, true);
  perform public._audit_srv(tid, auth.uid(), 'Usuario nuevo', left(trim(p_nombre), 80) || ' · rol ' || p_rol);
  return uid;
end $$;

create or replace function public._cortar_sesiones(p_uid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from auth.sessions where user_id = p_uid;
  delete from auth.refresh_tokens where user_id::uuid = p_uid;
exception when others then null;
end $$;

create or replace function public.usuario_actualizar(p_user uuid, p_nombre text, p_rol text, p_activo boolean) returns void
language plpgsql security definer set search_path = public as $$
declare tid uuid := public.tenant_de(auth.uid()); m public.miembros; admins int;
begin
  if tid is null or public.nivel_de(auth.uid(), 'usuarios') < 4 then raise exception 'sin_permiso'; end if;
  select * into m from public.miembros where user_id = p_user and tenant_id = tid;
  if not found then raise exception 'no_existe'; end if;
  if p_rol not in ('admin','supervisor','mostrador','operador') then raise exception 'rol_invalido'; end if;
  if length(trim(coalesce(p_nombre, ''))) < 3 then raise exception 'nombre_invalido'; end if;
  if m.rol = 'admin' and m.activo and (p_rol <> 'admin' or not p_activo) then
    select count(*) into admins from public.miembros where tenant_id = tid and rol = 'admin' and activo;
    if admins < 2 then raise exception 'ultimo_admin'; end if;
  end if;
  update public.miembros set nombre = left(trim(p_nombre), 80), rol = p_rol, activo = p_activo where user_id = p_user;
  update auth.users set banned_until = case when p_activo then null else 'infinity'::timestamptz end where id = p_user;
  if not p_activo or p_rol <> m.rol then perform public._cortar_sesiones(p_user); end if;
  perform public._audit_srv(tid, auth.uid(), 'Usuario editado', left(trim(p_nombre), 80) || ' · rol ' || p_rol || ' · ' || case when p_activo then 'activo' else 'de baja' end);
end $$;

create or replace function public.usuario_reset_clave(p_user uuid, p_clave text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare tid uuid := public.tenant_de(auth.uid()); m public.miembros;
begin
  if tid is null or public.nivel_de(auth.uid(), 'usuarios') < 4 then raise exception 'sin_permiso'; end if;
  select * into m from public.miembros where user_id = p_user and tenant_id = tid;
  if not found then raise exception 'no_existe'; end if;
  if not public.clave_ok(p_clave) then raise exception 'clave_debil'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_clave, extensions.gen_salt('bf', 10)), updated_at = now() where id = p_user;
  update public.miembros set cambiar = true where user_id = p_user;
  perform public._cortar_sesiones(p_user);
  perform public._audit_srv(tid, auth.uid(), 'Clave temporal', 'Generada para ' || m.nombre);
end $$;

create or replace function public.perms_guardar(p_perms jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare tid uuid := public.tenant_de(auth.uid()); r text; k text; v text; limpio jsonb := '{}'::jsonb;
begin
  if tid is null or public.nivel_de(auth.uid(), 'usuarios') < 4 then raise exception 'sin_permiso'; end if;
  if jsonb_typeof(p_perms) <> 'object' then raise exception 'perms_invalidos'; end if;
  foreach r in array array['supervisor','mostrador','operador'] loop
    limpio := limpio || jsonb_build_object(r, '{}'::jsonb);
    for k in select unnest(public.mods_validos()) loop
      v := coalesce(p_perms->r->>k, '');
      if v not in ('','ver','oper','edit','admin') then raise exception 'nivel_invalido'; end if;
      limpio := jsonb_set(limpio, array[r, k], to_jsonb(v));
    end loop;
  end loop;
  update public.tenants set perms = limpio where id = tid;
  perform public._audit_srv(tid, auth.uid(), 'Permisos', 'Matriz de permisos actualizada');
end $$;

-- ---------- equipos (número de caja / punto de venta por dispositivo) ----------
create or replace function public.equipo_num(p_device text, p_etiqueta text) returns int
language plpgsql security definer set search_path = public as $$
declare tid uuid := public.tenant_de(auth.uid()); n int;
begin
  if tid is null then raise exception 'sin_acceso'; end if;
  if p_device is null or length(p_device) < 8 or length(p_device) > 64 then raise exception 'device_invalido'; end if;
  select num into n from public.equipos where tenant_id = tid and device = p_device;
  if found then return n; end if;
  perform pg_advisory_xact_lock(hashtext('equipos' || tid::text));
  select coalesce(max(num), 0) + 1 into n from public.equipos where tenant_id = tid;
  insert into public.equipos (tenant_id, device, num, etiqueta) values (tid, p_device, n, left(coalesce(p_etiqueta, ''), 60));
  return n;
end $$;

-- ---------- sincronización ----------
create or replace function public.sync_push(p_cambios jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := auth.uid(); tid uuid := public.tenant_de(auth.uid()); c jsonb; cdef public.colecciones;
  cl text; rid text; d jsonb; old public.registros; res jsonb := '[]'::jsonb; actual numeric; cant numeric; lote text; nuevo_v int; nseq bigint; borrar boolean;
begin
  if tid is null then raise exception 'sin_acceso'; end if;
  if jsonb_typeof(p_cambios) <> 'array' or jsonb_array_length(p_cambios) > 300 then raise exception 'lote_invalido'; end if;
  for c in select * from jsonb_array_elements(p_cambios) loop
    begin
      cl := c->>'col'; rid := c->>'id'; borrar := coalesce((c->>'del')::boolean, false); d := c->'data';
      select * into cdef from public.colecciones where col = cl;
      if not found then raise exception 'coleccion_invalida'; end if;
      if rid is null or length(rid) < 1 or length(rid) > 80 then raise exception 'id_invalido'; end if;
      if not public.puede(uid, cl, 'w', case when borrar then 3 else 2 end) then raise exception 'sin_permiso'; end if;
      select * into old from public.registros where tenant_id = tid and col = cl and id = rid for update;
      if borrar then
        if cdef.sin_borrar then raise exception 'no_se_borra'; end if;
        if found then
          update public.registros set borrado = true, v = v + 1, seq = nextval('public.registros_seq'), updated_at = now(), updated_by = uid where tenant_id = tid and col = cl and id = rid;
        end if;
        res := res || jsonb_build_object('col', cl, 'id', rid, 'ok', true);
        continue;
      end if;
      if d is null or jsonb_typeof(d) <> 'object' then raise exception 'dato_invalido'; end if;
      if length(d::text) > 400000 then raise exception 'registro_muy_grande'; end if;
      if cl = 'pacientes' and coalesce(d->>'dni', '') <> rid then raise exception 'id_no_coincide'; end if;
      if cl not in ('pacientes','cfg','ong','m_pub','m_draft') and coalesce(d->>'id', '') <> rid then raise exception 'id_no_coincide'; end if;
      if old.col is not null and cdef.solo_agregar and not old.borrado then
        if old.data = d then
          res := res || jsonb_build_object('col', cl, 'id', rid, 'ok', true, 'v', old.v, 'seq', old.seq); continue;
        end if;
        raise exception 'solo_agregar';
      end if;
      if old.col is not null and cdef.congela_cerradas and not old.borrado and old.data->>'estado' = 'cerrada' then
        if (old.data - 'notas') <> (d - 'notas') or jsonb_array_length(coalesce(d->'notas', '[]'::jsonb)) < jsonb_array_length(coalesce(old.data->'notas', '[]'::jsonb)) then
          raise exception 'caja_cerrada';
        end if;
      end if;
      if cl = 'movs' and old.col is null then
        lote := d->>'lote'; cant := (d->>'cant')::numeric;
        perform pg_advisory_xact_lock(hashtext(tid::text || coalesce(lote, '')));
        if cant < 0 then
          select coalesce(sum((r.data->>'cant')::numeric), 0) into actual from public.registros r
            where r.tenant_id = tid and r.col = 'movs' and not r.borrado and r.data->>'lote' = lote;
          if actual + cant < -0.0001 then raise exception 'stock_negativo'; end if;
        end if;
      end if;
      if cl = 'audit' then d := d || jsonb_build_object('uid', uid::text, 'srv', true); end if;
      nuevo_v := coalesce(old.v, 0) + 1; nseq := nextval('public.registros_seq');
      insert into public.registros (tenant_id, col, id, data, v, seq, updated_by, borrado)
      values (tid, cl, rid, d, nuevo_v, nseq, uid, false)
      on conflict (tenant_id, col, id) do update set data = excluded.data, v = excluded.v, seq = excluded.seq, updated_at = now(), updated_by = excluded.updated_by, borrado = false;
      res := res || jsonb_build_object('col', cl, 'id', rid, 'ok', true, 'v', nuevo_v, 'seq', nseq);
    exception when others then
      res := res || jsonb_build_object('col', cl, 'id', rid, 'ok', false, 'err', sqlerrm);
    end;
  end loop;
  return res;
end $$;

-- vacía los datos operativos (conserva usuarios, permisos, ajustes, menú, rubros, auditoría)
create or replace function public.sync_vaciar() returns void
language plpgsql security definer set search_path = public as $$
declare tid uuid := public.tenant_de(auth.uid());
begin
  if tid is null or public.nivel_de(auth.uid(), 'ajustes') < 4 then raise exception 'sin_permiso'; end if;
  -- baja lógica: los demás equipos reciben el borrado en su próxima sincronización
  update public.registros set borrado = true, v = v + 1, seq = nextval('public.registros_seq'), updated_at = now(), updated_by = auth.uid()
   where tenant_id = tid and not borrado and col in ('pacientes','lotes','movs','disp','aportes','comps','seg','cajas','cmovs','fichas','sellos','cupones','cuponUsos','membresias','insumos','imovs','cultivos','cultReg','m_altas','m_solic','m_turnos','m_hcs','tareas','staff');
  delete from public.solicitudes_publicas where tenant_id = tid;
  perform public._audit_srv(tid, auth.uid(), 'Empezar de cero', 'Se retiraron los datos operativos de la nube');
end $$;

-- ---------- menú público y solicitudes anónimas ----------
create or replace function public.pub_menu_obtener() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('data', data, 'version', version, 'updated_at', updated_at) from public.menu_publicado order by updated_at desc limit 1;
$$;

create or replace function public.menu_publicar(p_data jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare tid uuid := public.tenant_de(auth.uid()); v int;
begin
  if tid is null or public.nivel_de(auth.uid(), 'menu') < 3 then raise exception 'sin_permiso'; end if;
  if jsonb_typeof(p_data) <> 'object' or length(p_data::text) > 400000 then raise exception 'menu_invalido'; end if;
  insert into public.menu_publicado (tenant_id, data) values (tid, p_data)
  on conflict (tenant_id) do update set data = excluded.data, version = public.menu_publicado.version + 1, updated_at = now()
  returning version into v;
  return v;
end $$;

create or replace function public._limitar(p_clave text, p_max int, p_seg int) returns void
language plpgsql security definer set search_path = public as $$
declare l public.limites;
begin
  insert into public.limites (clave, n, ventana) values (p_clave, 0, now()) on conflict (clave) do nothing;
  select * into l from public.limites where clave = p_clave for update;
  if l.ventana < now() - make_interval(secs => p_seg) then update public.limites set n = 0, ventana = now() where clave = p_clave; l.n := 0; end if;
  if l.n >= p_max then raise exception 'limite'; end if;
  update public.limites set n = n + 1 where clave = p_clave;
end $$;

create or replace function public.pub_solicitud(p_tipo text, p_payload jsonb, p_nonce text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare tid uuid; ip text; ya public.solicitudes_publicas; l text := null; abc text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; b bytea; i int; intento int := 0;
begin
  select id into tid from public.tenants order by created_at limit 1;
  if tid is null then raise exception 'no_disponible'; end if;
  if p_tipo not in ('hc','turno','club') then raise exception 'tipo_invalido'; end if;
  if jsonb_typeof(p_payload) <> 'object' or length(p_payload::text) > 20000 then raise exception 'dato_invalido'; end if;
  if p_nonce is null or length(p_nonce) < 8 or length(p_nonce) > 64 then raise exception 'nonce_invalido'; end if;
  select * into ya from public.solicitudes_publicas where tenant_id = tid and nonce = p_nonce;
  if found then return jsonb_build_object('ok', true, 'leg', ya.leg, 'repetida', true); end if;
  ip := coalesce((nullif(current_setting('request.headers', true), '')::jsonb)->>'x-forwarded-for', 'sin-ip');
  ip := encode(extensions.digest(split_part(ip, ',', 1), 'sha256'), 'hex');
  perform public._limitar('pub:' || p_tipo || ':ip:' || ip, 6, 3600);
  perform public._limitar('pub:' || p_tipo || ':all', 300, 3600);
  if p_tipo = 'hc' then
    loop
      b := extensions.gen_random_bytes(6); l := 'L-' || to_char(now() at time zone 'America/Argentina/Salta', 'YYMMDD') || '-';
      for i in 0..5 loop l := l || substr(abc, (get_byte(b, i) % 31) + 1, 1); end loop;
      exit when not exists (select 1 from public.solicitudes_publicas where tenant_id = tid and leg = l) and not exists (select 1 from public.registros where tenant_id = tid and col = 'pacientes' and data->>'leg' = l);
      intento := intento + 1; if intento > 20 then raise exception 'reintentar'; end if;
    end loop;
  end if;
  insert into public.solicitudes_publicas (tenant_id, tipo, payload, leg, nonce) values (tid, p_tipo, p_payload, l, p_nonce);
  return jsonb_build_object('ok', true, 'leg', l);
end $$;

create or replace function public.solicitudes_listar() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tid uuid := public.tenant_de(auth.uid());
begin
  if tid is null or (public.nivel_de(auth.uid(), 'menu') < 2 and public.nivel_de(auth.uid(), 'pacientes') < 2) then raise exception 'sin_permiso'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'tipo', tipo, 'leg', leg, 'nonce', nonce, 'ts', created_at, 'payload', payload) order by created_at) from public.solicitudes_publicas where tenant_id = tid and estado = 'pendiente'), '[]'::jsonb);
end $$;

create or replace function public.solicitud_resolver(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare tid uuid := public.tenant_de(auth.uid());
begin
  if tid is null or (public.nivel_de(auth.uid(), 'menu') < 2 and public.nivel_de(auth.uid(), 'pacientes') < 2) then raise exception 'sin_permiso'; end if;
  update public.solicitudes_publicas set estado = 'procesada', payload = '{}'::jsonb where id = p_id and tenant_id = tid;
end $$;

update public.tenants set perms = public.perms_defecto() where perms = '{}'::jsonb;

-- soporte de Rave: restablece la clave de un usuario (se corre a mano en el SQL Editor; NO es ejecutable desde la API)
create or replace function public.soporte_restablecer_clave(p_correo text, p_clave text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare m public.miembros;
begin
  select * into m from public.miembros where lower(correo) = lower(trim(p_correo));
  if not found then raise exception 'no_existe'; end if;
  if not public.clave_ok(p_clave) then raise exception 'clave_debil'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_clave, extensions.gen_salt('bf', 10)), updated_at = now() where id = m.user_id;
  update public.miembros set cambiar = true where user_id = m.user_id;
  perform public._cortar_sesiones(m.user_id);
  perform public._audit_srv(m.tenant_id, m.user_id, 'Soporte', 'Clave restablecida por Rave Holding (verificación de identidad previa)');
end $$;

-- ---------- permisos de ejecución (nada por defecto) ----------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;

grant select on public.registros to authenticated;
grant execute on function public.bootstrap_estado() to anon, authenticated;
grant execute on function public.bootstrap(text, text, text, text, text) to anon, authenticated;
grant execute on function public.pub_menu_obtener() to anon, authenticated;
grant execute on function public.pub_solicitud(text, jsonb, text) to anon, authenticated;
grant execute on function public.miembro_actual() to authenticated;
grant execute on function public.clave_cambiada() to authenticated;
grant execute on function public.usuarios_listar() to authenticated;
grant execute on function public.usuario_crear(text, text, text, text) to authenticated;
grant execute on function public.usuario_actualizar(uuid, text, text, boolean) to authenticated;
grant execute on function public.usuario_reset_clave(uuid, text) to authenticated;
grant execute on function public.perms_guardar(jsonb) to authenticated;
grant execute on function public.equipo_num(text, text) to authenticated;
grant execute on function public.sync_push(jsonb) to authenticated;
grant execute on function public.sync_vaciar() to authenticated;
grant execute on function public.menu_publicar(jsonb) to authenticated;
grant execute on function public.solicitudes_listar() to authenticated;
grant execute on function public.solicitud_resolver(uuid) to authenticated;
-- las funciones internas (_crear_auth_user, _audit_srv, _limitar, _cortar_sesiones, puede, nivel_de, tenant_de, clave_ok, mods_validos)
-- no se exponen a la API; mi_tenant() y puedo_leer() sólo miran al usuario autenticado (auth.uid()).
grant execute on function public.mi_tenant() to authenticated;
grant execute on function public.puedo_leer(text) to authenticated;
