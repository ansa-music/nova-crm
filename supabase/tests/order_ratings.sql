-- =====================================================================
-- 20261005_order_ratings.sql: одна оценка за заказ, 1–10. Запуск после
-- desk_rows_rls.sql (схема tst) и всех миграций. Свой workspace WR:
--   RO — Owner; RT1, RT2 — технари (столы RP1, RP2); RTL — Тимлид;
--   ROS1 «anna», ROS2 «bella» — ОС; ROS3 — ОС без ника; RV — Viewer;
--   RX — посторонний.
-- RP1: карта столбцов вкладки month-2026-09 опубликована (os_key = os).
-- Итог — строка «ПРОВЕРОК: N, ПРОВАЛЕНО: 0».
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;
truncate tst.results;

insert into public.rows_workspaces (workspace_id, owner_id, live) values ('WR', 'RO', true), ('WRD', 'RO', false);
insert into public.rows_members (workspace_id, uid, role, extra_roles, os_nick_value) values
  ('WR', 'RO', 'owner', '{}', null),
  ('WR', 'RT1', 'manager', '{}', null),
  ('WR', 'RT2', 'manager', '{}', null),
  ('WR', 'RTL', 'teamlead', '{}', null),
  ('WR', 'ROS1', 'os', '{}', 'anna'),
  ('WR', 'ROS2', 'os', '{}', 'bella'),
  ('WR', 'ROS3', 'os', '{}', null),
  ('WR', 'RV', 'viewer', '{}', null),
  ('WRD', 'ROS1', 'os', '{}', 'anna'),
  ('WRD', 'RT1', 'manager', '{}', null);
insert into public.rows_page_acl (workspace_id, page_id, responsible_uid, created_by, os_desk, allowed_uids, editable_uids,
    os_keys_tab, os_key, os_status_key) values
  ('WR', 'RP1', 'RT1', 'RT1', false, '{RT1}', '{}', 'month-2026-09', 'os', 'status'),
  ('WR', 'RP2', 'RT2', 'RT2', false, '{RT2}', '{}', null, null, null),
  ('WR', 'osdesk_ROS1', 'ROS1', 'ROS1', true, '{ROS1}', '{}', null, null, null),
  ('WRD', 'RP1', 'RT1', 'RT1', false, '{RT1}', '{}', 'month-2026-09', 'os', 'status');
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at, os_uid, tech_uid) values
  -- ведёт ОС anna (подхвачен/выдан со стола ОС)
  ('WR', 'RP1', 'month-2026-09', 'a1', '{"client":"Заказ 1","os":"anna"}', 0, 1000, 1000, 'ROS1', 'RT1'),
  -- не подхвачен, ник anna в столбце ОС
  ('WR', 'RP1', 'month-2026-09', 'a2', '{"client":"Заказ 2","os":" anna "}', 1, 1000, 1000, null, null),
  -- ник bella
  ('WR', 'RP1', 'month-2026-09', 'b1', '{"client":"Заказ Беллы","os":"bella"}', 2, 1000, 1000, null, null),
  -- ник anna в столбце, но строку ВЕДЁТ bella
  ('WR', 'RP1', 'month-2026-09', 'b2', '{"client":"Передан","os":"anna"}', 3, 1000, 1000, 'ROS2', 'RT1'),
  -- ник anna, но другая вкладка (карта опубликована для month-2026-09)
  ('WR', 'RP1', 'other', 'a3', '{"client":"Старая вкладка","os":"anna"}', 0, 1000, 1000, null, null),
  -- стол без карты, но заказ ведёт anna
  ('WR', 'RP2', 'x1', 'a4', '{"client":"Без карты"}', 0, 1000, 1000, 'ROS1', 'RT2'),
  -- стол без карты, ник только в ячейке
  ('WR', 'RP2', 'x1', 'a5', '{"client":"Без карты 2","os":"anna"}', 1, 1000, 1000, null, null),
  -- строка самого стола ОС
  ('WR', 'osdesk_ROS1', '', 's1', '{"client":"Продажа"}', 0, 1000, 1000, 'ROS1', null),
  ('WRD', 'RP1', 'month-2026-09', 'd1', '{"client":"Неживое","os":"anna"}', 0, 1000, 1000, 'ROS1', 'RT1');

-- --- Кто может поставить -----------------------------------------------
select tst.expect('ОС ставит оценку заказу, который ведёт',
  tst.try('ROS1', $q$select rate_order('WR','RP1','month-2026-09','a1', 9, 'Заказ 1')$q$), 'ok:1');
select tst.expect('ОС ставит оценку неподхваченному заказу со своим ником (пробелы вокруг ника)',
  tst.try('ROS1', $q$select rate_order('WR','RP1','month-2026-09','a2', 7, 'Заказ 2')$q$), 'ok:1');
select tst.expect('чужой заказ (ник bella) — отказ',
  tst.try('ROS1', $q$select rate_order('WR','RP1','month-2026-09','b1', 5, '')$q$), 'error');
