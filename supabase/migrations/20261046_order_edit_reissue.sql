-- =====================================================================
-- 20261046: правка опубликованного заказа и «Перевыдать» из «В столах»
-- (просьба Nurba 12.10.2026: «у ОС и тимлидов должна быть возможность
-- перевыдать заказ и редактировать опубликованный заказ»).
--
-- Обе операции — ОТДЕЛЬНЫМИ функциями. `order_write` не тронута: от неё
-- зависят выдача, отклики и «Рандом» у всех, и новая копия ради двух веток
-- была бы лишним риском.
--
--   А. order_edit(ws, id, args) — меняет поля заказа (клиент, номер, ссылка,
--      дедлайн, срочность, цена, персонажи, минуты, пожелания). Только пока
--      заказ «Открыт» или «Выдан»: у заказа в столе правят строку стола, а
--      не карточку на «Заказах». Меняются только переданные ключи.
--   Б. order_reissue(ws, id) — заказ «В столе» возвращается в «Открытые»:
--      строка в столе технаря удаляется, отклики и выдача сбрасываются.
--      НЕ для заказов, которые ведёт ОС (выдан со стола ОС или подхвачен ОС):
--      у них на столе ОС лежит строка-источник, и перевыдают их там —
--      «снять технаря» → «Всем технарям». Здесь такой заказ — отказ NV409,
--      ничего не меняется.
--   В. nova_schema_version() = '20261046'.
--
-- Права — те же, что у «выдать / отозвать / отменить / удалить» в
-- order_write: Owner, Тимлид (и Тимлид+) — любой заказ; ОС — свой.
-- Файл идемпотентен.
-- =====================================================================

