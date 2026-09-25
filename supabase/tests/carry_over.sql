-- =====================================================================
-- 20261007_carry_over.sql: перенос незавершённых заказов в новый период и
-- переархив прошлого периода. Запуск после desk_rows_rls.sql (схема tst;
-- все миграции уже накатаны). Свой workspace WV:
--   VO — Owner; VT1, VT2 — технари (столы VP1, VP2); VTL — Тимлид;
--   VOS1 «anna» — ОС со столом osdesk_VOS1; VV — Viewer; VX — посторонний.
-- VP1: вкладки month-2026-09 (старый период) и month-2026-10-1 (новый).
-- Итог — строка «ПРОВЕРОК: N, ПРОВАЛЕНО: 0».
-- =====================================================================
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

insert into public.rows_workspaces (workspace_id, owner_id, live) values ('WV', 'VO', true), ('WVD', 'VO', false);
insert into public.rows_members (workspace_id, uid, role, extra_roles, os_nick_value) values
  ('WV', 'VO', 'owner', '{}', null),
  ('WV', 'VT1', 'manager', '{}', null),
  ('WV', 'VT2', 'manager', '{}', null),
  ('WV', 'VTL', 'teamlead', '{}', null),
  ('WV', 'VOS1', 'os', '{}', 'anna'),
  ('WV', 'VV', 'viewer', '{}', null),
  ('WVD', 'VT1', 'manager', '{}', null);
insert into public.rows_page_acl (workspace_id, page_id, responsible_uid, created_by, os_desk, allowed_uids, editable_uids,
    os_keys_tab, os_key, os_status_key) values
  ('WV', 'VP1', 'VT1', 'VT1', false, '{VT1}', '{}', 'month-2026-10-1', 'os', 'status'),
  ('WV', 'VP2', 'VT2', 'VT2', false, '{VT2}', '{}', null, null, null),
  ('WV', 'osdesk_VOS1', 'VOS1', 'VOS1', true, '{VOS1}', '{}', null, null, null),
  ('WVD', 'VP1', 'VT1', 'VT1', false, '{VT1}', '{}', null, null, null);
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at, os_uid, tech_uid, status_key,
    src_page_id, src_tab_id, src_row_id, order_id, extras) values
  -- обычная строка технаря в работе
  ('WV', 'VP1', 'month-2026-09', 'r1', '{"client":"Аня","status":"work","price":"100"}', 0, 1000, 1000, null, null, null, null, null, null, null, '{"persons":2}'),
  -- заказ ОС (копия) с источником на столе ОС
  ('WV', 'VP1', 'month-2026-09', 'r2', '{"client":"Боря","status":"work","os":"anna"}', 1, 1000, 1000, 'VOS1', 'VT1', 'status', 'osdesk_VOS1', '', 's2', null, null),
  -- заказ с биржи
  ('WV', 'VP1', 'month-2026-09', 'r3', '{"client":"Вика","status":"work"}', 2, 1000, 1000, null, null, null, null, null, null, 'ord-3', null),
  -- готовый (не переносится клиентом, но функция сама не фильтрует)
  ('WV', 'VP1', 'month-2026-09', 'r4', '{"client":"Гоша","status":"done"}', 3, 1000, 1000, null, null, null, null, null, null, null, null),
  -- в новой вкладке уже есть строка с id r5 (дубль)
  ('WV', 'VP1', 'month-2026-09', 'r5', '{"client":"Дубль старый"}', 4, 1000, 1000, null, null, null, null, null, null, null, null),
  ('WV', 'VP1', 'month-2026-10-1', 'r5', '{"client":"Дубль новый"}', 0, 2000, 2000, null, null, null, null, null, null, null, null),
  ('WV', 'VP1', 'month-2026-10-1', 'n1', '{"client":"Уже октябрь"}', 1, 2000, 2000, null, null, null, null, null, null, null, null),
  -- чужой стол
  ('WV', 'VP2', 'month-2026-09', 'q1', '{"client":"Чужой"}', 0, 1000, 1000, null, null, null, null, null, null, null, null),
  ('WV', 'VP2', 'month-2026-10-1', 'q2', '{"client":"Чужой окт"}', 0, 1000, 1000, null, null, null, null, null, null, null, null),
  -- стол ОС: источник s2 → копия r2; и источник s9 без копии
  ('WV', 'osdesk_VOS1', '', 's2', '{"client":"Боря","status":"work","technician":"t1"}', 0, 1000, 1000, null, null, null, null, null, null, null, null),
  ('WV', 'osdesk_VOS1', 'month-2026-10-1', 's9', '{"client":"Октябрьская"}', 0, 1000, 1000, null, null, null, null, null, null, null, null),
  ('WVD', 'VP1', 'month-2026-09', 'd1', '{"client":"Неживое"}', 0, 1000, 1000, null, null, null, null, null, null, null, null);
