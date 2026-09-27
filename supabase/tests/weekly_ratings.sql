-- Проверки еженедельной оценки (20261032_weekly_ratings.sql). Запускать ПОСЛЕ
-- desk_rows_rls.sql (хелперы tst.*). Свой workspace WR — наборы ролей в W
-- тесты выше меняют.
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

insert into public.rows_workspaces (workspace_id, owner_id) values ('WKR', 'RO') on conflict do nothing;
insert into public.rows_members (workspace_id, uid, role, extra_roles) values
  ('WKR', 'RO', 'owner', '{}'),
  ('WKR', 'RTL', 'teamlead', '{}'),
  ('WKR', 'RTLO', 'teamlead', '{os}'),
  ('WKR', 'RT1', 'manager', '{}'),
  ('WKR', 'RT2', 'manager', '{}'),
  ('WKR', 'RTO', 'manager', '{os}'),
  ('WKR', 'RS1', 'os', '{}'),
  ('WKR', 'RS2', 'os', '{}'),
  ('WKR', 'RS3', 'os', '{}'),
  ('WKR', 'RV', 'viewer', '{}')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Ставить.
-- ---------------------------------------------------------------------
select tst.expect('ОС оценивает технаря', tst.try('RS1', $q$select weekly_rate('WKR','os_tech','RT1',8)$q$), 'ok:1');
select tst.expect('ОС оценивает Owner как технаря', tst.try('RS1', $q$select weekly_rate('WKR','os_tech','RO',7)$q$), 'ok:1');
select tst.expect('Тимлид + ОС оценивает технаря', tst.try('RTLO', $q$select weekly_rate('WKR','os_tech','RT1',9)$q$), 'ok:1');
select tst.expect('ОС не оценивает другого ОС как технаря', tst.try('RS1', $q$select weekly_rate('WKR','os_tech','RS2',8)$q$), 'deny:42501');
select tst.expect('ОС не оценивает Тимлида без Технаря', tst.try('RS1', $q$select weekly_rate('WKR','os_tech','RTL',8)$q$), 'deny:42501');
select tst.expect('технарь не ставит от имени ОС', tst.try('RT1', $q$select weekly_rate('WKR','os_tech','RT2',8)$q$), 'deny:42501');
select tst.expect('технарь оценивает ОС', tst.try('RT1', $q$select weekly_rate('WKR','tech_os','RS1',6)$q$), 'ok:1');
select tst.expect('Owner оценивает ОС', tst.try('RO', $q$select weekly_rate('WKR','tech_os','RS1',6)$q$), 'ok:1');
select tst.expect('технарь не оценивает технаря как ОС', tst.try('RT1', $q$select weekly_rate('WKR','tech_os','RT2',6)$q$), 'deny:42501');
select tst.expect('Технарь + ОС не оценивает сам себя', tst.try('RTO', $q$select weekly_rate('WKR','os_tech','RTO',10)$q$), 'deny:22023');
select tst.expect('балл 0 — отказ', tst.try('RS1', $q$select weekly_rate('WKR','os_tech','RT2',0)$q$), 'deny:22023');
select tst.expect('балл 11 — отказ', tst.try('RS1', $q$select weekly_rate('WKR','os_tech','RT2',11)$q$), 'deny:22023');
select tst.expect('кривое направление — отказ', tst.try('RS1', $q$select weekly_rate('WKR','x','RT2',5)$q$), 'deny:22023');
select tst.expect('Viewer не оценивает', tst.try('RV', $q$select weekly_rate('WKR','os_tech','RT1',5)$q$), 'deny:42501');
select tst.expect('посторонний не оценивает', tst.try('X', $q$select weekly_rate('WKR','os_tech','RT1',5)$q$), 'deny:42501');
select tst.expect('анонимный ключ не оценивает', tst.try('__anon_key__', $q$select weekly_rate('WKR','os_tech','RT1',5)$q$), 'deny:42501');
select tst.expect('чужой проект Firebase не оценивает', tst.try('__forged__:RS1', $q$select weekly_rate('WKR','os_tech','RT1',5)$q$), 'deny:42501');
select tst.expect('прямой вставки нет', tst.try('RS1', $q$insert into weekly_ratings (workspace_id,week_key,direction,rater_uid,target_uid,score) values ('WKR','2026-W01','os_tech','RS1','RT2',9)$q$), 'error');
select tst.expect('прямой правки нет', tst.try('RS1', $q$update weekly_ratings set score = 1 where rater_uid = 'RS1'$q$), 'deny');
select tst.expect('прямого удаления нет', tst.try('RS1', $q$delete from weekly_ratings where rater_uid = 'RS1'$q$), 'deny');

