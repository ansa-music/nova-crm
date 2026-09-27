-- =====================================================================
-- «Тимлид+» и «Общая таблица» заказов (27.09.2026, просьба Nurba).
--
-- 1. Роль leadplus («Тимлид+»): всё, что умеет Тимлид (люди, заявки, роли,
--    доступы, настройки), и сверх того ЧИТАЕТ и ПРАВИТ строки всех столов
--    без второй роли «Технарь». Структуру чужого стола (столбцы, имя) не
--    правит — только данные и поля месячной вкладки (чтобы положить лид в
--    стол ОС). Личные зоны чужих столов закрыты. Роль выдаёт и снимает
--    только Owner; Тимлид записи Тимлид+ не трогает.
-- 2. История заказа — order_events: AFTER-триггер на desk_rows пишет, кто и
--    когда завёл заказ, сменил статус, технаря, сумму, выдал, перенёс в
--    новый период, удалил. Ключ заказа — id строки-источника (у копии у
--    технаря это src_row_id), поэтому переезды истории не рвут.
-- 3. Общая таблица — lead_board / lead_board_head (строки текущих вкладок
--    всех столов ОС и технарей одним запросом, дельта по rev и голова) и
--    lead_move_os (переназначить заказ другому ОС вместе с копией у технаря).
--
-- core_write и core_docs_member_sync — ПОЛНЫЕ КОПИИ из 20261030 с веткой
-- leadplus: правки этих функций — только здесь или в файле новее.
-- Файл повторяемый.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Роль в копии прав.
-- ---------------------------------------------------------------------
alter table public.rows_members drop constraint if exists rows_members_role_check;
alter table public.rows_members add constraint rows_members_role_check
  check (role in ('owner', 'teamlead', 'leadplus', 'admin', 'manager', 'os', 'viewer'));

-- Тимлид+ — во всём «Тимлид» (люди, заказы, график, объявления, Грок).
create or replace function public.rows_is_teamlead(ws text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.rows_member_role(ws) in ('teamlead', 'leadplus'), false)
$$;

create or replace function public.rows_is_leadplus(ws text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.rows_member_role(ws) = 'leadplus', false)
$$;
revoke all on function public.rows_is_leadplus(text) from public;
grant execute on function public.rows_is_leadplus(text) to anon, authenticated;

-- Руководство (hasFullAccess): Owner, Тимлид, Тимлид+.
create or replace function public.rows_lead_workspaces() returns setof text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select w from public.rows_owned_workspaces() w
  union
  select m.workspace_id from public.rows_members m
  where m.uid = public.rows_uid() and m.role in ('teamlead', 'leadplus')
$$;

-- Все столы на чтение: + Тимлид+.
create or replace function public.rows_read_all_workspaces() returns setof text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select m.workspace_id from public.rows_members m
  where m.uid = public.rows_uid()
    and (
      m.role = 'owner'
      or exists (select 1 from public.rows_workspaces w where w.workspace_id = m.workspace_id and w.owner_id = m.uid)
      -- Тимлид+ — все столы без второй роли.
      or m.role = 'leadplus'
      -- Тимлид + Технарь: чужие столы на чтение.
      or (m.role = 'teamlead' and 'manager' = any (m.extra_roles))
      -- ОС (основной или второй ролью): все столы на чтение по умолчанию.
      or m.role = 'os' or 'os' = any (m.extra_roles)
      -- Наблюдатель — ДО isDeskBlocked: право выдано человеку, а не роли.
      or exists (select 1 from public.rows_desk_observers o where o.workspace_id = m.workspace_id and o.uid = m.uid)
    )
$$;

-- «Правит все строки»: Owner и Тимлид+. Через этот набор роль проходит
-- политики desk_rows, стражи desk_rows_guard / desk_rows_os_managed_guard,
-- RESTRICTIVE-удаление, счётчики и вкладки в core_write.
create or replace function public.rows_edit_all_workspaces() returns setof text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select m.workspace_id from public.rows_members m
  where m.uid = public.rows_uid()
    and (m.role in ('owner', 'leadplus')
      or exists (select 1 from public.rows_workspaces w where w.workspace_id = m.workspace_id and w.owner_id = m.uid))
