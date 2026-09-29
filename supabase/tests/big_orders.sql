-- Проверки «Заказов от 300к+» (20261038_big_orders.sql, пауза — 20261039). Запускать ПОСЛЕ
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

-- Пауза (20261039). Очередь сейчас: BT3, BO, BT1; ответственный — BT1.
select tst.expect('умолчание — функция работает',
  tst.val('BS1', $q$select big_queue_get('WBQ')->>'enabled'$q$), 'true');
select tst.expect('умолчание — никто не на паузе',
  tst.val('BS1', $q$select big_queue_get('WBQ')->>'paused'$q$), '{}');
select tst.expect('технарь не ставит функцию на паузу',
  tst.try('BT2', $q$select big_queue_set_enabled('WBQ', false)$q$), 'deny:42501');
select tst.expect('ОС не ставит технаря на паузу',
  tst.try('BS1', $q$select big_queue_set_pause('WBQ', 'BT3', true, null)$q$), 'deny:42501');
select tst.expect('не-ответственный Тимлид не ставит на паузу',
  tst.try('BTL', $q$select big_queue_set_pause('WBQ', 'BT3', true, null)$q$), 'deny:42501');
select tst.expect('на паузу — только из очереди',
  tst.try('BT1', $q$select big_queue_set_pause('WBQ', 'BT2', true, null)$q$), 'deny:22023');
select tst.expect('дата паузы в прошлом — отказ',
  tst.try('BT1', $q$select big_queue_set_pause('WBQ', 'BT3', true, 1000)$q$), 'deny:22023');
select tst.expect('дата паузы дальше 90 дней — отказ',
  tst.try('BT1', $q$select big_queue_set_pause('WBQ', 'BT3', true,
    ((extract(epoch from now()) + 91 * 86400) * 1000)::bigint)$q$), 'deny:22023');
select tst.run('BT1', $q$select big_queue_set_pause('WBQ', 'BT3', true, null)$q$);
select tst.expect('ответственный поставил технаря на паузу «до снятия»',
  tst.val('BS1', $q$select big_queue_get('WBQ')->>'paused'$q$), '{"BT3": null}');
select tst.run('BO', $q$select big_queue_set_pause('WBQ', 'BT1', true,
  ((extract(epoch from now()) + 3 * 86400) * 1000)::bigint)$q$);
select tst.expect('Owner поставил паузу с датой',
  tst.val('BS1', $q$select jsonb_typeof(big_queue_get('WBQ')->'paused'->'BT1')$q$), 'number');
select tst.expect('кто ставил паузу — из токена',
  tst.val('BS1', $q$select big_queue_get('WBQ')->>'pausedBy'$q$), 'BO');
select tst.expect('пауза не меняет порядок очереди',
  tst.val('BS1', $q$select big_queue_get('WBQ')->>'queue'$q$), '["BT3", "BO", "BT1"]');
select tst.run('BT1', $q$select big_queue_set_pause('WBQ', 'BT1', false, null)$q$);
select tst.expect('«Вернуть» снимает паузу',
  tst.val('BS1', $q$select big_queue_get('WBQ')->>'paused'$q$), '{"BT3": null}');
select tst.expect('правка очереди оставляет паузу тех, кто остался',
  tst.val('BT1', $q$select big_queue_set('WBQ', array['BT1', 'BT3'])->>'paused'$q$), '{"BT3": null}');
select tst.expect('правка очереди без убранного снимает его паузу',
  tst.val('BT1', $q$select big_queue_set('WBQ', array['BO', 'BT1'])->>'paused'$q$), '{}');
select tst.run('BO', $q$select big_queue_set('WBQ', array['BT3', 'BO', 'BT1'])$q$);
select tst.expect('вернули в очередь — паузы нет',
  tst.val('BS1', $q$select big_queue_get('WBQ')->>'paused'$q$), '{}');
select tst.run('BT1', $q$select big_queue_set_pause('WBQ', 'BT3', true, null)$q$);
select tst.run('BT1', $q$select big_queue_set_enabled('WBQ', false)$q$);
select tst.expect('функция на паузе',
  tst.val('BS1', $q$select big_queue_get('WBQ')->>'enabled'$q$), 'false');
select tst.expect('на паузе очередь и паузы технарей сохраняются',
  tst.val('BS1', $q$select (big_queue_get('WBQ')->>'queue') || (big_queue_get('WBQ')->>'paused')$q$),
  '["BT3", "BO", "BT1"]{"BT3": null}');
update public.rows_workspaces set status = 'suspended' where workspace_id = 'WBQ';
select tst.expect('приостановленная компания — паузу не переключить',
  tst.try('BO', $q$select big_queue_set_enabled('WBQ', true)$q$), 'deny:42501');
update public.rows_workspaces set status = 'active' where workspace_id = 'WBQ';

-- Повторный накат.
\ir ../migrations/20261038_big_orders.sql
\ir ../migrations/20261039_big_orders_pause.sql
select tst.expect('после повторного наката очередь на месте',
  tst.val('BS1', $q$select big_queue_get('WBQ')->>'queue'$q$), '["BT3", "BO", "BT1"]');
select tst.expect('после повторного наката пауза на месте',
  tst.val('BS1', $q$select (big_queue_get('WBQ')->>'enabled') || (big_queue_get('WBQ')->>'paused')$q$),
  'false{"BT3": null}');
select tst.expect('версия схемы', (nova_schema_version() >= '20261039')::text, 'true');

-- ---------------------------------------------------------------------
select case when ok then '  OK  ' else 'FAIL  ' end || label || case when ok then '' else '  → ' || got end
from tst.results order by n;
select format('ПРОВЕРОК: %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
