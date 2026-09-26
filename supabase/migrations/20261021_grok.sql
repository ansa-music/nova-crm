-- =====================================================================
-- Nova CRM — «Грок лимит» в Postgres (26.09.2026, фаза 4 переезда с
-- Firestore; условие Nurba — никто не должен заметить перемен). Повторяемый
-- файл. Идёт ПОСЛЕ 20261020_announcements.sql (rows_is_management).
--
-- grok_docs — пять коллекций Firestore тем же видом документа (jsonb `data`):
--   kind = 'account'  — grokAccounts/{id} (аккаунты Грока);
--   kind = 'app'      — grokAppAccounts/{id} (Хикс, 11 Labs, прочее);
--   kind = 'settings' — grokSettings/access (кто управляет провайдером);
--   kind = 'stub'     — grokAccessStubs/{id} (витрина закрытых, без пароля);
--   kind = 'request'  — grokAccessRequests/{accountId}_{uid};
--   kind = 'meta'     — 'imported': старые документы перенесены.
-- Права — копия правил firestore.rules (canUseGrok, isGrokManager,
-- canGrantGrokApp, canTouchGrokApp, grokProviderChangeOk,
-- grokAppAccessPreserved). В Postgres RLS действует на КАЖДУЮ строку, поэтому
-- выборка всей таблицы технарём закрытых аккаунтов не отдаёт — двух запросов
-- «открытые / мои», как в Firestore, не нужно.
-- Пишет только grok_write (пачкой, одной транзакцией); удаление мягкое, и у
-- удалённой строки данные стираются (пароль не остаётся лежать).
-- grok_ids_head — «какие строки я вижу» (число + md5 id): закрыли аккаунт или
-- сменили управляющих — строка пропадает из выдачи без новой правки, и
-- дельта по rev этого не видит; клиент по смене головы перечитывает всё.
-- nova_schema_version() = '20261021'.
-- =====================================================================

-- Кому открыт «Грок лимит»: участник, кроме чистого ОС (ОС + Технарь — да).
create or replace function public.rows_grok_workspaces() returns setof text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select m.workspace_id from public.rows_members m
  where m.uid = public.rows_uid() and (m.role <> 'os' or 'manager' = any (m.extra_roles))
$$;

revoke all on function public.rows_grok_workspaces() from public;
grant execute on function public.rows_grok_workspaces() to anon, authenticated;

create table if not exists public.grok_docs (
  workspace_id text not null references public.rows_workspaces (workspace_id) on delete cascade,
  kind text not null check (kind in ('account', 'app', 'settings', 'stub', 'request', 'meta')),
  id text not null,
  -- Копии полей документа для прав и фильтров (ставит grok_write).
  provider text,
  restricted boolean not null default false,
  allowed_uids text[] not null default '{}',
  uid text,
  status text,
  deleted boolean not null default false,
  data jsonb not null,
  rev bigint not null default 0,
  server_at timestamptz not null default now(),
  primary key (workspace_id, kind, id)
);
create index if not exists grok_docs_rev on public.grok_docs (workspace_id, rev);

drop trigger if exists grok_docs_20_touch on public.grok_docs;
create trigger grok_docs_20_touch before insert or update on public.grok_docs
  for each row execute function public.nova_touch();

