-- =====================================================================
-- 20261045_tech_sync.sql: технарь «заполняет сам» → стол ОС сам и сразу.
-- Запуск после desk_rows_rls.sql (схема tst). Свой workspace WT:
--   TO — Owner; TLP — Тимлид+; TTL — Тимлид; TV — Viewer; TX — посторонний;
--   технари: TT1 (стол PT1, ник nick_t1), TT2 (PT2 — НЕ «заполняет сам»),
--     TT3 (PT3, без ника), TT4 и TT4B (ник dup — у двоих; стол PT4),
--     TT5 (PT5 — карта столбцов от вкладки прошлого периода),
--     TT6 (PTO — стол «только для Owner»), TT7 (PT7 — перебор без списка);
--   ОС: TOS1 «anna» (стол со СВОИМИ ключами статуса stx и технаря techx),
--     TOS2 «bella» (стола нет), TOS3 «vera» (стол, вкладки периода ещё нет),
--     TOS4 и TOS4B «dupos» (ник у двоих), TOS5 «dina» (стол без документа).
-- Вкладка текущего периода столов технарей — tst.tab() (month-{период}).
-- Итог — строка «ПРОВЕРОК: N, ПРОВАЛЕНО: 0».
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;
truncate tst.results;

\ir ../migrations/20261045_tech_sync.sql

-- ---------------------------------------------------------------------
-- Помощники набора.
-- ---------------------------------------------------------------------
-- Выполнить sql от лица uid, ОСТАВИТЬ результат, вернуть первое значение.
create or replace function tst.tsv(uid text, sql text) returns text language plpgsql as $$
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

-- Прочитать одно значение ОТДЕЛЬНЫМ запросом (свой снимок): в одном выражении
-- с действием обычный подзапрос может увидеть состояние ДО действия.
create or replace function tst.q(sql text) returns text language plpgsql as $$
declare v text;
begin
  execute sql into v;
  return v;
end;
$$;

-- ---------------------------------------------------------------------
-- 1. Порты JS-помощников — те же векторы, что в юнит-проверках клиента.
-- ---------------------------------------------------------------------
-- rows_js_trim (String.trim): пробел, таб, перевод строки, NBSP, BOM.
select tst.expect('trim: NBSP, BOM и переводы строк по краям снимаются',
  public.rows_js_trim(U&'\00A0\FEFF \0009 Аня\00A0Б \000A\2003'), U&'Аня\00A0Б');
select tst.expect('trim: null → пустая строка', public.rows_js_trim(null), '');

-- rows_num_loose (parseLooseNumber, src/utils/numberInput.ts:5-11 и ветки).
select tst.expect('число: векторы parseLooseNumber',
  (select string_agg(coalesce(public.rows_num_loose(v.raw)::text, 'null'), '|' order by v.n) from (values
    (1, '1 500'), (2, '1 500,50'), (3, '2.000'), (4, '2.5'), (5, '12 000 ₸'), (6, '-300'), (7, '1500=1200+300'),
    (8, '1,234.56'), (9, '1.234,56'), (10, '2,000'), (11, '2,5'), (12, '1,2,3'), (13, '100 тг.'), (14, 'РУБ 5'),
    (15, 'abc'), (16, ''), (17, '+5'), (18, '5+'), (19, '1.5.'), (20, U&'1\00A0500'), (21, '$100'), (22, '1.2.3'),
    (23, '5-3'), (24, '.5'), (25, '7 Тенге'), (26, '10 kzt'), (27, '--5'), (28, ','), (29, '0'), (30, '1 000 000,5')
  ) v(n, raw)),
  '1500|1500.50|2000|2.5|12000|-300|null|1234.56|1234.56|2000|2.5|123|100|5|null|null|5|null|1.5|1500|100|123|null|0.5|7|10|null|null|0|1000000.5');
select tst.expect('число → текст: как String(round2(n))',
  (select string_agg(public.rows_num_text(v.x), '|' order by v.n) from (values
    (1, 1500.50::numeric), (2, 146000::numeric), (3, 0.5::numeric), (4, -300::numeric), (5, 99.999::numeric), (6, 0::numeric)) v(n, x)),
  '1500.5|146000|0.5|-300|100|0');

-- rows_os_total (osRowTotal): Kaspi 0 % + Lavatop 8 % = 146 000.
select tst.expect('«Итого»: 100 000 Kaspi + 50 000 Lavatop −8 % = 146 000',
  public.rows_os_total('{"price":"100000","price__fee":0,"upsell":"50 000","upsell__fee":8}'::jsonb, 'price', 'upsell')::text, '146000.00');
select tst.expect('«Итого»: денег нет → null',
  coalesce(public.rows_os_total('{"price":"","upsell":null}'::jsonb, 'price', 'upsell')::text, 'null'), 'null');
select tst.expect('«Итого»: комиссия зажата 0..100, мусор = 0, число числом',
  public.rows_os_total('{"p":2000.5,"p__fee":"150","u":"x","u__fee":"abc"}'::jsonb, 'p', 'u')::text, '0.00');

-- rows_os_cols_keys (resolveOsDeskKeys).
select tst.expect('ключи: столбцов нет → ключи нового стола ОС',
  public.rows_os_cols_keys(null)::text,
  '{"link": "link", "note": "note", "phone": "phone", "price": "price", "total": "total", "client": "client", "status": "status", "upsell": "upsell", "technician": "technician"}');
select tst.expect('ключи: пустой массив → те же',
  (public.rows_os_cols_keys('[]'::jsonb) = public.rows_os_cols_keys(null))::text, 'true');
select tst.expect('ключи: стол по умолчанию',
  (public.rows_os_cols_keys('[{"key":"client","label":"Имя","type":"text"},{"key":"osDates","label":"Даты","type":"text"},
    {"key":"status","label":"Статус","type":"status"},{"key":"technician","label":"Технарь","type":"technician"},
    {"key":"phone","label":"Номер","type":"phone"},{"key":"price","label":"Цена","type":"currency"},
    {"key":"upsell","label":"Апсейл","type":"currency"},{"key":"total","label":"Итого","type":"currency"},
    {"key":"note","label":"Примечание","type":"text"},{"key":"link","label":"Ссылка","type":"url"}]'::jsonb)
   = public.rows_os_cols_keys(null))::text, 'true');
select tst.expect('ключи: свои «Статус» и «Технарь» — по ТИПУ столбца',
  (select k ->> 'status' || '|' || (k ->> 'technician') || '|' || (k ->> 'client') from public.rows_os_cols_keys(
    '[{"key":"client","label":"Имя"},{"key":"status","label":"Старый","type":"text"},{"key":"col_7","label":"Статус","type":"status"},{"key":"col_9","type":"technician"}]'::jsonb) k),
  'col_7|col_9|client');
