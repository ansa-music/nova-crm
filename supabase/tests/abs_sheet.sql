-- Проверки «ABS → Таблица» (20261051_abs_sheet.sql). Запускать ПОСЛЕ
-- desk_rows_rls.sql (хелперы tst.*). Свой workspace WAS.
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
values ('WAS', 'AO', true, 'a1b2c3d4e5f60718') on conflict do nothing;
insert into public.rows_workspaces (workspace_id, owner_id, live) values ('WAS2', 'BO2', true) on conflict do nothing;
insert into public.rows_members (workspace_id, uid, role, extra_roles) values
  ('WAS', 'AO', 'owner', '{}'),
  ('WAS', 'ATL', 'teamlead', '{}'),
  ('WAS', 'ALP', 'leadplus', '{}'),
  ('WAS', 'AT1', 'manager', '{}'),
  ('WAS', 'AS1', 'os', '{}'),
  ('WAS', 'AV', 'viewer', '{}'),
  ('WAS2', 'BO2', 'owner', '{}')
on conflict do nothing;

create temp table abs_tok (k text primary key, v text);
grant all on abs_tok to anon;

-- Не подключено.
select tst.expect('до подключения — connected false',
  tst.val('AT1', $q$select abs_sheet_get('WAS')->>'connected'$q$), 'false');
select tst.expect('посторонний не читает', tst.try('X', $q$select abs_sheet_get('WAS')$q$), 'deny:42501');
select tst.expect('анонимный ключ не читает', tst.try('__anon_key__', $q$select abs_sheet_get('WAS')$q$), 'deny:42501');
select tst.expect('прямого чтения таблицы нет', tst.try('AO', $q$select * from abs_sheet$q$, true), 'deny:42501');
select tst.expect('прямой записи нет',
  tst.try('AO', $q$insert into abs_sheet (workspace_id) values ('WAS')$q$), 'deny:42501');

-- Секрет выдаёт только Owner.
select tst.expect('технарь не выдаёт секрет', tst.try('AT1', $q$select abs_sheet_new_token('WAS')$q$), 'deny:42501');
select tst.expect('Тимлид не выдаёт секрет', tst.try('ATL', $q$select abs_sheet_new_token('WAS')$q$), 'deny:42501');
select tst.expect('Тимлид+ не выдаёт секрет', tst.try('ALP', $q$select abs_sheet_new_token('WAS')$q$), 'deny:42501');
select tst.expect('Owner другой компании не выдаёт секрет', tst.try('BO2', $q$select abs_sheet_new_token('WAS')$q$), 'deny:42501');
select tst.expect('настройку читает только Owner', tst.try('ATL', $q$select abs_sheet_config('WAS')$q$), 'deny:42501');
insert into abs_tok values ('t1', tst.val('AO', $q$select abs_sheet_new_token('WAS')->>'token'$q$));
select tst.expect('секрет — 64 hex', (select (v ~ '^[0-9a-f]{64}$')::text from abs_tok where k = 't1'), 'true');
select tst.expect('настройка отдаёт соль звонков',
  tst.val('AO', $q$select abs_sheet_config('WAS')->>'salt'$q$), 'a1b2c3d4e5f60718');
select tst.expect('подключено, но пока пусто — payload null',
  tst.val('AT1', $q$select coalesce(abs_sheet_get('WAS')->>'payload', 'null')$q$), 'null');
select tst.expect('подключено — connected true',
  tst.val('AT1', $q$select abs_sheet_get('WAS')->>'connected'$q$), 'true');

-- Скрипт присылает листы анонимным ключом.
select tst.expect('чужой секрет — отказ',
  tst.try('__anon_key__', $q$select abs_sheet_push('WAS', repeat('a', 64), '{"tabs":[]}')$q$), 'deny:42501');
select tst.expect('кривой секрет — отказ',
  tst.try('__anon_key__', $q$select abs_sheet_push('WAS', 'x', '{"tabs":[]}')$q$), 'deny:42501');
select tst.expect('секрет к другому workspace — отказ',
  tst.try('__anon_key__', format($q$select abs_sheet_push('WAS2', %L, '{"tabs":[]}')$q$, (select v from abs_tok where k = 't1'))), 'deny:42501');
select tst.expect('не объект — отказ',
  tst.try('__anon_key__', format($q$select abs_sheet_push('WAS', %L, '[1]')$q$, (select v from abs_tok where k = 't1'))), 'deny:22023');
select tst.expect('листов больше 8 — отказ',
  tst.try('__anon_key__', format($q$select abs_sheet_push('WAS', %L, jsonb_build_object('tabs',
    (select jsonb_agg(jsonb_build_object('name', 'L' || g, 'rows', '[]'::jsonb)) from generate_series(1, 9) g)))$q$,
    (select v from abs_tok where k = 't1'))), 'deny:22023');