-- Оставляем оценки недели: RT1 от RS1 (8→сменим на 10), RTLO (9).
select tst.run('RS1', $q$select weekly_rate('WKR','os_tech','RT1',8)$q$);
select tst.run('RS1', $q$select weekly_rate('WKR','os_tech','RT1',10)$q$);
select tst.run('RTLO', $q$select weekly_rate('WKR','os_tech','RT1',9)$q$);
select tst.run('RS1', $q$select weekly_rate('WKR','os_tech','RO',7)$q$);
select tst.run('RT1', $q$select weekly_rate('WKR','tech_os','RS1',6)$q$);
select tst.expect('повтор меняет, а не дублирует',
  (select count(*)::text from weekly_ratings where workspace_id = 'WKR' and rater_uid = 'RS1' and target_uid = 'RT1'), '1');
select tst.expect('новая оценка на месте',
  (select score::text from weekly_ratings where workspace_id = 'WKR' and rater_uid = 'RS1' and target_uid = 'RT1'), '10');

-- ---------------------------------------------------------------------
-- Анонимность чтения.
-- ---------------------------------------------------------------------
select tst.expect('свои оценки видны', tst.try('RS1', $q$select * from weekly_ratings where workspace_id = 'WKR'$q$, true), 'ok:2');
select tst.expect('оценённый технарь не видит строк о себе', tst.try('RT1', $q$select * from weekly_ratings where target_uid = 'RT1'$q$, true), 'ok:0');
select tst.expect('Owner не видит чужих строк', tst.try('RO', $q$select * from weekly_ratings where rater_uid <> 'RO'$q$, true), 'ok:0');
select tst.expect('Тимлид не видит строк', tst.try('RTL', $q$select * from weekly_ratings$q$, true), 'ok:0');
select tst.expect('другой ОС не видит строк коллеги', tst.try('RS2', $q$select * from weekly_ratings$q$, true), 'ok:0');
select tst.expect('посторонний не видит', tst.try('X', $q$select * from weekly_ratings$q$, true), 'ok:0');
select tst.expect('настройка напрямую закрыта', tst.try('RO', $q$select * from weekly_rating_config$q$, true), 'error');
select tst.expect('в состоянии — только мои оценки',
  tst.val('RS1', $q$select jsonb_array_length(weekly_rating_state('WKR')->'mine')::text$q$), '2');
select tst.expect('у технаря в состоянии нет оценок о нём',
  tst.val('RT1', $q$select (weekly_rating_state('WKR')->'mine')::text$q$), '[{"score": 6, "target": "RS1", "direction": "tech_os"}]');
select tst.expect('ОС может ставить технарям',
  tst.val('RS1', $q$select (weekly_rating_state('WKR')->'canRate'->>'os_tech')$q$), 'true');
select tst.expect('ОС не ставит ОС',
  tst.val('RS1', $q$select (weekly_rating_state('WKR')->'canRate'->>'tech_os')$q$), 'false');
select tst.expect('участие видит только Owner',
  tst.val('RS1', $q$select (weekly_rating_state('WKR') ? 'progress')::text$q$), 'false');
