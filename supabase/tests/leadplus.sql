-- Проверки 20261036_leadplus.sql: роль «Тимлид+», история заказов
-- (order_events), общая таблица (lead_board / lead_board_head) и переезд
-- заказа к другому ОС (lead_move_os). Запускать ПОСЛЕ desk_rows_rls.sql
-- (хелперы tst.*). Свой workspace WL:
--   LO — Owner, LP — Тимлид+, LT — Тимлид, LOS1/LOS2/LOS3 — ОС,
--   LT1/LT2 — технари, X — посторонний.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
truncate tst.results;

\ir ../migrations/20261036_leadplus.sql

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

create or replace function tst.lmember(uid text, role text, extra jsonb default '{}') returns jsonb language sql immutable as $$
  select jsonb_build_object('uid', uid, 'email', lower(uid) || '@x.io', 'name', 'Имя ' || uid, 'role', role, 'status', 'active',
    'invitedAt', 1000, 'invitedBy', 'LO', 'joinedAt', 1000) || extra
$$;

-- ---------------------------------------------------------------------
-- Данные.
-- ---------------------------------------------------------------------
delete from public.rows_workspaces where workspace_id = 'WL';
insert into public.rows_workspaces (workspace_id, owner_id, live) values ('WL', 'LO', true);
insert into public.rows_members (workspace_id, uid, role, extra_roles, os_nick_value) values
  ('WL', 'LO', 'owner', '{}', null),
  ('WL', 'LP', 'leadplus', '{}', null),
  ('WL', 'LT', 'teamlead', '{}', null),
  ('WL', 'LOS1', 'os', '{}', 'nick1'),
  ('WL', 'LOS2', 'os', '{}', 'nick2'),
  ('WL', 'LOS3', 'os', '{}', 'nick3'),
  ('WL', 'LT1', 'manager', '{}', null),
  ('WL', 'LT2', 'manager', '{}', null);
insert into public.core_docs (workspace_id, kind, parent_id, id, data)
select 'WL', 'member', '', u, tst.lmember(u, r, x::jsonb)
from (values ('LO', 'owner', '{}'), ('LP', 'leadplus', '{}'), ('LT', 'teamlead', '{}'),
  ('LOS1', 'os', '{"osNickValue":"nick1"}'), ('LOS2', 'os', '{"osNickValue":"nick2"}'), ('LOS3', 'os', '{"osNickValue":"nick3"}'),
  ('LT1', 'manager', '{}'), ('LT2', 'manager', '{}')) v(u, r, x);
insert into public.core_docs (workspace_id, kind, parent_id, id, data) values
  ('WL', 'page', '', 'osdesk_LOS1', '{"id":"osdesk_LOS1","workspaceId":"WL","name":"Стол ОС","osDesk":true,"responsibleUserId":"LOS1","createdBy":"LOS1","allowedUsers":["LOS1"],"columns":[]}'),
  ('WL', 'page', '', 'page_LP_own', '{"id":"page_LP_own","workspaceId":"WL","name":"Свой стол Тимлид+","responsibleUserId":"LP","createdBy":"LP","allowedUsers":["LP"],"columns":[]}'),
  ('WL', 'page', '', 'page_LT_own', '{"id":"page_LT_own","workspaceId":"WL","name":"Свой стол Тимлида","responsibleUserId":"LT","createdBy":"LT","allowedUsers":["LT"],"columns":[]}');
insert into public.rows_page_acl (workspace_id, page_id, responsible_uid, created_by, os_desk, allowed_uids, editable_uids, os_keys_tab, os_key, os_status_key) values
  ('WL', 'osdesk_LOS2', 'LOS2', 'LOS2', true, '{LOS2}', '{}', null, null, null),
  ('WL', 'LP1', 'LT1', 'LT1', false, '{LT1}', '{}', '', 'os', 'status'),
  ('WL', 'LP2', 'LT2', 'LT2', false, '{LT2}', '{}', null, null, null)
