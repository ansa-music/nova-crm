-- Проверки 20261046_order_edit_reissue.sql: правка опубликованного заказа и
-- «Перевыдать» из «В столах». Запускать ПОСЛЕ desk_rows_rls.sql (хелперы
-- tst.*, участники workspace W: O — Owner, TL — Тимлид, TLO — Тимлид + ОС,
-- T1..T3 — технари, OS1/OS2 — ОС, AD — Admin, V — Viewer, X — посторонний).
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
-- А. order_edit.
-- ---------------------------------------------------------------------
select tst.run('OS1', $q$select order_write('W', 'e1', 'create', '{"client":"Аня","phone":"+7 700","link":"https://x","price":5000,"persons":2,"minutes":3,"urgency":"normal","note":"было","osValue":"os_a","osLabel":"Анна","createdByName":"Анна"}'::jsonb)$q$);
select tst.run('T1', $q$select order_write('W', 'e1', 'claim', '{"on":true,"name":"Тимур"}'::jsonb)$q$);

select tst.expect('автор-ОС правит свой заказ',
  tst.jval('OS1', $q$select order_edit('W', 'e1', '{"client":"Анна П.","price":7000,"urgency":"fire","note":"стало"}'::jsonb) ->> 'client'$q$), 'Анна П.');
select tst.expect('новые значения легли',
  (select (data ->> 'client') || '|' || (data ->> 'price') || '|' || (data ->> 'urgency') || '|' || (data ->> 'note') from public.work_orders where id = 'e1'),
  'Анна П.|7000|fire|стало');
select tst.expect('непереданные поля не тронуты',
  (select (data ->> 'phone') || '|' || (data ->> 'link') || '|' || (data ->> 'persons') || '|' || (data ->> 'minutes') || '|' || (data ->> 'osLabel') from public.work_orders where id = 'e1'),
  '+7 700|https://x|2|3|Анна');
select tst.expect('отклики после правки на месте', (select data -> 'claims' -> 'T1' ->> 'name' from public.work_orders where id = 'e1'), 'Тимур');
select tst.expect('статус и автор правкой не меняются',
  tst.jval('OS1', $q$select (order_edit('W', 'e1', '{"status":"taken","createdBy":"X","assignedUid":"T2","claims":{},"osValue":"zzz"}'::jsonb) ->> 'status')$q$), 'open');
select tst.expect('автор, отклики и ОС заказа прежние',
  (select created_by || '|' || (data ->> 'createdBy') || '|' || status || '|' || coalesce(assigned_uid, '-') || '|' || (data ->> 'osValue') || '|' || (data -> 'claims' ? 'T1')::text from public.work_orders where id = 'e1'),
  'OS1|OS1|open|-|os_a|true');
select tst.expect('ответ несёт rev', tst.jval('OS1', $q$select ((order_edit('W', 'e1', '{"note":"ещё"}'::jsonb) ->> 'rev')::bigint > 0)::text$q$), 'true');
select tst.expect('rev растёт от правки',
  tst.jval('OS1', $q$select ((order_edit('W', 'e1', '{"note":"раз"}'::jsonb) ->> 'rev')::bigint < (order_edit('W', 'e1', '{"note":"два"}'::jsonb) ->> 'rev')::bigint)::text$q$), 'true');
select tst.expect('пустые аргументы — заказ как был', tst.jval('OS1', $q$select order_edit('W', 'e1', '{}'::jsonb) ->> 'client'$q$), 'Анна П.');
select tst.expect('цена строкой → null', tst.jval('OS1', $q$select coalesce(order_edit('W', 'e1', '{"price":"100"}'::jsonb) ->> 'price', 'null')$q$), 'null');
select tst.expect('дедлайн числом ложится', tst.jval('OS1', $q$select order_edit('W', 'e1', '{"deadline":1790000000000}'::jsonb) ->> 'deadline'$q$), '1790000000000');
select tst.expect('дедлайн можно снять', tst.jval('OS1', $q$select coalesce(order_edit('W', 'e1', '{"deadline":null}'::jsonb) ->> 'deadline', 'null')$q$), 'null');

