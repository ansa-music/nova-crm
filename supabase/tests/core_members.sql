-- Проверки 20261030_core_members.sql (участники, приглашения, заявки и
-- настройки workspace в core_docs). Запускать ПОСЛЕ desk_rows_rls.sql
-- (W: O — создатель, TL — Тимлид, TLT — Тимлид+Технарь, T1/T2/T3 — технари,
-- OS1/OS2 — ОС, AD — Admin, V — Viewer, X — посторонний; W2 — DOCOWNER).
\set ON_ERROR_STOP 1
set client_min_messages = warning;
truncate tst.results;

\ir ../migrations/20261030_core_members.sql
-- Список полей настроек «только Owner» — самый новый (шансы «Рандома»).
\ir ../migrations/20261043_random_settings.sql

delete from public.core_docs where workspace_id in ('W', 'W2');

-- Токен с почтой: uid@x.io (приглашения ищутся по ней).
create or replace function tst.claims(uid text) returns text language sql immutable as $$
  select case
    when uid = '__anon_key__' then '{"iss":"supabase","role":"anon"}'
    when uid like '__forged__:%' then json_build_object(
      'iss', 'https://securetoken.google.com/other-project', 'aud', 'other-project',
      'sub', substr(uid, 12), 'role', 'anon')::text
    else json_build_object(
      'iss', 'https://securetoken.google.com/nurba-6e70d', 'aud', 'nurba-6e70d',
      'sub', uid, 'role', 'anon', 'email', lower(uid) || '@x.io', 'email_verified', true)::text
  end
$$;

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

-- Документ участника «как в Firestore».
create or replace function tst.memberdoc(uid text, role text, extra jsonb default '{}') returns jsonb language sql immutable as $$
  select jsonb_build_object('uid', uid, 'email', lower(uid) || '@x.io', 'name', 'Имя ' || uid, 'role', role, 'status', 'active',
    'invitedAt', 1000, 'invitedBy', 'O', 'joinedAt', 1000) || extra
$$;

-- ---------- Перенос (только Owner): участники, приглашение, заявка, настройки ----------
select tst.expect('перенос — не Тимлид',
  tst.val('TL', $q$select core_import('W', '[]'::jsonb, 'imported_member', false)::text$q$), 'error:42501');
select tst.expect('Owner переносит участников, приглашение, заявку и настройки',
  tst.val('O', format($q$select core_import('W', %L::jsonb, 'imported_member', true)::text$q$,
    jsonb_build_array(
      jsonb_build_object('kind', 'member', 'id', 'O', 'data', tst.memberdoc('O', 'owner')),
      jsonb_build_object('kind', 'member', 'id', 'TL', 'data', tst.memberdoc('TL', 'teamlead')),
      jsonb_build_object('kind', 'member', 'id', 'TLT', 'data', tst.memberdoc('TLT', 'teamlead', '{"extraRoles":["manager"]}')),
      jsonb_build_object('kind', 'member', 'id', 'T1', 'data', tst.memberdoc('T1', 'manager', '{"techNick":"Тимур","techNickValue":"opt_t1"}')),
      jsonb_build_object('kind', 'member', 'id', 'T2', 'data', tst.memberdoc('T2', 'manager')),
      jsonb_build_object('kind', 'member', 'id', 'T3', 'data', tst.memberdoc('T3', 'manager')),
      jsonb_build_object('kind', 'member', 'id', 'OS1', 'data', tst.memberdoc('OS1', 'os', '{"osNick":"Оля","osNickValue":"opt_os1"}')),
      jsonb_build_object('kind', 'member', 'id', 'OS2', 'data', tst.memberdoc('OS2', 'os')),
      jsonb_build_object('kind', 'member', 'id', 'AD', 'data', tst.memberdoc('AD', 'admin')),
      jsonb_build_object('kind', 'member', 'id', 'V', 'data', tst.memberdoc('V', 'viewer')),
      jsonb_build_object('kind', 'invite', 'id', 'NEW@x.io', 'data', '{"email":"new@x.io","name":"new","role":"manager","status":"invited","invitedAt":5,"invitedBy":"TL","inviteToken":"inv_1"}'::jsonb),
      jsonb_build_object('kind', 'join', 'id', 'J1', 'data', '{"id":"J1","uid":"J1","email":"j1@x.io","name":"Заявитель","workspaceId":"W","status":"pending","requestedAt":7,"requestedRole":"os","requestedNick":"Джей"}'::jsonb),
      jsonb_build_object('kind', 'workspace', 'id', 'W', 'data', '{"ownerId":"HACK","rowsBackend":"firestore","name":"Студия","statusOptions":[{"value":"new","label":"Новый","color":"1 2% 3%"}],"responsibleOptions":[{"value":"opt_os1","label":"Оля","color":"2 3% 4%"}],"techNickOptions":[{"value":"opt_t1","label":"Тимур","color":"3 4% 5%"}],"scheduleSettings":{"editors":["OS1"]},"osManagedDesks":true,"region":{"timeZone":"Europe/Moscow","currency":"RUB","locale":"ru-RU"}}'::jsonb)
    )::text)), '13');
select tst.expect('отметка стоит', (select data ->> 'by' from public.core_docs where workspace_id = 'W' and kind = 'meta' and id = 'imported_member'), 'O');
select tst.expect('управляющие поля в настройки не попали',
  (select (data ? 'ownerId')::text || '|' || (data ? 'rowsBackend')::text || '|' || (data ? 'name')::text from public.core_docs where workspace_id = 'W' and kind = 'workspace'), 'false|false|false');
