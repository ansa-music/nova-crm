-- =====================================================================
-- Nova CRM — объявления в Postgres (26.09.2026, фаза 4 переезда с
-- Firestore; условие Nurba — никто не должен заметить перемен). Повторяемый
-- файл.
--
-- announcement_docs — те же документы, что announcements/{id} в Firestore
-- (jsonb `data`), плюс kind = 'meta' / id = 'imported' — отметка «старые
-- объявления перенесены, клиенты читают отсюда».
-- Права — копия правил:
--   читает любой участник;
--   пишет руководство (isManagement: Owner, Тимлид, Admin); автор нового
--   объявления — из токена.
-- Пишет только announcement_write (пачкой); удаление мягкое. Порядок в
-- ленте — `serverOrderAt` (серверное время создания, мс).
-- nova_schema_version() = '20261020'.
-- =====================================================================

create or replace function public.rows_is_management(ws text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.rows_is_owner(ws), false)
    or coalesce(public.rows_is_teamlead(ws), false)
    or coalesce(public.rows_member_role(ws) = 'admin', false)
$$;

revoke all on function public.rows_is_management(text) from public;
grant execute on function public.rows_is_management(text) to anon, authenticated;

create table if not exists public.announcement_docs (
  workspace_id text not null references public.rows_workspaces (workspace_id) on delete cascade,
  kind text not null check (kind in ('ann', 'meta')),
  id text not null,
  deleted boolean not null default false,
  data jsonb not null,
  rev bigint not null default 0,
  server_at timestamptz not null default now(),
  primary key (workspace_id, kind, id)
);
create index if not exists announcement_docs_rev on public.announcement_docs (workspace_id, rev);

drop trigger if exists announcement_docs_20_touch on public.announcement_docs;
create trigger announcement_docs_20_touch before insert or update on public.announcement_docs
  for each row execute function public.nova_touch();

alter table public.announcement_docs enable row level security;

drop policy if exists announcement_docs_read on public.announcement_docs;
create policy announcement_docs_read on public.announcement_docs for select to anon, authenticated
  using (workspace_id in (select public.rows_my_workspaces()));

revoke all on public.announcement_docs from public, anon, authenticated;
grant select on public.announcement_docs to anon, authenticated;

create or replace function public.announcement_keys_ok(d jsonb) returns boolean
language sql immutable
set search_path = public, pg_temp
as $$
  select not exists (
    select 1 from jsonb_object_keys(d) k
    where k <> all (array['id', 'workspaceId', 'title', 'body', 'priority', 'pinned', 'isArchived',
      'authorUid', 'authorName', 'authorPhotoURL', 'createdAt', 'updatedAt', 'serverOrderAt']))
$$;

revoke all on function public.announcement_keys_ok(jsonb) from public;
grant execute on function public.announcement_keys_ok(jsonb) to anon, authenticated;

