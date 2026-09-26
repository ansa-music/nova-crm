-- Проверки 20261022_personal.sql: личная зона стола в Postgres.
-- Запускать ПОСЛЕ desk_rows_rls.sql (W: O — Owner, TL — Тимлид, TLT —
-- Тимлид + Технарь, T1..T3 — технари, OS1 — ОС со столом osdesk_OS1,
-- TLO — Тимлид + ОС со столом osdesk_TLO, V — Viewer, X — посторонний;
-- стол P1 — ответственный T1, P2 — T2).
\set ON_ERROR_STOP 1
set client_min_messages = warning;
truncate tst.results;
\ir ../migrations/20261022_personal.sql
insert into public.rows_page_acl (workspace_id, page_id, responsible_uid, created_by, os_desk, allowed_uids, editable_uids, personal_zone_uids) values
  ('W', 'PTL', 'TL', 'TL', false, '{TL}', '{}', '{}'),
  ('W', 'PTLT', 'TLT', 'TLT', false, '{TLT}', '{}', '{}'),
  ('W', 'osdesk_TLO', 'TLO', 'TLO', true, '{TLO}', '{}', '{}')
  on conflict (workspace_id, page_id) do update set responsible_uid = excluded.responsible_uid, created_by = excluded.created_by, os_desk = excluded.os_desk;
update public.rows_page_acl set personal_zone_uids = '{T3}' where workspace_id = 'W' and page_id = 'P1';

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
create or replace function tst.pw(uid text, ops text) returns text language sql as $$
  select case when r like 'error:%' then r else 'done' end
  from (select tst.jval(uid, format('select personal_write(%L, %L)::text', 'W', ops)) r) x
$$;
create or replace function tst.pcnt(uid text, cond text) returns text language sql as $$
  select tst.jval(uid, 'select count(*)::text from personal_docs where workspace_id = ''W'' and not deleted and ' || cond)
$$;

select tst.expect('ответственный ведёт свою зону',
  tst.pw('T1', '[{"page":"P1","zone":"T1","kind":"finance","id":"f1","op":"set","data":{"uid":"X","type":"income","amountMinor":100,"createdAt":1}},{"page":"P1","zone":"T1","kind":"note","id":"n1","op":"set","data":{"authorId":"X","title":"Т","text":"т","updatedAt":1}},{"page":"P1","zone":"T1","kind":"zone","id":"zone_P1_T1","op":"merge","data":{"createdAt":1}}]'), 'done');
select tst.expect('uid/authorId — от зоны, а не из данных',
  (select string_agg(coalesce(data ->> 'uid', data ->> 'authorId'), ',' order by kind) from public.personal_docs where zone_uid = 'T1'), 'T1,T1,T1');
select tst.expect('метки стола и зоны проставлены', (select (data ->> '_page') || '|' || (data ->> '_zone') from public.personal_docs where id = 'f1'), 'P1|T1');
select tst.expect('чужую зону на своём столе не ведёт', tst.pw('T1', '[{"page":"P1","zone":"T2","kind":"note","id":"n2","op":"set","data":{"title":"x"}}]'), 'error:42501');
select tst.expect('на чужом столе своей зоны нет', tst.pw('T1', '[{"page":"P2","zone":"T1","kind":"note","id":"n3","op":"set","data":{"title":"x"}}]'), 'error:42501');
select tst.expect('допущенный в personalZoneAllowedUsers ведёт свою', tst.pw('T3', '[{"page":"P1","zone":"T3","kind":"debt","id":"d1","op":"set","data":{"personName":"Ира","amountMinor":5,"paid":false,"createdAt":1}}]'), 'done');
select tst.expect('просмотрщик стола (без допуска) — нет', tst.pw('T2', '[{"page":"P1","zone":"T2","kind":"note","id":"n4","op":"set","data":{"title":"x"}}]'), 'error:42501');
select tst.expect('Тимлид без Технаря — нет даже на своём столе', tst.pw('TL', '[{"page":"PTL","zone":"TL","kind":"note","id":"n5","op":"set","data":{"title":"x"}}]'), 'error:42501');
select tst.expect('Тимлид + Технарь — на своём столе да', tst.pw('TLT', '[{"page":"PTLT","zone":"TLT","kind":"note","id":"n6","op":"set","data":{"title":"x"}}]'), 'done');
select tst.expect('Тимлид + ОС — на своём столе ОС да', tst.pw('TLO', '[{"page":"osdesk_TLO","zone":"TLO","kind":"note","id":"n7","op":"set","data":{"title":"x"}}]'), 'done');
select tst.expect('ОС — на своём столе ОС да', tst.pw('OS1', '[{"page":"osdesk_OS1","zone":"OS1","kind":"note","id":"n8","op":"set","data":{"title":"x"}}]'), 'done');
select tst.expect('Owner — в любую зону', tst.pw('O', '[{"page":"P1","zone":"T1","kind":"note","id":"n9","op":"set","data":{"title":"от Owner"}}]'), 'done');
select tst.expect('посторонний — нет', tst.pw('X', '[{"page":"P1","zone":"X","kind":"note","id":"n10","op":"set","data":{"title":"x"}}]'), 'error:42501');
select tst.expect('чужой id не перехватить', tst.pw('T3', '[{"page":"P1","zone":"T3","kind":"note","id":"n1","op":"merge","data":{"title":"мой"}}]'), 'error:42501');
select tst.expect('…и не удалить', tst.pw('T3', '[{"page":"P1","zone":"T3","kind":"note","id":"n1","op":"delete"}]'), 'error:42501');

