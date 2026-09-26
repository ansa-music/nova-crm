-- Проверки 20261011_schedule.sql: «График» в Postgres.
-- Запускать ПОСЛЕ desk_rows_rls.sql (хелперы tst.*, участники workspace W:
-- O — Owner, TL — Тимлид, T1..T3 — технари, OS1/OS2 — ОС, AD — Admin,
-- V — Viewer, X — посторонний).
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
-- Слияние как у Firestore.
-- ---------------------------------------------------------------------
select tst.expect('merge: вложенные карты сливаются',
  public.nova_jmerge('{"days":{"1":"off","2":"off"},"hours":{"3":{"from":"10:00","to":"12:00","label":"x"}}}',
    '{"days":{"2":{"$del":true},"5":"off"},"hours":{"3":{"from":"11:00","label":{"$del":true}}}}')::text,
  '{"days": {"1": "off", "5": "off"}, "hours": {"3": {"to": "12:00", "from": "11:00"}}}');
select tst.expect('merge: пустая карта не стирает поле (её просто нет)', public.nova_jmerge('{"days":{"1":"off"}}', '{"days":{}}')::text, '{"days": {"1": "off"}}');
select tst.expect('strip: маркеры удаления не остаются', public.nova_jstrip('{"a":1,"b":{"$del":true},"c":{"d":{"$del":true},"e":2}}')::text, '{"a": 1, "c": {"e": 2}}');

-- ---------------------------------------------------------------------
-- Месяц.
-- ---------------------------------------------------------------------
select tst.expect('Тимлид ставит выходной',
  tst.jval('TL', $q$select jsonb_array_length(schedule_write('W', '[{"kind":"month","id":"T1_2026-09","op":"merge","data":{"uid":"T1","monthKey":"2026-09","days":{"7":"off"},"updatedAt":1,"updatedBy":"TL"}}]'))::text$q$), '1');
select tst.expect('копии полей для фильтров', (select uid || '|' || month_key from public.schedule_docs where kind = 'month' and id = 'T1_2026-09'), 'T1|2026-09');
select tst.expect('workspaceId — из вызова', (select data ->> 'workspaceId' from public.schedule_docs where kind = 'month' and id = 'T1_2026-09'), 'W');
select tst.run('O', $q$select schedule_write('W', '[{"kind":"month","id":"T1_2026-09","op":"merge","data":{"uid":"T1","monthKey":"2026-09","days":{"8":"leave"},"hours":{"9":{"from":"12:00","to":"15:00"}},"selfWork":{"7":{"$del":true}},"updatedAt":2}}]')$q$);
select tst.expect('Owner дописал — старое на месте', (select (data -> 'days')::text || '|' || (data -> 'hours' -> '9' ->> 'from') from public.schedule_docs where id = 'T1_2026-09'), '{"7": "off", "8": "leave"}|12:00');
select tst.run('TL', $q$select schedule_write('W', '[{"kind":"month","id":"T1_2026-09","op":"merge","data":{"uid":"T1","monthKey":"2026-09","days":{"7":{"$del":true}},"updatedAt":3}}]')$q$);
select tst.expect('«рабочий» — удаление ключа', (select (data -> 'days')::text from public.schedule_docs where id = 'T1_2026-09'), '{"8": "leave"}');
select tst.expect('технарь не пишет график', tst.try('T1', $q$select schedule_write('W', '[{"kind":"month","id":"T1_2026-09","op":"merge","data":{"uid":"T1","monthKey":"2026-09","days":{"1":"off"}}}]')$q$), 'error');
select tst.expect('ОС не пишет график', tst.try('OS1', $q$select schedule_write('W', '[{"kind":"month","id":"T1_2026-09","op":"merge","data":{"uid":"T1","monthKey":"2026-09"}}]')$q$), 'error');
select tst.expect('посторонний не пишет', tst.try('X', $q$select schedule_write('W', '[{"kind":"month","id":"T1_2026-09","op":"merge","data":{"uid":"T1","monthKey":"2026-09"}}]')$q$), 'error');
select tst.expect('чужой id месяца — отказ', tst.try('TL', $q$select schedule_write('W', '[{"kind":"month","id":"T2_2026-09","op":"merge","data":{"uid":"T1","monthKey":"2026-09"}}]')$q$), 'error');
select tst.expect('лишнее поле — отказ', tst.try('TL', $q$select schedule_write('W', '[{"kind":"month","id":"T1_2026-10","op":"merge","data":{"uid":"T1","monthKey":"2026-10","role":"owner"}}]')$q$), 'error');
select tst.expect('пачка атомарна: вторая запись с ошибкой откатывает первую',
  tst.try('TL', $q$select schedule_write('W', '[{"kind":"month","id":"T2_2026-09","op":"merge","data":{"uid":"T2","monthKey":"2026-09","days":{"1":"off"}}},{"kind":"month","id":"bad","op":"merge","data":{"uid":"T2"}}]')$q$), 'error');
