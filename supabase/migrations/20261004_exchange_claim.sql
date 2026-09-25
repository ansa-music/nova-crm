-- =====================================================================
-- Nova CRM — заказы с биржи «Заказы» тоже подхватываются на стол ОС
-- (повторяемый файл, 25.09.2026).
--
-- Жалоба Nurba: у строки с биржи нет кнопки «Готово?» (просьба к ОС
-- сменить статус). Кнопка есть только у строки-заказа, которую ВЕДЁТ ОС
-- (os_uid + src_*), а автоподхват (20261002, rows_os_claimable /
-- rows_os_claim_order) строки с order_id пропускал: у них был свой путь
-- удаления — rows_drop_order_row, который строку с os_uid не трогал.
--
--   А. rows_os_claimable и rows_os_claim_order — те же, что в 20261002, без
--      условия «не с биржи». Статус 'exchange' больше не отдаётся (клиент
--      его по-прежнему понимает — для базы без этого файла).
--   Б. rows_drop_order_row — удаление заказа на «Заказах» убирает и
--      ПОДХВАЧЕННУЮ строку (с os_uid) вместе с её источником на столе ОС:
--      иначе строка технаря осталась бы висеть «под ОС», а проход стола ОС
--      вернул бы её технарю как сироту.
--   В. nova_schema_version() = '20261004'.
--
-- Правки этих функций — только в этом файле или в файле после него.
-- =====================================================================

-- ---------------------------------------------------------------------
-- А1. Что ОС может забрать (копия из 20261002 без `r.order_id is null`).
-- ---------------------------------------------------------------------
create or replace function public.rows_os_claimable(p_workspace text, p_limit integer default 200)
returns setof jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with me as (
    select btrim(n.os_value) as nick, public.rows_uid() as uid
    from public.rows_my_os_nicks() n
    where n.workspace_id = p_workspace
      and public.rows_has_role(p_workspace, 'os')
      and p_workspace in (select public.rows_writable_workspaces())
  ), returned as (
    select s.id
    from me
    join public.desk_rows s on s.workspace_id = p_workspace and s.page_id = 'osdesk_' || me.uid
    where (s.mirror_row_id is null and btrim(coalesce(s.cells ->> 'osLostFor', '')) <> '')
       or s.mirror_row_id = 'os_' || s.id
  )
  select jsonb_build_object(
    'row', to_jsonb(r),
    'techUid', a.responsible_uid,
    'osKey', a.os_key,
    'statusKey', a.os_status_key
  )
  from me
  join public.rows_page_acl a on a.workspace_id = p_workspace
  join public.desk_rows r
    on r.workspace_id = a.workspace_id and r.page_id = a.page_id and r.tab_id = a.os_keys_tab
  where me.nick <> ''
    and not a.os_desk
    and not starts_with(a.page_id, 'osdesk_')
    and a.responsible_uid is not null
    and a.os_key is not null
    and a.os_status_key is not null
    and a.os_keys_tab is not null
    and r.os_uid is null
    and not starts_with(r.id, 'os_')
    and btrim(coalesce(r.cells ->> a.os_key, '')) = me.nick
    and btrim(coalesce(r.cells ->> 'osReleasedFrom', '')) <> me.nick
    -- Второе имя — запасной id источника при совпадении (см. rows_os_claim_order).
    and public.rows_claim_src_id(r.id) not in (select id from returned)
    and public.rows_claim_src_id(r.id) || '_' || substr(md5(r.page_id || '/' || r.tab_id), 1, 8)
        not in (select id from returned)
  order by r.updated_at, r.page_id, r.id
  limit least(greatest(coalesce(p_limit, 200), 1), 1000)
$$;

-- ---------------------------------------------------------------------
-- А2. Забрать заказ (копия из 20261002 без ветки «с биржи → exchange»).
--     Описание параметров и ответов — в 20261002_os_sync.sql, А3.
-- ---------------------------------------------------------------------
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

revoke all on function public.rows_os_claimable(text, integer) from public, anon, authenticated;
revoke all on function public.rows_os_claim_order(text, text, text, text, bigint, text, jsonb, jsonb, text, bigint, text) from public, anon, authenticated;
grant execute on function
  public.rows_os_claimable(text, integer),
  public.rows_os_claim_order(text, text, text, text, bigint, text, jsonb, jsonb, text, bigint, text)
  to anon, authenticated;

-- ---------------------------------------------------------------------
-- Б. Удаление заказа с «Заказов» убирает его строку у технаря — и когда её
--    уже подхватил ОС. Права прежние (20260926): Owner, Тимлид, роль ОС.
--    Строка — ровно по адресу и с этим order_id; источник удаляется, только
--    если лежит на столе ОС (osdesk_…) и показывает ровно на эту строку.
-- ---------------------------------------------------------------------
create or replace function public.rows_drop_order_row(
  p_workspace text,
  p_page text,
  p_tab text,
  p_row text,
  p_order text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.desk_rows%rowtype;
begin
  if public.rows_uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if coalesce(p_order, '') = '' then
    raise exception 'order id required' using errcode = '22023';
  end if;
  if p_workspace not in (select public.rows_writable_workspaces()) then
    raise exception 'rows storage is not writable' using errcode = '42501';
  end if;
  -- coalesce обязателен: для не участника rows_is_owner отдаёт NULL, а
  -- `if not NULL` в plpgsql молча пропускает — посторонний прошёл бы.
  if not coalesce(
    public.rows_is_owner(p_workspace)
    or public.rows_is_teamlead(p_workspace)
    or public.rows_has_role(p_workspace, 'os'),
    false
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from public.desk_rows x
  where x.workspace_id = p_workspace
    and x.page_id = p_page
    and x.tab_id = coalesce(p_tab, '')
    and x.id = p_row
    and x.order_id = p_order
  returning * into r;
  if not found then
    return false;
  end if;
  if r.os_uid is not null and r.src_page_id is not null and r.src_row_id is not null
     and starts_with(r.src_page_id, 'osdesk_') then
    delete from public.desk_rows s
    where s.workspace_id = p_workspace
      and s.page_id = r.src_page_id
      and s.tab_id = coalesce(r.src_tab_id, '')
      and s.id = r.src_row_id
      and s.mirror_page_id = r.page_id
      and coalesce(s.mirror_tab_id, '') = r.tab_id
      and s.mirror_row_id = r.id;
  end if;
  return true;
end;
$$;

revoke all on function public.rows_drop_order_row(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.rows_drop_order_row(text, text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- В. Версия схемы — ПОСЛЕДНЕЙ строкой файла.
-- ---------------------------------------------------------------------
create or replace function public.nova_schema_version() returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select '20261004'::text
$$;

revoke all on function public.nova_schema_version() from public, anon, authenticated;
grant execute on function public.nova_schema_version() to anon, authenticated;
