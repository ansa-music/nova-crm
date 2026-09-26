-- Проверки 20261020_announcements.sql: объявления в Postgres.
-- Запускать ПОСЛЕ desk_rows_rls.sql (участники workspace W: O — Owner,
-- TL — Тимлид, T1..T3 — технари, OS1/OS2 — ОС, AD — Admin, V — Viewer,
-- X — посторонний).
\set ON_ERROR_STOP 1
set client_min_messages = warning;
truncate tst.results;
\ir ../migrations/20261020_announcements.sql

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

select tst.expect('Admin публикует',
  tst.jval('AD', $q$select jsonb_array_length(announcement_write('W', '[{"kind":"ann","id":"ann_1","op":"set","data":{"title":"Привет","body":"Текст","priority":"normal","pinned":false,"isArchived":false,"authorUid":"T1","authorName":"Админ","createdAt":1,"updatedAt":1}}]'))::text$q$), '1');
select tst.expect('автор — из токена, а не из данных', (select data ->> 'authorUid' from public.announcement_docs where id = 'ann_1'), 'AD');
select tst.expect('серверный порядок проставлен', (select (data ? 'serverOrderAt')::text from public.announcement_docs where id = 'ann_1'), 'true');
select tst.expect('workspaceId и id — из вызова', (select (data ->> 'workspaceId') || '|' || (data ->> 'id') from public.announcement_docs where id = 'ann_1'), 'W|ann_1');
select tst.expect('Owner публикует', tst.jval('O', $q$select jsonb_array_length(announcement_write('W', '[{"kind":"ann","id":"ann_2","op":"set","data":{"title":"B","body":"","priority":"high","pinned":true,"isArchived":false}}]'))::text$q$), '1');
select tst.expect('Тимлид правит', tst.jval('TL', $q$select jsonb_array_length(announcement_write('W', '[{"kind":"ann","id":"ann_1","op":"merge","data":{"pinned":true,"updatedAt":2}}]'))::text$q$), '1');
select tst.expect('правка сливается, автор и порядок прежние',
  (select (data ->> 'pinned') || '|' || (data ->> 'title') || '|' || (data ->> 'authorUid') from public.announcement_docs where id = 'ann_1'), 'true|Привет|AD');
select tst.expect('правкой автора не подменить', tst.jval('TL', $q$select jsonb_array_length(announcement_write('W', '[{"kind":"ann","id":"ann_1","op":"merge","data":{"authorUid":"TL"}}]'))::text$q$), '1');
select tst.expect('…автор тот же', (select data ->> 'authorUid' from public.announcement_docs where id = 'ann_1'), 'AD');
select tst.expect('технарь не публикует', tst.try('T1', $q$select announcement_write('W', '[{"kind":"ann","id":"ann_3","op":"set","data":{"title":"x"}}]')$q$), 'error');
select tst.expect('ОС не публикует', tst.try('OS1', $q$select announcement_write('W', '[{"kind":"ann","id":"ann_3","op":"set","data":{"title":"x"}}]')$q$), 'error');
select tst.expect('Viewer не правит', tst.try('V', $q$select announcement_write('W', '[{"kind":"ann","id":"ann_1","op":"merge","data":{"pinned":false}}]')$q$), 'error');
select tst.expect('посторонний не пишет', tst.try('X', $q$select announcement_write('W', '[{"kind":"ann","id":"ann_3","op":"set","data":{"title":"x"}}]')$q$), 'error');
select tst.expect('лишнее поле — отказ', tst.try('O', $q$select announcement_write('W', '[{"kind":"ann","id":"ann_3","op":"set","data":{"title":"x","role":"owner"}}]')$q$), 'error');
select tst.expect('кривой id — отказ', tst.try('O', $q$select announcement_write('W', '[{"kind":"ann","id":"a b","op":"set","data":{"title":"x"}}]')$q$), 'error');
select tst.expect('meta писать нельзя', tst.try('O', $q$select announcement_write('W', '[{"kind":"meta","id":"imported","op":"set","data":{}}]')$q$), 'error');
select tst.expect('все участники читают', tst.try('T2', $q$select * from announcement_docs where workspace_id = 'W' and kind = 'ann'$q$, true), 'ok:2');
select tst.expect('посторонний не читает', tst.try('X', $q$select * from announcement_docs$q$, true), 'ok:0');
select tst.expect('прямая запись закрыта', tst.try('O', $q$insert into announcement_docs (workspace_id, kind, id, data) values ('W','ann','z','{}')$q$), 'error');
select tst.expect('прямая правка закрыта', tst.try('O', $q$update announcement_docs set deleted = true$q$), 'error');
select tst.expect('API-роли не пишут таблицу',
  (has_table_privilege('anon', 'public.announcement_docs', 'insert') or has_table_privilege('authenticated', 'public.announcement_docs', 'update')
   or has_table_privilege('anon', 'public.announcement_docs', 'truncate'))::text, 'false');

select tst.run('O', $q$select announcement_write('W', '[{"kind":"ann","id":"ann_2","op":"delete"}]')$q$);
select tst.expect('удаление мягкое', (select deleted::text from public.announcement_docs where id = 'ann_2'), 'true');
select tst.expect('rev растёт на каждой записи', (select (max(rev) > min(rev))::text from public.announcement_docs), 'true');
select tst.expect('технарь не удаляет', tst.try('T1', $q$select announcement_write('W', '[{"kind":"ann","id":"ann_1","op":"delete"}]')$q$), 'error');

-- Перенос.
select tst.expect('технарь не переносит', tst.try('T1', $q$select announcement_import('W', '[]', true)$q$), 'error');
select tst.expect('перенос кладёт новые и не затирает свежее',
  tst.jval('TL', $q$select announcement_import('W', '[{"id":"old_1","data":{"title":"Старое","createdAt":5,"updatedAt":5,"serverOrderAt":5,"legacy":1}},{"id":"ann_1","data":{"title":"Было","updatedAt":1}},{"id":"bad id","data":{}}]', false)::text$q$), '1');
select tst.expect('лишнее поле старого — отброшено', (select (data ? 'legacy')::text || '|' || (data ->> 'title') from public.announcement_docs where id = 'old_1'), 'false|Старое');
select tst.expect('свежее не затёрто', (select data ->> 'title' from public.announcement_docs where id = 'ann_1'), 'Привет');
select tst.expect('до отметки её нет', (select count(*)::text from public.announcement_docs where kind = 'meta'), '0');
select tst.run('AD', $q$select announcement_import('W', '[]', true)$q$);
select tst.expect('отметка «перенесено»', (select count(*)::text from public.announcement_docs where kind = 'meta' and id = 'imported'), '1');
select tst.run('AD', $q$select announcement_import('W', '[]', true)$q$);
select tst.expect('повторная отметка — дочитка (tailAt)', (select (data ? 'tailAt')::text from public.announcement_docs where kind = 'meta'), 'true');

\ir ../migrations/20261020_announcements.sql
select tst.expect('версия схемы не старее 20261020', (public.nova_schema_version() >= '20261020')::text, 'true');
select tst.expect('после наката данные на месте', (select data ->> 'title' from public.announcement_docs where id = 'ann_1'), 'Привет');

select label, got from tst.results where not ok;
select format('ПРОВЕРОК (объявления): %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