select tst.expect('ключи: по названиям (кириллица, оба регистра), телефон и ссылка — по типу',
  (select concat_ws('|', k ->> 'client', k ->> 'phone', k ->> 'price', k ->> 'upsell', k ->> 'note', k ->> 'link', k ->> 'total')
   from public.rows_os_cols_keys('[{"key":"a0","label":"№"},{"key":"a1","label":" КЛИЕНТ (имя)"},{"key":"a2","label":"телефон","type":"phone"},
     {"key":"a3","label":"сумма заказа"},{"key":"a4","label":"Доп. АПСЕЙЛ"},{"key":"a5","label":"Коммент"},
     {"key":"a6","label":"Адрес","type":"url"},{"key":"a7","label":"ИТОГО к оплате"}]'::jsonb) k),
  'a1|a2|a3|a4|a5|a6|a7');
select tst.expect('ключи: «Номер» по названию без типа; «цена» не с начала названия — не цена',
  (select concat_ws('|', k ->> 'phone', k ->> 'price', k ->> 'client') from public.rows_os_cols_keys(
    '[{"key":"z1","label":"Что-то"},{"key":"z2","label":"Старый номер"},{"key":"z3","label":"Итоговая цена"}]'::jsonb) k),
  'z2|price|z1');

-- rows_period_key (periodKeyFor + sanitizePeriods).
select tst.expect('период: векторы periodKeyFor',
  (select string_agg(public.rows_period_key(v.p::jsonb, v.at::timestamptz, 'Asia/Almaty'), '|' order by v.n) from (values
    (1, '{}', '2026-10-05 12:00+05'),
    (2, '{"from":"2026-10","splitDay":15}', '2026-10-15 23:59+05'),
    (3, '{"from":"2026-10","splitDay":15}', '2026-10-16 00:00+05'),
    (4, '{"from":"2026-11","splitDay":15}', '2026-10-20 12:00+05'),
    (5, '{"from":"2026-09","until":"2026-10"}', '2026-10-20 12:00+05'),
    (6, '{"from":"2026-09","until":"2026-10"}', '2026-09-20 12:00+05'),
    (7, '{"from":"2026-10","until":"2026-10"}', '2026-10-20 12:00+05'),
    (8, '{"from":"2026-10","splitDay":25}', '2026-10-20 12:00+05'),
    (9, '{"from":"2026-10","splitDay":25}', '2026-10-21 12:00+05'),
    (10, '{"from":"2026-10","splitDay":null}', '2026-10-11 12:00+05'),
    (11, '{"from":"2026-10","splitDay":"12"}', '2026-10-12 12:00+05'),
    (12, '{}', '2026-09-30 20:00+00'),
    (13, '{"from":"2026-1","until":"x"}', '2026-10-20 12:00+05'),
    (14, '{"until":"2026-12"}', '2026-10-20 12:00+05'),
    (15, 'null', '2026-02-28 23:00+05'),
    (16, '{"from":"2026-10","splitDay":15.9}', '2026-10-16 12:00+05')
  ) v(n, p, at)),
  '2026-10|2026-10-1|2026-10-2|2026-10|2026-10|2026-09-2|2026-10|2026-10-1|2026-10-2|2026-10-2|2026-10-1|2026-10|2026-10|2026-10|2026-02|2026-10-2');
select tst.expect('период: пояс компании — тот же момент в Нью-Йорке ещё сентябрь',
  public.rows_period_key('{}'::jsonb, '2026-09-30 20:00+00'::timestamptz, 'America/New_York'), '2026-09');

-- ---------------------------------------------------------------------
-- 2. Данные (от суперпользователя). Копии прав ведут триггеры core_docs.
-- ---------------------------------------------------------------------
insert into public.rows_workspaces (workspace_id, owner_id, live) values ('WT', 'TO', true);
insert into public.core_docs (workspace_id, kind, parent_id, id, data) values
  ('WT', 'workspace', '', 'WT', '{"name":"Тест","techFillsAll":false,"osManagedDesks":false}'),
  ('WT', 'meta', '', 'imported_page', '{"at":1}'),
  ('WT', 'meta', '', 'imported_member', '{"at":1}');
insert into public.core_docs (workspace_id, kind, parent_id, id, data) values
  ('WT', 'member', '', 'TO', '{"uid":"TO","role":"owner","status":"active"}'),
  ('WT', 'member', '', 'TLP', '{"uid":"TLP","role":"leadplus","status":"active"}'),
  ('WT', 'member', '', 'TTL', '{"uid":"TTL","role":"teamlead","status":"active"}'),
  ('WT', 'member', '', 'TV', '{"uid":"TV","role":"viewer","status":"active"}'),
  ('WT', 'member', '', 'TT1', '{"uid":"TT1","role":"manager","status":"active","techNickValue":" nick_t1 "}'),
  ('WT', 'member', '', 'TT2', '{"uid":"TT2","role":"manager","status":"active","techNickValue":"nick_t2"}'),
  ('WT', 'member', '', 'TT3', '{"uid":"TT3","role":"manager","status":"active"}'),
  ('WT', 'member', '', 'TT4', '{"uid":"TT4","role":"manager","status":"active","techNickValue":"dup"}'),
  ('WT', 'member', '', 'TT4B', '{"uid":"TT4B","role":"manager","status":"active","techNickValue":"dup"}'),
  ('WT', 'member', '', 'TT5', '{"uid":"TT5","role":"manager","status":"active","techNickValue":"nick_t5"}'),
  ('WT', 'member', '', 'TT6', '{"uid":"TT6","role":"manager","status":"active","techNickValue":"nick_t6"}'),
  ('WT', 'member', '', 'TT7', '{"uid":"TT7","role":"manager","status":"active","techNickValue":"nick_t7"}'),
  ('WT', 'member', '', 'TOS1', '{"uid":"TOS1","role":"os","status":"active","osNickValue":"anna"}'),
  ('WT', 'member', '', 'TOS2', '{"uid":"TOS2","role":"os","status":"active","osNickValue":"bella"}'),
  ('WT', 'member', '', 'TOS3', '{"uid":"TOS3","role":"manager","extraRoles":["os"],"status":"active","osNickValue":"vera","techNickValue":"nick_os3"}'),
  ('WT', 'member', '', 'TOS4', '{"uid":"TOS4","role":"os","status":"active","osNickValue":"dupos"}'),
  ('WT', 'member', '', 'TOS4B', '{"uid":"TOS4B","role":"os","status":"active","osNickValue":"dupos"}'),
  ('WT', 'member', '', 'TOS5', '{"uid":"TOS5","role":"os","status":"active","osNickValue":"dina"}'),
  -- «anna» стоит и у технаря без роли ОС: ник ищется только среди ОС.
  ('WT', 'member', '', 'TT8', '{"uid":"TT8","role":"manager","status":"active","osNickValue":"anna","techNickValue":"nick_t8"}');

-- Вкладка текущего периода (целые месяцы) — константой на весь набор.
do $$
begin
  execute format('create or replace function tst.tab() returns text language sql immutable as %L',
    'select ' || quote_literal('month-' || public.rows_period_now('WT')));
  execute format('create or replace function tst.per() returns text language sql immutable as %L',
    'select ' || quote_literal(public.rows_period_now('WT')));
end $$;
grant usage on schema tst to anon;
grant execute on function tst.tab(), tst.per() to anon;
select tst.expect('период из настроек workspace — текущий месяц по Алматы',
  tst.per(), to_char(now() at time zone 'Asia/Almaty', 'YYYY-MM'));

-- Столы технарей: карта столбцов (свой ключ статуса st) от вкладки периода.
insert into public.core_docs (workspace_id, kind, parent_id, id, data)
select 'WT', 'page', '', p.id, jsonb_build_object('id', p.id, 'workspaceId', 'WT', 'name', p.id,
    'responsibleUserId', p.resp, 'createdBy', p.resp, 'allowedUsers', jsonb_build_array(p.resp),
    'osFieldKeys', jsonb_build_object('tabId', coalesce(p.tab, tst.tab()), 'at', 1, 'client', 'client', 'phone', 'phone',
      'price', 'price', 'status', 'st', 'os', 'os', 'link', 'link'))
from (values ('PT1', 'TT1', null), ('PT2', 'TT2', null), ('PT3', 'TT3', null), ('PT4', 'TT4', null),
             ('PT5', 'TT5', 'month-2020-01'), ('PTO', 'TT6', null), ('PT7', 'TT7', null)) p(id, resp, tab);
-- Столы ОС.
insert into public.core_docs (workspace_id, kind, parent_id, id, data) values
  ('WT', 'page', '', 'osdesk_TOS1', '{"id":"osdesk_TOS1","workspaceId":"WT","osDesk":true,"responsibleUserId":"TOS1","createdBy":"TOS1","allowedUsers":["TOS1"],
    "columns":[{"key":"client","label":"Имя","type":"text"},{"key":"stx","label":"Статус","type":"status"},{"key":"techx","label":"Технарь","type":"technician"},
      {"key":"phone","label":"Номер","type":"phone"},{"key":"price","label":"Цена","type":"currency"},{"key":"upsell","label":"Апсейл","type":"currency"},
      {"key":"total","label":"Итого","type":"currency"},{"key":"note","label":"Примечание","type":"text"},{"key":"link","label":"Ссылка","type":"url"}]}'),
  ('WT', 'page', '', 'osdesk_TOS3', '{"id":"osdesk_TOS3","workspaceId":"WT","osDesk":true,"responsibleUserId":"TOS3","createdBy":"TOS3","allowedUsers":["TOS3"],
    "mainTabMonthKey":"2020-01",
    "columns":[{"key":"client","label":"Имя","type":"text"},{"key":"status","label":"Статус","type":"status"},{"key":"technician","label":"Технарь","type":"technician"},
      {"key":"phone","label":"Номер","type":"phone"},{"key":"price","label":"Цена","type":"currency"},{"key":"upsell","label":"Апсейл","type":"currency"},
      {"key":"total","label":"Итого","type":"currency"},{"key":"note","label":"Примечание","type":"text"},{"key":"link","label":"Ссылка","type":"url"}]}');
-- Стол ОС «dina»: запись прав есть, документа стола в ядре нет.
insert into public.rows_page_acl (workspace_id, page_id, responsible_uid, created_by, os_desk, allowed_uids, editable_uids) values
  ('WT', 'osdesk_TOS5', 'TOS5', 'TOS5', true, '{TOS5}', '{}');
insert into public.rows_owner_only (workspace_id, page_id) values ('WT', 'PTO');
-- «Заполняет сам»: PT1, PT3, PT4, PT5, PTO, PT7 — выборочно; PT2 — нет.
insert into public.rows_os_exempt (workspace_id, page_id) values
  ('WT', 'PT3'), ('WT', 'PT4'), ('WT', 'PT5'), ('WT', 'PTO'), ('WT', 'PT7');

select tst.expect('копии прав собраны триггерами ядра (ОС, технари, столы, карта столбцов)',
  (select count(*)::text from public.rows_members where workspace_id = 'WT')
  || '|' || (select count(*)::text from public.rows_page_acl where workspace_id = 'WT')
  || '|' || (select os_keys_tab || '/' || os_key || '/' || os_status_key from public.rows_page_acl where workspace_id = 'WT' and page_id = 'PT1'),
  '19|10|' || tst.tab() || '/os/st');

insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, extras, sort_order, created_at, updated_at) values
  ('WT', 'PT1', tst.tab(), 't1', '{"client":" Клиент 1 ","phone":"+7 700","price":"50 000","os":"anna","st":"work","link":"http://x"}', '{"note":"пожелание","persons":2}', 0, 5000, 5000),
  ('WT', 'PT1', tst.tab(), 'u_noos', '{"client":"Без ОС"}', null, 1, 1000, 1000),
  ('WT', 'PT1', tst.tab(), 'u_nocl', '{"os":"anna"}', null, 2, 1000, 1000),
  ('WT', 'PT1', tst.tab(), 'u_blank', '{"client":"","os":""}', null, 3, 1000, 1000),
  ('WT', 'PT1', tst.tab(), 'os_zz', '{"client":"Копия ОС","os":"anna"}', null, 4, 1000, 1000),
  ('WT', 'PT1', tst.tab(), 'u_rel', '{"client":"Вернули","os":"anna","osReleasedFrom":"anna"}', null, 5, 1000, 1000),
  ('WT', 'PT1', tst.tab(), 'u_ghost', '{"client":"Нет такого ОС","os":"ghost"}', null, 6, 1000, 1000),
  ('WT', 'PT1', tst.tab(), 'u_dup', '{"client":"Ник у двоих","os":"dupos"}', null, 7, 1000, 1000),
  ('WT', 'PT1', tst.tab(), 'u_nodesk', '{"client":"Нет стола ОС","os":"bella"}', null, 8, 1000, 1000),
  ('WT', 'PT1', tst.tab(), 'u_nomap', '{"client":"Нет документа стола","os":"dina"}', null, 9, 1000, 1000),
  ('WT', 'PT1', 'other', 'u_tab', '{"client":"Другая вкладка","os":"anna"}', null, 0, 1000, 1000),
  ('WT', 'PT1', tst.tab(), 'R', '{"client":"Мой","os":"anna"}', null, 10, 1000, 1000),
  ('WT', 'PT1', tst.tab(), 'q1', '{"client":"Оба id заняты","os":"anna"}', null, 11, 1000, 1000),
  ('WT', 'PT1', tst.tab(), 'q2', '{"client":"Первый id занят","os":"anna"}', null, 12, 1000, 1000),
  ('WT', 'PT1', tst.tab(), 'q3', '{"client":"Источник в другой вкладке","os":"anna","price":"10"}', null, 13, 1000, 1000),
  ('WT', 'PT2', tst.tab(), 'm1', '{"client":"Смешанный","os":"anna","st":"work"}', null, 0, 1000, 1000),
  ('WT', 'PT3', tst.tab(), 'n1', '{"client":"Технарь без ника","os":"anna"}', null, 0, 1000, 1000),
  ('WT', 'PT4', tst.tab(), 'n2', '{"client":"Ник технаря у двоих","os":"anna"}', null, 0, 1000, 1000),
  ('WT', 'PT5', 'month-2020-01', 'n3', '{"client":"Прошлый период","os":"anna"}', null, 0, 1000, 1000),
  ('WT', 'PTO', tst.tab(), 'o1', '{"client":"Только Owner","os":"anna","st":"work"}', null, 0, 1000, 1000),
  ('WT', 'PT7', tst.tab(), 'e1', '{"client":"Перебор 1","os":"anna"}', null, 0, 1000, 1000),
  ('WT', 'PT7', tst.tab(), 'e2', '{"os":"anna"}', null, 1, 1000, 1000),
  ('WT', 'PT7', tst.tab(), 'e3', '{"client":"Без ОС"}', null, 2, 1000, 1000),
  ('WT', 'osdesk_TOS1', '', 'own1', '{"client":"Своё"}', null, 0, 1000, 1000);
-- Источник без адреса копии (ОС снял технаря) под id, выводимым из строки R.
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at) values
  ('WT', 'osdesk_TOS1', '', 'adopt_R', '{"client":"Чужой заказ","upsell":"7000"}', 5, 1000, 1000);
-- Оба выводимых id для q1 заняты источниками ДРУГИХ копий; для q2 — первый.
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at, mirror_page_id, mirror_tab_id, mirror_row_id) values
  ('WT', 'osdesk_TOS1', '', 'adopt_q1', '{"client":"Чужой 1"}', 6, 1000, 1000, 'PZ', 'q', 'q1'),
  ('WT', 'osdesk_TOS1', '', 'adopt_q1_' || substr(md5('PT1/' || tst.tab()), 1, 8), '{"client":"Чужой 2"}', 7, 1000, 1000, 'PZ', 'q', 'q1'),
  ('WT', 'osdesk_TOS1', '', 'adopt_q2', '{"client":"Чужой 3"}', 8, 1000, 1000, 'PZ', 'q', 'q2'),
  -- Источник q3 уже лежит в ДРУГОЙ вкладке стола ОС и показывает на q3.
  ('WT', 'osdesk_TOS1', 'oldtab', 'adopt_q3', '{"client":"Старое имя","note":"заметка ОС"}', 0, 1000, 1000, 'PT1', tst.tab(), 'q3');

-- Вызов rows_tech_sync от лица uid с сохранением результата.
create or replace function tst.ts_sync(uid text, pg text, rws text[] default null, force boolean default false, tb text default null)
returns jsonb language plpgsql as $$
declare res jsonb; items jsonb;
begin
  items := case when rws is null then null else (select coalesce(jsonb_agg(jsonb_build_object('row', x, 'hash', 'лишнее поле')), '[]'::jsonb) from unnest(rws) x) end;
  perform set_config('request.jwt.claims', tst.claims(uid), true);
  execute 'set local role anon';
  execute format('select public.rows_tech_sync(%L, %L, %L, %L::jsonb, %L)', 'WT', pg, coalesce(tb, tst.tab()), items, force) into res;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return res;
exception when others then
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return jsonb_build_object('status', 'error:' || sqlstate, 'message', sqlerrm);
end;
$$;
-- Код ответа по одной строке.
create or replace function tst.ts_code(uid text, pg text, rw text, force boolean default false, tb text default null) returns text
language sql as $$ select coalesce(j -> 'items' -> 0 ->> 'code', j ->> 'status') from tst.ts_sync(uid, pg, array[rw], force, tb) j $$;
-- Правка строки технаря (rows_patch) от лица uid с сохранением результата.
create or replace function tst.ts_patch(uid text, pg text, rw text, cells jsonb, extra text default '', tb text default null) returns text
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', tst.claims(uid), true);
  execute 'set local role anon';
  execute format('select public.rows_patch(%L, %L, %L, %L, %L::jsonb%s)', 'WT', pg, coalesce(tb, tst.tab()), rw, cells, extra);
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return 'ok';
exception when others then
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return 'error:' || sqlstate;
end;
$$;
-- Значение ячейки строки (id в наборе уникальны в пределах стола).
create or replace function tst.cell(pg text, rw text, k text) returns text language sql as $$
  select r.cells ->> k from public.desk_rows r where r.workspace_id = 'WT' and r.page_id = pg and r.id = rw
$$;
-- Правка мимо триггеров (как «уже так лежит»): готовит расхождения.
create or replace function tst.raw_cells(pg text, rw text, patch jsonb) returns void language plpgsql as $$
begin
  set local session_replication_role = replica;
  update public.desk_rows r set cells = r.cells || patch where r.workspace_id = 'WT' and r.page_id = pg and r.id = rw;
  set local session_replication_role = origin;
end;
$$;
-- Снимок столов ОС: число строк и свёртка — «не изменилось ли что-то».
create or replace function tst.os_snap() returns text language sql as $$
  select count(*)::text || ':' || md5(coalesce(string_agg(r.page_id || '/' || r.tab_id || '/' || r.id || '=' || r.cells::text || coalesce(r.mirror_row_id, '-'), ';' order by r.page_id, r.tab_id, r.id), ''))
  from public.desk_rows r where r.workspace_id = 'WT' and r.page_id like 'osdesk\_%'
$$;
create table if not exists tst.ts_mem (k text primary key, v text);
truncate tst.ts_mem;

-- ---------------------------------------------------------------------
-- 3. Область действия и кто зовёт.
-- ---------------------------------------------------------------------
insert into tst.ts_mem values ('snap0', tst.os_snap());
select tst.expect('«Смешанный» без галочки стола → out_of_scope', tst.ts_sync('TT1', 'PT1', array['t1']) ->> 'status', 'out_of_scope');
select tst.run('TO', $q$select rows_set_desk_os_exempt('WT', 'PT1', true)$q$);
select tst.expect('галочка стола есть, флаг ещё не включали (null) → off', tst.ts_sync('TT1', 'PT1', array['t1']) ->> 'status', 'off');
select tst.expect('флаг включает не технарь', tst.try('TT1', $q$select rows_set_tech_sync('WT', true)$q$), 'error');
select tst.expect('…не Тимлид', tst.try('TTL', $q$select rows_set_tech_sync('WT', true)$q$), 'error');
select tst.expect('…не Тимлид+', tst.try('TLP', $q$select rows_set_tech_sync('WT', true)$q$), 'error');
select tst.expect('…не посторонний', tst.try('TX', $q$select rows_set_tech_sync('WT', true)$q$), 'error');
select tst.expect('…Owner без значения → 22023', tst.try('TO', $q$select rows_set_tech_sync('WT', null)$q$), 'deny:22023');
select tst.expect('состояние до включения: on = null (ключ есть)',
  tst.tsv('TT1', $q$select (j ? 'on')::text || '|' || coalesce(j ->> 'on', 'null') || '|' || (j ->> 'core') from rows_tech_sync_state('WT') j$q$), 'true|null|true');
select tst.expect('Owner выключил (false) → off',
  tst.tsv('TO', $q$select rows_set_tech_sync('WT', false)::text$q$) || '|' || (tst.ts_sync('TT1', 'PT1', array['t1']) ->> 'status'), 'false|off');
