-- =====================================================================
-- Nova CRM — «Общая таблица»: удаление заказа видно в ленте (30.09.2026).
--
-- Просьба Nurba: «общая таблица — сделай, чтобы можно было удалять отсюда».
-- Удаляет клиент (Owner и Тимлид+: политика удаления строк и так пускает
-- `rows_edit_all_workspaces`), а история пишется триггером `desk_rows_events`.
-- У удаления в историю шло только «строка удалена»: строки больше нет, и в
-- «Ленте изменений» не понять, какой заказ убрали и кто. Теперь в `old_value`
-- события `deleted` кладётся имя клиента (ячейка «client» — ключ стола ОС).
--
-- desk_rows_events — полная копия из 20261036_leadplus.sql с одной правкой
-- (ветка DELETE); правки функции — только здесь или новее. Повторяемый файл.
-- =====================================================================

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
    -- Имя клиента (ключ «client» стола ОС, как «technician»/«price» ниже) —
    -- в old_value: строки больше нет, и в ленте иначе было бы «заказ · удалён».
    insert into public.order_events (workspace_id, order_key, page_id, tab_id, row_id, kind, old_value, actor_uid, at)
    values (old.workspace_id, v_key, old.page_id, old.tab_id, old.id, 'deleted',
            left(nullif(btrim(coalesce(old.cells ->> 'client', '')), ''), 200), v_actor, v_at);
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

-- ---------------------------------------------------------------------
-- Версия схемы.
-- ---------------------------------------------------------------------
create or replace function public.nova_schema_version() returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select '20261043'
$$;
revoke all on function public.nova_schema_version() from public, anon, authenticated;
grant execute on function public.nova_schema_version() to anon, authenticated;
