-- Проверки 20261009_chat.sql: чаты, карточки личек, отметки «прочитано».
-- Запускать ПОСЛЕ desk_rows_rls.sql (хелперы tst.*, участники W: O — Owner,
-- TL — Тимлид, TLT — Тимлид + Технарь, TLO — Тимлид + ОС, T1..T3 — технари,
-- OS1/OS2 — ОС, AD — Admin, V — Viewer, OBS — наблюдатель, X — посторонний;
-- столы P1 (ответственный T1, allowed T1,T2,T3,V), P2 (T2, allowed T2)).
\set ON_ERROR_STOP 1
set client_min_messages = warning;
truncate tst.results;

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

create or replace function tst.chat(uid text, kind text, page text, row_ text, peer text, msg text) returns text language sql as $$
  select tst.jval(uid, format($f$select (send_chat_message('W', %L, %L, %L, %L, %L::jsonb) ->> 'id')$f$, kind, page, row_, peer, msg))
$$;

-- ---------------------------------------------------------------------
-- Общий чат.
-- ---------------------------------------------------------------------
select tst.expect('технарь пишет в общий чат — id из payload сохранён',
  tst.chat('T1', 'ws', null, null, null, '{"id":"m1","text":"Привет","authorName":"Тимур","authorUid":"O","authorPhotoURL":"http://x/p.png"}'), 'm1');
select tst.expect('author_uid — из токена', (select author_uid from public.chat_messages where id = 'm1'), 'T1');
select tst.expect('нить ws', (select thread || '|' || kind from public.chat_messages where id = 'm1'), 'ws|ws');
select tst.expect('created_at серверное', (select (abs(created_at - (extract(epoch from now()) * 1000)::bigint) < 60000)::text from public.chat_messages where id = 'm1'), 'true');
select tst.expect('фото и имя легли', (select author_name || '|' || author_photo_url from public.chat_messages where id = 'm1'), 'Тимур|http://x/p.png');
select tst.expect('кривой id → сгенерирован msg_…', (tst.chat('T1', 'ws', null, null, null, '{"id":"a/b","text":"x"}') ~ '^msg_[0-9a-f]{32}$')::text, 'true');
select tst.expect('повтор id — та же строка, текст не переписан', tst.chat('T1', 'ws', null, null, null, '{"id":"m1","text":"Другое"}'), 'm1');
select tst.expect('…текст прежний', (select text from public.chat_messages where id = 'm1'), 'Привет');
select tst.expect('длинный текст обрезан до 4000',
  (length((select text from public.chat_messages where id = tst.chat('T1', 'ws', null, null, null, format('{"id":"m2","text":"%s"}', repeat('x', 5000))))))::text, '4000');
select tst.expect('ответ: reply_to_text обрезан до 140',
  (select length(reply_to_text)::text || '|' || reply_to_id from public.chat_messages where id = tst.chat('T1', 'ws', null, null, null, format('{"id":"m3","text":"re","replyToId":"m1","replyToAuthorName":"Тимур","replyToText":"%s"}', repeat('y', 200)))), '140|m1');
