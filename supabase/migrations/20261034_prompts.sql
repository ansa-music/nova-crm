-- =====================================================================
-- Nova CRM — «Промты» (27.09.2026).
--
-- Просьба Nurba: «страница „Промты“, внутри две — „Мои“ и „Общие“; личные
-- видны только ему, с доступом можно запросить; общие — название, промт и для
-- чего; одна кнопка на копирку; можно прикрепить одно фото как результат;
-- пока только выбранным пользователям можно писать общие, остальные делают
-- себе личные».
--
-- Всё закрыто от прямого доступа: таблицы без политик, наружу — только
-- функции ниже (SECURITY DEFINER), и они повторяют правила:
--   • общий промт читает любой участник, пишет «писатель» (Owner или uid из
--     prompt_config.writers), правит его автор или Owner, удаляет так же;
--   • личный промт читает и правит только автор; другой участник видит лишь
--     НАЗВАНИЕ и автора (prompt_list → stubs), может попросить доступ —
--     автор открывает (prompt_access) или отклоняет, может снять доступ.
-- Удаление мягкое, у удалённого стираются текст и фото.
--
-- Фото результата лежит в бакете row-files по пути {ws}/prompts/{uid}/…:
-- nova_storage_path_ok — полная копия из 20261031_site_builder.sql плюс ветка
-- prompts (писать можно только в свою папку). Ссылка публичная, как у
-- вложений строк; адрес со случайным uuid не угадать.
--
-- Скрипт повторяемый. Правки функций — только в этом файле или новее.
-- =====================================================================

create table if not exists public.prompts (
  workspace_id text not null references public.rows_workspaces (workspace_id) on delete cascade,
  id text not null,
  kind text not null check (kind in ('personal', 'shared')),
  author_uid text not null,
  title text not null default '',
  purpose text not null default '',
  body text not null default '',
  photo_url text,
  photo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  deleted boolean not null default false,
  primary key (workspace_id, id)
);

create index if not exists prompts_author_idx on public.prompts (workspace_id, author_uid) where not deleted;
create index if not exists prompts_shared_idx on public.prompts (workspace_id, kind) where not deleted;

create table if not exists public.prompt_access (
  workspace_id text not null,
  prompt_id text not null,
  uid text not null,
  granted_at timestamptz not null default now(),
  primary key (workspace_id, prompt_id, uid),
  foreign key (workspace_id, prompt_id) references public.prompts (workspace_id, id) on delete cascade
);

create table if not exists public.prompt_requests (
  workspace_id text not null,
  prompt_id text not null,
  uid text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  primary key (workspace_id, prompt_id, uid),
  foreign key (workspace_id, prompt_id) references public.prompts (workspace_id, id) on delete cascade
);

