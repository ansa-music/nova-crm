-- =====================================================================
-- Nova CRM — заявки на подключение компании и именные коды
-- (27.09.2026, SaaS этап 3). Повторяемый файл.
--
-- Человек без кода приглашения оставляет ЗАЯВКУ прямо на /start:
-- название компании, как связаться, комментарий. Администратор платформы
-- видит заявки в «Платформе» и одобряет — база заводит код, ПРИВЯЗАННЫЙ к
-- этому человеку (platform_invites.for_uid): открыв /start, он получает
-- «заявка одобрена» и заводит компанию без ввода кода. Чужой такой код не
-- подойдёт (rows_register_company сверяет for_uid).
--   platform_leads      — заявки (одна на человека, uid — ключ);
--   platform_lead_submit — подать/поправить свою (пока не одобрена);
--   platform_my_status   — своя заявка и свободный код на моё имя;
--   platform_leads_list / platform_lead_resolve — только администратор.
-- platform_invite_create и rows_register_company переписаны ЗДЕСЬ целиком
-- (правки — только в этом файле или новее).
-- nova_schema_version() = '20261028'.
-- =====================================================================

alter table public.platform_invites add column if not exists for_uid text;

create table if not exists public.platform_leads (
  uid text primary key,
  email text not null default '',
  name text not null default '',
  company text not null check (length(company) between 2 and 120),
  contact text not null default '' check (length(contact) <= 200),
  note text not null default '' check (length(note) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  invite_code text
);

alter table public.platform_leads enable row level security;
revoke all on public.platform_leads from public, anon, authenticated;

-- Код: 10 знаков без 0/O/1/I, криптостойкий источник, уникален.
create or replace function public.nova_new_invite_code() returns text
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
begin
  loop
    attempt := attempt + 1;
    bytes := uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid());
    v_code := '';
    for i in 0..9 loop
      v_code := v_code || substr(alphabet, 1 + (get_byte(bytes, i + (case when i >= 6 then 3 else 0 end)) % 32), 1);
    end loop;
    exit when not exists (select 1 from public.platform_invites where code = v_code);
    if attempt > 5 then
      raise exception 'nova_new_invite_code: не удалось подобрать код' using errcode = 'P0001';
    end if;
  end loop;
  return v_code;
end;
$$;

revoke all on function public.nova_new_invite_code() from public, anon, authenticated;

