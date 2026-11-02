-- =====================================================================
-- 20261054: руководство ставит и снимает отклик ЗА технаря
-- (просьба Nurba 02.11.2026: «тимлид и выше могли отозвать отклик технаря»,
-- «у Owner — откликнуться за другого или наоборот убрать отклик; начиная с
-- Тимлида так могут»).
--
-- Отдельной функцией, как order_edit / order_reissue: `order_write` не
-- тронута — от неё зависят выдача, отклики и «Рандом» у всех.
--
--   order_claim_for(ws, id, args { uid, on, name }) — у ОТКРЫТОГО заказа:
--     on = true  — отклик за участника, который работает за столом (роль
--                  Технаря основной или второй, или Owner — как у `claim`);
--     on = false — снять его отклик.
--   Только Owner, Тимлид и Тимлид+ (`rows_is_teamlead`). Повтор (отклик уже
--   есть / уже снят) — заказ как есть, без ошибки и без новой отметки времени.
--
-- nova_schema_version НЕ поднимаем: без функции клиент отвечает тостом
-- «нужно обновить базу» (OrderSqlOutdated), остальное от неё не зависит.
-- Файл идемпотентен.
-- =====================================================================

create or replace function public.order_claim_for(p_workspace text, p_id text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_uid text;
  v_on boolean;
  v_has boolean;
  r public.work_orders%rowtype;
  d jsonb;
begin
  if me is null or not coalesce(public.rows_is_member(p_workspace), false) then
    raise exception 'order_claim_for: не участник workspace' using errcode = '42501';
  end if;
  if p_id is null or p_id !~ '^[A-Za-z0-9_-]{1,100}$' then
    raise exception 'order_claim_for: неверный id заказа' using errcode = '22023';
  end if;
  if not (coalesce(public.rows_is_owner(p_workspace), false) or coalesce(public.rows_is_teamlead(p_workspace), false)) then
    raise exception 'order_claim_for: отклик за другого ставят и снимают Owner и Тимлид' using errcode = '42501';
  end if;
  if p_args is null or coalesce(jsonb_typeof(p_args -> 'uid'), '') <> 'string' or (p_args ->> 'uid') = '' then
    raise exception 'order_claim_for: чей отклик?' using errcode = '22023';
  end if;
  v_uid := left(p_args ->> 'uid', 200);
  v_on := coalesce(jsonb_typeof(p_args -> 'on'), '') = 'boolean' and (p_args ->> 'on')::boolean;

  select * into r from public.work_orders o
  where o.workspace_id = p_workspace and o.id = p_id
  for update;
  if not found or r.deleted then
    raise exception 'order_claim_for: заказа нет' using errcode = 'P0002';
  end if;
  if r.status <> 'open' then
    raise exception 'order_claim_for: отклик — только у открытого заказа' using errcode = '42501';
  end if;

  v_has := coalesce((r.data -> 'claims') ? v_uid, false);
  if v_on = v_has then
    return r.data || jsonb_build_object('rev', r.rev, 'deleted', r.deleted);
  end if;

  if v_on then
    if not exists (
      select 1 from public.rows_members m
      where m.workspace_id = p_workspace and m.uid = v_uid
        and (m.role in ('manager', 'owner') or 'manager' = any(m.extra_roles))
    ) then
      raise exception 'order_claim_for: откликаются технари и Owner' using errcode = '42501';
    end if;
    d := jsonb_set(r.data, '{claims}', coalesce(r.data -> 'claims', '{}'::jsonb)
      || jsonb_build_object(v_uid, jsonb_build_object('uid', v_uid, 'name', public.nova_jtext(p_args, 'name', 200), 'at', v_now)));
  else
    d := jsonb_set(r.data, '{claims}', (r.data -> 'claims') - v_uid);
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

revoke all on function public.order_claim_for(text, text, jsonb) from public;
grant execute on function public.order_claim_for(text, text, jsonb) to anon, authenticated;