select tst.expect('ник anna в ячейке, но заказ ведёт bella — anna отказ',
  tst.try('ROS1', $q$select rate_order('WR','RP1','month-2026-09','b2', 5, '')$q$), 'error');
select tst.expect('...а bella, которая ведёт, ставит',
  tst.try('ROS2', $q$select rate_order('WR','RP1','month-2026-09','b2', 5, '')$q$), 'ok:1');
select tst.expect('ник в ячейке вкладки без опубликованной карты — отказ',
  tst.try('ROS1', $q$select rate_order('WR','RP1','other','a3', 5, '')$q$), 'error');
select tst.expect('стол без карты, заказ ведёт ОС — ставит',
  tst.try('ROS1', $q$select rate_order('WR','RP2','x1','a4', 10, '')$q$), 'ok:1');
select tst.expect('стол без карты, ник только в ячейке — отказ',
  tst.try('ROS1', $q$select rate_order('WR','RP2','x1','a5', 5, '')$q$), 'error');
select tst.expect('строку самого стола ОС оценить нельзя',
  tst.try('ROS1', $q$select rate_order('WR','osdesk_ROS1','','s1', 5, '')$q$), 'error');
select tst.expect('ОС без ника — отказ',
  tst.try('ROS3', $q$select rate_order('WR','RP1','month-2026-09','a2', 5, '')$q$), 'error');
select tst.expect('технарь сам себе не ставит',
  tst.try('RT1', $q$select rate_order('WR','RP1','month-2026-09','a2', 10, '')$q$), 'error');
select tst.expect('Owner (не ОС заказа) не ставит',
  tst.try('RO', $q$select rate_order('WR','RP1','month-2026-09','a1', 10, '')$q$), 'error');
select tst.expect('Тимлид не ставит',
  tst.try('RTL', $q$select rate_order('WR','RP1','month-2026-09','a1', 10, '')$q$), 'error');
select tst.expect('посторонний не ставит',
  tst.try('RX', $q$select rate_order('WR','RP1','month-2026-09','a1', 10, '')$q$), 'error');
select tst.expect('анонимный ключ не ставит',
  tst.try('__anon_key__', $q$select rate_order('WR','RP1','month-2026-09','a1', 10, '')$q$), 'error');
select tst.expect('токен чужого проекта с uid ОС не ставит',
  tst.try('__forged__:ROS1', $q$select rate_order('WR','RP1','month-2026-09','a1', 10, '')$q$), 'error');
select tst.expect('несуществующая строка — отказ',
  tst.try('ROS1', $q$select rate_order('WR','RP1','month-2026-09','nope', 5, '')$q$), 'error');
select tst.expect('балл 0 — отказ', tst.try('ROS1', $q$select rate_order('WR','RP1','month-2026-09','a1', 0, '')$q$), 'error');
select tst.expect('балл 11 — отказ', tst.try('ROS1', $q$select rate_order('WR','RP1','month-2026-09','a1', 11, '')$q$), 'error');
select tst.expect('неживое хранилище — отказ',
  tst.try('ROS1', $q$select rate_order('WRD','RP1','month-2026-09','d1', 5, '')$q$), 'error');
select tst.expect('напрямую в таблицу не пишет даже ОС',
  tst.try('ROS1', $q$insert into order_ratings (workspace_id, page_id, tab_id, row_id, os_uid, tech_uid, score, month_key, created_at, updated_at)
    values ('WR','RP1','month-2026-09','a1','ROS1','RT1',10,'2026-09',1,1)$q$), 'error');

-- --- Запись по-настоящему ----------------------------------------------
select tst.run('ROS1', $q$select rate_order('WR','RP1','month-2026-09','a1', 9, 'Заказ 1')$q$);
select tst.run('ROS1', $q$select rate_order('WR','RP1','month-2026-09','a2', 6, 'Заказ 2')$q$);
select tst.run('ROS2', $q$select rate_order('WR','RP1','month-2026-09','b2', 4, 'Передан')$q$);
select tst.run('ROS1', $q$select rate_order('WR','RP2','x1','a4', 10, 'Без карты', '2026-09')$q$);

select tst.expect('месяц — из вкладки month-YYYY-MM',
  (select month_key from public.order_ratings where row_id = 'a1'), '2026-09');
select tst.expect('технарь — tech_uid строки', (select tech_uid from public.order_ratings where row_id = 'a1'), 'RT1');
select tst.expect('технарь — ответственный стола, если tech_uid пуст', (select tech_uid from public.order_ratings where row_id = 'a2'), 'RT1');
select tst.expect('ник ОС записан', (select os_value from public.order_ratings where row_id = 'a2'), 'anna');
select tst.expect('немесячная вкладка: месяц клиента, если он текущий/прошлый',
  (select (month_key = '2026-09' or month_key = to_char(now() at time zone 'Asia/Almaty', 'YYYY-MM'))::text
   from public.order_ratings where row_id = 'a4'), 'true');