select tst.expect('Viewer пишет в общий чат', (tst.chat('V', 'ws', null, null, null, '{"id":"m4","text":"v"}') = 'm4')::text, 'true');
select tst.expect('ОС пишет в общий чат', (tst.chat('OS1', 'ws', null, null, null, '{"id":"m5","text":"os"}') = 'm5')::text, 'true');
select tst.expect('посторонний не пишет', tst.try('X', $q$select send_chat_message('W','ws',null,null,null,'{"text":"x"}'::jsonb)$q$), 'error');
select tst.expect('анонимный ключ не пишет', tst.try('__anon_key__', $q$select send_chat_message('W','ws',null,null,null,'{"text":"x"}'::jsonb)$q$), 'error');
select tst.expect('кривой вид нити — отказ', tst.try('T1', $q$select send_chat_message('W','bogus',null,null,null,'{"text":"x"}'::jsonb)$q$), 'error');
select tst.expect('не объект — отказ', tst.try('T1', $q$select send_chat_message('W','ws',null,null,null,'[]'::jsonb)$q$), 'error');
select tst.expect('общий чат читают все участники (V)', tst.try('V', $q$select * from chat_messages where thread = 'ws'$q$, true), 'ok:6');
select tst.expect('общий чат читает ОС', tst.try('OS2', $q$select * from chat_messages where thread = 'ws'$q$, true), 'ok:6');
select tst.expect('посторонний не читает', tst.try('X', $q$select * from chat_messages$q$, true), 'ok:0');
select tst.expect('анонимный ключ не читает', tst.try('__anon_key__', $q$select * from chat_messages$q$, true), 'ok:0');
select tst.expect('прямая вставка — отказ', tst.try('T1', $q$insert into chat_messages (workspace_id, id, kind, thread, author_uid, created_at) values ('W','x1','ws','ws','T1',1)$q$), 'error');

-- ---------------------------------------------------------------------
-- Чат стола и комментарии — canAccessPage.
-- ---------------------------------------------------------------------
select tst.expect('технарь с доступом пишет в чат стола P1', tst.chat('T2', 'page', 'P1', null, null, '{"id":"p1","text":"x"}'), 'p1');
select tst.expect('…нить page:P1', (select thread || '|' || page_id from public.chat_messages where id = 'p1'), 'page:P1|P1');
select tst.expect('ОС пишет в чат чужого стола (читает все столы)', tst.chat('OS2', 'page', 'P1', null, null, '{"id":"p2","text":"x"}'), 'p2');
select tst.expect('Тимлид без Технаря в чат стола не пишет', tst.try('TL', $q$select send_chat_message('W','page','P1',null,null,'{"text":"x"}'::jsonb)$q$), 'error');
select tst.expect('Тимлид + Технарь пишет', tst.chat('TLT', 'page', 'P1', null, null, '{"id":"p3","text":"x"}'), 'p3');
select tst.expect('наблюдатель пишет', tst.chat('OBS', 'page', 'P1', null, null, '{"id":"p4","text":"x"}'), 'p4');
select tst.expect('Owner пишет', tst.chat('O', 'page', 'P2', null, null, '{"id":"p5","text":"x"}'), 'p5');
select tst.expect('технарь без доступа к P2 не пишет', tst.try('T1', $q$select send_chat_message('W','page','P2',null,null,'{"text":"x"}'::jsonb)$q$), 'error');
select tst.expect('без стола — отказ', tst.try('T1', $q$select send_chat_message('W','page','',null,null,'{"text":"x"}'::jsonb)$q$), 'error');
select tst.expect('комментарий к строке', tst.chat('T3', 'row', 'P1', 'r1', null, '{"id":"c1","text":"x"}'), 'c1');
select tst.expect('…нить row:P1:r1', (select thread || '|' || page_id || '|' || row_id from public.chat_messages where id = 'c1'), 'row:P1:r1|P1|r1');
select tst.expect('комментарий без строки — отказ', tst.try('T3', $q$select send_chat_message('W','row','P1','',null,'{"text":"x"}'::jsonb)$q$), 'error');
select tst.expect('чат P1 читает Viewer с доступом', tst.try('V', $q$select * from chat_messages where thread = 'page:P1'$q$, true), 'ok:4');
select tst.expect('чат P2 технарь T1 не читает', tst.try('T1', $q$select * from chat_messages where thread = 'page:P2'$q$, true), 'ok:0');
select tst.expect('чат столов Тимлид без Технаря не читает', tst.try('TL', $q$select * from chat_messages where kind in ('page','row')$q$, true), 'ok:0');
select tst.expect('чат столов ОС читает', tst.try('OS1', $q$select * from chat_messages where kind in ('page','row')$q$, true), 'ok:6');
select tst.expect('Owner читает всё', tst.try('O', $q$select * from chat_messages$q$, true), 'ok:12');

