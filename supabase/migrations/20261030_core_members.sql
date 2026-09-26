-- =====================================================================
-- Ядро в Supabase, этап B (27.09.2026, просьба Nurba «все в супабасе»):
-- участники, приглашения по почте, заявки на вход и НАСТРОЙКИ workspace —
-- в той же таблице core_docs, что столы и вкладки (20261029).
--
--   kind = member    — участник, id = uid, data — документ members/{uid};
--   kind = invite    — приглашение по почте, id = почта в нижнем регистре;
--   kind = join      — заявка на вход, id = uid просящего;
--   kind = workspace — настройки workspace, id = workspace_id (статусы,
--                      ники, касса, периоды, график, регион…). Управляющие
--                      поля (ownerId, rowsBackend, sbCollections, reloadEpoch,
--                      name…) остаются в документе Firestore — их читают
--                      правила и выключатели хранилищ.
--
-- Права — копия правил firestore.rules (members, joinRequests, workspace):
-- всё пишет только core_write (одной транзакцией) и функции-действия ниже
-- (core_claim_invites, core_nick_*, core_approve_join, core_member_purge,
-- core_seed_status) — они повторяют транзакции Firestore, которые раньше
-- собирал клиент. Копию прав rows_members ведёт ТРИГГЕР по документу
-- участника, копию настроек в rows_workspaces (редакторы графика, режим
-- «кто заполняет столы», регион) — триггер по документу workspace.
--
-- Отметка переноса — meta/imported_member (столы — своя, imported_page).
-- core_write и core_import — ПОЛНЫЕ КОПИИ из 20261029 с новыми ветками:
-- правки этих функций — только здесь или в файле новее.
-- Файл повторяемый.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Таблица: новые виды документов.
-- ---------------------------------------------------------------------
do $$
declare c record;
begin
  for c in
    select con.conname from pg_constraint con
    join pg_class t on t.oid = con.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'core_docs' and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%kind%'
  loop
    execute format('alter table public.core_docs drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.core_docs add constraint core_docs_kind_check
  check (kind in ('page', 'subpage', 'meta', 'member', 'invite', 'join', 'workspace'));

-- Почта из токена Firebase (в нижнем регистре) — по ней приглашения.
create or replace function public.rows_email() returns text
language sql stable
set search_path = public, pg_temp
as $$
  select case when public.rows_uid() is not null
    then nullif(lower(btrim(coalesce(auth.jwt() ->> 'email', ''))), '') end
$$;
revoke all on function public.rows_email() from public;
grant execute on function public.rows_email() to anon, authenticated;

-- ---------------------------------------------------------------------
-- Копия прав rows_members — по документу участника (как rows_page_acl по
-- документу стола). Приглашения по почте участниками не считаются.
-- ---------------------------------------------------------------------
create or replace function public.core_docs_member_sync() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_extra text[];
  v_nick text;
begin
  if new.kind <> 'member' then
    return new;
  end if;
  if not exists (select 1 from public.rows_workspaces w where w.workspace_id = new.workspace_id) then
    return new;
  end if;
  if new.deleted then
    delete from public.rows_members m where m.workspace_id = new.workspace_id and m.uid = new.id;
    return new;
  end if;
  v_role := new.data ->> 'role';
  if v_role is null or v_role not in ('owner', 'teamlead', 'admin', 'manager', 'os', 'viewer') then
    return new;
  end if;
  select coalesce(array_agg(distinct e order by e), '{}') into v_extra
  from jsonb_array_elements_text(case when jsonb_typeof(new.data -> 'extraRoles') = 'array' then new.data -> 'extraRoles' else '[]'::jsonb end) e
  where e in ('manager', 'os');
  v_nick := nullif(new.data ->> 'osNickValue', '');
  insert into public.rows_members as m (workspace_id, uid, role, extra_roles, os_nick_value, updated_at)
  values (new.workspace_id, new.id, v_role, v_extra, v_nick, (extract(epoch from now()) * 1000)::bigint)
  on conflict (workspace_id, uid) do update
    set role = excluded.role, extra_roles = excluded.extra_roles, os_nick_value = excluded.os_nick_value, updated_at = excluded.updated_at
    where m.role is distinct from excluded.role or m.extra_roles is distinct from excluded.extra_roles
       or m.os_nick_value is distinct from excluded.os_nick_value;
  return new;
end;
$$;
revoke all on function public.core_docs_member_sync() from public, anon, authenticated;

drop trigger if exists core_docs_40_member on public.core_docs;
create trigger core_docs_40_member
  after insert or update on public.core_docs
  for each row execute function public.core_docs_member_sync();

-- ---------------------------------------------------------------------
-- Копия настроек в rows_workspaces: редакторы графика, режим «кто
-- заполняет столы», регион. Кривой регион не роняет запись — остаётся прежний.
-- ---------------------------------------------------------------------
create or replace function public.core_docs_workspace_sync() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_editors text[];
  v_tz text;
  v_cur text;
  v_loc text;
begin
  if new.kind <> 'workspace' or new.deleted or new.id <> new.workspace_id then
    return new;
  end if;
  select coalesce(array_agg(distinct e order by e), '{}') into v_editors
  from jsonb_array_elements_text(case when jsonb_typeof(new.data -> 'scheduleSettings' -> 'editors') = 'array' then new.data -> 'scheduleSettings' -> 'editors' else '[]'::jsonb end) e
  where e is not null and e <> '';
  if cardinality(v_editors) > 20 then
    v_editors := v_editors[1:20];
  end if;
  v_tz := nullif(btrim(coalesce(new.data -> 'region' ->> 'timeZone', '')), '');
  v_cur := upper(nullif(btrim(coalesce(new.data -> 'region' ->> 'currency', '')), ''));
  v_loc := nullif(btrim(coalesce(new.data -> 'region' ->> 'locale', '')), '');
  update public.rows_workspaces w
     set schedule_editors = v_editors,
         os_managed = coalesce((new.data ->> 'osManagedDesks')::boolean, false),
         tech_fills_all = coalesce((new.data ->> 'techFillsAll')::boolean, false),
         timezone = case when v_tz is not null and exists (select 1 from pg_timezone_names z where z.name = v_tz) then v_tz
                         when new.data ? 'region' and v_tz is null then 'Asia/Almaty' else w.timezone end,
         currency = case when v_cur ~ '^[A-Z]{3}$' then v_cur
                         when new.data ? 'region' and v_cur is null then 'KZT' else w.currency end,
         locale = case when v_loc ~ '^[a-z]{2,3}(-[A-Z]{2})?$' then v_loc
                       when new.data ? 'region' and v_loc is null then 'ru-KZ' else w.locale end
   where w.workspace_id = new.workspace_id;
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function public.core_docs_workspace_sync() from public, anon, authenticated;

drop trigger if exists core_docs_50_workspace on public.core_docs;
create trigger core_docs_50_workspace
  after insert or update on public.core_docs
  for each row execute function public.core_docs_workspace_sync();

-- ---------------------------------------------------------------------
-- Чтение.
-- ---------------------------------------------------------------------
drop policy if exists core_docs_read on public.core_docs;
create policy core_docs_read on public.core_docs for select to anon, authenticated
  using (
    case kind
      when 'page' then coalesce(public.rows_is_member(workspace_id), false)
      -- Отметка переноса — любому вошедшему: по ней и НЕ участник (заявка на
      -- вход, убранный из команды) узнаёт, где искать свою заявку.
      when 'meta' then public.rows_uid() is not null
      -- Настройки — любому вошедшему, как документ workspace в Firestore
      -- (подсказки ников на странице заявки у постороннего).
      when 'workspace' then public.rows_uid() is not null
      when 'subpage' then
        workspace_id in (select public.rows_read_all_workspaces())
        or (workspace_id, parent_id) in (select r.workspace_id, r.page_id from public.rows_readable_pages() r)
      -- Ростер — участнику; свою запись — всегда (по ней вход решает «участник ли я»).
      when 'member' then coalesce(public.rows_is_member(workspace_id), false) or id = public.rows_uid()
      -- Приглашение — участнику и тому, кому оно адресовано.
      when 'invite' then coalesce(public.rows_is_member(workspace_id), false) or id = public.rows_email()
      -- Заявки — руководству; свою — сам.
      when 'join' then workspace_id in (select public.rows_lead_workspaces()) or id = public.rows_uid()
      else false
    end
  );

-- ---------------------------------------------------------------------
-- Помощники прав участников (копия веток правил members).
-- ---------------------------------------------------------------------
create or replace function public.core_owner_uid(ws text) returns text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce((select w.owner_id from public.rows_workspaces w where w.workspace_id = ws), '')
$$;
revoke all on function public.core_owner_uid(text) from public, anon, authenticated;

create or replace function public.core_extra_ok(d jsonb) returns boolean
language sql immutable
set search_path = public, pg_temp
as $$
  select not (d ? 'extraRoles') or (jsonb_typeof(d -> 'extraRoles') = 'array'
    and not exists (select 1 from jsonb_array_elements_text(d -> 'extraRoles') e where e not in ('manager', 'os')))
$$;
revoke all on function public.core_extra_ok(jsonb) from public, anon, authenticated;

-- Вид ника → ключи списка и полей участника.
create or replace function public.core_nick_meta(p_kind text) returns table (list_key text, label_key text, value_key text)
language sql immutable
set search_path = public, pg_temp
as $$
  select v.list_key, v.label_key, v.value_key from (values
    ('os', 'responsibleOptions', 'osNick', 'osNickValue'),
    ('tech', 'techNickOptions', 'techNick', 'techNickValue'),
    ('other', 'otherNickOptions', 'otherNick', 'otherNickValue')
  ) v(kind, list_key, label_key, value_key) where v.kind = p_kind
$$;
revoke all on function public.core_nick_meta(text) from public, anon, authenticated;

-- Цвета вариантов — как COLOR_PRESETS у клиента.
create or replace function public.core_nick_color(n integer) returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select (array['243 75% 59%', '271 81% 56%', '199 89% 48%', '152 60% 40%', '38 92% 50%', '0 72% 51%', '330 81% 60%', '24 75% 50%', '240 4% 46%'])[(n % 9) + 1]
$$;
revoke all on function public.core_nick_color(integer) from public, anon, authenticated;

-- Как показать участника в ошибке «ник уже закреплён за …».
create or replace function public.core_member_label(d jsonb) returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select coalesce(nullif(d ->> 'nickname', ''), nullif(d ->> 'name', ''), nullif(d ->> 'email', ''), 'участник')
$$;
revoke all on function public.core_member_label(jsonb) from public, anon, authenticated;

-- Предел мест компании (rows_workspaces.seats_limit): живые участники +
-- приглашения по почте, как utils/seats.ts у клиента. null — без предела.
create or replace function public.core_seat_free(ws text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select w.seats_limit is null
        or w.seats_limit > (select count(*) from public.core_docs c
                            where c.workspace_id = ws and c.kind in ('member', 'invite') and c.parent_id = '' and not c.deleted
                              and (c.kind = 'invite' or coalesce(c.data ->> 'status', 'active') <> 'invited'))
    from public.rows_workspaces w where w.workspace_id = ws
  ), true)