select tst.expect('пустой клиент — отказ', tst.jval('OS1', $q$select order_edit('W', 'e1', '{"client":"  "}'::jsonb)::text$q$), 'error:22023');
select tst.expect('клиент не строкой — отказ', tst.jval('OS1', $q$select order_edit('W', 'e1', '{"client":5}'::jsonb)::text$q$), 'error:22023');
select tst.expect('кривая срочность — отказ', tst.jval('OS1', $q$select order_edit('W', 'e1', '{"urgency":"nope"}'::jsonb)::text$q$), 'error:22023');
select tst.expect('после отказов клиент цел', (select data ->> 'client' from public.work_orders where id = 'e1'), 'Анна П.');

select tst.expect('чужой ОС не правит', tst.jval('OS2', $q$select order_edit('W', 'e1', '{"client":"x"}'::jsonb)::text$q$), 'error:42501');
select tst.expect('технарь не правит', tst.jval('T1', $q$select order_edit('W', 'e1', '{"client":"x"}'::jsonb)::text$q$), 'error:42501');
select tst.expect('Admin не правит', tst.jval('AD', $q$select order_edit('W', 'e1', '{"client":"x"}'::jsonb)::text$q$), 'error:42501');
select tst.expect('Viewer не правит', tst.jval('V', $q$select order_edit('W', 'e1', '{"client":"x"}'::jsonb)::text$q$), 'error:42501');
select tst.expect('посторонний не правит', tst.jval('X', $q$select order_edit('W', 'e1', '{"client":"x"}'::jsonb)::text$q$), 'error:42501');
select tst.expect('анонимный ключ не правит', tst.jval('__anon_key__', $q$select order_edit('W', 'e1', '{"client":"x"}'::jsonb)::text$q$), 'error:42501');
select tst.expect('Тимлид правит чужой заказ', tst.jval('TL', $q$select order_edit('W', 'e1', '{"client":"От тимлида"}'::jsonb) ->> 'client'$q$), 'От тимлида');
select tst.expect('Owner правит чужой заказ', tst.jval('O', $q$select order_edit('W', 'e1', '{"client":"От owner"}'::jsonb) ->> 'client'$q$), 'От owner');
select tst.expect('Тимлид + ОС правит чужой заказ', tst.jval('TLO', $q$select order_edit('W', 'e1', '{"client":"От tlo"}'::jsonb) ->> 'client'$q$), 'От tlo');
select tst.expect('заказа нет — P0002', tst.jval('O', $q$select order_edit('W', 'nope', '{"client":"x"}'::jsonb)::text$q$), 'error:P0002');
select tst.expect('кривой id — отказ', tst.jval('O', $q$select order_edit('W', 'a/b', '{"client":"x"}'::jsonb)::text$q$), 'error:22023');

-- Выданный правится, в столе / отменённый / удалённый — нет.
select tst.run('OS1', $q$select order_write('W', 'e1', 'assign', '{"uid":"T1","name":"Тимур"}'::jsonb)$q$);
select tst.expect('выданный заказ правится', tst.jval('OS1', $q$select order_edit('W', 'e1', '{"note":"выдан"}'::jsonb) ->> 'status'$q$), 'assigned');
select tst.expect('выдача после правки на месте', (select assigned_uid || '|' || (data ->> 'assignedName') from public.work_orders where id = 'e1'), 'T1|Тимур');
select tst.run('T1', $q$select order_write('W', 'e1', 'take', '{"pageId":"P2","subPageId":null,"rowId":"row_e1"}'::jsonb)$q$);
select tst.expect('заказ в столе не правится', tst.jval('OS1', $q$select order_edit('W', 'e1', '{"note":"x"}'::jsonb)::text$q$), 'error:42501');
select tst.expect('Owner заказ в столе тоже не правит', tst.jval('O', $q$select order_edit('W', 'e1', '{"note":"x"}'::jsonb)::text$q$), 'error:42501');
select tst.run('OS1', $q$select order_write('W', 'e2', 'create', '{"client":"Отменённый"}'::jsonb)$q$);
select tst.run('OS1', $q$select order_write('W', 'e2', 'cancel', '{"cancelled":true}'::jsonb)$q$);
select tst.expect('отменённый не правится', tst.jval('OS1', $q$select order_edit('W', 'e2', '{"note":"x"}'::jsonb)::text$q$), 'error:42501');
select tst.run('OS1', $q$select order_write('W', 'e3', 'create', '{"client":"Удалённый"}'::jsonb)$q$);
select tst.run('OS1', $q$select order_write('W', 'e3', 'delete', '{}'::jsonb)$q$);
select tst.expect('удалённый не правится', tst.jval('OS1', $q$select order_edit('W', 'e3', '{"note":"x"}'::jsonb)::text$q$), 'error:P0002');

