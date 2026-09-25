-- =====================================================================
-- «Технари заполняют сами» (20261001_tech_fill.sql). Запуск ПОСЛЕ
-- desk_rows_rls.sql (берёт его схему tst и участников: O — Owner, T1/T2 —
-- технари со столами P1/P2, TL — Тимлид, OS1 — ОС, X — посторонний).
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;
truncate tst.results;

insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at, os_uid, tech_uid, status_key, src_page_id, src_row_id, sync_hash) values
  ('W', 'P1', '', 'tf1', '{"client":"Заказ ОС","status":"work","price":"100"}', 60, 1000, 1000, 'OS1', 'T1', 'status', 'osdesk_OS1', 'src1', 'h1'),
  ('W', 'P2', '', 'tf2', '{"client":"Заказ ОС 2","status":"work"}', 60, 1000, 1000, 'OS1', 'T2', 'status', 'osdesk_OS1', 'src2', 'h2');
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at) values
  ('W', 'P1', '', 'tfp', '{"client":"Свой","status":"work"}', 61, 1000, 1000);

-- --- Режим «заказы ведёт ОС» ------------------------------------------
select tst.expect('посторонний режим не ставит',
  tst.try('X', $q$select rows_set_desk_mode('W', 'tech')$q$), 'error');
select tst.expect('технарь режим не ставит',
  tst.try('T1', $q$select rows_set_desk_mode('W', 'tech')$q$), 'error');
select tst.expect('Тимлид режим не ставит',
  tst.try('TL', $q$select rows_set_desk_mode('W', 'tech')$q$), 'error');
select tst.expect('ОС режим не ставит',
  tst.try('OS1', $q$select rows_set_desk_mode('W', 'os')$q$), 'error');
select tst.expect('неизвестный режим отклоняется',
  tst.try('O', $q$select rows_set_desk_mode('W', 'всё')$q$), 'error');
select tst.run('O', $q$select rows_set_desk_mode('W', 'os')$q$);
select tst.expect('режим читается: os',
  tst.try('T1', $q$select 1 where rows_desk_mode('W') = 'os'$q$, true), 'ok:1');

select tst.expect('os: технарь НЕ меняет статус заказа ОС',
  tst.try('T1', $q$update desk_rows set cells = cells || '{"status":"done"}'::jsonb where workspace_id='W' and page_id='P1' and tab_id='' and id='tf1'$q$), 'error');
select tst.expect('os: технарь НЕ меняет статус своей строки',
  tst.try('T1', $q$update desk_rows set cells = cells || '{"status":"done"}'::jsonb where workspace_id='W' and page_id='P1' and tab_id='' and id='tfp'$q$), 'error');
select tst.expect('os: ссылку на работу технарь пишет',
  tst.try('T1', $q$update desk_rows set cells = cells || '{"techLink":"https://x"}'::jsonb where workspace_id='W' and page_id='P1' and tab_id='' and id='tf1'$q$), 'ok:1');

-- --- Выборочно: стол P1 заполняет сам ---------------------------------
select tst.run('O', $q$select rows_set_desk_os_exempt('W', 'P1', true)$q$);
select tst.expect('выборочно: технарь ставит статус в заказе ОС',
  tst.try('T1', $q$update desk_rows set cells = cells || '{"status":"done"}'::jsonb where workspace_id='W' and page_id='P1' and tab_id='' and id='tf1'$q$), 'ok:1');
select tst.expect('выборочно: технарь правит цену и клиента заказа ОС',
  tst.try('T1', $q$select rows_patch('W','P1','','tf1','{"price":"500","client":"Иван"}'::jsonb)$q$), 'ok:1');
select tst.expect('выборочно: визитку заказа технарь правит',
  tst.try('T1', $q$update desk_rows set extras = '{"persons":2}'::jsonb where workspace_id='W' and page_id='P1' and tab_id='' and id='tf1'$q$), 'ok:1');
select tst.expect('выборочно: свою строку технарь правит',
  tst.try('T1', $q$update desk_rows set cells = cells || '{"status":"done"}'::jsonb where workspace_id='W' and page_id='P1' and tab_id='' and id='tfp'$q$), 'ok:1');
select tst.expect('выборочно: метку ОС технарь НЕ снимает',
  tst.try('T1', $q$update desk_rows set os_uid = null where workspace_id='W' and page_id='P1' and tab_id='' and id='tf1'$q$), 'error');
select tst.expect('выборочно: адрес источника технарь НЕ меняет',
  tst.try('T1', $q$update desk_rows set src_row_id = 'other' where workspace_id='W' and page_id='P1' and tab_id='' and id='tf1'$q$), 'error');
select tst.expect('выборочно: подпись заказа технарь НЕ меняет',
  tst.try('T1', $q$update desk_rows set sync_hash = 'x' where workspace_id='W' and page_id='P1' and tab_id='' and id='tf1'$q$), 'error');
select tst.expect('выборочно: заказ ОС технарь НЕ удаляет',
  tst.try('T1', $q$delete from desk_rows where workspace_id='W' and page_id='P1' and tab_id='' and id='tf1'$q$), 'deny');
select tst.expect('выборочно: просьбу за другого не оставить',
  tst.try('T1', $q$update desk_rows set success_requested_by = 'T2', success_requested_at = 1 where workspace_id='W' and page_id='P1' and tab_id='' and id='tf1'$q$), 'error');
