-- =====================================================================
-- Nova CRM — журнал изменений и «Выдачи ОС» в Postgres (26.09.2026, фаза 3
-- переезда с Firestore; условие Nurba — никто не должен заметить перемен).
-- Повторяемый файл: «Скопировать SQL» вставляет все файлы разом и повторно.
--
-- А. history_log — журнал изменений ячеек (Firestore `history`). Пишет любой
--    участник, кроме Viewer, ТОЛЬКО через log_history (SECURITY DEFINER:
--    user_id — из токена, до 100 записей за вызов — клиент копит пачку и
--    отдаёт её одним запросом, как раньше одним документом). Читает и
--    удаляет только Owner (как `isOwner` в правилах). Записи не правятся.
-- Б. os_dispatch_log — журнал выборочных выдач ОС (Firestore `osDispatchLog`).
--    Пишет тот, кто вправе выдавать заказы (Owner, Тимлид, любой с ролью ОС),
--    только от своего имени — через log_os_dispatch. Читают Owner и Тимлид
--    (`hasFullAccess`) — набор rows_lead_workspaces(); удаляет Owner.
-- В. nova_schema_version() = '20261008'.
-- Опирается на rows_* (20260923), rows_owned_workspaces (20260930b) и
-- nova_touch (20260927): rev/server_at ставит база.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Набор «руководство»: Owner (по документу или роли) и Тимлид — hasFullAccess.
-- ---------------------------------------------------------------------
create or replace function public.rows_lead_workspaces() returns setof text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select w from public.rows_owned_workspaces() w
  union
  select m.workspace_id from public.rows_members m
  where m.uid = public.rows_uid() and m.role = 'teamlead'
$$;

revoke all on function public.rows_lead_workspaces() from public;
grant execute on function public.rows_lead_workspaces() to anon, authenticated;

-- ---------------------------------------------------------------------
-- А. Журнал изменений.
-- ---------------------------------------------------------------------
create table if not exists public.history_log (
  workspace_id text not null references public.rows_workspaces (workspace_id) on delete cascade,
  id text not null,
  page_id text,
  page_name text,
  row_id text,
  field text,
  field_label text,
  -- Значения ячейки: строка, число или null — как в Firestore.
  old_value jsonb,
  new_value jsonb,
  action text not null default 'update' check (action in ('create', 'update', 'delete', 'restore')),
  user_id text not null,
  user_name text not null default '',
  -- Время правки по часам устройства (как timestamp в Firestore) — по нему
  -- сортируется журнал; created_at — серверное время записи.
  ts bigint not null,
  created_at bigint not null,
  rev bigint not null default 0,
  server_at timestamptz not null default now(),
  primary key (workspace_id, id)
);
create index if not exists history_log_page on public.history_log (workspace_id, page_id, ts desc);
create index if not exists history_log_ts on public.history_log (workspace_id, ts desc);

drop trigger if exists history_log_20_touch on public.history_log;
create trigger history_log_20_touch before insert or update on public.history_log
  for each row execute function public.nova_touch();

alter table public.history_log enable row level security;

drop policy if exists history_log_read on public.history_log;
create policy history_log_read on public.history_log for select to anon, authenticated
  using (workspace_id in (select public.rows_owned_workspaces()));

drop policy if exists history_log_delete on public.history_log;
create policy history_log_delete on public.history_log for delete to anon, authenticated
  using (workspace_id in (select public.rows_owned_workspaces()));
-- Вставки и правки с клиента нет: только log_history.

revoke all on public.history_log from public, anon, authenticated;
grant select, delete on public.history_log to anon, authenticated;