$$;
revoke all on function public.core_seat_free(text) from public, anon, authenticated;

-- Управляющие поля документа workspace — в настройках их не бывает.
create or replace function public.core_workspace_control_keys() returns text[]
language sql immutable
set search_path = public, pg_temp
as $$
  select array['id', 'ownerId', 'createdAt', 'rowsBackend', 'rowsMigrationAt', 'sbCollections', 'reloadEpoch', 'companyInvite', 'name', 'icon', 'color']
$$;
revoke all on function public.core_workspace_control_keys() from public, anon, authenticated;

-- Поля настроек, закрытые Тимлиду (правило workspace в firestore.rules).
create or replace function public.core_workspace_owner_keys() returns text[]
language sql immutable
set search_path = public, pg_temp
as $$
  select array['paymentMethods', 'techBonuses', 'osPay', 'scheduleSettings', 'osManagedDesks', 'techFillsAll', 'clientCardOptions', 'orderSound', 'periods', 'region']
$$;
revoke all on function public.core_workspace_owner_keys() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Запись (полная копия 20261029 + участники, приглашения, заявки, настройки).
-- ---------------------------------------------------------------------
create or replace function public.core_write(p_workspace text, p_ops jsonb) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  my_email text := public.rows_email();
  v_member boolean;
  v_owner boolean;
  v_creator boolean;
  v_lead boolean;
  v_role text;
  v_owner_uid text;
  v_writable boolean;
  o jsonb;
  v_kind text;
  v_id text;
  v_parent text;
  v_op text;
  sub record;
  cur public.core_docs%rowtype;
  v_found boolean;
  d jsonb;
  v_new jsonb;
  v_changed text[];
  v_out jsonb := '[]'::jsonb;
  v_rev bigint;
  v_can_edit boolean;
  page_os boolean;
  page_resp text;
  n integer;
  cur_role text;
  new_role text;
  v_self boolean;
