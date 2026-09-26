-- Проверки 20261021_grok.sql: «Грок лимит» в Postgres.
-- Запускать ПОСЛЕ desk_rows_rls.sql (участники workspace W: O — Owner,
-- TL — Тимлид, T1..T3 — технари, OS1/OS2 — ОС, TLO — Тимлид + ОС,
-- AD — Admin, V — Viewer, X — посторонний).
\set ON_ERROR_STOP 1
set client_min_messages = warning;
truncate tst.results;
\ir ../migrations/20261020_announcements.sql
\ir ../migrations/20261021_grok.sql
insert into public.rows_members (workspace_id, uid, role, extra_roles) values ('W', 'OST', 'os', '{manager}')
  on conflict do nothing;

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
-- Одна запись от имени: 'ok' (запись осталась) или код ошибки.
create or replace function tst.gw(uid text, ops text) returns text language sql as $$
  select case when r like 'error:%' then r else 'done' end
  from (select tst.jval(uid, format('select grok_write(%L, %L)::text', 'W', ops)) r) x
$$;
create or replace function tst.cnt(uid text, cond text) returns text language sql as $$
  select tst.jval(uid, 'select count(*)::text from grok_docs where workspace_id = ''W'' and not deleted and ' || cond)
$$;

-- ---------------------------------------------------------------------
-- Аккаунты Грока.
-- ---------------------------------------------------------------------
select tst.expect('технарь заводит аккаунт',
  tst.gw('T1', '[{"kind":"account","id":"g1","op":"set","data":{"email":"a@x","password":"p","createdBy":"O","updatedByUid":"O","available":true,"updatedAt":10}}]'), 'done');
select tst.expect('автор и правщик — из токена', (select (data ->> 'createdBy') || '|' || (data ->> 'updatedByUid') from public.grok_docs where id = 'g1'), 'T1|T1');
select tst.expect('технарь не задаёт название карточки',
  tst.gw('T1', '[{"kind":"account","id":"g2","op":"set","data":{"email":"b@x","nickname":"Главный"}}]'), 'error:42501');
select tst.expect('Admin задаёт название', tst.gw('AD', '[{"kind":"account","id":"g2","op":"set","data":{"email":"b@x","nickname":"Главный"}}]'), 'done');
select tst.expect('технарь не меняет название', tst.gw('T2', '[{"kind":"account","id":"g2","op":"merge","data":{"nickname":"Мой"}}]'), 'error:42501');
select tst.expect('технарь отмечает лимит', tst.gw('T2', '[{"kind":"account","id":"g2","op":"merge","data":{"available":false,"usagePct":100}}]'), 'done');
select tst.expect('…название и автор на месте, правщик — T2',
  (select (data ->> 'nickname') || '|' || (data ->> 'createdBy') || '|' || (data ->> 'updatedByUid') || '|' || (data ->> 'available') from public.grok_docs where id = 'g2'), 'Главный|AD|T2|false');
select tst.expect('чистый ОС не пишет', tst.gw('OS1', '[{"kind":"account","id":"g3","op":"set","data":{"email":"c@x"}}]'), 'error:42501');
select tst.expect('чистый ОС не читает', tst.cnt('OS1', 'true'), '0');
select tst.expect('посторонний не читает', tst.cnt('X', 'true'), '0');
select tst.expect('ОС + Технарь читает', tst.cnt('OST', 'kind = ''account'''), '2');
select tst.expect('Viewer читает аккаунты', tst.cnt('V', 'kind = ''account'''), '2');

-- ---------------------------------------------------------------------
-- Управляющие разделом.
-- ---------------------------------------------------------------------
select tst.expect('Тимлид не назначает управляющих',
  tst.gw('TL', '[{"kind":"settings","id":"access","op":"merge","data":{"managers":{"higgsfield":["TL"]}}}]'), 'error:42501');
select tst.expect('Owner назначает', tst.gw('O', '[{"kind":"settings","id":"access","op":"merge","data":{"managers":{"higgsfield":["T2"]},"updatedAt":1,"updatedBy":"O"}}]'), 'done');
select tst.expect('лишнее поле настройки — отказ', tst.gw('O', '[{"kind":"settings","id":"access","op":"merge","data":{"role":"x"}}]'), 'error:22023');
select tst.expect('управляющий виден набором', tst.jval('T2', $q$select string_agg(provider, ',') from grok_my_managed()$q$), 'higgsfield');

