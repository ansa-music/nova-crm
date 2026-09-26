-- =====================================================================
-- Nova CRM — регистрация компаний по приглашению и админка платформы
-- (26.09.2026, SaaS этап 2). Повторяемый файл.
--
-- Раньше новый workspace мог завести только Nurba (правило Firestore по его
-- почте), а строку компании в rows_workspaces он вставлял руками в SQL
-- Editor. Теперь:
--   platform_invites — одноразовые коды приглашения. Заводит, смотрит и
--     отзывает только администратор платформы (nova_is_platform_admin:
--     проверенная почта Nurba в токене Firebase). Прямого доступа к таблице
--     у клиента нет — только функции ниже;
--   rows_register_company(ws, code, name) — новая компания сама заводит свою
--     строку: id workspace обязан быть `ws_{свой uid}_…` (чужой id не
--     присвоить), код — свободный и не отозванный. Пробный период и предел
--     мест — из кода. Администратор платформы регистрирует без кода;
--   platform_tenants / platform_set_tenant — список компаний и их тариф:
--     статус, пробный период, предел мест. Клиент компании эти поля
--     по-прежнему не пишет;
--   rows_writable_workspaces — теперь ещё и «компания действует»: у
--     приостановленной и у той, чей пробный период кончился, строки столов и
--     всё, что стоит на этом наборе, только читаются. У существующей
--     компании Nurba status = 'active', для неё ничего не меняется.
-- nova_schema_version() = '20261025'.
-- =====================================================================

alter table public.rows_workspaces add column if not exists name text;

-- Администратор платформы — по ПРОВЕРЕННОЙ почте в токене Firebase того же
-- проекта (rows_uid сверяет iss/aud). Тот же адрес, что в firestore.rules и
-- src/utils/adminAccess.ts.
create or replace function public.nova_is_platform_admin() returns boolean
language sql stable
set search_path = public, pg_temp
as $$
  select public.rows_uid() is not null
    and lower(coalesce(auth.jwt() ->> 'email', '')) = 'nurpro2005@gmail.com'
    and coalesce(auth.jwt() ->> 'email_verified', '') = 'true'
$$;

revoke all on function public.nova_is_platform_admin() from public;
grant execute on function public.nova_is_platform_admin() to anon, authenticated;

-- Действует ли компания: оплачена (active) или пробный период ещё идёт.
create or replace function public.nova_tenant_active(p_status text, p_trial_until timestamptz) returns boolean
language sql stable
set search_path = public, pg_temp
as $$
  select coalesce(p_status, 'active') = 'active'
    or (p_status = 'trial' and (p_trial_until is null or p_trial_until > now()))
$$;

revoke all on function public.nova_tenant_active(text, timestamptz) from public;
grant execute on function public.nova_tenant_active(text, timestamptz) to anon, authenticated;

-- Писать можно только в живое хранилище ДЕЙСТВУЮЩЕЙ компании.
create or replace function public.rows_writable_workspaces() returns setof text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select w.workspace_id from public.rows_workspaces w
  where (w.live
     or (w.migrating_until > now() and public.rows_is_owner(w.workspace_id)))
    and public.nova_tenant_active(w.status, w.trial_until)
$$;

-- ---------------------------------------------------------------------
-- Коды приглашения.
-- ---------------------------------------------------------------------
create table if not exists public.platform_invites (
  code text primary key check (code ~ '^[A-Z2-9]{10}$'),
  note text not null default '' check (length(note) <= 200),
  trial_days integer not null default 14 check (trial_days between 1 and 365),
  seats_limit integer check (seats_limit is null or seats_limit between 1 and 1000),
  created_at timestamptz not null default now(),
  created_by text not null,
  used_by text,
  used_at timestamptz,
  workspace_id text,
  revoked_at timestamptz
);

alter table public.platform_invites enable row level security;
-- Ни одной политики: таблицу читают и пишут только функции ниже. Supabase
-- по default privileges открывает новую таблицу ролям API — закрываем явно.
revoke all on public.platform_invites from public, anon, authenticated;

