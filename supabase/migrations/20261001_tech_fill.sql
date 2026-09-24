-- ======================================================================
-- «Технари заполняют сами» (просьба Nurba 24.09.2026)
--
-- Owner на отдельной вкладке «Правка столов» решает, кто заполняет столы
-- технарей: «заказы ведёт ОС» (технарь правит только ссылку и примечание,
-- просит «Успешку») или «технари заполняют сами» — всем разом или выборочно
-- (стол-исключение, rows_os_exempt). До этого файла выборочное разрешение
-- открывало технарю только его СОБСТВЕННЫЕ строки, а строки-заказы, которые
-- выдал ОС, оставались запертыми навсегда — а у технаря почти все строки
-- такие. Отсюда «функция есть, но не работает».
--
-- Режимы workspace (rows_set_desk_mode, только Owner):
--   'os'    — заказы ведёт ОС: os_managed = true, tech_fills_all = false;
--   'tech'  — технари заполняют сами, и строки ОС тоже: os_managed = false,
--             tech_fills_all = true;
--   'mixed' — как было до 24.09: свои строки технарь правит, строки ОС — нет.
-- Выборочно (стол-исключение) технарь заполняет сам В ЛЮБОМ режиме.
--
-- Статус, который технарь поставил в строке ОС, проход стола ОС сам
-- подтягивает к ОС (planOsDispatch → pull). Опорные поля строки-заказа
-- (os_uid, tech_uid, status_key, src_*) и служебные (order_id, sync_hash)
-- технарь не меняет и здесь: иначе замок снимался бы переписыванием замка.
--
-- desk_rows_guard ЗАМЕНЯЕТСЯ целиком (create or replace): файлы накатываются
-- по порядку имён, и этот идёт после 20260923_desk_rows.sql. Правки guard
-- делать ЗДЕСЬ, не в 20260923 — там осталась прежняя версия, которую этот
-- файл перекрывает. Повторяемый.
-- ======================================================================

alter table public.rows_workspaces
  add column if not exists tech_fills_all boolean not null default false;

-- Стол, где технарь заполняет сам: весь workspace в режиме 'tech' или
-- стол-исключение. Функцией, а не набором: зовёт её только триггер одной
-- правящейся строки, не политика на каждую строку выборки.
create or replace function public.rows_tech_fills(p_workspace text, p_page text) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select w.tech_fills_all from public.rows_workspaces w where w.workspace_id = p_workspace), false)
      or exists (select 1 from public.rows_os_exempt x where x.workspace_id = p_workspace and x.page_id = p_page)
$$;

create or replace function public.rows_desk_mode(p_workspace text) returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when w.tech_fills_all then 'tech' when w.os_managed then 'os' else 'mixed' end
  from public.rows_workspaces w
  where w.workspace_id = p_workspace
$$;

-- Один переключатель на оба флага: два отдельных вызова оставили бы после
-- сбоя посередине «и ОС ведёт, и технари заполняют».
create or replace function public.rows_set_desk_mode(p_workspace text, p_mode text) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not coalesce(public.rows_is_owner(p_workspace), false) then
    raise exception 'rows_set_desk_mode: только Owner' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('os', 'tech', 'mixed') then
    raise exception 'rows_set_desk_mode: режим os | tech | mixed' using errcode = '22023';
  end if;
  update public.rows_workspaces
    set os_managed = (p_mode = 'os'), tech_fills_all = (p_mode = 'tech')
    where workspace_id = p_workspace;
  if not found then
    raise exception 'rows_set_desk_mode: workspace не заведён' using errcode = 'P0002';
  end if;
end;
$$;

-- Старый переключатель (вкладки на прежнем коде до перезагрузки): включение
-- «заказы ведёт ОС» гасит «технари заполняют сами», иначе оба флага стояли бы
-- разом.
create or replace function public.rows_set_os_managed(p_workspace text, p_on boolean) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not coalesce(public.rows_is_owner(p_workspace), false) then
    raise exception 'rows_set_os_managed: только Owner' using errcode = '42501';
  end if;
  update public.rows_workspaces
    set os_managed = p_on, tech_fills_all = case when p_on then false else tech_fills_all end
    where workspace_id = p_workspace;
  if not found then
    raise exception 'rows_set_os_managed: workspace не заведён' using errcode = 'P0002';
  end if;
end;
$$;

-- ----------------------------------------------------------------------
-- Замок строки-заказа. Та же логика, что в 20260923_desk_rows.sql, плюс
-- ветка «технарь заполняет сам» перед веткой технаря.
-- ----------------------------------------------------------------------
create or replace function public.desk_rows_guard() returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  is_owner boolean := new.workspace_id in (select public.rows_edit_all_workspaces());
  changed text[];
  allowed text[] := array['techLink', 'techNote'];
begin
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

grant execute on function
  public.rows_tech_fills(text, text),
  public.rows_desk_mode(text),
  public.rows_set_desk_mode(text, text),
  public.rows_set_os_managed(text, boolean)
  to anon, authenticated;
