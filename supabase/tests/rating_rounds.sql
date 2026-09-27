-- Проверки оценки раундами (20261033_rating_rounds.sql). Запускать ПОСЛЕ
-- desk_rows_rls.sql (хелперы tst.*). Свой workspace WRR.
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

insert into public.rows_workspaces (workspace_id, owner_id) values ('WRR', 'QO') on conflict do nothing;
insert into public.rows_members (workspace_id, uid, role, extra_roles) values
  ('WRR', 'QO', 'owner', '{}'),
  ('WRR', 'QTL', 'teamlead', '{}'),
  ('WRR', 'QT1', 'manager', '{}'),
  ('WRR', 'QT2', 'manager', '{}'),
  ('WRR', 'QT3', 'manager', '{}'),
  ('WRR', 'QS1', 'os', '{}'),
  ('WRR', 'QS2', 'os', '{}'),
  ('WRR', 'QS3', 'os', '{}'),
  ('WRR', 'QV', 'viewer', '{}')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Управляющие.
-- ---------------------------------------------------------------------
select tst.expect('Тимлид не открывает раунд без права', tst.try('QTL', $q$select rating_round_start('WRR','os_tech')$q$), 'deny:42501');
select tst.expect('ОС не открывает раунд без права', tst.try('QS1', $q$select rating_round_start('WRR','os_tech')$q$), 'deny:42501');
select tst.expect('Тимлид не назначает управляющих', tst.try('QTL', $q$select rating_set_managers('WRR', array['QTL'])$q$), 'deny:42501');
select tst.expect('ОС не назначает себя управляющим', tst.try('QS1', $q$select rating_set_managers('WRR', array['QS1'])$q$), 'deny:42501');
select tst.run('QO', $q$select rating_set_managers('WRR', array['QTL','NOBODY'])$q$);
select tst.expect('Owner назначил Тимлида; постороннего uid в списке нет',
  tst.val('QO', $q$select (rating_state('WRR')->'managers')::text$q$), '["QTL"]');
select tst.expect('управляющий видит, что он управляющий',
  tst.val('QTL', $q$select rating_state('WRR')->>'isManager'$q$), 'true');
select tst.expect('технарь — не управляющий и списка управляющих не видит',
  tst.val('QT1', $q$select (rating_state('WRR')->>'isManager') || ':' || (rating_state('WRR') ? 'managers')::text$q$), 'false:false');

-- ---------------------------------------------------------------------
-- Раунд: открыть.
-- ---------------------------------------------------------------------
select tst.expect('до раунда оценить нельзя',
  tst.try('QS1', $q$select rating_vote('WRR','nope','QT1',8)$q$), 'deny:P0002');
select tst.expect('кривое направление', tst.try('QTL', $q$select rating_round_start('WRR','x')$q$), 'deny:22023');
select tst.run('QTL', $q$select rating_round_start('WRR','os_tech')$q$);
select tst.expect('раунд открыт и виден всем',
  tst.val('QV', $q$select (rating_state('WRR')->'open'->'os_tech'->>'status')$q$), 'open');
select tst.expect('повторное открытие отдаёт тот же раунд',
  tst.val('QO', $q$select (rating_round_start('WRR','os_tech')->>'already')$q$), 'true');
select tst.expect('один открытый раунд на направление',
  (select count(*)::text from rating_rounds where workspace_id = 'WRR' and status = 'open' and direction = 'os_tech'), '1');
select tst.expect('ответ старта — кому слать уведомление (Owner и технари)',
  tst.val('QO', $q$select (select jsonb_agg(x order by x) from jsonb_array_elements_text(rating_round_start('WRR','tech_os')->'raters') x)::text$q$),
  '["QO", "QT1", "QT2", "QT3"]');
select tst.run('QO', $q$select rating_round_cancel('WRR', (rating_state('WRR')->'open'->'tech_os'->>'id'))$q$);
select tst.expect('отменённый раунд больше не открыт',
  tst.val('QO', $q$select (rating_state('WRR')->'open' ? 'tech_os')::text$q$), 'false');

