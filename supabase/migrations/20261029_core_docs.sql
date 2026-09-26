-- =====================================================================
-- Nova CRM — ядро в Supabase, шаг 1: столы (pages) и вкладки (subpages)
-- (27.09.2026; просьба Nurba «всё в Supabase»). Повторяемый файл.
--
-- Документы столов и вкладок переезжают из Firestore в таблицу core_docs
-- РАЗОВЫМ ПЕРЕНОСОМ (как график): сессия Owner копирует их и ставит отметку
-- meta/imported_page; пока отметки нет — все читают и пишут Firestore.
-- После отметки Supabase — единственное место, где столы и вкладки живут;
-- в Firestore у стола остаётся ТЕНЬ (поля доступа), на которую опираются
-- оставшиеся там правила (viewRequests, deskLoad, leaderboard): её ведёт
-- клиент при создании стола и смене доступа.
--
--   core_docs      — kind: page | subpage | meta; subpage → parent_id = стол;
--   чтение         — RLS: стол читает участник (как isMember), вкладку — кто
--                    видит стол (наборы rows_read_all_workspaces /
--                    rows_readable_pages, они же у строк);
--   запись         — только core_write(ws, ops[]): пачка одной транзакцией,
--                    права — копия firestore.rules для pages/subpages;
--   копия прав     — rows_page_acl обновляет ТРИГГЕР по документу стола
--                    (клиентская сверка становится страховкой);
--   перенос        — core_import (только Owner; существующее заменяется
--                    только более свежим по updatedAt), отметка по p_done.
-- nova_schema_version() = '20261029'.
-- =====================================================================

create table if not exists public.core_docs (
  workspace_id text not null references public.rows_workspaces (workspace_id) on delete cascade,
  kind text not null check (kind in ('page', 'subpage', 'meta')),
  parent_id text not null default '',
  id text not null,
  data jsonb not null default '{}'::jsonb,
  deleted boolean not null default false,
  rev bigint not null default 0,
  server_at timestamptz not null default now(),
  primary key (workspace_id, kind, parent_id, id)
);

create index if not exists core_docs_rev_idx on public.core_docs (workspace_id, rev);

alter table public.core_docs enable row level security;
revoke all on public.core_docs from public, anon, authenticated;
grant select on public.core_docs to anon, authenticated;

drop trigger if exists core_docs_20_touch on public.core_docs;
create trigger core_docs_20_touch
  before insert or update on public.core_docs
  for each row execute function public.nova_touch();

-- ---------------------------------------------------------------------
-- Копия прав стола — из документа стола, триггером. Те же поля, что
-- desiredPageRow в rowAclService.ts.
-- ---------------------------------------------------------------------
create or replace function public.core_docs_acl_sync() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d jsonb := new.data;
  v_os boolean := coalesce((d ->> 'osDesk')::boolean, false);
  keys jsonb;
begin
  if new.kind <> 'page' then
    return new;
  end if;
  if new.deleted then
    delete from public.rows_page_acl a where a.workspace_id = new.workspace_id and a.page_id = new.id;
    return new;
  end if;
  keys := case when v_os then null else d -> 'osFieldKeys' end;
  insert into public.rows_page_acl as a (
    workspace_id, page_id, responsible_uid, created_by, os_desk, allowed_uids, editable_uids,
    os_keys_tab, os_key, os_status_key, personal_zone_uids, updated_at
  ) values (
    new.workspace_id,
    new.id,
    nullif(d ->> 'responsibleUserId', ''),
    nullif(d ->> 'createdBy', ''),
    v_os,
    coalesce((select array_agg(distinct x order by x) from jsonb_array_elements_text(coalesce(d -> 'allowedUsers', '[]'::jsonb)) x), '{}'),
    coalesce((select array_agg(distinct x order by x) from jsonb_array_elements_text(coalesce(d -> 'editableUsers', '[]'::jsonb)) x), '{}'),
    nullif(keys ->> 'tabId', ''),
    nullif(keys ->> 'os', ''),
    nullif(keys ->> 'status', ''),
    coalesce((select array_agg(distinct x order by x) from jsonb_array_elements_text(coalesce(d -> 'personalZoneAllowedUsers', '[]'::jsonb)) x), '{}'),
    (extract(epoch from now()) * 1000)::bigint
  )
  on conflict (workspace_id, page_id) do update set
    responsible_uid = excluded.responsible_uid,
    created_by = excluded.created_by,
    os_desk = excluded.os_desk,
    allowed_uids = excluded.allowed_uids,
    editable_uids = excluded.editable_uids,
    os_keys_tab = excluded.os_keys_tab,
    os_key = excluded.os_key,
    os_status_key = excluded.os_status_key,
    personal_zone_uids = excluded.personal_zone_uids,
    updated_at = excluded.updated_at;
  return new;
