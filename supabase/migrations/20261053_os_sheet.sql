-- «Таблица ОС» — Google-таблица ОС (реестр продаж), которую ОС правят прямо из
-- Nova (20.10.2026).
--
-- Просьба: «добавили такую таблицу для просмотра (ABS → Таблица), надо добавить
-- такую таблицу для ОС — редактируемую сразу с сайта» (скриншот — «StoryLove —
-- Данные (Октябрь)», лист «Октябрь оформление»: имя, дата, телефон, касса,
-- метод оплаты, менеджер ОС, статус…, выпадающие списки, столбцы-формулы).
--
-- Как и в ABS (20261051_abs_sheet.sql), сервера Google у нас нет: скрипт ВНУТРИ
-- таблицы (Apps Script, текст собирает Nova — src/utils/osSheetScript.ts)
-- присылает листы сюда (`os_sheet_push`). Отличия:
--
--  1. Обратный путь. Правка в Nova ложится в очередь `os_sheet_edits`
--     (`os_sheet_edit`: ОС и руководство). Скрипт забирает очередь
--     (`os_sheet_pull`), пишет ячейки в таблицу и в следующей передаче
--     отчитывается по каждой правке (`p_done`). Будит скрипт браузер правщика —
--     запросом на адрес веб-приложения скрипта (`hook`, задаёт Owner), а без
--     него скрипт сам спрашивает очередь раз в минуту.
--  2. Строки хранятся ПОШТУЧНО (`os_sheet_rows`) с отпечатком и версией: лист
--     ОС — сотни строк и сотни правок в день, и отдавать его целиком каждому
--     читателю на каждую правку — гигабайты исходящего трафика в сутки.
--     Читатель спрашивает «что новее версии N» (`os_sheet_get`) и получает
--     только изменившиеся строки.
--  3. Одна таблица на workspace: novaSetup в другой Google-таблице (копия на
--     новый месяц) забирает подключение себе (`source`), а старая копия
--     получает отказ «other sheet» и снимает свои триггеры.
--
-- Таблицы закрыты API-ролям целиком: читают и пишут только функции ниже.
-- Файл повторяемый.