begin
  if me is null then
    raise exception 'core_write: нет входа' using errcode = '42501';
  end if;
  if p_ops is null or jsonb_typeof(p_ops) <> 'array' then
    raise exception 'core_write: ожидается массив' using errcode = '22023';
  end if;
  if jsonb_array_length(p_ops) > 500 then
    raise exception 'core_write: не больше 500 записей за раз' using errcode = '22023';
  end if;
  v_member := coalesce(public.rows_is_member(p_workspace), false);
  v_writable := p_workspace in (select public.rows_writable_workspaces());
  v_owner := coalesce(public.rows_is_owner(p_workspace), false);
  v_creator := coalesce(public.rows_is_creator(p_workspace), false);
  v_role := public.rows_member_role(p_workspace);
  v_lead := v_role = 'teamlead';
  v_owner_uid := public.core_owner_uid(p_workspace);

  for o in select * from jsonb_array_elements(p_ops) loop
    v_kind := o ->> 'kind';
    v_id := o ->> 'id';
    v_op := coalesce(o ->> 'op', 'merge');
    v_parent := case when v_kind = 'subpage' then coalesce(o ->> 'page', '') else '' end;
    if v_kind is null or v_kind not in ('page', 'subpage', 'member', 'invite', 'join', 'workspace') then
      raise exception 'core_write: неверный вид %', v_kind using errcode = '22023';
    end if;
    if v_kind = 'invite' then
      if v_id is null or v_id !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' or char_length(v_id) > 200 then
        raise exception 'core_write: неверная почта приглашения' using errcode = '22023';
      end if;
    elsif v_id is null or v_id !~ '^[A-Za-z0-9_.-]+$' or char_length(v_id) > 300 then
      raise exception 'core_write: неверный id' using errcode = '22023';
    end if;
    if v_kind = 'subpage' and (v_parent = '' or v_parent !~ '^[A-Za-z0-9_.-]+$') then
      raise exception 'core_write: у вкладки нет стола' using errcode = '22023';
    end if;
    if v_kind = 'workspace' and v_id <> p_workspace then
      raise exception 'core_write: настройки workspace — только под его id' using errcode = '22023';
    end if;
    if v_op not in ('merge', 'set', 'create', 'delete') then
      raise exception 'core_write: неверная операция' using errcode = '22023';
    end if;
    v_self := v_id = me;
    -- Кто вообще может писать: участник; заявку на вход — и не участник (за себя).
    if not v_member and not (v_kind = 'join' and v_self) then
      raise exception 'core_write: не участник workspace' using errcode = '42501';
    end if;
    -- Живое хранилище и действующая компания; заявка постороннего смотрит только на компанию.
    if v_member and not v_writable then
      raise exception 'core_write: хранилище закрыто (перенос, откат или компания не действует)' using errcode = '42501';
    end if;
    if not v_member and not exists (
      select 1 from public.rows_workspaces w where w.workspace_id = p_workspace and public.nova_tenant_active(w.status, w.trial_until)
    ) then
      raise exception 'core_write: компания не действует' using errcode = '42501';
    end if;

    select * into cur from public.core_docs c
    where c.workspace_id = p_workspace and c.kind = v_kind and c.parent_id = v_parent and c.id = v_id
    for update;
    v_found := found and not cur.deleted;

    -- «create» — завести, если нет; есть — вернуть как есть (вкладка месяца
    -- заводится «один раз» из двух вкладок сразу).
    if v_op = 'create' and v_found then
      v_out := v_out || jsonb_build_array(jsonb_build_object('kind', v_kind, 'id', v_id, 'page', v_parent, 'data', cur.data, 'deleted', false, 'rev', cur.rev));
      continue;
    end if;

    if v_op = 'delete' then
      if not v_found then
        continue;
      end if;
      if v_kind = 'page' then
        if not v_owner then
          raise exception 'core_write: удалить стол может только Owner' using errcode = '42501';
        end if;
        -- Вкладки стола — вместе с ним; они же в ответе, чтобы вкладка,
        -- которая удаляла, убрала их с экрана сразу, а не по следующей дельте.
        for sub in
          update public.core_docs c set deleted = true
          where c.workspace_id = p_workspace and c.kind = 'subpage' and c.parent_id = v_id and not c.deleted
          returning c.id, c.data, c.rev
        loop
          v_out := v_out || jsonb_build_array(jsonb_build_object('kind', 'subpage', 'id', sub.id, 'page', v_id, 'data', sub.data, 'deleted', true, 'rev', sub.rev));
        end loop;
      elsif v_kind = 'subpage' then
        if not (p_workspace in (select public.rows_edit_all_workspaces())
                or (p_workspace, v_parent) in (select e.workspace_id, e.page_id from public.rows_editable_pages() e)) then
          raise exception 'core_write: вкладку удаляет тот, кто правит стол' using errcode = '42501';
        end if;
      elsif v_kind = 'member' then
        cur_role := coalesce(cur.data ->> 'role', '');
        if v_creator then
          null;
        elsif v_owner then
          if cur_role = 'owner' or v_id = v_owner_uid then
            raise exception 'core_write: записи Owner убирает только создатель' using errcode = '42501';
          end if;
        elsif v_lead then
          if cur_role = 'owner' or v_self or v_id = v_owner_uid then
            raise exception 'core_write: Тимлид не убирает Owner и себя' using errcode = '42501';
          end if;
        else
          raise exception 'core_write: участников убирает руководство' using errcode = '42501';
        end if;
      elsif v_kind = 'invite' then
        cur_role := coalesce(cur.data ->> 'role', '');
        if v_creator then
          null;
        elsif v_owner or v_lead then
          if cur_role = 'owner' then
            raise exception 'core_write: приглашение Owner отзывает только создатель' using errcode = '42501';
          end if;
        else
          raise exception 'core_write: приглашения отзывает руководство' using errcode = '42501';
        end if;
      elsif v_kind = 'join' then
        if not (v_self or p_workspace in (select public.rows_lead_workspaces())) then
          raise exception 'core_write: заявку убирает её автор или руководство' using errcode = '42501';
        end if;
      else
        raise exception 'core_write: настройки workspace не удаляются' using errcode = '22023';
      end if;
      update public.core_docs c set deleted = true
      where c.workspace_id = p_workspace and c.kind = v_kind and c.parent_id = v_parent and c.id = v_id
      returning c.rev into v_rev;
      v_out := v_out || jsonb_build_array(jsonb_build_object('kind', v_kind, 'id', v_id, 'page', v_parent, 'data', cur.data, 'deleted', true, 'rev', v_rev));
      continue;
    end if;

    if coalesce(jsonb_typeof(o -> 'data'), '') <> 'object' then
      raise exception 'core_write: нет данных' using errcode = '22023';
    end if;
    if v_op in ('set', 'create') or not v_found then
      d := public.nova_jstrip(o -> 'data');
      v_new := d;
    else
      d := o -> 'data';
      v_new := public.nova_jmerge(cur.data, d);
    end if;
    if pg_column_size(v_new) > 1048576 then
      raise exception 'core_write: документ больше 1 МБ' using errcode = '22023';
    end if;
    v_changed := public.nova_changed_keys(case when v_found then cur.data else '{}'::jsonb end, v_new);

    -- ---------------- стол ----------------
    if v_kind = 'page' then
      if not v_found then
        -- Создание: как allow create у pages.
        if coalesce(v_new ->> 'workspaceId', '') <> p_workspace then
          raise exception 'core_write: стол чужого workspace' using errcode = '42501';
        end if;
        if v_owner then
          null;
        elsif coalesce((v_new ->> 'osDesk')::boolean, false) then
          if not (public.rows_has_role(p_workspace, 'os')
                  and v_id = 'osdesk_' || me
                  and v_new ->> 'createdBy' = me
                  and v_new ->> 'responsibleUserId' = me
                  and coalesce(v_new -> 'allowedUsers', '[]'::jsonb) ? me) then
            raise exception 'core_write: стол ОС заводит его ОС под своим id' using errcode = '42501';
          end if;
        elsif v_role = 'admin' then
          if not (v_new ->> 'responsibleUserId' = me and coalesce(v_new -> 'allowedUsers', '[]'::jsonb) ? me) then
            raise exception 'core_write: Admin заводит стол только за себя' using errcode = '42501';
          end if;
        elsif public.rows_has_role(p_workspace, 'manager') then
          if not (v_new ->> 'createdBy' = me and v_new ->> 'responsibleUserId' = me
                  and coalesce(v_new -> 'allowedUsers', '[]'::jsonb) ? me) then
            raise exception 'core_write: технарь заводит стол только за себя' using errcode = '42501';
          end if;
          -- Квота: один живой стол на технаря (managerPageClaims в Firestore).
          select count(*) into n from public.core_docs c
          where c.workspace_id = p_workspace and c.kind = 'page' and not c.deleted
            and c.data ->> 'createdBy' = me
            and coalesce((c.data ->> 'inactive')::boolean, false) = false
            and coalesce((c.data ->> 'osDesk')::boolean, false) = false;
          if n > 0 then
            raise exception 'core_write: у технаря уже есть стол' using errcode = '42501';
          end if;
        else
          raise exception 'core_write: эта роль столы не заводит' using errcode = '42501';
        end if;
      else
        -- Правка существующего стола.
        page_os := coalesce((cur.data ->> 'osDesk')::boolean, false);
        page_resp := cur.data ->> 'responsibleUserId';
        if v_owner then
          null;
        elsif v_lead then
          if not (v_changed <@ array['allowedUsers', 'editableUsers', 'responsibleUserId', 'hiddenByResponsible', 'personalZoneAllowedUsers', 'inactive', 'inactiveAt', 'inactiveBy', 'updatedAt']::text[]) then
            raise exception 'core_write: Тимлид меняет только доступ и статус стола' using errcode = '42501';
          end if;
          if page_os and 'responsibleUserId' = any(v_changed) then
            raise exception 'core_write: ответственного за стол ОС не переназначают' using errcode = '42501';
          end if;
        elsif page_resp is not null and page_resp = me then
          if v_changed && array['responsibleUserId', 'createdBy', 'workspaceId', 'inactive', 'inactiveAt', 'inactiveBy', 'osDesk', 'techEditable']::text[] then
            raise exception 'core_write: ответственный не меняет опорные поля стола' using errcode = '42501';
          end if;
        elsif v_role = 'admin' then
          if page_os or not ('responsibleUserId' = any(v_changed))
             or not (v_changed <@ array['responsibleUserId', 'allowedUsers', 'hiddenByResponsible', 'updatedAt']::text[]) then
            raise exception 'core_write: Admin только переназначает ответственного' using errcode = '42501';
          end if;
        else
          raise exception 'core_write: нет права править этот стол' using errcode = '42501';
        end if;
      end if;
    -- ---------------- вкладка ----------------
    elsif v_kind = 'subpage' then
      if not exists (select 1 from public.core_docs c where c.workspace_id = p_workspace and c.kind = 'page' and c.id = v_parent and not c.deleted) then
        raise exception 'core_write: стола нет' using errcode = 'P0002';
      end if;
      v_can_edit := p_workspace in (select public.rows_edit_all_workspaces())
        or (p_workspace, v_parent) in (select e.workspace_id, e.page_id from public.rows_editable_pages() e);
      if not v_can_edit then
        raise exception 'core_write: вкладку правит тот, кто правит стол' using errcode = '42501';
      end if;
      if v_found and not v_owner
         and (v_changed && array['pageId', 'workspaceId', 'createdBy', 'personalOwnerUid', 'personalAllowedUsers']::text[]) then
        raise exception 'core_write: опорные поля вкладки меняет Owner' using errcode = '42501';
      end if;
    -- ---------------- участник ----------------
    elsif v_kind = 'member' then
      cur_role := coalesce(cur.data ->> 'role', '');
      new_role := coalesce(v_new ->> 'role', '');
      if new_role <> '' and new_role not in ('owner', 'teamlead', 'admin', 'manager', 'os', 'viewer') then
        raise exception 'core_write: неизвестная роль %', new_role using errcode = '22023';
      end if;
      if coalesce(v_new ->> 'uid', v_id) <> v_id then
        raise exception 'core_write: uid участника не совпадает с id' using errcode = '22023';
      end if;
      if not v_found then
        if new_role = '' then
          raise exception 'core_write: у участника нет роли' using errcode = '22023';
        end if;
        if not public.core_seat_free(p_workspace) then
          raise exception 'core_write: достигнут предел мест — попросите Nova увеличить предел' using errcode = '42501';
        end if;
        if v_creator then
          null;
        elsif v_owner then
          if new_role = 'owner' or v_id = v_owner_uid then
            raise exception 'core_write: роль Owner выдаёт только создатель' using errcode = '42501';
          end if;
        elsif v_lead then
          if new_role = 'owner' or not public.core_extra_ok(v_new) or v_self or v_id = v_owner_uid then
            raise exception 'core_write: Тимлид не заводит Owner и себя' using errcode = '42501';
          end if;
        else
          raise exception 'core_write: участников заводит руководство' using errcode = '42501';
        end if;
      else
        -- Самообслуживание: ник, пульс, режим роли, скрытые столы, фото.
        if v_self and v_changed <@ array['nickname', 'lastActiveAt', 'activeRole', 'hiddenPageIds', 'photoURL']::text[]
           and (not ('activeRole' = any(v_changed)) or v_new ->> 'activeRole' is null
                or (cur_role = 'owner' and v_new ->> 'activeRole' in ('owner', 'teamlead', 'admin', 'manager', 'os', 'viewer'))) then
          null;
        elsif v_creator then
          null;
        elsif v_owner then
          if v_id = v_owner_uid
             or not ((cur_role <> 'owner' and new_role <> 'owner')
                     or (v_self and not (v_changed && array['role', 'status', 'uid', 'email']::text[]))) then
            raise exception 'core_write: записи Owner правит только создатель' using errcode = '42501';
          end if;
        elsif v_lead then
          if cur_role = 'owner' or new_role = 'owner' or not public.core_extra_ok(v_new) or v_id = v_owner_uid
             or (v_self and (v_changed && array['role', 'extraRoles', 'osNick', 'osNickValue', 'techNick', 'techNickValue', 'otherNick', 'otherNickValue', 'status', 'uid', 'email']::text[])) then
            raise exception 'core_write: Тимлид не меняет Owner, свою роль и свои ники' using errcode = '42501';
          end if;
        else
          raise exception 'core_write: участников правит руководство' using errcode = '42501';
        end if;
      end if;
    -- ---------------- приглашение по почте ----------------
    elsif v_kind = 'invite' then
      new_role := coalesce(v_new ->> 'role', '');
      if new_role not in ('owner', 'teamlead', 'admin', 'manager', 'os', 'viewer') then
        raise exception 'core_write: у приглашения нет роли' using errcode = '22023';
      end if;
      if coalesce(v_new ->> 'email', v_id) <> v_id or coalesce(v_new ->> 'status', 'invited') <> 'invited' then
        raise exception 'core_write: приглашение — по этой почте и со статусом invited' using errcode = '22023';
      end if;
      if not v_found and not public.core_seat_free(p_workspace) then
        raise exception 'core_write: достигнут предел мест — попросите Nova увеличить предел' using errcode = '42501';
      end if;
      if v_creator then
        null;
      elsif v_owner then
        if new_role = 'owner' or (v_found and coalesce(cur.data ->> 'role', '') = 'owner') then
          raise exception 'core_write: роль Owner выдаёт только создатель' using errcode = '42501';
        end if;
      elsif v_lead then
        if new_role = 'owner' or (v_found and coalesce(cur.data ->> 'role', '') = 'owner') or not public.core_extra_ok(v_new) then
          raise exception 'core_write: Тимлид не приглашает Owner' using errcode = '42501';
        end if;
      else
        raise exception 'core_write: приглашает руководство' using errcode = '42501';
      end if;
    -- ---------------- заявка на вход ----------------
    elsif v_kind = 'join' then
      if v_found and not v_self and p_workspace in (select public.rows_lead_workspaces()) then
        -- Руководство рассматривает (и может поправить) СУЩЕСТВУЮЩУЮ заявку;
        -- завести заявку за другого нельзя — только от себя.
        null;
      elsif v_self then
        if my_email is null or coalesce(v_new ->> 'email', '') <> my_email or coalesce(v_new ->> 'uid', '') <> me
           or coalesce(v_new ->> 'status', '') <> 'pending' then
          raise exception 'core_write: заявка — от себя, со своей почтой и «pending»' using errcode = '42501';
        end if;
        if exists (select 1 from jsonb_object_keys(v_new) k
                   where k not in ('id', 'uid', 'email', 'name', 'photoURL', 'workspaceId', 'status', 'requestedAt', 'requestedRole', 'requestedNick')) then
          raise exception 'core_write: лишние поля в заявке' using errcode = '22023';
        end if;
        if coalesce(v_new ->> 'requestedRole', 'manager') not in ('manager', 'os')
           or char_length(coalesce(v_new ->> 'requestedNick', '')) > 32 then
          raise exception 'core_write: роль в заявке — Технарь или ОС, ник до 32 знаков' using errcode = '22023';
        end if;
        -- Подать заново можно после отказа, поправить — пока ждёт, после
        -- одобрения — только если человека с тех пор убрали из участников.
        if v_found and not (coalesce(cur.data ->> 'status', '') in ('rejected', 'pending')
                            or (coalesce(cur.data ->> 'status', '') = 'approved' and not v_member)) then
          raise exception 'core_write: заявка уже одобрена' using errcode = '42501';
        end if;
      else
        raise exception 'core_write: чужую заявку не правят' using errcode = '42501';
      end if;
    -- ---------------- настройки workspace ----------------
    else
      if v_changed && public.core_workspace_control_keys() then
        raise exception 'core_write: управляющие поля workspace живут в Firestore' using errcode = '22023';
      end if;
      if v_owner then
        null;
      elsif v_lead then
        if v_changed && public.core_workspace_owner_keys() then
          raise exception 'core_write: эти настройки меняет только Owner' using errcode = '42501';
        end if;
      else
        raise exception 'core_write: настройки меняет руководство' using errcode = '42501';
      end if;
    end if;

    if v_found or (found and cur.deleted) then
      update public.core_docs c set data = v_new, deleted = false
      where c.workspace_id = p_workspace and c.kind = v_kind and c.parent_id = v_parent and c.id = v_id
      returning c.rev into v_rev;
    else
      insert into public.core_docs (workspace_id, kind, parent_id, id, data)
      values (p_workspace, v_kind, v_parent, v_id, v_new)
      returning rev into v_rev;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('kind', v_kind, 'id', v_id, 'page', v_parent, 'data', v_new, 'deleted', false, 'rev', v_rev));
  end loop;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------
