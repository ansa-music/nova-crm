-- =====================================================================
-- Проверки списков заказов ОС в Postgres (20260930b_os_orders.sql).
-- Запускать ПОСЛЕ desk_rows_rls.sql: берёт оттуда хелперы tst.* и
-- заведённые workspace/участников/столы:
--   W (живое хранилище): O — Owner, T1 — ответственный за P1, T2 — за P2,
--   T3 и V — в editable_uids P1, TL — Тимлид без Технаря, TLO — Тимлид + ОС,
--   OS1/OS2 — ОС, X — посторонний с настоящим токеном.
-- Итог — строка «ПРОВЕРОК: N, ПРОВАЛЕНО: 0».
-- =====================================================================
truncate tst.results;

-- Значение запроса от лица uid (без отката).
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
  return 'error:' || sqlstate;
end;
$$;

-- Публикация списка так, как её шлёт клиент (PostgREST upsert … select("rev")).
create or replace function tst.oput(page text, resp text, os text, month text, orders text, ws text default 'W') returns text
language sql immutable as $$
  select format($f$insert into os_orders (workspace_id, page_id, os_value, responsible_uid, month_key, sub_page_id, orders, updated_by)
    values (%L, %L, %L, %L, %L, %L, %L::jsonb, 'кто-то')
    on conflict (workspace_id, page_id, os_value) do update set
      responsible_uid = excluded.responsible_uid, month_key = excluded.month_key,
      sub_page_id = excluded.sub_page_id, orders = excluded.orders, updated_by = excluded.updated_by
    returning rev$f$,
    ws, page, os, resp, month, 'tab_' || month, orders)
$$;

-- Ники ОС в копии (как их положит сверка Owner/Тимлида из Firestore).
update public.rows_members set os_nick_value = 'os-a' where workspace_id = 'W' and uid = 'OS1';
update public.rows_members set os_nick_value = 'os-b' where workspace_id = 'W' and uid = 'OS2';
update public.rows_members set os_nick_value = 'os-t' where workspace_id = 'W' and uid = 'TLO';

-- Неживой workspace: строки ещё в Firestore (до переноса / после отката).
insert into public.rows_workspaces (workspace_id, owner_id, live) values ('WQ', 'OQ', false)
  on conflict (workspace_id) do update set live = false, migrating_until = null;
insert into public.rows_members (workspace_id, uid, role, extra_roles) values ('WQ', 'OQ', 'owner', '{}'), ('WQ', 'TQ', 'manager', '{}')
  on conflict do nothing;
insert into public.rows_page_acl (workspace_id, page_id, responsible_uid, created_by) values ('WQ', 'Q1', 'TQ', 'TQ')
  on conflict do nothing;

-- Владелец по документу workspace, без записи участника (isOwner в правилах его пускает).
insert into public.rows_workspaces (workspace_id, owner_id, live) values ('WD', 'DOC3', true)
  on conflict (workspace_id) do update set live = true;
insert into public.rows_page_acl (workspace_id, page_id, responsible_uid, created_by) values ('WD', 'D1', 'TD', 'TD')
  on conflict do nothing;
insert into public.os_orders (workspace_id, page_id, os_value, responsible_uid, month_key, sub_page_id, orders)
  values ('WD', 'D1', 'os-a', 'TD', '2026-09', 'tab', '[]') on conflict do nothing;

-- ---------------------------------------------------------------------
-- Ник ОС в копии прав: пишут ровно те, кто в Firestore меняет osNickValue.
-- ---------------------------------------------------------------------
select tst.expect('ОС НЕ вписывает себе чужой ник',
  tst.try('OS1', $q$update rows_members set os_nick_value = 'os-b' where workspace_id = 'W' and uid = 'OS1'$q$), 'deny');
select tst.expect('ОС НЕ меняет ник другому ОС',
  tst.try('OS1', $q$update rows_members set os_nick_value = 'os-a' where workspace_id = 'W' and uid = 'OS2'$q$), 'deny');
select tst.expect('технарь НЕ вписывает себе ник ОС',
  tst.try('T1', $q$update rows_members set os_nick_value = 'os-a' where workspace_id = 'W' and uid = 'T1'$q$), 'deny');
