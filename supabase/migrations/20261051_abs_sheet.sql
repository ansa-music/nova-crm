-- ABS → «Таблица»: живая копия листов Google-таблицы (фин. отчёта) в ABS (17.10.2026).
--
-- Просьба: «в ABS систему эту таблицу сразу из Excel фин. отчёта, чтобы
-- обновлялась в реальном времени». Таблицу ведут в Google Sheets, и тянуть её
-- оттуда приходится без сервера Google на нашей стороне: скрипт ВНУТРИ таблицы
-- (Apps Script, его текст собирает Nova — src/utils/absSheetScript.ts) при
-- каждой правке и раз в 5 минут присылает выбранные листы сюда
-- (`abs_sheet_push`) — значения как на экране, цвета, жирность, объединения,
-- ширины. Таблица остаётся закрытой: наружу ничего не публикуется.
--
-- Скрипт ходит публичным (anon) ключом Supabase и доказывает право секретом
-- `token` (64 hex), который выдаёт Owner (`abs_sheet_new_token`). Новый секрет
-- отключает старый скрипт. Читают копию участники (`abs_sheet_get`), а при
-- `audience = 'lead'` — только руководство (Owner, Тимлид, Тимлид+).
--
-- Таблица закрыта API-ролям целиком: читают и пишут только функции ниже.
-- Файл повторяемый.

create table if not exists public.abs_sheet (
  workspace_id text primary key references public.rows_workspaces (workspace_id) on delete cascade,
  token text check (token is null or token ~ '^[0-9a-f]{64}$'),
  audience text not null default 'all' check (audience in ('all', 'lead')),
  -- Какие листы присылать (выбор Owner; пусто — листы со словом «OUTPUT», иначе первый).
  pick text[] not null default '{}',
  -- Все листы таблицы, как их последний раз назвал скрипт (для выбора в Nova).
  sheets text[] not null default '{}',
  title text,
  payload jsonb,
  hash text,
  pushed_at timestamptz,
  seen_at timestamptz,
  push_count bigint not null default 0,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.abs_sheet enable row level security;
revoke all on public.abs_sheet from public, anon, authenticated;

-- Что видит Owner в настройке (секрет — только ему: он вставляет его в скрипт).
create or replace function public.abs_sheet_config_row(p_workspace text) returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'token', s.token,
    'audience', coalesce(s.audience, 'all'),
    'pick', to_jsonb(coalesce(s.pick, '{}')),
    'sheets', to_jsonb(coalesce(s.sheets, '{}')),
    'title', s.title,
    'pushedAt', (extract(epoch from s.pushed_at) * 1000)::bigint,
    'seenAt', (extract(epoch from s.seen_at) * 1000)::bigint,
    'pushCount', coalesce(s.push_count, 0),
    'salt', w.ring_salt)
  from public.rows_workspaces w
  left join public.abs_sheet s on s.workspace_id = w.workspace_id
  where w.workspace_id = p_workspace
$$;
revoke all on function public.abs_sheet_config_row(text) from public, anon, authenticated;

create or replace function public.abs_sheet_owner_guard(p_workspace text, p_write boolean) returns text
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
begin
  if me is null or not coalesce(public.rows_is_owner(p_workspace), false) then
    raise exception 'only owner' using errcode = '42501';
  end if;
  if p_write and p_workspace not in (select public.rows_writable_workspaces()) then
    raise exception 'workspace is read-only' using errcode = '42501';
  end if;
  return me;
end;
$$;
revoke all on function public.abs_sheet_owner_guard(text, boolean) from public, anon, authenticated;

create or replace function public.abs_sheet_config(p_workspace text) returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  perform public.abs_sheet_owner_guard(p_workspace, false);
  return public.abs_sheet_config_row(p_workspace);
end;
$$;
revoke all on function public.abs_sheet_config(text) from public;
grant execute on function public.abs_sheet_config(text) to anon, authenticated;

