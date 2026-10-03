-- 20261044 — «Рандом»: шансы закрыты от всех, кроме Owner; розыгрыш на сервере;
-- барабан видят все, кто сейчас на сайте; Owner (стол технаря) откликается.
--
-- Просьба Nurba 03.10.2026: «это все настройки только у Owner, никто другой не
-- должен про них знать» и «при прокрутке рулетки все видели эту рулетку, если
-- на сайте; если не на сайте — не видят».
--
-- 1. random_settings — шансы «Рандома» (раньше workspace.randomSettings — его
--    читали все участники). Таблица закрыта API-ролям целиком; читает и пишет
--    только Owner функциями random_settings_get / random_settings_set.
-- 2. random_draw — бросок на СЕРВЕРЕ: выдающий (Owner, Тимлид/Тимлид+, ОС)
--    присылает пул (uid, подпись, заказов за период) и сумму чека, база по
--    скрытым шансам выбирает победителя и пишет «спин» в random_spins. Кто ×0 —
--    просто не выигрывает: колесо у всех то же, о шансах не узнать.
-- 3. random_spin_latest — последний спин и его возраст по часам базы: вкладки,
--    услышав звонок nova:{ws}:wheel, показывают барабан, только если спину
--    меньше 15 секунд. Закрытый сайт ничего не догоняет — звонок не хранится.
-- 4. order_write — полная копия из 20261010 с одной правкой: откликаться
--    (claim) может и Owner (его стол — стол технаря). Правки order_write —
--    только в этом файле или новее.

create table if not exists public.random_settings (
  workspace_id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);
revoke all on table public.random_settings from public, anon, authenticated;

create table if not exists public.random_spins (
  workspace_id text not null,
  id text not null,
  order_id text,
  title text,
  pool jsonb not null,
  winner_uid text not null,
  by_uid text,
  by_name text,
  created_at timestamptz not null default now(),
  primary key (workspace_id, id)
);
create index if not exists random_spins_ws_created on public.random_spins (workspace_id, created_at desc);
revoke all on table public.random_spins from public, anon, authenticated;

create or replace function public.random_settings_get(p_workspace text) returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  if not coalesce(public.rows_is_owner(p_workspace), false) then
    raise exception 'random_settings: шансы видит только Owner' using errcode = '42501';
  end if;
  select s.data into v from public.random_settings s where s.workspace_id = p_workspace;
  return jsonb_build_object('data', coalesce(v, '{}'::jsonb), 'exists', v is not null);
end;
$$;
revoke all on function public.random_settings_get(text) from public;
grant execute on function public.random_settings_get(text) to anon, authenticated;

create or replace function public.random_settings_set(p_workspace text, p_data jsonb) returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
begin
  if not coalesce(public.rows_is_owner(p_workspace), false) then
    raise exception 'random_settings: шансы правит только Owner' using errcode = '42501';
  end if;
  if p_data is null or coalesce(jsonb_typeof(p_data), '') <> 'object' then
    raise exception 'random_settings: ожидался объект' using errcode = '22023';
  end if;
  if length(p_data::text) > 65536 then
    raise exception 'random_settings: слишком большая настройка' using errcode = '22023';
  end if;
  insert into public.random_settings (workspace_id, data, updated_at, updated_by)
  values (p_workspace, p_data, now(), public.rows_uid())
  on conflict (workspace_id) do update
    set data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  return p_data;
end;
$$;
revoke all on function public.random_settings_set(text, jsonb) from public;
grant execute on function public.random_settings_set(text, jsonb) to anon, authenticated;

