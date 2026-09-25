-- =====================================================================
-- Nova CRM — чаты в Postgres (26.09.2026, фаза 3 переезда с Firestore;
-- условие Nurba — никто не должен заметить перемен). Повторяемый файл.
--
-- Четыре нити Firestore — одна таблица chat_messages с полем thread:
--   ws                 — общий чат workspace   (workspaceChat)
--   page:{pageId}      — чат стола             (pages/{p}/chat)
--   row:{pageId}:{row} — комментарии к строке  (pages/{p}/rows/{r}/comments)
--   dm:{a}_{b}         — личная переписка      (privateChats/{a_b}/messages)
-- Права повторяют firestore.rules: общий чат — участник; чат стола и
-- комментарии — canAccessPage (наборы rows_read_all_workspaces /
-- rows_readable_pages); личка — только двое участников (peer_a/peer_b из
-- отсортированной пары uid); правит и удаляет только автор, и менять можно
-- ТОЛЬКО text / edited_at / deleted (страж). Пишет только send_chat_message
-- (SECURITY DEFINER): author_uid и created_at — серверные, он же ведёт
-- карточку личной переписки chat_dm_meta (в Firestore её писал клиент).
-- chat_reads — отметки «прочитано» (Firestore readMarkers): каждый пишет и
-- читает только свои.
-- Живость — звонок nova:{ws}:chat без данных + дельта по rev (nova_touch).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Сообщения.
-- ---------------------------------------------------------------------
create table if not exists public.chat_messages (
  workspace_id text not null references public.rows_workspaces (workspace_id) on delete cascade,
  id text not null,
  kind text not null check (kind in ('ws', 'page', 'row', 'dm')),
  thread text not null,
  page_id text not null default '',
  row_id text not null default '',
  chat_id text not null default '',
  peer_a text,
  peer_b text,
  author_uid text not null,
  author_name text not null default '',
  author_photo_url text,
  text text not null default '',
  -- Серверное время, миллисекунды (в Firestore порядок давал serverOrderAt).
  created_at bigint not null,
  edited_at bigint,
  deleted boolean not null default false,
  reply_to_id text,
  reply_to_author_name text,
  reply_to_text text,
  rev bigint not null default 0,
  server_at timestamptz not null default now(),
  primary key (workspace_id, id)
);
create index if not exists chat_messages_thread on public.chat_messages (workspace_id, thread, created_at desc);
create index if not exists chat_messages_thread_rev on public.chat_messages (workspace_id, thread, rev);

-- Страж правки: меняются только text / edited_at / deleted; ничего не
-- изменилось — строку не трогаем (0 строк, rev не растёт).
create or replace function public.chat_messages_guard() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (to_jsonb(new) - array['text', 'edited_at', 'deleted', 'rev', 'server_at'])
     is distinct from (to_jsonb(old) - array['text', 'edited_at', 'deleted', 'rev', 'server_at']) then
    raise exception 'chat_messages: менять можно только text, edited_at и deleted' using errcode = '42501';
  end if;
  if new.text is not distinct from old.text and new.deleted is not distinct from old.deleted
     and new.edited_at is not distinct from old.edited_at then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists chat_messages_10_guard on public.chat_messages;
create trigger chat_messages_10_guard before update on public.chat_messages
  for each row execute function public.chat_messages_guard();
drop trigger if exists chat_messages_20_touch on public.chat_messages;
create trigger chat_messages_20_touch before insert or update on public.chat_messages
  for each row execute function public.nova_touch();

alter table public.chat_messages enable row level security;

drop policy if exists chat_messages_read on public.chat_messages;
create policy chat_messages_read on public.chat_messages for select to anon, authenticated
  using (
    workspace_id in (select public.rows_my_workspaces())
    and (
      kind = 'ws'
      or (kind in ('page', 'row') and (
        workspace_id in (select public.rows_read_all_workspaces())
        or (workspace_id, page_id) in (select r.workspace_id, r.page_id from public.rows_readable_pages() r)))
      or (kind = 'dm' and (select public.rows_uid()) in (peer_a, peer_b))
    )
  );

