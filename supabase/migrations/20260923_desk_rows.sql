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
-- Состояние хранилища (меняет только Owner через rows_set_state):
--  live — строки этого workspace живут ЗДЕСЬ, их правят все по своим правам;
--         пока false (до переноса и после отката) — запись строк закрыта всем,
--         поздняя правка со старой вкладки отказывает громко, а не теряется;
--  migrating_until — идёт перенос: Owner копирует строки и пишет их даже в
--         неживое хранилище; срок — чтобы брошенный перенос не держал дверь.
alter table public.rows_workspaces add column if not exists live boolean not null default false;
alter table public.rows_workspaces add column if not exists migrating_until timestamptz;

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
-- ВНИМАНИЕ: эти функции читают rows_members/rows_workspaces под SECURITY
-- DEFINER, и политики к владельцу таблиц не применяются — поэтому цепочка
-- «политика → функция → таблица с политикой» не зацикливается. Не включать
-- на rows_* `force row level security` и прогонять файл той же ролью, что
-- создала таблицы, иначе Postgres ответит «infinite recursion detected in
-- policy» и строк не увидит никто.
create or replace function public.rows_read_all_workspaces() returns setof text
language sql stable security definer
set search_path = public, pg_temp
as $$
  -- Владельца БЕЗ записи участника здесь намеренно нет: правило строк в
  -- firestore.rules — `isMember(workspaceId) && canAccessPage(...)`, то есть
  -- и там он строк не прочитает. Копия прав повторяет Firestore, а не даёт
  -- больше; запись участника владельцу заводит обычная сверка прав.
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

-- Куда вообще можно писать строки: живое хранилище — всем (дальше решают
-- права стола), неживое — только Owner и только во время переноса.
create or replace function public.rows_writable_workspaces() returns setof text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select w.workspace_id from public.rows_workspaces w
  where w.live
     or (w.migrating_until > now() and public.rows_is_owner(w.workspace_id))
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
  select ws in (select public.rows_writable_workspaces()) and (
    ws in (select public.rows_edit_all_workspaces())
    or (ws, pg) in (select e.workspace_id, e.page_id from public.rows_editable_pages() e))
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
    -- Тимлид заводит запись о столе ОС только ЧУЖОМУ человеку: себе он
    -- завёл бы `osdesk_{свой uid}` и получил бы на него правку мимо запрета
    -- Тимлиду на таблицы (в Firestore такой стол ему создать нельзя — там
    -- нужна роль ОС). Свой стол ОС Тимлид + ОС заводит веткой участника ниже,
    -- где роль ОС проверяется.
    or (public.rows_is_teamlead(workspace_id) and (
      -- Обычный стол — с любым ответственным (Тимлид их и переназначает), но
      -- id не из-под столов ОС: иначе он завёл бы запись о ЧУЖОМ столе ОС с
      -- `os_desk = false` и, будучи ещё и Технарём, получил бы правку его
      -- строк — в Firestore ответственного у стола ОС он менять не вправе.
      (not os_desk and not starts_with(page_id, 'osdesk_'))
      or (os_desk
        and page_id = 'osdesk_' || responsible_uid
        and created_by = responsible_uid
        and responsible_uid <> public.rows_uid())))
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

-- Строка-заказ, которую ВЕДЁТ ОС (см. «Стол ОС — источник» в CLAUDE.md).
-- os_uid — это и есть замок: он не пустой, значит статус, цену и клиента
-- правит только ОС, а технарю оставлены свои поля. Именно uid, а не ник: ник
-- лежит в обычной ЯЧЕЙКЕ, которую пишет сам технарь, и право, выведенное из
-- ячейки, чеканил бы тот, кого оно ограничивает; плюс ник переназначает
-- руководство, и смена ника молча передала бы права на старые строки.
alter table public.desk_rows
  add column if not exists os_uid text,
  -- Кому адресована строка: политика вставки сверяет его с ответственным за
  -- стол, иначе любой ОС дописывал бы строки в любой стол.
  add column if not exists tech_uid text,
  -- Ключ столбца статуса ЭТОЙ вкладки: ключи у вкладок разные, хардкод
  -- 'status' не годится. По нему же Тимлид получает право ставить «Успешку».
  add column if not exists status_key text,
  -- Адрес строки-источника в столе ОС (и зеркальный адрес на той строке).
  add column if not exists src_page_id text,
  add column if not exists src_tab_id text,
  add column if not exists src_row_id text,
  add column if not exists mirror_page_id text,
  add column if not exists mirror_tab_id text,
  add column if not exists mirror_row_id text,
  -- Хеш зеркалируемых полей, одинаковый на обеих строках: сверка «доехало ли»
  -- идёт по нему БЕЗ выборки самих ячеек (на стол это мегабайты трафика).
  add column if not exists sync_hash text,
  -- Технарь просит поставить «Успешку» — чип прямо на строке.
  add column if not exists success_requested_at bigint,
  add column if not exists success_requested_by text;