update public.desk_rows set mirror_page_id = 'VP1', mirror_tab_id = 'month-2026-09', mirror_row_id = 'r2'
  where workspace_id = 'WV' and page_id = 'osdesk_VOS1' and id = 's2';
-- оценка у r2 (ключуется адресом)
insert into public.order_ratings (workspace_id, page_id, tab_id, row_id, os_uid, os_value, tech_uid, score, month_key, title, created_at, updated_at)
  values ('WV', 'VP1', 'month-2026-09', 'r2', 'VOS1', 'anna', 'VT1', 8, '2026-09', 'Боря', 1, 1);

-- --- Права ----------------------------------------------------------------
select tst.expect('чужой технарь не переносит', tst.try('VT2', $q$select rows_carry_over('WV','VP1','month-2026-09','month-2026-10-1', array['r1'])$q$), 'error');
select tst.expect('ОС не переносит строки стола технаря', tst.try('VOS1', $q$select rows_carry_over('WV','VP1','month-2026-09','month-2026-10-1', array['r2'])$q$), 'error');
select tst.expect('Тимлид не переносит', tst.try('VTL', $q$select rows_carry_over('WV','VP1','month-2026-09','month-2026-10-1', array['r1'])$q$), 'error');
select tst.expect('Viewer не переносит', tst.try('VV', $q$select rows_carry_over('WV','VP1','month-2026-09','month-2026-10-1', array['r1'])$q$), 'error');
select tst.expect('посторонний не переносит', tst.try('VX', $q$select rows_carry_over('WV','VP1','month-2026-09','month-2026-10-1', array['r1'])$q$), 'error');
select tst.expect('анонимный ключ не переносит', tst.try('__anon_key__', $q$select rows_carry_over('WV','VP1','month-2026-09','month-2026-10-1', array['r1'])$q$), 'error');
select tst.expect('та же вкладка — отказ', tst.try('VT1', $q$select rows_carry_over('WV','VP1','month-2026-09','month-2026-09', array['r1'])$q$), 'error');
select tst.expect('неживое хранилище — отказ', tst.try('VT1', $q$select rows_carry_over('WVD','VP1','month-2026-09','month-2026-10', array['d1'])$q$), 'error');
select tst.expect('пустой список — пусто без ошибки',
  tst.jval('VT1', $q$select (rows_carry_over('WV','VP1','month-2026-09','month-2026-10-1', array[]::text[]) ->> 'moved')$q$), '[]');

-- --- Перенос технарём -------------------------------------------------------
select tst.expect('технарь переносит свои строки (в т. ч. заказ ОС и с биржи), дубль пропущен',
  tst.jval('VT1', $q$select rows_carry_over('WV','VP1','month-2026-09','month-2026-10-1', array['r1','r2','r3','r5'])::text$q$),
  '{"moved": ["r1", "r2", "r3"], "skipped": ["r5"]}');
select tst.expect('строки лежат в новой вкладке', (select count(*)::text from public.desk_rows where workspace_id='WV' and page_id='VP1' and tab_id='month-2026-10-1' and id in ('r1','r2','r3')), '3');
select tst.expect('в старой их нет', (select count(*)::text from public.desk_rows where workspace_id='WV' and page_id='VP1' and tab_id='month-2026-09' and id in ('r1','r2','r3')), '0');
select tst.expect('дубль остался в старой', (select count(*)::text from public.desk_rows where workspace_id='WV' and page_id='VP1' and tab_id='month-2026-09' and id = 'r5'), '1');
select tst.expect('содержимое цело (ячейки, визитка, order_id, os_uid)',
  (select (cells ->> 'client') || '|' || (extras ->> 'persons') || '|' || coalesce(order_id,'-') || '|' || coalesce(os_uid,'-')
   from public.desk_rows where workspace_id='WV' and page_id='VP1' and tab_id='month-2026-10-1' and id='r1'), 'Аня|2|-|-');
