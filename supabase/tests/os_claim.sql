-- =====================================================================
-- 20261002_os_sync.sql, часть А: ОС сам забирает заказ, записанный
-- технарём с его ником в столбце ОС, и возвращает его; связка с частью Б
-- (статус со стола ОС доезжает до забранной строки). Запуск после
-- desk_rows_rls.sql (схема tst). Свой workspace WC:
--   CO — Owner; CT1, CT2 — технари (столы PC1, PC2); CTL — Тимлид;
--   COS1 «anna», COS2 «bella» — ОС со столами; COS3 — ОС без ника;
--   COS4 «dina» — ОС без стола ОС; CX — посторонний.
-- PC1: карта столбцов вкладки m9 опубликована (os_key = os, status).
-- PC2: карты нет (потом появится — со своим ключом статуса st2).
-- PC4: карта без ключа статуса.
-- Итог — строка «ПРОВЕРОК: N, ПРОВАЛЕНО: 0».
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;
truncate tst.results;

insert into public.rows_workspaces (workspace_id, owner_id, live) values ('WC', 'CO', true);
insert into public.rows_members (workspace_id, uid, role, extra_roles, os_nick_value) values
  ('WC', 'CO', 'owner', '{}', null),
  ('WC', 'CT1', 'manager', '{}', null),
  ('WC', 'CT2', 'manager', '{}', null),
  ('WC', 'CTL', 'teamlead', '{}', null),
  ('WC', 'COS1', 'os', '{}', 'anna'),
  ('WC', 'COS2', 'os', '{}', 'bella'),
  ('WC', 'COS3', 'os', '{}', null),
  ('WC', 'COS4', 'os', '{}', 'dina');
insert into public.rows_page_acl (workspace_id, page_id, responsible_uid, created_by, os_desk, allowed_uids, editable_uids) values
  ('WC', 'PC1', 'CT1', 'CT1', false, '{CT1}', '{}'),
  ('WC', 'PC2', 'CT2', 'CT2', false, '{CT2}', '{}'),
  ('WC', 'osdesk_COS1', 'COS1', 'COS1', true, '{COS1}', '{}'),
  ('WC', 'osdesk_COS2', 'COS2', 'COS2', true, '{COS2}', '{}'),
  ('WC', 'osdesk_COS3', 'COS3', 'COS3', true, '{COS3}', '{}');
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at, order_id) values
  ('WC', 'PC1', 'm9', 'c1', '{"client":"Клиент 1","os":"anna","price":"50000","status":"work"}', 0, 5000, 5000, null),
  ('WC', 'PC1', 'm9', 'c2', '{"client":"Клиент 2","os":"bella"}', 1, 1000, 1000, null),
  ('WC', 'PC1', 'm9', 'c3', '{"client":"С биржи","os":"anna"}', 2, 1000, 1000, 'ord-1'),
  ('WC', 'PC1', 'm9', 'c5', '{"client":"anna","os":""}', 3, 1000, 1000, null),
  ('WC', 'PC1', 'm9', 'c7', '{"client":"Клиент 7","os":" anna "}', 4, 1000, 1000, null),
  ('WC', 'PC1', 'm8', 'c6', '{"client":"Прошлый месяц","os":"anna"}', 0, 1000, 1000, null),
  ('WC', 'PC2', 'x1', 'd1', '{"client":"Без карты","os":"anna"}', 0, 1000, 1000, null),
  ('WC', 'osdesk_COS1', '', 'own1', '{"client":"Своё"}', 0, 1000, 1000, null);
-- Строка на столе ОС с id, который выведется для c7, но показывает на ДРУГУЮ копию.
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at,
    mirror_page_id, mirror_tab_id, mirror_row_id) values
  ('WC', 'osdesk_COS1', 'mo', 'adopt_c7', '{"client":"Чужой перенос"}', 5, 1000, 1000, 'PZ', 'q', 'c7');

-- --- Карта столбцов в копии прав: кто пишет ---------------------------
select tst.expect('ответственный пишет карту своего стола в копию',
  tst.try('CT1', $q$update rows_page_acl set os_keys_tab='m9', os_key='os', os_status_key='status' where workspace_id='WC' and page_id='PC1'$q$), 'ok:1');
select tst.expect('чужой технарь карту НЕ пишет',
  tst.try('CT2', $q$update rows_page_acl set os_key='client' where workspace_id='WC' and page_id='PC1'$q$), 'deny');
select tst.expect('ОС карту стола технаря НЕ пишет',
  tst.try('COS1', $q$update rows_page_acl set os_key='client' where workspace_id='WC' and page_id='PC1'$q$), 'deny');
select tst.expect('Тимлид карту пишет (как osFieldKeys в Firestore)',
  tst.try('CTL', $q$update rows_page_acl set os_key='os' where workspace_id='WC' and page_id='PC1'$q$), 'ok:1');
select tst.run('CT1', $q$update rows_page_acl set os_keys_tab='m9', os_key='os', os_status_key='status' where workspace_id='WC' and page_id='PC1'$q$);

-- --- Что можно забрать ------------------------------------------------
select tst.expect('ОС anna видит к забору ровно свои строки вкладки с картой (c1, c3 с биржи, c7)',
  tst.try('COS1', $q$select 1 from rows_os_claimable('WC') j where j->'row'->>'id' in ('c1','c3','c7')$q$, true), 'ok:3');
select tst.expect('…и ничего лишнего (клиент «anna», прошлая вкладка, стол без карты, чужой ник)',
  tst.try('COS1', $q$select 1 from rows_os_claimable('WC')$q$, true), 'ok:3');
select tst.expect('ОС bella видит свою строку c2',
  tst.try('COS2', $q$select 1 from rows_os_claimable('WC') j where j->'row'->>'id' = 'c2'$q$, true), 'ok:1');
