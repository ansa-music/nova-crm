-- =====================================================================
-- Nova CRM — «отметка таблицы» для живых строк (повторяемый файл).
--
-- Живые строки приходят через Supabase Realtime. Если канал не поднялся
-- (сеть, расширение браузера, прокси) или молчит, открытый стол не узнал
-- бы о чужих правках до перезагрузки. Страховка: стол раз в 15 секунд
-- спрашивает короткую отметку своей таблицы (число строк + хеш) и
-- перечитывает строки ТОЛЬКО если она сменилась — это десятки байт вместо
-- всей таблицы.
--
-- SECURITY INVOKER: отметку считает сам спрашивающий под своими политиками
-- RLS, поэтому она отражает ровно те строки, которые он и так читает, и
-- ничего не говорит о чужих столах.
-- =====================================================================

create or replace function public.rows_table_stamp(p_workspace text, p_page text, p_tab text)
returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select count(*)::text || ':' || coalesce(md5(string_agg(md5(r::text), '' order by r.id)), '')
  from public.desk_rows r
  where r.workspace_id = p_workspace and r.page_id = p_page and r.tab_id = coalesce(p_tab, '')
$$;

grant execute on function public.rows_table_stamp(text, text, text) to anon, authenticated;
