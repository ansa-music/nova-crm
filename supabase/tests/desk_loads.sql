-- =====================================================================
-- Проверки счётчиков столов в Postgres (20260927_nova_sync.sql +
-- 20260928_desk_loads.sql). Запускать ПОСЛЕ desk_rows_rls.sql: берёт оттуда
-- хелперы tst.* и заведённые workspace/участников/столы:
--   W (живое хранилище): O — Owner, T1 — ответственный за P1, T2 — за P2,
--   T3 и V — в editable_uids P1, TL — Тимлид без Технаря, OS1/OS2 — ОС,
--   X — посторонний с настоящим токеном.
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

-- Публикация счётчиков так, как её шлёт клиент (PostgREST upsert = INSERT ON CONFLICT DO UPDATE).
create or replace function tst.put(page text, resp text, month text, data text, ws text default 'W') returns text
language sql immutable as $$
  select format($f$insert into desk_loads (workspace_id, page_id, responsible_uid, month_key, sub_page_id, data, updated_by)
    values (%L, %L, %L, %L, %L, %L::jsonb, 'кто-то')
    on conflict (workspace_id, page_id) do update set
      responsible_uid = excluded.responsible_uid, month_key = excluded.month_key,
      sub_page_id = excluded.sub_page_id, data = excluded.data, updated_by = excluded.updated_by$f$,
    ws, page, resp, month, 'tab_' || month, data)
$$;

-- Второй, НЕживой workspace: строки ещё в Firestore (до переноса / после отката).
insert into public.rows_workspaces (workspace_id, owner_id, live) values ('W2', 'O2', false)
  on conflict (workspace_id) do update set live = false, migrating_until = null;
insert into public.rows_members (workspace_id, uid, role, extra_roles) values ('W2', 'O2', 'owner', '{}'), ('W2', 'T9', 'manager', '{}')
  on conflict do nothing;
insert into public.rows_page_acl (workspace_id, page_id, responsible_uid, created_by) values ('W2', 'Q1', 'T9', 'T9')
  on conflict do nothing;

-- ---------------------------------------------------------------------
-- Запись: canEditPage + настоящий ответственный + живое хранилище.
-- ---------------------------------------------------------------------
select tst.expect('ответственный пишет свой стол',
  tst.try('T1', tst.put('P1', 'T1', '2026-09', '{"total":3,"statusCounts":{"work":3}}')), 'ok:1');
select tst.expect('ответственный НЕ пишет свой стол с чужим ответственным',
  tst.try('T1', tst.put('P1', 'T2', '2026-09', '{"total":3}')), 'deny');
select tst.expect('технарь НЕ пишет чужой стол',
  tst.try('T1', tst.put('P2', 'T2', '2026-09', '{"total":1}')), 'deny');
select tst.expect('технарь НЕ пишет чужой стол, назвав ответственным себя',
  tst.try('T1', tst.put('P2', 'T1', '2026-09', '{"total":1}')), 'deny');
select tst.expect('редактор стола (editableUsers) пишет с настоящим ответственным',
  tst.try('T3', tst.put('P1', 'T1', '2026-09', '{"total":4}')), 'ok:1');
select tst.expect('Owner пишет любой стол с настоящим ответственным',
  tst.try('O', tst.put('P2', 'T2', '2026-09', '{"total":2}')), 'ok:1');
select tst.expect('Owner НЕ пишет стол с выдуманным ответственным',
  tst.try('O', tst.put('P2', 'O', '2026-09', '{"total":2}')), 'deny');
select tst.expect('Owner НЕ пишет стол без записи о правах',
  tst.try('O', tst.put('P404', 'T1', '2026-09', '{"total":2}')), 'deny');
select tst.expect('Тимлид без Технаря НЕ пишет стол технаря',
  tst.try('TL', tst.put('P1', 'T1', '2026-09', '{"total":9}')), 'deny');
select tst.expect('ОС НЕ пишет стол технаря',
  tst.try('OS2', tst.put('P1', 'T1', '2026-09', '{"total":9}')), 'deny');