select tst.expect('в ответе — ответственный стола и ключи',
  tst.try('COS1', $q$select 1 from rows_os_claimable('WC') j where j->>'techUid' = 'CT1' and j->>'osKey' = 'os' and j->>'statusKey' = 'status' and (j->'row'->>'rev') is not null$q$, true), 'ok:3');
select tst.expect('лимит соблюдается',
  tst.try('COS1', $q$select 1 from rows_os_claimable('WC', 1)$q$, true), 'ok:1');
select tst.expect('технарь (не ОС) ничего не видит к забору',
  tst.try('CT1', $q$select 1 from rows_os_claimable('WC')$q$, true), 'ok:0');
select tst.expect('ОС без ника ничего не видит',
  tst.try('COS3', $q$select 1 from rows_os_claimable('WC')$q$, true), 'ok:0');
select tst.expect('посторонний ничего не видит',
  tst.try('CX', $q$select 1 from rows_os_claimable('WC')$q$, true), 'ok:0');
select tst.expect('анонимный ключ ничего не видит',
  tst.try('__anon_key__', $q$select 1 from rows_os_claimable('WC')$q$, true), 'ok:0');

-- --- Кто может забирать ---------------------------------------------------
select tst.expect('технарь НЕ забирает (не ОС)',
  tst.try('CT1', $q$select rows_os_claim_order('WC','PC1','m9','c1',null,'','{"client":"x"}'::jsonb,null,'h')$q$), 'error');
select tst.expect('Тимлид НЕ забирает',
  tst.try('CTL', $q$select rows_os_claim_order('WC','PC1','m9','c1',null,'','{"client":"x"}'::jsonb,null,'h')$q$), 'error');
select tst.expect('посторонний НЕ забирает',
  tst.try('CX', $q$select rows_os_claim_order('WC','PC1','m9','c1',null,'','{"client":"x"}'::jsonb,null,'h')$q$), 'error');
select tst.expect('анонимный ключ НЕ забирает',
  tst.try('__anon_key__', $q$select rows_os_claim_order('WC','PC1','m9','c1',null,'','{"client":"x"}'::jsonb,null,'h')$q$), 'error');
select tst.expect('без подписи — отказ',
  tst.try('COS1', $q$select rows_os_claim_order('WC','PC1','m9','c1',null,'','{"client":"x"}'::jsonb,null,'')$q$), 'error');
select tst.expect('ячейки не объектом — отказ',
  tst.try('COS1', $q$select rows_os_claim_order('WC','PC1','m9','c1',null,'','[1]'::jsonb,null,'h')$q$), 'error');

-- Забрать от лица uid и ОСТАВИТЬ результат; ответ — весь jsonb.
create or replace function tst.oc_claim_json(uid text, pg text, tb text, rw text, rev bigint default null, stab text default '',
  cells jsonb default '{"client":"Клиент","technician":"tech1","osIssuedAt":"5000"}'::jsonb, skey text default null) returns jsonb
language plpgsql as $$
declare res jsonb;
begin
  perform set_config('request.jwt.claims', tst.claims(uid), true);
  execute 'set local role anon';
  execute format($f$select rows_os_claim_order('WC', %L, %L, %L, %s, %L, %L::jsonb, '{"persons":2}'::jsonb, 'H1', null, %L)$f$,
    pg, tb, rw, coalesce(rev::text, 'null'), stab, cells::text, skey) into res;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return res;
end;
$$;
create or replace function tst.oc_claim(uid text, pg text, tb text, rw text, rev bigint default null, stab text default '') returns text
language sql as $$ select tst.oc_claim_json(uid, pg, tb, rw, rev, stab) ->> 'status' $$;
grant usage on schema tst to anon;
grant execute on function tst.oc_claim_json(text, text, text, text, bigint, text, jsonb, text), tst.oc_claim(text, text, text, text, bigint, text) to anon;

select tst.expect('ОС без ника → no_nick', tst.oc_claim('COS3','PC1','m9','c1'), 'no_nick');
select tst.expect('ОС без стола ОС → no_os_desk', tst.oc_claim('COS4','PC1','m9','c1'), 'no_os_desk');
select tst.expect('чужой ник в столбце ОС → not_mine', tst.oc_claim('COS1','PC1','m9','c2'), 'not_mine');
select tst.expect('ник ОС в столбце КЛИЕНТА не даёт забрать → not_mine', tst.oc_claim('COS1','PC1','m9','c5'), 'not_mine');
select tst.expect('вкладка без карты → no_keys', tst.oc_claim('COS1','PC1','m8','c6'), 'no_keys');
select tst.expect('стол без карты → no_keys', tst.oc_claim('COS1','PC2','x1','d1'), 'no_keys');
select tst.expect('стол ОС → not_tech_desk', tst.oc_claim('COS1','osdesk_COS2','','x'), 'not_tech_desk');
select tst.expect('нет строки → gone', tst.oc_claim('COS1','PC1','m9','nope'), 'gone');
select tst.expect('строку поменяли после чтения (rev) → stale', tst.oc_claim('COS1','PC1','m9','c1', -5), 'stale');

-- --- Забрали ----------------------------------------------------------------
select tst.expect('ОС anna забирает c1 (rev сходится)',
  tst.oc_claim('COS1','PC1','m9','c1', (select rev from desk_rows where workspace_id='WC' and page_id='PC1' and tab_id='m9' and id='c1')), 'claimed');
select tst.expect('строка технаря помечена: os_uid, tech_uid, status_key, адрес источника, подпись',
  tst.try('CO', $q$select 1 from desk_rows where workspace_id='WC' and page_id='PC1' and tab_id='m9' and id='c1'
    and os_uid='COS1' and tech_uid='CT1' and status_key='status' and src_page_id='osdesk_COS1' and src_tab_id='' and src_row_id='adopt_c1' and sync_hash='H1'$q$, true), 'ok:1');
