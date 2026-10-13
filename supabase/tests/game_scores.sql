-- Проверки рейтинга игры (20261047_game_scores.sql). Запускать ПОСЛЕ
-- desk_rows_rls.sql: берёт оттуда хелперы tst.* и участников workspace W
-- (O, T1, T2, T3, OS1, V …; X — посторонний с настоящим токеном).
--
-- Запускать без `psql -1`: проверка даты рекорда сравнивает now(), а в одной
-- транзакции оно стоит на месте.
--
-- Прогон 14.10.2026 на PostgreSQL 16.4 (все миграции дважды → desk_rows_rls.sql
-- → этот файл): 36 проверок, провалов нет; из 10 намеренных поломок миграции
-- пойманы 9, десятая (убрать условие «токен есть») ничего не меняет — без
-- токена человек и так не участник.
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

-- Фикстура: T2 уже сыграл на 30 (остаётся после проверки).
select tst.run('T2', $q$select * from game_submit_score('W', 'lanes', 30)$q$);

-- ---------------------------------------------------------------------
-- Запись — только функцией и только за себя.
-- ---------------------------------------------------------------------
select tst.expect('участник кладёт счёт одним вызовом',
  tst.try('T1', $q$select * from game_submit_score('W', 'lanes', 12)$q$, true), 'ok:1');
select tst.expect('Viewer тоже участник — играет',
  tst.try('V', $q$select * from game_submit_score('W', 'lanes', 3)$q$, true), 'ok:1');
select tst.expect('посторонний не пишет (пусто, не ошибка)',
  tst.try('X', $q$select * from game_submit_score('W', 'lanes', 12)$q$, true), 'ok:0');
select tst.expect('анонимный ключ не пишет',
  tst.try('__anon_key__', $q$select * from game_submit_score('W', 'lanes', 12)$q$, true), 'ok:0');
select tst.expect('токен чужого проекта с uid участника не пишет',
  tst.try('__forged__:T1', $q$select * from game_submit_score('W', 'lanes', 12)$q$, true), 'ok:0');
select tst.expect('workspace без копии прав молча пропускается',
  tst.try('T1', $q$select * from game_submit_score('NOPE', 'lanes', 12)$q$, true), 'ok:0');
select tst.expect('неизвестный код игры — пусто',
  tst.try('T1', $q$select * from game_submit_score('W', 'other', 12)$q$, true), 'ok:0');
select tst.expect('код игры null — пусто',
  tst.try('T1', $q$select * from game_submit_score('W', null, 12)$q$, true), 'ok:0');
select tst.expect('прямой вставки нет',
  tst.try('T1', $q$insert into game_scores (workspace_id, game, uid, best, plays) values ('W', 'lanes', 'T1', 99999, 1)$q$), 'error');
select tst.expect('свой счёт напрямую не поправить',
  tst.try('T2', $q$update game_scores set best = 99999 where workspace_id = 'W' and uid = 'T2'$q$), 'deny');
select tst.expect('чужой счёт напрямую не поправить',
  tst.try('T1', $q$update game_scores set best = 0 where workspace_id = 'W' and uid = 'T2'$q$), 'deny');
select tst.expect('удаления с клиента нет',
  tst.try('T2', $q$delete from game_scores where workspace_id = 'W' and uid = 'T2'$q$), 'deny');

-- ---------------------------------------------------------------------
-- Рекорд — максимум, партии считаются, счёт режется потолком.
-- ---------------------------------------------------------------------
select tst.expect('счёт ниже рекорда: рекорд прежний, партий больше',
  tst.val('T2', $q$select best::text || '/' || plays::text from game_submit_score('W', 'lanes', 10)$q$), '30/2');

select best_at::text as before_at from public.game_scores where workspace_id = 'W' and game = 'lanes' and uid = 'T2' \gset
select pg_sleep(0.05);
select tst.expect('ещё один счёт ниже рекорда',
  tst.val('T2', $q$select best::text || '/' || plays::text from game_submit_score('W', 'lanes', 1)$q$), '30/3');
select tst.expect('счёт ниже рекорда не двигает дату рекорда',
  (select (best_at = :'before_at'::timestamptz)::text from public.game_scores where workspace_id = 'W' and game = 'lanes' and uid = 'T2'), 'true');
select tst.expect('счёт выше рекорда — новый рекорд',
  tst.val('T2', $q$select best::text || '/' || plays::text from game_submit_score('W', 'lanes', 45)$q$), '45/4');