end;
$$;

revoke all on function public.core_docs_acl_sync() from public, anon, authenticated;

drop trigger if exists core_docs_30_acl on public.core_docs;
create trigger core_docs_30_acl
  after insert or update on public.core_docs
  for each row execute function public.core_docs_acl_sync();

-- ---------------------------------------------------------------------
-- Чтение.
-- ---------------------------------------------------------------------
drop policy if exists core_docs_read on public.core_docs;
create policy core_docs_read on public.core_docs for select to anon, authenticated
  using (
    case kind
      when 'page' then coalesce(public.rows_is_member(workspace_id), false)
      when 'meta' then coalesce(public.rows_is_member(workspace_id), false)
      when 'subpage' then
        workspace_id in (select public.rows_read_all_workspaces())
        or (workspace_id, parent_id) in (select r.workspace_id, r.page_id from public.rows_readable_pages() r)
      else false
    end
  );

-- ---------------------------------------------------------------------
-- Помощники.
-- ---------------------------------------------------------------------

-- Ключи, чьё значение различается между двумя документами (affectedKeys у Firestore).
create or replace function public.nova_changed_keys(a jsonb, b jsonb) returns text[]
language sql immutable
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(k order by k), '{}')
  from (
    select k from jsonb_object_keys(coalesce(a, '{}'::jsonb)) k
    union
    select k from jsonb_object_keys(coalesce(b, '{}'::jsonb)) k
  ) keys
  where (a -> k) is distinct from (b -> k)
$$;

-- Роль ОС / технаря — основная или вторая (hasRole в правилах).
create or replace function public.rows_has_role(ws text, r text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.rows_members m
    where m.workspace_id = ws and m.uid = public.rows_uid()
      and (m.role = r or r = any(m.extra_roles))
  )
$$;