select tst.expect('лист без rows — отказ',
  tst.try('__anon_key__', format($q$select abs_sheet_push('WAS', %L, '{"tabs":[{"name":"A"}]}')$q$, (select v from abs_tok where k = 't1'))), 'deny:22023');
select tst.expect('строк больше 300 — отказ',
  tst.try('__anon_key__', format($q$select abs_sheet_push('WAS', %L, jsonb_build_object('tabs', jsonb_build_array(
    jsonb_build_object('name', 'A', 'rows', (select jsonb_agg('[]'::jsonb) from generate_series(1, 301))))))$q$,
    (select v from abs_tok where k = 't1'))), 'deny:22023');
select tst.expect('больше 900 КБ — отказ',
  tst.try('__anon_key__', format($q$select abs_sheet_push('WAS', %L, jsonb_build_object('tabs', '[]'::jsonb, 'pad', repeat('я', 460000)))$q$,
    (select v from abs_tok where k = 't1'))), 'deny:22023');

select tst.expect('первая передача — changed',
  tst.val('__anon_key__', format($q$select abs_sheet_push('WAS', %L,
    '{"v":1,"title":"StoryLove — Дашборд","sheets":["Октябрь OUTPUT Тех.","DATA октябрь",5],
      "tabs":[{"name":"Октябрь OUTPUT Тех.","rows":[["","Имя МОП","Касса апсейлы"],["1","Батырхан","₸1 301 768"]]}]}')->>'changed'$q$,
    (select v from abs_tok where k = 't1'))), 'true');
select tst.expect('кривой список листов (не строки) не записан',
  tst.val('AO', $q$select abs_sheet_config('WAS')->>'sheets'$q$), '["Октябрь OUTPUT Тех.", "DATA октябрь"]');
select tst.expect('название записано',
  tst.val('AO', $q$select abs_sheet_config('WAS')->>'title'$q$), 'StoryLove — Дашборд');
select tst.expect('технарь читает таблицу',
  tst.val('AT1', $q$select abs_sheet_get('WAS')->'payload'->'tabs'->0->'rows'->1->>1$q$), 'Батырхан');
select tst.expect('ОС читает таблицу',
  tst.val('AS1', $q$select abs_sheet_get('WAS')->'payload'->'tabs'->0->>'name'$q$), 'Октябрь OUTPUT Тех.');
select tst.expect('секрета в чтении нет',
  tst.val('AT1', $q$select (abs_sheet_get('WAS') ? 'token')::text$q$), 'false');
insert into abs_tok values ('h1', tst.val('AT1', $q$select abs_sheet_get('WAS')->>'hash'$q$));
select tst.expect('тот же отпечаток — таблица не отдаётся',
  tst.val('AT1', format($q$select coalesce(abs_sheet_get('WAS', %L)->>'payload', 'null')$q$, (select v from abs_tok where k = 'h1'))), 'null');
select tst.expect('тот же отпечаток — время передачи отдаётся',
  tst.val('AT1', format($q$select (abs_sheet_get('WAS', %L)->>'pushedAt' is not null)::text$q$, (select v from abs_tok where k = 'h1'))), 'true');

update public.abs_sheet set seen_at = now() - interval '1 hour' where workspace_id = 'WAS';
select tst.expect('повтор тех же листов — не changed',
  tst.val('__anon_key__', format($q$select abs_sheet_push('WAS', %L,
    '{"v":1,"title":"StoryLove — Дашборд","sheets":["Октябрь OUTPUT Тех.","DATA октябрь",5],
      "tabs":[{"name":"Октябрь OUTPUT Тех.","rows":[["","Имя МОП","Касса апсейлы"],["1","Батырхан","₸1 301 768"]]}]}')->>'changed'$q$,
    (select v from abs_tok where k = 't1'))), 'false');
select tst.expect('повтор отмечает «на связи»',
  (select (seen_at > now() - interval '1 minute')::text from public.abs_sheet where workspace_id = 'WAS'), 'true');
select tst.expect('повтор не считается передачей',
  (select push_count::text from public.abs_sheet where workspace_id = 'WAS'), '1');

-- Кому видна и какие листы.
select tst.expect('Тимлид не правит настройку',
  tst.try('ATL', $q$select abs_sheet_set('WAS', 'lead', '{}')$q$), 'deny:42501');
select tst.expect('кривая аудитория — отказ',
  tst.try('AO', $q$select abs_sheet_set('WAS', 'everyone', '{}')$q$), 'deny:22023');
select tst.expect('листов больше 8 в выборе — отказ',
  tst.try('AO', $q$select abs_sheet_set('WAS', 'all', array['1','2','3','4','5','6','7','8','9'])$q$), 'deny:22023');
select tst.run('AO', $q$select abs_sheet_set('WAS', 'lead', array['Октябрь OUTPUT Тех.', 'Октябрь OUTPUT Тех.', '', 'Итоги'])$q$);
select tst.expect('выбор листов без повторов и пустых',
  tst.val('AO', $q$select abs_sheet_config('WAS')->>'pick'$q$), '["Октябрь OUTPUT Тех.", "Итоги"]');