-- смена балла — та же строка, created_at не меняется
select tst.run('ROS1', $q$select rate_order('WR','RP1','month-2026-09','a1', 3, '')$q$);
select tst.expect('смена балла — одна строка', (select count(*)::text from public.order_ratings where row_id = 'a1'), '1');
select tst.expect('смена балла записана', (select score::text from public.order_ratings where row_id = 'a1'), '3');
select tst.expect('пустое название при смене не стирает прежнее', (select title from public.order_ratings where row_id = 'a1'), 'Заказ 1');

-- --- Чтение -----------------------------------------------------------
select tst.expect('ОС видит свои оценки', tst.try('ROS1', $q$select * from order_ratings where workspace_id='WR'$q$, true), 'ok:3');
select tst.expect('ОС не видит оценки другого ОС', tst.try('ROS2', $q$select * from order_ratings where workspace_id='WR'$q$, true), 'ok:1');
select tst.expect('технарь видит оценки своих заказов', tst.try('RT1', $q$select * from order_ratings where workspace_id='WR'$q$, true), 'ok:3');
select tst.expect('другой технарь — только свои', tst.try('RT2', $q$select * from order_ratings where workspace_id='WR'$q$, true), 'ok:1');
select tst.expect('Owner видит все', tst.try('RO', $q$select * from order_ratings where workspace_id='WR'$q$, true), 'ok:4');
select tst.expect('Тимлид не видит (названия заказов)', tst.try('RTL', $q$select * from order_ratings$q$, true), 'ok:0');
select tst.expect('Viewer не видит', tst.try('RV', $q$select * from order_ratings$q$, true), 'ok:0');
select tst.expect('посторонний не видит', tst.try('RX', $q$select * from order_ratings$q$, true), 'ok:0');
select tst.expect('анонимный ключ не видит', tst.try('__anon_key__', $q$select * from order_ratings$q$, true), 'ok:0');

-- --- Итоги ------------------------------------------------------------
select tst.expect('итоги видит любой участник (Viewer)',
  tst.try('RV', $q$select * from order_rating_totals('WR', array['2026-09'])$q$, true), 'ok');
do $$
declare got text;
begin
  perform set_config('request.jwt.claims', tst.claims('RV'), true);
  execute 'set local role anon';
  select cnt || '/' || total into got from public.order_rating_totals('WR', array['2026-09']) where os_uid = 'ROS1' and tech_uid = 'RT1';
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform tst.expect('итоги: пара anna×RT1 = 2 оценки, сумма 9 (3 + 6)', got, '2/9');
end;
$$;
select tst.expect('итоги посторонний не получает',
  tst.try('RX', $q$select * from order_rating_totals('WR', array['2026-09'])$q$, true), 'ok:0');
select tst.expect('итоги анонимный ключ не получает',
  tst.try('__anon_key__', $q$select * from order_rating_totals('WR', array['2026-09'])$q$, true), 'ok:0');
select tst.expect('итоги за другой месяц пусты',
  tst.try('RO', $q$select * from order_rating_totals('WR', array['2020-01'])$q$, true), 'ok:0');

-- --- Снять ------------------------------------------------------------
select tst.expect('другой ОС чужую оценку не снимает',
  tst.try('ROS2', $q$select rate_order('WR','RP1','month-2026-09','a1', null)$q$), 'error');
select tst.expect('технарь оценку не снимает',
  tst.try('RT1', $q$select rate_order('WR','RP1','month-2026-09','a1', null)$q$), 'error');
select tst.expect('Viewer оценку не снимает',
  tst.try('RV', $q$select rate_order('WR','RP1','month-2026-09','a1', null)$q$), 'error');
do $$
declare got jsonb;
begin
  perform set_config('request.jwt.claims', tst.claims('RTL'), true);
  execute 'set local role anon';
  begin
    got := public.rate_order('WR','RP1','month-2026-09','b2', null);
  exception when others then got := jsonb_build_object('state', 'error:' || sqlstate);
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform tst.expect('Тимлид снимает несправедливую оценку', got ->> 'state', 'removed');
end;
$$;
select tst.expect('после снятия Тимлидом оценки нет', (select count(*)::text from public.order_ratings where row_id = 'b2'), '0');
select tst.expect('ОС снимает свою',
  tst.try('ROS1', $q$select rate_order('WR','RP1','month-2026-09','a2', null)$q$), 'ok:1');
select tst.expect('Owner снимает любую',
  tst.try('RO', $q$select rate_order('WR','RP1','month-2026-09','a1', null)$q$), 'ok:1');
select tst.expect('снять несуществующую — без ошибки',
  tst.try('ROS1', $q$select rate_order('WR','RP1','month-2026-09','b1', null)$q$), 'ok:1');

-- --- Повторный накат ---------------------------------------------------
\ir ../migrations/20261005_order_ratings.sql
select tst.expect('повторный накат не трогает оценки', (select count(*)::text from public.order_ratings where workspace_id = 'WR'), '3');
select tst.expect('версия схемы', public.nova_schema_version(), '20261005');
select tst.expect('после наката права на таблицу — только чтение',
  tst.try('ROS1', $q$delete from order_ratings where workspace_id='WR'$q$), 'error');

select label, got from tst.results where not ok;
select format('ПРОВЕРОК: %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