create table if not exists public.prompt_config (
  workspace_id text primary key references public.rows_workspaces (workspace_id) on delete cascade,
  writers text[] not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.prompts enable row level security;
alter table public.prompt_access enable row level security;
alter table public.prompt_requests enable row level security;
alter table public.prompt_config enable row level security;
-- Ни одной политики: всё отдают и пишут функции ниже.
revoke all on public.prompts from public, anon, authenticated;
revoke all on public.prompt_access from public, anon, authenticated;
revoke all on public.prompt_requests from public, anon, authenticated;
revoke all on public.prompt_config from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Помощники.
-- ---------------------------------------------------------------------

create or replace function public.prompt_tenant_active(ws text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.rows_workspaces w
    where w.workspace_id = ws and public.nova_tenant_active(w.status, w.trial_until)
  )
$$;
revoke all on function public.prompt_tenant_active(text) from public, anon, authenticated;

-- Пишет общие промты: Owner или участник из списка писателей.
create or replace function public.prompt_can_write_shared(ws text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.rows_uid() is not null and (
    coalesce(public.rows_is_owner(ws), false)
    or (
      coalesce(public.rows_is_member(ws), false)
      and exists (
        select 1 from public.prompt_config c
        where c.workspace_id = ws and public.rows_uid() = any (c.writers)
      )
    )
  )
$$;
revoke all on function public.prompt_can_write_shared(text) from public, anon, authenticated;

create or replace function public.prompt_json(p public.prompts) returns jsonb
language sql immutable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', p.id,
    'kind', p.kind,
    'authorUid', p.author_uid,
    'title', p.title,
    'purpose', p.purpose,
    'body', p.body,
    'photoUrl', p.photo_url,
    'photoPath', p.photo_path,
    'createdAt', floor(extract(epoch from p.created_at) * 1000),
    'updatedAt', floor(extract(epoch from p.updated_at) * 1000)
  )
$$;
revoke all on function public.prompt_json(public.prompts) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Всё для страницы одним вызовом.
-- ---------------------------------------------------------------------
create or replace function public.prompt_list(p_workspace text) returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  owner boolean;
begin
  if me is null or not coalesce(public.rows_is_member(p_workspace), false) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  owner := coalesce(public.rows_is_owner(p_workspace), false);
  return jsonb_build_object(
    'isOwner', owner,
    'canWriteShared', public.prompt_can_write_shared(p_workspace),
    'writers', case when owner then to_jsonb(coalesce((select c.writers from public.prompt_config c where c.workspace_id = p_workspace), '{}'::text[])) else '[]'::jsonb end,
    -- Мои (личные и общие) + все общие + открытые мне чужие личные.
    'prompts', coalesce((
      select jsonb_agg(
        public.prompt_json(p) || jsonb_build_object(
          'granted', p.kind = 'personal' and p.author_uid <> me,
          'access', case when p.kind = 'personal' and p.author_uid = me then coalesce((
            select jsonb_agg(a.uid order by a.granted_at) from public.prompt_access a
            where a.workspace_id = p.workspace_id and a.prompt_id = p.id
          ), '[]'::jsonb) else '[]'::jsonb end
        ) order by p.updated_at desc)
      from public.prompts p
      where p.workspace_id = p_workspace and not p.deleted and (
        p.kind = 'shared'
        or p.author_uid = me
        or exists (
          select 1 from public.prompt_access a
          where a.workspace_id = p.workspace_id and a.prompt_id = p.id and a.uid = me
        )
      )
    ), '[]'::jsonb),
    -- Чужие личные без доступа: только название и автор.
    'stubs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'title', p.title,
        'authorUid', p.author_uid,
        'request', (
          select r.status from public.prompt_requests r
          where r.workspace_id = p.workspace_id and r.prompt_id = p.id and r.uid = me
        )
      ) order by p.updated_at desc)
      from public.prompts p
      where p.workspace_id = p_workspace and not p.deleted and p.kind = 'personal' and p.author_uid <> me
        and not exists (
          select 1 from public.prompt_access a
          where a.workspace_id = p.workspace_id and a.prompt_id = p.id and a.uid = me
        )
    ), '[]'::jsonb),
    -- Ожидающие запросы к моим промтам.
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'promptId', r.prompt_id,
        'uid', r.uid,
        'at', floor(extract(epoch from r.requested_at) * 1000)
      ) order by r.requested_at)
      from public.prompt_requests r
      join public.prompts p on p.workspace_id = r.workspace_id and p.id = r.prompt_id
      where r.workspace_id = p_workspace and r.status = 'pending' and p.author_uid = me and not p.deleted
        and coalesce(public.rows_is_member(p_workspace), false)
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.prompt_list(text) from public;
grant execute on function public.prompt_list(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Создать или править. Новый — p_kind; у существующего вид не меняется.
-- Фото: p_photo_url/p_photo_path = null — убрать; не трогать — передать
-- прежние значения (клиент всегда шлёт то, что должно быть).
-- ---------------------------------------------------------------------
create or replace function public.prompt_save(
  p_workspace text,
  p_id text,
  p_kind text,
  p_title text,
  p_purpose text,
  p_body text,
  p_photo_url text,
  p_photo_path text
) returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  cur public.prompts%rowtype;
  row public.prompts%rowtype;
  t text := btrim(coalesce(p_title, ''));
  pu text := btrim(coalesce(p_purpose, ''));
  b text := coalesce(p_body, '');
begin
  if me is null or not coalesce(public.rows_is_member(p_workspace), false) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  if not public.prompt_tenant_active(p_workspace) then
    raise exception 'workspace suspended' using errcode = '42501';
  end if;
  if p_id is null or p_id !~ '^[A-Za-z0-9_-]{6,64}$' then
    raise exception 'bad id' using errcode = '22023';
  end if;
  if t = '' then
    raise exception 'title required' using errcode = '22023';
  end if;
  if btrim(b) = '' then
    raise exception 'body required' using errcode = '22023';
  end if;
  if length(t) > 120 or length(pu) > 300 or length(b) > 20000 then
    raise exception 'too long' using errcode = '22023';
  end if;
  if p_photo_path is not null and p_photo_path not like p_workspace || '/prompts/' || me || '/%'
     and p_photo_path is distinct from (select x.photo_path from public.prompts x where x.workspace_id = p_workspace and x.id = p_id) then
    raise exception 'bad photo path' using errcode = '22023';
  end if;
  if p_photo_url is not null and (length(p_photo_url) > 1000 or p_photo_url !~ '^https?://') then
    raise exception 'bad photo url' using errcode = '22023';
  end if;

  select * into cur from public.prompts x where x.workspace_id = p_workspace and x.id = p_id for update;
  if found then
    if cur.deleted then
      raise exception 'prompt deleted' using errcode = 'P0002';
    end if;
    if cur.kind = 'personal' then
      if cur.author_uid <> me then
        raise exception 'not the author' using errcode = '42501';
      end if;
    elsif not (
      coalesce(public.rows_is_owner(p_workspace), false)
      or (cur.author_uid = me and public.prompt_can_write_shared(p_workspace))
    ) then
      raise exception 'not a shared writer' using errcode = '42501';
    end if;
    update public.prompts x set
      title = t, purpose = pu, body = b,
      photo_url = p_photo_url, photo_path = p_photo_path,
      updated_at = now(), updated_by = me
    where x.workspace_id = p_workspace and x.id = p_id
    returning * into row;
  else
    if p_kind not in ('personal', 'shared') then
      raise exception 'bad kind' using errcode = '22023';
    end if;
    if p_kind = 'shared' and not public.prompt_can_write_shared(p_workspace) then
      raise exception 'not a shared writer' using errcode = '42501';
    end if;
    if (select count(*) from public.prompts x where x.workspace_id = p_workspace and x.author_uid = me and not x.deleted) >= 500 then
      raise exception 'too many prompts' using errcode = '54000';
    end if;
    insert into public.prompts (workspace_id, id, kind, author_uid, title, purpose, body, photo_url, photo_path, updated_by)
    values (p_workspace, p_id, p_kind, me, t, pu, b, p_photo_url, p_photo_path, me)
    returning * into row;
  end if;
  return public.prompt_json(row);
end;
$$;
revoke all on function public.prompt_save(text, text, text, text, text, text, text, text) from public;
grant execute on function public.prompt_save(text, text, text, text, text, text, text, text) to anon, authenticated;

-- Удалить (мягко). Возвращает путь фото, чтобы клиент стёр файл.
create or replace function public.prompt_delete(p_workspace text, p_id text) returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  cur public.prompts%rowtype;
begin
  if me is null or not coalesce(public.rows_is_member(p_workspace), false) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  select * into cur from public.prompts x where x.workspace_id = p_workspace and x.id = p_id and not x.deleted for update;
  if not found then
    return jsonb_build_object('photoPath', null);
  end if;
  if not (cur.author_uid = me or (cur.kind = 'shared' and coalesce(public.rows_is_owner(p_workspace), false))) then
    raise exception 'not the author' using errcode = '42501';
  end if;
  update public.prompts x set
    deleted = true, body = '', purpose = '', photo_url = null, photo_path = null,
    updated_at = now(), updated_by = me
  where x.workspace_id = p_workspace and x.id = p_id;
  delete from public.prompt_access a where a.workspace_id = p_workspace and a.prompt_id = p_id;
  delete from public.prompt_requests r where r.workspace_id = p_workspace and r.prompt_id = p_id;
  return jsonb_build_object('photoPath', cur.photo_path);
end;
$$;
revoke all on function public.prompt_delete(text, text) from public;
grant execute on function public.prompt_delete(text, text) to anon, authenticated;

-- Попросить доступ к чужому личному промту. Возвращает автора (кому уведомление).
create or replace function public.prompt_request(p_workspace text, p_id text) returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  cur public.prompts%rowtype;
  prev text;
begin
  if me is null or not coalesce(public.rows_is_member(p_workspace), false) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  select * into cur from public.prompts x where x.workspace_id = p_workspace and x.id = p_id and not x.deleted;
  if not found then
    raise exception 'prompt not found' using errcode = 'P0002';
  end if;
  if cur.kind <> 'personal' or cur.author_uid = me then
    raise exception 'nothing to request' using errcode = '22023';
  end if;
  if exists (select 1 from public.prompt_access a where a.workspace_id = p_workspace and a.prompt_id = p_id and a.uid = me) then
    return jsonb_build_object('status', 'approved', 'author', cur.author_uid, 'already', true);
  end if;
  select r.status into prev from public.prompt_requests r
  where r.workspace_id = p_workspace and r.prompt_id = p_id and r.uid = me;
  if prev = 'pending' then
    return jsonb_build_object('status', 'pending', 'author', cur.author_uid, 'already', true);
  end if;
  insert into public.prompt_requests as r (workspace_id, prompt_id, uid, status, requested_at, resolved_at)
  values (p_workspace, p_id, me, 'pending', now(), null)
  on conflict (workspace_id, prompt_id, uid) do update set status = 'pending', requested_at = now(), resolved_at = null;
  return jsonb_build_object('status', 'pending', 'author', cur.author_uid, 'already', false, 'title', cur.title);
end;
$$;
revoke all on function public.prompt_request(text, text) from public;
grant execute on function public.prompt_request(text, text) to anon, authenticated;

-- Автор открывает (p_approve) или отклоняет запрос.
create or replace function public.prompt_resolve(p_workspace text, p_id text, p_uid text, p_approve boolean) returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  cur public.prompts%rowtype;
begin
  if me is null or not coalesce(public.rows_is_member(p_workspace), false) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  select * into cur from public.prompts x where x.workspace_id = p_workspace and x.id = p_id and not x.deleted;
  if not found then
    raise exception 'prompt not found' using errcode = 'P0002';
  end if;
  if cur.author_uid <> me or cur.kind <> 'personal' then
    raise exception 'not the author' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.prompt_requests r
    where r.workspace_id = p_workspace and r.prompt_id = p_id and r.uid = p_uid and r.status = 'pending'
  ) then
    raise exception 'no pending request' using errcode = 'P0002';
  end if;
  update public.prompt_requests r set
    status = case when coalesce(p_approve, false) then 'approved' else 'rejected' end,
    resolved_at = now()
  where r.workspace_id = p_workspace and r.prompt_id = p_id and r.uid = p_uid;
  if coalesce(p_approve, false) and coalesce(public.rows_is_member(p_workspace), false)
     and exists (select 1 from public.rows_members m where m.workspace_id = p_workspace and m.uid = p_uid) then
    insert into public.prompt_access (workspace_id, prompt_id, uid) values (p_workspace, p_id, p_uid)
    on conflict do nothing;
  end if;
  return jsonb_build_object('title', cur.title, 'approved', coalesce(p_approve, false));
