-- Pruebas del servidor (RLS, permisos por rol, stock, cierres, auditoría, público).
-- Se corren en el SQL Editor sobre un proyecto de PRUEBA o antes de la entrega; limpian lo que crean.
-- Resultado: una fila por prueba (ok = true/false).
create table if not exists public._t (n serial, prueba text, ok boolean, detalle text);
truncate public._t;
create or replace function public._chk(p text, c boolean, d text default '') returns void language sql security definer set search_path = public as $$
  insert into public._t (prueba, ok, detalle) values (p, coalesce(c, false), left(coalesce(d, ''), 200));
$$;
grant all on public._t to authenticated, anon;
grant usage on all sequences in schema public to authenticated, anon;
grant execute on function public._chk(text, boolean, text) to authenticated, anon;

do $$
declare
  ta uuid; tb uuid; a uuid; b uuid; mos uuid; sup uuid; r jsonb; n int; e text;
  pw text := 'Prueba2026x';
  hoy text := to_char(now(), 'YYYY-MM-DD');
begin
  select id into ta from public.tenants order by created_at limit 1;
  select user_id into a from public.miembros where tenant_id = ta and rol = 'admin' order by created_at limit 1;
  -- tenant B (otro comercio) con su admin
  insert into public.tenants (nombre, perms) values ('Comercio B (prueba)', public.perms_defecto()) returning id into tb;
  b := public._crear_auth_user('admin.b.prueba@example.com', pw);
  insert into public.miembros (user_id, tenant_id, nombre, correo, rol) values (b, tb, 'Admin B', 'admin.b.prueba@example.com', 'admin');

  -- ===== como admin A =====
  perform set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  mos := public.usuario_crear('mostrador.prueba@example.com', 'Mostrador Prueba', 'mostrador', pw);
  sup := public.usuario_crear('super.prueba@example.com', 'Supervisora Prueba', 'supervisor', pw);
  perform public._chk('admin crea usuarios', mos is not null and sup is not null);
  begin perform public.usuario_crear('mostrador.prueba@example.com', 'Otro', 'mostrador', pw); perform public._chk('correo duplicado rechazado', false); exception when others then perform public._chk('correo duplicado rechazado', sqlerrm like '%correo_existente%', sqlerrm); end;
  begin perform public.usuario_crear('debil@example.com', 'Debil Prueba', 'mostrador', 'abc'); perform public._chk('clave débil rechazada', false); exception when others then perform public._chk('clave débil rechazada', sqlerrm like '%clave_debil%', sqlerrm); end;

  r := public.sync_push(jsonb_build_array(
    jsonb_build_object('col','pacientes','id','99000001','data',jsonb_build_object('dni','99000001','nombre','Paciente Prueba','leg','L-PRUEBA-AAAAAA')),
    jsonb_build_object('col','lotes','id','LT-1','data',jsonb_build_object('id','LT-1','nombre','Lote 1')),
    jsonb_build_object('col','movs','id','MV-1','data',jsonb_build_object('id','MV-1','lote','LT-1','cant',100)),
    jsonb_build_object('col','movs','id','MV-2','data',jsonb_build_object('id','MV-2','lote','LT-1','cant',-30)),
    jsonb_build_object('col','movs','id','MV-3','data',jsonb_build_object('id','MV-3','lote','LT-1','cant',-80)),
    jsonb_build_object('col','cajas','id','CJ-1','data',jsonb_build_object('id','CJ-1','estado','cerrada','inicial',1000,'cierre',jsonb_build_object('hash','abc'),'notas','[]'::jsonb)),
    jsonb_build_object('col','audit','id','AU-1','data',jsonb_build_object('id','AU-1','accion','x')),
    jsonb_build_object('col','cultivos','id','CU-1','data',jsonb_build_object('id','CU-1','nombre','Ciclo'))
  ));
  perform public._chk('push paciente ok', (r->0->>'ok')::boolean, r->0->>'err');
  perform public._chk('push lote ok', (r->1->>'ok')::boolean);
  perform public._chk('stock: ingreso ok', (r->2->>'ok')::boolean);
  perform public._chk('stock: egreso dentro del saldo ok', (r->3->>'ok')::boolean);
  perform public._chk('stock: egreso que deja negativo rechazado', not (r->4->>'ok')::boolean and r->4->>'err' like '%stock_negativo%', r->4->>'err');
  perform public._chk('caja cerrada se guarda', (r->5->>'ok')::boolean, r->5->>'err');
  perform public._chk('auditoría se agrega', (r->6->>'ok')::boolean);
  perform public._chk('cultivo se guarda', (r->7->>'ok')::boolean, r->7->>'err');

  r := public.sync_push(jsonb_build_array(
    jsonb_build_object('col','cajas','id','CJ-1','data',jsonb_build_object('id','CJ-1','estado','cerrada','inicial',2000,'cierre',jsonb_build_object('hash','abc'),'notas','[]'::jsonb)),
    jsonb_build_object('col','cajas','id','CJ-1','data',jsonb_build_object('id','CJ-1','estado','cerrada','inicial',1000,'cierre',jsonb_build_object('hash','abc'),'notas','[{"t":"nota"}]'::jsonb)),
    jsonb_build_object('col','audit','id','AU-1','data',jsonb_build_object('id','AU-1','accion','CAMBIADA')),
    jsonb_build_object('col','pacientes','id','99000001','del',true),
    jsonb_build_object('col','movs','id','MV-2','data',jsonb_build_object('id','MV-2','lote','LT-1','cant',-30)),
    jsonb_build_object('col','coleccion_falsa','id','x','data','{}'::jsonb),
    jsonb_build_object('col','pacientes','id','11111111','data',jsonb_build_object('dni','22222222'))
  ));
  perform public._chk('cierre congelado: no se edita', not (r->0->>'ok')::boolean and r->0->>'err' like '%caja_cerrada%', r->0->>'err');
  perform public._chk('cierre congelado: se pueden agregar notas', (r->1->>'ok')::boolean, r->1->>'err');
  perform public._chk('auditoría: no se modifica', not (r->2->>'ok')::boolean and r->2->>'err' like '%solo_agregar%', r->2->>'err');
  perform public._chk('paciente: no se borra', not (r->3->>'ok')::boolean, r->3->>'err');
  perform public._chk('reenvío idéntico es idempotente', (r->4->>'ok')::boolean, r->4->>'err');
  perform public._chk('colección inválida rechazada', not (r->5->>'ok')::boolean, r->5->>'err');
  perform public._chk('id distinto del dni rechazado', not (r->6->>'ok')::boolean, r->6->>'err');

  select count(*) into n from public.registros;
  perform public._chk('admin A lee sus registros', n >= 8, n::text);

  -- ===== como mostrador (A) =====
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', mos::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  r := public.sync_push(jsonb_build_array(
    jsonb_build_object('col','pacientes','id','99000002','data',jsonb_build_object('dni','99000002','nombre','Otro Paciente')),
    jsonb_build_object('col','cfg','id','_','data',jsonb_build_object('x',1)),
    jsonb_build_object('col','cultivos','id','CU-2','data',jsonb_build_object('id','CU-2')),
    jsonb_build_object('col','audit','id','AU-2','data',jsonb_build_object('id','AU-2','accion','y'))
  ));
  perform public._chk('mostrador: carga paciente', (r->0->>'ok')::boolean, r->0->>'err');
  perform public._chk('mostrador: no toca ajustes', not (r->1->>'ok')::boolean and r->1->>'err' like '%sin_permiso%', r->1->>'err');
  perform public._chk('mostrador: no toca cultivo', not (r->2->>'ok')::boolean and r->2->>'err' like '%sin_permiso%', r->2->>'err');
  perform public._chk('mostrador: puede auditar', (r->3->>'ok')::boolean, r->3->>'err');
  select count(*) into n from public.registros where col = 'cultivos';
  perform public._chk('mostrador: no lee cultivos (RLS)', n = 0, n::text);
  select count(*) into n from public.registros where col = 'pacientes';
  perform public._chk('mostrador: lee pacientes', n >= 2, n::text);
  select count(*) into n from public.registros where col = 'audit';
  perform public._chk('mostrador: no lee la auditoría', n = 0, n::text);
  begin perform public.usuario_crear('x.prueba@example.com','Equis Prueba','mostrador',pw); perform public._chk('mostrador no crea usuarios', false); exception when others then perform public._chk('mostrador no crea usuarios', sqlerrm like '%sin_permiso%', sqlerrm); end;
  begin perform public.perms_guardar('{}'::jsonb); perform public._chk('mostrador no cambia permisos', false); exception when others then perform public._chk('mostrador no cambia permisos', sqlerrm like '%sin_permiso%', sqlerrm); end;
  begin perform public.sync_vaciar(); perform public._chk('mostrador no vacía datos', false); exception when others then perform public._chk('mostrador no vacía datos', sqlerrm like '%sin_permiso%', sqlerrm); end;
  begin perform public.menu_publicar('{"x":1}'::jsonb); perform public._chk('mostrador no publica el menú', false); exception when others then perform public._chk('mostrador no publica el menú', sqlerrm like '%sin_permiso%', sqlerrm); end;

  -- ===== como admin B: aislamiento =====
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', b::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.registros;
  perform public._chk('B no ve nada de A', n = 0, n::text);
  r := public.sync_push(jsonb_build_array(jsonb_build_object('col','pacientes','id','99000001','data',jsonb_build_object('dni','99000001','nombre','Paciente de B'))));
  perform public._chk('B escribe en su propio espacio', (r->0->>'ok')::boolean, r->0->>'err');
  select count(*) into n from public.registros;
  perform public._chk('B sólo ve lo suyo', n = 1, n::text);
  select count(*) into n from public.usuarios_listar() j, jsonb_array_elements(j);
  perform public._chk('B no lista usuarios de A', n = 1, n::text);
  begin perform public.usuario_actualizar(a, 'Hack Hack', 'operador', false); perform public._chk('B no edita usuarios de A', false); exception when others then perform public._chk('B no edita usuarios de A', sqlerrm like '%no_existe%', sqlerrm); end;
  begin perform public.usuario_reset_clave(a, 'Hackeado2026'); perform public._chk('B no resetea claves de A', false); exception when others then perform public._chk('B no resetea claves de A', sqlerrm like '%no_existe%', sqlerrm); end;

  -- ===== como admin A: usuarios =====
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.usuario_actualizar(a, 'Admin Prueba', 'operador', true); perform public._chk('no se puede dejar sin administrador', false); exception when others then perform public._chk('no se puede dejar sin administrador', sqlerrm like '%ultimo_admin%', sqlerrm); end;
  perform public.usuario_reset_clave(mos, 'Temporal2026a');
  perform public._chk('reset de clave exige cambio', (select cambiar from public.miembros where user_id = mos));
  perform public.usuario_actualizar(sup, 'Supervisora Prueba', 'supervisor', false);
  perform public._chk('baja de usuario', not (select activo from public.miembros where user_id = sup));
  perform public.menu_publicar('{"nombre":"Menú de prueba"}'::jsonb);

  -- ===== anónimo =====
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  r := public.pub_menu_obtener();
  perform public._chk('anónimo ve el menú publicado', r->'data'->>'nombre' = 'Menú de prueba', r::text);
  begin perform 1 from public.registros limit 1; perform public._chk('anónimo no lee registros', false); exception when others then perform public._chk('anónimo no lee registros', sqlerrm like '%permission denied%', sqlerrm); end;
  begin perform public.sync_push('[]'::jsonb); perform public._chk('anónimo no sincroniza', false); exception when others then perform public._chk('anónimo no sincroniza', sqlerrm like '%permission denied%', sqlerrm); end;
  begin perform public.usuarios_listar(); perform public._chk('anónimo no lista usuarios', false); exception when others then perform public._chk('anónimo no lista usuarios', sqlerrm like '%permission denied%', sqlerrm); end;
  begin perform public._crear_auth_user('hack@example.com', 'Hackeado2026'); perform public._chk('anónimo no crea cuentas', false); exception when others then perform public._chk('anónimo no crea cuentas', sqlerrm like '%permission denied%', sqlerrm); end;
  r := public.pub_solicitud('hc', '{"nombre":"Persona Prueba"}'::jsonb, 'nonce-prueba-0001');
  perform public._chk('solicitud pública devuelve legajo', (r->>'ok')::boolean and r->>'leg' ~ '^L-[0-9]{6}-[A-Z2-9]{6}$', r::text);
  perform public._chk('solicitud repetida no duplica', (public.pub_solicitud('hc', '{"nombre":"Persona Prueba"}'::jsonb, 'nonce-prueba-0001'))->>'leg' = r->>'leg');
  begin perform public.pub_solicitud('xx', '{}'::jsonb, 'nonce-prueba-0002'); perform public._chk('tipo inválido rechazado', false); exception when others then perform public._chk('tipo inválido rechazado', sqlerrm like '%tipo_invalido%', sqlerrm); end;
  begin perform public.bootstrap('X', 'x@example.com', 'Equis', 'Prueba2026x', 'ONG'); perform public._chk('bootstrap cerrado una vez configurado', false); exception when others then perform public._chk('bootstrap cerrado una vez configurado', sqlerrm like '%ya_configurado%', sqlerrm); end;

  execute 'reset role';
  -- limpieza de lo creado por la prueba (B, mostrador, supervisora y datos de A)
  delete from public.solicitudes_publicas where nonce like 'nonce-prueba-%';
  delete from public.registros where tenant_id = tb;
  delete from public.miembros where tenant_id = tb;
  delete from public.tenants where id = tb;
  delete from auth.users where email in ('admin.b.prueba@example.com', 'mostrador.prueba@example.com', 'super.prueba@example.com');
  delete from public.registros where tenant_id = ta;
  delete from public.menu_publicado where tenant_id = ta;
  delete from public.limites where clave like 'pub:%';
end $$;

select n, prueba, ok, detalle from public._t order by n;
