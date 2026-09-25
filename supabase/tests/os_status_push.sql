-- =====================================================================
-- 20261002_os_sync.sql, часть Б: статус со стола ОС доезжает до копии у
-- технаря той же записью (триггер desk_rows_os_status_push), плюс права на
-- функции файла и nova_schema_version(). Запуск ПОСЛЕ desk_rows_rls.sql (берёт
-- его схему tst). Свой workspace WP, чтобы не зависеть от соседних наборов:
--   PO — Owner; PT1, PT2 — технари (столы PP1, PP2); PTE — технарь со столом
--   PP3, которому дали правку стола ОС POS1; PTL — Тимлид; POS1, POS2 — ОС.
-- Итог — строка «ПРОВЕРОК: N, ПРОВАЛЕНО: 0».
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;
truncate tst.results;

insert into public.rows_workspaces (workspace_id, owner_id, live) values ('WP', 'PO', true);
insert into public.rows_members (workspace_id, uid, role, extra_roles, os_nick_value) values
  ('WP', 'PO', 'owner', '{}', null),
  ('WP', 'PT1', 'manager', '{}', null),
  ('WP', 'PT2', 'manager', '{}', null),
  ('WP', 'PTE', 'manager', '{}', null),
  ('WP', 'PTL', 'teamlead', '{}', null),
  ('WP', 'POS1', 'os', '{}', 'os1'),
  ('WP', 'POS2', 'os', '{}', 'os2');
insert into public.rows_page_acl (workspace_id, page_id, responsible_uid, created_by, os_desk, allowed_uids, editable_uids) values
  ('WP', 'PP1', 'PT1', 'PT1', false, '{PT1}', '{}'),
  ('WP', 'PP2', 'PT2', 'PT2', false, '{PT2}', '{}'),
  ('WP', 'PP3', 'PTE', 'PTE', false, '{PTE}', '{}'),
  ('WP', 'osdesk_POS1', 'POS1', 'POS1', true, '{POS1}', '{PTE}'),
  ('WP', 'osdesk_POS2', 'POS2', 'POS2', true, '{POS2}', '{}');

-- Копии у технарей (строки-заказы).
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at,
  os_uid, tech_uid, status_key, src_page_id, src_tab_id, src_row_id, sync_hash, success_requested_at, success_requested_by) values
  ('WP', 'PP1', 'm9', 'os_s1', '{"client":"Клиент","status":"work","os":"os1"}', 0, 1000, 1000,
   'POS1', 'PT1', 'status', 'osdesk_POS1', '', 's1', 'h1', 5, 'PT1'),
  -- копия со СВОИМ ключом статуса (другой, чем у текущей вкладки)
  ('WP', 'PP1', 'm8', 'os_s2', '{"client":"К2","st2":"work"}', 0, 1000, 1000,
   'POS1', 'PT1', 'st2', 'osdesk_POS1', '', 's2', 'h1', null, null),
  -- копия чужого ОС
  ('WP', 'PP2', '', 'os_x', '{"client":"Чужой ОС","status":"work"}', 0, 1000, 1000,
   'POS2', 'PT2', 'status', 'osdesk_POS2', '', 'x', 'h', null, null),
  -- копия того же ОС, но показывает НАЗАД на другой источник
  ('WP', 'PP1', 'm9', 'os_s3', '{"client":"Не та копия","status":"work"}', 1, 1000, 1000,
   'POS1', 'PT1', 'status', 'osdesk_POS1', '', 'other_src', 'h1', null, null),
  -- копия в столе PTE (ему дали правку стола ОС)
  ('WP', 'PP3', '', 'os_e1', '{"client":"У PTE","status":"work"}', 0, 1000, 1000,
   'POS1', 'PTE', 'status', 'osdesk_POS1', '', 'e1', 'h1', null, null);
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at) values
  ('WP', 'PP1', '', 'r1', '{"client":"Обычная строка","status":"work"}', 0, 1000, 1000);
