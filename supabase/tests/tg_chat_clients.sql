-- Проверки 20261014_tg_chat_clients.sql: чат Telegram ↔ клиент (строка стола).
-- Запускать ПОСЛЕ desk_rows_rls.sql (W: P1 — стол T1, P2 — стол T2 (T1 его не
-- читает), osdesk_OS1 — стол ОС, читают все; OS1 читает все столы).
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

-- Клиенты: на своём столе T1, на чужом (T2) и на столе ОС. Сессия без
-- токена стражами не ограничивается.
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at) values
  ('W', 'P1', '', 'tg1', '{"client":"Айгерим Тестова","phone":"+7 701 555 12 34"}', 50, 2000, 2000),
  ('W', 'P2', '', 'tg2', '{"client":"Айгерим Скрытая"}', 50, 2000, 2000),
  ('W', 'osdesk_OS1', '', 'tg3', '{"name":"Айгерим ОС","phone":"8 (701) 555-12-34"}', 50, 3000, 3000),
  ('W', 'P1', '', 'tg4', '{"client":"100%_скидка"}', 51, 2000, 2000)
on conflict do nothing;

select tst.run('O', $q$select * from tg_set_access('W', '{OS1,T1}')$q$);

-- Поиск.
select tst.expect('технарь находит клиента на своём столе и на столе ОС, чужой стол — нет',
  tst.jval('T1', $q$select string_agg(row_id, ',' order by row_id) from tg_find_clients('W', 'айгерим', 30) where row_id like 'tg%'$q$), 'tg1,tg3');
select tst.expect('ОС (читает все столы) находит всех троих',
  tst.jval('OS1', $q$select string_agg(row_id, ',' order by row_id) from tg_find_clients('W', 'Айгерим', 30) where row_id like 'tg%'$q$), 'tg1,tg2,tg3');
select tst.expect('по телефону в любом виде (+7 и 8, скобки, дефисы)',
  tst.jval('T1', $q$select string_agg(row_id, ',' order by row_id) from tg_find_clients('W', '+7 701 555 12 34', 30)$q$), 'tg1,tg3');
select tst.expect('по части номера',
  tst.jval('T1', $q$select string_agg(row_id, ',' order by row_id) from tg_find_clients('W', '5551234', 30)$q$), 'tg1,tg3');
select tst.expect('новые выше: стол ОС (3000) раньше своего (2000)',
  tst.jval('T1', $q$select string_agg(row_id, ',') from tg_find_clients('W', 'айгерим', 30)$q$), 'tg3,tg1');
select tst.expect('% и _ в запросе — буквально, не шаблон',
  tst.jval('T1', $q$select string_agg(row_id, ',') from tg_find_clients('W', '0%_', 30)$q$), 'tg4');
select tst.expect('«%%» ничего не находит', tst.jval('T1', $q$select count(*)::text from tg_find_clients('W', '%%', 30)$q$), '0');
select tst.expect('запрос в 1 знак — отказ', tst.try('T1', $q$select * from tg_find_clients('W', 'а', 30)$q$), 'error');
select tst.expect('лимит соблюдается', tst.jval('OS1', $q$select count(*)::text from tg_find_clients('W', 'Айгерим', 1)$q$), '1');
select tst.expect('лимит больше 30 режется до 30', tst.jval('OS1', $q$select (count(*) <= 30)::text from tg_find_clients('W', 'ай', 999)$q$), 'true');
select tst.expect('без доступа к разделу поиск закрыт (ОС2)', tst.try('OS2', $q$select * from tg_find_clients('W', 'айгерим', 30)$q$), 'error');
select tst.expect('посторонний не ищет', tst.try('X', $q$select * from tg_find_clients('W', 'айгерим', 30)$q$), 'error');
select tst.expect('Owner ищет и без доступа к разделу',
  tst.jval('O', $q$select string_agg(row_id, ',' order by row_id) from tg_find_clients('W', 'айгерим', 30) where row_id like 'tg%'$q$), 'tg1,tg2,tg3');

-- Привязка.
select tst.expect('технарь привязывает чат к клиенту со своего стола',
  tst.jval('T1', $q$select (tg_link_client('W', 101, 'P1', '', 'tg1', 'Айгерим Тестова · +7 701 555 12 34') ->> 'row_id')$q$), 'tg1');
