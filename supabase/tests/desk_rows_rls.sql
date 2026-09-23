-- =====================================================================
-- Проверка прав desk_rows и копии прав на локальном Postgres.
-- Запуск (нужны supabase_stub.sql и миграция, накатанные на пустую базу):
--   psql -d nova -f supabase/tests/supabase_stub.sql
--   psql -d nova -f supabase/migrations/20260923_desk_rows.sql
--   psql -d nova -f supabase/tests/desk_rows_rls.sql
-- Каждая проверка идёт от лица участника (роль anon + claims токена
-- Firebase, как их видит Supabase) и откатывается, если не сказано иное.
-- Итог — строка «ПРОВЕРОК: N, ПРОВАЛЕНО: 0».
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;

drop schema if exists tst cascade;
create schema tst;
create table tst.results (n serial, label text, ok boolean, got text);

create function tst.claims(uid text) returns text language sql immutable as $$
  select case
    when uid = '__anon_key__' then '{"iss":"supabase","role":"anon"}'
    when uid like '__forged__:%' then json_build_object(
      'iss', 'https://securetoken.google.com/other-project', 'aud', 'other-project',
      'sub', substr(uid, 12), 'role', 'anon')::text
    else json_build_object(
      'iss', 'https://securetoken.google.com/nurba-6e70d', 'aud', 'nurba-6e70d',
      'sub', uid, 'role', 'anon')::text
  end
$$;

-- Выполнить sql от лица uid и ОТКАТИТЬ. Ответ: 'ok:<строк>' или 'deny:<код>'.
create function tst.try(uid text, sql text, as_count boolean default false) returns text
language plpgsql as $$
declare n bigint; res text;
begin
  begin
    perform set_config('request.jwt.claims', tst.claims(uid), true);
    execute 'set local role anon';
    if as_count then
      execute 'select count(*) from (' || sql || ') q' into n;
    else
      execute sql;
      get diagnostics n = row_count;
    end if;
    res := 'ok:' || n;
    raise exception using errcode = 'P0001', message = '__rollback__';
  exception when others then
    if sqlerrm <> '__rollback__' then res := 'deny:' || sqlstate; end if;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return res;
end;
$$;

-- Выполнить sql от лица uid и ОСТАВИТЬ результат.
create function tst.run(uid text, sql text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', tst.claims(uid), true);
  execute 'set local role anon';
  execute sql;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create function tst.expect(label text, got text, want text) returns void language plpgsql as $$
begin
  insert into tst.results (label, ok, got) values (
    label,
    case
      when want = 'deny' then got like 'deny:%' or got = 'ok:0'
      when want = 'error' then got like 'deny:%'
      when want = 'ok' then got like 'ok:%' and got <> 'ok:0'
      else got = want
    end,
    got);
end;
$$;

-- ---------------------------------------------------------------------
-- Данные (от суперпользователя — как «SQL-редактор» у Nurba).
-- ---------------------------------------------------------------------
insert into public.rows_workspaces (workspace_id, owner_id, live) values ('W', 'O', true);
insert into public.rows_members (workspace_id, uid, role, extra_roles) values
  ('W', 'O', 'owner', '{}'),
  ('W', 'TL', 'teamlead', '{}'),
  ('W', 'TLT', 'teamlead', '{manager}'),
  ('W', 'TLO', 'teamlead', '{os}'),
  ('W', 'T1', 'manager', '{}'),
  ('W', 'T2', 'manager', '{}'),
  ('W', 'T3', 'manager', '{}'),
  ('W', 'OS1', 'os', '{}'),
  ('W', 'OS2', 'os', '{}'),
  ('W', 'AD', 'admin', '{}'),
  ('W', 'V', 'viewer', '{}'),
  ('W', 'OBS', 'manager', '{}');
insert into public.rows_page_acl (workspace_id, page_id, responsible_uid, created_by, os_desk, allowed_uids, editable_uids) values
  ('W', 'P1', 'T1', 'T1', false, '{T1,T2,T3,V}', '{T3,V}'),
  ('W', 'P2', 'T2', 'T2', false, '{T2}', '{}'),
  ('W', 'osdesk_OS1', 'OS1', 'OS1', true, '{OS1}', '{}'),
  ('W', 'osdesk_TLO', 'TLO', 'TLO', true, '{TLO}', '{}');
insert into public.rows_desk_observers values ('W', 'OBS');
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at) values
  ('W', 'P1', '', 'r1', '{"client":"Аня","price":"100"}', 0, 1000, 1000),
  ('W', 'P1', '', 'r2', '{"client":"Боря"}', 1, 1000, 1000),
  ('W', 'P1', 'm1', 'r3', '{"client":"Вика"}', 0, 1000, 1000),
  ('W', 'P2', '', 'r1', '{"client":"Чужой"}', 0, 1000, 1000),
  ('W', 'osdesk_OS1', '', 'o1', '{"client":"Продажа"}', 0, 1000, 1000),
  ('W', 'osdesk_TLO', '', 't1', '{"client":"Своё"}', 0, 1000, 1000);