create table if not exists public.os_sheet (
  workspace_id text primary key references public.rows_workspaces (workspace_id) on delete cascade,
  token text check (token is null or token ~ '^[0-9a-f]{64}$'),
  -- 'os' — ОС и руководство; 'all' — смотрят все участники, правят ОС и руководство.
  audience text not null default 'os' check (audience in ('os', 'all')),
  -- Какие листы присылать (выбор Owner; пусто — первый видимый лист).
  pick text[] not null default '{}',
  sheets text[] not null default '{}',
  title text,
  -- Какая Google-таблица подключена (id из адреса). Задаёт novaSetup.
  source text check (source is null or source ~ '^[A-Za-z0-9_-]{10,100}$'),
  -- Адрес веб-приложения скрипта: по нему браузер будит скрипт сразу после правки.
  hook text check (hook is null or hook ~ '^https://script\.google\.com/macros/s/[A-Za-z0-9_-]{10,200}/exec$'),
  -- Листы без строк: имена, ширины, закреплённое, столбцы, палитра, число строк.
  meta jsonb,
  meta_hash text,
  ver bigint not null default 0,
  meta_ver bigint not null default 0,
  pushed_at timestamptz,
  seen_at timestamptz,
  pulled_at timestamptz,
  push_count bigint not null default 0,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.os_sheet enable row level security;
revoke all on public.os_sheet from public, anon, authenticated;

create table if not exists public.os_sheet_rows (
  workspace_id text not null references public.os_sheet (workspace_id) on delete cascade,
  tab text not null,
  r int not null check (r >= 0),
  cells jsonb not null,
  styles jsonb not null,
  fx jsonb not null default 'null',
  h text not null,
  ver bigint not null,
  primary key (workspace_id, tab, r)
);

alter table public.os_sheet_rows enable row level security;
revoke all on public.os_sheet_rows from public, anon, authenticated;
create index if not exists os_sheet_rows_ver on public.os_sheet_rows (workspace_id, ver);

create table if not exists public.os_sheet_edits (
  id bigint generated always as identity primary key,
  workspace_id text not null references public.os_sheet (workspace_id) on delete cascade,
  tab text not null,
  -- Правка ячейки: строка и столбец листа (с нуля), ключ строки, как его видел
  -- человек ([[столбец, значение], …]), новое и прежнее значение.
  r int,
  c int,
  k jsonb,
  v text,
  o text,
  -- Новая строка: [[столбец, значение], …].
  add jsonb,
  by_uid text not null,
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  reason text,
  row_at int,
  done_at timestamptz,
  check ((add is null) <> (c is null))
);

alter table public.os_sheet_edits enable row level security;
revoke all on public.os_sheet_edits from public, anon, authenticated;
create index if not exists os_sheet_edits_pending on public.os_sheet_edits (workspace_id, status, id);

-- ---------------------------------------------------------------------
-- Права.

create or replace function public.os_sheet_owner_guard(p_workspace text, p_write boolean) returns text
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
revoke all on function public.os_sheet_owner_guard(text, boolean) from public, anon, authenticated;

-- 'edit' — ОС (основной или второй ролью) и руководство; 'view' — остальные
-- участники при audience = 'all'; 'none' — остальные. Не участник — отказ.
create or replace function public.os_sheet_access(p_workspace text, p_audience text) returns text
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if public.rows_uid() is null or not coalesce(public.rows_is_member(p_workspace), false) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  if p_workspace in (select public.rows_lead_workspaces()) or coalesce(public.rows_has_role(p_workspace, 'os'), false) then
    return 'edit';
  end if;
  return case when p_audience = 'all' then 'view' else 'none' end;
end;
$$;
revoke all on function public.os_sheet_access(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Настройка — только Owner.

create or replace function public.os_sheet_config_row(p_workspace text) returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'token', s.token,
    'audience', coalesce(s.audience, 'os'),
    'pick', to_jsonb(coalesce(s.pick, '{}')),
    'sheets', to_jsonb(coalesce(s.sheets, '{}')),
    'title', s.title,
    'source', s.source,
    'hook', s.hook,
    'pushedAt', (extract(epoch from s.pushed_at) * 1000)::bigint,
    'seenAt', (extract(epoch from s.seen_at) * 1000)::bigint,
    'pulledAt', (extract(epoch from s.pulled_at) * 1000)::bigint,
    'pushCount', coalesce(s.push_count, 0),
    'pending', (select count(*) from public.os_sheet_edits e
                where e.workspace_id = w.workspace_id and e.status = 'pending'),
    'salt', w.ring_salt)
  from public.rows_workspaces w
  left join public.os_sheet s on s.workspace_id = w.workspace_id
  where w.workspace_id = p_workspace
$$;
revoke all on function public.os_sheet_config_row(text) from public, anon, authenticated;

create or replace function public.os_sheet_config(p_workspace text) returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  perform public.os_sheet_owner_guard(p_workspace, false);
  return public.os_sheet_config_row(p_workspace);
end;
$$;
revoke all on function public.os_sheet_config(text) from public;
grant execute on function public.os_sheet_config(text) to anon, authenticated;

-- Новый секрет скрипта (первый — подключение, следующий — старый скрипт перестаёт работать).
create or replace function public.os_sheet_new_token(p_workspace text) returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.os_sheet_owner_guard(p_workspace, true);
  secret text := encode(sha256(convert_to(
    gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex');
begin
  insert into public.os_sheet as s (workspace_id, token, updated_at, updated_by)
  values (p_workspace, secret, now(), me)
  on conflict (workspace_id) do update set token = excluded.token, updated_at = now(), updated_by = me;
  return public.os_sheet_config_row(p_workspace);
end;
$$;
revoke all on function public.os_sheet_new_token(text) from public;
grant execute on function public.os_sheet_new_token(text) to anon, authenticated;

-- Кому видна таблица, какие листы присылать и адрес веб-приложения скрипта
-- (пусто — убрать: скрипт тогда спрашивает очередь сам раз в минуту).
create or replace function public.os_sheet_set(p_workspace text, p_audience text, p_pick text[], p_hook text) returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.os_sheet_owner_guard(p_workspace, true);
  list text[] := '{}';
  n text;
  hook text := nullif(btrim(coalesce(p_hook, '')), '');
begin
  if p_audience is null or p_audience not in ('os', 'all') then
    raise exception 'bad audience' using errcode = '22023';
  end if;
  if coalesce(array_length(p_pick, 1), 0) > 4 then
    raise exception 'too many sheets' using errcode = '22023';
  end if;
  if hook is not null and hook !~ '^https://script\.google\.com/macros/s/[A-Za-z0-9_-]{10,200}/exec$' then
    raise exception 'bad hook' using errcode = '22023';
  end if;
  foreach n in array coalesce(p_pick, '{}') loop
    if n is not null and length(n) between 1 and 100 and not (n = any (list)) then
      list := list || n;
    end if;
  end loop;
  insert into public.os_sheet as s (workspace_id, audience, pick, hook, updated_at, updated_by)
  values (p_workspace, p_audience, list, hook, now(), me)
  on conflict (workspace_id) do update
    set audience = excluded.audience, pick = excluded.pick, hook = excluded.hook, updated_at = now(), updated_by = me;
  return public.os_sheet_config_row(p_workspace);
end;
$$;
revoke all on function public.os_sheet_set(text, text, text[], text) from public;
grant execute on function public.os_sheet_set(text, text, text[], text) to anon, authenticated;

-- Отключить: секрет, копия и очередь стираются; выбор листов, «кому видна» и
-- адрес веб-приложения остаются.
create or replace function public.os_sheet_disconnect(p_workspace text) returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.os_sheet_owner_guard(p_workspace, false);
begin
  delete from public.os_sheet_rows where workspace_id = p_workspace;
  delete from public.os_sheet_edits where workspace_id = p_workspace;
  update public.os_sheet
    set token = null, source = null, meta = null, meta_hash = null, title = null, sheets = '{}',
        ver = ver + 1, meta_ver = ver + 1,
        pushed_at = null, seen_at = null, pulled_at = null, updated_at = now(), updated_by = me
  where workspace_id = p_workspace;
  return public.os_sheet_config_row(p_workspace);
end;
$$;
revoke all on function public.os_sheet_disconnect(text) from public;
grant execute on function public.os_sheet_disconnect(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Скрипт таблицы. Ходит анонимным ключом, право — секрет.

-- Секрет, живая компания и «та же Google-таблица». `p_claim` — novaSetup:
-- забрать подключение этой таблице (старая копия тогда получает отказ).
create or replace function public.os_sheet_script_auth(p_workspace text, p_token text, p_source text, p_claim boolean)
returns public.os_sheet
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  cur public.os_sheet;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'bad token' using errcode = '42501';
  end if;
  select * into cur from public.os_sheet s
  where s.workspace_id = p_workspace and s.token = p_token
  for update;
  if not found then
    raise exception 'bad token' using errcode = '42501';
  end if;
  if p_workspace not in (select w.workspace_id from public.rows_workspaces w
                         where w.live and public.nova_tenant_active(w.status, w.trial_until)) then
    raise exception 'workspace is read-only' using errcode = '42501';
  end if;
  if p_source is null or p_source !~ '^[A-Za-z0-9_-]{10,100}$' then
    raise exception 'bad source' using errcode = '22023';
  end if;
  if cur.source is null then
    -- Первое подключение (или после «Отключить», которое копию уже стёрло).
    update public.os_sheet set source = p_source where workspace_id = p_workspace returning * into cur;
  elsif coalesce(p_claim, false) then
    if cur.source <> p_source then
      -- Другая Google-таблица: прежняя копия и очередь — от неё, не от этой.
      delete from public.os_sheet_rows where workspace_id = p_workspace;
      update public.os_sheet_edits set status = 'failed', reason = 'other sheet', done_at = now()
      where workspace_id = p_workspace and status = 'pending';
      update public.os_sheet set source = p_source, meta = null, meta_hash = null, ver = ver + 1, meta_ver = ver + 1
      where workspace_id = p_workspace
      returning * into cur;
    end if;
  elsif cur.source <> p_source then
    raise exception 'other sheet' using errcode = '42501';
  end if;
  return cur;
end;
$$;
revoke all on function public.os_sheet_script_auth(text, text, text, boolean) from public, anon, authenticated;

-- Очередь правок для скрипта (старые сначала). Правки старше суток —
-- «не дождались»: человек давно ушёл, и молча вписать их сейчас хуже, чем отказать.
create or replace function public.os_sheet_pull(p_workspace text, p_token text, p_source text) returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  cur public.os_sheet := public.os_sheet_script_auth(p_workspace, p_token, p_source, false);
  list jsonb;
begin
  update public.os_sheet_edits set status = 'failed', reason = 'timeout', done_at = now()
  where workspace_id = p_workspace and status = 'pending' and created_at < now() - interval '1 day';
  update public.os_sheet set pulled_at = now() where workspace_id = p_workspace;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'tab', e.tab, 'r', e.r, 'c', e.c, 'k', e.k, 'v', e.v, 'add', e.add) order by e.id), '[]')
    into list
  from (select * from public.os_sheet_edits
        where workspace_id = p_workspace and status = 'pending'
        order by id limit 100) e;
  return jsonb_build_object('ok', true, 'edits', list, 'pick', to_jsonb(cur.pick));
end;
$$;
revoke all on function public.os_sheet_pull(text, text, text) from public;
grant execute on function public.os_sheet_pull(text, text, text) to anon, authenticated;

-- Передача листов + отчёт по применённым правкам (`p_done`: [{id, ok, reason, row}]).
-- Строки сверяются по отпечатку: версия растёт только у изменившихся.
create or replace function public.os_sheet_push(
  p_workspace text, p_token text, p_source text, p_payload jsonb,
  p_done jsonb default '[]', p_claim boolean default false
) returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  cur public.os_sheet := public.os_sheet_script_auth(p_workspace, p_token, p_source, p_claim);
  tabs jsonb;
  tb jsonb;
  names text[] := '{}';
  sheet_names text[] := '{}';
  label text;
  next_meta jsonb;
  next_hash text;
  next_ver bigint := cur.ver + 1;
  changed_rows bigint := 0;
  dropped_rows bigint := 0;
  acked bigint := 0;
  pending bigint;
  changed boolean;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'bad payload' using errcode = '22023';
  end if;
  if octet_length(p_payload::text) > 4000000 then
    raise exception 'payload too large' using errcode = '22023';
  end if;
  tabs := p_payload -> 'tabs';
  if coalesce(jsonb_typeof(tabs), '') <> 'array' or jsonb_array_length(tabs) > 4 then
    raise exception 'bad tabs' using errcode = '22023';
  end if;
  for tb in select value from jsonb_array_elements(tabs) loop
    if coalesce(jsonb_typeof(tb), '') <> 'object'
       or coalesce(jsonb_typeof(tb -> 'name'), '') <> 'string'
       or length(tb ->> 'name') not between 1 and 100
       or (tb ->> 'name') = any (names)
       or coalesce(jsonb_typeof(tb -> 'rows'), '') <> 'array'
       or jsonb_array_length(tb -> 'rows') > 3000
       or coalesce(jsonb_typeof(tb -> 's'), 'array') <> 'array'
       or coalesce(jsonb_typeof(tb -> 'fx'), 'array') <> 'array'
       or exists (select 1 from jsonb_array_elements(tb -> 'rows') x
                  where jsonb_typeof(x) <> 'array' or jsonb_array_length(x) > 40) then
      raise exception 'bad tab' using errcode = '22023';
    end if;
    names := names || (tb ->> 'name');
  end loop;
  if coalesce(jsonb_typeof(p_done), 'array') <> 'array' or jsonb_array_length(coalesce(p_done, '[]')) > 200 then
    raise exception 'bad done' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(p_payload -> 'sheets'), '') = 'array' then
    select coalesce(array_agg(left(x.e #>> '{}', 100) order by x.i), '{}') into sheet_names
    from jsonb_array_elements(p_payload -> 'sheets') with ordinality as x(e, i)
    where jsonb_typeof(x.e) = 'string' and x.i <= 60;
  end if;
  label := case when coalesce(jsonb_typeof(p_payload -> 'title'), '') = 'string'
                then left(p_payload ->> 'title', 200) end;

  -- Отчёт по правкам: только по своим ещё не решённым.
  update public.os_sheet_edits e
    set status = case when (d.value ->> 'ok')::boolean then 'done' else 'failed' end,
        reason = left(d.value ->> 'reason', 200),
        row_at = case when jsonb_typeof(d.value -> 'row') = 'number' then (d.value ->> 'row')::int end,
        done_at = now()
  from jsonb_array_elements(coalesce(p_done, '[]')) d
  where e.workspace_id = p_workspace and e.status = 'pending'
    -- Сравнение текстом: приведение кривого id к числу уронило бы всю передачу.
    and jsonb_typeof(d.value -> 'id') = 'number' and e.id::text = d.value ->> 'id'
    and jsonb_typeof(d.value -> 'ok') = 'boolean';
  get diagnostics acked = row_count;

  -- Строки: новая версия только у изменившихся.
  with incoming as (
    select t.value ->> 'name' as tab,
           (x.i - 1)::int as r,
           x.e as cells,
           coalesce(t.value -> 's' -> ((x.i - 1)::int), '[]') as styles,
           coalesce(t.value -> 'fx' -> ((x.i - 1)::int), 'null') as fx
    from jsonb_array_elements(tabs) t,
         jsonb_array_elements(t.value -> 'rows') with ordinality as x(e, i)
  )
  insert into public.os_sheet_rows as o (workspace_id, tab, r, cells, styles, fx, h, ver)
  select p_workspace, i.tab, i.r, i.cells, i.styles, i.fx,
         md5(i.cells::text || '|' || i.styles::text || '|' || i.fx::text), next_ver
  from incoming i
  on conflict (workspace_id, tab, r) do update
    set cells = excluded.cells, styles = excluded.styles, fx = excluded.fx, h = excluded.h, ver = excluded.ver
    where o.h is distinct from excluded.h;
  get diagnostics changed_rows = row_count;

  delete from public.os_sheet_rows o
  where o.workspace_id = p_workspace
    and not exists (select 1 from jsonb_array_elements(tabs) t
                    where t.value ->> 'name' = o.tab and o.r < jsonb_array_length(t.value -> 'rows'));
  get diagnostics dropped_rows = row_count;

  select jsonb_build_object(
           'id', case when coalesce(jsonb_typeof(p_payload -> 'id'), '') = 'string' then left(p_payload ->> 'id', 100) end,
           'tabs', coalesce(jsonb_agg((t.value - 'rows' - 's' - 'fx')
                                      || jsonb_build_object('n', jsonb_array_length(t.value -> 'rows'))
                                      order by t.i), '[]'))
    into next_meta
  from jsonb_array_elements(tabs) with ordinality as t(value, i);
  next_hash := md5(next_meta::text);

  changed := changed_rows > 0 or dropped_rows > 0 or next_hash is distinct from cur.meta_hash;
  if changed then
    update public.os_sheet
      set ver = next_ver,
          meta_ver = case when next_hash is distinct from cur.meta_hash then next_ver else meta_ver end,
          meta = next_meta, meta_hash = next_hash, title = label, sheets = sheet_names,
          pushed_at = now(), seen_at = now(), push_count = push_count + 1
    where workspace_id = p_workspace;
  else
    update public.os_sheet set seen_at = now(), title = label, sheets = sheet_names where workspace_id = p_workspace;
  end if;

  -- Журнал правок не копится вечно.
  delete from public.os_sheet_edits
  where workspace_id = p_workspace and status <> 'pending' and done_at < now() - interval '30 days';

  select count(*) into pending from public.os_sheet_edits where workspace_id = p_workspace and status = 'pending';
  return jsonb_build_object('ok', true, 'changed', changed, 'acked', acked, 'pending', pending,
                            'ver', case when changed then next_ver else cur.ver end, 'pick', to_jsonb(cur.pick));
end;
$$;
revoke all on function public.os_sheet_push(text, text, text, jsonb, jsonb, boolean) from public;
grant execute on function public.os_sheet_push(text, text, text, jsonb, jsonb, boolean) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Участники.

-- Чтение копии с версии `p_since` (0 — целиком): только изменившиеся строки,
-- описание листов — если менялось. `p_edits` — свои правки, о которых
-- читатель ждёт ответа.
create or replace function public.os_sheet_get(p_workspace text, p_since bigint default 0, p_edits bigint[] default '{}')
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  s public.os_sheet;
  access text;
  full_read boolean;
  rows_out jsonb;
  edits_out jsonb;
  since bigint := coalesce(p_since, 0);
begin
  select * into s from public.os_sheet where workspace_id = p_workspace;
  access := public.os_sheet_access(p_workspace, coalesce(s.audience, 'os'));
  if s.workspace_id is null or s.token is null then
    return jsonb_build_object('connected', false, 'allowed', access <> 'none', 'canEdit', access = 'edit');
  end if;
  if access = 'none' then
    return jsonb_build_object('connected', true, 'allowed', false, 'audience', s.audience);
  end if;
  full_read := since <= 0 or since > s.ver;
  select coalesce(jsonb_agg(jsonb_build_array(o.tab, o.r, o.cells, o.styles, o.fx) order by o.tab, o.r), '[]')
    into rows_out
  from public.os_sheet_rows o
  where o.workspace_id = p_workspace and (full_read or o.ver > since);
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'status', e.status, 'reason', e.reason, 'row', e.row_at)), '[]')
    into edits_out
  from public.os_sheet_edits e
  where e.workspace_id = p_workspace and e.by_uid = public.rows_uid()
    and e.id = any (coalesce(p_edits, '{}'));
  return jsonb_build_object(
    'connected', true,
    'allowed', true,
    'canEdit', access = 'edit',
    'audience', s.audience,
    'ver', s.ver,
    'full', full_read,
    'title', s.title,
    'hook', case when access = 'edit' then s.hook end,
    'pushedAt', (extract(epoch from s.pushed_at) * 1000)::bigint,
    'seenAt', (extract(epoch from s.seen_at) * 1000)::bigint,
    'pulledAt', (extract(epoch from s.pulled_at) * 1000)::bigint,
    'pending', (select count(*) from public.os_sheet_edits e where e.workspace_id = p_workspace and e.status = 'pending'),
    'meta', case when full_read or s.meta_ver > since then s.meta end,
    'rows', rows_out,
    'edits', edits_out);
end;
$$;
revoke all on function public.os_sheet_get(text, bigint, bigint[]) from public;
grant execute on function public.os_sheet_get(text, bigint, bigint[]) to anon, authenticated;

-- Правки из Nova: [{tab, r, c, v, k, o}] — ячейка; [{tab, add: [[c, v], …]}] —
-- новая строка. Шапку и формулы не правят; ответ — номера правок по порядку.
create or replace function public.os_sheet_edit(p_workspace text, p_edits jsonb) returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  s public.os_sheet;
  me text := public.rows_uid();
  e jsonb;
  tab_meta jsonb;
  tab_name text;
  hdr int;
  n int;
  ncols int;
  v_r int;
  v_c int;
  cell_fx jsonb;
  pair jsonb;
  new_id bigint;
  ids jsonb := '[]';
  queued bigint;
begin
  select * into s from public.os_sheet where workspace_id = p_workspace for update;
  if public.os_sheet_access(p_workspace, coalesce(s.audience, 'os')) <> 'edit' then
    raise exception 'cannot edit' using errcode = '42501';
  end if;
  if p_workspace not in (select public.rows_writable_workspaces()) then
    raise exception 'workspace is read-only' using errcode = '42501';
  end if;
  if s.workspace_id is null or s.token is null or s.meta is null then
    raise exception 'not connected' using errcode = '55000';
  end if;
  if p_edits is null or jsonb_typeof(p_edits) <> 'array' or jsonb_array_length(p_edits) not between 1 and 200 then
    raise exception 'bad edits' using errcode = '22023';
  end if;
  select count(*) into queued from public.os_sheet_edits where workspace_id = p_workspace and status = 'pending';
  if queued + jsonb_array_length(p_edits) > 1000 then
    raise exception 'queue full' using errcode = '22023';
  end if;

  for e in select value from jsonb_array_elements(p_edits) loop
    if jsonb_typeof(e) <> 'object' or coalesce(jsonb_typeof(e -> 'tab'), '') <> 'string' then
      raise exception 'bad edit' using errcode = '22023';
    end if;
    tab_name := e ->> 'tab';
    select x into tab_meta from jsonb_array_elements(s.meta -> 'tabs') x where x ->> 'name' = tab_name limit 1;
    if tab_meta is null then
      raise exception 'no such tab' using errcode = '22023';
    end if;
    hdr := greatest(coalesce((tab_meta ->> 'hdr')::int, 1), 0);
    n := coalesce((tab_meta ->> 'n')::int, 0);
    ncols := coalesce(jsonb_array_length(tab_meta -> 'cols'), 0);

    if e ? 'add' then
      if coalesce(jsonb_typeof(e -> 'add'), '') <> 'array' or jsonb_array_length(e -> 'add') not between 1 and 40 then
        raise exception 'bad edit' using errcode = '22023';
      end if;
      for pair in select value from jsonb_array_elements(e -> 'add') loop
        if jsonb_typeof(pair) <> 'array' or jsonb_array_length(pair) <> 2
           or jsonb_typeof(pair -> 0) <> 'number' or jsonb_typeof(pair -> 1) <> 'string'
           or (pair ->> 0)::int not between 0 and ncols - 1
           or length(pair ->> 1) > 2000 then
          raise exception 'bad edit' using errcode = '22023';
        end if;
        if coalesce((tab_meta -> 'cols' -> ((pair ->> 0)::int) ->> 'f')::int, 0) = 1 then
          raise exception 'formula cell' using errcode = '22023';
        end if;
      end loop;
      insert into public.os_sheet_edits (workspace_id, tab, add, by_uid)
      values (p_workspace, tab_name, e -> 'add', me)
      returning id into new_id;
    else
      if jsonb_typeof(e -> 'r') <> 'number' or jsonb_typeof(e -> 'c') <> 'number'
         or coalesce(jsonb_typeof(e -> 'v'), '') <> 'string' or length(e ->> 'v') > 2000
         or coalesce(jsonb_typeof(e -> 'k'), 'array') <> 'array' or jsonb_array_length(coalesce(e -> 'k', '[]')) > 6 then
        raise exception 'bad edit' using errcode = '22023';
      end if;
      v_r := (e ->> 'r')::int;
      v_c := (e ->> 'c')::int;
      if v_r < hdr or v_r >= n or v_c < 0 or v_c >= ncols then
        raise exception 'bad cell' using errcode = '22023';
      end if;
      cell_fx := null;
      select o.fx into cell_fx from public.os_sheet_rows o
      where o.workspace_id = p_workspace and o.tab = tab_name and o.r = v_r;
      if jsonb_typeof(cell_fx) = 'array' and cell_fx @> to_jsonb(v_c) then
        raise exception 'formula cell' using errcode = '22023';
      end if;
      insert into public.os_sheet_edits (workspace_id, tab, r, c, k, v, o, by_uid)
      values (p_workspace, tab_name, v_r, v_c, coalesce(e -> 'k', '[]'), e ->> 'v', left(e ->> 'o', 2000), me)
      returning id into new_id;
    end if;
    ids := ids || to_jsonb(new_id);
  end loop;
  return jsonb_build_object('ids', ids, 'hook', s.hook);
end;
$$;
revoke all on function public.os_sheet_edit(text, jsonb) from public;
grant execute on function public.os_sheet_edit(text, jsonb) to anon, authenticated;
