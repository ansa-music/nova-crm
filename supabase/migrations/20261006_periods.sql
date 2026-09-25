-- =====================================================================
-- Nova CRM — периоды столов: целый месяц или две половины (26.09.2026).
--
-- Просьба Nurba: «месяцы теперь будут разделены на 2 — с 1-го по 15-е,
-- потом до конца; оценка, дашборд и ABS тоже делятся на 2 в месяц».
-- Ключ периода — строка, которой раньше был ключ месяца `YYYY-MM`:
--   • целый месяц — `2026-09` (как было);
--   • половины   — `2026-10-1` (1..splitDay) и `2026-10-2` (splitDay+1..конец).
-- Лексический порядок верный: `2026-09 < 2026-10-1 < 2026-10-2 < 2026-11`,
-- поэтому стражи «прошлый месяц поверх нового не пишется» (desk_loads,
-- os_orders) и выборки `>= from` работают без правок. Меняются только:
--   А. проверки формата month_key в desk_loads, desk_load_history,
--      os_orders, order_ratings — теперь `^[0-9]{4}-[0-9]{2}(-[12])?$`;
--   Б. rate_order — месяц оценки читается и из id вкладки половины
--      (`month-2026-10-2`), а присланный ключ принимается, если его
--      месяц — текущий или прошлый по Алматы;
--   В. nova_schema_version() = '20261006'.
-- Правки rate_order — только здесь или в файле новее.
-- Скрипт повторяемый.
-- =====================================================================

-- ---------------------------------------------------------------------
-- А. Формат ключа периода.
-- ---------------------------------------------------------------------
do $$
declare
  t text;
  c record;
