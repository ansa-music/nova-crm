-- Проверки 20261037_tg_courier.sql: поля служебного бота в tg_master.
-- Запускать ПОСЛЕ desk_rows_rls.sql (хелперы tst.*) и tg_server.sql
-- (workspace WTG и его главный вход).
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

select tst.expect('поля бота есть',
  (select count(*)::text from information_schema.columns
   where table_schema = 'public' and table_name = 'tg_master'
     and column_name in ('bot_token', 'bot_id', 'bot_username', 'courier_chat_id')), '4');

-- Функция `tg` пишет их service-ключом (здесь — от имени владельца базы).
insert into public.tg_master (workspace_id) values ('WTG') on conflict do nothing;
update public.tg_master
   set bot_token = '777000:SECRET-BOT-TOKEN', bot_id = 777, bot_username = 'nova_files_bot', courier_chat_id = 555
 where workspace_id = 'WTG';

-- Токен бота не читает никто, кроме функции: ни Owner, ни ОС, ни технарь с разрешением.
select tst.expect('Owner: токен бота не читается', tst.try('GO', $q$select bot_token from public.tg_master$q$), 'error');
select tst.expect('ОС: токен бота не читается', tst.try('GS1', $q$select bot_token from public.tg_master$q$), 'error');
select tst.expect('технарь: токен бота не читается', tst.try('GT2', $q$select bot_token from public.tg_master$q$), 'error');
select tst.expect('аноним: токен бота не читается', tst.try('__anon_key__', $q$select bot_token from public.tg_master$q$), 'error');
select tst.expect('Owner: id группы не читается', tst.try('GO', $q$select courier_chat_id from public.tg_master$q$), 'error');
select tst.expect('Owner: бота не переписать', tst.try('GO', $q$update public.tg_master set bot_token = 'x'$q$), 'error');

-- Статус аккаунта (RPC для всех, кому открыт раздел) токена не отдаёт.
select tst.expect('tg_account_status без токена бота',
  (coalesce(tst.val('GO', $q$select tg_account_status('WTG')::text$q$), '') like '%SECRET-BOT-TOKEN%')::text, 'false');

-- Повторный накат ничего не стирает.
\ir ../migrations/20261037_tg_courier.sql
select tst.expect('после повторного наката бот на месте',
  (select bot_username || ':' || courier_chat_id from public.tg_master where workspace_id = 'WTG'), 'nova_files_bot:555');
select tst.expect('после повторного наката главный вход на месте',
  (select coalesce(session, 'нет') from public.tg_master where workspace_id = 'WTG'), 'SECRET-SESSION');
select tst.expect('версия схемы', (nova_schema_version() >= '20261037')::text, 'true');

select case when ok then '  OK  ' else 'FAIL  ' end || label || case when ok then '' else '  → ' || got end
from tst.results order by n;
select format('ПРОВЕРОК: %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
