-- Минимальная копия окружения Supabase для локальной проверки миграции:
-- роли API, auth.jwt() из request.jwt.claims (так её и считает Supabase),
-- публикация Realtime и старое зеркало row_records с «открытой» политикой.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema if not exists auth;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.jwt() to anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
create table if not exists public.row_records (id text primary key, page_id text, cells jsonb);
alter table public.row_records enable row level security;
drop policy if exists open_all on public.row_records;
create policy open_all on public.row_records for all to anon using (true) with check (true);
grant all on public.row_records to anon, authenticated;
-- Как в Supabase: новые последовательности схемы public по умолчанию открыты
-- ролям API. Без этого тест не видел, что nova_rev_seq надо закрывать явно.
alter default privileges in schema public grant all on sequences to anon, authenticated;
