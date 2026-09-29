-- Проверки «Заказов от 300к+» (20261038_big_orders.sql). Запускать ПОСЛЕ
-- desk_rows_rls.sql (хелперы tst.*). Свой workspace WBQ.
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

insert into public.rows_workspaces (workspace_id, owner_id, live) values ('WBQ', 'BO', true) on conflict do nothing;
insert into public.rows_members (workspace_id, uid, role, extra_roles) values
  ('WBQ', 'BO', 'owner', '{}'),
  ('WBQ', 'BTL', 'teamlead', '{}'),
  ('WBQ', 'BTT', 'teamlead', '{manager}'),
  ('WBQ', 'BT1', 'manager', '{}'),
  ('WBQ', 'BT2', 'manager', '{}'),
  ('WBQ', 'BT3', 'manager', '{}'),
  ('WBQ', 'BS1', 'os', '{}')
on conflict do nothing;

-- Умолчание: порог 300 000, пусто.
select tst.expect('умолчание — порог 300000',
  tst.val('BS1', $q$select big_queue_get('WBQ')->>'threshold'$q$), '300000');
select tst.expect('умолчание — очередь пуста',
  tst.val('BS1', $q$select jsonb_array_length(big_queue_get('WBQ')->'queue')::text$q$), '0');
select tst.expect('посторонний не читает', tst.try('X', $q$select big_queue_get('WBQ')$q$), 'deny:42501');
select tst.expect('прямого чтения таблицы нет', tst.try('BO', $q$select * from big_order_queue$q$, true), 'deny');
select tst.expect('прямой записи нет',
  tst.try('BO', $q$insert into big_order_queue (workspace_id) values ('WBQ')$q$), 'error');

-- Ответственные и порог — только Owner.
select tst.expect('технарь не назначает ответственных',
  tst.try('BT1', $q$select big_queue_set_config('WBQ', array['BT1'], 300000)$q$), 'deny:42501');
select tst.expect('Тимлид не назначает ответственных',
  tst.try('BTL', $q$select big_queue_set_config('WBQ', array['BTL'], 300000)$q$), 'deny:42501');
select tst.expect('порог меньше 1000 — отказ',
  tst.try('BO', $q$select big_queue_set_config('WBQ', array['BTL'], 10)$q$), 'deny:22023');
select tst.run('BO', $q$select big_queue_set_config('WBQ', array['BTL', 'ZZZ'], 250000)$q$);
select tst.expect('ответственный записан, посторонний uid отброшен',
  tst.val('BS1', $q$select big_queue_get('WBQ')->>'managers'$q$), '["BTL"]');
select tst.expect('порог записан',
  tst.val('BS1', $q$select big_queue_get('WBQ')->>'threshold'$q$), '250000');

-- Очередь — Owner или ответственный.
select tst.expect('технарь не правит очередь',
  tst.try('BT1', $q$select big_queue_set('WBQ', array['BT1'])$q$), 'deny:42501');
select tst.expect('ОС не правит очередь',
  tst.try('BS1', $q$select big_queue_set('WBQ', array['BT1'])$q$), 'deny:42501');
select tst.expect('другой Тимлид (не ответственный) не правит очередь',
  tst.try('BTT', $q$select big_queue_set('WBQ', array['BT1'])$q$), 'deny:42501');
select tst.run('BTL', $q$select big_queue_set('WBQ', array['BT2', 'BT1', 'BT2', 'BS1', 'BTL', 'BTT', 'ZZZ'])$q$);
select tst.expect('ответственный записал: порядок сохранён, повтор/ОС/Тимлид/чужой отброшены, Тимлид+Технарь остался',
  tst.val('BS1', $q$select big_queue_get('WBQ')->>'queue'$q$), '["BT2", "BT1", "BTT"]');
select tst.expect('кто правил — из токена',
  tst.val('BS1', $q$select big_queue_get('WBQ')->>'updatedBy'$q$), 'BTL');
select tst.run('BO', $q$select big_queue_set('WBQ', array['BT3', 'BO', 'BT1'])$q$);
select tst.expect('Owner правит очередь (и сам может стоять в ней)',
  tst.val('BS1', $q$select big_queue_get('WBQ')->>'queue'$q$), '["BT3", "BO", "BT1"]');
select tst.expect('смена ответственных не трогает очередь',
  tst.val('BO', $q$select big_queue_set_config('WBQ', array['BT1'], 300000)->>'queue'$q$), '["BT3", "BO", "BT1"]');
select tst.expect('снятый ответственный больше не правит',
  tst.try('BTL', $q$select big_queue_set('WBQ', array['BT1'])$q$), 'deny:42501');
select tst.expect('новый ответственный правит',
  tst.try('BT1', $q$select big_queue_set('WBQ', array['BT1', 'BT2'])$q$), 'ok');
select tst.expect('слишком длинная очередь — отказ',
  tst.try('BO', $q$select big_queue_set('WBQ', array_fill('BT1'::text, array[51]))$q$), 'deny:22023');

-- Убранный из участников ответственный.
delete from public.rows_members where workspace_id = 'WBQ' and uid = 'BT1';
select tst.expect('убранный из участников ответственный не правит',
  tst.try('BT1', $q$select big_queue_set('WBQ', array['BT2'])$q$), 'deny:42501');
insert into public.rows_members (workspace_id, uid, role, extra_roles) values ('WBQ', 'BT1', 'manager', '{}')
on conflict do nothing;

-- Приостановленная компания.
update public.rows_workspaces set status = 'suspended' where workspace_id = 'WBQ';
select tst.expect('приостановленная компания — не пишет',
  tst.try('BO', $q$select big_queue_set('WBQ', array['BT2'])$q$), 'deny:42501');
select tst.expect('приостановленная компания — читает',
  tst.try('BS1', $q$select big_queue_get('WBQ')$q$), 'ok');
update public.rows_workspaces set status = 'active' where workspace_id = 'WBQ';

-- Повторный накат.
\ir ../migrations/20261038_big_orders.sql
select tst.expect('после повторного наката очередь на месте',
  tst.val('BS1', $q$select big_queue_get('WBQ')->>'queue'$q$), '["BT3", "BO", "BT1"]');
select tst.expect('версия схемы', (nova_schema_version() >= '20261038')::text, 'true');

-- ---------------------------------------------------------------------
select case when ok then '  OK  ' else 'FAIL  ' end || label || case when ok then '' else '  → ' || got end
from tst.results order by n;
select format('ПРОВЕРОК: %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
