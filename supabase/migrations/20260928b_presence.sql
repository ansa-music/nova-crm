-- =====================================================================
-- Nova CRM — присутствие «в сети» в Postgres (повторяемый файл).
--
-- Раньше пульс писал `lastActiveAt` в member-документ Firestore раз в 15
-- минут. Сам удар дешёвый, но он «пачкал» ВСЕ member-документы: каждое
-- чтение ростера (fetchMembers/fetchMembersFresh через resume-токен) платило
-- почти за весь список — тысячи чтений в сутки при лимите Spark 50 000.
-- Здесь нет суточной квоты, поэтому пульс идёт раз в 5 минут, а документы
-- участников в Firestore становятся «тихими».
--
-- Права — по копии прав rows_* (20260923_desk_rows.sql): читает любой
-- участник workspace (как members в firestore.rules: allow read if isMember),
-- пишет человек только СВОЮ строку. Время ставит сервер (триггер ниже):
-- часы клиента могут врать, а «вечно в сети» с часами из будущего никому не
-- нужно.
--
-- Файл не опирается на 20260927_nova_sync.sql — только на копию прав, чтобы
-- его можно было вставить и отдельно.
-- =====================================================================

create table if not exists public.member_presence (
  workspace_id text not null references public.rows_workspaces (workspace_id) on delete cascade,
  uid text not null,
  -- Миллисекунды эпохи — как `lastActiveAt` в Firestore: экраны берут
  -- максимум из двух источников, пока старые вкладки ещё пишут туда.
  last_active_at bigint not null default 0,
  server_at timestamptz not null default now(),
  primary key (workspace_id, uid)
);

-- Время удара — серверное, что бы ни прислал клиент.
create or replace function public.member_presence_touch() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.server_at := now();
  new.last_active_at := (extract(epoch from now()) * 1000)::bigint;
  return new;
end;
$$;

drop trigger if exists member_presence_touch on public.member_presence;
create trigger member_presence_touch before insert or update on public.member_presence
  for each row execute function public.member_presence_touch();

alter table public.member_presence enable row level security;

-- Строк ~30 на workspace, поэтому функция «на строку» здесь допустима (урок
-- про наборы — для desk_rows с тысячами строк).
drop policy if exists member_presence_read on public.member_presence;
create policy member_presence_read on public.member_presence for select to anon, authenticated
  using (public.rows_is_member(workspace_id));

drop policy if exists member_presence_insert on public.member_presence;
create policy member_presence_insert on public.member_presence for insert to anon, authenticated
  with check (uid = public.rows_uid() and public.rows_is_member(workspace_id));

drop policy if exists member_presence_update on public.member_presence;
create policy member_presence_update on public.member_presence for update to anon, authenticated
  using (uid = public.rows_uid() and public.rows_is_member(workspace_id))
  with check (uid = public.rows_uid() and public.rows_is_member(workspace_id));
-- Удаления с клиента нет: строка убранного человека уходит вместе с
-- workspace (cascade), а до того просто стареет.

-- Удар во все workspace человека ОДНИМ запросом. SECURITY INVOKER — политики
-- выше решают как для прямой записи. Workspace, где человека нет в копии
-- прав (копия ещё не догнала, строки в Firestore, устаревший id), молча
-- пропускается, а не роняет весь удар ошибкой внешнего ключа: клиент видит,
-- какие легли, и остальные пишет по-старому в Firestore.
create or replace function public.presence_beat(p_workspaces text[])
returns table (workspace_id text, last_active_at bigint)
language sql
volatile
security invoker
set search_path = public, pg_temp
as $$
  insert into public.member_presence as p (workspace_id, uid, last_active_at)
  select distinct w.ws, public.rows_uid(), 0
  from unnest(coalesce(p_workspaces, '{}'::text[])) as w (ws)
  where public.rows_uid() is not null and public.rows_is_member(w.ws)
  on conflict on constraint member_presence_pkey do update set last_active_at = excluded.last_active_at
  returning p.workspace_id, p.last_active_at
$$;

grant select, insert, update on public.member_presence to anon, authenticated;
grant execute on function public.presence_beat(text[]) to anon, authenticated;
