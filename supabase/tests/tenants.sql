-- Проверки 20261023_tenants.sql (компания-арендатор) и
-- 20261024_storage_policies.sql (файлы по токену). Запускать ПОСЛЕ
-- desk_rows_rls.sql (W: O — Owner, TL — Тимлид, T1 — технарь, V — Viewer,
-- X — посторонний). Здесь же заводится вторая компания TW2 (Owner TO2,
-- технарь TZ) — проверки «компания A не дотягивается до компании B».
\set ON_ERROR_STOP 1
set client_min_messages = warning;
truncate tst.results;

-- Мини-схема storage, как у Supabase (на стенде её нет).
create schema if not exists storage;
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null,
  name text not null
);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated;
grant select, insert, update, delete on storage.objects to anon, authenticated;
delete from storage.objects;

\ir ../migrations/20261023_tenants.sql
\ir ../migrations/20261024_storage_policies.sql

insert into public.rows_workspaces (workspace_id, owner_id, live) values ('TW2', 'TO2', true) on conflict do nothing;
insert into public.rows_members (workspace_id, uid, role) values ('TW2', 'TO2', 'owner'), ('TW2', 'TZ', 'manager')
  on conflict do nothing;

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

-- ---------- Этап 1: умолчания, как было зашито в коде ----------
select tst.expect('умолчание: пояс Алматы', (select timezone from public.rows_workspaces where workspace_id = 'W'), 'Asia/Almaty');
select tst.expect('умолчание: тенге', (select currency from public.rows_workspaces where workspace_id = 'W'), 'KZT');
select tst.expect('умолчание: ru-KZ', (select locale from public.rows_workspaces where workspace_id = 'W'), 'ru-KZ');
select tst.expect('умолчание: тариф internal, активен', (select plan || '|' || status from public.rows_workspaces where workspace_id = 'W'), 'internal|active');
select tst.expect('соль звонков у каждой компании своя, 32 hex',
  (select (count(distinct ring_salt) = 2 and bool_and(ring_salt ~ '^[0-9a-f]{32}$'))::text from public.rows_workspaces where workspace_id in ('W', 'TW2')), 'true');
select tst.expect('rows_tz по умолчанию', public.rows_tz('W'), 'Asia/Almaty');
select tst.expect('rows_tz у неизвестного workspace — Алматы', public.rows_tz('NOPE'), 'Asia/Almaty');

-- ---------- Регион пишет только Owner ----------
select tst.expect('Owner ставит регион', tst.val('O', $q$select rows_set_tenant_region('W', 'Europe/Moscow', 'rub', 'ru-RU') ->> 'currency'$q$), 'RUB');
select tst.expect('…он записан', (select timezone || '|' || currency || '|' || locale from public.rows_workspaces where workspace_id = 'W'), 'Europe/Moscow|RUB|ru-RU');
select tst.expect('rows_tz берёт пояс компании', public.rows_tz('W'), 'Europe/Moscow');
select tst.expect('Тимлид регион не меняет', tst.val('TL', $q$select rows_set_tenant_region('W', 'Asia/Almaty', 'KZT', 'ru-KZ')::text$q$), 'error:42501');
select tst.expect('технарь регион не меняет', tst.val('T1', $q$select rows_set_tenant_region('W', 'Asia/Almaty', 'KZT', 'ru-KZ')::text$q$), 'error:42501');
select tst.expect('посторонний регион не меняет', tst.val('X', $q$select rows_set_tenant_region('W', 'Asia/Almaty', 'KZT', 'ru-KZ')::text$q$), 'error:42501');
select tst.expect('без токена — отказ', tst.val('__anon_key__', $q$select rows_set_tenant_region('W', 'Asia/Almaty', 'KZT', 'ru-KZ')::text$q$), 'error:42501');
select tst.expect('Owner чужой компании — отказ', tst.val('TO2', $q$select rows_set_tenant_region('W', 'Asia/Almaty', 'KZT', 'ru-KZ')::text$q$), 'error:42501');
select tst.expect('неизвестный пояс — отказ', tst.val('O', $q$select rows_set_tenant_region('W', 'Mars/Olympus', 'KZT', 'ru-KZ')::text$q$), 'error:22023');
select tst.expect('кривая валюта — отказ', tst.val('O', $q$select rows_set_tenant_region('W', 'Asia/Almaty', 'TENGE', 'ru-KZ')::text$q$), 'error:22023');
select tst.expect('кривой язык — отказ', tst.val('O', $q$select rows_set_tenant_region('W', 'Asia/Almaty', 'KZT', 'русский')::text$q$), 'error:22023');
select tst.expect('пустые значения — умолчания', tst.val('O', $q$select rows_set_tenant_region('W', '', null, ' ')::text$q$), '{"locale": "ru-KZ", "currency": "KZT", "timezone": "Asia/Almaty"}');