select tst.expect('Тимлид + ОС НЕ меняет свой ник',
  tst.try('TLO', $q$update rows_members set os_nick_value = 'os-a' where workspace_id = 'W' and uid = 'TLO'$q$), 'deny');
select tst.expect('Тимлид НЕ трогает ник Owner',
  tst.try('TL', $q$update rows_members set os_nick_value = 'os-a' where workspace_id = 'W' and uid = 'O'$q$), 'deny');
select tst.expect('Тимлид меняет ник другому участнику',
  tst.try('TL', $q$update rows_members set os_nick_value = 'os-z' where workspace_id = 'W' and uid = 'OS2'$q$), 'ok:1');
select tst.expect('Тимлид заводит участника сразу с ником (одобрение заявки)',
  tst.try('TL', $q$insert into rows_members (workspace_id, uid, role, extra_roles, os_nick_value) values ('W', 'NEWOS', 'os', '{}', 'os-new')$q$), 'ok:1');
select tst.expect('Owner меняет ник любому, и себе',
  tst.try('O', $q$update rows_members set os_nick_value = 'os-o' where workspace_id = 'W' and uid in ('O', 'OS1')$q$), 'ok:2');
select tst.expect('посторонний НЕ заводит себя участником с ником',
  tst.try('X', $q$insert into rows_members (workspace_id, uid, role, extra_roles, os_nick_value) values ('W', 'X', 'os', '{}', 'os-a')$q$), 'deny');
select tst.expect('посторонний НЕ меняет ник',
  tst.try('X', $q$update rows_members set os_nick_value = 'os-x' where workspace_id = 'W'$q$), 'deny');
select tst.expect('ОС читает свой ник в копии',
  tst.val('OS1', $q$select os_nick_value from rows_members where workspace_id = 'W' and uid = 'OS1'$q$), 'os-a');

-- ---------------------------------------------------------------------
-- Запись: canEditPage + настоящий ответственный + живое хранилище.
-- ---------------------------------------------------------------------
select tst.expect('ответственный пишет список ОС своего стола',
  tst.try('T1', tst.oput('P1', 'T1', 'os-a', '2026-09', '[{"rowId":"r1","title":"Аня","status":"work"}]')), 'ok:1');
select tst.expect('ответственный НЕ пишет свой стол с чужим ответственным',
  tst.try('T1', tst.oput('P1', 'T2', 'os-a', '2026-09', '[]')), 'deny');
select tst.expect('технарь НЕ пишет чужой стол',
  tst.try('T1', tst.oput('P2', 'T2', 'os-a', '2026-09', '[]')), 'deny');
select tst.expect('технарь НЕ пишет чужой стол, назвав ответственным себя',
  tst.try('T1', tst.oput('P2', 'T1', 'os-a', '2026-09', '[]')), 'deny');
select tst.expect('редактор стола (editableUsers) пишет с настоящим ответственным',
  tst.try('T3', tst.oput('P1', 'T1', 'os-a', '2026-09', '[]')), 'ok:1');
select tst.expect('Owner пишет любой стол с настоящим ответственным',
  tst.try('O', tst.oput('P2', 'T2', 'os-a', '2026-09', '[]')), 'ok:1');
select tst.expect('Owner НЕ пишет стол с выдуманным ответственным',
  tst.try('O', tst.oput('P2', 'O', 'os-a', '2026-09', '[]')), 'deny');
select tst.expect('Owner НЕ пишет стол без записи о правах',
  tst.try('O', tst.oput('P404', 'T1', 'os-a', '2026-09', '[]')), 'deny');
select tst.expect('Тимлид без Технаря НЕ пишет',
  tst.try('TL', tst.oput('P1', 'T1', 'os-a', '2026-09', '[]')), 'deny');
select tst.expect('ОС НЕ пишет даже список со своим ником',
  tst.try('OS1', tst.oput('P1', 'T1', 'os-a', '2026-09', '[]')), 'deny');
select tst.expect('посторонний НЕ пишет',
  tst.try('X', tst.oput('P1', 'T1', 'os-a', '2026-09', '[]')), 'deny');
