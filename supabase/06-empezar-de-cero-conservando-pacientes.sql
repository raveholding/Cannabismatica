-- =====================================================================================
-- 06 · «Empezar de cero» CONSERVANDO pacientes, legajos y documentos · 2026-11-10
-- Pedido de la fundación: arrancar el sistema limpio, pero sólo con los pacientes, su legajo
-- (ficha, historia clínica, REPROCANN, seguimientos médicos) y sus documentos (consentimiento
-- informado, REPROCANN y demás escaneos / accesos a Drive).
-- Aditivo e idempotente. Correr en el SQL Editor con el contenido pegado.
--
-- Qué se CONSERVA: pacientes · legDocs (documentos del legajo) · seg (seguimientos médicos) ·
--   m_hcs (historias clínicas recibidas por el menú, evita que se dupliquen) · solicitudes de
--   historia clínica del menú público todavía sin incorporar · usuarios, permisos, ajustes, rubros,
--   planes, menú público y auditoría (la auditoría es sólo-agregar por diseño).
-- Qué se RETIRA (baja lógica, llega a todos los equipos en la próxima sincronización):
--   lotes, stock, dispensaciones, donaciones, comprobantes, cajas y sus movimientos, personal y
--   fichadas, tareas, sellos, cupones, membresías, inventario, cultivo, altas al club, pedidos de
--   turno y mensajes del menú.
-- Antes de retirar, copia todo lo afectado a public.respaldo_registros (sólo lo ve el SQL Editor).
-- =====================================================================================
create table if not exists public.respaldo_registros (
  respaldo_id bigserial primary key,
  respaldo_ts timestamptz not null default now(),
  motivo text not null,
  tenant_id uuid not null,
  col text not null,
  id text not null,
  data jsonb not null,
  v int,
  borrado boolean
);
alter table public.respaldo_registros enable row level security;   -- sin políticas: nadie desde la API
revoke all on public.respaldo_registros from anon, authenticated;

create or replace function public.sync_vaciar_conservar() returns jsonb
language plpgsql security definer set search_path = public as $$
declare tid uuid := public.tenant_de(auth.uid());
  cols text[] := array['lotes','movs','disp','aportes','comps','cajas','cmovs','fichas','sellos','cupones','cuponUsos','membresias','insumos','imovs','cultivos','cultReg','m_altas','m_solic','m_turnos','tareas','staff'];
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
  -- del menú público sólo quedan las historias clínicas todavía sin incorporar (son pacientes nuevos)
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

-- Para revisar antes / después (SQL Editor):
--   select col, count(*) filter (where not borrado) activos, count(*) filter (where borrado) retirados from public.registros group by col order by col;
--   select motivo, col, count(*) from public.respaldo_registros group by 1, 2 order by 1, 2;
