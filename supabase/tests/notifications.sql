-- Проверки уведомлений (20260930_notifications.sql). Запускать ПОСЛЕ
-- desk_rows_rls.sql: берёт оттуда хелперы tst.* и участников workspace W
-- (O, T1, T2, T3, OS1, V …; X — посторонний с настоящим токеном).
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

-- Вызов рассылки от лица отправителя: пачка, получатели, payload.
create or replace function tst.send(batch text, uids text, extra text default '') returns text language sql as $$
  select format($f$select * from send_notifications('W', %L::text[], jsonb_build_object('id', %L, 'title', 'Новый заказ', 'body', 'Клиент Аня', 'priority', 'urgent', 'href', '/orders', 'fromName', 'Оля'%s))$f$,
    uids, batch, extra)
$$;

-- ---------------------------------------------------------------------
-- Рассылка.
-- ---------------------------------------------------------------------
select tst.expect('одна RPC создаёт строку на каждого получателя (3)',
  tst.try('OS1', tst.send('b1', '{T1,T2,T3}'), true), 'ok:3');
select tst.run('OS1', tst.send('b1', '{T1,T2,T3}'));
select tst.expect('после рассылки в базе ровно 3 строки пачки',
  (select count(*)::text from public.notifications where id like 'b1\_%'), '3');
select tst.expect('id строки — {пачка}_{uid}',
  (select string_agg(id, ',' order by id) from public.notifications where id like 'b1\_%'), 'b1_T1,b1_T2,b1_T3');
select tst.expect('from_uid — из токена отправителя',
  (select string_agg(distinct from_uid, ',') from public.notifications where id like 'b1\_%'), 'OS1');
select tst.expect('повтор той же пачки (ответ потерялся) — дублей нет, принятые те же',
  tst.try('OS1', tst.send('b1', '{T1,T2,T3}'), true), 'ok:3');
select tst.run('OS1', tst.send('b1', '{T1,T2,T3}'));
select tst.expect('после повтора пачки строк по-прежнему 3',
  (select count(*)::text from public.notifications where id like 'b1\_%'), '3');
select tst.expect('отправитель в списке получателей — себе не пишется',
  tst.try('T1', tst.send('b2', '{T1,T2}'), true), 'ok:1');
select tst.expect('повтор uid в списке — одна строка',
  tst.try('T1', tst.send('b3', '{T2,T2,T2}'), true), 'ok:1');
select tst.expect('не участник среди получателей молча пропускается',
  tst.try('T1', tst.send('b4', '{T2,X,NOPE}'), true), 'ok:1');
select tst.expect('пустой и null список — пусто без ошибки',
  tst.try('T1', $q$select * from send_notifications('W', null, '{"id":"b5"}'::jsonb)$q$, true), 'ok:0');
select tst.expect('посторонний (настоящий токен) не рассылает',
  tst.try('X', tst.send('b6', '{T1}'), true), 'error');
select tst.expect('анонимный ключ не рассылает',
  tst.try('__anon_key__', tst.send('b7', '{T1}'), true), 'error');
select tst.expect('токен чужого проекта с uid участника не рассылает',
  tst.try('__forged__:T1', tst.send('b8', '{T2}'), true), 'error');
select tst.expect('чужой fromUid в payload — отказ',
  tst.try('T1', tst.send('b9', '{T2}', $e$, 'fromUid', 'O'$e$), true), 'error');
select tst.expect('свой fromUid в payload проходит',
  tst.try('T1', tst.send('b10', '{T2}', $e$, 'fromUid', 'T1'$e$), true), 'ok:1');
select tst.expect('рассылка в чужой workspace — отказ',
  tst.try('T1', $q$select * from send_notifications('NOPE', '{T2}', '{"id":"b11"}'::jsonb)$q$, true), 'error');
select tst.expect('id пачки со слешем — отказ',
  tst.try('T1', tst.send('a/b', '{T2}'), true), 'error');
