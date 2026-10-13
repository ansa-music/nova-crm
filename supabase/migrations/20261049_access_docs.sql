-- =====================================================================
-- Nova CRM — доступы в Postgres (13.10.2026, переезд с Firestore, этап C;
-- условие Nurba — без потери данных, никто не замечает перемен). Повторяемый
-- файл.
--
-- access_docs — те же документы, что в Firestore, jsonb `data`:
--   viewreq   viewRequests/{id}         — запрос на просмотр стола;
--   observer  deskObservers/{uid}       — «наблюдатель» (тихое право Owner);
--   ownerkey  ownerAccess/key           — ключ доступа (id всегда 'key');
--   ownerreq  ownerAccessRequests/{uid} — заявка по ключу;
--   meta/imported — отметка «старые документы перенесены, читаем отсюда».
--
-- Права — копия правил firestore.rules:
--   viewreq: читают проситель и ответственный; просит участник за себя
--     (ответственный — ИЗ копии прав стола, не со слов клиента; стол «только
--     для Owner» — отказ); решает ответственный, сверх правил — Owner;
--   observer: пишет Owner, читают Owner и сам наблюдатель. Запись заодно
--     ведёт rows_desk_observers — на нём держится чтение строк наблюдателем;
--   ownerkey: только создатель workspace; хеш считает БАЗА (sha256 от
--     «{ws}:{ключ}», как ownerAccessKeyHash на клиенте);
--   ownerreq: подаёт участник за себя с хешем ключа — база сверяет его с
--     ключом создателя (нет своего — с ключом по умолчанию); решает создатель.
-- Пишет только access_write (пачкой, одна транзакция); удаление мягкое,
-- прямой записи нет. Перенос — access_import (Owner).
-- nova_schema_version() = '20261049' (номер — после 20261047_game_scores и
-- 20261048_nick_rename параллельных сессий).
-- =====================================================================

create table if not exists public.access_docs (
  workspace_id text not null references public.rows_workspaces (workspace_id) on delete cascade,
  kind text not null check (kind in ('viewreq', 'observer', 'ownerkey', 'ownerreq', 'meta')),
  id text not null,
  deleted boolean not null default false,
  data jsonb not null,
  rev bigint not null default 0,
  server_at timestamptz not null default now(),
  primary key (workspace_id, kind, id)
);
create index if not exists access_docs_rev on public.access_docs (workspace_id, rev);

drop trigger if exists access_docs_20_touch on public.access_docs;
create trigger access_docs_20_touch before insert or update on public.access_docs
  for each row execute function public.nova_touch();

alter table public.access_docs enable row level security;

drop policy if exists access_docs_read on public.access_docs;
create policy access_docs_read on public.access_docs for select to anon, authenticated
  using (
    (kind = 'meta' and workspace_id in (select public.rows_my_workspaces()))
    or (kind = 'viewreq'
        and workspace_id in (select public.rows_my_workspaces())
        and (data ->> 'fromUid' = public.rows_uid() or data ->> 'toUid' = public.rows_uid()))
    or (kind = 'observer'
        and (coalesce(public.rows_is_owner(workspace_id), false)
             or (id = public.rows_uid() and workspace_id in (select public.rows_my_workspaces()))))
    or (kind = 'ownerkey' and coalesce(public.rows_is_creator(workspace_id), false))
    or (kind = 'ownerreq' and (coalesce(public.rows_is_creator(workspace_id), false) or id = public.rows_uid()))
  );

revoke all on public.access_docs from public, anon, authenticated;
grant select on public.access_docs to anon, authenticated;