$$;

-- Прежнее «правит всё» — только Owner. Им закрыты личные зоны.
create or replace function public.rows_owner_all_workspaces() returns setof text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select m.workspace_id from public.rows_members m
  where m.uid = public.rows_uid()
    and (m.role = 'owner'
      or exists (select 1 from public.rows_workspaces w where w.workspace_id = m.workspace_id and w.owner_id = m.uid))
$$;
revoke all on function public.rows_owner_all_workspaces() from public;
grant execute on function public.rows_owner_all_workspaces() to anon, authenticated;

-- Личная зона чужого стола Тимлиду+ закрыта (как canUsePersonalZone).
create or replace function public.rows_personal_ok(ws text, p_page text, p_zone text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.rows_uid() is not null and (
    ws in (select public.rows_owner_all_workspaces())
    or (p_zone = public.rows_uid()
      and exists (select 1 from public.rows_my_personal_pages() p where p.workspace_id = ws and p.page_id = p_page)))
$$;

drop policy if exists personal_docs_read on public.personal_docs;
create policy personal_docs_read on public.personal_docs for select to anon, authenticated
  using (
    workspace_id in (select public.rows_owner_all_workspaces())
    or (zone_uid = (select public.rows_uid())
      and (workspace_id, page_id) in (select p.workspace_id, p.page_id from public.rows_my_personal_pages() p))
  );

-- Записи участников в копии: Тимлид (и Тимлид+) не трогает Owner и Тимлид+.
drop policy if exists rows_members_teamlead_insert on public.rows_members;
create policy rows_members_teamlead_insert on public.rows_members for insert to anon, authenticated
  with check (
    public.rows_is_teamlead(workspace_id)
    and role not in ('owner', 'leadplus')
    and uid <> public.rows_uid()
    and uid <> coalesce((select w.owner_id from public.rows_workspaces w where w.workspace_id = rows_members.workspace_id), '')
  );

drop policy if exists rows_members_teamlead_update on public.rows_members;
create policy rows_members_teamlead_update on public.rows_members for update to anon, authenticated
  using (
    public.rows_is_teamlead(workspace_id)
    and role not in ('owner', 'leadplus')
    and uid <> public.rows_uid()
    and uid <> coalesce((select w.owner_id from public.rows_workspaces w where w.workspace_id = rows_members.workspace_id), '')
  )
  with check (
    public.rows_is_teamlead(workspace_id)
    and role not in ('owner', 'leadplus')
    and uid <> public.rows_uid()
    and uid <> coalesce((select w.owner_id from public.rows_workspaces w where w.workspace_id = rows_members.workspace_id), '')
  );

drop policy if exists rows_members_teamlead_delete on public.rows_members;
create policy rows_members_teamlead_delete on public.rows_members for delete to anon, authenticated
  using (
    public.rows_is_teamlead(workspace_id)
    and role not in ('owner', 'leadplus')
    and uid <> public.rows_uid()
    and uid <> coalesce((select w.owner_id from public.rows_workspaces w where w.workspace_id = rows_members.workspace_id), '')
  );

-- Ник и запись участника: Тимлид не трогает Owner и Тимлид+.
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
    return p_uid <> me and p_uid <> public.core_owner_uid(p_workspace) and coalesce(p_target_role, '') not in ('owner', 'leadplus');
  end if;
  return false;
end;
$$;
revoke all on function public.core_can_manage_member(text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Копия прав rows_members по документу участника (копия из 20261030 +
-- leadplus в списке ролей).
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
  if v_role is null or v_role not in ('owner', 'teamlead', 'leadplus', 'admin', 'manager', 'os', 'viewer') then
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

-- ---------------------------------------------------------------------
-- core_write (полная копия из 20261030 + ветки Тимлид+).
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
  v_leadplus boolean;
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
  v_lead := v_role in ('teamlead', 'leadplus');
  v_leadplus := v_role = 'leadplus';
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
          if cur_role in ('owner', 'leadplus') or v_self or v_id = v_owner_uid then
            raise exception 'core_write: Тимлид не убирает Owner, Тимлид+ и себя' using errcode = '42501';
          end if;
        else
          raise exception 'core_write: участников убирает руководство' using errcode = '42501';
        end if;
      elsif v_kind = 'invite' then
        cur_role := coalesce(cur.data ->> 'role', '');
        if v_creator then
          null;
        elsif v_owner or v_lead then
          if cur_role = 'owner' or (not v_owner and cur_role = 'leadplus') then
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
          if not ((public.rows_has_role(p_workspace, 'os')
                   and v_id = 'osdesk_' || me
                   and v_new ->> 'createdBy' = me
                   and v_new ->> 'responsibleUserId' = me
                   and coalesce(v_new -> 'allowedUsers', '[]'::jsonb) ? me)
                  -- Тимлид+ заводит стол ОС участнику с ролью ОС (лид на его стол).
                  or (v_leadplus
                   and v_id = 'osdesk_' || coalesce(v_new ->> 'responsibleUserId', '')
                   and v_new ->> 'createdBy' = v_new ->> 'responsibleUserId'
                   and coalesce(v_new -> 'allowedUsers', '[]'::jsonb) ? (v_new ->> 'responsibleUserId')
                   and exists (select 1 from public.rows_members m
                               where m.workspace_id = p_workspace and m.uid = v_new ->> 'responsibleUserId'
                                 and (m.role = 'os' or 'os' = any (m.extra_roles))))) then
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
        elsif v_lead and not (page_resp is not null and page_resp = me) then
          if not (v_changed <@ (array['allowedUsers', 'editableUsers', 'responsibleUserId', 'hiddenByResponsible', 'personalZoneAllowedUsers', 'inactive', 'inactiveAt', 'inactiveBy', 'updatedAt']::text[]
                  -- Тимлид+ ещё заводит месячную вкладку чужого стола (лид в стол ОС).
                  || case when v_leadplus then array['autoMonthKey', 'autoMonthSubPageId', 'defaultSubPageId', 'mainTabName', 'mainTabMonthKey']::text[] else '{}'::text[] end)) then
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
      if new_role <> '' and new_role not in ('owner', 'teamlead', 'leadplus', 'admin', 'manager', 'os', 'viewer') then
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
          if new_role in ('owner', 'leadplus') or not public.core_extra_ok(v_new) or v_self or v_id = v_owner_uid then
            raise exception 'core_write: Тимлид не заводит Owner, Тимлид+ и себя' using errcode = '42501';
          end if;
        else
          raise exception 'core_write: участников заводит руководство' using errcode = '42501';
        end if;
      else
        -- Самообслуживание: ник, пульс, режим роли, скрытые столы, фото.
        if v_self and v_changed <@ array['nickname', 'lastActiveAt', 'activeRole', 'hiddenPageIds', 'photoURL']::text[]
           and (not ('activeRole' = any(v_changed)) or v_new ->> 'activeRole' is null
                or (cur_role = 'owner' and v_new ->> 'activeRole' in ('owner', 'teamlead', 'leadplus', 'admin', 'manager', 'os', 'viewer'))) then
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
          if cur_role in ('owner', 'leadplus') or new_role in ('owner', 'leadplus') or not public.core_extra_ok(v_new) or v_id = v_owner_uid
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
      if new_role not in ('owner', 'teamlead', 'leadplus', 'admin', 'manager', 'os', 'viewer') then
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
        if new_role in ('owner', 'leadplus') or (v_found and coalesce(cur.data ->> 'role', '') in ('owner', 'leadplus')) or not public.core_extra_ok(v_new) then
          raise exception 'core_write: Тимлид не приглашает Owner и Тимлид+' using errcode = '42501';
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
-- История заказов.
-- ---------------------------------------------------------------------
create table if not exists public.order_events (
  workspace_id text not null references public.rows_workspaces (workspace_id) on delete cascade,
  id bigint generated always as identity,
  order_key text not null,
  page_id text not null,
  tab_id text not null default '',
  row_id text not null,
  kind text not null check (kind in ('created', 'status', 'tech', 'issued', 'unissued', 'amount', 'carried', 'deleted', 'os')),
  field text,
  old_value text,
  new_value text,
  actor_uid text,
  at bigint not null,
  primary key (workspace_id, id)
);
create index if not exists order_events_key on public.order_events (workspace_id, order_key, id);
create index if not exists order_events_recent on public.order_events (workspace_id, id desc);

alter table public.order_events enable row level security;
revoke all on public.order_events from public, anon, authenticated;
grant select on public.order_events to anon, authenticated;

drop policy if exists order_events_read on public.order_events;
create policy order_events_read on public.order_events for select to anon, authenticated
  using (workspace_id in (select public.rows_lead_workspaces()));

-- Пустая строка (слот): ни одной заполненной ячейки.
create or replace function public.desk_cells_blank(c jsonb) returns boolean
language sql immutable
set search_path = public, pg_temp
as $$
  select not exists (
    select 1 from jsonb_each(coalesce(c, '{}'::jsonb)) e
    where case jsonb_typeof(e.value)
      when 'string' then btrim(e.value #>> '{}') <> ''
      when 'number' then true
      when 'boolean' then e.value = 'true'::jsonb
      when 'array' then jsonb_array_length(e.value) > 0
      when 'object' then e.value <> '{}'::jsonb
      else false
    end
  )
$$;
revoke all on function public.desk_cells_blank(jsonb) from public;
grant execute on function public.desk_cells_blank(jsonb) to anon, authenticated;

create or replace function public.desk_rows_events() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.desk_rows%rowtype;
  v_key text;
  v_copy boolean;
  v_os boolean;
  v_actor text := public.rows_uid();
  v_at bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  o_blank boolean;
  n_blank boolean;
  o_st text;
  n_st text;
  f text;
begin
  -- Переезд к другому ОС пишет своё одно событие сам.
  if coalesce(current_setting('nova.lead_move', true), '') = '1' then
    return null;
  end if;
  if tg_op = 'DELETE' then
    r := old;
  else
    r := new;
  end if;
  v_copy := r.os_uid is not null and r.src_row_id is not null;
  v_key := case when v_copy then r.src_row_id else r.id end;
  v_os := r.page_id like 'osdesk\_%';

  if tg_op = 'DELETE' then
    -- Копия у технаря уходит вместе с источником или переездом — её не пишем.
    if v_copy or public.desk_cells_blank(old.cells) then
      return null;
    end if;
    -- Каскад при удалении компании: её уже нет — писать историю некуда.
    if not exists (select 1 from public.rows_workspaces w where w.workspace_id = old.workspace_id) then
      return null;
    end if;
    insert into public.order_events (workspace_id, order_key, page_id, tab_id, row_id, kind, actor_uid, at)
    values (old.workspace_id, v_key, old.page_id, old.tab_id, old.id, 'deleted', v_actor, v_at);
    return null;
  end if;

  n_blank := public.desk_cells_blank(new.cells);
  if tg_op = 'INSERT' then
    -- Новая копия у технаря — это «выдан», его пишет строка-источник.
    if v_copy or n_blank then
      return null;
    end if;
    insert into public.order_events (workspace_id, order_key, page_id, tab_id, row_id, kind, new_value, actor_uid, at)
    values (new.workspace_id, v_key, new.page_id, new.tab_id, new.id, 'created',
            new.cells ->> coalesce(new.status_key, 'status'), v_actor, v_at);
    return null;
  end if;

  -- UPDATE: быстрый выход, если не менялось ничего, что попадает в историю.
  if new.cells is not distinct from old.cells
     and new.tab_id is not distinct from old.tab_id
     and new.mirror_row_id is not distinct from old.mirror_row_id then
    return null;
  end if;

  o_blank := public.desk_cells_blank(old.cells);
  if o_blank and not n_blank and not v_copy then
    -- Слот впервые заполнен — заказ заведён.
    insert into public.order_events (workspace_id, order_key, page_id, tab_id, row_id, kind, new_value, actor_uid, at)
    values (new.workspace_id, v_key, new.page_id, new.tab_id, new.id, 'created',
            new.cells ->> coalesce(new.status_key, 'status'), v_actor, v_at);
    return null;
  end if;
  if n_blank then
    return null;
  end if;

  if new.tab_id is distinct from old.tab_id and not v_copy then
    insert into public.order_events (workspace_id, order_key, page_id, tab_id, row_id, kind, old_value, new_value, actor_uid, at)
    values (new.workspace_id, v_key, new.page_id, new.tab_id, new.id, 'carried', old.tab_id, new.tab_id, v_actor, v_at);
  end if;

  o_st := old.cells ->> coalesce(old.status_key, 'status');
  n_st := new.cells ->> coalesce(new.status_key, 'status');
  -- Статус копии, который довёз триггер статуса ОС (вложенная запись), —
  -- тот же, что у источника: второй раз не пишем.
  if coalesce(o_st, '') is distinct from coalesce(n_st, '') and not (v_copy and pg_trigger_depth() > 1) then
    insert into public.order_events (workspace_id, order_key, page_id, tab_id, row_id, kind, field, old_value, new_value, actor_uid, at)
    values (new.workspace_id, v_key, new.page_id, new.tab_id, new.id, 'status',
            case when v_copy then 'tech' else null end, o_st, n_st, v_actor, v_at);
  end if;

  if v_os then
    if coalesce(old.cells ->> 'technician', '') is distinct from coalesce(new.cells ->> 'technician', '') then
      insert into public.order_events (workspace_id, order_key, page_id, tab_id, row_id, kind, old_value, new_value, actor_uid, at)
      values (new.workspace_id, v_key, new.page_id, new.tab_id, new.id, 'tech',
              nullif(old.cells ->> 'technician', ''), nullif(new.cells ->> 'technician', ''), v_actor, v_at);
    end if;
    foreach f in array array['price', 'upsell'] loop
      if coalesce(old.cells ->> f, '') is distinct from coalesce(new.cells ->> f, '') then
        insert into public.order_events (workspace_id, order_key, page_id, tab_id, row_id, kind, field, old_value, new_value, actor_uid, at)
        values (new.workspace_id, v_key, new.page_id, new.tab_id, new.id, 'amount', f,
                nullif(old.cells ->> f, ''), nullif(new.cells ->> f, ''), v_actor, v_at);
      end if;
    end loop;
    if new.mirror_row_id is distinct from old.mirror_row_id then
      insert into public.order_events (workspace_id, order_key, page_id, tab_id, row_id, kind, old_value, new_value, actor_uid, at)
      values (new.workspace_id, v_key, new.page_id, new.tab_id, new.id,
              case when new.mirror_row_id is null then 'unissued' else 'issued' end,
              old.mirror_page_id, new.mirror_page_id, v_actor, v_at);
    end if;
  end if;
  return null;
end;
$$;
revoke all on function public.desk_rows_events() from public, anon, authenticated;

drop trigger if exists desk_rows_zz_events on public.desk_rows;
create trigger desk_rows_zz_events
  after insert or update or delete on public.desk_rows
  for each row execute function public.desk_rows_events();

-- ---------------------------------------------------------------------
-- Общая таблица: строки нужных вкладок всех столов одним запросом.
-- p_tables — [{page, tab}] (tab '' — «Основная»), не больше 400.
-- copies — копии у технарей для строк столов ОС, лежащие ВНЕ этих вкладок.
-- Голова — как rows_table_head, но по всем таблицам: число, max rev и md5
-- «page/tab/id:rev» в побайтовом порядке (клиент считает тот же md5).
-- SECURITY INVOKER: строки отдаёт политика чтения (Owner и Тимлид+ читают всё).
-- ---------------------------------------------------------------------
create or replace function public.lead_board_scope(p_workspace text, p_tables jsonb)
returns setof public.desk_rows
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with t as (
    select distinct x ->> 'page' as page_id, coalesce(x ->> 'tab', '') as tab_id
    from jsonb_array_elements(case when jsonb_typeof(p_tables) = 'array' then p_tables else '[]'::jsonb end) x
    where coalesce(x ->> 'page', '') <> ''
  ), scope as (
    select r.* from public.desk_rows r
    join t on r.page_id = t.page_id and r.tab_id = t.tab_id
    where r.workspace_id = p_workspace
  )
  select * from scope
  union all
  select c.* from public.desk_rows c
  where c.workspace_id = p_workspace and c.os_uid is not null and c.src_row_id is not null
    and (c.src_page_id, c.src_row_id) in (select s.page_id, s.id from scope s where s.page_id like 'osdesk\_%')
    and not exists (select 1 from t where t.page_id = c.page_id and t.tab_id = c.tab_id)
$$;

create or replace function public.lead_board_check(p_workspace text, p_tables jsonb) returns void
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
begin
  if not (coalesce(public.rows_is_owner(p_workspace), false) or coalesce(public.rows_is_leadplus(p_workspace), false)) then
    raise exception 'lead_board: общая таблица — у Owner и Тимлид+' using errcode = '42501';
  end if;
  if jsonb_typeof(p_tables) <> 'array' or jsonb_array_length(p_tables) > 400 then
    raise exception 'lead_board: список таблиц — массив до 400' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.lead_board(p_workspace text, p_tables jsonb, p_after bigint default 0)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  perform public.lead_board_check(p_workspace, p_tables);
  with s as (select * from public.lead_board_scope(p_workspace, p_tables))
  select jsonb_build_object(
    'count', (select count(*) from s),
    'rev', (select coalesce(max(s.rev), 0) from s),
    'ids', (select coalesce(md5(string_agg(s.page_id || '/' || s.tab_id || '/' || s.id || ':' || coalesce(s.rev, 0)::text, ','
                                            order by s.page_id || '/' || s.tab_id || '/' || s.id collate "C")), '') from s),
    'rows', coalesce((select jsonb_agg(to_jsonb(s) order by s.rev) from s where coalesce(s.rev, 0) > coalesce(p_after, 0)), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;

create or replace function public.lead_board_head(p_workspace text, p_tables jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  perform public.lead_board_check(p_workspace, p_tables);
  with s as (select * from public.lead_board_scope(p_workspace, p_tables))
  select jsonb_build_object(
    'count', (select count(*) from s),
    'rev', (select coalesce(max(s.rev), 0) from s),
    'ids', (select coalesce(md5(string_agg(s.page_id || '/' || s.tab_id || '/' || s.id || ':' || coalesce(s.rev, 0)::text, ','
                                            order by s.page_id || '/' || s.tab_id || '/' || s.id collate "C")), '') from s)
  ) into v;
  return v;
end;
$$;

revoke all on function public.lead_board_scope(text, jsonb) from public;
revoke all on function public.lead_board_check(text, jsonb) from public;
revoke all on function public.lead_board(text, jsonb, bigint) from public;
revoke all on function public.lead_board_head(text, jsonb) from public;
grant execute on function public.lead_board_scope(text, jsonb) to anon, authenticated;
grant execute on function public.lead_board_check(text, jsonb) to anon, authenticated;
grant execute on function public.lead_board(text, jsonb, bigint) to anon, authenticated;
grant execute on function public.lead_board_head(text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Переназначить заказ другому ОС: строка переезжает на его стол (тот же id),
-- копия у технаря — переподписывается на нового ОС (os_uid, адрес
-- источника, ник ОС в её столбце). Одно событие «os» в истории.
-- ---------------------------------------------------------------------
create or replace function public.lead_move_os(
  p_workspace text, p_from_page text, p_from_tab text, p_row text, p_to_page text, p_to_tab text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  src public.desk_rows%rowtype;
  v_from_os text;
  v_to_os text;
  v_nick text;
  v_key text;
  v_order double precision;
  now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_copy boolean := false;
begin
  if me is null or not (coalesce(public.rows_is_owner(p_workspace), false) or coalesce(public.rows_is_leadplus(p_workspace), false)) then
    raise exception 'lead_move_os: переназначает Owner или Тимлид+' using errcode = '42501';
  end if;
  if p_workspace not in (select public.rows_writable_workspaces()) then
    raise exception 'lead_move_os: хранилище закрыто' using errcode = '42501';
  end if;
  if p_from_page is null or p_to_page is null or p_from_page not like 'osdesk\_%' or p_to_page not like 'osdesk\_%' then
    raise exception 'lead_move_os: переносятся строки столов ОС' using errcode = '22023';
  end if;
  if p_from_page = p_to_page then
    raise exception 'lead_move_os: заказ уже у этого ОС' using errcode = '22023';
  end if;
  select a.responsible_uid into v_to_os from public.rows_page_acl a
  where a.workspace_id = p_workspace and a.page_id = p_to_page and a.os_desk;
  if v_to_os is null then
    raise exception 'lead_move_os: стола этого ОС нет' using errcode = 'P0002';
  end if;
  select a.responsible_uid into v_from_os from public.rows_page_acl a
  where a.workspace_id = p_workspace and a.page_id = p_from_page;
  select * into src from public.desk_rows r
  where r.workspace_id = p_workspace and r.page_id = p_from_page and r.tab_id = coalesce(p_from_tab, '') and r.id = p_row
  for update;
  if not found then
    raise exception 'lead_move_os: заказа уже нет — обновите таблицу' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.desk_rows r where r.workspace_id = p_workspace and r.page_id = p_to_page
             and r.tab_id = coalesce(p_to_tab, '') and r.id = p_row) then
    raise exception 'lead_move_os: у ОС уже есть строка с этим id' using errcode = '23505';
  end if;
  select coalesce(max(r.sort_order), 0) + 1 into v_order from public.desk_rows r
  where r.workspace_id = p_workspace and r.page_id = p_to_page and r.tab_id = coalesce(p_to_tab, '');

  perform set_config('nova.lead_move', '1', true);
  insert into public.desk_rows (
    workspace_id, page_id, tab_id, id, cells, extras, attachments, sort_order, height,
    created_at, updated_at, filled_at, order_id, highlight,
    os_uid, tech_uid, status_key, src_page_id, src_tab_id, src_row_id,
    mirror_page_id, mirror_tab_id, mirror_row_id, sync_hash,
    success_requested_at, success_requested_by, carried_from, carried_at
  ) values (
    p_workspace, p_to_page, coalesce(p_to_tab, ''), src.id, src.cells, src.extras, src.attachments, v_order, src.height,
    src.created_at, now_ms, src.filled_at, src.order_id, true,
    case when src.os_uid is null then null else v_to_os end, src.tech_uid, src.status_key, src.src_page_id, src.src_tab_id, src.src_row_id,
    src.mirror_page_id, src.mirror_tab_id, src.mirror_row_id, src.sync_hash,
    src.success_requested_at, src.success_requested_by, src.carried_from, src.carried_at
  );
  delete from public.desk_rows r
  where r.workspace_id = p_workspace and r.page_id = p_from_page and r.tab_id = coalesce(p_from_tab, '') and r.id = p_row;

  if src.mirror_row_id is not null then
    select m.os_nick_value into v_nick from public.rows_members m
    where m.workspace_id = p_workspace and m.uid = v_to_os;
    select a.os_key into v_key from public.rows_page_acl a
    where a.workspace_id = p_workspace and a.page_id = src.mirror_page_id
      and coalesce(a.os_keys_tab, '') = coalesce(src.mirror_tab_id, '');
    update public.desk_rows c
       set os_uid = v_to_os,
           src_page_id = p_to_page,
           src_tab_id = coalesce(p_to_tab, ''),
           cells = case when v_key is not null and v_nick is not null then c.cells || jsonb_build_object(v_key, v_nick) else c.cells end,
           updated_at = now_ms
     where c.workspace_id = p_workspace and c.page_id = src.mirror_page_id
       and c.tab_id = coalesce(src.mirror_tab_id, '') and c.id = src.mirror_row_id;
    v_copy := found;
  end if;
  perform set_config('nova.lead_move', '', true);

  insert into public.order_events (workspace_id, order_key, page_id, tab_id, row_id, kind, old_value, new_value, actor_uid, at)
  values (p_workspace, src.id, p_to_page, coalesce(p_to_tab, ''), src.id, 'os', v_from_os, v_to_os, me, now_ms);

  return jsonb_build_object('page', p_to_page, 'tab', coalesce(p_to_tab, ''), 'id', src.id,
                            'osUid', v_to_os, 'fromOsUid', v_from_os, 'copyMoved', v_copy);
end;
$$;
revoke all on function public.lead_move_os(text, text, text, text, text, text) from public;
grant execute on function public.lead_move_os(text, text, text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
create or replace function public.nova_schema_version() returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select '20261036'
$$;
revoke all on function public.nova_schema_version() from public, anon, authenticated;
grant execute on function public.nova_schema_version() to anon, authenticated;