select tst.expect('без id пачки — отказ',
  tst.try('T1', $q$select * from send_notifications('W', '{T2}', '{"title":"x"}'::jsonb)$q$, true), 'error');
select tst.expect('payload не объект — отказ',
  tst.try('T1', $q$select * from send_notifications('W', '{T2}', '[]'::jsonb)$q$, true), 'error');
select tst.expect('больше 500 получателей — отказ',
  tst.try('T1', format('select * from send_notifications(%L, %L::text[], %L::jsonb)', 'W',
    (select array_agg('U' || g)::text from generate_series(1, 501) g), '{"id":"b12"}'), true), 'error');
-- Фикстуры (остаются): T1 → T2 ещё четыре пачки.
select tst.run('T1', tst.send('b2', '{T1,T2}'));
select tst.run('T1', tst.send('b3', '{T2}'));
select tst.run('T1', tst.send('b4', '{T2}'));
select tst.run('T1', tst.send('b10', '{T2}'));
select tst.expect('прямая вставка участником — отказ (только через RPC)',
  tst.try('T1', $q$insert into notifications (workspace_id, id, target_uid, from_uid, created_at) values ('W','x1','T2','T1',1)$q$), 'error');
select tst.expect('прямая вставка «себе» — тоже отказ',
  tst.try('T2', $q$insert into notifications (workspace_id, id, target_uid, from_uid, created_at) values ('W','x2','T2','T2',1)$q$), 'error');

do $$
declare
  server_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  r record;
begin
  perform tst.run('T1', tst.send('b13', '{T2}', $e$, 'createdAt', 1, 'priority', 'бред', 'title', repeat('я', 999)$e$));
  select * into r from public.notifications where id = 'b13_T2';
  perform tst.expect('created_at — серверное время, а не присланное', (abs(r.created_at - server_ms) < 60000)::text, 'true');
  perform tst.expect('неизвестный priority → normal', r.priority, 'normal');
  perform tst.expect('длинный заголовок обрезан до 300', length(r.title)::text, '300');
  perform tst.expect('rev поставила база', (r.rev > 0)::text, 'true');
  perform tst.expect('новое — непрочитано', r.read::text, 'false');
  perform tst.expect('поля payload легли в столбцы', (select href || '|' || from_name from public.notifications where id = 'b1_T2'), '/orders|Оля');
end;
$$;

-- ---------------------------------------------------------------------
-- Чтение: только адресат.
-- ---------------------------------------------------------------------
select tst.expect('адресат читает свои', tst.try('T2', $q$select * from notifications where id like 'b1\_%'$q$, true), 'ok:1');
select tst.expect('адресат видит только свои (весь список)',
  tst.try('T3', $q$select * from notifications$q$, true), 'ok:1');
select tst.expect('отправитель чужих не читает', tst.try('OS1', $q$select * from notifications$q$, true), 'ok:0');
select tst.expect('Owner чужих не читает', tst.try('O', $q$select * from notifications$q$, true), 'ok:0');
select tst.expect('посторонний не читает', tst.try('X', $q$select * from notifications$q$, true), 'ok:0');
select tst.expect('анонимный ключ не читает', tst.try('__anon_key__', $q$select * from notifications$q$, true), 'ok:0');
select tst.expect('токен чужого проекта с uid адресата не читает',
  tst.try('__forged__:T2', $q$select * from notifications$q$, true), 'ok:0');

-- ---------------------------------------------------------------------
-- Правка: только read, только своё.
-- ---------------------------------------------------------------------
select tst.expect('адресат помечает своё прочитанным',
  tst.try('T2', $q$update notifications set read = true where workspace_id = 'W' and id = 'b1_T2'$q$), 'ok:1');
select tst.expect('чужое прочитанным не пометить',
  tst.try('T3', $q$update notifications set read = true where workspace_id = 'W' and id = 'b1_T2'$q$), 'deny');
select tst.expect('отправитель не помечает за получателя',
  tst.try('OS1', $q$update notifications set read = true where workspace_id = 'W' and id = 'b1_T2'$q$), 'deny');