select tst.expect('пока выключено — столы ОС не тронуты', tst.os_snap(), (select v from tst.ts_mem where k = 'snap0'));
select tst.expect('Owner включает', tst.tsv('TO', $q$select rows_set_tech_sync('WT', true)::text$q$), 'true');
update public.core_docs set deleted = true where workspace_id = 'WT' and kind = 'meta' and id = 'imported_member';
select tst.expect('ядро не перенесено (нет отметки участников) → no_core', tst.ts_sync('TT1', 'PT1', array['t1']) ->> 'status', 'no_core');
update public.core_docs set deleted = false where workspace_id = 'WT' and kind = 'meta' and id = 'imported_member';
select tst.expect('стол ОС → out_of_scope', tst.ts_sync('TOS1', 'osdesk_TOS1', array['own1'], false, '') ->> 'status', 'out_of_scope');
select tst.expect('стола нет в копии прав → out_of_scope', tst.ts_sync('TO', 'NOPE', array['x']) ->> 'status', 'out_of_scope');

select tst.expect('чужой технарь → 42501', tst.ts_sync('TT2', 'PT1', array['t1']) ->> 'status', 'error:42501');
select tst.expect('Viewer → 42501', tst.ts_sync('TV', 'PT1', array['t1']) ->> 'status', 'error:42501');
select tst.expect('Тимлид (таблиц не видит) → 42501', tst.ts_sync('TTL', 'PT1', array['t1']) ->> 'status', 'error:42501');
select tst.expect('ОС (стол читает, не правит) → 42501', tst.ts_sync('TOS1', 'PT1', array['t1']) ->> 'status', 'error:42501');
select tst.expect('посторонний → 42501', tst.ts_sync('TX', 'PT1', array['t1']) ->> 'status', 'error:42501');
select tst.expect('анонимный ключ → 42501', tst.ts_sync('__anon_key__', 'PT1', array['t1']) ->> 'status', 'error:42501');
select tst.expect('«Передать ОС» (force) технарю нельзя → 42501', tst.ts_sync('TT1', 'PT1', array['t1'], true) ->> 'status', 'error:42501');
select tst.expect('51 элемент → 22023',
  tst.ts_sync('TT1', 'PT1', (select array_agg('x' || g) from generate_series(1, 51) g)) ->> 'status', 'error:22023');
select tst.expect('элемент без row → 22023',
  tst.try('TT1', format($q$select rows_tech_sync('WT', 'PT1', %L, '[{"id":"t1"}]'::jsonb)$q$, tst.tab())), 'deny:22023');
select tst.expect('p_items не массив → 22023',
  tst.try('TT1', format($q$select rows_tech_sync('WT', 'PT1', %L, '{"row":"t1"}'::jsonb)$q$, tst.tab())), 'deny:22023');
update public.rows_workspaces set status = 'suspended' where workspace_id = 'WT';
select tst.expect('приостановленная компания → 42501', tst.ts_sync('TT1', 'PT1', array['t1']) ->> 'status', 'error:42501');
update public.rows_workspaces set status = 'active' where workspace_id = 'WT';
select tst.expect('после всех отказов столы ОС не тронуты', tst.os_snap(), (select v from tst.ts_mem where k = 'snap0'));

select tst.expect('состояние: посторонний → 42501', tst.try('TX', $q$select rows_tech_sync_state('WT')$q$), 'deny:42501');
select tst.expect('состояние: технарю — on/core/period без столов ОС',
  tst.tsv('TT1', $q$select concat_ws('|', j ->> 'on', j ->> 'core', j ->> 'period', (j ? 'desks')::text) from rows_tech_sync_state('WT') j$q$),
  'true|true|' || tst.per() || '|false');
select tst.expect('состояние: Owner видит все столы ОС',
  tst.tsv('TO', $q$select (select string_agg(d ->> 'page', ',' order by d ->> 'page') from jsonb_array_elements(j -> 'desks') d) from rows_tech_sync_state('WT') j$q$),
  'osdesk_TOS1,osdesk_TOS3,osdesk_TOS5');
select tst.expect('состояние: ОС видит только свой стол, с ключами вкладки',
  tst.tsv('TOS1', $q$select concat_ws('|', jsonb_array_length(j -> 'desks')::text, j -> 'desks' -> 0 ->> 'page', j -> 'desks' -> 0 ->> 'tab',
    j -> 'desks' -> 0 ->> 'planned', j -> 'desks' -> 0 -> 'keys' ->> 'status', j -> 'desks' -> 0 -> 'keys' ->> 'technician') from rows_tech_sync_state('WT') j$q$),
  '1|osdesk_TOS1||false|stx|techx');
select tst.expect('состояние: вкладки периода у ОС vera ещё нет — planned',
  tst.tsv('TO', $q$select concat_ws('|', d ->> 'tab', d ->> 'planned', d -> 'keys' ->> 'status') from rows_tech_sync_state('WT') j, jsonb_array_elements(j -> 'desks') d where d ->> 'page' = 'osdesk_TOS3'$q$),
  tst.tab() || '|true|status');

-- ---------------------------------------------------------------------
-- 4. Связь: источник на столе ОС собирает база.
-- ---------------------------------------------------------------------
select tst.expect('технарь связывает t1 → linked, адрес источника в ответе',
  (select concat_ws('|', j ->> 'status', j ->> 'period', i ->> 'code', i ->> 'srcPage', i ->> 'srcTab', i ->> 'srcRow', i ->> 'osUid', (i ? 'hash')::text)
   from tst.ts_sync('TT1', 'PT1', array['t1']) j, lateral (select j -> 'items' -> 0 as i) x),
  'ok|' || tst.per() || '|linked|osdesk_TOS1||adopt_t1|TOS1|false');