-- ---------------------------------------------------------------------
-- Чтение: canAccessPage.
-- ---------------------------------------------------------------------
select tst.expect('Owner читает стол технаря', tst.try('O', $q$select * from desk_rows where page_id = 'P1'$q$, true), 'ok:3');
select tst.expect('ответственный читает свой стол (обе вкладки)', tst.try('T1', $q$select * from desk_rows where page_id = 'P1'$q$, true), 'ok:3');
select tst.expect('технарь из allowedUsers читает', tst.try('T2', $q$select * from desk_rows where page_id = 'P1'$q$, true), 'ok:3');
select tst.expect('Viewer из allowedUsers читает', tst.try('V', $q$select * from desk_rows where page_id = 'P1'$q$, true), 'ok:3');
select tst.expect('чужой технарь НЕ читает скрытый стол', tst.try('T1', $q$select * from desk_rows where page_id = 'P2'$q$, true), 'ok:0');
select tst.expect('Тимлид без Технаря НЕ читает стол технаря', tst.try('TL', $q$select * from desk_rows where page_id = 'P1'$q$, true), 'ok:0');
select tst.expect('Тимлид читает стол ОС', tst.try('TL', $q$select * from desk_rows where page_id = 'osdesk_OS1'$q$, true), 'ok:1');
select tst.expect('Тимлид + Технарь читает чужой стол', tst.try('TLT', $q$select * from desk_rows where page_id = 'P2'$q$, true), 'ok:1');
select tst.expect('Тимлид + ОС НЕ читает стол технаря', tst.try('TLO', $q$select * from desk_rows where page_id = 'P1'$q$, true), 'ok:0');
select tst.expect('Тимлид + ОС читает чужой стол ОС', tst.try('TLO', $q$select * from desk_rows where page_id = 'osdesk_OS1'$q$, true), 'ok:1');
select tst.expect('наблюдатель читает чужой стол', tst.try('OBS', $q$select * from desk_rows where page_id = 'P2'$q$, true), 'ok:1');
select tst.expect('ОС НЕ читает чужой стол ОС', tst.try('OS2', $q$select * from desk_rows where page_id = 'osdesk_OS1'$q$, true), 'ok:0');
select tst.expect('Admin без доступа НЕ читает', tst.try('AD', $q$select * from desk_rows where page_id = 'P1'$q$, true), 'ok:0');
select tst.expect('не участник с настоящим токеном НЕ читает', tst.try('X', $q$select * from desk_rows$q$, true), 'ok:0');
select tst.expect('анонимный ключ (из репозитория) НЕ читает', tst.try('__anon_key__', $q$select * from desk_rows$q$, true), 'ok:0');
select tst.expect('токен ЧУЖОГО проекта с uid Owner НЕ читает', tst.try('__forged__:O', $q$select * from desk_rows$q$, true), 'ok:0');
select tst.expect('весь список строк технарю — только доступные', tst.try('T1', $q$select * from desk_rows$q$, true), 'ok:3');
select tst.expect('весь список Viewer — только доступные', tst.try('V', $q$select * from desk_rows$q$, true), 'ok:3');

