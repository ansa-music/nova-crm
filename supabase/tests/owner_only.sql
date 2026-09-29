-- Проверки 20261041_owner_only.sql — стол «только для Owner». Запускать
-- ПОСЛЕ desk_rows_rls.sql (W: O — создатель, TL — Тимлид, TLT — Тимлид +
-- Технарь, T1/T2/T3 — технари, OS1/OS2 — ОС, AD — Admin, V — Viewer,
-- OBS — наблюдатель, X — посторонний; стол P1: ответственный T1, просмотр
-- T1/T2/T3/V, правка T3/V; P2 — стол T2).
\set ON_ERROR_STOP 1
set client_min_messages = warning;
truncate tst.results;

\ir ../migrations/20261041_owner_only.sql

create or replace function tst.val(uid text, sql text) returns text language plpgsql as $$
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

-- ---------- Исходное состояние ----------
update public.rows_workspaces set live = true, migrating_until = null, os_managed = false, tech_fills_all = false, status = 'active'
where workspace_id = 'W';
insert into public.rows_members (workspace_id, uid, role, extra_roles) values ('W', 'LP', 'leadplus', '{}')
on conflict (workspace_id, uid) do update set role = 'leadplus', extra_roles = '{}';
update public.rows_members set os_nick_value = 'opt_os1' where workspace_id = 'W' and uid = 'OS1';
delete from public.rows_owner_only where workspace_id = 'W';
delete from public.core_docs where workspace_id = 'W';
delete from public.desk_rows where workspace_id = 'W' and page_id in ('P1', 'P2') and id like 'oo_%';
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at) values
  ('W', 'P1', '', 'oo_r1', '{"client":"Секрет"}', 90, 1000, 1000),
  ('W', 'P2', '', 'oo_p2', '{"client":"Открытый"}', 90, 1000, 1000);
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at, os_uid, tech_uid, status_key) values
  ('W', 'P1', '', 'oo_os', '{"client":"Заказ ОС","status":"work"}', 91, 1000, 1000, 'OS1', 'T1', 'status');