-- Строки стола ОС с адресами копий.
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at,
  mirror_page_id, mirror_tab_id, mirror_row_id) values
  ('WP', 'osdesk_POS1', '', 's1', '{"client":"Клиент","status":"work","technician":"t1","osStatusSent":"work"}', 0, 1000, 1000, 'PP1', 'm9', 'os_s1'),
  ('WP', 'osdesk_POS1', '', 's2', '{"client":"К2","status":"work","technician":"t1","osStatusSent":"work"}', 1, 1000, 1000, 'PP1', 'm8', 'os_s2'),
  -- «подложенный» адрес: на обычную строку технаря (os_uid null)
  ('WP', 'osdesk_POS1', '', 'f1', '{"client":"F","status":"work"}', 2, 1000, 1000, 'PP1', '', 'r1'),
  -- «подложенный» адрес: на копию чужого ОС
  ('WP', 'osdesk_POS1', '', 'f2', '{"client":"F2","status":"work"}', 3, 1000, 1000, 'PP2', '', 'os_x'),
  -- «подложенный» адрес: на свою копию, которая показывает на другой источник
  ('WP', 'osdesk_POS1', '', 'f3', '{"client":"F3","status":"work"}', 4, 1000, 1000, 'PP1', 'm9', 'os_s3'),
  ('WP', 'osdesk_POS1', '', 'e1', '{"client":"У PTE","status":"work","osStatusSent":"work"}', 5, 1000, 1000, 'PP3', '', 'os_e1');

-- --- Статус ОС доезжает во всех режимах ---------------------------------
do $$
declare m text;
begin
  foreach m in array array['os', 'tech', 'mixed', 'exempt'] loop
    if m = 'exempt' then
      perform tst.run('PO', $q$select rows_set_desk_mode('WP', 'os')$q$);
      perform tst.run('PO', $q$select rows_set_desk_os_exempt('WP', 'PP1', true)$q$);
    else
      perform tst.run('PO', format($q$select rows_set_desk_mode('WP', %L)$q$, m));
    end if;
    perform tst.expect(m || ': ОС меняет статус у себя (rows_patch стола ОС) — запись проходит',
      tst.try('POS1', format($q$select rows_patch('WP','osdesk_POS1','','s1', %L::jsonb)$q$, json_build_object('status', 'st_' || m)::text)), 'ok:1');
    perform tst.run('POS1', format($q$select rows_patch('WP','osdesk_POS1','','s1', %L::jsonb)$q$, json_build_object('status', 'st_' || m)::text));
    perform tst.expect(m || ': технарь сразу видит статус ОС в копии',
      tst.try('PT1', format($q$select 1 from desk_rows where workspace_id='WP' and page_id='PP1' and tab_id='m9' and id='os_s1' and cells->>'status' = %L$q$, 'st_' || m), true), 'ok:1');
    perform tst.expect(m || ': на строке ОС osStatusSent = новый статус',
      tst.try('POS1', format($q$select 1 from desk_rows where workspace_id='WP' and page_id='osdesk_POS1' and id='s1' and cells->>'osStatusSent' = %L$q$, 'st_' || m), true), 'ok:1');
    if m = 'exempt' then
      perform tst.run('PO', $q$select rows_set_desk_os_exempt('WP', 'PP1', false)$q$);
    end if;
  end loop;
end $$;

select tst.expect('просьба технаря об «Успешке» снята статусом ОС',
  tst.try('PT1', $q$select 1 from desk_rows where workspace_id='WP' and page_id='PP1' and id='os_s1' and success_requested_by is null and success_requested_at is null$q$, true), 'ok:1');
select tst.run('POS1', $q$select rows_patch('WP','osdesk_POS1','','s2','{"status":"wait"}'::jsonb)$q$);
select tst.expect('копия со своим ключом статуса (st2) получает статус в СВОЙ ключ',
  tst.try('PT1', $q$select 1 from desk_rows where workspace_id='WP' and page_id='PP1' and tab_id='m8' and id='os_s2' and cells->>'st2' = 'wait' and cells->>'status' is null$q$, true), 'ok:1');
select tst.run('PO', $q$select rows_patch('WP','osdesk_POS1','','s1','{"status":"by_owner"}'::jsonb)$q$);
select tst.expect('Owner меняет статус на столе ОС — доезжает до технаря',
  tst.try('PT1', $q$select 1 from desk_rows where workspace_id='WP' and page_id='PP1' and tab_id='m9' and id='os_s1' and cells->>'status'='by_owner'$q$, true), 'ok:1');

