-- =====================================================================
-- Nova CRM — строки таблиц столов в Postgres («гибрид»).
--
-- Firestore остаётся источником правды для ВСЕГО, кроме строк: участники,
-- столы, вкладки, заказы, график, права. Строки таблиц (самая частая
-- операция приложения и главный пожиратель квоты Spark) живут здесь, в
-- `desk_rows`. Какое хранилище сейчас главное, решает поле
-- `rowsBackend` у документа workspace в Firestore — меняет его только Owner
-- кнопкой в «Настройки → Строки таблиц», туда же и обратно.
--
-- БЕЗОПАСНОСТЬ. Клиент приходит сюда с ID-токеном Firebase (Supabase →
-- Authentication → Third-party Auth → Firebase, проект nurba-6e70d). Права на
-- строки — ТЕ ЖЕ, что в firestore.rules (`canAccessPage`/`canEditPage`), и
-- считаются по КОПИИ прав: участники, ответственные, списки доступа,
-- наблюдатели. Копию пишут сессии Owner/Тимлида (сверка с Firestore) и
-- ответственный — про свой стол. Политики на запись копии разрешают РОВНО то,
-- что firestore.rules разрешают на те же поля, поэтому подменой копии нельзя
-- получить больше, чем честной правкой в Firestore.
--
-- Скрипт повторяемый: его можно прогнать ещё раз целиком.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Кто спрашивает. Только токен Firebase НАШЕГО проекта: анонимный ключ
--    (он лежит в публичном репозитории) несёт роль anon без `sub`, и любая
--    проверка ниже для него ложна.
-- ---------------------------------------------------------------------
create or replace function public.rows_uid() returns text
language sql stable
set search_path = public, pg_temp
as $$
  select case
    when coalesce(auth.jwt() ->> 'iss', '') = 'https://securetoken.google.com/nurba-6e70d'
     and coalesce(auth.jwt() ->> 'aud', '') = 'nurba-6e70d'
    then nullif(auth.jwt() ->> 'sub', '')
  end
$$;

-- ---------------------------------------------------------------------
-- 1. Копия прав.
-- ---------------------------------------------------------------------

-- Владелец workspace. Клиент эту таблицу НЕ пишет — строка заводится одной
-- командой в SQL-редакторе (её готовой показывает экран «Строки таблиц»).
-- Иначе первый пришедший мог бы объявить себя владельцем.
create table if not exists public.rows_workspaces (
  workspace_id text primary key,
  owner_id text not null
);

create table if not exists public.rows_members (
  workspace_id text not null references public.rows_workspaces (workspace_id) on delete cascade,
  uid text not null,
  role text not null check (role in ('owner', 'teamlead', 'admin', 'manager', 'os', 'viewer')),
  extra_roles text[] not null default '{}' check (extra_roles <@ array['manager', 'os']::text[]),
  updated_at bigint not null default 0,
  primary key (workspace_id, uid)
);

create table if not exists public.rows_page_acl (
  workspace_id text not null references public.rows_workspaces (workspace_id) on delete cascade,
  page_id text not null,
  responsible_uid text,
  created_by text,
  os_desk boolean not null default false,
  allowed_uids text[] not null default '{}',
  editable_uids text[] not null default '{}',
  updated_at bigint not null default 0,
  primary key (workspace_id, page_id)
);

create table if not exists public.rows_desk_observers (
  workspace_id text not null references public.rows_workspaces (workspace_id) on delete cascade,
  uid text not null,
  primary key (workspace_id, uid)
);

-- ---------------------------------------------------------------------
-- 2. Проверки прав — зеркало функций firestore.rules. SECURITY DEFINER:
--    читают копию прав мимо её собственных политик (иначе политики звали бы
--    сами себя), но отвечают только про ТОГО, кто спрашивает.
-- ---------------------------------------------------------------------
create or replace function public.rows_member_role(ws text) returns text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select m.role from public.rows_members m
  where m.workspace_id = ws and m.uid = public.rows_uid()
