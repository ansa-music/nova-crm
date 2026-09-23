-- =====================================================================
-- rows_drop_order_row: удаление заказа на «Заказах» убирает его строку в
-- столе технаря. Запуск ПОСЛЕ desk_rows_rls.sql (берёт его схему tst и
-- участников) и миграции 20260926_order_row_drop.sql.
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;
truncate tst.results;

insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at, order_id) values
  ('W', 'P2', '', 'x1', '{"client":"С биржи"}', 5, 1000, 1000, 'ord1'),
  ('W', 'P2', 'm1', 'x2', '{"client":"С биржи во вкладке"}', 5, 1000, 1000, 'ord2');
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at, order_id, os_uid) values
  ('W', 'P2', '', 'x3', '{"client":"Заказ ОС"}', 6, 1000, 1000, 'ord3', 'OS1');

-- Сам вызов — «1 строка», если функция вернула true.
create function tst.drop_sql(page text, tab text, row_id text, ord text) returns text language sql immutable as $$
  select format('select 1 where rows_drop_order_row(%L, %L, %L, %L, %L)', 'W', page, tab, row_id, ord)
$$;

select tst.expect('ОС убирает строку заказа в чужом столе', tst.try('OS1', tst.drop_sql('P2', '', 'x1', 'ord1'), true), 'ok:1');
select tst.expect('Тимлид (без Технаря) убирает строку заказа', tst.try('TL', tst.drop_sql('P2', '', 'x1', 'ord1'), true), 'ok:1');
select tst.expect('Owner убирает строку заказа', tst.try('O', tst.drop_sql('P2', '', 'x1', 'ord1'), true), 'ok:1');
select tst.expect('Тимлид + ОС убирает строку заказа', tst.try('TLO', tst.drop_sql('P2', '', 'x1', 'ord1'), true), 'ok:1');
select tst.expect('строка во вкладке тоже убирается', tst.try('OS2', tst.drop_sql('P2', 'm1', 'x2', 'ord2'), true), 'ok:1');
select tst.expect('чужой технарь НЕ убирает', tst.try('T1', tst.drop_sql('P2', '', 'x1', 'ord1'), true), 'error');
select tst.expect('Viewer НЕ убирает', tst.try('V', tst.drop_sql('P2', '', 'x1', 'ord1'), true), 'error');
select tst.expect('Admin НЕ убирает', tst.try('AD', tst.drop_sql('P2', '', 'x1', 'ord1'), true), 'error');
select tst.expect('посторонний НЕ убирает', tst.try('X', tst.drop_sql('P2', '', 'x1', 'ord1'), true), 'error');
select tst.expect('анонимный ключ НЕ убирает', tst.try('__anon_key__', tst.drop_sql('P2', '', 'x1', 'ord1'), true), 'error');
select tst.expect('чужой заказ к строке не подходит', tst.try('OS1', tst.drop_sql('P2', '', 'x1', 'ordX'), true), 'ok:0');
select tst.expect('обычную строку (без заказа) так не удалить', tst.try('OS1', tst.drop_sql('P2', '', 'r1', ''), true), 'error');
select tst.expect('обычную строку с подложенным id заказа не удалить', tst.try('OS1', tst.drop_sql('P2', '', 'r1', 'ord1'), true), 'ok:0');
select tst.expect('строку-заказ стола ОС (os_uid) так не удалить', tst.try('OS2', tst.drop_sql('P2', '', 'x3', 'ord3'), true), 'ok:0');
select tst.expect('строки нет — не ошибка, false', tst.try('OS1', tst.drop_sql('P2', '', 'nope', 'ord1'), true), 'ok:0');

-- По-настоящему: строка исчезает, соседние целы.
select tst.run('OS1', $q$select rows_drop_order_row('W', 'P2', '', 'x1', 'ord1')$q$);
select tst.expect('после удаления строки x1 нет', (select 'ok:' || count(*) from public.desk_rows where page_id = 'P2' and id = 'x1'), 'ok:0');
select tst.expect('чужие строки стола целы', (select 'ok:' || count(*) from public.desk_rows where page_id = 'P2' and id in ('r1', 'x2', 'x3')), 'ok:3');

-- Неживое хранилище (до переноса / после отката) — отказ.
update public.rows_workspaces set live = false where workspace_id = 'W';
select tst.expect('неживое хранилище — отказ', tst.try('O', tst.drop_sql('P2', 'm1', 'x2', 'ord2'), true), 'error');
update public.rows_workspaces set live = true where workspace_id = 'W';

select label, got from tst.results where not ok;
select format('ПРОВЕРОК: %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