select tst.expect('ячейки технаря не тронуты',
  tst.try('CO', $q$select 1 from desk_rows where workspace_id='WC' and page_id='PC1' and id='c1' and cells = '{"client":"Клиент 1","os":"anna","price":"50000","status":"work"}'::jsonb$q$, true), 'ok:1');
select tst.expect('источник на столе ОС: ячейки, визитка, адрес копии, подсветка, дата заказа',
  tst.try('CO', $q$select 1 from desk_rows where workspace_id='WC' and page_id='osdesk_COS1' and tab_id='' and id='adopt_c1'
    and cells->>'technician' = 'tech1' and extras->>'persons' = '2' and mirror_page_id='PC1' and mirror_tab_id='m9' and mirror_row_id='c1'
    and highlight and sync_hash='H1' and created_at = 5000 and sort_order > 0 and status_key is null$q$, true), 'ok:1');
select tst.expect('повтор — already, без второго источника',
  tst.oc_claim('COS1','PC1','m9','c1'), 'already');
select tst.expect('already несёт адрес источника',
  (select case when j->>'srcPageId' = 'osdesk_COS1' and j->>'srcTabId' = '' and j->>'srcRowId' = 'adopt_c1' and j->>'techUid' = 'CT1'
    then 'yes' else j::text end from tst.oc_claim_json('COS1','PC1','m9','c1') j), 'yes');
select tst.expect('источник ровно один',
  tst.try('CO', $q$select 1 from desk_rows where workspace_id='WC' and page_id='osdesk_COS1' and mirror_row_id='c1' and mirror_page_id='PC1'$q$, true), 'ok:1');
select tst.expect('другой ОС → taken', tst.oc_claim('COS2','PC1','m9','c1'), 'taken');
select tst.expect('забранное больше не в списке к забору',
  tst.try('COS1', $q$select 1 from rows_os_claimable('WC') j where j->'row'->>'id' = 'c1'$q$, true), 'ok:0');
select tst.expect('ОС видит свой заказ через политику os_uid (useMyOrderRows)',
  tst.try('COS1', $q$select 1 from desk_rows where workspace_id='WC' and os_uid='COS1'$q$, true), 'ok:1');

-- id источника занят строкой с чужим адресом → хвост от адреса стола.
select tst.expect('c7 (ник с пробелами) забирается во вкладку mo',
  tst.oc_claim('COS1','PC1','m9','c7', null, 'mo'), 'claimed');
select tst.expect('чужая строка adopt_c7 не тронута',
  tst.try('CO', $q$select 1 from desk_rows where workspace_id='WC' and page_id='osdesk_COS1' and id='adopt_c7' and mirror_page_id='PZ' and cells->>'client'='Чужой перенос'$q$, true), 'ok:1');
select tst.expect('источник c7 — под id с хвостом',
  tst.try('CO', $q$select 1 from desk_rows d join desk_rows t on t.workspace_id='WC' and t.page_id='PC1' and t.id='c7'
    where d.workspace_id='WC' and d.page_id='osdesk_COS1' and d.tab_id='mo' and d.id = t.src_row_id and d.id like 'adopt\_c7\_%' and d.mirror_row_id='c7'$q$, true), 'ok:1');

-- --- После забора: кто что правит (режимы) ----------------------------------
select tst.run('CO', $q$select rows_set_desk_mode('WC', 'mixed')$q$);
select tst.expect('mixed: технарь НЕ меняет цену забранной строки',
  tst.try('CT1', $q$select rows_patch('WC','PC1','m9','c1','{"price":"1"}'::jsonb)$q$), 'error');
select tst.expect('mixed: технарь пишет ссылку на работу',
  tst.try('CT1', $q$select rows_patch('WC','PC1','m9','c1','{"techLink":"https://x"}'::jsonb)$q$), 'ok');
select tst.expect('mixed: технарь НЕ удаляет забранную строку',
  tst.try('CT1', $q$delete from desk_rows where workspace_id='WC' and page_id='PC1' and tab_id='m9' and id='c1'$q$), 'deny');
select tst.expect('ОС правит статус своей строки',
  tst.try('COS1', $q$select rows_patch('WC','PC1','m9','c1','{"status":"paid"}'::jsonb)$q$), 'ok');
select tst.expect('Тимлид ставит «Успешку» (status_key из карты)',
  tst.try('CTL', $q$select rows_patch('WC','PC1','m9','c1','{"status":"success"}'::jsonb)$q$), 'ok');
select tst.expect('ОС НЕ меняет tech_uid/адрес (опорные поля — Owner)',
  tst.try('COS1', $q$update desk_rows set tech_uid='CT2' where workspace_id='WC' and page_id='PC1' and tab_id='m9' and id='c1'$q$), 'error');
select tst.run('CO', $q$select rows_set_desk_mode('WC', 'tech')$q$);
select tst.expect('tech: технарь меняет цену забранной строки',
  tst.try('CT1', $q$select rows_patch('WC','PC1','m9','c1','{"price":"60000"}'::jsonb)$q$), 'ok');
select tst.expect('tech: технарь НЕ снимает метку ОС',
  tst.try('CT1', $q$update desk_rows set os_uid=null where workspace_id='WC' and page_id='PC1' and tab_id='m9' and id='c1'$q$), 'error');
select tst.run('CO', $q$select rows_set_desk_mode('WC', 'os')$q$);
select tst.expect('os: забор работает и под «заказы ведёт ОС» (c2 ОС bella)',
  tst.oc_claim('COS2','PC1','m9','c2'), 'claimed');

