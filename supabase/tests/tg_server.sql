-- Проверки 20261035_tg_server.sql: главный вход, разрешения технарям,
-- аренда. Запускать ПОСЛЕ desk_rows_rls.sql (хелперы tst.*). Свой
-- workspace WTG.
set client_min_messages = warning;
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
  perform set_config('request.jwt.claims', '', true);
  return 'error:' || sqlstate;
end;
$$;

insert into public.rows_workspaces (workspace_id, owner_id) values ('WTG', 'GO') on conflict do nothing;
insert into public.rows_members (workspace_id, uid, role, extra_roles) values
  ('WTG', 'GO', 'owner', '{}'),
  ('WTG', 'GS1', 'os', '{}'),
  ('WTG', 'GS2', 'os', '{}'),
  ('WTG', 'GT1', 'manager', '{}'),
  ('WTG', 'GT2', 'manager', '{}'),
  ('WTG', 'GTL', 'teamlead', '{}')
on conflict do nothing;
-- Раздел открыт ОС GS1 (полный доступ). GS2 и технари — нет.
insert into public.tg_access (workspace_id, uid, granted_by, granted_at) values ('WTG', 'GS1', 'GO', 1) on conflict do nothing;

-- ---------------------------------------------------------------------
-- Главный вход закрыт всем.
-- ---------------------------------------------------------------------
insert into public.tg_master (workspace_id, session, account_id, account_name, password, connected_by, connected_at)
values ('WTG', 'SECRET-SESSION', 777, 'Nova work', 'cloudpass', 'GO', now())
on conflict (workspace_id) do update set session = excluded.session, account_id = excluded.account_id,
  account_name = excluded.account_name, password = excluded.password;

select tst.expect('Owner не читает tg_master напрямую', tst.try('GO', $q$select * from tg_master$q$, true), 'deny');
select tst.expect('ОС не читает tg_master', tst.try('GS1', $q$select * from tg_master$q$, true), 'deny');
select tst.expect('анонимный ключ не читает tg_master', tst.try('__anon_key__', $q$select * from tg_master$q$, true), 'deny');
select tst.expect('никто не пишет tg_master', tst.try('GO', $q$update tg_master set session = 'x'$q$), 'error');
select tst.expect('tg_devices закрыта', tst.try('GO', $q$select * from tg_devices$q$, true), 'deny');
select tst.expect('tg_tech_grants напрямую закрыта', tst.try('GS1', $q$select * from tg_tech_grants$q$, true), 'deny');
select tst.expect('аренда не для API-ролей', tst.try('GO', $q$select tg_srv_lease('WTG','x',1000)$q$), 'error');

-- ---------------------------------------------------------------------
-- Статус аккаунта — без сессии и пароля.
-- ---------------------------------------------------------------------
select tst.expect('ОС с доступом видит «подключён» и имя',
  tst.val('GS1', $q$select (tg_account_status('WTG')->>'connected') || ':' || (tg_account_status('WTG')->>'name')$q$), 'true:Nova work');
select tst.expect('в статусе нет сессии и пароля',
  tst.val('GO', $q$select (tg_account_status('WTG')::text like '%SECRET%' or tg_account_status('WTG')::text like '%cloudpass%')::text$q$), 'false');
select tst.expect('статус: пароль сохранён',
  tst.val('GO', $q$select tg_account_status('WTG')->>'passwordSaved'$q$), 'true');
select tst.expect('технарь без разрешений статус не видит', tst.try('GT1', $q$select tg_account_status('WTG')$q$), 'error');
select tst.expect('посторонний статус не видит', tst.try('X', $q$select tg_account_status('WTG')$q$), 'error');

-- ---------------------------------------------------------------------
-- Кто я для функции.
-- ---------------------------------------------------------------------
select tst.expect('ОС с доступом — full',
  tst.val('GS1', $q$select (tg_edge_ctx('WTG')->>'full') || ':' || (tg_edge_ctx('WTG')->>'owner')$q$), 'true:false');