create or replace function public.platform_invite_create(
  p_note text, p_trial_days integer, p_seats_limit integer
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  inv public.platform_invites%rowtype;
begin
  if not public.nova_is_platform_admin() then
    raise exception 'platform_invite_create: только администратор платформы' using errcode = '42501';
  end if;
  insert into public.platform_invites (code, note, trial_days, seats_limit, created_by)
  values (
    public.nova_new_invite_code(),
    left(coalesce(btrim(p_note), ''), 200),
    greatest(1, least(365, coalesce(p_trial_days, 14))),
    case when p_seats_limit is null or p_seats_limit < 1 then null else least(p_seats_limit, 1000) end,
    public.rows_uid()
  )
  returning * into inv;
  return to_jsonb(inv);
end;
$$;

-- ---------------------------------------------------------------------
-- Заявка.
-- ---------------------------------------------------------------------
create or replace function public.platform_lead_submit(
  p_company text, p_contact text, p_note text, p_email text, p_name text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid text := public.rows_uid();
  v_company text := left(btrim(coalesce(p_company, '')), 120);
  lead public.platform_leads%rowtype;
begin
  if v_uid is null then
    raise exception 'platform_lead_submit: нужен вход' using errcode = '42501';
  end if;
  if length(v_company) < 2 then
    raise exception 'platform_lead_submit: напишите название компании' using errcode = '22023';
  end if;
  select * into lead from public.platform_leads where uid = v_uid for update;
  if found and lead.status = 'approved' then
    raise exception 'platform_lead_submit: заявка уже одобрена' using errcode = '22023';
  end if;
  insert into public.platform_leads (uid, email, name, company, contact, note, status, updated_at, resolved_at)
  values (
    v_uid,
    left(coalesce(nullif(btrim(p_email), ''), coalesce(auth.jwt() ->> 'email', '')), 200),
    left(coalesce(btrim(p_name), ''), 120),
    v_company,
    left(coalesce(btrim(p_contact), ''), 200),
    left(coalesce(btrim(p_note), ''), 1000),
    'pending',
    now(),
    null
  )
  on conflict (uid) do update
    set email = excluded.email, name = excluded.name, company = excluded.company,
        contact = excluded.contact, note = excluded.note,
        status = 'pending', updated_at = now(), resolved_at = null
  returning * into lead;
  return to_jsonb(lead);
end;
$$;

-- Своя заявка и свободный код на моё имя.
create or replace function public.platform_my_status() returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'lead', (select to_jsonb(l) from public.platform_leads l where l.uid = public.rows_uid()),
    'invite', (
      select jsonb_build_object('code', i.code, 'trial_days', i.trial_days, 'seats_limit', i.seats_limit, 'note', i.note)
      from public.platform_invites i
      where i.for_uid = public.rows_uid() and i.used_by is null and i.revoked_at is null
      order by i.created_at desc
      limit 1
    )
  )
  where public.rows_uid() is not null
$$;

create or replace function public.platform_leads_list() returns setof jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.nova_is_platform_admin() then
    raise exception 'platform_leads_list: только администратор платформы' using errcode = '42501';
  end if;
  return query
    select to_jsonb(l) || jsonb_build_object(
      'workspace_id', (select i.workspace_id from public.platform_invites i where i.code = l.invite_code)
    )
    from public.platform_leads l
    order by (l.status = 'pending') desc, l.updated_at desc
    limit 500;
end;
$$;

-- Одобрить (код на имя заявителя) или отклонить.
create or replace function public.platform_lead_resolve(
  p_uid text, p_approve boolean, p_trial_days integer, p_seats_limit integer
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  lead public.platform_leads%rowtype;
  inv public.platform_invites%rowtype;
begin
  if not public.nova_is_platform_admin() then
    raise exception 'platform_lead_resolve: только администратор платформы' using errcode = '42501';
  end if;
  select * into lead from public.platform_leads where uid = p_uid for update;
  if not found then
    raise exception 'platform_lead_resolve: заявки нет' using errcode = 'P0002';
  end if;
  if lead.status = 'approved' then
    raise exception 'platform_lead_resolve: заявка уже одобрена' using errcode = '22023';
  end if;
  if not p_approve then
    update public.platform_leads set status = 'rejected', resolved_at = now(), updated_at = now() where uid = p_uid
    returning * into lead;
    return to_jsonb(lead);
  end if;
  insert into public.platform_invites (code, note, trial_days, seats_limit, created_by, for_uid)
  values (
    public.nova_new_invite_code(),
    left(lead.company, 200),
    greatest(1, least(365, coalesce(p_trial_days, 14))),
    case when p_seats_limit is null or p_seats_limit < 1 then null else least(p_seats_limit, 1000) end,
    public.rows_uid(),
    p_uid
  )
  returning * into inv;
  update public.platform_leads
     set status = 'approved', resolved_at = now(), updated_at = now(), invite_code = inv.code
   where uid = p_uid
  returning * into lead;
  return to_jsonb(lead) || jsonb_build_object('invite', to_jsonb(inv));
end;
$$;

-- ---------------------------------------------------------------------
-- Регистрация — с проверкой «код на моё имя» (полная копия из 20261025).
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
    if inv.for_uid is not null and inv.for_uid <> v_uid then
      raise exception 'rows_register_company: этот код выдан другому человеку' using errcode = '42501';
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

revoke all on function public.platform_invite_create(text, integer, integer) from public;
revoke all on function public.platform_lead_submit(text, text, text, text, text) from public;
revoke all on function public.platform_my_status() from public;
revoke all on function public.platform_leads_list() from public;
revoke all on function public.platform_lead_resolve(text, boolean, integer, integer) from public;
revoke all on function public.rows_register_company(text, text, text) from public;
grant execute on function public.platform_invite_create(text, integer, integer) to anon, authenticated;
grant execute on function public.platform_lead_submit(text, text, text, text, text) to anon, authenticated;
grant execute on function public.platform_my_status() to anon, authenticated;
grant execute on function public.platform_leads_list() to anon, authenticated;
grant execute on function public.platform_lead_resolve(text, boolean, integer, integer) to anon, authenticated;
grant execute on function public.rows_register_company(text, text, text) to anon, authenticated;

create or replace function public.nova_schema_version() returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select '20261028'::text
$$;

revoke all on function public.nova_schema_version() from public, anon, authenticated;
grant execute on function public.nova_schema_version() to anon, authenticated;