-- --- Связка с частью Б: статус со стола ОС доезжает до забранной строки ----
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at) values
  ('WC', 'PC1', 'm9', 'c10', '{"client":"Клиент 10","os":"anna","status":"work"}', 10, 1000, 1000);
create table tst.oc_rev as select rev from desk_rows where workspace_id='WC' and page_id='PC1' and tab_id='m9' and id='c10';
grant select on tst.oc_rev to anon;
select tst.expect('забор c10: статус технаря уходит в источник (клиент кладёт его сам)',
  tst.oc_claim_json('COS1','PC1','m9','c10', null, '', '{"client":"Клиент 10","status":"work","osStatusSent":"work","technician":"tech1"}'::jsonb) ->> 'status', 'claimed');
select tst.expect('забор не шлёт статус назад и не трогает ячейки технаря',
  tst.try('CO', $q$select 1 from desk_rows where workspace_id='WC' and page_id='PC1' and id='c10' and cells = '{"client":"Клиент 10","os":"anna","status":"work"}'::jsonb$q$, true), 'ok:1');
create table tst.oc_rev2 as select rev from desk_rows where workspace_id='WC' and page_id='PC1' and tab_id='m9' and id='c10';
grant select on tst.oc_rev2 to anon;
select tst.run('COS1', $q$select rows_patch('WC','osdesk_COS1','','adopt_c10','{"status":"paid"}'::jsonb)$q$);
select tst.expect('ОС меняет статус у себя — технарь видит его в забранной строке',
  tst.try('CT1', $q$select 1 from desk_rows where workspace_id='WC' and page_id='PC1' and tab_id='m9' and id='c10' and cells->>'status'='paid'$q$, true), 'ok:1');
select tst.expect('…rev забранной строки вырос (стол технаря дочитает её)',
  tst.try('CO', $q$select 1 from desk_rows where workspace_id='WC' and page_id='PC1' and id='c10' and rev > (select rev from tst.oc_rev2) and rev > (select rev from tst.oc_rev)$q$, true), 'ok:1');
select tst.expect('…на источнике osStatusSent = paid',
  tst.try('COS1', $q$select 1 from desk_rows where workspace_id='WC' and page_id='osdesk_COS1' and id='adopt_c10' and cells->>'osStatusSent'='paid'$q$, true), 'ok:1');

-- Свой ключ статуса у стола ОС (p_src_status_key) и у стола технаря (st2).
select tst.run('CT2', $q$update rows_page_acl set os_keys_tab='x1', os_key='os', os_status_key='st2' where workspace_id='WC' and page_id='PC2'$q$);
select tst.expect('стол со своим ключом статуса: d1 забирается с ключом «Статуса» стола ОС',
  tst.oc_claim_json('COS1','PC2','x1','d1', null, '', '{"client":"Без карты","ost":"new","osStatusSent":"new"}'::jsonb, 'ost') ->> 'status', 'claimed');
select tst.expect('…у источника status_key = ost, у строки технаря status_key = st2',
  tst.try('CO', $q$select 1 from desk_rows s join desk_rows t on t.workspace_id='WC' and t.page_id='PC2' and t.id='d1'
    where s.workspace_id='WC' and s.page_id='osdesk_COS1' and s.id = t.src_row_id and s.status_key='ost' and t.status_key='st2'$q$, true), 'ok:1');
select tst.run('COS1', $q$select rows_patch('WC','osdesk_COS1','','adopt_d1','{"ost":"paid2"}'::jsonb)$q$);
select tst.expect('…статус ОС (ost) доезжает в st2 технаря',
  tst.try('CT2', $q$select 1 from desk_rows where workspace_id='WC' and page_id='PC2' and id='d1' and cells->>'st2'='paid2' and cells->>'ost' is null$q$, true), 'ok:1');

-- Стол с картой без ключа статуса: такую строку не берём.
insert into public.rows_page_acl (workspace_id, page_id, responsible_uid, created_by, os_desk, allowed_uids, editable_uids, os_keys_tab, os_key, os_status_key) values
  ('WC', 'PC4', 'CT1', 'CT1', false, '{CT1}', '{}', 'k', 'os', null);
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at) values
  ('WC', 'PC4', 'k', 'e1', '{"client":"Без статуса","os":"anna"}', 0, 1000, 1000);
select tst.expect('карта без ключа статуса → не в списке к забору',
  tst.try('COS1', $q$select 1 from rows_os_claimable('WC') j where j->'row'->>'id' = 'e1'$q$, true), 'ok:0');
select tst.expect('карта без ключа статуса → no_keys', tst.oc_claim('COS1','PC4','k','e1'), 'no_keys');

-- --- «Вернуть» Owner не отменяется опросом ОС -------------------------------
-- Копия, выданная ОС со своего стола (id os_…) и возвращённая Owner технарю.
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at) values
  ('WC', 'PC1', 'm9', 'os_z1', '{"client":"Возвращённая копия","os":"anna","status":"work"}', 11, 1000, 1000),
  ('WC', 'PC1', 'm9', 'c12', '{"client":"Возвращённый перенос","os":"anna"}', 12, 1000, 1000),
  ('WC', 'PC1', 'm9', 'c13', '{"client":"Клиент 13","os":"anna"}', 13, 1000, 1000);
-- Источник c12 помечен «вернули технарю» (releaseDeskOrders: osLostFor, адреса нет) — в ДРУГОЙ вкладке.
-- Источник c13 — без адреса и без пометки, в другой вкладке (копию когда-то сняли).
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at) values
  ('WC', 'osdesk_COS1', 'old', 'adopt_c12', '{"client":"Возвращённый перенос","osLostFor":"tech1"}', 0, 1000, 1000),
  ('WC', 'osdesk_COS1', 'old', 'adopt_c13', '{"client":"Старый источник","note":"моя заметка"}', 1, 1000, 1000);
