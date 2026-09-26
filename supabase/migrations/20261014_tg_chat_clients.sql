-- =====================================================================
-- Nova CRM — чат Telegram ↔ клиент (строка стола) (26.09.2026, просьба
-- Nurba: «прикрепить также чат к клиенту — с переадресацией к нему»).
-- Повторяемый файл.
--
--   А. tg_chat_clients (workspace_id, chat_id) → стол, вкладка, строка
--      клиента и подпись на момент привязки (имя · телефон). Один клиент
--      на чат. Из чата — «Открыть клиента» (стол с ?row=), из визитки
--      клиента — «Чат в Telegram». Читают все, кому открыт раздел, и Owner.
--   Б. tg_find_clients — поиск клиента по имени или телефону среди строк
--      столов. SECURITY INVOKER: человек находит РОВНО те строки, которые
--      и так читает (политика desk_rows), чужие столы в выдачу не попадают.
--   В. tg_link_client (SECURITY DEFINER) — привязать / снять. Строка должна
--      существовать и читаться тем, кто привязывает (те же наборы прав,
--      что у политики desk_rows_read).
--   Г. nova_schema_version() = '20261014'.
-- =====================================================================

create table if not exists public.tg_chat_clients (
  workspace_id text not null references public.rows_workspaces (workspace_id) on delete cascade,
  chat_id bigint not null check (chat_id <> 0),
  page_id text not null,
  tab_id text not null default '',
  row_id text not null,
  label text not null default '',
  bound_by text not null default '',
  bound_at bigint not null,
  primary key (workspace_id, chat_id)
);

-- Обратный путь: визитка клиента ищет свой чат по строке.
create index if not exists tg_chat_clients_row_idx on public.tg_chat_clients (workspace_id, page_id, row_id);

alter table public.tg_chat_clients enable row level security;

drop policy if exists tg_chat_clients_read on public.tg_chat_clients;
create policy tg_chat_clients_read on public.tg_chat_clients for select to anon, authenticated
  using (
    workspace_id in (select public.tg_my_workspaces())
    or workspace_id in (select public.rows_owned_workspaces())
  );

revoke all on public.tg_chat_clients from public, anon, authenticated;
grant select on public.tg_chat_clients to anon, authenticated;

-- ---------------------------------------------------------------------
-- Б. Поиск клиента.
-- ---------------------------------------------------------------------
create or replace function public.tg_find_clients(p_workspace text, p_query text, p_limit integer default 20)
returns table (page_id text, tab_id text, row_id text, cells jsonb, created_at bigint, filled_at bigint)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
  v_like text;
  v_digits text;
begin
  if public.rows_uid() is null or p_workspace is null
     or not (
       p_workspace in (select public.tg_my_workspaces())
       or coalesce(public.rows_is_owner(p_workspace), false)
     ) then
    raise exception 'tg_find_clients: поиск клиентов — у тех, кому открыт раздел Telegram' using errcode = '42501';
  end if;
  if char_length(v_q) < 2 or char_length(v_q) > 100 then
    raise exception 'tg_find_clients: запрос от 2 до 100 знаков' using errcode = '22023';
  end if;
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_digits := regexp_replace(v_q, '\D', '', 'g');
  -- Телефон пишут и «+7 701…», и «8 (701)…»: сравниваем последние 10 цифр.
  if char_length(v_digits) >= 10 then
    v_digits := right(v_digits, 10);
  end if;

  return query
  select r.page_id, r.tab_id, r.id, r.cells, r.created_at, r.filled_at
  from public.desk_rows r
  where r.workspace_id = p_workspace
    and r.cells <> '{}'::jsonb
    and (
      exists (select 1 from jsonb_each_text(r.cells) e where e.value ilike v_like escape '\')
      or (
        char_length(v_digits) >= 5
        and exists (
          select 1 from jsonb_each_text(r.cells) e
          where regexp_replace(e.value, '\D', '', 'g') like '%' || v_digits || '%'
        )
      )
    )
  order by coalesce(r.filled_at, r.created_at) desc
  limit least(greatest(coalesce(p_limit, 20), 1), 30);
end;
$$;

revoke all on function public.tg_find_clients(text, text, integer) from public;
grant execute on function public.tg_find_clients(text, text, integer) to anon, authenticated;

-- ---------------------------------------------------------------------
-- В. Привязать / снять.
-- ---------------------------------------------------------------------
create or replace function public.tg_link_client(
  p_workspace text,
  p_chat_id bigint,
  p_page_id text,
  p_tab_id text,
  p_row_id text,
  p_label text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  v_tab text := coalesce(p_tab_id, '');
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_row public.tg_chat_clients;
begin
  if me is null or p_workspace is null
     or not (
       p_workspace in (select public.tg_my_workspaces())
       or coalesce(public.rows_is_owner(p_workspace), false)
     ) then
    raise exception 'tg_link_client: привязывать чаты могут те, кому открыт раздел Telegram' using errcode = '42501';
  end if;
  if p_chat_id is null or p_chat_id = 0 then
    raise exception 'tg_link_client: нет чата' using errcode = '22023';
  end if;

  if coalesce(p_row_id, '') = '' then
    delete from public.tg_chat_clients where workspace_id = p_workspace and chat_id = p_chat_id;
    return null;
  end if;

  -- Строка есть и читается привязывающим — те же наборы, что у desk_rows_read.
  if not exists (
    select 1 from public.desk_rows r
    where r.workspace_id = p_workspace
      and r.page_id = p_page_id
      and r.tab_id = v_tab
      and r.id = p_row_id
      and (
        r.workspace_id in (select public.rows_read_all_workspaces())
        or (r.workspace_id, r.page_id) in (select a.workspace_id, a.page_id from public.rows_readable_pages() a)
        or (r.os_uid is not null and r.os_uid = me)
      )
  ) then
    raise exception 'tg_link_client: клиент не найден или нет доступа к его столу' using errcode = '42501';
  end if;

  insert into public.tg_chat_clients (workspace_id, chat_id, page_id, tab_id, row_id, label, bound_by, bound_at)
  values (p_workspace, p_chat_id, p_page_id, v_tab, p_row_id, left(btrim(coalesce(p_label, '')), 200), me, v_now)
  on conflict (workspace_id, chat_id) do update set
    page_id = excluded.page_id,
    tab_id = excluded.tab_id,
    row_id = excluded.row_id,
    label = excluded.label,
    bound_by = excluded.bound_by,
    bound_at = excluded.bound_at
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.tg_link_client(text, bigint, text, text, text, text) from public;
grant execute on function public.tg_link_client(text, bigint, text, text, text, text) to anon, authenticated;

create or replace function public.nova_schema_version() returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select '20261014'::text
$$;

revoke all on function public.nova_schema_version() from public, anon, authenticated;
grant execute on function public.nova_schema_version() to anon, authenticated;