select tst.expect('посторонний НЕ пишет',
  tst.try('X', tst.put('P1', 'T1', '2026-09', '{"total":9}')), 'deny');
select tst.expect('анонимный ключ НЕ пишет',
  tst.try('__anon_key__', tst.put('P1', 'T1', '2026-09', '{"total":9}')), 'deny');
select tst.expect('токен чужого проекта с uid ответственного НЕ пишет',
  tst.try('__forged__:T1', tst.put('P1', 'T1', '2026-09', '{"total":9}')), 'deny');
select tst.expect('неживое хранилище: ответственный НЕ пишет',
  tst.try('T9', tst.put('Q1', 'T9', '2026-09', '{"total":1}', 'W2')), 'deny');
select tst.expect('неживое хранилище: Owner вне переноса НЕ пишет',
  tst.try('O2', tst.put('Q1', 'T9', '2026-09', '{"total":1}', 'W2')), 'deny');
select tst.expect('data не объект — отказ',
  tst.try('T1', tst.put('P1', 'T1', '2026-09', '[1,2]')), 'error');
select tst.expect('ни клиент, ни Owner НЕ удаляют счётчики (нет права delete)',
  tst.try('O', $q$delete from desk_loads where workspace_id = 'W'$q$), 'deny');

-- Фикстуры (остаются): P1 и P2 опубликованы.
select tst.run('T1', tst.put('P1', 'T1', '2026-09', '{"pageId":"P1","updatedAt":5,"total":3,"statusCounts":{"work":3},"osLastOrderAt":{"os-a":1000}}'));
select tst.run('O', tst.put('P2', 'T2', '2026-09', '{"total":2,"statusCounts":{"done":2}}'));

-- ---------------------------------------------------------------------
-- Чтение: isMember.
-- ---------------------------------------------------------------------
select tst.expect('ответственный читает все счётчики workspace', tst.try('T1', 'select * from desk_loads', true), 'ok:2');
select tst.expect('ОС без доступа к столам читает счётчики', tst.try('OS2', 'select * from desk_loads', true), 'ok:2');
select tst.expect('Тимлид читает счётчики', tst.try('TL', 'select * from desk_loads', true), 'ok:2');
select tst.expect('посторонний не видит ничего', tst.try('X', 'select * from desk_loads', true), 'ok:0');
select tst.expect('анонимный ключ не видит ничего', tst.try('__anon_key__', 'select * from desk_loads', true), 'ok:0');
select tst.expect('участник другого workspace не видит W', tst.try('T9', $q$select * from desk_loads where workspace_id = 'W'$q$, true), 'ok:0');
select tst.expect('rows_my_workspaces — только свои', tst.val('T1', $q$select string_agg(w, ',') from rows_my_workspaces() w$q$), 'W');
select tst.expect('rows_my_workspaces посторонним — пусто', coalesce(tst.val('X', $q$select string_agg(w, ',') from rows_my_workspaces() w$q$), ''), '');

-- ---------------------------------------------------------------------
-- Страж: кто записал, слияние osLastOrderAt, «те же цифры», rev.
-- ---------------------------------------------------------------------
select tst.expect('updated_by — по токену, а не со слов клиента',
  (select updated_by from desk_loads where workspace_id = 'W' and page_id = 'P1'), 'T1');
select tst.expect('служебные поля в data не держатся',
  tst.val('T1', $q$select (data ? 'pageId')::text from desk_loads where page_id = 'P1'$q$), 'false');

do $$
declare
  rev0 bigint;
  rev1 bigint;
  day_now bigint := (extract(epoch from now()) * 1000)::bigint;
  fresh text := format('{"total":3,"statusCounts":{"work":3},"osLastOrderAt":{"os-a":%s}}', (extract(epoch from now()) * 1000)::bigint - 5000);
  skipped text;