-- Приглашения по почте → участник (claimPendingInvites при входе). Ищет
-- приглашения на почту из токена во ВСЕХ workspace; возвращает их id.
-- ---------------------------------------------------------------------
create or replace function public.core_claim_invites(p_name text default null, p_photo text default null, p_nickname text default null) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  my_email text := public.rows_email();
  inv record;
  cur public.core_docs%rowtype;
  v_member jsonb;
  v_out jsonb := '[]'::jsonb;
  now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if me is null or my_email is null then
    return v_out;
  end if;
  for inv in
    select c.workspace_id, c.data from public.core_docs c
    where c.kind = 'invite' and c.parent_id = '' and c.id = my_email and not c.deleted
    for update
  loop
    select * into cur from public.core_docs c
    where c.workspace_id = inv.workspace_id and c.kind = 'member' and c.parent_id = '' and c.id = me;
    if not found or cur.deleted then
      v_member := (inv.data - 'inviteToken')
        || jsonb_build_object('uid', me, 'email', my_email, 'status', 'active', 'joinedAt', now_ms,
             'name', coalesce(nullif(p_name, ''), inv.data ->> 'name', split_part(my_email, '@', 1)),
             'nickname', coalesce(p_nickname, inv.data ->> 'nickname'),
             'photoURL', p_photo);
      -- Ник и вторую роль сам себе не вписать: их выдаёт руководство.
      v_member := v_member - 'osNick' - 'osNickValue' - 'techNick' - 'techNickValue' - 'otherNick' - 'otherNickValue' - 'extraRoles';
      if found then
        update public.core_docs c set data = v_member, deleted = false
        where c.workspace_id = inv.workspace_id and c.kind = 'member' and c.parent_id = '' and c.id = me;
      else
        insert into public.core_docs (workspace_id, kind, parent_id, id, data)
        values (inv.workspace_id, 'member', '', me, v_member);
      end if;
    end if;
    update public.core_docs c set deleted = true
    where c.workspace_id = inv.workspace_id and c.kind = 'invite' and c.parent_id = '' and c.id = my_email;
    v_out := v_out || to_jsonb(inv.workspace_id);
  end loop;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------
