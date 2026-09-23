-- ======================================================================
-- «Заказы ведёт ОС» в базе (23.09.2026)
--
-- Переключатель `workspace.osManagedDesks` жил только в Firestore и только
-- прятал кнопки: технарь по-прежнему мог поставить себе «Успешку» обычной
-- правкой ячейки. Правило человеку обещали железное («статус меняет только
-- ОС»), поэтому оно переезжает в базу.
--
-- Отдельным файлом и ОТДЕЛЬНЫМ триггером, а не правкой `desk_rows_guard` в
-- 20260923_desk_rows.sql: два файла параллельных сессий не конфликтуют, и
-- повторный накат соседнего файла не откатит это правило.
-- ======================================================================

alter table public.rows_workspaces
  add column if not exists os_managed boolean not null default false;

-- Флаг workspace. SECURITY DEFINER: на rows_workspaces нет политики записи,
-- а чтение под RLS в триггере считалось бы от лица правящего.
create or replace function public.rows_is_os_managed(p_workspace text) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select w.os_managed from public.rows_workspaces w where w.workspace_id = p_workspace),
    false
  );
$$;

-- Переключает только Owner — как и `rows_set_state`.
create or replace function public.rows_set_os_managed(p_workspace text, p_on boolean) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.rows_is_owner(p_workspace) then
    raise exception 'rows_set_os_managed: только Owner' using errcode = '42501';
  end if;
  update public.rows_workspaces set os_managed = p_on where workspace_id = p_workspace;
  if not found then
    raise exception 'rows_set_os_managed: workspace не заведён' using errcode = 'P0002';
  end if;
end;
$$;

-- ----------------------------------------------------------------------
-- Правка ячеек в столе технаря, когда заказы ведёт ОС.
--
-- `desk_rows_guard` держит СТРОКИ-ЗАКАЗЫ (у них есть os_uid). Этот триггер —
-- про остальные строки того же стола: старые заказы, которые ещё не перенесли,
-- и всё, что технарь завёл руками. Человеку обещано «статусы меняет только
-- ОС», а не «только в перенесённых строках».
-- ----------------------------------------------------------------------
create or replace function public.desk_rows_os_managed_guard() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  changed text[];
begin
  -- Ячейки не тронуты — порядок строк, высота, подсветка, метка заказа.
  -- Проверка стоит ПЕРВОЙ: массовые операции идут построчно, и любой lookup
  -- до неё стоил бы запроса на каждую строку таблицы.
  if new.cells is not distinct from old.cells then
    return new;
  end if;

  if not public.rows_is_os_managed(new.workspace_id) then
    return new;
  end if;

  -- Owner и Тимлид — как раньше.
  if new.workspace_id in (select public.rows_edit_all_workspaces())
     or public.rows_is_teamlead(new.workspace_id) then
    return new;
  end if;

  -- Строку-заказ разбирает desk_rows_guard: там свои ветки для ОС и технаря.
  if new.os_uid is not null or old.os_uid is not null then
    return new;
  end if;

  -- Стол ОС — его собственная таблица, там ОС хозяин.
  if exists (
    select 1 from public.rows_page_acl a
    where a.workspace_id = new.workspace_id and a.page_id = new.page_id and a.os_desk
  ) then
    return new;
  end if;

  -- Заезд заказа с биржи занимает ПУСТОЙ слот и пишет в него весь набор
  -- ячеек из сессии технаря (takeOrderToDesk). Заполнение пустой строки
  -- остаётся разрешённым: это новый заказ, а не правка чужого.
  if not exists (
    select 1 from jsonb_each_text(coalesce(old.cells, '{}'::jsonb)) e
    where coalesce(e.value, '') <> ''
  ) then
    return new;
  end if;

  changed := array(
    select coalesce(o.key, n.key)
    from jsonb_each(coalesce(old.cells, '{}'::jsonb)) o
    full outer join jsonb_each(coalesce(new.cells, '{}'::jsonb)) n on n.key = o.key
    where o.value is distinct from n.value
  );
  if not (changed <@ array['techLink', 'techNote']) then
    raise exception 'desk_rows: заказы ведёт ОС — статус и сумму меняет он, попросите «Успешку»'
      using errcode = '42501';
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

drop trigger if exists desk_rows_os_managed on public.desk_rows;
create trigger desk_rows_os_managed
  before update on public.desk_rows
  for each row execute function public.desk_rows_os_managed_guard();

-- ----------------------------------------------------------------------
-- Удаление. Без этого замок на правку обходится в два шага: удалить строку
-- и вставить её заново с нужным статусом (политика вставки пускает
-- ответственного завести в своём столе любую строку).
--
-- Политика RESTRICTIVE — она складывается с обычной по «И», а не по «ИЛИ».
-- ----------------------------------------------------------------------
drop policy if exists desk_rows_delete_os_managed on public.desk_rows;
create policy desk_rows_delete_os_managed on public.desk_rows
  as restrictive
  for delete
  to anon, authenticated
  using (
    not public.rows_is_os_managed(workspace_id)
    or workspace_id in (select public.rows_edit_all_workspaces())
    or public.rows_is_teamlead(workspace_id)
    or os_uid = public.rows_uid()
    or exists (
      select 1 from public.rows_page_acl a
      where a.workspace_id = desk_rows.workspace_id and a.page_id = desk_rows.page_id and a.os_desk
    )
    -- Пустой слот убрать можно: заказа в нём нет.
    or not exists (
      select 1 from jsonb_each_text(coalesce(cells, '{}'::jsonb)) e
      where coalesce(e.value, '') <> ''
    )
  );

grant execute on function
  public.rows_is_os_managed(text),
  public.rows_set_os_managed(text, boolean)
  to anon, authenticated;