select tst.expect('копия os_… не в списке к забору',
  tst.try('COS1', $q$select 1 from rows_os_claimable('WC') j where j->'row'->>'id' = 'os_z1'$q$, true), 'ok:0');
select tst.expect('копия os_… → released', tst.oc_claim('COS1','PC1','m9','os_z1'), 'released');
select tst.expect('строка с источником «вернули технарю» не в списке к забору',
  tst.try('COS1', $q$select 1 from rows_os_claimable('WC') j where j->'row'->>'id' = 'c12'$q$, true), 'ok:0');
select tst.expect('строка с источником «вернули технарю» → released', tst.oc_claim('COS1','PC1','m9','c12'), 'released');
select tst.expect('…и осталась ничьей',
  tst.try('CO', $q$select 1 from desk_rows where workspace_id='WC' and page_id='PC1' and id in ('os_z1','c12') and os_uid is null$q$, true), 'ok:2');
select tst.expect('строка с прежним источником без пометки — в списке к забору',
  tst.try('COS1', $q$select 1 from rows_os_claimable('WC') j where j->'row'->>'id' = 'c13'$q$, true), 'ok:1');
select tst.expect('забор c13 возвращает ПРЕЖНИЙ источник из другой вкладки',
  (select case when j->>'status' = 'claimed' and j->>'srcTabId' = 'old' and j->>'srcRowId' = 'adopt_c13' then 'yes' else j::text end
   from tst.oc_claim_json('COS1','PC1','m9','c13', null, '') j), 'yes');
select tst.expect('…второго источника нет, своя заметка ОС на месте, адрес — на c13',
  tst.try('CO', $q$select 1 from desk_rows where workspace_id='WC' and page_id='osdesk_COS1' and id='adopt_c13'
    and tab_id='old' and mirror_row_id='c13' and cells->>'note'='моя заметка' and cells->>'client'='Клиент'$q$, true), 'ok:1');
select tst.expect('…строка технаря показывает на эту вкладку',
  tst.try('CO', $q$select 1 from desk_rows where workspace_id='WC' and page_id='PC1' and id='c13' and src_tab_id='old' and src_row_id='adopt_c13'$q$, true), 'ok:1');

-- Пометка на САМОЙ строке технаря: «Вернуть» Owner пишет osReleasedFrom = ник ОС.
-- Она не зависит от источника на столе ОС (его ОС может удалить или выдать заново).
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at) values
  ('WC', 'PC1', 'm9', 'c21', '{"client":"Вернул Owner","os":"anna","osReleasedFrom":" anna "}', 21, 1000, 1000),
  ('WC', 'PC1', 'm9', 'c22', '{"client":"Вернули от anna, теперь bella","os":"bella","osReleasedFrom":"anna"}', 22, 1000, 1000);
select tst.expect('osReleasedFrom = мой ник (с пробелами) → не в списке к забору',
  tst.try('COS1', $q$select 1 from rows_os_claimable('WC') j where j->'row'->>'id' = 'c21'$q$, true), 'ok:0');
select tst.expect('osReleasedFrom = мой ник → released', tst.oc_claim('COS1','PC1','m9','c21'), 'released');
select tst.expect('…строка осталась ничьей, источника у неё нет',
  tst.try('CO', $q$select 1 where exists (select 1 from desk_rows where workspace_id='WC' and page_id='PC1' and id='c21' and os_uid is null)
    and not exists (select 1 from desk_rows where workspace_id='WC' and page_id='osdesk_COS1' and id like 'adopt\_c21%')$q$, true), 'ok:1');
select tst.expect('пометка с ником anna не мешает ОС bella, которого технарь поставил потом',
  tst.try('COS2', $q$select 1 from rows_os_claimable('WC') j where j->'row'->>'id' = 'c22'$q$, true), 'ok:1');
select tst.expect('…bella забирает c22', tst.oc_claim('COS2','PC1','m9','c22'), 'claimed');
-- «Передать ОС» стирает пометку — строка снова забирается.
select tst.run('CO', $q$select rows_patch('WC','PC1','m9','c21','{"osReleasedFrom":""}'::jsonb)$q$);
select tst.expect('пометку стёрли («Передать ОС») — c21 снова в списке к забору',
  tst.try('COS1', $q$select 1 from rows_os_claimable('WC') j where j->'row'->>'id' = 'c21'$q$, true), 'ok:1');
select tst.expect('…и забирается', tst.oc_claim('COS1','PC1','m9','c21'), 'claimed');

-- Источник уже выдан заново самим ОС (адрес копии os_<id источника>): «Вернуть»
-- прежним клиентом (без osReleasedFrom), потом «Выдать заново» технарю PC2.
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at) values
  ('WC', 'PC1', 'm9', 'c23', '{"client":"Выдан заново","os":"anna"}', 23, 1000, 1000);
select tst.expect('c23 забирается', tst.oc_claim('COS1','PC1','m9','c23'), 'claimed');
select tst.run('CO', $q$update desk_rows set os_uid=null, tech_uid=null, status_key=null, src_page_id=null, src_tab_id=null, src_row_id=null, sync_hash=null
  where workspace_id='WC' and page_id='PC1' and tab_id='m9' and id='c23'$q$);
select tst.run('COS1', $q$update desk_rows set mirror_page_id=null, mirror_tab_id=null, mirror_row_id=null, cells = cells || '{"osLostFor":"tech1"}'::jsonb
  where workspace_id='WC' and page_id='osdesk_COS1' and id='adopt_c23'$q$);
