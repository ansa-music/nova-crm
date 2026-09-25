-- =====================================================================
-- Nova CRM — биржа «Заказы» и запросы технарей к ОС в Postgres (26.09.2026,
-- фаза 4 переезда с Firestore; условие Nurba — никто не должен заметить
-- перемен). Повторяемый файл: деплой и «Скопировать SQL» накатывают его
-- заново вместе с соседями.
--
-- А. work_orders — заказы (Firestore `orders`). Весь заказ лежит в `data`
--    (тот же объект WorkOrder, что в Firestore), а столбцы status /
--    created_by / assigned_uid — его копия для фильтров и прав. Читает любой
--    участник (`isMember`). С клиента НИЧЕГО не пишется напрямую: только
--    order_write (SECURITY DEFINER), который повторяет правила Firestore:
--      create  — Owner, Тимлид, любой с ролью ОС; автор — из токена;
--      claim   — Технарь (основная или вторая роль), только свой отклик и
--                только у открытого заказа;
--      scope   — «Свободные / Все»: выдающий у своего; любой ОС — у чужого
--                ОТКРЫТОГО;
--      assign / unassign / cancel / delete — Owner, Тимлид или ОС-автор;
--      take    — назначенный технарь у выданного ему (или выдающий: ОС сам
--                доводит заказ со своего стола);
--      retab   — перенос строки в новый период: назначенный технарь у
--                взятого заказа (или выдающий).
--    Удаление — мягкое (`deleted`): дельта по rev видит его так же, как
--    правку, и экран убирает заказ без полной перечитки.
-- Б. order_requests — запросы технаря к ОС (Firestore `orderRequests`):
--    пишет технарь за себя (order_request_submit), решает ОС заказа или
--    руководство (order_request_resolve), отозвать — технарь, пока не решили,
--    убрать — ОС или Owner (order_request_withdraw; тоже мягко). Читают
--    технарь, ОС и руководство.
-- В. nova_schema_version() = '20261010'.
-- Опирается на rows_* (20260923), rows_my_workspaces / nova_touch (20260927),
-- rows_lead_workspaces (20261008).
-- =====================================================================

-- ---------------------------------------------------------------------
-- А. Заказы.
-- ---------------------------------------------------------------------
create table if not exists public.work_orders (
  workspace_id text not null references public.rows_workspaces (workspace_id) on delete cascade,
  id text not null,
  status text not null check (status in ('open', 'assigned', 'taken', 'cancelled')),
  created_by text not null,
  assigned_uid text,
  deleted boolean not null default false,
  data jsonb not null,
  -- Серверное время, миллисекунды: по нему сортируется история.
  created_at bigint not null,
  updated_at bigint not null,
  rev bigint not null default 0,
  server_at timestamptz not null default now(),
  primary key (workspace_id, id)
);
create index if not exists work_orders_live on public.work_orders (workspace_id, status) where not deleted;
create index if not exists work_orders_history on public.work_orders (workspace_id, created_at desc);
create index if not exists work_orders_rev on public.work_orders (workspace_id, rev);

drop trigger if exists work_orders_20_touch on public.work_orders;
create trigger work_orders_20_touch before insert or update on public.work_orders
  for each row execute function public.nova_touch();

alter table public.work_orders enable row level security;

drop policy if exists work_orders_read on public.work_orders;
create policy work_orders_read on public.work_orders for select to anon, authenticated
  using (workspace_id in (select public.rows_my_workspaces()));
-- Вставки, правки и удаления с клиента нет: только order_write.

revoke all on public.work_orders from public, anon, authenticated;
grant select on public.work_orders to anon, authenticated;

-- Короткая строка из jsonb: только строка, обрезанная; иначе значение по умолчанию.
create or replace function public.nova_jtext(p jsonb, p_key text, p_max int, p_default text default '')
returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select case when jsonb_typeof(p -> p_key) = 'string' then left(p ->> p_key, p_max) else p_default end
$$;