select tst.expect('…и первой нет', (select count(*)::text from public.schedule_docs where id = 'T2_2026-09'), '0');
select tst.expect('все читают график', tst.try('V', $q$select * from schedule_docs where workspace_id = 'W' and kind = 'month'$q$, true), 'ok:1');
select tst.expect('посторонний не читает', tst.try('X', $q$select * from schedule_docs$q$, true), 'ok:0');
select tst.expect('прямая запись закрыта', tst.try('TL', $q$insert into schedule_docs (workspace_id, kind, id, data) values ('W','month','z','{}')$q$), 'error');

-- ---------------------------------------------------------------------
-- Назначенный редактор (scheduleSettings.editors).
-- ---------------------------------------------------------------------
select tst.expect('Тимлид не назначает редакторов', tst.try('TL', $q$select rows_set_schedule_editors('W', array['OS1'])$q$), 'error');
select tst.run('O', $q$select rows_set_schedule_editors('W', array['OS1', 'OS1', ''])$q$);
select tst.expect('список без повторов и пустых', (select array_to_string(schedule_editors, ',') from public.rows_workspaces where workspace_id = 'W'), 'OS1');
select tst.expect('назначенный ОС правит график', tst.try('OS1', $q$select schedule_write('W', '[{"kind":"month","id":"T3_2026-09","op":"merge","data":{"uid":"T3","monthKey":"2026-09","days":{"2":"off"}}}]')$q$), 'ok');
select tst.expect('другой ОС — нет', tst.try('OS2', $q$select schedule_write('W', '[{"kind":"month","id":"T3_2026-09","op":"merge","data":{"uid":"T3","monthKey":"2026-09","days":{"2":"off"}}}]')$q$), 'error');
select tst.expect('список читает участник', tst.jval('T1', $q$select array_to_string(rows_schedule_editors('W'), ',')$q$), 'OS1');
select tst.expect('посторонний — пусто', coalesce(tst.jval('X', $q$select array_to_string(rows_schedule_editors('W'), ',')$q$), ''), '');
select tst.run('O', $q$select rows_set_schedule_editors('W', '{}')$q$);
select tst.expect('снятый — больше не правит', tst.try('OS1', $q$select schedule_write('W', '[{"kind":"month","id":"T3_2026-09","op":"merge","data":{"uid":"T3","monthKey":"2026-09"}}]')$q$), 'error');