select tst.expect('после «Вернуть» c23 → released (источник с пометкой osLostFor)', tst.oc_claim('COS1','PC1','m9','c23'), 'released');
select tst.run('COS1', $q$insert into desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at,
    os_uid, tech_uid, status_key, src_page_id, src_tab_id, src_row_id)
  values ('WC','PC2','x1','os_adopt_c23','{"client":"Выдан заново"}',5,1000,1000,'COS1','CT2','st2','osdesk_COS1','','adopt_c23')$q$);
select tst.run('COS1', $q$update desk_rows set mirror_page_id='PC2', mirror_tab_id='x1', mirror_row_id='os_adopt_c23', cells = cells - 'osLostFor'
  where workspace_id='WC' and page_id='osdesk_COS1' and id='adopt_c23'$q$);
select tst.expect('источник выдан заново самим ОС → строка технаря не в списке к забору',
  tst.try('COS1', $q$select 1 from rows_os_claimable('WC') j where j->'row'->>'id' = 'c23'$q$, true), 'ok:0');
select tst.expect('…и не забирается вторым источником с хвостом → released', tst.oc_claim('COS1','PC1','m9','c23'), 'released');
select tst.expect('…источник у заказа один, строка технаря ничья',
  tst.try('CO', $q$select 1 where exists (select 1 from desk_rows where workspace_id='WC' and page_id='PC1' and id='c23' and os_uid is null)
    and (select count(*) from desk_rows where workspace_id='WC' and page_id='osdesk_COS1' and id like 'adopt\_c23%') = 1$q$, true), 'ok:1');

-- --- Вернуть технарю ----------------------------------------------------------
select tst.expect('чужой ОС НЕ возвращает',
  tst.try('COS2', $q$select rows_os_release_claim('WC','PC1','m9','c1')$q$), 'error');
select tst.expect('технарь НЕ возвращает (RPC)',
  tst.try('CT1', $q$select rows_os_release_claim('WC','PC1','m9','c1')$q$), 'error');
select tst.expect('ОС НЕ снимает метку обычной правкой (политика)',
  tst.try('COS1', $q$select rows_patch(p_workspace => 'WC', p_page => 'PC1', p_tab => 'm9', p_id => 'c1', p_release_order => true)$q$), 'error');
select tst.expect('ОС НЕ снимает метку прямым UPDATE',
  tst.try('COS1', $q$update desk_rows set os_uid=null, tech_uid=null, status_key=null, src_page_id=null, src_tab_id=null, src_row_id=null
    where workspace_id='WC' and page_id='PC1' and tab_id='m9' and id='c1'$q$), 'error');
-- Заказ, заведённый самим ОС (источник не adopt_), «вернуть» нельзя.
select tst.run('COS1', $q$insert into desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at, os_uid, tech_uid, status_key, src_page_id, src_row_id)
  values ('WC','PC1','m9','os_own1','{"client":"Выдал ОС"}',9,1000,1000,'COS1','CT1','status','osdesk_COS1','own1')$q$);
select tst.expect('заказ, выданный самим ОС, — not_claimed',
  tst.try('COS1', $q$select 1 from rows_os_release_claim('WC','PC1','m9','os_own1') j where j->>'status' = 'not_claimed'$q$, true), 'ok:1');
-- Не-ОС не узнаёт через возврат, есть ли строка: роль проверяется до выборки.
select tst.expect('технарь: нет строки — тоже отказ 42501 (не gone)',
  tst.try('CT1', $q$select rows_os_release_claim('WC','PC1','m9','nope')$q$), 'deny:42501');
select tst.expect('технарь: строка чужого стола — тот же отказ 42501',
  tst.try('CT2', $q$select rows_os_release_claim('WC','PC1','m9','c1')$q$), 'deny:42501');
select tst.expect('Тимлид: нет строки — отказ 42501',
  tst.try('CTL', $q$select rows_os_release_claim('WC','PC1','m9','nope')$q$), 'deny:42501');
select tst.expect('посторонний: нет строки — отказ 42501',
  tst.try('CX', $q$select rows_os_release_claim('WC','PC1','m9','nope')$q$), 'deny:42501');
select tst.expect('посторонний: есть строка — тот же отказ 42501',
  tst.try('CX', $q$select rows_os_release_claim('WC','PC1','m9','c1')$q$), 'deny:42501');
select tst.expect('ОС: нет строки → gone, как раньше',
  tst.try('COS1', $q$select 1 from rows_os_release_claim('WC','PC1','m9','nope') j where j->>'status' = 'gone'$q$, true), 'ok:1');

-- Переезд забранного заказа: ОС сменил технаря — строка c20 технаря PC1 удалена,
-- у технаря PC2 заведена копия os_adopt_c20 (id выведен из источника adopt_c20).
-- Потом ОС удалил заказ у себя: копию надо удалить, а не отдать технарю PC2
-- как его собственный заказ с ценой.
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at) values
  ('WC', 'PC1', 'm9', 'c20', '{"client":"Переезд","os":"anna","price":"100"}', 20, 1000, 1000);
select tst.expect('c20 забирается', tst.oc_claim('COS1','PC1','m9','c20'), 'claimed');
select tst.run('COS1', $q$delete from desk_rows where workspace_id='WC' and page_id='PC1' and tab_id='m9' and id='c20'$q$);
select tst.run('COS1', $q$insert into desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at,
    os_uid, tech_uid, status_key, src_page_id, src_tab_id, src_row_id)
  values ('WC','PC2','x1','os_adopt_c20','{"client":"Переезд","os":"anna","price":"100"}',6,1000,1000,'COS1','CT2','st2','osdesk_COS1','','adopt_c20')$q$);
select tst.run('COS1', $q$update desk_rows set mirror_page_id='PC2', mirror_tab_id='x1', mirror_row_id='os_adopt_c20'
  where workspace_id='WC' and page_id='osdesk_COS1' and id='adopt_c20'$q$);
