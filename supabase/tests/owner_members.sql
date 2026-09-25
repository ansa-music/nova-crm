-- =====================================================================
-- Роль Owner — только у создателя (20261003_owner_members.sql). Запуск ПОСЛЕ
-- desk_rows_rls.sql (берёт его схему tst и участников: O — создатель W,
-- TL — Тимлид, T1/T2 — технари). Файл миграции накатывается дважды.
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;
\ir ../migrations/20261003_owner_members.sql
\ir ../migrations/20261003_owner_members.sql
truncate tst.results;

insert into public.rows_members (workspace_id, uid, role, extra_roles) values
  ('W', 'O2', 'owner', '{}'),
  ('W', 'O3', 'owner', '{}')
on conflict (workspace_id, uid) do update set role = excluded.role;

-- --- Создатель ---------------------------------------------------------
select tst.expect('создатель делает технаря Owner',
  tst.try('O', $q$update rows_members set role = 'owner' where workspace_id='W' and uid = 'T1'$q$), 'ok:1');
select tst.expect('создатель забирает Owner',
  tst.try('O', $q$update rows_members set role = 'manager' where workspace_id='W' and uid = 'T1'$q$), 'ok:1');
select tst.expect('создатель заводит участника-Owner',
  tst.try('O', $q$insert into rows_members (workspace_id,uid,role) values ('W','NEWO','owner')$q$), 'ok:1');
select tst.expect('создатель убирает выданного Owner',
  tst.try('O', $q$delete from rows_members where workspace_id='W' and uid = 'O3'$q$), 'ok:1');

-- --- Выданный Owner ----------------------------------------------------
select tst.expect('выданный Owner НЕ выдаёт роль owner',
  tst.try('O2', $q$update rows_members set role = 'owner' where workspace_id='W' and uid = 'T1'$q$), 'error');
select tst.expect('выданный Owner НЕ заводит участника-Owner',
  tst.try('O2', $q$insert into rows_members (workspace_id,uid,role) values ('W','NEWO','owner')$q$), 'error');
select tst.expect('выданный Owner НЕ снимает другого Owner',
  tst.try('O2', $q$update rows_members set role = 'viewer' where workspace_id='W' and uid = 'O3'$q$), 'ok:0');
select tst.expect('выданный Owner НЕ трогает создателя',
  tst.try('O2', $q$update rows_members set role = 'viewer' where workspace_id='W' and uid = 'O'$q$), 'ok:0');
select tst.expect('выданный Owner НЕ убирает другого Owner',
  tst.try('O2', $q$delete from rows_members where workspace_id='W' and uid = 'O3'$q$), 'ok:0');
select tst.expect('выданный Owner НЕ убирает создателя',
  tst.try('O2', $q$delete from rows_members where workspace_id='W' and uid = 'O'$q$), 'ok:0');
select tst.expect('выданный Owner меняет роль технаря',
  tst.try('O2', $q$update rows_members set role = 'admin' where workspace_id='W' and uid = 'T1'$q$), 'ok:1');
select tst.expect('…и возвращает её',
  tst.try('O2', $q$update rows_members set role = 'manager' where workspace_id='W' and uid = 'T1'$q$), 'ok:1');
select tst.expect('выданный Owner заводит технаря',
  tst.try('O2', $q$insert into rows_members (workspace_id,uid,role) values ('W','NEWT','manager')$q$), 'ok:1');
select tst.expect('выданный Owner убирает технаря',
  tst.try('O2', $q$delete from rows_members where workspace_id='W' and uid = 'T2'$q$), 'ok:1');
select tst.expect('выданный Owner правит свою вторую роль',
  tst.try('O2', $q$update rows_members set extra_roles = '{manager}' where workspace_id='W' and uid = 'O2'$q$), 'ok:1');

-- --- Тимлид — как раньше ----------------------------------------------
select tst.expect('Тимлид НЕ выдаёт роль owner',
  tst.try('TL', $q$update rows_members set role = 'owner' where workspace_id='W' and uid = 'T1'$q$), 'error');
select tst.expect('Тимлид НЕ трогает выданного Owner',
  tst.try('TL', $q$update rows_members set role = 'viewer' where workspace_id='W' and uid = 'O2'$q$), 'ok:0');
select tst.expect('технарь роли не меняет',
  tst.try('T2', $q$update rows_members set role = 'viewer' where workspace_id='W' and uid = 'T1'$q$), 'ok:0');

-- --- Создатель снимает выданного Owner --------------------------------
select tst.expect('создатель снимает выданного Owner',
  tst.try('O', $q$update rows_members set role = 'viewer' where workspace_id='W' and uid = 'O3'$q$), 'ok:1');
-- tst.try всё откатывает — снимаем по-настоящему и проверяем снятого.
select tst.run('O', $q$update rows_members set role = 'viewer' where workspace_id='W' and uid = 'O3'$q$);
select tst.expect('снятый Owner больше ничего не меняет',
  tst.try('O3', $q$update rows_members set role = 'admin' where workspace_id='W' and uid = 'T1'$q$), 'ok:0');

select label, got from tst.results where not ok;
select format('ПРОВЕРОК: %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