-- ---------------------------------------------------------------------
-- Аккаунты подписок и доступ.
-- ---------------------------------------------------------------------
select tst.expect('технарь заводит открытый', tst.gw('T1', '[{"kind":"app","id":"a0","op":"set","data":{"provider":"higgsfield","email":"o@x","password":"p0"}}]'), 'done');
select tst.expect('у нового — restricted=false и пустой список', (select restricted::text || '|' || cardinality(allowed_uids) || '|' || (data ->> 'restricted') from public.grok_docs where kind = 'app' and id = 'a0'), 'false|0|false');
select tst.expect('технарь не заводит закрытый', tst.gw('T1', '[{"kind":"app","id":"a9","op":"set","data":{"provider":"higgsfield","restricted":true,"allowedUids":["T1"]}}]'), 'error:42501');
select tst.expect('Owner заводит закрытый', tst.gw('O', '[{"kind":"app","id":"a1","op":"set","data":{"provider":"higgsfield","email":"s@x","password":"secret","restricted":true,"allowedUids":["T3","T3",""]}},{"kind":"stub","id":"a1","op":"set","data":{"provider":"higgsfield","providerOther":"","title":"s•••@x","updatedAt":1}}]'), 'done');
select tst.expect('список без повторов и пустых', (select array_to_string(allowed_uids, ',') from public.grok_docs where kind = 'app' and id = 'a1'), 'T3');
select tst.run('O', $q$select grok_write('W', '[{"kind":"app","id":"a2","op":"set","data":{"provider":"elevenlabs","email":"e@x","password":"el","restricted":true,"allowedUids":["T3"]}},{"kind":"stub","id":"a2","op":"set","data":{"provider":"elevenlabs","providerOther":"","title":"e","updatedAt":1}}]')$q$);

select tst.expect('технарь видит только открытый', tst.cnt('T1', 'kind = ''app'''), '1');
select tst.expect('…и пароля закрытого нет в выборке всей таблицы', coalesce(tst.jval('T1', $q$select string_agg(data ->> 'password', ',') from grok_docs where kind = 'app'$q$), ''), 'p0');
select tst.expect('допущенный видит закрытые', tst.cnt('T3', 'kind = ''app'''), '3');
select tst.expect('управляющий Хикса видит закрытый Хикс, но не 11 Labs', tst.cnt('T2', 'kind = ''app'''), '2');
select tst.expect('Тимлид видит все', tst.cnt('TL', 'kind = ''app'''), '3');
select tst.expect('Admin — только открытые', tst.cnt('AD', 'kind = ''app'''), '1');
select tst.expect('Viewer — только открытые', tst.cnt('V', 'kind = ''app'''), '1');
select tst.expect('витрину видят все с Гроком', tst.cnt('T1', 'kind = ''stub'''), '2');

select tst.expect('чужой закрытый не правится', tst.gw('T1', '[{"kind":"app","id":"a1","op":"merge","data":{"password":"hack"}}]'), 'error:42501');
select tst.expect('закрытый не переносится к «своему» управляющему', tst.gw('T1', '[{"kind":"app","id":"a2","op":"merge","data":{"provider":"higgsfield"}}]'), 'error:42501');
select tst.expect('чужой закрытый не удаляется', tst.gw('T1', '[{"kind":"app","id":"a1","op":"delete"}]'), 'error:42501');
select tst.expect('допущенный правит пароль', tst.gw('T3', '[{"kind":"app","id":"a1","op":"merge","data":{"available":false}}]'), 'done');
select tst.expect('допущенный не меняет список доступа', tst.gw('T3', '[{"kind":"app","id":"a1","op":"merge","data":{"allowedUids":["T3","T1"]}}]'), 'error:42501');
select tst.expect('допущенный не открывает всем', tst.gw('T3', '[{"kind":"app","id":"a1","op":"merge","data":{"restricted":false}}]'), 'error:42501');
select tst.expect('допущенный не меняет провайдера', tst.gw('T3', '[{"kind":"app","id":"a1","op":"merge","data":{"provider":"elevenlabs"}}]'), 'error:42501');
select tst.expect('управляющий Хикса не уводит аккаунт в 11 Labs', tst.gw('T2', '[{"kind":"app","id":"a1","op":"merge","data":{"provider":"elevenlabs"}}]'), 'error:42501');
select tst.expect('технарь не закрывает открытый', tst.gw('T1', '[{"kind":"app","id":"a0","op":"merge","data":{"restricted":true,"allowedUids":["T1"]}}]'), 'error:42501');
select tst.expect('технарь меняет провайдера открытого', tst.gw('T1', '[{"kind":"app","id":"a0","op":"merge","data":{"provider":"suno"}}]'), 'done');