-- Какие поля бывают у документа каждого вида (лишнее — отказ, как hasOnly в правилах).
create or replace function public.access_keys_ok(k text, d jsonb) returns boolean
language sql immutable
set search_path = public, pg_temp
as $$
  select not exists (
    select 1 from jsonb_object_keys(d) key
    where key <> all (case k
      when 'viewreq' then array['id', 'workspaceId', 'pageId', 'pageName', 'fromUid', 'fromName', 'toUid', 'status', 'createdAt', 'updatedAt']
      when 'observer' then array['uid', 'label', 'grantedAt', 'grantedBy']
      when 'ownerkey' then array['key', 'hash', 'updatedAt', 'updatedByUid', 'updatedByName']
      when 'ownerreq' then array['id', 'workspaceId', 'fromUid', 'fromName', 'fromEmail', 'status', 'createdAt', 'updatedAt',
                                 'resolvedByUid', 'resolvedByName', 'keyHash', 'grantedRole']
      else array[]::text[] end))
$$;

revoke all on function public.access_keys_ok(text, jsonb) from public;
grant execute on function public.access_keys_ok(text, jsonb) to anon, authenticated;

-- sha256("{ws}:{ключ}") hex — ровно то, что считает клиент (ownerAccessKeyHash).
create or replace function public.access_key_hash(ws text, k text) returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select encode(sha256(convert_to(ws || ':' || k, 'UTF8')), 'hex')
$$;

revoke all on function public.access_key_hash(text, text) from public;
grant execute on function public.access_key_hash(text, text) to anon, authenticated;

