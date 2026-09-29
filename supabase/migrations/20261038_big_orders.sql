-- «Заказы от 300к+» — очередь технарей для крупных заказов (28.09.2026).
--
-- Owner назначает ответственных (доп. право, не роль) и порог суммы чека.
-- Ответственный (и Owner) составляет очередь технарей по номерам: №1 в
-- приоритете. При выдаче заказа с чеком от порога ОС отдаёт его только
-- технарю из очереди — это держит интерфейс (как запреты на отклик), база
-- хранит саму очередь и решает, кто вправе её править.
--
-- Таблица закрыта API-ролям целиком: читают и пишут только функции ниже.
-- Файл повторяемый.

create table if not exists public.big_order_queue (
  workspace_id text primary key references public.rows_workspaces (workspace_id) on delete cascade,
  threshold numeric not null default 300000,
  managers text[] not null default '{}',
  queue text[] not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.big_order_queue enable row level security;
revoke all on public.big_order_queue from public, anon, authenticated;

-- Работает за столом: Технарь (основной или второй ролью) или Owner — как
-- `worksAsTechnician` на клиенте.
create or replace function public.big_queue_tech_ok(p_workspace text, p_uid text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.rows_members m
    where m.workspace_id = p_workspace and m.uid = p_uid
      and (m.role in ('manager', 'owner') or 'manager' = any (coalesce(m.extra_roles, '{}')))
  )
$$;
revoke all on function public.big_queue_tech_ok(text, text) from public, anon, authenticated;

create or replace function public.big_queue_row(p_workspace text) returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select jsonb_build_object(
        'threshold', q.threshold,
        'managers', to_jsonb(q.managers),
        'queue', to_jsonb(q.queue),
        'updatedAt', (extract(epoch from q.updated_at) * 1000)::bigint,
        'updatedBy', q.updated_by)
     from public.big_order_queue q where q.workspace_id = p_workspace),
    jsonb_build_object('threshold', 300000, 'managers', '[]'::jsonb, 'queue', '[]'::jsonb,
                       'updatedAt', null, 'updatedBy', null)
  )
$$;
revoke all on function public.big_queue_row(text) from public, anon, authenticated;

-- Чтение — любой участник.
create or replace function public.big_queue_get(p_workspace text) returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if public.rows_uid() is null or not coalesce(public.rows_is_member(p_workspace), false) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  return public.big_queue_row(p_workspace);
end;
$$;
revoke all on function public.big_queue_get(text) from public;
grant execute on function public.big_queue_get(text) to anon, authenticated;

-- Ответственные и порог — только Owner.
create or replace function public.big_queue_set_config(p_workspace text, p_managers text[], p_threshold numeric)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  list text[];
begin
  if me is null or not coalesce(public.rows_is_owner(p_workspace), false) then
    raise exception 'only owner' using errcode = '42501';
  end if;
  if p_workspace not in (select public.rows_writable_workspaces()) then
    raise exception 'workspace is read-only' using errcode = '42501';
  end if;
  if coalesce(array_length(p_managers, 1), 0) > 10 then
    raise exception 'too many managers' using errcode = '22023';
  end if;
  if p_threshold is null or p_threshold < 1000 or p_threshold > 1e12 then
    raise exception 'bad threshold' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct m.uid order by m.uid), '{}') into list
  from public.rows_members m
  where m.workspace_id = p_workspace and m.uid = any (coalesce(p_managers, '{}'));
  insert into public.big_order_queue as c (workspace_id, threshold, managers, updated_at, updated_by)
  values (p_workspace, p_threshold, list, now(), me)
  on conflict (workspace_id) do update
    set threshold = excluded.threshold, managers = excluded.managers, updated_at = now(), updated_by = me;
  return public.big_queue_row(p_workspace);
end;
$$;
revoke all on function public.big_queue_set_config(text, text[], numeric) from public;
grant execute on function public.big_queue_set_config(text, text[], numeric) to anon, authenticated;

-- Очередь — Owner или ответственный. Порядок сохраняется, повторы и не-технари
-- отбрасываются.
create or replace function public.big_queue_set(p_workspace text, p_queue text[]) returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  allowed boolean;
  list text[] := '{}';
  u text;
begin
  if me is null or not coalesce(public.rows_is_member(p_workspace), false) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  allowed := coalesce(public.rows_is_owner(p_workspace), false)
    or exists (select 1 from public.big_order_queue q
               where q.workspace_id = p_workspace and me = any (q.managers));
  if not allowed then
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
  on conflict (workspace_id) do update set queue = excluded.queue, updated_at = now(), updated_by = me;
  return public.big_queue_row(p_workspace);
end;
$$;
revoke all on function public.big_queue_set(text, text[]) from public;
grant execute on function public.big_queue_set(text, text[]) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Версия схемы.
-- ---------------------------------------------------------------------
create or replace function public.nova_schema_version() returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select '20261038'
$$;
revoke all on function public.nova_schema_version() from public, anon, authenticated;
grant execute on function public.nova_schema_version() to anon, authenticated;
