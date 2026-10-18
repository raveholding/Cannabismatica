-- Sistema VB ONG · dejar el proyecto listo para entregar (SOLO el proyecto de la ONG).
-- BORRA TODO: usuarios, datos cargados, menú publicado y pruebas. Después genera un código de
-- configuración nuevo (válido para crear la primera cuenta de administración) y lo muestra UNA vez
-- en el resultado. El código no queda guardado en texto: sólo su hash SHA-256.
-- Correr en el SQL Editor con el contenido pegado (no el nombre del archivo).
drop function if exists public._chk(text, boolean, text);
drop table if exists public._t;
truncate public.limites;
delete from public.tenants;                       -- cascada: miembros, equipos, registros, menú, solicitudes
delete from auth.users;                           -- proyecto dedicado a la ONG: no hay otras cuentas
do $$
declare alfabeto text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; cod text := ''; i int;
begin
  for i in 1..16 loop
    cod := cod || substr(alfabeto, 1 + (get_byte(extensions.gen_random_bytes(1), 0) % length(alfabeto)), 1);
    if i % 4 = 0 and i < 16 then cod := cod || '-'; end if;
  end loop;
  insert into public.setup (id, codigo_hash, intentos, ventana, usado)
  values (1, encode(extensions.digest(cod, 'sha256'), 'hex'), 0, now(), false)
  on conflict (id) do update set codigo_hash = excluded.codigo_hash, intentos = 0, ventana = now(), usado = false;
  perform set_config('app.codigo_nuevo', cod, false);
end $$;
select current_setting('app.codigo_nuevo') as codigo_de_configuracion;
