-- Проверки 20261011_telegram.sql: доступ к разделу «Telegram» и ключи.
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
-- Доступ.
-- ---------------------------------------------------------------------
select tst.expect('Owner выдаёт доступ: только ОС проходят (T1 и X отброшены)',
  tst.jval('O', $q$select string_agg(u, ',' order by u) from tg_set_access('W', '{OS1,TLO,T1,X}') u$q$), 'OS1,TLO');
select tst.expect('в таблице ровно двое', (select string_agg(uid, ',' order by uid) from public.tg_access where workspace_id = 'W'), 'OS1,TLO');
select tst.expect('granted_by — Owner из токена', (select string_agg(distinct granted_by, ',') from public.tg_access), 'O');
select tst.expect('Тимлид доступ не выдаёт', tst.try('TL', $q$select * from tg_set_access('W', '{OS2}')$q$), 'error');
select tst.expect('ОС сам себе доступ не выдаёт', tst.try('OS2', $q$select * from tg_set_access('W', '{OS2}')$q$), 'error');
select tst.expect('посторонний не выдаёт', tst.try('X', $q$select * from tg_set_access('W', '{OS2}')$q$), 'error');
select tst.expect('анонимный ключ не выдаёт', tst.try('__anon_key__', $q$select * from tg_set_access('W', '{OS2}')$q$), 'error');
select tst.expect('прямая вставка — отказ', tst.try('OS2', $q$insert into tg_access (workspace_id, uid, granted_at) values ('W','OS2',1)$q$), 'error');
select tst.expect('допущенный ОС видит свою строку', tst.try('OS1', $q$select * from tg_access$q$, true), 'ok:1');
select tst.expect('недопущенный ОС ничего не видит', tst.try('OS2', $q$select * from tg_access$q$, true), 'ok:0');
select tst.expect('технарь ничего не видит', tst.try('T1', $q$select * from tg_access$q$, true), 'ok:0');
select tst.expect('Тимлид список не видит', tst.try('TL', $q$select * from tg_access$q$, true), 'ok:0');
select tst.expect('Owner видит весь список', tst.try('O', $q$select * from tg_access$q$, true), 'ok:2');
select tst.expect('повторная выдача — тот же список', tst.jval('O', $q$select string_agg(u, ',' order by u) from tg_set_access('W', '{OS1,TLO}') u$q$), 'OS1,TLO');
select tst.expect('снятие: новый список без OS1', tst.jval('O', $q$select string_agg(u, ',' order by u) from tg_set_access('W', '{TLO,OS2}') u$q$), 'OS2,TLO');
select tst.expect('снятый OS1 больше ничего не видит', tst.try('OS1', $q$select * from tg_access$q$, true), 'ok:0');
select tst.expect('пустой список снимает всех', tst.jval('O', $q$select count(*)::text from tg_set_access('W', '{}') u$q$), '0');
select tst.run('O', $q$select * from tg_set_access('W', '{OS1,TLO}')$q$);

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
select tst.expect('недопущенный ОС ключи не читает', tst.try('OS2', $q$select * from tg_config$q$, true), 'ok:0');
select tst.expect('технарь ключи не читает', tst.try('T1', $q$select * from tg_config$q$, true), 'ok:0');
select tst.expect('Тимлид ключи не читает', tst.try('TL', $q$select * from tg_config$q$, true), 'ok:0');
select tst.expect('посторонний ключи не читает', tst.try('X', $q$select * from tg_config$q$, true), 'ok:0');
select tst.expect('Owner читает ключи', tst.try('O', $q$select * from tg_config$q$, true), 'ok:1');
select tst.expect('прямая правка ключей — отказ', tst.try('OS1', $q$update tg_config set api_id = 1$q$), 'error');

-- Сняли роль ОС — доступ пропал сам, строка осталась.
update public.rows_members set role = 'manager' where workspace_id = 'W' and uid = 'OS1';
select tst.expect('без роли ОС ключи не читаются', tst.try('OS1', $q$select * from tg_config$q$, true), 'ok:0');
select tst.expect('без роли ОС своя строка не видна', tst.try('OS1', $q$select * from tg_access$q$, true), 'ok:0');
update public.rows_members set role = 'os' where workspace_id = 'W' and uid = 'OS1';
select tst.expect('роль вернули — снова читает', tst.try('OS1', $q$select * from tg_config$q$, true), 'ok:1');

select tst.expect('Owner стирает ключи', tst.try('O', $q$select tg_set_config('W', null, null)$q$), 'ok:1');
select tst.run('O', $q$select tg_set_config('W', null, null)$q$);
select tst.expect('ключей нет', (select count(*)::text from public.tg_config), '0');

select tst.expect('роли API: запись в таблицы закрыта',
  (has_table_privilege('authenticated', 'public.tg_access', 'insert') or has_table_privilege('anon', 'public.tg_config', 'update'))::text, 'false');
select tst.expect('версия схемы не старее 20261011', (public.nova_schema_version() >= '20261011')::text, 'true');
\ir ../migrations/20261011_telegram.sql
select tst.expect('после повторного наката доступ на месте', (select count(*)::text from public.tg_access where workspace_id = 'W'), '2');

select label, got from tst.results where not ok;
select format('ПРОВЕРОК (telegram): %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
