-- Проверки 20261047_access_docs.sql: запросы на просмотр, наблюдатели,
-- ключ доступа и заявки по ключу — в Postgres.
-- Запускать ПОСЛЕ desk_rows_rls.sql (workspace W: O — создатель, TL — Тимлид,
-- T1..T3 — технари, OS1/OS2 — ОС, AD — Admin, V — Viewer, OBS — наблюдатель
-- из копии прав, X — посторонний; столы P1 (ответственный T1), P2 (T2)).
\set ON_ERROR_STOP 1
set client_min_messages = warning;
truncate tst.results;
\ir ../migrations/20261047_access_docs.sql

create or replace function tst.jval(uid text, sql text) returns text language plpgsql as $$
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

-- Выданный (не создатель) Owner — для разницы «Owner» / «создатель».
insert into public.rows_members (workspace_id, uid, role, extra_roles) values ('W', 'O2', 'owner', '{}')
on conflict do nothing;
delete from public.access_docs where workspace_id = 'W';
delete from public.rows_owner_only where workspace_id = 'W';

select tst.expect('версия схемы', public.nova_schema_version(), '20261047');
select tst.expect('хеш ключа — sha256 от «ws:ключ» в hex',
  public.access_key_hash('W', '21122005'), encode(sha256('W:21122005'::bytea), 'hex'));

-- ---------------------------------------------------------------------
-- Запросы на просмотр.
-- ---------------------------------------------------------------------
select tst.expect('технарь просит просмотр чужого стола',
  tst.jval('T2', $q$select jsonb_array_length(access_write('W', '[{"kind":"viewreq","id":"vr_1","op":"set","data":{"id":"vr_1","workspaceId":"W","pageId":"P1","pageName":"Стол","fromUid":"O","fromName":"Таня","toUid":"OS1","status":"approved","createdAt":1,"updatedAt":1}}]'))::text$q$), '1');
select tst.expect('…адресат — ответственный из копии прав, не со слов клиента',
  (select data ->> 'toUid' from public.access_docs where kind = 'viewreq' and id = 'vr_1'), 'T1');
select tst.expect('…проситель — из токена, статус pending',
  (select (data ->> 'fromUid') || '|' || (data ->> 'status') || '|' || (data ->> 'workspaceId') from public.access_docs where kind = 'viewreq' and id = 'vr_1'), 'T2|pending|W');
select tst.expect('повторная просьба того же стола — та же заявка',
  tst.jval('T2', $q$select (access_write('W', '[{"kind":"viewreq","id":"vr_dup","op":"set","data":{"pageId":"P1","fromName":"Таня","createdAt":2}}]') -> 0 ->> 'id')$q$), 'vr_1');
select tst.expect('…второй документ не заведён',
  (select count(*)::text from public.access_docs where kind = 'viewreq' and data ->> 'fromUid' = 'T2' and data ->> 'pageId' = 'P1'), '1');
select tst.expect('посторонний не просит', tst.try('X', $q$select access_write('W', '[{"kind":"viewreq","id":"vr_x","op":"set","data":{"pageId":"P1"}}]')$q$), 'error');
select tst.expect('стол без копии прав — отказ', tst.jval('T2', $q$select access_write('W', '[{"kind":"viewreq","id":"vr_9","op":"set","data":{"pageId":"P9"}}]')::text$q$), 'error:22023');
select tst.expect('без стола — отказ', tst.jval('T2', $q$select access_write('W', '[{"kind":"viewreq","id":"vr_9","op":"set","data":{"pageName":"x"}}]')::text$q$), 'error:22023');
insert into public.rows_owner_only (workspace_id, page_id, set_at, set_by) values ('W', 'P2', 1, 'O');
select tst.expect('стол «только для Owner» не просят', tst.jval('T1', $q$select access_write('W', '[{"kind":"viewreq","id":"vr_oo","op":"set","data":{"pageId":"P2"}}]')::text$q$), 'error:42501');
delete from public.rows_owner_only where workspace_id = 'W';
select tst.expect('лишнее поле у запроса — отказ', tst.jval('T3', $q$select access_write('W', '[{"kind":"viewreq","id":"vr_bad","op":"set","data":{"pageId":"P1","role":"owner"}}]')::text$q$), 'error:22023');