-- --- Подложенные адреса: запись строки ОС проходит, чужое НЕ меняется ----
select tst.expect('адрес на обычную строку технаря — запись строки ОС проходит',
  tst.try('POS1', $q$select rows_patch('WP','osdesk_POS1','','f1','{"status":"hack"}'::jsonb)$q$), 'ok:1');
select tst.run('POS1', $q$select rows_patch('WP','osdesk_POS1','','f1','{"status":"hack"}'::jsonb)$q$);
select tst.run('POS1', $q$select rows_patch('WP','osdesk_POS1','','f2','{"status":"hack"}'::jsonb)$q$);
select tst.run('POS1', $q$select rows_patch('WP','osdesk_POS1','','f3','{"status":"hack"}'::jsonb)$q$);
select tst.expect('адрес на обычную строку технаря — она НЕ тронута',
  tst.try('PO', $q$select 1 from desk_rows where workspace_id='WP' and page_id='PP1' and tab_id='' and id='r1' and cells->>'status' = 'work'$q$, true), 'ok:1');
select tst.expect('адрес на копию чужого ОС — она НЕ тронута',
  tst.try('PO', $q$select 1 from desk_rows where workspace_id='WP' and page_id='PP2' and id='os_x' and cells->>'status' = 'work'$q$, true), 'ok:1');
select tst.expect('своя копия, которая показывает на ДРУГОЙ источник, — НЕ тронута',
  tst.try('PO', $q$select 1 from desk_rows where workspace_id='WP' and page_id='PP1' and id='os_s3' and cells->>'status' = 'work'$q$, true), 'ok:1');
select tst.expect('подложенный адрес: osStatusSent НЕ ставится',
  tst.try('PO', $q$select 1 from desk_rows where workspace_id='WP' and page_id='osdesk_POS1' and id in ('f1','f2','f3') and cells ? 'osStatusSent'$q$, true), 'ok:0');

-- --- Пусто / другая ячейка — ничего не шлём ------------------------------
select tst.run('POS1', $q$select rows_patch('WP','osdesk_POS1','','s1','{"status":"keep1"}'::jsonb)$q$);
create table tst.osp_cp as select rev from desk_rows where workspace_id='WP' and page_id='PP1' and id='os_s1';
grant usage on schema tst to anon;
grant select on tst.osp_cp to anon;
select tst.run('POS1', $q$select rows_patch('WP','osdesk_POS1','','s1','{"note":"x"}'::jsonb)$q$);
select tst.expect('правка другой ячейки строки ОС копию не трогает (rev тот же)',
  tst.try('PO', $q$select 1 from desk_rows d where workspace_id='WP' and page_id='PP1' and id='os_s1' and d.rev = (select rev from tst.osp_cp)$q$, true), 'ok:1');
select tst.run('POS1', $q$select rows_patch('WP','osdesk_POS1','','s1','{"status":""}'::jsonb)$q$);
select tst.expect('стёртый статус у ОС не стирает статус технаря',
  tst.try('PT1', $q$select 1 from desk_rows where workspace_id='WP' and page_id='PP1' and id='os_s1' and cells->>'status'='keep1'$q$, true), 'ok:1');

-- --- rev растёт и у копии, и у строки ОС (порядок триггеров) ------------
create table tst.osp_rev as
  select (select rev from desk_rows where workspace_id='WP' and page_id='PP1' and id='os_s1') as copy_rev,
         (select rev from desk_rows where workspace_id='WP' and page_id='osdesk_POS1' and id='s1') as src_rev;
grant select on tst.osp_rev to anon;
select tst.run('POS1', $q$select rows_patch('WP','osdesk_POS1','','s1','{"status":"rv"}'::jsonb)$q$);
select tst.expect('rev копии вырос',
  tst.try('PO', $q$select 1 from desk_rows where workspace_id='WP' and page_id='PP1' and id='os_s1' and rev > (select copy_rev from tst.osp_rev)$q$, true), 'ok:1');
