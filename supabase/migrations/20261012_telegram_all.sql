-- =====================================================================
-- Nova CRM — раздел «Telegram» открыт всем ролям (26.09.2026, просьба
-- Nurba: «сделай возможность подключаться всем, раздели по категориям:
-- ОС, технари и другие»). Повторяемый файл. Меняет 20261011:
--   А. tg_my_workspaces(): раздел открыт, если есть строка доступа И человек
--      сейчас участник workspace (копия прав rows_members). Роль больше не
--      проверяется. Убрали из участников — доступ пропадает сам.
--   Б. tg_set_access(): Owner может отметить ЛЮБОГО участника (ОС, технаря,
--      Тимлида, Admin, Viewer, себя). Не участники молча отбрасываются.
--   В. nova_schema_version() = '20261012'.
-- Правки этих функций — только в этом файле или новее: повтор 20261011
-- вернул бы «только ОС», но деплой после изменившегося файла накатывает и
-- все следующие (каскад scripts/supabase-sql.mjs).
-- =====================================================================

create or replace function public.tg_my_workspaces() returns setof text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select a.workspace_id from public.tg_access a
  where a.uid = public.rows_uid() and public.rows_is_member(a.workspace_id)
$$;

revoke all on function public.tg_my_workspaces() from public;
grant execute on function public.tg_my_workspaces() to anon, authenticated;

create or replace function public.tg_set_access(p_workspace text, p_uids text[])
returns setof text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if me is null or p_workspace is null or not coalesce(public.rows_is_owner(p_workspace), false) then
    raise exception 'tg_set_access: доступ к Telegram выдаёт только Owner' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_uids), 0) > 200 then
    raise exception 'tg_set_access: слишком длинный список' using errcode = '22023';
  end if;

  -- Снимаются и не отмеченные, и те, кто ушёл из участников: доступа у
  -- ушедшего и так нет (tg_my_workspaces), а строка не должна вернуть его,
  -- если человека когда-нибудь примут обратно.
  delete from public.tg_access a
  where a.workspace_id = p_workspace
    and (
      not (a.uid = any (coalesce(p_uids, '{}'::text[])))
      or not exists (select 1 from public.rows_members m where m.workspace_id = p_workspace and m.uid = a.uid)
    );

  insert into public.tg_access (workspace_id, uid, granted_by, granted_at)
  select distinct p_workspace, m.uid, me, v_now
  from unnest(coalesce(p_uids, '{}'::text[])) as u (uid)
  join public.rows_members m on m.workspace_id = p_workspace and m.uid = u.uid
  on conflict (workspace_id, uid) do nothing;

  return query select a.uid from public.tg_access a where a.workspace_id = p_workspace order by a.uid;
end;
$$;

revoke all on function public.tg_set_access(text, text[]) from public;
grant execute on function public.tg_set_access(text, text[]) to anon, authenticated;

create or replace function public.nova_schema_version() returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select '20261012'::text
$$;

revoke all on function public.nova_schema_version() from public, anon, authenticated;
grant execute on function public.nova_schema_version() to anon, authenticated;