-- Чтение.
select tst.expect('своя зона: всё видно', tst.pcnt('T1', 'true'), '4');
select tst.expect('чужие зоны на своём столе не видны', tst.pcnt('T1', 'zone_uid <> ''T1'''), '0');
select tst.expect('T3 видит только свою', tst.pcnt('T3', 'true'), '1');
select tst.expect('Тимлид без Технаря не видит ничего', tst.pcnt('TL', 'true'), '0');
select tst.expect('Owner видит все зоны', tst.pcnt('O', 'true'), '8');
select tst.expect('Viewer не видит', tst.pcnt('V', 'true'), '0');
select tst.expect('посторонний не видит', tst.pcnt('X', 'true'), '0');
select tst.run('O', $q$update rows_page_acl set personal_zone_uids = '{}' where workspace_id = 'W' and page_id = 'P1'$q$);
select tst.expect('сняли допуск — зона закрылась', tst.pcnt('T3', 'true'), '0');
select tst.run('O', $q$update rows_page_acl set personal_zone_uids = '{T3}' where workspace_id = 'W' and page_id = 'P1'$q$);

-- Отчёты и строки.
select tst.expect('отчёт и строки',
  tst.pw('T1', '[{"page":"P1","zone":"T1","kind":"report","id":"rep1","op":"set","data":{"name":"Сентябрь","order":0,"columns":[]}},{"page":"P1","zone":"T1","kind":"row","id":"pr1","parent":"rep1","op":"set","data":{"cells":{"a":1,"b":2},"order":0}},{"page":"P1","zone":"T1","kind":"row","id":"pr2","parent":"rep1","op":"set","data":{"cells":{},"order":1}}]'), 'done');
select tst.expect('строка без отчёта — отказ', tst.pw('T1', '[{"page":"P1","zone":"T1","kind":"row","id":"pr3","op":"set","data":{"cells":{}}}]'), 'error:22023');
select tst.run('T1', $q$select personal_write('W', '[{"page":"P1","zone":"T1","kind":"row","id":"pr1","op":"merge","data":{"cells":{"b":3},"updatedAt":2}}]')$q$);
select tst.expect('ячейка сливается, отчёт помнится', (select (data -> 'cells')::text || '|' || parent_id || '|' || (data ->> '_parent') from public.personal_docs where id = 'pr1'), '{"a": 1, "b": 3}|rep1|rep1');
select tst.run('T1', $q$select personal_write('W', '[{"page":"P1","zone":"T1","kind":"report","id":"rep1","op":"delete"}]')$q$);
select tst.expect('отчёт удалён вместе со строками', (select count(*)::text from public.personal_docs where parent_id = 'rep1' and not deleted), '0');
select tst.expect('удаление стирает данные', (select (data ? 'cells')::text from public.personal_docs where id = 'pr1'), 'false');

-- Прямая запись закрыта.
select tst.expect('прямая вставка закрыта', tst.try('O', $q$insert into personal_docs (workspace_id, kind, id, page_id, zone_uid, data) values ('W','note','z','P1','T1','{}')$q$), 'error');
select tst.expect('API-роли не пишут таблицу',
  (has_table_privilege('anon', 'public.personal_docs', 'insert') or has_table_privilege('authenticated', 'public.personal_docs', 'update')
   or has_table_privilege('anon', 'public.personal_docs', 'truncate'))::text, 'false');

-- Перенос.
select tst.expect('чужую зону не переносит', tst.try('T2', $q$select personal_import('W', 'P1', 'T1', '[]', true)$q$), 'error');
select tst.expect('хозяин переносит свою',
  tst.jval('T3', $q$select personal_import('W', 'P1', 'T3', '[{"kind":"finance","id":"f9","data":{"type":"expense","amountMinor":7,"createdAt":3}},{"kind":"debt","id":"d1","data":{"personName":"Старое","createdAt":0}},{"kind":"row","id":"x1","data":{}},{"kind":"note","id":"n1","data":{"title":"чужой id"}}]', true)::text$q$), '1');
select tst.expect('свежее не затёрто', (select data ->> 'personName' from public.personal_docs where id = 'd1'), 'Ира');
select tst.expect('чужой id переносом не перехвачен', (select zone_uid from public.personal_docs where id = 'n1'), 'T1');
select tst.expect('отметка зоны видна хозяину', tst.pcnt('T3', 'kind = ''meta'' and id = ''imported_P1_T3'''), '1');
select tst.expect('…и не видна другим', tst.pcnt('T1', 'kind = ''meta'''), '0');
select tst.expect('Owner переносит любую', tst.try('O', $q$select personal_import('W', 'P1', 'T1', '[]', true)$q$), 'ok');

\ir ../migrations/20261022_personal.sql
select tst.expect('версия схемы не старее 20261022', (public.nova_schema_version() >= '20261022')::text, 'true');
select tst.expect('после наката допуск на месте', (select array_to_string(personal_zone_uids, ',') from public.rows_page_acl where page_id = 'P1'), 'T3');

select label, got from tst.results where not ok;
select format('ПРОВЕРОК (личная зона): %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
