-- =====================================================================
-- Номер правки строки и голова таблицы (20260929_desk_rows_rev.sql).
-- Запуск ПОСЛЕ desk_rows_rls.sql (берёт его схему tst, участников и столы).
-- Итог — строка «ПРОВЕРОК: N, ПРОВАЛЕНО: 0».
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;
truncate tst.results;

-- Как в настоящем Supabase: default privileges схемы public раздают API-ролям
-- все права на последовательности (заглушка этого не делает). Выдаём их так,
-- как выдал бы Supabase при создании, и накатываем файл повторно — как
-- Nurba вставляет все миграции разом. Проверки ниже должны увидеть, что
-- revoke из файла права снял.
grant all on sequence public.nova_rev_seq to public, anon, authenticated;
\ir ../migrations/20260929_desk_rows_rev.sql
select tst.expect('после наката у anon нет прав на последовательность',
  (has_sequence_privilege('anon', 'public.nova_rev_seq', 'USAGE')
   or has_sequence_privilege('anon', 'public.nova_rev_seq', 'UPDATE')
   or has_sequence_privilege('anon', 'public.nova_rev_seq', 'SELECT'))::text, 'false');
select tst.expect('после наката у authenticated нет прав на последовательность',
  (has_sequence_privilege('authenticated', 'public.nova_rev_seq', 'USAGE')
   or has_sequence_privilege('authenticated', 'public.nova_rev_seq', 'UPDATE')
   or has_sequence_privilege('authenticated', 'public.nova_rev_seq', 'SELECT'))::text, 'false');

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

create or replace function tst.rev_of(p_page text, p_tab text, p_id text) returns bigint language sql as $$
  select rev from public.desk_rows where workspace_id = 'W' and page_id = p_page and tab_id = p_tab and id = p_id
$$;

-- Голова, посчитанная «как клиент»: id:rev по возрастанию id побайтово.
create or replace function tst.client_ids(p_page text, p_tab text) returns text language sql as $$
  select coalesce(md5(string_agg(id || ':' || rev::text, ',' order by convert_to(id, 'UTF8'))), '')
  from public.desk_rows where workspace_id = 'W' and page_id = p_page and tab_id = p_tab
$$;

do $$
declare
  r1_before bigint := tst.rev_of('P1', '', 'r1');
  r2_before bigint := tst.rev_of('P1', '', 'r2');
  r1_after bigint;
  new_rev bigint;
  head_owner jsonb;
  head_t1 jsonb;
  head_after jsonb;
  delta jsonb;
  seq_before bigint;
