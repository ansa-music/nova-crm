-- =====================================================================
-- Nova CRM — общий каркас для коллекций, которые переезжают из Firestore
-- в Supabase (счётчики столов, дальше присутствие, уведомления, заказы ОС,
-- чаты, журнал). Повторяемый файл: «Скопировать SQL» вставляет ВСЕ файлы
-- миграций разом, поэтому здесь только create … if not exists /
-- create or replace.
--
-- Зачем каркас. Postgres Changes в проде не поднимается (ID-токен Firebase
-- без claim `role`), поэтому живость держится «звонком» (broadcast без
-- данных) и дочитыванием своим токеном. Дочитывать ВСЁ на каждый звонок —
-- это 5 ГБ трафика Supabase Free за неделю, поэтому у каждой строки есть
-- серверный номер правки `rev`: клиент спрашивает `rev > курсор` и получает
-- одну-две строки. Часы клиента (`updated_at = Date.now()`) курсором не
-- годятся: у разных устройств они разные.
-- =====================================================================

-- Одна последовательность на все коллекции: номер правки уникален и растёт
-- во всей базе, курсор одной коллекции не путается с другой.
create sequence if not exists public.nova_rev_seq;

-- BEFORE INSERT/UPDATE: номер правки и серверное время — ставит база, а не
-- клиент. SECURITY DEFINER: nextval нужен право на последовательность, а
-- выдавать его anon значит дать любому с публичным ключом крутить счётчик.
-- Триггеры коллекции, которым нужно старое значение (слияние, архив), должны
-- идти РАНЬШЕ по имени: Postgres запускает BEFORE-триггеры по алфавиту.
create or replace function public.nova_touch() returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  new.rev := nextval('public.nova_rev_seq');
  new.server_at := now();
  return new;
end;
$$;

-- Workspace, где я участник, — НАБОРОМ, а не функцией «на строку».
-- Политика вида `workspace_id in (select public.rows_my_workspaces())`
-- считает набор один раз на запрос (урок гибрида: функция на строку шла
-- ~5 с на 3000 строк, набор — 5 мс). Это `isMember` из firestore.rules:
-- владелец без записи участника сюда не входит, как и там.
create or replace function public.rows_my_workspaces() returns setof text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select m.workspace_id from public.rows_members m
  where m.uid = public.rows_uid()
$$;

grant execute on function public.rows_my_workspaces() to anon, authenticated;