select tst.expect('rev строки ОС вырос и выдан ПОСЛЕ копии (desk_rows_rev — последний)',
  tst.try('PO', $q$select 1 from desk_rows s join desk_rows c on c.workspace_id='WP' and c.page_id='PP1' and c.id='os_s1'
    where s.workspace_id='WP' and s.page_id='osdesk_POS1' and s.id='s1' and s.rev > (select src_rev from tst.osp_rev) and s.rev > c.rev$q$, true), 'ok:1');
select tst.expect('порядок BEFORE-триггеров desk_rows: стражи → статус → rev',
  tst.try('PO', $q$select 1 where (select string_agg(tgname, ',' order by tgname) from pg_trigger
    where tgrelid = 'public.desk_rows'::regclass and not tgisinternal)
    = 'desk_rows_guard,desk_rows_os_managed,desk_rows_os_status_push,desk_rows_rev'$q$, true), 'ok:1');

-- --- Гонка прохода: «подтянуть» по устаревшему списку не шлётся назад ---
select tst.run('POS1', $q$select rows_patch('WP','osdesk_POS1','','s1','{"status":"fresh"}'::jsonb)$q$);
select tst.expect('устаревший pull (status + osStatusSent = старое) — запись проходит',
  tst.try('POS1', $q$select rows_patch('WP','osdesk_POS1','','s1','{"status":"old","osStatusSent":"old"}'::jsonb)$q$), 'ok:1');
select tst.run('POS1', $q$select rows_patch('WP','osdesk_POS1','','s1','{"status":"old","osStatusSent":"old"}'::jsonb)$q$);
select tst.expect('…и технарю НЕ уходит: в копии новый статус ОС',
  tst.try('PT1', $q$select 1 from desk_rows where workspace_id='WP' and page_id='PP1' and id='os_s1' and cells->>'status'='fresh'$q$, true), 'ok:1');
select tst.expect('…строка ОС хранит то, что записал проход (он же и исправит)',
  tst.try('POS1', $q$select 1 from desk_rows where workspace_id='WP' and page_id='osdesk_POS1' and id='s1' and cells->>'status'='old' and cells->>'osStatusSent'='old'$q$, true), 'ok:1');
select tst.run('POS1', $q$select rows_patch('WP','osdesk_POS1','','s1','{"status":"fresh","osStatusSent":"fresh"}'::jsonb)$q$);
select tst.expect('следующий pull по свежему списку сходится: обе стороны fresh',
  tst.try('PO', $q$select 1 from desk_rows s join desk_rows c on c.workspace_id='WP' and c.page_id='PP1' and c.id='os_s1'
    where s.workspace_id='WP' and s.page_id='osdesk_POS1' and s.id='s1' and s.cells->>'status'='fresh' and c.cells->>'status'='fresh'$q$, true), 'ok:1');
-- Честный pull: Тимлид поставил «Успешку» у технаря, проход тянет её к ОС.
select tst.run('PTL', $q$select rows_patch('WP','PP1','m9','os_s1','{"status":"success"}'::jsonb)$q$);
select tst.expect('Тимлид ставит «Успешку» в копии',
  tst.try('PT1', $q$select 1 from desk_rows where workspace_id='WP' and page_id='PP1' and id='os_s1' and cells->>'status'='success'$q$, true), 'ok:1');
select tst.expect('проход тянет «Успешку» к ОС — запись проходит',
  tst.try('POS1', $q$select rows_patch('WP','osdesk_POS1','','s1','{"status":"success","osStatusSent":"success"}'::jsonb)$q$), 'ok:1');

-- --- Петля адресов на своём столе ОС не роняет правку --------------------
select tst.run('POS1', $q$insert into desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at,
    os_uid, tech_uid, status_key, src_page_id, src_tab_id, src_row_id, mirror_page_id, mirror_tab_id, mirror_row_id) values
  ('WP','osdesk_POS1','','cy1','{"status":"a"}',20,1000,1000,'POS1','POS1','status','osdesk_POS1','','cy2','osdesk_POS1','','cy2'),
  ('WP','osdesk_POS1','','cy2','{"status":"a"}',21,1000,1000,'POS1','POS1','status','osdesk_POS1','','cy1','osdesk_POS1','','cy1')$q$);
