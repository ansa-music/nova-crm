-- =====================================================================
-- Nova CRM — номер правки строки (`rev`) и «голова» таблицы (повторяемый файл).
--
-- Зачем. Postgres Changes в проде не поднимается (токен Firebase без claim
-- `role`), и открытый стол узнаёт о правках «звонком» (rowsDoorbell) — а
-- дочитывал он после КАЖДОЙ своей правки и каждого звонка ВСЮ таблицу:
-- 100–400 КБ и две полные перерисовки на правку у каждого, у кого стол
-- открыт, при лимите Supabase Free 5 ГБ трафика в месяц.
--
-- Теперь у каждой строки есть `rev` — номер из общей последовательности,
-- его ставит триггер на КАЖДОЙ вставке и правке (клиент его не пишет и
-- подделать не может). Стол дочитывает только `rev > курсор` (обычно 1–2
-- строки), а удаления и «обгон фиксаций» (правка с меньшим номером
-- зафиксировалась позже большей) ловит «голова» — число строк и md5 пар
-- id:rev. Содержимое строк в голову НЕ входит (в отличие от
-- rows_table_stamp) — она дешёвая, а rev и так меняется при любой правке.
--
-- rows_table_stamp НЕ трогаем: им пользуются вкладки на старом коде.
-- Пока этот файл не накатан, клиент молча работает по-старому (нет колонки
-- или функции — коды 42703/PGRST202/42883).
-- =====================================================================

-- Общая последовательность номеров правок (её же берут и другие таблицы
-- переноса; `if not exists` — чтобы файл не зависел от порядка наката).
create sequence if not exists public.nova_rev_seq;
-- Supabase по «default privileges» раздаёт anon/authenticated ВСЕ права на
-- новые последовательности схемы public — и на эту тоже, кто бы её ни
-- создал (этот файл или 20260927). Снимаем: номер ставит только триггер
-- (SECURITY DEFINER, ему право не нужно), а открытая последовательность
-- дала бы любому с ключом сбросить её setval'ом назад.
revoke all on sequence public.nova_rev_seq from public, anon, authenticated;

alter table public.desk_rows add column if not exists rev bigint;

-- Номер ставит база. SECURITY DEFINER — роли anon/authenticated не нужно
-- право на последовательность (иначе любой с ключом крутил бы её сам).
create or replace function public.desk_rows_set_rev() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.rev := nextval('public.nova_rev_seq');
  return new;
end;
$$;

revoke all on function public.desk_rows_set_rev() from public;

-- Имя «desk_rows_rev» идёт по алфавиту ПОСЛЕ desk_rows_guard и
-- desk_rows_os_managed: сначала стражи решают, можно ли, потом номер.
drop trigger if exists desk_rows_rev on public.desk_rows;
create trigger desk_rows_rev before insert or update on public.desk_rows
  for each row execute function public.desk_rows_set_rev();

-- Старые строки — номер один раз (стражи на такой правке ничего не
-- проверяют: ячейки не меняются, а сессия SQL-редактора без токена).
-- Триггер уже стоит, поэтому строка, вставленная в это же время, номер
-- получит сама.
update public.desk_rows set rev = nextval('public.nova_rev_seq') where rev is null;

create index if not exists desk_rows_tab_rev on public.desk_rows (workspace_id, page_id, tab_id, rev);

-- ---------------------------------------------------------------------
-- «Голова» таблицы: число строк, наибольший rev и md5 пар id:rev по id.
-- SECURITY INVOKER — считается под политиками спрашивающего, поэтому про
-- чужой стол посторонний получает {count: 0} и ничего больше.
-- Порядок `collate "C"` — побайтовый: клиент считает тот же md5 у себя и
-- сравнивает с головой, а порядок по языковой сортировке базы он повторить
-- не может.
-- ---------------------------------------------------------------------
create or replace function public.rows_table_head(p_workspace text, p_page text, p_tab text)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'count', count(*),
    'rev', coalesce(max(r.rev), 0),
    'ids', coalesce(md5(string_agg(r.id || ':' || coalesce(r.rev, 0)::text, ',' order by r.id collate "C")), '')
  )
  from public.desk_rows r
  where r.workspace_id = p_workspace and r.page_id = p_page and r.tab_id = coalesce(p_tab, '')
$$;

-- ---------------------------------------------------------------------
-- Дельта: строки с rev > p_after (не больше p_limit) и голова — ОДНИМ
-- запросом, то есть из одного снимка базы. Выборка и голова отдельными
-- запросами расходились бы на правку, пришедшую между ними, и стол
-- перечитывался бы целиком зря. `more` — строк больше лимита (долго не
-- было на столе): клиент тогда читает таблицу целиком обычной выборкой.
-- ---------------------------------------------------------------------
create or replace function public.rows_table_delta(
  p_workspace text,
  p_page text,
  p_tab text,
  p_after bigint,
  p_limit integer default 500
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with scope as (
    select r.*
    from public.desk_rows r
    where r.workspace_id = p_workspace and r.page_id = p_page and r.tab_id = coalesce(p_tab, '')
  ), changed as (
    select s.*
    from scope s
    where coalesce(s.rev, 0) > coalesce(p_after, 0)
    order by s.rev, s.id
    limit greatest(coalesce(p_limit, 500), 1) + 1
  )
  select jsonb_build_object(
    'count', (select count(*) from scope),
    'rev', (select coalesce(max(s.rev), 0) from scope s),
    'ids', (select coalesce(md5(string_agg(s.id || ':' || coalesce(s.rev, 0)::text, ',' order by s.id collate "C")), '') from scope s),
    'rows', coalesce(
      (select jsonb_agg(to_jsonb(c) order by c.rev, c.id)
       from (select * from changed order by rev, id limit greatest(coalesce(p_limit, 500), 1)) c),
      '[]'::jsonb),
    'more', (select count(*) from changed) > greatest(coalesce(p_limit, 500), 1)
  )
$$;

grant execute on function
  public.rows_table_head(text, text, text),
  public.rows_table_delta(text, text, text, bigint, integer)
  to anon, authenticated;
