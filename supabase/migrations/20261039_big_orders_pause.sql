-- «Заказы от 300к+» — временно отключить (29.09.2026).
--
-- Два переключателя, права те же, что у самой очереди (Owner и ответственные):
--   * enabled = false — вся функция на паузе: крупные заказы выдаются как
--     обычно, очередь со всеми номерами сохраняется;
--   * paused[uid] — технарь на паузе: остаётся в очереди со своим номером, но
--     при выдаче его пропускают. Значение — мс «до какого момента» или null
--     («пока не снимут»). Истёкшая дата = активен (клиент сравнивает сам,
--     база ничего не чистит по времени).
--
-- big_queue_row и big_queue_set — полные копии из 20261038 (правки только здесь
-- или новее). Файл повторяемый.

alter table public.big_order_queue add column if not exists enabled boolean not null default true;
alter table public.big_order_queue add column if not exists paused jsonb not null default '{}'::jsonb;
alter table public.big_order_queue add column if not exists paused_by text;

create or replace function public.big_queue_row(p_workspace text) returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select jsonb_build_object(
        'threshold', q.threshold,
        'managers', to_jsonb(q.managers),
        'queue', to_jsonb(q.queue),
        'enabled', q.enabled,
        'paused', q.paused,
        'pausedBy', q.paused_by,
        'updatedAt', (extract(epoch from q.updated_at) * 1000)::bigint,
        'updatedBy', q.updated_by)
     from public.big_order_queue q where q.workspace_id = p_workspace),
    jsonb_build_object('threshold', 300000, 'managers', '[]'::jsonb, 'queue', '[]'::jsonb,
                       'enabled', true, 'paused', '{}'::jsonb, 'pausedBy', null,
                       'updatedAt', null, 'updatedBy', null)
  )
$$;
revoke all on function public.big_queue_row(text) from public, anon, authenticated;

-- Owner или ответственный, участник, живое хранилище.
create or replace function public.big_queue_can_edit(p_workspace text) returns boolean
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
begin
  if me is null or not coalesce(public.rows_is_member(p_workspace), false) then
    return false;
  end if;
  return coalesce(public.rows_is_owner(p_workspace), false)
    or exists (select 1 from public.big_order_queue q
               where q.workspace_id = p_workspace and me = any (q.managers));
end;
$$;
revoke all on function public.big_queue_can_edit(text) from public, anon, authenticated;

-- Очередь — Owner или ответственный. Порядок сохраняется, повторы и не-технари
-- отбрасываются; пауза убранных из очереди снимается.
create or replace function public.big_queue_set(p_workspace text, p_queue text[]) returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  list text[] := '{}';
  u text;
begin
  if not public.big_queue_can_edit(p_workspace) then
    raise exception 'not a queue manager' using errcode = '42501';
  end if;
  if p_workspace not in (select public.rows_writable_workspaces()) then
    raise exception 'workspace is read-only' using errcode = '42501';
  end if;
  if coalesce(array_length(p_queue, 1), 0) > 50 then
    raise exception 'queue too long' using errcode = '22023';
  end if;
  foreach u in array coalesce(p_queue, '{}') loop
    if u is not null and not (u = any (list)) and public.big_queue_tech_ok(p_workspace, u) then
      list := list || u;
    end if;
  end loop;
  insert into public.big_order_queue as c (workspace_id, queue, updated_at, updated_by)
  values (p_workspace, list, now(), me)
  on conflict (workspace_id) do update
    set queue = excluded.queue,
        paused = coalesce((select jsonb_object_agg(k, v) from jsonb_each(c.paused) as e(k, v)
                           where k = any (excluded.queue)), '{}'::jsonb),
        updated_at = now(), updated_by = me;
  return public.big_queue_row(p_workspace);
end;
$$;
revoke all on function public.big_queue_set(text, text[]) from public;
grant execute on function public.big_queue_set(text, text[]) to anon, authenticated;

-- Вся функция: работает / на паузе.
create or replace function public.big_queue_set_enabled(p_workspace text, p_on boolean) returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
begin
  if not public.big_queue_can_edit(p_workspace) then
    raise exception 'not a queue manager' using errcode = '42501';
  end if;
  if p_workspace not in (select public.rows_writable_workspaces()) then
    raise exception 'workspace is read-only' using errcode = '42501';
  end if;
  if p_on is null then
    raise exception 'bad value' using errcode = '22023';
  end if;
  insert into public.big_order_queue as c (workspace_id, enabled, paused_by, updated_at, updated_by)
  values (p_workspace, p_on, me, now(), me)
  on conflict (workspace_id) do update
    set enabled = excluded.enabled, paused_by = me, updated_at = now(), updated_by = me;
  return public.big_queue_row(p_workspace);
end;
$$;
revoke all on function public.big_queue_set_enabled(text, boolean) from public;
grant execute on function public.big_queue_set_enabled(text, boolean) to anon, authenticated;

-- Технарь на паузе (только из очереди). p_until_ms — в будущем и не дальше
-- 90 дней, null — пока не снимут. p_on = false — снять.
create or replace function public.big_queue_set_pause(p_workspace text, p_uid text, p_on boolean, p_until_ms bigint)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if not public.big_queue_can_edit(p_workspace) then
    raise exception 'not a queue manager' using errcode = '42501';
  end if;
  if p_workspace not in (select public.rows_writable_workspaces()) then
    raise exception 'workspace is read-only' using errcode = '42501';
  end if;
  if p_uid is null or p_on is null then
    raise exception 'bad value' using errcode = '22023';
  end if;
  if p_on then
    if not exists (select 1 from public.big_order_queue q
                   where q.workspace_id = p_workspace and p_uid = any (q.queue)) then
      raise exception 'not in queue' using errcode = '22023';
    end if;
    if p_until_ms is not null and (p_until_ms <= now_ms or p_until_ms > now_ms + 90::bigint * 86400000) then
      raise exception 'bad pause date' using errcode = '22023';
    end if;
    update public.big_order_queue
      set paused = paused || jsonb_build_object(p_uid, to_jsonb(p_until_ms)),
          paused_by = me, updated_at = now(), updated_by = me
      where workspace_id = p_workspace;
  else
    update public.big_order_queue
      set paused = paused - p_uid, paused_by = me, updated_at = now(), updated_by = me
      where workspace_id = p_workspace;
  end if;
  return public.big_queue_row(p_workspace);
end;
$$;
revoke all on function public.big_queue_set_pause(text, text, boolean, bigint) from public;
grant execute on function public.big_queue_set_pause(text, text, boolean, bigint) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Версия схемы.
-- ---------------------------------------------------------------------
create or replace function public.nova_schema_version() returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select '20261039'
$$;
revoke all on function public.nova_schema_version() from public, anon, authenticated;
grant execute on function public.nova_schema_version() to anon, authenticated;