-- Документы столов и вкладок в ядре (как после переноса).
select tst.run('O', $q$select core_import('W', '[
  {"kind":"page","id":"P1","data":{"id":"P1","workspaceId":"W","name":"Стол T1","responsibleUserId":"T1","createdBy":"T1","allowedUsers":["T1","T2","T3","V"],"editableUsers":["T3","V"],"updatedAt":1}},
  {"kind":"page","id":"P2","data":{"id":"P2","workspaceId":"W","name":"Стол T2","responsibleUserId":"T2","createdBy":"T2","allowedUsers":["T2"],"updatedAt":1}},
  {"kind":"page","id":"osdesk_OS1","data":{"id":"osdesk_OS1","workspaceId":"W","name":"Стол ОС","osDesk":true,"responsibleUserId":"OS1","createdBy":"OS1","allowedUsers":["OS1"],"updatedAt":1}},
  {"kind":"subpage","id":"m1","page":"P1","data":{"id":"m1","pageId":"P1","name":"Сентябрь","updatedAt":1}},
  {"kind":"subpage","id":"x1","page":"P2","data":{"id":"x1","pageId":"P2","name":"Октябрь","updatedAt":1}}
]'::jsonb, 'imported_page', true)$q$);

-- ---------- До закрытия ----------
select tst.expect('до закрытия: технарь из просмотра читает стол', tst.try('T2', $q$select * from desk_rows where workspace_id='W' and page_id='P1'$q$, true), 'ok');
select tst.expect('до закрытия: ОС видит все столы', tst.try('OS2', $q$select * from desk_rows where workspace_id='W' and page_id='P1'$q$, true), 'ok');
-- Старая дыра: «create» существующей вкладки отдавал её любому участнику.
select tst.expect('«create» чужой вкладки без права читать — отказ (старая дыра)',
  tst.val('T1', $q$select core_write('W', '[{"kind":"subpage","page":"P2","id":"x1","op":"create","data":{}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('«create» своей существующей вкладки — как раньше',
  tst.val('T2', $q$select (core_write('W', '[{"kind":"subpage","page":"P2","id":"x1","op":"create","data":{}}]'::jsonb) -> 0 -> 'data' ->> 'name')$q$), 'Октябрь');

-- ---------- Кто закрывает ----------
select tst.expect('ответственный стол не закрывает', tst.val('T1', $q$select rows_set_desk_owner_only('W','P1',true)::text$q$), 'error:42501');
select tst.expect('Тимлид не закрывает', tst.val('TL', $q$select rows_set_desk_owner_only('W','P1',true)::text$q$), 'error:42501');
select tst.expect('Тимлид+ не закрывает', tst.val('LP', $q$select rows_set_desk_owner_only('W','P1',true)::text$q$), 'error:42501');
select tst.expect('стол ОС не закрывается', tst.val('O', $q$select rows_set_desk_owner_only('W','osdesk_OS1',true)::text$q$), 'error:22023');
select tst.expect('Owner закрывает стол', tst.val('O', $q$select rows_set_desk_owner_only('W','P1',true)::text$q$), 'true');
select tst.expect('…флаг в таблице', (select count(*)::text from public.rows_owner_only where workspace_id = 'W' and page_id = 'P1'), '1');
select tst.expect('…и в документе стола', (select data ->> 'ownerOnly' from public.core_docs where workspace_id = 'W' and kind = 'page' and id = 'P1'), 'true');
select tst.expect('повторное закрытие — без ошибки', tst.val('O', $q$select rows_set_desk_owner_only('W','P1',true)::text$q$), 'true');
select tst.expect('флаг видят участники (значок в «Столах»)', tst.try('T2', $q$select * from rows_owner_only where workspace_id='W'$q$, true), 'ok:1');
select tst.expect('посторонний флаг не видит', tst.try('X', $q$select * from rows_owner_only where workspace_id='W'$q$, true), 'ok:0');

-- ---------- Чтение строк закрытого стола ----------
select tst.expect('Owner читает все строки', tst.try('O', $q$select * from desk_rows where workspace_id='W' and page_id='P1' and id like 'oo_%'$q$, true), 'ok:2');
select tst.expect('ответственный не читает свой закрытый стол', tst.try('T1', $q$select * from desk_rows where workspace_id='W' and page_id='P1'$q$, true), 'ok:0');
select tst.expect('просмотр (allowedUsers) не читает', tst.try('T2', $q$select * from desk_rows where workspace_id='W' and page_id='P1'$q$, true), 'ok:0');
select tst.expect('правка (editableUsers) не читает', tst.try('T3', $q$select * from desk_rows where workspace_id='W' and page_id='P1'$q$, true), 'ok:0');
select tst.expect('Viewer из просмотра не читает', tst.try('V', $q$select * from desk_rows where workspace_id='W' and page_id='P1'$q$, true), 'ok:0');
select tst.expect('ОС видит свою строку-заказ', tst.try('OS1', $q$select * from desk_rows where workspace_id='W' and page_id='P1' and id='oo_os'$q$, true), 'ok:1');
select tst.expect('…и ни одной чужой строки стола', tst.try('OS1', $q$select * from desk_rows where workspace_id='W' and page_id='P1' and os_uid is distinct from 'OS1'$q$, true), 'ok:0');
select tst.expect('другой ОС не видит ничего', tst.try('OS2', $q$select * from desk_rows where workspace_id='W' and page_id='P1'$q$, true), 'ok:0');
select tst.expect('Тимлид + Технарь не читает', tst.try('TLT', $q$select * from desk_rows where workspace_id='W' and page_id='P1'$q$, true), 'ok:0');
select tst.expect('Тимлид не видит строки-заказы (ветка «Успешка»)', tst.try('TL', $q$select * from desk_rows where workspace_id='W' and page_id='P1'$q$, true), 'ok:0');
select tst.expect('Тимлид+ не читает', tst.try('LP', $q$select * from desk_rows where workspace_id='W' and page_id='P1'$q$, true), 'ok:0');
select tst.expect('наблюдатель не читает', tst.try('OBS', $q$select * from desk_rows where workspace_id='W' and page_id='P1'$q$, true), 'ok:0');
select tst.expect('Admin не читает', tst.try('AD', $q$select * from desk_rows where workspace_id='W' and page_id='P1'$q$, true), 'ok:0');
select tst.expect('соседний стол не задет', tst.try('T2', $q$select * from desk_rows where workspace_id='W' and page_id='P2' and id='oo_p2'$q$, true), 'ok:1');
select tst.expect('голова таблицы у ответственного — пусто', tst.val('T1', $q$select (rows_table_head('W','P1','') ->> 'count')$q$), '0');
select tst.expect('rows_page_access: ответственный — не читает', tst.val('T1', $q$select (rows_page_access('W','P1') ->> 'canRead')$q$), 'false');
select tst.expect('rows_page_access: Owner — читает', tst.val('O', $q$select (rows_page_access('W','P1') ->> 'canRead')$q$), 'true');
select tst.expect('rows_can_edit_page: ответственный — нет', tst.val('T1', $q$select rows_can_edit_page('W','P1')::text$q$), 'false');

-- ---------- Запись в строки закрытого стола ----------
select tst.expect('ответственный не правит строку', tst.try('T1', $q$update desk_rows set cells = cells || '{"x":"1"}' where workspace_id='W' and page_id='P1' and id='oo_r1'$q$), 'deny');
select tst.expect('ответственный не заводит строку', tst.try('T1', $q$insert into desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at) values ('W','P1','','oo_new','{}',1,1,1)$q$), 'deny');
select tst.expect('rows_patch ответственного — отказ', tst.try('T1', $q$select rows_patch('W','P1','','oo_r1','{"x":"2"}'::jsonb)$q$), 'deny');
select tst.expect('Тимлид+ не правит', tst.try('LP', $q$update desk_rows set cells = cells || '{"x":"1"}' where workspace_id='W' and page_id='P1'$q$), 'deny');
select tst.expect('Тимлид+ не удаляет', tst.try('LP', $q$delete from desk_rows where workspace_id='W' and page_id='P1'$q$), 'deny');
select tst.expect('Тимлид не ставит «Успешку» на закрытом столе', tst.try('TL', $q$select rows_patch('W','P1','','oo_os','{"status":"success"}'::jsonb)$q$), 'deny');
select tst.expect('ОС правит свою строку-заказ', tst.try('OS1', $q$update desk_rows set cells = cells || '{"status":"pay"}' where workspace_id='W' and page_id='P1' and id='oo_os'$q$), 'ok:1');
select tst.expect('ОС заводит новую копию заказа (выдача работает)',
  tst.try('OS1', $q$insert into desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at, os_uid, tech_uid, status_key)
    values ('W','P1','','oo_os2','{"client":"Новый"}',92,1,1,'OS1','T1','status')$q$), 'ok:1');
select tst.expect('ОС убирает свою копию', tst.try('OS1', $q$delete from desk_rows where workspace_id='W' and page_id='P1' and id='oo_os'$q$), 'ok:1');
select tst.expect('ОС не заводит строку без метки ОС', tst.try('OS1', $q$insert into desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at) values ('W','P1','','oo_x','{}',1,1,1)$q$), 'deny');
select tst.expect('Owner правит', tst.try('O', $q$update desk_rows set cells = cells || '{"x":"1"}' where workspace_id='W' and page_id='P1' and id='oo_r1'$q$), 'ok:1');

