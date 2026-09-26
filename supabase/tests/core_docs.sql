-- Проверки 20261029_core_docs.sql (столы и вкладки в Supabase). Запускать
-- ПОСЛЕ desk_rows_rls.sql (W: O — Owner, TL — Тимлид, TLT — Тимлид+Технарь,
-- T1/T2/T3 — технари, OS1/OS2 — ОС, AD — Admin, V — Viewer, X — посторонний;
-- rows_page_acl: P1 (отв. T1, allowed T1,T2,T3,V, editable T3,V), P2 (отв. T2)).
\set ON_ERROR_STOP 1
set client_min_messages = warning;
truncate tst.results;

\ir ../migrations/20261029_core_docs.sql

delete from public.core_docs where workspace_id in ('W', 'W2');

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

-- Стол «как в Firestore».
create or replace function tst.pagedoc(id text, resp text, allowed text[], extra jsonb default '{}') returns jsonb language sql immutable as $$
  select jsonb_build_object('id', id, 'workspaceId', 'W', 'name', 'Стол ' || id, 'icon', 'Table', 'color', '1 2% 3%',
    'order', 0, 'allowedUsers', to_jsonb(allowed), 'responsibleUserId', resp, 'editableUsers', '[]'::jsonb,
    'columns', '[]'::jsonb, 'createdAt', 1000, 'updatedAt', 1000, 'createdBy', resp) || extra
$$;

-- ---------- Перенос (только Owner) ----------
select tst.expect('перенос — не Тимлид',
  tst.val('TL', $q$select core_import('W', '[]'::jsonb, 'imported_page', false)::text$q$), 'error:42501');
select tst.expect('перенос — не технарь',
  tst.val('T1', $q$select core_import('W', '[]'::jsonb, 'imported_page', false)::text$q$), 'error:42501');
select tst.expect('кривая отметка — отказ',
  tst.val('O', $q$select core_import('W', '[]'::jsonb, 'x', true)::text$q$), 'error:22023');
select tst.expect('Owner переносит столы и вкладки',
  tst.val('O', format($q$select core_import('W', %L::jsonb, 'imported_page', false)::text$q$,
    jsonb_build_array(
      jsonb_build_object('kind', 'page', 'id', 'P1', 'data', tst.pagedoc('P1', 'T1', array['T1','T2','T3','V'], '{"editableUsers":["T3","V"],"osFieldKeys":{"tabId":"month-2026-09","os":"os","status":"status"}}')),
      jsonb_build_object('kind', 'page', 'id', 'P2', 'data', tst.pagedoc('P2', 'T2', array['T2'])),
      jsonb_build_object('kind', 'page', 'id', 'osdesk_OS1', 'data', tst.pagedoc('osdesk_OS1', 'OS1', array['OS1'], '{"osDesk":true}')),
      jsonb_build_object('kind', 'subpage', 'id', 'month-2026-09', 'page', 'P1', 'data', '{"name":"Сентябрь 2026","order":0,"columns":[],"updatedAt":1000,"pageId":"P1","workspaceId":"W","createdBy":"T1"}'::jsonb),
      jsonb_build_object('kind', 'subpage', 'id', 'month-2026-09', 'page', 'P2', 'data', '{"name":"Сентябрь 2026","order":0,"columns":[],"updatedAt":1000,"pageId":"P2","workspaceId":"W","createdBy":"T2"}'::jsonb)
    )::text)), '5');
select tst.expect('отметки ещё нет', (select count(*)::text from public.core_docs where workspace_id = 'W' and kind = 'meta'), '0');
select tst.expect('повторный перенос — старое не заменяется (updatedAt не новее)',
  tst.val('O', format($q$select core_import('W', %L::jsonb, 'imported_page', true)::text$q$,
    jsonb_build_array(jsonb_build_object('kind', 'page', 'id', 'P1', 'data', tst.pagedoc('P1', 'T1', array['T1'], '{"name":"Старое имя"}')))::text)), '0');
select tst.expect('…имя прежнее', (select data ->> 'name' from public.core_docs where workspace_id = 'W' and kind = 'page' and id = 'P1'), 'Стол P1');
select tst.expect('отметка стоит', (select data ->> 'by' from public.core_docs where workspace_id = 'W' and kind = 'meta' and id = 'imported_page'), 'O');
select tst.expect('более свежий документ заменяет',
  tst.val('O', format($q$select core_import('W', %L::jsonb, 'imported_page', true)::text$q$,
    jsonb_build_array(jsonb_build_object('kind', 'page', 'id', 'P2', 'data', tst.pagedoc('P2', 'T2', array['T2'], '{"name":"P2 свежий","updatedAt":2000}')))::text)), '1');