create index if not exists desk_rows_tab_order on public.desk_rows (workspace_id, page_id, tab_id, sort_order);
create index if not exists desk_rows_os_uid on public.desk_rows (workspace_id, os_uid) where os_uid is not null;
create index if not exists desk_rows_created on public.desk_rows (workspace_id, page_id, created_at);
create index if not exists desk_rows_filled on public.desk_rows (workspace_id, page_id, filled_at);

alter table public.desk_rows enable row level security;

-- Сверка с наборами, посчитанными один раз на запрос (см. rows_readable_pages).
drop policy if exists desk_rows_read on public.desk_rows;
create policy desk_rows_read on public.desk_rows for select to anon, authenticated
  using (
    workspace_id in (select public.rows_read_all_workspaces())
    or (workspace_id, page_id) in (select r.workspace_id, r.page_id from public.rows_readable_pages() r)
    -- СВОИ строки-заказы в чужих столах: ОС ведёт заказ у себя, а живёт он в
    -- столе технаря. Видит он ровно свои строки и ничего больше этого стола.
    or (os_uid is not null and os_uid = public.rows_uid() and public.rows_is_member(workspace_id))
    -- Тимлид видит строки-ЗАКАЗЫ (и только их): по просьбе технаря он ставит
    -- «Успешку», а поставить статус в строке, которой не видишь, нельзя.
    -- Ничего нового ему это не открывает: те же заказы лежат на столах ОС,
    -- которые любой Тимлид читает и сейчас. Обычные строки стола технаря
    -- по-прежнему закрыты (это и есть isDeskBlocked).
    or (os_uid is not null and public.rows_is_teamlead(workspace_id))
  );

drop policy if exists desk_rows_insert on public.desk_rows;
create policy desk_rows_insert on public.desk_rows for insert to anon, authenticated
  with check (
    workspace_id in (select public.rows_writable_workspaces())
    and (
      workspace_id in (select public.rows_edit_all_workspaces())
      or (workspace_id, page_id) in (select e.workspace_id, e.page_id from public.rows_editable_pages() e)
      -- ОС заводит строку-заказ в столе технаря. Три условия обязательны:
      -- владелец ячеек — он сам, у него есть роль ОС, и строка адресована
      -- ИМЕННО ответственному за этот стол. Без последнего любой ОС дописывал
      -- бы строки в любой стол (метки заказа тут не защита: коллекцию заказов
      -- читает любой участник, id заказа не секрет).
      or (
        os_uid is not null
        and os_uid = public.rows_uid()
        and public.rows_has_role(workspace_id, 'os')
        and tech_uid is not null
        and status_key is not null
        and exists (
          select 1 from public.rows_page_acl a
          where a.workspace_id = desk_rows.workspace_id
            and a.page_id = desk_rows.page_id
            and not a.os_desk
            and a.responsible_uid = desk_rows.tech_uid
        )
      )
    )
  );

