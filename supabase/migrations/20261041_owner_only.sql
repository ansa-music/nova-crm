-- =====================================================================
-- Стол «только для Owner» (29.09.2026, просьба Nurba: «сделай функцию для
-- овнера, где он может сделать выбранный стол недоступный для просмотра
-- никому, остаётся только для овнера доступным — но стол должен отображаться
-- в рейтингах и при выдаче заказа — но саму таблицу не сможет посмотреть никто»).
--
-- Что закрыто на таком столе всем, кроме Owner (создатель и выданный Owner,
-- rows_is_owner), — строки всех вкладок, сами вкладки, чат стола,
-- комментарии к строкам, личные зоны, файлы строк, история заказов, оценки
-- (у технаря) и привязки Telegram. Перекрывает ВСЕ обходы: ответственный,
-- allowedUsers/editableUsers, «ОС видит все столы», Тимлид+Технарь, Тимлид+,
-- наблюдатели, ветку Тимлида «Успешка».
-- Что остаётся: документ стола в списках («Столы», рейтинги, выдача заказа),
-- счётчики desk_loads (их публикует сессия Owner) и СВОИ строки-заказы ОС
-- (os_uid = он) — иначе выдача заказа технарю этого стола остановилась бы.
--
-- Где флаг: отдельная таблица rows_owner_only, пишет ТОЛЬКО Owner — функцией
-- rows_set_desk_owner_only или записью «ownerOnly» в документе стола
-- (core_write это пускает только Owner; копию ведёт триггер). В rows_page_acl
-- флаг не кладётся: её пишут Тимлиды и ответственные.
--
-- Полные копии (правки — только здесь или в файле новее): core_write
-- (из 20261036), core_import (20261030), rows_readable_pages,
-- rows_editable_pages, rows_can_access_page, rows_can_edit_page (20260923),
-- rows_my_personal_pages (20261022), rows_carry_over, desk_load_rearchive
-- (20261007), rows_os_claim_order (20261004), tg_link_client (20261014),
-- send_chat_message (20261009), nova_storage_path_ok (20261034).
-- Заодно закрыты две старые дыры: core_write «create» отдавал существующую
-- вкладку (и заявку) любому участнику, send_chat_message по чужому id
-- возвращал любое сообщение.
-- Файл повторяемый.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Флаг и наборы.
-- ---------------------------------------------------------------------
create table if not exists public.rows_owner_only (
  workspace_id text not null references public.rows_workspaces (workspace_id) on delete cascade,
  page_id text not null,
  set_at bigint not null default 0,
  set_by text,
  primary key (workspace_id, page_id)
);
alter table public.rows_owner_only enable row level security;
revoke all on public.rows_owner_only from public, anon, authenticated;
grant select on public.rows_owner_only to anon, authenticated;
-- Сам факт «стол закрыт» не секрет: его видно по значку в «Столах».
drop policy if exists rows_owner_only_read on public.rows_owner_only;
create policy rows_owner_only_read on public.rows_owner_only for select to anon, authenticated
  using (workspace_id in (select public.rows_my_workspaces()));