-- ---------------------------------------------------------------------
-- Б. order_reissue.
-- ---------------------------------------------------------------------
-- r1: заказ Тимлида с «Заказов», забран в стол T1; рядом — обычная строка стола.
select tst.run('TL', $q$select order_write('W', 'r1', 'create', '{"client":"Перевыдать","price":9000,"note":"заметка"}'::jsonb)$q$);
select tst.run('T2', $q$select order_write('W', 'r1', 'claim', '{"on":true,"name":"Толя"}'::jsonb)$q$);
select tst.run('TL', $q$select order_write('W', 'r1', 'assign', '{"uid":"T1","name":"Тимур"}'::jsonb)$q$);
select tst.run('T1', $q$select order_write('W', 'r1', 'take', '{"pageId":"P2","subPageId":null,"rowId":"row_r1"}'::jsonb)$q$);
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at, order_id) values
  ('W', 'P2', '', 'row_r1', '{"client":"Перевыдать"}', 50, 1000, 1000, 'r1'),
  ('W', 'P2', '', 'row_other', '{"client":"Чужая строка с биржи"}', 51, 1000, 1000, 'r_other');
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at) values
  ('W', 'P2', '', 'row_plain', '{"client":"Обычная строка"}', 52, 1000, 1000);

select tst.expect('чужой ОС не перевыдаёт', tst.jval('OS2', $q$select order_reissue('W', 'r1')::text$q$), 'error:42501');
select tst.expect('технарь не перевыдаёт', tst.jval('T1', $q$select order_reissue('W', 'r1')::text$q$), 'error:42501');
select tst.expect('Admin не перевыдаёт', tst.jval('AD', $q$select order_reissue('W', 'r1')::text$q$), 'error:42501');
select tst.expect('Viewer не перевыдаёт', tst.jval('V', $q$select order_reissue('W', 'r1')::text$q$), 'error:42501');
select tst.expect('посторонний не перевыдаёт', tst.jval('X', $q$select order_reissue('W', 'r1')::text$q$), 'error:42501');
select tst.expect('анонимный ключ не перевыдаёт', tst.jval('__anon_key__', $q$select order_reissue('W', 'r1')::text$q$), 'error:42501');
select tst.expect('после отказов заказ в столе, строка на месте',
  (select status from public.work_orders where id = 'r1') || '|' || (select count(*) from public.desk_rows where page_id = 'P2' and id = 'row_r1'), 'taken|1');

select tst.run('TL', $q$select order_reissue('W', 'r1')$q$);
select tst.expect('после перевыдачи заказ открыт', (select status || '|' || coalesce(assigned_uid, '-') from public.work_orders where id = 'r1'), 'open|-');
select tst.expect('выдача и адрес строки сброшены',
  (select coalesce(data ->> 'assignedUid', '-') || '|' || coalesce(data ->> 'assignedName', '-') || '|' || coalesce(data ->> 'takenPageId', '-') || '|' || coalesce(data ->> 'takenRowId', '-') || '|' || coalesce(data ->> 'takenAt', '-')
     from public.work_orders where id = 'r1'), '-|-|-|-|-');