-- Новый секрет скрипта (первый — подключение, следующий — старый скрипт перестаёт работать).
create or replace function public.abs_sheet_new_token(p_workspace text) returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.abs_sheet_owner_guard(p_workspace, true);
  secret text := encode(sha256(convert_to(
    gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex');
begin
  insert into public.abs_sheet as s (workspace_id, token, updated_at, updated_by)
  values (p_workspace, secret, now(), me)
  on conflict (workspace_id) do update set token = excluded.token, updated_at = now(), updated_by = me;
  return public.abs_sheet_config_row(p_workspace);
end;
$$;
revoke all on function public.abs_sheet_new_token(text) from public;
grant execute on function public.abs_sheet_new_token(text) to anon, authenticated;

-- Кому видна таблица и какие листы присылать.
create or replace function public.abs_sheet_set(p_workspace text, p_audience text, p_pick text[]) returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.abs_sheet_owner_guard(p_workspace, true);
  list text[] := '{}';
  n text;
begin
  if p_audience is null or p_audience not in ('all', 'lead') then
    raise exception 'bad audience' using errcode = '22023';
  end if;
  if coalesce(array_length(p_pick, 1), 0) > 8 then
    raise exception 'too many sheets' using errcode = '22023';
  end if;
  foreach n in array coalesce(p_pick, '{}') loop
    if n is not null and length(n) between 1 and 100 and not (n = any (list)) then
      list := list || n;
    end if;
  end loop;
  insert into public.abs_sheet as s (workspace_id, audience, pick, updated_at, updated_by)
  values (p_workspace, p_audience, list, now(), me)
  on conflict (workspace_id) do update
    set audience = excluded.audience, pick = excluded.pick, updated_at = now(), updated_by = me;
  return public.abs_sheet_config_row(p_workspace);
end;
$$;
revoke all on function public.abs_sheet_set(text, text, text[]) from public;
grant execute on function public.abs_sheet_set(text, text, text[]) to anon, authenticated;

-- Отключить: секрет и копия стираются, выбор листов и «кому видна» остаются.
create or replace function public.abs_sheet_disconnect(p_workspace text) returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.abs_sheet_owner_guard(p_workspace, false);
begin
  update public.abs_sheet
    set token = null, payload = null, hash = null, title = null, sheets = '{}',
        pushed_at = null, seen_at = null, updated_at = now(), updated_by = me
  where workspace_id = p_workspace;
  return public.abs_sheet_config_row(p_workspace);
end;
$$;
revoke all on function public.abs_sheet_disconnect(text) from public;
grant execute on function public.abs_sheet_disconnect(text) to anon, authenticated;

-- Скрипт таблицы присылает листы. Ходит анонимным ключом, право — секрет.
-- Тот же отпечаток — копия не переписывается, отмечается только «на связи».
create or replace function public.abs_sheet_push(p_workspace text, p_token text, p_payload jsonb) returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  cur public.abs_sheet;
  body text;
  digest text;
  tabs jsonb;
  names text[] := '{}';
  t jsonb;
  label text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'bad token' using errcode = '42501';
  end if;
  select * into cur from public.abs_sheet s
  where s.workspace_id = p_workspace and s.token = p_token
  for update;
  if not found then
    raise exception 'bad token' using errcode = '42501';
  end if;
  if p_workspace not in (select w.workspace_id from public.rows_workspaces w
                         where w.live and public.nova_tenant_active(w.status, w.trial_until)) then
    raise exception 'workspace is read-only' using errcode = '42501';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'bad payload' using errcode = '22023';
  end if;
  body := p_payload::text;
  if octet_length(body) > 900000 then
    raise exception 'payload too large' using errcode = '22023';
  end if;
  tabs := p_payload -> 'tabs';
  if coalesce(jsonb_typeof(tabs), '') <> 'array' or jsonb_array_length(tabs) > 8 then
    raise exception 'bad tabs' using errcode = '22023';
  end if;
  for t in select value from jsonb_array_elements(tabs) loop
    if coalesce(jsonb_typeof(t), '') <> 'object'
       or coalesce(jsonb_typeof(t -> 'name'), '') <> 'string'
       or coalesce(jsonb_typeof(t -> 'rows'), '') <> 'array'
       or jsonb_array_length(t -> 'rows') > 300 then
      raise exception 'bad tab' using errcode = '22023';
    end if;
  end loop;
  if coalesce(jsonb_typeof(p_payload -> 'sheets'), '') = 'array' then
    select coalesce(array_agg(left(x.e #>> '{}', 100) order by x.i), '{}') into names
    from jsonb_array_elements(p_payload -> 'sheets') with ordinality as x(e, i)
    where jsonb_typeof(x.e) = 'string' and x.i <= 60;
  end if;
  label := case when coalesce(jsonb_typeof(p_payload -> 'title'), '') = 'string'
                then left(p_payload ->> 'title', 200) end;

  digest := md5(body);
  if cur.hash = digest then
    update public.abs_sheet set seen_at = now() where workspace_id = p_workspace;
    return jsonb_build_object('ok', true, 'changed', false, 'pick', to_jsonb(cur.pick));
  end if;
  update public.abs_sheet
    set payload = p_payload, hash = digest, title = label, sheets = names,
        pushed_at = now(), seen_at = now(), push_count = push_count + 1
  where workspace_id = p_workspace;
  return jsonb_build_object('ok', true, 'changed', true, 'pick', to_jsonb(cur.pick));
end;
$$;
revoke all on function public.abs_sheet_push(text, text, jsonb) from public;
grant execute on function public.abs_sheet_push(text, text, jsonb) to anon, authenticated;

-- Чтение копии. `p_hash` — отпечаток, который у читателя уже есть: совпал —
-- сама таблица не отдаётся (опрос раз в 20 с стоит десятки байт).
create or replace function public.abs_sheet_get(p_workspace text, p_hash text default null) returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  s public.abs_sheet;
  allowed boolean;
begin
  if public.rows_uid() is null or not coalesce(public.rows_is_member(p_workspace), false) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  select * into s from public.abs_sheet where workspace_id = p_workspace;
  if not found or s.token is null then
    return jsonb_build_object('connected', false, 'allowed', true);
  end if;
  allowed := s.audience = 'all' or p_workspace in (select public.rows_lead_workspaces());
  if not allowed then
    return jsonb_build_object('connected', true, 'allowed', false, 'audience', s.audience);
  end if;
  return jsonb_build_object(
    'connected', true,
    'allowed', true,
    'audience', s.audience,
    'hash', s.hash,
    'title', s.title,
    'pushedAt', (extract(epoch from s.pushed_at) * 1000)::bigint,
    'seenAt', (extract(epoch from s.seen_at) * 1000)::bigint,
    'payload', case when s.hash is not null and s.hash is distinct from p_hash then s.payload end);
end;
$$;
revoke all on function public.abs_sheet_get(text, text) from public;
grant execute on function public.abs_sheet_get(text, text) to anon, authenticated;