select tst.expect('копия os_adopt_… (её завёл ОС при переезде) → not_claimed',
  tst.try('COS1', $q$select 1 from rows_os_release_claim('WC','PC2','x1','os_adopt_c20') j where j->>'status' = 'not_claimed'$q$, true), 'ok:1');
select tst.run('COS1', $q$select rows_os_release_claim('WC','PC2','x1','os_adopt_c20')$q$);
select tst.expect('…копия осталась заказом ОС: метка, адрес и ник ОС на месте',
  tst.try('CO', $q$select 1 from desk_rows where workspace_id='WC' and page_id='PC2' and id='os_adopt_c20'
    and os_uid='COS1' and tech_uid='CT2' and src_row_id='adopt_c20' and cells->>'os'='anna'$q$, true), 'ok:1');
select tst.expect('…и ОС удаляет её как свою копию',
  tst.try('COS1', $q$delete from desk_rows where workspace_id='WC' and page_id='PC2' and tab_id='x1' and id='os_adopt_c20'$q$), 'ok:1');
select tst.expect('ОС anna возвращает c1 и стирает свой ник',
  tst.try('COS1', $q$select 1 from rows_os_release_claim('WC','PC1','m9','c1') j where j->>'status' = 'released' and (j->>'clearedOs')::boolean$q$, true), 'ok:1');
select tst.run('COS1', $q$select rows_os_release_claim('WC','PC1','m9','c1')$q$);
select tst.expect('после возврата: метки нет, ник ОС стёрт, остальное на месте',
  tst.try('CO', $q$select 1 from desk_rows where workspace_id='WC' and page_id='PC1' and tab_id='m9' and id='c1'
    and os_uid is null and tech_uid is null and src_row_id is null and sync_hash is null and cells->>'os' = '' and cells->>'client' = 'Клиент 1' and cells->>'price' = '50000'$q$, true), 'ok:1');
select tst.expect('возвращённое не забирается снова (ника нет)',
  tst.try('COS1', $q$select 1 from rows_os_claimable('WC') j where j->'row'->>'id' = 'c1'$q$, true), 'ok:0');
select tst.run('CO', $q$select rows_set_desk_mode('WC', 'mixed')$q$);
select tst.expect('mixed: после возврата технарь снова правит цену',
  tst.try('CT1', $q$select rows_patch('WC','PC1','m9','c1','{"price":"70000"}'::jsonb)$q$), 'ok');
select tst.expect('возврат без стирания ника (технарь сменил ОС) — ник остаётся',
  tst.try('COS2', $q$select 1 from rows_os_release_claim('WC','PC1','m9','c2', false) j where j->>'status' = 'released' and not (j->>'clearedOs')::boolean$q$, true), 'ok:1');
-- Связка с частью Б: возвращённая строка статус ОС больше не получает.
select tst.run('COS1', $q$select rows_os_release_claim('WC','PC1','m9','c10')$q$);
select tst.expect('после возврата правка статуса на источнике ОС проходит',
  tst.try('COS1', $q$select rows_patch('WC','osdesk_COS1','','adopt_c10','{"status":"after"}'::jsonb)$q$), 'ok:1');
select tst.run('COS1', $q$select rows_patch('WC','osdesk_COS1','','adopt_c10','{"status":"after"}'::jsonb)$q$);
select tst.expect('…и до технаря НЕ доходит',
  tst.try('CT1', $q$select 1 from desk_rows where workspace_id='WC' and page_id='PC1' and id='c10' and cells->>'status'='paid' and os_uid is null$q$, true), 'ok:1');
select tst.expect('…osStatusSent на источнике прежний',
  tst.try('COS1', $q$select 1 from desk_rows where workspace_id='WC' and page_id='osdesk_COS1' and id='adopt_c10' and cells->>'osStatusSent'='paid'$q$, true), 'ok:1');

-- Страж: ветка возврата не пускает ничего, кроме снятия метки (проверка
-- прямо на триггере — от лица ОС без RLS, как если бы политику ослабили).
create or replace function tst.oc_guarded(uid text, sql text) returns text language plpgsql as $$
declare res text; n bigint;
begin
  begin
    perform set_config('request.jwt.claims', tst.claims(uid), true);
    execute sql;
    get diagnostics n = row_count;
    res := 'ok:' || n;
    raise exception using errcode = 'P0001', message = '__rollback__';
  exception when others then
    if sqlerrm <> '__rollback__' then res := 'deny:' || sqlstate; end if;
  end;
  perform set_config('request.jwt.claims', '', true);
  return res;
end;
$$;
select tst.expect('страж: при снятии метки чужую ячейку не поменять',
  tst.oc_guarded('COS1', $q$update desk_rows set os_uid=null, tech_uid=null, status_key=null, src_page_id=null, src_tab_id=null, src_row_id=null,
    cells = cells || '{"price":"1"}'::jsonb where workspace_id='WC' and page_id='PC1' and tab_id='m9' and id='c7'$q$), 'error');
select tst.run('CO', $q$update desk_rows set os_uid='COS2', tech_uid='CT1', status_key='status', src_page_id='osdesk_COS2', src_tab_id='', src_row_id='adopt_c2x'
  where workspace_id='WC' and page_id='PC1' and tab_id='m9' and id='c2'$q$);
select tst.expect('страж: при снятии метки tech_uid не оставить',
  tst.oc_guarded('COS2', $q$update desk_rows set os_uid=null where workspace_id='WC' and page_id='PC1' and tab_id='m9' and id='c2'$q$), 'error');