-- ---------------------------------------------------------------------
-- Личка.
-- ---------------------------------------------------------------------
select tst.expect('T1 пишет T2', tst.chat('T1', 'dm', null, null, 'T2', '{"id":"d1","text":"привет","authorName":"Тимур"}'), 'd1');
select tst.expect('нить dm:T1_T2, пара отсортирована', (select thread || '|' || peer_a || '|' || peer_b || '|' || chat_id from public.chat_messages where id = 'd1'), 'dm:T1_T2|T1|T2|T1_T2');
select tst.expect('T2 отвечает — та же нить', (select thread from public.chat_messages where id = tst.chat('T2', 'dm', null, null, 'T1', '{"id":"d2","text":"и тебе","authorName":"Дан"}')), 'dm:T1_T2');
select tst.expect('карточка переписки — последнее сообщение', (select last_from_uid || '|' || last_text || '|' || last_from_name from public.chat_dm_meta where chat_id = 'T1_T2'), 'T2|и тебе|Дан');
select tst.expect('карточку читают оба', tst.try('T1', $q$select * from chat_dm_meta$q$, true), 'ok:1');
select tst.expect('карточку читает T2', tst.try('T2', $q$select * from chat_dm_meta$q$, true), 'ok:1');
select tst.expect('карточку не читает третий', tst.try('T3', $q$select * from chat_dm_meta$q$, true), 'ok:0');
select tst.expect('карточку не читает Owner', tst.try('O', $q$select * from chat_dm_meta$q$, true), 'ok:0');
select tst.expect('карточку не правит участник', tst.try('T1', $q$update chat_dm_meta set last_text = 'x' where chat_id = 'T1_T2'$q$), 'error');
select tst.expect('личку читают только двое: T1', tst.try('T1', $q$select * from chat_messages where kind = 'dm'$q$, true), 'ok:2');
select tst.expect('личку не читает T3', tst.try('T3', $q$select * from chat_messages where kind = 'dm'$q$, true), 'ok:0');
select tst.expect('личку не читает Owner', tst.try('O', $q$select * from chat_messages where kind = 'dm'$q$, true), 'ok:0');
select tst.expect('себе — отказ', tst.try('T1', $q$select send_chat_message('W','dm',null,null,'T1','{"text":"x"}'::jsonb)$q$), 'error');
select tst.expect('постороннему — отказ', tst.try('T1', $q$select send_chat_message('W','dm',null,null,'X','{"text":"x"}'::jsonb)$q$), 'error');
select tst.expect('без собеседника — отказ', tst.try('T1', $q$select send_chat_message('W','dm',null,null,'','{"text":"x"}'::jsonb)$q$), 'error');
select tst.expect('Viewer пишет Owner в личку', (tst.chat('V', 'dm', null, null, 'O', '{"id":"d3","text":"x"}') = 'd3')::text, 'true');

