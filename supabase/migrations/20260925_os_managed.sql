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

-- ----------------------------------------------------------------------
-- Столы-исключения (просьба Nurba 23.09.2026: «выборочно давать технарю
-- правку своего стола»). Пока заказы ведёт ОС, технарь в столе из этого
-- списка правит свои строки сам, как без флага. Строки-заказы ОС (os_uid)
-- это не открывает — их держит desk_rows_guard. Пишет только Owner
-- (rows_set_desk_os_exempt), читают политики через SECURITY DEFINER.
-- ----------------------------------------------------------------------
create table if not exists public.rows_os_exempt (
  workspace_id text not null references public.rows_workspaces (workspace_id) on delete cascade,
  page_id text not null,
  created_at bigint not null default 0,
  primary key (workspace_id, page_id)
);
alter table public.rows_os_exempt enable row level security;
revoke all on public.rows_os_exempt from anon, authenticated;
grant select on public.rows_os_exempt to anon, authenticated;
drop policy if exists rows_os_exempt_owner_read on public.rows_os_exempt;
create policy rows_os_exempt_owner_read on public.rows_os_exempt for select to anon, authenticated
  using (public.rows_is_owner(workspace_id));

-- Набор столов-исключений тех workspace, где спрашивающий — участник.
-- Функция без аргументов-столбцов: политика сверяет строку с НАБОРОМ, и
-- Postgres считает его один раз на запрос (урок про can_access на строку).
create or replace function public.rows_os_exempt_pages() returns table (workspace_id text, page_id text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select x.workspace_id, x.page_id
  from public.rows_os_exempt x
  where x.workspace_id in (select m.workspace_id from public.rows_members m where m.uid = public.rows_uid())
$$;

create or replace function public.rows_is_os_exempt(p_workspace text, p_page text) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.rows_os_exempt x where x.workspace_id = p_workspace and x.page_id = p_page)
$$;

create or replace function public.rows_set_desk_os_exempt(p_workspace text, p_page text, p_on boolean) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not coalesce(public.rows_is_owner(p_workspace), false) then
    raise exception 'rows_set_desk_os_exempt: только Owner' using errcode = '42501';
  end if;
  if p_on then
    insert into public.rows_os_exempt (workspace_id, page_id, created_at)
    values (p_workspace, p_page, (extract(epoch from now()) * 1000)::bigint)
    on conflict (workspace_id, page_id) do nothing;
  else
    delete from public.rows_os_exempt where workspace_id = p_workspace and page_id = p_page;
  end if;
end;
$$;

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

  -- Стол-исключение: Owner разрешил этому технарю править свой стол сам.
  if public.rows_is_os_exempt(new.workspace_id, new.page_id) then
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
    -- Стол-исключение: технарь правит свой стол сам — и строки удаляет тоже.
    or (workspace_id, page_id) in (select e.workspace_id, e.page_id from public.rows_os_exempt_pages() e)
    -- Пустой слот убрать можно: заказа в нём нет.
    or not exists (
      select 1 from jsonb_each_text(coalesce(cells, '{}'::jsonb)) e
      where coalesce(e.value, '') <> ''
    )
  );

grant execute on function
  public.rows_is_os_managed(text),
  public.rows_set_os_managed(text, boolean),
  public.rows_os_exempt_pages(),
  public.rows_is_os_exempt(text, text),
  public.rows_set_desk_os_exempt(text, text, boolean)
  to anon, authenticated;
