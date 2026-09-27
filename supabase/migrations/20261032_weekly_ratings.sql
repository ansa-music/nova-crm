-- =====================================================================
-- Nova CRM — еженедельная анонимная оценка (27.09.2026).
--
-- Просьба Nurba: «каждый ОС раз в неделю ставит технарю оценку по 10-балльной
-- шкале на отдельной странице; никто не должен знать, кто поставил и сколько;
-- и обратно — технари оценивают ОС; оценка видна рядом с ABS и на визитке
-- технаря; Owner может выключить оценку и скрыть итоги кнопкой».
--
-- Анонимность держит БАЗА, а не интерфейс:
--   • weekly_ratings — строки «кто кому сколько». Читает ТОЛЬКО тот, кто
--     ставил (свою оценку ему показать можно — он её и так знает). Owner,
--     Тимлид и оценённый строк не видят; прямой записи нет ни у кого.
--   • weekly_rate() — поставить/сменить/снять оценку ТЕКУЩЕЙ недели (неделя —
--     ISO, по поясу компании rows_tz). Прошлые недели не правятся.
--   • weekly_rating_results() — наружу выходят только СРЕДНИЙ балл и число
--     оценивших по человеку, только за ЗАКРЫТЫЕ недели (живое среднее
--     текущей недели выдало бы, кто сколько поставил, по тому, как оно
--     сдвинулось) и только если оценивших не меньше порога (min_raters,
--     умолчание 3: при двух каждый из двоих вычислил бы оценку другого).
--   • weekly_rating_config — выключатели Owner: сбор оценок (enabled) и показ
--     итогов (visible). Скрытые итоги база не отдаёт никому, кроме Owner.
--
-- Направления: os_tech — ОС оценивает технаря; tech_os — технарь ОС.
-- «Технарь» — роль Технаря (основная или вторая) или Owner: столы Owner
-- считаются столами технаря (worksAsTechnician на клиенте).
--
-- Честная граница: Owner в SQL-редакторе Supabase видит таблицу целиком —
-- это доступ к самой базе, а не к приложению.
--
-- Скрипт повторяемый. Правки функций — только в этом файле или новее.
-- =====================================================================

create table if not exists public.weekly_ratings (
  workspace_id text not null references public.rows_workspaces (workspace_id) on delete cascade,
  week_key text not null check (week_key ~ '^[0-9]{4}-W[0-9]{2}$'),
  direction text not null check (direction in ('os_tech', 'tech_os')),
  rater_uid text not null,
  target_uid text not null,
  score smallint not null check (score between 1 and 10),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, week_key, direction, rater_uid, target_uid)
);

create index if not exists weekly_ratings_target_idx
  on public.weekly_ratings (workspace_id, week_key, direction, target_uid);

alter table public.weekly_ratings enable row level security;

drop policy if exists weekly_ratings_read_own on public.weekly_ratings;
create policy weekly_ratings_read_own on public.weekly_ratings for select to anon, authenticated
  using (rater_uid = (select public.rows_uid()));
-- Политик записи нет: пишет только weekly_rate() (SECURITY DEFINER).

-- Supabase по default privileges открывает новые таблицы ролям API целиком.
revoke all on public.weekly_ratings from public, anon, authenticated;
grant select on public.weekly_ratings to anon, authenticated;

