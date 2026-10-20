-- Проверки «Таблица ОС» (20261053_os_sheet.sql). Запускать ПОСЛЕ
-- desk_rows_rls.sql (хелперы tst.*). Свой workspace WOS.
truncate tst.results;

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
  return 'error:' || sqlstate;
end;
$$;

insert into public.rows_workspaces (workspace_id, owner_id, live, ring_salt)
values ('WOS', 'OO', true, 'b1c2d3e4f5061728') on conflict do nothing;
insert into public.rows_workspaces (workspace_id, owner_id, live) values ('WOS2', 'PO2', true) on conflict do nothing;
insert into public.rows_members (workspace_id, uid, role, extra_roles) values
  ('WOS', 'OO', 'owner', '{}'),
  ('WOS', 'OTL', 'teamlead', '{}'),
  ('WOS', 'OLP', 'leadplus', '{}'),
  ('WOS', 'OT1', 'manager', '{}'),
  ('WOS', 'OMX', 'manager', '{os}'),
  ('WOS', 'OS1', 'os', '{}'),
  ('WOS', 'OS2', 'os', '{}'),
  ('WOS', 'OV', 'viewer', '{}'),
  ('WOS2', 'PO2', 'owner', '{}')
on conflict do nothing;

create temp table oss_tok (k text primary key, v text);
create temp table oss_p (k text primary key, v jsonb);
grant all on oss_tok, oss_p to anon;

create or replace function tst.os_tok(key text) returns text language sql as $$ select v from oss_tok where k = key $$;
create or replace function tst.os_p(key text) returns text language sql as $$ select v::text from oss_p where k = key $$;
-- Передача от лица скрипта: секрет, источник, листы, отчёт, «забрать подключение».
create or replace function tst.os_push(tok text, src text, payload text, done text default '[]', claim boolean default false)
returns text language sql as $$
  select format($q$select os_sheet_push('WOS', %L, %L, %L::jsonb, %L::jsonb, %L)$q$, tok, src, payload, done, claim)
$$;

-- Лист «Октябрь оформление»: шапка + две строки; столбец 3 — формула.
insert into oss_p values ('p1', $j${"v":1,"id":"SheetAAAAAAAA1","title":"StoryLove — Данные (Октябрь)",
  "sheets":["Октябрь оформление","Апсейлы ОС Октябрь",7],
  "tabs":[{"name":"Октябрь оформление","gid":5,"fr":1,"fc":0,"hdr":1,"w":[120,90,130,100],
    "cols":[{"k":"t"},{"k":"d"},{"k":"t"},{"k":"n","f":1}],"key":[0,1,2],"st":{"h":{"b":"#274e13","c":"#ffffff","w":1}},
    "rows":[["Имя","Дата","Номер телефона","Флаг"],["Александра","01.10.2026","82 10-25332108","95 000"],["Ник","01.10.2026","1 773 595 5343","80 000"]],
    "s":[["h","h","h","h"],["","","",""],["","","",""]],
    "fx":[null,[3],[3]]}]}$j$);
