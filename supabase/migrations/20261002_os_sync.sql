-- =====================================================================
-- Nova CRM — синхронизация стола ОС и столов технарей в САМОЙ базе
-- (жалобы Nurba 24.09.2026). Повторяемый файл: его можно прогнать ещё раз
-- целиком. Три части:
--
--   А. ОС сам забирает заказ, записанный ЛЮБЫМ человеком в своём столе с
--      ником ОС в столбце «ОС»/«Ответственный» («если пользователь напишет в
--      странице и поставит ОС ответственным, то у ОС тоже должно
--      появиться»): rows_os_claimable, rows_os_claim_order,
--      rows_os_release_claim и копия карты столбцов стола в rows_page_acl.
--   Б. Статус, который поставили на столе ОС, доезжает до строки технаря
--      ТОЙ ЖЕ записью (триггер desk_rows_os_status_push): «ОС поставил
--      статус, а у технаря его нет». Раньше статус вёз только проход стола
--      в браузере ОС — закрыл стол через полсекунды или заблокировал
--      телефон, и статус ждал следующего открытия стола.
--   В. nova_schema_version() — по ней клиент видит, что SQL не вставлен
--      или устарел, и говорит об этом Owner.
--
-- desk_rows_guard ТЕПЕРЬ ЖИВЁТ ЗДЕСЬ: create or replace целиком — текст из
-- 20261001_tech_fill.sql плюс ветка «ОС возвращает строку технарю».
-- Правки guard делать ТОЛЬКО в этом файле (или в файле после него), не в
-- 20261001 и не в 20260923: там остались прежние версии, которые этот файл
-- перекрывает. Повтор одного раннего файла вернул бы старый guard без ветки
-- возврата — поэтому scripts/supabase-sql.mjs накатывает изменившийся файл
-- И ВСЕ файлы после него, а «Скопировать SQL» берёт все файлы по порядку.
--
-- Деплой SQL сам НЕ накатывает — Owner вставляет файл в SQL Editor. Пока
-- его нет, клиент молча работает по-старому (нет функции — PGRST202/42883,
-- нет столбца — 42703/PGRST204).
-- =====================================================================

-- ---------------------------------------------------------------------
-- А1. Копия карты столбцов стола технаря (page.osFieldKeys) в копии прав:
--     вкладка, для которой карта посчитана, ключ столбца ОС и ключ статуса.
--     Пишет её обычная сверка прав (desiredPageRow): Owner — все столы,
--     Тимлид, ответственный — свой. Политики и страж rows_page_acl уже
--     пускают ровно этих людей — тех же, кто пишет osFieldKeys в Firestore.
--     У стола ОС поля пустые: забирать с него нечего.
-- ---------------------------------------------------------------------
alter table public.rows_page_acl
  add column if not exists os_keys_tab text,
  add column if not exists os_key text,
  add column if not exists os_status_key text;

-- id строки-источника выводится из строки технаря — как sourceRowIdFor()
-- в services/rows/osOrderAdoption.ts: повтор (и перенос Owner) пишет в ту
-- же строку, а не заводит вторую.
create or replace function public.rows_claim_src_id(p_row text) returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select 'adopt_' || regexp_replace(coalesce(p_row, ''), '[^A-Za-z0-9_-]', '', 'g')
$$;