-- ---------- Копия прав столов — триггером ----------
select tst.expect('копия прав P1 из документа',
  (select responsible_uid || '|' || array_to_string(allowed_uids, ',') || '|' || array_to_string(editable_uids, ',') || '|' || coalesce(os_keys_tab, '-') || '|' || coalesce(os_key, '-')
     from public.rows_page_acl where workspace_id = 'W' and page_id = 'P1'), 'T1|T1,T2,T3,V|T3,V|month-2026-09|os');
select tst.expect('стол ОС: os_desk и без карты столбцов',
  (select os_desk::text || '|' || coalesce(os_keys_tab, '-') from public.rows_page_acl where workspace_id = 'W' and page_id = 'osdesk_OS1'), 'true|-');

-- ---------- Чтение ----------
select tst.expect('участник читает столы', tst.try('V', $q$select * from public.core_docs where workspace_id = 'W' and kind = 'page'$q$, true), 'ok:3');
select tst.expect('посторонний столы не читает', tst.try('X', $q$select * from public.core_docs where workspace_id = 'W' and kind = 'page'$q$, true), 'ok:0');
select tst.expect('T1 читает вкладки своего стола', tst.try('T1', $q$select * from public.core_docs where workspace_id = 'W' and kind = 'subpage' and parent_id = 'P1'$q$, true), 'ok:1');
select tst.expect('T1 не читает вкладки чужого закрытого стола P2', tst.try('T1', $q$select * from public.core_docs where workspace_id = 'W' and kind = 'subpage' and parent_id = 'P2'$q$, true), 'ok:0');
select tst.expect('Owner читает все вкладки', tst.try('O', $q$select * from public.core_docs where workspace_id = 'W' and kind = 'subpage'$q$, true), 'ok:2');
select tst.expect('Тимлид без Технаря вкладки не видит', tst.try('TL', $q$select * from public.core_docs where workspace_id = 'W' and kind = 'subpage'$q$, true), 'ok:0');
select tst.expect('Тимлид + Технарь видит все вкладки', tst.try('TLT', $q$select * from public.core_docs where workspace_id = 'W' and kind = 'subpage'$q$, true), 'ok:2');
select tst.expect('ОС видит все вкладки (столы открыты ОС)', tst.try('OS2', $q$select * from public.core_docs where workspace_id = 'W' and kind = 'subpage'$q$, true), 'ok:2');
select tst.expect('прямая запись в таблицу закрыта', tst.try('O', $q$update public.core_docs set data = '{}' where workspace_id = 'W'$q$), 'error');
select tst.expect('прямая вставка закрыта', tst.try('O', $q$insert into public.core_docs (workspace_id, kind, id) values ('W', 'page', 'PX')$q$), 'error');

-- ---------- core_write: столы ----------
select tst.expect('посторонний не пишет', tst.val('X', $q$select core_write('W', '[]'::jsonb)::text$q$), 'error:42501');
select tst.expect('пустая пачка — ок', tst.val('V', $q$select core_write('W', '[]'::jsonb)::text$q$), '[]');
select tst.expect('ответственный переименовывает свой стол',
  tst.val('T1', $q$select core_write('W', '[{"kind":"page","id":"P1","op":"merge","data":{"name":"Мой стол","updatedAt":3000}}]'::jsonb) -> 0 -> 'data' ->> 'name'$q$), 'Мой стол');
select tst.expect('…rev вырос, старые поля целы',
  (select (rev > 0)::text || '|' || (data ->> 'responsibleUserId') from public.core_docs where workspace_id = 'W' and kind = 'page' and id = 'P1'), 'true|T1');