-- Пачка записей. p_ops — массив {kind: 'ann', id, op: merge|set|delete, data}.
create or replace function public.announcement_write(p_workspace text, p_ops jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  o jsonb;
  v_id text;
  v_op text;
  cur public.announcement_docs%rowtype;
  v_found boolean;
  d jsonb;
  v_out jsonb := '[]'::jsonb;
  v_rev bigint;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if me is null or not public.rows_is_management(p_workspace) then
    raise exception 'announcement_write: объявления ведёт руководство' using errcode = '42501';
  end if;
  if p_ops is null or jsonb_typeof(p_ops) <> 'array' then
    raise exception 'announcement_write: ожидается массив' using errcode = '22023';
  end if;
  if jsonb_array_length(p_ops) > 100 then
    raise exception 'announcement_write: не больше 100 записей за раз' using errcode = '22023';
  end if;

  for o in select * from jsonb_array_elements(p_ops) loop
    v_id := o ->> 'id';
    v_op := coalesce(o ->> 'op', 'merge');
    if coalesce(o ->> 'kind', 'ann') <> 'ann' then
      raise exception 'announcement_write: неверный вид' using errcode = '22023';
    end if;
    if v_id is null or v_id !~ '^[A-Za-z0-9_-]+$' or char_length(v_id) > 200 then
      raise exception 'announcement_write: неверный id' using errcode = '22023';
    end if;
    if v_op not in ('merge', 'set', 'delete') then
      raise exception 'announcement_write: неверная операция' using errcode = '22023';
    end if;

    select * into cur from public.announcement_docs a
    where a.workspace_id = p_workspace and a.kind = 'ann' and a.id = v_id
    for update;
    v_found := found and not cur.deleted;

    if v_op = 'delete' then
      if found then
        update public.announcement_docs a set deleted = true
        where a.workspace_id = p_workspace and a.kind = 'ann' and a.id = v_id
        returning a.rev into v_rev;
        v_out := v_out || jsonb_build_array(jsonb_build_object('kind', 'ann', 'id', v_id, 'data', cur.data, 'deleted', true, 'rev', v_rev));
      end if;
      continue;
    end if;

    if coalesce(jsonb_typeof(o -> 'data'), '') <> 'object' then
      raise exception 'announcement_write: нет данных' using errcode = '22023';
    end if;
    if v_op = 'set' or not v_found then
      d := public.nova_jstrip(o -> 'data');
    else
      d := public.nova_jmerge(cur.data, o -> 'data');
    end if;
    d := d || jsonb_build_object('workspaceId', p_workspace, 'id', v_id);
    if not v_found then
      -- Новое: автор — из токена, порядок в ленте — серверное время.
      d := d || jsonb_build_object('authorUid', me, 'serverOrderAt', v_now);
    else
      -- Автор и порядок не меняются правкой.
      d := d || jsonb_build_object('authorUid', cur.data -> 'authorUid', 'serverOrderAt', coalesce(cur.data -> 'serverOrderAt', to_jsonb(v_now)));
    end if;
    if not public.announcement_keys_ok(d) then
      raise exception 'announcement_write: лишнее поле в документе' using errcode = '22023';
    end if;
    if char_length(coalesce(d ->> 'title', '')) > 300 or char_length(coalesce(d ->> 'body', '')) > 20000 then
      raise exception 'announcement_write: слишком длинный текст' using errcode = '22023';
    end if;

    insert into public.announcement_docs (workspace_id, kind, id, deleted, data)
    values (p_workspace, 'ann', v_id, false, d)
    on conflict (workspace_id, kind, id) do update set deleted = false, data = excluded.data
    returning rev into v_rev;
    v_out := v_out || jsonb_build_array(jsonb_build_object('kind', 'ann', 'id', v_id, 'data', d, 'deleted', false, 'rev', v_rev));
  end loop;
  return v_out;
end;
$$;

revoke all on function public.announcement_write(text, jsonb) from public;
grant execute on function public.announcement_write(text, jsonb) to anon, authenticated;

-- Перенос объявлений Firestore-эпохи (руководство). Новый ложится,
-- существующий заменяется только более свежим (updatedAt / createdAt).
create or replace function public.announcement_import(p_workspace text, p_docs jsonb, p_done boolean default false)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  o jsonb;
  v_id text;
  d jsonb;
  cur public.announcement_docs%rowtype;
  n integer := 0;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if not public.rows_is_management(p_workspace) then
    raise exception 'announcement_import: переносит руководство' using errcode = '42501';
  end if;
  if p_docs is not null and jsonb_typeof(p_docs) = 'array' then
    if jsonb_array_length(p_docs) > 1000 then
      raise exception 'announcement_import: не больше 1000 документов за раз' using errcode = '22023';
    end if;
    for o in select * from jsonb_array_elements(p_docs) loop
      v_id := o ->> 'id';
      if v_id is null or v_id !~ '^[A-Za-z0-9_-]+$' or char_length(v_id) > 200 then continue; end if;
      if coalesce(jsonb_typeof(o -> 'data'), '') <> 'object' then continue; end if;
      d := public.nova_jstrip(o -> 'data') || jsonb_build_object('workspaceId', p_workspace, 'id', v_id);
      d := (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) from jsonb_each(d) e
            where public.announcement_keys_ok(jsonb_build_object(e.key, e.value)));
      select * into cur from public.announcement_docs a
      where a.workspace_id = p_workspace and a.kind = 'ann' and a.id = v_id
      for update;
      if found and public.nova_jstamp(cur.data) >= public.nova_jstamp(d) then continue; end if;
      insert into public.announcement_docs (workspace_id, kind, id, deleted, data)
      values (p_workspace, 'ann', v_id, false, d)
      on conflict (workspace_id, kind, id) do update set deleted = false, data = excluded.data;
      n := n + 1;
    end loop;
  end if;
  if p_done then
    insert into public.announcement_docs (workspace_id, kind, id, deleted, data)
    values (p_workspace, 'meta', 'imported', false, jsonb_build_object('at', v_now))
    on conflict (workspace_id, kind, id) do update set
      data = public.announcement_docs.data || jsonb_build_object('tailAt', v_now);
  end if;
  return n;
end;
$$;

revoke all on function public.announcement_import(text, jsonb, boolean) from public;
grant execute on function public.announcement_import(text, jsonb, boolean) to anon, authenticated;

create or replace function public.nova_schema_version() returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select '20261020'::text
$$;

revoke all on function public.nova_schema_version() from public, anon, authenticated;
grant execute on function public.nova_schema_version() to anon, authenticated;