select tst.expect('почта приглашения — в нижнем регистре', (select count(*)::text from public.core_docs where workspace_id = 'W' and kind = 'invite' and id = 'new@x.io'), '1');
select tst.expect('повторный перенос участника не заменяет (даже с подделанным updatedAt)',
  tst.val('O', format($q$select core_import('W', %L::jsonb, 'imported_member', true)::text$q$,
    jsonb_build_array(jsonb_build_object('kind', 'member', 'id', 'T2', 'data', tst.memberdoc('T2', 'viewer', '{"updatedAt":9000000000000000}')))::text)), '0');
select tst.expect('…роль прежняя', (select data ->> 'role' from public.core_docs where workspace_id = 'W' and kind = 'member' and id = 'T2'), 'manager');
-- Выданный Owner переносить может, но записи Owner — нет.
select tst.run('O', $q$select core_write('W', '[{"kind":"member","id":"AD","op":"merge","data":{"role":"owner"}}]'::jsonb)$q$);
select tst.expect('выданный Owner переносит обычного участника',
  tst.val('AD', format($q$select core_import('W', %L::jsonb, 'imported_member', false)::text$q$,
    jsonb_build_array(jsonb_build_object('kind', 'member', 'id', 'IMP1', 'data', tst.memberdoc('IMP1', 'viewer')))::text)), '1');
select tst.expect('выданный Owner не переносит запись с ролью Owner',
  tst.val('AD', format($q$select core_import('W', %L::jsonb, 'imported_member', false)::text$q$,
    jsonb_build_array(jsonb_build_object('kind', 'member', 'id', 'FRIEND', 'data', tst.memberdoc('FRIEND', 'owner')))::text)), '0');
select tst.expect('…и не заводит её в копии прав', (select count(*)::text from public.rows_members where workspace_id = 'W' and uid = 'FRIEND'), '0');
select tst.run('O', $q$select core_write('W', '[{"kind":"member","id":"AD","op":"merge","data":{"role":"admin"}}]'::jsonb)$q$);
-- Служебного участника убираем насовсем (не мягко), чтобы счётчики ростера ниже не сдвинулись.
delete from public.core_docs where workspace_id = 'W' and kind = 'member' and id = 'IMP1';
delete from public.rows_members where workspace_id = 'W' and uid = 'IMP1';

-- ---------- Триггеры: копия прав и настроек ----------
select tst.expect('копия прав: ник ОС и вторая роль из документа',
  (select coalesce(os_nick_value, '-') || '|' || array_to_string(extra_roles, ',') from public.rows_members where workspace_id = 'W' and uid = 'OS1')
  || '|' || (select array_to_string(extra_roles, ',') from public.rows_members where workspace_id = 'W' and uid = 'TLT'), 'opt_os1||manager');
select tst.expect('копия настроек: редакторы графика, режим, регион',
  (select array_to_string(schedule_editors, ',') || '|' || os_managed::text || '|' || tech_fills_all::text || '|' || timezone || '|' || currency || '|' || locale
     from public.rows_workspaces where workspace_id = 'W'), 'OS1|true|false|Europe/Moscow|RUB|ru-RU');

-- ---------- Чтение ----------
select tst.expect('участник читает ростер', tst.try('V', $q$select * from public.core_docs where workspace_id = 'W' and kind = 'member'$q$, true), 'ok:10');
select tst.expect('участник читает приглашения', tst.try('V', $q$select * from public.core_docs where workspace_id = 'W' and kind = 'invite'$q$, true), 'ok:1');
select tst.expect('участник читает настройки', tst.try('V', $q$select * from public.core_docs where workspace_id = 'W' and kind = 'workspace'$q$, true), 'ok:1');
select tst.expect('посторонний ростер не читает', tst.try('X', $q$select * from public.core_docs where workspace_id = 'W' and kind = 'member'$q$, true), 'ok:0');
select tst.expect('настройки читает и посторонний (как документ workspace в Firestore)', tst.try('X', $q$select * from public.core_docs where workspace_id = 'W' and kind = 'workspace'$q$, true), 'ok:1');
select tst.expect('без входа настройки не читаются', tst.try('__anon_key__', $q$select * from public.core_docs where workspace_id = 'W' and kind = 'workspace'$q$, true), 'ok:0');
select tst.expect('посторонний отметку переноса читает', tst.try('X', $q$select * from public.core_docs where workspace_id = 'W' and kind = 'meta'$q$, true), 'ok:1');
select tst.expect('адресат читает своё приглашение', tst.try('NEW', $q$select * from public.core_docs where workspace_id = 'W' and kind = 'invite'$q$, true), 'ok:1');
select tst.expect('чужое приглашение постороннему не видно', tst.try('X', $q$select * from public.core_docs where workspace_id = 'W' and kind = 'invite'$q$, true), 'ok:0');
select tst.expect('заявитель читает свою заявку', tst.try('J1', $q$select * from public.core_docs where workspace_id = 'W' and kind = 'join'$q$, true), 'ok:1');
select tst.expect('технарь заявки не читает', tst.try('T1', $q$select * from public.core_docs where workspace_id = 'W' and kind = 'join'$q$, true), 'ok:0');
select tst.expect('Тимлид заявки читает', tst.try('TL', $q$select * from public.core_docs where workspace_id = 'W' and kind = 'join'$q$, true), 'ok:1');
select tst.expect('Owner заявки читает', tst.try('O', $q$select * from public.core_docs where workspace_id = 'W' and kind = 'join'$q$, true), 'ok:1');