end;
$$;
revoke all on function public.prompt_resolve(text, text, text, boolean) from public;
grant execute on function public.prompt_resolve(text, text, text, boolean) to anon, authenticated;

-- Автор снимает доступ (запрос тоже стирается — можно попросить снова).
create or replace function public.prompt_revoke(p_workspace text, p_id text, p_uid text) returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
begin
  if me is null or not exists (
    select 1 from public.prompts x
    where x.workspace_id = p_workspace and x.id = p_id and x.author_uid = me and not x.deleted
  ) then
    raise exception 'not the author' using errcode = '42501';
  end if;
  delete from public.prompt_access a where a.workspace_id = p_workspace and a.prompt_id = p_id and a.uid = p_uid;
  delete from public.prompt_requests r where r.workspace_id = p_workspace and r.prompt_id = p_id and r.uid = p_uid;
end;
$$;
revoke all on function public.prompt_revoke(text, text, text) from public;
grant execute on function public.prompt_revoke(text, text, text) to anon, authenticated;

-- Кто пишет общие промты — только Owner.
create or replace function public.prompt_set_writers(p_workspace text, p_uids text[]) returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  list text[];
begin
  if me is null or not coalesce(public.rows_is_owner(p_workspace), false) then
    raise exception 'only owner' using errcode = '42501';
  end if;
  if coalesce(array_length(p_uids, 1), 0) > 50 then
    raise exception 'too many writers' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct m.uid order by m.uid), '{}') into list
  from public.rows_members m where m.workspace_id = p_workspace and m.uid = any (coalesce(p_uids, '{}'));
  insert into public.prompt_config as c (workspace_id, writers, updated_at, updated_by)
  values (p_workspace, list, now(), me)
  on conflict (workspace_id) do update set writers = list, updated_at = now(), updated_by = me;
  return jsonb_build_object('writers', to_jsonb(list));