-- ---------------------------------------------------------------------
-- Запись: canEditPage.
-- ---------------------------------------------------------------------
select tst.expect('ответственный правит свой стол', tst.try('T1', $q$select rows_patch('W','P1','','r1','{"price":"200"}'::jsonb)$q$), 'ok:1');
select tst.expect('технарь с одним просмотром НЕ правит', tst.try('T2', $q$select rows_patch('W','P1','','r1','{"price":"1"}'::jsonb)$q$), 'error');
select tst.expect('технарь из editableUsers правит', tst.try('T3', $q$select rows_patch('W','P1','','r1','{"price":"300"}'::jsonb)$q$), 'ok:1');
select tst.expect('Viewer в editableUsers правит (как в правилах)', tst.try('V', $q$select rows_patch('W','P1','','r1','{"price":"301"}'::jsonb)$q$), 'ok:1');
select tst.expect('Тимлид НЕ правит стол ОС', tst.try('TL', $q$select rows_patch('W','osdesk_OS1','','o1','{"price":"1"}'::jsonb)$q$), 'error');
select tst.expect('Тимлид + Технарь НЕ правит чужой стол', tst.try('TLT', $q$select rows_patch('W','P2','','r1','{"price":"1"}'::jsonb)$q$), 'error');
select tst.expect('Тимлид + ОС правит СВОЙ стол ОС', tst.try('TLO', $q$select rows_patch('W','osdesk_TLO','','t1','{"price":"5"}'::jsonb)$q$), 'ok:1');
select tst.expect('Тимлид + ОС НЕ правит чужой стол ОС', tst.try('TLO', $q$select rows_patch('W','osdesk_OS1','','o1','{"price":"1"}'::jsonb)$q$), 'error');
select tst.expect('ОС правит свой стол ОС', tst.try('OS1', $q$select rows_patch('W','osdesk_OS1','','o1','{"price":"7"}'::jsonb)$q$), 'ok:1');
select tst.expect('наблюдатель НЕ правит', tst.try('OBS', $q$select rows_patch('W','P2','','r1','{"price":"1"}'::jsonb)$q$), 'error');
select tst.expect('Owner правит любой стол', tst.try('O', $q$select rows_patch('W','P2','','r1','{"price":"9"}'::jsonb)$q$), 'ok:1');
select tst.expect('чужой технарь НЕ вставляет строку в чужой стол', tst.try('T1', $q$insert into desk_rows (workspace_id,page_id,id,created_at,updated_at) values ('W','P2','x',1,1)$q$), 'error');
select tst.expect('строку НЕ перенести в чужой стол сменой page_id', tst.try('T1', $q$update desk_rows set page_id = 'P2' where page_id = 'P1' and id = 'r1'$q$), 'error');
select tst.expect('чужой технарь НЕ удаляет чужую строку', tst.try('T1', $q$delete from desk_rows where page_id = 'P2'$q$), 'ok:0');
select tst.expect('ответственный удаляет свою строку', tst.try('T1', $q$delete from desk_rows where page_id = 'P1' and tab_id = '' and id = 'r2'$q$), 'ok:1');
select tst.expect('просмотр НЕ удаляет', tst.try('T2', $q$delete from desk_rows where page_id = 'P1'$q$), 'ok:0');
select tst.expect('анонимный ключ НЕ пишет', tst.try('__anon_key__', $q$select rows_patch('W','P1','','r1','{"price":"0"}'::jsonb)$q$), 'error');
select tst.expect('порядок строк — ответственный', tst.try('T1', $q$select * from rows_set_order('W','P1','',array['r2','r1'])$q$), 'ok:1');
select tst.expect('порядок строк — просмотр ничего не двигает', tst.try('T2', $q$update desk_rows set sort_order = 99 where page_id = 'P1'$q$), 'ok:0');

-- ---------------------------------------------------------------------
-- Слияние ячеек, визитка, подсветка — как merge в Firestore.
-- ---------------------------------------------------------------------
select tst.run('T1', $q$select rows_patch('W','P1','','r1','{"price":"500"}'::jsonb, 2000)$q$);
select tst.run('T1', $q$select rows_patch('W','P1','','r1','{"status":"done"}'::jsonb, 2001)$q$);
select tst.expect('две правки разных ячеек не затирают друг друга',
  (select cells->>'client' || '|' || (cells->>'price') || '|' || (cells->>'status') from desk_rows where page_id='P1' and tab_id='' and id='r1'),
  'Аня|500|done');