-- Множитель из настройки: число 0..3, всё остальное — 1.
create or replace function public.random_mult(v jsonb) returns numeric
language sql immutable
set search_path = public, pg_temp
as $$
  select case
    when v is null or coalesce(jsonb_typeof(v), '') <> 'number' then 1::numeric
    else least(3::numeric, greatest(0::numeric, (v #>> '{}')::numeric))
  end
$$;
revoke all on function public.random_mult(jsonb) from public, anon, authenticated;

create or replace function public.random_draw(
  p_workspace text,
  p_order_id text,
  p_title text,
  p_pool jsonb,
  p_check numeric,
  p_by_name text
) returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  s jsonb;
  v_boost numeric;
  v_band int := -1;
  v_max numeric := 0;
  v_total numeric := 0;
  v_pick numeric;
  v_acc numeric := 0;
  v_winner text;
  v_id text;
  v_pool jsonb := '[]'::jsonb;
  v_uids text[] := '{}';
  v_weights numeric[] := '{}';
  e jsonb;
  v_uid text;
  v_n numeric;
  w numeric;
  i int;
begin
  if me is null or not coalesce(public.rows_is_member(p_workspace), false) then
    raise exception 'random_draw: не участник workspace' using errcode = '42501';
  end if;
  if not (coalesce(public.rows_is_owner(p_workspace), false)
          or coalesce(public.rows_is_teamlead(p_workspace), false)
          or coalesce(public.rows_has_role(p_workspace, 'os'), false)) then
    raise exception 'random_draw: крутят Owner, Тимлид и ОС' using errcode = '42501';
  end if;
  if p_pool is null or coalesce(jsonb_typeof(p_pool), '') <> 'array'
     or jsonb_array_length(p_pool) < 1 or jsonb_array_length(p_pool) > 50 then
    raise exception 'random_draw: в барабане от 1 до 50 человек' using errcode = '22023';
  end if;

  select r.data into s from public.random_settings r where r.workspace_id = p_workspace;
  s := coalesce(s, '{}'::jsonb);
  v_boost := public.random_mult(s -> 'fewerOrdersBoost');
  if coalesce(jsonb_typeof(s -> 'fewerOrdersBoost'), '') <> 'number' then v_boost := 0; end if;
  if p_check is not null and p_check > 0 and coalesce(jsonb_typeof(s -> 'checkBands'), '') = 'array' then
    select count(*)::int into v_band
    from jsonb_array_elements(s -> 'checkBands') b
    where jsonb_typeof(b) = 'number' and (b #>> '{}')::numeric <= p_check;
  end if;

  for e in select * from jsonb_array_elements(p_pool) loop
    if coalesce(jsonb_typeof(e), '') <> 'object' or coalesce(jsonb_typeof(e -> 'uid'), '') <> 'string' then
      raise exception 'random_draw: неверный участник барабана' using errcode = '22023';
    end if;
    v_uid := left(e ->> 'uid', 128);
    if v_uid = '' or v_uid = any(v_uids) then
      raise exception 'random_draw: повтор в барабане' using errcode = '22023';
    end if;
    v_n := case when coalesce(jsonb_typeof(e -> 'count'), '') = 'number'
                then greatest(0::numeric, (e ->> 'count')::numeric) else 0 end;
    v_max := greatest(v_max, v_n);
    v_uids := v_uids || v_uid;
    v_pool := v_pool || jsonb_build_array(jsonb_build_object(
      'uid', v_uid,
      'name', left(coalesce(case when jsonb_typeof(e -> 'name') = 'string' then e ->> 'name' end, ''), 60),
      'n', v_n));
  end loop;

  for i in 1 .. jsonb_array_length(v_pool) loop
    e := v_pool -> (i - 1);
    v_uid := e ->> 'uid';
    w := public.random_mult(s -> 'weights' -> v_uid);
    if v_band >= 0 and coalesce(jsonb_typeof(s -> 'bandWeights' -> v_uid), '') = 'array' then
      w := w * public.random_mult(s -> 'bandWeights' -> v_uid -> v_band);
    end if;
    if w > 0 and v_boost > 0 and v_max > 0 then
      w := w * (1 + v_boost * (v_max - least(v_max, (e ->> 'n')::numeric)) / v_max);
    end if;
    v_weights := v_weights || w;
    v_total := v_total + w;
  end loop;

  if v_total <= 0 then
    raise exception 'random_draw: некому выпасть' using errcode = 'P0001', hint = 'all_zero';
  end if;

  v_pick := random() * v_total;
  for i in 1 .. array_length(v_uids, 1) loop
    if v_weights[i] <= 0 then continue; end if;
    v_acc := v_acc + v_weights[i];
    v_winner := v_uids[i];
    exit when v_pick < v_acc;
  end loop;

  v_id := replace(gen_random_uuid()::text, '-', '');
  insert into public.random_spins (workspace_id, id, order_id, title, pool, winner_uid, by_uid, by_name)
  values (
    p_workspace, v_id, left(p_order_id, 100), left(coalesce(p_title, ''), 200),
    (select coalesce(jsonb_agg(jsonb_build_object('uid', t.x ->> 'uid', 'name', t.x ->> 'name') order by t.ord), '[]'::jsonb)
       from jsonb_array_elements(v_pool) with ordinality as t(x, ord)),
    v_winner, me, left(coalesce(p_by_name, ''), 60));
  delete from public.random_spins where workspace_id = p_workspace and created_at < now() - interval '1 day';

  return jsonb_build_object('id', v_id, 'winner', v_winner);
end;
$$;
revoke all on function public.random_draw(text, text, text, jsonb, numeric, text) from public;
grant execute on function public.random_draw(text, text, text, jsonb, numeric, text) to anon, authenticated;

create or replace function public.random_spin_latest(p_workspace text) returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  r public.random_spins%rowtype;
begin
  if not coalesce(public.rows_is_member(p_workspace), false) then
    raise exception 'random_spin_latest: не участник workspace' using errcode = '42501';
  end if;
  select * into r from public.random_spins s
  where s.workspace_id = p_workspace order by s.created_at desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object(
    'id', r.id, 'orderId', r.order_id, 'title', r.title, 'pool', r.pool,
    'winner', r.winner_uid, 'byUid', r.by_uid, 'byName', r.by_name,
    'ageMs', floor(extract(epoch from (clock_timestamp() - r.created_at)) * 1000)::bigint);
end;
$$;
revoke all on function public.random_spin_latest(text) from public;
grant execute on function public.random_spin_latest(text) to anon, authenticated;

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
    if not (coalesce(public.rows_has_role(p_workspace, 'manager'), false)
            or coalesce(public.rows_has_role(p_workspace, 'owner'), false)) then
      raise exception 'order_write: откликаются технари и Owner' using errcode = '42501';
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

create or replace function public.nova_schema_version() returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select '20261044'
$$;
revoke all on function public.nova_schema_version() from public, anon, authenticated;
grant execute on function public.nova_schema_version() to anon, authenticated;