-- Пачка записей одним вызовом. Плохие элементы (не объект, кривой id или
-- action) пропускаются, повтор id — no-op; возвращает число записанных.
create or replace function public.log_history(p_workspace text, p_entries jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  v_role text;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  e jsonb;
  n integer := 0;
  k integer;
  v_old jsonb;
  v_new jsonb;
begin
  if me is null then
    raise exception 'log_history: нет токена' using errcode = '42501';
  end if;
  v_role := public.rows_member_role(p_workspace);
  if v_role is null or v_role = 'viewer' then
    raise exception 'log_history: журнал пишут участники, кроме Viewer' using errcode = '42501';
  end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'log_history: ожидается массив записей' using errcode = '22023';
  end if;
  if jsonb_array_length(p_entries) > 100 then
    raise exception 'log_history: не больше 100 записей за вызов' using errcode = '22023';
  end if;
  for e in select * from jsonb_array_elements(p_entries) loop
    if jsonb_typeof(e) <> 'object' then continue; end if;
    if coalesce(e ->> 'id', '') !~ '^[A-Za-z0-9_-]{1,100}$' then continue; end if;
    if coalesce(e ->> 'action', 'update') not in ('create', 'update', 'delete', 'restore') then continue; end if;
    v_old := case when jsonb_typeof(e -> 'oldValue') = 'string' then to_jsonb(left(e ->> 'oldValue', 4000))
                  when jsonb_typeof(e -> 'oldValue') = 'number' then e -> 'oldValue' else null end;
    v_new := case when jsonb_typeof(e -> 'newValue') = 'string' then to_jsonb(left(e ->> 'newValue', 4000))
                  when jsonb_typeof(e -> 'newValue') = 'number' then e -> 'newValue' else null end;
    insert into public.history_log (workspace_id, id, page_id, page_name, row_id, field, field_label,
      old_value, new_value, action, user_id, user_name, ts, created_at)
    values (p_workspace, e ->> 'id', left(e ->> 'pageId', 200), left(e ->> 'pageName', 300), left(e ->> 'rowId', 200),
      left(e ->> 'field', 200), left(e ->> 'fieldLabel', 300), v_old, v_new, coalesce(e ->> 'action', 'update'), me,
      left(coalesce(e ->> 'userName', ''), 200),
      case when coalesce(e ->> 'timestamp', '') ~ '^[0-9]{1,16}$' then (e ->> 'timestamp')::bigint else v_now end,
      v_now)
    on conflict (workspace_id, id) do nothing;
    get diagnostics k = row_count;
    n := n + k;
  end loop;
  return n;
end;
$$;

revoke all on function public.log_history(text, jsonb) from public;
grant execute on function public.log_history(text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Б. Выдачи ОС.
-- ---------------------------------------------------------------------
create table if not exists public.os_dispatch_log (
  workspace_id text not null references public.rows_workspaces (workspace_id) on delete cascade,
  id text not null,
  kind text not null check (kind in ('assign', 'move', 'unassign')),
  os_uid text not null,
  os_name text not null default '',
  tech_uid text,
  tech_name text not null default '',
  prev_tech_name text,
  client text not null default '',
  phone text not null default '',
  amount numeric,
  src_page_id text not null default '',
  src_row_id text not null default '',
  -- Серверное время, миллисекунды (createdAt в Firestore был по часам ОС).
  created_at bigint not null,
  rev bigint not null default 0,
  server_at timestamptz not null default now(),
  primary key (workspace_id, id)
);
create index if not exists os_dispatch_log_window on public.os_dispatch_log (workspace_id, created_at desc);

drop trigger if exists os_dispatch_log_20_touch on public.os_dispatch_log;
create trigger os_dispatch_log_20_touch before insert or update on public.os_dispatch_log
  for each row execute function public.nova_touch();

alter table public.os_dispatch_log enable row level security;

drop policy if exists os_dispatch_log_read on public.os_dispatch_log;
create policy os_dispatch_log_read on public.os_dispatch_log for select to anon, authenticated
  using (workspace_id in (select public.rows_lead_workspaces()));

drop policy if exists os_dispatch_log_delete on public.os_dispatch_log;
create policy os_dispatch_log_delete on public.os_dispatch_log for delete to anon, authenticated
  using (workspace_id in (select public.rows_owned_workspaces()));

revoke all on public.os_dispatch_log from public, anon, authenticated;
grant select, delete on public.os_dispatch_log to anon, authenticated;

-- Одна выдача. Возвращает серверное created_at; повтор id — та же запись.
create or replace function public.log_os_dispatch(p_workspace text, p_entry jsonb)
returns bigint
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_id text;
  v_kind text;
begin
  if me is null or not public.rows_is_member(p_workspace) then
    raise exception 'log_os_dispatch: не участник workspace' using errcode = '42501';
  end if;
  if not (public.rows_is_owner(p_workspace) or public.rows_is_teamlead(p_workspace) or public.rows_has_role(p_workspace, 'os')) then
    raise exception 'log_os_dispatch: выдачи пишут Owner, Тимлид и ОС' using errcode = '42501';
  end if;
  if p_entry is null or jsonb_typeof(p_entry) <> 'object' then
    raise exception 'log_os_dispatch: запись должна быть объектом' using errcode = '22023';
  end if;
  v_id := p_entry ->> 'id';
  if v_id is null or v_id !~ '^[A-Za-z0-9_-]{1,100}$' then
    raise exception 'log_os_dispatch: неверный id записи' using errcode = '22023';
  end if;
  v_kind := p_entry ->> 'kind';
  if v_kind is null or v_kind not in ('assign', 'move', 'unassign') then
    raise exception 'log_os_dispatch: неверный вид выдачи' using errcode = '22023';
  end if;
  insert into public.os_dispatch_log (workspace_id, id, kind, os_uid, os_name, tech_uid, tech_name, prev_tech_name,
    client, phone, amount, src_page_id, src_row_id, created_at)
  values (p_workspace, v_id, v_kind, me,
    left(coalesce(p_entry ->> 'osName', ''), 200),
    left(p_entry ->> 'techUid', 200),
    left(coalesce(p_entry ->> 'techName', ''), 200),
    left(p_entry ->> 'prevTechName', 200),
    left(coalesce(p_entry ->> 'client', ''), 300),
    left(coalesce(p_entry ->> 'phone', ''), 64),
    case when jsonb_typeof(p_entry -> 'amount') = 'number' then (p_entry ->> 'amount')::numeric else null end,
    left(coalesce(p_entry ->> 'srcPageId', ''), 200),
    left(coalesce(p_entry ->> 'srcRowId', ''), 200),
    v_now)
  on conflict (workspace_id, id) do nothing;
  return coalesce((select l.created_at from public.os_dispatch_log l where l.workspace_id = p_workspace and l.id = v_id), v_now);
end;
$$;

revoke all on function public.log_os_dispatch(text, jsonb) from public;
grant execute on function public.log_os_dispatch(text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------
-- В. Версия схемы.
-- ---------------------------------------------------------------------
create or replace function public.nova_schema_version() returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select '20261008'::text
$$;

revoke all on function public.nova_schema_version() from public, anon, authenticated;
grant execute on function public.nova_schema_version() to anon, authenticated;