-- Ники: список в настройках + поля участника — одной транзакцией.
-- ---------------------------------------------------------------------
-- Внутренний помощник: найти/завести вариант ника в списке (resolveNickOption).
create or replace function public.core_nick_resolve(
  p_options jsonb, p_target jsonb, p_prev_label text, p_prev_value text
) returns jsonb
language plpgsql volatile
set search_path = public, pg_temp
as $$
declare
  v_opts jsonb := case when jsonb_typeof(p_options) = 'array' then p_options else '[]'::jsonb end;
  v_opt jsonb;
  v_nick text;
  v_lower text;
  v_value text;
  v_out jsonb;
  e jsonb;
  n integer := 0;
begin
  if p_target ? 'optionValue' then
    select x into v_opt from jsonb_array_elements(v_opts) x where x ->> 'value' = p_target ->> 'optionValue';
    if v_opt is null then
      raise exception 'Этого ника уже нет в списке' using errcode = 'P0002';
    end if;
  else
    v_nick := left(btrim(coalesce(p_target ->> 'newNick', '')), 32);
    if v_nick = '' then
      raise exception 'Введите ник' using errcode = '22023';
    end if;
    v_lower := lower(v_nick);
    select x into v_opt from jsonb_array_elements(v_opts) x where lower(btrim(x ->> 'label')) = v_lower limit 1;
    if v_opt is null then
      if coalesce(p_prev_value, '') <> '' and lower(btrim(coalesce(p_prev_label, ''))) = v_lower
         and not exists (select 1 from jsonb_array_elements(v_opts) x where x ->> 'value' = p_prev_value) then
        v_value := p_prev_value;
      else
        v_value := 'opt_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 14);
      end if;
      v_opt := jsonb_build_object('value', v_value, 'label', v_nick, 'color', public.core_nick_color(jsonb_array_length(v_opts)));
      return jsonb_build_object('option', v_opt, 'options', v_opts || jsonb_build_array(v_opt), 'changed', true);
    end if;
  end if;
  -- Ник закрепили за живым аккаунтом — он снова в работе: флаг УДАЛЯЕМ.
  if coalesce((v_opt ->> 'inactive')::boolean, false) then
    v_out := '[]'::jsonb;
    for e in select x from jsonb_array_elements(v_opts) x loop
      v_out := v_out || jsonb_build_array(case when e ->> 'value' = v_opt ->> 'value' then e - 'inactive' else e end);
    end loop;
    return jsonb_build_object('option', v_opt - 'inactive', 'options', v_out, 'changed', true);
  end if;
  return jsonb_build_object('option', v_opt, 'options', v_opts, 'changed', false);
end;
$$;
revoke all on function public.core_nick_resolve(jsonb, jsonb, text, text) from public, anon, authenticated;

-- Кто вправе выдавать ники и трогать запись участника p_uid (правила members).
create or replace function public.core_can_manage_member(p_workspace text, p_uid text, p_target_role text) returns boolean
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
begin
  if me is null then return false; end if;
  if coalesce(public.rows_is_creator(p_workspace), false) then return true; end if;
  if coalesce(public.rows_is_owner(p_workspace), false) then
    return p_uid <> public.core_owner_uid(p_workspace) and (coalesce(p_target_role, '') <> 'owner' or p_uid = me);
  end if;
  if coalesce(public.rows_is_teamlead(p_workspace), false) then
    return p_uid <> me and p_uid <> public.core_owner_uid(p_workspace) and coalesce(p_target_role, '') <> 'owner';
  end if;
  return false;