drop policy if exists chat_messages_update on public.chat_messages;
create policy chat_messages_update on public.chat_messages for update to anon, authenticated
  using (workspace_id in (select public.rows_my_workspaces()) and author_uid = (select public.rows_uid()))
  with check (workspace_id in (select public.rows_my_workspaces()) and author_uid = (select public.rows_uid()));

drop policy if exists chat_messages_delete on public.chat_messages;
create policy chat_messages_delete on public.chat_messages for delete to anon, authenticated
  using (workspace_id in (select public.rows_my_workspaces()) and author_uid = (select public.rows_uid()));
-- Политики вставки нет: только send_chat_message.

revoke all on public.chat_messages from public, anon, authenticated;
grant select, delete on public.chat_messages to anon, authenticated;
grant update (text, edited_at, deleted) on public.chat_messages to anon, authenticated;

-- ---------------------------------------------------------------------
-- Карточка личной переписки (последнее сообщение) — ведёт send_chat_message.
-- ---------------------------------------------------------------------
create table if not exists public.chat_dm_meta (
  workspace_id text not null references public.rows_workspaces (workspace_id) on delete cascade,
  chat_id text not null,
  peer_a text not null,
  peer_b text not null,
  last_text text not null default '',
  last_at bigint not null,
  last_from_uid text not null,
  last_from_name text not null default '',
  rev bigint not null default 0,
  server_at timestamptz not null default now(),
  primary key (workspace_id, chat_id)
);
create index if not exists chat_dm_meta_a on public.chat_dm_meta (workspace_id, peer_a);
create index if not exists chat_dm_meta_b on public.chat_dm_meta (workspace_id, peer_b);

drop trigger if exists chat_dm_meta_20_touch on public.chat_dm_meta;
create trigger chat_dm_meta_20_touch before insert or update on public.chat_dm_meta
  for each row execute function public.nova_touch();

alter table public.chat_dm_meta enable row level security;

drop policy if exists chat_dm_meta_read on public.chat_dm_meta;
create policy chat_dm_meta_read on public.chat_dm_meta for select to anon, authenticated
  using (workspace_id in (select public.rows_my_workspaces()) and (select public.rows_uid()) in (peer_a, peer_b));

revoke all on public.chat_dm_meta from public, anon, authenticated;
grant select on public.chat_dm_meta to anon, authenticated;

-- ---------------------------------------------------------------------
-- Отметки «прочитано»: свои пишет и читает каждый сам.
-- ---------------------------------------------------------------------
create table if not exists public.chat_reads (
  workspace_id text not null references public.rows_workspaces (workspace_id) on delete cascade,
  uid text not null,
  context text not null,
  last_read_at bigint not null,
  rev bigint not null default 0,
  server_at timestamptz not null default now(),
  primary key (workspace_id, uid, context)
);

drop trigger if exists chat_reads_20_touch on public.chat_reads;
create trigger chat_reads_20_touch before insert or update on public.chat_reads
  for each row execute function public.nova_touch();

alter table public.chat_reads enable row level security;

drop policy if exists chat_reads_read on public.chat_reads;
create policy chat_reads_read on public.chat_reads for select to anon, authenticated
  using (uid = (select public.rows_uid()));

drop policy if exists chat_reads_insert on public.chat_reads;
create policy chat_reads_insert on public.chat_reads for insert to anon, authenticated
  with check (uid = (select public.rows_uid()) and workspace_id in (select public.rows_my_workspaces()));

drop policy if exists chat_reads_update on public.chat_reads;
create policy chat_reads_update on public.chat_reads for update to anon, authenticated
  using (uid = (select public.rows_uid()))
  with check (uid = (select public.rows_uid()));

revoke all on public.chat_reads from public, anon, authenticated;
grant select, insert on public.chat_reads to anon, authenticated;
grant update (last_read_at) on public.chat_reads to anon, authenticated;

