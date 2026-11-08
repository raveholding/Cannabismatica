-- =====================================================================================
-- 04 · Donaciones: editar importe/medio y quitar/restaurar sólo con nivel «admin» · 2026-11-08
-- Aditivo e idempotente. Sobre una donación ya guardada, cambiar importe, medio, pago mixto
-- o pasarla a / sacarla de «quitada» exige nivel 4 en Donaciones. Anular (dispensación) sigue igual.
-- =====================================================================================
do $$
declare def text; ancla text := 'if cl not in (''pacientes'',''cfg'',''ong'',''m_pub'',''m_draft'') and coalesce(d->>''id'', '''') <> rid then raise exception ''id_no_coincide''; end if;';
begin
  def := pg_get_functiondef('public.sync_push(jsonb)'::regprocedure);
  if position('aportes_solo_admin' in def) = 0 then
    if position(ancla in def) = 0 then raise exception 'sync_push no tiene la forma esperada: no se modificó'; end if;
    def := replace(def, ancla, ancla || E'\n      if cl = ''aportes'' and old.col is not null and not old.borrado and ((old.data->''cent'') is distinct from (d->''cent'') or (old.data->''medio'') is distinct from (d->''medio'') or (old.data->''pays'') is distinct from (d->''pays'') or (coalesce(old.data->>''estado'', '''') = ''quitada'') <> (coalesce(d->>''estado'', '''') = ''quitada'')) and not public.puede(uid, cl, ''w'', 4) then raise exception ''sin_permiso''; end if; -- aportes_solo_admin');
    execute def;
  end if;
end $$;