-- Витрина.
select tst.expect('технарь витрину не пишет', tst.gw('T1', '[{"kind":"stub","id":"a0","op":"set","data":{"provider":"suno","title":"x"}}]'), 'error:42501');
select tst.expect('управляющий Хикса пишет свою карточку', tst.gw('T2', '[{"kind":"stub","id":"a1","op":"set","data":{"provider":"higgsfield","providerOther":"","title":"Хикс","updatedAt":2}}]'), 'done');
select tst.expect('…но не чужую', tst.gw('T2', '[{"kind":"stub","id":"a2","op":"set","data":{"provider":"elevenlabs","title":"x"}}]'), 'error:42501');
select tst.expect('в карточке лишнего поля нет (пароль не положить)', tst.gw('O', '[{"kind":"stub","id":"a2","op":"merge","data":{"password":"x"}}]'), 'error:22023');
select tst.expect('удалить несуществующую карточку — не ошибка', tst.gw('T1', '[{"kind":"stub","id":"nope","op":"delete"}]'), 'done');

-- Запросы.
select tst.expect('технарь просит доступ', tst.gw('T1', '[{"kind":"request","id":"a1_T1","op":"set","data":{"accountId":"a1","provider":"higgsfield","uid":"T1","name":"Т1","accountTitle":"Хикс","status":"pending","createdAt":1,"resolvedAt":null,"resolvedBy":null,"resolvedByName":null}}]'), 'done');
select tst.expect('запрос к «чужому» управляющему — отказ', tst.gw('T1', '[{"kind":"request","id":"a2_T1","op":"set","data":{"accountId":"a2","provider":"higgsfield","uid":"T1","status":"pending"}}]'), 'error:42501');
select tst.expect('запрос не за себя — отказ', tst.gw('T1', '[{"kind":"request","id":"a2_T2","op":"set","data":{"accountId":"a2","provider":"elevenlabs","uid":"T2","status":"pending"}}]'), 'error:42501');
select tst.expect('сам себе не одобряет', tst.gw('T1', '[{"kind":"request","id":"a1_T1","op":"merge","data":{"status":"approved"}}]'), 'error:42501');
select tst.expect('к открытому (без карточки) не просят', tst.gw('T1', '[{"kind":"request","id":"a0_T1","op":"set","data":{"accountId":"a0","provider":"suno","uid":"T1","status":"pending"}}]'), 'error:42501');
select tst.expect('лишнее поле запроса — отказ', tst.gw('T2', '[{"kind":"request","id":"a2_T2","op":"set","data":{"accountId":"a2","provider":"elevenlabs","uid":"T2","status":"pending","role":"owner"}}]'), 'error:22023');
select tst.expect('свой запрос видит', tst.cnt('T1', 'kind = ''request'''), '1');
select tst.expect('другой технарь не видит', tst.cnt('T3', 'kind = ''request'''), '0');
select tst.expect('управляющий провайдера видит', tst.cnt('T2', 'kind = ''request'''), '1');
select tst.expect('Тимлид (без права раздела) не видит', tst.cnt('TL', 'kind = ''request'''), '0');
select tst.expect('Owner видит', tst.cnt('O', 'kind = ''request'''), '1');
select tst.expect('управляющий одобряет и дописывает одной пачкой',
  tst.gw('T2', '[{"kind":"app","id":"a1","op":"merge","data":{"allowedUids":{"$union":["T1"]},"updatedAt":5}},{"kind":"request","id":"a1_T1","op":"merge","data":{"status":"approved","resolvedAt":5,"resolvedBy":"T2","resolvedByName":"Т2"}}]'), 'done');