select tst.expect('ответственный не меняет ответственного',
  tst.val('T1', $q$select core_write('W', '[{"kind":"page","id":"P1","op":"merge","data":{"responsibleUserId":"T2"}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('ответственный не снимает osDesk/techEditable',
  tst.val('OS1', $q$select core_write('W', '[{"kind":"page","id":"osdesk_OS1","op":"merge","data":{"osDesk":false}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('ответственный не уводит стол в неактуальные',
  tst.val('T1', $q$select core_write('W', '[{"kind":"page","id":"P1","op":"merge","data":{"inactive":true}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('«то же значение» не считается изменением опорного поля',
  tst.val('T1', $q$select core_write('W', '[{"kind":"page","id":"P1","op":"merge","data":{"responsibleUserId":"T1","name":"Мой стол 2"}}]'::jsonb) -> 0 -> 'data' ->> 'name'$q$), 'Мой стол 2');
select tst.expect('редактор (не ответственный) стол не правит',
  tst.val('T3', $q$select core_write('W', '[{"kind":"page","id":"P1","op":"merge","data":{"name":"x"}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('Тимлид меняет доступ',
  tst.val('TL', $q$select core_write('W', '[{"kind":"page","id":"P1","op":"merge","data":{"allowedUsers":["T1","T2","T3","V","OS2"],"updatedAt":4000}}]'::jsonb)::text is not null$q$), 'true');
select tst.expect('…копия прав обновилась триггером',
  (select array_to_string(allowed_uids, ',') from public.rows_page_acl where workspace_id = 'W' and page_id = 'P1'), 'OS2,T1,T2,T3,V');
select tst.expect('Тимлид не правит содержимое',
  tst.val('TL', $q$select core_write('W', '[{"kind":"page","id":"P1","op":"merge","data":{"name":"x"}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('Тимлид не переназначает стол ОС',
  tst.val('TL', $q$select core_write('W', '[{"kind":"page","id":"osdesk_OS1","op":"merge","data":{"responsibleUserId":"OS2"}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('Тимлид уводит стол в неактуальные',
  tst.val('TL', $q$select core_write('W', '[{"kind":"page","id":"P2","op":"merge","data":{"inactive":true,"inactiveAt":5,"inactiveBy":"TL"}}]'::jsonb) -> 0 -> 'data' ->> 'inactive'$q$), 'true');
select tst.expect('Admin переназначает ответственного (с allowedUsers)',
  tst.val('AD', $q$select core_write('W', '[{"kind":"page","id":"P2","op":"merge","data":{"responsibleUserId":"T3","allowedUsers":["T2","T3"],"hiddenByResponsible":false,"updatedAt":6}}]'::jsonb) -> 0 -> 'data' ->> 'responsibleUserId'$q$), 'T3');
select tst.expect('Admin без смены ответственного — нет',
  tst.val('AD', $q$select core_write('W', '[{"kind":"page","id":"P2","op":"merge","data":{"allowedUsers":["T2"]}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('Admin стол ОС не переназначает',
  tst.val('AD', $q$select core_write('W', '[{"kind":"page","id":"osdesk_OS1","op":"merge","data":{"responsibleUserId":"AD","allowedUsers":["AD"]}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('Owner правит что угодно',
  tst.val('O', $q$select core_write('W', '[{"kind":"page","id":"P1","op":"merge","data":{"techEditable":true,"columns":[{"key":"a"}]}}]'::jsonb) -> 0 -> 'data' ->> 'techEditable'$q$), 'true');
select tst.expect('$del убирает поле',
  tst.val('O', $q$select coalesce(core_write('W', '[{"kind":"page","id":"P1","op":"merge","data":{"techEditable":{"$del":true}}}]'::jsonb) -> 0 -> 'data' ->> 'techEditable', '-')$q$), '-');

-- Создание.
select tst.expect('технарь заводит стол за себя',
  tst.val('T3', format($q$select core_write('W', %L::jsonb) -> 0 ->> 'id'$q$,
    jsonb_build_array(jsonb_build_object('kind', 'page', 'id', 'page_T3_new1', 'op', 'set', 'data', tst.pagedoc('page_T3_new1', 'T3', array['T3'])))::text)), 'page_T3_new1');
select tst.expect('…копия прав заведена триггером',
  (select responsible_uid from public.rows_page_acl where workspace_id = 'W' and page_id = 'page_T3_new1'), 'T3');
select tst.expect('второй стол технарю — квота',
  tst.val('T3', format($q$select core_write('W', %L::jsonb)::text$q$,
    jsonb_build_array(jsonb_build_object('kind', 'page', 'id', 'page_T3_new2', 'op', 'set', 'data', tst.pagedoc('page_T3_new2', 'T3', array['T3'])))::text)), 'error:42501');
select tst.expect('технарь не заводит стол за другого',
  tst.val('T2', format($q$select core_write('W', %L::jsonb)::text$q$,
    jsonb_build_array(jsonb_build_object('kind', 'page', 'id', 'page_T2_x', 'op', 'set', 'data', tst.pagedoc('page_T2_x', 'T1', array['T1'])))::text)), 'error:42501');
select tst.expect('стол чужого workspace — отказ',
  tst.val('O', $q$select core_write('W', '[{"kind":"page","id":"PZ","op":"set","data":{"workspaceId":"W2","name":"z"}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('Viewer столы не заводит',
  tst.val('V', format($q$select core_write('W', %L::jsonb)::text$q$,
    jsonb_build_array(jsonb_build_object('kind', 'page', 'id', 'page_V_1', 'op', 'set', 'data', tst.pagedoc('page_V_1', 'V', array['V'])))::text)), 'error:42501');
select tst.expect('ОС заводит свой стол ОС',
  tst.val('OS2', format($q$select core_write('W', %L::jsonb) -> 0 ->> 'id'$q$,
    jsonb_build_array(jsonb_build_object('kind', 'page', 'id', 'osdesk_OS2', 'op', 'set', 'data', tst.pagedoc('osdesk_OS2', 'OS2', array['OS2'], '{"osDesk":true}')))::text)), 'osdesk_OS2');
select tst.expect('ОС не заводит стол под чужим id',
  tst.val('OS2', format($q$select core_write('W', %L::jsonb)::text$q$,
    jsonb_build_array(jsonb_build_object('kind', 'page', 'id', 'osdesk_OS3', 'op', 'set', 'data', tst.pagedoc('osdesk_OS3', 'OS2', array['OS2'], '{"osDesk":true}')))::text)), 'error:42501');
select tst.expect('ОС обычный стол не заводит',
  tst.val('OS2', format($q$select core_write('W', %L::jsonb)::text$q$,
    jsonb_build_array(jsonb_build_object('kind', 'page', 'id', 'page_OS2_x', 'op', 'set', 'data', tst.pagedoc('page_OS2_x', 'OS2', array['OS2'])))::text)), 'error:42501');
select tst.expect('Admin заводит стол за себя',
  tst.val('AD', format($q$select core_write('W', %L::jsonb) -> 0 ->> 'id'$q$,
    jsonb_build_array(jsonb_build_object('kind', 'page', 'id', 'page_AD_1', 'op', 'set', 'data', tst.pagedoc('page_AD_1', 'AD', array['AD'])))::text)), 'page_AD_1');
select tst.expect('«create» существующего — возвращает как есть',
  tst.val('T3', $q$select core_write('W', '[{"kind":"page","id":"page_T3_new1","op":"create","data":{"name":"другое"}}]'::jsonb) -> 0 -> 'data' ->> 'name'$q$), 'Стол page_T3_new1');

-- Удаление.
select tst.expect('технарь стол не удаляет',
  tst.val('T3', $q$select core_write('W', '[{"kind":"page","id":"page_T3_new1","op":"delete"}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('Тимлид стол не удаляет',
  tst.val('TL', $q$select core_write('W', '[{"kind":"page","id":"page_T3_new1","op":"delete"}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('Owner удаляет стол — вместе с вкладками (в ответе и стол, и его вкладка)',
  tst.val('O', $q$select string_agg((e ->> 'kind') || ':' || (e ->> 'id') || ':' || (e ->> 'deleted'), ',' order by e ->> 'kind')
    from jsonb_array_elements(core_write('W', '[{"kind":"page","id":"P2","op":"delete"}]'::jsonb)) e$q$), 'page:P2:true,subpage:month-2026-09:true');
select tst.expect('…вкладка P2 помечена удалённой',
  (select deleted::text from public.core_docs where workspace_id = 'W' and kind = 'subpage' and parent_id = 'P2' and id = 'month-2026-09'), 'true');
select tst.expect('…копия прав P2 снята', (select count(*)::text from public.rows_page_acl where workspace_id = 'W' and page_id = 'P2'), '0');
select tst.expect('…удалённый стол не читается', tst.try('O', $q$select * from public.core_docs where workspace_id = 'W' and kind = 'page' and id = 'P2' and not deleted$q$, true), 'ok:0');
select tst.expect('удалённый id можно завести заново (set)',
  tst.val('O', format($q$select core_write('W', %L::jsonb) -> 0 ->> 'deleted'$q$,
    jsonb_build_array(jsonb_build_object('kind', 'page', 'id', 'P2', 'op', 'set', 'data', tst.pagedoc('P2', 'T2', array['T2'])))::text)), 'false');

-- ---------- core_write: вкладки ----------
select tst.expect('ответственный заводит вкладку',
  tst.val('T1', $q$select core_write('W', '[{"kind":"subpage","id":"month-2026-10","page":"P1","op":"create","data":{"name":"Октябрь","order":1,"columns":[],"pageId":"P1","workspaceId":"W","createdBy":"T1","updatedAt":1}}]'::jsonb) -> 0 ->> 'page'$q$), 'P1');
select tst.expect('редактор правит вкладку',
  tst.val('T3', $q$select core_write('W', '[{"kind":"subpage","id":"month-2026-10","page":"P1","op":"merge","data":{"name":"Октябрь 2026"}}]'::jsonb) -> 0 -> 'data' ->> 'name'$q$), 'Октябрь 2026');
select tst.expect('редактор не меняет опорные поля вкладки',
  tst.val('T3', $q$select core_write('W', '[{"kind":"subpage","id":"month-2026-10","page":"P1","op":"merge","data":{"personalOwnerUid":"T3"}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('зритель (allowed, не editable) вкладку не правит',
  tst.val('T2', $q$select core_write('W', '[{"kind":"subpage","id":"month-2026-10","page":"P1","op":"merge","data":{"name":"x"}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('Тимлид без Технаря вкладки не правит',
  tst.val('TL', $q$select core_write('W', '[{"kind":"subpage","id":"month-2026-10","page":"P1","op":"merge","data":{"name":"x"}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('вкладка без стола — отказ',
  tst.val('O', $q$select core_write('W', '[{"kind":"subpage","id":"m","page":"NOPE","op":"set","data":{"name":"x"}}]'::jsonb)::text$q$), 'error:P0002');
select tst.expect('вкладка без page — отказ',
  tst.val('O', $q$select core_write('W', '[{"kind":"subpage","id":"m","op":"set","data":{"name":"x"}}]'::jsonb)::text$q$), 'error:22023');
select tst.expect('«create» той же вкладки второй раз — прежняя',
  tst.val('T1', $q$select core_write('W', '[{"kind":"subpage","id":"month-2026-10","page":"P1","op":"create","data":{"name":"Заново"}}]'::jsonb) -> 0 -> 'data' ->> 'name'$q$), 'Октябрь 2026');
select tst.expect('редактор удаляет вкладку',
  tst.val('T3', $q$select core_write('W', '[{"kind":"subpage","id":"month-2026-10","page":"P1","op":"delete"}]'::jsonb) -> 0 ->> 'deleted'$q$), 'true');
select tst.expect('Owner видит удалённую как deleted в выборке с флагом',
  tst.try('O', $q$select * from public.core_docs where workspace_id = 'W' and kind = 'subpage' and id = 'month-2026-10' and deleted$q$, true), 'ok:1');

-- Неживое хранилище / приостановленная компания — запись закрыта.
update public.rows_workspaces set status = 'suspended' where workspace_id = 'W';
select tst.expect('приостановленная компания: столы не пишутся',
  tst.val('O', $q$select core_write('W', '[{"kind":"page","id":"P1","op":"merge","data":{"name":"x"}}]'::jsonb)::text$q$), 'error:42501');
update public.rows_workspaces set status = 'active' where workspace_id = 'W';
select tst.expect('…снова активна — пишется',
  tst.val('O', $q$select core_write('W', '[{"kind":"page","id":"P1","op":"merge","data":{"name":"Стол P1"}}]'::jsonb) -> 0 -> 'data' ->> 'name'$q$), 'Стол P1');

-- ---------- Повторный накат ----------
\ir ../migrations/20261029_core_docs.sql
select tst.expect('после наката документы на месте', (select count(*)::text from public.core_docs where workspace_id = 'W' and kind = 'page' and not deleted), '6');
select tst.expect('версия схемы не старее 20261029', (public.nova_schema_version() >= '20261029')::text, 'true');

select label, got from tst.results where not ok;
select format('ПРОВЕРОК (ядро: столы и вкладки): %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
