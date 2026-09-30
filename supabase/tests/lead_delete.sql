-- Проверки удаления заказа из «Общей таблицы» (30.09.2026) и 20261043_lead_delete.sql.
-- Клиент удаляет строки прямым DELETE (PostgREST) — решают политики desk_rows;
-- «Вернуть» вставляет удалённые строки обратно (upsert). Запускать ПОСЛЕ
-- desk_rows_rls.sql (хелперы tst.*). Свой workspace WLD:
--   DO — Owner, DP — Тимлид+, DT — Тимлид, DS — ОС, DK / DK2 — технари.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
truncate tst.results;

\ir ../migrations/20261043_lead_delete.sql

delete from public.desk_rows where workspace_id = 'WLD';
delete from public.rows_owner_only where workspace_id = 'WLD';
delete from public.rows_page_acl where workspace_id = 'WLD';
delete from public.rows_members where workspace_id = 'WLD';
delete from public.rows_workspaces where workspace_id = 'WLD';
insert into public.rows_workspaces (workspace_id, owner_id, live) values ('WLD', 'DO', true);
insert into public.rows_members (workspace_id, uid, role, extra_roles, os_nick_value) values
  ('WLD', 'DO', 'owner', '{}', null),
  ('WLD', 'DP', 'leadplus', '{}', null),
  ('WLD', 'DT', 'teamlead', '{}', null),
  ('WLD', 'DS', 'os', '{}', 'nickS'),
  ('WLD', 'DK', 'manager', '{}', null),
  ('WLD', 'DK2', 'manager', '{}', null);
insert into public.rows_page_acl (workspace_id, page_id, responsible_uid, created_by, os_desk, allowed_uids, editable_uids) values
  ('WLD', 'osdesk_DS', 'DS', 'DS', true, '{DS}', '{}'),
  ('WLD', 'KD', 'DK', 'DK', false, '{DK}', '{}'),
  ('WLD', 'KD2', 'DK2', 'DK2', false, '{DK2}', '{}');
-- s1 — заказ ОС, выданный технарю DK (копия os_s1); s2 — ещё не выдан;
-- own — строка технаря без ОС; blank — пустой слот; hid — строка закрытого стола.
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at,
  os_uid, tech_uid, status_key, src_page_id, src_tab_id, src_row_id, mirror_page_id, mirror_tab_id, mirror_row_id, order_id) values
  ('WLD', 'osdesk_DS', 'month-2026-09', 's1', '{"client":"Наташа","status":"work","technician":"tk","price":"101000"}', 0, 1000, 1000,
   null, null, null, null, null, null, 'KD', 'month-2026-09', 'os_s1', null),
  ('WLD', 'KD', 'month-2026-09', 'os_s1', '{"client":"Наташа","status":"work","price":"101000"}', 0, 1100, 1100,
   'DS', 'DK', 'status', 'osdesk_DS', 'month-2026-09', 's1', null, null, null, null),
  ('WLD', 'osdesk_DS', 'month-2026-09', 's2', '{"client":"Адриан","status":"approval","price":"171500"}', 1, 1200, 1200,
   null, null, null, null, null, null, null, null, null, 'ord_1'),
  ('WLD', 'KD', 'month-2026-09', 'own', '{"client":"Para germany","price":"59800"}', 1, 1300, 1300,
   null, null, null, null, null, null, null, null, null, null),
  ('WLD', 'KD', 'month-2026-09', 'blank', '{}', 2, 1400, 1400,
   null, null, null, null, null, null, null, null, null, null),
  ('WLD', 'KD2', 'month-2026-09', 'hid', '{"client":"Закрытый"}', 0, 1500, 1500,
   null, null, null, null, null, null, null, null, null, null);
insert into public.rows_owner_only (workspace_id, page_id) values ('WLD', 'KD2');
-- Вставка исходных строк сама пишет «created» — история начинается отсюда.
delete from public.order_events where workspace_id = 'WLD';

-- ---------------------------------------------------------------------
-- Кто удаляет.
-- ---------------------------------------------------------------------
select tst.expect('Тимлид+ удаляет строку ОС на чужом столе ОС',
  tst.try('DP', $q$delete from desk_rows where workspace_id = 'WLD' and page_id = 'osdesk_DS' and tab_id = 'month-2026-09' and id = 's1'$q$), 'ok:1');
