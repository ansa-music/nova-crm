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
-- big_queue_row — полная копия из 20261040 (+ taken), правки только здесь или
-- новее. Файл повторяемый.

alter table public.big_order_queue add column if not exists taken jsonb not null default '{}'::jsonb;
alter table public.big_order_queue add column if not exists taken_by text;

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
        'updatedAt', (extract(epoch from q.updated_at) * 1000)::bigint,
        'updatedBy', q.updated_by)
     from public.big_order_queue q where q.workspace_id = p_workspace),
    jsonb_build_object('threshold', 300000, 'managers', '[]'::jsonb, 'queue', '[]'::jsonb,
                       'pool', '[]'::jsonb, 'enabled', true, 'paused', '{}'::jsonb, 'pausedBy', null,
                       'taken', '{}'::jsonb, 'takenBy', null,
                       'updatedAt', null, 'updatedBy', null)
  )
$$;
revoke all on function public.big_queue_row(text) from public, anon, authenticated;

create or replace function public.big_queue_took(p_workspace text, p_uid text) returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
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
  if p_uid is null then
    raise exception 'bad value' using errcode = '22023';
  end if;
  update public.big_order_queue
    set queue = array_remove(queue, p_uid),
        pool = array_prepend(p_uid, array_remove(pool, p_uid)),
        taken = taken || jsonb_build_object(p_uid, now_ms),
        taken_by = me,
        paused = paused - p_uid,
        updated_at = now(), updated_by = me
    where workspace_id = p_workspace and p_uid = any (queue);
  return public.big_queue_row(p_workspace);
end;
$$;
revoke all on function public.big_queue_took(text, text) from public;
grant execute on function public.big_queue_took(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Версия схемы.
-- ---------------------------------------------------------------------
create or replace function public.nova_schema_version() returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select '20261041'
$$;
revoke all on function public.nova_schema_version() from public, anon, authenticated;
grant execute on function public.nova_schema_version() to anon, authenticated;
