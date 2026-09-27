-- =====================================================================
-- Nova CRM — оценка раундами (27.09.2026).
--
-- Просьба Nurba вдогонку к 20261032: «внутри оценки две кнопки — только
-- технари и только ОС; в каждой второй тип оценивает первый (ОС → технари,
-- технари → ОС); Owner может отключить оценку какого-то типа; Owner даёт
-- кому-то право „управление оценками“ — не роль, а доп. привилегия; в какой-то
-- момент управляющий нажимает „Еженедельная оценка“ — всем уведомление,
-- открывается оценка выбранной группы; потом управляющий нажимает
-- „Завершить“ — и отображается итог».
--
-- Было (20261032): оценка по календарной ISO-неделе, итог — после её конца.
-- Стало: РАУНД. Его открывает управляющий (Owner или участник из
-- weekly_rating_config.managers) для одного направления, закрывает он же —
-- тогда и появляется итог. Таблицы и функции 20261032 остаются (старый код во
-- вкладках до перезагрузки), новым кодом не используются.
--
-- Анонимность прежняя и держит её база:
--   • rating_votes читает ТОЛЬКО тот, кто ставил; прямой записи нет;
--   • наружу (rating_results) — средний балл и число оценивших, только у
--     ЗАКРЫТЫХ раундов и только при числе оценивших ≥ порога;
--   • управляющий во время раунда видит только «оценили N из M» без имён.
--
-- Направления: os_tech — ОС оценивают технарей; tech_os — технари (и Owner,
-- его столы — столы технаря) оценивают ОС. Себя нельзя; кого Owner/управляющий
-- исключил (excluded) — не оценивает и не оценивается.
--
-- Скрипт повторяемый. Правки функций — только в этом файле или новее.
-- =====================================================================

alter table public.weekly_rating_config add column if not exists rate_techs boolean not null default true;
alter table public.weekly_rating_config add column if not exists rate_os boolean not null default true;
alter table public.weekly_rating_config add column if not exists managers text[] not null default '{}';
alter table public.weekly_rating_config add column if not exists excluded text[] not null default '{}';

create table if not exists public.rating_rounds (
  workspace_id text not null references public.rows_workspaces (workspace_id) on delete cascade,
  id text not null,
  direction text not null check (direction in ('os_tech', 'tech_os')),
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  opened_at timestamptz not null default now(),
  opened_by text,
  closed_at timestamptz,
  closed_by text,
  primary key (workspace_id, id)
);

-- Один открытый раунд на направление.
create unique index if not exists rating_rounds_one_open
  on public.rating_rounds (workspace_id, direction) where status = 'open';
create index if not exists rating_rounds_closed_idx
  on public.rating_rounds (workspace_id, direction, closed_at desc) where status = 'closed';

alter table public.rating_rounds enable row level security;
-- Ни одной политики: раунды отдают функции ниже.
revoke all on public.rating_rounds from public, anon, authenticated;

create table if not exists public.rating_votes (
  workspace_id text not null,
  round_id text not null,
  rater_uid text not null,
  target_uid text not null,
  score smallint not null check (score between 1 and 10),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, round_id, rater_uid, target_uid),
  foreign key (workspace_id, round_id) references public.rating_rounds (workspace_id, id) on delete cascade
);

create index if not exists rating_votes_target_idx on public.rating_votes (workspace_id, round_id, target_uid);

alter table public.rating_votes enable row level security;

drop policy if exists rating_votes_read_own on public.rating_votes;
create policy rating_votes_read_own on public.rating_votes for select to anon, authenticated
  using (rater_uid = (select public.rows_uid()));

revoke all on public.rating_votes from public, anon, authenticated;
grant select on public.rating_votes to anon, authenticated;

-- ---------------------------------------------------------------------
-- Помощники.
-- ---------------------------------------------------------------------

-- Настройка workspace (нет строки — умолчания).
create or replace function public.rating_cfg(ws text) returns public.weekly_rating_config
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  cfg public.weekly_rating_config%rowtype;
begin
  select * into cfg from public.weekly_rating_config c where c.workspace_id = ws;
  if not found then
    cfg.workspace_id := ws;
    cfg.enabled := true;
    cfg.visible := true;
    cfg.min_raters := 3;
    cfg.rate_techs := true;
    cfg.rate_os := true;
    cfg.managers := '{}';
    cfg.excluded := '{}';
  end if;
  return cfg;
