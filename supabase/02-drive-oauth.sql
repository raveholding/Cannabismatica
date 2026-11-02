-- =====================================================================================
-- 02 · Google Drive de la ONG SIN conectar en cada equipo (Gmail común) · 2026-11-01
-- Una persona administradora autoriza UNA sola vez; el servidor guarda el permiso (refresh token)
-- cifrado en la bóveda de Supabase (supabase_vault). Ningún navegador lo puede leer.
-- Aditivo e idempotente. Lo usa la función de servidor «drive-legajos».
-- Por qué no cuenta de servicio: en un Drive de Gmail común la cuenta de servicio no tiene espacio
-- propio y Google rechaza las subidas.
-- =====================================================================================
create extension if not exists supabase_vault;

create table if not exists public.drive_conexion (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  secreto_id uuid,                  -- id del secreto en vault.secrets (el token NO está en esta tabla)
  cuenta text,                      -- correo de Google que autorizó
  carpeta_raiz_id text check (carpeta_raiz_id is null or carpeta_raiz_id ~ '^[A-Za-z0-9_-]{10,120}$'),
  scopes text,
  conectado_por uuid,
  conectado_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.drive_conexion enable row level security;
revoke all on public.drive_conexion from anon, authenticated;   -- sin políticas: ilegible desde el navegador

-- guardar (o reemplazar) el permiso de Google de un comercio
create or replace function public.drive_guardar_token(p_tenant uuid, p_token text, p_cuenta text, p_uid uuid, p_scopes text)
returns void language plpgsql security definer set search_path = public, vault, pg_temp as $$
declare v_sec uuid;
begin
  if p_token is null or length(p_token) < 20 then raise exception 'token_invalido'; end if;
  if not exists (select 1 from public.miembros where user_id = p_uid and tenant_id = p_tenant and rol = 'admin' and activo) then
    raise exception 'sin_permiso';
  end if;
  select secreto_id into v_sec from public.drive_conexion where tenant_id = p_tenant;
  if v_sec is not null and exists (select 1 from vault.secrets where id = v_sec) then
    perform vault.update_secret(v_sec, p_token);
  else
    v_sec := vault.create_secret(p_token, 'drive_rt_' || p_tenant::text || '_' || extract(epoch from now())::bigint, 'Permiso de Google Drive de la ONG (refresh token)');
  end if;
  insert into public.drive_conexion (tenant_id, secreto_id, cuenta, scopes, conectado_por, conectado_at, updated_at)
  values (p_tenant, v_sec, left(p_cuenta, 200), left(p_scopes, 500), p_uid, now(), now())
  on conflict (tenant_id) do update set secreto_id = excluded.secreto_id, cuenta = excluded.cuenta, scopes = excluded.scopes,
    conectado_por = excluded.conectado_por, conectado_at = excluded.conectado_at, updated_at = now();
  perform public._audit_srv(p_tenant, p_uid, 'DRIVE_CONECTADO', 'Google Drive conectado con la cuenta ' || coalesce(left(p_cuenta, 200), '?'));
end $$;

-- leer (sólo el servidor)
create or replace function public.drive_leer(p_tenant uuid)
returns jsonb language sql stable security definer set search_path = public, vault, pg_temp as $$
  select jsonb_build_object('token', d.decrypted_secret, 'cuenta', c.cuenta, 'raiz', c.carpeta_raiz_id, 'conectado_at', c.conectado_at)
  from public.drive_conexion c left join vault.decrypted_secrets d on d.id = c.secreto_id
  where c.tenant_id = p_tenant
$$;

create or replace function public.drive_set_raiz(p_tenant uuid, p_raiz text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_raiz !~ '^[A-Za-z0-9_-]{10,120}$' then raise exception 'carpeta_invalida'; end if;
  update public.drive_conexion set carpeta_raiz_id = p_raiz, updated_at = now() where tenant_id = p_tenant;
end $$;

create or replace function public.drive_borrar(p_tenant uuid, p_uid uuid)
returns void language plpgsql security definer set search_path = public, vault, pg_temp as $$
declare v_sec uuid;
begin
  if not exists (select 1 from public.miembros where user_id = p_uid and tenant_id = p_tenant and rol = 'admin' and activo) then
    raise exception 'sin_permiso';
  end if;
  select secreto_id into v_sec from public.drive_conexion where tenant_id = p_tenant;
  if v_sec is not null then delete from vault.secrets where id = v_sec; end if;
  delete from public.drive_conexion where tenant_id = p_tenant;
  perform public._audit_srv(p_tenant, p_uid, 'DRIVE_DESCONECTADO', 'Google Drive desconectado');
end $$;

-- sólo la función de servidor (service_role) puede usarlas
do $$
declare f text;
begin
  foreach f in array array['public.drive_guardar_token(uuid,text,text,uuid,text)','public.drive_leer(uuid)','public.drive_set_raiz(uuid,text)','public.drive_borrar(uuid,uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