select tst.expect('проситель читает свою заявку', tst.try('T2', $q$select * from access_docs where kind = 'viewreq'$q$, true), 'ok:1');
select tst.expect('ответственный читает заявку к себе', tst.try('T1', $q$select * from access_docs where kind = 'viewreq'$q$, true), 'ok:1');
select tst.expect('чужой технарь заявку не видит', tst.try('T3', $q$select * from access_docs where kind = 'viewreq'$q$, true), 'ok:0');
select tst.expect('Тимлид чужую заявку не видит', tst.try('TL', $q$select * from access_docs where kind = 'viewreq'$q$, true), 'ok:0');
select tst.expect('посторонний не читает', tst.try('X', $q$select * from access_docs$q$, true), 'ok:0');

select tst.expect('чужой технарь не решает', tst.jval('T3', $q$select access_write('W', '[{"kind":"viewreq","id":"vr_1","op":"merge","data":{"status":"approved"}}]')::text$q$), 'error:42501');
select tst.expect('сам проситель не решает', tst.jval('T2', $q$select access_write('W', '[{"kind":"viewreq","id":"vr_1","op":"merge","data":{"status":"approved"}}]')::text$q$), 'error:42501');
select tst.expect('решение с лишним полем — отказ', tst.jval('T1', $q$select access_write('W', '[{"kind":"viewreq","id":"vr_1","op":"merge","data":{"status":"approved","pageName":"x"}}]')::text$q$), 'error:22023');
select tst.expect('неверный статус — отказ', tst.jval('T1', $q$select access_write('W', '[{"kind":"viewreq","id":"vr_1","op":"merge","data":{"status":"pending"}}]')::text$q$), 'error:22023');
select tst.expect('ответственный одобряет', tst.jval('T1', $q$select jsonb_array_length(access_write('W', '[{"kind":"viewreq","id":"vr_1","op":"merge","data":{"status":"approved","updatedAt":5}}]'))::text$q$), '1');
select tst.expect('…статус approved, остальное на месте',
  (select (data ->> 'status') || '|' || (data ->> 'fromUid') || '|' || (data ->> 'pageId') from public.access_docs where kind = 'viewreq' and id = 'vr_1'), 'approved|T2|P1');
select tst.expect('после решения просьба того же стола — новая заявка',
  tst.jval('T2', $q$select (access_write('W', '[{"kind":"viewreq","id":"vr_2","op":"set","data":{"pageId":"P1"}}]') -> 0 ->> 'id')$q$), 'vr_2');
select tst.expect('Owner отклоняет чужую заявку', tst.jval('O', $q$select (access_write('W', '[{"kind":"viewreq","id":"vr_2","op":"merge","data":{"status":"denied"}}]') -> 0 -> 'data' ->> 'status')$q$), 'denied');
select tst.expect('несуществующую заявку не решить', tst.jval('O', $q$select access_write('W', '[{"kind":"viewreq","id":"vr_none","op":"merge","data":{"status":"denied"}}]')::text$q$), 'error:22023');
select tst.expect('ответственный заявку не удаляет', tst.jval('T1', $q$select access_write('W', '[{"kind":"viewreq","id":"vr_1","op":"delete"}]')::text$q$), 'error:42501');
select tst.expect('Owner удаляет', tst.jval('O', $q$select (access_write('W', '[{"kind":"viewreq","id":"vr_1","op":"delete"}]') -> 0 ->> 'deleted')$q$), 'true');
select tst.expect('…удаление мягкое', (select deleted::text from public.access_docs where kind = 'viewreq' and id = 'vr_1'), 'true');