select tst.expect('Owner видит, сколько ОС уже оценили (без имён)',
  tst.val('RO', $q$select (weekly_rating_state('WKR')->'progress'->'os_tech')::text$q$), '{"rated": 2, "raters": 5}');
select tst.expect('посторонний не читает состояние', tst.val('X', $q$select weekly_rating_state('WKR')::text$q$), 'error:42501');

-- ---------------------------------------------------------------------
-- Итоги: текущая неделя не публикуется.
-- ---------------------------------------------------------------------
select tst.expect('текущая неделя в итоги не попадает',
  tst.val('RT2', $q$select jsonb_array_length(weekly_rating_results('WKR')->'rows')::text$q$), '0');

-- Прошлые недели — фикстурой от суперпользователя.
insert into public.weekly_ratings (workspace_id, week_key, direction, rater_uid, target_uid, score)
select 'WKR', weekly_key_of(weekly_monday('WKR') - 7), 'os_tech', r, 'RT1', s
from (values ('RS1', 8), ('RS2', 9), ('RS3', 10)) v(r, s);
insert into public.weekly_ratings (workspace_id, week_key, direction, rater_uid, target_uid, score)
select 'WKR', weekly_key_of(weekly_monday('WKR') - 7), 'os_tech', r, 'RT2', s
from (values ('RS1', 5), ('RS2', 6)) v(r, s);
insert into public.weekly_ratings (workspace_id, week_key, direction, rater_uid, target_uid, score)
select 'WKR', weekly_key_of(weekly_monday('WKR') - 14), 'tech_os', r, 'RS1', s
from (values ('RT1', 7), ('RT2', 8), ('RO', 9)) v(r, s);

select tst.expect('3 оценивших — среднее видно всем',
  tst.val('RV', $q$select (weekly_rating_results('WKR')->'rows')::jsonb @> jsonb_build_array(jsonb_build_object('target','RT1','avg',9.0,'count',3,'direction','os_tech'))$q$), 'true');
select tst.expect('2 оценивших при пороге 3 — не видно',
  tst.val('RV', $q$select exists (select 1 from jsonb_array_elements(weekly_rating_results('WKR')->'rows') e where e->>'target' = 'RT2')::text$q$), 'false');
select tst.expect('оценка ОС от технарей видна',
  tst.val('RS2', $q$select exists (select 1 from jsonb_array_elements(weekly_rating_results('WKR')->'rows') e where e->>'target' = 'RS1' and e->>'direction' = 'tech_os')::text$q$), 'true');
select tst.expect('в итогах нет, кто ставил',
  tst.val('RS1', $q$select (weekly_rating_results('WKR')::text like '%RS2%' or weekly_rating_results('WKR')::text like '%RS3%')::text$q$), 'false');
select tst.expect('недель по умолчанию 8, новые первыми',
  tst.val('RV', $q$select jsonb_array_length(weekly_rating_results('WKR')->'weeks') || ':' || (weekly_rating_results('WKR')->'weeks'->>0)$q$),
  '8:' || weekly_key_of(weekly_monday('WKR') - 7));
select tst.expect('служебные функции закрыты API', tst.val('RV', $q$select weekly_monday('WKR')::text$q$), 'error:42501');
select tst.expect('посторонний итогов не читает', tst.val('X', $q$select weekly_rating_results('WKR')::text$q$), 'error:42501');

-- ---------------------------------------------------------------------
-- Выключатели Owner.
-- ---------------------------------------------------------------------
select tst.expect('Тимлид не меняет настройку', tst.try('RTL', $q$select weekly_rating_set_config('WKR', false, null, null)$q$), 'deny:42501');
select tst.expect('ОС не меняет настройку', tst.try('RS1', $q$select weekly_rating_set_config('WKR', null, false, null)$q$), 'deny:42501');
select tst.expect('порог 1 — отказ', tst.try('RO', $q$select weekly_rating_set_config('WKR', null, null, 1)$q$), 'deny:22023');

