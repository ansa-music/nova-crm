-- =====================================================================
-- Nova CRM — уведомления (колокольчик и всплывашки о заказах) в Postgres.
-- Повторяемый файл: «Скопировать SQL» вставляет ВСЕ файлы миграций разом и
-- повторно, поэтому здесь только create … if not exists / create or replace /
-- drop … if exists.
--
-- Зачем. В Firestore уведомление — документ на КАЖДОГО получателя: новый
-- заказ биржи давал ~18 записей, каждую читал свой колокольчик, а чистка и
-- «прочитать всё» шли пачками записей и удалений (≈1,7k записей, ≈0,7k
-- удалений и ≈5–6k чтений в сутки из квоты Spark). Здесь рассылка на N
-- получателей — ОДИН вызов send_notifications, «прочитать всё» — один UPDATE,
-- чистка — один DELETE, и всё без суточной квоты.
--
-- Права повторяют notifications в firestore.rules:
--  • читает, помечает прочитанным и удаляет только адресат
--    (target_uid = rows_uid()); править можно ТОЛЬКО поле read — остальное
--    держит BEFORE-триггер и права на столбцы;
--  • создаёт любой участник workspace и только от своего имени (from_uid =
--    токен) — упоминания в чатах должны пускать любого к любому. Клиент
--    напрямую не вставляет вовсе: только через send_notifications, который
--    проверяет отправителя и оставляет только получателей-участников.
-- Опирается на копию прав rows_* (20260923_desk_rows.sql) и nova_touch
-- (20260927_nova_sync.sql): rev и server_at ставит база, курсор дельты у
-- клиента — rev (часы устройств курсором не годятся).
-- =====================================================================

create table if not exists public.notifications (
  workspace_id text not null references public.rows_workspaces (workspace_id) on delete cascade,
  -- `{пачка}_{uid}`: один и тот же id у копии в Firestore (запасной путь
  -- при сбое вызова) — читатель склеивает два источника по id.
  id text not null,
  target_uid text not null,
  from_uid text not null,
  from_name text not null default '',
  title text not null default '',
  body text not null default '',
  priority text not null default 'normal' check (priority in ('normal', 'important', 'urgent')),
  href text,
  page_id text,
  kind text,
  related_announcement_id text,
  view_request_id text,
  owner_request_id text,
  read boolean not null default false,
  -- Миллисекунды эпохи, как createdAt в Firestore, но СЕРВЕРНЫЕ: ставит
  -- send_notifications. По ним окно колокольчика и «новое» у всплывашек.
  created_at bigint not null,
  rev bigint not null default 0,
  server_at timestamptz not null default now(),
  primary key (workspace_id, id)
);
-- Дельта «мои, rev > курсор» и окно «мои последние 40».
create index if not exists notifications_rev on public.notifications (workspace_id, target_uid, rev);
create index if not exists notifications_window on public.notifications (workspace_id, target_uid, created_at desc);

-- ---------------------------------------------------------------------
-- Страж правки. Идёт ДО nova_touch (имя по алфавиту раньше), чтобы
-- пропущенная правка не получала новый rev:
--  • меняться может только read (как affectedKeys().hasOnly(['read']));
--  • read не изменился — строку не трогаем (return null: 0 строк, rev не
--    растёт, дельта у других устройств не качает пустую «правку»).
-- ---------------------------------------------------------------------
create or replace function public.notifications_guard() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (to_jsonb(new) - array['read', 'rev', 'server_at']) is distinct from (to_jsonb(old) - array['read', 'rev', 'server_at']) then
    raise exception 'notifications: менять можно только read' using errcode = '42501';
  end if;
  if new.read is not distinct from old.read then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_10_guard on public.notifications;
create trigger notifications_10_guard before update on public.notifications
  for each row execute function public.notifications_guard();
drop trigger if exists notifications_20_touch on public.notifications;
create trigger notifications_20_touch before insert or update on public.notifications
  for each row execute function public.nova_touch();

alter table public.notifications enable row level security;

-- `(select rows_uid())` — один раз на запрос, а не на строку.
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to anon, authenticated
  using (target_uid = (select public.rows_uid()));

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update to anon, authenticated
  using (target_uid = (select public.rows_uid()))
  with check (target_uid = (select public.rows_uid()));

drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications for delete to anon, authenticated
  using (target_uid = (select public.rows_uid()));
-- Политики вставки НЕТ: вставляет только send_notifications (SECURITY DEFINER).

