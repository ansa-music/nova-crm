-- Проверки «Заказов от 300к+» (20261038_big_orders.sql, пауза — 20261039, группа — 20261040,
-- получил заказ и счётчик — 20261042). Запускать ПОСЛЕ
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
  ('WBQ', 'BS1', 'os', '{}'),
  ('WBQ', 'BLP', 'leadplus', '{}')
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

-- Группа и активная очередь (20261040). Сейчас: очередь BT3, BO, BT1; ответственный BT1.
select tst.expect('умолчание — группа пуста',
  tst.val('BS1', $q$select big_queue_get('WBQ')->>'pool'$q$), '[]');
select tst.expect('технарь без права не правит группу',
  tst.try('BT2', $q$select big_queue_set_lists('WBQ', array['BT2'], array[]::text[])$q$), 'deny:42501');
select tst.expect('ОС не правит группу',
  tst.try('BS1', $q$select big_queue_set_lists('WBQ', array['BT1'], array['BT2'])$q$), 'deny:42501');
select tst.expect('группа больше 100 — отказ',
  tst.try('BT1', $q$select big_queue_set_lists('WBQ', array['BT1'], array_fill('BT2'::text, array[101]))$q$), 'deny:22023');
select tst.run('BT1', $q$select big_queue_set_lists('WBQ', array['BT3', 'BO', 'BT1'], array['BT2', 'BT1', 'BS1', 'BT2', 'ZZZ'])$q$);
select tst.expect('группа записана: стоящий в очереди, ОС, повтор и чужой отброшены',
  tst.val('BS1', $q$select big_queue_get('WBQ')->>'pool'$q$), '["BT2"]');
select tst.expect('очередь при этом та же, пауза стоящего в очереди на месте',
  tst.val('BS1', $q$select (big_queue_get('WBQ')->>'queue') || (big_queue_get('WBQ')->>'paused')$q$),
  '["BT3", "BO", "BT1"]{"BT3": null}');
select tst.expect('перенос из очереди в группу — одной записью, пауза снимается',
  tst.val('BT1', $q$select (r->>'queue') || (r->>'pool') || (r->>'paused')
    from (select big_queue_set_lists('WBQ', array['BO', 'BT1'], array['BT2', 'BT3']) as r) x$q$),
  '["BO", "BT1"]["BT2", "BT3"]{}');
select tst.expect('из группы в очередь на нужное место',
  tst.val('BO', $q$select (r->>'queue') || (r->>'pool')
    from (select big_queue_set_lists('WBQ', array['BT2', 'BO', 'BT1'], array['BT3']) as r) x$q$),
  '["BT2", "BO", "BT1"]["BT3"]');
select tst.expect('старая правка одной очереди группу не трогает',
  tst.val('BT1', $q$select big_queue_set('WBQ', array['BO', 'BT1'])->>'pool'$q$), '["BT3"]');
select tst.run('BO', $q$select big_queue_set_lists('WBQ', array['BT3', 'BO', 'BT1'], array['BT2'])$q$);
select tst.run('BT1', $q$select big_queue_set_pause('WBQ', 'BT3', true, null)$q$);
update public.rows_workspaces set status = 'suspended' where workspace_id = 'WBQ';
select tst.expect('приостановленная компания — группу не править',
  tst.try('BO', $q$select big_queue_set_lists('WBQ', array['BT1'], array[]::text[])$q$), 'deny:42501');
update public.rows_workspaces set status = 'active' where workspace_id = 'WBQ';

-- Повторный накат.
\ir ../migrations/20261038_big_orders.sql
\ir ../migrations/20261039_big_orders_pause.sql
\ir ../migrations/20261040_big_orders_pool.sql
select tst.expect('после повторного наката очередь на месте',
  tst.val('BS1', $q$select big_queue_get('WBQ')->>'queue'$q$), '["BT3", "BO", "BT1"]');