create table if not exists public.weekly_rating_config (
  workspace_id text primary key references public.rows_workspaces (workspace_id) on delete cascade,
  enabled boolean not null default true,
  visible boolean not null default true,
  min_raters smallint not null default 3 check (min_raters between 2 and 10),
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.weekly_rating_config enable row level security;
-- Ни одной политики: настройку читают и пишут только функции ниже.
revoke all on public.weekly_rating_config from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Кто есть кто (по копии прав rows_members).
-- ---------------------------------------------------------------------
create or replace function public.weekly_is_os(ws text, u text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.rows_members m
    where m.workspace_id = ws and m.uid = u and (m.role = 'os' or 'os' = any (m.extra_roles))
  )
$$;

create or replace function public.weekly_is_tech(ws text, u text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.rows_members m
    where m.workspace_id = ws and m.uid = u and (m.role in ('manager', 'owner') or 'manager' = any (m.extra_roles))
  )
$$;

revoke all on function public.weekly_is_os(text, text) from public, anon, authenticated;
revoke all on function public.weekly_is_tech(text, text) from public, anon, authenticated;

-- Может ли u оценивать в этом направлении / можно ли оценить u.
create or replace function public.weekly_can_rate(ws text, dir text, u text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case dir
    when 'os_tech' then public.weekly_is_os(ws, u)
    when 'tech_os' then public.weekly_is_tech(ws, u)
    else false
  end
$$;

create or replace function public.weekly_can_be_rated(ws text, dir text, u text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case dir
    when 'os_tech' then public.weekly_is_tech(ws, u)
    when 'tech_os' then public.weekly_is_os(ws, u)
    else false
  end
$$;

revoke all on function public.weekly_can_rate(text, text, text) from public, anon, authenticated;
revoke all on function public.weekly_can_be_rated(text, text, text) from public, anon, authenticated;

-- Неделя по поясу компании: ключ ISO «2026-W39» и понедельник.
create or replace function public.weekly_monday(ws text) returns date
language sql stable security definer
set search_path = public, pg_temp
as $$
  select date_trunc('week', now() at time zone public.rows_tz(ws))::date
$$;

create or replace function public.weekly_key_of(d date) returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select to_char(d, 'IYYY-"W"IW')
$$;

revoke all on function public.weekly_monday(text) from public, anon, authenticated;
revoke all on function public.weekly_key_of(date) from public;
grant execute on function public.weekly_key_of(date) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Состояние для страницы: настройка, текущая неделя, мои оценки.
-- ---------------------------------------------------------------------
create or replace function public.weekly_rating_state(p_workspace text) returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  cfg public.weekly_rating_config%rowtype;
  monday date;
  wk text;
  owner boolean;
  res jsonb;
begin
  if me is null or not coalesce(public.rows_is_member(p_workspace), false) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  select * into cfg from public.weekly_rating_config c where c.workspace_id = p_workspace;
  monday := public.weekly_monday(p_workspace);
  wk := public.weekly_key_of(monday);
  owner := coalesce(public.rows_is_owner(p_workspace), false);

  res := jsonb_build_object(
    'enabled', coalesce(cfg.enabled, true),
    'visible', coalesce(cfg.visible, true),
    'minRaters', coalesce(cfg.min_raters, 3),
    'week', wk,
    'weekStart', to_char(monday, 'YYYY-MM-DD'),
    'weekEnd', to_char(monday + 6, 'YYYY-MM-DD'),
    'isOwner', owner,
    'canRate', jsonb_build_object(
      'os_tech', public.weekly_can_rate(p_workspace, 'os_tech', me),
      'tech_os', public.weekly_can_rate(p_workspace, 'tech_os', me)
    ),
    'mine', coalesce((
      select jsonb_agg(jsonb_build_object('direction', r.direction, 'target', r.target_uid, 'score', r.score))
      from public.weekly_ratings r
      where r.workspace_id = p_workspace and r.week_key = wk and r.rater_uid = me
    ), '[]'::jsonb)
  );

  -- Owner видит участие — сколько человек уже оценили за неделю (без имён
  -- и баллов), чтобы напомнить остальным.
  if owner then
    res := res || jsonb_build_object('progress', jsonb_build_object(
      'os_tech', jsonb_build_object(
        'rated', (select count(distinct r.rater_uid) from public.weekly_ratings r
                  where r.workspace_id = p_workspace and r.week_key = wk and r.direction = 'os_tech'),
        'raters', (select count(*) from public.rows_members m
                   where m.workspace_id = p_workspace and public.weekly_is_os(p_workspace, m.uid))
      ),
      'tech_os', jsonb_build_object(
        'rated', (select count(distinct r.rater_uid) from public.weekly_ratings r
                  where r.workspace_id = p_workspace and r.week_key = wk and r.direction = 'tech_os'),
        'raters', (select count(*) from public.rows_members m
                   where m.workspace_id = p_workspace and public.weekly_is_tech(p_workspace, m.uid))
      )
    ));
  end if;
  return res;
end;
$$;

revoke all on function public.weekly_rating_state(text) from public;
grant execute on function public.weekly_rating_state(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Поставить / сменить / снять (p_score = null) свою оценку текущей недели.
-- Отказы: 42501 — нет права / сбор выключен / компания приостановлена,
-- 22023 — балл вне 1–10, неизвестное направление, оценка самого себя.
-- ---------------------------------------------------------------------
create or replace function public.weekly_rate(
  p_workspace text,
  p_direction text,
  p_target text,
  p_score integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  wk text;
  n integer;
begin
  if me is null or not coalesce(public.rows_is_member(p_workspace), false) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  if p_direction is null or p_direction not in ('os_tech', 'tech_os') then
    raise exception 'unknown direction' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.rows_workspaces w
    where w.workspace_id = p_workspace and public.nova_tenant_active(w.status, w.trial_until)
  ) then
    raise exception 'workspace suspended' using errcode = '42501';
  end if;
  if not coalesce((select c.enabled from public.weekly_rating_config c where c.workspace_id = p_workspace), true) then
    raise exception 'weekly rating is off' using errcode = '42501';
  end if;
  if p_target is null or p_target = me then
    raise exception 'cannot rate yourself' using errcode = '22023';
  end if;
  if not public.weekly_can_rate(p_workspace, p_direction, me) then
    raise exception 'not a rater' using errcode = '42501';
  end if;
  if not public.weekly_can_be_rated(p_workspace, p_direction, p_target) then
    raise exception 'not a rateable member' using errcode = '42501';
  end if;

  wk := public.weekly_key_of(public.weekly_monday(p_workspace));

  if p_score is null then
    delete from public.weekly_ratings r
    where r.workspace_id = p_workspace and r.week_key = wk and r.direction = p_direction
      and r.rater_uid = me and r.target_uid = p_target;
    get diagnostics n = row_count;
    return jsonb_build_object('state', case when n > 0 then 'removed' else 'none' end, 'week', wk);
  end if;

  if p_score < 1 or p_score > 10 then
    raise exception 'score out of range' using errcode = '22023';
  end if;

  insert into public.weekly_ratings (workspace_id, week_key, direction, rater_uid, target_uid, score, updated_at)
  values (p_workspace, wk, p_direction, me, p_target, p_score, now())
  on conflict (workspace_id, week_key, direction, rater_uid, target_uid)
  do update set score = excluded.score, updated_at = excluded.updated_at;

  return jsonb_build_object('state', 'rated', 'week', wk, 'score', p_score);
end;
$$;

revoke all on function public.weekly_rate(text, text, text, integer) from public;
grant execute on function public.weekly_rate(text, text, text, integer) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Итоги: средний балл и число оценивших по человеку за последние p_weeks
-- ЗАКРЫТЫХ недель, только где оценивших не меньше порога.
-- Ответ: {"hidden", "minRaters", "weeks": [...новые первыми], "rows": [
--   {"week", "direction", "target", "avg", "count"}]}.
-- ---------------------------------------------------------------------
create or replace function public.weekly_rating_results(p_workspace text, p_weeks integer default 8) returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  cfg public.weekly_rating_config%rowtype;
  visible boolean;
  owner boolean;
  min_n integer;
  monday date;
  weeks text[];
  k integer := greatest(1, least(coalesce(p_weeks, 8), 26));
begin
  if me is null or not coalesce(public.rows_is_member(p_workspace), false) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  select * into cfg from public.weekly_rating_config c where c.workspace_id = p_workspace;
  visible := coalesce(cfg.visible, true);
  min_n := coalesce(cfg.min_raters, 3);
  owner := coalesce(public.rows_is_owner(p_workspace), false);
  monday := public.weekly_monday(p_workspace);
  select array_agg(public.weekly_key_of(monday - 7 * i) order by i)
    into weeks from generate_series(1, k) as i;

  if not visible and not owner then
    return jsonb_build_object('hidden', true, 'minRaters', min_n, 'weeks', to_jsonb(weeks), 'rows', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'hidden', not visible,
    'minRaters', min_n,
    'weeks', to_jsonb(weeks),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'week', g.week_key, 'direction', g.direction, 'target', g.target_uid,
        'avg', g.avg_score, 'count', g.cnt
      ))
      from (
        select r.week_key, r.direction, r.target_uid,
               round(avg(r.score)::numeric, 1) as avg_score, count(*)::integer as cnt
        from public.weekly_ratings r
        where r.workspace_id = p_workspace and r.week_key = any (weeks)
        group by r.week_key, r.direction, r.target_uid
        having count(*) >= min_n
      ) g
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.weekly_rating_results(text, integer) from public;
grant execute on function public.weekly_rating_results(text, integer) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Выключатели Owner. null — не менять.
-- ---------------------------------------------------------------------
create or replace function public.weekly_rating_set_config(
  p_workspace text,
  p_enabled boolean default null,
  p_visible boolean default null,
  p_min_raters integer default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  cfg public.weekly_rating_config%rowtype;
begin
  if me is null or not coalesce(public.rows_is_owner(p_workspace), false) then
    raise exception 'only owner' using errcode = '42501';
  end if;
  if p_min_raters is not null and (p_min_raters < 2 or p_min_raters > 10) then
    raise exception 'min raters out of range' using errcode = '22023';
  end if;
  insert into public.weekly_rating_config as c (workspace_id, enabled, visible, min_raters, updated_at, updated_by)
  values (p_workspace, coalesce(p_enabled, true), coalesce(p_visible, true), coalesce(p_min_raters, 3), now(), me)
  on conflict (workspace_id) do update set
    enabled = coalesce(p_enabled, c.enabled),
    visible = coalesce(p_visible, c.visible),
    min_raters = coalesce(p_min_raters, c.min_raters),
    updated_at = now(),
    updated_by = me
  returning * into cfg;
  return jsonb_build_object('enabled', cfg.enabled, 'visible', cfg.visible, 'minRaters', cfg.min_raters);
end;
$$;

revoke all on function public.weekly_rating_set_config(text, boolean, boolean, integer) from public;
grant execute on function public.weekly_rating_set_config(text, boolean, boolean, integer) to anon, authenticated;

-- ---------------------------------------------------------------------
create or replace function public.nova_schema_version() returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select '20261032'
$$;
revoke all on function public.nova_schema_version() from public, anon, authenticated;
grant execute on function public.nova_schema_version() to anon, authenticated;