select tst.expect('заголовок своего не переписать',
  tst.try('T2', $q$update notifications set title = 'подделка' where workspace_id = 'W' and id = 'b1_T2'$q$), 'error');
select tst.expect('своё не переадресовать другому',
  tst.try('T2', $q$update notifications set target_uid = 'T3' where workspace_id = 'W' and id = 'b1_T2'$q$), 'error');
select tst.expect('rev руками не поставить',
  tst.try('T2', $q$update notifications set rev = 1 where workspace_id = 'W' and id = 'b1_T2'$q$), 'error');
select tst.expect('read + другое поле одним запросом — отказ',
  tst.try('T2', $q$update notifications set read = true, body = 'x' where workspace_id = 'W' and id = 'b1_T2'$q$), 'error');

-- Страж держит и без прав на столбцы (вторая стена): суперпользователь идёт мимо прав, но не мимо триггера.
do $$
begin
  begin
    update public.notifications set title = 'подделка' where workspace_id = 'W' and id = 'b1_T3';
    perform tst.expect('триггер не даёт менять ничего, кроме read', 'прошло', 'отказ');
  exception when others then
    perform tst.expect('триггер не даёт менять ничего, кроме read', sqlstate, '42501');
  end;
end;
$$;

do $$
declare
  rev0 bigint;
  rev1 bigint;
  at1 timestamptz;
begin
  select rev into rev0 from public.notifications where id = 'b1_T3';
  perform tst.run('T3', $q$update notifications set read = true where workspace_id = 'W' and id = 'b1_T3'$q$);
  select rev, server_at into rev1, at1 from public.notifications where id = 'b1_T3';
  perform tst.expect('пометка прочитанным двигает rev (дельта других устройств её увидит)', (rev1 > rev0)::text, 'true');
  perform tst.expect('повторная пометка уже прочитанного — 0 строк',
    tst.try('T3', $q$update notifications set read = true where workspace_id = 'W' and id = 'b1_T3'$q$), 'ok:0');
  perform tst.run('T3', $q$update notifications set read = true where workspace_id = 'W' and id = 'b1_T3'$q$);
  perform tst.expect('повторная пометка rev не двигает',
    (select (rev = rev1)::text from public.notifications where id = 'b1_T3'), 'true');
end;
$$;

-- «Прочитать всё» — один UPDATE по моим непрочитанным до известного rev.
do $$
declare
  cutoff bigint;
begin
  -- У T2 непрочитанные b1, b2, b3, b4, b10 и (позже курсора) b13.
  select rev into cutoff from public.notifications where id = 'b10_T2';
  perform tst.expect('«прочитать всё» до курсора — одним запросом только мои до него',
    tst.try('T2', format($q$update notifications set read = true where workspace_id = 'W' and target_uid = 'T2' and read = false and rev <= %s$q$, cutoff)), 'ok:5');
  perform tst.expect('«прочитать всё» не трогает чужие',
    tst.try('T2', $q$update notifications set read = true where workspace_id = 'W' and read = false$q$), 'ok:6');
end;
$$;

-- Дельта: мои rev > курсор.
do $$
declare
  cur bigint;
begin
  select max(rev) into cur from public.notifications where target_uid = 'T2';
  perform tst.expect('дельта после курсора пуста',
    tst.try('T2', format($q$select * from notifications where workspace_id = 'W' and target_uid = 'T2' and rev > %s$q$, cur), true), 'ok:0');
  perform tst.run('OS1', tst.send('b14', '{T2,T3}'));
  perform tst.expect('новая рассылка видна в дельте адресата одной строкой',
    tst.try('T2', format($q$select * from notifications where workspace_id = 'W' and target_uid = 'T2' and rev > %s$q$, cur), true), 'ok:1');
end;
$$;