select tst.expect('петля A → B → A: правка строки ОС проходит без ошибки',
  tst.try('POS1', $q$select rows_patch('WP','osdesk_POS1','','cy1','{"status":"loop"}'::jsonb)$q$), 'ok:1');
select tst.run('POS1', $q$select rows_patch('WP','osdesk_POS1','','cy1','{"status":"loop"}'::jsonb)$q$);
select tst.expect('…вторая строка петли получила статус ровно один раз (без рекурсии)',
  tst.try('POS1', $q$select 1 from desk_rows where workspace_id='WP' and page_id='osdesk_POS1' and id in ('cy1','cy2') and cells->>'status'='loop'$q$, true), 'ok:2');

-- --- Кому копию трогать нельзя — правка строки ОС всё равно проходит -----
select tst.run('PO', $q$select rows_set_desk_mode('WP', 'os')$q$);
select tst.expect('os: технарь с правкой стола ОС меняет там статус — запись проходит',
  tst.try('PTE', $q$select rows_patch('WP','osdesk_POS1','','e1','{"status":"by_pte"}'::jsonb)$q$), 'ok:1');
select tst.run('PTE', $q$select rows_patch('WP','osdesk_POS1','','e1','{"status":"by_pte"}'::jsonb)$q$);
select tst.expect('…но свою копию заказа ОС он так не правит (замок цел)',
  tst.try('PTE', $q$select 1 from desk_rows where workspace_id='WP' and page_id='PP3' and id='os_e1' and cells->>'status'='work'$q$, true), 'ok:1');
select tst.expect('…и osStatusSent на строке ОС не ставится (доставки не было)',
  tst.try('PTE', $q$select 1 from desk_rows where workspace_id='WP' and page_id='osdesk_POS1' and id='e1' and cells->>'osStatusSent'='work'$q$, true), 'ok:1');
select tst.run('PO', $q$select rows_set_desk_mode('WP', 'tech')$q$);
select tst.run('PTE', $q$select rows_patch('WP','osdesk_POS1','','e1','{"status":"by_pte2"}'::jsonb)$q$);
select tst.expect('tech: тот же технарь — копия получает статус (он и так её правит)',
  tst.try('PTE', $q$select 1 from desk_rows where workspace_id='WP' and page_id='PP3' and id='os_e1' and cells->>'status'='by_pte2'$q$, true), 'ok:1');
select tst.run('PO', $q$select rows_set_desk_mode('WP', 'os')$q$);
select tst.expect('os: технарь по-прежнему НЕ меняет статус копии сам',
  tst.try('PT1', $q$select rows_patch('WP','PP1','m9','os_s1','{"status":"x"}'::jsonb)$q$), 'error');

-- --- После «Вернуть» (Owner снял управление) статус не уходит ------------
select tst.run('PO', $q$select rows_patch(p_workspace => 'WP', p_page => 'PP1', p_tab => 'm8', p_id => 'os_s2', p_release_order => true)$q$);
select tst.expect('после снятия управления правка статуса ОС проходит',
  tst.try('POS1', $q$select rows_patch('WP','osdesk_POS1','','s2','{"status":"after_release"}'::jsonb)$q$), 'ok:1');
select tst.run('POS1', $q$select rows_patch('WP','osdesk_POS1','','s2','{"status":"after_release"}'::jsonb)$q$);
select tst.expect('…и до технаря НЕ доходит (строка уже не заказ ОС)',
  tst.try('PT1', $q$select 1 from desk_rows where workspace_id='WP' and page_id='PP1' and id='os_s2' and cells->>'st2'='wait' and os_uid is null$q$, true), 'ok:1');
select tst.expect('…osStatusSent не ставится',
  tst.try('POS1', $q$select 1 from desk_rows where workspace_id='WP' and page_id='osdesk_POS1' and id='s2' and cells->>'osStatusSent' = 'after_release'$q$, true), 'ok:0');

