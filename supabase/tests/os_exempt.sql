-- =====================================================================
-- Столы-исключения из «заказы ведёт ОС» (rows_os_exempt). Запуск ПОСЛЕ
-- desk_rows_rls.sql (берёт его схему tst и участников).
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;
truncate tst.results;

select tst.run('O', $q$select rows_set_os_managed('W', true)$q$);
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at) values
  ('W', 'P1', '', 'ex1', '{"client":"Свой","status":"work","price":"100"}', 40, 1000, 1000),
  ('W', 'P1', '', 'ex2', '{"client":"Удалю","status":"work"}', 41, 1000, 1000),
  ('W', 'P2', '', 'ex3', '{"client":"Чужой стол","status":"work"}', 40, 1000, 1000);
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at, os_uid, tech_uid, status_key) values
  ('W', 'P1', '', 'exm', '{"client":"Заказ ОС","status":"work"}', 42, 1000, 1000, 'OS1', 'T1', 'status');

select tst.expect('до исключения технарь статус не ставит',
  tst.try('T1', $q$update desk_rows set cells = cells || '{"status":"done"}'::jsonb where workspace_id='W' and page_id='P1' and tab_id='' and id='ex1'$q$), 'error');

select tst.expect('технарь сам себе исключение НЕ выдаёт',
  tst.try('T1', $q$select rows_set_desk_os_exempt('W', 'P1', true)$q$), 'error');
select tst.expect('Тимлид исключение НЕ выдаёт',
  tst.try('TL', $q$select rows_set_desk_os_exempt('W', 'P1', true)$q$), 'error');
select tst.expect('ОС исключение НЕ выдаёт',
  tst.try('OS1', $q$select rows_set_desk_os_exempt('W', 'P1', true)$q$), 'error');
select tst.expect('посторонний исключение НЕ выдаёт',
  tst.try('X', $q$select rows_set_desk_os_exempt('W', 'P1', true)$q$), 'error');
select tst.expect('технарь НЕ пишет в таблицу исключений напрямую',
  tst.try('T1', $q$insert into rows_os_exempt (workspace_id, page_id) values ('W','P1')$q$), 'error');
select tst.expect('Owner выдаёт исключение столу P1',
  tst.try('O', $q$select rows_set_desk_os_exempt('W', 'P1', true)$q$), 'ok');
select tst.run('O', $q$select rows_set_desk_os_exempt('W', 'P1', true)$q$);

select tst.expect('с исключением технарь ставит статус в своём столе',
  tst.try('T1', $q$update desk_rows set cells = cells || '{"status":"done"}'::jsonb where workspace_id='W' and page_id='P1' and tab_id='' and id='ex1'$q$), 'ok');
select tst.expect('с исключением технарь правит цену',
  tst.try('T1', $q$select rows_patch('W','P1','','ex1','{"price":"500"}'::jsonb)$q$), 'ok:1');
select tst.expect('с исключением технарь удаляет свою строку',
  tst.try('T1', $q$delete from desk_rows where workspace_id='W' and page_id='P1' and tab_id='' and id='ex2'$q$), 'ok:1');
select tst.expect('заказ ОС в столе-исключении технарь по-прежнему НЕ правит',
  tst.try('T1', $q$update desk_rows set cells = cells || '{"status":"done"}'::jsonb where workspace_id='W' and page_id='P1' and tab_id='' and id='exm'$q$), 'error');
select tst.expect('заказ ОС в столе-исключении технарь НЕ удаляет',
  tst.try('T1', $q$delete from desk_rows where workspace_id='W' and page_id='P1' and tab_id='' and id='exm'$q$), 'deny');
select tst.expect('другой технарь без исключения по-прежнему заперт',
  tst.try('T2', $q$update desk_rows set cells = cells || '{"status":"done"}'::jsonb where workspace_id='W' and page_id='P2' and tab_id='' and id='ex3'$q$), 'error');
select tst.expect('другой технарь без исключения НЕ удаляет',
  tst.try('T2', $q$delete from desk_rows where workspace_id='W' and page_id='P2' and tab_id='' and id='ex3'$q$), 'deny');
select tst.expect('чужой стол исключение не открывает (T2 в P1)',
  tst.try('T2', $q$update desk_rows set cells = cells || '{"status":"x"}'::jsonb where workspace_id='W' and page_id='P1' and tab_id='' and id='ex1'$q$), 'deny');

select tst.expect('Owner видит список исключений',
  tst.try('O', $q$select * from rows_os_exempt$q$, true), 'ok:1');
select tst.expect('технарь список исключений не читает',
  tst.try('T1', $q$select * from rows_os_exempt$q$, true), 'ok:0');
select tst.expect('посторонний через функцию набор не получает',
  tst.try('X', $q$select * from rows_os_exempt_pages()$q$, true), 'ok:0');

select tst.expect('Owner снимает исключение',
  tst.try('O', $q$select rows_set_desk_os_exempt('W', 'P1', false)$q$), 'ok');
select tst.run('O', $q$select rows_set_desk_os_exempt('W', 'P1', false)$q$);
select tst.expect('без исключения технарь снова заперт',
  tst.try('T1', $q$update desk_rows set cells = cells || '{"status":"done"}'::jsonb where workspace_id='W' and page_id='P1' and tab_id='' and id='ex1'$q$), 'error');
select tst.run('O', $q$select rows_set_os_managed('W', false)$q$);

select label, got from tst.results where not ok;
select format('ПРОВЕРОК: %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