select tst.expect('Тимлид+ удаляет копию у технаря — только копию ЭТОГО источника',
  tst.try('DP', $q$delete from desk_rows where workspace_id = 'WLD' and page_id = 'KD' and tab_id = 'month-2026-09' and id = 'os_s1'
    and src_row_id = 's1' and os_uid is not null$q$), 'ok:1');
select tst.expect('…копию чужого источника по тому же адресу — нет',
  tst.try('DP', $q$delete from desk_rows where workspace_id = 'WLD' and page_id = 'KD' and tab_id = 'month-2026-09' and id = 'os_s1'
    and src_row_id = 's9' and os_uid is not null$q$), 'ok:0');
select tst.expect('…и не строку технаря без метки ОС по адресу копии',
  tst.try('DP', $q$delete from desk_rows where workspace_id = 'WLD' and page_id = 'KD' and tab_id = 'month-2026-09' and id = 'own'
    and src_row_id = 's1' and os_uid is not null$q$), 'ok:0');
select tst.expect('Тимлид+ удаляет строку технаря без ОС',
  tst.try('DP', $q$delete from desk_rows where workspace_id = 'WLD' and page_id = 'KD' and id = 'own'$q$), 'ok:1');
select tst.expect('Owner удаляет строку ОС',
  tst.try('DO', $q$delete from desk_rows where workspace_id = 'WLD' and id = 's1'$q$), 'ok:1');
select tst.expect('Тимлид без «+» строку ОС не удаляет',
  tst.try('DT', $q$delete from desk_rows where workspace_id = 'WLD' and id = 's1'$q$), 'deny');
select tst.expect('Тимлид без «+» строку технаря не удаляет',
  tst.try('DT', $q$delete from desk_rows where workspace_id = 'WLD' and id = 'own'$q$), 'deny');
select tst.expect('технарь копию заказа ОС у себя не удаляет',
  tst.try('DK', $q$delete from desk_rows where workspace_id = 'WLD' and id = 'os_s1'$q$), 'deny');
select tst.expect('чужой технарь строку другого стола не удаляет',
  tst.try('DK2', $q$delete from desk_rows where workspace_id = 'WLD' and id = 'own'$q$), 'deny');
select tst.expect('стол «только для Owner»: Тимлид+ не удаляет',
  tst.try('DP', $q$delete from desk_rows where workspace_id = 'WLD' and id = 'hid'$q$), 'deny');
select tst.expect('…Owner — удаляет',
  tst.try('DO', $q$delete from desk_rows where workspace_id = 'WLD' and id = 'hid'$q$), 'ok:1');
select tst.expect('Тимлид+ видит строку, чтобы отличить «нет прав» от «уже удалена»',
  tst.try('DP', $q$select id from desk_rows where workspace_id = 'WLD' and id = 's1'$q$, true), 'ok:1');

-- ---------------------------------------------------------------------
-- История: удаление — с именем клиента; копия и слот — без события.
-- ---------------------------------------------------------------------
select tst.run('DP', $q$delete from desk_rows where workspace_id = 'WLD' and page_id = 'osdesk_DS' and id = 's1'$q$);
select tst.run('DP', $q$delete from desk_rows where workspace_id = 'WLD' and page_id = 'KD' and id = 'os_s1' and src_row_id = 's1' and os_uid is not null$q$);
select tst.run('DP', $q$delete from desk_rows where workspace_id = 'WLD' and page_id = 'KD' and id = 'blank'$q$);
select tst.expect('удаление строки ОС — событие deleted с именем клиента',
  coalesce((select string_agg(order_key || ':' || kind || ':' || coalesce(old_value, '-') || ':' || coalesce(actor_uid, '-'), ',')
   from public.order_events where workspace_id = 'WLD'), 'null'), 's1:deleted:Наташа:DP');
select tst.expect('копия и пустой слот событий не пишут',
  (select count(*)::text from public.order_events where workspace_id = 'WLD' and order_key in ('os_s1', 'blank')), '0');
select tst.run('DO', $q$delete from desk_rows where workspace_id = 'WLD' and id = 'own'$q$);
select tst.expect('строка технаря — имя из ячейки client',
  coalesce((select old_value from public.order_events where workspace_id = 'WLD' and order_key = 'own' and kind = 'deleted'), 'null'), 'Para germany');
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at)
values ('WLD', 'osdesk_DS', 'month-2026-09', 'long', jsonb_build_object('client', repeat('я', 250)), 5, 1600, 1600),
       ('WLD', 'osdesk_DS', 'month-2026-09', 'noname', '{"price":"5000"}', 6, 1700, 1700);
