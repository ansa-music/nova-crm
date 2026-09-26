-- =====================================================================
-- Nova CRM — «График» в Postgres (26.09.2026, фаза 4 переезда с Firestore;
-- условие Nurba — никто не должен заметить перемен). Повторяемый файл.
--
-- Одна таблица schedule_docs на четыре коллекции Firestore — тем же видом
-- документа (jsonb `data`), что и там, чтобы код графика не менялся:
--   kind = 'month'    — techSchedule/{uid}_{monthKey} (дни, «пришёл», часы);
--   kind = 'template' — scheduleTemplates/week (постоянная неделя);
--   kind = 'group'    — scheduleGroups/custom (свой раздел, подрядчики);
--   kind = 'request'  — scheduleRequests/{uid}_{monthKey}_{день};
--   kind = 'meta'     — служебное: 'imported' — старые документы Firestore
--                       перенесены, клиенты читают отсюда.
-- Читают все участники (`isMember`, как в правилах). Пишет только
-- schedule_write — пачкой, одной транзакцией (как writeBatch): слияние полей
-- как у Firestore `set(..., {merge: true})` (вложенные карты сливаются,
-- {"$del": true} — deleteField()), права — копия правил:
--   month / template / group — руководство или назначенный Owner редактор
--     графика (`scheduleSettings.editors`, копия — rows_workspaces.schedule_editors);
--   request — сам человек за себя и только 'pending' (id = uid_месяц_день),
--     отозвать — пока ждёт; рассматривает редактор.
-- Удаление мягкое (`deleted`) — дельта по rev видит его.
-- schedule_import — перенос документов Firestore-эпохи (только редактор):
-- новый документ ложится, существующий заменяется, только если пришедший
-- свежее (updatedAt / createdAt / resolvedAt).
-- nova_schema_version() = '20261011'.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Редакторы графика — копия workspace.scheduleSettings.editors.
-- ---------------------------------------------------------------------
alter table public.rows_workspaces add column if not exists schedule_editors text[] not null default '{}';

create or replace function public.rows_is_schedule_editor(ws text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.rows_is_owner(ws), false)
    or coalesce(public.rows_is_teamlead(ws), false)
    or (coalesce(public.rows_is_member(ws), false) and exists (
      select 1 from public.rows_workspaces w
      where w.workspace_id = ws and public.rows_uid() = any (w.schedule_editors)))
$$;

revoke all on function public.rows_is_schedule_editor(text) from public;
grant execute on function public.rows_is_schedule_editor(text) to anon, authenticated;

-- Список пишет только Owner (как scheduleSettings в правилах workspace).
create or replace function public.rows_set_schedule_editors(p_workspace text, p_editors text[])
returns boolean
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
begin
  if not coalesce(public.rows_is_owner(p_workspace), false) then
    raise exception 'rows_set_schedule_editors: только Owner' using errcode = '42501';
  end if;
  if cardinality(coalesce(p_editors, '{}')) > 20 then
    raise exception 'rows_set_schedule_editors: не больше 20' using errcode = '22023';
  end if;
  update public.rows_workspaces
     set schedule_editors = (select coalesce(array_agg(distinct e), '{}') from unnest(coalesce(p_editors, '{}')) e
                             where e is not null and e <> '')
   where workspace_id = p_workspace;
  return found;
end;
$$;

revoke all on function public.rows_set_schedule_editors(text, text[]) from public;
grant execute on function public.rows_set_schedule_editors(text, text[]) to anon, authenticated;

create or replace function public.rows_schedule_editors(p_workspace text) returns text[]
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case when coalesce(public.rows_is_member(p_workspace), false) or coalesce(public.rows_is_owner(p_workspace), false)
    then (select w.schedule_editors from public.rows_workspaces w where w.workspace_id = p_workspace) end
$$;

