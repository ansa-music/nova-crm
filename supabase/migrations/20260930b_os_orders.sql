-- =====================================================================
-- Nova CRM — списки заказов ОС («Технари» → «Ваши заказы») в Postgres.
-- Повторяемый файл: «Скопировать SQL» вставляет ВСЕ миграции разом, поэтому
-- здесь только create … if not exists / create or replace / drop … if exists
-- / add column if not exists.
--
-- Зачем. Стол публикует рядом со счётчиками по списку на каждый ник ОС
-- (useDeskLoadPublisher, пересчёт Owner) — сотни записей в день, и каждую
-- Firestore расходил чтением по всем открытым «Технарям» у ОС. Здесь квоты
-- на операции нет; живость — звонок `nova:{ws}:osorders` (без данных) и
-- дочитывание своим токеном `rev > курсор`.
--
-- Права — повтор firestore.rules → osOrders:
--   читает Owner (isOwner: и владелец по документу workspace) и ОС, у
--   которого в member-документе osNickValue = os_value строки. Тимлид
--   содержимого столов не видит, другой ОС — чужих заказов;
--   пишет тот, кто правит строки стола (canEditPage), и только с НАСТОЯЩИМ
--   ответственным (как desk_loads), только в живое хранилище.
-- Сверх Firestore чтение получает ещё и сам писатель (кто правит строки
-- стола — только ЭТОГО стола): upsert — это INSERT … ON CONFLICT DO UPDATE,
-- и Postgres требует, чтобы существующую строку пропускала политика ЧТЕНИЯ,
-- иначе запись падает. Утечки нет: список — это название, статус и дата
-- строк того же стола, которые писатель и так читает целиком (право править
-- строки включает право их читать).
--
-- Ник ОС — копия `members.osNickValue` в rows_members.os_nick_value. Её
-- пишут ровно те, кто в Firestore вправе менять osNickValue: Owner — любого,
-- Тимлид — кроме себя и Owner (политики rows_members в 20260923_desk_rows.sql
-- уже такие), сам участник свою запись в копии не пишет вовсе (в Firestore
-- ник себе тоже не вписать). Поэтому подменой копии свой ник не поменять и
-- чужие заказы не прочитать — ровно как в Firestore.
-- =====================================================================

alter table public.rows_members add column if not exists os_nick_value text;

create table if not exists public.os_orders (
  workspace_id text not null references public.rows_workspaces (workspace_id) on delete cascade,
  page_id text not null,
  -- Значение варианта «Ответственный» (ник ОС), как в Firestore-документе.
  os_value text not null check (os_value <> ''),
  responsible_uid text not null,
  month_key text not null check (month_key ~ '^[0-9]{4}-[0-9]{2}$'),
  sub_page_id text not null,
  -- OsOrderItem[] как в Firestore (collectOsOrders): rowId, title, status,
  -- date, createdAt, updatedAt. Не больше 150 на ОС — режет клиент.
  orders jsonb not null default '[]'::jsonb,
  updated_by text,
  rev bigint not null default 0,
  server_at timestamptz not null default now(),
  primary key (workspace_id, page_id, os_value)
);
-- Дельта ОС: `workspace_id = … and os_value = … and rev > курсор`.
create index if not exists os_orders_os_rev on public.os_orders (workspace_id, os_value, rev);

-- ---------------------------------------------------------------------
-- Наборы для политик — НАБОРОМ на запрос, а не функцией «на строку»
-- (урок гибрида: функция на строку шла ~5 с на 3000 строк).
-- ---------------------------------------------------------------------

-- isOwner из firestore.rules: владелец по документу workspace (он же
-- owner_id копии) ИЛИ участник с ролью owner.
create or replace function public.rows_owned_workspaces() returns setof text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select w.workspace_id from public.rows_workspaces w
  where public.rows_uid() is not null and w.owner_id = public.rows_uid()
  union
  select m.workspace_id from public.rows_members m
  where m.uid = public.rows_uid() and m.role = 'owner'
$$;