select tst.expect('список дописан, не заменён', (select array_to_string(allowed_uids, ',') || '|' || restricted from public.grok_docs where kind = 'app' and id = 'a1'), 'T1,T3|true');
select tst.expect('теперь технарь видит закрытый', tst.cnt('T1', 'kind = ''app'''), '2');
select tst.expect('одобренный не отозвать', tst.gw('T1', '[{"kind":"request","id":"a1_T1","op":"delete"}]'), 'error:42501');
select tst.expect('пачка атомарна', tst.gw('T2', '[{"kind":"stub","id":"a1","op":"merge","data":{"title":"Новое"}},{"kind":"stub","id":"a2","op":"merge","data":{"title":"x"}}]'), 'error:42501');
select tst.expect('…первая запись откатилась', (select data ->> 'title' from public.grok_docs where kind = 'stub' and id = 'a1'), 'Хикс');
select tst.run('T2', $q$select grok_write('W', '[{"kind":"request","id":"a2_T2","op":"set","data":{"accountId":"a2","provider":"elevenlabs","uid":"T2","status":"pending"}}]')$q$);
select tst.expect('свой ждущий — отзывается', tst.gw('T2', '[{"kind":"request","id":"a2_T2","op":"delete"}]'), 'done');

-- Голова видимости.
select tst.run('T1', $q$select 1$q$);
create temp table heads as select tst.jval('T1', $q$select grok_ids_head('W')$q$) h1;
grant select on heads to anon, authenticated;
select tst.run('O', $q$select grok_write('W', '[{"kind":"app","id":"a1","op":"merge","data":{"allowedUids":["T3"]}}]')$q$);
select tst.expect('закрыли от технаря — его голова сменилась, хотя его строк не правили',
  ((select h1 from heads) <> tst.jval('T1', $q$select grok_ids_head('W')$q$))::text, 'true');
select tst.expect('посторонний — пустая голова', tst.jval('X', $q$select grok_ids_head('W')$q$), '0:');

-- Удаление стирает данные.
select tst.expect('допущенный удаляет закрытый', tst.gw('T3', '[{"kind":"app","id":"a1","op":"delete"}]'), 'done');
select tst.expect('у удалённого пароля не осталось', (select (data ? 'password')::text || '|' || deleted from public.grok_docs where kind = 'app' and id = 'a1'), 'false|true');

-- Прямая запись закрыта.
select tst.expect('прямая вставка закрыта', tst.try('O', $q$insert into grok_docs (workspace_id, kind, id, data) values ('W','app','z','{}')$q$), 'error');
select tst.expect('прямая правка закрыта', tst.try('O', $q$update grok_docs set restricted = false$q$), 'error');
select tst.expect('API-роли не пишут таблицу',
  (has_table_privilege('anon', 'public.grok_docs', 'insert') or has_table_privilege('authenticated', 'public.grok_docs', 'update')
   or has_table_privilege('anon', 'public.grok_docs', 'truncate'))::text, 'false');

-- Перенос.
select tst.expect('Тимлид не переносит', tst.try('TL', $q$select grok_import('W', '[]', true)$q$), 'error');
select tst.expect('Owner переносит новые, не затирая свежее',
  tst.jval('O', $q$select grok_import('W', '[{"kind":"app","id":"old1","data":{"provider":"suno","email":"x","password":"y","updatedAt":3}},{"kind":"account","id":"g1","data":{"email":"old","updatedAt":1}},{"kind":"stub","id":"old1","data":{"provider":"suno","title":"t","legacy":1}},{"kind":"meta","id":"imported","data":{}}]', false)::text$q$), '2');
select tst.expect('старый аккаунт без restricted — открыт', (select restricted::text || '|' || (data ->> 'restricted') from public.grok_docs where kind = 'app' and id = 'old1'), 'false|false');
select tst.expect('лишнее поле карточки отброшено', (select (data ? 'legacy')::text from public.grok_docs where kind = 'stub' and id = 'old1'), 'false');
select tst.expect('свежее не затёрто', (select data ->> 'email' from public.grok_docs where kind = 'account' and id = 'g1'), 'a@x');
select tst.expect('meta переносом не пишется', (select count(*)::text from public.grok_docs where kind = 'meta'), '0');
select tst.run('O', $q$select grok_import('W', '[]', true)$q$);
select tst.expect('отметка «перенесено» видна технарю', tst.cnt('T1', 'kind = ''meta'''), '1');

\ir ../migrations/20261021_grok.sql
select tst.expect('версия схемы не старее 20261021', (public.nova_schema_version() >= '20261021')::text, 'true');
select tst.expect('после наката данные на месте', (select data ->> 'email' from public.grok_docs where kind = 'account' and id = 'g1'), 'a@x');

select label, got from tst.results where not ok;
select format('ПРОВЕРОК (грок): %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