-- --- Выдача (pushOrderToTech / довоз с биржи) работает как раньше -------
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at) values
  ('WP', 'osdesk_POS1', '', 'h1', '{"client":"С биржи","status":"approval"}', 30, 1000, 1000),
  ('WP', 'osdesk_POS1', '', 'h2', '{"client":"С биржи 2","status":"approval"}', 31, 1000, 1000);
select tst.expect('выдача: ОС заводит копию у технаря',
  tst.try('POS1', $q$select rows_patch(p_workspace => 'WP', p_page => 'PP1', p_tab => 'm9', p_id => 'os_h1',
    p_cells => '{"client":"С биржи","status":"work"}'::jsonb, p_highlight => true, p_os_uid => 'POS1', p_tech_uid => 'PT1',
    p_status_key => 'status', p_sync_hash => 'hh', p_src_page => 'osdesk_POS1', p_src_tab => '', p_src_row => 'h1')$q$), 'ok:1');
select tst.run('POS1', $q$select rows_patch(p_workspace => 'WP', p_page => 'PP1', p_tab => 'm9', p_id => 'os_h1',
    p_cells => '{"client":"С биржи","status":"work"}'::jsonb, p_highlight => true, p_os_uid => 'POS1', p_tech_uid => 'PT1',
    p_status_key => 'status', p_sync_hash => 'hh', p_src_page => 'osdesk_POS1', p_src_tab => '', p_src_row => 'h1')$q$);
select tst.expect('выдача: адрес копии + статус на строке ОС одной записью — проходит',
  tst.try('POS1', $q$select rows_patch(p_workspace => 'WP', p_page => 'osdesk_POS1', p_tab => '', p_id => 'h1',
    p_cells => '{"status":"work","technician":"t1","osIssuedAt":"9"}'::jsonb, p_sync_hash => 'hh',
    p_mirror_page => 'PP1', p_mirror_tab => 'm9', p_mirror_row => 'os_h1')$q$), 'ok:1');
select tst.run('POS1', $q$select rows_patch(p_workspace => 'WP', p_page => 'osdesk_POS1', p_tab => '', p_id => 'h1',
    p_cells => '{"status":"work","technician":"t1","osIssuedAt":"9"}'::jsonb, p_sync_hash => 'hh',
    p_mirror_page => 'PP1', p_mirror_tab => 'm9', p_mirror_row => 'os_h1')$q$);
select tst.expect('…копия со статусом work, на строке ОС osStatusSent = work',
  tst.try('PO', $q$select 1 from desk_rows s join desk_rows c on c.workspace_id='WP' and c.page_id='PP1' and c.id='os_h1'
    where s.workspace_id='WP' and s.page_id='osdesk_POS1' and s.id='h1' and c.cells->>'status'='work' and s.cells->>'osStatusSent'='work'$q$, true), 'ok:1');
select tst.run('POS1', $q$select rows_patch(p_workspace => 'WP', p_page => 'PP1', p_tab => 'm9', p_id => 'os_h2',
    p_cells => '{"client":"С биржи 2","status":"work"}'::jsonb, p_os_uid => 'POS1', p_tech_uid => 'PT1',
    p_status_key => 'status', p_sync_hash => 'hh2', p_src_page => 'osdesk_POS1', p_src_tab => '', p_src_row => 'h2')$q$);
select tst.expect('выдача с osStatusSent в той же записи (служебные ячейки прохода) — проходит',
  tst.try('POS1', $q$select rows_patch(p_workspace => 'WP', p_page => 'osdesk_POS1', p_tab => '', p_id => 'h2',
    p_cells => '{"status":"work","osStatusSent":"work"}'::jsonb, p_sync_hash => 'hh2',
    p_mirror_page => 'PP1', p_mirror_tab => 'm9', p_mirror_row => 'os_h2')$q$), 'ok:1');
select tst.run('POS1', $q$select rows_patch(p_workspace => 'WP', p_page => 'osdesk_POS1', p_tab => '', p_id => 'h2',
    p_cells => '{"status":"work","osStatusSent":"work"}'::jsonb, p_sync_hash => 'hh2',
    p_mirror_page => 'PP1', p_mirror_tab => 'm9', p_mirror_row => 'os_h2')$q$);
