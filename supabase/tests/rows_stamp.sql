-- Проверки «отметки таблицы» (20260924_rows_stamp.sql). Запускать ПОСЛЕ
-- desk_rows_rls.sql: берёт оттуда хелперы tst.* и заведённые столы.
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

do $$
declare
  owner_stamp text := tst.val('O', $q$select rows_table_stamp('W','P1','')$q$);
  reader_stamp text := tst.val('T1', $q$select rows_table_stamp('W','P1','')$q$);
  outsider_stamp text := tst.val('X', $q$select rows_table_stamp('W','P1','')$q$);
  anon_stamp text := tst.val('__anon_key__', $q$select rows_table_stamp('W','P1','')$q$);
  rows_seen int;
  after_stamp text;
begin
  select count(*) into rows_seen from public.desk_rows where workspace_id = 'W' and page_id = 'P1' and tab_id = '';
  perform tst.expect('отметка ответственного: число строк как в таблице', split_part(reader_stamp, ':', 1), rows_seen::text);
  perform tst.expect('отметка ответственного = отметка Owner (видят одно и то же)', reader_stamp, owner_stamp);
  perform tst.expect('посторонний: пустая отметка, про чужой стол ничего', outsider_stamp, '0:');
  perform tst.expect('анонимный ключ: пустая отметка', anon_stamp, '0:');
  perform tst.run('T1', $q$select rows_patch('W','P1','','r1','{"stamp":"1"}'::jsonb)$q$);
  after_stamp := tst.val('T1', $q$select rows_table_stamp('W','P1','')$q$);
  perform tst.expect('правка ячейки меняет отметку', (after_stamp <> reader_stamp)::text, 'true');
  perform tst.expect('та же таблица — та же отметка (стабильна)', tst.val('T1', $q$select rows_table_stamp('W','P1','')$q$), after_stamp);
  perform tst.expect('null вкладки = «Основная»', tst.val('T1', $q$select rows_table_stamp('W','P1',null)$q$), after_stamp);
end;
$$;

select case when ok then '  OK  ' else 'FAIL  ' end || label || case when ok then '' else '  → ' || got end
from tst.results order by n;
select format('ПРОВЕРОК: %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
