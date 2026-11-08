-- =====================================================================================
-- 05 · Tarjeta digital del Club (pacientes/socios) · 2026-11-08 · SISTEMA_VB_ONGF 4.25 / 4.27.3
-- Aditivo e idempotente. Una función pública (anónima) que, a quien tiene el identificador secreto
-- de una tarjeta (80 bits al azar, guardado en la ficha del paciente: data.club.id), le devuelve
-- SÓLO el N.º de socio, los sellos, la meta y el beneficio. Nunca nombre, documento, legajo,
-- teléfono ni ningún dato de salud. Una tarjeta dada de baja o reemitida (id nuevo) deja de responder.
-- Límite de consultas por IP para que no se pueda probar identificadores a ciegas.
-- =====================================================================================
create or replace function public.pub_club_estado(p_id text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare tid uuid; ip text; v_dni text; v_num text; v_n numeric; v_cfg jsonb; v_menu jsonb;
begin
  if coalesce(p_id, '') !~ '^[A-Z2-9]{16}$' then return jsonb_build_object('ok', false); end if;
  select id into tid from public.tenants order by created_at limit 1;
  if tid is null then return jsonb_build_object('ok', false); end if;
  ip := coalesce((nullif(current_setting('request.headers', true), '')::jsonb)->>'x-forwarded-for', 'sin-ip');
  ip := encode(extensions.digest(split_part(ip, ',', 1), 'sha256'), 'hex');
  perform public._limitar('club:ip:' || ip, 240, 3600);
  select r.id, r.data->'club'->>'num' into v_dni, v_num from public.registros r
   where r.tenant_id = tid and r.col = 'pacientes' and not r.borrado
     and r.data->'club'->>'id' = p_id and coalesce((r.data->'club'->>'baja')::boolean, false) = false
   limit 1;
  if v_dni is null then return jsonb_build_object('ok', true, 'socio', false); end if;
  select coalesce(sum((s.data->>'cant')::numeric), 0) into v_n from public.registros s
   where s.tenant_id = tid and s.col = 'sellos' and not s.borrado and s.data->>'dni' = v_dni;
  select data into v_cfg from public.registros where tenant_id = tid and col = 'cfg' and id = 'main';
  select data->'club' into v_menu from public.menu_publicado where tenant_id = tid;
  return jsonb_build_object('ok', true, 'socio', true, 'num', v_num, 'sellos', v_n,
    'meta', coalesce((v_cfg->>'sellosMeta')::int, 8), 'premio', left(coalesce(v_menu->'premio'->>'es', ''), 120));
end $$;
revoke all on function public.pub_club_estado(text) from public;
grant execute on function public.pub_club_estado(text) to anon, authenticated;