select tst.expect('заказ с биржи сохранил order_id', (select order_id from public.desk_rows where workspace_id='WV' and page_id='VP1' and tab_id='month-2026-10-1' and id='r3'), 'ord-3');
select tst.expect('заказ ОС сохранил os_uid/src_*', (select os_uid || '|' || src_page_id || '|' || src_row_id from public.desk_rows where workspace_id='WV' and page_id='VP1' and tab_id='month-2026-10-1' and id='r2'), 'VOS1|osdesk_VOS1|s2');
select tst.expect('carried_from поставлен', (select carried_from from public.desk_rows where workspace_id='WV' and page_id='VP1' and tab_id='month-2026-10-1' and id='r1'), 'month-2026-09');
select tst.expect('carried_at поставлен', (select (carried_at > 0)::text from public.desk_rows where workspace_id='WV' and page_id='VP1' and tab_id='month-2026-10-1' and id='r1'), 'true');
select tst.expect('порядок — хвостом целевой вкладки', (select string_agg(id, ',' order by sort_order) from public.desk_rows where workspace_id='WV' and page_id='VP1' and tab_id='month-2026-10-1'), 'r5,n1,r1,r2,r3');
select tst.expect('источник на столе ОС смотрит на новую вкладку копии', (select mirror_tab_id from public.desk_rows where workspace_id='WV' and page_id='osdesk_VOS1' and id='s2'), 'month-2026-10-1');
select tst.expect('оценка перетегирована на новую вкладку', (select tab_id from public.order_ratings where workspace_id='WV' and page_id='VP1' and row_id='r2'), 'month-2026-10-1');
select tst.expect('месяц оценки прежний', (select month_key from public.order_ratings where workspace_id='WV' and page_id='VP1' and row_id='r2'), '2026-09');
select tst.expect('rev у перенесённой строки вырос', (select (rev > 0)::text from public.desk_rows where workspace_id='WV' and page_id='VP1' and tab_id='month-2026-10-1' and id='r1'), 'true');
select tst.expect('повтор переноса — всё пропущено',
  tst.jval('VT1', $q$select (rows_carry_over('WV','VP1','month-2026-09','month-2026-10-1', array['r1','r2']) ->> 'moved')$q$), '[]');

-- --- Статус доезжает до копии в новой вкладке ------------------------------
select tst.run('VOS1', $q$update desk_rows set cells = cells || '{"status":"done"}'::jsonb where workspace_id='WV' and page_id='osdesk_VOS1' and tab_id='' and id='s2'$q$);
select tst.expect('статус со стола ОС доехал до перенесённой копии', (select cells ->> 'status' from public.desk_rows where workspace_id='WV' and page_id='VP1' and tab_id='month-2026-10-1' and id='r2'), 'done');

-- --- GUC не течёт ------------------------------------------------------------
select tst.expect('GUC переноса не виден в следующем запросе', tst.jval('VT1', $q$select coalesce(current_setting('nova.carry_over', true), '')$q$), '');
select tst.expect('без GUC технарь по-прежнему не меняет опорные поля заказа ОС',
  tst.try('VT1', $q$update desk_rows set src_tab_id = 'x' where workspace_id='WV' and page_id='VP1' and tab_id='month-2026-10-1' and id='r2'$q$), 'error');
select tst.expect('без GUC технарь не меняет статус заказа ОС',
  tst.try('VT1', $q$update desk_rows set cells = cells || '{"status":"work"}'::jsonb where workspace_id='WV' and page_id='VP1' and tab_id='month-2026-10-1' and id='r2'$q$), 'error');
do $$
declare got text;
begin
  -- GUC выставлен, но правится содержимое: ветка бипаса не пускает.
  perform set_config('request.jwt.claims', tst.claims('VT1'), true);
  perform set_config('nova.carry_over', '1', true);
  execute 'set local role anon';
  begin
    update public.desk_rows set cells = cells || '{"status":"work"}'::jsonb where workspace_id='WV' and page_id='VP1' and tab_id='month-2026-10-1' and id='r2';
    got := 'allowed';
  exception when others then got := 'denied:' || sqlstate;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('nova.carry_over', '', true);
  perform tst.expect('под GUC правка содержимого заказа ОС всё равно отклонена', got, 'denied:42501');
end;
$$;

-- --- Перенос источников на столе ОС (Owner) чинит src_tab_id копий ----------
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at, mirror_page_id, mirror_tab_id, mirror_row_id) values
  ('WV', 'osdesk_VOS1', '', 's7', '{"client":"Источник 7"}', 5, 1000, 1000, 'VP1', 'month-2026-10-1', 'r7');
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at, os_uid, tech_uid, status_key, src_page_id, src_tab_id, src_row_id) values
  ('WV', 'VP1', 'month-2026-10-1', 'r7', '{"client":"Источник 7","status":"work"}', 9, 1000, 1000, 'VOS1', 'VT1', 'status', 'osdesk_VOS1', '', 's7');
select tst.expect('Owner переносит источники на столе ОС',
  tst.jval('VO', $q$select (rows_carry_over('WV','osdesk_VOS1','','month-2026-10-1', array['s7']) ->> 'moved')$q$), '["s7"]');
select tst.expect('копия смотрит на новую вкладку источника', (select src_tab_id from public.desk_rows where workspace_id='WV' and page_id='VP1' and id='r7'), 'month-2026-10-1');
select tst.expect('ОС переносит строки своего стола ОС',
  tst.jval('VOS1', $q$select (rows_carry_over('WV','osdesk_VOS1','month-2026-10-1','', array['s9']) ->> 'moved')$q$), '["s9"]');