select tst.expect('анонимный ключ НЕ пишет',
  tst.try('__anon_key__', tst.oput('P1', 'T1', 'os-a', '2026-09', '[]')), 'deny');
select tst.expect('токен чужого проекта с uid ответственного НЕ пишет',
  tst.try('__forged__:T1', tst.oput('P1', 'T1', 'os-a', '2026-09', '[]')), 'deny');
select tst.expect('неживое хранилище: ответственный НЕ пишет',
  tst.try('TQ', tst.oput('Q1', 'TQ', 'os-a', '2026-09', '[]', 'WQ')), 'deny');
select tst.expect('неживое хранилище: Owner вне переноса НЕ пишет',
  tst.try('OQ', tst.oput('Q1', 'TQ', 'os-a', '2026-09', '[]', 'WQ')), 'deny');
select tst.expect('orders не массив — отказ',
  tst.try('T1', tst.oput('P1', 'T1', 'os-a', '2026-09', '{"a":1}')), 'error');
select tst.expect('пустой ник — отказ',
  tst.try('T1', tst.oput('P1', 'T1', '', '2026-09', '[]')), 'error');
select tst.expect('список длиннее 500 — отказ',
  tst.try('T1', tst.oput('P1', 'T1', 'os-a', '2026-09',
    (select jsonb_agg(jsonb_build_object('rowId', g))::text from generate_series(1, 501) g))), 'error');

-- Фикстуры (остаются): на P1 списки os-a и os-b, на P2 — os-a, на P1 — os-t (Тимлид + ОС).
select tst.run('T1', tst.oput('P1', 'T1', 'os-a', '2026-09', '[{"rowId":"r1","title":"Аня","status":"work"}]'));
select tst.run('T1', tst.oput('P1', 'T1', 'os-b', '2026-09', '[{"rowId":"r2","title":"Боря","status":"done"}]'));
select tst.run('O', tst.oput('P2', 'T2', 'os-a', '2026-09', '[{"rowId":"r1","title":"Чужой","status":"work"}]'));
select tst.run('T1', tst.oput('P1', 'T1', 'os-t', '2026-09', '[]'));

select tst.expect('ни клиент, ни Owner НЕ удаляют списки (нет права delete)',
  tst.try('O', $q$delete from os_orders where workspace_id = 'W'$q$), 'deny');
select tst.expect('TRUNCATE мимо RLS закрыт ролям API',
  tst.try('O', 'truncate os_orders'), 'error');
select tst.expect('редактор перезаписывает СУЩЕСТВУЮЩИЙ список (ON CONFLICT требует чтения строки)',
  tst.try('T3', tst.oput('P1', 'T1', 'os-a', '2026-09', '[{"rowId":"r1","title":"Аня","status":"done"}]')), 'ok:1');

-- ---------------------------------------------------------------------
-- Чтение: Owner, ОС по своему нику, писатель своего стола.
-- ---------------------------------------------------------------------
select tst.expect('ОС видит только списки со своим ником (оба стола)',
  tst.try('OS1', $q$select * from os_orders where workspace_id = 'W'$q$, true), 'ok:2');
select tst.expect('ОС НЕ видит чужой ник, даже прямо спросив',
  tst.try('OS1', $q$select * from os_orders where os_value = 'os-b'$q$, true), 'ok:0');
select tst.expect('второй ОС видит свой список',
  tst.try('OS2', $q$select * from os_orders where workspace_id = 'W'$q$, true), 'ok:1');
select tst.expect('Тимлид + ОС видит только свой ник',
  tst.try('TLO', $q$select * from os_orders where workspace_id = 'W'$q$, true), 'ok:1');
select tst.expect('Owner видит всё',
  tst.try('O', $q$select * from os_orders where workspace_id = 'W'$q$, true), 'ok:4');
select tst.expect('владелец по документу без записи участника видит свой workspace',
  tst.try('DOC3', $q$select * from os_orders$q$, true), 'ok:1');
select tst.expect('Тимлид без ника НЕ видит ничего',
  tst.try('TL', $q$select * from os_orders$q$, true), 'ok:0');
