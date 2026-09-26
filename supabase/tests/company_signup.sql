-- Проверки 20261025_company_signup.sql (регистрация компаний по приглашению
-- и админка платформы). Запускать ПОСЛЕ desk_rows_rls.sql (W: O — Owner,
-- TL — Тимлид, T1 — технарь, X — посторонний).
-- Администратор платформы — PA (проверенная почта nurpro2005@gmail.com),
-- новый клиент — N1, ещё один — N2.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
truncate tst.results;

\ir ../migrations/20261023_tenants.sql
\ir ../migrations/20261025_company_signup.sql

delete from public.rows_members where workspace_id like 'ws_N1_%' or workspace_id like 'ws_N2_%' or workspace_id like 'ws_PA_%';
delete from public.rows_workspaces where workspace_id like 'ws_N1_%' or workspace_id like 'ws_N2_%' or workspace_id like 'ws_PA_%';
delete from public.platform_invites;

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

-- Токен с почтой (claims задаём целиком).
create or replace function tst.claims_mail(uid text, email text, verified boolean) returns text
language sql immutable as $$
  select json_build_object(
    'iss', 'https://securetoken.google.com/nurba-6e70d', 'aud', 'nurba-6e70d',
    'sub', uid, 'role', 'anon', 'email', email, 'email_verified', verified)::text
$$;