-- Настоящий Supabase по default privileges схемы public отдаёт ролям API ВСЕ
-- права на новую таблицу, включая TRUNCATE (его RLS не останавливает) и
-- INSERT. Поэтому сначала забираем всё, потом выдаём ровно нужное: чтение,
-- удаление своих и правку ОДНОГО столбца read (вторая стена за триггером).
revoke all on public.notifications from public, anon, authenticated;
grant select, delete on public.notifications to anon, authenticated;
grant update (read) on public.notifications to anon, authenticated;

-- ---------------------------------------------------------------------
-- Рассылка: одна вставка на всех получателей.
--  • отправитель — участник workspace (isMember) и from_uid = его токен
--    (fromUid в payload, если прислан, обязан совпасть);
--  • получатели — только участники этого workspace, без повторов и без
--    самого отправителя; не участник (копия прав ещё не догнала) молча
--    пропускается — клиент видит, кто принят, и остальным пишет по-старому;
--  • id строки — `{payload.id}_{uid}`, повтор той же пачки (ответ потерялся
--    в сети) дублей не даёт;
--  • created_at — серверное время, текстовые поля обрезаются.
-- Возвращает принятых получателей (в том числе уже записанных прошлым
-- повтором пачки).
-- ---------------------------------------------------------------------
create or replace function public.send_notifications(p_workspace text, p_uids text[], p_payload jsonb)
returns setof text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  v_batch text;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_priority text;
begin
  if me is null or p_workspace is null or not public.rows_is_member(p_workspace) then
    raise exception 'send_notifications: отправитель не участник workspace' using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'send_notifications: payload должен быть объектом' using errcode = '22023';
  end if;
  if coalesce(p_payload ->> 'fromUid', me) <> me then
    raise exception 'send_notifications: from_uid не совпадает с токеном' using errcode = '42501';
  end if;
  v_batch := p_payload ->> 'id';
  if v_batch is null or v_batch !~ '^[A-Za-z0-9_-]{1,100}$' then
    raise exception 'send_notifications: неверный id пачки' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_uids), 0) > 500 then
    raise exception 'send_notifications: слишком много получателей' using errcode = '22023';
  end if;
  v_priority := coalesce(p_payload ->> 'priority', 'normal');
  if v_priority not in ('normal', 'important', 'urgent') then
    v_priority := 'normal';
  end if;

  return query
  with targets as (
    select distinct u.uid
    from unnest(coalesce(p_uids, '{}'::text[])) as u (uid)
    join public.rows_members m on m.workspace_id = p_workspace and m.uid = u.uid
    where u.uid is not null and u.uid <> me
  ),
  ins as (
    insert into public.notifications as n (
      workspace_id, id, target_uid, from_uid, from_name, title, body, priority, href, page_id, kind,
      related_announcement_id, view_request_id, owner_request_id, read, created_at)
    select p_workspace, v_batch || '_' || t.uid, t.uid, me,
      left(coalesce(p_payload ->> 'fromName', ''), 200),
      left(coalesce(p_payload ->> 'title', ''), 300),
      left(coalesce(p_payload ->> 'body', ''), 4000),
      v_priority,
      left(p_payload ->> 'href', 1000),
      left(p_payload ->> 'pageId', 200),
      left(p_payload ->> 'kind', 64),
      left(p_payload ->> 'relatedAnnouncementId', 200),
      left(p_payload ->> 'viewRequestId', 200),
      left(p_payload ->> 'ownerRequestId', 200),
      false, v_now
    from targets t
    on conflict (workspace_id, id) do nothing
  )
  select t.uid from targets t;
end;
$$;

-- ---------------------------------------------------------------------
-- Чистка: мои ПРОЧИТАННЫЕ старше 14 дней — одним DELETE. Клиент зовёт не
-- чаще раза в сутки (pg_cron не нужен). SECURITY INVOKER: удалить можно
-- только своё — решает политика notifications_delete.
-- ---------------------------------------------------------------------
create or replace function public.cleanup_read_notifications(p_workspace text)
returns integer
language sql
volatile
security invoker
set search_path = public, pg_temp
as $$
  with gone as (
    delete from public.notifications n
    where n.workspace_id = p_workspace
      and n.target_uid = public.rows_uid()
      and n.read
      and n.created_at < (extract(epoch from now()) * 1000)::bigint - 14::bigint * 86400000
    returning 1
  )
  select count(*)::integer from gone
$$;

grant execute on function public.send_notifications(text, text[], jsonb) to anon, authenticated;
grant execute on function public.cleanup_read_notifications(text) to anon, authenticated;