-- ---------------------------------------------------------------------
-- Удаление и чистка.
-- ---------------------------------------------------------------------
select tst.expect('адресат удаляет своё', tst.try('T2', $q$delete from notifications where workspace_id = 'W' and id = 'b1_T2'$q$), 'ok:1');
select tst.expect('чужое не удалить', tst.try('T3', $q$delete from notifications where workspace_id = 'W' and id = 'b1_T2'$q$), 'deny');
select tst.expect('посторонний не удаляет', tst.try('X', $q$delete from notifications$q$), 'deny');
select tst.expect('TRUNCATE ролям API закрыт', tst.try('T2', $q$truncate notifications$q$), 'error');

-- Старые (15 дней) прочитанные и непрочитанные у T2, старое прочитанное у T3.
alter table public.notifications disable trigger notifications_10_guard;
update public.notifications set created_at = created_at - 15::bigint * 86400000 where id in ('b2_T2', 'b3_T2', 'b4_T2', 'b1_T3');
update public.notifications set read = true where id in ('b2_T2', 'b3_T2', 'b10_T2');
alter table public.notifications enable trigger notifications_10_guard;
select tst.expect('чистка удаляет мои прочитанные старше 14 дней (2)',
  tst.val('T2', $q$select cleanup_read_notifications('W')::text$q$), '2');
select tst.expect('непрочитанное старое осталось', (select count(*)::text from public.notifications where id = 'b4_T2'), '1');
select tst.expect('свежее прочитанное осталось', (select count(*)::text from public.notifications where id = 'b10_T2'), '1');
select tst.expect('чужое старое прочитанное чистка T2 не тронула', (select count(*)::text from public.notifications where id = 'b1_T3'), '1');
select tst.expect('посторонний чисткой ничего не удаляет', tst.val('X', $q$select cleanup_read_notifications('W')::text$q$), '0');
select tst.expect('анонимный ключ чисткой ничего не удаляет', tst.val('__anon_key__', $q$select cleanup_read_notifications('W')::text$q$), '0');

-- ---------------------------------------------------------------------
-- Повторный накат файла (кнопка «Скопировать SQL» вставляет все файлы
-- разом и повторно). Сначала — права «как в Supabase» (default privileges
-- отдают ролям API ВСЁ, включая INSERT и TRUNCATE): накат обязан их забрать.
-- ---------------------------------------------------------------------
grant all on public.notifications to anon, authenticated;
create temp table tst_notif_before as select count(*) as n from public.notifications;
\ir ../migrations/20260930_notifications.sql
select tst.expect('после повторного наката строки на месте',
  (select (count(*) = (select n from tst_notif_before))::text from public.notifications), 'true');
select tst.expect('после повторного наката политик ровно три',
  (select count(*)::text from pg_policies where tablename = 'notifications'), '3');
select tst.expect('после повторного наката триггеров два',
  (select count(*)::text from pg_trigger where tgrelid = 'public.notifications'::regclass and not tgisinternal), '2');
select tst.expect('после наката поверх «всех прав» прямая вставка снова закрыта',
  tst.try('T1', $q$insert into notifications (workspace_id, id, target_uid, from_uid, created_at) values ('W','x3','T2','T1',1)$q$), 'error');
select tst.expect('после наката поверх «всех прав» TRUNCATE закрыт',
  tst.try('T2', $q$truncate notifications$q$), 'error');
select tst.expect('после наката поверх «всех прав» заголовок не переписать',
  tst.try('T2', $q$update notifications set title = 'x' where workspace_id = 'W' and target_uid = 'T2'$q$), 'error');
select tst.expect('после повторного наката рассылка работает',
  tst.try('OS1', tst.send('b15', '{T1,T2}'), true), 'ok:2');
select tst.expect('после повторного наката посторонний по-прежнему не читает',
  tst.try('X', $q$select * from notifications$q$, true), 'ok:0');

-- ---------------------------------------------------------------------
select case when ok then '  OK  ' else 'FAIL  ' end || label || case when ok then '' else '  → ' || got end
from tst.results order by n;
select format('ПРОВЕРОК: %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