select tst.run('T1', $q$select rows_patch('W','P1','','r1','{"price":null}'::jsonb, 2002)$q$);
select tst.expect('null в ячейке — как в Firestore, поле есть и пустое',
  (select (cells ? 'price')::text || '|' || coalesce(cells->>'price', 'NULL') from desk_rows where page_id='P1' and tab_id='' and id='r1'), 'true|NULL');
select tst.run('T1', $q$select rows_patch('W','P1','','r1','{}'::jsonb, 2003, null, 'set', '{"persons":2}'::jsonb, true)$q$);
select tst.expect('визитка и подсветка ставятся',
  (select (extras->>'persons') || '|' || highlight::text from desk_rows where page_id='P1' and tab_id='' and id='r1'), '2|true');
select tst.run('T1', $q$select rows_patch('W','P1','','r1','{"a":"1"}'::jsonb, 2004)$q$);
select tst.expect('keep не трогает визитку и подсветку',
  (select (extras->>'persons') || '|' || highlight::text from desk_rows where page_id='P1' and tab_id='' and id='r1'), '2|true');
select tst.run('T1', $q$select rows_patch('W','P1','','r1','{}'::jsonb, 2005, null, 'clear', null, false)$q$);
select tst.expect('clear убирает визитку, false снимает подсветку',
  (select coalesce(extras::text, 'NULL') || '|' || highlight::text from desk_rows where page_id='P1' and tab_id='' and id='r1'), 'NULL|false');
select tst.run('T1', $q$select rows_patch('W','P1','','r1', p_height => 44)$q$);
select tst.expect('высота строки не сдвигает время правки',
  (select height::text || '|' || updated_at::text from desk_rows where page_id='P1' and tab_id='' and id='r1'), '44|2005');
select tst.run('T1', $q$select rows_patch('W','P1','','fresh','{"client":"Новый"}'::jsonb, 3000)$q$);
select tst.expect('правка несуществующей строки заводит её внизу',
  (select sort_order::text || '|' || created_at::text from desk_rows where page_id='P1' and tab_id='' and id='fresh'), '2|3000');
select tst.run('T1', $q$select rows_patch('W','P1','','r1','{}'::jsonb, 3001, 2500, p_order_id => 'ord1')$q$);
select tst.expect('filledAt и метка заказа пишутся',
  (select filled_at::text || '|' || order_id from desk_rows where page_id='P1' and tab_id='' and id='r1'), '2500|ord1');
select tst.run('T1', $q$select rows_patch('W','P1','','r1','{}'::jsonb, 3002, p_attachments_set => true, p_attachments => '[{"id":"f"}]'::jsonb)$q$);
select tst.expect('вложения пишутся только по флагу, ячейки целы',
  (select (attachments->0->>'id') || '|' || (cells->>'client') from desk_rows where page_id='P1' and tab_id='' and id='r1'), 'f|Аня');