select tst.expect('страж: при снятии метки визитку не поменять',
  tst.oc_guarded('COS2', $q$update desk_rows set os_uid=null, tech_uid=null, status_key=null, src_page_id=null, src_tab_id=null, src_row_id=null,
    extras='{"x":1}'::jsonb where workspace_id='WC' and page_id='PC1' and tab_id='m9' and id='c2'$q$), 'error');
select tst.expect('страж: стереть ник и заодно поменять цену — нельзя',
  tst.oc_guarded('COS2', $q$update desk_rows set os_uid=null, tech_uid=null, status_key=null, src_page_id=null, src_tab_id=null, src_row_id=null,
    cells = cells || '{"os":"","price":"1"}'::jsonb where workspace_id='WC' and page_id='PC1' and tab_id='m9' and id='c2'$q$), 'error');
select tst.expect('страж: стереть свой ник ОС при снятии метки можно',
  tst.oc_guarded('COS2', $q$update desk_rows set os_uid=null, tech_uid=null, status_key=null, src_page_id=null, src_tab_id=null, src_row_id=null,
    cells = cells || '{"os":""}'::jsonb where workspace_id='WC' and page_id='PC1' and tab_id='m9' and id='c2'$q$), 'ok');
select tst.expect('страж: чужой ОС метку не снимает',
  tst.oc_guarded('COS1', $q$update desk_rows set os_uid=null, tech_uid=null, status_key=null, src_page_id=null, src_tab_id=null, src_row_id=null
    where workspace_id='WC' and page_id='PC1' and tab_id='m9' and id='c2'$q$), 'error');
select tst.expect('страж: Owner снимает метку как раньше («Вернуть»)',
  tst.oc_guarded('CO', $q$update desk_rows set os_uid=null, tech_uid=null, status_key=null, src_page_id=null, src_tab_id=null, src_row_id=null
    where workspace_id='WC' and page_id='PC1' and tab_id='m9' and id='c2'$q$), 'ok');

-- Хранилище неживое — никто не забирает и не возвращает.
select tst.run('CO', $q$select rows_set_state('WC', false, false)$q$);
select tst.expect('неживое хранилище: забор — отказ',
  tst.try('COS1', $q$select rows_os_claim_order('WC','PC1','m9','c1',null,'','{"client":"x"}'::jsonb,null,'h')$q$), 'error');
select tst.expect('неживое хранилище: возврат — отказ',
  tst.try('COS1', $q$select rows_os_release_claim('WC','PC1','m9','c13')$q$), 'error');
select tst.expect('неживое хранилище: список к забору пуст',
  tst.try('COS1', $q$select 1 from rows_os_claimable('WC')$q$, true), 'ok:0');
select tst.run('CO', $q$select rows_set_state('WC', true, false)$q$);

-- --- Строка с биржи (20261004): забирается, как вписанная руками ---------
select tst.expect('строка с биржи c3 → claimed (20261004)', tst.oc_claim('COS1','PC1','m9','c3'), 'claimed');
select tst.expect('у строки с биржи метка ОС и адрес источника, order_id на месте',
  tst.try('CO', $q$select 1 from desk_rows where workspace_id='WC' and page_id='PC1' and tab_id='m9' and id='c3'
    and os_uid='COS1' and src_page_id='osdesk_COS1' and src_row_id='adopt_c3' and order_id='ord-1'$q$, true), 'ok:1');
select tst.expect('источник строки с биржи лёг на стол ОС и показывает на неё',
  tst.try('CO', $q$select 1 from desk_rows where workspace_id='WC' and page_id='osdesk_COS1' and id='adopt_c3'
    and mirror_page_id='PC1' and mirror_tab_id='m9' and mirror_row_id='c3'$q$, true), 'ok:1');
select tst.expect('ОС удаляет заказ с биржи — строка технаря и источник уходят вместе',
  tst.try('COS1', $q$select 1 where rows_drop_order_row('WC','PC1','m9','c3','ord-1')$q$, true), 'ok:1');
select tst.run('COS1', $q$select rows_drop_order_row('WC','PC1','m9','c3','ord-1')$q$);
select tst.expect('…строки технаря нет',
  tst.try('CO', $q$select 1 from desk_rows where workspace_id='WC' and page_id='PC1' and id='c3'$q$, true), 'ok:0');
select tst.expect('…источника на столе ОС нет',
  tst.try('CO', $q$select 1 from desk_rows where workspace_id='WC' and page_id='osdesk_COS1' and id='adopt_c3'$q$, true), 'ok:0');

-- Повторный накат файлов.
\ir ../migrations/20261002_os_sync.sql
\ir ../migrations/20261004_exchange_claim.sql
\ir ../migrations/20261007_carry_over.sql
select tst.expect('после повторного наката карта в копии на месте',
  tst.try('CT1', $q$select 1 from rows_page_acl where workspace_id='WC' and page_id='PC1' and os_key='os' and os_keys_tab='m9' and os_status_key='status'$q$, true), 'ok:1');
select tst.expect('после повторного наката ровно одна rows_os_claim_order',
  tst.try('CO', $q$select 1 from pg_proc where proname = 'rows_os_claim_order'$q$, true), 'ok:1');
select tst.expect('триггер замка ровно один',
  tst.try('CO', $q$select 1 from pg_trigger where tgrelid = 'public.desk_rows'::regclass and tgname = 'desk_rows_guard'$q$, true), 'ok:1');
select tst.expect('после повторного наката ветка возврата на месте',
  tst.try('COS1', $q$select 1 from rows_os_release_claim('WC','PC1','m9','c13') j where j->>'status' = 'released'$q$, true), 'ok:1');

select case when ok then '  OK  ' else 'FAIL  ' end || label || case when ok then '' else '  → ' || got end
from tst.results order by n;
select format('ПРОВЕРОК (забор ОС): %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
