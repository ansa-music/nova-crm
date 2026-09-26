-- =====================================================================
-- Nova CRM — workspace как «компания»-арендатор (26.09.2026, SaaS этап 1).
-- Повторяемый файл. Никому ничего не меняет: у существующих workspace
-- умолчания ровно те, что были зашиты в коде (Алматы, тенге).
--
-- rows_workspaces уже есть у каждого workspace со строками в Supabase — это
-- и есть реестр арендаторов. Добавляем:
--   plan / status / trial_until / seats_limit — тариф. Клиент их НЕ пишет
--     вообще (ни политики, ни функции): их ставит будущая админка продаж
--     ключом service role. Читает участник — как и всю строку workspace;
--   timezone / currency / locale — регион компании. Пишет только Owner через
--     rows_set_tenant_region (копия workspace.region из Firestore — её сверяет
--     сессия Owner). SQL-функции дальше берут пояс через rows_tz(ws);
--   ring_salt — соль тем «звонков» Realtime: тему `nova:{ws}:…` посторонний
--     с публичным анонимным ключом мог слушать, зная id. Соль видит только
--     участник (политика rows_workspaces_read) — тема с солью ему недоступна.
-- nova_schema_version() = '20261023'.
-- =====================================================================

alter table public.rows_workspaces add column if not exists plan text not null default 'internal';
alter table public.rows_workspaces add column if not exists status text not null default 'active';
alter table public.rows_workspaces add column if not exists trial_until timestamptz;
alter table public.rows_workspaces add column if not exists seats_limit integer;
alter table public.rows_workspaces add column if not exists timezone text not null default 'Asia/Almaty';
alter table public.rows_workspaces add column if not exists currency text not null default 'KZT';
alter table public.rows_workspaces add column if not exists locale text not null default 'ru-KZ';
alter table public.rows_workspaces add column if not exists created_at timestamptz not null default now();
alter table public.rows_workspaces add column if not exists ring_salt text not null
  default replace(gen_random_uuid()::text, '-', '');

do $$
begin
  alter table public.rows_workspaces add constraint rows_workspaces_status_ck
    check (status in ('active', 'trial', 'suspended'));
exception when duplicate_object then null;
end $$;
do $$
begin
  alter table public.rows_workspaces add constraint rows_workspaces_currency_ck
    check (currency ~ '^[A-Z]{3}$');
exception when duplicate_object then null;
end $$;
do $$
begin
  alter table public.rows_workspaces add constraint rows_workspaces_seats_ck
    check (seats_limit is null or seats_limit > 0);
exception when duplicate_object then null;
end $$;

-- Пояс компании для SQL-функций. Нет строки или пусто — Алматы, как было.
create or replace function public.rows_tz(ws text) returns text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce((select nullif(w.timezone, '') from public.rows_workspaces w where w.workspace_id = ws), 'Asia/Almaty')
$$;

revoke all on function public.rows_tz(text) from public;
grant execute on function public.rows_tz(text) to anon, authenticated;

-- Регион пишет только Owner. Проверки — чтобы кривое значение не уронило
-- даты у всей компании: пояс обязан быть известен Postgres, валюта — ISO 4217.
create or replace function public.rows_set_tenant_region(
  p_workspace text, p_timezone text, p_currency text, p_locale text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text := coalesce(nullif(btrim(p_timezone), ''), 'Asia/Almaty');
  v_cur text := upper(coalesce(nullif(btrim(p_currency), ''), 'KZT'));
  v_loc text := coalesce(nullif(btrim(p_locale), ''), 'ru-KZ');
  w public.rows_workspaces%rowtype;
begin
  if public.rows_uid() is null or not coalesce(public.rows_is_owner(p_workspace), false) then
    raise exception 'rows_set_tenant_region: регион меняет Owner' using errcode = '42501';
  end if;
  if not exists (select 1 from pg_timezone_names z where z.name = v_tz) then
    raise exception 'rows_set_tenant_region: неизвестный часовой пояс' using errcode = '22023';
  end if;
  if v_cur !~ '^[A-Z]{3}$' then
    raise exception 'rows_set_tenant_region: валюта — три латинские буквы' using errcode = '22023';
  end if;
  if v_loc !~ '^[a-z]{2,3}(-[A-Z]{2})?$' then
    raise exception 'rows_set_tenant_region: неверный язык' using errcode = '22023';
  end if;
  update public.rows_workspaces
     set timezone = v_tz, currency = v_cur, locale = v_loc
   where workspace_id = p_workspace
  returning * into w;
  if not found then
    raise exception 'rows_set_tenant_region: workspace не заведён' using errcode = 'P0002';
  end if;
  return jsonb_build_object('timezone', w.timezone, 'currency', w.currency, 'locale', w.locale);
end;
$$;

revoke all on function public.rows_set_tenant_region(text, text, text, text) from public;
grant execute on function public.rows_set_tenant_region(text, text, text, text) to anon, authenticated;

create or replace function public.nova_schema_version() returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select '20261023'::text
$$;

revoke all on function public.nova_schema_version() from public, anon, authenticated;
grant execute on function public.nova_schema_version() to anon, authenticated;