-- Кто вообще может ТРОНУТЬ строку — здесь; какие ПОЛЯ ему при этом можно —
-- в триггере desk_rows_guard ниже (политика не видит старое значение рядом с
-- новым, а правило «технарь пишет только свои поля» без этого не выразить).
drop policy if exists desk_rows_update on public.desk_rows;
create policy desk_rows_update on public.desk_rows for update to anon, authenticated
  using (
    workspace_id in (select public.rows_writable_workspaces())
    and (
      workspace_id in (select public.rows_edit_all_workspaces())
      or (workspace_id, page_id) in (select e.workspace_id, e.page_id from public.rows_editable_pages() e)
      -- ОС правит свою строку-заказ в чужом столе.
      or (os_uid is not null and os_uid = public.rows_uid())
      -- Тимлид ставит «Успешку» по просьбе технаря — только статус, см. триггер.
      or (os_uid is not null and public.rows_is_teamlead(workspace_id))
    )
  )
  with check (
    workspace_id in (select public.rows_writable_workspaces())
    and (
      workspace_id in (select public.rows_edit_all_workspaces())
      or (workspace_id, page_id) in (select e.workspace_id, e.page_id from public.rows_editable_pages() e)
      or (os_uid is not null and os_uid = public.rows_uid())
      or (os_uid is not null and public.rows_is_teamlead(workspace_id))
    )
  );

drop policy if exists desk_rows_delete on public.desk_rows;
create policy desk_rows_delete on public.desk_rows for delete to anon, authenticated
  using (
    workspace_id in (select public.rows_writable_workspaces())
    and (
      workspace_id in (select public.rows_edit_all_workspaces())
      -- Строку-заказ технарь не удаляет: иначе он выходил бы из-под замка
      -- удалением. Её убирает ОС этого заказа или Owner.
      or (os_uid is null and (workspace_id, page_id) in (select e.workspace_id, e.page_id from public.rows_editable_pages() e))
      or (os_uid is not null and os_uid = public.rows_uid())
    )
  );

-- ---------------------------------------------------------------------
-- 5. Операции, которых нет в простом REST: слияние ячеек и порядок.
--    SECURITY INVOKER — политики выше действуют как обычно.
-- ---------------------------------------------------------------------

-- Номер для НОВОЙ строки внизу таблицы. SECURITY DEFINER намеренно: обычный
-- подзапрос считал бы максимум под правами вызывающего, а ОС видит в чужом
-- столе только СВОИ строки — новые строки вставали бы друг на друга и на
-- чужие. Наружу отдаётся одно число, ничего чужого через него не видно.
create or replace function public.rows_append_order(p_workspace text, p_page text, p_tab text)
returns double precision
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(max(x.sort_order) + 1, 0)
  from public.desk_rows x
  where x.workspace_id = p_workspace and x.page_id = p_page and x.tab_id = coalesce(p_tab, '')
$$;