select tst.expect('источник ровно один, во вкладке периода стола ОС',
  (select count(*)::text || '|' || min(tab_id) from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS1' and id = 'adopt_t1'), '1|');
select tst.expect('ячейки источника — ровно собранный набор под настоящими ключами вкладки',
  (select cells::text from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS1' and id = 'adopt_t1'),
  '{"stx": "work", "link": "http://x", "note": "пожелание", "phone": "+7 700", "price": "50000", "techx": "nick_t1", "total": "50000", "client": "Клиент 1", "osLostFor": "", "osIssuedAt": "5000", "osStatusSent": "work"}'::jsonb::text);
select tst.expect('источник: визитка, адрес копии, подсветка, дата заказа, ключ статуса, без подписи',
  (select concat_ws('|', extras ->> 'persons', mirror_page_id, mirror_tab_id = tst.tab(), mirror_row_id, highlight, created_at, status_key, coalesce(sync_hash, 'null'), (sort_order > 0))
   from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS1' and id = 'adopt_t1'),
  '2|PT1|t|t1|t|5000|stx|null|t');
select tst.expect('строка технаря помечена, ячейки и подпись не тронуты',
  (select concat_ws('|', os_uid, tech_uid, status_key, src_page_id, coalesce(src_tab_id, 'null'), src_row_id, coalesce(sync_hash, 'null'),
     (cells = '{"client":" Клиент 1 ","phone":"+7 700","price":"50 000","os":"anna","st":"work","link":"http://x"}'::jsonb)::text)
   from public.desk_rows where workspace_id = 'WT' and page_id = 'PT1' and id = 't1'),
  'TOS1|TT1|st|osdesk_TOS1||adopt_t1|null|true');
select tst.expect('создание заказа записано в историю один раз',
  (select count(*)::text || '|' || min(kind) || '|' || min(actor_uid) from public.order_events where workspace_id = 'WT' and order_key = 'adopt_t1'), '1|created|TT1');
insert into tst.ts_mem values ('snap1', tst.os_snap());
select tst.expect('повтор — ok без записи, второго источника нет',
  (select concat_ws('|', i ->> 'code', i ->> 'wrote', i ->> 'srcRow') from tst.ts_sync('TT1', 'PT1', array['t1']) j, lateral (select j -> 'items' -> 0 as i) x)
  || '|' || (tst.os_snap() = (select v from tst.ts_mem where k = 'snap1'))::text, 'ok|false|adopt_t1|true');
select tst.expect('забор ОС после авто-связи → already',
  tst.tsv('TOS1', format($q$select rows_os_claim_order('WT','PT1',%L,'t1',null,'','{"client":"x"}'::jsonb,null,'h') ->> 'status'$q$, tst.tab())), 'already');
select tst.expect('строка больше не числится «к забору»',
  tst.try('TOS1', $q$select 1 from rows_os_claimable('WT') j where j->'row'->>'id' = 't1'$q$, true), 'ok:0');

-- GUC не течёт: после вызова и после строки, упавшей с ошибкой.
create or replace function tst.ts_guc(uid text, pg text, rws text[]) returns text language plpgsql as $$
declare res jsonb;
begin
  res := tst.ts_sync(uid, pg, rws);
  return coalesce(current_setting('nova.tech_sync', true), '') || '|' || coalesce(current_setting('nova.lead_move', true), '')
    || '|' || coalesce(current_setting('lock_timeout', true), '') || '|' || (res ->> 'status');
end;
$$;
select tst.expect('после вызова GUC nova.tech_sync и nova.lead_move пусты, lock_timeout прежний',
  tst.ts_guc('TT1', 'PT1', array['t1', 'u_noos']), '||0|ok');

-- --- Отказы: первый по порядку — ответ, оба стола не тронуты -----------
select tst.expect('нет строки → gone', tst.ts_code('TT1', 'PT1', 'nope'), 'gone');
select tst.expect('пустая строка → blank', tst.ts_code('TT1', 'PT1', 'u_blank'), 'blank');
select tst.expect('вкладка без карты столбцов → no_keys', tst.ts_code('TT1', 'PT1', 'u_tab', false, 'other'), 'no_keys');
select tst.expect('вкладка прошлого периода → period_mismatch', tst.ts_code('TT5', 'PT5', 'n3', false, 'month-2020-01'), 'period_mismatch');
select tst.expect('копия ОС (id os_…) → released', tst.ts_code('TT1', 'PT1', 'os_zz'), 'released');
select tst.expect('столбец ОС пуст → no_os', tst.ts_code('TT1', 'PT1', 'u_noos'), 'no_os');
select tst.expect('нет клиента → no_client', tst.ts_code('TT1', 'PT1', 'u_nocl'), 'no_client');
select tst.expect('«вернули технарю» от этого ОС → released', tst.ts_code('TT1', 'PT1', 'u_rel'), 'released');
select tst.expect('ник не закреплён за ОС → no_os_member', tst.ts_code('TT1', 'PT1', 'u_ghost'), 'no_os_member');
select tst.expect('ник у двух ОС → nick_ambiguous', tst.ts_code('TT1', 'PT1', 'u_dup'), 'nick_ambiguous');
select tst.expect('у ОС нет стола → no_os_desk и его uid',
  (select concat_ws('|', i ->> 'code', i ->> 'osUid') from tst.ts_sync('TT1', 'PT1', array['u_nodesk']) j, lateral (select j -> 'items' -> 0 as i) x), 'no_os_desk|TOS2');
select tst.expect('у стола ОС нет документа в ядре → no_os_map', tst.ts_code('TT1', 'PT1', 'u_nomap'), 'no_os_map');
select tst.expect('у технаря стола нет ника → no_tech_nick', tst.ts_code('TT3', 'PT3', 'n1'), 'no_tech_nick');
select tst.expect('ник технаря у двоих → no_tech_nick', tst.ts_code('TT4', 'PT4', 'n2'), 'no_tech_nick');
select tst.expect('стол «только для Owner»: Owner без force → owner_only', tst.ts_code('TO', 'PTO', 'o1'), 'owner_only');
select tst.expect('стол «только для Owner»: Тимлид+ → 42501', tst.ts_sync('TLP', 'PTO', array['o1'], true) ->> 'status', 'error:42501');
select tst.expect('стол «только для Owner»: ответственный технарь → 42501', tst.ts_sync('TT6', 'PTO', array['o1']) ->> 'status', 'error:42501');
select tst.expect('источник без адреса копии под выведенным id → released (подмена id строки)', tst.ts_code('TT1', 'PT1', 'R'), 'released');
select tst.expect('оба выводимых id заняты чужими копиями → src_conflict', tst.ts_code('TT1', 'PT1', 'q1'), 'src_conflict');
select tst.expect('после всех отказов столы ОС не тронуты', tst.os_snap(), (select v from tst.ts_mem where k = 'snap1'));
select tst.expect('…и ни одна из этих строк технарей не помечена',
  (select count(*)::text from public.desk_rows where workspace_id = 'WT' and page_id like 'PT%' and id <> 't1' and (os_uid is not null or src_row_id is not null)), '0');

-- --- «Передать ОС» (force) и запасные пути ------------------------------
select tst.expect('Owner с force берёт источник без адреса копии → linked, ячейки поверх',
  tst.ts_code('TO', 'PT1', 'R', true) || '|' || tst.cell('osdesk_TOS1', 'adopt_R', 'client') || '|' || tst.cell('osdesk_TOS1', 'adopt_R', 'upsell')
  || '|' || tst.cell('osdesk_TOS1', 'adopt_R', 'techx') || '|' || tst.q($q$select mirror_row_id from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS1' and id = 'adopt_R'$q$),
  'linked|Мой|7000|nick_t1|R');
select tst.expect('Owner с force на столе «только для Owner» → linked', tst.ts_code('TO', 'PTO', 'o1', true), 'linked');
select tst.expect('Тимлид+ с force снимает отметку «вернули технарю» и связывает',
  tst.ts_code('TLP', 'PT1', 'u_rel', true) || '|' || coalesce(tst.cell('PT1', 'u_rel', 'osReleasedFrom'), 'null')
  || '|' || tst.q($q$select os_uid from public.desk_rows where workspace_id = 'WT' and page_id = 'PT1' and id = 'u_rel'$q$), 'linked||TOS1');
-- Копия `os_<источник>`, возвращённая технарю: «Передать ОС» подключает
-- ИСХОДНУЮ строку стола ОС, а не заводит рядом вторую.
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at) values
  ('WT', 'PT1', tst.tab(), 'os_orig1', '{"client":"Выдавал ОС","os":"anna","st":"work"}', 14, 1000, 1000),
  ('WT', 'osdesk_TOS1', 'oldtab', 'orig1', '{"client":"Выдавал ОС","upsell":"3000","osLostFor":"nick_t1"}', 1, 1000, 1000);
select tst.expect('копия os_<источник> без force → released', tst.ts_code('TT1', 'PT1', 'os_orig1'), 'released');
select tst.expect('force: копия os_<источник> подключается к исходной строке стола ОС',
  (select concat_ws('|', i ->> 'code', i ->> 'srcRow', i ->> 'srcTab') from tst.ts_sync('TO', 'PT1', array['os_orig1'], true) j, lateral (select j -> 'items' -> 0 as i) x)
  || '|' || tst.q($q$select count(*)::text from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS1' and id in ('orig1', 'adopt_os_orig1')$q$)
  || '|' || concat_ws('|', tst.cell('osdesk_TOS1', 'orig1', 'upsell'), tst.cell('osdesk_TOS1', 'orig1', 'osLostFor'), tst.cell('osdesk_TOS1', 'orig1', 'stx'))
  || '|' || tst.q($q$select mirror_row_id from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS1' and id = 'orig1'$q$),
  'linked|orig1|oldtab|1|3000||work|os_orig1');
select tst.expect('force: копия os_… без исходной строки — обычный источник adopt_os_…',
  (select concat_ws('|', i ->> 'code', i ->> 'srcRow') from tst.ts_sync('TO', 'PT1', array['os_zz'], true) j, lateral (select j -> 'items' -> 0 as i) x),
  'linked|adopt_os_zz');
select tst.expect('первый id занят чужой копией → источник под id с хвостом',
  (select concat_ws('|', i ->> 'code', (i ->> 'srcRow' = 'adopt_q2_' || substr(md5('PT1/' || tst.tab()), 1, 8))::text)
   from tst.ts_sync('TT1', 'PT1', array['q2']) j, lateral (select j -> 'items' -> 0 as i) x), 'linked|true');
select tst.expect('источник уже лежит в другой вкладке и показывает на строку → берётся он, второй не заводится',
  (select concat_ws('|', i ->> 'code', i ->> 'srcTab') from tst.ts_sync('TT1', 'PT1', array['q3']) j, lateral (select j -> 'items' -> 0 as i) x)
  || '|' || tst.q($q$select count(*)::text from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS1' and id = 'adopt_q3'$q$)
  || '|' || tst.cell('osdesk_TOS1', 'adopt_q3', 'client') || '|' || tst.cell('osdesk_TOS1', 'adopt_q3', 'note')
  || '|' || tst.q($q$select src_tab_id from public.desk_rows where workspace_id = 'WT' and page_id = 'PT1' and id = 'q3'$q$),
  'linked|oldtab|1|Источник в другой вкладке|заметка ОС|oldtab');
-- Другой ник в строке с отметкой «вернули» — уходит другому ОС (как забор).
update public.desk_rows set cells = cells || '{"os":"vera","osReleasedFrom":"anna"}' where workspace_id = 'WT' and page_id = 'PT1' and id = 'u_noos';
select tst.expect('отметка «вернули» от anna, в столбце vera → связь с vera; вкладки периода ещё нет — planned',
  (select concat_ws('|', i ->> 'code', i ->> 'osUid', i ->> 'srcTab', i ->> 'planned') from tst.ts_sync('TT1', 'PT1', array['u_noos']) j, lateral (select j -> 'items' -> 0 as i) x),
  'linked|TOS3|' || tst.tab() || '|true');
select tst.expect('источник у vera — под ключами по умолчанию, ник технаря из документа участника',
  (select concat_ws('|', tab_id = tst.tab(), cells ->> 'technician', cells ->> 'client', coalesce(status_key, 'null'))
   from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS3' and id = 'adopt_u_noos'), 't|nick_t1|Без ОС|null');
select tst.expect('состояние: строки лежат во вкладке без документа — orphans',
  tst.tsv('TOS3', $q$select j -> 'desks' -> 0 -> 'orphans' ->> 0 from rows_tech_sync_state('WT') j$q$), tst.tab());

-- --- Перебор без списка (p_items = null) ---------------------------------
select tst.expect('перебор: только несвязанные строки с ником ОС (e1, e2), без e3',
  (select concat_ws('|', j ->> 'status', jsonb_array_length(j -> 'items')::text, j ->> 'more',
     (select string_agg((i ->> 'row') || ':' || (i ->> 'code'), ',' order by i ->> 'row') from jsonb_array_elements(j -> 'items') i))
   from tst.ts_sync('TT7', 'PT7') j), 'ok|2|false|e1:linked,e2:no_client');
select tst.expect('повторный перебор связанную строку не берёт',
  (select (select string_agg((i ->> 'row') || ':' || (i ->> 'code'), ',' order by i ->> 'row') from jsonb_array_elements(j -> 'items') i)
   from tst.ts_sync('TT7', 'PT7') j), 'e2:no_client');
select tst.expect('один источник на строку перебора',
  (select count(*)::text from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS1' and id = 'adopt_e1'), '1');

-- ---------------------------------------------------------------------
-- 5. Вкладка периода стола ОС (rows_os_target) — как openOsDeskCurrentTab.
-- ---------------------------------------------------------------------
insert into public.core_docs (workspace_id, kind, parent_id, id, data) values
  ('WT', 'page', '', 'osdesk_TGT', '{"id":"osdesk_TGT","osDesk":true,"responsibleUserId":"TGT","columns":[{"key":"pstat","type":"status"}]}'),
  ('WT', 'subpage', 'osdesk_TGT', 'tabA', '{"id":"tabA","order":1,"columns":[{"key":"astat","type":"status"}]}'),
  ('WT', 'subpage', 'osdesk_TGT', 'tabP', '{"id":"tabP","order":0,"monthKey":"2026-10","personalOwnerUid":"TGT","columns":[{"key":"xstat","type":"status"}]}'),
  ('WT', 'subpage', 'osdesk_TGT', 'tabD', '{"id":"tabD","order":5,"columns":[{"key":"dstat","type":"status"}]}');
create or replace function tst.tgt(patch jsonb, per text default '2026-10') returns text language plpgsql as $$
declare t jsonb;
begin
  update public.core_docs set data = '{"id":"osdesk_TGT","osDesk":true,"responsibleUserId":"TGT","columns":[{"key":"pstat","type":"status"}]}'::jsonb || patch
  where workspace_id = 'WT' and kind = 'page' and id = 'osdesk_TGT';
  t := public.rows_os_target('WT', 'osdesk_TGT', per);
  if t is null then
    return 'null';
  end if;
  return concat_ws('|', t ->> 'tab', t ->> 'planned', t -> 'keys' ->> 'status');
end;
$$;
select tst.expect('«Основная» ещё не названа периодом → она', tst.tgt('{}'), '|false|pstat');
select tst.expect('«Основная» названа этим периодом → она', tst.tgt('{"mainTabMonthKey":"2026-10"}'), '|false|pstat');
select tst.expect('вкладка автопилота этого периода', tst.tgt('{"mainTabMonthKey":"2026-09","autoMonthKey":"2026-10","autoMonthSubPageId":"tabA"}'), 'tabA|false|astat');
select tst.expect('автопилот от другого периода и вкладки нет → будущая month-{период}, столбцы стола',
  tst.tgt('{"mainTabMonthKey":"2026-09","autoMonthKey":"2026-09","autoMonthSubPageId":"tabA"}'), 'month-2026-10|true|pstat');
select tst.expect('вкладки автопилота нет в ядре → не она', tst.tgt('{"mainTabMonthKey":"2026-09","autoMonthKey":"2026-10","autoMonthSubPageId":"gone"}'), 'month-2026-10|true|pstat');
select tst.expect('будущая вкладка: столбцы вкладки по умолчанию (columnSource)',
  tst.tgt('{"mainTabMonthKey":"2026-09","defaultSubPageId":"tabD"}'), 'month-2026-10|true|dstat');
select tst.expect('будущая вкладка: «Основная» скрыта → столбцы последней видимой',
  tst.tgt('{"mainTabMonthKey":"2026-09","hideMainTab":true}'), 'month-2026-10|true|dstat');
select tst.expect('личная вкладка с monthKey периода не берётся', tst.tgt('{"mainTabMonthKey":"2026-09"}'), 'month-2026-10|true|pstat');
insert into public.core_docs (workspace_id, kind, parent_id, id, data) values
  ('WT', 'subpage', 'osdesk_TGT', 'tabK', '{"id":"tabK","order":2,"monthKey":"2026-10","columns":[{"key":"kstat","type":"status"}]}');
select tst.expect('вкладка с monthKey периода', tst.tgt('{"mainTabMonthKey":"2026-09"}'), 'tabK|false|kstat');
update public.core_docs set data = data || '{"isArchived":true}' where workspace_id = 'WT' and kind = 'subpage' and parent_id = 'osdesk_TGT' and id = 'tabK';
select tst.expect('архивная вкладка с monthKey не берётся', tst.tgt('{"mainTabMonthKey":"2026-09"}'), 'month-2026-10|true|pstat');
insert into public.core_docs (workspace_id, kind, parent_id, id, data) values
  ('WT', 'subpage', 'osdesk_TGT', 'month-2026-10', '{"id":"month-2026-10","order":3,"isArchived":true}');
select tst.expect('вкладка month-{период} (и архивная) — она; своих столбцов нет → столбцы стола',
  tst.tgt('{"mainTabMonthKey":"2026-09"}'), 'month-2026-10|false|pstat');
select tst.expect('период неизвестен → null', tst.tgt('{}', null), 'null');
select tst.expect('документа стола нет → null', coalesce(public.rows_os_target('WT', 'osdesk_NOPE', '2026-10')::text, 'null'), 'null');
select tst.expect('ключи вкладки без документа → null (поля не пишутся)',
  coalesce(public.rows_os_tab_keys('WT', 'osdesk_TGT', 'ghost')::text, 'null'), 'null');
delete from public.core_docs where workspace_id = 'WT' and (id = 'osdesk_TGT' or parent_id = 'osdesk_TGT');
delete from public.rows_page_acl where workspace_id = 'WT' and page_id = 'osdesk_TGT';

-- ---------------------------------------------------------------------
-- 6. Триггер: правка связанной копии доезжает до источника сама.
-- ---------------------------------------------------------------------
insert into tst.ts_mem
select 'rev_src', rev::text from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS1' and id = 'adopt_t1'
union all select 'rev_copy', rev::text from public.desk_rows where workspace_id = 'WT' and page_id = 'PT1' and id = 't1';
select tst.expect('технарь ставит статус', tst.ts_patch('TT1', 'PT1', 't1', '{"st":"done"}') || '!', 'ok!');
select tst.expect('…статус и osStatusSent источника — тем же значением, под ключом вкладки ОС',
  concat_ws('|', tst.cell('osdesk_TOS1', 'adopt_t1', 'stx'), tst.cell('osdesk_TOS1', 'adopt_t1', 'osStatusSent'), coalesce(tst.cell('osdesk_TOS1', 'adopt_t1', 'status'), 'null')),
  'done|done|null');
select tst.expect('…rev копии и источника выросли',
  (select (rev > (select v::bigint from tst.ts_mem where k = 'rev_src'))::text from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS1' and id = 'adopt_t1')
  || '|' || (select (rev > (select v::bigint from tst.ts_mem where k = 'rev_copy'))::text from public.desk_rows where workspace_id = 'WT' and page_id = 'PT1' and id = 't1'), 'true|true');
select tst.expect('…в истории ОДНО событие статуса (с копии, field = tech), с источника — нет',
  (select count(*)::text || '|' || min(coalesce(field, 'null')) || '|' || min(new_value) || '|' || min(page_id)
   from public.order_events where workspace_id = 'WT' and order_key = 'adopt_t1' and kind = 'status'), '1|tech|done|PT1');
select tst.expect('…остальные ячейки источника не тронуты',
  concat_ws('|', tst.cell('osdesk_TOS1', 'adopt_t1', 'client'), tst.cell('osdesk_TOS1', 'adopt_t1', 'price'), tst.cell('osdesk_TOS1', 'adopt_t1', 'techx')), 'Клиент 1|50000|nick_t1');
select tst.expect('после правки GUC nova.lead_move пуст',
  tst.tsv('TT1', format($q$select coalesce(current_setting('nova.lead_move', true), '') from (select rows_patch('WT','PT1',%L,'t1','{"st":"done2"}'::jsonb)) q$q$, tst.tab())), '');
select tst.expect('стёртый статус не едет',
  tst.ts_patch('TT1', 'PT1', 't1', '{"st":""}') || '|' || tst.cell('osdesk_TOS1', 'adopt_t1', 'stx'), 'ok|done2');
-- Недоставленный статус ОС: стоит у ОС, osStatusSent ещё прежний.
select tst.raw_cells('osdesk_TOS1', 'adopt_t1', '{"stx":"pay"}');
select tst.expect('у ОС недоставленный статус — правка технаря его не затирает (прав ОС)',
  tst.ts_patch('TT1', 'PT1', 't1', '{"st":"rework"}') || '|' || tst.cell('osdesk_TOS1', 'adopt_t1', 'stx') || '|' || tst.cell('osdesk_TOS1', 'adopt_t1', 'osStatusSent'),
  'ok|pay|done2');
select tst.expect('…и rows_tech_sync его тоже не чинит',
  (select concat_ws('|', i ->> 'code', i ->> 'wrote') from tst.ts_sync('TT1', 'PT1', array['t1']) j, lateral (select j -> 'items' -> 0 as i) x)
  || '|' || tst.cell('osdesk_TOS1', 'adopt_t1', 'stx'), 'ok|false|pay');
-- ОС → технарь по-прежнему: триггер статуса ОС, без отскока.
select tst.expect('ОС ставит статус у себя → доезжает технарю, назад не возвращается',
  tst.tsv('TOS1', $q$select rows_patch('WT','osdesk_TOS1','','adopt_t1','{"stx":"hold"}'::jsonb)::text$q$)
  || '|' || concat_ws('|', tst.cell('PT1', 't1', 'st'), tst.cell('osdesk_TOS1', 'adopt_t1', 'stx'), tst.cell('osdesk_TOS1', 'adopt_t1', 'osStatusSent')),
  '|hold|hold|hold');
-- Owner — не ОС этой строки: копию правит триггер статуса ОС ИЗНУТРИ правки
-- источника, и писать назад в источник оттуда нельзя (выход по глубине).
select tst.expect('Owner ставит статус на столе ОС → доезжает технарю, правка не падает',
  tst.tsv('TO', $q$select rows_patch('WT','osdesk_TOS1','','adopt_t1','{"stx":"byowner"}'::jsonb)::text$q$)
  || '|' || concat_ws('|', tst.cell('PT1', 't1', 'st'), tst.cell('osdesk_TOS1', 'adopt_t1', 'stx'), tst.cell('osdesk_TOS1', 'adopt_t1', 'osStatusSent')),
  '|byowner|byowner|byowner');
select tst.expect('Тимлид ставит «Успешку» в копии → доезжает до ОС',
  tst.ts_patch('TTL', 'PT1', 't1', '{"st":"success"}') || '|' || tst.cell('osdesk_TOS1', 'adopt_t1', 'stx') || '|' || tst.cell('osdesk_TOS1', 'adopt_t1', 'osStatusSent'),
  'ok|success|success');
select tst.expect('правит сам ОС этой строки → триггер молчит (источник он ведёт у себя)',
  tst.ts_patch('TOS1', 'PT1', 't1', '{"st":"byos","client":"От ОС"}') || '|' || tst.cell('osdesk_TOS1', 'adopt_t1', 'stx') || '|' || tst.cell('osdesk_TOS1', 'adopt_t1', 'client'),
  'ok|success|Клиент 1');
select tst.ts_patch('TT1', 'PT1', 't1', '{"st":"work","client":" Клиент 1 "}');

-- Поля.
select tst.expect('клиент доезжает (обрезан), прочее не тронуто',
  tst.ts_patch('TT1', 'PT1', 't1', '{"client":"  Новый клиент "}') || '|' || tst.cell('osdesk_TOS1', 'adopt_t1', 'client') || '|' || tst.cell('osdesk_TOS1', 'adopt_t1', 'phone'),
  'ok|Новый клиент|+7 700');
select tst.expect('номер и ссылка доезжают одной правкой',
  tst.ts_patch('TT1', 'PT1', 't1', '{"phone":"+7 701","link":"http://y"}') || '|' || tst.cell('osdesk_TOS1', 'adopt_t1', 'phone') || '|' || tst.cell('osdesk_TOS1', 'adopt_t1', 'link'),
  'ok|+7 701|http://y');
select tst.expect('визитка доезжает целиком',
  tst.ts_patch('TT1', 'PT1', 't1', '{}', $x$, p_extras_mode => 'set', p_extras => '{"note":"новое","persons":3,"tier":"Premium"}'::jsonb$x$)
  || '|' || tst.q($q$select extras::text from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS1' and id = 'adopt_t1'$q$),
  'ok|' || '{"note":"новое","persons":3,"tier":"Premium"}'::jsonb::text);
select tst.expect('…«Примечание» ОС после связи не переписывается', tst.cell('osdesk_TOS1', 'adopt_t1', 'note'), 'пожелание');
select tst.expect('поля записаны в историю не как статус (событий статуса с источника по-прежнему нет)',
  (select count(*)::text from public.order_events where workspace_id = 'WT' and order_key = 'adopt_t1' and kind = 'status' and page_id = 'osdesk_TOS1' and actor_uid = 'TT1'), '0');
select tst.expect('правка не из карты столбцов (свой столбец технаря) источник не трогает',
  tst.q($q$select rev::text from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS1' and id = 'adopt_t1'$q$)
  || '|' || tst.ts_patch('TT1', 'PT1', 't1', '{"techNote":"моё","os":"anna"}'),
  tst.q($q$select rev::text from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS1' and id = 'adopt_t1'$q$) || '|ok');

-- Сумма.
select tst.expect('сумма без апсейла и комиссий: цена = сумма технаря, «Итого» то же',
  tst.ts_patch('TT1', 'PT1', 't1', '{"price":"70 000"}') || '|' || tst.cell('osdesk_TOS1', 'adopt_t1', 'price') || '|' || tst.cell('osdesk_TOS1', 'adopt_t1', 'total'),
  'ok|70000|70000');
select tst.raw_cells('osdesk_TOS1', 'adopt_t1', '{"upsell":"50000","upsell__fee":8,"upsell__pay":"lava","total":"116000"}');
select tst.expect('апсейл 50 000 −8 %: сумма технаря 146 000 → цена 100 000, «Итого» 146 000, апсейл и комиссия целы',
  tst.ts_patch('TT1', 'PT1', 't1', '{"price":"146000"}') || '|' || concat_ws('|', tst.cell('osdesk_TOS1', 'adopt_t1', 'price'), tst.cell('osdesk_TOS1', 'adopt_t1', 'total'),
    tst.cell('osdesk_TOS1', 'adopt_t1', 'upsell'), tst.cell('osdesk_TOS1', 'adopt_t1', 'upsell__fee'), tst.cell('osdesk_TOS1', 'adopt_t1', 'upsell__pay')),
  'ok|100000|146000|50000|8|lava');
select tst.expect('сумма меньше апсейла после комиссии — ничего не пишется',
  tst.ts_patch('TT1', 'PT1', 't1', '{"price":"40000"}') || '|' || tst.cell('osdesk_TOS1', 'adopt_t1', 'price') || '|' || tst.cell('osdesk_TOS1', 'adopt_t1', 'total'), 'ok|100000|146000');
select tst.expect('…rows_tech_sync сообщает sum: refused и сумму ОС',
  (select concat_ws('|', i ->> 'code', i ->> 'sum', i ->> 'osTotal') from tst.ts_sync('TT1', 'PT1', array['t1']) j, lateral (select j -> 'items' -> 0 as i) x), 'ok|refused|146000');
select tst.expect('сумму стёрли при апсейле — ничего не пишется',
  tst.ts_patch('TT1', 'PT1', 't1', '{"price":""}') || '|' || tst.cell('osdesk_TOS1', 'adopt_t1', 'price'), 'ok|100000');
select tst.expect('не число в сумме — ничего не пишется',
  tst.ts_patch('TT1', 'PT1', 't1', '{"price":"сто тысяч"}') || '|' || tst.cell('osdesk_TOS1', 'adopt_t1', 'price'), 'ok|100000');
select tst.expect('разница в копейку — равенство, записи нет',
  tst.q($q$select rev::text from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS1' and id = 'adopt_t1'$q$)
  || '|' || tst.ts_patch('TT1', 'PT1', 't1', '{"price":"146000.01"}'),
  tst.q($q$select rev::text from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS1' and id = 'adopt_t1'$q$) || '|ok');
select tst.raw_cells('osdesk_TOS1', 'adopt_t1', '{"price__fee":8}');
select tst.expect('комиссия и у цены (8 %), и у апсейла: 129 720 → цена 91 000',
  tst.ts_patch('TT1', 'PT1', 't1', '{"price":"129720"}') || '|' || tst.cell('osdesk_TOS1', 'adopt_t1', 'price') || '|' || tst.cell('osdesk_TOS1', 'adopt_t1', 'total'), 'ok|91000|129720');
select tst.expect('подбор до копейки: 100 000,55 → «Итого» ровно 100 000,55',
  tst.ts_patch('TT1', 'PT1', 't1', '{"price":"100000,55"}') || '|' || tst.cell('osdesk_TOS1', 'adopt_t1', 'total')
  || '|' || tst.q($q$select public.rows_os_total(cells, 'price', 'upsell')::text || '/' || (cells ->> 'price') from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS1' and id = 'adopt_t1'$q$),
  'ok|100000.55|100000.55/58696.25');
select tst.raw_cells('osdesk_TOS1', 'adopt_t1', '{"upsell":"","upsell__fee":null,"price__fee":null}');
select tst.expect('без апсейла: стёртая сумма стирает цену и «Итого»',
  tst.ts_patch('TT1', 'PT1', 't1', '{"price":""}') || '|[' || tst.cell('osdesk_TOS1', 'adopt_t1', 'price') || ']|[' || tst.cell('osdesk_TOS1', 'adopt_t1', 'total') || ']', 'ok|[]|[]');
select tst.ts_patch('TT1', 'PT1', 't1', '{"price":"50000"}');

-- Вкладка не из карты: едет только статус.
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at, os_uid, tech_uid, status_key, src_page_id, src_tab_id, src_row_id) values
  ('WT', 'PT1', 'other', 'k1', '{"client":"Старая вкладка","st":"work","os":"anna"}', 1, 1000, 1000, 'TOS1', 'TT1', 'st', 'osdesk_TOS1', '', 'adopt_k1'),
  ('WT', 'PT1', tst.tab(), 'k2', '{"client":"Источник смотрит не сюда","st":"work","os":"anna"}', 20, 1000, 1000, 'TOS1', 'TT1', 'st', 'osdesk_TOS1', '', 'adopt_k2'),
  ('WT', 'PT1', tst.tab(), 'k3', '{"client":"Источника нет","st":"work","os":"anna"}', 21, 1000, 1000, 'TOS1', 'TT1', 'st', 'osdesk_TOS1', '', 'adopt_k3'),
  ('WT', 'PT1', tst.tab(), 'k4', '{"client":"Чужой стол в адресе","st":"work","os":"anna"}', 22, 1000, 1000, 'TOS1', 'TT1', 'st', 'osdesk_TOS3', '', 'adopt_k4');
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at, mirror_page_id, mirror_tab_id, mirror_row_id) values
  ('WT', 'osdesk_TOS1', '', 'adopt_k1', '{"client":"Старая вкладка","stx":"work","osStatusSent":"work","techx":"nick_t1"}', 30, 1000, 1000, 'PT1', 'other', 'k1'),
  ('WT', 'osdesk_TOS1', '', 'adopt_k2', '{"client":"Источник смотрит не сюда","stx":"work","osStatusSent":"work"}', 31, 1000, 1000, 'PT1', tst.tab(), 'elsewhere'),
  ('WT', 'osdesk_TOS3', '', 'adopt_k4', '{"client":"Чужой стол в адресе","status":"work","osStatusSent":"work"}', 32, 1000, 1000, 'PT1', tst.tab(), 'k4');
select tst.expect('вкладка не из карты столбцов: статус едет, поля — нет',
  tst.ts_patch('TT1', 'PT1', 'k1', '{"st":"done","client":"Переименовали"}', '', 'other') || '|' || tst.cell('osdesk_TOS1', 'adopt_k1', 'stx') || '|' || tst.cell('osdesk_TOS1', 'adopt_k1', 'client'),
  'ok|done|Старая вкладка');
select tst.expect('источник показывает не на эту копию — ничего не пишется',
  tst.ts_patch('TT1', 'PT1', 'k2', '{"st":"done","client":"Я"}') || '|' || tst.cell('osdesk_TOS1', 'adopt_k2', 'stx') || '|' || tst.cell('osdesk_TOS1', 'adopt_k2', 'client'),
  'ok|work|Источник смотрит не сюда');
select tst.expect('источника нет — правка технаря всё равно сохраняется',
  tst.ts_patch('TT1', 'PT1', 'k3', '{"st":"done"}') || '|' || tst.cell('PT1', 'k3', 'st'), 'ok|done');
select tst.expect('адрес источника не на столе ЕГО ОС — ничего не пишется',
  tst.ts_patch('TT1', 'PT1', 'k4', '{"st":"done"}') || '|' || tst.cell('osdesk_TOS3', 'adopt_k4', 'status'), 'ok|work');

-- Выключено — триггер молчит.
select tst.run('TO', $q$select rows_set_tech_sync('WT', false)$q$);
select tst.expect('флаг выключен — правка копии источник не трогает',
  tst.ts_patch('TT1', 'PT1', 't1', '{"st":"off1","client":"Выключено"}') || '|' || tst.cell('osdesk_TOS1', 'adopt_t1', 'stx') || '|' || tst.cell('osdesk_TOS1', 'adopt_t1', 'client'),
  'ok|work|Новый клиент');
select tst.run('TO', $q$select rows_set_tech_sync('WT', true)$q$);
select tst.run('TO', $q$select rows_set_desk_os_exempt('WT', 'PT1', false)$q$);
select tst.expect('стол больше не «заполняет сам» — правка Owner источник не трогает',
  tst.ts_patch('TO', 'PT1', 't1', '{"st":"off2"}') || '|' || tst.cell('osdesk_TOS1', 'adopt_t1', 'stx'), 'ok|work');
select tst.run('TO', $q$select rows_set_desk_os_exempt('WT', 'PT1', true)$q$);
select tst.run('TO', $q$select rows_set_desk_mode('WT', 'tech')$q$);
select tst.run('TO', $q$select rows_set_desk_os_exempt('WT', 'PT1', false)$q$);
select tst.expect('режим «Технари заполняют сами» — в области и без галочки стола',
  tst.ts_patch('TT1', 'PT1', 't1', '{"st":"work2","client":"Клиент 1"}') || '|' || tst.cell('osdesk_TOS1', 'adopt_t1', 'stx') || '|' || tst.cell('osdesk_TOS1', 'adopt_t1', 'client'),
  'ok|work2|Клиент 1');
select tst.expect('…и стол PT2 теперь в области: связь проходит', tst.ts_code('TT2', 'PT2', 'm1'), 'linked');
select tst.run('TO', $q$select rows_set_desk_mode('WT', 'mixed')$q$);
select tst.run('TO', $q$select rows_set_desk_os_exempt('WT', 'PT1', true)$q$);
select tst.expect('«Смешанный»: PT2 снова вне области — правка копии источник не трогает',
  tst.ts_patch('TO', 'PT2', 'm1', '{"st":"x9"}') || '|' || tst.cell('osdesk_TOS1', 'adopt_m1', 'stx') || '|' || (tst.ts_sync('TT2', 'PT2', array['m1']) ->> 'status'),
  'ok|work|out_of_scope');

-- Правка с новой подписью (пересылка ОС → технарь), перенос, переезд к другому ОС.
select tst.expect('правка, меняющая sync_hash (пересылка прохода от Owner), назад не едет',
  tst.ts_patch('TO', 'PT1', 't1', '{"st":"pushed","client":"Из прохода"}', $x$, p_sync_hash => 'HX'$x$) || '|' || tst.cell('osdesk_TOS1', 'adopt_t1', 'stx') || '|' || tst.cell('osdesk_TOS1', 'adopt_t1', 'client'),
  'ok|work2|Клиент 1');
select tst.ts_patch('TO', 'PT1', 't1', '{"st":"work2","client":"Клиент 1"}');
insert into tst.ts_mem select 'src_cells', cells::text from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS1' and id = 'adopt_e1';
select tst.expect('перенос в другую вкладку (rows_carry_over): адрес чинится, ячейки источника те же',
  tst.tsv('TT7', format($q$select rows_carry_over('WT','PT7',%L,'next', array['e1']) ->> 'moved'$q$, tst.tab()))
  || '|' || tst.q($q$select mirror_tab_id from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS1' and id = 'adopt_e1'$q$)
  || '|' || (tst.q($q$select cells::text from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS1' and id = 'adopt_e1'$q$) = (select v from tst.ts_mem where k = 'src_cells'))::text,
  '["e1"]|next|true');
select tst.expect('после переноса статус по-прежнему доезжает (вкладка не из карты — только статус)',
  tst.ts_patch('TT7', 'PT7', 'e1', '{"st":"moved_ok"}', '', 'next') || '|' || tst.cell('osdesk_TOS1', 'adopt_e1', 'stx'), 'ok|moved_ok');
select tst.expect('переезд к другому ОС (lead_move_os): копия переподписана, источник не переписан триггером',
  tst.tsv('TO', $q$select lead_move_os('WT','osdesk_TOS1','','adopt_e1','osdesk_TOS3','') ->> 'copyMoved'$q$)
  || '|' || tst.q($q$select os_uid || '/' || src_page_id from public.desk_rows where workspace_id = 'WT' and page_id = 'PT7' and id = 'e1'$q$)
  || '|' || tst.cell('osdesk_TOS3', 'adopt_e1', 'stx'),
  'true|TOS3/osdesk_TOS3|moved_ok');

-- ---------------------------------------------------------------------
-- 7. Починка статуса и сверка (rows_tech_sync, rows_tech_sync_scan).
-- ---------------------------------------------------------------------
select tst.raw_cells('PT1', 't1', '{"st":"drifted"}');
select tst.expect('сверка: разошедшийся статус — в drift; без источника и «не сюда» — в dead',
  tst.tsv('TT1', format($q$select (j ->> 'drift') || '|' || (select string_agg(d, ',' order by d) from jsonb_array_elements_text(j -> 'dead') d) from rows_tech_sync_scan('WT','PT1',%L) j$q$, tst.tab())),
  '["t1"]|k2,k3,k4');
select tst.expect('сверка: посторонний и аноним получают пустые списки',
  tst.tsv('TX', format($q$select rows_tech_sync_scan('WT','PT1',%L)::text$q$, tst.tab())) || tst.tsv('__anon_key__', format($q$select rows_tech_sync_scan('WT','PT1',%L)::text$q$, tst.tab())),
  '{"dead": [], "drift": []}{"dead": [], "drift": []}');
select tst.expect('сверка ничего не пишет (функция только читает)',
  (select provolatile::text || '|' || prosecdef::text from pg_proc where proname = 'rows_tech_sync_scan'), 's|false');
select tst.expect('починка: статус дописан в источник одним вызовом',
  (select concat_ws('|', i ->> 'code', i ->> 'wrote') from tst.ts_sync('TT1', 'PT1', array['t1']) j, lateral (select j -> 'items' -> 0 as i) x)
  || '|' || tst.cell('osdesk_TOS1', 'adopt_t1', 'stx') || '|' || tst.cell('osdesk_TOS1', 'adopt_t1', 'osStatusSent'), 'ok|true|drifted|drifted');
select tst.expect('…после починки drift пуст',
  tst.tsv('TT1', format($q$select rows_tech_sync_scan('WT','PT1',%L) ->> 'drift'$q$, tst.tab())), '[]');
select tst.expect('…и событие статуса с источника не задвоено',
  (select count(*)::text from public.order_events where workspace_id = 'WT' and order_key = 'adopt_t1' and kind = 'status' and page_id = 'osdesk_TOS1' and new_value = 'drifted'), '0');
select tst.expect('починка: источника нет → no_source; показывает не сюда → not_linked; чужой стол в адресе → not_linked',
  (select string_agg((i ->> 'row') || ':' || (i ->> 'code'), ',' order by i ->> 'row') from tst.ts_sync('TT1', 'PT1', array['k2', 'k3', 'k4']) j, jsonb_array_elements(j -> 'items') i),
  'k2:not_linked,k3:no_source,k4:not_linked');
select tst.raw_cells('PT1', 't1', '{"client":"Пропущенное поле"}');
select tst.expect('пропущенная правка ПОЛЯ в v1 не чинится (чинится только статус)',
  (select i ->> 'code' from tst.ts_sync('TT1', 'PT1', array['t1']) j, lateral (select j -> 'items' -> 0 as i) x) || '|' || tst.cell('osdesk_TOS1', 'adopt_t1', 'client'), 'ok|Клиент 1');
select tst.raw_cells('PT1', 't1', '{"client":"Клиент 1"}');

-- --- Перевесить на другого ОС, пока ОС строку не трогал -------------------
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at) values
  ('WT', 'PT1', tst.tab(), 'p1', '{"client":"Не тот ОС","os":"anna","st":"work"}', 40, 1000, 1000),
  ('WT', 'PT1', tst.tab(), 'p2', '{"client":"ОС уже снял «новые»","os":"anna"}', 41, 1000, 1000),
  ('WT', 'PT1', tst.tab(), 'p3', '{"client":"ОС добавил апсейл","os":"anna"}', 42, 1000, 1000),
  ('WT', 'PT1', tst.tab(), 'p4', '{"client":"Ник стёрли","os":"anna"}', 43, 1000, 1000);
select tst.expect('четыре строки связаны с anna',
  (select string_agg(i ->> 'code', ',') from tst.ts_sync('TT1', 'PT1', array['p1', 'p2', 'p3', 'p4']) j, jsonb_array_elements(j -> 'items') i), 'linked,linked,linked,linked');
select tst.expect('технарь меняет ник ОС в связанной строке (правка проходит, источник не тронут)',
  tst.ts_patch('TT1', 'PT1', 'p1', '{"os":"vera"}') || '|' || tst.cell('osdesk_TOS1', 'adopt_p1', 'client'), 'ok|Не тот ОС');
select tst.expect('ОС источник не трогал → он удалён, заказ связан с новым ОС',
  (select concat_ws('|', i ->> 'code', i ->> 'osUid', i ->> 'srcPage') from tst.ts_sync('TT1', 'PT1', array['p1']) j, lateral (select j -> 'items' -> 0 as i) x)
  || '|' || tst.q($q$select count(*)::text from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS1' and id = 'adopt_p1'$q$)
  || '|' || tst.q($q$select count(*)::text from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS3' and id = 'adopt_p1'$q$)
  || '|' || tst.q($q$select os_uid || '/' || src_page_id from public.desk_rows where workspace_id = 'WT' and page_id = 'PT1' and id = 'p1'$q$),
  'linked|TOS3|osdesk_TOS3|0|1|TOS3/osdesk_TOS3');
set session_replication_role = replica;
update public.desk_rows set highlight = false where workspace_id = 'WT' and page_id = 'osdesk_TOS1' and id = 'adopt_p2';
update public.desk_rows set cells = cells || '{"upsell":"5000"}' where workspace_id = 'WT' and page_id = 'osdesk_TOS1' and id = 'adopt_p3';
set session_replication_role = origin;
select tst.ts_patch('TT1', 'PT1', 'p2', '{"os":"vera"}');
select tst.ts_patch('TT1', 'PT1', 'p3', '{"os":"vera"}');
select tst.expect('ОС снял подсветку «новый» → заказ остаётся у него (osFixed)',
  (select concat_ws('|', i ->> 'code', i ->> 'osFixed', i ->> 'osUid') from tst.ts_sync('TT1', 'PT1', array['p2']) j, lateral (select j -> 'items' -> 0 as i) x)
  || '|' || tst.q($q$select count(*)::text from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS1' and id = 'adopt_p2'$q$), 'ok|true|TOS1|1');
select tst.expect('ОС вписал апсейл → заказ остаётся у него (osFixed)',
  (select concat_ws('|', i ->> 'code', i ->> 'osFixed') from tst.ts_sync('TT1', 'PT1', array['p3']) j, lateral (select j -> 'items' -> 0 as i) x)
  || '|' || tst.q($q$select os_uid from public.desk_rows where workspace_id = 'WT' and page_id = 'PT1' and id = 'p3'$q$), 'ok|true|TOS1');
select tst.ts_patch('TT1', 'PT1', 'p4', '{"os":""}');
select tst.expect('ник ОС стёрли, ОС строку не трогал → связь снята целиком, источник удалён',
  tst.ts_code('TT1', 'PT1', 'p4')
  || '|' || tst.q($q$select concat_ws('/', coalesce(os_uid, '-'), coalesce(tech_uid, '-'), coalesce(status_key, '-'), coalesce(src_row_id, '-'), coalesce(sync_hash, '-')) from public.desk_rows where workspace_id = 'WT' and page_id = 'PT1' and id = 'p4'$q$)
  || '|' || tst.q($q$select count(*)::text from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS1' and id = 'adopt_p4'$q$), 'no_os|-/-/-/-/-|0');

-- ---------------------------------------------------------------------
-- 8. Замок (desk_rows_guard).
-- ---------------------------------------------------------------------
select tst.expect('технарь напрямую ставит os_uid связанной строке → 42501',
  tst.ts_patch('TT1', 'PT1', 't1', '{}', $x$, p_os_uid => 'TT1'$x$), 'error:42501');
select tst.expect('технарь напрямую меняет адрес источника → 42501',
  tst.ts_patch('TT1', 'PT1', 't1', '{}', $x$, p_src_row => 'adopt_R'$x$), 'error:42501');
select tst.expect('технарь напрямую меняет подпись (p_sync_hash) → 42501',
  tst.ts_patch('TT1', 'PT1', 't1', '{}', $x$, p_sync_hash => 'forged'$x$), 'error:42501');
select tst.expect('технарь напрямую метит НЕсвязанную строку (os_uid + src) → 42501',
  tst.ts_patch('TT1', 'PT1', 'u_nocl', '{}', $x$, p_os_uid => 'TOS1', p_tech_uid => 'TT1', p_status_key => 'st', p_src_page => 'osdesk_TOS1', p_src_row => 'adopt_x'$x$), 'error:42501');
-- После вызова rows_tech_sync в ТОЙ ЖЕ транзакции прямые правки по-прежнему закрыты.
create or replace function tst.ts_after_sync(uid text) returns text language plpgsql as $$
declare a text; b text;
begin
  perform tst.ts_sync(uid, 'PT1', array['t1', 'u_nocl']);
  a := tst.ts_patch(uid, 'PT1', 't1', '{}', $x$, p_sync_hash => 'forged'$x$);
  b := tst.ts_patch(uid, 'PT1', 'u_nocl', '{}', $x$, p_os_uid => 'TOS1', p_tech_uid => 'TT1', p_status_key => 'st', p_src_page => 'osdesk_TOS1', p_src_row => 'adopt_x'$x$);
  return a || '|' || b;
end;
$$;
select tst.expect('…и сразу после rows_tech_sync в той же транзакции — тоже 42501', tst.ts_after_sync('TT1'), 'error:42501|error:42501');

-- Ветка GUC: что именно она пускает. GUC ставит суперпользователь (через
-- PostgREST set_config недоступен), правка идёт от лица технаря и откатывается.
create or replace function tst.ts_guarded(uid text, sql text) returns text language plpgsql as $$
declare n bigint; res text;
begin
  begin
    perform set_config('nova.tech_sync', '1', true);
    perform set_config('request.jwt.claims', tst.claims(uid), true);
    execute 'set local role anon';
    execute sql;
    get diagnostics n = row_count;
    res := 'ok:' || n;
    raise exception using errcode = 'P0001', message = '__rollback__';
  exception when others then
    if sqlerrm <> '__rollback__' then res := 'deny:' || sqlstate; end if;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('nova.tech_sync', '', true);
  return res;
end;
$$;
select tst.expect('под GUC: точная метка связи проходит',
  tst.ts_guarded('TT1', $q$update desk_rows set os_uid='TOS1', tech_uid='TT1', status_key='st', src_page_id='osdesk_TOS1', src_tab_id='', src_row_id='adopt_x'
    where workspace_id='WT' and page_id='PT1' and id='u_nocl'$q$), 'ok:1');
select tst.expect('без GUC та же правка — отказ',
  tst.try('TT1', $q$update desk_rows set os_uid='TOS1', tech_uid='TT1', status_key='st', src_page_id='osdesk_TOS1', src_tab_id='', src_row_id='adopt_x'
    where workspace_id='WT' and page_id='PT1' and id='u_nocl'$q$), 'deny');
select tst.expect('под GUC: метка вместе с правкой ячейки → отказ',
  tst.ts_guarded('TT1', $q$update desk_rows set cells = cells || '{"st":"done"}', os_uid='TOS1', tech_uid='TT1', status_key='st', src_page_id='osdesk_TOS1', src_tab_id='', src_row_id='adopt_x'
    where workspace_id='WT' and page_id='PT1' and id='u_nocl'$q$), 'deny');
select tst.expect('под GUC: источник на ЧУЖОМ столе ОС → отказ',
  tst.ts_guarded('TT1', $q$update desk_rows set os_uid='TOS1', tech_uid='TT1', status_key='st', src_page_id='osdesk_TOS3', src_tab_id='', src_row_id='adopt_x'
    where workspace_id='WT' and page_id='PT1' and id='u_nocl'$q$), 'deny');
select tst.expect('под GUC: os_uid не ОС (технарь метит на себя) → отказ',
  tst.ts_guarded('TT1', $q$update desk_rows set os_uid='TT1', tech_uid='TT1', status_key='st', src_page_id='osdesk_TT1', src_tab_id='', src_row_id='adopt_x'
    where workspace_id='WT' and page_id='PT1' and id='u_nocl'$q$), 'deny');
select tst.expect('под GUC: tech_uid не ответственный стола → отказ',
  tst.ts_guarded('TT1', $q$update desk_rows set os_uid='TOS1', tech_uid='TT2', status_key='st', src_page_id='osdesk_TOS1', src_tab_id='', src_row_id='adopt_x'
    where workspace_id='WT' and page_id='PT1' and id='u_nocl'$q$), 'deny');
select tst.expect('под GUC: метка с подписью → отказ (подпись эта ветка не пишет)',
  tst.ts_guarded('TT1', $q$update desk_rows set os_uid='TOS1', tech_uid='TT1', status_key='st', src_page_id='osdesk_TOS1', src_tab_id='', src_row_id='adopt_x', sync_hash='h'
    where workspace_id='WT' and page_id='PT1' and id='u_nocl'$q$), 'deny');
select tst.expect('под GUC: стол вне области (PT2, «Смешанный») → отказ',
  tst.ts_guarded('TT2', $q$update desk_rows set os_uid=null, tech_uid=null, status_key=null, src_page_id=null, src_tab_id=null, src_row_id=null, sync_hash=null
    where workspace_id='WT' and page_id='PT2' and id='m1'$q$), 'deny');
select tst.expect('под GUC: снятие связи целиком проходит',
  tst.ts_guarded('TT1', $q$update desk_rows set os_uid=null, tech_uid=null, status_key=null, src_page_id=null, src_tab_id=null, src_row_id=null, sync_hash=null
    where workspace_id='WT' and page_id='PT1' and id='t1'$q$), 'ok:1');
select tst.expect('под GUC: снятие связи не целиком (адрес оставлен) → отказ',
  tst.ts_guarded('TT1', $q$update desk_rows set os_uid=null, tech_uid=null, status_key=null
    where workspace_id='WT' and page_id='PT1' and id='t1'$q$), 'deny');
select tst.expect('без GUC технарь связь не снимает',
  tst.try('TT1', $q$update desk_rows set os_uid=null, tech_uid=null, status_key=null, src_page_id=null, src_tab_id=null, src_row_id=null, sync_hash=null
    where workspace_id='WT' and page_id='PT1' and id='t1'$q$), 'deny');

-- Отметка «вернули технарю».
update public.desk_rows set cells = cells || '{"osReleasedFrom":"anna"}' where workspace_id = 'WT' and page_id = 'PT1' and id = 'u_nocl';
select tst.expect('технарь стирает отметку «вернули технарю» → 42501',
  tst.ts_patch('TT1', 'PT1', 'u_nocl', '{"osReleasedFrom":""}'), 'error:42501');
select tst.expect('технарь меняет отметку → 42501', tst.ts_patch('TT1', 'PT1', 'u_nocl', '{"osReleasedFrom":"vera"}'), 'error:42501');
select tst.expect('остальные ячейки той же строки технарь правит', tst.ts_patch('TT1', 'PT1', 'u_nocl', '{"client":"Вписал клиента"}') || '!', 'ok!');
select tst.expect('…и строка с отметкой сама к ОС не уходит', tst.ts_code('TT1', 'PT1', 'u_nocl'), 'released');
select tst.run('TO', $q$select rows_set_tech_sync('WT', false)$q$);
select tst.expect('флаг выключен — отметку технарь правит, как раньше',
  tst.try('TT1', format($q$select rows_patch('WT','PT1',%L,'u_nocl','{"osReleasedFrom":""}'::jsonb)$q$, tst.tab())), 'ok:1');
select tst.run('TO', $q$select rows_set_tech_sync('WT', true)$q$);
select tst.expect('Owner отметку меняет', tst.ts_patch('TO', 'PT1', 'u_nocl', '{"osReleasedFrom":"vera"}') || '!', 'ok!');

-- Адрес копии со строки-источника, пока копия связана.
select tst.expect('ОС снимает адрес живой связанной копии («потеряна» по устаревшему списку) → 42501',
  tst.try('TOS1', $q$select rows_patch('WT','osdesk_TOS1','','adopt_t1','{"osLostFor":"nick_t1"}'::jsonb, p_clear_mirror => true)$q$), 'deny:42501');
select tst.expect('…Owner тоже → 42501',
  tst.try('TO', $q$select rows_patch('WT','osdesk_TOS1','','adopt_t1','{}'::jsonb, p_clear_mirror => true)$q$), 'deny:42501');
select tst.expect('адрес, по которому копии нет, ОС снимает (копию удалили)',
  tst.try('TOS1', $q$select rows_patch('WT','osdesk_TOS1','','adopt_k2','{}'::jsonb, p_clear_mirror => true)$q$), 'ok:1');
select tst.run('TO', $q$select rows_set_tech_sync('WT', false)$q$);
select tst.expect('флаг выключен — адрес снимается, как раньше',
  tst.try('TOS1', $q$select rows_patch('WT','osdesk_TOS1','','adopt_t1','{}'::jsonb, p_clear_mirror => true)$q$), 'ok:1');
select tst.run('TO', $q$select rows_set_tech_sync('WT', true)$q$);
select tst.expect('«Вернуть»: Owner снимает связь с копии, затем адрес с источника — проходит',
  tst.ts_patch('TO', 'PT1', 'p3', '{"osReleasedFrom":"anna"}', $x$, p_release_order => true$x$)
  || '|' || tst.tsv('TO', $q$select rows_patch('WT','osdesk_TOS1','','adopt_p3','{"osLostFor":"nick_t1"}'::jsonb, p_clear_mirror => true)::text$q$)
  || '|' || tst.q($q$select coalesce(mirror_row_id, 'null') from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS1' and id = 'adopt_p3'$q$), 'ok||null');
select tst.expect('…после «Вернуть» правка технаря к ОС не едет, строка сама не связывается',
  tst.ts_patch('TT1', 'PT1', 'p3', '{"st":"after_release","os":"anna"}') || '|' || coalesce(tst.cell('osdesk_TOS1', 'adopt_p3', 'stx'), 'null') || '|' || tst.ts_code('TT1', 'PT1', 'p3'),
  'ok|null|released');
select tst.expect('…«Передать ОС» (Owner, force) возвращает её ОС и снимает отметку',
  tst.ts_code('TO', 'PT1', 'p3', true) || '|' || tst.cell('PT1', 'p3', 'osReleasedFrom') || '|' || tst.cell('osdesk_TOS1', 'adopt_p3', 'osLostFor')
  || '|' || tst.cell('osdesk_TOS1', 'adopt_p3', 'stx') || '|' || tst.cell('osdesk_TOS1', 'adopt_p3', 'upsell'),
  'linked|||after_release|5000');

select tst.expect('текст замка: ветка возврата ОС (20261002) и ветка переноса (20261007) на месте',
  tst.try('TO', $q$select 1 from pg_proc where proname = 'desk_rows_guard' and prosrc like '%вернуть строку технарю%'
    and prosrc like '%nova.carry_over%' and prosrc like '%nova.tech_sync%'$q$, true), 'ok:1');
select tst.expect('триггер замка ровно один',
  tst.try('TO', $q$select 1 from pg_trigger where tgrelid = 'public.desk_rows'::regclass and tgname = 'desk_rows_guard'$q$, true), 'ok:1');
select tst.expect('порядок BEFORE-триггеров desk_rows не изменился',
  (select string_agg(tgname, ',' order by tgname) from pg_trigger
    where tgrelid = 'public.desk_rows'::regclass and not tgisinternal and (tgtype & 2) = 2),
  'desk_rows_guard,desk_rows_os_managed,desk_rows_os_status_push,desk_rows_rev');
select tst.expect('новый триггер — AFTER UPDATE и по имени раньше истории событий',
  (select string_agg(tgname, ',' order by tgname) from pg_trigger
    where tgrelid = 'public.desk_rows'::regclass and not tgisinternal and (tgtype & 2) = 0 and (tgtype & 16) = 16),
  'desk_rows_tech_push,desk_rows_zz_events');

-- ---------------------------------------------------------------------
-- 8а. Находки ревью перед выкладкой (06.10.2026).
-- ---------------------------------------------------------------------
-- (1) Перевесить / снять ОС можно, только пока ОС источник НЕ ТРОГАЛ. Своя
--     заметка ОС событий не оставляет — её ловит условие по «Примечанию»;
--     цена и статус ОС — событие истории с его uid.
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at) values
  ('WT', 'PT1', tst.tab(), 'v1', '{"client":"ОС вписал заметку","os":"anna","st":"work"}', 50, 1000, 1000),
  ('WT', 'PT1', tst.tab(), 'v2', '{"client":"ОС вписал цену и статус","os":"anna","st":"work"}', 51, 1000, 1000),
  ('WT', 'PT1', tst.tab(), 'v3', '{"client":"ОС не трогал, пожелание из визитки","os":"anna","st":"work"}', 52, 1000, 1000);
update public.desk_rows set extras = '{"note":"пожелание клиента"}' where workspace_id = 'WT' and page_id = 'PT1' and id = 'v3';
select tst.expect('ревью 1: три строки связаны с anna',
  (select string_agg(i ->> 'code', ',') from tst.ts_sync('TT1', 'PT1', array['v1', 'v2', 'v3']) j, jsonb_array_elements(j -> 'items') i), 'linked,linked,linked');
select tst.run('TOS1', $q$select rows_patch('WT','osdesk_TOS1','','adopt_v1','{"note":"ВАЖНО: предоплата 50 %"}'::jsonb)$q$);
select tst.run('TOS1', $q$select rows_patch('WT','osdesk_TOS1','','adopt_v2','{"price":"250000","total":"250000","stx":"done"}'::jsonb)$q$);
select tst.expect('ревью 1: заметка ОС событий не оставила, цена и статус — оставили (подсветка «новый» у обеих не снята)',
  (select count(*)::text from public.order_events where workspace_id = 'WT' and order_key = 'adopt_v1' and actor_uid = 'TOS1')
  || '|' || (select (count(*) > 0)::text from public.order_events where workspace_id = 'WT' and order_key = 'adopt_v2' and actor_uid = 'TOS1')
  || '|' || (select string_agg(highlight::text, ',' order by id) from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS1' and id in ('adopt_v1', 'adopt_v2')),
  '0|true|true,true');
select tst.ts_patch('TT1', 'PT1', 'v1', '{"os":""}');
select tst.ts_patch('TT1', 'PT1', 'v2', '{"os":""}');
select tst.ts_patch('TT1', 'PT1', 'v3', '{"os":""}');
select tst.expect('ревью 1: ОС вписал свою заметку, технарь стёр ник → osFixed, источник и связь на месте',
  (select concat_ws('|', i ->> 'code', i ->> 'osFixed', i ->> 'osUid') from tst.ts_sync('TT1', 'PT1', array['v1']) j, lateral (select j -> 'items' -> 0 as i) x)
  || '|' || tst.q($q$select count(*)::text from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS1' and id = 'adopt_v1'$q$)
  || '|' || tst.cell('osdesk_TOS1', 'adopt_v1', 'note')
  || '|' || tst.q($q$select os_uid || '/' || src_row_id from public.desk_rows where workspace_id = 'WT' and page_id = 'PT1' and id = 'v1'$q$),
  'ok|true|TOS1|1|ВАЖНО: предоплата 50 %|TOS1/adopt_v1');
select tst.expect('ревью 1: ОС поставил цену и статус, технарь стёр ник → osFixed, источник и связь на месте',
  (select concat_ws('|', i ->> 'code', i ->> 'osFixed', i ->> 'osUid') from tst.ts_sync('TT1', 'PT1', array['v2']) j, lateral (select j -> 'items' -> 0 as i) x)
  || '|' || tst.q($q$select count(*)::text from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS1' and id = 'adopt_v2'$q$)
  || '|' || tst.cell('osdesk_TOS1', 'adopt_v2', 'price')
  || '|' || tst.q($q$select os_uid || '/' || src_row_id from public.desk_rows where workspace_id = 'WT' and page_id = 'PT1' and id = 'v2'$q$),
  'ok|true|TOS1|1|250000|TOS1/adopt_v2');
select tst.expect('ревью 1: «Примечание» — ровно пожелание из визитки, ОС не трогал → связь снимается, как раньше',
  tst.ts_code('TT1', 'PT1', 'v3')
  || '|' || tst.q($q$select count(*)::text from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS1' and id = 'adopt_v3'$q$)
  || '|' || tst.q($q$select coalesce(os_uid, '-') from public.desk_rows where workspace_id = 'WT' and page_id = 'PT1' and id = 'v3'$q$), 'no_os|0|-');

-- (2) p_force и подобранный id строки технаря: чужую строку стола ОС без
--     адреса копии не берём и не переписываем.
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at) values
  ('WT', 'PT1', tst.tab(), 'os_own1', '{"client":"Подмена","phone":"000","os":"anna","price":"1","st":"work"}', 53, 1000, 1000),
  ('WT', 'PT1', tst.tab(), 'w1', '{"client":"Подмена 2","os":"anna","price":"2"}', 54, 1000, 1000),
  -- заказ, который ОС вернул ДРУГОМУ технарю (nick_t7), под id, выводимым из w1
  ('WT', 'osdesk_TOS1', '', 'adopt_w1', '{"client":"Заказ TT7","price":"500000","techx":"","osLostFor":"nick_t7","note":"заметка ОС"}', 70, 1000, 1000);
insert into tst.ts_mem
select 'own1', cells::text from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS1' and id = 'own1'
union all select 'adopt_w1', cells::text from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS1' and id = 'adopt_w1';
select tst.expect('ревью 2: force на os_<id обычной строки ОС без адреса копии> — та строка не тронута, источник заведён свой',
  (select concat_ws('|', i ->> 'code', i ->> 'srcRow') from tst.ts_sync('TO', 'PT1', array['os_own1'], true) j, lateral (select j -> 'items' -> 0 as i) x)
  || '|' || (tst.q($q$select cells::text from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS1' and id = 'own1'$q$) = (select v from tst.ts_mem where k = 'own1'))::text
  || '|' || tst.q($q$select coalesce(mirror_row_id, 'null') || '/' || coalesce(highlight, false)::text from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS1' and id = 'own1'$q$)
  || '|' || tst.q($q$select src_row_id from public.desk_rows where workspace_id = 'WT' and page_id = 'PT1' and id = 'os_own1'$q$),
  'linked|adopt_os_own1|true|null/false|adopt_os_own1');
select tst.expect('ревью 2: …и правка технаря после связи до той строки не доезжает',
  tst.ts_patch('TT1', 'PT1', 'os_own1', '{"client":"Ещё раз","price":"5"}')
  || '|' || (tst.q($q$select cells::text from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS1' and id = 'own1'$q$) = (select v from tst.ts_mem where k = 'own1'))::text
  || '|' || tst.cell('osdesk_TOS1', 'adopt_os_own1', 'client'), 'ok|true|Ещё раз');
select tst.expect('ревью 2: источник, возвращённый ДРУГОМУ технарю: без force → released',
  tst.ts_code('TT1', 'PT1', 'w1'), 'released');
select tst.expect('ревью 2: …с force он не тронут, источник заведён под id с хвостом',
  (select concat_ws('|', i ->> 'code', (i ->> 'srcRow' = 'adopt_w1_' || substr(md5('PT1/' || tst.tab()), 1, 8))::text)
   from tst.ts_sync('TO', 'PT1', array['w1'], true) j, lateral (select j -> 'items' -> 0 as i) x)
  || '|' || (tst.q($q$select cells::text from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS1' and id = 'adopt_w1'$q$) = (select v from tst.ts_mem where k = 'adopt_w1'))::text
  || '|' || tst.q($q$select coalesce(mirror_row_id, 'null') from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS1' and id = 'adopt_w1'$q$)
  || '|' || tst.q($q$select count(*)::text from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS1' and id like 'adopt\_w1%'$q$),
  'linked|true|true|null|2');

-- (3) Период только начался: документа вкладки стола ОС ещё нет, источник
--     лежит в её будущем id. Правки технаря обязаны доезжать и туда.
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at) values
  ('WT', 'PT1', tst.tab(), 'y1', '{"client":"Планируемая","os":"vera","price":"50000","phone":"111"}', 55, 1000, 1000);
select tst.expect('ревью 3: связь в планируемую вкладку стола ОС vera (документа вкладки нет)',
  (select concat_ws('|', i ->> 'code', i ->> 'srcTab', i ->> 'planned') from tst.ts_sync('TT1', 'PT1', array['y1']) j, lateral (select j -> 'items' -> 0 as i) x)
  || '|' || coalesce(public.rows_os_tab_keys('WT', 'osdesk_TOS3', tst.tab())::text, 'null'),
  'linked|' || tst.tab() || '|true|null');
select tst.expect('ревью 3: статус, телефон, цена и клиент доезжают до источника в планируемой вкладке, «Итого» верное',
  tst.ts_patch('TT1', 'PT1', 'y1', '{"st":"done","phone":"222","price":"80 000","client":" Новое имя "}')
  || '|' || concat_ws('|', tst.cell('osdesk_TOS3', 'adopt_y1', 'status'), tst.cell('osdesk_TOS3', 'adopt_y1', 'osStatusSent'), tst.cell('osdesk_TOS3', 'adopt_y1', 'phone'),
       tst.cell('osdesk_TOS3', 'adopt_y1', 'price'), tst.cell('osdesk_TOS3', 'adopt_y1', 'client'), tst.cell('osdesk_TOS3', 'adopt_y1', 'total'))
  || '|' || tst.q($q$select (tab_id = tst.tab())::text from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS3' and id = 'adopt_y1'$q$),
  'ok|done|done|222|80000|Новое имя|80000|true');
select tst.expect('ревью 3: …и сверка расхождений по этой строке не видит',
  tst.tsv('TT1', format($q$select (not (rows_tech_sync_scan('WT','PT1',%L) -> 'drift') ? 'y1')::text$q$, tst.tab())), 'true');

-- (4) «Вернуть» → «Передать ОС»: у переиспользуемого источника с апсейлом
--     или комиссией на цене сумма технаря — это «Итого», цену ОС не трогаем.
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at) values
  ('WT', 'PT1', tst.tab(), 'z1', '{"client":"С апсейлом","os":"anna","price":"100000","st":"work"}', 56, 1000, 1000),
  ('WT', 'PT1', tst.tab(), 'z2', '{"client":"С комиссией на цене","os":"anna","price":"100000","st":"work"}', 57, 1000, 1000),
  ('WT', 'PT1', tst.tab(), 'z3', '{"client":"Без апсейла и комиссий","os":"anna","price":"100","st":"work"}', 58, 1000, 1000);
select tst.expect('ревью 4: три строки связаны с anna',
  (select string_agg(i ->> 'code', ',') from tst.ts_sync('TT1', 'PT1', array['z1', 'z2', 'z3']) j, jsonb_array_elements(j -> 'items') i), 'linked,linked,linked');
-- ОС добавил апсейл 50 000 через способ с комиссией 8 % (z1) и комиссию 8 % на
-- цену (z2); проход стола ОС привёз технарю «Итого» как его сумму.
select tst.raw_cells('osdesk_TOS1', 'adopt_z1', '{"upsell":"50000","upsell__fee":8,"upsell__pay":"lava","total":"146000"}');
select tst.raw_cells('PT1', 'z1', '{"price":"146000"}');
select tst.raw_cells('osdesk_TOS1', 'adopt_z2', '{"price__fee":8,"price__pay":"lava","total":"92000"}');
select tst.raw_cells('PT1', 'z2', '{"price":"92000"}');
create or replace function tst.ts_return(rw text) returns text language sql as $$
  select tst.ts_patch('TO', 'PT1', rw, '{"osReleasedFrom":"anna"}', $x$, p_release_order => true$x$)
    || '/' || tst.tsv('TO', format($q$select coalesce(rows_patch('WT','osdesk_TOS1','',%L,'{"osLostFor":"nick_t1"}'::jsonb, p_clear_mirror => true)::text, '') || 'cleared'$q$, 'adopt_' || rw))
$$;
select tst.expect('ревью 4: «Вернуть» всех трёх', tst.ts_return('z1') || ',' || tst.ts_return('z2') || ',' || tst.ts_return('z3'), 'ok/cleared,ok/cleared,ok/cleared');
select tst.ts_patch('TT1', 'PT1', 'z3', '{"price":"200"}');
select tst.expect('ревью 4: «Передать ОС» у заказа с апсейлом — цена, апсейл и «Итого» источника прежние',
  tst.ts_code('TO', 'PT1', 'z1', true)
  || '|' || concat_ws('|', tst.cell('osdesk_TOS1', 'adopt_z1', 'price'), tst.cell('osdesk_TOS1', 'adopt_z1', 'upsell'), tst.cell('osdesk_TOS1', 'adopt_z1', 'upsell__fee'), tst.cell('osdesk_TOS1', 'adopt_z1', 'total'))
  || '|' || tst.q($q$select mirror_row_id from public.desk_rows where workspace_id = 'WT' and page_id = 'osdesk_TOS1' and id = 'adopt_z1'$q$),
  'linked|100000|50000|8|146000|z1');
select tst.expect('ревью 4: …и с комиссией на цене — цена и «Итого» прежние',
  tst.ts_code('TO', 'PT1', 'z2', true)
  || '|' || concat_ws('|', tst.cell('osdesk_TOS1', 'adopt_z2', 'price'), tst.cell('osdesk_TOS1', 'adopt_z2', 'price__fee'), tst.cell('osdesk_TOS1', 'adopt_z2', 'total')),
  'linked|100000|8|92000');
select tst.expect('ревью 4: без апсейла и комиссий цена источника пишется, как раньше (сумму технарь менял, пока строка была у него)',
  tst.ts_code('TO', 'PT1', 'z3', true)
  || '|' || concat_ws('|', tst.cell('osdesk_TOS1', 'adopt_z3', 'price'), tst.cell('osdesk_TOS1', 'adopt_z3', 'total')), 'linked|200|200');
select tst.expect('ревью 4: после «Передать ОС» сумма технаря сверяется с «Итого» ОС без отказа',
  (select concat_ws('|', i ->> 'code', coalesce(i ->> 'sum', 'нет')) from tst.ts_sync('TT1', 'PT1', array['z1']) j, lateral (select j -> 'items' -> 0 as i) x), 'ok|нет');

-- ---------------------------------------------------------------------
-- 9. Права на функции, версия, повторный накат.
-- ---------------------------------------------------------------------
do $$ begin if not exists (select 1 from pg_roles where rolname = 'tst_nobody') then create role tst_nobody nologin; end if; end $$;
select tst.expect('служебные функции закрыты от ролей API и PUBLIC',
  (select count(*)::text from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('rows_js_trim', 'rows_num_loose', 'rows_num_text', 'rows_cell_num', 'rows_os_total', 'rows_os_cols_keys', 'rows_period_key',
       'rows_core_live', 'rows_tech_sync_on', 'rows_period_now', 'rows_tech_keys', 'rows_tech_nick', 'rows_os_tab_keys', 'rows_os_target',
       'rows_tech_apply', 'rows_tech_sync_item', 'desk_rows_tech_push')
     and not has_function_privilege('anon', p.oid, 'execute')
     and not has_function_privilege('authenticated', p.oid, 'execute')
     and not has_function_privilege('tst_nobody', p.oid, 'execute')), '17');
select tst.expect('четыре RPC выданы anon и authenticated, но не PUBLIC',
  (select count(*)::text from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('rows_tech_sync', 'rows_tech_sync_scan', 'rows_tech_sync_state', 'rows_set_tech_sync')
     and has_function_privilege('anon', p.oid, 'execute') and has_function_privilege('authenticated', p.oid, 'execute')
     and not has_function_privilege('tst_nobody', p.oid, 'execute')), '4');
select tst.expect('технарь не зовёт служебные функции напрямую',
  tst.try('TT1', $q$select rows_tech_sync_item('WT','PT1','x','t1',true,'TT1',null,'2026-10')$q$), 'deny:42501');
select tst.expect('версия схемы не старее 20261045', (public.nova_schema_version() >= '20261045')::text, 'true');

insert into tst.ts_mem values ('snap_final', tst.os_snap());
grant all on function public.rows_tech_apply(public.desk_rows, public.desk_rows, text) to public;
grant all on function public.rows_tech_sync(text, text, text, jsonb, boolean) to public;
\ir ../migrations/20261045_tech_sync.sql
select tst.expect('повторный накат: данные столов ОС те же, флаг на месте',
  (tst.os_snap() = (select v from tst.ts_mem where k = 'snap_final'))::text || '|' || (select tech_sync::text from public.rows_workspaces where workspace_id = 'WT'), 'true|true');
select tst.expect('повторный накат поверх «открытых» прав снова закрывает функции',
  (not has_function_privilege('tst_nobody', 'public.rows_tech_apply(public.desk_rows, public.desk_rows, text)', 'execute')
   and not has_function_privilege('anon', 'public.rows_tech_apply(public.desk_rows, public.desk_rows, text)', 'execute')
   and not has_function_privilege('tst_nobody', 'public.rows_tech_sync(text, text, text, jsonb, boolean)', 'execute'))::text, 'true');
select tst.expect('после повторного наката триггер один и работает',
  (select count(*)::text from pg_trigger where tgrelid = 'public.desk_rows'::regclass and tgname = 'desk_rows_tech_push')
  || '|' || tst.ts_patch('TT1', 'PT1', 't1', '{"st":"final"}') || '|' || tst.cell('osdesk_TOS1', 'adopt_t1', 'stx'), '1|ok|final');
select tst.expect('после повторного наката по одной функции каждого имени',
  (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace
    and proname in ('rows_tech_sync', 'rows_tech_sync_item', 'rows_tech_apply', 'rows_tech_sync_scan', 'rows_tech_sync_state', 'rows_set_tech_sync', 'desk_rows_guard')), '7');

-- Проверка, чьё выражение дало NULL (строки, которую читали, уже нет), —
-- тоже провал: «not ok» её не считал, и строка FAIL печаталась пустой.
select case when ok then '  OK  ' else 'FAIL  ' end || label || case when ok then '' else '  → ' || coalesce(got, '<NULL>') end
from tst.results order by n;
select format('ПРОВЕРОК (авто-передача ОС): %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where ok is not true)) from tst.results;
