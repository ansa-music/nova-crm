-- Проверки 20261011_telegram.sql + 20261012_telegram_all.sql: доступ к
-- разделу «Telegram» (любой участник, которого отметил Owner) и ключи.
-- Запускать ПОСЛЕ desk_rows_rls.sql (участники W: O — Owner, TL — Тимлид,
-- TLO — Тимлид + ОС, T1..T3 — технари, OS1/OS2 — ОС, V — Viewer, X —
-- посторонний с настоящим токеном).
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

-- ---------------------------------------------------------------------
-- Доступ: Owner отмечает любого участника, посторонний отбрасывается.
-- ---------------------------------------------------------------------
select tst.expect('Owner выдаёт доступ: участники любых ролей проходят, посторонний X отброшен',
  tst.jval('O', $q$select string_agg(u, ',' order by u) from tg_set_access('W', '{OS1,TLO,T1,X}') u$q$), 'OS1,T1,TLO');
select tst.expect('в таблице ровно трое', (select string_agg(uid, ',' order by uid) from public.tg_access where workspace_id = 'W'), 'OS1,T1,TLO');
select tst.expect('granted_by — Owner из токена', (select string_agg(distinct granted_by, ',') from public.tg_access), 'O');
select tst.expect('Тимлид доступ не выдаёт', tst.try('TL', $q$select * from tg_set_access('W', '{OS2}')$q$), 'error');
select tst.expect('ОС сам себе доступ не выдаёт', tst.try('OS2', $q$select * from tg_set_access('W', '{OS2}')$q$), 'error');
select tst.expect('технарь сам себе доступ не выдаёт', tst.try('T2', $q$select * from tg_set_access('W', '{T2}')$q$), 'error');
select tst.expect('посторонний не выдаёт', tst.try('X', $q$select * from tg_set_access('W', '{OS2}')$q$), 'error');
select tst.expect('анонимный ключ не выдаёт', tst.try('__anon_key__', $q$select * from tg_set_access('W', '{OS2}')$q$), 'error');
select tst.expect('прямая вставка — отказ', tst.try('T2', $q$insert into tg_access (workspace_id, uid, granted_at) values ('W','T2',1)$q$), 'error');
select tst.expect('допущенный ОС видит свою строку', tst.try('OS1', $q$select * from tg_access$q$, true), 'ok:1');
select tst.expect('допущенный технарь видит свою строку', tst.try('T1', $q$select * from tg_access$q$, true), 'ok:1');
select tst.expect('недопущенный ОС ничего не видит', tst.try('OS2', $q$select * from tg_access$q$, true), 'ok:0');
select tst.expect('недопущенный технарь ничего не видит', tst.try('T2', $q$select * from tg_access$q$, true), 'ok:0');
select tst.expect('Тимлид список не видит', tst.try('TL', $q$select * from tg_access$q$, true), 'ok:0');
select tst.expect('Owner видит весь список', tst.try('O', $q$select * from tg_access$q$, true), 'ok:3');
select tst.expect('повторная выдача — тот же список', tst.jval('O', $q$select string_agg(u, ',' order by u) from tg_set_access('W', '{OS1,TLO,T1}') u$q$), 'OS1,T1,TLO');
select tst.expect('снятие и новые: Viewer и ОС2 допущены, OS1 и T1 сняты',
  tst.jval('O', $q$select string_agg(u, ',' order by u) from tg_set_access('W', '{TLO,OS2,V}') u$q$), 'OS2,TLO,V');
select tst.expect('снятый OS1 больше ничего не видит', tst.try('OS1', $q$select * from tg_access$q$, true), 'ok:0');
select tst.expect('Owner может отметить и себя', tst.jval('O', $q$select string_agg(u, ',' order by u) from tg_set_access('W', '{O}') u$q$), 'O');
select tst.expect('пустой список снимает всех', tst.jval('O', $q$select count(*)::text from tg_set_access('W', '{}') u$q$), '0');
select tst.run('O', $q$select * from tg_set_access('W', '{OS1,TLO,T1}')$q$);