-- ---------------------------------------------------------------------
-- Наблюдатели.
-- ---------------------------------------------------------------------
select tst.expect('технарь наблюдателя не выдаёт', tst.jval('T1', $q$select access_write('W', '[{"kind":"observer","id":"T2","op":"set","data":{"label":"x"}}]')::text$q$), 'error:42501');
select tst.expect('Тимлид наблюдателя не выдаёт', tst.jval('TL', $q$select access_write('W', '[{"kind":"observer","id":"T2","op":"set","data":{"label":"x"}}]')::text$q$), 'error:42501');
select tst.expect('до выдачи технарь чужой стол не читает', tst.try('T3', $q$select * from desk_rows where page_id = 'P2'$q$, true), 'ok:0');
select tst.expect('Owner выдаёт', tst.jval('O', $q$select (access_write('W', '[{"kind":"observer","id":"T3","op":"set","data":{"uid":"T9","label":"Таня","grantedBy":"T9"}}]') -> 0 -> 'data' ->> 'grantedBy')$q$), 'O');
select tst.expect('…uid — из id, подпись сохранена', (select (data ->> 'uid') || '|' || (data ->> 'label') from public.access_docs where kind = 'observer' and id = 'T3'), 'T3|Таня');
select tst.expect('…копия прав получила наблюдателя', (select count(*)::text from public.rows_desk_observers where workspace_id = 'W' and uid = 'T3'), '1');
select tst.expect('…и он читает чужой стол', tst.try('T3', $q$select * from desk_rows where page_id = 'P2'$q$, true), 'ok:1');
select tst.expect('выданный Owner тоже выдаёт', tst.jval('O2', $q$select jsonb_array_length(access_write('W', '[{"kind":"observer","id":"AD","op":"set","data":{"label":""}}]'))::text$q$), '1');
select tst.expect('Owner читает список наблюдателей', tst.try('O', $q$select * from access_docs where kind = 'observer'$q$, true), 'ok:2');
select tst.expect('наблюдатель видит только себя', tst.try('T3', $q$select * from access_docs where kind = 'observer'$q$, true), 'ok:1');
select tst.expect('ответственный за стол наблюдателей не видит', tst.try('T1', $q$select * from access_docs where kind = 'observer'$q$, true), 'ok:0');
select tst.expect('Тимлид наблюдателей не видит', tst.try('TL', $q$select * from access_docs where kind = 'observer'$q$, true), 'ok:0');
select tst.expect('наблюдатель себя не снимает', tst.jval('T3', $q$select access_write('W', '[{"kind":"observer","id":"T3","op":"delete"}]')::text$q$), 'error:42501');
select tst.expect('Owner снимает', tst.jval('O', $q$select jsonb_array_length(access_write('W', '[{"kind":"observer","id":"T3","op":"delete"},{"kind":"observer","id":"AD","op":"delete"}]'))::text$q$), '2');
select tst.expect('…документ удалён мягко, копия прав — насовсем',
  (select (select deleted::text from public.access_docs where kind = 'observer' and id = 'T3') || '|' ||
          (select count(*)::text from public.rows_desk_observers where workspace_id = 'W' and uid in ('T3', 'AD'))), 'true|0');
select tst.expect('…чужой стол снова закрыт', tst.try('T3', $q$select * from desk_rows where page_id = 'P2'$q$, true), 'ok:0');
select tst.expect('снятие несуществующего — пусто, без ошибки', tst.jval('O', $q$select jsonb_array_length(access_write('W', '[{"kind":"observer","id":"nobody","op":"delete"}]'))::text$q$), '0');
select tst.expect('наблюдатель из копии прав без документа не задет', (select count(*)::text from public.rows_desk_observers where workspace_id = 'W' and uid = 'OBS'), '1');

-- ---------------------------------------------------------------------
-- Заявки по ключу — сначала с ключом по умолчанию.
-- ---------------------------------------------------------------------
select tst.expect('заявка с верным ключом по умолчанию',
  tst.jval('T1', $q$select (access_write('W', '[{"kind":"ownerreq","id":"T1","op":"set","data":{"fromName":"Технарь","fromEmail":"t1@x","keyHash":"$q$ || public.access_key_hash('W', '21122005') || $q$","status":"approved","grantedRole":"owner","createdAt":7}}]') -> 0 -> 'data' ->> 'status')$q$), 'pending');