select tst.expect('Owner — full и owner (без строки доступа)',
  tst.val('GO', $q$select (tg_edge_ctx('WTG')->>'full') || ':' || (tg_edge_ctx('WTG')->>'owner')$q$), 'true:true');
select tst.expect('ОС без доступа — не full',
  tst.val('GS2', $q$select tg_edge_ctx('WTG')->>'full'$q$), 'false');
select tst.expect('посторонний — отказ', tst.try('X', $q$select tg_edge_ctx('WTG')$q$), 'error');
select tst.expect('без токена — отказ', tst.try('__anon_key__', $q$select tg_edge_ctx('WTG')$q$), 'error');

-- ---------------------------------------------------------------------
-- Разрешения технарям.
-- ---------------------------------------------------------------------
select tst.expect('технарь сам себе чат не открывает',
  tst.try('GT1', $q$select tg_grant_tech('WTG', 5001, 'GT1', '{"type":"user","id":"5001","accessHash":"99"}', 'Клиент')$q$), 'error');
select tst.expect('ОС без доступа к разделу не открывает',
  tst.try('GS2', $q$select tg_grant_tech('WTG', 5001, 'GT1', '{"type":"user","id":"5001","accessHash":"99"}', 'Клиент')$q$), 'error');
select tst.expect('Тимлид без доступа к разделу не открывает',
  tst.try('GTL', $q$select tg_grant_tech('WTG', 5001, 'GT1', '{"type":"user","id":"5001","accessHash":"99"}', 'Клиент')$q$), 'error');
select tst.expect('неверный адрес чата — отказ',
  tst.try('GS1', $q$select tg_grant_tech('WTG', 5001, 'GT1', '{"type":"user","id":"5001"}', 'Клиент')$q$), 'error');
select tst.expect('посторонний технарь — отказ',
  tst.try('GS1', $q$select tg_grant_tech('WTG', 5001, 'X', '{"type":"user","id":"5001","accessHash":"99"}', 'Клиент')$q$), 'error');
select tst.run('GS1', $q$select tg_grant_tech('WTG', 5001, 'GT1', '{"type":"user","id":"5001","accessHash":"99"}', 'Клиент Анна', 'osdesk_GS1', 'r1')$q$);
select tst.expect('ОС с доступом открыл чат технарю',
  (select tech_uid || ':' || title || ':' || granted_by from public.tg_tech_grants where workspace_id = 'WTG' and chat_id = 5001), 'GT1:Клиент Анна:GS1');
select tst.run('GO', $q$select tg_grant_tech('WTG', 6002, 'GT1', '{"type":"chat","id":"6002"}', 'Группа')$q$);
select tst.expect('Owner открывает чат-группу (без accessHash)',
  (select count(*)::text from public.tg_tech_grants where workspace_id = 'WTG' and tech_uid = 'GT1'), '2');
select tst.expect('технарь видит свои разрешения в ctx (с адресом)',
  tst.val('GT1', $q$select jsonb_array_length(tg_edge_ctx('WTG')->'grants')::text || ':' || (tg_edge_ctx('WTG')->>'full')$q$), '2:false');
select tst.expect('у другого технаря разрешений нет',
  tst.val('GT2', $q$select jsonb_array_length(tg_edge_ctx('WTG')->'grants')::text$q$), '0');
select tst.expect('технарь с разрешением видит статус аккаунта',
  tst.val('GT1', $q$select tg_account_status('WTG')->>'connected'$q$), 'true');
select tst.expect('tg_tech_workspaces у технаря',
  tst.val('GT1', $q$select string_agg(w, ',') from tg_tech_workspaces() w$q$), 'WTG');
select tst.expect('список: технарь видит только свои и без адреса',
  tst.val('GT1', $q$select (jsonb_array_length(tg_grants_list('WTG'))::text) || ':' || (tg_grants_list('WTG')::text like '%accessHash%')::text$q$), '2:false');