end;
$$;

revoke all on function public.rating_cfg(text) from public, anon, authenticated;

-- Управляет оценками: Owner или участник из списка управляющих.
create or replace function public.rating_is_manager(ws text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.rows_uid() is not null and (
    coalesce(public.rows_is_owner(ws), false)
    or (
      coalesce(public.rows_is_member(ws), false)
      and public.rows_uid() = any ((public.rating_cfg(ws)).managers)
    )
  )
$$;

revoke all on function public.rating_is_manager(text) from public, anon, authenticated;

-- Направление включено.
create or replace function public.rating_dir_on(cfg public.weekly_rating_config, dir text) returns boolean
language sql immutable
set search_path = public, pg_temp
as $$
  select case dir when 'os_tech' then cfg.rate_techs when 'tech_os' then cfg.rate_os else false end
$$;

revoke all on function public.rating_dir_on(public.weekly_rating_config, text) from public, anon, authenticated;

-- Кто оценивает в направлении / кого оценивают (без исключённых).
create or replace function public.rating_raters(ws text, dir text) returns setof text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select m.uid from public.rows_members m
  where m.workspace_id = ws
    and public.weekly_can_rate(ws, dir, m.uid)
    and not (m.uid = any ((public.rating_cfg(ws)).excluded))
$$;

create or replace function public.rating_targets(ws text, dir text) returns setof text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select m.uid from public.rows_members m
  where m.workspace_id = ws
    and public.weekly_can_be_rated(ws, dir, m.uid)
    and not (m.uid = any ((public.rating_cfg(ws)).excluded))
$$;

revoke all on function public.rating_raters(text, text) from public, anon, authenticated;
revoke all on function public.rating_targets(text, text) from public, anon, authenticated;

create or replace function public.rating_round_json(r public.rating_rounds) returns jsonb
language sql immutable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', r.id, 'direction', r.direction, 'status', r.status,
    'openedAt', (extract(epoch from r.opened_at) * 1000)::bigint,
    'openedBy', r.opened_by,
    'closedAt', case when r.closed_at is null then null else (extract(epoch from r.closed_at) * 1000)::bigint end
  )
$$;

revoke all on function public.rating_round_json(public.rating_rounds) from public, anon, authenticated;

create or replace function public.rating_tenant_active(ws text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.rows_workspaces w
    where w.workspace_id = ws and public.nova_tenant_active(w.status, w.trial_until)
  )
$$;