begin
  perform tst.run('T1', tst.put('P1', 'T1', '2026-09', fresh));
  select rev into rev0 from public.desk_loads where workspace_id = 'W' and page_id = 'P1';
  -- Те же цифры (включая osLastOrderAt, который и так там) — 0 строк, rev тот же.
  skipped := tst.try('T1', tst.put('P1', 'T1', '2026-09', fresh));
  perform tst.expect('те же цифры недавно — не переписываются (0 строк)', skipped, 'ok:0');
  -- Вкладка больше не называет свежего ОС — он не теряется, и это не изменение.
  skipped := tst.try('T1', tst.put('P1', 'T1', '2026-09', '{"total":3,"statusCounts":{"work":3}}'));
  perform tst.expect('пропавший из вкладки свежий ОС не считается изменением (0 строк)', skipped, 'ok:0');
  perform tst.expect('rev не рос на пропущенной записи',
    (select rev from public.desk_loads where workspace_id = 'W' and page_id = 'P1')::text, rev0::text);

  -- Давний ОС в базе (как после долгого простоя) и новый ОС во вкладке.
  update public.desk_loads set data = jsonb_set(data, '{osLastOrderAt,os-old}', '1000')
    where workspace_id = 'W' and page_id = 'P1';
  select rev into rev0 from public.desk_loads where workspace_id = 'W' and page_id = 'P1';
  perform tst.run('T1', tst.put('P1', 'T1', '2026-09', format('{"total":4,"statusCounts":{"work":4},"osLastOrderAt":{"os-b":%s}}', day_now)));
  select rev into rev1 from public.desk_loads where workspace_id = 'W' and page_id = 'P1';
  perform tst.expect('новая правка — rev растёт', (rev1 > rev0)::text, 'true');
  perform tst.expect('новый ОС добавлен',
    (select (data -> 'osLastOrderAt' ->> 'os-b') from public.desk_loads where workspace_id = 'W' and page_id = 'P1'), day_now::text);
  perform tst.expect('ОС старше 40 дней выпал при слиянии',
    (select (data -> 'osLastOrderAt' ? 'os-old')::text from public.desk_loads where workspace_id = 'W' and page_id = 'P1'), 'false');
  perform tst.expect('свежий прежний ОС остался при слиянии',
    (select (data -> 'osLastOrderAt' ? 'os-a')::text from public.desk_loads where workspace_id = 'W' and page_id = 'P1'), 'true');

  -- Более старый день того же ОС не затирает новый.
  perform tst.run('T1', tst.put('P1', 'T1', '2026-09', '{"total":6,"statusCounts":{"work":6},"osLastOrderAt":{"os-b":5}}'));
  perform tst.expect('слияние: у ОС остаётся самый новый день',
    (select (data -> 'osLastOrderAt' ->> 'os-b') from public.desk_loads where workspace_id = 'W' and page_id = 'P1'), day_now::text);
end;
$$;

-- rev монотонен и уникален на серии правок разных столов.
do $$
declare
  a bigint; b bigint; c bigint;
begin
  perform tst.run('T1', tst.put('P1', 'T1', '2026-09', '{"total":10}'));
  select rev into a from public.desk_loads where workspace_id = 'W' and page_id = 'P1';
  perform tst.run('O', tst.put('P2', 'T2', '2026-09', '{"total":11}'));
  select rev into b from public.desk_loads where workspace_id = 'W' and page_id = 'P2';
  perform tst.run('T1', tst.put('P1', 'T1', '2026-09', '{"total":12}'));
  select rev into c from public.desk_loads where workspace_id = 'W' and page_id = 'P1';
  perform tst.expect('rev растёт монотонно по всей коллекции', (a < b and b < c)::text, 'true');
  perform tst.expect('дельта «rev > курсор» отдаёт ровно изменившиеся',
    tst.try('OS2', format('select * from desk_loads where workspace_id = %L and rev > %s', 'W', a), true), 'ok:2');
  perform tst.expect('дельта после последней правки пуста',
    tst.try('OS2', format('select * from desk_loads where workspace_id = %L and rev > %s', 'W', c), true), 'ok:0');
end;
$$;