-- ---------- Тариф клиенту закрыт ----------
select tst.expect('Owner не меняет себе тариф', tst.try('O', $q$update rows_workspaces set plan = 'pro' where workspace_id = 'W'$q$), 'deny');
select tst.expect('Owner не продлевает себе пробный период', tst.try('O', $q$update rows_workspaces set trial_until = now() + interval '1 year'$q$), 'deny');
select tst.expect('Owner не снимает предел мест', tst.try('O', $q$update rows_workspaces set seats_limit = null$q$), 'deny');
do $$ begin
  begin
    update public.rows_workspaces set status = 'banana' where workspace_id = 'TW2';
    insert into tst.results (label, ok, got) values ('неизвестный статус — отказ', false, 'прошёл');
  exception when check_violation then
    insert into tst.results (label, ok, got) values ('неизвестный статус — отказ', true, 'check');
  end;
end $$;

-- ---------- Изоляция: строку чужой компании не видно ----------
select tst.expect('участник видит свою компанию', tst.val('T1', $q$select count(*)::text from rows_workspaces$q$), '1');
select tst.expect('…и её соль', tst.val('T1', $q$select (ring_salt = (select ring_salt from rows_workspaces where workspace_id = 'W'))::text from rows_workspaces where workspace_id = 'W'$q$), 'true');
select tst.expect('соль чужой компании не видна', tst.val('T1', $q$select coalesce(max(ring_salt), 'нет') from rows_workspaces where workspace_id = 'TW2'$q$), 'нет');
select tst.expect('посторонний не видит ни одной компании', tst.val('X', $q$select count(*)::text from rows_workspaces$q$), '0');
select tst.expect('анонимный ключ не видит соль', tst.val('__anon_key__', $q$select count(*)::text from rows_workspaces$q$), '0');
select tst.expect('чужой Owner не видит W', tst.val('TO2', $q$select string_agg(workspace_id, ',') from rows_workspaces$q$), 'TW2');

-- ---------- Этап 4: файлы по токену ----------
select tst.expect('участник кладёт вложение в свою папку', tst.try('T1', $q$insert into storage.objects (bucket_id, name) values ('row-files', 'W/page1/row1/a_file.pdf')$q$), 'ok:1');
select tst.expect('в папку чужой компании — отказ', tst.try('T1', $q$insert into storage.objects (bucket_id, name) values ('row-files', 'TW2/page1/row1/a_file.pdf')$q$), 'error');
select tst.expect('посторонний не кладёт', tst.try('X', $q$insert into storage.objects (bucket_id, name) values ('row-files', 'W/page1/row1/a_file.pdf')$q$), 'error');
select tst.expect('анонимный ключ без токена не кладёт', tst.try('__anon_key__', $q$insert into storage.objects (bucket_id, name) values ('row-files', 'W/page1/row1/a_file.pdf')$q$), 'error');
select tst.expect('чужой проект Firebase не кладёт', tst.try('__forged__:T1', $q$insert into storage.objects (bucket_id, name) values ('row-files', 'W/page1/row1/a_file.pdf')$q$), 'error');
select tst.expect('в корень бакета — отказ', tst.try('T1', $q$insert into storage.objects (bucket_id, name) values ('row-files', 'W')$q$), 'error');
select tst.expect('другой бакет этими политиками не открыт', tst.try('T1', $q$insert into storage.objects (bucket_id, name) values ('other', 'W/x.pdf')$q$), 'error');
select tst.expect('аватар — свой uid', tst.try('T1', $q$insert into storage.objects (bucket_id, name) values ('row-files', 'W/avatars/T1/a.png')$q$), 'ok:1');
select tst.expect('аватар за другого — отказ', tst.try('T1', $q$insert into storage.objects (bucket_id, name) values ('row-files', 'W/avatars/TL/a.png')$q$), 'error');
select tst.expect('звук заказа — Owner', tst.try('O', $q$insert into storage.objects (bucket_id, name) values ('row-files', 'W/sounds/order-1.mp3')$q$), 'ok:1');
select tst.expect('звук заказа технарём — отказ', tst.try('T1', $q$insert into storage.objects (bucket_id, name) values ('row-files', 'W/sounds/order-1.mp3')$q$), 'error');
select tst.expect('обложка стола — участник', tst.try('V', $q$insert into storage.objects (bucket_id, name) values ('row-files', 'W/covers/page1/c.webp')$q$), 'ok:1');