revoke all on function public.rating_tenant_active(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Состояние для страницы и меню.
-- ---------------------------------------------------------------------
create or replace function public.rating_state(p_workspace text) returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  cfg public.weekly_rating_config;
  owner boolean;
  manager boolean;
  mine_excluded boolean;
  open_json jsonb := '{}'::jsonb;
  progress jsonb := '{}'::jsonb;
  r public.rating_rounds%rowtype;
  res jsonb;
begin
  if me is null or not coalesce(public.rows_is_member(p_workspace), false) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  cfg := public.rating_cfg(p_workspace);
  owner := coalesce(public.rows_is_owner(p_workspace), false);
  manager := public.rating_is_manager(p_workspace);
  mine_excluded := me = any (cfg.excluded);

  for r in select * from public.rating_rounds x where x.workspace_id = p_workspace and x.status = 'open' loop
    open_json := open_json || jsonb_build_object(r.direction, public.rating_round_json(r));
    if manager then
      progress := progress || jsonb_build_object(r.direction, jsonb_build_object(
        'rated', (select count(distinct v.rater_uid) from public.rating_votes v
                  where v.workspace_id = p_workspace and v.round_id = r.id),
        'raters', (select count(*) from public.rating_raters(p_workspace, r.direction))
      ));
    end if;
  end loop;

  res := jsonb_build_object(
    'rateTechs', cfg.rate_techs,
    'rateOs', cfg.rate_os,
    'visible', cfg.visible,
    'minRaters', cfg.min_raters,
    'excluded', to_jsonb(cfg.excluded),
    'isOwner', owner,
    'isManager', manager,
    'canRate', jsonb_build_object(
      'os_tech', not mine_excluded and cfg.rate_techs and public.weekly_can_rate(p_workspace, 'os_tech', me),
      'tech_os', not mine_excluded and cfg.rate_os and public.weekly_can_rate(p_workspace, 'tech_os', me)
    ),
    'open', open_json,
    'mine', coalesce((
      select jsonb_agg(jsonb_build_object('round', v.round_id, 'target', v.target_uid, 'score', v.score))
      from public.rating_votes v
      join public.rating_rounds x on x.workspace_id = v.workspace_id and x.id = v.round_id and x.status = 'open'
      where v.workspace_id = p_workspace and v.rater_uid = me
    ), '[]'::jsonb)
  );
  if manager then
    res := res || jsonb_build_object('managers', to_jsonb(cfg.managers), 'progress', progress);
  end if;
  return res;
end;
$$;

revoke all on function public.rating_state(text) from public;
grant execute on function public.rating_state(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Открыть раунд. Ответ: {"round": {...}, "raters": [uid...], "already": bool}.
-- raters — кому слать уведомление (клиент шлёт send_notifications).
-- ---------------------------------------------------------------------
create or replace function public.rating_round_start(p_workspace text, p_direction text) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  cfg public.weekly_rating_config;
  r public.rating_rounds%rowtype;
begin
  if me is null or not public.rating_is_manager(p_workspace) then
    raise exception 'not a rating manager' using errcode = '42501';
  end if;
  if p_direction is null or p_direction not in ('os_tech', 'tech_os') then
    raise exception 'unknown direction' using errcode = '22023';
  end if;
  if not public.rating_tenant_active(p_workspace) then
    raise exception 'workspace suspended' using errcode = '42501';
  end if;
  cfg := public.rating_cfg(p_workspace);
  if not public.rating_dir_on(cfg, p_direction) then
    raise exception 'direction is off' using errcode = '42501';
  end if;

  select * into r from public.rating_rounds x
  where x.workspace_id = p_workspace and x.direction = p_direction and x.status = 'open';
  if found then
    return jsonb_build_object('round', public.rating_round_json(r), 'already', true, 'raters', '[]'::jsonb);
  end if;

  begin
    insert into public.rating_rounds (workspace_id, id, direction, status, opened_at, opened_by)
    values (p_workspace, gen_random_uuid()::text, p_direction, 'open', now(), me)
    returning * into r;
  exception when unique_violation then
    select * into r from public.rating_rounds x
    where x.workspace_id = p_workspace and x.direction = p_direction and x.status = 'open';
    return jsonb_build_object('round', public.rating_round_json(r), 'already', true, 'raters', '[]'::jsonb);
  end;

  return jsonb_build_object(
    'round', public.rating_round_json(r),
    'already', false,
    'raters', coalesce((select jsonb_agg(u) from public.rating_raters(p_workspace, p_direction) u), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.rating_round_start(text, text) from public;
grant execute on function public.rating_round_start(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Завершить раунд — итоги видны. Ответ: {"round", "notify": [uid...]}
-- (оценивавшие в направлении и оценённые — им уведомление «итоги готовы»).
-- ---------------------------------------------------------------------
create or replace function public.rating_round_finish(p_workspace text, p_round text) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  r public.rating_rounds%rowtype;
begin
  if me is null or not public.rating_is_manager(p_workspace) then
    raise exception 'not a rating manager' using errcode = '42501';
  end if;
  update public.rating_rounds x set status = 'closed', closed_at = now(), closed_by = me
  where x.workspace_id = p_workspace and x.id = p_round and x.status = 'open'
  returning * into r;
  if not found then
    raise exception 'round is not open' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'round', public.rating_round_json(r),
    'notify', coalesce((
      select jsonb_agg(distinct u) from (
        select public.rating_raters(p_workspace, r.direction) as u
        union select public.rating_targets(p_workspace, r.direction)
      ) q
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.rating_round_finish(text, text) from public;
grant execute on function public.rating_round_finish(text, text) to anon, authenticated;

-- Отменить открытый раунд (открыли по ошибке) — оценки его стираются.
create or replace function public.rating_round_cancel(p_workspace text, p_round text) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  r public.rating_rounds%rowtype;
begin
  if me is null or not public.rating_is_manager(p_workspace) then
    raise exception 'not a rating manager' using errcode = '42501';
  end if;
  update public.rating_rounds x set status = 'cancelled', closed_at = now(), closed_by = me
  where x.workspace_id = p_workspace and x.id = p_round and x.status = 'open'
  returning * into r;
  if not found then
    raise exception 'round is not open' using errcode = 'P0002';
  end if;
  delete from public.rating_votes v where v.workspace_id = p_workspace and v.round_id = p_round;
  return jsonb_build_object('round', public.rating_round_json(r));
end;
$$;

revoke all on function public.rating_round_cancel(text, text) from public;
grant execute on function public.rating_round_cancel(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Поставить / сменить / снять (null) свою оценку в открытом раунде.
-- ---------------------------------------------------------------------
create or replace function public.rating_vote(p_workspace text, p_round text, p_target text, p_score integer) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  cfg public.weekly_rating_config;
  r public.rating_rounds%rowtype;
  n integer;
begin
  if me is null or not coalesce(public.rows_is_member(p_workspace), false) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  if not public.rating_tenant_active(p_workspace) then
    raise exception 'workspace suspended' using errcode = '42501';
  end if;
  select * into r from public.rating_rounds x where x.workspace_id = p_workspace and x.id = p_round;
  if not found or r.status <> 'open' then
    raise exception 'round is not open' using errcode = 'P0002';
  end if;
  cfg := public.rating_cfg(p_workspace);
  if not public.rating_dir_on(cfg, r.direction) then
    raise exception 'direction is off' using errcode = '42501';
  end if;
  if p_target is null or p_target = me then
    raise exception 'cannot rate yourself' using errcode = '22023';
  end if;
  if me = any (cfg.excluded) or not public.weekly_can_rate(p_workspace, r.direction, me) then
    raise exception 'not a rater' using errcode = '42501';
  end if;
  if p_target = any (cfg.excluded) or not public.weekly_can_be_rated(p_workspace, r.direction, p_target) then
    raise exception 'not a rateable member' using errcode = '42501';
  end if;

  if p_score is null then
    delete from public.rating_votes v
    where v.workspace_id = p_workspace and v.round_id = p_round and v.rater_uid = me and v.target_uid = p_target;
    get diagnostics n = row_count;
    return jsonb_build_object('state', case when n > 0 then 'removed' else 'none' end);
  end if;
  if p_score < 1 or p_score > 10 then
    raise exception 'score out of range' using errcode = '22023';
  end if;

  insert into public.rating_votes (workspace_id, round_id, rater_uid, target_uid, score, updated_at)
  values (p_workspace, p_round, me, p_target, p_score, now())
  on conflict (workspace_id, round_id, rater_uid, target_uid)
  do update set score = excluded.score, updated_at = excluded.updated_at;
  return jsonb_build_object('state', 'rated', 'score', p_score);
end;
$$;

revoke all on function public.rating_vote(text, text, text, integer) from public;
grant execute on function public.rating_vote(text, text, text, integer) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Итоги: последние p_rounds ЗАКРЫТЫХ раундов каждого направления (новые
-- первыми) и средний балл по человеку, где оценивших не меньше порога.
-- Скрытые итоги — только Owner и управляющим (с пометкой hidden).
-- ---------------------------------------------------------------------
create or replace function public.rating_results(p_workspace text, p_rounds integer default 8) returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  cfg public.weekly_rating_config;
  k integer := greatest(1, least(coalesce(p_rounds, 8), 26));
  ids text[];
  rounds jsonb;
begin
  if me is null or not coalesce(public.rows_is_member(p_workspace), false) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  cfg := public.rating_cfg(p_workspace);

  select coalesce(array_agg(x.id), '{}'), coalesce(jsonb_agg(public.rating_round_json(x) order by x.closed_at desc), '[]'::jsonb)
    into ids, rounds
  from public.rating_rounds x
  where x.workspace_id = p_workspace and x.id in (
    select q.id from (
      select y.id, row_number() over (partition by y.direction order by y.closed_at desc) as rn
      from public.rating_rounds y
      where y.workspace_id = p_workspace and y.status = 'closed'
    ) q
    where q.rn <= k
  );

  if not cfg.visible and not public.rating_is_manager(p_workspace) then
    return jsonb_build_object('hidden', true, 'minRaters', cfg.min_raters, 'rounds', rounds, 'rows', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'hidden', not cfg.visible,
    'minRaters', cfg.min_raters,
    'rounds', rounds,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object('round', g.round_id, 'target', g.target_uid, 'avg', g.avg_score, 'count', g.cnt))
      from (
        select v.round_id, v.target_uid, round(avg(v.score)::numeric, 1) as avg_score, count(*)::integer as cnt
        from public.rating_votes v
        where v.workspace_id = p_workspace and v.round_id = any (ids)
        group by v.round_id, v.target_uid
        having count(*) >= cfg.min_raters
      ) g
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.rating_results(text, integer) from public;
grant execute on function public.rating_results(text, integer) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Настройка: направления, показ итогов, порог, исключённые — управляющий.
-- null — не менять. Исключать можно только участников.
-- ---------------------------------------------------------------------
create or replace function public.rating_set_config(
  p_workspace text,
  p_rate_techs boolean default null,
  p_rate_os boolean default null,
  p_visible boolean default null,
  p_min_raters integer default null,
  p_excluded text[] default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  cfg public.weekly_rating_config%rowtype;
  excl text[];
begin
  if me is null or not public.rating_is_manager(p_workspace) then
    raise exception 'not a rating manager' using errcode = '42501';
  end if;
  if p_min_raters is not null and (p_min_raters < 2 or p_min_raters > 10) then
    raise exception 'min raters out of range' using errcode = '22023';
  end if;
  if p_excluded is not null then
    select coalesce(array_agg(distinct m.uid), '{}') into excl
    from public.rows_members m where m.workspace_id = p_workspace and m.uid = any (p_excluded);
  end if;
  insert into public.weekly_rating_config as c
    (workspace_id, enabled, visible, min_raters, rate_techs, rate_os, excluded, updated_at, updated_by)
  values (p_workspace, true, coalesce(p_visible, true), coalesce(p_min_raters, 3),
          coalesce(p_rate_techs, true), coalesce(p_rate_os, true), coalesce(excl, '{}'), now(), me)
  on conflict (workspace_id) do update set
    visible = coalesce(p_visible, c.visible),
    min_raters = coalesce(p_min_raters, c.min_raters),
    rate_techs = coalesce(p_rate_techs, c.rate_techs),
    rate_os = coalesce(p_rate_os, c.rate_os),
    excluded = coalesce(excl, c.excluded),
    updated_at = now(),
    updated_by = me
  returning * into cfg;
  return jsonb_build_object('rateTechs', cfg.rate_techs, 'rateOs', cfg.rate_os, 'visible', cfg.visible,
                            'minRaters', cfg.min_raters, 'excluded', to_jsonb(cfg.excluded));
end;
$$;

revoke all on function public.rating_set_config(text, boolean, boolean, boolean, integer, text[]) from public;
grant execute on function public.rating_set_config(text, boolean, boolean, boolean, integer, text[]) to anon, authenticated;

-- Управляющие оценками — только Owner.
create or replace function public.rating_set_managers(p_workspace text, p_uids text[]) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  list text[];
begin
  if me is null or not coalesce(public.rows_is_owner(p_workspace), false) then
    raise exception 'only owner' using errcode = '42501';
  end if;
  if coalesce(array_length(p_uids, 1), 0) > 30 then
    raise exception 'too many managers' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct m.uid), '{}') into list
  from public.rows_members m where m.workspace_id = p_workspace and m.uid = any (coalesce(p_uids, '{}'));
  insert into public.weekly_rating_config as c (workspace_id, managers, updated_at, updated_by)
  values (p_workspace, list, now(), me)
  on conflict (workspace_id) do update set managers = list, updated_at = now(), updated_by = me;
  return jsonb_build_object('managers', to_jsonb(list));
end;
$$;

revoke all on function public.rating_set_managers(text, text[]) from public;
grant execute on function public.rating_set_managers(text, text[]) to anon, authenticated;

-- ---------------------------------------------------------------------
create or replace function public.nova_schema_version() returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select '20261033'
$$;
revoke all on function public.nova_schema_version() from public, anon, authenticated;
grant execute on function public.nova_schema_version() to anon, authenticated;