select tst.expect('отклики сброшены — откликаются заново', (select (data -> 'claims')::text from public.work_orders where id = 'r1'), '{}');
select tst.expect('поля заказа и автор целы',
  (select (data ->> 'client') || '|' || (data ->> 'price') || '|' || (data ->> 'note') || '|' || created_by from public.work_orders where id = 'r1'), 'Перевыдать|9000|заметка|TL');
select tst.expect('строки заказа в столе больше нет', (select 'ok:' || count(*) from public.desk_rows where page_id = 'P2' and id = 'row_r1'), 'ok:0');
select tst.expect('соседние строки стола целы', (select 'ok:' || count(*) from public.desk_rows where page_id = 'P2' and id in ('row_other', 'row_plain')), 'ok:2');
select tst.expect('на перевыданный можно откликнуться', tst.try('T3', $q$select order_write('W', 'r1', 'claim', '{"on":true,"name":"Трофим"}'::jsonb)$q$), 'ok');
select tst.expect('открытый заказ не перевыдаётся', tst.jval('TL', $q$select order_reissue('W', 'r1')::text$q$), 'error:42501');
select tst.expect('заказа нет — P0002', tst.jval('TL', $q$select order_reissue('W', 'nope')::text$q$), 'error:P0002');

-- r2: заказ со стола ОС (osSource) — перевыдаёт ОС на своём столе, здесь отказ.
select tst.run('OS1', $q$select order_write('W', 'r2', 'create', '{"client":"Со стола ОС","osSource":{"pageId":"osdesk_OS1","tabId":null,"rowId":"src_r2"}}'::jsonb)$q$);
select tst.run('OS1', $q$select order_write('W', 'r2', 'assign', '{"uid":"T1","name":"Тимур"}'::jsonb)$q$);
select tst.run('OS1', $q$select order_write('W', 'r2', 'take', '{"pageId":"P2","subPageId":null,"rowId":"row_r2"}'::jsonb)$q$);
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at, order_id, os_uid) values
  ('W', 'P2', '', 'row_r2', '{"client":"Со стола ОС"}', 53, 1000, 1000, 'r2', 'OS1');
select tst.expect('заказ со стола ОС — отказ NV409 (автору)', tst.jval('OS1', $q$select order_reissue('W', 'r2')::text$q$), 'error:NV409');
select tst.expect('заказ со стола ОС — отказ NV409 (Owner)', tst.jval('O', $q$select order_reissue('W', 'r2')::text$q$), 'error:NV409');
select tst.expect('после отказа ничего не изменилось',
  (select status from public.work_orders where id = 'r2') || '|' || (select count(*) from public.desk_rows where page_id = 'P2' and id = 'row_r2'), 'taken|1');

-- r3: заказ с «Заказов», который подхватил ОС (os_uid + источник на столе ОС).
select tst.run('TL', $q$select order_write('W', 'r3', 'create', '{"client":"Подхвачен ОС"}'::jsonb)$q$);
select tst.run('TL', $q$select order_write('W', 'r3', 'assign', '{"uid":"T1","name":"Тимур"}'::jsonb)$q$);
select tst.run('T1', $q$select order_write('W', 'r3', 'take', '{"pageId":"P2","subPageId":"m1","rowId":"row_r3"}'::jsonb)$q$);
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at, order_id, os_uid,
    src_page_id, src_tab_id, src_row_id) values
  ('W', 'P2', 'm1', 'row_r3', '{"client":"Подхвачен ОС"}', 54, 1000, 1000, 'r3', 'OS1', 'osdesk_OS1', '', 'adopt_r3');
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at,
    mirror_page_id, mirror_tab_id, mirror_row_id) values
  ('W', 'osdesk_OS1', '', 'adopt_r3', '{"client":"Источник r3"}', 5, 1000, 1000, 'P2', 'm1', 'row_r3');
