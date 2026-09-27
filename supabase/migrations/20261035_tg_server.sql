-- =====================================================================
-- Nova CRM — Telegram: один аккаунт на workspace, вход на сервере,
-- технари пишут только разрешённым клиентам (27.09.2026).
--
-- Просьба Nurba: «только 1 аккаунт телеграмма в одном workspace; чтобы
-- аккаунт не вылетал, когда закрываешь сайт, и был доступен всегда — один
-- раз зашёл и остался, пока сам не выйдет или не заберут доступ; технарям —
-- писать только тем клиентам, кому разрешил ОС».
--
-- Раньше каждый входил по QR в своём браузере, и ключ входа жил только там.
-- Теперь:
--   А. tg_master — ГЛАВНЫЙ вход workspace (сессия mtcute, аккаунт, облачный
--      пароль, если Owner разрешил его запомнить). Закрыт всем, кроме
--      service_role: читает и пишет только функция Supabase `tg`.
--      Браузеры с полным доступом получают своё «устройство» от главного
--      входа без QR (auth.acceptLoginToken на сервере).
--   Б. tg_devices — какие устройства кому выданы (чтобы снять доступ сразу).
--   В. tg_tech_grants — разрешение технарю писать в конкретный чат. Выдают
--      те, кому открыт раздел (ОС и др.), и Owner. Технарь ходит в Telegram
--      ТОЛЬКО через функцию `tg`, и она проверяет разрешение здесь.
--   Г. tg_edge_ctx — «кто я и что мне можно» для функции `tg` (вызывается с
--      токеном человека, так функции не нужна своя проверка токена).
--   Д. tg_srv_lease — главным входом в один момент пользуется один вызов
--      (иначе Telegram ругается AUTH_KEY_DUPLICATED и убивает ключ).
-- Повторяемый файл.
-- =====================================================================

