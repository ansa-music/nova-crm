-- Проверки 20261010_orders.sql: биржа «Заказы» и запросы технарей к ОС.
-- Запускать ПОСЛЕ desk_rows_rls.sql (хелперы tst.*, участники workspace W:
-- O — Owner, TL — Тимлид, TLT — Тимлид + Технарь, TLO — Тимлид + ОС,
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
-- Создание.
-- ---------------------------------------------------------------------
select tst.expect('ОС выдаёт заказ',
  tst.jval('OS1', $q$select order_write('W', 'o1', 'create', '{"client":"Аня","phone":"+7 700","price":5000,"urgency":"fire","osValue":"os_a","osLabel":"Анна","createdByName":"Анна","createdBy":"O","status":"taken","claims":{"T1":{"uid":"T1"}}}'::jsonb) ->> 'status'$q$),
  'open');
select tst.expect('автор — из токена, а не из payload', (select created_by || '|' || (data ->> 'createdBy') from public.work_orders where id = 'o1'), 'OS1|OS1');
select tst.expect('чужие отклики в новом заказе не приняты', (select (data -> 'claims')::text from public.work_orders where id = 'o1'), '{}');
select tst.expect('поля заказа легли', (select (data ->> 'client') || '|' || (data ->> 'price') || '|' || (data ->> 'urgency') from public.work_orders where id = 'o1'), 'Аня|5000|fire');
select tst.expect('claimScope по умолчанию free', (select data ->> 'claimScope' from public.work_orders where id = 'o1'), 'free');
select tst.expect('createdAt — серверное время', (select (abs((data ->> 'createdAt')::bigint - (extract(epoch from now()) * 1000)::bigint) < 60000)::text from public.work_orders where id = 'o1'), 'true');
select tst.expect('rev поставила база', (select (rev > 0)::text from public.work_orders where id = 'o1'), 'true');
select tst.expect('ответ несёт rev', tst.jval('OS1', $q$select ((order_write('W', 'o1', 'create', '{}'::jsonb) ->> 'rev')::bigint > 0)::text$q$), 'true');
select tst.expect('повтор создания автором — тот же заказ', tst.jval('OS1', $q$select order_write('W', 'o1', 'create', '{"client":"Другой"}'::jsonb) ->> 'client'$q$), 'Аня');
select tst.expect('чужой id при создании — отказ', tst.try('OS2', $q$select order_write('W', 'o1', 'create', '{}'::jsonb)$q$), 'error');
select tst.expect('Owner выдаёт', tst.jval('O', $q$select order_write('W', 'o_o', 'create', '{"client":"x"}'::jsonb) ->> 'createdBy'$q$), 'O');
select tst.expect('Тимлид выдаёт', tst.jval('TL', $q$select order_write('W', 'o_tl', 'create', '{"client":"x"}'::jsonb) ->> 'createdBy'$q$), 'TL');
select tst.expect('Тимлид + ОС выдаёт', tst.jval('TLO', $q$select order_write('W', 'o_tlo', 'create', '{"client":"x"}'::jsonb) ->> 'createdBy'$q$), 'TLO');
select tst.expect('технарь не выдаёт', tst.try('T1', $q$select order_write('W', 'o_t', 'create', '{"client":"x"}'::jsonb)$q$), 'error');
select tst.expect('Admin не выдаёт', tst.try('AD', $q$select order_write('W', 'o_ad', 'create', '{"client":"x"}'::jsonb)$q$), 'error');
select tst.expect('Viewer не выдаёт', tst.try('V', $q$select order_write('W', 'o_v', 'create', '{"client":"x"}'::jsonb)$q$), 'error');
select tst.expect('посторонний не выдаёт', tst.try('X', $q$select order_write('W', 'o_x', 'create', '{"client":"x"}'::jsonb)$q$), 'error');
select tst.expect('анонимный ключ не выдаёт', tst.try('__anon_key__', $q$select order_write('W', 'o_a', 'create', '{"client":"x"}'::jsonb)$q$), 'error');
select tst.expect('кривой id — отказ', tst.try('OS1', $q$select order_write('W', 'a/b', 'create', '{}'::jsonb)$q$), 'error');
select tst.expect('claimScope вне free/all — отказ', tst.try('OS1', $q$select order_write('W', 'o_bad', 'create', '{"claimScope":"x"}'::jsonb)$q$), 'error');
select tst.expect('кривая срочность → normal',
  tst.jval('OS1', $q$select order_write('W', 'o_urg', 'create', '{"urgency":"nope"}'::jsonb) ->> 'urgency'$q$), 'normal');
select tst.expect('цена строкой → null',
  tst.jval('OS1', $q$select coalesce(order_write('W', 'o_pr', 'create', '{"price":"100"}'::jsonb) ->> 'price', 'null')$q$), 'null');
select tst.expect('заказ со стола ОС помнит osSource',
  tst.jval('OS1', $q$select order_write('W', 'o_src', 'create', '{"client":"С","osSource":{"pageId":"osdesk_OS1","tabId":null,"rowId":"r5"}}'::jsonb) -> 'osSource' ->> 'rowId'$q$), 'r5');
select tst.expect('прямая вставка — отказ',
  tst.try('OS1', $q$insert into work_orders (workspace_id, id, status, created_by, data, created_at, updated_at) values ('W','z','open','OS1','{}',1,1)$q$), 'error');
select tst.expect('прямая правка — отказ', tst.try('O', $q$update work_orders set status = 'taken' where id = 'o1'$q$), 'error');
select tst.expect('прямое удаление — отказ', tst.try('O', $q$delete from work_orders where id = 'o1'$q$), 'error');

-- ---------------------------------------------------------------------
-- Чтение.
-- ---------------------------------------------------------------------
select tst.expect('технарь читает заказы', tst.try('T1', $q$select * from work_orders where workspace_id = 'W' and id = 'o1'$q$, true), 'ok:1');
select tst.expect('Viewer читает заказы', tst.try('V', $q$select * from work_orders where workspace_id = 'W' and id = 'o1'$q$, true), 'ok:1');
select tst.expect('посторонний не читает', tst.try('X', $q$select * from work_orders$q$, true), 'ok:0');
select tst.expect('анонимный ключ не читает', tst.try('__anon_key__', $q$select * from work_orders$q$, true), 'ok:0');

-- ---------------------------------------------------------------------
-- Отклики.
-- ---------------------------------------------------------------------
select tst.run('T1', $q$select order_write('W', 'o1', 'claim', '{"on":true,"name":"Тимур"}'::jsonb)$q$);
select tst.expect('технарь откликнулся', (select data -> 'claims' -> 'T1' ->> 'name' from public.work_orders where id = 'o1'), 'Тимур');
select tst.expect('отклик — под своим uid', (select data -> 'claims' -> 'T1' ->> 'uid' from public.work_orders where id = 'o1'), 'T1');
select tst.run('T2', $q$select order_write('W', 'o1', 'claim', '{"on":true,"name":"Толя"}'::jsonb)$q$);
select tst.expect('второй отклик рядом с первым', (select (select count(*) from jsonb_object_keys(data -> 'claims'))::text from public.work_orders where id = 'o1'), '2');
select tst.run('T2', $q$select order_write('W', 'o1', 'claim', '{"on":false}'::jsonb)$q$);
select tst.expect('снял свой — остался чужой', (select string_agg(k, ',') from public.work_orders, jsonb_object_keys(data -> 'claims') k where id = 'o1'), 'T1');
select tst.expect('Тимлид + Технарь откликается', tst.try('TLT', $q$select order_write('W', 'o1', 'claim', '{"on":true}'::jsonb)$q$), 'ok');
select tst.expect('ОС не откликается', tst.try('OS2', $q$select order_write('W', 'o1', 'claim', '{"on":true}'::jsonb)$q$), 'error');
select tst.expect('Viewer не откликается', tst.try('V', $q$select order_write('W', 'o1', 'claim', '{"on":true}'::jsonb)$q$), 'error');

-- ---------------------------------------------------------------------
-- «Свободные / Все».
-- ---------------------------------------------------------------------
select tst.expect('чужой ОС переключает у открытого', tst.try('OS2', $q$select order_write('W', 'o1', 'scope', '{"scope":"all"}'::jsonb)$q$), 'ok');
select tst.expect('технарь не переключает', tst.try('T1', $q$select order_write('W', 'o1', 'scope', '{"scope":"all"}'::jsonb)$q$), 'error');
select tst.expect('кривое значение — отказ', tst.try('OS1', $q$select order_write('W', 'o1', 'scope', '{"scope":"x"}'::jsonb)$q$), 'error');
select tst.run('OS1', $q$select order_write('W', 'o1', 'scope', '{"scope":"all"}'::jsonb)$q$);
select tst.expect('scope записан', (select data ->> 'claimScope' from public.work_orders where id = 'o1'), 'all');

-- ---------------------------------------------------------------------
-- Выдача, отзыв, отмена.
-- ---------------------------------------------------------------------
select tst.expect('чужой ОС не выдаёт', tst.try('OS2', $q$select order_write('W', 'o1', 'assign', '{"uid":"T1","name":"Тимур"}'::jsonb)$q$), 'error');
select tst.expect('технарь не выдаёт', tst.try('T1', $q$select order_write('W', 'o1', 'assign', '{"uid":"T1","name":"Тимур"}'::jsonb)$q$), 'error');
select tst.expect('выдать без кому — отказ', tst.try('OS1', $q$select order_write('W', 'o1', 'assign', '{}'::jsonb)$q$), 'error');
select tst.run('OS1', $q$select order_write('W', 'o1', 'assign', '{"uid":"T1","name":"Тимур"}'::jsonb)$q$);
select tst.expect('выдан', (select status || '|' || assigned_uid || '|' || (data ->> 'assignedBy') from public.work_orders where id = 'o1'), 'assigned|T1|OS1');
select tst.expect('после выдачи отклик закрыт', tst.try('T2', $q$select order_write('W', 'o1', 'claim', '{"on":true}'::jsonb)$q$), 'error');
select tst.expect('чужой ОС не переключает scope у выданного', tst.try('OS2', $q$select order_write('W', 'o1', 'scope', '{"scope":"free"}'::jsonb)$q$), 'error');
select tst.expect('Тимлид отзывает чужой', tst.try('TL', $q$select order_write('W', 'o1', 'unassign', '{}'::jsonb)$q$), 'ok');
select tst.run('OS1', $q$select order_write('W', 'o1', 'unassign', '{}'::jsonb)$q$);
select tst.expect('отозван', (select status || '|' || coalesce(assigned_uid, '-') || '|' || coalesce(data ->> 'assignedUid', '-') from public.work_orders where id = 'o1'), 'open|-|-');
select tst.run('O', $q$select order_write('W', 'o1', 'cancel', '{"cancelled":true}'::jsonb)$q$);
select tst.expect('Owner отменил чужой', (select status || '|' || ((data ->> 'cancelledAt') is not null)::text from public.work_orders where id = 'o1'), 'cancelled|true');
select tst.run('OS1', $q$select order_write('W', 'o1', 'cancel', '{"cancelled":false}'::jsonb)$q$);
select tst.expect('вернули из отменённых', (select status || '|' || coalesce(data ->> 'cancelledAt', 'null') from public.work_orders where id = 'o1'), 'open|null');

-- ---------------------------------------------------------------------
-- Забрать в стол, перенос периода.
-- ---------------------------------------------------------------------
select tst.run('OS1', $q$select order_write('W', 'o1', 'assign', '{"uid":"T1","name":"Тимур"}'::jsonb)$q$);
select tst.expect('чужой технарь не забирает', tst.try('T2', $q$select order_write('W', 'o1', 'take', '{"pageId":"P2","subPageId":null,"rowId":"r"}'::jsonb)$q$), 'error');
select tst.expect('забрать без адреса — отказ', tst.try('T1', $q$select order_write('W', 'o1', 'take', '{}'::jsonb)$q$), 'error');
select tst.run('T1', $q$select order_write('W', 'o1', 'take', '{"pageId":"P1","subPageId":"month-2026-09","rowId":"row_o1"}'::jsonb)$q$);
select tst.expect('назначенный забрал', (select status || '|' || (data ->> 'takenPageId') || '|' || (data ->> 'takenSubPageId') || '|' || (data ->> 'takenRowId') from public.work_orders where id = 'o1'), 'taken|P1|month-2026-09|row_o1');
select tst.expect('второй раз забрать нельзя', tst.try('T1', $q$select order_write('W', 'o1', 'take', '{"pageId":"P1","rowId":"row_o1"}'::jsonb)$q$), 'error');
select tst.run('T1', $q$select order_write('W', 'o1', 'retab', '{"subPageId":"month-2026-10","rowId":"row_o1"}'::jsonb)$q$);
select tst.expect('технарь перенёс строку в новый период', (select data ->> 'takenSubPageId' from public.work_orders where id = 'o1'), 'month-2026-10');
select tst.expect('чужой технарь не переносит', tst.try('T2', $q$select order_write('W', 'o1', 'retab', '{"subPageId":null,"rowId":"x"}'::jsonb)$q$), 'error');
select tst.expect('ОС-автор доводит свой заказ сам (take)', tst.try('OS1', $q$select order_write('W', 'o_src', 'take', '{"pageId":"P1","subPageId":null,"rowId":"os_r5"}'::jsonb)$q$), 'ok');

-- ---------------------------------------------------------------------
-- Удаление (мягкое).
-- ---------------------------------------------------------------------
select tst.expect('чужой ОС не удаляет', tst.try('OS2', $q$select order_write('W', 'o_tl', 'delete', '{}'::jsonb)$q$), 'error');
select tst.expect('технарь не удаляет', tst.try('T1', $q$select order_write('W', 'o_tl', 'delete', '{}'::jsonb)$q$), 'error');
select tst.run('TL', $q$select order_write('W', 'o_tl', 'delete', '{}'::jsonb)$q$);
select tst.expect('удалён мягко (виден в дельте)', (select deleted::text from public.work_orders where id = 'o_tl'), 'true');
select tst.expect('rev удаления вырос', (select (rev > (select rev from public.work_orders where id = 'o_o'))::text from public.work_orders where id = 'o_tl'), 'true');
select tst.expect('удалённый не правится', tst.try('TL', $q$select order_write('W', 'o_tl', 'unassign', '{}'::jsonb)$q$), 'error');
select tst.expect('удалённый не создаётся заново тем же id чужим', tst.try('OS1', $q$select order_write('W', 'o_tl', 'create', '{}'::jsonb)$q$), 'error');
select tst.expect('неизвестная операция — отказ', tst.try('O', $q$select order_write('W', 'o1', 'boom', '{}'::jsonb)$q$), 'error');
select tst.expect('несуществующий заказ — отказ', tst.try('O', $q$select order_write('W', 'nope', 'assign', '{"uid":"T1"}'::jsonb)$q$), 'error');
select tst.expect('чужой workspace — отказ', tst.try('O', $q$select order_write('W2', 'o1', 'assign', '{"uid":"T1"}'::jsonb)$q$), 'error');

-- ---------------------------------------------------------------------
-- Запросы технаря к ОС.
-- ---------------------------------------------------------------------
select tst.expect('технарь просит ОС',
  tst.jval('T1', $q$select order_request_submit('W', '{"id":"P1_r1","kind":"status","status":"done","statusLabel":"Готово","note":"сделал","techUid":"T9","techName":"Тимур","osUid":"OS1","client":"Аня","deskPageId":"P1","deskTabId":null,"rowId":"r1","srcPageId":"osdesk_OS1","srcTabId":null,"srcRowId":"s1","state":"approved"}'::jsonb) ->> 'state'$q$),
  'pending');
select tst.expect('techUid — из токена', (select tech_uid || '|' || (data ->> 'techUid') from public.order_requests where id = 'P1_r1'), 'T1|T1');
select tst.expect('просить себя — отказ', tst.try('T1', $q$select order_request_submit('W', '{"id":"P1_r2","kind":"status","osUid":"T1"}'::jsonb)$q$), 'error');
select tst.expect('кривой вид — отказ', tst.try('T1', $q$select order_request_submit('W', '{"id":"P1_r2","kind":"x","osUid":"OS1"}'::jsonb)$q$), 'error');
select tst.expect('длинное примечание — отказ',
  tst.try('T1', format($q$select order_request_submit('W', '{"id":"P1_r2","kind":"delete","osUid":"OS1","note":"%s"}'::jsonb)$q$, repeat('x', 301))), 'error');
select tst.expect('чужую просьбу не перезаписать', tst.try('T2', $q$select order_request_submit('W', '{"id":"P1_r1","kind":"delete","osUid":"OS1"}'::jsonb)$q$), 'error');
select tst.expect('посторонний не просит', tst.try('X', $q$select order_request_submit('W', '{"id":"P1_r3","kind":"delete","osUid":"OS1"}'::jsonb)$q$), 'error');
select tst.expect('технарь читает свою', tst.try('T1', $q$select * from order_requests where id = 'P1_r1'$q$, true), 'ok:1');
select tst.expect('ОС заказа читает', tst.try('OS1', $q$select * from order_requests where id = 'P1_r1'$q$, true), 'ok:1');
select tst.expect('Тимлид читает', tst.try('TL', $q$select * from order_requests where id = 'P1_r1'$q$, true), 'ok:1');
select tst.expect('другой технарь не читает', tst.try('T2', $q$select * from order_requests$q$, true), 'ok:0');
select tst.expect('другой ОС не читает', tst.try('OS2', $q$select * from order_requests$q$, true), 'ok:0');
select tst.expect('Viewer не читает', tst.try('V', $q$select * from order_requests$q$, true), 'ok:0');
select tst.expect('технарь сам себе не решает', tst.try('T1', $q$select order_request_resolve('W', 'P1_r1', true)$q$), 'error');
select tst.expect('другой ОС не решает', tst.try('OS2', $q$select order_request_resolve('W', 'P1_r1', true)$q$), 'error');
select tst.run('OS1', $q$select order_request_resolve('W', 'P1_r1', false)$q$);
select tst.expect('ОС отклонил', (select state || '|' || (data ->> 'resolvedBy') from public.order_requests where id = 'P1_r1'), 'rejected|OS1');
select tst.expect('второй раз не решить', tst.try('OS1', $q$select order_request_resolve('W', 'P1_r1', true)$q$), 'error');
select tst.expect('после отказа можно попросить снова',
  tst.jval('T1', $q$select order_request_submit('W', '{"id":"P1_r1","kind":"delete","osUid":"OS1","note":""}'::jsonb) ->> 'state'$q$), 'pending');
select tst.expect('Тимлид решает', tst.jval('TL', $q$select order_request_resolve('W', 'P1_r1', true) ->> 'state'$q$), 'approved');
select tst.run('T1', $q$select order_request_submit('W', '{"id":"P1_r4","kind":"delete","osUid":"OS1"}'::jsonb)$q$);
select tst.expect('чужой технарь не отзывает', tst.try('T2', $q$select order_request_withdraw('W', 'P1_r4')$q$), 'error');
select tst.expect('технарь отозвал ожидающую', tst.jval('T1', $q$select order_request_withdraw('W', 'P1_r4')::text$q$), 'true');
select tst.expect('отзыв — мягкий', (select deleted::text from public.order_requests where id = 'P1_r4'), 'true');
select tst.expect('решённую технарь не отзывает', tst.try('T1', $q$select order_request_withdraw('W', 'P1_r1')$q$), 'error');
select tst.expect('ОС заказа убирает решённую', tst.jval('OS1', $q$select order_request_withdraw('W', 'P1_r1')::text$q$), 'true');
select tst.expect('прямая вставка в запросы — отказ',
  tst.try('T1', $q$insert into order_requests (workspace_id, id, tech_uid, os_uid, state, data, created_at) values ('W','z','T1','OS1','pending','{}',1)$q$), 'error');

-- ---------------------------------------------------------------------
-- Права на таблицы и последовательность.
-- ---------------------------------------------------------------------
select tst.expect('API-роли не пишут таблицы напрямую',
  (has_table_privilege('anon', 'public.work_orders', 'insert') or has_table_privilege('authenticated', 'public.work_orders', 'update')
   or has_table_privilege('anon', 'public.order_requests', 'delete') or has_table_privilege('anon', 'public.work_orders', 'truncate'))::text, 'false');

-- ---------------------------------------------------------------------
-- Версия и повторный накат.
-- ---------------------------------------------------------------------
-- Проверка версии — ПОСЛЕ повторного наката: другие наборы накатывают
-- старые файлы заново, и в общем прогоне версия могла откатиться.
\ir ../migrations/20261010_orders.sql
select tst.expect('версия схемы не старее 20261010', (public.nova_schema_version() >= '20261010')::text, 'true');
select tst.expect('после повторного наката заказ выдаётся', tst.try('OS1', $q$select order_write('W', 'o_again', 'create', '{"client":"x"}'::jsonb)$q$), 'ok');
select tst.expect('после повторного наката заказы на месте', (select count(*)::text from public.work_orders where id = 'o1'), '1');

select label, got from tst.results where not ok;
select format('ПРОВЕРОК (заказы): %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