begin
  foreach t in array array['desk_loads', 'desk_load_history', 'os_orders', 'order_ratings'] loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    for c in
      select conname from pg_constraint
      where conrelid = ('public.' || t)::regclass and contype = 'c'
        and pg_get_constraintdef(oid) like '%month_key ~%'
    loop
      execute format('alter table public.%I drop constraint %I', t, c.conname);
    end loop;
    execute format(
      'alter table public.%I add constraint %I check (month_key ~ ''^[0-9]{4}-[0-9]{2}(-[12])?$'')',
      t, t || '_month_key_check'
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Б. rate_order — копия из 20261005 с периодами (см. шапку).
-- ---------------------------------------------------------------------
create or replace function public.rate_order(
  p_workspace text,
  p_page text,
  p_tab text,
  p_row text,
  p_score integer,
  p_title text default '',
  p_month text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  tab text := coalesce(p_tab, '');
  r public.desk_rows%rowtype;
  acl public.rows_page_acl%rowtype;
  prev public.order_ratings%rowtype;
  had_prev boolean;
  nick text;
  mine boolean := false;
  tech text;
  month text;
  cur_month text := to_char(now() at time zone 'Asia/Almaty', 'YYYY-MM');
  prev_month text := to_char((date_trunc('month', now() at time zone 'Asia/Almaty') - interval '1 day'), 'YYYY-MM');
  now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if me is null or not coalesce(public.rows_is_member(p_workspace), false) then
    raise exception 'not a member' using errcode = '42501';
  end if;

  select * into prev from public.order_ratings o
  where o.workspace_id = p_workspace and o.page_id = p_page and o.tab_id = tab and o.row_id = p_row;
  had_prev := found;

  -- Снять оценку.
  if p_score is null then
    if not had_prev then
      return jsonb_build_object('state', 'none');
    end if;
    if prev.os_uid <> me
       and not coalesce(public.rows_is_owner(p_workspace), false)
       and not coalesce(public.rows_is_teamlead(p_workspace), false) then
      raise exception 'not your rating' using errcode = '42501';
    end if;
    delete from public.order_ratings o
    where o.workspace_id = p_workspace and o.page_id = p_page and o.tab_id = tab and o.row_id = p_row;
    return jsonb_build_object('state', 'removed', 'monthKey', prev.month_key, 'techUid', prev.tech_uid);
  end if;

  if p_score < 1 or p_score > 10 then
    raise exception 'score out of range' using errcode = '22023';
  end if;

  -- Живое хранилище: после отката строк в Firestore здесь лежит архив.
  if not exists (select 1 from public.rows_workspaces w where w.workspace_id = p_workspace and w.live) then
    raise exception 'rows storage is not live' using errcode = '42501';
  end if;

  select * into r from public.desk_rows d
  where d.workspace_id = p_workspace and d.page_id = p_page and d.tab_id = tab and d.id = p_row;
  if not found then
    raise exception 'order row not found' using errcode = 'P0002';
  end if;

  select * into acl from public.rows_page_acl a where a.workspace_id = p_workspace and a.page_id = p_page;
  -- Оценивается заказ У ТЕХНАРЯ: строка самого стола ОС — это продажа, не работа.
  if coalesce(acl.os_desk, false) or p_page like 'osdesk\_%' then
    raise exception 'not a technician desk' using errcode = '42501';
  end if;

  select n.os_value into nick from public.rows_my_os_nicks() n where n.workspace_id = p_workspace limit 1;

  if coalesce(r.os_uid, '') <> '' then
    -- Заказ ведёт ОС — оценивает он и только он.
    mine := r.os_uid = me;
  else
    -- Заказ ещё не подхвачен: мой ник в настоящем столбце ОС этой вкладки.
    mine := coalesce(nick, '') <> ''
      and coalesce(public.rows_has_role(p_workspace, 'os'), false)
      and acl.os_key is not null
      and acl.os_keys_tab = tab
      and btrim(coalesce(r.cells ->> acl.os_key, '')) = nick;
  end if;
  if not mine then
    raise exception 'not your order' using errcode = '42501';
  end if;

  tech := coalesce(nullif(r.tech_uid, ''), acl.responsible_uid);
  if tech is null or tech = '' or tech = me then
    raise exception 'no technician to rate' using errcode = '42501';
  end if;

  -- Период оценки: из id вкладки (`month-2026-10` или `month-2026-10-2`),
  -- иначе прежний, иначе присланный ключ периода текущего/прошлого месяца.
  month := case
    when tab ~ '^month-[0-9]{4}-[0-9]{2}(-[12])?$' then substr(tab, 7)
    when had_prev then prev.month_key
    when p_month ~ '^[0-9]{4}-[0-9]{2}(-[12])?$' and left(p_month, 7) in (cur_month, prev_month) then p_month
    else cur_month
  end;

  insert into public.order_ratings as o (
    workspace_id, page_id, tab_id, row_id, os_uid, os_value, tech_uid, score, month_key, title, created_at, updated_at
  ) values (
    p_workspace, p_page, tab, p_row, me, coalesce(nick, ''), tech, p_score, month,
    left(coalesce(p_title, ''), 120), now_ms, now_ms
  )
  on conflict (workspace_id, page_id, tab_id, row_id) do update set
    os_uid = excluded.os_uid,
    os_value = excluded.os_value,
    tech_uid = excluded.tech_uid,
    score = excluded.score,
    title = case when excluded.title <> '' then excluded.title else o.title end,
    month_key = o.month_key,
    updated_at = excluded.updated_at;

  return jsonb_build_object('state', 'rated', 'score', p_score, 'monthKey', month, 'techUid', tech);
end;
$$;

revoke all on function public.rate_order(text, text, text, text, integer, text, text) from public;
grant execute on function public.rate_order(text, text, text, text, integer, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- В. Версия схемы.
-- ---------------------------------------------------------------------
create or replace function public.nova_schema_version() returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select '20261006'::text
$$;

revoke all on function public.nova_schema_version() from public, anon, authenticated;
grant execute on function public.nova_schema_version() to anon, authenticated;
