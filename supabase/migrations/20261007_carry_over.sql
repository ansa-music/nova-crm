-- =====================================================================
-- Nova CRM — перенос незавершённых заказов в новый период (26.09.2026).
--
-- Просьба Nurba: «продумать перенос заказов, которые остались в работе, на
-- следующий месяц; чтобы перенос каждый раз был удобным». Строки ПЕРЕЕЗЖАЮТ
-- целиком (тот же id, все поля) во вкладку нового периода; старый период их
-- больше не считает (архив пересчитывается по оставшимся), новый — считает.
--
--   А. desk_rows.carried_from / carried_at — откуда и когда переехала строка
--      (метка «перенос» в таблице).
--   Б. rows_carry_over(ws, page, from_tab, to_tab, rows[]) — SECURITY DEFINER:
--      право — редактор стола (rows_edit_all_workspaces / rows_editable_pages),
--      живое хранилище; переносит строки и чинит адреса: у источников на
--      столе ОС — mirror_tab_id, у копий перенесённых источников — src_tab_id,
--      у оценок — tab_id. Ответ {"moved": [...], "skipped": [...]} (skipped —
--      id уже есть в целевой вкладке).
--   В. desk_rows_guard — полная копия из 20261002 (правило: guard правится
--      только в самом новом файле) с одной веткой: под GUC nova.carry_over
--      пропускаются правки, где не менялись содержимое и опорные поля
--      (нужно ради src_tab_id копий — иначе «поля заказа меняет только Owner»).
--   Г. desk_load_rearchive(ws, page, month_key, sub_page_id, data) — после
--      переноса клиент пересчитывает старый период по ОСТАВШИМСЯ строкам и
--      кладёт в desk_load_history (сюда клиент напрямую не пишет); если стол
--      ещё не опубликовал новый период — правится и живая строка desk_loads,
--      её потом заархивирует триггер. Так порядок «перенос ↔ первая
--      публикация нового периода» неважен.
--   Д. nova_schema_version() = '20261007'.
-- Скрипт повторяемый. Правки guard и rows_carry_over — только здесь или новее.
-- =====================================================================

-- ---------------------------------------------------------------------
-- А. Метка переноса.
-- ---------------------------------------------------------------------
alter table public.desk_rows
  add column if not exists carried_from text,
  add column if not exists carried_at bigint;