select tst.expect('подхваченный ОС заказ — отказ NV409', tst.jval('TL', $q$select order_reissue('W', 'r3')::text$q$), 'error:NV409');
select tst.expect('строка технаря и источник на столе ОС целы',
  (select status from public.work_orders where id = 'r3') || '|'
  || (select count(*) from public.desk_rows where page_id = 'P2' and id = 'row_r3') || '|'
  || (select count(*) from public.desk_rows where page_id = 'osdesk_OS1' and id = 'adopt_r3'), 'taken|1|1');

-- r4: строку перенесли в другую вкладку, заказ помнит старую — находим по id заказа.
select tst.run('OS1', $q$select order_write('W', 'r4', 'create', '{"client":"Свой заказ ОС без стола"}'::jsonb)$q$);
select tst.run('OS1', $q$select order_write('W', 'r4', 'assign', '{"uid":"T2","name":"Толя"}'::jsonb)$q$);
select tst.run('T2', $q$select order_write('W', 'r4', 'take', '{"pageId":"P2","subPageId":null,"rowId":"row_r4"}'::jsonb)$q$);
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at, order_id) values
  ('W', 'P2', 'm1', 'row_r4', '{"client":"Свой заказ ОС без стола"}', 55, 1000, 1000, 'r4');
select tst.expect('ОС перевыдаёт свой заказ', tst.jval('OS1', $q$select order_reissue('W', 'r4') ->> 'status'$q$), 'open');
select tst.expect('строка в другой вкладке тоже убрана', (select 'ok:' || count(*) from public.desk_rows where page_id = 'P2' and id = 'row_r4'), 'ok:0');

-- r5: строки в столе уже нет (технарь удалил) — заказ всё равно возвращается.
select tst.run('TL', $q$select order_write('W', 'r5', 'create', '{"client":"Без строки"}'::jsonb)$q$);
select tst.run('TL', $q$select order_write('W', 'r5', 'assign', '{"uid":"T1","name":"Тимур"}'::jsonb)$q$);
select tst.run('T1', $q$select order_write('W', 'r5', 'take', '{"pageId":"P2","subPageId":null,"rowId":"row_r5"}'::jsonb)$q$);
select tst.expect('строки нет — заказ всё равно открыт', tst.jval('O', $q$select order_reissue('W', 'r5') ->> 'status'$q$), 'open');

-- r6: неживое хранилище строк — отказ, ничего не меняется.
select tst.run('TL', $q$select order_write('W', 'r6', 'create', '{"client":"Неживое"}'::jsonb)$q$);
select tst.run('TL', $q$select order_write('W', 'r6', 'assign', '{"uid":"T1","name":"Тимур"}'::jsonb)$q$);
select tst.run('T1', $q$select order_write('W', 'r6', 'take', '{"pageId":"P2","subPageId":null,"rowId":"row_r6"}'::jsonb)$q$);
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at, order_id) values
  ('W', 'P2', '', 'row_r6', '{"client":"Неживое"}', 56, 1000, 1000, 'r6');
update public.rows_workspaces set live = false where workspace_id = 'W';
select tst.expect('неживое хранилище — отказ', tst.jval('O', $q$select order_reissue('W', 'r6')::text$q$), 'error:42501');
update public.rows_workspaces set live = true where workspace_id = 'W';
select tst.expect('после отказа заказ в столе, строка цела',
  (select status from public.work_orders where id = 'r6') || '|' || (select count(*) from public.desk_rows where page_id = 'P2' and id = 'row_r6'), 'taken|1');

-- Старые операции живы после новой миграции.
select tst.expect('order_write работает как раньше', tst.jval('OS1', $q$select order_write('W', 'z1', 'create', '{"client":"Проверка"}'::jsonb) ->> 'status'$q$), 'open');
select tst.expect('версия схемы', (select public.nova_schema_version()), '20261046');

select label, got from tst.results where not ok;
select format('ПРОВЕРОК (правка и перевыдача): %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