-- Число из jsonb или null.
create or replace function public.nova_jnum(p jsonb, p_key text)
returns jsonb
language sql immutable
set search_path = public, pg_temp
as $$
  select case when jsonb_typeof(p -> p_key) = 'number' then p -> p_key else 'null'::jsonb end
$$;

revoke all on function public.nova_jtext(jsonb, text, int, text) from public;
revoke all on function public.nova_jnum(jsonb, text) from public;
grant execute on function public.nova_jtext(jsonb, text, int, text) to anon, authenticated;
grant execute on function public.nova_jnum(jsonb, text) to anon, authenticated;

-- Любая операция с заказом. Возвращает заказ целиком (объект WorkOrder) с
-- полями `rev` и `deleted` — клиент кладёт его на экран сразу, не дожидаясь
-- звонка.
create or replace function public.order_write(p_workspace text, p_id text, p_op text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_full boolean;
  v_issue boolean;
  r public.work_orders%rowtype;
  d jsonb;
  v_scope text;
  v_src jsonb;
  v_name text;
  v_rev bigint;
begin
  if me is null or not coalesce(public.rows_is_member(p_workspace), false) then
    raise exception 'order_write: не участник workspace' using errcode = '42501';
  end if;
  if p_id is null or p_id !~ '^[A-Za-z0-9_-]{1,100}$' then
    raise exception 'order_write: неверный id заказа' using errcode = '22023';
  end if;
  if p_args is null or coalesce(jsonb_typeof(p_args), '') <> 'object' then
    p_args := '{}'::jsonb;
  end if;
  v_full := coalesce(public.rows_is_owner(p_workspace), false) or coalesce(public.rows_is_teamlead(p_workspace), false);
  v_issue := v_full or coalesce(public.rows_has_role(p_workspace, 'os'), false);

  -- --- Новый заказ ---------------------------------------------------
  if p_op = 'create' then
    if not v_issue then
      raise exception 'order_write: заказы выдают Owner, Тимлид и ОС' using errcode = '42501';
    end if;
    select * into r from public.work_orders o where o.workspace_id = p_workspace and o.id = p_id;
    if found then
      -- Повтор той же записи (сбой ответа) — тот же заказ; чужой id — отказ.
      if r.created_by <> me then
        raise exception 'order_write: такой заказ уже есть' using errcode = '42501';
      end if;
      return r.data || jsonb_build_object('rev', r.rev, 'deleted', r.deleted);
    end if;
    v_scope := coalesce(p_args ->> 'claimScope', 'free');
    if v_scope not in ('free', 'all') then
      raise exception 'order_write: claimScope — только free или all' using errcode = '22023';
    end if;
    v_src := null;
    if jsonb_typeof(p_args -> 'osSource') = 'object'
       and jsonb_typeof(p_args -> 'osSource' -> 'pageId') = 'string'
       and jsonb_typeof(p_args -> 'osSource' -> 'rowId') = 'string' then
      v_src := jsonb_build_object(
        'pageId', left(p_args -> 'osSource' ->> 'pageId', 200),
        'tabId', case when jsonb_typeof(p_args -> 'osSource' -> 'tabId') = 'string'
                      then to_jsonb(left(p_args -> 'osSource' ->> 'tabId', 200)) else 'null'::jsonb end,
        'rowId', left(p_args -> 'osSource' ->> 'rowId', 200));
    end if;
    d := jsonb_build_object(
      'id', p_id,
      'workspaceId', p_workspace,
      'client', public.nova_jtext(p_args, 'client', 300),
      'phone', public.nova_jtext(p_args, 'phone', 64),
      'link', public.nova_jtext(p_args, 'link', 2000),
      'deadline', public.nova_jnum(p_args, 'deadline'),
      'urgency', case when p_args ->> 'urgency' in ('fire', 'urgent', 'normal') then p_args ->> 'urgency' else 'normal' end,
      'price', public.nova_jnum(p_args, 'price'),
      'persons', public.nova_jnum(p_args, 'persons'),
      'minutes', public.nova_jnum(p_args, 'minutes'),
      'note', public.nova_jtext(p_args, 'note', 2000),
      'osValue', public.nova_jtext(p_args, 'osValue', 200),
      'osLabel', public.nova_jtext(p_args, 'osLabel', 200),
      'createdBy', me,
      'createdByName', public.nova_jtext(p_args, 'createdByName', 200),
      'status', 'open',
      'claims', '{}'::jsonb,
      'assignedUid', null, 'assignedName', null, 'assignedAt', null, 'assignedBy', null,
      'takenAt', null, 'takenPageId', null, 'takenSubPageId', null, 'takenRowId', null,
      'cancelledAt', null,
      'claimScope', v_scope,
      'createdAt', v_now,
      'updatedAt', v_now);
    if v_src is not null then
      d := d || jsonb_build_object('osSource', v_src);
    end if;
    insert into public.work_orders (workspace_id, id, status, created_by, assigned_uid, data, created_at, updated_at)
    values (p_workspace, p_id, 'open', me, null, d, v_now, v_now)
    returning rev into v_rev;
    return d || jsonb_build_object('rev', v_rev, 'deleted', false);
  end if;

  -- --- Операции над существующим заказом -----------------------------
  select * into r from public.work_orders o
  where o.workspace_id = p_workspace and o.id = p_id
  for update;
  if not found or r.deleted then
    raise exception 'order_write: заказа нет' using errcode = 'P0002';
  end if;
  d := r.data;

  if p_op = 'claim' then
    if not coalesce(public.rows_has_role(p_workspace, 'manager'), false) then
      raise exception 'order_write: откликаются технари' using errcode = '42501';
    end if;
    if r.status <> 'open' then
      raise exception 'order_write: отклик — только у открытого заказа' using errcode = '42501';
    end if;
    if coalesce((p_args ->> 'on')::boolean, true) then
      v_name := public.nova_jtext(p_args, 'name', 200);
      d := jsonb_set(d, '{claims}', coalesce(d -> 'claims', '{}'::jsonb)
        || jsonb_build_object(me, jsonb_build_object('uid', me, 'name', v_name, 'at', v_now)));
    else
      d := jsonb_set(d, '{claims}', coalesce(d -> 'claims', '{}'::jsonb) - me);
    end if;

  elsif p_op = 'scope' then
    v_scope := p_args ->> 'scope';
    if v_scope is null or v_scope not in ('free', 'all') then
      raise exception 'order_write: claimScope — только free или all' using errcode = '22023';
    end if;
    if not (v_full or (v_issue and (r.created_by = me or r.status = 'open'))) then
      raise exception 'order_write: «Свободные / Все» у чужого — только у открытого заказа' using errcode = '42501';
    end if;
    d := d || jsonb_build_object('claimScope', v_scope);

  elsif p_op in ('assign', 'unassign', 'cancel', 'delete') then
    if not (v_full or (v_issue and r.created_by = me)) then
      raise exception 'order_write: заказом распоряжаются его ОС, Тимлид и Owner' using errcode = '42501';
    end if;
    if p_op = 'assign' then
      if coalesce(jsonb_typeof(p_args -> 'uid'), '') <> 'string' or (p_args ->> 'uid') = '' then
        raise exception 'order_write: кому выдать?' using errcode = '22023';
      end if;
      d := d || jsonb_build_object(
        'status', 'assigned',
        'assignedUid', left(p_args ->> 'uid', 200),
        'assignedName', public.nova_jtext(p_args, 'name', 200),
        'assignedAt', v_now,
        'assignedBy', me);
    elsif p_op = 'unassign' then
      d := d || jsonb_build_object('status', 'open', 'assignedUid', null, 'assignedName', null,
        'assignedAt', null, 'assignedBy', null);
    elsif p_op = 'cancel' then
      if coalesce((p_args ->> 'cancelled')::boolean, true) then
        d := d || jsonb_build_object('status', 'cancelled', 'cancelledAt', v_now);
      else
        d := d || jsonb_build_object('status', 'open', 'cancelledAt', null);
      end if;
      d := d || jsonb_build_object('assignedUid', null, 'assignedName', null, 'assignedAt', null, 'assignedBy', null);
    else
      update public.work_orders o set deleted = true, updated_at = v_now,
        data = d || jsonb_build_object('updatedAt', v_now)
      where o.workspace_id = p_workspace and o.id = p_id
      returning * into r;
      return r.data || jsonb_build_object('rev', r.rev, 'deleted', true);
    end if;

  elsif p_op = 'take' then
    if not ((r.assigned_uid = me and r.status = 'assigned')
            or (v_full or (v_issue and r.created_by = me))) then
      raise exception 'order_write: забрать в стол может тот, кому заказ выдан' using errcode = '42501';
    end if;
    if coalesce(jsonb_typeof(p_args -> 'pageId'), '') <> 'string' or coalesce(jsonb_typeof(p_args -> 'rowId'), '') <> 'string' then
      raise exception 'order_write: куда забрали?' using errcode = '22023';
    end if;
    d := d || jsonb_build_object(
      'status', 'taken',
      'takenAt', v_now,
      'takenPageId', left(p_args ->> 'pageId', 200),
      'takenSubPageId', case when jsonb_typeof(p_args -> 'subPageId') = 'string'
                             then to_jsonb(left(p_args ->> 'subPageId', 200)) else 'null'::jsonb end,
      'takenRowId', left(p_args ->> 'rowId', 200));

  elsif p_op = 'retab' then
    if not ((r.assigned_uid = me and r.status = 'taken')
            or (v_full or (v_issue and r.created_by = me))) then
      raise exception 'order_write: адрес строки меняет тот, у кого заказ в столе' using errcode = '42501';
    end if;
    if coalesce(jsonb_typeof(p_args -> 'rowId'), '') <> 'string' then
      raise exception 'order_write: какая строка?' using errcode = '22023';
    end if;
    d := d || jsonb_build_object(
      'takenSubPageId', case when jsonb_typeof(p_args -> 'subPageId') = 'string'
                             then to_jsonb(left(p_args ->> 'subPageId', 200)) else 'null'::jsonb end,
      'takenRowId', left(p_args ->> 'rowId', 200));

  else
    raise exception 'order_write: неизвестная операция %', p_op using errcode = '22023';
  end if;

  d := d || jsonb_build_object('updatedAt', v_now);
  update public.work_orders o set
    data = d,
    status = d ->> 'status',
    assigned_uid = d ->> 'assignedUid',
    updated_at = v_now
  where o.workspace_id = p_workspace and o.id = p_id
  returning * into r;
  return r.data || jsonb_build_object('rev', r.rev, 'deleted', r.deleted);
end;
$$;

revoke all on function public.order_write(text, text, text, jsonb) from public;
grant execute on function public.order_write(text, text, text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Б. Запросы технаря к ОС.
-- ---------------------------------------------------------------------
create table if not exists public.order_requests (
  workspace_id text not null references public.rows_workspaces (workspace_id) on delete cascade,
  id text not null,
  tech_uid text not null,
  os_uid text not null,
  state text not null check (state in ('pending', 'approved', 'rejected')),
  deleted boolean not null default false,
  data jsonb not null,
  created_at bigint not null,
  rev bigint not null default 0,
  server_at timestamptz not null default now(),
  primary key (workspace_id, id)
);
create index if not exists order_requests_os on public.order_requests (workspace_id, os_uid, state);
create index if not exists order_requests_tech on public.order_requests (workspace_id, tech_uid, state);
create index if not exists order_requests_rev on public.order_requests (workspace_id, rev);

drop trigger if exists order_requests_20_touch on public.order_requests;
create trigger order_requests_20_touch before insert or update on public.order_requests
  for each row execute function public.nova_touch();

alter table public.order_requests enable row level security;

drop policy if exists order_requests_read on public.order_requests;
create policy order_requests_read on public.order_requests for select to anon, authenticated
  using (
    workspace_id in (select public.rows_my_workspaces())
    and (
      tech_uid = (select public.rows_uid())
      or os_uid = (select public.rows_uid())
      or workspace_id in (select public.rows_lead_workspaces())
    )
  );

revoke all on public.order_requests from public, anon, authenticated;
grant select on public.order_requests to anon, authenticated;

-- Просьба технаря (и повтор после решения — тот же id).
create or replace function public.order_request_submit(p_workspace text, p_req jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_id text;
  v_os text;
  v_kind text;
  r public.order_requests%rowtype;
  d jsonb;
begin
  if me is null or not coalesce(public.rows_is_member(p_workspace), false) then
    raise exception 'order_request_submit: не участник workspace' using errcode = '42501';
  end if;
  if p_req is null or coalesce(jsonb_typeof(p_req), '') <> 'object' then
    raise exception 'order_request_submit: запрос должен быть объектом' using errcode = '22023';
  end if;
  v_id := p_req ->> 'id';
  if v_id is null or v_id !~ '^[A-Za-z0-9_-]+$' or char_length(v_id) > 300 then
    raise exception 'order_request_submit: неверный id' using errcode = '22023';
  end if;
  v_kind := p_req ->> 'kind';
  if v_kind is null or v_kind not in ('delete', 'status') then
    raise exception 'order_request_submit: неверный вид' using errcode = '22023';
  end if;
  v_os := p_req ->> 'osUid';
  if coalesce(jsonb_typeof(p_req -> 'osUid'), '') <> 'string' or v_os = '' or v_os = me then
    raise exception 'order_request_submit: просьба уходит ОС заказа, не себе' using errcode = '42501';
  end if;
  if jsonb_typeof(p_req -> 'note') = 'string' and char_length(p_req ->> 'note') > 300 then
    raise exception 'order_request_submit: примечание — до 300 символов' using errcode = '22023';
  end if;
  select * into r from public.order_requests q where q.workspace_id = p_workspace and q.id = v_id for update;
  if found and r.tech_uid <> me then
    raise exception 'order_request_submit: это чужая просьба' using errcode = '42501';
  end if;
  d := jsonb_build_object(
    'id', v_id,
    'workspaceId', p_workspace,
    'kind', v_kind,
    'status', case when jsonb_typeof(p_req -> 'status') = 'string' then to_jsonb(left(p_req ->> 'status', 200)) else 'null'::jsonb end,
    'statusLabel', case when jsonb_typeof(p_req -> 'statusLabel') = 'string' then to_jsonb(left(p_req ->> 'statusLabel', 200)) else 'null'::jsonb end,
    'note', public.nova_jtext(p_req, 'note', 300),
    'techUid', me,
    'techName', public.nova_jtext(p_req, 'techName', 200),
    'osUid', v_os,
    'client', public.nova_jtext(p_req, 'client', 300),
    'deskPageId', public.nova_jtext(p_req, 'deskPageId', 200),
    'deskTabId', case when jsonb_typeof(p_req -> 'deskTabId') = 'string' then to_jsonb(left(p_req ->> 'deskTabId', 200)) else 'null'::jsonb end,
    'rowId', public.nova_jtext(p_req, 'rowId', 200),
    'srcPageId', public.nova_jtext(p_req, 'srcPageId', 200),
    'srcTabId', case when jsonb_typeof(p_req -> 'srcTabId') = 'string' then to_jsonb(left(p_req ->> 'srcTabId', 200)) else 'null'::jsonb end,
    'srcRowId', public.nova_jtext(p_req, 'srcRowId', 200),
    'state', 'pending',
    'createdAt', v_now,
    'resolvedAt', null,
    'resolvedBy', null);
  insert into public.order_requests (workspace_id, id, tech_uid, os_uid, state, deleted, data, created_at)
  values (p_workspace, v_id, me, v_os, 'pending', false, d, v_now)
  on conflict (workspace_id, id) do update set
    tech_uid = excluded.tech_uid, os_uid = excluded.os_uid, state = 'pending', deleted = false,
    data = excluded.data, created_at = excluded.created_at
  returning * into r;
  return r.data || jsonb_build_object('rev', r.rev, 'deleted', false);
end;
$$;

revoke all on function public.order_request_submit(text, jsonb) from public;
grant execute on function public.order_request_submit(text, jsonb) to anon, authenticated;

-- Решение: ОС этого заказа или руководство, один раз.
create or replace function public.order_request_resolve(p_workspace text, p_id text, p_approved boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  r public.order_requests%rowtype;
  v_state text := case when p_approved then 'approved' else 'rejected' end;
begin
  if me is null or not coalesce(public.rows_is_member(p_workspace), false) then
    raise exception 'order_request_resolve: не участник workspace' using errcode = '42501';
  end if;
  select * into r from public.order_requests q where q.workspace_id = p_workspace and q.id = p_id for update;
  if not found or r.deleted then
    raise exception 'order_request_resolve: просьбы нет' using errcode = 'P0002';
  end if;
  if not (r.os_uid = me or coalesce(public.rows_is_owner(p_workspace), false) or coalesce(public.rows_is_teamlead(p_workspace), false)) then
    raise exception 'order_request_resolve: решает ОС заказа или руководство' using errcode = '42501';
  end if;
  if r.state <> 'pending' then
    raise exception 'order_request_resolve: просьба уже рассмотрена' using errcode = '42501';
  end if;
  update public.order_requests q set state = v_state,
    data = q.data || jsonb_build_object('state', v_state, 'resolvedAt', v_now, 'resolvedBy', me)
  where q.workspace_id = p_workspace and q.id = p_id
  returning * into r;
  return r.data || jsonb_build_object('rev', r.rev, 'deleted', false);
end;
$$;

revoke all on function public.order_request_resolve(text, text, boolean) from public;
grant execute on function public.order_request_resolve(text, text, boolean) to anon, authenticated;

-- Отозвать (технарь, пока не решили) или убрать (ОС заказа, Owner). Мягко.
create or replace function public.order_request_withdraw(p_workspace text, p_id text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  r public.order_requests%rowtype;
begin
  if me is null or not coalesce(public.rows_is_member(p_workspace), false) then
    raise exception 'order_request_withdraw: не участник workspace' using errcode = '42501';
  end if;
  select * into r from public.order_requests q where q.workspace_id = p_workspace and q.id = p_id for update;
  if not found or r.deleted then
    return false;
  end if;
  if not ((r.tech_uid = me and r.state = 'pending') or r.os_uid = me or coalesce(public.rows_is_owner(p_workspace), false)) then
    raise exception 'order_request_withdraw: отозвать может технарь (пока не решили), убрать — ОС или Owner' using errcode = '42501';
  end if;
  update public.order_requests q set deleted = true where q.workspace_id = p_workspace and q.id = p_id;
  return true;
end;
$$;

revoke all on function public.order_request_withdraw(text, text) from public;
grant execute on function public.order_request_withdraw(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- В. Версия схемы.
-- ---------------------------------------------------------------------
create or replace function public.nova_schema_version() returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select '20261010'::text
$$;

revoke all on function public.nova_schema_version() from public, anon, authenticated;
grant execute on function public.nova_schema_version() to anon, authenticated;