-- Подходит ли хеш из заявки: к ключу создателя, а нет своего — к ключу по умолчанию.
create or replace function public.access_key_hash_ok(ws text, h text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(h, '') <> '' and h = coalesce(
    (select d.data ->> 'hash' from public.access_docs d
      where d.workspace_id = ws and d.kind = 'ownerkey' and d.id = 'key' and not d.deleted),
    public.access_key_hash(ws, '21122005'))
$$;

revoke all on function public.access_key_hash_ok(text, text) from public;
grant execute on function public.access_key_hash_ok(text, text) to anon, authenticated;

-- Пачка записей. p_ops — массив {kind, id, op: merge|set|create|delete, data}.
--   viewreq: set/create — подать (своя ожидающая по тому же столу — вернуть её),
--            merge — решить (status/updatedAt), delete — Owner;
--   observer: set — выдать, delete — снять (только Owner);
--   ownerkey: set — сменить ключ (создатель), delete — вернуть ключ по умолчанию;
--   ownerreq: set/create — подать за себя (с keyHash), merge — решить (создатель), delete — создатель.
create or replace function public.access_write(p_workspace text, p_ops jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  v_member boolean;
  v_owner boolean;
  v_creator boolean;
  o jsonb;
  v_kind text;
  v_id text;
  v_op text;
  cur public.access_docs%rowtype;
  v_found boolean;
  d jsonb;
  inc jsonb;
  v_page text;
  v_resp text;
  v_status text;
  v_key text;
  existing public.access_docs%rowtype;
  v_out jsonb := '[]'::jsonb;
  v_rev bigint;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if me is null or p_workspace is null then
    raise exception 'access_write: нужен вход' using errcode = '42501';
  end if;
  v_member := p_workspace in (select public.rows_my_workspaces());
  v_owner := coalesce(public.rows_is_owner(p_workspace), false);
  v_creator := coalesce(public.rows_is_creator(p_workspace), false);
  if not (v_member or v_owner or v_creator) then
    raise exception 'access_write: не участник' using errcode = '42501';
  end if;
  if p_ops is null or jsonb_typeof(p_ops) <> 'array' then
    raise exception 'access_write: ожидается массив' using errcode = '22023';
  end if;
  if jsonb_array_length(p_ops) > 100 then
    raise exception 'access_write: не больше 100 записей за раз' using errcode = '22023';
  end if;

  for o in select * from jsonb_array_elements(p_ops) loop
    v_kind := o ->> 'kind';
    v_id := o ->> 'id';
    v_op := coalesce(o ->> 'op', 'merge');
    if v_kind not in ('viewreq', 'observer', 'ownerkey', 'ownerreq') then
      raise exception 'access_write: неверный вид' using errcode = '22023';
    end if;
    if v_id is null or v_id !~ '^[A-Za-z0-9_-]+$' or char_length(v_id) > 200 then
      raise exception 'access_write: неверный id' using errcode = '22023';
    end if;
    if v_op not in ('merge', 'set', 'create', 'delete') then
      raise exception 'access_write: неверная операция' using errcode = '22023';
    end if;
    if v_kind = 'ownerkey' and v_id <> 'key' then
      raise exception 'access_write: у ключа id всегда key' using errcode = '22023';
    end if;

    select * into cur from public.access_docs a
    where a.workspace_id = p_workspace and a.kind = v_kind and a.id = v_id
    for update;
    v_found := found and not cur.deleted;

    -- Удаление.
    if v_op = 'delete' then
      if (v_kind in ('viewreq', 'observer') and not v_owner)
         or (v_kind in ('ownerkey', 'ownerreq') and not v_creator) then
        raise exception 'access_write: удалять может только Owner' using errcode = '42501';
      end if;
      if found then
        update public.access_docs a set deleted = true
        where a.workspace_id = p_workspace and a.kind = v_kind and a.id = v_id
        returning a.rev into v_rev;
        v_out := v_out || jsonb_build_array(jsonb_build_object('kind', v_kind, 'id', v_id, 'data', cur.data, 'deleted', true, 'rev', v_rev));
      end if;
      if v_kind = 'observer' then
        delete from public.rows_desk_observers r where r.workspace_id = p_workspace and r.uid = v_id;
      end if;
      continue;
    end if;

    if coalesce(jsonb_typeof(o -> 'data'), '') <> 'object' then
      raise exception 'access_write: нет данных' using errcode = '22023';
    end if;
    inc := public.nova_jstrip(o -> 'data');

    if v_kind = 'viewreq' then
      if v_op in ('set', 'create') then
        -- Подать запрос: за себя, ответственный — из копии прав стола.
        if not v_member then
          raise exception 'access_write: просить просмотр может участник' using errcode = '42501';
        end if;
        v_page := inc ->> 'pageId';
        if v_page is null or v_page = '' then
          raise exception 'access_write: какой стол?' using errcode = '22023';
        end if;
        select a.responsible_uid into v_resp from public.rows_page_acl a
        where a.workspace_id = p_workspace and a.page_id = v_page;
        if not found or v_resp is null or v_resp = '' then
          raise exception 'access_write: у стола нет ответственного' using errcode = '22023';
        end if;
        if exists (select 1 from public.rows_owner_only r where r.workspace_id = p_workspace and r.page_id = v_page) then
          raise exception 'access_write: стол открыт только Owner' using errcode = '42501';
        end if;
        -- Уже прошу этот стол — вернуть ту же заявку, второй не заводить.
        select * into existing from public.access_docs a
        where a.workspace_id = p_workspace and a.kind = 'viewreq' and not a.deleted
          and a.data ->> 'fromUid' = me and a.data ->> 'pageId' = v_page and a.data ->> 'status' = 'pending'
        limit 1;
        if found then
          v_out := v_out || jsonb_build_array(jsonb_build_object('kind', 'viewreq', 'id', existing.id, 'data', existing.data, 'deleted', false, 'rev', existing.rev));
          continue;
        end if;
        d := inc || jsonb_build_object(
          'id', v_id, 'workspaceId', p_workspace, 'pageId', v_page,
          'pageName', left(coalesce(inc ->> 'pageName', ''), 200),
          'fromUid', me, 'fromName', left(coalesce(inc ->> 'fromName', ''), 120),
          'toUid', v_resp, 'status', 'pending',
          'createdAt', coalesce(inc -> 'createdAt', to_jsonb(v_now)), 'updatedAt', v_now);
      else
        -- Решить: ответственный (адресат) или Owner, только статус.
        if not v_found then
          raise exception 'access_write: запроса нет' using errcode = '22023';
        end if;
        if not (cur.data ->> 'toUid' = me or v_owner) then
          raise exception 'access_write: решает ответственный за стол' using errcode = '42501';
        end if;
        if exists (select 1 from jsonb_object_keys(inc) k where k not in ('status', 'updatedAt')) then
          raise exception 'access_write: у запроса меняется только статус' using errcode = '22023';
        end if;
        v_status := inc ->> 'status';
        if v_status not in ('approved', 'denied') then
          raise exception 'access_write: неверный статус' using errcode = '22023';
        end if;
        d := cur.data || jsonb_build_object('status', v_status, 'updatedAt', v_now);
      end if;

    elsif v_kind = 'observer' then
      if not v_owner then
        raise exception 'access_write: наблюдателей выдаёт Owner' using errcode = '42501';
      end if;
      d := jsonb_build_object(
        'uid', v_id, 'label', left(coalesce(inc ->> 'label', cur.data ->> 'label', ''), 200),
        'grantedAt', case when v_found then coalesce(cur.data -> 'grantedAt', to_jsonb(v_now)) else to_jsonb(v_now) end,
        'grantedBy', me);
      insert into public.rows_desk_observers (workspace_id, uid) values (p_workspace, v_id)
      on conflict do nothing;

    elsif v_kind = 'ownerkey' then
      if not v_creator then
        raise exception 'access_write: ключ меняет создатель workspace' using errcode = '42501';
      end if;
      v_key := regexp_replace(coalesce(inc ->> 'key', ''), '\s', '', 'g');
      if char_length(v_key) < 4 or char_length(v_key) > 64 then
        raise exception 'access_write: ключ — от 4 до 64 символов' using errcode = '22023';
      end if;
      d := jsonb_build_object(
        'key', v_key, 'hash', public.access_key_hash(p_workspace, v_key),
        'updatedAt', v_now, 'updatedByUid', me, 'updatedByName', left(coalesce(inc ->> 'updatedByName', ''), 120));

    else -- ownerreq
      if v_op in ('set', 'create') then
        -- Подать заявку: только за себя, ключ сверяет база.
        if not v_member or v_id <> me then
          raise exception 'access_write: заявку подают за себя' using errcode = '42501';
        end if;
        if not public.access_key_hash_ok(p_workspace, inc ->> 'keyHash') then
          raise exception 'access_write: неверный ключ доступа' using errcode = '42501';
        end if;
        d := jsonb_build_object(
          'id', me, 'workspaceId', p_workspace, 'fromUid', me,
          'fromName', left(coalesce(inc ->> 'fromName', ''), 120), 'fromEmail', left(coalesce(inc ->> 'fromEmail', ''), 200),
          'status', 'pending',
          'createdAt', case when v_found then coalesce(cur.data -> 'createdAt', to_jsonb(v_now)) else coalesce(inc -> 'createdAt', to_jsonb(v_now)) end,
          'updatedAt', v_now, 'resolvedByUid', null, 'resolvedByName', null,
          'keyHash', inc ->> 'keyHash', 'grantedRole', null);
      else
        if not v_creator then
          raise exception 'access_write: заявки решает создатель workspace' using errcode = '42501';
        end if;
        if not v_found then
          raise exception 'access_write: заявки нет' using errcode = '22023';
        end if;
        if exists (select 1 from jsonb_object_keys(inc) k where k not in ('status', 'updatedAt', 'resolvedByUid', 'resolvedByName', 'grantedRole')) then
          raise exception 'access_write: у заявки меняется только решение' using errcode = '22023';
        end if;
        v_status := inc ->> 'status';
        if v_status not in ('approved', 'denied') then
          raise exception 'access_write: неверный статус' using errcode = '22023';
        end if;
        d := cur.data || inc || jsonb_build_object('status', v_status, 'updatedAt', v_now, 'resolvedByUid', me,
          'grantedRole', case when v_status = 'approved' then coalesce(inc -> 'grantedRole', 'null'::jsonb) else 'null'::jsonb end);
      end if;
    end if;

    if not public.access_keys_ok(v_kind, d) then
      raise exception 'access_write: лишнее поле в документе' using errcode = '22023';
    end if;

    insert into public.access_docs (workspace_id, kind, id, deleted, data)
    values (p_workspace, v_kind, v_id, false, d)
    on conflict (workspace_id, kind, id) do update set deleted = false, data = excluded.data
    returning rev into v_rev;
    v_out := v_out || jsonb_build_array(jsonb_build_object('kind', v_kind, 'id', v_id, 'data', d, 'deleted', false, 'rev', v_rev));
  end loop;
  return v_out;
end;
$$;

revoke all on function public.access_write(text, jsonb) from public;
grant execute on function public.access_write(text, jsonb) to anon, authenticated;

-- Перенос документов Firestore-эпохи (Owner). Новый ложится, существующий
-- заменяется только более свежим (updatedAt / createdAt); наблюдатель заодно
-- попадает в rows_desk_observers.
create or replace function public.access_import(p_workspace text, p_docs jsonb, p_done boolean default false)
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
  cur public.access_docs%rowtype;
  n integer := 0;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if not coalesce(public.rows_is_owner(p_workspace), false) then
    raise exception 'access_import: переносит Owner' using errcode = '42501';
  end if;
  if p_docs is not null and jsonb_typeof(p_docs) = 'array' then
    if jsonb_array_length(p_docs) > 2000 then
      raise exception 'access_import: не больше 2000 документов за раз' using errcode = '22023';
    end if;
    for o in select * from jsonb_array_elements(p_docs) loop
      v_kind := o ->> 'kind';
      v_id := o ->> 'id';
      if v_kind not in ('viewreq', 'observer', 'ownerkey', 'ownerreq') then continue; end if;
      if v_id is null or v_id !~ '^[A-Za-z0-9_-]+$' or char_length(v_id) > 200 then continue; end if;
      if v_kind = 'ownerkey' and v_id <> 'key' then continue; end if;
      if coalesce(jsonb_typeof(o -> 'data'), '') <> 'object' then continue; end if;
      d := public.nova_jstrip(o -> 'data');
      d := (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) from jsonb_each(d) e
            where public.access_keys_ok(v_kind, jsonb_build_object(e.key, e.value)));
      if v_kind in ('viewreq', 'ownerreq') then d := d || jsonb_build_object('workspaceId', p_workspace, 'id', v_id); end if;
      if v_kind = 'observer' then d := d || jsonb_build_object('uid', v_id); end if;
      select * into cur from public.access_docs a
      where a.workspace_id = p_workspace and a.kind = v_kind and a.id = v_id
      for update;
      -- Удалённое в базе не воскрешаем; живое заменяем только более свежим.
      if found and (cur.deleted or public.nova_jstamp(cur.data) >= public.nova_jstamp(d)) then continue; end if;
      insert into public.access_docs (workspace_id, kind, id, deleted, data)
      values (p_workspace, v_kind, v_id, false, d)
      on conflict (workspace_id, kind, id) do update set deleted = false, data = excluded.data;
      if v_kind = 'observer' then
        insert into public.rows_desk_observers (workspace_id, uid) values (p_workspace, v_id) on conflict do nothing;
      end if;
      n := n + 1;
    end loop;
  end if;
  if p_done then
    insert into public.access_docs (workspace_id, kind, id, deleted, data)
    values (p_workspace, 'meta', 'imported', false, jsonb_build_object('at', v_now))
    on conflict (workspace_id, kind, id) do update set
      data = public.access_docs.data || jsonb_build_object('tailAt', v_now);
  end if;
  return n;
end;
$$;

revoke all on function public.access_import(text, jsonb, boolean) from public;
grant execute on function public.access_import(text, jsonb, boolean) to anon, authenticated;

create or replace function public.nova_schema_version() returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select '20261049'
$$;
revoke all on function public.nova_schema_version() from public, anon, authenticated;
grant execute on function public.nova_schema_version() to anon, authenticated;