-- ---------------------------------------------------------------------
-- Голоса.
-- ---------------------------------------------------------------------
create temp table rr as select (tst.val('QV', $q$select rating_state('WRR')->'open'->'os_tech'->>'id'$q$)) as id;
grant select on rr to anon;
select tst.expect('ОС оценивает технаря', tst.try('QS1', $q$select rating_vote('WRR',(select id from rr),'QT1',8)$q$), 'ok:1');
select tst.expect('ОС оценивает Owner как технаря', tst.try('QS1', $q$select rating_vote('WRR',(select id from rr),'QO',8)$q$), 'ok:1');
select tst.expect('технарь в раунде ОС→технари не голосует', tst.try('QT1', $q$select rating_vote('WRR',(select id from rr),'QT2',8)$q$), 'deny:42501');
select tst.expect('ОС не оценивает ОС', tst.try('QS1', $q$select rating_vote('WRR',(select id from rr),'QS2',8)$q$), 'deny:42501');
select tst.expect('балл 11 — отказ', tst.try('QS1', $q$select rating_vote('WRR',(select id from rr),'QT1',11)$q$), 'deny:22023');
select tst.expect('посторонний не голосует', tst.try('X', $q$select rating_vote('WRR',(select id from rr),'QT1',5)$q$), 'deny:42501');
select tst.expect('прямой записи нет', tst.try('QS1', $q$insert into rating_votes values ('WRR',(select id from rr),'QS1','QT2',9,now())$q$), 'error');
select tst.run('QS1', $q$select rating_vote('WRR',(select id from rr),'QT1',8)$q$);
select tst.run('QS2', $q$select rating_vote('WRR',(select id from rr),'QT1',9)$q$);
select tst.run('QS3', $q$select rating_vote('WRR',(select id from rr),'QT1',10)$q$);
select tst.run('QS1', $q$select rating_vote('WRR',(select id from rr),'QT2',5)$q$);
select tst.run('QS2', $q$select rating_vote('WRR',(select id from rr),'QT2',6)$q$);
select tst.expect('свои голоса видны', tst.try('QS1', $q$select * from rating_votes where workspace_id = 'WRR'$q$, true), 'ok:2');
select tst.expect('в состоянии мои голоса открытого раунда',
  tst.val('QS2', $q$select jsonb_array_length(rating_state('WRR')->'mine')::text$q$), '2');
select tst.expect('оценённый строк о себе не видит', tst.try('QT1', $q$select * from rating_votes$q$, true), 'ok:0');
select tst.expect('Owner чужих строк не видит', tst.try('QO', $q$select * from rating_votes$q$, true), 'ok:0');
select tst.expect('управляющий видит только участие',
  tst.val('QTL', $q$select (rating_state('WRR')->'progress'->'os_tech')::text$q$), '{"rated": 3, "raters": 3}');
select tst.expect('пока раунд открыт, итогов нет',
  tst.val('QV', $q$select jsonb_array_length(rating_results('WRR')->'rows')::text$q$), '0');
select tst.expect('раунды напрямую закрыты', tst.try('QO', $q$select * from rating_rounds$q$, true), 'error');

-- ---------------------------------------------------------------------
-- Завершить.
-- ---------------------------------------------------------------------
select tst.expect('технарь не завершает', tst.try('QT1', $q$select rating_round_finish('WRR',(select id from rr))$q$), 'deny:42501');
select tst.expect('завершение — кому уведомление (ОС и технари)',
  tst.val('QTL', $q$select jsonb_array_length(rating_round_finish('WRR',(select id from rr))->'notify')::text$q$), '7');
select tst.expect('после завершения голосовать нельзя', tst.try('QS3', $q$select rating_vote('WRR',(select id from rr),'QT2',7)$q$), 'deny:P0002');
select tst.expect('итог: QT1 = 9,0 от троих',
  tst.val('QV', $q$select (rating_results('WRR')->'rows')::jsonb @> jsonb_build_array(jsonb_build_object('target','QT1','avg',9.0,'count',3))$q$)::text, 'true');
select tst.expect('двое оценивших при пороге 3 — не видно',
  tst.val('QV', $q$select exists (select 1 from jsonb_array_elements(rating_results('WRR')->'rows') e where e->>'target' = 'QT2')::text$q$), 'false');
select tst.expect('в итогах нет, кто ставил',
  tst.val('QT1', $q$select (rating_results('WRR')::text like '%QS2%')::text$q$), 'false');
select tst.expect('закрытый раунд в списке раундов',
  tst.val('QV', $q$select rating_results('WRR')->'rounds'->0->>'status'$q$), 'closed');

