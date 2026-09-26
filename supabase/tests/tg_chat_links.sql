-- Проверки 20261013_tg_chat_links.sql: привязка чата Telegram к нику ОС.
-- Запускать ПОСЛЕ desk_rows_rls.sql (участники W: O — Owner, TL — Тимлид,
-- TLO — Тимлид + ОС, T1..T3 — технари, OS1/OS2 — ОС, V — Viewer, X —
-- посторонний с настоящим токеном).
\set ON_ERROR_STOP 1
set client_min_messages = warning;
truncate tst.results;

create or replace function tst.jval(uid text, sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', tst.claims(uid), true);
  execute 'set local role anon';
  execute sql into v;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
exception when others then
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return 'error:' || sqlstate;
end;
$$;

-- Раздел открыт OS1 и T1.
select tst.run('O', $q$select * from tg_set_access('W', '{OS1,T1}')$q$);

select tst.expect('допущенный ОС привязывает чат к своему нику',
  tst.jval('OS1', $q$select (tg_link_chat('W', 101, 'resp_a', 'Айгерим') ->> 'os_value')$q$), 'resp_a');
select tst.run('OS1', $q$select tg_link_chat('W', 101, 'resp_a', 'Айгерим')$q$);
select tst.expect('в таблице одна привязка, кто привязал — из токена',
  (select os_value || '|' || title || '|' || bound_by from public.tg_chat_links where workspace_id = 'W' and chat_id = 101), 'resp_a|Айгерим|OS1');
select tst.expect('допущенный технарь видит привязку', tst.try('T1', $q$select * from tg_chat_links$q$, true), 'ok:1');
select tst.expect('Owner видит привязку', tst.try('O', $q$select * from tg_chat_links$q$, true), 'ok:1');
select tst.expect('недопущенный ОС не видит', tst.try('OS2', $q$select * from tg_chat_links$q$, true), 'ok:0');
select tst.expect('Тимлид без доступа не видит', tst.try('TL', $q$select * from tg_chat_links$q$, true), 'ok:0');
select tst.expect('посторонний не видит', tst.try('X', $q$select * from tg_chat_links$q$, true), 'ok:0');

select tst.expect('допущенный технарь перепривязывает к другому нику (без имени — прежнее остаётся)',
  tst.jval('T1', $q$select (tg_link_chat('W', 101, 'resp_ali', '') ->> 'title')$q$), 'Айгерим');
select tst.run('T1', $q$select tg_link_chat('W', 101, 'resp_ali', '')$q$);
select tst.expect('ник сменился, привязал T1',
  (select os_value || '|' || bound_by from public.tg_chat_links where workspace_id = 'W' and chat_id = 101), 'resp_ali|T1');
select tst.expect('недопущенный ОС не привязывает', tst.try('OS2', $q$select tg_link_chat('W', 102, 'resp_a', 'x')$q$), 'error');
select tst.expect('Тимлид без доступа не привязывает', tst.try('TL', $q$select tg_link_chat('W', 102, 'resp_a', 'x')$q$), 'error');
select tst.expect('посторонний не привязывает', tst.try('X', $q$select tg_link_chat('W', 102, 'resp_a', 'x')$q$), 'error');
select tst.expect('анонимный ключ не привязывает', tst.try('__anon_key__', $q$select tg_link_chat('W', 102, 'resp_a', 'x')$q$), 'error');
select tst.expect('Owner привязывает и без доступа к разделу',
  tst.jval('O', $q$select (tg_link_chat('W', -1001234567890, 'resp_a', 'Группа заказов') ->> 'chat_id')$q$), '-1001234567890');
select tst.run('O', $q$select tg_link_chat('W', -1001234567890, 'resp_a', 'Группа заказов')$q$);
select tst.expect('чат 0 — отказ', tst.try('OS1', $q$select tg_link_chat('W', 0, 'resp_a', 'x')$q$), 'error');
select tst.expect('слишком длинный ник — отказ', tst.try('OS1', $q$select tg_link_chat('W', 103, repeat('a', 121), 'x')$q$), 'error');
select tst.expect('длинное имя чата обрезается до 200',
  tst.jval('OS1', $q$select char_length(tg_link_chat('W', 104, 'resp_a', repeat('я', 300)) ->> 'title')::text$q$), '200');
select tst.expect('прямая вставка — отказ', tst.try('OS1', $q$insert into tg_chat_links (workspace_id, chat_id, os_value, bound_at) values ('W', 105, 'resp_a', 1)$q$), 'error');
select tst.expect('прямая правка — отказ', tst.try('OS1', $q$update tg_chat_links set os_value = 'x'$q$), 'error');
select tst.expect('пустой ник снимает привязку', tst.jval('OS1', $q$select coalesce(tg_link_chat('W', 101, '  ', '')::text, 'null')$q$), 'null');
select tst.run('OS1', $q$select tg_link_chat('W', 101, '', '')$q$);
select tst.expect('привязки 101 больше нет', (select count(*)::text from public.tg_chat_links where workspace_id = 'W' and chat_id = 101), '0');

-- Сняли доступ к разделу — ни читать, ни привязывать.
select tst.run('O', $q$select * from tg_set_access('W', '{OS1}')$q$);
select tst.expect('снятый технарь привязки не видит', tst.try('T1', $q$select * from tg_chat_links$q$, true), 'ok:0');
select tst.expect('снятый технарь не привязывает', tst.try('T1', $q$select tg_link_chat('W', 106, 'resp_a', 'x')$q$), 'error');

select tst.expect('роли API: запись в таблицу закрыта',
  (has_table_privilege('authenticated', 'public.tg_chat_links', 'insert') or has_table_privilege('anon', 'public.tg_chat_links', 'delete'))::text, 'false');
select tst.expect('версия схемы не старее 20261013', (public.nova_schema_version() >= '20261013')::text, 'true');
\ir ../migrations/20261013_tg_chat_links.sql
select tst.expect('после повторного наката привязки на месте', (select count(*)::text from public.tg_chat_links where workspace_id = 'W'), '2');

select label, got from tst.results where not ok;
select format('ПРОВЕРОК (tg_chat_links): %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