$$;

create or replace function public.rows_has_extra(ws text, r text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select r = any (m.extra_roles) from public.rows_members m
    where m.workspace_id = ws and m.uid = public.rows_uid()
  ), false)
$$;

-- isMember
create or replace function public.rows_is_member(ws text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.rows_member_role(ws) is not null
$$;

-- isOwner = владелец по документу workspace ИЛИ участник с ролью owner.
create or replace function public.rows_is_owner(ws text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.rows_uid() is not null and (
    exists (select 1 from public.rows_workspaces w where w.workspace_id = ws and w.owner_id = public.rows_uid())
    or public.rows_member_role(ws) = 'owner'
  )
$$;

create or replace function public.rows_is_teamlead(ws text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.rows_member_role(ws) = 'teamlead', false)
$$;

-- hasRole: основная роль или вторая.
create or replace function public.rows_has_role(ws text, r text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.rows_member_role(ws) = r, false) or public.rows_has_extra(ws, r)
$$;

-- canAccessPage / canEditPage — ДВУМЯ наборами на человека, а не функцией
-- «на строку». Политика строки вызывает свою проверку на КАЖДУЮ строку, и
-- цепочка SECURITY DEFINER-функций на 3000 строк шла ~5 секунд. Функции без
-- аргументов-столбцов Postgres считает ОДИН раз на запрос (хешированный
-- подплан), а строка лишь сверяется с готовым набором.
--
-- «Всё в workspace»: Owner, Тимлид + Технарь и наблюдатель читают любой стол
-- — в том числе стол, у которого записи о правах ещё нет.
create or replace function public.rows_read_all_workspaces() returns setof text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select m.workspace_id from public.rows_members m
  where m.uid = public.rows_uid()
    and (
      m.role = 'owner'
      or exists (select 1 from public.rows_workspaces w where w.workspace_id = m.workspace_id and w.owner_id = m.uid)
      -- Тимлид + Технарь: чужие столы на чтение.
      or (m.role = 'teamlead' and 'manager' = any (m.extra_roles))
      -- Наблюдатель — ДО isDeskBlocked: право выдано человеку, а не роли.
      or exists (select 1 from public.rows_desk_observers o where o.workspace_id = m.workspace_id and o.uid = m.uid)
    )
$$;

-- Отдельные столы, которые человек читает по записи о правах.
create or replace function public.rows_readable_pages() returns table (workspace_id text, page_id text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select a.workspace_id, a.page_id
  from public.rows_page_acl a
  join public.rows_members m on m.workspace_id = a.workspace_id and m.uid = public.rows_uid()
  where
    -- Любой Тимлид: столы ОС.
    (m.role = 'teamlead' and a.os_desk)
    -- isDeskBlocked: Тимлид без Технаря — нет.
    or (not (m.role = 'teamlead' and not ('manager' = any (m.extra_roles)))
      and (a.responsible_uid = m.uid or m.uid = any (a.allowed_uids)))
$$;

-- «Правит всё»: только Owner.
create or replace function public.rows_edit_all_workspaces() returns setof text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select m.workspace_id from public.rows_members m
  where m.uid = public.rows_uid()
    and (m.role = 'owner'
      or exists (select 1 from public.rows_workspaces w where w.workspace_id = m.workspace_id and w.owner_id = m.uid))
$$;

create or replace function public.rows_editable_pages() returns table (workspace_id text, page_id text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select a.workspace_id, a.page_id
  from public.rows_page_acl a
  join public.rows_members m on m.workspace_id = a.workspace_id and m.uid = public.rows_uid()
  where
    -- Свой стол ОС ведёт и Тимлид + ОС: создатель и ответственный — один человек.
    (a.os_desk and a.responsible_uid = m.uid and a.created_by = m.uid)
    or (not (m.role = 'teamlead' and not ('manager' = any (m.extra_roles)))
      and (
        a.responsible_uid = m.uid
        -- editableUsers — только вместе с правом открыть стол (canAccessPage).
        or (m.uid = any (a.editable_uids) and (
          a.workspace_id in (select public.rows_read_all_workspaces())
          or (a.workspace_id, a.page_id) in (select r.workspace_id, r.page_id from public.rows_readable_pages() r)))
      ))
$$;

-- Точечные проверки — для RPC и экрана настройки. Те же наборы.
create or replace function public.rows_can_access_page(ws text, pg text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select ws in (select public.rows_read_all_workspaces())
    or (ws, pg) in (select r.workspace_id, r.page_id from public.rows_readable_pages() r)
$$;

create or replace function public.rows_can_edit_page(ws text, pg text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select ws in (select public.rows_edit_all_workspaces())
    or (ws, pg) in (select e.workspace_id, e.page_id from public.rows_editable_pages() e)
$$;

-- ---------------------------------------------------------------------
-- 3. Кто пишет копию прав — ровно то, что firestore.rules разрешают на те
--    же поля в Firestore.
-- ---------------------------------------------------------------------
alter table public.rows_workspaces enable row level security;
alter table public.rows_members enable row level security;
alter table public.rows_page_acl enable row level security;
alter table public.rows_desk_observers enable row level security;

drop policy if exists rows_workspaces_read on public.rows_workspaces;
create policy rows_workspaces_read on public.rows_workspaces for select to anon, authenticated
  using (owner_id = public.rows_uid() or public.rows_is_member(workspace_id));
-- Записи в rows_workspaces с клиента нет вовсе: ни одной политики на запись.

-- Участники: Owner — всё; Тимлид — кроме Owner и себя, роль owner не выдаёт
-- (members в firestore.rules). В копии только роль и вторая роль — поля,
-- которые Тимлиду у себя менять и так нельзя, поэтому себя он не трогает.
drop policy if exists rows_members_read on public.rows_members;
create policy rows_members_read on public.rows_members for select to anon, authenticated
  using (uid = public.rows_uid() or public.rows_is_owner(workspace_id) or public.rows_is_teamlead(workspace_id));

drop policy if exists rows_members_owner on public.rows_members;
create policy rows_members_owner on public.rows_members for all to anon, authenticated
  using (public.rows_is_owner(workspace_id))
  with check (public.rows_is_owner(workspace_id));

drop policy if exists rows_members_teamlead_insert on public.rows_members;
create policy rows_members_teamlead_insert on public.rows_members for insert to anon, authenticated
  with check (
    public.rows_is_teamlead(workspace_id)
    and role <> 'owner'
    and uid <> public.rows_uid()
    and uid <> coalesce((select w.owner_id from public.rows_workspaces w where w.workspace_id = rows_members.workspace_id), '')
  );

drop policy if exists rows_members_teamlead_update on public.rows_members;
create policy rows_members_teamlead_update on public.rows_members for update to anon, authenticated
  using (
    public.rows_is_teamlead(workspace_id)
    and role <> 'owner'
    and uid <> public.rows_uid()
    and uid <> coalesce((select w.owner_id from public.rows_workspaces w where w.workspace_id = rows_members.workspace_id), '')
  )
  with check (
    public.rows_is_teamlead(workspace_id)
    and role <> 'owner'
    and uid <> public.rows_uid()
    and uid <> coalesce((select w.owner_id from public.rows_workspaces w where w.workspace_id = rows_members.workspace_id), '')
  );

drop policy if exists rows_members_teamlead_delete on public.rows_members;
create policy rows_members_teamlead_delete on public.rows_members for delete to anon, authenticated
  using (
    public.rows_is_teamlead(workspace_id)
    and role <> 'owner'
    and uid <> public.rows_uid()
    and uid <> coalesce((select w.owner_id from public.rows_workspaces w where w.workspace_id = rows_members.workspace_id), '')
  );

-- Права на столы. Читает любой участник — как документ стола в Firestore
-- (`pages`: allow read if isMember), где лежат те же responsibleUserId и
-- списки доступа. Без чтения не работала бы и правка: UPDATE в Postgres
-- видит только строки, прошедшие политику чтения.
drop policy if exists rows_page_acl_read on public.rows_page_acl;
create policy rows_page_acl_read on public.rows_page_acl for select to anon, authenticated
  using (public.rows_is_member(workspace_id));

-- Завести запись о столе:
--  • Owner — любую;
--  • Тимлид — любую, но стол ОС только под его настоящим id `osdesk_{uid}`
--    с этим же uid ответственным и создателем (id стола ОС детерминирован,
--    поэтому чужой стол ОС так не присвоить);
--  • создатель — свой только что созданный стол (Технарь/Admin — обычный
--    с его uid в id, ОС — свой `osdesk_{uid}`), как ветки `create` в firestore.rules.
-- Уже заведённую запись вставкой не перезаписать — первичный ключ.
drop policy if exists rows_page_acl_insert on public.rows_page_acl;
create policy rows_page_acl_insert on public.rows_page_acl for insert to anon, authenticated
  with check (
    public.rows_is_owner(workspace_id)
    or (public.rows_is_teamlead(workspace_id) and (
      not os_desk
      or (page_id = 'osdesk_' || responsible_uid and created_by = responsible_uid)))
    or (public.rows_is_member(workspace_id)
      and responsible_uid = public.rows_uid()
      and created_by = public.rows_uid()
      and (
        (os_desk and page_id = 'osdesk_' || public.rows_uid() and public.rows_has_role(workspace_id, 'os'))
        -- Обычный стол — только со СВОИМ uid в id (`page_{uid}_…`, generateDeskId):
        -- иначе, увидев id нового чужого стола раньше сверки прав, технарь
        -- объявил бы себя его ответственным.
        or (not os_desk
          and starts_with(page_id, 'page_' || public.rows_uid() || '_')
          and (public.rows_has_role(workspace_id, 'manager') or public.rows_member_role(workspace_id) = 'admin'))))
  );

-- Правка записи: кто вправе — здесь, какие ПОЛЯ — триггер ниже (политика не
-- видит старое значение рядом с новым).
drop policy if exists rows_page_acl_update on public.rows_page_acl;
create policy rows_page_acl_update on public.rows_page_acl for update to anon, authenticated
  using (
    public.rows_is_owner(workspace_id)
    or public.rows_is_teamlead(workspace_id)
    or (public.rows_member_role(workspace_id) = 'admin' and not os_desk)
    or (public.rows_is_member(workspace_id) and responsible_uid = public.rows_uid())
  )
  with check (
    public.rows_is_owner(workspace_id)
    or public.rows_is_teamlead(workspace_id)
    or (public.rows_member_role(workspace_id) = 'admin' and not os_desk)
    or public.rows_is_member(workspace_id)
  );

-- Жёсткое удаление стола в Firestore — только Owner.
drop policy if exists rows_page_acl_delete on public.rows_page_acl;
create policy rows_page_acl_delete on public.rows_page_acl for delete to anon, authenticated
  using (public.rows_is_owner(workspace_id));

create or replace function public.rows_page_acl_guard() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  ws text := old.workspace_id;
  me text := public.rows_uid();
begin
  -- Служебная роль (SQL-редактор, миграции) — без ограничений.
  if me is null and current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if public.rows_is_owner(ws) then
    return new;
  end if;
  if new.workspace_id <> old.workspace_id or new.page_id <> old.page_id then
    raise exception 'rows_page_acl: id стола не меняется' using errcode = '42501';
  end if;
  -- createdBy и osDesk не меняет никто, кроме Owner.
  if new.created_by is distinct from old.created_by or new.os_desk is distinct from old.os_desk then
    raise exception 'rows_page_acl: createdBy/osDesk меняет только Owner' using errcode = '42501';
  end if;
  if public.rows_is_teamlead(ws) then
    -- Ответственного у стола ОС не переназначают.
    if old.os_desk and new.responsible_uid is distinct from old.responsible_uid then
      raise exception 'rows_page_acl: ответственный стола ОС не меняется' using errcode = '42501';
    end if;
    return new;
  end if;
  if public.rows_member_role(ws) = 'admin' and not old.os_desk
     and new.responsible_uid is distinct from old.responsible_uid then
    -- Admin: только вместе со сменой ответственного и только просмотр.
    if new.editable_uids is distinct from old.editable_uids then
      raise exception 'rows_page_acl: Admin не меняет список правки' using errcode = '42501';
    end if;
    return new;
  end if;
  -- Ответственный за свой стол: списки доступа, но не ответственного.
  if old.responsible_uid = me then
    if new.responsible_uid is distinct from old.responsible_uid then
      raise exception 'rows_page_acl: ответственного меняют Owner/Тимлид/Admin' using errcode = '42501';
    end if;
    return new;
  end if;
  raise exception 'rows_page_acl: нет прав' using errcode = '42501';
end;
$$;

drop trigger if exists rows_page_acl_guard on public.rows_page_acl;
create trigger rows_page_acl_guard before update on public.rows_page_acl
  for each row execute function public.rows_page_acl_guard();

-- Наблюдатели: пишет только Owner, читают Owner и сам наблюдатель.
drop policy if exists rows_desk_observers_read on public.rows_desk_observers;
create policy rows_desk_observers_read on public.rows_desk_observers for select to anon, authenticated
  using (public.rows_is_owner(workspace_id) or (uid = public.rows_uid() and public.rows_is_member(workspace_id)));

drop policy if exists rows_desk_observers_owner on public.rows_desk_observers;
create policy rows_desk_observers_owner on public.rows_desk_observers for all to anon, authenticated
  using (public.rows_is_owner(workspace_id))
  with check (public.rows_is_owner(workspace_id));

-- ---------------------------------------------------------------------
-- 4. Сами строки.
-- ---------------------------------------------------------------------
create table if not exists public.desk_rows (
  workspace_id text not null references public.rows_workspaces (workspace_id) on delete cascade,
  page_id text not null,
  -- '' — «Основная» таблица стола, иначе id вкладки (subpage).
  tab_id text not null default '',
  id text not null,
  cells jsonb not null default '{}'::jsonb,
  extras jsonb,
  attachments jsonb,
  sort_order double precision not null default 0,
  height integer,
  -- Время — миллисекунды, как `Date.now()` в клиенте (serverTimestamp в
  -- проекте запрещён, и здесь то же: числа без часовых поясов).
  created_at bigint not null,
  updated_at bigint not null,
  filled_at bigint,
  order_id text,
  highlight boolean not null default false,
  -- id строки уникален только внутри таблицы: копия стола раньше переносила
  -- строки со старыми id, поэтому ключ — вся цепочка.
  primary key (workspace_id, page_id, tab_id, id)
);

create index if not exists desk_rows_tab_order on public.desk_rows (workspace_id, page_id, tab_id, sort_order);
create index if not exists desk_rows_created on public.desk_rows (workspace_id, page_id, created_at);
create index if not exists desk_rows_filled on public.desk_rows (workspace_id, page_id, filled_at);

alter table public.desk_rows enable row level security;

-- Сверка с наборами, посчитанными один раз на запрос (см. rows_readable_pages).
drop policy if exists desk_rows_read on public.desk_rows;
create policy desk_rows_read on public.desk_rows for select to anon, authenticated
  using (
    workspace_id in (select public.rows_read_all_workspaces())
    or (workspace_id, page_id) in (select r.workspace_id, r.page_id from public.rows_readable_pages() r)
  );

drop policy if exists desk_rows_insert on public.desk_rows;
create policy desk_rows_insert on public.desk_rows for insert to anon, authenticated
  with check (
    workspace_id in (select public.rows_edit_all_workspaces())
    or (workspace_id, page_id) in (select e.workspace_id, e.page_id from public.rows_editable_pages() e)
  );

drop policy if exists desk_rows_update on public.desk_rows;
create policy desk_rows_update on public.desk_rows for update to anon, authenticated
  using (
    workspace_id in (select public.rows_edit_all_workspaces())
    or (workspace_id, page_id) in (select e.workspace_id, e.page_id from public.rows_editable_pages() e)
  )
  with check (
    workspace_id in (select public.rows_edit_all_workspaces())
    or (workspace_id, page_id) in (select e.workspace_id, e.page_id from public.rows_editable_pages() e)
  );

drop policy if exists desk_rows_delete on public.desk_rows;
create policy desk_rows_delete on public.desk_rows for delete to anon, authenticated
  using (
    workspace_id in (select public.rows_edit_all_workspaces())
    or (workspace_id, page_id) in (select e.workspace_id, e.page_id from public.rows_editable_pages() e)
  );

-- ---------------------------------------------------------------------
-- 5. Операции, которых нет в простом REST: слияние ячеек и порядок.
--    SECURITY INVOKER — политики выше действуют как обычно.
-- ---------------------------------------------------------------------

-- Правка строки слиянием — как setDoc(..., { merge: true }) в Firestore:
-- переданные ячейки ложатся поверх, остальные не трогаются. Слияние идёт
-- ВНУТРИ базы одним оператором: прежнее зеркало читало ячейки, склеивало их
-- в браузере и писало обратно — две быстрые правки одной строки теряли одна
-- другую. Строки нет — заводится (как merge-запись в Firestore), внизу таблицы.
--   p_extras_mode: 'keep' — визитку не трогать, 'set' — заменить, 'clear' — убрать.
create or replace function public.rows_patch(
  p_workspace text,
  p_page text,
  p_tab text,
  p_id text,
  p_cells jsonb default '{}'::jsonb,
  p_updated_at bigint default null,
  p_filled_at bigint default null,
  p_extras_mode text default 'keep',
  p_extras jsonb default null,
  p_highlight boolean default null,
  p_order_id text default null,
  p_attachments_set boolean default false,
  p_attachments jsonb default null,
  p_height integer default null
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  tab text := coalesce(p_tab, '');
  now_ms bigint := coalesce(p_updated_at, (extract(epoch from clock_timestamp()) * 1000)::bigint);
begin
  if p_extras_mode not in ('keep', 'set', 'clear') then
    raise exception 'rows_patch: неизвестный p_extras_mode %', p_extras_mode;
  end if;
  insert into public.desk_rows as r (
    workspace_id, page_id, tab_id, id, cells, extras, attachments, sort_order, height,
    created_at, updated_at, filled_at, order_id, highlight
  ) values (
    p_workspace, p_page, tab, p_id,
    coalesce(p_cells, '{}'::jsonb),
    case when p_extras_mode = 'set' then p_extras end,
    case when p_attachments_set then p_attachments end,
    coalesce((select max(x.sort_order) + 1 from public.desk_rows x
      where x.workspace_id = p_workspace and x.page_id = p_page and x.tab_id = tab), 0),
    p_height,
    now_ms, now_ms, p_filled_at, p_order_id, coalesce(p_highlight, false)
  )
  on conflict (workspace_id, page_id, tab_id, id) do update set
    cells = r.cells || coalesce(p_cells, '{}'::jsonb),
    extras = case p_extras_mode when 'set' then p_extras when 'clear' then null else r.extras end,
    attachments = case when p_attachments_set then p_attachments else r.attachments end,
    height = coalesce(p_height, r.height),
    -- Высота строки — не правка данных, время правки от неё не меняется.
    updated_at = case
      when p_height is not null and coalesce(p_cells, '{}'::jsonb) = '{}'::jsonb and p_extras_mode = 'keep'
        and p_highlight is null and p_order_id is null and not p_attachments_set and p_filled_at is null
      then r.updated_at else now_ms end,
    filled_at = coalesce(p_filled_at, r.filled_at),
    order_id = coalesce(p_order_id, r.order_id),
    highlight = coalesce(p_highlight, r.highlight);
end;
$$;

-- Порядок строк вкладки: ids по порядку, пишутся только сдвинувшиеся.
create or replace function public.rows_set_order(
  p_workspace text,
  p_page text,
  p_tab text,
  p_ids text[]
) returns integer
language sql
set search_path = public, pg_temp
as $$
  with target as (
    select x.id, (x.ord - 1)::double precision as ord
    from unnest(p_ids) with ordinality as x(id, ord)
  ), changed as (
    update public.desk_rows r set sort_order = t.ord
    from target t
    where r.workspace_id = p_workspace and r.page_id = p_page and r.tab_id = coalesce(p_tab, '')
      and r.id = t.id and r.sort_order is distinct from t.ord
    returning 1
  )
  select count(*)::integer from changed
$$;

-- Что Supabase знает про меня: проверка настройки на экране «Строки таблиц».
create or replace function public.rows_whoami(p_workspace text) returns jsonb
language sql stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'uid', public.rows_uid(),
    'role', public.rows_member_role(p_workspace),
    'isOwner', public.rows_is_owner(p_workspace),
    'workspaceSeeded', exists (select 1 from public.rows_workspaces w where w.workspace_id = p_workspace)
  )
$$;

-- Могу ли я читать/править стол — отличает «строк нет» от «права ещё не
-- доехали»: политика в обоих случаях отдаёт пустую выборку.
create or replace function public.rows_page_access(p_workspace text, p_page text) returns jsonb
language sql stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'canRead', public.rows_can_access_page(p_workspace, p_page),
    'canEdit', public.rows_can_edit_page(p_workspace, p_page),
    'hasAcl', public.rows_is_member(p_workspace) and exists (
      select 1 from public.rows_page_acl a where a.workspace_id = p_workspace and a.page_id = p_page)
  )
$$;

-- ---------------------------------------------------------------------
-- 6. Доступ ролей API. RLS решает, что видно, а без GRANT не видно ничего.
--    Токен Firebase без claim `role` приходит ролью anon — поэтому обе.
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select on public.rows_workspaces to anon, authenticated;
grant select, insert, update, delete on public.rows_members, public.rows_page_acl, public.rows_desk_observers
  to anon, authenticated;
grant select, insert, update, delete on public.desk_rows to anon, authenticated;
grant execute on function
  public.rows_uid(), public.rows_member_role(text), public.rows_has_extra(text, text),
  public.rows_is_member(text), public.rows_is_owner(text), public.rows_is_teamlead(text),
  public.rows_has_role(text, text),
  public.rows_read_all_workspaces(), public.rows_readable_pages(),
  public.rows_edit_all_workspaces(), public.rows_editable_pages(),
  public.rows_can_access_page(text, text), public.rows_can_edit_page(text, text),
  public.rows_patch(text, text, text, text, jsonb, bigint, bigint, text, jsonb, boolean, text, boolean, jsonb, integer),
  public.rows_set_order(text, text, text, text[]),
  public.rows_whoami(text), public.rows_page_access(text, text)
  to anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. Живые изменения (Supabase Realtime) по строкам.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'desk_rows') then
    execute 'alter publication supabase_realtime add table public.desk_rows';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. Старое зеркало `row_records` закрывается. Оно ходило анонимным ключом,
--    то есть его политики пускали любого, у кого есть ключ, а ключ лежит в
--    публичном репозитории. Данные не удаляются — только доступ через API.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'row_records') then
    execute 'alter table public.row_records enable row level security';
    execute 'revoke all on public.row_records from anon, authenticated';
  end if;
end;
$$;