-- ---------------------------------------------------------------------
-- Настройка: направления, скрытие, порог, исключённые.
-- ---------------------------------------------------------------------
select tst.expect('технарь не меняет настройку', tst.try('QT1', $q$select rating_set_config('WRR', false)$q$), 'deny:42501');
select tst.run('QTL', $q$select rating_set_config('WRR', null, false)$q$);
select tst.expect('оценка ОС выключена — раунд не открыть', tst.try('QO', $q$select rating_round_start('WRR','tech_os')$q$), 'deny:42501');
select tst.expect('оценка ОС выключена — у технаря canRate false',
  tst.val('QT1', $q$select rating_state('WRR')->'canRate'->>'tech_os'$q$), 'false');
select tst.run('QTL', $q$select rating_set_config('WRR', null, true)$q$);
select tst.run('QTL', $q$select rating_set_config('WRR', null, null, false)$q$);
select tst.expect('итоги скрыты — участнику пусто',
  tst.val('QT1', $q$select (rating_results('WRR')->>'hidden') || ':' || jsonb_array_length(rating_results('WRR')->'rows')$q$), 'true:0');
select tst.expect('итоги скрыты — управляющий видит',
  tst.val('QTL', $q$select jsonb_array_length(rating_results('WRR')->'rows')::text$q$), '1');
select tst.run('QTL', $q$select rating_set_config('WRR', null, null, true, 2)$q$);
select tst.expect('порог 2 — видно и QT2',
  tst.val('QV', $q$select exists (select 1 from jsonb_array_elements(rating_results('WRR')->'rows') e where e->>'target' = 'QT2')::text$q$), 'true');
select tst.expect('порог 1 — отказ', tst.try('QTL', $q$select rating_set_config('WRR', null, null, null, 1)$q$), 'deny:22023');
select tst.run('QTL', $q$select rating_set_config('WRR', null, null, null, null, array['QS3','QT3'])$q$);
select tst.run('QO', $q$select rating_round_start('WRR','tech_os')$q$);
create temp table rr2 as select (tst.val('QV', $q$select rating_state('WRR')->'open'->'tech_os'->>'id'$q$)) as id;
grant select on rr2 to anon;
select tst.expect('исключённого ОС не оценить', tst.try('QT1', $q$select rating_vote('WRR',(select id from rr2),'QS3',7)$q$), 'deny:42501');
select tst.expect('исключённый технарь не оценивает', tst.try('QT3', $q$select rating_vote('WRR',(select id from rr2),'QS1',7)$q$), 'deny:42501');
select tst.expect('технарь оценивает ОС', tst.try('QT1', $q$select rating_vote('WRR',(select id from rr2),'QS1',7)$q$), 'ok:1');
select tst.expect('Owner оценивает ОС', tst.try('QO', $q$select rating_vote('WRR',(select id from rr2),'QS1',7)$q$), 'ok:1');
select tst.expect('участие: исключённые не в счёте (Owner + 2 технаря)',
  tst.val('QTL', $q$select rating_state('WRR')->'progress'->'tech_os'->>'raters'$q$), '3');

-- Снятое право.
select tst.run('QO', $q$select rating_set_managers('WRR', array[]::text[])$q$);
select tst.expect('после снятия права Тимлид не завершает',
  tst.try('QTL', $q$select rating_round_finish('WRR',(select id from rr2))$q$), 'deny:42501');

-- Приостановленная компания.
update public.rows_workspaces set status = 'suspended' where workspace_id = 'WRR';
select tst.expect('приостановленная компания — голос не принят', tst.try('QT2', $q$select rating_vote('WRR',(select id from rr2),'QS1',7)$q$), 'deny:42501');
update public.rows_workspaces set status = 'active' where workspace_id = 'WRR';

-- ---------------------------------------------------------------------
-- Повторный накат.
-- ---------------------------------------------------------------------
\ir ../migrations/20261033_rating_rounds.sql
select tst.expect('после повторного наката раунды и голоса на месте',
  (select (count(*) >= 5)::text from public.rating_votes where workspace_id = 'WRR'), 'true');
select tst.expect('после повторного наката открытый раунд на месте',
  tst.val('QV', $q$select (rating_state('WRR')->'open' ? 'tech_os')::text$q$), 'true');
select tst.expect('версия схемы', (nova_schema_version() >= '20261033')::text, 'true');

-- ---------------------------------------------------------------------
select case when ok then '  OK  ' else 'FAIL  ' end || label || case when ok then '' else '  → ' || got end
from tst.results order by n;
select format('ПРОВЕРОК: %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
