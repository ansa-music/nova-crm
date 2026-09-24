-- Проверки присутствия (20260928b_presence.sql). Запускать ПОСЛЕ
-- desk_rows_rls.sql: берёт оттуда хелперы tst.* и участников workspace W
-- (O, T1, T2, V …; X — посторонний с настоящим токеном).
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

-- Фикстура: T2 уже отметился (остаётся после проверки).
select tst.run('T2', $q$select * from presence_beat(array['W'])$q$);

-- ---------------------------------------------------------------------
-- Запись.
-- ---------------------------------------------------------------------
select tst.expect('участник отмечается одним вызовом', tst.try('T1', $q$select * from presence_beat(array['W'])$q$, true), 'ok:1');
select tst.expect('повтор workspace в списке — одна строка, без ошибки ON CONFLICT',
  tst.try('T1', $q$select * from presence_beat(array['W','W'])$q$, true), 'ok:1');
select tst.expect('workspace без копии прав молча пропускается (не ошибка FK)',
  tst.try('T1', $q$select * from presence_beat(array['NOPE'])$q$, true), 'ok:0');
select tst.expect('смесь: свой workspace ложится, чужой пропускается',
  tst.try('T1', $q$select * from presence_beat(array['W','NOPE'])$q$, true), 'ok:1');
select tst.expect('пустой и null список — пусто без ошибки',
  tst.try('T1', $q$select * from presence_beat(null)$q$, true), 'ok:0');
select tst.expect('свой upsert напрямую проходит',
  tst.try('T1', $q$insert into member_presence (workspace_id, uid, last_active_at) values ('W','T1',1)
    on conflict (workspace_id, uid) do update set last_active_at = excluded.last_active_at$q$), 'ok:1');
select tst.expect('чужой uid отказывает (вставка за другого)',
  tst.try('T1', $q$insert into member_presence (workspace_id, uid, last_active_at) values ('W','T3',1)$q$), 'error');
select tst.expect('чужую строку не обновить',
  tst.try('T1', $q$update member_presence set last_active_at = 1 where workspace_id = 'W' and uid = 'T2'$q$), 'deny');
select tst.expect('свою строку не переписать на чужой uid',
  tst.try('T2', $q$update member_presence set uid = 'T3' where workspace_id = 'W' and uid = 'T2'$q$), 'deny');
select tst.expect('удаления с клиента нет (даже своей строки)',
  tst.try('T2', $q$delete from member_presence where workspace_id = 'W' and uid = 'T2'$q$), 'deny');
select tst.expect('посторонний не пишет через вызов',
  tst.try('X', $q$select * from presence_beat(array['W'])$q$, true), 'ok:0');
select tst.expect('посторонний не пишет напрямую',
  tst.try('X', $q$insert into member_presence (workspace_id, uid, last_active_at) values ('W','X',1)$q$), 'error');
select tst.expect('анонимный ключ не пишет',
  tst.try('__anon_key__', $q$select * from presence_beat(array['W'])$q$, true), 'ok:0');
select tst.expect('токен чужого проекта с uid участника не пишет',
  tst.try('__forged__:T1', $q$select * from presence_beat(array['W'])$q$, true), 'ok:0');

-- ---------------------------------------------------------------------
-- Чтение.
-- ---------------------------------------------------------------------
select tst.expect('участник видит отметку коллеги', tst.try('T1', $q$select * from member_presence where workspace_id = 'W' and uid = 'T2'$q$, true), 'ok:1');
select tst.expect('Viewer видит присутствие', tst.try('V', $q$select * from member_presence where workspace_id = 'W'$q$, true), 'ok:1');
select tst.expect('посторонний не читает', tst.try('X', $q$select * from member_presence$q$, true), 'ok:0');
select tst.expect('анонимный ключ не читает', tst.try('__anon_key__', $q$select * from member_presence$q$, true), 'ok:0');

-- ---------------------------------------------------------------------
-- Время — серверное.
-- ---------------------------------------------------------------------
do $$
declare
  server_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  got text;
begin
  perform tst.run('T1', $q$insert into member_presence (workspace_id, uid, last_active_at) values ('W','T1',9000000000000000)
    on conflict (workspace_id, uid) do update set last_active_at = excluded.last_active_at$q$);
  select last_active_at::text into got from public.member_presence where workspace_id = 'W' and uid = 'T1';
  perform tst.expect('время из будущего от клиента заменено серверным',
    (abs(got::bigint - server_ms) < 60000)::text, 'true');
  perform tst.expect('вызов отдаёт серверное время',
    (abs(tst.val('T1', $q$select last_active_at::text from presence_beat(array['W'])$q$)::bigint - server_ms) < 60000)::text, 'true');
end;
$$;

-- ---------------------------------------------------------------------
-- Повторный накат файла (кнопка «Скопировать SQL» вставляет все файлы
-- разом и повторно) ничего не ломает и данных не теряет.
-- ---------------------------------------------------------------------
\ir ../migrations/20260928b_presence.sql
select tst.expect('после повторного наката отметки на месте',
  (select count(*)::text from public.member_presence where workspace_id = 'W'), '2');
select tst.expect('после повторного наката политик ровно три',
  (select count(*)::text from pg_policies where tablename = 'member_presence'), '3');
select tst.expect('после повторного наката триггер один',
  (select count(*)::text from pg_trigger where tgrelid = 'public.member_presence'::regclass and not tgisinternal), '1');
select tst.expect('после повторного наката участник отмечается',
  tst.try('T1', $q$select * from presence_beat(array['W'])$q$, true), 'ok:1');
select tst.expect('после повторного наката посторонний по-прежнему не читает',
  tst.try('X', $q$select * from member_presence$q$, true), 'ok:0');

-- ---------------------------------------------------------------------
select case when ok then '  OK  ' else 'FAIL  ' end || label || case when ok then '' else '  → ' || got end
from tst.results order by n;
select format('ПРОВЕРОК: %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
