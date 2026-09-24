-- =====================================================================
-- Nova CRM — счётчики столов (deskLoad) и архив месяцев (deskLoadHistory)
-- в Postgres. Повторяемый файл.
--
-- Зачем. Счётчики стола пишет сам стол (useDeskLoadPublisher) сотни раз в
-- день, а читают их все открытые «Дашборд», «Технари», «Заказы», ABS —
-- в Firestore каждая публикация стоила чтение у каждого зрителя (≈11–13 тыс.
-- чтений в сутки из 50 тыс. Spark). Здесь квоты на операции нет.
--
-- Права — те же, что у deskLoad в firestore.rules: читает любой участник;
-- пишет тот, кто правит строки стола (canEditPage), и только с НАСТОЯЩИМ
-- ответственным за стол — ему верит правило оценок. Копия прав — rows_*
-- (её ведёт useRowAclSync, поэтому коллекция включается только при
-- rowsBackend = "supabase").
--
-- Минимальный документ deskLoad в Firestore остаётся: правило оценок ОС
-- (hasRecentOrderFrom) читает оттуда responsibleUserId и osLastOrderAt.
-- =====================================================================

create table if not exists public.desk_loads (
  workspace_id text not null references public.rows_workspaces (workspace_id) on delete cascade,
  page_id text not null,
  responsible_uid text not null,
  month_key text not null check (month_key ~ '^[0-9]{4}-[0-9]{2}$'),
  sub_page_id text not null,
  -- Сами цифры — как в документе Firestore (total, statusCounts, osCounts,
  -- osStatusCounts, osLastOrderAt, grandTotal, statusSums, dayCounts,
  -- daySums): экраны читают их без перевода, а новое поле счётчиков не
  -- требует миграции.
  data jsonb not null default '{}'::jsonb,
  updated_by text,
  rev bigint not null default 0,
  server_at timestamptz not null default now(),
  primary key (workspace_id, page_id)
);
create index if not exists desk_loads_rev on public.desk_loads (workspace_id, rev);

-- Прошлые месяцы. Клиент сюда НЕ пишет: архив делает триггер desk_loads при
-- первой публикации нового месяца (как транзакция publishDeskLoad в Firestore).
create table if not exists public.desk_load_history (
  workspace_id text not null references public.rows_workspaces (workspace_id) on delete cascade,
  page_id text not null,
  month_key text not null check (month_key ~ '^[0-9]{4}-[0-9]{2}$'),
  responsible_uid text,
  sub_page_id text,
  data jsonb not null default '{}'::jsonb,
  updated_by text,
  archived_at timestamptz not null default now(),
  rev bigint not null default 0,
  server_at timestamptz not null default now(),
  primary key (workspace_id, page_id, month_key)
);
create index if not exists desk_load_history_month on public.desk_load_history (workspace_id, month_key);
-- На когда верны цифры архива — server_at строки месяца на момент архивации
-- (server_at самой архивной строки — время архивации). По нему клиент
-- склеивает архив Supabase с архивом Firestore (mergeHistory): побеждают
-- более свежие цифры, а не более поздняя архивация.
alter table public.desk_load_history add column if not exists counts_at timestamptz;

