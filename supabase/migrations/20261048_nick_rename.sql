-- =====================================================================
-- Nova CRM — переименование ника (13.10.2026).
--
-- Просьба Nurba: «добавь функцию редактирования привязываемого ника —
-- только Owner и Тимлидам». До этого ники не переименовывались вовсе.
--
-- Меняется ТОЛЬКО подпись варианта (label). Значение (value) прежнее: на
-- нём висят ячейки столов, заказы, счётчики, оценки и копия прав
-- rows_members.os_nick_value — им переименование не видно. Подпись лежит в
-- двух местах, оба пишутся одной транзакцией:
--   * список в настройках workspace (responsibleOptions / techNickOptions /
--     otherNickOptions);
--   * копия на участнике, который ник держит (osNick / techNick / otherNick)
--     — по ней человека подписывают везде (workNickOf на клиенте).
--
-- Кто: Owner и Тимлид / Тимлид+ (та же проверка, что у core_nick_add).
-- Ник, который держит человек, чей ник спрашивающему трогать не положено
-- (свой у Тимлида, ник Owner и Тимлид+ у Тимлида, ник создателя и других
-- Owner у выданного Owner — core_can_manage_member), не переименовывается:
-- иначе Тимлид менял бы подпись Owner в обход правила «ник Owner закрепляет
-- сам Owner».
--
-- Файл повторяемый, ничего существующего не меняет и nova_schema_version
-- НЕ поднимает: отсутствие функции клиент узнаёт по коду ответа.
-- =====================================================================

create or replace function public.core_nick_rename(p_workspace text, p_kind text, p_value text, p_label text) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  meta record;
  ws public.core_docs%rowtype;
  v_opts jsonb;
  v_out jsonb := '[]'::jsonb;
  v_label text := left(btrim(coalesce(p_label, '')), 32);
  v_old text;
  e jsonb;
  holder record;
  v_uids jsonb := '[]'::jsonb;
begin
  select * into meta from public.core_nick_meta(p_kind);
  if not found then
    raise exception 'core_nick_rename: вид ника os | tech | other' using errcode = '22023';
  end if;
  if me is null or not (coalesce(public.rows_is_owner(p_workspace), false) or coalesce(public.rows_is_teamlead(p_workspace), false))
     or p_workspace not in (select public.rows_writable_workspaces()) then
    raise exception 'core_nick_rename: ники ведёт руководство' using errcode = '42501';
  end if;
  if v_label = '' then
    raise exception 'Введите ник' using errcode = '22023';
  end if;
  -- Пустое значение — не ник: без этой проверки «держателями» при кривом
  -- списке оказались бы все, у кого поле значения пустое.
  if coalesce(p_value, '') = '' then
    raise exception 'Этого ника уже нет в списке' using errcode = 'P0002';
  end if;
  -- Замки в том же порядке, что у core_nick_link: сначала участник, потом
  -- настройки — иначе две правки одного ника ждали бы друг друга по кругу.
  perform 1 from public.core_docs c
  where c.workspace_id = p_workspace and c.kind = 'member' and c.parent_id = '' and not c.deleted
    and (c.data ->> meta.value_key) = p_value
  for update;
  select * into ws from public.core_docs c
  where c.workspace_id = p_workspace and c.kind = 'workspace' and c.parent_id = '' and c.id = p_workspace for update;
  v_opts := case when found and not ws.deleted and jsonb_typeof(ws.data -> meta.list_key) = 'array' then ws.data -> meta.list_key else '[]'::jsonb end;
  for e in select x from jsonb_array_elements(v_opts) x loop
    if (e ->> 'value') = p_value then
      v_old := coalesce(e ->> 'label', '');
      v_out := v_out || jsonb_build_array(e || jsonb_build_object('label', v_label));
    else
      -- Две одинаковые подписи в одном списке не отличить ни в выборе, ни в заказах.
      if lower(btrim(coalesce(e ->> 'label', ''))) = lower(v_label) then
        raise exception 'Ник «%» уже есть в списке', v_label using errcode = '23505';
      end if;
      v_out := v_out || jsonb_build_array(e);
    end if;
  end loop;
  if v_old is null then
    raise exception 'Этого ника уже нет в списке' using errcode = 'P0002';
  end if;
  -- Кто ник держит: его подпись сменится везде — значит, спрашивающий должен
  -- быть вправе вести ник этого человека.
  for holder in
    select c.id, c.data from public.core_docs c
    where c.workspace_id = p_workspace and c.kind = 'member' and c.parent_id = '' and not c.deleted
      and (c.data ->> meta.value_key) = p_value
  loop
    if not public.core_can_manage_member(p_workspace, holder.id, holder.data ->> 'role') then
      raise exception 'Ник «%» закреплён за % — менять его ник вам нельзя', v_old, public.core_member_label(holder.data) using errcode = '42501';
    end if;
    v_uids := v_uids || to_jsonb(holder.id);
  end loop;
  if v_old is distinct from v_label then
    update public.core_docs c set data = c.data || jsonb_build_object(meta.list_key, v_out)
    where c.workspace_id = p_workspace and c.kind = 'workspace' and c.parent_id = '' and c.id = p_workspace;
  end if;
  -- Копия подписи на участнике. Пишется и когда в списке подпись уже новая:
  -- так чинится копия, отставшая от списка (подпись меняли в редакторе
  -- вариантов «Ответственный», который участников не трогает).
  update public.core_docs c set data = c.data || jsonb_build_object(meta.label_key, v_label)
  where c.workspace_id = p_workspace and c.kind = 'member' and c.parent_id = '' and not c.deleted
    and (c.data ->> meta.value_key) = p_value
    and (c.data ->> meta.label_key) is distinct from v_label;
  return jsonb_build_object('value', p_value, 'label', v_label, 'oldLabel', v_old, 'uids', v_uids);
end;
$$;

revoke all on function public.core_nick_rename(text, text, text, text) from public;
grant execute on function public.core_nick_rename(text, text, text, text) to anon, authenticated;