revoke all on function public.rows_has_role(text, text) from public;
grant execute on function public.rows_has_role(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Запись.
-- ---------------------------------------------------------------------
create or replace function public.core_write(p_workspace text, p_ops jsonb) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  v_owner boolean;
  v_lead boolean;
  v_role text;
  o jsonb;
  v_kind text;
  v_id text;
  v_parent text;
  v_op text;
  sub record;
  cur public.core_docs%rowtype;
  v_found boolean;
  d jsonb;
  v_new jsonb;
  v_changed text[];
  v_out jsonb := '[]'::jsonb;
  v_rev bigint;
  v_can_edit boolean;
  page_os boolean;
  page_resp text;
  n integer;
begin
  if me is null or not coalesce(public.rows_is_member(p_workspace), false) then
    raise exception 'core_write: не участник workspace' using errcode = '42501';
  end if;
  if p_ops is null or jsonb_typeof(p_ops) <> 'array' then
    raise exception 'core_write: ожидается массив' using errcode = '22023';
  end if;
  if jsonb_array_length(p_ops) > 500 then
    raise exception 'core_write: не больше 500 записей за раз' using errcode = '22023';
  end if;
  if p_workspace not in (select public.rows_writable_workspaces()) then
    raise exception 'core_write: хранилище закрыто (перенос, откат или компания не действует)' using errcode = '42501';
  end if;
  v_owner := coalesce(public.rows_is_owner(p_workspace), false);
  v_role := public.rows_member_role(p_workspace);
  v_lead := v_role = 'teamlead';

  for o in select * from jsonb_array_elements(p_ops) loop
    v_kind := o ->> 'kind';
    v_id := o ->> 'id';
    v_op := coalesce(o ->> 'op', 'merge');
    v_parent := case when v_kind = 'subpage' then coalesce(o ->> 'page', '') else '' end;
    if v_kind is null or v_kind not in ('page', 'subpage') then
      raise exception 'core_write: неверный вид %', v_kind using errcode = '22023';
    end if;
    if v_id is null or v_id !~ '^[A-Za-z0-9_.-]+$' or char_length(v_id) > 300 then
      raise exception 'core_write: неверный id' using errcode = '22023';
    end if;
    if v_kind = 'subpage' and (v_parent = '' or v_parent !~ '^[A-Za-z0-9_.-]+$') then
      raise exception 'core_write: у вкладки нет стола' using errcode = '22023';
    end if;
    if v_op not in ('merge', 'set', 'create', 'delete') then
      raise exception 'core_write: неверная операция' using errcode = '22023';
    end if;

    select * into cur from public.core_docs c
    where c.workspace_id = p_workspace and c.kind = v_kind and c.parent_id = v_parent and c.id = v_id
    for update;
    v_found := found and not cur.deleted;

    -- «create» — завести, если нет; есть — вернуть как есть (вкладка месяца
    -- заводится «один раз» из двух вкладок сразу).
    if v_op = 'create' and v_found then
      v_out := v_out || jsonb_build_array(jsonb_build_object('kind', v_kind, 'id', v_id, 'page', v_parent, 'data', cur.data, 'deleted', false, 'rev', cur.rev));
      continue;
    end if;

    if v_op = 'delete' then
      if not v_found then
        continue;
      end if;
      if v_kind = 'page' then
        if not v_owner then
          raise exception 'core_write: удалить стол может только Owner' using errcode = '42501';
        end if;
        -- Вкладки стола — вместе с ним; они же в ответе, чтобы вкладка,
        -- которая удаляла, убрала их с экрана сразу, а не по следующей дельте.
        for sub in
          update public.core_docs c set deleted = true
          where c.workspace_id = p_workspace and c.kind = 'subpage' and c.parent_id = v_id and not c.deleted
          returning c.id, c.data, c.rev
        loop
          v_out := v_out || jsonb_build_array(jsonb_build_object('kind', 'subpage', 'id', sub.id, 'page', v_id, 'data', sub.data, 'deleted', true, 'rev', sub.rev));
        end loop;
      else
        if not (p_workspace in (select public.rows_edit_all_workspaces())
                or (p_workspace, v_parent) in (select e.workspace_id, e.page_id from public.rows_editable_pages() e)) then
          raise exception 'core_write: вкладку удаляет тот, кто правит стол' using errcode = '42501';
        end if;
      end if;
      update public.core_docs c set deleted = true
      where c.workspace_id = p_workspace and c.kind = v_kind and c.parent_id = v_parent and c.id = v_id
      returning c.rev into v_rev;
      v_out := v_out || jsonb_build_array(jsonb_build_object('kind', v_kind, 'id', v_id, 'page', v_parent, 'data', cur.data, 'deleted', true, 'rev', v_rev));
      continue;
    end if;

    if coalesce(jsonb_typeof(o -> 'data'), '') <> 'object' then
      raise exception 'core_write: нет данных' using errcode = '22023';
    end if;
    if v_op in ('set', 'create') or not v_found then
      d := public.nova_jstrip(o -> 'data');
      v_new := d;
    else
      d := o -> 'data';
      v_new := public.nova_jmerge(cur.data, d);
    end if;
    if pg_column_size(v_new) > 1048576 then
      raise exception 'core_write: документ больше 1 МБ' using errcode = '22023';
    end if;
    v_changed := public.nova_changed_keys(case when v_found then cur.data else '{}'::jsonb end, v_new);

    -- ---------------- стол ----------------
    if v_kind = 'page' then
      if not v_found then
        -- Создание: как allow create у pages.
        if coalesce(v_new ->> 'workspaceId', '') <> p_workspace then
          raise exception 'core_write: стол чужого workspace' using errcode = '42501';
        end if;
        if v_owner then
          null;
        elsif coalesce((v_new ->> 'osDesk')::boolean, false) then
          if not (public.rows_has_role(p_workspace, 'os')
                  and v_id = 'osdesk_' || me
                  and v_new ->> 'createdBy' = me
                  and v_new ->> 'responsibleUserId' = me
                  and coalesce(v_new -> 'allowedUsers', '[]'::jsonb) ? me) then
            raise exception 'core_write: стол ОС заводит его ОС под своим id' using errcode = '42501';
          end if;
        elsif v_role = 'admin' then
          if not (v_new ->> 'responsibleUserId' = me and coalesce(v_new -> 'allowedUsers', '[]'::jsonb) ? me) then
            raise exception 'core_write: Admin заводит стол только за себя' using errcode = '42501';
          end if;
        elsif public.rows_has_role(p_workspace, 'manager') then
          if not (v_new ->> 'createdBy' = me and v_new ->> 'responsibleUserId' = me
                  and coalesce(v_new -> 'allowedUsers', '[]'::jsonb) ? me) then
            raise exception 'core_write: технарь заводит стол только за себя' using errcode = '42501';
          end if;
          -- Квота: один живой стол на технаря (managerPageClaims в Firestore).
          select count(*) into n from public.core_docs c
          where c.workspace_id = p_workspace and c.kind = 'page' and not c.deleted
            and c.data ->> 'createdBy' = me
            and coalesce((c.data ->> 'inactive')::boolean, false) = false
            and coalesce((c.data ->> 'osDesk')::boolean, false) = false;
          if n > 0 then
            raise exception 'core_write: у технаря уже есть стол' using errcode = '42501';
          end if;
        else
          raise exception 'core_write: эта роль столы не заводит' using errcode = '42501';
        end if;
      else
        -- Правка существующего стола.
        page_os := coalesce((cur.data ->> 'osDesk')::boolean, false);
        page_resp := cur.data ->> 'responsibleUserId';
        if v_owner then
          null;
        elsif v_lead then
          if not (v_changed <@ array['allowedUsers', 'editableUsers', 'responsibleUserId', 'hiddenByResponsible', 'personalZoneAllowedUsers', 'inactive', 'inactiveAt', 'inactiveBy', 'updatedAt']::text[]) then
            raise exception 'core_write: Тимлид меняет только доступ и статус стола' using errcode = '42501';
          end if;
          if page_os and 'responsibleUserId' = any(v_changed) then
            raise exception 'core_write: ответственного за стол ОС не переназначают' using errcode = '42501';
          end if;
        elsif page_resp is not null and page_resp = me then
          if v_changed && array['responsibleUserId', 'createdBy', 'workspaceId', 'inactive', 'inactiveAt', 'inactiveBy', 'osDesk', 'techEditable']::text[] then
            raise exception 'core_write: ответственный не меняет опорные поля стола' using errcode = '42501';
          end if;
        elsif v_role = 'admin' then
          if page_os or not ('responsibleUserId' = any(v_changed))
             or not (v_changed <@ array['responsibleUserId', 'allowedUsers', 'hiddenByResponsible', 'updatedAt']::text[]) then
            raise exception 'core_write: Admin только переназначает ответственного' using errcode = '42501';
          end if;
        else
          raise exception 'core_write: нет права править этот стол' using errcode = '42501';
        end if;
      end if;
    -- ---------------- вкладка ----------------
    else
      if not exists (select 1 from public.core_docs c where c.workspace_id = p_workspace and c.kind = 'page' and c.id = v_parent and not c.deleted) then
        raise exception 'core_write: стола нет' using errcode = 'P0002';
      end if;
      v_can_edit := p_workspace in (select public.rows_edit_all_workspaces())
        or (p_workspace, v_parent) in (select e.workspace_id, e.page_id from public.rows_editable_pages() e);
      if not v_can_edit then
        raise exception 'core_write: вкладку правит тот, кто правит стол' using errcode = '42501';
      end if;
      if v_found and not v_owner
         and (v_changed && array['pageId', 'workspaceId', 'createdBy', 'personalOwnerUid', 'personalAllowedUsers']::text[]) then
        raise exception 'core_write: опорные поля вкладки меняет Owner' using errcode = '42501';
      end if;
    end if;

    if v_found or (found and cur.deleted) then
      update public.core_docs c set data = v_new, deleted = false
      where c.workspace_id = p_workspace and c.kind = v_kind and c.parent_id = v_parent and c.id = v_id
      returning c.rev into v_rev;
    else
      insert into public.core_docs (workspace_id, kind, parent_id, id, data)
      values (p_workspace, v_kind, v_parent, v_id, v_new)
      returning rev into v_rev;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('kind', v_kind, 'id', v_id, 'page', v_parent, 'data', v_new, 'deleted', false, 'rev', v_rev));
  end loop;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------