create or replace function public.platform_invite_create(
  p_note text, p_trial_days integer, p_seats_limit integer
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea;
  v_code text;
  i integer;
  attempt integer := 0;
  inv public.platform_invites%rowtype;
begin
  if not public.nova_is_platform_admin() then
    raise exception 'platform_invite_create: только администратор платформы' using errcode = '42501';
  end if;
  loop
    attempt := attempt + 1;
    -- gen_random_uuid() — криптостойкий источник; берём байты без битов версии.
    bytes := uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid());
    v_code := '';
    for i in 0..9 loop
      v_code := v_code || substr(alphabet, 1 + (get_byte(bytes, i + (case when i >= 6 then 3 else 0 end)) % 32), 1);
    end loop;
    exit when not exists (select 1 from public.platform_invites where code = v_code);
    if attempt > 5 then
      raise exception 'platform_invite_create: не удалось подобрать код' using errcode = 'P0001';
    end if;
  end loop;
  insert into public.platform_invites (code, note, trial_days, seats_limit, created_by)
  values (
    v_code,
    left(coalesce(btrim(p_note), ''), 200),
    greatest(1, least(365, coalesce(p_trial_days, 14))),
    case when p_seats_limit is null or p_seats_limit < 1 then null else least(p_seats_limit, 1000) end,
    public.rows_uid()
  )
  returning * into inv;
  return to_jsonb(inv);
end;
$$;

create or replace function public.platform_invite_list() returns setof jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.nova_is_platform_admin() then
    raise exception 'platform_invite_list: только администратор платформы' using errcode = '42501';
  end if;
  return query
    select to_jsonb(i) || jsonb_build_object('workspace_name', w.name)
    from public.platform_invites i
    left join public.rows_workspaces w on w.workspace_id = i.workspace_id
    order by i.created_at desc
    limit 500;
end;
$$;

create or replace function public.platform_invite_revoke(p_code text) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  inv public.platform_invites%rowtype;
begin
  if not public.nova_is_platform_admin() then
    raise exception 'platform_invite_revoke: только администратор платформы' using errcode = '42501';
  end if;
  update public.platform_invites
     set revoked_at = coalesce(revoked_at, now())
   where code = upper(btrim(p_code)) and used_by is null
  returning * into inv;
  if not found then
    raise exception 'platform_invite_revoke: кода нет или он уже использован' using errcode = 'P0002';
  end if;
  return to_jsonb(inv);
end;
$$;