select tst.expect('выборочно: другой технарь без исключения заперт',
  tst.try('T2', $q$update desk_rows set cells = cells || '{"status":"done"}'::jsonb where workspace_id='W' and page_id='P2' and tab_id='' and id='tf2'$q$), 'error');
select tst.run('O', $q$select rows_set_desk_os_exempt('W', 'P1', false)$q$);
select tst.expect('исключение снято — заказ ОС снова заперт',
  tst.try('T1', $q$update desk_rows set cells = cells || '{"status":"x"}'::jsonb where workspace_id='W' and page_id='P1' and tab_id='' and id='tf1'$q$), 'error');

-- --- Все технари заполняют сами ---------------------------------------
select tst.run('O', $q$select rows_set_desk_mode('W', 'tech')$q$);
select tst.expect('режим читается: tech',
  tst.try('T2', $q$select 1 where rows_desk_mode('W') = 'tech'$q$, true), 'ok:1');
select tst.expect('tech: технарь P1 ставит статус в заказе ОС',
  tst.try('T1', $q$update desk_rows set cells = cells || '{"status":"work"}'::jsonb where workspace_id='W' and page_id='P1' and tab_id='' and id='tf1'$q$), 'ok:1');
select tst.expect('tech: технарь P2 ставит статус в заказе ОС',
  tst.try('T2', $q$update desk_rows set cells = cells || '{"status":"done"}'::jsonb where workspace_id='W' and page_id='P2' and tab_id='' and id='tf2'$q$), 'ok:1');
select tst.expect('tech: свою строку технарь правит (os_managed снят)',
  tst.try('T1', $q$update desk_rows set cells = cells || '{"status":"work"}'::jsonb where workspace_id='W' and page_id='P1' and tab_id='' and id='tfp'$q$), 'ok:1');
select tst.expect('tech: чужой стол по-прежнему закрыт (T2 в P1)',
  tst.try('T2', $q$update desk_rows set cells = cells || '{"status":"x"}'::jsonb where workspace_id='W' and page_id='P1' and tab_id='' and id='tf1'$q$), 'deny');
select tst.expect('tech: метку ОС технарь НЕ снимает',
  tst.try('T2', $q$update desk_rows set os_uid = null where workspace_id='W' and page_id='P2' and tab_id='' and id='tf2'$q$), 'error');
select tst.expect('tech: ОС по-прежнему правит свой заказ',
  tst.try('OS1', $q$select rows_patch('W','P2','','tf2','{"price":"700"}'::jsonb)$q$), 'ok:1');

-- Старый переключатель «заказы ведёт ОС» гасит режим tech.
select tst.run('O', $q$select rows_set_os_managed('W', true)$q$);
select tst.expect('rows_set_os_managed(true) гасит tech',
  tst.try('T1', $q$select 1 where rows_desk_mode('W') = 'os'$q$, true), 'ok:1');
select tst.expect('после гашения заказ ОС снова заперт',
  tst.try('T2', $q$update desk_rows set cells = cells || '{"status":"x"}'::jsonb where workspace_id='W' and page_id='P2' and tab_id='' and id='tf2'$q$), 'error');

-- --- Как было: свои строки свободны, заказы ОС заперты ----------------
select tst.run('O', $q$select rows_set_desk_mode('W', 'mixed')$q$);
select tst.expect('mixed: свою строку технарь правит',
  tst.try('T1', $q$update desk_rows set cells = cells || '{"status":"done"}'::jsonb where workspace_id='W' and page_id='P1' and tab_id='' and id='tfp'$q$), 'ok:1');
select tst.expect('mixed: заказ ОС заперт',
  tst.try('T1', $q$update desk_rows set cells = cells || '{"status":"done"}'::jsonb where workspace_id='W' and page_id='P1' and tab_id='' and id='tf1'$q$), 'error');

-- Повторный накат файла не ломает режим и замок. desk_rows_guard с 24.09.2026
-- живёт в 20261002_os_sync.sql (ветка «ОС возвращает строку технарю»), и
-- повтор ОДНОГО раннего файла вернул бы старый guard — поэтому, как каскад
-- scripts/supabase-sql.mjs, следом накатываются и файлы после него.
\ir ../migrations/20261001_tech_fill.sql
\ir ../migrations/20261002_os_sync.sql
\ir ../migrations/20261004_exchange_claim.sql
\ir ../migrations/20261007_carry_over.sql
select tst.expect('после каскадного наката guard — версия с веткой возврата (20261002)',
  tst.try('O', $q$select 1 from pg_proc where proname = 'desk_rows_guard' and prosrc like '%вернуть строку технарю%'$q$, true), 'ok:1');
select tst.expect('после повторного наката режим mixed на месте',
  tst.try('T1', $q$select 1 where rows_desk_mode('W') = 'mixed'$q$, true), 'ok:1');
select tst.expect('после повторного наката заказ ОС заперт',
  tst.try('T1', $q$update desk_rows set cells = cells || '{"status":"x"}'::jsonb where workspace_id='W' and page_id='P1' and tab_id='' and id='tf1'$q$), 'error');
select tst.expect('триггер замка ровно один',
  tst.try('O', $q$select 1 from pg_trigger where tgrelid = 'public.desk_rows'::regclass and tgname = 'desk_rows_guard'$q$, true), 'ok:1');

select label, got from tst.results where not ok;
select format('ПРОВЕРОК: %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