select tst.expect('ответственный видит списки СВОЕГО стола',
  tst.try('T1', $q$select * from os_orders where page_id = 'P1'$q$, true), 'ok:3');
select tst.expect('ответственный НЕ видит списки чужого стола',
  tst.try('T1', $q$select * from os_orders where page_id = 'P2'$q$, true), 'ok:0');
select tst.expect('Viewer-редактор P1 видит только P1',
  tst.try('V', $q$select * from os_orders where workspace_id = 'W' and page_id <> 'P1'$q$, true), 'ok:0');
select tst.expect('посторонний не видит ничего', tst.try('X', 'select * from os_orders', true), 'ok:0');
select tst.expect('анонимный ключ не видит ничего', tst.try('__anon_key__', 'select * from os_orders', true), 'ok:0');
select tst.expect('токен чужого проекта с uid ОС не видит ничего',
  tst.try('__forged__:OS1', 'select * from os_orders', true), 'ok:0');
select tst.expect('rows_my_os_nicks — только свой ник',
  tst.val('OS1', $q$select string_agg(workspace_id || ':' || os_value, ',') from rows_my_os_nicks()$q$), 'W:os-a');
select tst.expect('rows_owned_workspaces у технаря пуст',
  coalesce(tst.val('T1', $q$select string_agg(w, ',') from rows_owned_workspaces() w$q$), ''), '');
select tst.expect('rows_owned_workspaces у владельца по документу',
  tst.val('DOC3', $q$select string_agg(w, ',') from rows_owned_workspaces() w$q$), 'WD');

-- Ник сменили (Тимлид в Firestore → копия) — ОС сразу видит новый ник и не видит старый.
select tst.run('TL', $q$update rows_members set os_nick_value = 'os-b' where workspace_id = 'W' and uid = 'OS1'$q$);
select tst.expect('после смены ника ОС видит заказы нового ника',
  tst.try('OS1', $q$select * from os_orders where os_value = 'os-b'$q$, true), 'ok:1');
select tst.expect('после смены ника ОС НЕ видит заказы старого ника',
  tst.try('OS1', $q$select * from os_orders where os_value = 'os-a'$q$, true), 'ok:0');
select tst.run('TL', $q$update rows_members set os_nick_value = 'os-a' where workspace_id = 'W' and uid = 'OS1'$q$);
-- Ник сняли — не видно ничего.
select tst.run('TL', $q$update rows_members set os_nick_value = null where workspace_id = 'W' and uid = 'OS2'$q$);
select tst.expect('без ника ОС не видит ничего',
  tst.try('OS2', 'select * from os_orders', true), 'ok:0');
select tst.run('TL', $q$update rows_members set os_nick_value = 'os-b' where workspace_id = 'W' and uid = 'OS2'$q$);
-- Убранный из копии участник не видит ничего.
select tst.run('O', $q$delete from rows_members where workspace_id = 'W' and uid = 'OS2'$q$);
select tst.expect('убранный из участников ОС не видит свой бывший список',
  tst.try('OS2', 'select * from os_orders', true), 'ok:0');
select tst.run('O', $q$insert into rows_members (workspace_id, uid, role, extra_roles, os_nick_value) values ('W', 'OS2', 'os', '{}', 'os-b')$q$);

-- ---------------------------------------------------------------------
-- Страж: кто записал, rev, «тот же список», прошлый месяц, ключи.
-- ---------------------------------------------------------------------
select tst.expect('updated_by — по токену, а не со слов клиента',
  (select updated_by from os_orders where workspace_id = 'W' and page_id = 'P1' and os_value = 'os-b'), 'T1');
select tst.expect('rev ставит база',
  (select (rev > 0)::text from os_orders where workspace_id = 'W' and page_id = 'P1' and os_value = 'os-b'), 'true');
select tst.expect('клиент rev не подсовывает',
  tst.val('T1', $q$with i as (insert into os_orders (workspace_id, page_id, os_value, responsible_uid, month_key, sub_page_id, orders, rev)
    values ('W', 'P1', 'os-q', 'T1', '2026-09', 'tab', '[]', 1) returning rev) select (rev <> 1)::text from i$q$), 'true');