end;
$$;
revoke all on function public.prompt_set_writers(text, text[]) from public;
grant execute on function public.prompt_set_writers(text, text[]) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Хранилище: полная копия из 20261031_site_builder.sql + ветка prompts.
-- ---------------------------------------------------------------------
do $storage$
begin
  create or replace function public.nova_storage_path_ok(p_name text, p_write boolean) returns boolean
  language plpgsql stable security definer
  set search_path = public, pg_temp
  as $fn$
  declare
    parts text[] := string_to_array(coalesce(p_name, ''), '/');
    ws text := parts[1];
    me text := public.rows_uid();
  begin
    if me is null or ws is null or ws = '' or coalesce(array_length(parts, 1), 0) < 2 then
      return false;
    end if;
    if not coalesce(public.rows_is_member(ws), false) then
      return false;
    end if;
    if not p_write then
      return true;
    end if;
    if parts[2] in ('avatars', 'prompts') then
      return coalesce(parts[3] = me, false);
    end if;
    if parts[2] in ('sounds', 'brand') then
      return coalesce(public.rows_is_owner(ws), false);
    end if;
    return true;
  end;
  $fn$;
  revoke all on function public.nova_storage_path_ok(text, boolean) from public;
  grant execute on function public.nova_storage_path_ok(text, boolean) to anon, authenticated;
exception when others then
  raise warning 'nova_storage_path_ok not updated: %', sqlerrm;
end
$storage$;

-- ---------------------------------------------------------------------
create or replace function public.nova_schema_version() returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select '20261034'
$$;
revoke all on function public.nova_schema_version() from public, anon, authenticated;
grant execute on function public.nova_schema_version() to anon, authenticated;