-- ---------- Настройки workspace ----------
select tst.expect('Owner правит статусы',
  tst.val('O', $q$select core_write('W', '[{"kind":"workspace","id":"W","op":"merge","data":{"statusOptions":[{"value":"new","label":"Новый","color":"1 2% 3%"},{"value":"done","label":"Готово","color":"5 5% 5%"}]}}]'::jsonb) -> 0 -> 'data' -> 'statusOptions' ->> 1$q$), '{"color": "5 5% 5%", "label": "Готово", "value": "done"}');
select tst.expect('Тимлид правит ники «Другие»',
  tst.val('TL', $q$select core_write('W', '[{"kind":"workspace","id":"W","op":"merge","data":{"otherNickOptions":[{"value":"o1","label":"Босс","color":"1 1% 1%"}]}}]'::jsonb) -> 0 -> 'data' -> 'otherNickOptions' -> 0 ->> 'label'$q$), 'Босс');
select tst.expect('Тимлид не трогает кассу',
  tst.val('TL', $q$select core_write('W', '[{"kind":"workspace","id":"W","op":"merge","data":{"paymentMethods":[]}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('Тимлид не трогает шансы «Рандома»',
  tst.val('TL', $q$select core_write('W', '[{"kind":"workspace","id":"W","op":"merge","data":{"randomSettings":{"fewerOrdersBoost":1}}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('Owner правит шансы «Рандома»',
  tst.val('O', $q$select core_write('W', '[{"kind":"workspace","id":"W","op":"merge","data":{"randomSettings":{"weights":{"T1":2}}}}]'::jsonb) -> 0 -> 'data' -> 'randomSettings' -> 'weights' ->> 'T1'$q$), '2');
select tst.expect('Тимлид не трогает периоды',
  tst.val('TL', $q$select core_write('W', '[{"kind":"workspace","id":"W","op":"merge","data":{"periods":{"mode":"half"}}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('технарь настройки не правит',
  tst.val('T1', $q$select core_write('W', '[{"kind":"workspace","id":"W","op":"merge","data":{"statusOptions":[]}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('управляющее поле в настройках — отказ',
  tst.val('O', $q$select core_write('W', '[{"kind":"workspace","id":"W","op":"merge","data":{"rowsBackend":"firestore"}}]'::jsonb)::text$q$), 'error:22023');
select tst.expect('настройки под чужим id — отказ',
  tst.val('O', $q$select core_write('W', '[{"kind":"workspace","id":"W2","op":"merge","data":{"statusOptions":[]}}]'::jsonb)::text$q$), 'error:22023');
select tst.expect('настройки не удаляются',
  tst.val('O', $q$select core_write('W', '[{"kind":"workspace","id":"W","op":"delete"}]'::jsonb)::text$q$), 'error:22023');
select tst.expect('$del снимает поле (accentColor)',
  tst.val('O', $q$select coalesce(core_write('W', '[{"kind":"workspace","id":"W","op":"merge","data":{"accentColor":"1 2% 3%"}},{"kind":"workspace","id":"W","op":"merge","data":{"accentColor":{"$del":true}}}]'::jsonb) -> 1 -> 'data' ->> 'accentColor', '-')$q$), '-');
select tst.expect('Owner меняет режим столов',
  tst.val('O', $q$select core_write('W', '[{"kind":"workspace","id":"W","op":"merge","data":{"osManagedDesks":false,"techFillsAll":true}}]'::jsonb) -> 0 -> 'data' ->> 'techFillsAll'$q$), 'true');
select tst.expect('…копия в rows_workspaces', (select os_managed::text || '|' || tech_fills_all::text from public.rows_workspaces where workspace_id = 'W'), 'false|true');
select tst.expect('кривой регион не роняет запись',
  tst.val('O', $q$select core_write('W', '[{"kind":"workspace","id":"W","op":"merge","data":{"region":{"timeZone":"Mars/Olympus","currency":"rub"}}}]'::jsonb) -> 0 -> 'data' -> 'region' ->> 'timeZone'$q$), 'Mars/Olympus');
select tst.expect('…и не портит копию', (select timezone || '|' || currency from public.rows_workspaces where workspace_id = 'W'), 'Europe/Moscow|RUB');

-- ---------- Участники: самообслуживание ----------
select tst.expect('технарь меняет свой ник и фото',
  tst.val('T2', $q$select core_write('W', '[{"kind":"member","id":"T2","op":"merge","data":{"nickname":"Тим","photoURL":"http://x/p.png","hiddenPageIds":["P1"],"lastActiveAt":5}}]'::jsonb) -> 0 -> 'data' ->> 'nickname'$q$), 'Тим');
select tst.expect('технарь свою роль не меняет',
  tst.val('T2', $q$select core_write('W', '[{"kind":"member","id":"T2","op":"merge","data":{"role":"owner"}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('технарь режим роли не включает',
  tst.val('T2', $q$select core_write('W', '[{"kind":"member","id":"T2","op":"merge","data":{"activeRole":"viewer"}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('Owner включает режим роли',
  tst.val('O', $q$select core_write('W', '[{"kind":"member","id":"O","op":"merge","data":{"activeRole":"manager"}}]'::jsonb) -> 0 -> 'data' ->> 'activeRole'$q$), 'manager');
select tst.expect('снять режим роли (null) можно любому',
  tst.val('O', $q$select coalesce(core_write('W', '[{"kind":"member","id":"O","op":"merge","data":{"activeRole":null}}]'::jsonb) -> 0 -> 'data' ->> 'activeRole', '-')$q$), '-');
select tst.expect('технарь чужую запись не правит',
  tst.val('T2', $q$select core_write('W', '[{"kind":"member","id":"T3","op":"merge","data":{"nickname":"x"}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('технарь сам себе ник технаря не вписывает',
  tst.val('T2', $q$select core_write('W', '[{"kind":"member","id":"T2","op":"merge","data":{"techNickValue":"opt_t1"}}]'::jsonb)::text$q$), 'error:42501');

-- ---------- Участники: Тимлид ----------
select tst.expect('Тимлид меняет роль технарю',
  tst.val('TL', $q$select core_write('W', '[{"kind":"member","id":"T3","op":"merge","data":{"role":"os"}}]'::jsonb) -> 0 -> 'data' ->> 'role'$q$), 'os');
select tst.expect('…копия прав догнала', (select role from public.rows_members where workspace_id = 'W' and uid = 'T3'), 'os');
select tst.expect('Тимлид ставит вторую роль',
  tst.val('TL', $q$select core_write('W', '[{"kind":"member","id":"T3","op":"merge","data":{"extraRoles":["manager"]}}]'::jsonb) -> 0 -> 'data' -> 'extraRoles' ->> 0$q$), 'manager');
select tst.expect('…и в копии', (select array_to_string(extra_roles, ',') from public.rows_members where workspace_id = 'W' and uid = 'T3'), 'manager');
select tst.expect('вторая роль только Технарь/ОС',
  tst.val('TL', $q$select core_write('W', '[{"kind":"member","id":"T3","op":"merge","data":{"extraRoles":["admin"]}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('Тимлид не выдаёт Owner',
  tst.val('TL', $q$select core_write('W', '[{"kind":"member","id":"T3","op":"merge","data":{"role":"owner"}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('Тимлид не трогает создателя',
  tst.val('TL', $q$select core_write('W', '[{"kind":"member","id":"O","op":"merge","data":{"nickname":"x"}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('Тимлид не меняет свою роль',
  tst.val('TL', $q$select core_write('W', '[{"kind":"member","id":"TL","op":"merge","data":{"role":"owner"}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('Тимлид не ставит себе ник ОС',
  tst.val('TL', $q$select core_write('W', '[{"kind":"member","id":"TL","op":"merge","data":{"osNickValue":"opt_os1"}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('Тимлид меняет себе ник (самообслуживание)',
  tst.val('TL', $q$select core_write('W', '[{"kind":"member","id":"TL","op":"merge","data":{"nickname":"Лид"}}]'::jsonb) -> 0 -> 'data' ->> 'nickname'$q$), 'Лид');
select tst.expect('Тимлид заводит участника',
  tst.val('TL', format($q$select core_write('W', %L::jsonb) -> 0 ->> 'id'$q$,
    jsonb_build_array(jsonb_build_object('kind', 'member', 'id', 'N1', 'op', 'set', 'data', tst.memberdoc('N1', 'viewer')))::text)), 'N1');
select tst.expect('…N1 в копии прав', (select role from public.rows_members where workspace_id = 'W' and uid = 'N1'), 'viewer');
select tst.expect('uid участника не совпадает с id — отказ',
  tst.val('TL', $q$select core_write('W', '[{"kind":"member","id":"N2","op":"set","data":{"uid":"N9","role":"viewer","email":"n2@x.io"}}]'::jsonb)::text$q$), 'error:22023');
select tst.expect('участник без роли — отказ',
  tst.val('TL', $q$select core_write('W', '[{"kind":"member","id":"N2","op":"set","data":{"uid":"N2","email":"n2@x.io"}}]'::jsonb)::text$q$), 'error:22023');
select tst.expect('Тимлид убирает участника',
  tst.val('TL', $q$select core_write('W', '[{"kind":"member","id":"N1","op":"delete"}]'::jsonb) -> 0 ->> 'deleted'$q$), 'true');
select tst.expect('…и из копии прав', (select count(*)::text from public.rows_members where workspace_id = 'W' and uid = 'N1'), '0');
select tst.expect('Тимлид не убирает себя',
  tst.val('TL', $q$select core_write('W', '[{"kind":"member","id":"TL","op":"delete"}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('Admin участников не ведёт',
  tst.val('AD', $q$select core_write('W', '[{"kind":"member","id":"T2","op":"merge","data":{"role":"viewer"}}]'::jsonb)::text$q$), 'error:42501');

-- ---------- Участники: выданный Owner и создатель ----------
select tst.expect('создатель выдаёт Owner',
  tst.val('O', $q$select core_write('W', '[{"kind":"member","id":"AD","op":"merge","data":{"role":"owner"}}]'::jsonb) -> 0 -> 'data' ->> 'role'$q$), 'owner');
select tst.expect('выданный Owner правит технаря',
  tst.val('AD', $q$select core_write('W', '[{"kind":"member","id":"T2","op":"merge","data":{"role":"admin"}}]'::jsonb) -> 0 -> 'data' ->> 'role'$q$), 'admin');
select tst.expect('выданный Owner не выдаёт Owner',
  tst.val('AD', $q$select core_write('W', '[{"kind":"member","id":"T2","op":"merge","data":{"role":"owner"}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('выданный Owner не трогает создателя',
  tst.val('AD', $q$select core_write('W', '[{"kind":"member","id":"O","op":"merge","data":{"role":"viewer"}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('выданный Owner правит себе вторую роль',
  tst.val('AD', $q$select core_write('W', '[{"kind":"member","id":"AD","op":"merge","data":{"extraRoles":["manager"]}}]'::jsonb) -> 0 -> 'data' -> 'extraRoles' ->> 0$q$), 'manager');
select tst.expect('выданный Owner не снимает себе роль',
  tst.val('AD', $q$select core_write('W', '[{"kind":"member","id":"AD","op":"merge","data":{"role":"admin"}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('создатель забирает Owner',
  tst.val('O', $q$select core_write('W', '[{"kind":"member","id":"AD","op":"merge","data":{"role":"admin","extraRoles":{"$del":true}}}]'::jsonb) -> 0 -> 'data' ->> 'role'$q$), 'admin');
select tst.expect('T2 обратно в технари', tst.val('O', $q$select core_write('W', '[{"kind":"member","id":"T2","op":"merge","data":{"role":"manager"}}]'::jsonb) -> 0 -> 'data' ->> 'role'$q$), 'manager');

-- ---------- Приглашения по почте ----------
select tst.expect('Тимлид приглашает',
  tst.val('TL', $q$select core_write('W', '[{"kind":"invite","id":"guest@x.io","op":"set","data":{"email":"guest@x.io","name":"guest","role":"viewer","status":"invited","invitedAt":1,"invitedBy":"TL","inviteToken":"inv_2"}}]'::jsonb) -> 0 ->> 'id'$q$), 'guest@x.io');
select tst.expect('приглашение с ролью Owner — только создатель',
  tst.val('TL', $q$select core_write('W', '[{"kind":"invite","id":"boss@x.io","op":"set","data":{"email":"boss@x.io","role":"owner","status":"invited"}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('кривая почта — отказ',
  tst.val('TL', $q$select core_write('W', '[{"kind":"invite","id":"not-mail","op":"set","data":{"email":"not-mail","role":"viewer","status":"invited"}}]'::jsonb)::text$q$), 'error:22023');
select tst.expect('технарь не приглашает',
  tst.val('T1', $q$select core_write('W', '[{"kind":"invite","id":"z@x.io","op":"set","data":{"email":"z@x.io","role":"viewer","status":"invited"}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('приглашение в копию прав не попадает', (select count(*)::text from public.rows_members where workspace_id = 'W' and uid like '%@%'), '0');
select tst.expect('Тимлид отзывает приглашение',
  tst.val('TL', $q$select core_write('W', '[{"kind":"invite","id":"guest@x.io","op":"delete"}]'::jsonb) -> 0 ->> 'deleted'$q$), 'true');
-- Принять приглашение — тот, кому оно адресовано.
select tst.expect('чужой почте приглашений нет',
  tst.val('X', $q$select core_claim_invites('Икс', null, null)::text$q$), '[]');
select tst.expect('адресат принимает приглашение',
  tst.val('NEW', $q$select core_claim_invites('Новичок', 'http://x/a.png', 'Нов')::text$q$), '["W"]');
select tst.expect('…участник заведён с ролью приглашения, без токена',
  (select (data ->> 'role') || '|' || (data ->> 'status') || '|' || (data ->> 'name') || '|' || (data ? 'inviteToken')::text || '|' || (data ->> 'nickname')
     from public.core_docs where workspace_id = 'W' and kind = 'member' and id = 'NEW'), 'manager|active|Новичок|false|Нов');
select tst.expect('…приглашение погашено', (select deleted::text from public.core_docs where workspace_id = 'W' and kind = 'invite' and id = 'new@x.io'), 'true');
select tst.expect('…и в копии прав', (select role from public.rows_members where workspace_id = 'W' and uid = 'NEW'), 'manager');
select tst.expect('повтор — пусто', tst.val('NEW', $q$select core_claim_invites(null, null, null)::text$q$), '[]');

-- ---------- Заявки на вход ----------
select tst.expect('посторонний подаёт заявку',
  tst.val('J2', $q$select core_write('W', '[{"kind":"join","id":"J2","op":"set","data":{"id":"J2","uid":"J2","email":"j2@x.io","name":"Джей 2","photoURL":null,"workspaceId":"W","status":"pending","requestedAt":9,"requestedRole":"manager","requestedNick":"Джей2"}}]'::jsonb) -> 0 -> 'data' ->> 'status'$q$), 'pending');
select tst.expect('заявка без uid — отказ',
  tst.val('J3', $q$select core_write('W', '[{"kind":"join","id":"J3","op":"set","data":{"id":"J3","email":"j3@x.io","workspaceId":"W","status":"pending","requestedAt":9}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('Тимлид не заводит заявку за другого',
  tst.val('TL', $q$select core_write('W', '[{"kind":"join","id":"SOMEONE","op":"set","data":{"id":"SOMEONE","uid":"SOMEONE","email":"someone@x.io","workspaceId":"W","status":"pending","requestedAt":9}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('заявка с чужой почтой — отказ',
  tst.val('J3', $q$select core_write('W', '[{"kind":"join","id":"J3","op":"set","data":{"id":"J3","uid":"J3","email":"other@x.io","workspaceId":"W","status":"pending","requestedAt":9}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('заявка за другого — отказ',
  tst.val('J3', $q$select core_write('W', '[{"kind":"join","id":"J4","op":"set","data":{"id":"J4","uid":"J4","email":"j4@x.io","workspaceId":"W","status":"pending","requestedAt":9}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('заявка сразу «approved» — отказ',
  tst.val('J3', $q$select core_write('W', '[{"kind":"join","id":"J3","op":"set","data":{"id":"J3","uid":"J3","email":"j3@x.io","workspaceId":"W","status":"approved","requestedAt":9}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('лишнее поле в заявке — отказ',
  tst.val('J3', $q$select core_write('W', '[{"kind":"join","id":"J3","op":"set","data":{"id":"J3","uid":"J3","email":"j3@x.io","workspaceId":"W","status":"pending","requestedAt":9,"role":"owner"}}]'::jsonb)::text$q$), 'error:22023');
select tst.expect('роль в заявке — только Технарь/ОС',
  tst.val('J3', $q$select core_write('W', '[{"kind":"join","id":"J3","op":"set","data":{"id":"J3","uid":"J3","email":"j3@x.io","workspaceId":"W","status":"pending","requestedAt":9,"requestedRole":"admin"}}]'::jsonb)::text$q$), 'error:22023');
select tst.expect('заявитель правит свою ждущую заявку',
  tst.val('J2', $q$select core_write('W', '[{"kind":"join","id":"J2","op":"merge","data":{"requestedNick":"Джей-2"}}]'::jsonb) -> 0 -> 'data' ->> 'requestedNick'$q$), 'Джей-2');
select tst.expect('Тимлид отклоняет заявку',
  tst.val('TL', $q$select core_write('W', '[{"kind":"join","id":"J2","op":"merge","data":{"status":"rejected","resolvedAt":10,"resolvedBy":"TL"}}]'::jsonb) -> 0 -> 'data' ->> 'status'$q$), 'rejected');
select tst.expect('после отказа можно подать заново',
  tst.val('J2', $q$select core_write('W', '[{"kind":"join","id":"J2","op":"set","data":{"id":"J2","uid":"J2","email":"j2@x.io","name":"Джей 2","workspaceId":"W","status":"pending","requestedAt":11,"requestedRole":"os"}}]'::jsonb) -> 0 -> 'data' ->> 'status'$q$), 'pending');
select tst.expect('технарь чужую заявку не рассматривает',
  tst.val('T1', $q$select core_write('W', '[{"kind":"join","id":"J2","op":"merge","data":{"status":"approved"}}]'::jsonb)::text$q$), 'error:42501');
-- Одобрение — одной функцией: участник + ник в список + заявка.
select tst.expect('Тимлид одобряет заявку с новым ником ОС',
  tst.val('TL', $q$select core_approve_join('W', 'J2', 'os', '{"newNick":"Джей"}'::jsonb)::text$q$), '{"nickLabel": "Джей"}');
select tst.expect('…участник с ником ОС',
  (select (data ->> 'role') || '|' || (data ->> 'osNick') || '|' || (data ->> 'invitedBy') from public.core_docs where workspace_id = 'W' and kind = 'member' and id = 'J2'), 'os|Джей|TL');
select tst.expect('…ник дописан в «Ответственный»',
  (select count(*)::text from public.core_docs c, jsonb_array_elements(c.data -> 'responsibleOptions') o where c.workspace_id = 'W' and c.kind = 'workspace' and o ->> 'label' = 'Джей'), '1');
select tst.expect('…копия прав знает ник ОС',
  (select (os_nick_value is not null)::text from public.rows_members where workspace_id = 'W' and uid = 'J2'), 'true');
select tst.expect('…заявка одобрена', (select (data ->> 'status') || '|' || (data ->> 'approvedNick') from public.core_docs where workspace_id = 'W' and kind = 'join' and id = 'J2'), 'approved|Джей');
select tst.expect('одобрить второй раз нельзя',
  tst.val('TL', $q$select core_approve_join('W', 'J2', 'os', null)::text$q$), 'error:P0002');
select tst.expect('одобрение с занятым ником — отказ',
  tst.val('TL', $q$select core_approve_join('W', 'J1', 'os', '{"optionValue":"opt_os1"}'::jsonb)::text$q$), 'error:23505');
select tst.expect('технарь заявки не одобряет',
  tst.val('T1', $q$select core_approve_join('W', 'J1', 'os', null)::text$q$), 'error:42501');
select tst.expect('Тимлид одобряет без ника',
  tst.val('TL', $q$select core_approve_join('W', 'J1', 'manager', null)::text$q$), '{"nickLabel": null}');
-- Заявку за другого не заводит даже создатель (правило «только от себя») — старая заявка приходит переносом.
select tst.expect('создатель заявку за другого не заводит',
  tst.val('O', $q$select core_write('W', '[{"kind":"join","id":"T1","op":"set","data":{"id":"T1","uid":"T1","email":"t1@x.io","workspaceId":"W","status":"pending","requestedAt":1}}]'::jsonb)::text$q$), 'error:42501');
select tst.run('O', $q$select core_import('W', '[{"kind":"join","id":"T1","data":{"id":"T1","uid":"T1","email":"t1@x.io","workspaceId":"W","status":"pending","requestedAt":1}}]'::jsonb, 'imported_member', false)$q$);
select tst.expect('одобрение поверх живого участника — отказ',
  tst.val('TL', $q$select core_approve_join('W', 'T1', 'manager', null)::text$q$), 'error:23505');
select tst.expect('участник новую заявку не подаёт (уже одобрен и участник)',
  tst.val('J2', $q$select core_write('W', '[{"kind":"join","id":"J2","op":"set","data":{"id":"J2","uid":"J2","email":"j2@x.io","workspaceId":"W","status":"pending","requestedAt":12}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('заявитель убирает свою заявку',
  tst.val('J1', $q$select core_write('W', '[{"kind":"join","id":"J1","op":"delete"}]'::jsonb) -> 0 ->> 'deleted'$q$), 'true');

-- ---------- Ники ----------
select tst.expect('Тимлид заводит свободный ник технаря',
  tst.val('TL', $q$select core_nick_add('W', 'tech', ' Данияр ') ->> 'label'$q$), 'Данияр');
select tst.expect('дубль ника — отказ', tst.val('TL', $q$select core_nick_add('W', 'tech', 'данияр')::text$q$), 'error:23505');
select tst.expect('технарь ники не заводит', tst.val('T1', $q$select core_nick_add('W', 'tech', 'Ещё')::text$q$), 'error:42501');
select tst.expect('Тимлид закрепляет существующий ник за T2',
  tst.val('TL', $q$select core_nick_link('W', 'T2', 'tech', jsonb_build_object('optionValue', (select o ->> 'value' from public.core_docs c, jsonb_array_elements(c.data -> 'techNickOptions') o where c.workspace_id = 'W' and c.kind = 'workspace' and o ->> 'label' = 'Данияр'))) ->> 'label'$q$), 'Данияр');
select tst.expect('занятый ник за другим — отказ',
  tst.val('TL', $q$select core_nick_link('W', 'T3', 'tech', '{"newNick":"данияр"}'::jsonb)::text$q$), 'error:23505');
select tst.expect('новый ник — дописывается в список',
  tst.val('TL', $q$select core_nick_link('W', 'T3', 'tech', '{"newNick":"Санжар"}'::jsonb) ->> 'label'$q$), 'Санжар');
select tst.expect('…в документе участника', (select data ->> 'techNick' from public.core_docs where workspace_id = 'W' and kind = 'member' and id = 'T3'), 'Санжар');
select tst.expect('Тимлид себе ник не ставит', tst.val('TL', $q$select core_nick_link('W', 'TL', 'other', '{"newNick":"Лидер"}'::jsonb)::text$q$), 'error:42501');
select tst.expect('Тимлид Owner ник не ставит', tst.val('TL', $q$select core_nick_link('W', 'O', 'other', '{"newNick":"Босс"}'::jsonb)::text$q$), 'error:42501');
select tst.expect('Owner ставит себе ник «Другие»', tst.val('O', $q$select core_nick_link('W', 'O', 'other', '{"newNick":"Босс"}'::jsonb) ->> 'label'$q$), 'Босс');
select tst.expect('закрепить новый ник ОС за OS2',
  tst.val('TL', $q$select core_nick_link('W', 'OS2', 'os', '{"newNick":"Оксана"}'::jsonb) ->> 'label'$q$), 'Оксана');
select tst.expect('…ник ОС в копии прав',
  (select (m.os_nick_value = (c.data ->> 'osNickValue'))::text from public.rows_members m, public.core_docs c
    where m.workspace_id = 'W' and m.uid = 'OS2' and c.workspace_id = 'W' and c.kind = 'member' and c.id = 'OS2'), 'true');
select tst.expect('открепить ник', tst.val('TL', $q$select coalesce(core_nick_link('W', 'OS2', 'os', null)::text, '-')$q$), '-');
select tst.expect('…и в копии прав ника нет', (select coalesce(os_nick_value, '-') from public.rows_members where workspace_id = 'W' and uid = 'OS2'), '-');
select tst.run('TL', $q$select core_nick_inactive('W', 'tech', 'opt_t1', true)$q$);
select tst.expect('технарь в неактуальные не уводит', tst.val('T1', $q$select core_nick_inactive('W', 'tech', 'opt_t1', false)::text$q$), 'error:42501');
select tst.expect('…флаг стоит', (select o ->> 'inactive' from public.core_docs c, jsonb_array_elements(c.data -> 'techNickOptions') o where c.workspace_id = 'W' and c.kind = 'workspace' and o ->> 'value' = 'opt_t1'), 'true');
select tst.expect('закрепление неактуального ника его оживляет',
  tst.val('TL', $q$select core_nick_link('W', 'T1', 'tech', '{"optionValue":"opt_t1"}'::jsonb) ->> 'label'$q$), 'Тимур');
select tst.expect('…флаг снят', (select coalesce(o ->> 'inactive', '-') from public.core_docs c, jsonb_array_elements(c.data -> 'techNickOptions') o where c.workspace_id = 'W' and c.kind = 'workspace' and o ->> 'value' = 'opt_t1'), '-');
select tst.expect('несуществующий ник в неактуальные — отказ', tst.val('TL', $q$select core_nick_inactive('W', 'tech', 'nope', true)::text$q$), 'error:P0002');

-- ---------- «Заморозка» ----------
select tst.expect('Owner сеет «Заморозку»',
  tst.val('O', $q$select core_seed_status('W', '{"value":"freeze","label":"Заморозка","color":"189 94% 43%"}'::jsonb)::text$q$), 'true');
select tst.expect('…второй раз — нет',
  tst.val('O', $q$select core_seed_status('W', '{"value":"freeze","label":"Заморозка","color":"189 94% 43%"}'::jsonb)::text$q$), 'false');
select tst.expect('…в списке один раз', (select count(*)::text from public.core_docs c, jsonb_array_elements(c.data -> 'statusOptions') o where c.workspace_id = 'W' and c.kind = 'workspace' and o ->> 'value' = 'freeze'), '1');
select tst.expect('Тимлид не сеет', tst.val('TL', $q$select core_seed_status('W', '{"value":"freeze","label":"Заморозка"}'::jsonb)::text$q$), 'error:42501');

-- ---------- Полное удаление ----------
select tst.expect('Тимлид полное удаление не делает', tst.val('TL', $q$select core_member_purge('W', 'T3', 't3@x.io')::text$q$), 'error:42501');
select tst.expect('Owner удаляет полностью',
  tst.val('O', $q$select core_member_purge('W', 'J2', 'j2@x.io')::text$q$), '{"invite": false, "member": true, "joinRequests": 1}');
select tst.expect('…участника и заявки нет, копия прав чиста',
  (select count(*)::text from public.core_docs where workspace_id = 'W' and kind in ('member', 'join') and id = 'J2' and not deleted)
  || '|' || (select count(*)::text from public.rows_members where workspace_id = 'W' and uid = 'J2'), '0|0');
select tst.run('O', $q$select core_write('W', '[{"kind":"member","id":"AD","op":"merge","data":{"role":"owner"}}]'::jsonb)$q$);
select tst.expect('выданный Owner создателя не удаляет', tst.val('AD', $q$select core_member_purge('W', 'O', 'o@x.io')::text$q$), 'error:42501');
select tst.run('O', $q$select core_write('W', '[{"kind":"member","id":"AD","op":"merge","data":{"role":"admin"}}]'::jsonb)$q$);

-- ---------- Предел мест ----------
update public.rows_workspaces set seats_limit = (select count(*) from public.core_docs where workspace_id = 'W' and kind in ('member', 'invite') and not deleted) where workspace_id = 'W';
select tst.expect('предел мест: приглашение не проходит',
  tst.val('TL', $q$select core_write('W', '[{"kind":"invite","id":"more@x.io","op":"set","data":{"email":"more@x.io","role":"viewer","status":"invited"}}]'::jsonb)::text$q$), 'error:42501');
select tst.run('J9', $q$select core_write('W', '[{"kind":"join","id":"J9","op":"set","data":{"id":"J9","uid":"J9","email":"j9@x.io","workspaceId":"W","status":"pending","requestedAt":1}}]'::jsonb)$q$);
select tst.expect('предел мест: одобрение — отказ', tst.val('TL', $q$select core_approve_join('W', 'J9', 'viewer', null)::text$q$), 'error:42501');
select tst.expect('предел мест: правка участника проходит',
  tst.val('TL', $q$select core_write('W', '[{"kind":"member","id":"T2","op":"merge","data":{"nickname":"Тимка"}}]'::jsonb) -> 0 -> 'data' ->> 'nickname'$q$), 'Тимка');
update public.rows_workspaces set seats_limit = null where workspace_id = 'W';
select tst.expect('предел снят — приглашение проходит',
  tst.val('TL', $q$select core_write('W', '[{"kind":"invite","id":"more@x.io","op":"set","data":{"email":"more@x.io","role":"viewer","status":"invited"}}]'::jsonb) -> 0 ->> 'id'$q$), 'more@x.io');

-- ---------- Приостановленная компания ----------
update public.rows_workspaces set status = 'suspended' where workspace_id = 'W';
select tst.expect('приостановлена: участники не пишутся',
  tst.val('TL', $q$select core_write('W', '[{"kind":"member","id":"T2","op":"merge","data":{"nickname":"x"}}]'::jsonb)::text$q$), 'error:42501');
select tst.expect('приостановлена: заявка постороннего тоже нет',
  tst.val('J5', $q$select core_write('W', '[{"kind":"join","id":"J5","op":"set","data":{"id":"J5","uid":"J5","email":"j5@x.io","workspaceId":"W","status":"pending","requestedAt":1}}]'::jsonb)::text$q$), 'error:42501');
update public.rows_workspaces set status = 'active' where workspace_id = 'W';

-- ---------- Повторный накат ----------
\ir ../migrations/20261030_core_members.sql
select tst.expect('после наката участники на месте', (select count(*)::text from public.core_docs where workspace_id = 'W' and kind = 'member' and not deleted), '12');
select tst.expect('версия схемы не старее 20261030', (public.nova_schema_version() >= '20261030')::text, 'true');

select label, got from tst.results where not ok;
select format('ПРОВЕРОК (ядро: участники и настройки): %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