select tst.expect('список у другого технаря — отказ (нет разрешений)', tst.try('GT2', $q$select tg_grants_list('WTG')$q$), 'error');
select tst.expect('список у ОС по строке заказа',
  tst.val('GS1', $q$select jsonb_array_length(tg_grants_list('WTG', null, 'osdesk_GS1', 'r1'))::text$q$), '1');
select tst.expect('список у ОС по чату',
  tst.val('GS1', $q$select tg_grants_list('WTG', 6002)->0->>'techUid'$q$), 'GT1');
select tst.expect('технарь не снимает разрешение', tst.try('GT1', $q$select tg_revoke_tech('WTG', 5001, 'GT1')$q$), 'error');
select tst.run('GS1', $q$select tg_revoke_tech('WTG', 6002, 'GT1')$q$);
select tst.expect('ОС снял разрешение',
  (select count(*)::text from public.tg_tech_grants where workspace_id = 'WTG' and tech_uid = 'GT1'), '1');

-- Убранный из участников технарь теряет всё.
delete from public.rows_members where workspace_id = 'WTG' and uid = 'GT1';
select tst.expect('убранный технарь: ctx — отказ', tst.try('GT1', $q$select tg_edge_ctx('WTG')$q$), 'error');
select tst.expect('убранный технарь: workspace пропал', tst.val('GT1', $q$select count(*)::text from tg_tech_workspaces()$q$), '0');
insert into public.rows_members (workspace_id, uid, role, extra_roles) values ('WTG', 'GT1', 'manager', '{}') on conflict do nothing;

-- Снят доступ к разделу у ОС — больше не выдаёт.
delete from public.tg_access where workspace_id = 'WTG' and uid = 'GS1';
select tst.expect('ОС без доступа не выдаёт', tst.try('GS1', $q$select tg_grant_tech('WTG', 5003, 'GT2', '{"type":"user","id":"5003","accessHash":"1"}', 'x')$q$), 'error');
insert into public.tg_access (workspace_id, uid, granted_by, granted_at) values ('WTG', 'GS1', 'GO', 1) on conflict do nothing;

-- ---------------------------------------------------------------------
-- Аренда (от имени владельца базы, как service_role).
-- ---------------------------------------------------------------------
select tst.expect('аренда: первый берёт', tg_srv_lease('WTG', 'a', 5000)::text, 'true');
select tst.expect('аренда: второй ждёт', tg_srv_lease('WTG', 'b', 5000)::text, 'false');
select tst.expect('аренда: тот же продлевает', tg_srv_lease('WTG', 'a', 5000)::text, 'true');
select tg_srv_release('WTG', 'a');
select tst.expect('аренда: после отпуска берёт второй', tg_srv_lease('WTG', 'b', 5000)::text, 'true');
update public.tg_master set lease_until = clock_timestamp() - interval '1 second' where workspace_id = 'WTG';
select tst.expect('аренда: истёкшая переходит', tg_srv_lease('WTG', 'c', 5000)::text, 'true');
select tst.expect('аренда: для нового workspace', tg_srv_lease('W', 'z', 1000)::text, 'true');
select tst.expect('аренда: строка заведена', exists (select 1 from public.tg_master where workspace_id = 'W')::text, 'true');
select tg_srv_release('W', 'z');
delete from public.tg_master where workspace_id = 'W';

-- ---------------------------------------------------------------------
-- Повторный накат.
-- ---------------------------------------------------------------------
\ir ../migrations/20261035_tg_server.sql
select tst.expect('после повторного наката главный вход на месте',
  (select session from public.tg_master where workspace_id = 'WTG'), 'SECRET-SESSION');
select tst.expect('после повторного наката разрешение на месте',
  (select count(*)::text from public.tg_tech_grants where workspace_id = 'WTG'), '1');
select tst.expect('версия схемы', (nova_schema_version() >= '20261035')::text, 'true');

select case when ok then '  OK  ' else 'FAIL  ' end || label || case when ok then '' else '  → ' || got end
from tst.results order by n;
select format('ПРОВЕРОК: %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