-- ---------------------------------------------------------------------
-- Регистрация компании.
-- ---------------------------------------------------------------------
create or replace function public.rows_register_company(
  p_workspace text, p_code text, p_name text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid text := public.rows_uid();
  v_admin boolean := public.nova_is_platform_admin();
  v_prefix text;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_name text := left(btrim(coalesce(p_name, '')), 120);
  inv public.platform_invites%rowtype;
  w public.rows_workspaces%rowtype;
begin
  if v_uid is null then
    raise exception 'rows_register_company: нужен вход' using errcode = '42501';
  end if;
  v_prefix := 'ws_' || v_uid || '_';
  if left(coalesce(p_workspace, ''), length(v_prefix)) <> v_prefix
     or substr(p_workspace, length(v_prefix) + 1) !~ '^[a-z0-9]{6,40}$' then
    raise exception 'rows_register_company: id компании должен начинаться с вашего uid' using errcode = '42501';
  end if;

  select * into w from public.rows_workspaces where workspace_id = p_workspace;
  if found then
    if w.owner_id = v_uid then
      return jsonb_build_object('status', 'already', 'plan', w.plan, 'tenant_status', w.status,
                                'trial_until', w.trial_until, 'seats_limit', w.seats_limit);
    end if;
    raise exception 'rows_register_company: компания уже заведена' using errcode = '42501';
  end if;

  if v_code <> '' then
    select * into inv from public.platform_invites where code = v_code for update;
    if not found or inv.revoked_at is not null then
      raise exception 'rows_register_company: код не найден или отозван' using errcode = '42501';
    end if;
    if inv.used_by is not null then
      raise exception 'rows_register_company: код уже использован' using errcode = '42501';
    end if;
  elsif not v_admin then
    raise exception 'rows_register_company: нужен код приглашения' using errcode = '42501';
  end if;

  insert into public.rows_workspaces (workspace_id, owner_id, live, plan, status, trial_until, seats_limit, name)
  values (
    p_workspace,
    v_uid,
    true,
    case when v_code <> '' then 'trial' else 'internal' end,
    case when v_code <> '' then 'trial' else 'active' end,
    case when v_code <> '' then now() + make_interval(days => inv.trial_days) end,
    case when v_code <> '' then inv.seats_limit end,
    nullif(v_name, '')
  )
  returning * into w;

  insert into public.rows_members (workspace_id, uid, role)
  values (p_workspace, v_uid, 'owner')
  on conflict (workspace_id, uid) do update set role = 'owner';

  if v_code <> '' then
    update public.platform_invites
       set used_by = v_uid, used_at = now(), workspace_id = p_workspace
     where code = v_code;
  end if;

  return jsonb_build_object('status', 'registered', 'plan', w.plan, 'tenant_status', w.status,
                            'trial_until', w.trial_until, 'seats_limit', w.seats_limit);
end;
$$;

-- Название компании в реестре — пишет её Owner (переименовал workspace).
create or replace function public.rows_set_tenant_name(p_workspace text, p_name text) returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if public.rows_uid() is null or not coalesce(public.rows_is_owner(p_workspace), false) then
    raise exception 'rows_set_tenant_name: название меняет Owner' using errcode = '42501';
  end if;
  update public.rows_workspaces
     set name = nullif(left(btrim(coalesce(p_name, '')), 120), '')
   where workspace_id = p_workspace;
end;
$$;

-- ---------------------------------------------------------------------
-- Админка платформы: список компаний и их тариф.
-- ---------------------------------------------------------------------
create or replace function public.platform_tenants() returns setof jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.nova_is_platform_admin() then
    raise exception 'platform_tenants: только администратор платформы' using errcode = '42501';
  end if;
  return query
    select jsonb_build_object(
      'workspace_id', w.workspace_id,
      'name', w.name,
      'owner_id', w.owner_id,
      'plan', w.plan,
      'status', w.status,
      'trial_until', w.trial_until,
      'seats_limit', w.seats_limit,
      'created_at', w.created_at,
      'live', w.live,
      'timezone', w.timezone,
      'currency', w.currency,
      'members', (select count(*) from public.rows_members m where m.workspace_id = w.workspace_id),
      'active_now', public.nova_tenant_active(w.status, w.trial_until)
    )
    from public.rows_workspaces w
    order by w.created_at desc;
end;
$$;

create or replace function public.platform_set_tenant(
  p_workspace text,
  p_status text,
  p_plan text,
  p_trial_until timestamptz,
  p_seats_limit integer,
  p_set_trial boolean default false,
  p_set_seats boolean default false
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  w public.rows_workspaces%rowtype;
begin
  if not public.nova_is_platform_admin() then
    raise exception 'platform_set_tenant: только администратор платформы' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('active', 'trial', 'suspended') then
    raise exception 'platform_set_tenant: статус — active, trial или suspended' using errcode = '22023';
  end if;
  if p_plan is not null and p_plan !~ '^[a-z][a-z0-9_-]{1,31}$' then
    raise exception 'platform_set_tenant: неверный тариф' using errcode = '22023';
  end if;
  if p_set_seats and p_seats_limit is not null and (p_seats_limit < 1 or p_seats_limit > 1000) then
    raise exception 'platform_set_tenant: предел мест — от 1 до 1000' using errcode = '22023';
  end if;
  update public.rows_workspaces
     set status = coalesce(p_status, status),
         plan = coalesce(p_plan, plan),
         trial_until = case when p_set_trial then p_trial_until else trial_until end,
         seats_limit = case when p_set_seats then p_seats_limit else seats_limit end
   where workspace_id = p_workspace
  returning * into w;
  if not found then
    raise exception 'platform_set_tenant: компании нет' using errcode = 'P0002';
  end if;
  return jsonb_build_object('workspace_id', w.workspace_id, 'plan', w.plan, 'status', w.status,
                            'trial_until', w.trial_until, 'seats_limit', w.seats_limit,
                            'active_now', public.nova_tenant_active(w.status, w.trial_until));
end;
$$;

revoke all on function public.platform_invite_create(text, integer, integer) from public;
revoke all on function public.platform_invite_list() from public;
revoke all on function public.platform_invite_revoke(text) from public;
revoke all on function public.rows_register_company(text, text, text) from public;
revoke all on function public.rows_set_tenant_name(text, text) from public;
revoke all on function public.platform_tenants() from public;
revoke all on function public.platform_set_tenant(text, text, text, timestamptz, integer, boolean, boolean) from public;
grant execute on function public.platform_invite_create(text, integer, integer) to anon, authenticated;
grant execute on function public.platform_invite_list() to anon, authenticated;
grant execute on function public.platform_invite_revoke(text) to anon, authenticated;
grant execute on function public.rows_register_company(text, text, text) to anon, authenticated;
grant execute on function public.rows_set_tenant_name(text, text) to anon, authenticated;
grant execute on function public.platform_tenants() to anon, authenticated;
grant execute on function public.platform_set_tenant(text, text, text, timestamptz, integer, boolean, boolean) to anon, authenticated;

create or replace function public.nova_schema_version() returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select '20261025'::text
$$;

revoke all on function public.nova_schema_version() from public, anon, authenticated;
grant execute on function public.nova_schema_version() to anon, authenticated;
