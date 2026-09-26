-- =====================================================================
-- Nova CRM — привязка чата Telegram к нику ОС (26.09.2026, просьба Nurba:
-- «создай возможность привязать чат к ОСнику»). Повторяемый файл.
--
-- Рабочий аккаунт один на всех, и по одному списку чатов не видно, чей это
-- клиент. Привязка — «этот чат ведёт ОС Таня»: у чата в списке цветная
-- метка ника, фильтры «Мои / Без ОС / по нику». Хранится в Nova, а не в
-- папках Telegram: папок у аккаунта не больше 10 (с Premium 20), чатов в
-- папке не больше 100, и две правки папки одновременно затирают друг друга.
--
--   А. tg_chat_links (workspace_id, chat_id) → os_value (значение варианта
--      «Ответственный» = ник ОС, как в заказах), title — имя чата на момент
--      привязки (для отчётов, если чат пропадёт из списка), кто и когда.
--   Б. Читают все, кому открыт раздел (tg_my_workspaces), и Owner.
--   В. Пишет только tg_link_chat (SECURITY DEFINER): любой допущенный к
--      разделу или Owner; пустой ник — снять привязку. Прямой записи нет.
--   Г. nova_schema_version() = '20261013'.
-- =====================================================================

create table if not exists public.tg_chat_links (
  workspace_id text not null references public.rows_workspaces (workspace_id) on delete cascade,
  chat_id bigint not null check (chat_id <> 0),
  os_value text not null check (char_length(os_value) between 1 and 120),
  title text not null default '',
  bound_by text not null default '',
  bound_at bigint not null,
  primary key (workspace_id, chat_id)
);

alter table public.tg_chat_links enable row level security;

drop policy if exists tg_chat_links_read on public.tg_chat_links;
create policy tg_chat_links_read on public.tg_chat_links for select to anon, authenticated
  using (
    workspace_id in (select public.tg_my_workspaces())
    or workspace_id in (select public.rows_owned_workspaces())
  );

revoke all on public.tg_chat_links from public, anon, authenticated;
grant select on public.tg_chat_links to anon, authenticated;

create or replace function public.tg_link_chat(p_workspace text, p_chat_id bigint, p_os_value text, p_title text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  v_os text := btrim(coalesce(p_os_value, ''));
  v_title text := left(btrim(coalesce(p_title, '')), 200);
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_row public.tg_chat_links;
begin
  if me is null or p_workspace is null
     or not (
       p_workspace in (select public.tg_my_workspaces())
       or coalesce(public.rows_is_owner(p_workspace), false)
     ) then
    raise exception 'tg_link_chat: привязывать чаты могут те, кому открыт раздел Telegram' using errcode = '42501';
  end if;
  if p_chat_id is null or p_chat_id = 0 then
    raise exception 'tg_link_chat: нет чата' using errcode = '22023';
  end if;
  if char_length(v_os) > 120 then
    raise exception 'tg_link_chat: слишком длинный ник' using errcode = '22023';
  end if;

  if v_os = '' then
    delete from public.tg_chat_links where workspace_id = p_workspace and chat_id = p_chat_id;
    return null;
  end if;

  insert into public.tg_chat_links (workspace_id, chat_id, os_value, title, bound_by, bound_at)
  values (p_workspace, p_chat_id, v_os, v_title, me, v_now)
  on conflict (workspace_id, chat_id) do update set
    os_value = excluded.os_value,
    title = case when excluded.title <> '' then excluded.title else public.tg_chat_links.title end,
    bound_by = excluded.bound_by,
    bound_at = excluded.bound_at
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.tg_link_chat(text, bigint, text, text) from public;
grant execute on function public.tg_link_chat(text, bigint, text, text) to anon, authenticated;

create or replace function public.nova_schema_version() returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select '20261013'::text
$$;

revoke all on function public.nova_schema_version() from public, anon, authenticated;
grant execute on function public.nova_schema_version() to anon, authenticated;