-- Выполнить от лица claims и ОСТАВИТЬ результат; ответ — текст или 'error:<код>'.
create or replace function tst.valc(claims text, sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', claims, true);
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

\set PA '''{"iss":"https://securetoken.google.com/nurba-6e70d","aud":"nurba-6e70d","sub":"PA","role":"anon","email":"nurpro2005@gmail.com","email_verified":true}'''

-- ---------- Кто администратор платформы ----------
select tst.expect('PA с проверенной почтой — администратор',
  tst.valc(:PA, $q$select nova_is_platform_admin()::text$q$), 'true');
select tst.expect('та же почта, но не проверена — нет',
  tst.valc(tst.claims_mail('PA', 'nurpro2005@gmail.com', false), $q$select nova_is_platform_admin()::text$q$), 'false');
select tst.expect('почта другого проекта Firebase — нет',
  tst.valc(json_build_object('iss', 'https://securetoken.google.com/other', 'aud', 'other', 'sub', 'PA',
    'role', 'anon', 'email', 'nurpro2005@gmail.com', 'email_verified', true)::text,
    $q$select nova_is_platform_admin()::text$q$), 'false');
select tst.expect('Owner компании W — не администратор платформы',
  tst.valc(tst.claims_mail('O', 'owner@example.com', true), $q$select nova_is_platform_admin()::text$q$), 'false');

-- ---------- Коды приглашения ----------
select tst.expect('чужой код завести нельзя',
  tst.valc(tst.claims_mail('O', 'owner@example.com', true), $q$select platform_invite_create('x', 14, null)::text$q$), 'error:42501');
select tst.expect('посторонний список кодов не видит',
  tst.valc(tst.claims_mail('X', 'x@example.com', true), $q$select count(*)::text from platform_invite_list()$q$), 'error:42501');
select tst.expect('прямого доступа к таблице кодов нет',
  tst.try('O', $q$select * from public.platform_invites$q$, true), 'error');

create temp table codes (k text, code text);
insert into codes select 'a', tst.valc(:PA, $q$select platform_invite_create('Студия А', 30, 5) ->> 'code'$q$);
insert into codes select 'b', tst.valc(:PA, $q$select platform_invite_create('Студия Б', 7, null) ->> 'code'$q$);
insert into codes select 'c', tst.valc(:PA, $q$select platform_invite_create('отзовём', 14, null) ->> 'code'$q$);
select tst.expect('код — 10 знаков без путаницы 0/O/1/I',
  (select bool_and(code ~ '^[A-HJ-NP-Z2-9]{10}$')::text from codes), 'true');
select tst.expect('коды разные', (select (count(distinct code) = 3)::text from codes), 'true');
select tst.expect('пробный период и места из кода',
  (select trial_days || '|' || coalesce(seats_limit::text, '-') || '|' || note from public.platform_invites where code = (select code from codes where k = 'a')),
  '30|5|Студия А');
select tst.expect('администратор видит список',
  tst.valc(:PA, $q$select count(*)::text from platform_invite_list()$q$), '3');
select tst.expect('отзыв кода',
  tst.valc(:PA, format($q$select (platform_invite_revoke(%L) ->> 'revoked_at') is not null$q$, (select code from codes where k = 'c'))), 'true');

-- ---------- Регистрация ----------
select tst.expect('без кода обычный человек не регистрирует',
  tst.val('N1', $q$select rows_register_company('ws_N1_abcdef', '', 'Моя')::text$q$), 'error:42501');
select tst.expect('чужой id не присвоить (не мой uid)',
  tst.val('N1', format($q$select rows_register_company('ws_N2_abcdef', %L, 'Чужая')::text$q$, (select code from codes where k = 'a'))), 'error:42501');
select tst.expect('id без суффикса — отказ',
  tst.val('N1', format($q$select rows_register_company('ws_N1_', %L, 'x')::text$q$, (select code from codes where k = 'a'))), 'error:42501');
select tst.expect('существующую компанию Nurba не присвоить',
  tst.val('N1', format($q$select rows_register_company('W', %L, 'x')::text$q$, (select code from codes where k = 'a'))), 'error:42501');
select tst.expect('отозванный код — отказ',
  tst.val('N1', format($q$select rows_register_company('ws_N1_abcdef', %L, 'x')::text$q$, (select code from codes where k = 'c'))), 'error:42501');
select tst.expect('несуществующий код — отказ',
  tst.val('N1', $q$select rows_register_company('ws_N1_abcdef', 'ZZZZZZZZZZ', 'x')::text$q$), 'error:42501');

select tst.expect('N1 регистрирует компанию по коду',
  tst.val('N1', format($q$select rows_register_company('ws_N1_abcdef', %L, '  Студия А  ') ->> 'status'$q$, lower((select code from codes where k = 'a')))), 'registered');
select tst.expect('строка компании: владелец, живое хранилище, пробный, 5 мест, имя',
  (select owner_id || '|' || live || '|' || plan || '|' || status || '|' || seats_limit || '|' || name
     from public.rows_workspaces where workspace_id = 'ws_N1_abcdef'),
  'N1|true|trial|trial|5|Студия А');
select tst.expect('пробный период ≈ 30 дней',
  (select (trial_until between now() + interval '29 days 23 hours' and now() + interval '30 days 1 hour')::text
     from public.rows_workspaces where workspace_id = 'ws_N1_abcdef'), 'true');
select tst.expect('владелец — участник с ролью owner',
  (select role from public.rows_members where workspace_id = 'ws_N1_abcdef' and uid = 'N1'), 'owner');
select tst.expect('код помечен использованным',
  (select used_by || '|' || workspace_id from public.platform_invites where code = (select code from codes where k = 'a')),
  'N1|ws_N1_abcdef');
select tst.expect('повтор той же регистрации — already',
  tst.val('N1', format($q$select rows_register_company('ws_N1_abcdef', %L, 'x') ->> 'status'$q$, (select code from codes where k = 'a'))), 'already');
select tst.expect('использованным кодом вторую компанию не завести',
  tst.val('N1', format($q$select rows_register_company('ws_N1_second', %L, 'x')::text$q$, (select code from codes where k = 'a'))), 'error:42501');
select tst.expect('N2 не забирает чужой использованный код',
  tst.val('N2', format($q$select rows_register_company('ws_N2_abcdef', %L, 'x')::text$q$, (select code from codes where k = 'a'))), 'error:42501');
select tst.expect('N2 по своему коду — да, без предела мест',
  tst.val('N2', format($q$select rows_register_company('ws_N2_zzz999', %L, 'Студия Б') ->> 'status'$q$, (select code from codes where k = 'b'))), 'registered');
select tst.expect('…предела мест нет', (select coalesce(seats_limit::text, '-') from public.rows_workspaces where workspace_id = 'ws_N2_zzz999'), '-');
select tst.expect('отозвать использованный код нельзя',
  tst.valc(:PA, format($q$select platform_invite_revoke(%L)::text$q$, (select code from codes where k = 'a'))), 'error:P0002');
select tst.expect('администратор регистрирует без кода — internal/active',
  tst.valc(:PA, $q$select (rows_register_company('ws_PA_mine01', '', 'Своя') ->> 'plan') || '|' || (select status from rows_workspaces where workspace_id = 'ws_PA_mine01')$q$),
  'internal|active');
select tst.expect('список кодов показывает название компании',
  tst.valc(:PA, format($q$select string_agg(i ->> 'workspace_name', ',') from platform_invite_list() i where i ->> 'code' = %L$q$, (select code from codes where k = 'a'))),
  'Студия А');

-- Строки столов новой компании пишет её владелец (хранилище живое).
insert into public.rows_page_acl (workspace_id, page_id, responsible_uid, created_by)
values ('ws_N1_abcdef', 'page_N1_d1', 'N1', 'N1') on conflict do nothing;
select tst.expect('владелец новой компании пишет строку стола',
  tst.try('N1', $q$insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, created_at, updated_at) values ('ws_N1_abcdef', 'page_N1_d1', '', 'r1', '{"name":"Клиент"}', 1, 1)$q$), 'ok:1');
select tst.run('N1', $q$insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, created_at, updated_at) values ('ws_N1_abcdef', 'page_N1_d1', '', 'r1', '{"name":"Клиент"}', 1, 1)$q$);
select tst.expect('посторонний в чужую компанию не пишет',
  tst.try('N2', $q$insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, created_at, updated_at) values ('ws_N1_abcdef', 'page_N1_d1', '', 'r2', '{}', 1, 1)$q$), 'error');
select tst.expect('Owner W не читает строки компании N1',
  tst.try('O', $q$select * from public.desk_rows where workspace_id = 'ws_N1_abcdef'$q$, true), 'ok:0');

-- ---------- Админка: тариф и статус ----------
select tst.expect('Owner компании свой тариф не меняет',
  tst.val('N1', $q$select platform_set_tenant('ws_N1_abcdef', 'active', null, null, null)::text$q$), 'error:42501');
