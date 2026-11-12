-- =====================================================================================
-- 08 · Recursos humanos · 2026-11-11
-- Aditivo e idempotente. Correr en el SQL Editor con el contenido pegado.
--   · Permiso nuevo «rrhh» (Recursos humanos): legajos privados, aprobaciones de pedidos y liquidación.
--     Administración lo tiene siempre; supervisión arranca con «edit»; mostrador y operador sin acceso (se cambia en
--     Usuarios y permisos).
--   · rhpriv  · datos privados del legajo (CUIL, remuneración, documentos, notas). Sólo quien tiene «rrhh».
--   · rhsol   · pedidos de vacaciones, licencias, permisos, cambios de turno y adelantos. Los crea cada persona
--               (permiso «personal»); se aprueban en la app con «rrhh».
--   · rhliq   · liquidaciones internas cerradas. Sólo se agregan (una corrección es una versión nueva).
-- También suma estas colecciones a «Empezar de cero» (las dos variantes).
-- =====================================================================================
create or replace function public.mods_validos() returns text[] language sql immutable set search_path = public as $$
  select array['pacientes','dispensaciones','aportes','reprocann','trazabilidad','cultivo','dashboard','caja','cierre','cerradas','inventario','fidelizacion','personal','tareas','menu','nube','perifericos','importexport','integraciones','usuarios','auditoria','ajustes','rrhh'];
$$;

update public.tenants set perms = jsonb_set(perms, '{supervisor,rrhh}', '"edit"', true)
 where perms ? 'supervisor' and not (perms->'supervisor' ? 'rrhh');
update public.tenants set perms = jsonb_set(perms, array[r, 'rrhh'], '""', true)
  from unnest(array['mostrador','operador']) r
 where perms ? r and not (perms->r ? 'rrhh');

insert into public.colecciones (col, lectura, escritura, solo_agregar, congela_cerradas, sin_borrar) values
 ('rhpriv', array['rrhh'], array['rrhh'], false, false, true),
 ('rhsol',  array['personal','rrhh'], array['personal','rrhh'], false, false, true),
 ('rhliq',  array['rrhh'], array['rrhh'], true, false, true)
on conflict (col) do update set lectura = excluded.lectura, escritura = excluded.escritura,
  solo_agregar = excluded.solo_agregar, congela_cerradas = excluded.congela_cerradas, sin_borrar = excluded.sin_borrar;

create or replace function public.sync_vaciar() returns void
language plpgsql security definer set search_path = public as $$
declare tid uuid := public.tenant_de(auth.uid());
begin
  if tid is null or public.nivel_de(auth.uid(), 'ajustes') < 4 then raise exception 'sin_permiso'; end if;
  update public.registros set borrado = true, v = v + 1, seq = nextval('public.registros_seq'), updated_at = now(), updated_by = auth.uid()
   where tenant_id = tid and not borrado and col in ('pacientes','lotes','movs','disp','aportes','comps','seg','cajas','cmovs','ctransf','cortesx','fichas','sellos','cupones','cuponUsos','membresias','insumos','imovs','cultivos','cultReg','m_altas','m_solic','m_turnos','m_hcs','tareas','staff','rhpriv','rhsol','rhliq');
  delete from public.solicitudes_publicas where tenant_id = tid;
  perform public._audit_srv(tid, auth.uid(), 'Empezar de cero', 'Se retiraron los datos operativos de la nube');
end $$;

create or replace function public.sync_vaciar_conservar() returns jsonb
language plpgsql security definer set search_path = public as $$
declare tid uuid := public.tenant_de(auth.uid());
  cols text[] := array['lotes','movs','disp','aportes','comps','cajas','cmovs','ctransf','cortesx','fichas','sellos','cupones','cuponUsos','membresias','insumos','imovs','cultivos','cultReg','m_altas','m_solic','m_turnos','tareas','staff','rhpriv','rhsol','rhliq'];
  n_resp int; n_ret int; n_pac int; n_docs int; n_seg int; n_sol int; motivo text;
begin
  if tid is null or public.nivel_de(auth.uid(), 'ajustes') < 4 then raise exception 'sin_permiso'; end if;
  motivo := 'Empezar de cero conservando pacientes · ' || to_char(now() at time zone 'America/Argentina/Salta', 'YYYY-MM-DD HH24:MI');
  insert into public.respaldo_registros (motivo, tenant_id, col, id, data, v, borrado)
    select motivo, tenant_id, col, id, data, v, borrado from public.registros
     where tenant_id = tid and not borrado and col = any(cols);
  get diagnostics n_resp = row_count;
  update public.registros set borrado = true, v = v + 1, seq = nextval('public.registros_seq'), updated_at = now(), updated_by = auth.uid()
   where tenant_id = tid and not borrado and col = any(cols);
  get diagnostics n_ret = row_count;
  delete from public.solicitudes_publicas where tenant_id = tid and (estado = 'procesada' or tipo <> 'hc');
  get diagnostics n_sol = row_count;
  select count(*) into n_pac from public.registros where tenant_id = tid and col = 'pacientes' and not borrado;
  select count(*) into n_docs from public.registros where tenant_id = tid and col = 'legDocs' and not borrado;
  select count(*) into n_seg from public.registros where tenant_id = tid and col = 'seg' and not borrado;
  perform public._audit_srv(tid, auth.uid(), 'Empezar de cero (conservando pacientes)',
    n_ret || ' registros retirados (respaldo en el servidor) · quedan ' || n_pac || ' pacientes, ' || n_docs || ' documentos y ' || n_seg || ' seguimientos');
  return jsonb_build_object('ok', true, 'retirados', n_ret, 'respaldados', n_resp, 'solicitudes', n_sol, 'pacientes', n_pac, 'docs', n_docs, 'seg', n_seg);
end $$;
revoke all on function public.sync_vaciar_conservar() from public, anon;
grant execute on function public.sync_vaciar_conservar() to authenticated;