-- Столы, закрытые ОТ МЕНЯ: все «только для Owner», кроме workspace, где я
-- Owner. Без аргументов-столбцов — Postgres считает набор раз на запрос.
create or replace function public.rows_owner_only_hidden() returns table (workspace_id text, page_id text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select o.workspace_id, o.page_id from public.rows_owner_only o
  where o.workspace_id in (select public.rows_my_workspaces())
    and o.workspace_id not in (select public.rows_owned_workspaces())
$$;

-- Workspace, где у меня есть роль ОС (основная или вторая) — исключение для
-- СВОИХ строк-заказов ОС на закрытом столе. Без роли os_uid = я не значит
-- ничего: Тимлид+ заводил бы свои строки в закрытый стол.
create or replace function public.rows_my_os_workspaces() returns setof text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select m.workspace_id from public.rows_members m
  where m.uid = public.rows_uid() and (m.role = 'os' or 'os' = any (coalesce(m.extra_roles, '{}')))
$$;
revoke all on function public.rows_my_os_workspaces() from public;
grant execute on function public.rows_my_os_workspaces() to anon, authenticated;
revoke all on function public.rows_owner_only_hidden() from public;
grant execute on function public.rows_owner_only_hidden() to anon, authenticated;

-- Закрыть / открыть стол. Только Owner; стол ОС не закрывается (ОС потерял бы
-- свой стол и выдачу). Документ стола в core_docs правится здесь же — одной
-- транзакцией с флагом.
create or replace function public.rows_set_desk_owner_only(p_workspace text, p_page text, p_on boolean) returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  v_doc public.core_docs%rowtype;
  v_found boolean;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if me is null or not coalesce(public.rows_is_owner(p_workspace), false) then
    raise exception 'Закрыть стол «только для Owner» может только Owner' using errcode = '42501';
  end if;
  if p_page is null or p_page !~ '^[A-Za-z0-9_.-]+$' or p_on is null then
    raise exception 'rows_set_desk_owner_only: неверный стол' using errcode = '22023';
  end if;
  if starts_with(p_page, 'osdesk_')
     or exists (select 1 from public.rows_page_acl a where a.workspace_id = p_workspace and a.page_id = p_page and a.os_desk) then
    raise exception 'Стол ОС не закрывают «только для Owner»' using errcode = '22023';
  end if;
  select * into v_doc from public.core_docs c
  where c.workspace_id = p_workspace and c.kind = 'page' and c.parent_id = '' and c.id = p_page
  for update;
  v_found := found and not v_doc.deleted;
  if v_found and coalesce(v_doc.data -> 'osDesk' = 'true'::jsonb, false) then
    raise exception 'Стол ОС не закрывают «только для Owner»' using errcode = '22023';
  end if;
  if p_on then
    insert into public.rows_owner_only (workspace_id, page_id, set_at, set_by)
    values (p_workspace, p_page, v_now, me)
    on conflict (workspace_id, page_id) do nothing;
    if v_found and not coalesce(v_doc.data -> 'ownerOnly' = 'true'::jsonb, false) then
      update public.core_docs c set data = c.data || jsonb_build_object('ownerOnly', true, 'updatedAt', v_now)
      where c.workspace_id = p_workspace and c.kind = 'page' and c.parent_id = '' and c.id = p_page;
    end if;
  else
    delete from public.rows_owner_only o where o.workspace_id = p_workspace and o.page_id = p_page;
    if v_found and v_doc.data ? 'ownerOnly' then
      update public.core_docs c set data = (c.data - 'ownerOnly') || jsonb_build_object('updatedAt', v_now)
      where c.workspace_id = p_workspace and c.kind = 'page' and c.parent_id = '' and c.id = p_page;
    end if;
  end if;
  return p_on;
end;
$$;
revoke all on function public.rows_set_desk_owner_only(text, text, boolean) from public;
grant execute on function public.rows_set_desk_owner_only(text, text, boolean) to anon, authenticated;

-- Копия флага из документа стола (core_docs). Флаг в документе меняет только
-- Owner (core_write, core_import, rows_set_desk_owner_only), поэтому триггер
-- доверяет переходу; снимает флаг только ПЕРЕХОД true → нет.
create or replace function public.core_docs_owner_only_sync() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.kind <> 'page' or new.parent_id <> '' then
    return new;
  end if;
  if not exists (select 1 from public.rows_workspaces w where w.workspace_id = new.workspace_id) then
    return new;
  end if;
  -- Удалённый стол флаг сохраняет: его строки удаляются позже отдельным
  -- шагом, и без флага они на это время открылись бы «видящим все столы».
  -- Флаг на id удалённого стола безвреден.
  if new.deleted then
    return new;
  end if;
  if coalesce(new.data -> 'ownerOnly' = 'true'::jsonb, false) then
    insert into public.rows_owner_only (workspace_id, page_id, set_at, set_by)
    values (new.workspace_id, new.id, (extract(epoch from clock_timestamp()) * 1000)::bigint, public.rows_uid())
    on conflict (workspace_id, page_id) do nothing;
  elsif tg_op = 'UPDATE' and coalesce(old.data -> 'ownerOnly' = 'true'::jsonb, false) then
    delete from public.rows_owner_only o where o.workspace_id = new.workspace_id and o.page_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function public.core_docs_owner_only_sync() from public, anon, authenticated;

drop trigger if exists core_docs_35_owner_only on public.core_docs;
create trigger core_docs_35_owner_only
  after insert or update on public.core_docs
  for each row execute function public.core_docs_owner_only_sync();

-- ---------------------------------------------------------------------
-- 2. Постраничные наборы прав: закрытый стол из них выпадает (у Owner свой
--    путь — rows_read_all / rows_edit_all / rows_owner_all).
-- ---------------------------------------------------------------------
create or replace function public.rows_readable_pages() returns table (workspace_id text, page_id text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select a.workspace_id, a.page_id
  from public.rows_page_acl a
  join public.rows_members m on m.workspace_id = a.workspace_id and m.uid = public.rows_uid()
  where (a.workspace_id, a.page_id) not in (select o.workspace_id, o.page_id from public.rows_owner_only o)
    and (
    -- Столы ОС — любому участнику на чтение (как isOsDeskPage в firestore.rules).
    a.os_desk
    -- isDeskBlocked: Тимлид без Технаря — нет.
    or (not (m.role = 'teamlead' and not ('manager' = any (m.extra_roles)))
      and (a.responsible_uid = m.uid or m.uid = any (a.allowed_uids))))
$$;

create or replace function public.rows_editable_pages() returns table (workspace_id text, page_id text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select a.workspace_id, a.page_id
  from public.rows_page_acl a
  join public.rows_members m on m.workspace_id = a.workspace_id and m.uid = public.rows_uid()
  where (a.workspace_id, a.page_id) not in (select o.workspace_id, o.page_id from public.rows_owner_only o)
    and (
    -- Свой стол ОС ведёт и Тимлид + ОС: создатель и ответственный — один человек.
    (a.os_desk and a.responsible_uid = m.uid and a.created_by = m.uid)
    or (not (m.role = 'teamlead' and not ('manager' = any (m.extra_roles)))
      and (
        a.responsible_uid = m.uid
        -- editableUsers — только вместе с правом открыть стол (canAccessPage).
        or (m.uid = any (a.editable_uids) and (
          a.workspace_id in (select public.rows_read_all_workspaces())
          or (a.workspace_id, a.page_id) in (select r.workspace_id, r.page_id from public.rows_readable_pages() r)))
      )))
$$;

create or replace function public.rows_can_access_page(ws text, pg text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select (ws in (select public.rows_read_all_workspaces())
    or (ws, pg) in (select r.workspace_id, r.page_id from public.rows_readable_pages() r))
    and (ws, pg) not in (select h.workspace_id, h.page_id from public.rows_owner_only_hidden() h)
$$;

create or replace function public.rows_can_edit_page(ws text, pg text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select ws in (select public.rows_writable_workspaces()) and (
    ws in (select public.rows_edit_all_workspaces())
    or (ws, pg) in (select e.workspace_id, e.page_id from public.rows_editable_pages() e))
    and (ws, pg) not in (select h.workspace_id, h.page_id from public.rows_owner_only_hidden() h)
$$;

create or replace function public.rows_my_personal_pages() returns table (workspace_id text, page_id text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select a.workspace_id, a.page_id
  from public.rows_page_acl a
  join public.rows_members m on m.workspace_id = a.workspace_id and m.uid = public.rows_uid()
  where (a.workspace_id, a.page_id) not in (select o.workspace_id, o.page_id from public.rows_owner_only o)
    and (
    -- Свой стол ОС (и у Тимлида + ОС): ответственный и создатель.
    (a.os_desk and a.responsible_uid = m.uid and a.created_by = m.uid)
    -- isDeskBlocked: Тимлид без Технаря — нет.
    or (not (m.role = 'teamlead' and not ('manager' = any (m.extra_roles)))
      and (a.responsible_uid = m.uid or m.uid = any (a.personal_zone_uids))))
$$;

-- ---------------------------------------------------------------------
-- 3. Ограничительные политики — одна на таблицу, И со всеми разрешающими
--    (read_all, Тимлид+, ветка Тимлида «Успешка» и т. д.) разом.
-- ---------------------------------------------------------------------
-- Строки: закрытый стол — только Owner и СВОИ строки-заказы ОС.
drop policy if exists desk_rows_owner_only on public.desk_rows;
create policy desk_rows_owner_only on public.desk_rows as restrictive for all to anon, authenticated
  using ((workspace_id, page_id) not in (select h.workspace_id, h.page_id from public.rows_owner_only_hidden() h)
         or (os_uid is not null and os_uid = (select public.rows_uid())
             and workspace_id in (select public.rows_my_os_workspaces())))
  with check ((workspace_id, page_id) not in (select h.workspace_id, h.page_id from public.rows_owner_only_hidden() h)
         or (os_uid is not null and os_uid = (select public.rows_uid())
             and workspace_id in (select public.rows_my_os_workspaces())));

-- Вкладки.
drop policy if exists core_docs_owner_only on public.core_docs;
create policy core_docs_owner_only on public.core_docs as restrictive for select to anon, authenticated
  using (kind <> 'subpage' or (workspace_id, parent_id) not in (select h.workspace_id, h.page_id from public.rows_owner_only_hidden() h));

-- Чат стола и комментарии к строкам.
drop policy if exists chat_messages_owner_only on public.chat_messages;
create policy chat_messages_owner_only on public.chat_messages as restrictive for all to anon, authenticated
  using (kind not in ('page', 'row') or (workspace_id, page_id) not in (select h.workspace_id, h.page_id from public.rows_owner_only_hidden() h))
  with check (kind not in ('page', 'row') or (workspace_id, page_id) not in (select h.workspace_id, h.page_id from public.rows_owner_only_hidden() h));

-- История заказов «Общей таблицы».
drop policy if exists order_events_owner_only on public.order_events;
create policy order_events_owner_only on public.order_events as restrictive for select to anon, authenticated
  using ((workspace_id, page_id) not in (select h.workspace_id, h.page_id from public.rows_owner_only_hidden() h));

-- Оценки: технарь закрытого стола не видит названий заказов; ОС — свои видит.
drop policy if exists order_ratings_owner_only on public.order_ratings;
create policy order_ratings_owner_only on public.order_ratings as restrictive for select to anon, authenticated
  using ((workspace_id, page_id) not in (select h.workspace_id, h.page_id from public.rows_owner_only_hidden() h) or os_uid = (select public.rows_uid()));

-- Привязки Telegram к клиентам (подпись «имя · телефон»): свои — видно.
drop policy if exists tg_chat_clients_owner_only on public.tg_chat_clients;
create policy tg_chat_clients_owner_only on public.tg_chat_clients as restrictive for select to anon, authenticated
  using ((workspace_id, page_id) not in (select h.workspace_id, h.page_id from public.rows_owner_only_hidden() h) or bound_by = (select public.rows_uid()));

-- Счётчики и списки заказов ОС закрытого стола публикует только Owner
-- (читают их все — рейтинги и выдача заказа остаются).
drop policy if exists desk_loads_owner_only_ins on public.desk_loads;
create policy desk_loads_owner_only_ins on public.desk_loads as restrictive for insert to anon, authenticated
  with check ((workspace_id, page_id) not in (select h.workspace_id, h.page_id from public.rows_owner_only_hidden() h));
drop policy if exists desk_loads_owner_only_upd on public.desk_loads;
create policy desk_loads_owner_only_upd on public.desk_loads as restrictive for update to anon, authenticated
  using ((workspace_id, page_id) not in (select h.workspace_id, h.page_id from public.rows_owner_only_hidden() h))
  with check ((workspace_id, page_id) not in (select h.workspace_id, h.page_id from public.rows_owner_only_hidden() h));
drop policy if exists os_orders_owner_only_ins on public.os_orders;
create policy os_orders_owner_only_ins on public.os_orders as restrictive for insert to anon, authenticated
  with check ((workspace_id, page_id) not in (select h.workspace_id, h.page_id from public.rows_owner_only_hidden() h));
drop policy if exists os_orders_owner_only_upd on public.os_orders;
create policy os_orders_owner_only_upd on public.os_orders as restrictive for update to anon, authenticated
  using ((workspace_id, page_id) not in (select h.workspace_id, h.page_id from public.rows_owner_only_hidden() h))
  with check ((workspace_id, page_id) not in (select h.workspace_id, h.page_id from public.rows_owner_only_hidden() h));

-- ---------------------------------------------------------------------
-- 4. Функции с правами владельца базы (RLS их не видит) — полные копии.
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
  v_hidden boolean;
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
      -- Вернуть существующий документ — только тому, кто вправе его читать
      -- (вкладка — как core_docs_read с закрытыми столами, заявка — руководству
      -- и самому). Раньше «create» отдавал любую вкладку любому участнику.
      if v_kind = 'subpage' and not (
           (p_workspace in (select public.rows_read_all_workspaces())
            or (p_workspace, v_parent) in (select r.workspace_id, r.page_id from public.rows_readable_pages() r))
           and (p_workspace, v_parent) not in (select h.workspace_id, h.page_id from public.rows_owner_only_hidden() h)) then
        raise exception 'core_write: нет доступа к вкладкам этого стола' using errcode = '42501';
      end if;
      if v_kind = 'join' and not (v_self or p_workspace in (select public.rows_lead_workspaces())) then
        raise exception 'core_write: чужую заявку не читают' using errcode = '42501';
      end if;
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
        if not ((p_workspace in (select public.rows_edit_all_workspaces())
                 or (p_workspace, v_parent) in (select e.workspace_id, e.page_id from public.rows_editable_pages() e))
                and (p_workspace, v_parent) not in (select h.workspace_id, h.page_id from public.rows_owner_only_hidden() h)) then
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
        -- «Только для Owner» ставит только Owner, только true/false и не на столе ОС.
        if v_new ? 'ownerOnly' then
          if jsonb_typeof(v_new -> 'ownerOnly') <> 'boolean' then
            raise exception 'core_write: ownerOnly — true или false' using errcode = '22023';
          end if;
          if (v_new -> 'ownerOnly') = 'true'::jsonb and not v_owner then
            raise exception 'core_write: закрыть стол «только для Owner» может только Owner' using errcode = '42501';
          end if;
          if (v_new -> 'ownerOnly') = 'true'::jsonb and coalesce(v_new -> 'osDesk' = 'true'::jsonb, false) then
            raise exception 'core_write: стол ОС не закрывают «только для Owner»' using errcode = '22023';
          end if;
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
        v_hidden := coalesce(cur.data -> 'ownerOnly' = 'true'::jsonb, false);
        if 'ownerOnly' = any(v_changed) then
          if not v_owner then
            raise exception 'core_write: «только для Owner» меняет только Owner' using errcode = '42501';
          end if;
          if v_new ? 'ownerOnly' and jsonb_typeof(v_new -> 'ownerOnly') <> 'boolean' then
            raise exception 'core_write: ownerOnly — true или false' using errcode = '22023';
          end if;
        end if;
        if coalesce(v_new -> 'ownerOnly' = 'true'::jsonb, false) and coalesce(v_new -> 'osDesk' = 'true'::jsonb, false) then
          raise exception 'core_write: стол ОС не закрывают «только для Owner»' using errcode = '22023';
        end if;
        if v_owner then
          null;
        -- Ответственный за стол «только для Owner» свой стол не правит — его
        -- ведёт Owner; Тимлид-ответственный идёт по списку Тимлида.
        elsif v_lead and not (page_resp is not null and page_resp = me and not v_hidden) then
          if not (v_changed <@ (array['allowedUsers', 'editableUsers', 'responsibleUserId', 'hiddenByResponsible', 'personalZoneAllowedUsers', 'inactive', 'inactiveAt', 'inactiveBy', 'updatedAt']::text[]
                  -- Тимлид+ ещё заводит месячную вкладку чужого стола (лид в стол ОС).
                  || case when v_leadplus then array['autoMonthKey', 'autoMonthSubPageId', 'defaultSubPageId', 'mainTabName', 'mainTabMonthKey']::text[] else '{}'::text[] end)) then
            raise exception 'core_write: Тимлид меняет только доступ и статус стола' using errcode = '42501';
          end if;
          if page_os and 'responsibleUserId' = any(v_changed) then
            raise exception 'core_write: ответственного за стол ОС не переназначают' using errcode = '42501';
          end if;
        elsif page_resp is not null and page_resp = me and not v_hidden then
          if v_changed && array['responsibleUserId', 'createdBy', 'workspaceId', 'inactive', 'inactiveAt', 'inactiveBy', 'osDesk', 'techEditable', 'ownerOnly']::text[] then
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
      v_can_edit := (p_workspace in (select public.rows_edit_all_workspaces())
          or (p_workspace, v_parent) in (select e.workspace_id, e.page_id from public.rows_editable_pages() e))
        and (p_workspace, v_parent) not in (select h.workspace_id, h.page_id from public.rows_owner_only_hidden() h);
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
      -- «Только для Owner» после переноса живёт здесь: дочитка документа из
      -- Firestore (тень без флага) его не снимает и не ставит.
      if v_kind = 'page' then
        d := (d - 'ownerOnly') || case when cur.data ? 'ownerOnly' then jsonb_build_object('ownerOnly', cur.data -> 'ownerOnly') else '{}'::jsonb end;
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

create or replace function public.rows_carry_over(
  p_workspace text,
  p_page text,
  p_from_tab text,
  p_to_tab text,
  p_rows text[]
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  from_tab text := coalesce(p_from_tab, '');
  to_tab text := coalesce(p_to_tab, '');
  base double precision;
  now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  moved text[];
begin
  if me is null then
    raise exception 'no token' using errcode = '42501';
  end if;
  if from_tab = to_tab then
    raise exception 'same tab' using errcode = '22023';
  end if;
  if p_workspace not in (select public.rows_writable_workspaces()) then
    raise exception 'rows storage is not writable' using errcode = '42501';
  end if;
  if not ((p_workspace in (select public.rows_edit_all_workspaces())
           or (p_workspace, p_page) in (select e.workspace_id, e.page_id from public.rows_editable_pages() e))
          and (p_workspace, p_page) not in (select h.workspace_id, h.page_id from public.rows_owner_only_hidden() h)) then
    raise exception 'not a desk editor' using errcode = '42501';
  end if;
  if coalesce(array_length(p_rows, 1), 0) = 0 then
    return jsonb_build_object('moved', '[]'::jsonb, 'skipped', '[]'::jsonb);
  end if;

  perform set_config('nova.carry_over', '1', true);
  base := public.rows_append_order(p_workspace, p_page, to_tab);

  with src as (
    select r.id, row_number() over (order by r.sort_order, r.created_at, r.id) - 1 as n
    from public.desk_rows r
    where r.workspace_id = p_workspace and r.page_id = p_page and r.tab_id = from_tab and r.id = any (p_rows)
      and not exists (
        select 1 from public.desk_rows t
        where t.workspace_id = p_workspace and t.page_id = p_page and t.tab_id = to_tab and t.id = r.id
      )
  ), upd as (
    update public.desk_rows d
    set tab_id = to_tab,
        sort_order = base + src.n,
        carried_from = from_tab,
        carried_at = now_ms,
        updated_at = now_ms
    from src
    where d.workspace_id = p_workspace and d.page_id = p_page and d.tab_id = from_tab and d.id = src.id
    returning d.id
  )
  select coalesce(array_agg(id order by id), '{}'::text[]) into moved from upd;

  -- Адреса: источник на столе ОС смотрит на копию → новая вкладка копии.
  update public.desk_rows s
  set mirror_tab_id = to_tab
  where s.workspace_id = p_workspace and s.mirror_page_id = p_page
    and coalesce(s.mirror_tab_id, '') = from_tab and s.mirror_row_id = any (moved);
  -- Копии перенесённых источников (перенос на столе ОС) → новая вкладка источника.
  update public.desk_rows c
  set src_tab_id = to_tab
  where c.workspace_id = p_workspace and c.src_page_id = p_page
    and coalesce(c.src_tab_id, '') = from_tab and c.src_row_id = any (moved);
  -- Оценка заказа ключуется адресом строки; её период (month_key) не меняем.
  update public.order_ratings o
  set tab_id = to_tab
  where o.workspace_id = p_workspace and o.page_id = p_page and o.tab_id = from_tab and o.row_id = any (moved)
    and not exists (
      select 1 from public.order_ratings x
      where x.workspace_id = p_workspace and x.page_id = p_page and x.tab_id = to_tab and x.row_id = o.row_id
    );

  return jsonb_build_object(
    'moved', to_jsonb(moved),
    'skipped', to_jsonb(array(select s.x from (select unnest(p_rows) as x except select unnest(moved)) s order by s.x))
  );
end;
$$;

create or replace function public.desk_load_rearchive(
  p_workspace text,
  p_page text,
  p_month_key text,
  p_sub_page_id text,
  p_data jsonb
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  resp text;
  live_key text;
  cur_max text := to_char(now() at time zone 'Asia/Almaty', 'YYYY-MM') || '-2';
  clean jsonb;
begin
  if me is null then
    raise exception 'no token' using errcode = '42501';
  end if;
  if p_month_key !~ '^[0-9]{4}-[0-9]{2}(-[12])?$' or p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'bad period or data' using errcode = '22023';
  end if;
  if p_workspace not in (select public.rows_writable_workspaces()) then
    raise exception 'rows storage is not writable' using errcode = '42501';
  end if;
  if not ((p_workspace in (select public.rows_edit_all_workspaces())
           or (p_workspace, p_page) in (select e.workspace_id, e.page_id from public.rows_editable_pages() e))
          and (p_workspace, p_page) not in (select h.workspace_id, h.page_id from public.rows_owner_only_hidden() h)) then
    raise exception 'not a desk editor' using errcode = '42501';
  end if;
  select r.responsible_uid into resp from public.rows_page_responsibles() r
  where r.workspace_id = p_workspace and r.page_id = p_page;
  if resp is null then
    raise exception 'desk has no responsible' using errcode = '42501';
  end if;
  if p_month_key > cur_max then
    raise exception 'future period' using errcode = '22023';
  end if;
  select l.month_key into live_key from public.desk_loads l
  where l.workspace_id = p_workspace and l.page_id = p_page;
  if live_key is not null and p_month_key > live_key then
    raise exception 'period is newer than the live counts' using errcode = '22023';
  end if;

  clean := p_data - array['pageId', 'workspaceId', 'responsibleUserId', 'monthKey', 'subPageId', 'updatedAt', 'updatedBy', 'archivedAt'];

  -- Стол ещё не опубликовал новый период: живые цифры тоже правятся, их
  -- потом заархивирует триггер desk_loads_guard.
  if live_key = p_month_key then
    update public.desk_loads l
    set data = clean, sub_page_id = coalesce(p_sub_page_id, l.sub_page_id), updated_by = me
    where l.workspace_id = p_workspace and l.page_id = p_page;
  end if;

  insert into public.desk_load_history as h
    (workspace_id, page_id, month_key, responsible_uid, sub_page_id, data, updated_by, archived_at, counts_at)
  values (p_workspace, p_page, p_month_key, resp, p_sub_page_id, clean, me, now(), now())
  on conflict (workspace_id, page_id, month_key) do update set
    responsible_uid = excluded.responsible_uid,
    sub_page_id = excluded.sub_page_id,
    data = excluded.data,
    updated_by = excluded.updated_by,
    archived_at = excluded.archived_at,
    counts_at = excluded.counts_at;
end;
$$;

create or replace function public.rows_os_claim_order(
  p_workspace text,
  -- Строка технаря.
  p_page text,
  p_tab text,
  p_row text,
  -- rev строки, по которому клиент собрал источник (null — не сверять).
  p_expect_rev bigint,
  -- Вкладка стола ОС (текущий месяц; '' / null — «Основная»).
  p_src_tab text,
  -- Ячейки и визитка строки-источника (стол ОС — свой, их пишет сам ОС).
  p_src_cells jsonb,
  p_src_extras jsonb,
  -- Подпись полей (mirrorSyncHash) — одна на обе строки.
  p_sync_hash text,
  -- Дата заказа у технаря: created_at источника (max(createdAt, filledAt)).
  p_order_at bigint default null,
  -- Ключ «Статуса» стола ОС, если он не 'status'.
  p_src_status_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  tab text := coalesce(p_tab, '');
  src_tab text := coalesce(p_src_tab, '');
  src_key text := nullif(btrim(coalesce(p_src_status_key, '')), '');
  src_page text;
  nick text;
  acl public.rows_page_acl%rowtype;
  r public.desk_rows%rowtype;
  src public.desk_rows%rowtype;
  src_found boolean := false;
  src_id text;
  cand text;
  now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  order_ms bigint;
begin
  if me is null then
    raise exception 'rows_os_claim_order: нужен вход' using errcode = '42501';
  end if;
  if p_workspace is null or p_workspace not in (select public.rows_writable_workspaces()) then
    raise exception 'rows_os_claim_order: хранилище строк закрыто' using errcode = '42501';
  end if;
  -- coalesce — урок `if not NULL`: у не-участника проверка роли даёт NULL.
  if not coalesce(public.rows_has_role(p_workspace, 'os'), false) then
    raise exception 'rows_os_claim_order: забирает заказ только ОС' using errcode = '42501';
  end if;
  if coalesce(btrim(p_sync_hash), '') = '' or jsonb_typeof(coalesce(p_src_cells, '{}'::jsonb)) <> 'object'
     or (p_src_extras is not null and jsonb_typeof(p_src_extras) not in ('object', 'null')) then
    raise exception 'rows_os_claim_order: нет подписи или ячеек источника' using errcode = '22023';
  end if;

  -- Ник — из копии прав (её пишет руководство), не со слов клиента.
  select btrim(coalesce(m.os_nick_value, '')) into nick
  from public.rows_members m
  where m.workspace_id = p_workspace and m.uid = me;
  if coalesce(nick, '') = '' then
    return jsonb_build_object('status', 'no_nick');
  end if;

  select * into acl from public.rows_page_acl a where a.workspace_id = p_workspace and a.page_id = p_page;
  if not found or acl.os_desk or starts_with(coalesce(p_page, ''), 'osdesk_') or acl.responsible_uid is null then
    return jsonb_build_object('status', 'not_tech_desk');
  end if;
  -- Стол «только для Owner»: строк технаря ОС не видит и не забирает.
  if exists (select 1 from public.rows_owner_only o where o.workspace_id = p_workspace and o.page_id = p_page)
     and not coalesce(public.rows_is_owner(p_workspace), false) then
    return jsonb_build_object('status', 'not_tech_desk');
  end if;
  -- Без ключа статуса строка стала бы заказом, статус которого не ставит
  -- никто (ни триггер Б, ни Тимлид) — политика вставки ОС тоже его требует.
  if acl.os_key is null or acl.os_status_key is null or acl.os_keys_tab is distinct from tab then
    return jsonb_build_object('status', 'no_keys');
  end if;

  -- Источник — только на СВОЁМ столе ОС, и стол уже заведён в копии прав.
  src_page := 'osdesk_' || me;
  if not exists (
    select 1 from public.rows_page_acl a
    where a.workspace_id = p_workspace and a.page_id = src_page and a.os_desk and a.responsible_uid = me
  ) then
    return jsonb_build_object('status', 'no_os_desk');
  end if;

  -- Строка технаря — под замком до конца транзакции: две вкладки ОС (или
  -- два ОС) не заберут её дважды.
  select * into r from public.desk_rows x
  where x.workspace_id = p_workspace and x.page_id = p_page and x.tab_id = tab and x.id = p_row
  for update;
  if not found then
    return jsonb_build_object('status', 'gone');
  end if;
  if r.os_uid is not null then
    if r.os_uid = me and r.src_page_id = src_page then
      return jsonb_build_object('status', 'already', 'srcPageId', r.src_page_id, 'srcTabId', coalesce(r.src_tab_id, ''),
        'srcRowId', r.src_row_id, 'techUid', r.tech_uid);
    end if;
    return jsonb_build_object('status', 'taken');
  end if;
  -- Копию выдал ОС со своего стола, а Owner вернул её технарю (см. А2).
  if starts_with(r.id, 'os_') then
    return jsonb_build_object('status', 'released');
  end if;
  if btrim(coalesce(r.cells ->> acl.os_key, '')) <> nick then
    return jsonb_build_object('status', 'not_mine');
  end if;
  -- Owner вернул строку технарю от моего имени (ячейка osReleasedFrom, см. А2):
  -- снова забрать её можно только через «Передать ОС», которое пометку снимает.
  if btrim(coalesce(r.cells ->> 'osReleasedFrom', '')) = nick then
    return jsonb_build_object('status', 'released');
  end if;
  if p_expect_rev is not null and coalesce(r.rev, 0) <> p_expect_rev then
    return jsonb_build_object('status', 'stale', 'rev', r.rev);
  end if;

  -- id источника: выведенный из строки технаря. Занят строкой, которая
  -- показывает на ДРУГУЮ копию (id строк уникальны только внутри таблицы —
  -- копия стола переносила строки со старыми id), — тот же id с хвостом от
  -- адреса стола. Ищем по ВСЕМ вкладкам своего стола: прежний источник этой
  -- строки мог остаться в другой вкладке, и второй источник того же заказа
  -- ОС увидел бы дублем.
  foreach cand in array array[
    public.rows_claim_src_id(r.id),
    public.rows_claim_src_id(r.id) || '_' || substr(md5(p_page || '/' || tab), 1, 8)
  ] loop
    select * into src from public.desk_rows x
    where x.workspace_id = p_workspace and x.page_id = src_page and x.id = cand
    order by (x.mirror_page_id = p_page and coalesce(x.mirror_tab_id, '') = tab and x.mirror_row_id = r.id) desc nulls last,
             (x.mirror_row_id is null) desc,
             (x.tab_id = src_tab) desc
    limit 1;
    if not found then
      src_id := cand;
      src_found := false;
      exit;
    end if;
    if src.mirror_row_id is null
       or (src.mirror_page_id = p_page and coalesce(src.mirror_tab_id, '') = tab and src.mirror_row_id = r.id) then
      src_id := cand;
      src_found := true;
      exit;
    end if;
    -- Источник показывает на копию, которую ОС завёл из него сам (`os_<id>`:
    -- переезд к другому технарю, «Выдать заново» после «Вернуть»). Это тот же
    -- заказ: взять строку технаря вторым источником под id с хвостом значило
    -- бы посчитать заказ дважды — у ОС и у двух технарей. Решение прежнее —
    -- заказ отдан технарю, опрос ОС его не отменяет.
    if src.mirror_row_id = 'os_' || cand then
      return jsonb_build_object('status', 'released');
    end if;
  end loop;
  if src_id is null then
    return jsonb_build_object('status', 'src_conflict');
  end if;
  -- Источник помечен «заказ вернули технарю / копию потеряли» (releaseDeskOrders,
  -- ветка lost прохода) — решение Owner опрос ОС не отменяет.
  if src_found and src.mirror_row_id is null and btrim(coalesce(src.cells ->> 'osLostFor', '')) <> '' then
    return jsonb_build_object('status', 'released');
  end if;

  order_ms := coalesce(nullif(p_order_at, 0), nullif(greatest(coalesce(r.created_at, 0), coalesce(r.filled_at, 0)), 0), now_ms);

  if src_found then
    -- Повтор после сбоя или строка, у которой копию когда-то сняли: ячейки
    -- ложатся поверх (как rows_patch), адрес копии — на эту строку, вкладка —
    -- та, где источник уже лежит.
    src_tab := src.tab_id;
    update public.desk_rows x set
      cells = x.cells || coalesce(p_src_cells, '{}'::jsonb),
      extras = case when p_src_extras is null or jsonb_typeof(p_src_extras) = 'null' then x.extras else p_src_extras end,
      sync_hash = p_sync_hash,
      status_key = coalesce(src_key, x.status_key),
      mirror_page_id = p_page,
      mirror_tab_id = tab,
      mirror_row_id = r.id,
      highlight = true,
      updated_at = now_ms
    where x.workspace_id = p_workspace and x.page_id = src_page and x.tab_id = src_tab and x.id = src_id;
  else
    insert into public.desk_rows (
      workspace_id, page_id, tab_id, id, cells, extras, sort_order,
      created_at, updated_at, highlight, sync_hash, status_key, mirror_page_id, mirror_tab_id, mirror_row_id
    ) values (
      p_workspace, src_page, src_tab, src_id,
      coalesce(p_src_cells, '{}'::jsonb),
      case when p_src_extras is null or jsonb_typeof(p_src_extras) = 'null' then null else p_src_extras end,
      public.rows_append_order(p_workspace, src_page, src_tab),
      order_ms, now_ms, true, p_sync_hash, src_key, p_page, tab, r.id
    );
  end if;

  -- Метка на строке технаря. Ячейки технаря не трогаем: заказ его, поля
  -- совпадают с источником (он из них и собран — сверено по rev).
  -- desk_rows_guard пропускает: os_uid ставит сам ОС и на себя.
  update public.desk_rows x set
    os_uid = me,
    tech_uid = acl.responsible_uid,
    status_key = acl.os_status_key,
    sync_hash = p_sync_hash,
    src_page_id = src_page,
    src_tab_id = src_tab,
    src_row_id = src_id
  where x.workspace_id = p_workspace and x.page_id = p_page and x.tab_id = tab and x.id = r.id;

  return jsonb_build_object('status', 'claimed', 'srcPageId', src_page, 'srcTabId', src_tab, 'srcRowId', src_id,
    'techUid', acl.responsible_uid);
end;
$$;

create or replace function public.tg_link_client(
  p_workspace text,
  p_chat_id bigint,
  p_page_id text,
  p_tab_id text,
  p_row_id text,
  p_label text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  v_tab text := coalesce(p_tab_id, '');
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_row public.tg_chat_clients;
begin
  if me is null or p_workspace is null
     or not (
       p_workspace in (select public.tg_my_workspaces())
       or coalesce(public.rows_is_owner(p_workspace), false)
     ) then
    raise exception 'tg_link_client: привязывать чаты могут те, кому открыт раздел Telegram' using errcode = '42501';
  end if;
  if p_chat_id is null or p_chat_id = 0 then
    raise exception 'tg_link_client: нет чата' using errcode = '22023';
  end if;

  if coalesce(p_row_id, '') = '' then
    delete from public.tg_chat_clients where workspace_id = p_workspace and chat_id = p_chat_id;
    return null;
  end if;

  -- Строка есть и читается привязывающим — те же наборы, что у desk_rows_read.
  if not exists (
    select 1 from public.desk_rows r
    where r.workspace_id = p_workspace
      and r.page_id = p_page_id
      and r.tab_id = v_tab
      and r.id = p_row_id
      and (
        ((r.workspace_id in (select public.rows_read_all_workspaces())
          or (r.workspace_id, r.page_id) in (select a.workspace_id, a.page_id from public.rows_readable_pages() a))
         and (r.workspace_id, r.page_id) not in (select h.workspace_id, h.page_id from public.rows_owner_only_hidden() h))
        or (r.os_uid is not null and r.os_uid = me)
      )
  ) then
    raise exception 'tg_link_client: клиент не найден или нет доступа к его столу' using errcode = '42501';
  end if;

  insert into public.tg_chat_clients (workspace_id, chat_id, page_id, tab_id, row_id, label, bound_by, bound_at)
  values (p_workspace, p_chat_id, p_page_id, v_tab, p_row_id, left(btrim(coalesce(p_label, '')), 200), me, v_now)
  on conflict (workspace_id, chat_id) do update set
    page_id = excluded.page_id,
    tab_id = excluded.tab_id,
    row_id = excluded.row_id,
    label = excluded.label,
    bound_by = excluded.bound_by,
    bound_at = excluded.bound_at
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

create or replace function public.send_chat_message(
  p_workspace text,
  p_kind text,
  p_page text,
  p_row text,
  p_peer text,
  p_message jsonb
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_id text;
  v_thread text;
  v_page text := coalesce(p_page, '');
  v_row text := coalesce(p_row, '');
  v_chat text := '';
  v_a text;
  v_b text;
  v_text text;
  v_name text;
  v_out jsonb;
begin
  if me is null or p_workspace is null or not public.rows_is_member(p_workspace) then
    raise exception 'send_chat_message: не участник workspace' using errcode = '42501';
  end if;
  if p_message is null or jsonb_typeof(p_message) <> 'object' then
    raise exception 'send_chat_message: сообщение должно быть объектом' using errcode = '22023';
  end if;
  if p_kind = 'ws' then
    v_thread := 'ws';
    v_page := '';
    v_row := '';
  elsif p_kind in ('page', 'row') then
    if v_page = '' or (p_kind = 'row' and v_row = '') then
      raise exception 'send_chat_message: нет стола или строки' using errcode = '22023';
    end if;
    if not public.rows_can_access_page(p_workspace, v_page) then
      raise exception 'send_chat_message: нет доступа к столу' using errcode = '42501';
    end if;
    if p_kind = 'page' then
      v_row := '';
      v_thread := 'page:' || v_page;
    else
      v_thread := 'row:' || v_page || ':' || v_row;
    end if;
  elsif p_kind = 'dm' then
    if coalesce(p_peer, '') = '' or p_peer = me then
      raise exception 'send_chat_message: нет собеседника' using errcode = '22023';
    end if;
    if not exists (select 1 from public.rows_members m where m.workspace_id = p_workspace and m.uid = p_peer) then
      raise exception 'send_chat_message: собеседник не участник workspace' using errcode = '42501';
    end if;
    v_a := least(me, p_peer);
    v_b := greatest(me, p_peer);
    v_chat := v_a || '_' || v_b;
    v_thread := 'dm:' || v_chat;
    v_page := '';
    v_row := '';
  else
    raise exception 'send_chat_message: неверный вид нити' using errcode = '22023';
  end if;

  v_id := p_message ->> 'id';
  if v_id is null or v_id !~ '^[A-Za-z0-9_-]{1,100}$' then
    v_id := 'msg_' || md5(random()::text || clock_timestamp()::text);
  end if;
  v_text := left(coalesce(p_message ->> 'text', ''), 4000);
  v_name := left(coalesce(p_message ->> 'authorName', ''), 200);

  insert into public.chat_messages (workspace_id, id, kind, thread, page_id, row_id, chat_id, peer_a, peer_b,
    author_uid, author_name, author_photo_url, text, created_at, edited_at, deleted,
    reply_to_id, reply_to_author_name, reply_to_text)
  values (p_workspace, v_id, p_kind, v_thread, v_page, v_row, v_chat, v_a, v_b,
    me, v_name, left(p_message ->> 'authorPhotoURL', 1000), v_text, v_now, null, false,
    left(p_message ->> 'replyToId', 100), left(p_message ->> 'replyToAuthorName', 200), left(p_message ->> 'replyToText', 140))
  on conflict (workspace_id, id) do nothing;

  if p_kind = 'dm' then
    insert into public.chat_dm_meta as d (workspace_id, chat_id, peer_a, peer_b, last_text, last_at, last_from_uid, last_from_name)
    values (p_workspace, v_chat, v_a, v_b, left(v_text, 140), v_now, me, v_name)
    on conflict (workspace_id, chat_id) do update set
      last_text = excluded.last_text,
      last_at = excluded.last_at,
      last_from_uid = excluded.last_from_uid,
      last_from_name = excluded.last_from_name
    where excluded.last_at >= d.last_at;
  end if;

  -- Отдаём только своё сообщение этой нити: повтор чужого id раньше
  -- возвращал любое сообщение workspace (другой нити, закрытого стола).
  select to_jsonb(m) into v_out from public.chat_messages m
  where m.workspace_id = p_workspace and m.id = v_id and m.author_uid = me and m.thread = v_thread;
  if v_out is null then
    raise exception 'send_chat_message: такой id сообщения уже занят' using errcode = '23505';
  end if;
  return v_out;
end;
$$;

-- Файлы строк в Storage (row-files). Как в 20261034 — в блоке с перехватом:
-- без прав на схему storage файл миграции не должен падать.
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
    -- Файлы строк стола «только для Owner» ({ws}/{стол}/{строка}/…) — только Owner.
    if exists (select 1 from public.rows_owner_only o where o.workspace_id = ws and o.page_id = parts[2])
       and not coalesce(public.rows_is_owner(ws), false) then
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
-- Версия схемы.
-- ---------------------------------------------------------------------
create or replace function public.nova_schema_version() returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select '20261041'
$$;
revoke all on function public.nova_schema_version() from public, anon, authenticated;
grant execute on function public.nova_schema_version() to anon, authenticated;