on conflict (workspace_id, page_id) do update set responsible_uid = excluded.responsible_uid, created_by = excluded.created_by,
  os_desk = excluded.os_desk, allowed_uids = excluded.allowed_uids, os_keys_tab = excluded.os_keys_tab, os_key = excluded.os_key;
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at,
  os_uid, tech_uid, status_key, src_page_id, src_tab_id, src_row_id, mirror_page_id, mirror_tab_id, mirror_row_id) values
  ('WL', 'osdesk_LOS1', '', 's1', '{"client":"Аня","status":"approval","technician":"tn1","price":"100"}', 0, 1000, 1000,
   null, null, null, null, null, null, 'LP1', '', 'os_s1'),
  ('WL', 'LP1', '', 'os_s1', '{"client":"Аня","status":"approval","os":"nick1"}', 0, 1000, 1000,
   'LOS1', 'LT1', 'status', 'osdesk_LOS1', '', 's1', null, null, null),
  ('WL', 'LP1', '', 'own1', '{"client":"Своё"}', 1, 1000, 1000, null, null, null, null, null, null, null, null, null),
  ('WL', 'LP2', 'm', 'r9', '{"client":"Другой период"}', 0, 1000, 1000, null, null, null, null, null, null, null, null, null);
insert into public.personal_docs (workspace_id, kind, id, page_id, zone_uid, data)
values ('WL', 'note', 'pn1', 'LP1', 'LT1', '{"text":"личное"}');
delete from public.order_events where workspace_id = 'WL';

-- ---------------------------------------------------------------------
-- Роль и права на строки.
-- ---------------------------------------------------------------------
select tst.expect('роль leadplus принята копией прав', (select role from public.rows_members where workspace_id = 'WL' and uid = 'LP'), 'leadplus');
select tst.expect('кривая роль по-прежнему не принимается',
  tst.try('LO', $q$insert into rows_members (workspace_id, uid, role) values ('WL', 'ZZ', 'boss')$q$), 'error');
select tst.expect('Тимлид+ читает чужой стол технаря', tst.try('LP', $q$select * from desk_rows where workspace_id = 'WL' and page_id = 'LP1'$q$, true), 'ok:2');
select tst.expect('Тимлид без Технаря — по-прежнему только копии заказов ОС', tst.try('LT', $q$select * from desk_rows where workspace_id = 'WL' and page_id = 'LP1' and os_uid is null$q$, true), 'ok:0');
select tst.expect('Тимлид+ правит строку чужого стола', tst.try('LP', $q$select rows_patch('WL','LP1','','own1','{"price":"5"}'::jsonb)$q$), 'ok');
select tst.expect('Тимлид+ правит строку-заказ ОС целиком (не только статус)',
  tst.try('LP', $q$select rows_patch('WL','LP1','','os_s1','{"client":"Аня Б","status":"work"}'::jsonb)$q$), 'ok');
select tst.expect('Тимлид+ меняет опорные поля заказа', tst.try('LP', $q$update desk_rows set tech_uid = 'LT2' where workspace_id = 'WL' and id = 'os_s1'$q$), 'ok:1');
select tst.expect('Тимлид+ заводит строку на столе ОС',
  tst.try('LP', $q$select rows_patch('WL','osdesk_LOS1','','n1','{"client":"Новый"}'::jsonb)$q$), 'ok');
select tst.expect('Тимлид+ удаляет строку чужого стола', tst.try('LP', $q$delete from desk_rows where workspace_id = 'WL' and id = 'own1'$q$), 'ok:1');
select tst.expect('Тимлид (без +) строку-заказ целиком не правит',
  tst.try('LT', $q$select rows_patch('WL','LP1','','os_s1','{"client":"Взлом"}'::jsonb)$q$), 'error');
select tst.expect('личная зона чужого стола Тимлиду+ закрыта (чтение)', tst.try('LP', $q$select * from personal_docs where workspace_id = 'WL'$q$, true), 'ok:0');
select tst.expect('…и rows_personal_ok', tst.val('LP', $q$select rows_personal_ok('WL', 'LP1', 'LT1')::text$q$), 'false');
select tst.expect('Owner личную зону видит, как раньше', tst.try('LO', $q$select * from personal_docs where workspace_id = 'WL'$q$, true), 'ok:1');
select tst.expect('хозяин зоны видит свою', tst.try('LT1', $q$select * from personal_docs where workspace_id = 'WL'$q$, true), 'ok:1');
select tst.expect('Тимлид+ — руководство (набор lead)', tst.val('LP', $q$select ('WL' in (select rows_lead_workspaces()))::text$q$), 'true');

-- ---------------------------------------------------------------------
-- Участники и столы в core_write.
-- ---------------------------------------------------------------------
select tst.expect('Owner выдаёт роль Тимлид+',
  tst.try('LO', $q$select core_write('WL', '[{"kind":"member","id":"LT2","op":"merge","data":{"role":"leadplus"}}]'::jsonb)$q$), 'ok');