-- ---------------------------------------------------------------------
-- Копия прав: запись ровно в пределах firestore.rules.
-- ---------------------------------------------------------------------
select tst.expect('чужой технарь НЕ меняет доступ к чужому столу', tst.try('T2', $q$update rows_page_acl set allowed_uids = '{T2,X}' where page_id = 'P1'$q$), 'ok:0');
select tst.expect('ответственный открывает свой стол другому', tst.try('T1', $q$update rows_page_acl set allowed_uids = allowed_uids || '{X}' where page_id = 'P1'$q$), 'ok:1');
select tst.expect('ответственный НЕ переназначает ответственного', tst.try('T1', $q$update rows_page_acl set responsible_uid = 'T2' where page_id = 'P1'$q$), 'error');
select tst.expect('ответственный НЕ меняет createdBy', tst.try('T1', $q$update rows_page_acl set created_by = 'O' where page_id = 'P1'$q$), 'error');
select tst.expect('Тимлид переназначает ответственного', tst.try('TL', $q$update rows_page_acl set responsible_uid = 'T3' where page_id = 'P2'$q$), 'ok:1');
select tst.expect('Тимлид НЕ переназначает стол ОС', tst.try('TL', $q$update rows_page_acl set responsible_uid = 'TL' where page_id = 'osdesk_OS1'$q$), 'error');
select tst.expect('Тимлид открывает стол ОС на просмотр', tst.try('TL', $q$update rows_page_acl set allowed_uids = '{OS1,T1}' where page_id = 'osdesk_OS1'$q$), 'ok:1');
select tst.expect('Тимлид НЕ снимает признак стола ОС', tst.try('TL', $q$update rows_page_acl set os_desk = false where page_id = 'osdesk_OS1'$q$), 'error');
select tst.expect('ОС НЕ снимает признак своего стола ОС', tst.try('OS1', $q$update rows_page_acl set os_desk = false where page_id = 'osdesk_OS1'$q$), 'error');
select tst.expect('Admin переназначает ответственного', tst.try('AD', $q$update rows_page_acl set responsible_uid = 'T3', allowed_uids = '{T2,T3}' where page_id = 'P2'$q$), 'ok:1');
select tst.expect('Admin НЕ меняет доступ без смены ответственного', tst.try('AD', $q$update rows_page_acl set allowed_uids = '{AD}' where page_id = 'P2'$q$), 'error');
select tst.expect('Admin НЕ даёт правку', tst.try('AD', $q$update rows_page_acl set responsible_uid = 'T3', editable_uids = '{AD}' where page_id = 'P2'$q$), 'error');
select tst.expect('Admin НЕ трогает стол ОС', tst.try('AD', $q$update rows_page_acl set responsible_uid = 'AD' where page_id = 'osdesk_OS1'$q$), 'ok:0');
select tst.expect('технарь заводит запись своего нового стола (uid в id)', tst.try('T1', $q$insert into rows_page_acl (workspace_id,page_id,responsible_uid,created_by,allowed_uids) values ('W','page_T1_x9','T1','T1','{T1}')$q$), 'ok:1');
select tst.expect('технарь НЕ присваивает новый стол без своего uid в id', tst.try('T1', $q$insert into rows_page_acl (workspace_id,page_id,responsible_uid,created_by) values ('W','page_T2_x9','T1','T1')$q$), 'error');
select tst.expect('технарь НЕ присваивает стол со случайным id', tst.try('T1', $q$insert into rows_page_acl (workspace_id,page_id,responsible_uid,created_by) values ('W','P9','T1','T1')$q$), 'error');
select tst.expect('технарь НЕ заводит стол на чужое имя', tst.try('T1', $q$insert into rows_page_acl (workspace_id,page_id,responsible_uid,created_by) values ('W','page_T2_x9','T2','T2')$q$), 'error');
select tst.expect('префикс uid не обмануть похожим uid', tst.try('T1', $q$insert into rows_page_acl (workspace_id,page_id,responsible_uid,created_by) values ('W','page_T1x_x9','T1','T1')$q$), 'error');
select tst.expect('технарь НЕ перехватывает уже заведённый стол', tst.try('T1', $q$insert into rows_page_acl (workspace_id,page_id,responsible_uid,created_by) values ('W','P2','T1','T1')$q$), 'error');
select tst.expect('ОС заводит свой стол ОС', tst.try('OS2', $q$insert into rows_page_acl (workspace_id,page_id,responsible_uid,created_by,os_desk) values ('W','osdesk_OS2','OS2','OS2',true)$q$), 'ok:1');
select tst.expect('ОС НЕ заводит стол ОС под чужим id', tst.try('OS2', $q$insert into rows_page_acl (workspace_id,page_id,responsible_uid,created_by,os_desk) values ('W','osdesk_T1','OS2','OS2',true)$q$), 'error');
select tst.expect('технарь без роли ОС НЕ заводит стол ОС', tst.try('T1', $q$insert into rows_page_acl (workspace_id,page_id,responsible_uid,created_by,os_desk) values ('W','osdesk_T1','T1','T1',true)$q$), 'error');
select tst.expect('ОС НЕ заводит обычный стол', tst.try('OS2', $q$insert into rows_page_acl (workspace_id,page_id,responsible_uid,created_by) values ('W','page_OS2_x1','OS2','OS2')$q$), 'error');
select tst.expect('Тимлид заводит запись стола ОС за его ОС', tst.try('TL', $q$insert into rows_page_acl (workspace_id,page_id,responsible_uid,created_by,os_desk) values ('W','osdesk_OS2','OS2','OS2',true)$q$), 'ok:1');
select tst.expect('Тимлид НЕ присваивает себе стол ОС', tst.try('TL', $q$insert into rows_page_acl (workspace_id,page_id,responsible_uid,created_by,os_desk) values ('W','osdesk_OS2','TL','TL',true)$q$), 'error');
select tst.expect('Тимлид НЕ удаляет запись стола', tst.try('TL', $q$delete from rows_page_acl where page_id = 'P2'$q$), 'ok:0');
select tst.expect('Owner удаляет запись стола', tst.try('O', $q$delete from rows_page_acl where page_id = 'P2'$q$), 'ok:1');
select tst.expect('Owner меняет что угодно, и createdBy', tst.try('O', $q$update rows_page_acl set created_by = 'O', os_desk = false where page_id = 'osdesk_OS1'$q$), 'ok:1');