end;
$$;
revoke all on function public.core_can_manage_member(text, text, text) from public, anon, authenticated;

create or replace function public.core_nick_link(p_workspace text, p_uid text, p_kind text, p_target jsonb) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  meta record;
  mem public.core_docs%rowtype;
  ws public.core_docs%rowtype;
  r jsonb;
  v_opt jsonb;
  taken record;
  v_data jsonb;
begin
  select * into meta from public.core_nick_meta(p_kind);
  if not found then
    raise exception 'core_nick_link: вид ника os | tech | other' using errcode = '22023';
  end if;
  if me is null or not coalesce(public.rows_is_member(p_workspace), false)
     or p_workspace not in (select public.rows_writable_workspaces()) then
    raise exception 'core_nick_link: нет доступа' using errcode = '42501';
  end if;
  select * into mem from public.core_docs c
  where c.workspace_id = p_workspace and c.kind = 'member' and c.parent_id = '' and c.id = p_uid for update;
  if not found or mem.deleted then
    raise exception 'Участник не найден' using errcode = 'P0002';
  end if;
  -- Ник выдаёт руководство; Тимлид — не себе и не Owner (правило members).
  if not public.core_can_manage_member(p_workspace, p_uid, mem.data ->> 'role') then
    raise exception 'core_nick_link: ник выдаёт руководство' using errcode = '42501';
  end if;
  if p_target is null or jsonb_typeof(p_target) <> 'object' then
    -- Открепить.
    update public.core_docs c set data = c.data - meta.label_key - meta.value_key
    where c.workspace_id = p_workspace and c.kind = 'member' and c.parent_id = '' and c.id = p_uid;
    return null;
  end if;
  select * into ws from public.core_docs c
  where c.workspace_id = p_workspace and c.kind = 'workspace' and c.parent_id = '' and c.id = p_workspace for update;
  r := public.core_nick_resolve(
    case when found and not ws.deleted then ws.data -> meta.list_key else '[]'::jsonb end,
    p_target, mem.data ->> meta.label_key, mem.data ->> meta.value_key);
  v_opt := r -> 'option';
  -- Ник уже у другого живого участника — отказ (по сути правила уникальности у клиента).
  select c.data into taken from public.core_docs c
  where c.workspace_id = p_workspace and c.kind = 'member' and c.parent_id = '' and not c.deleted
    and c.id <> p_uid and c.data ->> meta.value_key = v_opt ->> 'value'
  limit 1;
  if found then
    raise exception 'Ник «%» уже закреплён за %', v_opt ->> 'label', public.core_member_label(taken.data) using errcode = '23505';
  end if;
  if (r ->> 'changed')::boolean then
    if ws.workspace_id is null or ws.deleted then
      insert into public.core_docs (workspace_id, kind, parent_id, id, data)
      values (p_workspace, 'workspace', '', p_workspace, jsonb_build_object(meta.list_key, r -> 'options'))
      on conflict (workspace_id, kind, parent_id, id) do update
        set data = public.core_docs.data || jsonb_build_object(meta.list_key, r -> 'options'), deleted = false;
    else
      update public.core_docs c set data = c.data || jsonb_build_object(meta.list_key, r -> 'options')
      where c.workspace_id = p_workspace and c.kind = 'workspace' and c.parent_id = '' and c.id = p_workspace;
    end if;
  end if;
  v_data := mem.data || jsonb_build_object(meta.label_key, v_opt ->> 'label', meta.value_key, v_opt ->> 'value');
  update public.core_docs c set data = v_data
  where c.workspace_id = p_workspace and c.kind = 'member' and c.parent_id = '' and c.id = p_uid;
  return jsonb_build_object('value', v_opt ->> 'value', 'label', v_opt ->> 'label');
end;
$$;

create or replace function public.core_nick_add(p_workspace text, p_kind text, p_label text) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  meta record;
  ws public.core_docs%rowtype;
  v_opts jsonb;
  v_label text := left(btrim(coalesce(p_label, '')), 32);
  v_opt jsonb;