select tst.run('DO', $q$delete from desk_rows where workspace_id = 'WLD' and id in ('long', 'noname')$q$);
select tst.expect('длинное имя обрезается до 200 знаков',
  coalesce((select length(old_value)::text from public.order_events where workspace_id = 'WLD' and order_key = 'long' and kind = 'deleted'), 'null'), '200');
select tst.expect('без имени — пусто (null), событие всё равно есть',
  (select coalesce(old_value, 'null') from public.order_events where workspace_id = 'WLD' and order_key = 'noname' and kind = 'deleted'), 'null');

-- ---------------------------------------------------------------------
-- «Вернуть»: Тимлид+ вставляет удалённое как было (копия с чужим os_uid тоже).
-- ---------------------------------------------------------------------
select tst.expect('Тимлид+ возвращает строку ОС',
  tst.try('DP', $q$insert into desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at, mirror_page_id, mirror_tab_id, mirror_row_id)
    values ('WLD', 'osdesk_DS', 'month-2026-09', 's1', '{"client":"Наташа","status":"work","technician":"tk","price":"101000"}', 0, 1000, 1000, 'KD', 'month-2026-09', 'os_s1')$q$), 'ok:1');
select tst.expect('Тимлид+ возвращает копию с меткой ОС (чужой os_uid)',
  tst.try('DP', $q$insert into desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at, os_uid, tech_uid, status_key, src_page_id, src_tab_id, src_row_id)
    values ('WLD', 'KD', 'month-2026-09', 'os_s1', '{"client":"Наташа","status":"work","price":"101000"}', 0, 1100, 1100, 'DS', 'DK', 'status', 'osdesk_DS', 'month-2026-09', 's1')$q$), 'ok:1');
select tst.expect('Тимлид без «+» строку-заказ с чужим os_uid не заводит',
  tst.try('DT', $q$insert into desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at, os_uid, src_page_id, src_row_id)
    values ('WLD', 'KD', 'month-2026-09', 'os_x', '{"client":"Взлом"}', 0, 1, 1, 'DS', 'osdesk_DS', 's1')$q$), 'deny');
select tst.run('DP', $q$insert into desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at, mirror_page_id, mirror_tab_id, mirror_row_id)
    values ('WLD', 'osdesk_DS', 'month-2026-09', 's1', '{"client":"Наташа","status":"work","technician":"tk","price":"101000"}', 0, 1000, 1000, 'KD', 'month-2026-09', 'os_s1')$q$);
select tst.expect('возврат — событие created (история: удалён → заведён)',
  coalesce((select string_agg(kind, '>' order by id) from public.order_events where workspace_id = 'WLD' and order_key = 's1'), 'null'), 'deleted>created');
select tst.expect('возвращённая строка — с прежним временем внесения',
  coalesce((select created_at::text from public.desk_rows where workspace_id = 'WLD' and id = 's1'), 'null'), '1000');

-- ---------------------------------------------------------------------
-- Приостановленная компания: удалять нельзя никому.
-- ---------------------------------------------------------------------
update public.rows_workspaces set status = 'suspended' where workspace_id = 'WLD';
select tst.expect('приостановленная компания: Тимлид+ не удаляет',
  tst.try('DP', $q$delete from desk_rows where workspace_id = 'WLD' and id = 's1'$q$), 'deny');
select tst.expect('…и Owner не удаляет',
  tst.try('DO', $q$delete from desk_rows where workspace_id = 'WLD' and id = 's1'$q$), 'deny');
update public.rows_workspaces set status = 'active' where workspace_id = 'WLD';

-- ---------------------------------------------------------------------
-- Повторный накат и версия.
-- ---------------------------------------------------------------------
\ir ../migrations/20261043_lead_delete.sql
select tst.run('DP', $q$delete from desk_rows where workspace_id = 'WLD' and id = 's1'$q$);
select tst.expect('после повторного наката событие по-прежнему с именем',
  coalesce((select old_value from public.order_events where workspace_id = 'WLD' and order_key = 's1' and kind = 'deleted' order by id desc limit 1), 'null'), 'Наташа');
select tst.expect('версия схемы', (nova_schema_version() >= '20261043')::text, 'true');

select case when ok then '  OK  ' else 'FAIL  ' end || label || case when ok then '' else '  → ' || got end
from tst.results order by n;
select format('ПРОВЕРОК: %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