-- ---------------------------------------------------------------------
-- Неделя и свой раздел.
-- ---------------------------------------------------------------------
select tst.expect('неделя — только week', tst.try('TL', $q$select schedule_write('W', '[{"kind":"template","id":"other","op":"merge","data":{"people":{}}}]')$q$), 'error');
select tst.run('TL', $q$select schedule_write('W', '[{"kind":"template","id":"week","op":"merge","data":{"people":{"T1":{"days":{"6":"off","0":"off"},"appliedThrough":"2026-10"}},"updatedAt":1}}]')$q$);
select tst.run('TL', $q$select schedule_write('W', '[{"kind":"template","id":"week","op":"merge","data":{"people":{"T1":{"days":{"0":{"$del":true}}},"T2":{"days":{"1":"off"}}}}}]')$q$);
select tst.expect('неделя сливается по людям', (select (data -> 'people' -> 'T1' -> 'days')::text || '|' || (data -> 'people' -> 'T1' ->> 'appliedThrough') || '|' || (data -> 'people' -> 'T2' -> 'days' ->> '1') from public.schedule_docs where kind = 'template'), '{"6": "off"}|2026-10|off');
select tst.expect('технарь неделю не пишет', tst.try('T1', $q$select schedule_write('W', '[{"kind":"template","id":"week","op":"merge","data":{"people":{}}}]')$q$), 'error');
select tst.run('TL', $q$select schedule_write('W', '[{"kind":"group","id":"custom","op":"set","data":{"name":"Подрядчики","people":[{"id":"ext_1","name":"Дина"}],"updatedAt":1}}]')$q$);
select tst.run('TL', $q$select schedule_write('W', '[{"kind":"group","id":"custom","op":"set","data":{"name":"Подрядчики","people":[],"updatedAt":2}}]')$q$);
select tst.expect('раздел пишется целиком (set)', (select jsonb_array_length(data -> 'people')::text from public.schedule_docs where kind = 'group'), '0');

-- ---------------------------------------------------------------------
-- Запросы на отметку.
-- ---------------------------------------------------------------------
select tst.expect('технарь просит отметку за себя',
  tst.try('T1', $q$select schedule_write('W', '[{"kind":"request","id":"T1_2026-09_7","op":"set","data":{"uid":"T1","name":"Тимур","monthKey":"2026-09","dayKey":"7","status":"pending","createdAt":1,"resolvedAt":null,"resolvedBy":null}}]')$q$), 'ok');
select tst.run('T1', $q$select schedule_write('W', '[{"kind":"request","id":"T1_2026-09_7","op":"set","data":{"uid":"T1","name":"Тимур","monthKey":"2026-09","dayKey":"7","status":"pending","createdAt":1,"resolvedAt":null,"resolvedBy":null}}]')$q$);
select tst.expect('за другого — отказ', tst.try('T2', $q$select schedule_write('W', '[{"kind":"request","id":"T1_2026-09_8","op":"set","data":{"uid":"T1","monthKey":"2026-09","dayKey":"8","status":"pending"}}]')$q$), 'error');
select tst.expect('сам себе не подтверждает', tst.try('T1', $q$select schedule_write('W', '[{"kind":"request","id":"T1_2026-09_7","op":"set","data":{"uid":"T1","monthKey":"2026-09","dayKey":"7","status":"approved"}}]')$q$), 'error');
select tst.expect('кривой id запроса — отказ', tst.try('T1', $q$select schedule_write('W', '[{"kind":"request","id":"T1_x","op":"set","data":{"uid":"T1","monthKey":"2026-09","dayKey":"7","status":"pending"}}]')$q$), 'error');
select tst.expect('чужой технарь не отзывает', tst.try('T2', $q$select schedule_write('W', '[{"kind":"request","id":"T1_2026-09_7","op":"delete"}]')$q$), 'error');
select tst.expect('Тимлид подтверждает и пишет отметку одной пачкой',
  tst.try('TL', $q$select schedule_write('W', '[{"kind":"request","id":"T1_2026-09_7","op":"set","data":{"uid":"T1","name":"Тимур","monthKey":"2026-09","dayKey":"7","status":"approved","createdAt":1,"resolvedAt":5,"resolvedBy":"TL"}},{"kind":"month","id":"T1_2026-09","op":"merge","data":{"uid":"T1","monthKey":"2026-09","selfWork":{"7":true}}}]')$q$), 'ok');