-- Та же, у Ника правка имени.
insert into oss_p select 'p2', jsonb_set(v, '{tabs,0,rows,2,0}', '"Никита"') from oss_p where k = 'p1';
-- Та же, без последней строки.
insert into oss_p select 'p3', jsonb_set(jsonb_set(jsonb_set(v, '{tabs,0,rows}', (v #> '{tabs,0,rows}') - 2),
  '{tabs,0,s}', (v #> '{tabs,0,s}') - 2), '{tabs,0,fx}', (v #> '{tabs,0,fx}') - 2) from oss_p where k = 'p2';

-- ---------------------------------------------------------------------
-- Не подключено.
select tst.expect('до подключения — connected false',
  tst.val('OS1', $q$select os_sheet_get('WOS')->>'connected'$q$), 'false');
select tst.expect('до подключения ОС — правщик',
  tst.val('OS1', $q$select os_sheet_get('WOS')->>'canEdit'$q$), 'true');
select tst.expect('до подключения технарь — не правщик',
  tst.val('OT1', $q$select os_sheet_get('WOS')->>'canEdit'$q$), 'false');
select tst.expect('посторонний не читает', tst.try('X', $q$select os_sheet_get('WOS')$q$), 'deny:42501');
select tst.expect('анонимный ключ не читает', tst.try('__anon_key__', $q$select os_sheet_get('WOS')$q$), 'deny:42501');
select tst.expect('Owner другой компании не читает', tst.try('PO2', $q$select os_sheet_get('WOS')$q$), 'deny:42501');
select tst.expect('прямого чтения настройки нет', tst.try('OO', $q$select * from os_sheet$q$, true), 'deny:42501');
select tst.expect('прямого чтения строк нет', tst.try('OO', $q$select * from os_sheet_rows$q$, true), 'deny:42501');
select tst.expect('прямого чтения очереди нет', tst.try('OS1', $q$select * from os_sheet_edits$q$, true), 'deny:42501');
select tst.expect('прямой записи в очередь нет',
  tst.try('OS1', $q$insert into os_sheet_edits (workspace_id, tab, c, by_uid) values ('WOS', 'x', 0, 'OS1')$q$), 'deny:42501');

-- Секрет выдаёт только Owner.
select tst.expect('технарь не выдаёт секрет', tst.try('OT1', $q$select os_sheet_new_token('WOS')$q$), 'deny:42501');
select tst.expect('ОС не выдаёт секрет', tst.try('OS1', $q$select os_sheet_new_token('WOS')$q$), 'deny:42501');
select tst.expect('Тимлид не выдаёт секрет', tst.try('OTL', $q$select os_sheet_new_token('WOS')$q$), 'deny:42501');
select tst.expect('Owner другой компании не выдаёт секрет', tst.try('PO2', $q$select os_sheet_new_token('WOS')$q$), 'deny:42501');
select tst.expect('настройку читает только Owner', tst.try('OTL', $q$select os_sheet_config('WOS')$q$), 'deny:42501');
insert into oss_tok values ('t1', tst.val('OO', $q$select os_sheet_new_token('WOS')->>'token'$q$));
select tst.expect('секрет — 64 hex', (tst.os_tok('t1') ~ '^[0-9a-f]{64}$')::text, 'true');
select tst.expect('настройка отдаёт соль звонков', tst.val('OO', $q$select os_sheet_config('WOS')->>'salt'$q$), 'b1c2d3e4f5061728');
select tst.expect('по умолчанию — только ОС и руководство', tst.val('OO', $q$select os_sheet_config('WOS')->>'audience'$q$), 'os');
select tst.expect('до первой передачи правки не принимаются',
  tst.try('OS1', $q$select os_sheet_edit('WOS', '[{"tab":"Октябрь оформление","r":1,"c":0,"v":"x"}]')$q$), 'deny:55000');

-- Передача: секрет, источник, форма.
select tst.expect('чужой секрет — отказ',
  tst.try('__anon_key__', tst.os_push(repeat('a', 64), 'SheetAAAAAAAA1', '{"tabs":[]}')), 'deny:42501');
select tst.expect('кривой секрет — отказ',
  tst.try('__anon_key__', tst.os_push('x', 'SheetAAAAAAAA1', '{"tabs":[]}')), 'deny:42501');
select tst.expect('секрет к другому workspace — отказ',
  tst.try('__anon_key__', format($q$select os_sheet_push('WOS2', %L, 'SheetAAAAAAAA1', '{"tabs":[]}')$q$, tst.os_tok('t1'))), 'deny:42501');
select tst.expect('кривой источник — отказ',
  tst.try('__anon_key__', tst.os_push(tst.os_tok('t1'), 'x/../y', '{"tabs":[]}')), 'deny:22023');
select tst.expect('не объект — отказ',
  tst.try('__anon_key__', tst.os_push(tst.os_tok('t1'), 'SheetAAAAAAAA1', '[1]')), 'deny:22023');
select tst.expect('листов больше 4 — отказ',
  tst.try('__anon_key__', tst.os_push(tst.os_tok('t1'), 'SheetAAAAAAAA1', jsonb_build_object('tabs',
    (select jsonb_agg(jsonb_build_object('name', 'L' || g, 'rows', '[]'::jsonb)) from generate_series(1, 5) g))::text)), 'deny:22023');
select tst.expect('два листа с одним именем — отказ',
  tst.try('__anon_key__', tst.os_push(tst.os_tok('t1'), 'SheetAAAAAAAA1',
    '{"tabs":[{"name":"A","rows":[]},{"name":"A","rows":[]}]}')), 'deny:22023');
select tst.expect('строк больше 3000 — отказ',
  tst.try('__anon_key__', tst.os_push(tst.os_tok('t1'), 'SheetAAAAAAAA1', jsonb_build_object('tabs', jsonb_build_array(
    jsonb_build_object('name', 'A', 'rows', (select jsonb_agg('[]'::jsonb) from generate_series(1, 3001)))))::text)), 'deny:22023');
select tst.expect('строка не массив — отказ',
  tst.try('__anon_key__', tst.os_push(tst.os_tok('t1'), 'SheetAAAAAAAA1', '{"tabs":[{"name":"A","rows":[{"a":1}]}]}')), 'deny:22023');
select tst.expect('ячеек в строке больше 40 — отказ',
  tst.try('__anon_key__', tst.os_push(tst.os_tok('t1'), 'SheetAAAAAAAA1', jsonb_build_object('tabs', jsonb_build_array(
    jsonb_build_object('name', 'A', 'rows', jsonb_build_array((select jsonb_agg(''::text) from generate_series(1, 41))))))::text)), 'deny:22023');
select tst.expect('больше 4 МБ — отказ',
  tst.try('__anon_key__', tst.os_push(tst.os_tok('t1'), 'SheetAAAAAAAA1',
    jsonb_build_object('tabs', '[]'::jsonb, 'pad', repeat('я', 2000001))::text)), 'deny:22023');
select tst.expect('отчёт не массив — отказ',
  tst.try('__anon_key__', tst.os_push(tst.os_tok('t1'), 'SheetAAAAAAAA1', '{"tabs":[]}', '{"id":1}')), 'deny:22023');

select tst.expect('первая передача — changed',
  tst.val('__anon_key__', tst.os_push(tst.os_tok('t1'), 'SheetAAAAAAAA1', tst.os_p('p1'), '[]', true) || $q$->>'changed'$q$), 'true');
select tst.expect('источник записан', tst.val('OO', $q$select os_sheet_config('WOS')->>'source'$q$), 'SheetAAAAAAAA1');
select tst.expect('название записано', tst.val('OO', $q$select os_sheet_config('WOS')->>'title'$q$), 'StoryLove — Данные (Октябрь)');
select tst.expect('кривой список листов (не строки) не записан',
  tst.val('OO', $q$select os_sheet_config('WOS')->>'sheets'$q$), '["Октябрь оформление", "Апсейлы ОС Октябрь"]');
select tst.expect('версия 1', tst.val('OS1', $q$select os_sheet_get('WOS')->>'ver'$q$), '1');
select tst.expect('ОС читает все строки',
  tst.val('OS1', $q$select jsonb_array_length(os_sheet_get('WOS')->'rows')::text$q$), '3');
select tst.expect('строка — [лист, номер, ячейки, стили, формулы]',
  tst.val('OS1', $q$select (os_sheet_get('WOS')->'rows'->1)::text$q$), '["Октябрь оформление", 1, ["Александра", "01.10.2026", "82 10-25332108", "95 000"], ["", "", "", ""], [3]]');
select tst.expect('описание листа — число строк',
  tst.val('OS1', $q$select os_sheet_get('WOS')->'meta'->'tabs'->0->>'n'$q$), '3');
select tst.expect('описание листа — без самих строк',
  tst.val('OS1', $q$select (os_sheet_get('WOS')->'meta'->'tabs'->0 ?| array['rows', 's', 'fx'])::text$q$), 'false');
select tst.expect('описание листа — палитра и столбцы',
  tst.val('OS1', $q$select os_sheet_get('WOS')->'meta'->'tabs'->0->'st'->'h'->>'b' || '/' || (os_sheet_get('WOS')->'meta'->'tabs'->0->'cols'->3->>'f')$q$), '#274e13/1');
select tst.expect('id таблицы — в описании',
  tst.val('OS1', $q$select os_sheet_get('WOS')->'meta'->>'id'$q$), 'SheetAAAAAAAA1');
select tst.expect('секрета в чтении нет', tst.val('OS1', $q$select (os_sheet_get('WOS') ? 'token')::text$q$), 'false');

-- Кто видит (по умолчанию «ОС и руководство»).
select tst.expect('технарь не видит', tst.val('OT1', $q$select os_sheet_get('WOS')->>'allowed'$q$), 'false');
select tst.expect('технарю строки не отдаются', tst.val('OT1', $q$select coalesce(os_sheet_get('WOS')->>'rows', 'null')$q$), 'null');
select tst.expect('Viewer не видит', tst.val('OV', $q$select os_sheet_get('WOS')->>'allowed'$q$), 'false');
select tst.expect('Тимлид правит', tst.val('OTL', $q$select os_sheet_get('WOS')->>'canEdit'$q$), 'true');
select tst.expect('Тимлид+ правит', tst.val('OLP', $q$select os_sheet_get('WOS')->>'canEdit'$q$), 'true');
select tst.expect('Owner правит', tst.val('OO', $q$select os_sheet_get('WOS')->>'canEdit'$q$), 'true');
select tst.expect('Технарь + ОС правит', tst.val('OMX', $q$select os_sheet_get('WOS')->>'canEdit'$q$), 'true');

-- Тот же лист — ничего не меняется; другой — только изменившаяся строка.
update public.os_sheet set seen_at = now() - interval '1 hour' where workspace_id = 'WOS';
select tst.expect('повтор тех же листов — не changed',
  tst.val('__anon_key__', tst.os_push(tst.os_tok('t1'), 'SheetAAAAAAAA1', tst.os_p('p1')) || $q$->>'changed'$q$), 'false');
select tst.expect('повтор отмечает «на связи»',
  (select (seen_at > now() - interval '1 minute')::text from public.os_sheet where workspace_id = 'WOS'), 'true');
select tst.expect('повтор не поднимает версию', tst.val('OS1', $q$select os_sheet_get('WOS')->>'ver'$q$), '1');
select tst.expect('с версии 1 — строк нет',
  tst.val('OS1', $q$select jsonb_array_length(os_sheet_get('WOS', 1)->'rows')::text$q$), '0');
select tst.expect('с версии 1 — описание не отдаётся',
  tst.val('OS1', $q$select coalesce(os_sheet_get('WOS', 1)->>'meta', 'null')$q$), 'null');
select tst.expect('правка строки — changed',
  tst.val('__anon_key__', tst.os_push(tst.os_tok('t1'), 'SheetAAAAAAAA1', tst.os_p('p2')) || $q$->>'changed'$q$), 'true');
select tst.expect('с версии 1 — одна строка, вторая',
  tst.val('OS1', $q$select jsonb_array_length(os_sheet_get('WOS', 1)->'rows')::text || ':' || (os_sheet_get('WOS', 1)->'rows'->0->>1)$q$), '1:2');
select tst.expect('с версии 1 — в строке новое имя',
  tst.val('OS1', $q$select os_sheet_get('WOS', 1)->'rows'->0->2->>0$q$), 'Никита');
select tst.expect('описание не менялось — не отдаётся',
  tst.val('OS1', $q$select coalesce(os_sheet_get('WOS', 1)->>'meta', 'null')$q$), 'null');
select tst.expect('с нуля — все строки', tst.val('OS1', $q$select jsonb_array_length(os_sheet_get('WOS', 0)->'rows')::text$q$), '3');
select tst.expect('версия из будущего — читается целиком',
  tst.val('OS1', $q$select (os_sheet_get('WOS', 99)->>'full') || ':' || jsonb_array_length(os_sheet_get('WOS', 99)->'rows')$q$), 'true:3');
select tst.expect('другая Google-таблица без novaSetup — отказ',
  tst.try('__anon_key__', tst.os_push(tst.os_tok('t1'), 'SheetBBBBBBBB2', tst.os_p('p2'))), 'deny:42501');

-- Настройка.
select tst.expect('Тимлид не правит настройку',
  tst.try('OTL', $q$select os_sheet_set('WOS', 'all', '{}', null)$q$), 'deny:42501');
select tst.expect('кривая аудитория — отказ', tst.try('OO', $q$select os_sheet_set('WOS', 'lead', '{}', null)$q$), 'deny:22023');
select tst.expect('листов больше 4 в выборе — отказ',
  tst.try('OO', $q$select os_sheet_set('WOS', 'os', array['1','2','3','4','5'], null)$q$), 'deny:22023');
select tst.expect('чужой адрес веб-приложения — отказ',
  tst.try('OO', $q$select os_sheet_set('WOS', 'os', '{}', 'https://evil.example.com/macros/s/AKfycbx1234567890/exec')$q$), 'deny:22023');
select tst.expect('адрес /dev — отказ',
  tst.try('OO', $q$select os_sheet_set('WOS', 'os', '{}', 'https://script.google.com/macros/s/AKfycbx1234567890/dev')$q$), 'deny:22023');
select tst.run('OO', $q$select os_sheet_set('WOS', 'all', array['Октябрь оформление', 'Октябрь оформление', ''],
  ' https://script.google.com/macros/s/AKfycbx1234567890abcdef/exec ')$q$);
select tst.expect('выбор листов без повторов и пустых',
  tst.val('OO', $q$select os_sheet_config('WOS')->>'pick'$q$), '["Октябрь оформление"]');
select tst.expect('адрес веб-приложения записан без пробелов',
  tst.val('OO', $q$select os_sheet_config('WOS')->>'hook'$q$), 'https://script.google.com/macros/s/AKfycbx1234567890abcdef/exec');
select tst.expect('«все участники»: технарь видит, но не правит',
  tst.val('OT1', $q$select (os_sheet_get('WOS')->>'allowed') || '/' || (os_sheet_get('WOS')->>'canEdit')$q$), 'true/false');
select tst.expect('«все участники»: Viewer видит',
  tst.val('OV', $q$select os_sheet_get('WOS')->>'allowed'$q$), 'true');
select tst.expect('адрес веб-приложения видит правщик',
  tst.val('OS1', $q$select os_sheet_get('WOS')->>'hook'$q$), 'https://script.google.com/macros/s/AKfycbx1234567890abcdef/exec');
select tst.expect('адреса веб-приложения не видит читатель',
  tst.val('OT1', $q$select coalesce(os_sheet_get('WOS')->>'hook', 'null')$q$), 'null');
select tst.expect('ответ скрипту несёт выбор листов',
  tst.val('__anon_key__', tst.os_push(tst.os_tok('t1'), 'SheetAAAAAAAA1', tst.os_p('p2')) || $q$->>'pick'$q$), '["Октябрь оформление"]');

-- Правки.
select tst.expect('технарь (читатель) не правит',
  tst.try('OT1', $q$select os_sheet_edit('WOS', '[{"tab":"Октябрь оформление","r":1,"c":0,"v":"x"}]')$q$), 'deny:42501');
select tst.expect('Viewer не правит',
  tst.try('OV', $q$select os_sheet_edit('WOS', '[{"tab":"Октябрь оформление","r":1,"c":0,"v":"x"}]')$q$), 'deny:42501');
select tst.expect('посторонний не правит',
  tst.try('X', $q$select os_sheet_edit('WOS', '[{"tab":"Октябрь оформление","r":1,"c":0,"v":"x"}]')$q$), 'deny:42501');
select tst.expect('шапку не правят',
  tst.try('OS1', $q$select os_sheet_edit('WOS', '[{"tab":"Октябрь оформление","r":0,"c":0,"v":"x"}]')$q$), 'deny:22023');
select tst.expect('формулу не правят',
  tst.try('OS1', $q$select os_sheet_edit('WOS', '[{"tab":"Октябрь оформление","r":1,"c":3,"v":"1"}]')$q$), 'deny:22023');
select tst.expect('строка за концом листа — отказ',
  tst.try('OS1', $q$select os_sheet_edit('WOS', '[{"tab":"Октябрь оформление","r":3,"c":0,"v":"x"}]')$q$), 'deny:22023');
select tst.expect('столбец за краем листа — отказ',
  tst.try('OS1', $q$select os_sheet_edit('WOS', '[{"tab":"Октябрь оформление","r":1,"c":4,"v":"x"}]')$q$), 'deny:22023');
select tst.expect('чужой лист — отказ',
  tst.try('OS1', $q$select os_sheet_edit('WOS', '[{"tab":"Итоги","r":1,"c":0,"v":"x"}]')$q$), 'deny:22023');
select tst.expect('значение длиннее 2000 — отказ',
  tst.try('OS1', format($q$select os_sheet_edit('WOS', %L)$q$,
    jsonb_build_array(jsonb_build_object('tab', 'Октябрь оформление', 'r', 1, 'c', 0, 'v', repeat('a', 2001)))::text)), 'deny:22023');
select tst.expect('число вместо текста — отказ',
  tst.try('OS1', $q$select os_sheet_edit('WOS', '[{"tab":"Октябрь оформление","r":1,"c":0,"v":5}]')$q$), 'deny:22023');
select tst.expect('пустой список — отказ', tst.try('OS1', $q$select os_sheet_edit('WOS', '[]')$q$), 'deny:22023');
select tst.expect('больше 200 правок за раз — отказ',
  tst.try('OS1', format($q$select os_sheet_edit('WOS', %L)$q$, (select jsonb_agg(jsonb_build_object(
    'tab', 'Октябрь оформление', 'r', 1, 'c', 0, 'v', 'x')) from generate_series(1, 201))::text)), 'deny:22023');
select tst.expect('новая строка с формулой — отказ',
  tst.try('OS1', $q$select os_sheet_edit('WOS', '[{"tab":"Октябрь оформление","add":[[0,"Ольга"],[3,"1"]]}]')$q$), 'deny:22023');
select tst.expect('новая строка с кривой парой — отказ',
  tst.try('OS1', $q$select os_sheet_edit('WOS', '[{"tab":"Октябрь оформление","add":[[0]]}]')$q$), 'deny:22023');
select tst.expect('новая строка за краем листа — отказ',
  tst.try('OS1', $q$select os_sheet_edit('WOS', '[{"tab":"Октябрь оформление","add":[[9,"x"]]}]')$q$), 'deny:22023');

insert into oss_tok values ('e1', tst.val('OS1', $q$select os_sheet_edit('WOS', '[{"tab":"Октябрь оформление","r":1,"c":2,
  "v":"7 700 000 0000","o":"82 10-25332108","k":[[0,"Александра"],[1,"01.10.2026"]]}]')->'ids'->>0$q$));
select tst.expect('ОС правит ячейку — номер правки', (tst.os_tok('e1') ~ '^[0-9]+$')::text, 'true');
insert into oss_tok values ('e2', tst.val('OS1', $q$select os_sheet_edit('WOS', '[{"tab":"Октябрь оформление",
  "add":[[0,"Ольга"],[1,"02.10.2026"]]}]')->'ids'->>0$q$));
select tst.expect('ОС добавляет строку — номер правки', (tst.os_tok('e2') ~ '^[0-9]+$')::text, 'true');
insert into oss_tok values ('e3', tst.val('OS2', $q$select os_sheet_edit('WOS', '[{"tab":"Октябрь оформление","r":2,"c":0,"v":"Ник"}]')->'ids'->>0$q$));
select tst.expect('Тимлид правит',
  tst.val('OTL', $q$select jsonb_array_length(os_sheet_edit('WOS', '[{"tab":"Октябрь оформление","r":2,"c":1,"v":"03.10.2026"}]')->'ids')::text$q$), '1');
select tst.expect('Технарь + ОС правит, ответ несёт адрес веб-приложения',
  tst.val('OMX', $q$select os_sheet_edit('WOS', '[{"tab":"Октябрь оформление","r":1,"c":0,"v":"Саша"}]')->>'hook'$q$),
  'https://script.google.com/macros/s/AKfycbx1234567890abcdef/exec');
select tst.expect('пачка правок — номера по порядку',
  tst.val('OS1', $q$select jsonb_array_length(os_sheet_edit('WOS', '[{"tab":"Октябрь оформление","r":1,"c":0,"v":"А"},
    {"tab":"Октябрь оформление","r":2,"c":0,"v":"Б"}]')->'ids')::text$q$), '2');
delete from public.os_sheet_edits where workspace_id = 'WOS' and v in ('А', 'Б');

-- Скрипт забирает очередь.
select tst.expect('очередь — чужой секрет не забирает',
  tst.try('__anon_key__', format($q$select os_sheet_pull('WOS', %L, 'SheetAAAAAAAA1')$q$, repeat('b', 64))), 'deny:42501');
select tst.expect('очередь — другая Google-таблица не забирает',
  tst.try('__anon_key__', format($q$select os_sheet_pull('WOS', %L, 'SheetBBBBBBBB2')$q$, tst.os_tok('t1'))), 'deny:42501');
select tst.expect('очередь — все пять правок',
  tst.val('__anon_key__', format($q$select jsonb_array_length(os_sheet_pull('WOS', %L, 'SheetAAAAAAAA1')->'edits')::text$q$, tst.os_tok('t1'))), '5');
select tst.expect('очередь — старые сначала, с ключом строки',
  tst.val('__anon_key__', format($q$select (e->>'id') || '|' || (e->>'r') || '|' || (e->>'c') || '|' || (e->>'v') || '|' || (e->'k')::text
    from (select os_sheet_pull('WOS', %L, 'SheetAAAAAAAA1')->'edits'->0 as e) q$q$, tst.os_tok('t1'))),
  tst.os_tok('e1') || '|1|2|7 700 000 0000|[[0, "Александра"], [1, "01.10.2026"]]');
select tst.expect('очередь — новая строка второй',
  tst.val('__anon_key__', format($q$select (os_sheet_pull('WOS', %L, 'SheetAAAAAAAA1')->'edits'->1->'add')::text$q$, tst.os_tok('t1'))),
  '[[0, "Ольга"], [1, "02.10.2026"]]');
select tst.expect('очередь — время запроса записано',
  tst.val('OO', $q$select (os_sheet_config('WOS')->>'pulledAt' is not null)::text$q$), 'true');
select tst.expect('очередь видна Owner счётчиком', tst.val('OO', $q$select os_sheet_config('WOS')->>'pending'$q$), '5');

-- Свои правки — свой ответ.
select tst.expect('ответ по своей правке — ждёт',
  tst.val('OS1', format($q$select os_sheet_get('WOS', 0, array[%s, %s]::bigint[])->'edits'->0->>'status'$q$, tst.os_tok('e1'), tst.os_tok('e3'))), 'pending');
select tst.expect('чужая правка в ответ не попадает',
  tst.val('OS1', format($q$select jsonb_array_length(os_sheet_get('WOS', 0, array[%s, %s]::bigint[])->'edits')::text$q$, tst.os_tok('e1'), tst.os_tok('e3'))), '1');

-- Отчёт скрипта по правкам.
select tst.expect('отчёт по двум правкам',
  tst.val('__anon_key__', tst.os_push(tst.os_tok('t1'), 'SheetAAAAAAAA1', tst.os_p('p2'),
    format('[{"id":%s,"ok":true,"row":1},{"id":%s,"ok":false,"reason":"moved"},{"id":"x","ok":true},{"id":999999,"ok":true}]',
      tst.os_tok('e1'), tst.os_tok('e2'))) || $q$->>'acked'$q$), '2');
select tst.expect('применённая — done и строка',
  tst.val('OS1', format($q$select (e->>'status') || ':' || (e->>'row') from (select os_sheet_get('WOS', 0, array[%s]::bigint[])->'edits'->0 as e) q$q$, tst.os_tok('e1'))), 'done:1');
select tst.expect('не применённая — failed и причина',
  tst.val('OS1', format($q$select (e->>'status') || ':' || (e->>'reason') from (select os_sheet_get('WOS', 0, array[%s]::bigint[])->'edits'->0 as e) q$q$, tst.os_tok('e2'))), 'failed:moved');
select tst.expect('решённую правку отчёт уже не меняет',
  tst.val('__anon_key__', tst.os_push(tst.os_tok('t1'), 'SheetAAAAAAAA1', tst.os_p('p2'),
    format('[{"id":%s,"ok":false,"reason":"late"}]', tst.os_tok('e1'))) || $q$->>'acked'$q$), '0');
select tst.expect('в очереди осталось три', tst.val('OS1', $q$select os_sheet_get('WOS')->>'pending'$q$), '3');

-- Не дождались за сутки.
update public.os_sheet_edits set created_at = now() - interval '2 days' where id = tst.os_tok('e3')::bigint;
select tst.expect('после суток очередь короче',
  tst.val('__anon_key__', format($q$select jsonb_array_length(os_sheet_pull('WOS', %L, 'SheetAAAAAAAA1')->'edits')::text$q$, tst.os_tok('t1'))), '2');
select tst.expect('старая правка — failed timeout',
  tst.val('OS2', format($q$select (e->>'status') || ':' || (e->>'reason') from (select os_sheet_get('WOS', 0, array[%s]::bigint[])->'edits'->0 as e) q$q$, tst.os_tok('e3'))), 'failed:timeout');

-- Очередь не бесконечна.
insert into public.os_sheet_edits (workspace_id, tab, r, c, k, v, by_uid)
select 'WOS', 'Октябрь оформление', 1, 0, '[]', 'спам', 'OS1' from generate_series(1, 999);
select tst.expect('очередь полна — отказ',
  tst.try('OS1', $q$select os_sheet_edit('WOS', '[{"tab":"Октябрь оформление","r":1,"c":0,"v":"x"}]')$q$), 'deny:22023');
delete from public.os_sheet_edits where workspace_id = 'WOS' and v = 'спам';

-- Лист стал короче.
insert into oss_tok values ('v3', tst.val('OS1', $q$select os_sheet_get('WOS')->>'ver'$q$));
select tst.expect('лист короче — changed',
  tst.val('__anon_key__', tst.os_push(tst.os_tok('t1'), 'SheetAAAAAAAA1', tst.os_p('p3')) || $q$->>'changed'$q$), 'true');
select tst.expect('лист короче — описание отдаётся, строк 2',
  tst.val('OS1', format($q$select os_sheet_get('WOS', %s)->'meta'->'tabs'->0->>'n'$q$, tst.os_tok('v3'))), '2');
select tst.expect('лишняя строка удалена из копии',
  (select count(*)::text from public.os_sheet_rows where workspace_id = 'WOS'), '2');
select tst.expect('правка удалённой строки — отказ',
  tst.try('OS1', $q$select os_sheet_edit('WOS', '[{"tab":"Октябрь оформление","r":2,"c":0,"v":"x"}]')$q$), 'deny:22023');

-- novaSetup в другой Google-таблице забирает подключение.
select tst.expect('другая таблица с novaSetup — changed',
  tst.val('__anon_key__', tst.os_push(tst.os_tok('t1'), 'SheetBBBBBBBB2', tst.os_p('p1'), '[]', true) || $q$->>'changed'$q$), 'true');
select tst.expect('источник сменился', tst.val('OO', $q$select os_sheet_config('WOS')->>'source'$q$), 'SheetBBBBBBBB2');
select tst.expect('ждавшие правки — failed other sheet',
  (select string_agg(distinct status || ':' || reason, ',') from public.os_sheet_edits where workspace_id = 'WOS' and by_uid in ('OTL', 'OMX')),
  'failed:other sheet');
select tst.expect('прежняя таблица — отказ',
  tst.try('__anon_key__', tst.os_push(tst.os_tok('t1'), 'SheetAAAAAAAA1', tst.os_p('p1'))), 'deny:42501');
select tst.expect('новая таблица — строки целиком', (select count(*)::text from public.os_sheet_rows where workspace_id = 'WOS'), '3');

-- Приостановленная компания.
update public.rows_workspaces set status = 'suspended' where workspace_id = 'WOS';
select tst.expect('приостановленная: скрипт не пишет',
  tst.try('__anon_key__', tst.os_push(tst.os_tok('t1'), 'SheetBBBBBBBB2', tst.os_p('p1'))), 'deny:42501');
select tst.expect('приостановленная: очередь не отдаётся',
  tst.try('__anon_key__', format($q$select os_sheet_pull('WOS', %L, 'SheetBBBBBBBB2')$q$, tst.os_tok('t1'))), 'deny:42501');
select tst.expect('приостановленная: ОС не правит',
  tst.try('OS1', $q$select os_sheet_edit('WOS', '[{"tab":"Октябрь оформление","r":1,"c":0,"v":"x"}]')$q$), 'deny:42501');
select tst.expect('приостановленная: новый секрет не выдаётся', tst.try('OO', $q$select os_sheet_new_token('WOS')$q$), 'deny:42501');
select tst.expect('приостановленная: читать можно', tst.val('OS1', $q$select os_sheet_get('WOS')->>'connected'$q$), 'true');
update public.rows_workspaces set status = 'active' where workspace_id = 'WOS';

-- Убранный из участников.
delete from public.rows_members where workspace_id = 'WOS' and uid = 'OS2';
select tst.expect('убранный участник не читает', tst.try('OS2', $q$select os_sheet_get('WOS')$q$), 'deny:42501');
select tst.expect('убранный участник не правит',
  tst.try('OS2', $q$select os_sheet_edit('WOS', '[{"tab":"Октябрь оформление","r":1,"c":0,"v":"x"}]')$q$), 'deny:42501');

-- Новый ключ: старый скрипт отключён.
insert into oss_tok values ('t2', tst.val('OO', $q$select os_sheet_new_token('WOS')->>'token'$q$));
select tst.expect('новый ключ — другой', (tst.os_tok('t2') <> tst.os_tok('t1'))::text, 'true');
select tst.expect('старый ключ после нового — отказ',
  tst.try('__anon_key__', tst.os_push(tst.os_tok('t1'), 'SheetBBBBBBBB2', tst.os_p('p1'))), 'deny:42501');
select tst.expect('новый ключ работает',
  tst.val('__anon_key__', tst.os_push(tst.os_tok('t2'), 'SheetBBBBBBBB2', tst.os_p('p1')) || $q$->>'ok'$q$), 'true');

-- Отключение.
insert into oss_tok values ('v9', tst.val('OS1', $q$select os_sheet_get('WOS')->>'ver'$q$));
select tst.expect('технарь не отключает', tst.try('OT1', $q$select os_sheet_disconnect('WOS')$q$), 'deny:42501');
select tst.expect('ОС не отключает', tst.try('OS1', $q$select os_sheet_disconnect('WOS')$q$), 'deny:42501');
select tst.run('OO', $q$select os_sheet_disconnect('WOS')$q$);
select tst.expect('после отключения — connected false', tst.val('OS1', $q$select os_sheet_get('WOS')->>'connected'$q$), 'false');
select tst.expect('после отключения строки стёрты', (select count(*)::text from public.os_sheet_rows where workspace_id = 'WOS'), '0');
select tst.expect('после отключения очередь стёрта', (select count(*)::text from public.os_sheet_edits where workspace_id = 'WOS'), '0');
select tst.expect('после отключения секрет не принимается',
  tst.try('__anon_key__', tst.os_push(tst.os_tok('t2'), 'SheetBBBBBBBB2', tst.os_p('p1'))), 'deny:42501');
select tst.expect('после отключения выбор листов и адрес остались',
  tst.val('OO', $q$select (os_sheet_config('WOS')->>'pick') || ' ' || (os_sheet_config('WOS')->>'hook')$q$),
  '["Октябрь оформление"] https://script.google.com/macros/s/AKfycbx1234567890abcdef/exec');

-- Подключили снова: читатель со старой версией получает всё заново.
insert into oss_tok values ('t3', tst.val('OO', $q$select os_sheet_new_token('WOS')->>'token'$q$));
select tst.run('__anon_key__', tst.os_push(tst.os_tok('t3'), 'SheetBBBBBBBB2', tst.os_p('p1'), '[]', true));
select tst.expect('после переподключения версия выше прежней',
  (tst.val('OS1', $q$select os_sheet_get('WOS')->>'ver'$q$)::bigint > tst.os_tok('v9')::bigint)::text, 'true');
select tst.expect('старая версия читателя — все строки и описание',
  tst.val('OS1', format($q$select jsonb_array_length(os_sheet_get('WOS', %s)->'rows') || ':' || (os_sheet_get('WOS', %s)->'meta'->'tabs'->0->>'n')$q$,
    tst.os_tok('v9'), tst.os_tok('v9'))), '3:3');

-- ---------------------------------------------------------------------
select case when ok then '  OK  ' else 'FAIL  ' end || label || case when ok then '' else '  → ' || got end
from tst.results order by n;
select format('ПРОВЕРОК: %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