-- ---------------------------------------------------------------------
-- А2. Что ОС может забрать: строки столов технарей во вкладке, для которой
--     стол опубликовал карту, где в столбце ОС стоит МОЙ ник и строка ещё
--     ничья. SECURITY INVOKER — считается под политиками спрашивающего (ОС
--     и так читает все столы), чужого через неё не узнать. Один запрос на
--     весь workspace вместо обхода столов.
--
--     Не предлагается (и не забирается, см. rows_os_claim_order):
--       • копия, которую ОС когда-то выдал со своего стола (id `os_…`), а
--         Owner вернул технарю («Правка столов» → «Вернуть»): иначе опрос ОС
--         через пару минут отменял бы решение Owner и заводил бы на столе ОС
--         второй источник того же заказа. Вернуть её под ОС — «Передать ОС»;
--       • строка, чей источник на моём столе помечен «заказ вернули / копию
--         потеряли» (ячейка osLostFor, адреса копии нет) — по той же причине;
--       • строка, которую Owner вернул технарю от МОЕГО имени: «Вернуть»
--         (releaseDeskOrders) пишет на самой строке технаря ячейку
--         osReleasedFrom = ник ОС. Пометка на строке технаря переживает всё,
--         что ОС делает со своим источником (удалил строку с битой ссылкой,
--         выдал её заново), — пометки на источнике для этого мало. Снимает её
--         «Передать ОС». Другой ОС, которого технарь поставил потом, такую
--         строку забирает: сверка идёт с ником;
--       • строка, чей источник ОС уже выдал заново сам (адрес копии —
--         `os_<id источника>`: переезд к другому технарю, «Выдать заново»):
--         это тот же заказ, и второй источник под id с хвостом стал бы дублем.
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
    and r.order_id is null
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
-- А3. Забрать заказ: источник на своём столе + метка на строке технаря —
--     ОДНОЙ транзакцией: сбой между ними оставил бы запертую строку без
--     источника, а проход стола ОС убрал бы такую «сироту».
--
--     Почему функция базы. Сегодня связать такую строку со столом ОС может
--     только Owner («разовый перенос», osOrderAdoption):
--       • ОС правит в чужом столе лишь строки с os_uid = он (политика
--         desk_rows_update), у строки технаря os_uid пуст — UPDATE не находит
--         её, rows_patch уходит во вставку и получает 42501;
--       • технарь строку видит и правит, но desk_rows_guard не даёт поставить
--         чужой os_uid («строку-заказ заводит её ОС»).
--     SECURITY DEFINER, поэтому функция сама проверяет всё, что политика
--     проверить не может:
--       • зовёт ОС (роль os), хранилище живое, у него есть ник ОС в копии прав
--         (rows_members.os_nick_value — 20260930b) и свой стол osdesk_{uid};
--       • стол — стол технаря (не стол ОС, есть ответственный);
--       • ник ОС стоит ИМЕННО в столбце ОС этой вкладки: ключ база берёт из
--         КОПИИ карты столбцов (А1), а не со слов ОС. Иначе ОС-«Анна» забрала
--         бы строку клиента по имени «Анна» и получила бы право её удалить;
--       • строка ещё ничья, не с биржи (order_id — у неё свой путь удаления,
--         rows_drop_order_row), не возвращённая Owner технарю (копия os_…,
--         osReleasedFrom = мой ник, источник с пометкой osLostFor или уже
--         выданный заново — см. А2; всё это — статус released) и не
--         менялась с тех пор, как ОС её прочитал (p_expect_rev) — иначе
--         источник вышел бы со старыми полями при совпавших подписях.
--
--     Ответ — jsonb {status, ...}. Ожидаемые гонки — статусом, а не ошибкой:
--       claimed | already | taken | gone | stale | not_mine | exchange |
--       released | no_nick | no_keys | not_tech_desk | no_os_desk |
--       src_conflict
--     claimed/already несут srcPageId, srcTabId, srcRowId, techUid — клиент
--     берёт адрес источника ИЗ ОТВЕТА: при совпадении id он с хвостом, а
--     прежний источник может лежать в другой вкладке стола ОС.
--     Нарушение прав — исключение 42501, плохие данные — 22023.
--
--     p_src_status_key (необязательный, 24.09.2026 — добавлен к прототипу) —
--     ключ столбца «Статус» стола ОС (resolveOsDeskKeys), если он не
--     'status': по нему триггер Б узнаёт статус строки-источника.
-- ---------------------------------------------------------------------
-- Прежняя сигнатура прототипа (10 параметров) — если её успели накатить:
-- `create or replace` с новым списком создал бы ВТОРУЮ функцию, и PostgREST
-- ответил бы PGRST203 «ambiguous».
drop function if exists public.rows_os_claim_order(text, text, text, text, bigint, text, jsonb, jsonb, text, bigint);

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
  if r.order_id is not null then
    return jsonb_build_object('status', 'exchange');
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

