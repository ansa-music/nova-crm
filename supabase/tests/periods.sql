-- =====================================================================
-- 20261006_periods.sql: ключи периодов («2026-10-1»/«2026-10-2») в
-- счётчиках, списках заказов ОС и оценках. Запуск после desk_rows_rls.sql
-- (схема tst, workspace W: O — Owner, T1 — технарь стола P1, OS1 «anna»).
-- Итог — строка «ПРОВЕРОК: N, ПРОВАЛЕНО: 0».
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;
truncate tst.results;

create or replace function tst.put(page text, resp text, month text, data text, ws text default 'W') returns text
language sql immutable as $$
  select format($f$insert into desk_loads (workspace_id, page_id, responsible_uid, month_key, sub_page_id, data, updated_by)
    values (%L, %L, %L, %L, %L, %L::jsonb, 'кто-то')
    on conflict (workspace_id, page_id) do update set
      responsible_uid = excluded.responsible_uid, month_key = excluded.month_key,
      sub_page_id = excluded.sub_page_id, data = excluded.data, updated_by = excluded.updated_by$f$,
    ws, page, resp, month, 'tab_' || month, data)
$$;

-- --- Формат ключа --------------------------------------------------------
select tst.expect('desk_loads принимает первую половину', tst.try('T1', tst.put('P1', 'T1', '2026-10-1', '{"total":1}')), 'ok:1');
select tst.expect('desk_loads принимает вторую половину', tst.try('T1', tst.put('P1', 'T1', '2026-10-2', '{"total":1}')), 'ok:1');
select tst.expect('desk_loads не принимает третью «половину»', tst.try('T1', tst.put('P1', 'T1', '2026-10-3', '{"total":1}')), 'error');
select tst.expect('desk_loads не принимает ключ без месяца', tst.try('T1', tst.put('P1', 'T1', '2026-1', '{"total":1}')), 'error');
select tst.expect('целый месяц по-прежнему принимается', tst.try('T1', tst.put('P1', 'T1', '2026-11', '{"total":1}')), 'ok:1');

-- --- Порядок периодов у стража -------------------------------------------
select tst.run('T1', tst.put('P1', 'T1', '2026-10-1', '{"total":5,"statusCounts":{"work":5}}'));
select tst.expect('вторая половина поверх первой — записана', tst.try('T1', tst.put('P1', 'T1', '2026-10-2', '{"total":2}')), 'ok:1');
select tst.run('T1', tst.put('P1', 'T1', '2026-10-2', '{"total":2}'));
select tst.expect('первая половина архивирована', (select count(*)::text from public.desk_load_history where workspace_id = 'W' and page_id = 'P1' and month_key = '2026-10-1'), '1');
select tst.expect('архив хранит цифры первой половины', (select (data ->> 'total') from public.desk_load_history where workspace_id = 'W' and page_id = 'P1' and month_key = '2026-10-1'), '5');
select tst.expect('целый «2026-10» поверх «2026-10-2» — 0 строк (старее)', tst.try('T1', tst.put('P1', 'T1', '2026-10', '{"total":9}')), 'ok:0');
select tst.expect('первая половина поверх второй — 0 строк', tst.try('T1', tst.put('P1', 'T1', '2026-10-1', '{"total":9}')), 'ok:0');
select tst.expect('следующий целый месяц поверх половины — записан', tst.try('T1', tst.put('P1', 'T1', '2026-11', '{"total":1}')), 'ok:1');
select tst.expect('следующая половина следующего месяца — записана', tst.try('T1', tst.put('P1', 'T1', '2026-11-1', '{"total":1}')), 'ok:1');
select tst.expect('архив по ключу половины читает участник',
  tst.try('V', $q$select * from desk_load_history where workspace_id = 'W' and month_key = '2026-10-1'$q$, true), 'ok:1');

-- --- os_orders -----------------------------------------------------------
select tst.expect('os_orders принимает ключ половины',
  tst.try('T1', $q$insert into os_orders (workspace_id, page_id, os_value, responsible_uid, month_key, sub_page_id, orders, updated_by)
    values ('W', 'P1', 'anna', 'T1', '2026-10-2', 'tab', '[]'::jsonb, 'x')$q$), 'ok:1');
select tst.expect('os_orders не принимает «-3»',
  tst.try('T1', $q$insert into os_orders (workspace_id, page_id, os_value, responsible_uid, month_key, sub_page_id, orders, updated_by)
    values ('W', 'P1', 'anna', 'T1', '2026-10-3', 'tab', '[]'::jsonb, 'x')$q$), 'error');

-- --- Версия --------------------------------------------------------------
select tst.expect('версия схемы 20261006', public.nova_schema_version(), '20261006');

-- --- Повторный накат ------------------------------------------------------
\ir ../migrations/20261006_periods.sql
select tst.expect('после повторного наката ограничение одно',
  (select count(*)::text from pg_constraint where conrelid = 'public.desk_loads'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%month_key ~%'), '1');
select tst.expect('после повторного наката половина принимается', tst.try('T1', tst.put('P1', 'T1', '2026-12-1', '{"total":1}')), 'ok:1');

select label, got from tst.results where not ok;
select format('ПРОВЕРОК: %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