select tst.expect('…роль из данных не принимается, проситель из токена',
  (select coalesce(data ->> 'grantedRole', 'null') || '|' || (data ->> 'fromUid') || '|' || (data ->> 'createdAt') from public.access_docs where kind = 'ownerreq' and id = 'T1'), 'null|T1|7');
select tst.expect('неверный ключ — отказ', tst.jval('T2', $q$select access_write('W', '[{"kind":"ownerreq","id":"T2","op":"set","data":{"keyHash":"deadbeef"}}]')::text$q$), 'error:42501');
select tst.expect('без ключа — отказ', tst.jval('T2', $q$select access_write('W', '[{"kind":"ownerreq","id":"T2","op":"set","data":{"fromName":"x"}}]')::text$q$), 'error:42501');
select tst.expect('заявку за другого не подать',
  tst.jval('T2', $q$select access_write('W', '[{"kind":"ownerreq","id":"T3","op":"set","data":{"keyHash":"$q$ || public.access_key_hash('W', '21122005') || $q$"}}]')::text$q$), 'error:42501');
select tst.expect('посторонний не подаёт',
  tst.jval('X', $q$select access_write('W', '[{"kind":"ownerreq","id":"X","op":"set","data":{"keyHash":"$q$ || public.access_key_hash('W', '21122005') || $q$"}}]')::text$q$), 'error:42501');

-- ---------------------------------------------------------------------
-- Ключ доступа — только создатель.
-- ---------------------------------------------------------------------
select tst.expect('Тимлид ключ не меняет', tst.jval('TL', $q$select access_write('W', '[{"kind":"ownerkey","id":"key","op":"set","data":{"key":"newkey1"}}]')::text$q$), 'error:42501');
select tst.expect('выданный Owner ключ не меняет', tst.jval('O2', $q$select access_write('W', '[{"kind":"ownerkey","id":"key","op":"set","data":{"key":"newkey1"}}]')::text$q$), 'error:42501');
select tst.expect('короткий ключ — отказ', tst.jval('O', $q$select access_write('W', '[{"kind":"ownerkey","id":"key","op":"set","data":{"key":"abc"}}]')::text$q$), 'error:22023');
select tst.expect('ключ не под id key — отказ', tst.jval('O', $q$select access_write('W', '[{"kind":"ownerkey","id":"other","op":"set","data":{"key":"newkey1"}}]')::text$q$), 'error:22023');
select tst.expect('создатель меняет ключ', tst.jval('O', $q$select (access_write('W', '[{"kind":"ownerkey","id":"key","op":"set","data":{"key":" new key 1 ","hash":"fake","updatedByName":"Нурба"}}]') -> 0 -> 'data' ->> 'key')$q$), 'newkey1');
select tst.expect('…хеш считает база', (select (data ->> 'hash' = public.access_key_hash('W', 'newkey1'))::text || '|' || (data ->> 'updatedByUid') from public.access_docs where kind = 'ownerkey'), 'true|O');
select tst.expect('создатель читает ключ', tst.try('O', $q$select * from access_docs where kind = 'ownerkey'$q$, true), 'ok:1');
select tst.expect('выданный Owner ключ не читает', tst.try('O2', $q$select * from access_docs where kind = 'ownerkey'$q$, true), 'ok:0');
select tst.expect('Тимлид ключ не читает', tst.try('TL', $q$select * from access_docs where kind = 'ownerkey'$q$, true), 'ok:0');

select tst.expect('после смены ключ по умолчанию не подходит',
  tst.jval('T2', $q$select access_write('W', '[{"kind":"ownerreq","id":"T2","op":"set","data":{"keyHash":"$q$ || public.access_key_hash('W', '21122005') || $q$"}}]')::text$q$), 'error:42501');
select tst.expect('новый ключ подходит',
  tst.jval('T2', $q$select (access_write('W', '[{"kind":"ownerreq","id":"T2","op":"set","data":{"keyHash":"$q$ || public.access_key_hash('W', 'newkey1') || $q$"}}]') -> 0 -> 'data' ->> 'status')$q$), 'pending');