-- ---------------------------------------------------------------------
-- Б. Перенос строк в другую вкладку того же стола.
-- ---------------------------------------------------------------------
create or replace function public.rows_carry_over(
  p_workspace text,
  p_page text,
  p_from_tab text,
  p_to_tab text,
  p_rows text[]
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  from_tab text := coalesce(p_from_tab, '');
  to_tab text := coalesce(p_to_tab, '');
  base double precision;
  now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  moved text[];
begin
  if me is null then
    raise exception 'no token' using errcode = '42501';
  end if;
  if from_tab = to_tab then
    raise exception 'same tab' using errcode = '22023';
  end if;
  if p_workspace not in (select public.rows_writable_workspaces()) then
    raise exception 'rows storage is not writable' using errcode = '42501';
  end if;
  if not (p_workspace in (select public.rows_edit_all_workspaces())
          or (p_workspace, p_page) in (select e.workspace_id, e.page_id from public.rows_editable_pages() e)) then
    raise exception 'not a desk editor' using errcode = '42501';
  end if;
  if coalesce(array_length(p_rows, 1), 0) = 0 then
    return jsonb_build_object('moved', '[]'::jsonb, 'skipped', '[]'::jsonb);
  end if;

  perform set_config('nova.carry_over', '1', true);
  base := public.rows_append_order(p_workspace, p_page, to_tab);

  with src as (
    select r.id, row_number() over (order by r.sort_order, r.created_at, r.id) - 1 as n
    from public.desk_rows r
    where r.workspace_id = p_workspace and r.page_id = p_page and r.tab_id = from_tab and r.id = any (p_rows)
      and not exists (
        select 1 from public.desk_rows t
        where t.workspace_id = p_workspace and t.page_id = p_page and t.tab_id = to_tab and t.id = r.id
      )
  ), upd as (
    update public.desk_rows d
    set tab_id = to_tab,
        sort_order = base + src.n,
        carried_from = from_tab,
        carried_at = now_ms,
        updated_at = now_ms
    from src
    where d.workspace_id = p_workspace and d.page_id = p_page and d.tab_id = from_tab and d.id = src.id
    returning d.id
  )
  select coalesce(array_agg(id order by id), '{}'::text[]) into moved from upd;

  -- Адреса: источник на столе ОС смотрит на копию → новая вкладка копии.
  update public.desk_rows s
  set mirror_tab_id = to_tab
  where s.workspace_id = p_workspace and s.mirror_page_id = p_page
    and coalesce(s.mirror_tab_id, '') = from_tab and s.mirror_row_id = any (moved);
  -- Копии перенесённых источников (перенос на столе ОС) → новая вкладка источника.
  update public.desk_rows c
  set src_tab_id = to_tab
  where c.workspace_id = p_workspace and c.src_page_id = p_page
    and coalesce(c.src_tab_id, '') = from_tab and c.src_row_id = any (moved);
  -- Оценка заказа ключуется адресом строки; её период (month_key) не меняем.
  update public.order_ratings o
  set tab_id = to_tab
  where o.workspace_id = p_workspace and o.page_id = p_page and o.tab_id = from_tab and o.row_id = any (moved)
    and not exists (
      select 1 from public.order_ratings x
      where x.workspace_id = p_workspace and x.page_id = p_page and x.tab_id = to_tab and x.row_id = o.row_id
    );

  return jsonb_build_object(
    'moved', to_jsonb(moved),
    'skipped', to_jsonb(array(select s.x from (select unnest(p_rows) as x except select unnest(moved)) s order by s.x))
  );
end;
$$;

revoke all on function public.rows_carry_over(text, text, text, text, text[]) from public;
grant execute on function public.rows_carry_over(text, text, text, text, text[]) to anon, authenticated;

-- ---------------------------------------------------------------------
-- В. Замок строки-заказа: копия из 20261002 + ветка переноса (см. шапку).
-- ---------------------------------------------------------------------
create or replace function public.desk_rows_guard() returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  is_owner boolean := new.workspace_id in (select public.rows_edit_all_workspaces());
  changed text[];
  allowed text[] := array['techLink', 'techNote'];
  release_key text;
begin
  -- ПЕРЕНОС в новый период (rows_carry_over, 20261007): функция ставит GUC
  -- nova.carry_over на транзакцию и меняет только адресные поля (tab_id,
  -- sort_order, carried_*, mirror_tab_id / src_tab_id) — содержимое строки и
  -- опорные поля заказа при этом не трогаются, что и проверяется ниже. Через
  -- PostgREST set_config недоступен, так что снаружи ветку не включить.
  if tg_op = 'UPDATE' and coalesce(current_setting('nova.carry_over', true), '') = '1'
     and new.cells is not distinct from old.cells
     and new.extras is not distinct from old.extras
     and new.attachments is not distinct from old.attachments
     and new.os_uid is not distinct from old.os_uid
     and new.tech_uid is not distinct from old.tech_uid
     and new.status_key is not distinct from old.status_key
     and new.src_page_id is not distinct from old.src_page_id
     and new.src_row_id is not distinct from old.src_row_id
     and new.order_id is not distinct from old.order_id
     and new.sync_hash is not distinct from old.sync_hash
     and new.filled_at is not distinct from old.filled_at then
    return new;
  end if;

  -- Вставка: строку-заказ (с os_uid) заводит только её ОС или Owner. Иначе
  -- технарь пометил бы свою строку чужим os_uid и правил бы статус вечно —
  -- политика вставки в свой стол его пускает, а замок смотрит на os_uid.
  if tg_op = 'INSERT' then
    -- Без токена (SQL-редактор, миграции, сервисный ключ) человека нет —
    -- ограничивать некого; RLS для таких сессий решает сама.
    if me is null then
      return new;
    end if;
    if new.os_uid is not null and not is_owner
       and (new.os_uid <> me or not public.rows_has_role(new.workspace_id, 'os')) then
      raise exception 'desk_rows: строку-заказ заводит её ОС' using errcode = '42501';
    end if;
    return new;
  end if;

  -- Не строка-заказ и ею не становится — обычная правка, решает политика.
  if old.os_uid is null and new.os_uid is null then
    return new;
  end if;

  -- Owner может всё, включая снятие управления со строки (аварийный выход,
  -- если ОС уволился или недоступен, а заказ надо закрыть).
  if is_owner then
    return new;
  end if;

  -- ОС возвращает свою строку технарю (rows_os_release_claim; политика
  -- правки сама такую запись не пропустит — у новой строки нет os_uid).
  -- Снимается РОВНО метка заказа; из ячеек можно только стереть значение
  -- столбца ОС этой вкладки (свой ник — «не мой заказ»).
  if old.os_uid is not null and new.os_uid is null and old.os_uid = me then
    if new.tech_uid is not null or new.status_key is not null
       or new.src_page_id is not null or new.src_tab_id is not null or new.src_row_id is not null
       or new.extras is distinct from old.extras
       or new.attachments is distinct from old.attachments
       or new.order_id is distinct from old.order_id
       or new.filled_at is distinct from old.filled_at then
      raise exception 'desk_rows: вернуть строку технарю — значит снять только метку заказа' using errcode = '42501';
    end if;
    changed := array(
      select coalesce(o.key, n.key)
      from jsonb_each(coalesce(old.cells, '{}'::jsonb)) o
      full outer join jsonb_each(coalesce(new.cells, '{}'::jsonb)) n on n.key = o.key
      where o.value is distinct from n.value
    );
    if coalesce(array_length(changed, 1), 0) > 0 then
      select a.os_key into release_key from public.rows_page_acl a
      where a.workspace_id = old.workspace_id and a.page_id = old.page_id and a.os_keys_tab = old.tab_id;
      if release_key is null or not (changed <@ array[release_key])
         or coalesce(new.cells ->> release_key, '') <> '' then
        raise exception 'desk_rows: вернуть строку технарю — стирается только свой ник ОС' using errcode = '42501';
      end if;
    end if;
    return new;
  end if;

  -- Взять строку под управление может только сам ОС и только на себя.
  if old.os_uid is null and new.os_uid is not null then
    if new.os_uid <> me or not public.rows_has_role(new.workspace_id, 'os') then
      raise exception 'desk_rows: строку-заказ заводит её ОС' using errcode = '42501';
    end if;
    return new;
  end if;

  -- Дальше строка уже управляемая. Опорные поля не переписываются никем,
  -- кроме Owner: иначе замок снимается переписыванием замка.
  if new.os_uid is distinct from old.os_uid
     or new.tech_uid is distinct from old.tech_uid
     or new.status_key is distinct from old.status_key
     or new.src_page_id is distinct from old.src_page_id
     or new.src_tab_id is distinct from old.src_tab_id
     or new.src_row_id is distinct from old.src_row_id then
    raise exception 'desk_rows: поля строки-заказа меняет только Owner' using errcode = '42501';
  end if;

  -- ОС этой строки — хозяин её содержимого.
  if old.os_uid = me then
    return new;
  end if;

  -- Какие ячейки изменились.
  changed := array(
    select coalesce(o.key, n.key)
    from jsonb_each(coalesce(old.cells, '{}'::jsonb)) o
    full outer join jsonb_each(coalesce(new.cells, '{}'::jsonb)) n on n.key = o.key
    where o.value is distinct from n.value
  );

  -- Тимлид: ровно статус (по ключу из строки) и снятие просьбы об «Успешке».
  if public.rows_is_teamlead(old.workspace_id) then
    if not (changed <@ array[old.status_key]) then
      raise exception 'desk_rows: Тимлид меняет в строке-заказе только статус' using errcode = '42501';
    end if;
    if new.extras is distinct from old.extras
       or new.attachments is distinct from old.attachments
       or new.order_id is distinct from old.order_id
       or new.sync_hash is distinct from old.sync_hash then
      raise exception 'desk_rows: Тимлид меняет в строке-заказе только статус' using errcode = '42501';
    end if;
    return new;
  end if;

  -- Технарь заполняет сам (Owner так решил для всех или для этого стола):
  -- ячейки, визитку и вложения строки ОС он правит, статус проход стола ОС
  -- подтянет к ОС. Служебные поля заказа — нет: по ним ОС узнаёт свою копию.
  if public.rows_tech_fills(old.workspace_id, old.page_id) then
    if new.order_id is distinct from old.order_id
       or new.sync_hash is distinct from old.sync_hash then
      raise exception 'desk_rows: служебные поля заказа меняет ОС' using errcode = '42501';
    end if;
    if new.success_requested_by is distinct from old.success_requested_by
       and new.success_requested_by is not null
       and new.success_requested_by <> me then
      raise exception 'desk_rows: просьбу об «Успешке» оставляют за себя' using errcode = '42501';
    end if;
    return new;
  end if;

  -- Технарь: свои поля и просьба об «Успешке».
  if not (changed <@ allowed) then
    raise exception 'desk_rows: статус, цену и клиента в этой строке ведёт ОС' using errcode = '42501';
  end if;
  if new.extras is distinct from old.extras
     or new.order_id is distinct from old.order_id
     or new.sync_hash is distinct from old.sync_hash
     or new.filled_at is distinct from old.filled_at then
    raise exception 'desk_rows: эту строку ведёт ОС' using errcode = '42501';
  end if;
  -- Просить «Успешку» можно только за себя.
  if new.success_requested_by is distinct from old.success_requested_by
     and new.success_requested_by is not null
     and new.success_requested_by <> me then
    raise exception 'desk_rows: просьбу об «Успешке» оставляют за себя' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists desk_rows_guard on public.desk_rows;
create trigger desk_rows_guard before insert or update on public.desk_rows
  for each row execute function public.desk_rows_guard();

-- ---------------------------------------------------------------------
-- Г. Переархив прошлого периода после переноса.
-- ---------------------------------------------------------------------
create or replace function public.desk_load_rearchive(
  p_workspace text,
  p_page text,
  p_month_key text,
  p_sub_page_id text,
  p_data jsonb
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  resp text;
  live_key text;
  cur_max text := to_char(now() at time zone 'Asia/Almaty', 'YYYY-MM') || '-2';
  clean jsonb;
begin
  if me is null then
    raise exception 'no token' using errcode = '42501';
  end if;
  if p_month_key !~ '^[0-9]{4}-[0-9]{2}(-[12])?$' or p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'bad period or data' using errcode = '22023';
  end if;
  if p_workspace not in (select public.rows_writable_workspaces()) then
    raise exception 'rows storage is not writable' using errcode = '42501';
  end if;
  if not (p_workspace in (select public.rows_edit_all_workspaces())
          or (p_workspace, p_page) in (select e.workspace_id, e.page_id from public.rows_editable_pages() e)) then
    raise exception 'not a desk editor' using errcode = '42501';
  end if;
  select r.responsible_uid into resp from public.rows_page_responsibles() r
  where r.workspace_id = p_workspace and r.page_id = p_page;
  if resp is null then
    raise exception 'desk has no responsible' using errcode = '42501';
  end if;
  if p_month_key > cur_max then
    raise exception 'future period' using errcode = '22023';
  end if;
  select l.month_key into live_key from public.desk_loads l
  where l.workspace_id = p_workspace and l.page_id = p_page;
  if live_key is not null and p_month_key > live_key then
    raise exception 'period is newer than the live counts' using errcode = '22023';
  end if;

  clean := p_data - array['pageId', 'workspaceId', 'responsibleUserId', 'monthKey', 'subPageId', 'updatedAt', 'updatedBy', 'archivedAt'];

  -- Стол ещё не опубликовал новый период: живые цифры тоже правятся, их
  -- потом заархивирует триггер desk_loads_guard.
  if live_key = p_month_key then
    update public.desk_loads l
    set data = clean, sub_page_id = coalesce(p_sub_page_id, l.sub_page_id), updated_by = me
    where l.workspace_id = p_workspace and l.page_id = p_page;
  end if;

  insert into public.desk_load_history as h
    (workspace_id, page_id, month_key, responsible_uid, sub_page_id, data, updated_by, archived_at, counts_at)
  values (p_workspace, p_page, p_month_key, resp, p_sub_page_id, clean, me, now(), now())
  on conflict (workspace_id, page_id, month_key) do update set
    responsible_uid = excluded.responsible_uid,
    sub_page_id = excluded.sub_page_id,
    data = excluded.data,
    updated_by = excluded.updated_by,
    archived_at = excluded.archived_at,
    counts_at = excluded.counts_at;
end;
$$;

revoke all on function public.desk_load_rearchive(text, text, text, text, jsonb) from public;
grant execute on function public.desk_load_rearchive(text, text, text, text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Д. Версия схемы.
-- ---------------------------------------------------------------------
create or replace function public.nova_schema_version() returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select '20261007'::text
$$;

revoke all on function public.nova_schema_version() from public, anon, authenticated;
grant execute on function public.nova_schema_version() to anon, authenticated;