select tst.expect('после повторного наката пауза на месте',
  tst.val('BS1', $q$select (big_queue_get('WBQ')->>'enabled') || (big_queue_get('WBQ')->>'paused')$q$),
  'false{"BT3": null}');
select tst.expect('после повторного наката группа на месте',
  tst.val('BS1', $q$select big_queue_get('WBQ')->>'pool'$q$), '["BT2"]');

-- Получил заказ — ушёл из очереди (20261042). Сейчас: очередь BT3, BO, BT1; группа BT2; пауза BT3.
select tst.run('BT1', $q$select big_queue_set_enabled('WBQ', true)$q$);
select tst.expect('технарь без права не снимает из очереди',
  tst.try('BT2', $q$select big_queue_took('WBQ', 'BT3')$q$), 'deny:42501');
select tst.expect('посторонний не снимает из очереди',
  tst.try('X', $q$select big_queue_took('WBQ', 'BT3')$q$), 'deny:42501');
select tst.expect('ОС: получивший уходит в начало группы, пауза снята',
  tst.val('BS1', $q$select (r->>'queue') || (r->>'pool') || (r->>'paused') || (r->'taken' ? 'BT3')::text || (r->>'takenBy')
    from (select big_queue_took('WBQ', 'BT3') as r) x$q$),
  '["BO", "BT1"]["BT3", "BT2"]{}trueBS1');
select tst.expect('повтор — без изменений и без дубля в группе',
  tst.val('BS1', $q$select (r->>'queue') || (r->>'pool') from (select big_queue_took('WBQ', 'BT3') as r) x$q$),
  '["BO", "BT1"]["BT3", "BT2"]');
select tst.expect('не в очереди — без изменений',
  tst.val('BS1', $q$select (r->>'queue') || (r->>'pool') from (select big_queue_took('WBQ', 'BT2') as r) x$q$),
  '["BO", "BT1"]["BT3", "BT2"]');
select tst.expect('Тимлид+ снимает из очереди',
  tst.val('BLP', $q$select (r->>'queue') || (r->>'pool') from (select big_queue_took('WBQ', 'BO') as r) x$q$),
  '["BT1"]["BO", "BT3", "BT2"]');
select tst.expect('Тимлид снимает из очереди',
  tst.val('BTL', $q$select (r->>'queue') || (r->>'pool') from (select big_queue_took('WBQ', 'BT1') as r) x$q$),
  '[]["BT1", "BO", "BT3", "BT2"]');
select tst.expect('вернули в очередь — отметка «получил» остаётся',
  tst.val('BO', $q$select (r->>'queue') || (r->'taken' ? 'BT3')::text
    from (select big_queue_set_lists('WBQ', array['BT3', 'BO'], array['BT1', 'BT2']) as r) x$q$),
  '["BT3", "BO"]true');
update public.rows_workspaces set status = 'suspended' where workspace_id = 'WBQ';
select tst.expect('приостановленная компания — не снять из очереди',
  tst.try('BS1', $q$select big_queue_took('WBQ', 'BT3')$q$), 'deny:42501');
update public.rows_workspaces set status = 'active' where workspace_id = 'WBQ';
-- Счётчик «получил заказов от 300к». Сейчас: очередь BT3, BO; группа BT1, BT2.
select tst.expect('ОС: получил крупный — счёт 1 и ушёл в группу',
  tst.val('BS1', $q$select (r->'counts'->>'BT3') || (r->>'queue') || (r->>'countsSince' is not null)::text
    from (select big_queue_took('WBQ', 'BT3', 'row:P:r1') as r) x$q$),
  '1["BO"]true');
select tst.expect('тот же заказ второй раз не считается',
  tst.val('BS1', $q$select big_queue_took('WBQ', 'BT3', 'row:P:r1')->'counts'->>'BT3'$q$), '1');