-- Решение заявок.
select tst.expect('выданный Owner заявки не решает', tst.jval('O2', $q$select access_write('W', '[{"kind":"ownerreq","id":"T1","op":"merge","data":{"status":"approved"}}]')::text$q$), 'error:42501');
select tst.expect('Тимлид не решает', tst.jval('TL', $q$select access_write('W', '[{"kind":"ownerreq","id":"T1","op":"merge","data":{"status":"approved"}}]')::text$q$), 'error:42501');
select tst.expect('сам себе не решает', tst.jval('T1', $q$select access_write('W', '[{"kind":"ownerreq","id":"T1","op":"merge","data":{"status":"approved"}}]')::text$q$), 'error:42501');
select tst.expect('создатель одобряет с ролью',
  tst.jval('O', $q$select (access_write('W', '[{"kind":"ownerreq","id":"T1","op":"merge","data":{"status":"approved","grantedRole":"teamlead","resolvedByName":"Нурба","resolvedByUid":"T9"}}]') -> 0 -> 'data' ->> 'resolvedByUid')$q$), 'O');
select tst.expect('…роль и статус записаны', (select (data ->> 'status') || '|' || (data ->> 'grantedRole') || '|' || (data ->> 'fromUid') from public.access_docs where kind = 'ownerreq' and id = 'T1'), 'approved|teamlead|T1');
select tst.expect('решение с лишним полем — отказ', tst.jval('O', $q$select access_write('W', '[{"kind":"ownerreq","id":"T2","op":"merge","data":{"status":"denied","keyHash":"x"}}]')::text$q$), 'error:22023');
select tst.expect('создатель отклоняет', tst.jval('O', $q$select (access_write('W', '[{"kind":"ownerreq","id":"T2","op":"merge","data":{"status":"denied","grantedRole":"owner"}}]') -> 0 -> 'data' ->> 'grantedRole')$q$), '');
select tst.expect('после отказа подают снова',
  tst.jval('T2', $q$select (access_write('W', '[{"kind":"ownerreq","id":"T2","op":"set","data":{"keyHash":"$q$ || public.access_key_hash('W', 'newkey1') || $q$"}}]') -> 0 -> 'data' ->> 'status')$q$), 'pending');
select tst.expect('…решение прежней заявки стёрто', (select coalesce(data ->> 'resolvedByUid', 'null') from public.access_docs where kind = 'ownerreq' and id = 'T2'), 'null');
select tst.expect('свою заявку человек читает', tst.try('T1', $q$select * from access_docs where kind = 'ownerreq'$q$, true), 'ok:1');
select tst.expect('создатель читает все заявки', tst.try('O', $q$select * from access_docs where kind = 'ownerreq'$q$, true), 'ok:2');
select tst.expect('выданный Owner чужие заявки не читает', tst.try('O2', $q$select * from access_docs where kind = 'ownerreq'$q$, true), 'ok:0');
select tst.expect('Тимлид заявку не удаляет', tst.jval('TL', $q$select access_write('W', '[{"kind":"ownerreq","id":"T1","op":"delete"}]')::text$q$), 'error:42501');
select tst.expect('создатель удаляет заявку', tst.jval('O', $q$select (access_write('W', '[{"kind":"ownerreq","id":"T1","op":"delete"}]') -> 0 ->> 'deleted')$q$), 'true');
select tst.expect('перенос ключа старее живого — пропуск', tst.jval('O', $q$select access_import('W', '[{"kind":"ownerkey","id":"key","data":{"key":"oldkey1","hash":"abc","updatedAt":2}}]', false)::text$q$), '0');
select tst.expect('перенос ключа новее живого — заменяет',
  tst.jval('O', $q$select access_import('W', '[{"kind":"ownerkey","id":"key","data":{"key":"oldkey1","hash":"$q$ || public.access_key_hash('W', 'oldkey1') || $q$","updatedAt":9000000000000}}]', false)::text$q$), '1');