-- ---------------------------------------------------------------------
-- А4. Вернуть взятую строку технарю. Только ОС этой строки и только строку,
--     взятую со стола технаря (источник `adopt_…`: перенос Owner или
--     rows_os_claim_order) — заказы, заведённые самим ОС, убираются как
--     раньше удалением копии. Копия `os_<источник>` — тоже заказ ОС, даже
--     если источник `adopt_…`: её завёл сам ОС при переезде к другому
--     технарю или при «Выдать заново», и технарь её никогда не писал. Отдать
--     её технарю значило бы оставить у него чужой заказ с ценой, который ОС
--     уже удалил, — not_claimed, и клиент удаляет копию как раньше.
--     p_clear_os — стереть свой ник в столбце ОС
--     («не мой заказ»; иначе строку тут же взяли бы снова); false — технарь
--     поставил другого ОС, и строку заберёт уже он. Строку-источник на
--     своём столе ОС убирает/помечает сам клиент — это его стол.
--
--     Роль ОС проверяется ДО выборки строки. Функция SECURITY DEFINER и
--     политик не видит: без этой проверки любой вошедший (технарь,
--     посторонний с токеном Firebase) по ответу «gone» / 42501 узнавал бы,
--     есть ли строка по адресу в любом живом хранилище, и ставил бы замок
--     на строки, которых даже не читает. ОС и так читает все столы — ему
--     разница ответов ничего нового не говорит.
-- ---------------------------------------------------------------------
create or replace function public.rows_os_release_claim(
  p_workspace text,
  p_page text,
  p_tab text,
  p_row text,
  p_clear_os boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  tab text := coalesce(p_tab, '');
  r public.desk_rows%rowtype;
  os_key text;
  nick text;
  clear_it boolean := false;
begin
  if me is null then
    raise exception 'rows_os_release_claim: нужен вход' using errcode = '42501';
  end if;
  if p_workspace is null or p_workspace not in (select public.rows_writable_workspaces()) then
    raise exception 'rows_os_release_claim: хранилище строк закрыто' using errcode = '42501';
  end if;
  -- coalesce — урок `if not NULL`: у не-участника проверка роли даёт NULL.
  if not coalesce(public.rows_has_role(p_workspace, 'os'), false) then
    raise exception 'rows_os_release_claim: возвращает заказ только ОС' using errcode = '42501';
  end if;
  select * into r from public.desk_rows x
  where x.workspace_id = p_workspace and x.page_id = p_page and x.tab_id = tab and x.id = p_row
  for update;
  if not found then
    return jsonb_build_object('status', 'gone');
  end if;
  if r.os_uid is distinct from me then
    raise exception 'rows_os_release_claim: это не ваша строка-заказ' using errcode = '42501';
  end if;
  if r.src_row_id is null or not starts_with(r.src_row_id, 'adopt_') then
    return jsonb_build_object('status', 'not_claimed');
  end if;
  -- Копию завёл сам ОС (id как у mirrorRowId() в osOrderMirror.ts) — не строка технаря.
  if r.id = 'os_' || regexp_replace(r.src_row_id, '[^A-Za-z0-9_-]', '', 'g') then
    return jsonb_build_object('status', 'not_claimed');
  end if;
  select a.os_key into os_key from public.rows_page_acl a
  where a.workspace_id = p_workspace and a.page_id = p_page and a.os_keys_tab = tab;
  select btrim(coalesce(m.os_nick_value, '')) into nick from public.rows_members m
  where m.workspace_id = p_workspace and m.uid = me;
  clear_it := coalesce(p_clear_os, true) and os_key is not null and coalesce(nick, '') <> ''
    and btrim(coalesce(r.cells ->> os_key, '')) = nick;
  update public.desk_rows x set
    os_uid = null,
    tech_uid = null,
    status_key = null,
    src_page_id = null,
    src_tab_id = null,
    src_row_id = null,
    sync_hash = null,
    success_requested_at = null,
    success_requested_by = null,
    cells = case when clear_it then x.cells || jsonb_build_object(os_key, '') else x.cells end
  where x.workspace_id = p_workspace and x.page_id = p_page and x.tab_id = tab and x.id = p_row;
  return jsonb_build_object('status', 'released', 'clearedOs', clear_it);
end;
$$;

-- ---------------------------------------------------------------------
-- А5. Замок строки-заказа: 20261001_tech_fill.sql целиком плюс ветка «ОС
--     возвращает строку технарю». Остальное — без изменений.
-- ---------------------------------------------------------------------
create or replace function public.desk_rows_guard() returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  is_owner boolean := new.workspace_id in (select public.rows_edit_all_workspaces());
  changed text[];
  allowed text[] := array['techLink', 'techNote'];
  release_key text;
begin
  -- Вставка: строку-заказ (с os_uid) заводит только её ОС или Owner. Иначе
  -- технарь пометил бы свою строку чужим os_uid и правил бы статус вечно —
  -- политика вставки в свой стол его пускает, а замок смотрит на os_uid.
  if tg_op = 'INSERT' then
    -- Без токена (SQL-редактор, миграции, сервисный ключ) человека нет —
    -- ограничивать некого; RLS для таких сессий решает сама.
    if me is null then
      return new;
    end if;
    if new.os_uid is not null and not is_owner
       and (new.os_uid <> me or not public.rows_has_role(new.workspace_id, 'os')) then
      raise exception 'desk_rows: строку-заказ заводит её ОС' using errcode = '42501';
    end if;
    return new;
  end if;

  -- Не строка-заказ и ею не становится — обычная правка, решает политика.
  if old.os_uid is null and new.os_uid is null then
    return new;
  end if;

  -- Owner может всё, включая снятие управления со строки (аварийный выход,
  -- если ОС уволился или недоступен, а заказ надо закрыть).
  if is_owner then
    return new;
  end if;

  -- ОС возвращает свою строку технарю (rows_os_release_claim; политика
  -- правки сама такую запись не пропустит — у новой строки нет os_uid).
  -- Снимается РОВНО метка заказа; из ячеек можно только стереть значение
  -- столбца ОС этой вкладки (свой ник — «не мой заказ»).
  if old.os_uid is not null and new.os_uid is null and old.os_uid = me then
    if new.tech_uid is not null or new.status_key is not null
       or new.src_page_id is not null or new.src_tab_id is not null or new.src_row_id is not null
       or new.extras is distinct from old.extras
       or new.attachments is distinct from old.attachments
       or new.order_id is distinct from old.order_id
       or new.filled_at is distinct from old.filled_at then
      raise exception 'desk_rows: вернуть строку технарю — значит снять только метку заказа' using errcode = '42501';
    end if;
    changed := array(
      select coalesce(o.key, n.key)
      from jsonb_each(coalesce(old.cells, '{}'::jsonb)) o
      full outer join jsonb_each(coalesce(new.cells, '{}'::jsonb)) n on n.key = o.key
      where o.value is distinct from n.value
    );
    if coalesce(array_length(changed, 1), 0) > 0 then
      select a.os_key into release_key from public.rows_page_acl a
      where a.workspace_id = old.workspace_id and a.page_id = old.page_id and a.os_keys_tab = old.tab_id;
      if release_key is null or not (changed <@ array[release_key])
         or coalesce(new.cells ->> release_key, '') <> '' then
        raise exception 'desk_rows: вернуть строку технарю — стирается только свой ник ОС' using errcode = '42501';
      end if;
    end if;
    return new;
  end if;

  -- Взять строку под управление может только сам ОС и только на себя.
  if old.os_uid is null and new.os_uid is not null then
    if new.os_uid <> me or not public.rows_has_role(new.workspace_id, 'os') then
      raise exception 'desk_rows: строку-заказ заводит её ОС' using errcode = '42501';
    end if;
    return new;
  end if;

  -- Дальше строка уже управляемая. Опорные поля не переписываются никем,
  -- кроме Owner: иначе замок снимается переписыванием замка.
  if new.os_uid is distinct from old.os_uid
     or new.tech_uid is distinct from old.tech_uid
     or new.status_key is distinct from old.status_key
     or new.src_page_id is distinct from old.src_page_id
     or new.src_tab_id is distinct from old.src_tab_id
     or new.src_row_id is distinct from old.src_row_id then
    raise exception 'desk_rows: поля строки-заказа меняет только Owner' using errcode = '42501';
  end if;

  -- ОС этой строки — хозяин её содержимого.
  if old.os_uid = me then
    return new;
  end if;

  -- Какие ячейки изменились.
  changed := array(
    select coalesce(o.key, n.key)
    from jsonb_each(coalesce(old.cells, '{}'::jsonb)) o
    full outer join jsonb_each(coalesce(new.cells, '{}'::jsonb)) n on n.key = o.key
    where o.value is distinct from n.value
  );

  -- Тимлид: ровно статус (по ключу из строки) и снятие просьбы об «Успешке».
  if public.rows_is_teamlead(old.workspace_id) then
    if not (changed <@ array[old.status_key]) then
      raise exception 'desk_rows: Тимлид меняет в строке-заказе только статус' using errcode = '42501';
    end if;
    if new.extras is distinct from old.extras
       or new.attachments is distinct from old.attachments
       or new.order_id is distinct from old.order_id
       or new.sync_hash is distinct from old.sync_hash then
      raise exception 'desk_rows: Тимлид меняет в строке-заказе только статус' using errcode = '42501';
    end if;
    return new;
  end if;

  -- Технарь заполняет сам (Owner так решил для всех или для этого стола):
  -- ячейки, визитку и вложения строки ОС он правит, статус проход стола ОС
  -- подтянет к ОС. Служебные поля заказа — нет: по ним ОС узнаёт свою копию.
  if public.rows_tech_fills(old.workspace_id, old.page_id) then
    if new.order_id is distinct from old.order_id
       or new.sync_hash is distinct from old.sync_hash then
      raise exception 'desk_rows: служебные поля заказа меняет ОС' using errcode = '42501';
    end if;
    if new.success_requested_by is distinct from old.success_requested_by
       and new.success_requested_by is not null
       and new.success_requested_by <> me then
      raise exception 'desk_rows: просьбу об «Успешке» оставляют за себя' using errcode = '42501';
    end if;
    return new;
  end if;

  -- Технарь: свои поля и просьба об «Успешке».
  if not (changed <@ allowed) then
    raise exception 'desk_rows: статус, цену и клиента в этой строке ведёт ОС' using errcode = '42501';
  end if;
  if new.extras is distinct from old.extras
     or new.order_id is distinct from old.order_id
     or new.sync_hash is distinct from old.sync_hash
     or new.filled_at is distinct from old.filled_at then
    raise exception 'desk_rows: эту строку ведёт ОС' using errcode = '42501';
  end if;
  -- Просить «Успешку» можно только за себя.
  if new.success_requested_by is distinct from old.success_requested_by
     and new.success_requested_by is not null
     and new.success_requested_by <> me then
    raise exception 'desk_rows: просьбу об «Успешке» оставляют за себя' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Триггер тот же (create or replace сохраняет функцию), но заводим его и
-- здесь: guard живёт в этом файле, и файл не должен зависеть от того, что
-- триггер уже стоит.
drop trigger if exists desk_rows_guard on public.desk_rows;
create trigger desk_rows_guard before insert or update on public.desk_rows
  for each row execute function public.desk_rows_guard();

-- ---------------------------------------------------------------------
-- Б. Статус со стола ОС доезжает до копии у технаря ТОЙ ЖЕ записью.
--
--    Срабатывает на правке строки стола ОС, у которой есть адрес копии
--    (mirror_*), когда её статус (ключ — status_key строки, по умолчанию
--    'status') сменился на НЕПУСТОЙ: ставит его в копию по ЕЁ status_key
--    (ключи у вкладок технаря свои), гасит просьбу об «Успешке» и пишет на
--    строке ОС osStatusSent — «последний синхронизированный»: проход стола ОС
--    тогда не шлёт статус второй раз и не тянет старый назад.
--
--    Копия — ровно та, что показывает НАЗАД на эту строку (src_page_id,
--    src_row_id) и принадлежит ОС этого стола (os_uid = ответственный стола
--    ОС). Подложенный адрес (чужая копия, обычная строка технаря) ничего не
--    меняет.
--
--    SECURITY INVOKER: копию правит тот, кто правит строку ОС, под своими
--    RLS и desk_rows_guard — ОС (os_uid = я) и Owner пройдут, Тимлиду guard
--    оставляет ровно статус. Кому копию трогать нельзя, тому UPDATE найдёт
--    0 строк или guard откажет — отказ (42501) ловится, и запись самой строки
--    ОС НЕ ломается: статус тогда везёт проход стола, как раньше.
--
--    Не шлёт:
--      • пустой статус (стёртый у ОС статус не стирает статус технаря);
--      • правку, которая сама ставит osStatusSent = новому статусу, — это
--        «подтянуть статус технаря к ОС» (planOsDispatch → pull) или перенос,
--        где статус взят С копии. Такую правку проход мог собрать по
--        УСТАРЕВШЕМУ списку заказов, и отправка назад затёрла бы технарю
--        новый статус старым. Не отправленный назад статус проход исправит
--        сам следующим pull по свежему списку;
--      • из вложенной правки (pg_trigger_depth() > 1): адреса пишет клиент, и
--        петля «строка A → строка B → строка A» на своём столе ОС иначе
--        упёрлась бы в ошибку и уронила бы саму правку.
--
--    Имя по алфавиту — после desk_rows_guard и desk_rows_os_managed (стражи
--    решают, можно ли) и ПЕРЕД desk_rows_rev: номер правки строке ОС
--    ставится последним, а копия получает свой rev своим же триггером.
--
--    Звонок (rowsDoorbell) база не делает: открытый стол технаря узнает о
--    правке по звонку клиента ОС на стол копии или по опросу отметки (≤15 с).
-- ---------------------------------------------------------------------
create or replace function public.desk_rows_os_status_push() returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  k text;
  v jsonb;
  os_owner text;
  n integer := 0;
begin
  if new.mirror_row_id is null or new.mirror_page_id is null or pg_trigger_depth() > 1 then
    return new;
  end if;
  k := coalesce(new.status_key, 'status');
  v := new.cells -> k;
  if btrim(coalesce(new.cells ->> k, '')) = '' or (old.cells -> k) is not distinct from v then
    return new;
  end if;
  -- Статус пришёл С копии (pull, перенос, забор): назад не шлём.
  if (new.cells ->> 'osStatusSent') is not distinct from (new.cells ->> k)
     and (old.cells ->> 'osStatusSent') is distinct from (new.cells ->> 'osStatusSent') then
    return new;
  end if;
  select a.responsible_uid into os_owner
  from public.rows_page_acl a
  where a.workspace_id = new.workspace_id and a.page_id = new.page_id and a.os_desk;
  if os_owner is null then
    return new;   -- не стол ОС
  end if;
  begin
    update public.desk_rows c
       set cells = c.cells || jsonb_build_object(c.status_key, v),
           success_requested_at = null,
           success_requested_by = null,
           updated_at = (extract(epoch from clock_timestamp()) * 1000)::bigint
     where c.workspace_id = new.workspace_id
       and c.page_id = new.mirror_page_id
       and c.tab_id = coalesce(new.mirror_tab_id, '')
       and c.id = new.mirror_row_id
       and c.os_uid = os_owner
       and c.status_key is not null
       and c.src_page_id = new.page_id
       and c.src_row_id = new.id
       and (c.cells -> c.status_key) is distinct from v;
    get diagnostics n = row_count;
  exception when insufficient_privilege then
    -- Копию этому человеку трогать нельзя — правка строки ОС остаётся.
    return new;
  end;
  if n > 0 or exists (
    select 1 from public.desk_rows c
    where c.workspace_id = new.workspace_id and c.page_id = new.mirror_page_id
      and c.tab_id = coalesce(new.mirror_tab_id, '') and c.id = new.mirror_row_id
      and c.os_uid = os_owner and c.status_key is not null
      and c.src_page_id = new.page_id and c.src_row_id = new.id
      and (c.cells -> c.status_key) is not distinct from v
  ) then
    new.cells := new.cells || jsonb_build_object('osStatusSent', new.cells ->> k);
  end if;
  return new;
end;
$$;

drop trigger if exists desk_rows_os_status_push on public.desk_rows;
create trigger desk_rows_os_status_push before update on public.desk_rows
  for each row
  when (new.mirror_row_id is not null and new.cells is distinct from old.cells)
  execute function public.desk_rows_os_status_push();

-- ---------------------------------------------------------------------
-- Права на функции. Supabase раздаёт ролям API EXECUTE на новые функции по
-- default privileges, а PUBLIC получает его сам — поэтому сначала снимаем
-- всё и выдаём ровно нужное. Триггерной функции EXECUTE не нужен никому
-- (триггер срабатывает без проверки права на функцию).
-- ---------------------------------------------------------------------
revoke all on function public.rows_claim_src_id(text) from public, anon, authenticated;
revoke all on function public.rows_os_claimable(text, integer) from public, anon, authenticated;
revoke all on function public.rows_os_claim_order(text, text, text, text, bigint, text, jsonb, jsonb, text, bigint, text) from public, anon, authenticated;
revoke all on function public.rows_os_release_claim(text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.desk_rows_os_status_push() from public, anon, authenticated;
grant execute on function
  public.rows_claim_src_id(text),
  public.rows_os_claimable(text, integer),
  public.rows_os_claim_order(text, text, text, text, bigint, text, jsonb, jsonb, text, bigint, text),
  public.rows_os_release_claim(text, text, text, text, boolean)
  to anon, authenticated;

-- ---------------------------------------------------------------------
-- В. Версия схемы — ПОСЛЕДНЕЙ строкой файла: если вставка оборвалась на
--    середине, клиент не решит, что всё на месте. Следующий файл миграции,
--    без которого новый клиент не работает, заменяет функцию в СВОЁМ файле
--    со своей датой.
-- ---------------------------------------------------------------------
create or replace function public.nova_schema_version() returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select '20261002'::text
$$;

revoke all on function public.nova_schema_version() from public, anon, authenticated;
grant execute on function public.nova_schema_version() to anon, authenticated;