insert into storage.objects (bucket_id, name) values
  ('row-files', 'W/page1/row1/keep.pdf'), ('row-files', 'TW2/page9/row9/secret.pdf'), ('row-files', 'W/avatars/TL/tl.png');
select tst.expect('чужой компании файл не удалить', tst.try('T1', $q$delete from storage.objects where name = 'TW2/page9/row9/secret.pdf'$q$), 'deny');
select tst.expect('…и не переименовать к себе', tst.try('T1', $q$update storage.objects set name = 'W/stolen.pdf' where name = 'TW2/page9/row9/secret.pdf'$q$), 'deny');
select tst.expect('свой файл участник удаляет', tst.try('T1', $q$delete from storage.objects where name = 'W/page1/row1/keep.pdf'$q$), 'ok:1');
select tst.expect('чужой аватар не удалить', tst.try('T1', $q$delete from storage.objects where name = 'W/avatars/TL/tl.png'$q$), 'deny');
select tst.expect('свой файл не вынести в чужую компанию', tst.try('T1', $q$update storage.objects set name = 'TW2/page9/x.pdf' where name = 'W/page1/row1/keep.pdf'$q$), 'error');
select tst.expect('список: видны только файлы своей компании',
  tst.val('TZ', $q$select string_agg(name, ',' order by name) from storage.objects$q$), 'TW2/page9/row9/secret.pdf');
create temp table tst_t3 as select * from public.rows_members where workspace_id = 'W' and uid = 'T3';
select tst.expect('T3 пока участник — кладёт', tst.try('T3', $q$insert into storage.objects (bucket_id, name) values ('row-files', 'W/x/y.pdf')$q$), 'ok:1');
delete from public.rows_members where workspace_id = 'W' and uid = 'T3';
select tst.expect('убранный из участников — отказ', tst.try('T3', $q$insert into storage.objects (bucket_id, name) values ('row-files', 'W/x/y.pdf')$q$), 'error');
insert into public.rows_members select * from tst_t3;

-- ---------- Список политик — только Owner ----------
select tst.expect('Owner видит политики бакета', tst.val('O', $q$select count(*)::text from nova_storage_policies('W') where policy_name like 'nova_rowfiles_%'$q$), '4');
select tst.expect('Тимлиду список политик закрыт', tst.val('TL', $q$select count(*)::text from nova_storage_policies('W')$q$), 'error:42501');
select tst.expect('чужой Owner — отказ', tst.val('TO2', $q$select count(*)::text from nova_storage_policies('W')$q$), 'error:42501');

-- ---------- Повторный накат ----------
\ir ../migrations/20261023_tenants.sql
\ir ../migrations/20261024_storage_policies.sql
select tst.expect('после наката соль прежняя (не пересоздаётся)',
  (select (count(distinct ring_salt) = 2)::text from public.rows_workspaces where workspace_id in ('W', 'TW2')), 'true');
select tst.expect('версия схемы не старее 20261023', (public.nova_schema_version() >= '20261023')::text, 'true');

select label, got from tst.results where not ok;
select format('ПРОВЕРОК (компании и файлы): %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