do $$
declare
  rev0 bigint;
  rev1 bigint;
  got text;
begin
  select rev into rev0 from public.os_orders where workspace_id = 'W' and page_id = 'P1' and os_value = 'os-b';
  got := tst.try('T1', tst.oput('P1', 'T1', 'os-b', '2026-09', '[{"rowId":"r2","title":"Боря","status":"done"}]'));
  perform tst.expect('тот же список моложе 90 минут — 0 строк (звонить некому)', got, 'ok:0');
  select rev into rev1 from public.os_orders where workspace_id = 'W' and page_id = 'P1' and os_value = 'os-b';
  perform tst.expect('пропущенная запись не двигает rev', (rev1 = rev0)::text, 'true');

  perform tst.run('T1', tst.oput('P1', 'T1', 'os-b', '2026-09', '[{"rowId":"r2","title":"Боря","status":"work"}]'));
  select rev into rev1 from public.os_orders where workspace_id = 'W' and page_id = 'P1' and os_value = 'os-b';
  perform tst.expect('новый список — новый rev', (rev1 > rev0)::text, 'true');

  -- Тот же список, но старше 90 минут — переписывается (свежесть «обновлено …»).
  -- Состарить запись мимо триггеров (страж и nova_touch иначе вернули бы «сейчас»).
  perform set_config('session_replication_role', 'replica', true);
  update public.os_orders set server_at = now() - interval '2 hours' where workspace_id = 'W' and page_id = 'P1' and os_value = 'os-b';
  perform set_config('session_replication_role', 'origin', true);
  got := tst.try('T1', tst.oput('P1', 'T1', 'os-b', '2026-09', '[{"rowId":"r2","title":"Боря","status":"work"}]'));
  perform tst.expect('тот же список старше 90 минут переписывается', got, 'ok:1');

  -- Новый месяц, потом застрявшая вкладка с прошлым.
  perform tst.run('T1', tst.oput('P1', 'T1', 'os-b', '2026-10', '[]'));
  got := tst.try('T1', tst.oput('P1', 'T1', 'os-b', '2026-09', '[{"rowId":"r2"}]'));
  perform tst.expect('прошлый месяц поверх нового — 0 строк', got, 'ok:0');
  perform tst.expect('месяц остался новым',
    (select month_key from public.os_orders where workspace_id = 'W' and page_id = 'P1' and os_value = 'os-b'), '2026-10');
end $$;

select tst.expect('ник у записи правкой НЕ меняется',
  tst.try('O', $q$update os_orders set os_value = 'os-zz' where workspace_id = 'W' and page_id = 'P1' and os_value = 'os-a'$q$), 'error');
select tst.expect('стол у записи правкой НЕ меняется',
  tst.try('O', $q$update os_orders set page_id = 'P2' where workspace_id = 'W' and page_id = 'P1' and os_value = 'os-t'$q$), 'error');

-- Смена ответственного в копии прав: прежний ответственный больше не пишет.
select tst.run('O', $q$update rows_page_acl set responsible_uid = 'T3' where workspace_id = 'W' and page_id = 'P1'$q$);
select tst.expect('после смены ответственного прежний НЕ пишет с собой',
  tst.try('T1', tst.oput('P1', 'T1', 'os-a', '2026-09', '[]')), 'deny');
select tst.expect('новый ответственный пишет',
  tst.try('T3', tst.oput('P1', 'T3', 'os-a', '2026-09', '[]')), 'ok:1');
select tst.run('O', $q$update rows_page_acl set responsible_uid = 'T1' where workspace_id = 'W' and page_id = 'P1'$q$);

-- Последовательность номеров ролям API не открыта (урок nova_rev_seq).
select tst.expect('анонимный ключ НЕ крутит nova_rev_seq',
  tst.try('__anon_key__', $q$select nextval('public.nova_rev_seq')$q$), 'error');

select case when ok then '  OK  ' else 'FAIL  ' end || label || case when ok then '' else '  → ' || got end
from tst.results order by n;
select format('ПРОВЕРОК: %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