-- ---------------------------------------------------------------------
-- Отправка. Возвращает записанную строку (jsonb) — клиент подменяет ею
-- оптимистичное сообщение.
-- ---------------------------------------------------------------------
create or replace function public.send_chat_message(
  p_workspace text,
  p_kind text,
  p_page text,
  p_row text,
  p_peer text,
  p_message jsonb
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_id text;
  v_thread text;
  v_page text := coalesce(p_page, '');
  v_row text := coalesce(p_row, '');
  v_chat text := '';
  v_a text;
  v_b text;
  v_text text;
  v_name text;
  v_out jsonb;
begin
  if me is null or p_workspace is null or not public.rows_is_member(p_workspace) then
    raise exception 'send_chat_message: не участник workspace' using errcode = '42501';
  end if;
  if p_message is null or jsonb_typeof(p_message) <> 'object' then
    raise exception 'send_chat_message: сообщение должно быть объектом' using errcode = '22023';
  end if;
  if p_kind = 'ws' then
    v_thread := 'ws';
    v_page := '';
    v_row := '';
  elsif p_kind in ('page', 'row') then
    if v_page = '' or (p_kind = 'row' and v_row = '') then
      raise exception 'send_chat_message: нет стола или строки' using errcode = '22023';
    end if;
    if not public.rows_can_access_page(p_workspace, v_page) then
      raise exception 'send_chat_message: нет доступа к столу' using errcode = '42501';
    end if;
    if p_kind = 'page' then
      v_row := '';
      v_thread := 'page:' || v_page;
    else
      v_thread := 'row:' || v_page || ':' || v_row;
    end if;
  elsif p_kind = 'dm' then
    if coalesce(p_peer, '') = '' or p_peer = me then
      raise exception 'send_chat_message: нет собеседника' using errcode = '22023';
    end if;
    if not exists (select 1 from public.rows_members m where m.workspace_id = p_workspace and m.uid = p_peer) then
      raise exception 'send_chat_message: собеседник не участник workspace' using errcode = '42501';
    end if;
    v_a := least(me, p_peer);
    v_b := greatest(me, p_peer);
    v_chat := v_a || '_' || v_b;
    v_thread := 'dm:' || v_chat;
    v_page := '';
    v_row := '';
  else
    raise exception 'send_chat_message: неверный вид нити' using errcode = '22023';
  end if;

  v_id := p_message ->> 'id';
  if v_id is null or v_id !~ '^[A-Za-z0-9_-]{1,100}$' then
    v_id := 'msg_' || md5(random()::text || clock_timestamp()::text);
  end if;
  v_text := left(coalesce(p_message ->> 'text', ''), 4000);
  v_name := left(coalesce(p_message ->> 'authorName', ''), 200);

  insert into public.chat_messages (workspace_id, id, kind, thread, page_id, row_id, chat_id, peer_a, peer_b,
    author_uid, author_name, author_photo_url, text, created_at, edited_at, deleted,
    reply_to_id, reply_to_author_name, reply_to_text)
  values (p_workspace, v_id, p_kind, v_thread, v_page, v_row, v_chat, v_a, v_b,
    me, v_name, left(p_message ->> 'authorPhotoURL', 1000), v_text, v_now, null, false,
    left(p_message ->> 'replyToId', 100), left(p_message ->> 'replyToAuthorName', 200), left(p_message ->> 'replyToText', 140))
  on conflict (workspace_id, id) do nothing;

  if p_kind = 'dm' then
    insert into public.chat_dm_meta as d (workspace_id, chat_id, peer_a, peer_b, last_text, last_at, last_from_uid, last_from_name)
    values (p_workspace, v_chat, v_a, v_b, left(v_text, 140), v_now, me, v_name)
    on conflict (workspace_id, chat_id) do update set
      last_text = excluded.last_text,
      last_at = excluded.last_at,
      last_from_uid = excluded.last_from_uid,
      last_from_name = excluded.last_from_name
    where excluded.last_at >= d.last_at;
  end if;

  select to_jsonb(m) into v_out from public.chat_messages m where m.workspace_id = p_workspace and m.id = v_id;
  return v_out;
end;
$$;

revoke all on function public.send_chat_message(text, text, text, text, text, jsonb) from public;
grant execute on function public.send_chat_message(text, text, text, text, text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Версия схемы.
-- ---------------------------------------------------------------------
create or replace function public.nova_schema_version() returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select '20261009'::text
$$;

revoke all on function public.nova_schema_version() from public, anon, authenticated;
grant execute on function public.nova_schema_version() to anon, authenticated;