select tst.run('RO', $q$select weekly_rating_set_config('WKR', null, null, 2)$q$);
select tst.expect('порог 2 — видно и двоих',
  tst.val('RV', $q$select exists (select 1 from jsonb_array_elements(weekly_rating_results('WKR')->'rows') e where e->>'target' = 'RT2')::text$q$), 'true');

select tst.run('RO', $q$select weekly_rating_set_config('WKR', null, false, null)$q$);
select tst.expect('итоги скрыты — участнику пусто',
  tst.val('RT1', $q$select (weekly_rating_results('WKR')->>'hidden') || ':' || jsonb_array_length(weekly_rating_results('WKR')->'rows')$q$), 'true:0');
select tst.expect('итоги скрыты — Owner видит с пометкой',
  tst.val('RO', $q$select (weekly_rating_results('WKR')->>'hidden') || ':' || (jsonb_array_length(weekly_rating_results('WKR')->'rows') > 0)$q$), 'true:true');
select tst.expect('порог сохранился при смене показа',
  tst.val('RT1', $q$select weekly_rating_state('WKR')->>'minRaters'$q$), '2');

select tst.run('RO', $q$select weekly_rating_set_config('WKR', false, null, null)$q$);
select tst.expect('сбор выключен — оценить нельзя', tst.try('RS2', $q$select weekly_rate('WKR','os_tech','RT2',8)$q$), 'deny:42501');
select tst.expect('сбор выключен — видно в состоянии',
  tst.val('RS2', $q$select weekly_rating_state('WKR')->>'enabled'$q$), 'false');
select tst.run('RO', $q$select weekly_rating_set_config('WKR', true, true, 3)$q$);
select tst.expect('включили снова — оценить можно', tst.try('RS2', $q$select weekly_rate('WKR','os_tech','RT2',8)$q$), 'ok:1');

-- Снять свою оценку.
select tst.expect('снять свою оценку',
  tst.val('RS1', $q$select weekly_rate('WKR','os_tech','RT1',null)->>'state'$q$), 'removed');

-- Приостановленная компания не пишет.
update public.rows_workspaces set status = 'suspended' where workspace_id = 'WKR';
select tst.expect('приостановленная компания — отказ', tst.try('RS2', $q$select weekly_rate('WKR','os_tech','RT1',8)$q$), 'deny:42501');
update public.rows_workspaces set status = 'active' where workspace_id = 'WKR';

-- Ушедший из команды не оценивает и не оценивается.
delete from public.rows_members where workspace_id = 'WKR' and uid = 'RS3';
select tst.expect('убранный ОС не оценивает', tst.try('RS3', $q$select weekly_rate('WKR','os_tech','RT1',8)$q$), 'deny:42501');
select tst.expect('убранного не оценить', tst.try('RT1', $q$select weekly_rate('WKR','tech_os','RS3',8)$q$), 'deny:42501');

-- ---------------------------------------------------------------------
-- Повторный накат.
-- ---------------------------------------------------------------------
\ir ../migrations/20261032_weekly_ratings.sql
select tst.expect('после повторного наката оценки на месте',
  (select (count(*) >= 8)::text from public.weekly_ratings where workspace_id = 'WKR'), 'true');
select tst.expect('после повторного наката настройка на месте',
  tst.val('RO', $q$select weekly_rating_state('WKR')->>'minRaters'$q$), '3');
select tst.expect('после повторного наката прямая запись закрыта',
  tst.try('RS1', $q$insert into weekly_ratings (workspace_id,week_key,direction,rater_uid,target_uid,score) values ('WKR','2026-W01','os_tech','RS1','RT2',9)$q$), 'error');
select tst.expect('версия схемы', (nova_schema_version() >= '20261032')::text, 'true');

-- ---------------------------------------------------------------------
select case when ok then '  OK  ' else 'FAIL  ' end || label || case when ok then '' else '  → ' || got end
from tst.results order by n;
select format('ПРОВЕРОК: %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