select tst.expect('новый рекорд двигает дату рекорда',
  (select (best_at > :'before_at'::timestamptz)::text from public.game_scores where workspace_id = 'W' and game = 'lanes' and uid = 'T2'), 'true');

select tst.expect('отрицательный счёт — ноль',
  tst.val('T3', $q$select best::text || '/' || plays::text from game_submit_score('W', 'lanes', -5)$q$), '0/1');
select tst.expect('счёт выше потолка режется до 100000',
  tst.val('T3', $q$select best::text || '/' || plays::text from game_submit_score('W', 'lanes', 9999999)$q$), '100000/2');
select tst.expect('счёт null — ноль',
  tst.val('OS1', $q$select best::text || '/' || plays::text from game_submit_score('W', 'lanes', null)$q$), '0/1');
select tst.expect('чужой uid в строке не появляется — пишется uid из токена',
  (select count(*)::text from public.game_scores where workspace_id = 'W' and uid not in ('T2', 'T3', 'OS1')), '0');

-- ---------------------------------------------------------------------
-- Чтение — любой участник workspace.
-- ---------------------------------------------------------------------
select tst.expect('участник видит рейтинг целиком',
  tst.try('T1', $q$select * from game_scores where workspace_id = 'W' and game = 'lanes'$q$, true), 'ok:3');
select tst.expect('Viewer видит рейтинг',
  tst.try('V', $q$select * from game_scores where workspace_id = 'W'$q$, true), 'ok:3');
select tst.expect('посторонний не читает',
  tst.try('X', $q$select * from game_scores$q$, true), 'ok:0');
select tst.expect('анонимный ключ не читает',
  tst.try('__anon_key__', $q$select * from game_scores$q$, true), 'ok:0');
select tst.expect('порядок рейтинга: выше — больший счёт',
  tst.val('T1', $q$select string_agg(uid, ',' order by best desc, best_at asc) from game_scores where workspace_id = 'W' and game = 'lanes'$q$), 'T3,T2,OS1');

-- Выдуманный код игры строк не плодит.
select tst.expect('неизвестная игра строку не заводит',
  tst.val('T2', $q$select count(*)::text from game_submit_score('W', 'other', 5)$q$), '0');
select tst.expect('строк по-прежнему три',
  (select count(*)::text from public.game_scores where workspace_id = 'W'), '3');

-- ---------------------------------------------------------------------
-- Повторный накат файла (кнопка «Скопировать SQL» вставляет все файлы
-- разом и повторно) ничего не ломает и данных не теряет. Сначала — права
-- «как в Supabase» (default privileges отдают ролям API ВСЁ, включая INSERT
-- и TRUNCATE): накат обязан их забрать.
-- ---------------------------------------------------------------------
grant all on public.game_scores to anon, authenticated;
\ir ../migrations/20261047_game_scores.sql
select tst.expect('после повторного наката счёт на месте',
  (select count(*)::text from public.game_scores where workspace_id = 'W'), '3');
select tst.expect('после повторного наката рекорд на месте',
  (select best::text from public.game_scores where workspace_id = 'W' and game = 'lanes' and uid = 'T2'), '45');
select tst.expect('после повторного наката политика одна',
  (select count(*)::text from pg_policies where tablename = 'game_scores'), '1');
select tst.expect('после повторного наката участник кладёт счёт',
  tst.try('T1', $q$select * from game_submit_score('W', 'lanes', 7)$q$, true), 'ok:1');
select tst.expect('после наката поверх «всех прав» прямая вставка снова закрыта',
  tst.try('T1', $q$insert into game_scores (workspace_id, game, uid, best, plays) values ('W', 'lanes', 'T1', 5, 1)$q$), 'error');
select tst.expect('после наката поверх «всех прав» свой счёт напрямую не поправить',
  tst.try('T2', $q$update game_scores set best = 99999 where workspace_id = 'W' and uid = 'T2'$q$), 'error');
select tst.expect('после наката поверх «всех прав» TRUNCATE закрыт',
  tst.try('T2', $q$truncate game_scores$q$), 'error');
select tst.expect('после повторного наката посторонний по-прежнему не читает',
  tst.try('X', $q$select * from game_scores$q$, true), 'ok:0');

-- ---------------------------------------------------------------------
select case when ok then '  OK  ' else 'FAIL  ' end || label || case when ok then '' else '  → ' || got end
from tst.results order by n;
select format('ПРОВЕРОК: %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
