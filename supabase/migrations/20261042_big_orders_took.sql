-- «Заказы от 300к+» — получил заказ = ушёл из очереди (29.09.2026).
--
-- Просьба Nurba: «если первый получил — чтобы он сразу уходил с очереди».
-- Очередь правят только Owner и ответственные (big_queue_set_lists), а
-- выдаёт заказ ОС — поэтому отдельная узкая функция: тот, кто выдаёт заказы
-- (Owner, Тимлид/Тимлид+, ОС основной или второй ролью, ответственный),
-- переносит ОДНОГО человека из очереди в начало группы и отмечает, когда он
-- получил заказ (taken[uid] = мс сервера). Не в очереди — ничего не меняется.
--
-- Пауза у отдельного технаря с этого файла клиентом не читается (кнопку убрали);
-- колонка paused осталась, big_queue_took чистит её у ушедшего.
--
-- Счётчик (просьба Nurba 29.09.2026: «кто получает заказ от 300к — рядом с именем
-- 1, с каждым получением +1, сбрасывается только кнопкой у Owner; считать с новых
-- заказов, старые не в учёт»): award_log — ключ заказа → {uid, at}. Ключ — адрес
-- строки стола ОС (или id заказа биржи), поэтому повторная выдача того же заказа не
-- считается дважды, а переданный другому технарю заказ переходит к нему. Счётчик
-- человека = число записей журнала с его uid. Сбросить — big_queue_reset_counts
-- (только Owner): журнал пустеет, counts_since = сейчас. Пишется при ЛЮБОЙ выдаче
-- крупного заказа технарю (в очереди он или нет); из очереди в группу переносит,
-- только пока функция включена.
--
-- big_queue_row — полная копия из 20261040 (+ taken, counts), правки только здесь
-- или новее. Файл повторяемый.

alter table public.big_order_queue add column if not exists taken jsonb not null default '{}'::jsonb;
alter table public.big_order_queue add column if not exists taken_by text;
alter table public.big_order_queue add column if not exists award_log jsonb not null default '{}'::jsonb;
alter table public.big_order_queue add column if not exists counts_since timestamptz;
alter table public.big_order_queue add column if not exists counts_reset_by text;

create or replace function public.big_queue_row(p_workspace text) returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select jsonb_build_object(
        'threshold', q.threshold,
        'managers', to_jsonb(q.managers),
        'queue', to_jsonb(q.queue),
        'pool', to_jsonb(q.pool),
        'enabled', q.enabled,
        'paused', q.paused,
        'pausedBy', q.paused_by,
        'taken', q.taken,
        'takenBy', q.taken_by,
        'counts', coalesce((select jsonb_object_agg(u, n) from (
            select e.value->>'uid' as u, count(*) as n
            from jsonb_each(q.award_log) as e
            where e.value->>'uid' is not null
            group by 1) c), '{}'::jsonb),
        'countsSince', (extract(epoch from q.counts_since) * 1000)::bigint,
        'countsResetBy', q.counts_reset_by,
        'updatedAt', (extract(epoch from q.updated_at) * 1000)::bigint,
        'updatedBy', q.updated_by)
     from public.big_order_queue q where q.workspace_id = p_workspace),
    jsonb_build_object('threshold', 300000, 'managers', '[]'::jsonb, 'queue', '[]'::jsonb,
                       'pool', '[]'::jsonb, 'enabled', true, 'paused', '{}'::jsonb, 'pausedBy', null,
                       'taken', '{}'::jsonb, 'takenBy', null,
                       'counts', '{}'::jsonb, 'countsSince', null, 'countsResetBy', null,
                       'updatedAt', null, 'updatedBy', null)
  )
$$;
revoke all on function public.big_queue_row(text) from public, anon, authenticated;

-- Первая версия этого файла (ещё не выкатывалась) принимала два аргумента.
drop function if exists public.big_queue_took(text, text);

-- Технарь получил крупный заказ. p_order_key — «row:{стол}:{строка}» или
-- «order:{id}» (до 200 знаков); null — только перенос из очереди, без счёта.
create or replace function public.big_queue_took(p_workspace text, p_uid text, p_order_key text default null)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  k text := nullif(btrim(coalesce(p_order_key, '')), '');
begin
  if me is null or not coalesce(public.rows_is_member(p_workspace), false) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  if not (coalesce(public.rows_is_owner(p_workspace), false)
          or coalesce(public.rows_is_teamlead(p_workspace), false)
          or coalesce(public.rows_has_role(p_workspace, 'os'), false)
          or coalesce(public.big_queue_can_edit(p_workspace), false)) then
    raise exception 'cannot issue orders' using errcode = '42501';
  end if;
  if p_workspace not in (select public.rows_writable_workspaces()) then
    raise exception 'workspace is read-only' using errcode = '42501';
  end if;
  if p_uid is null or (k is not null and length(k) > 200) then
    raise exception 'bad value' using errcode = '22023';
  end if;
  if k is not null and public.big_queue_tech_ok(p_workspace, p_uid) then
    insert into public.big_order_queue as c (workspace_id, award_log, counts_since, updated_at, updated_by)
    values (p_workspace, jsonb_build_object(k, jsonb_build_object('uid', p_uid, 'at', now_ms)), now(), now(), me)
    on conflict (workspace_id) do update
      set award_log = case
            when c.award_log -> k ->> 'uid' = p_uid then c.award_log
            when (select count(*) from jsonb_object_keys(c.award_log)) >= 5000 and not (c.award_log ? k)
              then c.award_log
            else c.award_log || jsonb_build_object(k, jsonb_build_object('uid', p_uid, 'at', now_ms))
          end,
          counts_since = coalesce(c.counts_since, now());
  end if;
  update public.big_order_queue
    set queue = array_remove(queue, p_uid),
        pool = array_prepend(p_uid, array_remove(pool, p_uid)),
        taken = taken || jsonb_build_object(p_uid, now_ms),
        taken_by = me,
        paused = paused - p_uid,
        updated_at = now(), updated_by = me
    where workspace_id = p_workspace and enabled and p_uid = any (queue);
  return public.big_queue_row(p_workspace);
end;
$$;
revoke all on function public.big_queue_took(text, text, text) from public;
grant execute on function public.big_queue_took(text, text, text) to anon, authenticated;

-- Сбросить счётчик — только Owner. Считаем заново с этой минуты.
create or replace function public.big_queue_reset_counts(p_workspace text) returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
begin
  if me is null or not coalesce(public.rows_is_member(p_workspace), false)
     or not coalesce(public.rows_is_owner(p_workspace), false) then
    raise exception 'only owner' using errcode = '42501';
  end if;
  if p_workspace not in (select public.rows_writable_workspaces()) then
    raise exception 'workspace is read-only' using errcode = '42501';
  end if;
  insert into public.big_order_queue as c (workspace_id, counts_since, counts_reset_by, updated_at, updated_by)
  values (p_workspace, now(), me, now(), me)
  on conflict (workspace_id) do update
    set award_log = '{}'::jsonb, counts_since = now(), counts_reset_by = me,
        updated_at = now(), updated_by = me;
  return public.big_queue_row(p_workspace);
end;
$$;
revoke all on function public.big_queue_reset_counts(text) from public;
grant execute on function public.big_queue_reset_counts(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Версия схемы.
-- ---------------------------------------------------------------------
create or replace function public.nova_schema_version() returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select '20261042'
$$;
revoke all on function public.nova_schema_version() from public, anon, authenticated;
grant execute on function public.nova_schema_version() to anon, authenticated;