begin
  perform tst.expect('старые строки получили номер при накате',
    (select count(*) from public.desk_rows where rev is null)::text, '0');
  perform tst.expect('номера старых строк различны',
    (select (count(distinct rev) = count(*))::text from public.desk_rows), 'true');

  -- Правка через rows_patch поднимает номер.
  perform tst.run('T1', $q$select rows_patch('W','P1','','r1','{"rev":"1"}'::jsonb)$q$);
  r1_after := tst.rev_of('P1', '', 'r1');
  perform tst.expect('rows_patch поднимает rev', (r1_after > r1_before)::text, 'true');
  perform tst.expect('rows_patch не трогает rev соседней строки', (tst.rev_of('P1', '', 'r2') = r2_before)::text, 'true');

  -- Вставка через rows_patch (строки нет — заводится).
  perform tst.run('T1', $q$select rows_patch('W','P1','','rnew','{"client":"Новый"}'::jsonb)$q$);
  new_rev := tst.rev_of('P1', '', 'rnew');
  perform tst.expect('вставка получает rev', (new_rev is not null)::text, 'true');
  perform tst.expect('rev растёт монотонно (вставка после правки)', (new_rev > r1_after)::text, 'true');

  -- Прямой upsert (sbPutRows) — тоже номер.
  perform tst.run('T1', $q$insert into desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at)
    values ('W','P1','','rput','{}'::jsonb, 9, 1, 1)
    on conflict (workspace_id, page_id, tab_id, id) do update set cells = excluded.cells$q$);
  perform tst.expect('upsert вставки получает rev', (tst.rev_of('P1', '', 'rput') > new_rev)::text, 'true');

  -- Клиент номер не подделает: триггер ставит свой.
  perform tst.run('T1', $q$update desk_rows set rev = 1, cells = cells || '{"x":"1"}'::jsonb
    where workspace_id='W' and page_id='P1' and tab_id='' and id='r2'$q$);
  perform tst.expect('rev из запроса игнорируется (подделать нельзя)', (tst.rev_of('P1', '', 'r2') > new_rev)::text, 'true');
  perform tst.run('T1', $q$insert into desk_rows (workspace_id, page_id, tab_id, id, cells, sort_order, created_at, updated_at, rev)
    values ('W','P1','','rfake','{}'::jsonb, 10, 1, 1, 1)$q$);
  perform tst.expect('rev во вставке игнорируется', (tst.rev_of('P1', '', 'rfake') > new_rev)::text, 'true');

  -- Порядок: номер получают только сдвинутые строки.
  r1_before := tst.rev_of('P1', '', 'r1');
  r2_before := tst.rev_of('P1', '', 'r2');
  perform tst.run('T1', $q$select rows_set_order('W','P1','',array['r2','r1'])$q$);
  perform tst.expect('rows_set_order поднимает rev сдвинутой строки', (tst.rev_of('P1', '', 'r1') > r1_before)::text, 'true');
  perform tst.expect('rows_set_order поднимает rev второй сдвинутой', (tst.rev_of('P1', '', 'r2') > r2_before)::text, 'true');
  r1_before := tst.rev_of('P1', '', 'r1');
  perform tst.run('T1', $q$select rows_set_order('W','P1','',array['r2','r1'])$q$);
  perform tst.expect('тот же порядок — rev не меняется', (tst.rev_of('P1', '', 'r1') = r1_before)::text, 'true');

  -- Последовательность закрыта для ключа API.
  perform tst.expect('anon не крутит последовательность сам',
    tst.try('T1', $q$select nextval('public.nova_rev_seq')$q$), 'error');
  perform tst.expect('посторонний тоже', tst.try('X', $q$select setval('public.nova_rev_seq', 1)$q$), 'error');

  -- Голова под RLS.
  head_owner := tst.val('O', $q$select rows_table_head('W','P1','')::text$q$)::jsonb;
  head_t1 := tst.val('T1', $q$select rows_table_head('W','P1','')::text$q$)::jsonb;
  perform tst.expect('голова: число строк как в таблице', head_t1->>'count',
    (select count(*)::text from public.desk_rows where workspace_id='W' and page_id='P1' and tab_id=''));
  perform tst.expect('голова: наибольший rev', head_t1->>'rev',
    (select max(rev)::text from public.desk_rows where workspace_id='W' and page_id='P1' and tab_id=''));
  perform tst.expect('голова: md5 id:rev совпадает с посчитанным «как клиент»', head_t1->>'ids', tst.client_ids('P1', ''));
  perform tst.expect('голова ответственного = голова Owner', head_t1::text, head_owner::text);
  perform tst.expect('посторонний: голова пустая', tst.val('X', $q$select rows_table_head('W','P1','')::text$q$),
    '{"ids": "", "rev": 0, "count": 0}');
  perform tst.expect('анонимный ключ: голова пустая', tst.val('__anon_key__', $q$select rows_table_head('W','P1','')::text$q$),
    '{"ids": "", "rev": 0, "count": 0}');
  perform tst.expect('чужой технарь: голова скрытого стола пустая', tst.val('T1', $q$select rows_table_head('W','P2','')::text$q$),
    '{"ids": "", "rev": 0, "count": 0}');
  perform tst.expect('null вкладки = «Основная»', tst.val('T1', $q$select rows_table_head('W','P1',null)::text$q$), head_t1::text);
  perform tst.expect('голова вкладки — только её строки',
    tst.val('T1', $q$select rows_table_head('W','P1','m1')->>'count'$q$), '1');

  -- Правка меняет md5, но не число; удаление — число.
  perform tst.run('T1', $q$select rows_patch('W','P1','','r1','{"rev":"2"}'::jsonb)$q$);
  head_after := tst.val('T1', $q$select rows_table_head('W','P1','')::text$q$)::jsonb;
  perform tst.expect('правка: число строк то же', head_after->>'count', head_t1->>'count');
  perform tst.expect('правка: md5 id:rev другой', ((head_after->>'ids') <> (head_t1->>'ids'))::text, 'true');
  perform tst.expect('правка: rev головы вырос', ((head_after->>'rev')::bigint > (head_t1->>'rev')::bigint)::text, 'true');
  perform tst.run('T1', $q$delete from desk_rows where workspace_id='W' and page_id='P1' and tab_id='' and id='rfake'$q$);
  head_t1 := head_after;
  head_after := tst.val('T1', $q$select rows_table_head('W','P1','')::text$q$)::jsonb;
  perform tst.expect('удаление: число строк меньше', ((head_after->>'count')::int = (head_t1->>'count')::int - 1)::text, 'true');
  perform tst.expect('удаление: md5 другой', ((head_after->>'ids') <> (head_t1->>'ids'))::text, 'true');
  perform tst.expect('удаление: md5 совпадает с «клиентом»', head_after->>'ids', tst.client_ids('P1', ''));

  -- Дельта.
  delta := tst.val('T1', format($q$select rows_table_delta('W','P1','',%s)::text$q$, head_after->>'rev'))::jsonb;
  perform tst.expect('дельта с курсором = голова: строк нет', jsonb_array_length(delta->'rows')::text, '0');
  perform tst.expect('дельта несёт ту же голову', (delta->>'ids') || '/' || (delta->>'count'),
    (head_after->>'ids') || '/' || (head_after->>'count'));
  perform tst.expect('дельта: more = false', delta->>'more', 'false');
  seq_before := (head_after->>'rev')::bigint;
  perform tst.run('T1', $q$select rows_patch('W','P1','','r2','{"delta":"1"}'::jsonb)$q$);
  delta := tst.val('T3', format($q$select rows_table_delta('W','P1','',%s)::text$q$, seq_before))::jsonb;
  perform tst.expect('чужая правка приходит одной строкой', jsonb_array_length(delta->'rows')::text, '1');
  perform tst.expect('в дельте вся строка (ячейки целиком)', delta->'rows'->0->'cells'->>'client', 'Боря');
  perform tst.expect('в дельте есть rev строки', ((delta->'rows'->0->>'rev')::bigint > seq_before)::text, 'true');
  perform tst.expect('посторонний: дельта пустая', tst.val('X', format($q$select rows_table_delta('W','P1','',0)::text$q$)),
    '{"ids": "", "rev": 0, "more": false, "rows": [], "count": 0}');
  delta := tst.val('T1', $q$select rows_table_delta('W','P1','',0,2)::text$q$)::jsonb;
  perform tst.expect('лимит: не больше p_limit строк', jsonb_array_length(delta->'rows')::text, '2');
  perform tst.expect('лимит: more = true', delta->>'more', 'true');
  delta := tst.val('T1', $q$select rows_table_delta('W','P1','',0,1000)::text$q$)::jsonb;
  perform tst.expect('дельта с нуля = вся таблица', jsonb_array_length(delta->'rows')::text, delta->>'count');
  perform tst.expect('дельта по возрастанию rev',
    (select bool_and(a <= b)::text from (
      select (e->>'rev')::bigint a, lead((e->>'rev')::bigint) over (order by o) b
      from jsonb_array_elements(delta->'rows') with ordinality t(e, o)) s where b is not null), 'true');
  -- ОС в чужом столе видит только свои строки-заказы — и голова только по ним.
  perform tst.expect('ОС (роль открывает все столы): голова — вся таблица',
    tst.val('OS2', $q$select rows_table_head('W','P1','')->>'count'$q$),
    (select count(*)::text from public.desk_rows where workspace_id='W' and page_id='P1' and tab_id=''));
end;
$$;

-- Повторный накат файла ничего не ломает и номера не переписывает.
create temp table rev_before as select workspace_id, page_id, tab_id, id, rev from public.desk_rows;
\ir ../migrations/20260929_desk_rows_rev.sql
select tst.expect('повторный накат: номера строк прежние',
  (select count(*)::text from public.desk_rows d join rev_before b using (workspace_id, page_id, tab_id, id) where d.rev <> b.rev), '0');
select tst.expect('повторный накат: триггер один',
  (select count(*)::text from pg_trigger where tgrelid = 'public.desk_rows'::regclass and tgname = 'desk_rows_rev'), '1');
select tst.expect('после повторного наката rev по-прежнему ставится',
  tst.try('T1', $q$select rows_patch('W','P1','','r1','{"again":"1"}'::jsonb)$q$), 'ok:1');
select tst.expect('rows_table_stamp (старые вкладки) жив',
  (tst.val('T1', $q$select rows_table_stamp('W','P1','')$q$) like '%:%')::text, 'true');

select case when ok then '  OK  ' else 'FAIL  ' end || label || case when ok then '' else '  → ' || got end
from tst.results order by n;
select format('ПРОВЕРОК: %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