-- ---------------------------------------------------------------------
-- Правка и удаление — только автор, только текст.
-- ---------------------------------------------------------------------
select tst.run('T1', $q$update chat_messages set text = 'Привет всем', edited_at = 5 where id = 'm1'$q$);
select tst.expect('автор правит текст', (select text || '|' || edited_at from public.chat_messages where id = 'm1'), 'Привет всем|5');
select tst.expect('…rev вырос', (select (rev > 0)::text from public.chat_messages where id = 'm1'), 'true');
select tst.run('T1', $q$update chat_messages set text = '', deleted = true, edited_at = 6 where id = 'm2'$q$);
select tst.expect('автор удаляет мягко', (select deleted::text || '|' || text from public.chat_messages where id = 'm2'), 'true|');
select tst.expect('без изменений — 0 строк', tst.try('T1', $q$update chat_messages set text = 'Привет всем', edited_at = 5 where id = 'm1'$q$), 'ok:0');
select tst.expect('чужое не правится', tst.try('T2', $q$update chat_messages set text = 'x' where id = 'm1'$q$), 'deny');
select tst.expect('автор не меняет имя (нет права на столбец)', tst.try('T1', $q$update chat_messages set author_name = 'x' where id = 'm1'$q$), 'error');
select tst.expect('автор не переносит сообщение в другую нить', tst.try('T1', $q$update chat_messages set thread = 'page:P2' where id = 'm1'$q$), 'error');
select tst.expect('чужое не удаляется', tst.try('T2', $q$delete from chat_messages where id = 'm1'$q$), 'deny');
select tst.expect('своё удаляется совсем', tst.try('T1', $q$delete from chat_messages where id = 'm3'$q$), 'ok:1');
select tst.expect('Owner чужое не правит', tst.try('O', $q$update chat_messages set text = 'x' where id = 'm1'$q$), 'deny');

-- ---------------------------------------------------------------------
-- Отметки «прочитано».
-- ---------------------------------------------------------------------
select tst.run('T1', $q$insert into chat_reads (workspace_id, uid, context, last_read_at) values ('W','T1','workspaceChat',100)$q$);
select tst.expect('своя отметка пишется', (select last_read_at::text from public.chat_reads where uid = 'T1'), '100');
select tst.run('T1', $q$update chat_reads set last_read_at = 200 where uid = 'T1' and context = 'workspaceChat'$q$);
select tst.expect('своя отметка обновляется', (select last_read_at::text from public.chat_reads where uid = 'T1'), '200');
select tst.run('T1', $q$insert into chat_reads (workspace_id, uid, context, last_read_at) values ('W','T1','workspaceChat',300) on conflict (workspace_id, uid, context) do update set last_read_at = excluded.last_read_at$q$);
select tst.expect('…значение 300', (select last_read_at::text from public.chat_reads where uid = 'T1'), '300');
select tst.expect('чужую отметку не поставить', tst.try('T1', $q$insert into chat_reads (workspace_id, uid, context, last_read_at) values ('W','T2','workspaceChat',100)$q$), 'error');
select tst.expect('посторонний не пишет отметку', tst.try('X', $q$insert into chat_reads (workspace_id, uid, context, last_read_at) values ('W','X','workspaceChat',100)$q$), 'error');
select tst.expect('чужие отметки не читаются', tst.try('T2', $q$select * from chat_reads$q$, true), 'ok:0');
select tst.expect('свои читаются', tst.try('T1', $q$select * from chat_reads$q$, true), 'ok:1');
select tst.expect('отметку не удалить (нет права)', tst.try('T1', $q$delete from chat_reads where uid = 'T1'$q$), 'error');

-- ---------------------------------------------------------------------
-- Права ролей API, версия, повторный накат.
-- ---------------------------------------------------------------------
select tst.expect('роли API: insert в chat_messages запрещён', has_table_privilege('authenticated', 'public.chat_messages', 'insert')::text, 'false');
select tst.expect('роли API: chat_dm_meta только чтение', (has_table_privilege('anon', 'public.chat_dm_meta', 'insert') or has_table_privilege('anon', 'public.chat_dm_meta', 'update'))::text, 'false');
-- Проверка версии — ПОСЛЕ повторного наката: другие наборы накатывают
-- старые файлы заново, и в общем прогоне версия могла откатиться.
\ir ../migrations/20261009_chat.sql
select tst.expect('версия схемы не старее 20261009', (public.nova_schema_version() >= '20261009')::text, 'true');
select tst.expect('после повторного наката чат пишется', tst.chat('T1', 'ws', null, null, null, '{"id":"m9","text":"x"}'), 'm9');

select label, got from tst.results where not ok;
select format('ПРОВЕРОК (чаты): %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
