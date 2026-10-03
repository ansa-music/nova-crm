-- Проверки 20261044_random_server.sql: шансы «Рандома» видит только Owner,
-- бросок на сервере, спин для зрителей, отклик Owner.
-- Запускать ПОСЛЕ desk_rows_rls.sql (участники workspace W: O — Owner,
-- TL — Тимлид, TLO — Тимлид + ОС, T1..T3 — технари, OS1 — ОС, V — Viewer,
-- X — посторонний).
\set ON_ERROR_STOP 1
set client_min_messages = warning;
truncate tst.results;
\ir ../migrations/20261010_orders.sql
\ir ../migrations/20261044_random_server.sql

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
-- Шансы: только Owner.
-- ---------------------------------------------------------------------
select tst.expect('таблица шансов закрыта API-ролям',
  (has_table_privilege('anon', 'public.random_settings', 'select') or has_table_privilege('authenticated', 'public.random_settings', 'select')
   or has_table_privilege('anon', 'public.random_spins', 'select'))::text, 'false');
select tst.expect('Owner читает пустые шансы', tst.jval('O', $q$select random_settings_get('W') ->> 'exists'$q$), 'false');
select tst.expect('Тимлид шансы не читает', tst.jval('TL', $q$select random_settings_get('W')::text$q$), 'error:42501');
select tst.expect('ОС шансы не читает', tst.jval('OS1', $q$select random_settings_get('W')::text$q$), 'error:42501');
select tst.expect('технарь шансы не читает', tst.jval('T1', $q$select random_settings_get('W')::text$q$), 'error:42501');
select tst.expect('Тимлид шансы не пишет', tst.jval('TL', $q$select random_settings_set('W', '{}')::text$q$), 'error:42501');
select tst.expect('посторонний шансы не пишет', tst.jval('X', $q$select random_settings_set('W', '{}')::text$q$), 'error:42501');
select tst.expect('Owner пишет шансы',
  (tst.jval('O', $q$select random_settings_set('W', '{"weights":{"T1":0,"T2":3},"checkBands":[100000,300000],"bandWeights":{"T3":[0,1,3]}}')::text$q$) is not null
  and tst.jval('O', $q$select random_settings_get('W') -> 'data' -> 'weights' ->> 'T2'$q$) = '3')::text, 'true');
select tst.expect('не объект — отказ', tst.jval('O', $q$select random_settings_set('W', '[1]')::text$q$), 'error:22023');

-- ---------------------------------------------------------------------
-- Бросок.
-- ---------------------------------------------------------------------
select tst.expect('технарь не крутит', tst.jval('T1', $q$select random_draw('W', 'o1', 'Аня', '[{"uid":"T2","name":"b","count":0}]', 1000, 'x')::text$q$), 'error:42501');
select tst.expect('Viewer не крутит', tst.jval('V', $q$select random_draw('W', 'o1', 'Аня', '[{"uid":"T2","name":"b","count":0}]', 1000, 'x')::text$q$), 'error:42501');
select tst.expect('пустой пул — отказ', tst.jval('OS1', $q$select random_draw('W', 'o1', 'Аня', '[]', 1000, 'x')::text$q$), 'error:22023');
select tst.expect('повтор в пуле — отказ', tst.jval('OS1', $q$select random_draw('W', 'o1', 'Аня', '[{"uid":"T2"},{"uid":"T2"}]', 1000, 'x')::text$q$), 'error:22023');
-- T1 ×0 — не выпадает никогда; на мелком чеке T3 ×0 (группа 0), T2 ×3.
select tst.expect('×0 не выпадает за 60 бросков (мелкий чек)',
  (select count(*)::text from generate_series(1, 60) g
   where tst.jval('OS1', $q$select random_draw('W', 'o1', 'Аня', '[{"uid":"T1","name":"a","count":0},{"uid":"T2","name":"b","count":0},{"uid":"T3","name":"c","count":0}]', 50000, 'Анна') ->> 'winner'$q$) <> 'T2'), '0');
select tst.expect('на крупном чеке выпадает и T3',
  ((select count(*) from generate_series(1, 80) g
    where tst.jval('TL', $q$select random_draw('W', 'o2', 'Боря', '[{"uid":"T1","name":"a","count":0},{"uid":"T2","name":"b","count":0},{"uid":"T3","name":"c","count":0}]', 400000, 'TL') ->> 'winner'$q$) = 'T3') > 0)::text, 'true');
select tst.expect('у всех ×0 — некому выпасть', tst.jval('OS1', $q$select random_draw('W', 'o1', 'Аня', '[{"uid":"T1","name":"a","count":0}]', 1000, 'x')::text$q$), 'error:P0001');

-- ---------------------------------------------------------------------
-- Спин для зрителей.
-- ---------------------------------------------------------------------
select tst.run('OS1', $q$select random_draw('W', 'o9', 'Клиент', '[{"uid":"T2","name":"Толя","count":1},{"uid":"T3","name":"Тима","count":0}]', null, 'Анна')$q$);
select tst.expect('технарь видит свежий спин',
  tst.jval('T1', $q$select random_spin_latest('W') ->> 'title'$q$), 'Клиент');
select tst.expect('пул спина в исходном порядке без чисел заказов',
  tst.jval('V', $q$select random_spin_latest('W') -> 'pool'$q$), '[{"uid": "T2", "name": "Толя"}, {"uid": "T3", "name": "Тима"}]');
select tst.expect('возраст спина по часам базы',
  (tst.jval('T1', $q$select random_spin_latest('W') ->> 'ageMs'$q$)::bigint < 15000)::text, 'true');
select tst.expect('посторонний спин не читает', tst.jval('X', $q$select random_spin_latest('W')::text$q$), 'error:42501');
select tst.expect('кто крутил — из токена', tst.jval('T1', $q$select random_spin_latest('W') ->> 'byUid'$q$), 'OS1');

-- ---------------------------------------------------------------------
-- Отклик Owner.
-- ---------------------------------------------------------------------
select tst.run('OS1', $q$select order_write('W', 'rs1', 'create', '{"client":"Вика"}'::jsonb)$q$);
select tst.expect('Owner откликается', tst.jval('O', $q$select order_write('W', 'rs1', 'claim', '{"on":true,"name":"Нурба"}'::jsonb) -> 'claims' -> 'O' ->> 'uid'$q$), 'O');
select tst.expect('технарь откликается как раньше', tst.jval('T1', $q$select order_write('W', 'rs1', 'claim', '{"on":true}'::jsonb) -> 'claims' -> 'T1' ->> 'uid'$q$), 'T1');
select tst.expect('Тимлид без Технаря не откликается', tst.jval('TL', $q$select order_write('W', 'rs1', 'claim', '{"on":true}'::jsonb)::text$q$), 'error:42501');
select tst.expect('ОС не откликается', tst.jval('OS1', $q$select order_write('W', 'rs1', 'claim', '{"on":true}'::jsonb)::text$q$), 'error:42501');

-- Повторный накат.
\ir ../migrations/20261044_random_server.sql
select tst.expect('после повторного наката шансы на месте', tst.jval('O', $q$select random_settings_get('W') -> 'data' -> 'weights' ->> 'T2'$q$), '3');
select tst.expect('версия схемы не старее 20261044', (public.nova_schema_version() >= '20261044')::text, 'true');

select label, got from tst.results where not ok;
select format('ПРОВЕРОК (рандом): %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
