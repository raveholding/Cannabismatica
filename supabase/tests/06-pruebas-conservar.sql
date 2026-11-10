-- Pruebas de 06-empezar-de-cero-conservando-pacientes.sql (base de PRUEBA, nunca producción).
-- Uso: psql -f supabase/tests/06-pruebas-conservar.sql  (con 01..06 ya aplicados y auth.uid() leyendo t.uid)
\set ON_ERROR_STOP 1
begin;
create temp table _r (n text, ok boolean);
insert into public.tenants (id, nombre) values ('00000000-0000-0000-0000-0000000000a1', 'ONG prueba');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b1', 'a@x'), ('00000000-0000-0000-0000-0000000000b2', 'm@x');
insert into public.miembros (user_id, tenant_id, nombre, correo, rol) values
 ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'Admin', 'a@x', 'admin'),
 ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', 'Mostrador', 'm@x', 'mostrador');
-- datos: 3 pacientes, 4 documentos, 2 seguimientos, 1 HC del menú y de todo lo operativo
insert into public.registros (tenant_id, col, id, data)
select '00000000-0000-0000-0000-0000000000a1', c, i, jsonb_build_object('id', i, 'dni', i)
from (values ('pacientes','30111222'),('pacientes','30111223'),('pacientes','8800000000001'),
 ('legDocs','DOC-1'),('legDocs','DOC-2'),('legDocs','DOC-3'),('legDocs','DOC-4'),('seg','SE-1'),('seg','SE-2'),('m_hcs','HC-x'),
 ('lotes','L1'),('movs','MV-1'),('disp','D-1'),('aportes','A-1'),('aportes','A-2'),('comps','CP-1'),('cajas','CJ-1-00001'),('cmovs','CM-1'),
 ('fichas','FI-1'),('sellos','S-1'),('cupones','CU-1'),('cuponUsos','CUU-1'),('membresias','MB-1'),('insumos','IN-1'),('imovs','IM-1'),
 ('cultivos','CL-1'),('cultReg','CR-1'),('m_altas','AL-1'),('m_solic','SO-1'),('m_turnos','TU-1'),('tareas','T-1'),('staff','ST-1'),
 ('rubros','R-1'),('planes','PL-1'),('cfg','main'),('ong','main'),('m_pub','main'),('audit','AU-1')) v(c, i);
update public.registros set borrado = true where id = 'A-2';   -- ya quitada antes
insert into public.solicitudes_publicas (tenant_id, tipo, payload, leg, nonce, estado) values
 ('00000000-0000-0000-0000-0000000000a1','hc','{"n":1}','L-1','nonce-hc-pend','pendiente'),
 ('00000000-0000-0000-0000-0000000000a1','hc','{}','L-2','nonce-hc-proc','procesada'),
 ('00000000-0000-0000-0000-0000000000a1','turno','{}',null,'nonce-turno-1','pendiente'),
 ('00000000-0000-0000-0000-0000000000a1','club','{}',null,'nonce-club-1','pendiente');

-- 1) sin sesión y con mostrador: rechazado
select set_config('t.uid', '', true);
do $$ begin perform public.sync_vaciar_conservar(); insert into _r values ('anónimo rechazado', false); exception when others then insert into _r values ('anónimo rechazado', sqlerrm = 'sin_permiso'); end $$;
select set_config('t.uid', '00000000-0000-0000-0000-0000000000b2', true);
do $$ begin perform public.sync_vaciar_conservar(); insert into _r values ('mostrador rechazado', false); exception when others then insert into _r values ('mostrador rechazado', sqlerrm = 'sin_permiso'); end $$;
insert into _r select 'tras rechazo no se tocó nada', count(*) = 0 from public.registros where borrado and id <> 'A-2';

-- 2) administración
select set_config('t.uid', '00000000-0000-0000-0000-0000000000b1', true);
create temp table _res as select public.sync_vaciar_conservar() r;
insert into _r select 'devuelve conteos', (r->>'retirados')::int = 21 and (r->>'respaldados')::int = 21 and (r->>'pacientes')::int = 3 and (r->>'docs')::int = 4 and (r->>'seg')::int = 2 and (r->>'solicitudes')::int = 3 from _res;
insert into _r select 'pacientes intactos', count(*) = 3 from public.registros where col = 'pacientes' and not borrado;
insert into _r select 'documentos intactos', count(*) = 4 from public.registros where col = 'legDocs' and not borrado;
insert into _r select 'seguimientos e HC del menú intactos', count(*) = 3 from public.registros where col in ('seg','m_hcs') and not borrado;
insert into _r select 'config, rubros, planes, menú intactos', count(*) = 5 from public.registros where col in ('rubros','planes','cfg','ong','m_pub') and not borrado;
insert into _r select 'operativo retirado (todo)', count(*) = 0 from public.registros where not borrado and col in ('lotes','movs','disp','aportes','comps','cajas','cmovs','fichas','sellos','cupones','cuponUsos','membresias','insumos','imovs','cultivos','cultReg','m_altas','m_solic','m_turnos','tareas','staff');
insert into _r select 'retirados llevan versión y seq nuevos (llegan a los equipos)', bool_and(v = 2) from public.registros where borrado and id <> 'A-2';
insert into _r select 'respaldo con los datos completos', count(*) = 21 and bool_and(data ? 'id') from public.respaldo_registros;
insert into _r select 'solo queda la HC pública pendiente', array_agg(nonce) = array['nonce-hc-pend'] from public.solicitudes_publicas;
insert into _r select 'auditoría del servidor', count(*) = 1 from public.registros where col = 'audit' and data->>'accion' = 'Empezar de cero (conservando pacientes)' and data->>'detalle' like '%quedan 3 pacientes, 4 documentos y 2 seguimientos%';
-- 3) repetir no rompe ni duplica respaldo
create temp table _res2 as select public.sync_vaciar_conservar() r;
insert into _r select 'repetir: 0 retirados, sin respaldo nuevo', (r->>'retirados')::int = 0 and (select count(*) from public.respaldo_registros) = 21 from _res2;
-- 4) después se puede volver a cargar con el mismo id (caja nueva del equipo 1)
select set_config('request.jwt.claims', '', true);
create temp table _p as select public.sync_push('[{"col":"cajas","id":"CJ-1-00001","data":{"id":"CJ-1-00001","estado":"abierta"}}]'::jsonb) r;
insert into _r select 'caja nueva con id reutilizado se guarda', (r->0->>'ok')::boolean from _p;
-- 5) el respaldo no lo lee la API
insert into _r select 'respaldo sin acceso para anon/authenticated', not has_table_privilege('authenticated', 'public.respaldo_registros', 'select') and not has_table_privilege('anon', 'public.respaldo_registros', 'select');
insert into _r select 'anon no ejecuta la función', not has_function_privilege('anon', 'public.sync_vaciar_conservar()', 'execute');
select (case when ok then 'ok   ' else 'FALLA' end) || ' ' || n from _r;
select count(*) filter (where ok) || '/' || count(*) as resultado from _r;
rollback;
