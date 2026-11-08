-- =====================================================================================
-- 03 · Planes de membresía sólo para administración y nombres del equipo para Tareas · 2026-11-08
-- Aditivo e idempotente.
--  1) sync_push: escribir la colección «planes» exige nivel «admin» (4) en Fidelización
--     (el administrador siempre lo tiene; otro rol sólo si se lo dan en Usuarios y permisos).
--  2) equipo_nombres(): id y nombre de las personas activas del equipo, para elegir responsable
--     en Tareas. No devuelve correos ni roles. Lo puede usar quien tenga acceso a Tareas.
-- =====================================================================================

-- 1) planes: nivel admin para escribir (se reemplaza sólo la expresión del nivel mínimo)
do $$
declare def text;
begin
  def := pg_get_functiondef('public.sync_push(jsonb)'::regprocedure);
  if position('when cl = ''planes'' then 4' in def) = 0 then
    def := replace(def, 'case when borrar then 3 else 2 end', 'case when borrar then 3 when cl = ''planes'' then 4 else 2 end');
    if position('when cl = ''planes'' then 4' in def) = 0 then raise exception 'sync_push no tiene la forma esperada: no se modificó'; end if;
    execute def;
  end if;
end $$;

-- 2) nombres del equipo (sin datos de contacto)
create or replace function public.equipo_nombres()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := public.tenant_de(auth.uid());
begin
  if tid is null or public.nivel_de(auth.uid(), 'tareas') < 1 then raise exception 'sin_permiso'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', user_id, 'nombre', nombre) order by nombre)
    from public.miembros where tenant_id = tid and activo and coalesce(nombre, '') <> ''), '[]'::jsonb);
end $$;
revoke all on function public.equipo_nombres() from public, anon;
grant execute on function public.equipo_nombres() to authenticated;