create table if not exists public.tg_master (
  workspace_id text primary key references public.rows_workspaces (workspace_id) on delete cascade,
  session text,
  account_id bigint,
  account_name text,
  account_username text,
  password text,
  connected_by text,
  connected_at timestamptz,
  pending_session text,
  pending_kind text,
  pending_phone text,
  pending_code_hash text,
  pending_by text,
  pending_at timestamptz,
  lease_holder text,
  lease_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.tg_master enable row level security;
-- Ни одной политики: только service_role (обходит RLS).
revoke all on public.tg_master from public, anon, authenticated;

create table if not exists public.tg_devices (
  workspace_id text not null references public.rows_workspaces (workspace_id) on delete cascade,
  uid text not null,
  marker text not null,
  auth_hash text,
  created_at timestamptz not null default now(),
  primary key (workspace_id, uid, marker)
);
alter table public.tg_devices add column if not exists auth_hash text;

alter table public.tg_devices enable row level security;
revoke all on public.tg_devices from public, anon, authenticated;

create table if not exists public.tg_tech_grants (
  workspace_id text not null references public.rows_workspaces (workspace_id) on delete cascade,
  chat_id bigint not null,
  tech_uid text not null,
  peer jsonb not null,
  title text not null default '',
  page_id text,
  row_id text,
  granted_by text not null,
  granted_at timestamptz not null default now(),
  primary key (workspace_id, chat_id, tech_uid)
);

create index if not exists tg_tech_grants_tech_idx on public.tg_tech_grants (workspace_id, tech_uid);

alter table public.tg_tech_grants enable row level security;
revoke all on public.tg_tech_grants from public, anon, authenticated;

do $grants$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.tg_master, public.tg_devices, public.tg_tech_grants to service_role;
    grant select on public.tg_config, public.tg_access, public.rows_members to service_role;
  end if;
end
$grants$;

-- ---------------------------------------------------------------------
-- Помощники.
-- ---------------------------------------------------------------------

-- Полный доступ к разделу: отмечен Owner'ом (tg_my_workspaces) или Owner.
create or replace function public.tg_full_access(ws text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.rows_uid() is not null and (
    coalesce(public.rows_is_owner(ws), false)
    or ws in (select public.tg_my_workspaces())
  )
$$;
revoke all on function public.tg_full_access(text) from public, anon, authenticated;

-- Workspace, где у меня есть разрешения технаря (и я участник).
create or replace function public.tg_tech_workspaces() returns setof text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select distinct g.workspace_id from public.tg_tech_grants g
  where g.tech_uid = public.rows_uid() and coalesce(public.rows_is_member(g.workspace_id), false)
$$;
revoke all on function public.tg_tech_workspaces() from public;
grant execute on function public.tg_tech_workspaces() to anon, authenticated;

-- ---------------------------------------------------------------------
-- Кто я для функции `tg`.
-- ---------------------------------------------------------------------
create or replace function public.tg_edge_ctx(p_workspace text) returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  member boolean;
begin
  if me is null or p_workspace is null then
    raise exception 'tg_edge_ctx: нужен вход' using errcode = '42501';
  end if;
  member := coalesce(public.rows_is_member(p_workspace), false);
  if not member then
    raise exception 'tg_edge_ctx: не участник' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'uid', me,
    'owner', coalesce(public.rows_is_owner(p_workspace), false),
    'full', public.tg_full_access(p_workspace),
    'grants', coalesce((
      select jsonb_agg(jsonb_build_object('chatId', g.chat_id, 'peer', g.peer, 'title', g.title) order by g.granted_at)
      from public.tg_tech_grants g
      where g.workspace_id = p_workspace and g.tech_uid = me
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.tg_edge_ctx(text) from public;
grant execute on function public.tg_edge_ctx(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Подключён ли аккаунт workspace (без сессии и пароля). Видят те, кому
-- открыт раздел, Owner и технари с разрешениями.
-- ---------------------------------------------------------------------
create or replace function public.tg_account_status(p_workspace text) returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  m public.tg_master%rowtype;
begin
  if not (public.tg_full_access(p_workspace) or p_workspace in (select public.tg_tech_workspaces())) then
    raise exception 'tg_account_status: раздел Telegram вам закрыт' using errcode = '42501';
  end if;
  select * into m from public.tg_master where workspace_id = p_workspace;
  if not found or m.session is null then
    return jsonb_build_object('connected', false, 'pending', found and m.pending_session is not null);
  end if;
  return jsonb_build_object(
    'connected', true,
    'accountId', m.account_id,
    'name', m.account_name,
    'username', m.account_username,
    'passwordSaved', m.password is not null,
    'connectedBy', m.connected_by,
    'connectedAt', floor(extract(epoch from m.connected_at) * 1000)
  );
end;
$$;
revoke all on function public.tg_account_status(text) from public;
grant execute on function public.tg_account_status(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Разрешения технарям.
-- ---------------------------------------------------------------------
create or replace function public.tg_grant_tech(
  p_workspace text,
  p_chat_id bigint,
  p_tech_uid text,
  p_peer jsonb,
  p_title text,
  p_page_id text default null,
  p_row_id text default null
) returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
begin
  if not public.tg_full_access(p_workspace) then
    raise exception 'tg_grant_tech: разрешать технарям может тот, кому открыт раздел Telegram' using errcode = '42501';
  end if;
  if p_chat_id is null or p_tech_uid is null or p_tech_uid = me then
    raise exception 'tg_grant_tech: нет чата или технаря' using errcode = '22023';
  end if;
  if not exists (select 1 from public.rows_members m where m.workspace_id = p_workspace and m.uid = p_tech_uid) then
    raise exception 'tg_grant_tech: технарь не участник workspace' using errcode = '22023';
  end if;
  if jsonb_typeof(p_peer) is distinct from 'object'
     or coalesce(p_peer->>'type', '') not in ('user', 'chat', 'channel')
     or coalesce(p_peer->>'id', '') !~ '^-?[0-9]{1,20}$'
     or (p_peer->>'type' <> 'chat' and coalesce(p_peer->>'accessHash', '') !~ '^-?[0-9]{1,20}$') then
    raise exception 'tg_grant_tech: неверный адрес чата' using errcode = '22023';
  end if;
  insert into public.tg_tech_grants as g (workspace_id, chat_id, tech_uid, peer, title, page_id, row_id, granted_by, granted_at)
  values (p_workspace, p_chat_id, p_tech_uid, p_peer, left(btrim(coalesce(p_title, '')), 200), p_page_id, p_row_id, me, now())
  on conflict (workspace_id, chat_id, tech_uid) do update
    set peer = excluded.peer,
        title = case when excluded.title = '' then g.title else excluded.title end,
        page_id = coalesce(excluded.page_id, g.page_id),
        row_id = coalesce(excluded.row_id, g.row_id),
        granted_by = excluded.granted_by,
        granted_at = now();
  return jsonb_build_object('chatId', p_chat_id, 'techUid', p_tech_uid);
end;
$$;
revoke all on function public.tg_grant_tech(text, bigint, text, jsonb, text, text, text) from public;
grant execute on function public.tg_grant_tech(text, bigint, text, jsonb, text, text, text) to anon, authenticated;

create or replace function public.tg_revoke_tech(p_workspace text, p_chat_id bigint, p_tech_uid text) returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
begin
  if not public.tg_full_access(p_workspace) then
    raise exception 'tg_revoke_tech: снимать разрешения может тот, кому открыт раздел Telegram' using errcode = '42501';
  end if;
  delete from public.tg_tech_grants g
  where g.workspace_id = p_workspace and g.chat_id = p_chat_id and g.tech_uid = p_tech_uid;
end;
$$;
revoke all on function public.tg_revoke_tech(text, bigint, text) from public;
grant execute on function public.tg_revoke_tech(text, bigint, text) to anon, authenticated;

-- Список разрешений: полный доступ — все (или по чату / строке), технарь — свои
-- (без адреса чата).
create or replace function public.tg_grants_list(
  p_workspace text,
  p_chat_id bigint default null,
  p_page_id text default null,
  p_row_id text default null
) returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  full_access boolean := public.tg_full_access(p_workspace);
begin
  if not full_access and not (p_workspace in (select public.tg_tech_workspaces())) then
    raise exception 'tg_grants_list: раздел Telegram вам закрыт' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'chatId', g.chat_id,
      'techUid', g.tech_uid,
      'title', g.title,
      'pageId', g.page_id,
      'rowId', g.row_id,
      'grantedBy', g.granted_by,
      'grantedAt', floor(extract(epoch from g.granted_at) * 1000)
    ) order by g.granted_at desc)
    from public.tg_tech_grants g
    where g.workspace_id = p_workspace
      and (full_access or g.tech_uid = me)
      and (p_chat_id is null or g.chat_id = p_chat_id)
      and (p_page_id is null or (g.page_id = p_page_id and g.row_id is not distinct from p_row_id))
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.tg_grants_list(text, bigint, text, text) from public;
grant execute on function public.tg_grants_list(text, bigint, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Служебное (только service_role): аренда главного входа.
-- ---------------------------------------------------------------------
create or replace function public.tg_srv_lease(p_workspace text, p_holder text, p_ttl_ms integer) returns boolean
language plpgsql volatile
set search_path = public, pg_temp
as $$
begin
  insert into public.tg_master (workspace_id) values (p_workspace) on conflict (workspace_id) do nothing;
  update public.tg_master m
     set lease_holder = p_holder,
         lease_until = clock_timestamp() + make_interval(secs => greatest(1, least(p_ttl_ms, 60000)) / 1000.0)
   where m.workspace_id = p_workspace
     and (m.lease_until is null or m.lease_until < clock_timestamp() or m.lease_holder = p_holder);
  return found;
end;
$$;

create or replace function public.tg_srv_release(p_workspace text, p_holder text) returns void
language sql volatile
set search_path = public, pg_temp
as $$
  update public.tg_master set lease_holder = null, lease_until = null
  where workspace_id = p_workspace and lease_holder = p_holder
$$;

revoke all on function public.tg_srv_lease(text, text, integer) from public, anon, authenticated;
revoke all on function public.tg_srv_release(text, text) from public, anon, authenticated;
do $grants2$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.tg_srv_lease(text, text, integer) to service_role;
    grant execute on function public.tg_srv_release(text, text) to service_role;
  end if;
end
$grants2$;

-- ---------------------------------------------------------------------
create or replace function public.nova_schema_version() returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select '20261035'
$$;
revoke all on function public.nova_schema_version() from public, anon, authenticated;
grant execute on function public.nova_schema_version() to anon, authenticated;