begin
  select * into meta from public.core_nick_meta(p_kind);
  if not found then
    raise exception 'core_nick_add: вид ника os | tech | other' using errcode = '22023';
  end if;
  if public.rows_uid() is null or not (coalesce(public.rows_is_owner(p_workspace), false) or coalesce(public.rows_is_teamlead(p_workspace), false))
     or p_workspace not in (select public.rows_writable_workspaces()) then
    raise exception 'core_nick_add: ники заводит руководство' using errcode = '42501';
  end if;
  if v_label = '' then
    raise exception 'Введите ник' using errcode = '22023';
  end if;
  select * into ws from public.core_docs c
  where c.workspace_id = p_workspace and c.kind = 'workspace' and c.parent_id = '' and c.id = p_workspace for update;
  v_opts := case when found and not ws.deleted and jsonb_typeof(ws.data -> meta.list_key) = 'array' then ws.data -> meta.list_key else '[]'::jsonb end;
  if exists (select 1 from jsonb_array_elements(v_opts) x where lower(btrim(x ->> 'label')) = lower(v_label)) then
    raise exception 'Ник «%» уже есть в списке', v_label using errcode = '23505';
  end if;
  v_opt := jsonb_build_object('value', 'opt_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 14), 'label', v_label, 'color', public.core_nick_color(jsonb_array_length(v_opts)));
  insert into public.core_docs (workspace_id, kind, parent_id, id, data)
  values (p_workspace, 'workspace', '', p_workspace, jsonb_build_object(meta.list_key, v_opts || jsonb_build_array(v_opt)))
  on conflict (workspace_id, kind, parent_id, id) do update
    set data = public.core_docs.data || jsonb_build_object(meta.list_key, v_opts || jsonb_build_array(v_opt)), deleted = false;
  return v_opt;
end;
$$;

create or replace function public.core_nick_inactive(p_workspace text, p_kind text, p_value text, p_inactive boolean) returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  meta record;
  ws public.core_docs%rowtype;
  v_opts jsonb;
  v_out jsonb := '[]'::jsonb;
  e jsonb;
  v_hit boolean := false;
begin
  select * into meta from public.core_nick_meta(p_kind);
  if not found then
    raise exception 'core_nick_inactive: вид ника os | tech | other' using errcode = '22023';
  end if;
  if public.rows_uid() is null or not (coalesce(public.rows_is_owner(p_workspace), false) or coalesce(public.rows_is_teamlead(p_workspace), false))
     or p_workspace not in (select public.rows_writable_workspaces()) then
    raise exception 'core_nick_inactive: ники ведёт руководство' using errcode = '42501';
  end if;
  select * into ws from public.core_docs c
  where c.workspace_id = p_workspace and c.kind = 'workspace' and c.parent_id = '' and c.id = p_workspace for update;
  v_opts := case when found and not ws.deleted and jsonb_typeof(ws.data -> meta.list_key) = 'array' then ws.data -> meta.list_key else '[]'::jsonb end;
  for e in select x from jsonb_array_elements(v_opts) x loop
    if e ->> 'value' = p_value then
      v_hit := true;
      v_out := v_out || jsonb_build_array(case when p_inactive then e || '{"inactive": true}'::jsonb else e - 'inactive' end);
    else
      v_out := v_out || jsonb_build_array(e);
    end if;
  end loop;
  if not v_hit then
    raise exception 'Этого ника уже нет в списке' using errcode = 'P0002';
  end if;
  update public.core_docs c set data = c.data || jsonb_build_object(meta.list_key, v_out)
  where c.workspace_id = p_workspace and c.kind = 'workspace' and c.parent_id = '' and c.id = p_workspace;
end;
$$;

-- ---------------------------------------------------------------------
-- Одобрить заявку: участник (с ником, если положен) + список ников +
-- приглашение по почте гасится + заявка «approved» — одной транзакцией.
-- ---------------------------------------------------------------------
create or replace function public.core_approve_join(p_workspace text, p_uid text, p_role text, p_nick jsonb default null) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  req public.core_docs%rowtype;
  ws public.core_docs%rowtype;
  v_kind text;
  meta record;
  r jsonb;
  v_opt jsonb;
  taken record;
  v_member jsonb;
  v_email text;
  now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_label text := null;
begin
  if me is null or p_workspace not in (select public.rows_lead_workspaces())
     or p_workspace not in (select public.rows_writable_workspaces()) then
    raise exception 'core_approve_join: заявки рассматривает руководство' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('teamlead', 'admin', 'manager', 'os', 'viewer') then
    raise exception 'core_approve_join: роль через заявку — не Owner' using errcode = '22023';
  end if;
  select * into req from public.core_docs c
  where c.workspace_id = p_workspace and c.kind = 'join' and c.parent_id = '' and c.id = p_uid for update;
  if not found or req.deleted or coalesce(req.data ->> 'status', '') <> 'pending' then
    raise exception 'Эту заявку уже рассмотрели — обновите страницу' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.core_docs c where c.workspace_id = p_workspace and c.kind = 'member' and c.parent_id = '' and c.id = p_uid and not c.deleted) then
    raise exception '% уже состоит в этом workspace. Обновите список участников.', coalesce(req.data ->> 'name', p_uid) using errcode = '23505';
  end if;
  if not public.core_seat_free(p_workspace) then
    raise exception 'Достигнут предел мест — попросите Nova увеличить предел' using errcode = '42501';
  end if;
  v_email := lower(coalesce(req.data ->> 'email', ''));
  v_member := jsonb_build_object(
    'uid', p_uid, 'email', v_email, 'name', coalesce(req.data ->> 'name', ''), 'photoURL', req.data -> 'photoURL',
    'role', p_role, 'status', 'active', 'invitedAt', coalesce((req.data ->> 'requestedAt')::bigint, now_ms),
    'invitedBy', me, 'joinedAt', now_ms);
  v_kind := case p_role when 'manager' then 'tech' when 'os' then 'os' else 'other' end;
  if p_nick is not null and jsonb_typeof(p_nick) = 'object' then
    select * into meta from public.core_nick_meta(v_kind);
    select * into ws from public.core_docs c
    where c.workspace_id = p_workspace and c.kind = 'workspace' and c.parent_id = '' and c.id = p_workspace for update;
    r := public.core_nick_resolve(case when found and not ws.deleted then ws.data -> meta.list_key else '[]'::jsonb end, p_nick, null, null);
    v_opt := r -> 'option';
    select c.data into taken from public.core_docs c
    where c.workspace_id = p_workspace and c.kind = 'member' and c.parent_id = '' and not c.deleted
      and c.id <> p_uid and c.data ->> meta.value_key = v_opt ->> 'value' limit 1;
    if found then
      raise exception 'Ник «%» уже закреплён за %', v_opt ->> 'label', public.core_member_label(taken.data) using errcode = '23505';
    end if;
    if (r ->> 'changed')::boolean then
      insert into public.core_docs (workspace_id, kind, parent_id, id, data)
      values (p_workspace, 'workspace', '', p_workspace, jsonb_build_object(meta.list_key, r -> 'options'))
      on conflict (workspace_id, kind, parent_id, id) do update
        set data = public.core_docs.data || jsonb_build_object(meta.list_key, r -> 'options'), deleted = false;
    end if;
    v_member := v_member || jsonb_build_object(meta.label_key, v_opt ->> 'label', meta.value_key, v_opt ->> 'value');
    v_label := v_opt ->> 'label';
  end if;
  insert into public.core_docs (workspace_id, kind, parent_id, id, data)
  values (p_workspace, 'member', '', p_uid, v_member)
  on conflict (workspace_id, kind, parent_id, id) do update set data = excluded.data, deleted = false;
  -- Приглашение по почте на того же человека теряет смысл — он уже внутри.
  if v_email <> '' then
    update public.core_docs c set deleted = true
    where c.workspace_id = p_workspace and c.kind = 'invite' and c.parent_id = '' and c.id = v_email and not c.deleted;
  end if;
  update public.core_docs c
     set data = c.data || jsonb_build_object('status', 'approved', 'approvedRole', p_role, 'approvedNick', v_label, 'resolvedAt', now_ms, 'resolvedBy', me)
   where c.workspace_id = p_workspace and c.kind = 'join' and c.parent_id = '' and c.id = p_uid;
  return jsonb_build_object('nickLabel', v_label);
end;
$$;

-- ---------------------------------------------------------------------
-- Полное удаление человека (только Owner): участник, приглашение по почте,
-- все заявки с этим uid и адресом. Наблюдателя чистит клиент (Firestore).
-- ---------------------------------------------------------------------
create or replace function public.core_member_purge(p_workspace text, p_uid text, p_email text) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  n_member integer := 0;
  n_invite integer := 0;
  n_join integer := 0;
  n_email integer := 0;
begin
  if public.rows_uid() is null or not coalesce(public.rows_is_owner(p_workspace), false) then
    raise exception 'core_member_purge: только Owner' using errcode = '42501';
  end if;
  if coalesce(p_uid, '') = '' and v_email = '' then
    raise exception 'У записи нет ни аккаунта, ни адреса — удалять нечего' using errcode = '22023';
  end if;
  if coalesce(p_uid, '') <> '' then
    if exists (select 1 from public.core_docs c where c.workspace_id = p_workspace and c.kind = 'member' and c.id = p_uid and not c.deleted
                 and (coalesce(c.data ->> 'role', '') = 'owner' or c.id = public.core_owner_uid(p_workspace))
                 and not coalesce(public.rows_is_creator(p_workspace), false)) then
      raise exception 'core_member_purge: записи Owner убирает только создатель' using errcode = '42501';
    end if;
    update public.core_docs c set deleted = true
    where c.workspace_id = p_workspace and c.kind = 'member' and c.parent_id = '' and c.id = p_uid and not c.deleted;
    get diagnostics n_member = row_count;
    update public.core_docs c set deleted = true
    where c.workspace_id = p_workspace and c.kind = 'join' and c.parent_id = '' and c.id = p_uid and not c.deleted;
    get diagnostics n_join = row_count;
  end if;
  if v_email <> '' then
    update public.core_docs c set deleted = true
    where c.workspace_id = p_workspace and c.kind = 'invite' and c.parent_id = '' and c.id = v_email and not c.deleted;
    get diagnostics n_invite = row_count;
    update public.core_docs c set deleted = true
    where c.workspace_id = p_workspace and c.kind = 'join' and c.parent_id = '' and not c.deleted
      and lower(coalesce(c.data ->> 'email', '')) = v_email;
    get diagnostics n_email = row_count;
    n_join := n_join + n_email;
  end if;
  return jsonb_build_object('member', n_member > 0, 'invite', n_invite > 0, 'joinRequests', n_join);
end;
$$;

-- ---------------------------------------------------------------------
-- Разовое: «Заморозка» в общий список статусов (ensureFreezeStatus).
-- ---------------------------------------------------------------------
create or replace function public.core_seed_status(p_workspace text, p_option jsonb) returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  ws public.core_docs%rowtype;
  v_opts jsonb;
  v_data jsonb;