-- Участники.
select tst.expect('Тимлид меняет роль технаря', tst.try('TL', $q$update rows_members set role = 'admin' where uid = 'T1'$q$), 'ok:1');
select tst.expect('Тимлид НЕ выдаёт роль owner', tst.try('TL', $q$update rows_members set role = 'owner' where uid = 'T1'$q$), 'error');
select tst.expect('Тимлид НЕ меняет роль себе', tst.try('TL', $q$update rows_members set extra_roles = '{manager}' where uid = 'TL'$q$), 'ok:0');
select tst.expect('Тимлид НЕ трогает Owner', tst.try('TL', $q$update rows_members set role = 'viewer' where uid = 'O'$q$), 'ok:0');
select tst.expect('Тимлид заводит участника', tst.try('TL', $q$insert into rows_members (workspace_id,uid,role) values ('W','NEW','manager')$q$), 'ok:1');
select tst.expect('Тимлид НЕ заводит участника-owner', tst.try('TL', $q$insert into rows_members (workspace_id,uid,role) values ('W','NEW','owner')$q$), 'error');
select tst.expect('Тимлид НЕ заводит сам себя заново', tst.try('TL', $q$insert into rows_members (workspace_id,uid,role) values ('W','TL','teamlead') on conflict do nothing$q$), 'error');
select tst.expect('Тимлид убирает технаря', tst.try('TL', $q$delete from rows_members where uid = 'T2'$q$), 'ok:1');
select tst.expect('Тимлид НЕ убирает Owner', tst.try('TL', $q$delete from rows_members where uid = 'O'$q$), 'ok:0');
select tst.expect('вторая роль — только manager/os', tst.try('TL', $q$update rows_members set extra_roles = '{teamlead}' where uid = 'T1'$q$), 'error');
select tst.expect('технарь НЕ заводит участников', tst.try('T1', $q$insert into rows_members (workspace_id,uid,role) values ('W','NEW','manager')$q$), 'error');
select tst.expect('технарь НЕ повышает себе роль', tst.try('T1', $q$update rows_members set role = 'owner' where uid = 'T1'$q$), 'ok:0');
select tst.expect('Owner меняет любую роль', tst.try('O', $q$update rows_members set role = 'viewer' where uid = 'TL'$q$), 'ok:1');

-- Наблюдатели и владелец.
select tst.expect('Тимлид НЕ выдаёт наблюдателя', tst.try('TL', $q$insert into rows_desk_observers values ('W','T1')$q$), 'error');
select tst.expect('технарь НЕ делает себя наблюдателем', tst.try('T1', $q$insert into rows_desk_observers values ('W','T1')$q$), 'error');
select tst.expect('Owner выдаёт наблюдателя', tst.try('O', $q$insert into rows_desk_observers values ('W','T1')$q$), 'ok:1');
select tst.expect('наблюдатель видит только свою запись', tst.try('OBS', $q$select * from rows_desk_observers$q$, true), 'ok:1');
select tst.expect('чужой НЕ видит список наблюдателей', tst.try('T1', $q$select * from rows_desk_observers$q$, true), 'ok:0');
select tst.expect('Owner НЕ переписывает владельца workspace с клиента', tst.try('O', $q$update rows_workspaces set owner_id = 'T1'$q$), 'deny');
select tst.expect('никто НЕ заводит чужой workspace с клиента', tst.try('X', $q$insert into rows_workspaces values ('W2','X')$q$), 'error');