-- Клиент не выставляет rev сам.
select tst.run('T1', $q$update desk_loads set rev = 1, data = '{"total":13}' where workspace_id = 'W' and page_id = 'P1'$q$);
select tst.expect('rev ставит база, а не клиент', (select (rev > 1)::text from desk_loads where workspace_id = 'W' and page_id = 'P1'), 'true');
select tst.expect('стол у записи не переписывается',
  tst.try('O', $q$update desk_loads set page_id = 'P9' where workspace_id = 'W' and page_id = 'P1'$q$), 'error');

-- ---------------------------------------------------------------------
-- Смена месяца: архив прошлого, прошлый месяц поверх нового не пишется.
-- ---------------------------------------------------------------------
create temp table tst_p1_at as select server_at from desk_loads where workspace_id = 'W' and page_id = 'P1';
select pg_sleep(0.02);
select tst.run('T1', tst.put('P1', 'T1', '2026-10', '{"total":1,"statusCounts":{"work":1}}'));
select tst.expect('архив помнит, на когда верны цифры (counts_at = server_at строки месяца, раньше архивации)',
  (select (h.counts_at = t.server_at and h.counts_at < h.server_at)::text
     from desk_load_history h, tst_p1_at t where h.workspace_id = 'W' and h.page_id = 'P1' and h.month_key = '2026-09'), 'true');
select tst.expect('первая публикация нового месяца архивирует прошлый',
  tst.try('T1', $q$select * from desk_load_history where workspace_id = 'W' and page_id = 'P1' and month_key = '2026-09' and data ->> 'total' = '13'$q$, true), 'ok:1');
select tst.expect('архив читает любой участник (ОС)',
  tst.try('OS2', $q$select * from desk_load_history where workspace_id = 'W'$q$, true), 'ok:1');
select tst.expect('архив не читает посторонний',
  tst.try('X', $q$select * from desk_load_history$q$, true), 'ok:0');
select tst.expect('архив клиент напрямую НЕ пишет',
  tst.try('O', $q$insert into desk_load_history (workspace_id, page_id, month_key, data) values ('W','P1','2026-01','{}')$q$), 'deny');
select tst.expect('архив клиент напрямую НЕ правит',
  tst.try('O', $q$update desk_load_history set data = '{}' where workspace_id = 'W'$q$), 'deny');
select tst.expect('прошлый месяц поверх нового не пишется (0 строк)',
  tst.try('T1', tst.put('P1', 'T1', '2026-09', '{"total":99}')), 'ok:0');
select tst.expect('после попытки прошлого месяца в столе новый месяц',
  (select month_key from desk_loads where workspace_id = 'W' and page_id = 'P1'), '2026-10');
select tst.expect('у архивной строки есть rev', (select (rev > 0)::text from desk_load_history where workspace_id = 'W' and page_id = 'P1'), 'true');

-- Отказ политики откатывает и вставку в архив (триггер идёт до проверки).
select tst.expect('чужой стол со сменой месяца — отказ',
  tst.try('T1', tst.put('P2', 'T2', '2026-10', '{"total":1}')), 'deny');
select tst.expect('отказ не оставил архивной строки',
  (select count(*)::text from desk_load_history where workspace_id = 'W' and page_id = 'P2'), '0');

-- Смена ответственного в копии прав: старый ответственный больше не пишет.
select tst.run('O', $q$update rows_page_acl set responsible_uid = 'T3' where workspace_id = 'W' and page_id = 'P1'$q$);
select tst.expect('после смены ответственного прежний НЕ пишет с собой',
  tst.try('T1', tst.put('P1', 'T1', '2026-10', '{"total":2}')), 'deny');
select tst.expect('новый ответственный пишет',
  tst.try('T3', tst.put('P1', 'T3', '2026-10', '{"total":2}')), 'ok:1');
select tst.run('O', $q$update rows_page_acl set responsible_uid = 'T1' where workspace_id = 'W' and page_id = 'P1'$q$);

select case when ok then '  OK  ' else 'FAIL  ' end || label || case when ok then '' else '  → ' || got end
from tst.results order by n;
select format('ПРОВЕРОК: %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