begin
  if public.rows_uid() is null or not coalesce(public.rows_is_owner(p_workspace), false)
     or p_workspace not in (select public.rows_writable_workspaces()) then
    raise exception 'core_seed_status: только Owner' using errcode = '42501';
  end if;
  if p_option is null or jsonb_typeof(p_option) <> 'object' or coalesce(p_option ->> 'value', '') = '' or coalesce(p_option ->> 'label', '') = '' then
    raise exception 'core_seed_status: нужен вариант {value, label, color}' using errcode = '22023';
  end if;
  select * into ws from public.core_docs c
  where c.workspace_id = p_workspace and c.kind = 'workspace' and c.parent_id = '' and c.id = p_workspace for update;
  if found and not ws.deleted and coalesce((ws.data ->> 'freezeStatusSeeded')::boolean, false) then
    return false;
  end if;
  v_opts := case when found and not ws.deleted and jsonb_typeof(ws.data -> 'statusOptions') = 'array' then ws.data -> 'statusOptions' else null end;
  v_data := jsonb_build_object('freezeStatusSeeded', true);
  -- Нет своего списка — статусы по умолчанию клиента (там «Заморозка» уже есть).
  if v_opts is not null and not exists (
    select 1 from jsonb_array_elements(v_opts) x
    where x ->> 'value' = p_option ->> 'value' or lower(coalesce(x ->> 'label', '')) like '%замороз%'
  ) then
    v_data := v_data || jsonb_build_object('statusOptions', v_opts || jsonb_build_array(p_option));
  end if;
  insert into public.core_docs (workspace_id, kind, parent_id, id, data)
  values (p_workspace, 'workspace', '', p_workspace, v_data)
  on conflict (workspace_id, kind, parent_id, id) do update
    set data = public.core_docs.data || v_data, deleted = false;
  return true;
end;
$$;

-- ---------------------------------------------------------------------
-- Перенос (полная копия 20261029 + новые виды). Только Owner. Новое ложится;
-- существующее заменяется только более свежим по updatedAt (у участников,
-- приглашений и заявок его нет — их второй раз не трогаем); удалённый в
-- Supabase не воскрешается.
-- ---------------------------------------------------------------------
create or replace function public.core_import(p_workspace text, p_docs jsonb, p_mark text, p_done boolean) returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  v_creator boolean;
  v_owner_uid text;
  o jsonb;
  v_kind text;
  v_id text;
  v_parent text;
  d jsonb;
  cur public.core_docs%rowtype;
  n integer := 0;
begin
  if me is null or not coalesce(public.rows_is_owner(p_workspace), false) then
    raise exception 'core_import: только Owner' using errcode = '42501';
  end if;
  v_creator := coalesce(public.rows_is_creator(p_workspace), false);
  v_owner_uid := public.core_owner_uid(p_workspace);
  if p_mark is null or p_mark !~ '^imported_[a-z]+$' then
    raise exception 'core_import: неверная отметка' using errcode = '22023';
  end if;
  for o in select * from jsonb_array_elements(coalesce(p_docs, '[]'::jsonb)) loop
    v_kind := o ->> 'kind';
    v_id := o ->> 'id';
    v_parent := case when v_kind = 'subpage' then coalesce(o ->> 'page', '') else '' end;
    d := o -> 'data';
    if v_kind not in ('page', 'subpage', 'member', 'invite', 'join', 'workspace') or v_id is null or coalesce(jsonb_typeof(d), '') <> 'object' then
      continue;
    end if;
    if v_kind = 'invite' then
      v_id := lower(btrim(v_id));
      if v_id !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' then
        continue;
      end if;
    elsif v_id !~ '^[A-Za-z0-9_.-]+$' then
      continue;
    end if;
    if v_kind = 'subpage' and v_parent = '' then
      continue;
    end if;
    if v_kind = 'workspace' and v_id <> p_workspace then
      continue;
    end if;
    if v_kind = 'workspace' then
      d := d - public.core_workspace_control_keys();
    end if;
    -- Выданный (не создатель) Owner записи Owner не переносит: ни роль owner,
    -- ни запись создателя (правило members: Owner выдаёт только создатель).
    if v_kind in ('member', 'invite') and not v_creator
       and (coalesce(d ->> 'role', '') = 'owner' or v_id = v_owner_uid) then
      continue;
    end if;
    select * into cur from public.core_docs c
    where c.workspace_id = p_workspace and c.kind = v_kind and c.parent_id = v_parent and c.id = v_id;
    if found then
      if cur.deleted then
        continue;
      end if;
      -- Участники, приглашения, заявки и настройки переносятся один раз: после
      -- переноса правда — здесь, и подделанный updatedAt ничего не перепишет.
      if v_kind in ('member', 'invite', 'join', 'workspace') then
        continue;
      end if;
      if coalesce((d ->> 'updatedAt')::numeric, 0) > coalesce((cur.data ->> 'updatedAt')::numeric, 0) then
        update public.core_docs c set data = d
        where c.workspace_id = p_workspace and c.kind = v_kind and c.parent_id = v_parent and c.id = v_id;
        n := n + 1;
      end if;
    else
      insert into public.core_docs (workspace_id, kind, parent_id, id, data) values (p_workspace, v_kind, v_parent, v_id, d);
      n := n + 1;
    end if;
  end loop;
  -- Отметка: `at` — когда перенос сделан (не меняется), `tailAt` — последняя
  -- дочитка (трое суток после переноса сессия Owner дочитывает правки
  -- вкладок на старом коде).
  if p_done then
    insert into public.core_docs (workspace_id, kind, parent_id, id, data)
    values (p_workspace, 'meta', '', p_mark,
      jsonb_build_object('at', (extract(epoch from now()) * 1000)::bigint, 'tailAt', (extract(epoch from now()) * 1000)::bigint, 'by', me))
    on conflict (workspace_id, kind, parent_id, id) do update
      set data = public.core_docs.data || jsonb_build_object('tailAt', (extract(epoch from now()) * 1000)::bigint), deleted = false;
  end if;
  return n;
end;
$$;

revoke all on function public.core_write(text, jsonb) from public;
revoke all on function public.core_import(text, jsonb, text, boolean) from public;
revoke all on function public.core_claim_invites(text, text, text) from public;
revoke all on function public.core_nick_link(text, text, text, jsonb) from public;
revoke all on function public.core_nick_add(text, text, text) from public;
revoke all on function public.core_nick_inactive(text, text, text, boolean) from public;
revoke all on function public.core_approve_join(text, text, text, jsonb) from public;
revoke all on function public.core_member_purge(text, text, text) from public;
revoke all on function public.core_seed_status(text, jsonb) from public;
grant execute on function public.core_write(text, jsonb) to anon, authenticated;
grant execute on function public.core_import(text, jsonb, text, boolean) to anon, authenticated;
grant execute on function public.core_claim_invites(text, text, text) to anon, authenticated;
grant execute on function public.core_nick_link(text, text, text, jsonb) to anon, authenticated;
grant execute on function public.core_nick_add(text, text, text) to anon, authenticated;
grant execute on function public.core_nick_inactive(text, text, text, boolean) to anon, authenticated;
grant execute on function public.core_approve_join(text, text, text, jsonb) to anon, authenticated;
grant execute on function public.core_member_purge(text, text, text) to anon, authenticated;
grant execute on function public.core_seed_status(text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Версия схемы.
-- ---------------------------------------------------------------------
create or replace function public.nova_schema_version() returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select '20261030'
$$;
revoke all on function public.nova_schema_version() from public, anon, authenticated;
grant execute on function public.nova_schema_version() to anon, authenticated;