-- ---------- Вкладки, документ стола ----------
select tst.expect('вкладки закрытого стола ответственный не видит', tst.try('T1', $q$select * from core_docs where workspace_id='W' and kind='subpage' and parent_id='P1'$q$, true), 'ok:0');
select tst.expect('…ОС не видит', tst.try('OS2', $q$select * from core_docs where workspace_id='W' and kind='subpage' and parent_id='P1'$q$, true), 'ok:0');
select tst.expect('…Owner видит', tst.try('O', $q$select * from core_docs where workspace_id='W' and kind='subpage' and parent_id='P1'$q$, true), 'ok:1');
select tst.expect('документ стола виден всем (рейтинги, выдача)', tst.try('OS2', $q$select * from core_docs where workspace_id='W' and kind='page' and id='P1'$q$, true), 'ok:1');
select tst.expect('«create» вкладки закрытого стола не отдаёт её ОС',
  tst.val('OS2', $q$select core_write('W', '[{"kind":"subpage","page":"P1","id":"m1","op":"create","data":{}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('Тимлид+ не правит вкладку закрытого стола',
  tst.val('LP', $q$select core_write('W', '[{"kind":"subpage","page":"P1","id":"m1","op":"merge","data":{"name":"x"}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('ответственный не заводит вкладку',
  tst.val('T1', $q$select core_write('W', '[{"kind":"subpage","page":"P1","id":"m2","op":"create","data":{"id":"m2","pageId":"P1"}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('Тимлид+ не удаляет вкладку',
  tst.val('LP', $q$select core_write('W', '[{"kind":"subpage","page":"P1","id":"m1","op":"delete"}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('Owner правит вкладку',
  tst.val('O', $q$select (core_write('W', '[{"kind":"subpage","page":"P1","id":"m1","op":"merge","data":{"name":"Сентябрь 2026"}}]'::jsonb) -> 0 ->> 'id')$q$), 'm1');
select tst.expect('ответственный не правит свой закрытый стол',
  tst.val('T1', $q$select core_write('W', '[{"kind":"page","id":"P1","op":"merge","data":{"name":"Мой"}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('ответственный не снимает флаг',
  tst.val('T1', $q$select core_write('W', '[{"kind":"page","id":"P1","op":"merge","data":{"ownerOnly":false}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('Тимлид не снимает флаг',
  tst.val('TL', $q$select core_write('W', '[{"kind":"page","id":"P1","op":"merge","data":{"ownerOnly":{"$del":true}}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('Тимлид правит доступ (список Тимлида) — как раньше',
  tst.val('TL', $q$select (core_write('W', '[{"kind":"page","id":"P1","op":"merge","data":{"allowedUsers":["T1","T2"]}}]'::jsonb) -> 0 ->> 'id')$q$), 'P1');
select tst.expect('…флаг остался', (select data ->> 'ownerOnly' from public.core_docs where workspace_id = 'W' and kind = 'page' and id = 'P1'), 'true');
select tst.expect('«set» стола без флага от Тимлида — отказ',
  tst.val('TL', $q$select core_write('W', '[{"kind":"page","id":"P1","op":"set","data":{"id":"P1","workspaceId":"W","name":"Стол T1","responsibleUserId":"T1","createdBy":"T1","allowedUsers":["T1"]}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('технарь не заводит свой стол сразу закрытым',
  tst.val('T3', $q$select core_write('W', '[{"kind":"page","id":"page_T3_a","op":"set","data":{"id":"page_T3_a","workspaceId":"W","name":"Мой","responsibleUserId":"T3","createdBy":"T3","allowedUsers":["T3"],"ownerOnly":true}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('флаг — только true/false',
  tst.val('O', $q$select core_write('W', '[{"kind":"page","id":"P2","op":"merge","data":{"ownerOnly":"yes"}}]'::jsonb)::text$q$), 'error:22023');
select tst.expect('стол ОС не закрывают и через документ',
  tst.val('O', $q$select core_write('W', '[{"kind":"page","id":"osdesk_OS1","op":"merge","data":{"ownerOnly":true}}]'::jsonb)::text$q$), 'error:22023');
-- Дочитка переноса (тень Firestore без флага, новее) флаг не снимает.
select tst.run('O', $q$select core_import('W', '[{"kind":"page","id":"P1","data":{"id":"P1","workspaceId":"W","name":"Из Firestore","responsibleUserId":"T1","createdBy":"T1","allowedUsers":["T1"],"updatedAt":99999999999999}}]'::jsonb, 'imported_page', false)$q$);
select tst.expect('дочитка переноса не снимает флаг', (select (data ->> 'name') || '|' || coalesce(data ->> 'ownerOnly', '-') from public.core_docs where workspace_id = 'W' and kind = 'page' and id = 'P1'), 'Из Firestore|true');
select tst.expect('…и копия флага на месте', (select count(*)::text from public.rows_owner_only where workspace_id = 'W' and page_id = 'P1'), '1');

-- ---------- Чат стола, личные зоны, счётчики ----------
select tst.expect('ответственный не пишет в чат закрытого стола',
  tst.val('T1', $q$select send_chat_message('W','page','P1',null,null,'{"text":"привет"}'::jsonb)::text$q$), 'error:42501');
select tst.expect('ОС не пишет в чат закрытого стола',
  tst.val('OS1', $q$select send_chat_message('W','page','P1',null,null,'{"text":"привет"}'::jsonb)::text$q$), 'error:42501');
select tst.expect('Owner пишет в чат стола',
  tst.val('O', $q$select (send_chat_message('W','page','P1',null,null,'{"id":"oo_msg1","text":"только Owner"}'::jsonb) ->> 'id')$q$), 'oo_msg1');
select tst.expect('чат закрытого стола не читает ОС', tst.try('OS2', $q$select * from chat_messages where workspace_id='W' and thread='page:P1'$q$, true), 'ok:0');
select tst.expect('…и ответственный', tst.try('T1', $q$select * from chat_messages where workspace_id='W' and thread='page:P1'$q$, true), 'ok:0');
select tst.expect('…Owner читает', tst.try('O', $q$select * from chat_messages where workspace_id='W' and thread='page:P1'$q$, true), 'ok:1');
-- Старая дыра: повтор чужого id возвращал сообщение другой нити.
select tst.expect('чужой id сообщения не отдаёт его содержимое',
  tst.val('T2', $q$select send_chat_message('W','ws',null,null,null,'{"id":"oo_msg1","text":"x"}'::jsonb)::text$q$), 'error:23505');
select tst.expect('личная зона на закрытом столе — нет', tst.val('T1', $q$select rows_personal_ok('W','P1','T1')::text$q$), 'false');
select tst.expect('личная зона на обычном столе — есть', tst.val('T2', $q$select rows_personal_ok('W','P2','T2')::text$q$), 'true');
select tst.expect('ответственный не публикует счётчики закрытого стола',
  tst.try('T1', $q$insert into desk_loads (workspace_id, page_id, responsible_uid, month_key, sub_page_id, data) values ('W','P1','T1','2026-09','m1','{}')$q$), 'deny');
select tst.expect('Owner публикует счётчики закрытого стола',
  tst.try('O', $q$insert into desk_loads (workspace_id, page_id, responsible_uid, month_key, sub_page_id, data) values ('W','P1','T1','2026-09','m1','{"total":3}')
    on conflict (workspace_id, page_id) do update set data = excluded.data$q$), 'ok:1');
select tst.run('O', $q$insert into desk_loads (workspace_id, page_id, responsible_uid, month_key, sub_page_id, data) values ('W','P1','T1','2026-09','m1','{"total":3}')
  on conflict (workspace_id, page_id) do update set data = excluded.data$q$);
select tst.expect('счётчики закрытого стола видны всем (рейтинги)', tst.try('OS2', $q$select * from desk_loads where workspace_id='W' and page_id='P1'$q$, true), 'ok:1');
select tst.expect('Тимлид+ не переносит строки закрытого стола',
  tst.val('LP', $q$select rows_carry_over('W','P1','','m1',array['oo_r1'])::text$q$), 'error:42501');
select tst.expect('Тимлид+ не переархивирует счётчики',
  tst.val('LP', $q$select desk_load_rearchive('W','P1','2026-08','m0','{}'::jsonb)::text$q$), 'error:42501');
select tst.expect('ОС не забирает строку закрытого стола',
  tst.val('OS1', $q$select (rows_os_claim_order('W','P1','','oo_r1',null,'','{}'::jsonb,null,'h') ->> 'status')$q$), 'not_tech_desk');

-- ---------- История, оценки, Telegram, файлы ----------
insert into public.order_events (workspace_id, order_key, page_id, row_id, kind, at) values ('W','oo_k1','P1','oo_r1','created',1), ('W','oo_k2','P2','oo_p2','created',1);
select tst.expect('Тимлид не видит историю закрытого стола', tst.try('TL', $q$select * from order_events where workspace_id='W' and order_key in ('oo_k1','oo_k2')$q$, true), 'ok:1');
select tst.expect('Owner видит всю историю', tst.try('O', $q$select * from order_events where workspace_id='W' and order_key in ('oo_k1','oo_k2')$q$, true), 'ok:2');
insert into public.order_ratings (workspace_id, page_id, tab_id, row_id, os_uid, os_value, tech_uid, score, month_key, title, created_at, updated_at)
values ('W','P1','','oo_os2','OS1','opt_os1','T1',8,'2026-09','Клиент Секрет',1,1)
on conflict do nothing;
select tst.expect('технарь закрытого стола не видит названия оценённых заказов', tst.try('T1', $q$select * from order_ratings where workspace_id='W' and page_id='P1'$q$, true), 'ok:0');
select tst.expect('ОС видит свою оценку', tst.try('OS1', $q$select * from order_ratings where workspace_id='W' and page_id='P1'$q$, true), 'ok:1');
insert into public.tg_access (workspace_id, uid, granted_by, granted_at) values ('W','OS1','O',1), ('W','OS2','O',1), ('W','T2','O',1) on conflict do nothing;
insert into public.tg_chat_clients (workspace_id, chat_id, page_id, tab_id, row_id, label, bound_by, bound_at) values
  ('W', 9001, 'P1', '', 'oo_r1', 'Секрет · 777', 'O', 1),
  ('W', 9002, 'P1', '', 'oo_os2', 'Новый · 555', 'OS1', 1)
on conflict do nothing;
select tst.expect('Telegram: чужая привязка к закрытому столу не видна', tst.try('T2', $q$select * from tg_chat_clients where workspace_id='W' and chat_id in (9001, 9002)$q$, true), 'ok:0');
select tst.expect('Telegram: ОС видит свою привязку', tst.try('OS1', $q$select * from tg_chat_clients where workspace_id='W' and chat_id in (9001, 9002)$q$, true), 'ok:1');
select tst.expect('Telegram: к строке закрытого стола не привязать',
  tst.val('OS2', $q$select tg_link_client('W', 9003, 'P1', '', 'oo_r1', 'x')::text$q$), 'error:42501');
select tst.expect('Telegram: к своей копии — можно',
  tst.val('OS1', $q$select (tg_link_client('W', 9004, 'P1', '', 'oo_os', 'свой') ->> 'row_id')$q$), 'oo_os');
select tst.expect('файлы строк закрытого стола — не участнику стола', tst.val('T2', $q$select nova_storage_path_ok('W/P1/oo_r1/f.png', false)::text$q$), 'false');
select tst.expect('…Owner — можно', tst.val('O', $q$select nova_storage_path_ok('W/P1/oo_r1/f.png', true)::text$q$), 'true');
select tst.expect('…обычный стол — как раньше', tst.val('T2', $q$select nova_storage_path_ok('W/P2/oo_p2/f.png', false)::text$q$), 'true');

-- ---------- Открыть обратно ----------
select tst.expect('ответственный не открывает', tst.val('T1', $q$select rows_set_desk_owner_only('W','P1',false)::text$q$), 'error:42501');
select tst.expect('Owner открывает стол', tst.val('O', $q$select rows_set_desk_owner_only('W','P1',false)::text$q$), 'false');
select tst.expect('…флаг снят и в документе', (select coalesce(data ->> 'ownerOnly', '-') from public.core_docs where workspace_id = 'W' and kind = 'page' and id = 'P1'), '-');
select tst.expect('после открытия ответственный читает', tst.try('T1', $q$select * from desk_rows where workspace_id='W' and page_id='P1' and id like 'oo_%'$q$, true), 'ok');
select tst.expect('после открытия ОС видит все строки', tst.try('OS2', $q$select * from desk_rows where workspace_id='W' and page_id='P1' and id like 'oo_%'$q$, true), 'ok');

-- ---------- Флаг через документ стола (core_write Owner) ----------
select tst.run('O', $q$select core_write('W', '[{"kind":"page","id":"P2","op":"merge","data":{"ownerOnly":true}}]'::jsonb)$q$);
select tst.expect('Owner закрывает стол записью документа — копия флага триггером', (select count(*)::text from public.rows_owner_only where workspace_id = 'W' and page_id = 'P2'), '1');
select tst.expect('…ответственный P2 больше не читает', tst.try('T2', $q$select * from desk_rows where workspace_id='W' and page_id='P2'$q$, true), 'ok:0');
select tst.run('TL', $q$select core_write('W', '[{"kind":"page","id":"P2","op":"merge","data":{"hiddenByResponsible":true}}]'::jsonb)$q$);
select tst.expect('правка Тимлида флаг не снимает', (select count(*)::text from public.rows_owner_only where workspace_id = 'W' and page_id = 'P2'), '1');
select tst.run('O', $q$select core_write('W', '[{"kind":"page","id":"P2","op":"merge","data":{"ownerOnly":{"$del":true}}}]'::jsonb)$q$);
select tst.expect('Owner снимает флаг документом — копия ушла', (select count(*)::text from public.rows_owner_only where workspace_id = 'W' and page_id = 'P2'), '0');
select tst.run('O', $q$select core_write('W', '[{"kind":"page","id":"P2","op":"merge","data":{"ownerOnly":true}}]'::jsonb)$q$);
select tst.run('O', $q$select core_write('W', '[{"kind":"page","id":"P2","op":"delete"}]'::jsonb)$q$);
select tst.expect('удалённый стол флаг сохраняет (строки удаляются позже)', (select count(*)::text from public.rows_owner_only where workspace_id = 'W' and page_id = 'P2'), '1');
select tst.expect('…и его строки ОС до удаления не видит', tst.try('OS2', $q$select * from desk_rows where workspace_id='W' and page_id='P2'$q$, true), 'ok:0');
select tst.expect('…и Тимлид+ не видит', tst.try('LP', $q$select * from desk_rows where workspace_id='W' and page_id='P2'$q$, true), 'ok:0');

-- ---------- Повторный накат ----------
select tst.run('O', $q$select rows_set_desk_owner_only('W','P1',true)$q$);
\ir ../migrations/20261041_owner_only.sql
select tst.expect('после наката флаг на месте', (select count(*)::text from public.rows_owner_only where workspace_id = 'W' and page_id = 'P1'), '1');
select tst.expect('…и закрытие действует', tst.try('T1', $q$select * from desk_rows where workspace_id='W' and page_id='P1'$q$, true), 'ok:0');
select tst.expect('версия схемы не старее 20261041', (public.nova_schema_version() >= '20261041')::text, 'true');

-- ---------- Находки ревью ----------
select tst.expect('Тимлид+ не заводит «свою строку ОС» в закрытый стол',
  tst.try('LP', $q$insert into desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at, os_uid, tech_uid, status_key)
    values ('W','P1','','oo_lp','{"client":"x"}',93,1,1,'LP','T1','status')$q$), 'deny');
select tst.expect('закрытые столы — только своих workspace: посторонний не видит ни одного',
  tst.val('X', $q$select count(*)::text from rows_owner_only_hidden()$q$), '0');
select tst.expect('…без входа — тоже', tst.val('__anon_key__', $q$select count(*)::text from rows_owner_only_hidden()$q$), '0');
select tst.expect('…участник видит закрытые столы своего workspace', (tst.val('T1', $q$select count(*)::text from rows_owner_only_hidden()$q$) <> '0')::text, 'true');

select label, got from tst.results where not ok;
select format('ПРОВЕРОК (стол только для Owner): %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