select tst.run('POS1', $q$select rows_patch('WP','osdesk_POS1','','h2','{"status":"paid"}'::jsonb)$q$);
select tst.expect('…дальше статус ОС по этой выдаче доезжает сам',
  tst.try('PT1', $q$select 1 from desk_rows where workspace_id='WP' and page_id='PP1' and id='os_h2' and cells->>'status'='paid'$q$, true), 'ok:1');

-- --- Права на функции файла и версия схемы -------------------------------
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'tst_nobody') then create role tst_nobody nologin; end if;
end $$;
select tst.expect('версия схемы — не ниже 20261002 (и анонимному ключу)',
  tst.try('__anon_key__', $q$select 1 where nova_schema_version() >= '20261002'$q$, true), 'ok:1');
select tst.expect('триггерную функцию ролям API не вызвать',
  tst.try('PO', $q$select 1 where not has_function_privilege('anon', 'public.desk_rows_os_status_push()', 'execute')
    and not has_function_privilege('authenticated', 'public.desk_rows_os_status_push()', 'execute')$q$, true), 'ok:1');
select tst.expect('новые функции ролям API — только EXECUTE, PUBLIC — ничего',
  tst.try('PO', $q$select 1 where
        has_function_privilege('anon', 'public.rows_os_claim_order(text,text,text,text,bigint,text,jsonb,jsonb,text,bigint,text)', 'execute')
    and has_function_privilege('anon', 'public.rows_os_release_claim(text,text,text,text,boolean)', 'execute')
    and has_function_privilege('anon', 'public.rows_os_claimable(text,integer)', 'execute')
    and has_function_privilege('authenticated', 'public.nova_schema_version()', 'execute')
    and not has_function_privilege('tst_nobody', 'public.rows_os_claim_order(text,text,text,text,bigint,text,jsonb,jsonb,text,bigint,text)', 'execute')
    and not has_function_privilege('tst_nobody', 'public.rows_os_release_claim(text,text,text,text,boolean)', 'execute')
    and not has_function_privilege('tst_nobody', 'public.rows_os_claimable(text,integer)', 'execute')
    and not has_function_privilege('tst_nobody', 'public.nova_schema_version()', 'execute')
    and not has_function_privilege('tst_nobody', 'public.desk_rows_os_status_push()', 'execute')$q$, true), 'ok:1');

-- Повторный накат поверх «открытых» прав (как default privileges Supabase).
grant all on function public.desk_rows_os_status_push() to anon, authenticated, public;
grant all on function public.rows_os_claim_order(text, text, text, text, bigint, text, jsonb, jsonb, text, bigint, text) to public;
\ir ../migrations/20261002_os_sync.sql
\ir ../migrations/20261004_exchange_claim.sql
\ir ../migrations/20261007_carry_over.sql
select tst.expect('после повторного наката триггерная функция снова закрыта',
  tst.try('PO', $q$select 1 where not has_function_privilege('anon', 'public.desk_rows_os_status_push()', 'execute')
    and not has_function_privilege('tst_nobody', 'public.desk_rows_os_status_push()', 'execute')
    and not has_function_privilege('tst_nobody', 'public.rows_os_claim_order(text,text,text,text,bigint,text,jsonb,jsonb,text,bigint,text)', 'execute')$q$, true), 'ok:1');
select tst.expect('после повторного наката триггер ровно один',
  tst.try('PO', $q$select 1 from pg_trigger where tgrelid='public.desk_rows'::regclass and tgname='desk_rows_os_status_push'$q$, true), 'ok:1');
select tst.run('POS1', $q$select rows_patch('WP','osdesk_POS1','','s1','{"status":"again"}'::jsonb)$q$);
select tst.expect('после повторного наката статус доезжает',
  tst.try('PT1', $q$select 1 from desk_rows where workspace_id='WP' and page_id='PP1' and id='os_s1' and cells->>'status'='again'$q$, true), 'ok:1');

select case when ok then '  OK  ' else 'FAIL  ' end || label || case when ok then '' else '  → ' || got end
from tst.results order by n;
select format('ПРОВЕРОК (статус ОС → технарь): %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