select tst.run('T1', $q$select tg_link_client('W', 101, 'P1', '', 'tg1', 'Айгерим Тестова · +7 701 555 12 34')$q$);
select tst.expect('кто привязал — из токена', (select bound_by || '|' || page_id || '|' || row_id from public.tg_chat_clients where workspace_id = 'W' and chat_id = 101), 'T1|P1|tg1');
select tst.expect('к клиенту на чужом столе (не читает) — отказ', tst.try('T1', $q$select tg_link_client('W', 102, 'P2', '', 'tg2', 'x')$q$), 'error');
select tst.expect('к несуществующей строке — отказ', tst.try('T1', $q$select tg_link_client('W', 102, 'P1', '', 'nope', 'x')$q$), 'error');
select tst.expect('не та вкладка — отказ', tst.try('T1', $q$select tg_link_client('W', 102, 'P1', 'm1', 'tg1', 'x')$q$), 'error');
select tst.expect('ОС перепривязывает к клиенту на столе ОС',
  tst.jval('OS1', $q$select (tg_link_client('W', 101, 'osdesk_OS1', '', 'tg3', 'Айгерим ОС') ->> 'page_id')$q$), 'osdesk_OS1');
select tst.run('OS1', $q$select tg_link_client('W', 101, 'osdesk_OS1', '', 'tg3', 'Айгерим ОС')$q$);
select tst.expect('ОС может привязать и к клиенту на столе технаря',
  tst.jval('OS1', $q$select (tg_link_client('W', 103, 'P2', '', 'tg2', 'Айгерим Скрытая') ->> 'row_id')$q$), 'tg2');
select tst.run('OS1', $q$select tg_link_client('W', 103, 'P2', '', 'tg2', 'Айгерим Скрытая')$q$);
select tst.expect('без доступа к разделу не привязывает (ОС2)', tst.try('OS2', $q$select tg_link_client('W', 104, 'osdesk_OS1', '', 'tg3', 'x')$q$), 'error');
select tst.expect('посторонний не привязывает', tst.try('X', $q$select tg_link_client('W', 104, 'osdesk_OS1', '', 'tg3', 'x')$q$), 'error');
select tst.expect('чат 0 — отказ', tst.try('T1', $q$select tg_link_client('W', 0, 'P1', '', 'tg1', 'x')$q$), 'error');
select tst.expect('подпись обрезается до 200',
  tst.jval('T1', $q$select char_length(tg_link_client('W', 105, 'P1', '', 'tg1', repeat('я', 300)) ->> 'label')::text$q$), '200');
select tst.expect('прямая вставка — отказ', tst.try('T1', $q$insert into tg_chat_clients (workspace_id, chat_id, page_id, row_id, bound_at) values ('W', 106, 'P1', 'tg1', 1)$q$), 'error');

-- Чтение.
select tst.expect('допущенный технарь видит привязки (в т.ч. к столу, которого не читает — только адрес и подпись)',
  tst.try('T1', $q$select * from tg_chat_clients$q$, true), 'ok:3');
select tst.expect('обратный путь: визитка находит свой чат по строке',
  tst.jval('T1', $q$select chat_id::text from tg_chat_clients where workspace_id = 'W' and page_id = 'osdesk_OS1' and row_id = 'tg3'$q$), '101');
select tst.expect('недопущенный ОС не видит', tst.try('OS2', $q$select * from tg_chat_clients$q$, true), 'ok:0');
select tst.expect('посторонний не видит', tst.try('X', $q$select * from tg_chat_clients$q$, true), 'ok:0');

-- Снять.
select tst.expect('пустая строка снимает привязку', tst.jval('T1', $q$select coalesce(tg_link_client('W', 105, '', '', '', '')::text, 'null')$q$), 'null');
select tst.run('T1', $q$select tg_link_client('W', 105, '', '', '', '')$q$);
select tst.expect('привязки 105 больше нет', (select count(*)::text from public.tg_chat_clients where workspace_id = 'W' and chat_id = 105), '0');

select tst.expect('роли API: запись в таблицу закрыта',
  (has_table_privilege('authenticated', 'public.tg_chat_clients', 'insert') or has_table_privilege('anon', 'public.tg_chat_clients', 'delete'))::text, 'false');
select tst.expect('версия схемы не старее 20261014', (public.nova_schema_version() >= '20261014')::text, 'true');
\ir ../migrations/20261014_tg_chat_clients.sql
select tst.expect('после повторного наката привязки на месте', (select count(*)::text from public.tg_chat_clients where workspace_id = 'W'), '2');

select label, got from tst.results where not ok;
select format('ПРОВЕРОК (tg_chat_clients): %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