-- ---------------------------------------------------------------------
-- Ключи.
-- ---------------------------------------------------------------------
select tst.expect('Owner вводит ключи', tst.try('O', $q$select tg_set_config('W', 123456, 'ABCDEF0123456789abcdef0123456789')$q$), 'ok:1');
select tst.run('O', $q$select tg_set_config('W', 123456, 'ABCDEF0123456789abcdef0123456789')$q$);
select tst.expect('api_hash приведён к нижнему регистру', (select api_id::text || '|' || api_hash from public.tg_config where workspace_id = 'W'), '123456|abcdef0123456789abcdef0123456789');
select tst.expect('кривой api_hash — отказ', tst.try('O', $q$select tg_set_config('W', 1, 'nope')$q$), 'error');
select tst.expect('отрицательный api_id — отказ', tst.try('O', $q$select tg_set_config('W', -5, 'abcdef0123456789abcdef0123456789')$q$), 'error');
select tst.expect('ОС ключи не вводит', tst.try('OS1', $q$select tg_set_config('W', 1, 'abcdef0123456789abcdef0123456789')$q$), 'error');
select tst.expect('Тимлид ключи не вводит', tst.try('TL', $q$select tg_set_config('W', 1, 'abcdef0123456789abcdef0123456789')$q$), 'error');
select tst.expect('допущенный ОС читает ключи', tst.try('OS1', $q$select * from tg_config$q$, true), 'ok:1');
select tst.expect('Тимлид + ОС (допущен) читает ключи', tst.try('TLO', $q$select * from tg_config$q$, true), 'ok:1');
select tst.expect('допущенный технарь читает ключи', tst.try('T1', $q$select * from tg_config$q$, true), 'ok:1');
select tst.expect('недопущенный ОС ключи не читает', tst.try('OS2', $q$select * from tg_config$q$, true), 'ok:0');
select tst.expect('недопущенный технарь ключи не читает', tst.try('T2', $q$select * from tg_config$q$, true), 'ok:0');
select tst.expect('Тимлид ключи не читает', tst.try('TL', $q$select * from tg_config$q$, true), 'ok:0');
select tst.expect('посторонний ключи не читает', tst.try('X', $q$select * from tg_config$q$, true), 'ok:0');
select tst.expect('Owner читает ключи', tst.try('O', $q$select * from tg_config$q$, true), 'ok:1');
select tst.expect('прямая правка ключей — отказ', tst.try('OS1', $q$update tg_config set api_id = 1$q$), 'error');

-- Роль больше не решает: сменили роль — доступ остался.
update public.rows_members set role = 'manager' where workspace_id = 'W' and uid = 'OS1';
select tst.expect('сменили роль ОС на технаря — ключи по-прежнему читаются', tst.try('OS1', $q$select * from tg_config$q$, true), 'ok:1');
update public.rows_members set role = 'os' where workspace_id = 'W' and uid = 'OS1';

-- Убрали из участников — доступ пропал сам, строка осталась; вернули — снова читает.
create temp table tg_saved_member as select * from public.rows_members where workspace_id = 'W' and uid = 'T1';
delete from public.rows_members where workspace_id = 'W' and uid = 'T1';
select tst.expect('убранный из участников ключи не читает', tst.try('T1', $q$select * from tg_config$q$, true), 'ok:0');
select tst.expect('убранный из участников своей строки не видит', tst.try('T1', $q$select * from tg_access$q$, true), 'ok:0');
select tst.expect('убранного заново не отметить', tst.jval('O', $q$select string_agg(u, ',' order by u) from tg_set_access('W', '{OS1,TLO,T1}') u$q$), 'OS1,TLO');
insert into public.rows_members select * from tg_saved_member;
select tst.run('O', $q$select * from tg_set_access('W', '{OS1,TLO,T1}')$q$);
select tst.expect('вернули в участники и отметили — снова читает', tst.try('T1', $q$select * from tg_config$q$, true), 'ok:1');

select tst.expect('Owner стирает ключи', tst.try('O', $q$select tg_set_config('W', null, null)$q$), 'ok:1');
select tst.run('O', $q$select tg_set_config('W', null, null)$q$);
select tst.expect('ключей нет', (select count(*)::text from public.tg_config), '0');

select tst.expect('роли API: запись в таблицы закрыта',
  (has_table_privilege('authenticated', 'public.tg_access', 'insert') or has_table_privilege('anon', 'public.tg_config', 'update'))::text, 'false');
select tst.expect('версия схемы не старее 20261012', (public.nova_schema_version() >= '20261012')::text, 'true');
-- Повторный накат обоих файлов по порядку (так делает деплой): правило «любой участник» на месте.
\ir ../migrations/20261011_telegram.sql
\ir ../migrations/20261012_telegram_all.sql
select tst.expect('после повторного наката доступ на месте', (select count(*)::text from public.tg_access where workspace_id = 'W'), '3');
select tst.expect('после повторного наката технарь по-прежнему допускается',
  tst.jval('O', $q$select string_agg(u, ',' order by u) from tg_set_access('W', '{OS1,T2}') u$q$), 'OS1,T2');

select label, got from tst.results where not ok;
select format('ПРОВЕРОК (telegram): %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
