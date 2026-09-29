-- «Заказы от 300к+» — группа технарей и активная очередь (29.09.2026).
--
-- Просьба Nurba: люди заранее отобраны в группу, а активную очередь из неё
-- надо быстро актуализировать — убирать, возвращать, менять порядок.
-- `queue` — активная очередь (порядок = приоритет), `pool` — остальная группа
-- (в очередь не попадают, но и не забыты). Одним вызовом `big_queue_set_lists`
-- пишутся оба списка — перенос человека между ними атомарный.
--
-- big_queue_row — полная копия из 20261039 (+ pool), правки только здесь или
-- новее. Файл повторяемый.

alter table public.big_order_queue add column if not exists pool text[] not null default '{}';

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
        'updatedAt', (extract(epoch from q.updated_at) * 1000)::bigint,
        'updatedBy', q.updated_by)
     from public.big_order_queue q where q.workspace_id = p_workspace),
    jsonb_build_object('threshold', 300000, 'managers', '[]'::jsonb, 'queue', '[]'::jsonb,
                       'pool', '[]'::jsonb, 'enabled', true, 'paused', '{}'::jsonb, 'pausedBy', null,
                       'updatedAt', null, 'updatedBy', null)
  )
$$;
revoke all on function public.big_queue_row(text) from public, anon, authenticated;

-- Оба списка разом. Порядок сохраняется, повторы и не-технари отбрасываются,
-- человек из очереди в группе не дублируется; пауза — только у стоящих в очереди.
create or replace function public.big_queue_set_lists(p_workspace text, p_queue text[], p_pool text[])
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  q text[] := '{}';
  p text[] := '{}';
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
  if coalesce(array_length(p_pool, 1), 0) > 100 then
    raise exception 'pool too long' using errcode = '22023';
  end if;
  foreach u in array coalesce(p_queue, '{}') loop
    if u is not null and not (u = any (q)) and public.big_queue_tech_ok(p_workspace, u) then
      q := q || u;
    end if;
  end loop;
  foreach u in array coalesce(p_pool, '{}') loop
    if u is not null and not (u = any (q)) and not (u = any (p)) and public.big_queue_tech_ok(p_workspace, u) then
      p := p || u;
    end if;
  end loop;
  insert into public.big_order_queue as c (workspace_id, queue, pool, updated_at, updated_by)
  values (p_workspace, q, p, now(), me)
  on conflict (workspace_id) do update
    set queue = excluded.queue,
        pool = excluded.pool,
        paused = coalesce((select jsonb_object_agg(k, v) from jsonb_each(c.paused) as e(k, v)
                           where k = any (excluded.queue)), '{}'::jsonb),
        updated_at = now(), updated_by = me;
  return public.big_queue_row(p_workspace);
end;
$$;
revoke all on function public.big_queue_set_lists(text, text[], text[]) from public;
grant execute on function public.big_queue_set_lists(text, text[], text[]) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Версия схемы.
-- ---------------------------------------------------------------------
create or replace function public.nova_schema_version() returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select '20261040'
$$;
revoke all on function public.nova_schema_version() from public, anon, authenticated;
grant execute on function public.nova_schema_version() to anon, authenticated;
