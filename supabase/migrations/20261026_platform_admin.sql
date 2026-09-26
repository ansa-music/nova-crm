-- =====================================================================
-- Nova CRM — кто администратор платформы (26.09.2026, поправка к 20261025).
-- Повторяемый файл.
--
-- В 20261025 администратором считалась ПРОВЕРЕННАЯ почта Nurba
-- (email_verified = true). У входа по почте и паролю Firebase ставит
-- email_verified = false, пока человек не нажал ссылку из письма, — и
-- «Платформа» у Nurba отвечала 42501, хотя приложение (оно смотрит только
-- почту) её показывало.
--
-- Теперь администратор платформы — владелец основной компании Nova
-- (`ws_zokgevudmsbfnq88`, тот же id, что FALLBACK_JOIN_WORKSPACE_ID в
-- src/utils/joinIntent.ts): его uid из токена Firebase своего проекта —
-- надёжнее почты. Проверенная почта Nurba по-прежнему тоже подходит.
-- nova_schema_version() = '20261026'.
-- =====================================================================

create or replace function public.nova_is_platform_admin() returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.rows_uid() is not null and (
    public.rows_uid() = (
      select w.owner_id from public.rows_workspaces w
      where w.workspace_id = 'ws_zokgevudmsbfnq88'
    )
    or (
      lower(coalesce(auth.jwt() ->> 'email', '')) = 'nurpro2005@gmail.com'
      and coalesce(auth.jwt() ->> 'email_verified', '') = 'true'
    )
  )
$$;

revoke all on function public.nova_is_platform_admin() from public;
grant execute on function public.nova_is_platform_admin() to anon, authenticated;

create or replace function public.nova_schema_version() returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select '20261026'::text
$$;

revoke all on function public.nova_schema_version() from public, anon, authenticated;
grant execute on function public.nova_schema_version() to anon, authenticated;