revoke all on function public.rows_schedule_editors(text) from public;
grant execute on function public.rows_schedule_editors(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Слияние как у Firestore merge: карты — рекурсивно, {"$del": true} — удалить.
-- ---------------------------------------------------------------------
create or replace function public.nova_jmerge(a jsonb, b jsonb) returns jsonb
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare
  k text;
  v jsonb;
  r jsonb := case when jsonb_typeof(a) = 'object' then a else '{}'::jsonb end;
begin
  if b is null or jsonb_typeof(b) <> 'object' then
    return r;
  end if;
  for k, v in select * from jsonb_each(b) loop
    if jsonb_typeof(v) = 'object' and v = '{"$del": true}'::jsonb then
      r := r - k;
    elsif jsonb_typeof(v) = 'object' then
      r := jsonb_set(r, array[k], public.nova_jmerge(r -> k, v), true);
    else
      r := jsonb_set(r, array[k], v, true);
    end if;
  end loop;
  return r;
end;
$$;

-- Убрать маркеры удаления из «set» целиком (там удалять нечего).
create or replace function public.nova_jstrip(a jsonb) returns jsonb
language sql immutable
set search_path = public, pg_temp
as $$
  select public.nova_jmerge('{}'::jsonb, a)
$$;

revoke all on function public.nova_jmerge(jsonb, jsonb) from public;
revoke all on function public.nova_jstrip(jsonb) from public;
grant execute on function public.nova_jmerge(jsonb, jsonb) to anon, authenticated;
grant execute on function public.nova_jstrip(jsonb) to anon, authenticated;

-- «Когда документ правили» — для переноса: кто свежее, тот и прав.
create or replace function public.nova_jstamp(d jsonb) returns bigint
language sql immutable
set search_path = public, pg_temp
as $$
  select greatest(
    case when jsonb_typeof(d -> 'updatedAt') = 'number' then (d ->> 'updatedAt')::numeric::bigint else 0 end,
    case when jsonb_typeof(d -> 'createdAt') = 'number' then (d ->> 'createdAt')::numeric::bigint else 0 end,
    case when jsonb_typeof(d -> 'resolvedAt') = 'number' then (d ->> 'resolvedAt')::numeric::bigint else 0 end)
$$;

revoke all on function public.nova_jstamp(jsonb) from public;
grant execute on function public.nova_jstamp(jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Таблица.
-- ---------------------------------------------------------------------
create table if not exists public.schedule_docs (
  workspace_id text not null references public.rows_workspaces (workspace_id) on delete cascade,
  kind text not null check (kind in ('month', 'template', 'group', 'request', 'meta')),
  id text not null,
  -- Копии полей документа для фильтров (ставит schedule_write).
  uid text,
  month_key text,
  status text,
  deleted boolean not null default false,
  data jsonb not null,
  rev bigint not null default 0,
  server_at timestamptz not null default now(),
  primary key (workspace_id, kind, id)
);
create index if not exists schedule_docs_month on public.schedule_docs (workspace_id, kind, month_key);
create index if not exists schedule_docs_status on public.schedule_docs (workspace_id, kind, status);
create index if not exists schedule_docs_rev on public.schedule_docs (workspace_id, rev);

drop trigger if exists schedule_docs_20_touch on public.schedule_docs;
create trigger schedule_docs_20_touch before insert or update on public.schedule_docs
  for each row execute function public.nova_touch();

alter table public.schedule_docs enable row level security;

drop policy if exists schedule_docs_read on public.schedule_docs;
create policy schedule_docs_read on public.schedule_docs for select to anon, authenticated
  using (workspace_id in (select public.rows_my_workspaces()));

revoke all on public.schedule_docs from public, anon, authenticated;
grant select on public.schedule_docs to anon, authenticated;

-- Разрешённые ключи документа по виду — как hasOnly в правилах.
create or replace function public.schedule_keys_ok(p_kind text, d jsonb) returns boolean
language sql immutable
set search_path = public, pg_temp
as $$
  select not exists (
    select 1 from jsonb_object_keys(d) k
    where k <> all (case p_kind
      when 'month' then array['workspaceId', 'uid', 'monthKey', 'days', 'selfWork', 'hours', 'updatedAt', 'updatedBy']
      when 'template' then array['workspaceId', 'people', 'updatedAt', 'updatedBy']
      when 'group' then array['workspaceId', 'name', 'people', 'updatedAt', 'updatedBy']
      when 'request' then array['workspaceId', 'uid', 'name', 'monthKey', 'dayKey', 'status', 'createdAt', 'resolvedAt', 'resolvedBy']
      else array[]::text[] end))
$$;

revoke all on function public.schedule_keys_ok(text, jsonb) from public;
grant execute on function public.schedule_keys_ok(text, jsonb) to anon, authenticated;

-- Пачка записей графика. p_ops — массив {kind, id, op: merge|set|delete, data}.
-- Возвращает записанные документы [{kind, id, data, deleted, rev}].
create or replace function public.schedule_write(p_workspace text, p_ops jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  v_editor boolean;
  o jsonb;
  v_kind text;
  v_id text;
  v_op text;
  cur public.schedule_docs%rowtype;
  v_found boolean;
  d jsonb;
  v_out jsonb := '[]'::jsonb;
  v_rev bigint;
begin
  if me is null or not coalesce(public.rows_is_member(p_workspace), false) then
    raise exception 'schedule_write: не участник workspace' using errcode = '42501';
  end if;
  if p_ops is null or jsonb_typeof(p_ops) <> 'array' then
    raise exception 'schedule_write: ожидается массив' using errcode = '22023';
  end if;
  if jsonb_array_length(p_ops) > 500 then
    raise exception 'schedule_write: не больше 500 записей за раз' using errcode = '22023';
  end if;
  v_editor := public.rows_is_schedule_editor(p_workspace);

  for o in select * from jsonb_array_elements(p_ops) loop
    v_kind := o ->> 'kind';
    v_id := o ->> 'id';
    v_op := coalesce(o ->> 'op', 'merge');
    if v_kind is null or v_kind not in ('month', 'template', 'group', 'request') then
      raise exception 'schedule_write: неверный вид %', v_kind using errcode = '22023';
    end if;
    if v_id is null or v_id !~ '^[A-Za-z0-9_-]+$' or char_length(v_id) > 300 then
      raise exception 'schedule_write: неверный id' using errcode = '22023';
    end if;
    if v_op not in ('merge', 'set', 'delete') then
      raise exception 'schedule_write: неверная операция' using errcode = '22023';
    end if;

    select * into cur from public.schedule_docs s
    where s.workspace_id = p_workspace and s.kind = v_kind and s.id = v_id
    for update;
    v_found := found and not cur.deleted;

    -- Права.
    if v_kind in ('month', 'template', 'group') then
      if not v_editor then
        raise exception 'schedule_write: график ведёт руководство' using errcode = '42501';
      end if;
    elsif not v_editor then
      -- Запрос на отметку: сам человек, за себя, только «на рассмотрении».
      if v_op = 'delete' then
        if not (v_found and cur.uid = me and cur.status = 'pending') then
          raise exception 'schedule_write: отозвать можно только свой запрос, пока его не рассмотрели' using errcode = '42501';
        end if;
      elsif v_found and cur.uid <> me then
        raise exception 'schedule_write: это чужой запрос' using errcode = '42501';
      end if;
    end if;

    if v_op = 'delete' then
      if found then
        update public.schedule_docs s set deleted = true
        where s.workspace_id = p_workspace and s.kind = v_kind and s.id = v_id
        returning s.rev into v_rev;
        v_out := v_out || jsonb_build_array(jsonb_build_object('kind', v_kind, 'id', v_id, 'data', cur.data, 'deleted', true, 'rev', v_rev));
      end if;
      continue;
    end if;

    if coalesce(jsonb_typeof(o -> 'data'), '') <> 'object' then
      raise exception 'schedule_write: нет данных' using errcode = '22023';
    end if;
    if v_op = 'set' or not v_found then
      d := public.nova_jstrip(o -> 'data');
    else
      d := public.nova_jmerge(cur.data, o -> 'data');
    end if;
    d := d || jsonb_build_object('workspaceId', p_workspace);

    if not public.schedule_keys_ok(v_kind, d) then
      raise exception 'schedule_write: лишнее поле в документе' using errcode = '22023';
    end if;
    if v_kind = 'month' and v_id <> coalesce(d ->> 'uid', '') || '_' || coalesce(d ->> 'monthKey', '') then
      raise exception 'schedule_write: id графика — uid_месяц' using errcode = '22023';
    end if;
    if v_kind = 'template' and v_id <> 'week' then
      raise exception 'schedule_write: неделя — только week' using errcode = '22023';
    end if;
    if v_kind = 'request' then
      if v_id <> coalesce(d ->> 'uid', '') || '_' || coalesce(d ->> 'monthKey', '') || '_' || coalesce(d ->> 'dayKey', '') then
        raise exception 'schedule_write: id запроса — uid_месяц_день' using errcode = '22023';
      end if;
      if not v_editor and (d ->> 'uid' is distinct from me or d ->> 'status' is distinct from 'pending') then
        raise exception 'schedule_write: запрос — только за себя и только на рассмотрение' using errcode = '42501';
      end if;
      if v_editor and v_found and cur.uid is distinct from d ->> 'uid' then
        raise exception 'schedule_write: чей запрос — не меняется' using errcode = '42501';
      end if;
    end if;

    insert into public.schedule_docs (workspace_id, kind, id, uid, month_key, status, deleted, data)
    values (p_workspace, v_kind, v_id, d ->> 'uid', d ->> 'monthKey', d ->> 'status', false, d)
    on conflict (workspace_id, kind, id) do update set
      uid = excluded.uid, month_key = excluded.month_key, status = excluded.status,
      deleted = false, data = excluded.data
    returning rev into v_rev;
    v_out := v_out || jsonb_build_array(jsonb_build_object('kind', v_kind, 'id', v_id, 'data', d, 'deleted', false, 'rev', v_rev));
  end loop;
  return v_out;
end;
$$;

revoke all on function public.schedule_write(text, jsonb) from public;
grant execute on function public.schedule_write(text, jsonb) to anon, authenticated;

-- Перенос документов Firestore-эпохи (сессия руководства). p_docs — массив
-- {kind, id, data}. Новый ложится, существующий заменяется только более
-- свежим. p_done — отметить «перенос сделан» (клиенты переходят сюда).
create or replace function public.schedule_import(p_workspace text, p_docs jsonb, p_done boolean default false)
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
  d jsonb;
  cur public.schedule_docs%rowtype;
  n integer := 0;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if not public.rows_is_schedule_editor(p_workspace) then
    raise exception 'schedule_import: переносит руководство' using errcode = '42501';
  end if;
  if p_docs is not null and jsonb_typeof(p_docs) = 'array' then
    if jsonb_array_length(p_docs) > 1000 then
      raise exception 'schedule_import: не больше 1000 документов за раз' using errcode = '22023';
    end if;
    for o in select * from jsonb_array_elements(p_docs) loop
      v_kind := o ->> 'kind';
      v_id := o ->> 'id';
      if v_kind is null or v_kind not in ('month', 'template', 'group', 'request') then continue; end if;
      if v_id is null or v_id !~ '^[A-Za-z0-9_-]+$' or char_length(v_id) > 300 then continue; end if;
      if coalesce(jsonb_typeof(o -> 'data'), '') <> 'object' then continue; end if;
      d := public.nova_jstrip(o -> 'data') || jsonb_build_object('workspaceId', p_workspace);
      -- Старый документ с полем, которого правила уже не знают, — берём без
      -- этого поля, а не пропускаем целиком (иначе у человека пропал бы месяц).
      d := (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) from jsonb_each(d) e
            where public.schedule_keys_ok(v_kind, jsonb_build_object(e.key, e.value)));
      select * into cur from public.schedule_docs s
      where s.workspace_id = p_workspace and s.kind = v_kind and s.id = v_id
      for update;
      if found and public.nova_jstamp(cur.data) >= public.nova_jstamp(d) then continue; end if;
      insert into public.schedule_docs (workspace_id, kind, id, uid, month_key, status, deleted, data)
      values (p_workspace, v_kind, v_id, d ->> 'uid', d ->> 'monthKey', d ->> 'status', false, d)
      on conflict (workspace_id, kind, id) do update set
        uid = excluded.uid, month_key = excluded.month_key, status = excluded.status,
        deleted = false, data = excluded.data;
      n := n + 1;
    end loop;
  end if;
  if p_done then
    insert into public.schedule_docs (workspace_id, kind, id, deleted, data)
    values (p_workspace, 'meta', 'imported', false, jsonb_build_object('at', v_now))
    on conflict (workspace_id, kind, id) do update set
      data = public.schedule_docs.data || jsonb_build_object('tailAt', v_now);
  end if;
  return n;
end;
$$;

revoke all on function public.schedule_import(text, jsonb, boolean) from public;
grant execute on function public.schedule_import(text, jsonb, boolean) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Версия схемы.
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