-- --- Переархив -------------------------------------------------------------
create or replace function tst.put(page text, resp text, month text, data text, ws text default 'WV') returns text
language sql immutable as $$
  select format($f$insert into desk_loads (workspace_id, page_id, responsible_uid, month_key, sub_page_id, data, updated_by)
    values (%L, %L, %L, %L, %L, %L::jsonb, 'кто-то')
    on conflict (workspace_id, page_id) do update set
      responsible_uid = excluded.responsible_uid, month_key = excluded.month_key,
      sub_page_id = excluded.sub_page_id, data = excluded.data, updated_by = excluded.updated_by$f$,
    ws, page, resp, month, 'tab_' || month, data)
$$;
select tst.run('VT1', tst.put('VP1', 'VT1', '2026-09', '{"total":5,"statusCounts":{"work":5}}'));
select tst.expect('переархив старого периода, когда стол ещё не опубликовал новый: правится живая строка',
  tst.try('VT1', $q$select desk_load_rearchive('WV','VP1','2026-09','month-2026-09','{"total":2,"statusCounts":{"work":2},"pageId":"x"}'::jsonb)$q$), 'ok:1');
select tst.run('VT1', $q$select desk_load_rearchive('WV','VP1','2026-09','month-2026-09','{"total":2,"statusCounts":{"work":2},"pageId":"x"}'::jsonb)$q$);
select tst.expect('живые цифры исправлены', (select data ->> 'total' from public.desk_loads where workspace_id='WV' and page_id='VP1'), '2');
select tst.expect('служебные ключи вырезаны', (select (data ? 'pageId')::text from public.desk_loads where workspace_id='WV' and page_id='VP1'), 'false');
select tst.expect('архив записан с counts_at', (select (counts_at is not null)::text from public.desk_load_history where workspace_id='WV' and page_id='VP1' and month_key='2026-09'), 'true');
select tst.expect('архив хранит исправленные цифры', (select data ->> 'total' from public.desk_load_history where workspace_id='WV' and page_id='VP1' and month_key='2026-09'), '2');
select tst.expect('архив помнит, кто пересчитал', (select updated_by from public.desk_load_history where workspace_id='WV' and page_id='VP1' and month_key='2026-09'), 'VT1');
-- стол опубликовал новый период → триггер архивирует уже исправленные цифры
select tst.run('VT1', tst.put('VP1', 'VT1', '2026-10-1', '{"total":3}'));
select tst.expect('после публикации нового периода архив старого — исправленные цифры', (select data ->> 'total' from public.desk_load_history where workspace_id='WV' and page_id='VP1' and month_key='2026-09'), '2');
select tst.expect('переархив ПОСЛЕ публикации нового периода пишет архив',
  tst.try('VT1', $q$select desk_load_rearchive('WV','VP1','2026-09','month-2026-09','{"total":1}'::jsonb)$q$), 'ok:1');
select tst.expect('ключ новее живого — отказ',
  tst.try('VT1', $q$select desk_load_rearchive('WV','VP1','2026-10-2','month-2026-10-2','{"total":1}'::jsonb)$q$), 'error');
select tst.expect('будущий период — отказ',
  tst.try('VT1', $q$select desk_load_rearchive('WV','VP1','2099-01','x','{"total":1}'::jsonb)$q$), 'error');
select tst.expect('кривой ключ — отказ',
  tst.try('VT1', $q$select desk_load_rearchive('WV','VP1','2026-10-3','x','{"total":1}'::jsonb)$q$), 'error');
select tst.expect('чужой технарь — отказ',
  tst.try('VT2', $q$select desk_load_rearchive('WV','VP1','2026-09','x','{"total":1}'::jsonb)$q$), 'error');
select tst.expect('ОС — отказ',
  tst.try('VOS1', $q$select desk_load_rearchive('WV','VP1','2026-09','x','{"total":1}'::jsonb)$q$), 'error');
select tst.expect('посторонний — отказ',
  tst.try('VX', $q$select desk_load_rearchive('WV','VP1','2026-09','x','{"total":1}'::jsonb)$q$), 'error');
select tst.expect('Owner переархивирует любой стол',
  tst.try('VO', $q$select desk_load_rearchive('WV','VP2','2026-09','x','{"total":1}'::jsonb)$q$), 'ok:1');

-- --- Версия и повторный накат ----------------------------------------------
select tst.expect('версия схемы не старее 20261007', (public.nova_schema_version() >= '20261007')::text, 'true');
\ir ../migrations/20261007_carry_over.sql
select tst.expect('после повторного наката перенос работает',
  tst.jval('VT1', $q$select (rows_carry_over('WV','VP1','month-2026-09','month-2026-10-1', array['r4']) ->> 'moved')$q$), '["r4"]');

select label, got from tst.results where not ok;
select format('ПРОВЕРОК (перенос): %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