-- ---------------------------------------------------------------------
-- Слияние «последний заказ от ОС» (mergeOsLastOrderAt из utils/techLoad.ts):
-- у каждого ОС — самый новый день, прошлые старше 40 дней выбрасываются.
-- Слияние в базе, а не «прочитал-склеил-записал» в браузере: две сессии
-- одного стола иначе теряли бы чужого ОС (урок гибрида про rows_patch).
-- ---------------------------------------------------------------------
create or replace function public.nova_merge_os_last(prev jsonb, nxt jsonb, now_ms bigint) returns jsonb
language sql immutable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_object_agg(s.k, s.v), '{}'::jsonb)
  from (
    select u.k, max(u.v) as v
    from (
      select p.key as k, (p.value #>> '{}')::numeric as v
      from jsonb_each(case when jsonb_typeof(prev) = 'object' then prev else '{}'::jsonb end) p
      where jsonb_typeof(p.value) = 'number'
        and (p.value #>> '{}')::numeric > now_ms - 40::numeric * 86400000
      union all
      select n.key, (n.value #>> '{}')::numeric
      from jsonb_each(case when jsonb_typeof(nxt) = 'object' then nxt else '{}'::jsonb end) n
      where jsonb_typeof(n.value) = 'number'
    ) u
    group by u.k
  ) s
$$;

-- ---------------------------------------------------------------------
-- Страж записи. Идёт ДО nova_touch (имя по алфавиту раньше): ему нужно
-- старое значение, а пропущенная правка не должна получать новый rev.
--  • updated_by — по токену, а не со слов клиента;
--  • osLastOrderAt сливается со старым;
--  • те же цифры той же вкладки, записанные меньше 90 минут назад, не
--    переписываются (return null — строка не меняется, rev не растёт,
--    клиент видит «0 строк» и не звонит) — как REWRITE_UNCHANGED_AFTER_MS;
--  • прошлый месяц поверх нового не пишется (застрявшая вкладка после
--    полуночи отправила бы новый месяц в архив);
--  • первая публикация нового месяца архивирует прежний.
-- SECURITY DEFINER — ради вставки в архив, куда у клиента права нет. Кто
-- вообще может тронуть строку, решают политики ниже: они проверяются ПОСЛЕ
-- BEFORE-триггеров, и отказ откатывает и вставку в архив.
-- ---------------------------------------------------------------------
create or replace function public.desk_loads_guard() returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if jsonb_typeof(new.data) is distinct from 'object' then
    raise exception 'desk_loads: data должен быть объектом' using errcode = '22023';
  end if;
  if me is not null then
    new.updated_by := me;
  end if;
  -- Опорные поля живут в столбцах; копия в data разошлась бы с ними.
  new.data := new.data - array['pageId', 'workspaceId', 'responsibleUserId', 'monthKey', 'subPageId',
    'updatedAt', 'updatedBy', 'archivedAt'];

  if tg_op = 'INSERT' then
    new.data := jsonb_set(new.data, '{osLastOrderAt}',
      public.nova_merge_os_last(null, new.data -> 'osLastOrderAt', now_ms));
    return new;
  end if;

  if new.workspace_id <> old.workspace_id or new.page_id <> old.page_id then
    raise exception 'desk_loads: стол у записи не меняется' using errcode = '42501';
  end if;
  if new.month_key < old.month_key then
    return null;
  end if;
  new.data := jsonb_set(new.data, '{osLastOrderAt}',
    public.nova_merge_os_last(old.data -> 'osLastOrderAt', new.data -> 'osLastOrderAt', now_ms));
  if new.month_key = old.month_key
     and new.sub_page_id = old.sub_page_id
     and new.responsible_uid = old.responsible_uid
     and new.data = old.data
     and old.server_at > now() - interval '90 minutes' then
    return null;
  end if;
  if new.month_key <> old.month_key then
    insert into public.desk_load_history as h
      (workspace_id, page_id, month_key, responsible_uid, sub_page_id, data, updated_by, archived_at, counts_at)
    values (old.workspace_id, old.page_id, old.month_key, old.responsible_uid, old.sub_page_id, old.data,
      old.updated_by, now(), old.server_at)
    on conflict (workspace_id, page_id, month_key) do update
      set responsible_uid = excluded.responsible_uid,
          sub_page_id = excluded.sub_page_id,
          data = excluded.data,
          updated_by = excluded.updated_by,
          archived_at = excluded.archived_at,
          counts_at = excluded.counts_at;
  end if;
  return new;
end;
$$;

drop trigger if exists desk_loads_10_guard on public.desk_loads;
create trigger desk_loads_10_guard before insert or update on public.desk_loads
  for each row execute function public.desk_loads_guard();
drop trigger if exists desk_loads_20_touch on public.desk_loads;
create trigger desk_loads_20_touch before insert or update on public.desk_loads
  for each row execute function public.nova_touch();
drop trigger if exists desk_load_history_20_touch on public.desk_load_history;
create trigger desk_load_history_20_touch before insert or update on public.desk_load_history
  for each row execute function public.nova_touch();

-- ---------------------------------------------------------------------
-- Ответственные за столы в МОИХ workspace — набором на запрос (урок: не
-- функция на строку). Нужен политике записи: ответственный в счётчиках
-- обязан совпадать с копией прав стола, иначе технарь объявил бы себя
-- ответственным за чужой стол и получил бы оценки ОС.
-- ---------------------------------------------------------------------
create or replace function public.rows_page_responsibles() returns table (workspace_id text, page_id text, responsible_uid text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select a.workspace_id, a.page_id, a.responsible_uid
  from public.rows_page_acl a
  where a.responsible_uid is not null
    and a.workspace_id in (select m.workspace_id from public.rows_members m where m.uid = public.rows_uid())
$$;

alter table public.desk_loads enable row level security;
alter table public.desk_load_history enable row level security;

-- deskLoad: allow read: if isMember(workspaceId).
drop policy if exists desk_loads_read on public.desk_loads;
create policy desk_loads_read on public.desk_loads for select to anon, authenticated
  using (workspace_id in (select public.rows_my_workspaces()));

-- deskLoad: canEditPage + настоящий ответственный. Плюс живое хранилище
-- (rows_writable_workspaces): до переноса строк и после отката сюда не пишет
-- никто, кроме Owner во время переноса, — как у desk_rows.
drop policy if exists desk_loads_insert on public.desk_loads;
create policy desk_loads_insert on public.desk_loads for insert to anon, authenticated
  with check (
    workspace_id in (select public.rows_writable_workspaces())
    and (
      workspace_id in (select public.rows_edit_all_workspaces())
      or (workspace_id, page_id) in (select e.workspace_id, e.page_id from public.rows_editable_pages() e)
    )
    and (workspace_id, page_id, responsible_uid) in
      (select r.workspace_id, r.page_id, r.responsible_uid from public.rows_page_responsibles() r)
  );

-- UPDATE видит только строки, прошедшие политику чтения (урок гибрида), и
-- проверяет новую строку тем же условием, что вставка. upsert — это INSERT
-- ON CONFLICT, и Postgres проверяет политику вставки и при правке.
drop policy if exists desk_loads_update on public.desk_loads;
create policy desk_loads_update on public.desk_loads for update to anon, authenticated
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

-- deskLoadHistory: читает любой участник; пишет только триггер.
drop policy if exists desk_load_history_read on public.desk_load_history;
create policy desk_load_history_read on public.desk_load_history for select to anon, authenticated
  using (workspace_id in (select public.rows_my_workspaces()));

grant select, insert, update on public.desk_loads to anon, authenticated;
grant select on public.desk_load_history to anon, authenticated;
grant execute on function public.rows_page_responsibles() to anon, authenticated;
