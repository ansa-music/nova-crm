-- =====================================================================
-- Nova CRM — личная зона стола в Postgres (26.09.2026, фаза 4 переезда с
-- Firestore; условие Nurba — никто не должен заметить перемен). Повторяемый
-- файл.
--
-- personal_docs — подколлекции pages/{p}/personalZones/{uid}/… тем же видом
-- документа (jsonb `data`):
--   kind = 'zone'    — сам документ зоны (id = zone_{стол}_{uid});
--   kind = 'report'  — reports/{id} (месячные отчёты);
--   kind = 'row'     — reports/{id}/rows/{rowId} (parent_id = отчёт);
--   kind = 'finance' / 'note' / 'debt' — finance/notes/debts;
--   kind = 'meta'    — imported_{стол}_{uid}: зона перенесена.
-- Права — копия canUsePersonalZone (firestore.rules): Owner — любая зона;
-- человек — своя зона на своём столе (ответственный, не Тимлид без
-- Технаря), на столе, где он в personalZoneAllowedUsers, и на СВОЁМ столе ОС.
-- Список допущенных — копия `page.personalZoneAllowedUsers` в
-- rows_page_acl.personal_zone_uids (пишет сверка прав, как и остальное).
-- Пишет только personal_write; удаление мягкое. uid/authorId документов
-- ставит база (как требуют правила: они обязаны совпасть с зоной).
-- nova_schema_version() = '20261022'.
-- =====================================================================

alter table public.rows_page_acl add column if not exists personal_zone_uids text[] not null default '{}';