select tst.run('TL', $q$select schedule_write('W', '[{"kind":"request","id":"T1_2026-09_7","op":"set","data":{"uid":"T1","name":"Тимур","monthKey":"2026-09","dayKey":"7","status":"declined","createdAt":1,"resolvedAt":5,"resolvedBy":"TL"}}]')$q$);
select tst.expect('решённый не отозвать', tst.try('T1', $q$select schedule_write('W', '[{"kind":"request","id":"T1_2026-09_7","op":"delete"}]')$q$), 'error');
select tst.expect('после отказа подать снова', tst.try('T1', $q$select schedule_write('W', '[{"kind":"request","id":"T1_2026-09_7","op":"set","data":{"uid":"T1","monthKey":"2026-09","dayKey":"7","status":"pending","createdAt":9}}]')$q$), 'ok');
select tst.run('T1', $q$select schedule_write('W', '[{"kind":"request","id":"T1_2026-09_7","op":"set","data":{"uid":"T1","monthKey":"2026-09","dayKey":"7","status":"pending","createdAt":9}}]')$q$);
select tst.run('T1', $q$select schedule_write('W', '[{"kind":"request","id":"T1_2026-09_7","op":"delete"}]')$q$);
select tst.expect('отзыв — мягкий', (select deleted::text from public.schedule_docs where kind = 'request' and id = 'T1_2026-09_7'), 'true');
select tst.expect('после отзыва подать снова', tst.try('T1', $q$select schedule_write('W', '[{"kind":"request","id":"T1_2026-09_7","op":"set","data":{"uid":"T1","monthKey":"2026-09","dayKey":"7","status":"pending","createdAt":10}}]')$q$), 'ok');

-- ---------------------------------------------------------------------
-- Перенос из Firestore.
-- ---------------------------------------------------------------------
select tst.expect('технарь не переносит', tst.try('T1', $q$select schedule_import('W', '[]', true)$q$), 'error');
select tst.expect('перенос кладёт новые',
  tst.jval('TL', $q$select schedule_import('W', '[{"kind":"month","id":"T2_2026-08","data":{"uid":"T2","monthKey":"2026-08","days":{"3":"off"},"updatedAt":100}},{"kind":"month","id":"T1_2026-09","data":{"uid":"T1","monthKey":"2026-09","days":{},"updatedAt":1}},{"kind":"month","id":"bad id","data":{}}]', false)::text$q$), '1');
select tst.expect('старое не затирает свежее', (select (data -> 'days')::text from public.schedule_docs where id = 'T1_2026-09'), '{"8": "leave"}');
select tst.expect('до отметки — «не перенесено»', (select count(*)::text from public.schedule_docs where kind = 'meta'), '0');
select tst.run('TL', $q$select schedule_import('W', '[{"kind":"month","id":"T2_2026-08","data":{"uid":"T2","monthKey":"2026-08","days":{"4":"off"},"updatedAt":200}}]', true)$q$);
select tst.expect('более свежее заменяет', (select (data -> 'days')::text from public.schedule_docs where id = 'T2_2026-08'), '{"4": "off"}');
select tst.expect('отметка «перенесено»', (select count(*)::text from public.schedule_docs where kind = 'meta' and id = 'imported'), '1');
select tst.expect('отметку видят все участники', tst.try('T3', $q$select * from schedule_docs where kind = 'meta'$q$, true), 'ok:1');

select tst.expect('API-роли не пишут таблицу напрямую',
  (has_table_privilege('anon', 'public.schedule_docs', 'insert') or has_table_privilege('authenticated', 'public.schedule_docs', 'update')
   or has_table_privilege('anon', 'public.schedule_docs', 'truncate'))::text, 'false');

-- ---------------------------------------------------------------------
-- Повторный накат и версия.
-- ---------------------------------------------------------------------
\ir ../migrations/20261011_schedule.sql
select tst.expect('версия схемы не старее 20261011', (public.nova_schema_version() >= '20261011')::text, 'true');
select tst.expect('после наката данные на месте', (select (data -> 'days')::text from public.schedule_docs where id = 'T1_2026-09'), '{"8": "leave"}');
select tst.expect('после наката Тимлид пишет', tst.try('TL', $q$select schedule_write('W', '[{"kind":"month","id":"T1_2026-11","op":"merge","data":{"uid":"T1","monthKey":"2026-11"}}]')$q$), 'ok');

select label, got from tst.results where not ok;
select format('ПРОВЕРОК (график): %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