select tst.expect('…перенесённый ключ подходит',
  tst.jval('T3', $q$select (access_write('W', '[{"kind":"ownerreq","id":"T3","op":"set","data":{"keyHash":"$q$ || public.access_key_hash('W', 'oldkey1') || $q$"}}]') -> 0 -> 'data' ->> 'status')$q$), 'pending');
select tst.expect('создатель возвращает ключ по умолчанию', tst.jval('O', $q$select jsonb_array_length(access_write('W', '[{"kind":"ownerkey","id":"key","op":"delete"}]'))::text$q$), '1');
select tst.expect('…ключ по умолчанию снова подходит',
  tst.jval('T3', $q$select (access_write('W', '[{"kind":"ownerreq","id":"T3","op":"set","data":{"keyHash":"$q$ || public.access_key_hash('W', '21122005') || $q$"}}]') -> 0 -> 'data' ->> 'status')$q$), 'pending');

-- ---------------------------------------------------------------------
-- Общее: meta, прямые записи, пачка.
-- ---------------------------------------------------------------------
select tst.expect('meta не пишется', tst.jval('O', $q$select access_write('W', '[{"kind":"meta","id":"imported","op":"set","data":{}}]')::text$q$), 'error:22023');
select tst.expect('неизвестный вид — отказ', tst.jval('O', $q$select access_write('W', '[{"kind":"page","id":"x","op":"set","data":{}}]')::text$q$), 'error:22023');
select tst.expect('кривой id — отказ', tst.jval('O', $q$select access_write('W', '[{"kind":"observer","id":"a b","op":"set","data":{}}]')::text$q$), 'error:22023');
select tst.expect('прямая запись закрыта', tst.try('O', $q$insert into access_docs (workspace_id, kind, id, data) values ('W','observer','z','{}')$q$), 'error');
select tst.expect('прямая правка закрыта', tst.try('O', $q$update access_docs set deleted = true$q$), 'error');
select tst.expect('API-роли не пишут таблицу',
  (has_table_privilege('anon', 'public.access_docs', 'insert') or has_table_privilege('authenticated', 'public.access_docs', 'update')
   or has_table_privilege('anon', 'public.access_docs', 'delete') or has_table_privilege('anon', 'public.access_docs', 'truncate'))::text, 'false');
select tst.expect('пачка — одна транзакция: отказ второй записи откатывает первую',
  tst.jval('O', $q$select access_write('W', '[{"kind":"observer","id":"V","op":"set","data":{}},{"kind":"ownerkey","id":"key","op":"set","data":{"key":"ab"}}]')::text$q$), 'error:22023');
select tst.expect('…наблюдателя нет', (select count(*)::text from public.rows_desk_observers where workspace_id = 'W' and uid = 'V'), '0');
select tst.expect('rev растёт на каждой записи', (select (max(rev) > min(rev))::text from public.access_docs where workspace_id = 'W'), 'true');
select tst.expect('отметки переноса пока нет', tst.try('T1', $q$select * from access_docs where kind = 'meta'$q$, true), 'ok:0');