-- Столы, на которых моя СОБСТВЕННАЯ личная зона открыта мне.
create or replace function public.rows_my_personal_pages() returns table (workspace_id text, page_id text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select a.workspace_id, a.page_id
  from public.rows_page_acl a
  join public.rows_members m on m.workspace_id = a.workspace_id and m.uid = public.rows_uid()
  where
    -- Свой стол ОС (и у Тимлида + ОС): ответственный и создатель.
    (a.os_desk and a.responsible_uid = m.uid and a.created_by = m.uid)
    -- isDeskBlocked: Тимлид без Технаря — нет.
    or (not (m.role = 'teamlead' and not ('manager' = any (m.extra_roles)))
      and (a.responsible_uid = m.uid or m.uid = any (a.personal_zone_uids)))
$$;

revoke all on function public.rows_my_personal_pages() from public;
grant execute on function public.rows_my_personal_pages() to anon, authenticated;

create or replace function public.rows_personal_ok(ws text, p_page text, p_zone text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.rows_uid() is not null and (
    ws in (select public.rows_edit_all_workspaces())
    or (p_zone = public.rows_uid()
      and exists (select 1 from public.rows_my_personal_pages() p where p.workspace_id = ws and p.page_id = p_page)))
$$;

revoke all on function public.rows_personal_ok(text, text, text) from public;
grant execute on function public.rows_personal_ok(text, text, text) to anon, authenticated;

create table if not exists public.personal_docs (
  workspace_id text not null references public.rows_workspaces (workspace_id) on delete cascade,
  kind text not null check (kind in ('zone', 'report', 'row', 'finance', 'note', 'debt', 'meta')),
  id text not null,
  page_id text not null,
  zone_uid text not null,
  parent_id text,
  deleted boolean not null default false,
  data jsonb not null,
  rev bigint not null default 0,
  server_at timestamptz not null default now(),
  primary key (workspace_id, kind, id)
);
create index if not exists personal_docs_zone on public.personal_docs (workspace_id, page_id, zone_uid, kind);
create index if not exists personal_docs_rev on public.personal_docs (workspace_id, rev);

drop trigger if exists personal_docs_20_touch on public.personal_docs;
create trigger personal_docs_20_touch before insert or update on public.personal_docs
  for each row execute function public.nova_touch();

alter table public.personal_docs enable row level security;

drop policy if exists personal_docs_read on public.personal_docs;
create policy personal_docs_read on public.personal_docs for select to anon, authenticated
  using (
    workspace_id in (select public.rows_edit_all_workspaces())
    or (zone_uid = (select public.rows_uid())
      and (workspace_id, page_id) in (select p.workspace_id, p.page_id from public.rows_my_personal_pages() p))
  );

revoke all on public.personal_docs from public, anon, authenticated;
grant select on public.personal_docs to anon, authenticated;

-- Документ в том виде, в каком его хранит Firestore, + служебные метки для
-- выборок (_page, _zone, _parent). uid/authorId — от зоны.
create or replace function public.personal_stamp(p_kind text, p_ws text, p_page text, p_zone text, p_parent text, d jsonb)
returns jsonb
language sql immutable
set search_path = public, pg_temp
as $$
  select d
    || jsonb_build_object('_page', p_page, '_zone', p_zone)
    || case when p_parent is not null then jsonb_build_object('_parent', p_parent) else '{}'::jsonb end
    || case p_kind
      when 'zone' then jsonb_build_object('uid', p_zone, 'pageId', p_page, 'workspaceId', p_ws)
      when 'finance' then jsonb_build_object('uid', p_zone)
      when 'debt' then jsonb_build_object('uid', p_zone)
      when 'note' then jsonb_build_object('authorId', p_zone)
      else '{}'::jsonb end
$$;

revoke all on function public.personal_stamp(text, text, text, text, text, jsonb) from public;
grant execute on function public.personal_stamp(text, text, text, text, text, jsonb) to anon, authenticated;

-- Пачка записей. p_ops — массив {page, zone, kind, id, op: merge|set|delete,
-- data, parent}. Возвращает записанные документы.
create or replace function public.personal_write(p_workspace text, p_ops jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  o jsonb;
  v_kind text;
  v_id text;
  v_op text;
  v_page text;
  v_zone text;
  v_parent text;
  cur public.personal_docs%rowtype;
  v_found boolean;
  d jsonb;
  v_out jsonb := '[]'::jsonb;
  v_rev bigint;
begin
  if public.rows_uid() is null then
    raise exception 'personal_write: нет входа' using errcode = '42501';
  end if;
  if p_ops is null or jsonb_typeof(p_ops) <> 'array' then
    raise exception 'personal_write: ожидается массив' using errcode = '22023';
  end if;
  if jsonb_array_length(p_ops) > 300 then
    raise exception 'personal_write: не больше 300 записей за раз' using errcode = '22023';
  end if;

  for o in select * from jsonb_array_elements(p_ops) loop
    v_kind := o ->> 'kind';
    v_id := o ->> 'id';
    v_op := coalesce(o ->> 'op', 'merge');
    v_page := o ->> 'page';
    v_zone := o ->> 'zone';
    v_parent := nullif(o ->> 'parent', '');
    if v_kind is null or v_kind not in ('zone', 'report', 'row', 'finance', 'note', 'debt') then
      raise exception 'personal_write: неверный вид %', v_kind using errcode = '22023';
    end if;
    if v_id is null or v_id !~ '^[A-Za-z0-9_-]+$' or char_length(v_id) > 300 then
      raise exception 'personal_write: неверный id' using errcode = '22023';
    end if;
    if v_op not in ('merge', 'set', 'delete') then
      raise exception 'personal_write: неверная операция' using errcode = '22023';
    end if;
    if v_page is null or v_page = '' or v_zone is null or v_zone = '' then
      raise exception 'personal_write: нет стола или зоны' using errcode = '22023';
    end if;
    if not public.rows_personal_ok(p_workspace, v_page, v_zone) then
      raise exception 'personal_write: личная зона закрыта' using errcode = '42501';
    end if;

    select * into cur from public.personal_docs x
    where x.workspace_id = p_workspace and x.kind = v_kind and x.id = v_id
    for update;
    -- id занят документом ДРУГОЙ зоны — это не мой документ.
    if found and (cur.page_id <> v_page or cur.zone_uid <> v_zone) then
      raise exception 'personal_write: чужой документ' using errcode = '42501';
    end if;
    v_found := found and not cur.deleted;
    if v_kind = 'row' and v_op <> 'delete' and coalesce(v_parent, case when found then cur.parent_id end) is null then
      raise exception 'personal_write: строка отчёта без отчёта' using errcode = '22023';
    end if;

    if v_op = 'delete' then
      if v_found then
        update public.personal_docs x set deleted = true, data = jsonb_build_object('_page', v_page, '_zone', v_zone)
        where x.workspace_id = p_workspace and x.kind = v_kind and x.id = v_id
        returning x.rev into v_rev;
        v_out := v_out || jsonb_build_array(jsonb_build_object('kind', v_kind, 'id', v_id, 'data', jsonb_build_object('_page', v_page, '_zone', v_zone), 'deleted', true, 'rev', v_rev));
        -- Отчёт уходит вместе со строками.
        if v_kind = 'report' then
          update public.personal_docs x set deleted = true, data = jsonb_build_object('_page', v_page, '_zone', v_zone)
          where x.workspace_id = p_workspace and x.kind = 'row' and x.parent_id = v_id
            and x.page_id = v_page and x.zone_uid = v_zone and not x.deleted;
        end if;
      end if;
      continue;
    end if;

    if coalesce(jsonb_typeof(o -> 'data'), '') <> 'object' then
      raise exception 'personal_write: нет данных' using errcode = '22023';
    end if;
    if v_op = 'set' or not v_found then
      d := public.nova_jstrip(o -> 'data');
    else
      d := public.nova_jmerge(cur.data, o -> 'data');
    end if;
    d := public.personal_stamp(v_kind, p_workspace, v_page, v_zone, coalesce(v_parent, case when found then cur.parent_id end), d);
    if pg_column_size(d) > 200000 then
      raise exception 'personal_write: слишком большой документ' using errcode = '22023';
    end if;

    insert into public.personal_docs (workspace_id, kind, id, page_id, zone_uid, parent_id, deleted, data)
    values (p_workspace, v_kind, v_id, v_page, v_zone, coalesce(v_parent, case when found then cur.parent_id end), false, d)
    on conflict (workspace_id, kind, id) do update set deleted = false, data = excluded.data, parent_id = excluded.parent_id
    returning rev into v_rev;
    v_out := v_out || jsonb_build_array(jsonb_build_object('kind', v_kind, 'id', v_id, 'data', d, 'deleted', false, 'rev', v_rev));
  end loop;
  return v_out;
end;
$$;

revoke all on function public.personal_write(text, jsonb) from public;
grant execute on function public.personal_write(text, jsonb) to anon, authenticated;

-- Перенос одной зоны из Firestore (её хозяин или Owner). Новый ложится,
-- существующий заменяется только более свежим. p_done — отметка
-- imported_{стол}_{uid}.
create or replace function public.personal_import(p_workspace text, p_page text, p_zone text, p_docs jsonb, p_done boolean default false)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  o jsonb;
  v_kind text;
  v_id text;
  v_parent text;
  d jsonb;
  cur public.personal_docs%rowtype;
  n integer := 0;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if not public.rows_personal_ok(p_workspace, p_page, p_zone) then
    raise exception 'personal_import: личная зона закрыта' using errcode = '42501';
  end if;
  if p_docs is not null and jsonb_typeof(p_docs) = 'array' then
    if jsonb_array_length(p_docs) > 2000 then
      raise exception 'personal_import: не больше 2000 документов за раз' using errcode = '22023';
    end if;
    for o in select * from jsonb_array_elements(p_docs) loop
      v_kind := o ->> 'kind';
      v_id := o ->> 'id';
      v_parent := nullif(o ->> 'parent', '');
      if v_kind is null or v_kind not in ('zone', 'report', 'row', 'finance', 'note', 'debt') then continue; end if;
      if v_id is null or v_id !~ '^[A-Za-z0-9_-]+$' or char_length(v_id) > 300 then continue; end if;
      if v_kind = 'row' and v_parent is null then continue; end if;
      if coalesce(jsonb_typeof(o -> 'data'), '') <> 'object' then continue; end if;
      d := public.personal_stamp(v_kind, p_workspace, p_page, p_zone, v_parent, public.nova_jstrip(o -> 'data'));
      select * into cur from public.personal_docs x
      where x.workspace_id = p_workspace and x.kind = v_kind and x.id = v_id
      for update;
      if found and (cur.page_id <> p_page or cur.zone_uid <> p_zone) then continue; end if;
      if found and public.nova_jstamp(cur.data) >= public.nova_jstamp(d) then continue; end if;
      insert into public.personal_docs (workspace_id, kind, id, page_id, zone_uid, parent_id, deleted, data)
      values (p_workspace, v_kind, v_id, p_page, p_zone, v_parent, false, d)
      on conflict (workspace_id, kind, id) do update set deleted = false, data = excluded.data, parent_id = excluded.parent_id;
      n := n + 1;
    end loop;
  end if;
  if p_done then
    insert into public.personal_docs (workspace_id, kind, id, page_id, zone_uid, deleted, data)
    values (p_workspace, 'meta', 'imported_' || p_page || '_' || p_zone, p_page, p_zone, false,
      jsonb_build_object('at', v_now, '_page', p_page, '_zone', p_zone))
    on conflict (workspace_id, kind, id) do update set
      data = public.personal_docs.data || jsonb_build_object('tailAt', v_now);
  end if;
  return n;
end;
$$;

revoke all on function public.personal_import(text, text, text, jsonb, boolean) from public;
grant execute on function public.personal_import(text, text, text, jsonb, boolean) to anon, authenticated;

create or replace function public.nova_schema_version() returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select '20261022'::text
$$;

revoke all on function public.nova_schema_version() from public, anon, authenticated;
grant execute on function public.nova_schema_version() to anon, authenticated;