-- Старая сигнатура rows_patch удаляется ЯВНО: `create or replace` с новым
-- списком параметров создал бы ВТОРУЮ функцию, и PostgREST ответил бы
-- PGRST203 «ambiguous» — перестали бы сохраняться все правки у всех.
drop function if exists public.rows_patch(text, text, text, text, jsonb, bigint, bigint, text, jsonb, boolean, text, boolean, jsonb, integer);
-- Промежуточная сигнатура (без адреса копии) — если её успели накатить.
drop function if exists public.rows_patch(text, text, text, text, jsonb, bigint, bigint, text, jsonb, boolean, text, boolean, jsonb, integer, text, text, text, text, text, text, text, bigint, text, boolean);

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
  p_height integer default null,
  -- Поля строки-заказа (см. выше). Все с default null: обычная правка их не
  -- передаёт и не трогает.
  p_os_uid text default null,
  p_tech_uid text default null,
  p_status_key text default null,
  p_sync_hash text default null,
  p_src_page text default null,
  p_src_tab text default null,
  p_src_row text default null,
  p_success_requested_at bigint default null,
  p_success_requested_by text default null,
  -- Адрес строки-копии — пишется на строку стола ОС.
  p_mirror_page text default null,
  p_mirror_tab text default null,
  p_mirror_row text default null,
  -- Снять просьбу об «Успешке» (решили — чип гаснет).
  p_clear_success boolean default false
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
    created_at, updated_at, filled_at, order_id, highlight,
    os_uid, tech_uid, status_key, sync_hash, src_page_id, src_tab_id, src_row_id,
    success_requested_at, success_requested_by, mirror_page_id, mirror_tab_id, mirror_row_id
  ) values (
    p_workspace, p_page, tab, p_id,
    coalesce(p_cells, '{}'::jsonb),
    case when p_extras_mode = 'set' then p_extras end,
    case when p_attachments_set then p_attachments end,
    public.rows_append_order(p_workspace, p_page, tab),
    p_height,
    now_ms, now_ms, p_filled_at, p_order_id, coalesce(p_highlight, false),
    p_os_uid, p_tech_uid, p_status_key, p_sync_hash, p_src_page, p_src_tab, p_src_row,
    p_success_requested_at, p_success_requested_by, p_mirror_page, p_mirror_tab, p_mirror_row
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
    highlight = coalesce(p_highlight, r.highlight),
    os_uid = coalesce(p_os_uid, r.os_uid),
    tech_uid = coalesce(p_tech_uid, r.tech_uid),
    status_key = coalesce(p_status_key, r.status_key),
    sync_hash = coalesce(p_sync_hash, r.sync_hash),
    src_page_id = coalesce(p_src_page, r.src_page_id),
    src_tab_id = coalesce(p_src_tab, r.src_tab_id),
    src_row_id = coalesce(p_src_row, r.src_row_id),
    success_requested_at = case when p_clear_success then null else coalesce(p_success_requested_at, r.success_requested_at) end,
    success_requested_by = case when p_clear_success then null else coalesce(p_success_requested_by, r.success_requested_by) end,
    mirror_page_id = coalesce(p_mirror_page, r.mirror_page_id),
    mirror_tab_id = coalesce(p_mirror_tab, r.mirror_tab_id),
    mirror_row_id = coalesce(p_mirror_row, r.mirror_row_id);
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

-- Состояние хранилища — только Owner (перенос туда и обратно).
create or replace function public.rows_set_state(p_workspace text, p_live boolean, p_migrating boolean) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not public.rows_is_owner(p_workspace) then
    raise exception 'rows_set_state: только Owner' using errcode = '42501';
  end if;
  update public.rows_workspaces
     set live = p_live,
         migrating_until = case when p_migrating then now() + interval '15 minutes' end
   where workspace_id = p_workspace;
  if not found then
    raise exception 'rows_set_state: workspace не заведён' using errcode = 'P0002';
  end if;
end;
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
    'workspaceSeeded', exists (select 1 from public.rows_workspaces w where w.workspace_id = p_workspace),
    'live', coalesce((select w.live from public.rows_workspaces w where w.workspace_id = p_workspace), false)
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
-- 5б. Страж полей строки-заказа.
--
-- Политика решает, КТО может тронуть строку; какие ПОЛЯ ему при этом можно —
-- решается здесь: политике не видно старое значение рядом с новым, а всё
-- правило держится именно на сравнении. Технарю в строке-заказе оставлены
-- только свои поля (ссылка на работу, примечание, файлы, высота, порядок,
-- снятие подсветки) и просьба об «Успешке»; статус, цену, клиента и ОС он не
-- трогает. Тимлиду оставлен ровно статус — тот, что назван в status_key.
-- ---------------------------------------------------------------------
create or replace function public.desk_rows_guard() returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  is_owner boolean := old.workspace_id in (select public.rows_edit_all_workspaces());
  changed text[];
  allowed text[] := array['techLink', 'techNote'];
begin
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
create trigger desk_rows_guard before update on public.desk_rows
  for each row execute function public.desk_rows_guard();

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
  public.rows_read_all_workspaces(), public.rows_readable_pages(), public.rows_writable_workspaces(),
  public.rows_set_state(text, boolean, boolean),
  public.rows_edit_all_workspaces(), public.rows_editable_pages(),
  public.rows_can_access_page(text, text), public.rows_can_edit_page(text, text),
  public.rows_patch(text, text, text, text, jsonb, bigint, bigint, text, jsonb, boolean, text, boolean, jsonb, integer,
    text, text, text, text, text, text, text, bigint, text, text, text, text, boolean),
  public.rows_append_order(text, text, text),
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
