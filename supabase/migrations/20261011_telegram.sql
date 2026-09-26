-- =====================================================================
-- Nova CRM — раздел «Telegram» (26.09.2026, просьба Nurba: «отдельная
-- страница под Telegram, только у ОС пока что, с выбором, кто может
-- получить доступ»). Повторяемый файл.
--
-- Сам Telegram через Supabase НЕ идёт: браузер подключается к серверам
-- Telegram напрямую (mtcute), переписка и файлы живут там. Здесь только то,
-- что хранит Nova:
--   А. tg_access — кому Owner открыл раздел. Допустить можно только
--      участника с ролью ОС (основной или второй). Читает свою строку сам
--      человек, весь список — Owner.
--   Б. tg_config — ключи приложения Telegram (api_id / api_hash с
--      my.telegram.org). Это не пароль: без кода с телефона хозяина
--      аккаунта с ними не войти. Читают Owner и допущенные ОС.
--   В. tg_set_access / tg_set_config — пишет только Owner (SECURITY DEFINER;
--      прямой записи с клиента нет).
--   Г. nova_schema_version() = '20261011'.
-- =====================================================================

create table if not exists public.tg_access (
  workspace_id text not null references public.rows_workspaces (workspace_id) on delete cascade,
  uid text not null,
  granted_by text not null default '',
  granted_at bigint not null,
  primary key (workspace_id, uid)
);

create table if not exists public.tg_config (
  workspace_id text primary key references public.rows_workspaces (workspace_id) on delete cascade,
  api_id integer not null check (api_id > 0),
  api_hash text not null check (api_hash ~ '^[0-9a-f]{32}$'),
  updated_by text not null default '',
  updated_at bigint not null
);

-- Где раздел открыт мне: есть строка доступа И роль ОС сейчас. Сняли роль
-- ОС — доступ пропадает сам, даже если строку забыли убрать.
create or replace function public.tg_my_workspaces() returns setof text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select a.workspace_id from public.tg_access a
  where a.uid = public.rows_uid() and public.rows_has_role(a.workspace_id, 'os')
$$;

revoke all on function public.tg_my_workspaces() from public;
grant execute on function public.tg_my_workspaces() to anon, authenticated;

alter table public.tg_access enable row level security;
alter table public.tg_config enable row level security;

drop policy if exists tg_access_read on public.tg_access;
create policy tg_access_read on public.tg_access for select to anon, authenticated
  using (
    (uid = (select public.rows_uid()) and workspace_id in (select public.tg_my_workspaces()))
    or workspace_id in (select public.rows_owned_workspaces())
  );

drop policy if exists tg_config_read on public.tg_config;
create policy tg_config_read on public.tg_config for select to anon, authenticated
  using (
    workspace_id in (select public.tg_my_workspaces())
    or workspace_id in (select public.rows_owned_workspaces())
  );

revoke all on public.tg_access from public, anon, authenticated;
revoke all on public.tg_config from public, anon, authenticated;
grant select on public.tg_access to anon, authenticated;
grant select on public.tg_config to anon, authenticated;

-- ---------------------------------------------------------------------
-- Owner: список допущенных целиком. Не ОС и не участники молча
-- отбрасываются; возвращает тех, кто в итоге допущен.
-- ---------------------------------------------------------------------
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
  if me is null or p_workspace is null or not public.rows_is_owner(p_workspace) then
    raise exception 'tg_set_access: доступ к Telegram выдаёт только Owner' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_uids), 0) > 200 then
    raise exception 'tg_set_access: слишком длинный список' using errcode = '22023';
  end if;

  delete from public.tg_access a
  where a.workspace_id = p_workspace
    and not (a.uid = any (coalesce(p_uids, '{}'::text[])));

  insert into public.tg_access (workspace_id, uid, granted_by, granted_at)
  select distinct p_workspace, m.uid, me, v_now
  from unnest(coalesce(p_uids, '{}'::text[])) as u (uid)
  join public.rows_members m on m.workspace_id = p_workspace and m.uid = u.uid
  where m.role = 'os' or 'os' = any (m.extra_roles)
  on conflict (workspace_id, uid) do nothing;

  return query select a.uid from public.tg_access a where a.workspace_id = p_workspace order by a.uid;
end;
$$;

revoke all on function public.tg_set_access(text, text[]) from public;
grant execute on function public.tg_set_access(text, text[]) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Owner: ключи приложения. api_id = null — ключи стираются.
-- ---------------------------------------------------------------------
create or replace function public.tg_set_config(p_workspace text, p_api_id integer, p_api_hash text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  v_hash text := lower(btrim(coalesce(p_api_hash, '')));
begin
  if me is null or p_workspace is null or not public.rows_is_owner(p_workspace) then
    raise exception 'tg_set_config: ключи Telegram вводит только Owner' using errcode = '42501';
  end if;
  if p_api_id is null then
    delete from public.tg_config where workspace_id = p_workspace;
    return;
  end if;
  if p_api_id <= 0 or v_hash !~ '^[0-9a-f]{32}$' then
    raise exception 'tg_set_config: api_id — число, api_hash — 32 знака 0-9a-f' using errcode = '22023';
  end if;
  insert into public.tg_config (workspace_id, api_id, api_hash, updated_by, updated_at)
  values (p_workspace, p_api_id, v_hash, me, (extract(epoch from clock_timestamp()) * 1000)::bigint)
  on conflict (workspace_id) do update set
    api_id = excluded.api_id,
    api_hash = excluded.api_hash,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.tg_set_config(text, integer, text) from public;
grant execute on function public.tg_set_config(text, integer, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Г. Версия схемы.
-- ---------------------------------------------------------------------
create or replace function public.nova_schema_version() returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select '20261011'::text
$$;

revoke all on function public.nova_schema_version() from public, anon, authenticated;
grant execute on function public.nova_schema_version() to anon, authenticated;