select tst.expect('только руководство: технарь не видит',
  tst.val('AT1', $q$select abs_sheet_get('WAS')->>'allowed'$q$), 'false');
select tst.expect('только руководство: технарю таблица не отдаётся',
  tst.val('AT1', $q$select coalesce(abs_sheet_get('WAS')->>'payload', 'null')$q$), 'null');
select tst.expect('только руководство: Viewer не видит',
  tst.val('AV', $q$select abs_sheet_get('WAS')->>'allowed'$q$), 'false');
select tst.expect('только руководство: Тимлид видит',
  tst.val('ATL', $q$select abs_sheet_get('WAS')->'payload'->'tabs'->0->'rows'->1->>1$q$), 'Батырхан');
select tst.expect('только руководство: Тимлид+ видит',
  tst.val('ALP', $q$select abs_sheet_get('WAS')->>'allowed'$q$), 'true');
select tst.expect('только руководство: Owner видит',
  tst.val('AO', $q$select abs_sheet_get('WAS')->>'allowed'$q$), 'true');
select tst.expect('ответ скрипту несёт выбор листов',
  tst.val('__anon_key__', format($q$select abs_sheet_push('WAS', %L, '{"tabs":[{"name":"Итоги","rows":[["x"]]}]}')->>'pick'$q$,
    (select v from abs_tok where k = 't1'))), '["Октябрь OUTPUT Тех.", "Итоги"]');
select tst.expect('новые листы — changed записан',
  tst.val('ATL', $q$select abs_sheet_get('WAS')->'payload'->'tabs'->0->>'name'$q$), 'Итоги');

-- Новый секрет отключает старый скрипт.
insert into abs_tok values ('t2', tst.val('AO', $q$select abs_sheet_new_token('WAS')->>'token'$q$));
select tst.expect('новый секрет другой',
  (select (a.v <> b.v)::text from abs_tok a, abs_tok b where a.k = 't1' and b.k = 't2'), 'true');
select tst.expect('старый секрет больше не принимается',
  tst.try('__anon_key__', format($q$select abs_sheet_push('WAS', %L, '{"tabs":[]}')$q$, (select v from abs_tok where k = 't1'))), 'deny:42501');
select tst.expect('новый секрет принимается',
  tst.try('__anon_key__', format($q$select abs_sheet_push('WAS', %L, '{"tabs":[]}')$q$, (select v from abs_tok where k = 't2'))), 'ok:1');
select tst.expect('новый секрет сохранил аудиторию',
  tst.val('AO', $q$select abs_sheet_config('WAS')->>'audience'$q$), 'lead');

-- Приостановленная компания: скрипт не пишет, читать можно.
update public.rows_workspaces set status = 'suspended' where workspace_id = 'WAS';
select tst.expect('приостановленная: скрипт не пишет',
  tst.try('__anon_key__', format($q$select abs_sheet_push('WAS', %L, '{"tabs":[]}')$q$, (select v from abs_tok where k = 't2'))), 'deny:42501');
select tst.expect('приостановленная: новый секрет не выдаётся',
  tst.try('AO', $q$select abs_sheet_new_token('WAS')$q$), 'deny:42501');
select tst.expect('приостановленная: Owner читает',
  tst.val('AO', $q$select abs_sheet_get('WAS')->>'connected'$q$), 'true');
update public.rows_workspaces set status = 'active' where workspace_id = 'WAS';

-- Убранный из участников не читает.
delete from public.rows_members where workspace_id = 'WAS' and uid = 'AS1';
select tst.expect('убранный участник не читает', tst.try('AS1', $q$select abs_sheet_get('WAS')$q$), 'deny:42501');

-- Отключение.
select tst.expect('технарь не отключает', tst.try('AT1', $q$select abs_sheet_disconnect('WAS')$q$), 'deny:42501');
select tst.run('AO', $q$select abs_sheet_disconnect('WAS')$q$);
select tst.expect('после отключения — connected false',
  tst.val('ATL', $q$select abs_sheet_get('WAS')->>'connected'$q$), 'false');
select tst.expect('после отключения таблица стёрта',
  (select coalesce(payload::text, 'null') from public.abs_sheet where workspace_id = 'WAS'), 'null');
select tst.expect('после отключения секрет не принимается',
  tst.try('__anon_key__', format($q$select abs_sheet_push('WAS', %L, '{"tabs":[]}')$q$, (select v from abs_tok where k = 't2'))), 'deny:42501');
select tst.expect('после отключения выбор листов остался',
  tst.val('AO', $q$select abs_sheet_config('WAS')->>'pick'$q$), '["Октябрь OUTPUT Тех.", "Итоги"]');

-- ---------------------------------------------------------------------
select case when ok then '  OK  ' else 'FAIL  ' end || label || case when ok then '' else '  → ' || got end
from tst.results order by n;
select format('ПРОВЕРОК: %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