-- Мой ник ОС в каждом моём workspace (пустой ник не открывает ничего — как
-- `osNickValue != ''` в правилах).
create or replace function public.rows_my_os_nicks() returns table (workspace_id text, os_value text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select m.workspace_id, m.os_nick_value
  from public.rows_members m
  where m.uid = public.rows_uid()
    and coalesce(m.os_nick_value, '') <> ''
$$;

-- ---------------------------------------------------------------------
-- Страж записи. Идёт ДО nova_touch (имя по алфавиту раньше): ему нужно
-- старое значение, а пропущенная правка не должна получать новый rev.
--  • updated_by — по токену, а не со слов клиента;
--  • orders — массив, не длиннее 500 (клиент шлёт ≤ 150);
--  • стол и ник у строки не меняются;
--  • прошлый месяц поверх нового не пишется (вкладка, застрявшая после
--    полуночи, вернула бы ОС вчерашний список);
--  • тот же список той же вкладки моложе 90 минут не переписывается
--    (return null — 0 строк, rev не растёт, клиент не звонит), как у
--    desk_loads: стол пишут сразу несколько сессий.
-- Кто вообще может тронуть строку, решают политики ниже — они проверяются
-- ПОСЛЕ BEFORE-триггеров.
-- ---------------------------------------------------------------------
create or replace function public.os_orders_guard() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
begin
  if jsonb_typeof(new.orders) is distinct from 'array' then
    raise exception 'os_orders: orders должен быть массивом' using errcode = '22023';
  end if;
  if jsonb_array_length(new.orders) > 500 then
    raise exception 'os_orders: слишком длинный список' using errcode = '22023';
  end if;
  if me is not null then
    new.updated_by := me;
  end if;
  if tg_op = 'INSERT' then
    return new;
  end if;
  if new.workspace_id <> old.workspace_id or new.page_id <> old.page_id or new.os_value <> old.os_value then
    raise exception 'os_orders: стол и ник у записи не меняются' using errcode = '42501';
  end if;
  if new.month_key < old.month_key then
    return null;
  end if;
  if new.month_key = old.month_key
     and new.sub_page_id = old.sub_page_id
     and new.responsible_uid = old.responsible_uid
     and new.orders = old.orders
     and old.server_at > now() - interval '90 minutes' then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists os_orders_10_guard on public.os_orders;
create trigger os_orders_10_guard before insert or update on public.os_orders
  for each row execute function public.os_orders_guard();
drop trigger if exists os_orders_20_touch on public.os_orders;
create trigger os_orders_20_touch before insert or update on public.os_orders
  for each row execute function public.nova_touch();

alter table public.os_orders enable row level security;

-- osOrders: allow read: if isOwner || (isMember && osNickValue != '' && osValue == osNickValue);
-- плюс писатель своего стола (см. шапку — без этого не работает upsert).
drop policy if exists os_orders_read on public.os_orders;
create policy os_orders_read on public.os_orders for select to anon, authenticated
  using (
    workspace_id in (select public.rows_owned_workspaces())
    or (workspace_id, os_value) in (select n.workspace_id, n.os_value from public.rows_my_os_nicks() n)
    or (workspace_id, page_id) in (select e.workspace_id, e.page_id from public.rows_editable_pages() e)
  );

-- osOrders: canEditPage + настоящий ответственный, как desk_loads. Плюс
-- живое хранилище (до переноса строк и после отката сюда не пишет никто,
-- кроме Owner во время переноса).
drop policy if exists os_orders_insert on public.os_orders;
create policy os_orders_insert on public.os_orders for insert to anon, authenticated
  with check (
    workspace_id in (select public.rows_writable_workspaces())
    and (
      workspace_id in (select public.rows_edit_all_workspaces())
      or (workspace_id, page_id) in (select e.workspace_id, e.page_id from public.rows_editable_pages() e)
    )
    and (workspace_id, page_id, responsible_uid) in
      (select r.workspace_id, r.page_id, r.responsible_uid from public.rows_page_responsibles() r)
  );

drop policy if exists os_orders_update on public.os_orders;
create policy os_orders_update on public.os_orders for update to anon, authenticated
  using (
    workspace_id in (select public.rows_writable_workspaces())
    and (
      workspace_id in (select public.rows_edit_all_workspaces())
      or (workspace_id, page_id) in (select e.workspace_id, e.page_id from public.rows_editable_pages() e)
    )
  )
  with check (
    workspace_id in (select public.rows_writable_workspaces())
    and (
      workspace_id in (select public.rows_edit_all_workspaces())
      or (workspace_id, page_id) in (select e.workspace_id, e.page_id from public.rows_editable_pages() e)
    )
    and (workspace_id, page_id, responsible_uid) in
      (select r.workspace_id, r.page_id, r.responsible_uid from public.rows_page_responsibles() r)
  );
-- Удаления нет — как в firestore.rules (allow delete у osOrders нет): список
-- ОС, у которого заказы переназначили, клиент перестаёт показывать сам
-- (верит ему, только пока deskLoad.osCounts[ник] > 0 за ту же вкладку).

-- Supabase по default privileges открывает новые таблицы ролям API целиком
-- (урок nova_rev_seq) — оставляем ровно нужное; TRUNCATE мимо RLS не нужен никому.
revoke all on public.os_orders from public, anon, authenticated;
grant select, insert, update on public.os_orders to anon, authenticated;
grant execute on function public.rows_owned_workspaces() to anon, authenticated;
grant execute on function public.rows_my_os_nicks() to anon, authenticated;