-- ---------------------------------------------------------------------
-- Замок хранилища: неживое (до переноса / после отката) — запись закрыта.
-- ---------------------------------------------------------------------
update public.rows_workspaces set live = false where workspace_id = 'W';
select tst.expect('неживое хранилище: ответственный НЕ пишет', tst.try('T1', $q$select rows_patch('W','P1','','r1','{"x":"1"}'::jsonb)$q$), 'error');
select tst.expect('неживое хранилище: НЕ удаляет', tst.try('T1', $q$delete from desk_rows where page_id = 'P1'$q$), 'ok:0');
select tst.expect('неживое хранилище: Owner без переноса тоже НЕ пишет', tst.try('O', $q$select rows_patch('W','P1','','r1','{"x":"1"}'::jsonb)$q$), 'error');
select tst.expect('rows_page_access: в неживом правки нет', tst.try('T1', $q$select 1 where not (rows_page_access('W','P1')->>'canEdit')::boolean$q$, true), 'ok:1');
select tst.expect('неживое хранилище: читать можно', tst.try('T1', $q$select * from desk_rows where page_id = 'P1'$q$, true), 'ok');
select tst.expect('rows_set_state — не Owner отказ', tst.try('TL', $q$select rows_set_state('W', true, false)$q$), 'error');
select tst.expect('rows_set_state — технарь отказ', tst.try('T1', $q$select rows_set_state('W', true, false)$q$), 'error');
select tst.run('O', $q$select rows_set_state('W', false, true)$q$);
select tst.expect('идёт перенос: Owner пишет в неживое', tst.try('O', $q$select rows_patch('W','P1','','r1','{"x":"2"}'::jsonb)$q$), 'ok');
select tst.expect('идёт перенос: технарь НЕ пишет', tst.try('T1', $q$select rows_patch('W','P1','','r1','{"x":"2"}'::jsonb)$q$), 'error');
update public.rows_workspaces set migrating_until = now() - interval '1 minute' where workspace_id = 'W';
select tst.expect('брошенный перенос (срок вышел): Owner НЕ пишет', tst.try('O', $q$select rows_patch('W','P1','','r1','{"x":"3"}'::jsonb)$q$), 'error');
select tst.run('O', $q$select rows_set_state('W', true, false)$q$);
select tst.expect('снова живое: ответственный пишет', tst.try('T1', $q$select rows_patch('W','P1','','r1','{"x":"4"}'::jsonb)$q$), 'ok');
select tst.expect('whoami показывает live', tst.try('O', $q$select 1 where (rows_whoami('W')->>'live')::boolean$q$, true), 'ok:1');
select tst.expect('rows_page_access: в живом правка есть', tst.try('T1', $q$select 1 where (rows_page_access('W','P1')->>'canEdit')::boolean$q$, true), 'ok:1');

-- Старое зеркало закрыто.
select tst.expect('анонимный ключ НЕ читает row_records', tst.try('__anon_key__', $q$select * from row_records$q$, true), 'error');

-- Проверка настройки.
select tst.expect('whoami Owner', tst.try('O', $q$select 1 where (rows_whoami('W')->>'isOwner')::boolean$q$, true), 'ok:1');
select tst.expect('whoami не участника: роли нет', tst.try('X', $q$select 1 where rows_whoami('W')->>'role' is null and rows_whoami('W')->>'uid' = 'X'$q$, true), 'ok:1');
select tst.expect('rows_page_access: просмотр без правки',
  tst.try('T2', $q$select 1 where (rows_page_access('W','P1')->>'canRead')::boolean and not (rows_page_access('W','P1')->>'canEdit')::boolean$q$, true), 'ok:1');

-- ---------------------------------------------------------------------
-- Владелец по документу workspace — БЕЗ записи участника (firestore.rules:
-- isOwner = isDocOwner || участник с ролью owner). Сверка прав пишет
-- rows_members из списка участников и такого владельца туда не добавит.
-- ---------------------------------------------------------------------
insert into public.rows_workspaces (workspace_id, owner_id, live) values ('W2', 'DOCOWNER', true);
insert into public.rows_page_acl (workspace_id, page_id, responsible_uid, created_by, os_desk, allowed_uids, editable_uids)
  values ('W2', 'P9', 'T9', 'T9', false, '{T9}', '{}');
insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at)
  values ('W2', 'P9', '', 'r9', '{"client":"Владелец"}', 0, 1000, 1000);
-- Паритет с firestore.rules: правило строк там — `isMember && canAccessPage`,
-- поэтому владелец БЕЗ записи участника не читает строк и здесь.
select tst.expect('владелец по документу БЕЗ записи участника не читает строк',
  tst.try('DOCOWNER', $q$select * from desk_rows where workspace_id = 'W2'$q$, true), 'ok:0');
select tst.expect('владелец по документу БЕЗ записи участника не правит строки',
  tst.try('DOCOWNER', $q$select rows_patch('W2','P9','','r9','{"x":"1"}'::jsonb)$q$), 'error');
insert into public.rows_members (workspace_id, uid, role, extra_roles) values ('W2', 'DOCOWNER', 'owner', '{}');
select tst.expect('он же с записью участника читает',
  tst.try('DOCOWNER', $q$select * from desk_rows where workspace_id = 'W2'$q$, true), 'ok:1');
select tst.expect('он же с записью участника правит',
  tst.try('DOCOWNER', $q$select rows_patch('W2','P9','','r9','{"x":"1"}'::jsonb)$q$), 'ok');
select tst.expect('анонимный ключ не читает строк W2',
  tst.try('__anon_key__', $q$select * from desk_rows where workspace_id = 'W2'$q$, true), 'ok:0');
select tst.expect('посторонний в чужом workspace не читает',
  tst.try('T1', $q$select * from desk_rows where workspace_id = 'W2'$q$, true), 'ok:0');
select tst.expect('владелец W2 НЕ читает строки W',
  tst.try('DOCOWNER', $q$select * from desk_rows where workspace_id = 'W'$q$, true), 'ok:0');

-- ---------------------------------------------------------------------
-- Тимлид не заводит себе стол ОС в копии прав (в Firestore такой стол ему
-- создать нельзя — нужна роль ОС).
-- ---------------------------------------------------------------------
select tst.expect('Тимлид НЕ заводит себе стол ОС',
  tst.try('TL', $q$insert into rows_page_acl (workspace_id, page_id, responsible_uid, created_by, os_desk, allowed_uids, editable_uids) values ('W','osdesk_TL','TL','TL',true,'{TL}','{}')$q$), 'error');
-- Id стола ОС всегда `osdesk_{uid}` — убираем фикстуру и заводим её заново
-- от самого TLO, как это делает приложение (ensureNewDeskAcl).
delete from public.rows_page_acl where workspace_id = 'W' and page_id = 'osdesk_TLO';
select tst.expect('Тимлид + ОС заводит СВОЙ стол ОС',
  tst.try('TLO', $q$insert into rows_page_acl (workspace_id, page_id, responsible_uid, created_by, os_desk, allowed_uids, editable_uids) values ('W','osdesk_TLO','TLO','TLO',true,'{TLO}','{}')$q$), 'ok');
select tst.expect('Тимлид НЕ заводит запись о чужом столе ОС под видом обычного',
  tst.try('TLT', $q$insert into rows_page_acl (workspace_id, page_id, responsible_uid, created_by, os_desk, allowed_uids, editable_uids) values ('W','osdesk_OS2','TLT','TLT',false,'{TLT}','{}')$q$), 'error');
select tst.expect('Тимлид заводит обычный стол с собой ответственным',
  tst.try('TLT', $q$insert into rows_page_acl (workspace_id, page_id, responsible_uid, created_by, os_desk, allowed_uids, editable_uids) values ('W','page_TLT_new','TLT','TLT',false,'{TLT}','{}')$q$), 'ok');
select tst.expect('Тимлид заводит стол ОС настоящему ОС',
  tst.try('TL', $q$insert into rows_page_acl (workspace_id, page_id, responsible_uid, created_by, os_desk, allowed_uids, editable_uids) values ('W','osdesk_OS2','OS2','OS2',true,'{OS2}','{}')$q$), 'ok');

-- ---------------------------------------------------------------------
select case when ok then '  OK  ' else 'FAIL  ' end || label || case when ok then '' else '  → ' || got end
from tst.results order by n;
select format('ПРОВЕРОК: %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