select tst.expect('клиент напрямую строку компании не правит',
  tst.try('N1', $q$update public.rows_workspaces set status = 'active' where workspace_id = 'ws_N1_abcdef'$q$), 'deny');
select tst.expect('администратор видит список компаний',
  tst.valc(:PA, $q$select (count(*) >= 4)::text from platform_tenants()$q$), 'true');
select tst.expect('в списке — число участников',
  tst.valc(:PA, $q$select t ->> 'members' from platform_tenants() t where t ->> 'workspace_id' = 'ws_N1_abcdef'$q$), '1');
select tst.expect('Owner W список компаний не видит',
  tst.valc(tst.claims_mail('O', 'owner@example.com', true), $q$select count(*)::text from platform_tenants()$q$), 'error:42501');
select tst.expect('кривой статус — отказ',
  tst.valc(:PA, $q$select platform_set_tenant('ws_N1_abcdef', 'paid', null, null, null)::text$q$), 'error:22023');

-- Пробный период кончился — строки только читаются.
select tst.expect('администратор ставит пробный период в прошлое',
  tst.valc(:PA, $q$select platform_set_tenant('ws_N1_abcdef', null, null, now() - interval '1 day', null, true, false) ->> 'active_now'$q$), 'false');
select tst.expect('после конца пробного периода строку не записать',
  tst.try('N1', $q$insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, created_at, updated_at) values ('ws_N1_abcdef', 'page_N1_d1', '', 'r3', '{}', 1, 1)$q$), 'error');
select tst.expect('…и не изменить',
  tst.try('N1', $q$update public.desk_rows set cells = '{"name":"x"}' where workspace_id = 'ws_N1_abcdef' and id = 'r1'$q$), 'deny');
select tst.expect('…до конца пробного та же правка проходила бы (контроль)',
  (select count(*)::text from public.desk_rows where workspace_id = 'ws_N1_abcdef' and id = 'r1'), '1');
select tst.expect('…но прочитать можно',
  tst.try('N1', $q$select * from public.desk_rows where workspace_id = 'ws_N1_abcdef'$q$, true), 'ok:1');
select tst.expect('продление +14 дней — снова пишет',
  tst.valc(:PA, $q$select platform_set_tenant('ws_N1_abcdef', null, null, now() + interval '14 days', null, true, false) ->> 'active_now'$q$), 'true');
select tst.expect('…запись снова проходит',
  tst.try('N1', $q$insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, created_at, updated_at) values ('ws_N1_abcdef', 'page_N1_d1', '', 'r4', '{}', 1, 1)$q$), 'ok:1');
select tst.expect('приостановка',
  tst.valc(:PA, $q$select platform_set_tenant('ws_N1_abcdef', 'suspended', null, null, null) ->> 'status'$q$), 'suspended');
select tst.expect('приостановленная компания не пишет',
  tst.try('N1', $q$insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, created_at, updated_at) values ('ws_N1_abcdef', 'page_N1_d1', '', 'r5', '{}', 1, 1)$q$), 'error');
select tst.expect('оплачено: active + тариф + 10 мест',
  tst.valc(:PA, $q$select (platform_set_tenant('ws_N1_abcdef', 'active', 'basic', null, 10, false, true) ->> 'seats_limit')$q$), '10');
select tst.expect('…active пишет даже с прошедшей датой пробного',
  tst.try('N1', $q$insert into public.desk_rows (workspace_id, page_id, tab_id, id, cells, created_at, updated_at) values ('ws_N1_abcdef', 'page_N1_d1', '', 'r6', '{}', 1, 1)$q$), 'ok:1');
select tst.expect('предел мест снимается',
  tst.valc(:PA, $q$select coalesce(platform_set_tenant('ws_N1_abcdef', null, null, null, null, false, true) ->> 'seats_limit', '-')$q$), '-');

-- Компания Nurba (W) не задета: статус active по умолчанию, строки пишутся.
select tst.expect('компания W по-прежнему пишет строки',
  tst.try('O', $q$update public.desk_rows set cells = cells where workspace_id = 'W'$q$), 'ok');

-- ---------- Название ----------
select tst.expect('Owner меняет название своей компании',
  tst.val('N2', $q$select rows_set_tenant_name('ws_N2_zzz999', 'Студия Б+')::text$q$), '');
select tst.expect('…записано', (select name from public.rows_workspaces where workspace_id = 'ws_N2_zzz999'), 'Студия Б+');
select tst.expect('чужой Owner название не меняет',
  tst.val('N1', $q$select rows_set_tenant_name('ws_N2_zzz999', 'x')::text$q$), 'error:42501');

-- ---------- Повторный накат ----------
\ir ../migrations/20261025_company_signup.sql
select tst.expect('после наката коды и компании на месте',
  (select (count(*) = 3)::text from public.platform_invites), 'true');
select tst.expect('версия схемы не старее 20261025', (public.nova_schema_version() >= '20261025')::text, 'true');

select label, got from tst.results where not ok;
select format('ПРОВЕРОК (регистрация компаний): %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