select tst.expect('Тимлид Тимлид+ не выдаёт',
  tst.val('LT', $q$select core_write('WL', '[{"kind":"member","id":"LT2","op":"merge","data":{"role":"leadplus"}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('Тимлид+ Тимлид+ не выдаёт',
  tst.val('LP', $q$select core_write('WL', '[{"kind":"member","id":"LT2","op":"merge","data":{"role":"leadplus"}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('Тимлид запись Тимлид+ не правит',
  tst.val('LT', $q$select core_write('WL', '[{"kind":"member","id":"LP","op":"merge","data":{"role":"viewer"}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('Тимлид Тимлид+ не убирает',
  tst.val('LT', $q$select core_write('WL', '[{"kind":"member","id":"LP","op":"delete"}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('Тимлид+ ведёт людей как Тимлид (технарь → ОС)',
  tst.try('LP', $q$select core_write('WL', '[{"kind":"member","id":"LT2","op":"merge","data":{"role":"os"}}]'::jsonb)$q$), 'ok');
select tst.expect('Тимлид+ себе роль не меняет',
  tst.val('LP', $q$select core_write('WL', '[{"kind":"member","id":"LP","op":"merge","data":{"role":"owner"}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('Тимлид не приглашает Тимлид+',
  tst.val('LT', $q$select core_write('WL', '[{"kind":"invite","id":"q@x.io","op":"set","data":{"email":"q@x.io","role":"leadplus","status":"invited"}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('Owner приглашает Тимлид+',
  tst.try('LO', $q$select core_write('WL', '[{"kind":"invite","id":"q@x.io","op":"set","data":{"email":"q@x.io","role":"leadplus","status":"invited"}}]'::jsonb)$q$), 'ok');
select tst.expect('копия прав Тимлиду: запись Тимлид+ не правится', tst.try('LT', $q$update rows_members set role = 'viewer' where workspace_id = 'WL' and uid = 'LP'$q$), 'deny');
select tst.expect('ник Тимлиду+ Тимлид не выдаёт',
  tst.val('LT', $q$select core_nick_link('WL', 'LP', 'other', '{"newNick":"Босс"}'::jsonb)::text$q$), 'error:42501');
select tst.expect('Owner — выдаёт',
  tst.val('LO', $q$select core_nick_link('WL', 'LP', 'other', '{"newNick":"Босс"}'::jsonb) ->> 'label'$q$), 'Босс');
select tst.expect('Тимлид+ ставит поля месячной вкладки чужому столу ОС',
  tst.try('LP', $q$select core_write('WL', '[{"kind":"page","id":"osdesk_LOS1","op":"merge","data":{"autoMonthKey":"2026-10","autoMonthSubPageId":"month-2026-10","defaultSubPageId":"month-2026-10","mainTabName":"Октябрь","mainTabMonthKey":"2026-10"}}]'::jsonb)$q$), 'ok');
select tst.expect('Тимлид (без +) — нет', tst.val('LT', $q$select core_write('WL', '[{"kind":"page","id":"osdesk_LOS1","op":"merge","data":{"autoMonthKey":"2026-10"}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('СВОЙ стол Тимлид+ правит как ответственный (столбцы)',
  tst.try('LP', $q$select core_write('WL', '[{"kind":"page","id":"page_LP_own","op":"merge","data":{"columns":[{"key":"x"}]}}]'::jsonb)$q$), 'ok');
select tst.expect('СВОЙ стол Тимлид правит как ответственный (столбцы)',
  tst.try('LT', $q$select core_write('WL', '[{"kind":"page","id":"page_LT_own","op":"merge","data":{"columns":[{"key":"x"}]}}]'::jsonb)$q$), 'ok');
select tst.expect('но опорные поля своего стола — нет',
  tst.val('LT', $q$select core_write('WL', '[{"kind":"page","id":"page_LT_own","op":"merge","data":{"osDesk":true}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('структуру чужого стола Тимлид+ не правит',
  tst.val('LP', $q$select core_write('WL', '[{"kind":"page","id":"osdesk_LOS1","op":"merge","data":{"columns":[{"key":"x"}]}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('Тимлид+ заводит вкладку на чужом столе ОС',
  tst.try('LP', $q$select core_write('WL', '[{"kind":"subpage","id":"month-2026-10","page":"osdesk_LOS1","op":"create","data":{"id":"month-2026-10","pageId":"osdesk_LOS1","workspaceId":"WL","name":"Октябрь"}}]'::jsonb)$q$), 'ok');
select tst.expect('Тимлид+ заводит стол ОС участнику-ОС',
  tst.try('LP', $q$select core_write('WL', '[{"kind":"page","id":"osdesk_LOS3","op":"create","data":{"id":"osdesk_LOS3","workspaceId":"WL","osDesk":true,"responsibleUserId":"LOS3","createdBy":"LOS3","allowedUsers":["LOS3"]}}]'::jsonb)$q$), 'ok');
select tst.expect('…но не технарю',
  tst.val('LP', $q$select core_write('WL', '[{"kind":"page","id":"osdesk_LT1","op":"create","data":{"id":"osdesk_LT1","workspaceId":"WL","osDesk":true,"responsibleUserId":"LT1","createdBy":"LT1","allowedUsers":["LT1"]}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('Тимлид стол ОС чужому не заводит',
  tst.val('LT', $q$select core_write('WL', '[{"kind":"page","id":"osdesk_LOS3","op":"create","data":{"id":"osdesk_LOS3","workspaceId":"WL","osDesk":true,"responsibleUserId":"LOS3","createdBy":"LOS3","allowedUsers":["LOS3"]}}]'::jsonb)::text$q$), 'error:42501');

-- ---------------------------------------------------------------------
-- Общая таблица.
-- ---------------------------------------------------------------------
select tst.expect('Owner: стол ОС + копия у технаря вне списка',
  tst.val('LO', $q$select (lead_board('WL', '[{"page":"osdesk_LOS1","tab":""}]'::jsonb, 0) ->> 'count')$q$), '2');
select tst.expect('копия отдана вместе со строками',
  tst.val('LO', $q$select string_agg(x ->> 'id', ',' order by x ->> 'id') from jsonb_array_elements(lead_board('WL', '[{"page":"osdesk_LOS1","tab":""}]'::jsonb, 0) -> 'rows') x$q$), 'os_s1,s1');
select tst.expect('стол ОС + стол технаря: копия не дублируется',
  tst.val('LP', $q$select (lead_board('WL', '[{"page":"osdesk_LOS1","tab":""},{"page":"LP1","tab":""}]'::jsonb, 0) ->> 'count')$q$), '3');
select tst.expect('вкладка другого периода не попадает',
  tst.val('LP', $q$select (lead_board('WL', '[{"page":"LP2","tab":""}]'::jsonb, 0) ->> 'count')$q$), '0');
select tst.expect('Тимлид общей таблицы не читает', tst.val('LT', $q$select lead_board('WL', '[]'::jsonb, 0)::text$q$), 'error:42501');
select tst.expect('ОС — нет', tst.val('LOS1', $q$select lead_board_head('WL', '[]'::jsonb)::text$q$), 'error:42501');
select tst.expect('технарь — нет', tst.val('LT1', $q$select lead_board_head('WL', '[]'::jsonb)::text$q$), 'error:42501');
select tst.expect('посторонний — нет', tst.val('X', $q$select lead_board_head('WL', '[]'::jsonb)::text$q$), 'error:42501');
select tst.expect('голова совпадает с головой выборки',
  tst.val('LP', $q$select ((lead_board('WL', '[{"page":"osdesk_LOS1","tab":""},{"page":"LP1","tab":""}]'::jsonb, 0) ->> 'ids')
    = (lead_board_head('WL', '[{"page":"osdesk_LOS1","tab":""},{"page":"LP1","tab":""}]'::jsonb) ->> 'ids'))::text$q$), 'true');
drop table if exists tst.lb_rev;
create table tst.lb_rev as select max(rev) as rev from public.desk_rows where workspace_id = 'WL';
grant usage on schema tst to anon;
grant select on tst.lb_rev to anon;
select tst.expect('дельта от головы — пусто',
  tst.val('LP', $q$select jsonb_array_length(lead_board('WL', '[{"page":"osdesk_LOS1","tab":""},{"page":"LP1","tab":""}]'::jsonb, (select rev from tst.lb_rev)) -> 'rows')::text$q$), '0');
select tst.run('LOS1', $q$select rows_patch('WL','osdesk_LOS1','','s1','{"phone":"+7 700"}'::jsonb)$q$);
select tst.expect('после правки — одна строка в дельте',
  tst.val('LP', $q$select jsonb_array_length(lead_board('WL', '[{"page":"osdesk_LOS1","tab":""},{"page":"LP1","tab":""}]'::jsonb, (select rev from tst.lb_rev)) -> 'rows')::text$q$), '1');
select tst.expect('больше 400 таблиц — отказ',
  tst.val('LP', format($q$select lead_board_head('WL', %L::jsonb)::text$q$, (select jsonb_agg(jsonb_build_object('page', 'p' || g, 'tab', '')) from generate_series(1, 401) g)::text)), 'error:22023');

-- ---------------------------------------------------------------------
-- История заказа.
-- ---------------------------------------------------------------------
delete from public.order_events where workspace_id = 'WL';
select tst.run('LOS1', $q$select rows_patch('WL','osdesk_LOS1','','s1','{"status":"work"}'::jsonb)$q$);
select tst.expect('статус ОС — одно событие (копия, которую довёз триггер, не дублирует)',
  (select count(*)::text || '|' || max(old_value) || '|' || max(new_value) || '|' || max(actor_uid) from public.order_events where workspace_id = 'WL' and kind = 'status'), '1|approval|work|LOS1');
select tst.expect('копия и правда получила статус', (select cells ->> 'status' from public.desk_rows where workspace_id = 'WL' and id = 'os_s1'), 'work');
select tst.run('LOS1', $q$select rows_patch('WL','osdesk_LOS1','','s1','{"technician":"tn2","price":"250","upsell":"50"}'::jsonb)$q$);
select tst.expect('смена технаря', (select old_value || '→' || new_value from public.order_events where workspace_id = 'WL' and kind = 'tech'), 'tn1→tn2');
select tst.expect('смена суммы и апсейла — два события', (select string_agg(field || ':' || coalesce(old_value, '-') || '→' || new_value, ',' order by field) from public.order_events where workspace_id = 'WL' and kind = 'amount'), 'price:100→250,upsell:-→50');
select tst.run('LO', $q$select rows_patch('WL','LP1','','os_s1','{"status":"done"}'::jsonb)$q$);
select tst.expect('статус у технаря — под ключом источника, поле tech',
  (select order_key || '|' || field || '|' || new_value from public.order_events where workspace_id = 'WL' and kind = 'status' and field = 'tech'), 's1|tech|done');
select tst.run('LOS1', $q$select rows_patch('WL','osdesk_LOS1','','slot1','{"client":""}'::jsonb)$q$);
select tst.expect('пустой слот — без события', (select count(*)::text from public.order_events where workspace_id = 'WL' and order_key = 'slot1'), '0');
select tst.run('LOS1', $q$select rows_patch('WL','osdesk_LOS1','','slot1','{"client":"Боря","status":"approval"}'::jsonb)$q$);
select tst.expect('слот заполнен — «заведён»', (select kind || '|' || new_value from public.order_events where workspace_id = 'WL' and order_key = 'slot1'), 'created|approval');
select tst.run('LOS1', $q$delete from desk_rows where workspace_id = 'WL' and id = 'slot1'$q$);
select tst.expect('удалён', (select count(*)::text from public.order_events where workspace_id = 'WL' and order_key = 'slot1' and kind = 'deleted'), '1');
select tst.run('LP', $q$select rows_patch('WL','osdesk_LOS1','','n1','{"client":"Новый"}'::jsonb)$q$);
select tst.expect('лид от Тимлид+ — «заведён», автор он', (select kind || '|' || actor_uid from public.order_events where workspace_id = 'WL' and order_key = 'n1'), 'created|LP');
update public.desk_rows set tab_id = 'month-2026-10' where workspace_id = 'WL' and page_id = 'osdesk_LOS1' and id = 'n1';
select tst.expect('перенос в новый период', (select old_value || '→' || new_value from public.order_events where workspace_id = 'WL' and order_key = 'n1' and kind = 'carried'), '→month-2026-10');
update public.desk_rows set mirror_row_id = null, mirror_page_id = null, mirror_tab_id = null where workspace_id = 'WL' and id = 'n1';
update public.desk_rows set mirror_page_id = 'LP1', mirror_tab_id = '', mirror_row_id = 'os_n1' where workspace_id = 'WL' and id = 'n1';
select tst.expect('выдан технарю', (select kind || '|' || new_value from public.order_events where workspace_id = 'WL' and order_key = 'n1' and kind = 'issued'), 'issued|LP1');
update public.desk_rows set sort_order = 99 where workspace_id = 'WL' and id = 'n1';
select tst.expect('порядок строк — без события', (select count(*)::text from public.order_events where workspace_id = 'WL' and order_key = 'n1'), '3');
select tst.expect('руководство читает историю (Тимлид)', tst.try('LT', $q$select * from order_events where workspace_id = 'WL'$q$, true), 'ok');
select tst.expect('Тимлид+ читает историю', tst.try('LP', $q$select * from order_events where workspace_id = 'WL'$q$, true), 'ok');
select tst.expect('технарь — нет', tst.try('LT1', $q$select * from order_events$q$, true), 'ok:0');
select tst.expect('ОС — нет', tst.try('LOS1', $q$select * from order_events$q$, true), 'ok:0');
select tst.expect('прямая запись в историю — отказ',
  tst.try('LO', $q$insert into order_events (workspace_id, order_key, page_id, row_id, kind, at) values ('WL','x','p','x','created',1)$q$), 'error');

-- ---------------------------------------------------------------------
-- Переезд к другому ОС.
-- ---------------------------------------------------------------------
select tst.expect('Тимлид не переназначает ОС',
  tst.val('LT', $q$select lead_move_os('WL','osdesk_LOS1','','s1','osdesk_LOS2','')::text$q$), 'error:42501');
select tst.expect('ОС не переназначает',
  tst.val('LOS1', $q$select lead_move_os('WL','osdesk_LOS1','','s1','osdesk_LOS2','')::text$q$), 'error:42501');
select tst.expect('на тот же стол — отказ',
  tst.val('LP', $q$select lead_move_os('WL','osdesk_LOS1','','s1','osdesk_LOS1','')::text$q$), 'error:22023');
select tst.expect('на стол технаря — отказ',
  tst.val('LP', $q$select lead_move_os('WL','osdesk_LOS1','','s1','LP1','')::text$q$), 'error:22023');
delete from public.order_events where workspace_id = 'WL';
select tst.expect('Тимлид+ переназначает',
  tst.val('LP', $q$select (lead_move_os('WL','osdesk_LOS1','','s1','osdesk_LOS2','') ->> 'osUid')$q$), 'LOS2');
select tst.expect('строка у нового ОС, у прежнего нет',
  (select string_agg(page_id, ',') from public.desk_rows where workspace_id = 'WL' and id = 's1'), 'osdesk_LOS2');
select tst.expect('содержимое переехало', (select cells ->> 'client' || '|' || mirror_row_id from public.desk_rows where workspace_id = 'WL' and id = 's1'), 'Аня|os_s1');
select tst.expect('копия переподписана на нового ОС с его ником',
  (select os_uid || '|' || src_page_id || '|' || (cells ->> 'os') from public.desk_rows where workspace_id = 'WL' and id = 'os_s1'), 'LOS2|osdesk_LOS2|nick2');
select tst.expect('в истории одно событие «os»',
  (select string_agg(kind || ':' || old_value || '→' || new_value || ':' || actor_uid, ',') from public.order_events where workspace_id = 'WL'), 'os:LOS1→LOS2:LP');
select tst.expect('переехавший заказ — в общей таблице нового ОС',
  tst.val('LP', $q$select (lead_board('WL', '[{"page":"osdesk_LOS2","tab":""}]'::jsonb, 0) ->> 'count')$q$), '2');
select tst.expect('нового ОС видит своя политика «мои заказы» (os_uid)', tst.try('LOS2', $q$select * from desk_rows where workspace_id = 'WL' and os_uid = 'LOS2'$q$, true), 'ok:1');
select tst.expect('заказа нет — понятный отказ',
  tst.val('LP', $q$select lead_move_os('WL','osdesk_LOS1','','nope','osdesk_LOS2','')::text$q$), 'error:P0002');

-- ---------------------------------------------------------------------
-- Повторный накат.
-- ---------------------------------------------------------------------
\ir ../migrations/20261036_leadplus.sql
select tst.expect('после повторного наката Тимлид+ читает', tst.try('LP', $q$select * from desk_rows where workspace_id = 'WL' and page_id = 'LP1'$q$, true), 'ok');
select tst.expect('версия схемы', (select public.nova_schema_version() >= '20261036')::text, 'true');

select label, got from tst.results where not ok;
select format('ПРОВЕРОК (Тимлид+): %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