-- ---------------------------------------------------------------------
-- Перенос.
-- ---------------------------------------------------------------------
select tst.expect('технарь не переносит', tst.jval('T1', $q$select access_import('W', '[]', true)::text$q$), 'error:42501');
select tst.expect('Тимлид не переносит', tst.jval('TL', $q$select access_import('W', '[]', true)::text$q$), 'error:42501');
select tst.expect('перенос кладёт документы',
  tst.jval('O', $q$select access_import('W', '[
    {"kind":"viewreq","id":"old_1","data":{"id":"old_1","workspaceId":"X","pageId":"P2","pageName":"Старый","fromUid":"T3","fromName":"T3","toUid":"T2","status":"pending","createdAt":5,"legacy":1}},
    {"kind":"observer","id":"OBS","data":{"uid":"OBS","label":"Наблюдатель","grantedAt":3,"grantedBy":"O"}},
    {"kind":"ownerreq","id":"OS1","data":{"fromUid":"OS1","status":"denied","createdAt":4,"resolvedByUid":"O","keyHash":"h"}},
    {"kind":"ownerkey","id":"key","data":{"key":"oldkey1","hash":"abc","updatedAt":2}},
    {"kind":"viewreq","id":"bad id","data":{}},
    {"kind":"meta","id":"imported","data":{"at":1}}
  ]', false)::text$q$), '3');
select tst.expect('…лишнее поле отброшено, workspaceId свой', (select (data ? 'legacy')::text || '|' || (data ->> 'workspaceId') from public.access_docs where kind = 'viewreq' and id = 'old_1'), 'false|W');
select tst.expect('…наблюдатель — и в копии прав', (select count(*)::text from public.rows_desk_observers where workspace_id = 'W' and uid = 'OBS'), '1');
select tst.expect('…перенесённая заявка видна просителю', tst.try('T3', $q$select * from access_docs where kind = 'viewreq' and id = 'old_1'$q$, true), 'ok:1');
select tst.expect('…удалённый ключ переносом не воскрес — ключ по умолчанию подходит',
  tst.jval('T2', $q$select (access_write('W', '[{"kind":"ownerreq","id":"T2","op":"set","data":{"keyHash":"$q$ || public.access_key_hash('W', '21122005') || $q$"}}]') -> 0 -> 'data' ->> 'status')$q$), 'pending');
select tst.expect('…ключ в базе так и удалён', (select deleted::text from public.access_docs where kind = 'ownerkey' and id = 'key'), 'true');
select tst.expect('более старое не затирает', tst.jval('O', $q$select access_import('W', '[{"kind":"viewreq","id":"old_1","data":{"status":"approved","updatedAt":3}}]', false)::text$q$), '0');
select tst.expect('более новое заменяет', tst.jval('O', $q$select access_import('W', '[{"kind":"viewreq","id":"old_1","data":{"status":"approved","updatedAt":30}}]', true)::text$q$), '1');
select tst.expect('…статус сменился', (select data ->> 'status' from public.access_docs where kind = 'viewreq' and id = 'old_1'), 'approved');
select tst.expect('отметка переноса стоит', (select (data ? 'at')::text || '|' || (data ? 'tailAt')::text from public.access_docs where kind = 'meta' and id = 'imported'), 'true|false');
select tst.expect('…участник видит отметку', tst.try('T1', $q$select * from access_docs where kind = 'meta'$q$, true), 'ok:1');
select tst.expect('…посторонний — нет', tst.try('X', $q$select * from access_docs where kind = 'meta'$q$, true), 'ok:0');
select tst.run('O', $q$select access_import('W', '[]', true)$q$);
select tst.expect('дочитка ставит tailAt, at прежний',
  (select (data ? 'tailAt')::text || '|' || ((data ->> 'at')::bigint > 0)::text from public.access_docs where kind = 'meta' and id = 'imported'), 'true|true');
select tst.expect('удалённое в базе переносом не воскресает', tst.jval('O', $q$select access_import('W', '[{"kind":"viewreq","id":"vr_1","data":{"status":"pending","updatedAt":99}}]', false)::text$q$), '0');
select tst.expect('…документ остался удалённым', (select deleted::text from public.access_docs where kind = 'viewreq' and id = 'vr_1'), 'true');

-- Повторный накат файла.
\ir ../migrations/20261047_access_docs.sql
select tst.expect('повторный накат: документы целы', (select count(*)::text from public.access_docs where workspace_id = 'W' and kind = 'viewreq' and not deleted), '2');
select tst.expect('повторный накат: запись работает', tst.jval('O', $q$select jsonb_array_length(access_write('W', '[{"kind":"observer","id":"AD","op":"set","data":{"label":"x"}},{"kind":"observer","id":"AD","op":"delete"}]'))::text$q$), '2');

delete from public.rows_members where workspace_id = 'W' and uid = 'O2';

select 'ПРОВЕРОК: ' || count(*) || ', ПРОВАЛЕНО: ' || count(*) filter (where not ok) as itog from tst.results;
select n, label, got from tst.results where not ok order by n;
