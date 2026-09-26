-- Проверки 20261028_platform_leads.sql (заявки на подключение и именные
-- коды). Запускать ПОСЛЕ desk_rows_rls.sql. Администратор — ROOT (владелец
-- основной компании), заявители — L1, L2, посторонний — X.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
truncate tst.results;

\ir ../migrations/20261023_tenants.sql
\ir ../migrations/20261025_company_signup.sql
\ir ../migrations/20261026_platform_admin.sql
\ir ../migrations/20261028_platform_leads.sql

delete from public.rows_members where workspace_id like 'ws_L1_%' or workspace_id like 'ws_L2_%';
delete from public.rows_workspaces where workspace_id like 'ws_L1_%' or workspace_id like 'ws_L2_%';
delete from public.platform_leads;
delete from public.platform_invites;
insert into public.rows_workspaces (workspace_id, owner_id, live) values ('ws_zokgevudmsbfnq88', 'ROOT', true)
  on conflict (workspace_id) do update set owner_id = 'ROOT';

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
  perform set_config('request.jwt.claims', '', true);
  return 'error:' || sqlstate;
end;
$$;

-- ---------- Заявка ----------
select tst.expect('без входа заявку не подать',
  tst.val('__anon_key__', $q$select platform_lead_submit('Студия', 'тг', '', '', '')::text$q$), 'error:42501');
select tst.expect('короткое название — отказ',
  tst.val('L1', $q$select platform_lead_submit('С', 'тг', '', '', '')::text$q$), 'error:22023');
select tst.expect('L1 подаёт заявку',
  tst.val('L1', $q$select platform_lead_submit('  Студия Л1  ', '@l1', 'хотим попробовать', 'l1@x.io', 'Лена') ->> 'status'$q$), 'pending');
select tst.expect('…записана с обрезкой пробелов',
  (select company || '|' || contact || '|' || email from public.platform_leads where uid = 'L1'), 'Студия Л1|@l1|l1@x.io');
select tst.expect('повтор — правит ту же заявку',
  tst.val('L1', $q$select platform_lead_submit('Студия Л1 новая', '@l1', '', '', '') ->> 'company'$q$), 'Студия Л1 новая');
select tst.expect('заявок по-прежнему одна', (select count(*)::text from public.platform_leads), '1');
select tst.expect('свой статус: заявка ждёт, кода нет',
  tst.val('L1', $q$select (platform_my_status() -> 'lead' ->> 'status') || '|' || coalesce(platform_my_status() ->> 'invite', '-')$q$), 'pending|-');
select tst.expect('чужой статус не виден: у L2 пусто',
  tst.val('L2', $q$select coalesce(platform_my_status() ->> 'lead', '-')$q$), '-');
select tst.expect('прямого доступа к таблице заявок нет',
  tst.try('L1', $q$select * from public.platform_leads$q$, true), 'error');
select tst.expect('посторонний список заявок не читает',
  tst.val('X', $q$select count(*)::text from platform_leads_list()$q$), 'error:42501');
select tst.expect('заявитель сам себе не одобряет',
  tst.val('L1', $q$select platform_lead_resolve('L1', true, 14, null)::text$q$), 'error:42501');

-- ---------- Администратор ----------
select tst.expect('администратор видит заявку',
  tst.val('ROOT', $q$select l ->> 'company' from platform_leads_list() l where l ->> 'uid' = 'L1'$q$), 'Студия Л1 новая');
select tst.expect('несуществующую заявку не решить',
  tst.val('ROOT', $q$select platform_lead_resolve('NOPE', true, 14, null)::text$q$), 'error:P0002');
select tst.val('L2', $q$select platform_lead_submit('Студия Л2', '', '', '', '')::text$q$);
select tst.expect('отклонить',
  tst.val('ROOT', $q$select platform_lead_resolve('L2', false, null, null) ->> 'status'$q$), 'rejected');
select tst.expect('после отказа можно подать снова',
  tst.val('L2', $q$select platform_lead_submit('Студия Л2 ещё раз', '', '', '', '') ->> 'status'$q$), 'pending');
select tst.expect('одобрить: код на имя L1, 30 дней, 5 мест',
  tst.val('ROOT', $q$select (platform_lead_resolve('L1', true, 30, 5) -> 'invite' ->> 'for_uid') || '|' || (platform_my_status() ->> 'lead' is not null)::text$q$), 'L1|false');
select tst.expect('заявка одобрена и знает код',
  (select status || '|' || (invite_code = (select code from public.platform_invites where for_uid = 'L1'))::text from public.platform_leads where uid = 'L1'), 'approved|true');
select tst.expect('код именной: 30 дней, 5 мест',
  (select trial_days || '|' || seats_limit from public.platform_invites where for_uid = 'L1'), '30|5');
select tst.expect('одобрить дважды нельзя',
  tst.val('ROOT', $q$select platform_lead_resolve('L1', true, 14, null)::text$q$), 'error:22023');
select tst.expect('одобренную заявку заявитель не переписывает',
  tst.val('L1', $q$select platform_lead_submit('Другое', '', '', '', '')::text$q$), 'error:22023');
select tst.expect('свой статус: код виден заявителю',
  tst.val('L1', $q$select platform_my_status() -> 'invite' ->> 'code'$q$), (select code from public.platform_invites where for_uid = 'L1'));
select tst.expect('в списке кодов у администратора — for_uid',
  tst.val('ROOT', $q$select i ->> 'for_uid' from platform_invite_list() i where i ->> 'for_uid' = 'L1'$q$), 'L1');

-- ---------- Именной код при регистрации ----------
select tst.expect('чужой именной код не подходит L2',
  tst.val('L2', format($q$select rows_register_company('ws_L2_abcdef', %L, 'x')::text$q$, (select code from public.platform_invites where for_uid = 'L1'))), 'error:42501');
select tst.expect('L1 регистрирует компанию своим кодом',
  tst.val('L1', format($q$select rows_register_company('ws_L1_abcdef', %L, 'Студия Л1') ->> 'status'$q$, (select code from public.platform_invites where for_uid = 'L1'))), 'registered');
select tst.expect('…5 мест и trial',
  (select status || '|' || seats_limit from public.rows_workspaces where workspace_id = 'ws_L1_abcdef'), 'trial|5');
select tst.expect('после регистрации кода на имя L1 больше нет',
  tst.val('L1', $q$select coalesce(platform_my_status() ->> 'invite', '-')$q$), '-');
select tst.expect('список заявок показывает компанию',
  tst.val('ROOT', $q$select l ->> 'workspace_id' from platform_leads_list() l where l ->> 'uid' = 'L1'$q$), 'ws_L1_abcdef');
select tst.expect('обычный код (без имени) по-прежнему годится любому',
  tst.val('L2', format($q$select rows_register_company('ws_L2_abcdef', %L, 'Л2') ->> 'status'$q$,
    tst.val('ROOT', $q$select platform_invite_create('общий', 14, null) ->> 'code'$q$))), 'registered');
select tst.expect('ожидающие заявки идут первыми',
  tst.val('ROOT', $q$select l ->> 'uid' from platform_leads_list() l limit 1$q$), 'L2');

-- ---------- Повторный накат ----------
\ir ../migrations/20261028_platform_leads.sql
select tst.expect('после наката заявки на месте', (select count(*)::text from public.platform_leads), '2');
select tst.expect('версия схемы не старее 20261028', (public.nova_schema_version() >= '20261028')::text, 'true');

select label, got from tst.results where not ok;
select format('ПРОВЕРОК (заявки на подключение): %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
