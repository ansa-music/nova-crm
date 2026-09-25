-- Проверки 20261008_history_dispatch.sql: журнал изменений и «Выдачи ОС».
-- Запускать ПОСЛЕ desk_rows_rls.sql (хелперы tst.*, участники workspace W:
-- O — Owner, TL — Тимлид, TLT — Тимлид + Технарь, T1..T3 — технари,
-- OS1/OS2 — ОС, AD — Admin, V — Viewer, X — посторонний с настоящим токеном).
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

-- ---------------------------------------------------------------------
-- Журнал изменений.
-- ---------------------------------------------------------------------
select tst.expect('технарь пишет пачку из двух записей',
  tst.jval('T1', $q$select log_history('W', '[
    {"id":"h1","pageId":"P1","pageName":"Стол","rowId":"r1","field":"price","fieldLabel":"Цена","oldValue":"100","newValue":250,"action":"update","userId":"O","userName":"Тимур","timestamp":1700000000000},
    {"id":"h2","pageId":"P1","rowId":"r2","field":"status","oldValue":null,"newValue":"done","action":"restore","userName":"Тимур","timestamp":1700000001000}
  ]'::jsonb)::text$q$), '2');
select tst.expect('user_id — из токена, а не из payload', (select user_id from public.history_log where id = 'h1'), 'T1');
select tst.expect('строка и число легли как есть', (select old_value::text || '|' || new_value::text from public.history_log where id = 'h1'), '"100"|250');
select tst.expect('null остаётся null', (select (old_value is null)::text from public.history_log where id = 'h2'), 'true');
select tst.expect('ts — из payload', (select ts::text from public.history_log where id = 'h1'), '1700000000000');
select tst.expect('created_at — серверное время', (select (abs(created_at - (extract(epoch from now()) * 1000)::bigint) < 60000)::text from public.history_log where id = 'h1'), 'true');
select tst.expect('rev поставила база', (select (rev > 0)::text from public.history_log where id = 'h1'), 'true');
select tst.expect('повтор тех же id — ничего не записано',
  tst.jval('T1', $q$select log_history('W', '[{"id":"h1","action":"update"},{"id":"h2","action":"update"}]'::jsonb)::text$q$), '0');
select tst.expect('кривой action и кривой id пропускаются',
  tst.jval('T1', $q$select log_history('W', '[{"id":"h3","action":"nope"},{"id":"a/b","action":"update"},{"id":"h4"}]'::jsonb)::text$q$), '1');
select tst.expect('action по умолчанию update', (select action from public.history_log where id = 'h4'), 'update');
select tst.expect('кривой timestamp → серверное время', tst.jval('T1', $q$select log_history('W', '[{"id":"h5","timestamp":"вчера"}]'::jsonb)::text$q$), '1');
select tst.expect('ts при кривом timestamp близок к now', (select (abs(ts - (extract(epoch from now()) * 1000)::bigint) < 60000)::text from public.history_log where id = 'h5'), 'true');
select tst.expect('длинная строка обрезана до 4000',
  tst.jval('T1', format($q$select log_history('W', '[{"id":"h6","newValue":"%s"}]'::jsonb)::text$q$, repeat('x', 5000))), '1');
select tst.expect('…и правда 4000', (select length(new_value #>> '{}')::text from public.history_log where id = 'h6'), '4000');
select tst.expect('Тимлид пишет', tst.jval('TL', $q$select log_history('W', '[{"id":"h7"}]'::jsonb)::text$q$), '1');
select tst.expect('Admin пишет', tst.jval('AD', $q$select log_history('W', '[{"id":"h8"}]'::jsonb)::text$q$), '1');
select tst.expect('ОС пишет', tst.jval('OS1', $q$select log_history('W', '[{"id":"h9"}]'::jsonb)::text$q$), '1');
select tst.expect('Viewer не пишет', tst.try('V', $q$select log_history('W', '[{"id":"h10"}]'::jsonb)$q$), 'error');
select tst.expect('посторонний не пишет', tst.try('X', $q$select log_history('W', '[{"id":"h11"}]'::jsonb)$q$), 'error');
select tst.expect('анонимный ключ не пишет', tst.try('__anon_key__', $q$select log_history('W', '[{"id":"h12"}]'::jsonb)$q$), 'error');
select tst.expect('чужой workspace — отказ', tst.try('T1', $q$select log_history('NOPE', '[{"id":"h13"}]'::jsonb)$q$), 'error');
select tst.expect('не массив — отказ', tst.try('T1', $q$select log_history('W', '{"id":"h14"}'::jsonb)$q$), 'error');
select tst.expect('больше 100 записей — отказ',
  tst.try('T1', format('select log_history(%L, %L::jsonb)', 'W', (select jsonb_agg(jsonb_build_object('id', 'big' || g)) from generate_series(1, 101) g)::text)), 'error');
select tst.expect('прямая вставка — отказ',
  tst.try('T1', $q$insert into history_log (workspace_id, id, user_id, ts, created_at) values ('W','x1','T1',1,1)$q$), 'error');
select tst.expect('Owner читает журнал (8 записанных)', tst.try('O', $q$select * from history_log where workspace_id = 'W'$q$, true), 'ok:8');
select tst.expect('Owner читает по столу', tst.try('O', $q$select * from history_log where workspace_id = 'W' and page_id = 'P1'$q$, true), 'ok:2');
select tst.expect('технарь своих записей не читает', tst.try('T1', $q$select * from history_log$q$, true), 'ok:0');
select tst.expect('Тимлид не читает (только Owner)', tst.try('TL', $q$select * from history_log$q$, true), 'ok:0');
select tst.expect('посторонний не читает', tst.try('X', $q$select * from history_log$q$, true), 'ok:0');
select tst.expect('Owner не правит запись (нет права)', tst.try('O', $q$update history_log set user_name = 'x' where id = 'h1'$q$), 'error');
select tst.expect('технарь не удаляет', tst.try('T1', $q$delete from history_log where id = 'h1'$q$), 'deny');
select tst.expect('Owner удаляет записи стола', tst.try('O', $q$delete from history_log where workspace_id = 'W' and page_id = 'P1'$q$), 'ok:2');
select tst.expect('роли API: insert/update запрещены',
  (has_table_privilege('authenticated', 'public.history_log', 'insert') or has_table_privilege('anon', 'public.history_log', 'update'))::text, 'false');

-- ---------------------------------------------------------------------
-- Выдачи ОС.
-- ---------------------------------------------------------------------
select tst.expect('ОС пишет выдачу (created_at серверное)',
  (abs(tst.jval('OS1', $q$select log_os_dispatch('W', '{"id":"d1","kind":"assign","osUid":"T1","osName":"Оля","techUid":"T2","techName":"Тимур","client":"Аня","phone":"+7","amount":12500.5,"srcPageId":"osdesk_OS1","srcRowId":"s1"}'::jsonb)::text$q$)::bigint
    - (extract(epoch from now()) * 1000)::bigint) < 60000)::text, 'true');
select tst.expect('os_uid — из токена', (select os_uid from public.os_dispatch_log where id = 'd1'), 'OS1');
select tst.expect('поля легли', (select kind || '|' || tech_uid || '|' || client || '|' || amount::text || '|' || src_row_id from public.os_dispatch_log where id = 'd1'), 'assign|T2|Аня|12500.5|s1');
select tst.expect('повтор id — та же запись, без дубля',
  tst.jval('OS1', $q$select log_os_dispatch('W', '{"id":"d1","kind":"move"}'::jsonb)::text$q$)::bigint::text, (select created_at::text from public.os_dispatch_log where id = 'd1'));
select tst.expect('…и вид не перезаписан', (select kind from public.os_dispatch_log where id = 'd1'), 'assign');
select tst.expect('амount не число → null', tst.jval('OS1', $q$select (log_os_dispatch('W', '{"id":"d2","kind":"unassign","amount":"12"}'::jsonb) > 0)::text$q$), 'true');
select tst.expect('…amount null', (select (amount is null)::text from public.os_dispatch_log where id = 'd2'), 'true');
select tst.expect('Тимлид пишет', tst.jval('TL', $q$select (log_os_dispatch('W', '{"id":"d3","kind":"move"}'::jsonb) > 0)::text$q$), 'true');
select tst.expect('Owner пишет', tst.jval('O', $q$select (log_os_dispatch('W', '{"id":"d4","kind":"assign"}'::jsonb) > 0)::text$q$), 'true');
select tst.expect('Тимлид + ОС пишет', tst.jval('TLO', $q$select (log_os_dispatch('W', '{"id":"d5","kind":"assign"}'::jsonb) > 0)::text$q$), 'true');
select tst.expect('технарь не пишет', tst.try('T1', $q$select log_os_dispatch('W', '{"id":"d6","kind":"assign"}'::jsonb)$q$), 'error');
select tst.expect('Viewer не пишет', tst.try('V', $q$select log_os_dispatch('W', '{"id":"d7","kind":"assign"}'::jsonb)$q$), 'error');
select tst.expect('посторонний не пишет', tst.try('X', $q$select log_os_dispatch('W', '{"id":"d8","kind":"assign"}'::jsonb)$q$), 'error');
select tst.expect('кривой вид — отказ', tst.try('OS1', $q$select log_os_dispatch('W', '{"id":"d9","kind":"steal"}'::jsonb)$q$), 'error');
select tst.expect('без id — отказ', tst.try('OS1', $q$select log_os_dispatch('W', '{"kind":"assign"}'::jsonb)$q$), 'error');
select tst.expect('прямая вставка — отказ',
  tst.try('OS1', $q$insert into os_dispatch_log (workspace_id, id, kind, os_uid, created_at) values ('W','x1','assign','OS1',1)$q$), 'error');
select tst.expect('Owner читает журнал выдач', tst.try('O', $q$select * from os_dispatch_log where workspace_id = 'W'$q$, true), 'ok:5');
select tst.expect('Тимлид читает', tst.try('TL', $q$select * from os_dispatch_log$q$, true), 'ok:5');
select tst.expect('Тимлид + Технарь читает', tst.try('TLT', $q$select * from os_dispatch_log$q$, true), 'ok:5');
select tst.expect('ОС свои выдачи не читает (журнал для руководства)', tst.try('OS1', $q$select * from os_dispatch_log$q$, true), 'ok:0');
select tst.expect('технарь не читает', tst.try('T1', $q$select * from os_dispatch_log$q$, true), 'ok:0');
select tst.expect('Admin не читает', tst.try('AD', $q$select * from os_dispatch_log$q$, true), 'ok:0');
select tst.expect('посторонний не читает', tst.try('X', $q$select * from os_dispatch_log$q$, true), 'ok:0');
select tst.expect('окно: последние 2 по created_at', tst.try('O', $q$select * from os_dispatch_log where workspace_id = 'W' order by created_at desc limit 2$q$, true), 'ok:2');
select tst.expect('Тимлид не удаляет', tst.try('TL', $q$delete from os_dispatch_log where id = 'd1'$q$), 'deny');
select tst.expect('Owner удаляет', tst.try('O', $q$delete from os_dispatch_log where id = 'd1'$q$), 'ok:1');
select tst.expect('роли API: insert/update запрещены',
  (has_table_privilege('authenticated', 'public.os_dispatch_log', 'insert') or has_table_privilege('anon', 'public.os_dispatch_log', 'update'))::text, 'false');
select tst.expect('rows_lead_workspaces: Owner', tst.jval('O', $q$select string_agg(w, ',') from rows_lead_workspaces() w$q$), 'W');
select tst.expect('rows_lead_workspaces: Тимлид', tst.jval('TL', $q$select string_agg(w, ',') from rows_lead_workspaces() w$q$), 'W');
select tst.expect('rows_lead_workspaces: технарь — пусто', tst.jval('T1', $q$select coalesce(string_agg(w, ','), '') from rows_lead_workspaces() w$q$), '');

-- ---------------------------------------------------------------------
-- Версия и повторный накат.
-- ---------------------------------------------------------------------
select tst.expect('версия схемы 20261008', public.nova_schema_version(), '20261008');
\ir ../migrations/20261008_history_dispatch.sql
select tst.expect('после повторного наката журнал пишется', tst.jval('T1', $q$select log_history('W', '[{"id":"h20"}]'::jsonb)::text$q$), '1');
select tst.expect('после повторного наката выдачи пишутся', tst.jval('OS1', $q$select (log_os_dispatch('W', '{"id":"d20","kind":"assign"}'::jsonb) > 0)::text$q$), 'true');

select label, got from tst.results where not ok;
select format('ПРОВЕРОК (журналы): %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
