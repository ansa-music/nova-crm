-- =====================================================================
-- Nova CRM — оценка заказа, одна система, 10 баллов (25.09.2026).
--
-- Просьба Nurba: «переделай систему оценок технарей — оставь только одну:
-- оценка на каждый заказ; сейчас ОС почему-то не могут оценивать; сделай
-- 10-балльную». Было две шкалы по 1–5 в Firestore (общая techRatings и
-- orderRatings), и право оценить правила Firestore выводили из счётчиков
-- стола (deskLoad.osLastOrderAt) — документа, который в режиме Supabase
-- лишь догоняет строки и который не пишется вовсе, когда кончилась дневная
-- квота Firestore (25.09.2026). Здесь право проверяется по САМОЙ строке
-- заказа в desk_rows: она и есть доказательство «заказ мой».
--
--   А. order_ratings — одна оценка на строку-заказ стола технаря
--      (ключ — адрес строки), score 1–10, месяц заказа, снимок названия.
--      Читают: ОС, который ставил; технарь, которого оценили; Owner.
--      Тимлид — нет (в строке название заказа, а содержимого столов
--      Тимлид не видит). Клиент напрямую НЕ пишет — только rate_order().
--   Б. rate_order(ws, page, tab, row, score, title, month) — SECURITY
--      DEFINER: ставит/меняет/снимает (score = null) оценку. Ставить может
--      только ОС этого заказа: строка ведётся им (os_uid = я) или, если
--      заказ ещё не подхвачен, в НАСТОЯЩЕМ столбце ОС этой вкладки
--      (rows_page_acl.os_key, os_keys_tab = вкладка) стоит мой ник ОС.
--      Снять: свою — ОС, любую — Owner и Тимлид.
--   В. order_rating_totals(ws, months[]) — сумма и число оценок по парам
--      ОС × технарь за месяцы. Любой участник: средним светит «Дашборд» и
--      «Технари» всем, а содержимого заказов тут нет.
--   Г. nova_schema_version() = '20261005'.
--
-- Скрипт повторяемый. Правки rate_order — только в этом файле или новее.
-- =====================================================================

create table if not exists public.order_ratings (
  workspace_id text not null references public.rows_workspaces (workspace_id) on delete cascade,
  page_id text not null,
  tab_id text not null default '',
  row_id text not null,
  -- Кто ставил и кому. tech_uid — владелец строки (tech_uid строки-заказа
  -- или ответственный за стол) В МОМЕНТ оценки.
  os_uid text not null,
  os_value text not null default '',
  tech_uid text not null,
  score smallint not null check (score between 1 and 10),
  -- Месяц, за который заказ считается («YYYY-MM»): месяц вкладки, а не
  -- день оценки — заказ 30-го, оценённый 1-го, остаётся в своём месяце.
  month_key text not null check (month_key ~ '^[0-9]{4}-[0-9]{2}$'),
  title text not null default '',
  created_at bigint not null,
  updated_at bigint not null,
  primary key (workspace_id, page_id, tab_id, row_id)
);

create index if not exists order_ratings_month_idx on public.order_ratings (workspace_id, month_key);
create index if not exists order_ratings_os_idx on public.order_ratings (workspace_id, os_uid, month_key);
create index if not exists order_ratings_tech_idx on public.order_ratings (workspace_id, tech_uid, month_key);

alter table public.order_ratings enable row level security;

drop policy if exists order_ratings_read on public.order_ratings;
create policy order_ratings_read on public.order_ratings for select to anon, authenticated
  using (
    os_uid = (select public.rows_uid())
    or tech_uid = (select public.rows_uid())
    or workspace_id in (select public.rows_owned_workspaces())
  );
-- Политик записи нет: пишет только rate_order() (SECURITY DEFINER).

-- Supabase по default privileges открывает новые таблицы ролям API целиком
-- (урок nova_rev_seq) — оставляем ровно чтение.
revoke all on public.order_ratings from public, anon, authenticated;
grant select on public.order_ratings to anon, authenticated;

-- ---------------------------------------------------------------------
-- Б. Поставить / сменить / снять оценку.
-- Ответ: {"state": "rated" | "removed" | "none", "score", "monthKey", "techUid"}.
-- Отказы — исключениями с кодом: 42501 (нет права), P0002 (строки нет),
-- 22023 (балл вне 1–10).
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

  month := case
    when tab ~ '^month-[0-9]{4}-[0-9]{2}$' then substr(tab, 7)
    when had_prev then prev.month_key
    when p_month in (cur_month, prev_month) then p_month
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
-- В. Итоги для всех участников: пары ОС × технарь × месяц.
-- ---------------------------------------------------------------------
create or replace function public.order_rating_totals(p_workspace text, p_months text[])
returns table (os_uid text, tech_uid text, month_key text, cnt integer, total integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select o.os_uid, o.tech_uid, o.month_key, count(*)::integer, sum(o.score)::integer
  from public.order_ratings o
  where coalesce(public.rows_is_member(p_workspace), false)
    and o.workspace_id = p_workspace
    and o.month_key = any (coalesce(p_months, '{}'::text[]))
  group by o.os_uid, o.tech_uid, o.month_key
$$;

revoke all on function public.order_rating_totals(text, text[]) from public;
grant execute on function public.order_rating_totals(text, text[]) to anon, authenticated;
grant execute on function public.rows_owned_workspaces() to anon, authenticated;

-- ---------------------------------------------------------------------
-- Г. Версия схемы.
-- ---------------------------------------------------------------------
create or replace function public.nova_schema_version() returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select '20261005'::text
$$;

revoke all on function public.nova_schema_version() from public, anon, authenticated;
grant execute on function public.nova_schema_version() to anon, authenticated;