-- Какими провайдерами я управляю (grokSettings/access → managers[provider]).
create or replace function public.grok_my_managed() returns table (workspace_id text, provider text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select g.workspace_id, p.key
  from public.grok_docs g
  cross join lateral jsonb_each(case when jsonb_typeof(g.data -> 'managers') = 'object' then g.data -> 'managers' else '{}'::jsonb end) p
  where g.kind = 'settings' and g.id = 'access' and not g.deleted
    and g.workspace_id in (select public.rows_grok_workspaces())
    and jsonb_typeof(p.value) = 'array'
    and p.value ? public.rows_uid()
$$;

revoke all on function public.grok_my_managed() from public;
grant execute on function public.grok_my_managed() to anon, authenticated;

create or replace function public.grok_can_grant(ws text, p_provider text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.rows_is_owner(ws), false)
    or exists (select 1 from public.grok_my_managed() m where m.workspace_id = ws and m.provider = coalesce(p_provider, 'other'))
$$;

revoke all on function public.grok_can_grant(text, text) from public;
grant execute on function public.grok_can_grant(text, text) to anon, authenticated;

alter table public.grok_docs enable row level security;

drop policy if exists grok_docs_read on public.grok_docs;
create policy grok_docs_read on public.grok_docs for select to anon, authenticated
  using (
    workspace_id in (select public.rows_grok_workspaces())
    and (
      kind in ('account', 'settings', 'stub', 'meta')
      or (kind = 'app' and (
        not restricted
        or workspace_id in (select public.rows_lead_workspaces())
        or (select public.rows_uid()) = any (allowed_uids)
        or (workspace_id, coalesce(provider, 'other')) in (select m.workspace_id, m.provider from public.grok_my_managed() m)))
      or (kind = 'request' and (
        uid = (select public.rows_uid())
        or workspace_id in (select public.rows_owned_workspaces())
        or (workspace_id, coalesce(provider, 'other')) in (select m.workspace_id, m.provider from public.grok_my_managed() m)))
    )
  );

revoke all on public.grok_docs from public, anon, authenticated;
grant select on public.grok_docs to anon, authenticated;

-- «Какие строки я вижу» — под политиками спрашивающего.
create or replace function public.grok_ids_head(p_workspace text) returns text
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select count(*)::text || ':' || coalesce(md5(string_agg(g.kind || '/' || g.id, ',' order by g.kind collate "C", g.id collate "C")), '')
  from public.grok_docs g
  where g.workspace_id = p_workspace and not g.deleted
$$;

revoke all on function public.grok_ids_head(text) from public;
grant execute on function public.grok_ids_head(text) to anon, authenticated;

create or replace function public.grok_keys_ok(p_kind text, d jsonb) returns boolean
language sql immutable
set search_path = public, pg_temp
as $$
  select case p_kind
    when 'settings' then not exists (select 1 from jsonb_object_keys(d) k
      where k <> all (array['workspaceId', 'managers', 'updatedAt', 'updatedBy']))
    when 'stub' then not exists (select 1 from jsonb_object_keys(d) k
      where k <> all (array['workspaceId', 'provider', 'providerOther', 'title', 'updatedAt']))
    when 'request' then not exists (select 1 from jsonb_object_keys(d) k
      where k <> all (array['workspaceId', 'accountId', 'provider', 'uid', 'name', 'accountTitle', 'status', 'createdAt', 'resolvedAt', 'resolvedBy', 'resolvedByName']))
    -- Аккаунты: правила набор ключей не ограничивают — только размер.
    else pg_column_size(d) <= 20000
  end
$$;

revoke all on function public.grok_keys_ok(text, jsonb) from public;
grant execute on function public.grok_keys_ok(text, jsonb) to anon, authenticated;

create or replace function public.grok_text_array(v jsonb) returns text[]
language sql immutable
set search_path = public, pg_temp
as $$
  select case when jsonb_typeof(v) = 'array'
    then coalesce((select array_agg(distinct e) from jsonb_array_elements_text(v) e where e <> ''), '{}')
    else '{}'::text[] end
$$;

revoke all on function public.grok_text_array(jsonb) from public;
grant execute on function public.grok_text_array(jsonb) to anon, authenticated;

-- Пачка записей. p_ops — массив {kind, id, op: merge|set|delete, data}.
-- `data.allowedUids = {"$union": [uid]}` у аккаунта подписки — дописать
-- (arrayUnion Firestore). Возвращает записанные документы.
create or replace function public.grok_write(p_workspace text, p_ops jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  v_lead boolean;
  v_mgmt boolean;
  v_owner boolean;
  o jsonb;
  v_kind text;
  v_id text;
  v_op text;
  cur public.grok_docs%rowtype;
  v_found boolean;
  inc jsonb;
  d jsonb;
  v_provider text;
  v_old_provider text;
  v_restricted boolean;
  v_allowed text[];
  v_out jsonb := '[]'::jsonb;
  v_rev bigint;
begin
  if me is null or p_workspace not in (select public.rows_grok_workspaces()) then
    raise exception 'grok_write: «Грок лимит» закрыт' using errcode = '42501';
  end if;
  if p_ops is null or jsonb_typeof(p_ops) <> 'array' then
    raise exception 'grok_write: ожидается массив' using errcode = '22023';
  end if;
  if jsonb_array_length(p_ops) > 300 then
    raise exception 'grok_write: не больше 300 записей за раз' using errcode = '22023';
  end if;
  v_lead := p_workspace in (select public.rows_lead_workspaces());
  v_mgmt := public.rows_is_management(p_workspace);
  v_owner := coalesce(public.rows_is_owner(p_workspace), false);

  for o in select * from jsonb_array_elements(p_ops) loop
    v_kind := o ->> 'kind';
    v_id := o ->> 'id';
    v_op := coalesce(o ->> 'op', 'merge');
    if v_kind is null or v_kind not in ('account', 'app', 'settings', 'stub', 'request') then
      raise exception 'grok_write: неверный вид %', v_kind using errcode = '22023';
    end if;
    if v_id is null or v_id !~ '^[A-Za-z0-9_-]+$' or char_length(v_id) > 300 then
      raise exception 'grok_write: неверный id' using errcode = '22023';
    end if;
    if v_op not in ('merge', 'set', 'delete') then
      raise exception 'grok_write: неверная операция' using errcode = '22023';
    end if;

    select * into cur from public.grok_docs g
    where g.workspace_id = p_workspace and g.kind = v_kind and g.id = v_id
    for update;
    v_found := found and not cur.deleted;

    -- ---------------- удаление ----------------
    if v_op = 'delete' then
      if not v_found then
        continue;
      end if;
      if v_kind = 'app' and not (not cur.restricted or v_lead or me = any (cur.allowed_uids)
          or public.grok_can_grant(p_workspace, cur.provider)) then
        raise exception 'grok_write: закрытый аккаунт удаляет тот, кому он открыт' using errcode = '42501';
      elsif v_kind = 'settings' and not v_owner then
        raise exception 'grok_write: настройку раздела ведёт Owner' using errcode = '42501';
      elsif v_kind = 'stub' and not public.grok_can_grant(p_workspace, cur.provider) then
        raise exception 'grok_write: витрину ведёт управляющий раздела' using errcode = '42501';
      elsif v_kind = 'request' and not ((cur.uid = me and cur.status = 'pending') or public.grok_can_grant(p_workspace, cur.provider)) then
        raise exception 'grok_write: запрос отзывает сам человек, пока его не рассмотрели' using errcode = '42501';
      end if;
      update public.grok_docs g set deleted = true, data = jsonb_build_object('workspaceId', p_workspace)
      where g.workspace_id = p_workspace and g.kind = v_kind and g.id = v_id
      returning g.rev into v_rev;
      v_out := v_out || jsonb_build_array(jsonb_build_object('kind', v_kind, 'id', v_id, 'data', jsonb_build_object('workspaceId', p_workspace), 'deleted', true, 'rev', v_rev));
      continue;
    end if;

    -- ---------------- запись ----------------
    if coalesce(jsonb_typeof(o -> 'data'), '') <> 'object' then
      raise exception 'grok_write: нет данных' using errcode = '22023';
    end if;
    inc := o -> 'data';
    -- arrayUnion для списка доступа.
    if v_kind = 'app' and jsonb_typeof(inc -> 'allowedUids') = 'object' and inc -> 'allowedUids' ? '$union' then
      inc := jsonb_set(inc, '{allowedUids}', to_jsonb(
        (select coalesce(array_agg(distinct e), '{}') from (
          select unnest(case when v_found then cur.allowed_uids else '{}'::text[] end) e
          union select jsonb_array_elements_text(case when jsonb_typeof(inc -> 'allowedUids' -> '$union') = 'array'
            then inc -> 'allowedUids' -> '$union' else '[]'::jsonb end)) x where e <> '')));
    end if;
    if v_op = 'set' or not v_found then
      d := public.nova_jstrip(inc);
    else
      d := public.nova_jmerge(cur.data, inc);
    end if;
    d := d || jsonb_build_object('workspaceId', p_workspace);

    if v_kind in ('account', 'app') then
      -- Кто правил — всегда я; кто завёл — я (новый) или прежний.
      d := d || jsonb_build_object('updatedByUid', me);
      if v_found then
        d := d || jsonb_build_object('createdBy', coalesce(cur.data -> 'createdBy', to_jsonb(me)));
      else
        d := d || jsonb_build_object('createdBy', me);
      end if;
      -- Ник карточки — только руководство.
      if not v_mgmt then
        if v_found and coalesce(d ->> 'nickname', '') is distinct from coalesce(cur.data ->> 'nickname', '') then
          raise exception 'grok_write: название карточки меняет руководство' using errcode = '42501';
        elsif not v_found and coalesce(d ->> 'nickname', '') <> '' then
          raise exception 'grok_write: название карточки задаёт руководство' using errcode = '42501';
        end if;
      end if;
    end if;

    if v_kind = 'app' then
      v_provider := coalesce(nullif(d ->> 'provider', ''), 'other');
      v_restricted := coalesce(d -> 'restricted' = 'true'::jsonb, false);
      v_allowed := public.grok_text_array(d -> 'allowedUids');
      d := d || jsonb_build_object('restricted', v_restricted, 'allowedUids', to_jsonb(v_allowed), 'provider', v_provider);
      if not v_found then
        if v_restricted and not v_lead and not public.grok_can_grant(p_workspace, v_provider) then
          raise exception 'grok_write: закрытый аккаунт заводит управляющий' using errcode = '42501';
        end if;
      else
        v_old_provider := coalesce(cur.provider, 'other');
        if not (not cur.restricted or v_lead or me = any (cur.allowed_uids) or public.grok_can_grant(p_workspace, v_old_provider)) then
          raise exception 'grok_write: закрытый аккаунт правит тот, кому он открыт' using errcode = '42501';
        end if;
        if v_provider <> v_old_provider and cur.restricted
            and not (public.grok_can_grant(p_workspace, v_old_provider) and public.grok_can_grant(p_workspace, v_provider)) then
          raise exception 'grok_write: провайдера закрытого аккаунта меняет управляющий обоих разделов' using errcode = '42501';
        end if;
        if (v_restricted is distinct from cur.restricted or v_allowed is distinct from cur.allowed_uids)
            and not (public.grok_can_grant(p_workspace, v_old_provider) and public.grok_can_grant(p_workspace, v_provider)) then
          raise exception 'grok_write: доступ к аккаунту меняет управляющий раздела' using errcode = '42501';
        end if;
      end if;
    elsif v_kind = 'settings' then
      if not v_owner or v_id <> 'access' then
        raise exception 'grok_write: настройку раздела ведёт Owner' using errcode = '42501';
      end if;
      v_provider := null;
    elsif v_kind = 'stub' then
      v_provider := coalesce(nullif(d ->> 'provider', ''), 'other');
      if not public.grok_can_grant(p_workspace, v_provider)
          or (v_found and not public.grok_can_grant(p_workspace, cur.provider)) then
        raise exception 'grok_write: витрину ведёт управляющий раздела' using errcode = '42501';
      end if;
    elsif v_kind = 'request' then
      v_provider := coalesce(nullif(d ->> 'provider', ''), 'other');
      if v_found and (d ->> 'uid' is distinct from cur.uid or d ->> 'accountId' is distinct from cur.data ->> 'accountId'
          or v_provider is distinct from cur.provider) then
        raise exception 'grok_write: чей запрос и к какому аккаунту — не меняется' using errcode = '42501';
      end if;
      if not (v_found and public.grok_can_grant(p_workspace, cur.provider)) then
        -- Сам человек: за себя, только «ждёт», id = аккаунт_я, провайдер —
        -- ровно провайдер карточки витрины.
        if d ->> 'uid' is distinct from me or d ->> 'status' is distinct from 'pending'
            or v_id <> coalesce(d ->> 'accountId', '') || '_' || me then
          raise exception 'grok_write: запрос — только за себя и только на рассмотрение' using errcode = '42501';
        end if;
        if not exists (select 1 from public.grok_docs s
            where s.workspace_id = p_workspace and s.kind = 'stub' and s.id = d ->> 'accountId' and not s.deleted
              and coalesce(s.provider, 'other') = v_provider) then
          raise exception 'grok_write: нет такого закрытого аккаунта' using errcode = '42501';
        end if;
      end if;
    end if;

    if not public.grok_keys_ok(v_kind, d) then
      raise exception 'grok_write: лишнее поле или слишком большой документ' using errcode = '22023';
    end if;

    insert into public.grok_docs (workspace_id, kind, id, provider, restricted, allowed_uids, uid, status, deleted, data)
    values (p_workspace, v_kind, v_id, v_provider,
      case when v_kind = 'app' then v_restricted else false end,
      case when v_kind = 'app' then v_allowed else '{}'::text[] end,
      d ->> 'uid', d ->> 'status', false, d)
    on conflict (workspace_id, kind, id) do update set
      provider = excluded.provider, restricted = excluded.restricted, allowed_uids = excluded.allowed_uids,
      uid = excluded.uid, status = excluded.status, deleted = false, data = excluded.data
    returning rev into v_rev;
    v_out := v_out || jsonb_build_array(jsonb_build_object('kind', v_kind, 'id', v_id, 'data', d, 'deleted', false, 'rev', v_rev));
  end loop;
  return v_out;
end;
$$;

revoke all on function public.grok_write(text, jsonb) from public;
grant execute on function public.grok_write(text, jsonb) to anon, authenticated;

-- Перенос документов Firestore-эпохи — только Owner (он один читает все пять
-- коллекций целиком). Новый ложится, существующий заменяется только более
-- свежим (updatedAt / createdAt / resolvedAt).
create or replace function public.grok_import(p_workspace text, p_docs jsonb, p_done boolean default false)
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
  cur public.grok_docs%rowtype;
  n integer := 0;
  v_provider text;
  v_restricted boolean;
  v_allowed text[];
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if not coalesce(public.rows_is_owner(p_workspace), false) then
    raise exception 'grok_import: переносит Owner' using errcode = '42501';
  end if;
  if p_docs is not null and jsonb_typeof(p_docs) = 'array' then
    if jsonb_array_length(p_docs) > 1000 then
      raise exception 'grok_import: не больше 1000 документов за раз' using errcode = '22023';
    end if;
    for o in select * from jsonb_array_elements(p_docs) loop
      v_kind := o ->> 'kind';
      v_id := o ->> 'id';
      if v_kind is null or v_kind not in ('account', 'app', 'settings', 'stub', 'request') then continue; end if;
      if v_id is null or v_id !~ '^[A-Za-z0-9_-]+$' or char_length(v_id) > 300 then continue; end if;
      if coalesce(jsonb_typeof(o -> 'data'), '') <> 'object' then continue; end if;
      d := public.nova_jstrip(o -> 'data') || jsonb_build_object('workspaceId', p_workspace);
      if v_kind in ('settings', 'stub', 'request') then
        d := (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) from jsonb_each(d) e
              where public.grok_keys_ok(v_kind, jsonb_build_object(e.key, e.value)));
      elsif not public.grok_keys_ok(v_kind, d) then
        continue;
      end if;
      v_provider := case when v_kind = 'settings' then null else coalesce(nullif(d ->> 'provider', ''), case when v_kind = 'account' then null else 'other' end) end;
      v_restricted := v_kind = 'app' and coalesce(d -> 'restricted' = 'true'::jsonb, false);
      v_allowed := case when v_kind = 'app' then public.grok_text_array(d -> 'allowedUids') else '{}'::text[] end;
      if v_kind = 'app' then
        d := d || jsonb_build_object('restricted', v_restricted, 'allowedUids', to_jsonb(v_allowed), 'provider', v_provider);
      end if;
      select * into cur from public.grok_docs g
      where g.workspace_id = p_workspace and g.kind = v_kind and g.id = v_id
      for update;
      if found and public.nova_jstamp(cur.data) >= public.nova_jstamp(d) then continue; end if;
      insert into public.grok_docs (workspace_id, kind, id, provider, restricted, allowed_uids, uid, status, deleted, data)
      values (p_workspace, v_kind, v_id, v_provider, v_restricted, v_allowed, d ->> 'uid', d ->> 'status', false, d)
      on conflict (workspace_id, kind, id) do update set
        provider = excluded.provider, restricted = excluded.restricted, allowed_uids = excluded.allowed_uids,
        uid = excluded.uid, status = excluded.status, deleted = false, data = excluded.data;
      n := n + 1;
    end loop;
  end if;
  if p_done then
    insert into public.grok_docs (workspace_id, kind, id, deleted, data)
    values (p_workspace, 'meta', 'imported', false, jsonb_build_object('at', v_now))
    on conflict (workspace_id, kind, id) do update set
      data = public.grok_docs.data || jsonb_build_object('tailAt', v_now);
  end if;
  return n;
end;
$$;

revoke all on function public.grok_import(text, jsonb, boolean) from public;
grant execute on function public.grok_import(text, jsonb, boolean) to anon, authenticated;

create or replace function public.nova_schema_version() returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select '20261021'::text
$$;

revoke all on function public.nova_schema_version() from public, anon, authenticated;
grant execute on function public.nova_schema_version() to anon, authenticated;