-- ---------------------------------------------------------------------
-- А. Правка опубликованного заказа.
-- ---------------------------------------------------------------------
create or replace function public.order_edit(p_workspace text, p_id text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_full boolean;
  v_issue boolean;
  r public.work_orders%rowtype;
  d jsonb;
begin
  if me is null or not coalesce(public.rows_is_member(p_workspace), false) then
    raise exception 'order_edit: не участник workspace' using errcode = '42501';
  end if;
  if p_id is null or p_id !~ '^[A-Za-z0-9_-]{1,100}$' then
    raise exception 'order_edit: неверный id заказа' using errcode = '22023';
  end if;
  if p_args is null or coalesce(jsonb_typeof(p_args), '') <> 'object' then
    p_args := '{}'::jsonb;
  end if;
  v_full := coalesce(public.rows_is_owner(p_workspace), false) or coalesce(public.rows_is_teamlead(p_workspace), false);
  v_issue := v_full or coalesce(public.rows_has_role(p_workspace, 'os'), false);

  select * into r from public.work_orders o
  where o.workspace_id = p_workspace and o.id = p_id
  for update;
  if not found or r.deleted then
    raise exception 'order_edit: заказа нет' using errcode = 'P0002';
  end if;
  if not (v_full or (v_issue and r.created_by = me)) then
    raise exception 'order_edit: заказ правят его ОС, Тимлид и Owner' using errcode = '42501';
  end if;
  if r.status not in ('open', 'assigned') then
    raise exception 'order_edit: правится только заказ, который ещё не в столе' using errcode = '42501';
  end if;

  d := r.data;
  if p_args ? 'client' then
    d := d || jsonb_build_object('client', public.nova_jtext(p_args, 'client', 300));
  end if;
  if p_args ? 'phone' then
    d := d || jsonb_build_object('phone', public.nova_jtext(p_args, 'phone', 64));
  end if;
  if p_args ? 'link' then
    d := d || jsonb_build_object('link', public.nova_jtext(p_args, 'link', 2000));
  end if;
  if p_args ? 'note' then
    d := d || jsonb_build_object('note', public.nova_jtext(p_args, 'note', 2000));
  end if;
  if p_args ? 'deadline' then
    d := d || jsonb_build_object('deadline', public.nova_jnum(p_args, 'deadline'));
  end if;
  if p_args ? 'price' then
    d := d || jsonb_build_object('price', public.nova_jnum(p_args, 'price'));
  end if;
  if p_args ? 'persons' then
    d := d || jsonb_build_object('persons', public.nova_jnum(p_args, 'persons'));
  end if;
  if p_args ? 'minutes' then
    d := d || jsonb_build_object('minutes', public.nova_jnum(p_args, 'minutes'));
  end if;
  if p_args ? 'urgency' then
    if coalesce(p_args ->> 'urgency', '') not in ('fire', 'urgent', 'normal') then
      raise exception 'order_edit: срочность — fire, urgent или normal' using errcode = '22023';
    end if;
    d := d || jsonb_build_object('urgency', p_args ->> 'urgency');
  end if;
  if btrim(coalesce(d ->> 'client', '')) = '' then
    raise exception 'order_edit: у заказа должен быть клиент' using errcode = '22023';
  end if;

  d := d || jsonb_build_object('updatedAt', v_now);
  update public.work_orders o set
    data = d,
    updated_at = v_now
  where o.workspace_id = p_workspace and o.id = p_id
  returning * into r;
  return r.data || jsonb_build_object('rev', r.rev, 'deleted', r.deleted);
end;
$$;

revoke all on function public.order_edit(text, text, jsonb) from public;
grant execute on function public.order_edit(text, text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Б. «Перевыдать»: заказ из стола — обратно в открытые.
-- ---------------------------------------------------------------------
create or replace function public.order_reissue(p_workspace text, p_id text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_full boolean;
  v_issue boolean;
  r public.work_orders%rowtype;
  d jsonb;
  v_page text;
begin
  if me is null or not coalesce(public.rows_is_member(p_workspace), false) then
    raise exception 'order_reissue: не участник workspace' using errcode = '42501';
  end if;
  if p_id is null or p_id !~ '^[A-Za-z0-9_-]{1,100}$' then
    raise exception 'order_reissue: неверный id заказа' using errcode = '22023';
  end if;
  v_full := coalesce(public.rows_is_owner(p_workspace), false) or coalesce(public.rows_is_teamlead(p_workspace), false);
  v_issue := v_full or coalesce(public.rows_has_role(p_workspace, 'os'), false);

  select * into r from public.work_orders o
  where o.workspace_id = p_workspace and o.id = p_id
  for update;
  if not found or r.deleted then
    raise exception 'order_reissue: заказа нет' using errcode = 'P0002';
  end if;
  if not (v_full or (v_issue and r.created_by = me)) then
    raise exception 'order_reissue: заказом распоряжаются его ОС, Тимлид и Owner' using errcode = '42501';
  end if;
  if r.status <> 'taken' then
    raise exception 'order_reissue: перевыдаётся только заказ, который уже в столе' using errcode = '42501';
  end if;
  d := r.data;
  -- Заказ со стола ОС: его строка-источник лежит на столе ОС, перевыдают там.
  if jsonb_typeof(d -> 'osSource') = 'object' then
    raise exception 'order_reissue: заказ со стола ОС перевыдаёт ОС на своём столе' using errcode = 'NV409';
  end if;

  v_page := nullif(d ->> 'takenPageId', '');
  if v_page is not null then
    if p_workspace not in (select public.rows_writable_workspaces()) then
      raise exception 'order_reissue: хранилище строк недоступно для записи' using errcode = '42501';
    end if;
    -- Строку ищем по id заказа на ЛЮБОЙ вкладке стола: её могли перенести в
    -- новый период раньше, чем заказ узнал новый адрес. Подхваченную ОС
    -- (os_uid) не трогаем вовсе — сначала проверка, потом удаление.
    if exists (
      select 1 from public.desk_rows x
      where x.workspace_id = p_workspace and x.page_id = v_page and x.order_id = p_id and x.os_uid is not null
    ) then
      raise exception 'order_reissue: заказ уже ведёт ОС — перевыдайте его со стола ОС' using errcode = 'NV409';
    end if;
    delete from public.desk_rows x
    where x.workspace_id = p_workspace and x.page_id = v_page and x.order_id = p_id;
  end if;

  d := d || jsonb_build_object(
    'status', 'open',
    'claims', '{}'::jsonb,
    'assignedUid', null, 'assignedName', null, 'assignedAt', null, 'assignedBy', null,
    'takenAt', null, 'takenPageId', null, 'takenSubPageId', null, 'takenRowId', null,
    'updatedAt', v_now);
  update public.work_orders o set
    data = d,
    status = 'open',
    assigned_uid = null,
    updated_at = v_now
  where o.workspace_id = p_workspace and o.id = p_id
  returning * into r;
  return r.data || jsonb_build_object('rev', r.rev, 'deleted', r.deleted);
end;
$$;

revoke all on function public.order_reissue(text, text) from public;
grant execute on function public.order_reissue(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- В. Версия схемы — ПОСЛЕДНЕЙ строкой файла.
-- ---------------------------------------------------------------------
create or replace function public.nova_schema_version() returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select '20261046'
$$;
revoke all on function public.nova_schema_version() from public, anon, authenticated;
grant execute on function public.nova_schema_version() to anon, authenticated;
