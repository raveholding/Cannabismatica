-- Sistema VB ONG · Promociones de la dispensa (2026-11-21)
-- Colección «promos»: la leen quienes dispensan, donan o manejan caja; la escriben sólo administradores
-- (nivel 4 en Dispensaciones o Configuración), validado en sync_push. No se borran: se archivan.
insert into public.colecciones (col, lectura, escritura, solo_agregar, congela_cerradas, sin_borrar)
values ('promos', array['dispensaciones','aportes','caja','pacientes','trazabilidad','dashboard','ajustes'], array['dispensaciones','ajustes'], false, false, true)
on conflict (col) do update set lectura = excluded.lectura, escritura = excluded.escritura, sin_borrar = true;
-- sync_push: escribir «promos» exige nivel 4 (igual que «planes»). Se reemplaza sólo esa condición; idempotente.
do $$
declare d text := pg_get_functiondef('public.sync_push(jsonb)'::regprocedure);
begin
  if position('''planes'',''promos''' in d) = 0 then
    d := replace(d, 'when cl = ''planes'' then 4', 'when cl in (''planes'',''promos'') then 4');
    if position('''planes'',''promos''' in d) = 0 then raise exception 'no se encontró la condición de nivel de sync_push'; end if;
    execute d;
  end if;
end $$;