-- Перенос (только Owner). Существующий документ заменяется лишь более
-- свежим по updatedAt; удалённый в Supabase не воскрешается.
-- ---------------------------------------------------------------------
create or replace function public.core_import(p_workspace text, p_docs jsonb, p_mark text, p_done boolean) returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  o jsonb;
  v_kind text;
  v_id text;
  v_parent text;
  d jsonb;
  cur public.core_docs%rowtype;
  n integer := 0;
begin
  if me is null or not coalesce(public.rows_is_owner(p_workspace), false) then
    raise exception 'core_import: только Owner' using errcode = '42501';
  end if;
  if p_mark is null or p_mark !~ '^imported_[a-z]+$' then
    raise exception 'core_import: неверная отметка' using errcode = '22023';
  end if;
  for o in select * from jsonb_array_elements(coalesce(p_docs, '[]'::jsonb)) loop
    v_kind := o ->> 'kind';
    v_id := o ->> 'id';
    v_parent := case when v_kind = 'subpage' then coalesce(o ->> 'page', '') else '' end;
    d := o -> 'data';
    if v_kind not in ('page', 'subpage') or v_id is null or v_id !~ '^[A-Za-z0-9_.-]+$' or coalesce(jsonb_typeof(d), '') <> 'object' then
      continue;
    end if;
    if v_kind = 'subpage' and v_parent = '' then
      continue;
    end if;
    select * into cur from public.core_docs c
    where c.workspace_id = p_workspace and c.kind = v_kind and c.parent_id = v_parent and c.id = v_id;
    if found then
      if cur.deleted then
        continue;
      end if;
      if coalesce((d ->> 'updatedAt')::numeric, 0) > coalesce((cur.data ->> 'updatedAt')::numeric, 0) then
        update public.core_docs c set data = d
        where c.workspace_id = p_workspace and c.kind = v_kind and c.parent_id = v_parent and c.id = v_id;
        n := n + 1;
      end if;
    else
      insert into public.core_docs (workspace_id, kind, parent_id, id, data) values (p_workspace, v_kind, v_parent, v_id, d);
      n := n + 1;
    end if;
  end loop;
  -- Отметка: `at` — когда перенос сделан (не меняется), `tailAt` — последняя
  -- дочитка (трое суток после переноса сессия Owner дочитывает правки
  -- вкладок на старом коде).
  if p_done then
    insert into public.core_docs (workspace_id, kind, parent_id, id, data)
    values (p_workspace, 'meta', '', p_mark,
      jsonb_build_object('at', (extract(epoch from now()) * 1000)::bigint, 'tailAt', (extract(epoch from now()) * 1000)::bigint, 'by', me))
    on conflict (workspace_id, kind, parent_id, id) do update
      set data = public.core_docs.data || jsonb_build_object('tailAt', (extract(epoch from now()) * 1000)::bigint), deleted = false;
  end if;
  return n;
end;
$$;

revoke all on function public.core_write(text, jsonb) from public;
revoke all on function public.core_import(text, jsonb, text, boolean) from public;
grant execute on function public.core_write(text, jsonb) to anon, authenticated;
grant execute on function public.core_import(text, jsonb, text, boolean) to anon, authenticated;

create or replace function public.nova_schema_version() returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select '20261029'::text
$$;

revoke all on function public.nova_schema_version() from public, anon, authenticated;
grant execute on function public.nova_schema_version() to anon, authenticated;