select tst.expect('не из очереди тоже считается, очередь не трогается',
  tst.val('BS1', $q$select (r->'counts'->>'BT1') || (r->>'queue') from (select big_queue_took('WBQ', 'BT1', 'row:P:r2') as r) x$q$),
  '1["BO"]');
select tst.expect('тот же заказ отдали другому — счёт переходит к нему',
  tst.val('BS1', $q$select coalesce(r->'counts'->>'BT1', '0') || '/' || (r->'counts'->>'BT2')
    from (select big_queue_took('WBQ', 'BT2', 'row:P:r2') as r) x$q$),
  '0/1');
select tst.expect('второй заказ — счёт 2',
  tst.val('BLP', $q$select big_queue_took('WBQ', 'BT3', 'order:o3')->'counts'->>'BT3'$q$), '2');
select tst.expect('не технарю не считается',
  tst.val('BS1', $q$select coalesce(big_queue_took('WBQ', 'BS1', 'row:P:r9')->'counts'->>'BS1', 'нет')$q$), 'нет');
select tst.expect('ключ длиннее 200 — отказ',
  tst.try('BS1', $q$select big_queue_took('WBQ', 'BT3', repeat('x', 201))$q$), 'deny:22023');
select tst.expect('технарь без права счёт не пишет',
  tst.try('BT2', $q$select big_queue_took('WBQ', 'BT2', 'row:P:r5')$q$), 'deny:42501');
select tst.run('BT1', $q$select big_queue_set_enabled('WBQ', false)$q$);
select tst.expect('функция на паузе — считает, но из очереди не убирает',
  tst.val('BS1', $q$select (r->'counts'->>'BO') || (r->>'queue') from (select big_queue_took('WBQ', 'BO', 'row:P:r6') as r) x$q$),
  '1["BO"]');
select tst.expect('ответственный счётчик не сбрасывает',
  tst.try('BT1', $q$select big_queue_reset_counts('WBQ')$q$), 'deny:42501');
select tst.expect('Тимлид счётчик не сбрасывает',
  tst.try('BTL', $q$select big_queue_reset_counts('WBQ')$q$), 'deny:42501');
select tst.expect('технарь счётчик не сбрасывает',
  tst.try('BT2', $q$select big_queue_reset_counts('WBQ')$q$), 'deny:42501');
select tst.expect('Owner сбрасывает — пусто, с новой даты',
  tst.val('BO', $q$select (r->>'counts') || (r->>'countsResetBy') || (r->>'queue') from (select big_queue_reset_counts('WBQ') as r) x$q$),
  '{}BO["BO"]');
select tst.expect('после сброса старый заказ считается заново с 1',
  tst.val('BS1', $q$select big_queue_took('WBQ', 'BT3', 'row:P:r1')->'counts'->>'BT3'$q$), '1');
update public.rows_workspaces set status = 'suspended' where workspace_id = 'WBQ';
select tst.expect('приостановленная компания — сброс закрыт',
  tst.try('BO', $q$select big_queue_reset_counts('WBQ')$q$), 'deny:42501');
update public.rows_workspaces set status = 'active' where workspace_id = 'WBQ';
\ir ../migrations/20261042_big_orders_took.sql
select tst.expect('после повторного наката счётчик на месте',
  tst.val('BS1', $q$select big_queue_get('WBQ')->'counts'->>'BT3'$q$), '1');
select tst.expect('после повторного наката отметки на месте',
  tst.val('BS1', $q$select (big_queue_get('WBQ')->>'queue') || (big_queue_get('WBQ')->'taken' ?& array['BT3', 'BO', 'BT1'])::text$q$),
  '["BO"]true');
select tst.expect('версия схемы', (nova_schema_version() >= '20261042')::text, 'true');

-- ---------------------------------------------------------------------
select case when ok then '  OK  ' else 'FAIL  ' end || label || case when ok then '' else '  → ' || got end
from tst.results order by n;
select format('ПРОВЕРОК: %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
