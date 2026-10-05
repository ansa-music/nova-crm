-- =====================================================================
-- 20261045 — технарь «заполняет сам» → стол ОС сам и сразу (05.10.2026).
--
-- Просьба Nurba: «когда технарь, который заполняет свой стол сам, правит
-- таблицу — это должно доезжать до столов ОС автоматически и в реальном
-- времени, без кнопки „Передать ОС“».
--
-- Всё новое действует, ТОЛЬКО когда разом верно три вещи (rows_tech_sync_on):
--   • стол «Заполняет сам» (rows_tech_fills: режим tech или стол-исключение);
--   • Owner включил флаг rows_workspaces.tech_sync (null — ещё не включали);
--   • ядро лежит в Supabase (meta/imported_page и meta/imported_member) —
--     вкладку периода и ключи столбцов стола ОС база читает из core_docs,
--     со слов клиента не берётся ничего.
-- В остальных режимах («Заказы ведёт ОС», «Смешанный» без галочки стола,
-- ядро в Firestore) триггер выходит сразу, RPC отвечает out_of_scope / off /
-- no_core, и всё работает как раньше.
--
--   А. rows_workspaces.tech_sync; индекс desk_rows (workspace_id, page_id, id).
--   Б. Чистые помощники — порты JS (менять ВМЕСТЕ с парой в src/utils):
--      rows_js_trim (String.trim), rows_num_loose (parseLooseNumber),
--      rows_num_text, rows_cell_num / rows_os_total (osRowTotal),
--      rows_os_cols_keys (resolveOsDeskKeys), rows_period_key (periodKeyFor +
--      sanitizePeriods).
--   В. Чтение core_docs: rows_core_live, rows_tech_sync_on, rows_period_now,
--      rows_tech_keys, rows_tech_nick, rows_os_tab_keys, rows_os_target
--      (openOsDeskCurrentTab без подбора вкладки по названию).
--   Г. rows_tech_apply — единственный писатель в строку-источник стола ОС от
--      имени технаря: только источник, который показывает РОВНО на эту копию,
--      только статус и поля карты столбцов, замок NOWAIT.
--   Д. Триггер desk_rows_tech_push (AFTER UPDATE на связанной копии): статус и
--      изменённые в этой правке поля — в источник той же транзакцией. Правку
--      человека не роняет и не держит никогда.
--   Е. RPC: rows_tech_sync (связать несвязанные строки пачкой ≤ 50, перевесить
--      на другого ОС, пока ОС строку не трогал, починить статус), rows_tech_sync_scan,
--      rows_tech_sync_state, rows_set_tech_sync.
--   Ж. desk_rows_guard — полная копия из 20261007 (правило: guard правится
--      только в самом новом файле) с тремя вставками: ветка GUC nova.tech_sync
--      (метка связи и снятие связи, которые ставит rows_tech_sync), отметка
--      «вернули технарю» и запрет снять адрес копии, пока копия связана.
--   З. nova_schema_version() = '20261045'.
--
-- Подпись полей (sync_hash) этот файл НЕ пишет нигде, кроме обнуления при
-- снятии связи: цена — одна лишняя пересылка ОС → технарь на новую связь.
-- Скрипт повторяемый. Правки guard и функций отсюда — здесь или новее.
-- =====================================================================

-- ---------------------------------------------------------------------
-- А. Флаг workspace и индекс.
--    tech_sync: null — ещё не включали, true — работает, false — Owner
--    выключил. Клиент столбец напрямую не пишет (rows_set_tech_sync).
-- ---------------------------------------------------------------------
alter table public.rows_workspaces add column if not exists tech_sync boolean;

-- Источник ищется по id на ВСЕХ вкладках стола ОС (первичный ключ начинается
-- с вкладки и для этого не годится).
create index if not exists desk_rows_page_row on public.desk_rows (workspace_id, page_id, id);

-- ---------------------------------------------------------------------
-- Б. Чистые помощники. Наружу не выданы: зовут их только функции ниже.
-- ---------------------------------------------------------------------

-- String.prototype.trim(): пробельный набор JS, а не один пробел, как btrim.
create or replace function public.rows_js_trim(p text) returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select btrim(coalesce(p, ''),
    U&' \0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
$$;

-- parseLooseNumber (src/utils/numberInput.ts). null — это не число.
create or replace function public.rows_num_loose(p text) returns numeric
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  s text := public.rows_js_trim(p);
  negative boolean;
  dots integer;
  commas integer;
  frac text;
  normalized text;
begin
  if s = '' then
    return null;
  end if;
  -- /[\s  ]/g
  s := translate(s,
    U&' \0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF', '');
  -- /(руб|тг|тенге|kzt|rub|usd|eur)\.?/gi — оба регистра выписаны: lower()
  -- кириллицы зависит от локали базы.
  s := regexp_replace(s,
    '([рР][уУ][бБ]|[тТ][гГ]|[тТ][еЕ][нН][гГ][еЕ]|[kK][zZ][tT]|[rR][uU][bB]|[uU][sS][dD]|[eE][uU][rR])\.?', '', 'g');
  -- /\p{Sc}/gu — знаки валют.
  s := translate(s,
    U&'$\00A2\00A3\00A4\00A5\058F\060B\07FE\07FF\09F2\09F3\09FB\0AF1\0BF9\0E3F\17DB\20A0\20A1\20A2\20A3\20A4\20A5\20A6\20A7\20A8\20A9\20AA\20AB\20AC\20AD\20AE\20AF\20B0\20B1\20B2\20B3\20B4\20B5\20B6\20B7\20B8\20B9\20BA\20BB\20BC\20BD\20BE\20BF\20C0\A838\FDFC\FE69\FF04\FFE0\FFE1\FFE5\FFE6\+011FDD\+011FDE\+011FDF\+011FE0\+01E2FF\+01ECB0', '');
  if s ~ '[^0-9.,+-]' then
    return null;
  end if;
  if position('+' in substr(s, 2)) > 0 or (length(s) - length(replace(s, '-', ''))) > 1 then
    return null;
  end if;
  negative := left(s, 1) = '-';
  s := regexp_replace(s, '^[+-]', '');
  s := regexp_replace(s, '[.,]$', '');
  if s = '' then
    return null;
  end if;
  dots := length(s) - length(replace(s, '.', ''));
  commas := length(s) - length(replace(s, ',', ''));
  if commas > 0 and dots > 0 then
    -- Оба знака: последний — десятичный, другой — разделитель тысяч.
    if length(s) - position('.' in reverse(s)) > length(s) - position(',' in reverse(s)) then
      normalized := replace(s, ',', '');
    else
      normalized := regexp_replace(replace(s, '.', ''), ',', '.');
    end if;
  elsif commas = 1 then
    frac := split_part(s, ',', 2);
    normalized := case when length(frac) = 3 then replace(s, ',', '') else replace(s, ',', '.') end;
  elsif commas > 1 then
    normalized := replace(s, ',', '');
  elsif dots = 1 then
    frac := split_part(s, '.', 2);
    normalized := case when length(frac) = 3 then replace(s, '.', '') else s end;
  elsif dots > 1 then
    normalized := replace(s, '.', '');
  else
    normalized := s;
  end if;
  if normalized = '' or normalized = '.' or normalized !~ '^[0-9]*(\.[0-9]+)?$' then
    return null;
  end if;
  return case when negative then -(normalized::numeric) else normalized::numeric end;
end;
$$;

-- String(round2(n)) — каноническая запись суммы в ячейке.
create or replace function public.rows_num_text(p numeric) returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select trim_scale(round(p, 2))::text
$$;

-- amountOf (src/utils/payment.ts): число ячейки, 0 — если пусто или не число.
create or replace function public.rows_cell_num(p_cells jsonb, p_key text) returns numeric
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_key is null or p_cells is null then 0
    when jsonb_typeof(p_cells -> p_key) = 'number' then (p_cells ->> p_key)::numeric
    else coalesce(public.rows_num_loose(p_cells ->> p_key), 0)
  end
$$;

-- osRowTotal: (цена − комиссия) + (апсейл − комиссия); null — денег нет.
create or replace function public.rows_os_total(p_cells jsonb, p_price text, p_upsell text) returns numeric
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when a.price + a.upsell = 0 then null
    else round(a.price * (1 - a.fee_price / 100) + a.upsell * (1 - a.fee_upsell / 100), 2)
  end
  from (
    select public.rows_cell_num(p_cells, p_price) as price,
           public.rows_cell_num(p_cells, p_upsell) as upsell,
           least(100, greatest(0, public.rows_cell_num(p_cells, p_price || '__fee'))) as fee_price,
           least(100, greatest(0, public.rows_cell_num(p_cells, p_upsell || '__fee'))) as fee_upsell
  ) a
$$;

-- resolveOsDeskKeys (src/utils/osDeskKeys.ts): ключи ячеек вкладки стола ОС
-- по её столбцам. Статус и технарь — по ТИПУ столбца; остальное — ключ по
-- умолчанию, потом тип, потом название. Регистр названий выписан руками.
create or replace function public.rows_os_cols_keys(p_cols jsonb) returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  c jsonb;
  k text;
  t text;
  lbl text;
  n integer := 0;
  first_key text;
  has_client boolean := false; lbl_client text;
  has_phone boolean := false; type_phone text; lbl_phone text;
  has_price boolean := false; lbl_price text;
  has_upsell boolean := false; lbl_upsell text;
  has_note boolean := false; lbl_note text;
  has_link boolean := false; type_url text;
  type_status text;
  type_technician text;
  has_total boolean := false; lbl_total text;
begin
  if p_cols is not null and jsonb_typeof(p_cols) = 'array' then
    for c in select e.value from jsonb_array_elements(p_cols) with ordinality as e(value, ord) order by e.ord loop
      n := n + 1;
      k := c ->> 'key';
      if n = 1 then
        first_key := k;
      end if;
      if k is null then
        continue;
      end if;
      t := c ->> 'type';
      lbl := public.rows_js_trim(c ->> 'label');
      if k = 'client' then has_client := true; end if;
      if k = 'phone' then has_phone := true; end if;
      if k = 'price' then has_price := true; end if;
      if k = 'upsell' then has_upsell := true; end if;
      if k = 'note' then has_note := true; end if;
      if k = 'link' then has_link := true; end if;
      if k = 'total' then has_total := true; end if;
      if t = 'phone' and type_phone is null then type_phone := k; end if;
      if t = 'url' and type_url is null then type_url := k; end if;
      if t = 'status' and type_status is null then type_status := k; end if;
      if t = 'technician' and type_technician is null then type_technician := k; end if;
      if lbl_client is null and lbl ~ '^([иИ][мМ][яЯ]|[кК][лЛ][иИ][еЕ][нН][тТ]|[фФ][иИ][оО])' then lbl_client := k; end if;
      if lbl_phone is null and lbl ~ '[нН][оО][мМ][еЕ][рР]|[тТ][еЕ][лЛ][еЕ][фФ][оО][нН]' then lbl_phone := k; end if;
      if lbl_price is null and lbl ~ '^([цЦ][еЕ][нН][аА]|[сС][уУ][мМ][мМ][аА]|[сС][тТ][оО][иИ][мМ][оО][сС][тТ][ьЬ])' then lbl_price := k; end if;
      if lbl_upsell is null and lbl ~ '[аА][пП][сС][еЕ][йЙ][лЛ]|[uU][pP][sS][eE][lL][lL]' then lbl_upsell := k; end if;
      if lbl_note is null and lbl ~ '[пП][рР][иИ][мМ][еЕ][чЧ]|[кК][оО][мМ][мМ][еЕ][нН][тТ]' then lbl_note := k; end if;
      if lbl_total is null and lbl ~ '^[иИ][тТ][оО][гГ]' then lbl_total := k; end if;
    end loop;
  end if;
  if n = 0 then
    -- Столбцов нет — ключи нового стола ОС (OS_DESK_KEYS).
    return jsonb_build_object('client', 'client', 'phone', 'phone', 'price', 'price', 'upsell', 'upsell',
      'note', 'note', 'link', 'link', 'status', 'status', 'technician', 'technician', 'total', 'total');
  end if;
  return jsonb_build_object(
    'client', coalesce(case when has_client then 'client' end, lbl_client, first_key, 'client'),
    'phone', coalesce(case when has_phone then 'phone' end, type_phone, lbl_phone, 'phone'),
    'price', coalesce(case when has_price then 'price' end, lbl_price, 'price'),
    'upsell', coalesce(case when has_upsell then 'upsell' end, lbl_upsell, 'upsell'),
    'note', coalesce(case when has_note then 'note' end, lbl_note, 'note'),
    'link', coalesce(case when has_link then 'link' end, type_url, 'link'),
    'status', coalesce(type_status, 'status'),
    'technician', coalesce(type_technician, 'technician'),
    'total', coalesce(case when has_total then 'total' end, lbl_total, 'total')
  );
end;
$$;

-- periodKeyFor + sanitizePeriods (src/utils/periods.ts): ключ периода, в
-- который попадает момент p_at (день по поясу p_tz). p_periods —
-- workspace.periods как есть.
create or replace function public.rows_period_key(p_periods jsonb, p_at timestamptz, p_tz text) returns text
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  src jsonb := case when jsonb_typeof(p_periods) = 'object' then p_periods else '{}'::jsonb end;
  v jsonb := src -> 'splitDay';
  num numeric;
  split integer := 15;
  v_from text := '';
  v_until text := '';
  local_ts timestamp := p_at at time zone coalesce(nullif(p_tz, ''), 'Asia/Almaty');
  month text := to_char(local_ts, 'YYYY-MM');
begin
  -- Number(splitDay): нет поля → 15; число → как есть; null, false, '' → 0.
  if v is not null then
    if jsonb_typeof(v) = 'number' then
      num := (v #>> '{}')::numeric;
    elsif jsonb_typeof(v) = 'string' then
      if public.rows_js_trim(v #>> '{}') = '' then
        num := 0;
      elsif public.rows_js_trim(v #>> '{}') ~ '^[+-]?[0-9]+(\.[0-9]+)?$' then
        num := public.rows_js_trim(v #>> '{}')::numeric;
      end if;
    elsif jsonb_typeof(v) = 'null' then
      num := 0;
    elsif jsonb_typeof(v) = 'boolean' then
      num := case when v = 'true'::jsonb then 1 else 0 end;
    end if;
    if num is not null then
      split := greatest(10, least(20, trunc(greatest(-1000, least(1000, num)))::integer));
    end if;
  end if;
  if jsonb_typeof(src -> 'from') = 'string' and (src ->> 'from') ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    v_from := src ->> 'from';
  end if;
  if jsonb_typeof(src -> 'until') = 'string' and (src ->> 'until') ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    v_until := src ->> 'until';
  end if;
  -- Конец раньше начала (или равен) — половин не было вовсе.
  if v_from <> '' and v_until <> '' and v_until collate "C" <= v_from collate "C" then
    v_from := '';
    v_until := '';
  end if;
  if v_from = '' then
    v_until := '';
  end if;
  if not (v_from <> '' and month collate "C" >= v_from collate "C"
          and (v_until = '' or month collate "C" < v_until collate "C")) then
    return month;
  end if;
  return month || case when extract(day from local_ts)::integer <= split then '-1' else '-2' end;
end;
$$;

revoke all on function public.rows_js_trim(text) from public, anon, authenticated;
revoke all on function public.rows_num_loose(text) from public, anon, authenticated;
revoke all on function public.rows_num_text(numeric) from public, anon, authenticated;
revoke all on function public.rows_cell_num(jsonb, text) from public, anon, authenticated;
revoke all on function public.rows_os_total(jsonb, text, text) from public, anon, authenticated;
revoke all on function public.rows_os_cols_keys(jsonb) from public, anon, authenticated;
revoke all on function public.rows_period_key(jsonb, timestamptz, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- В. Чтение core_docs. SECURITY DEFINER: документы столов ОС и участников
--    читаются мимо политик, наружу функции не выданы — их зовут только
--    триггер, замок и RPC этого файла, и отвечают они ключами, а не данными.
-- ---------------------------------------------------------------------

-- Ядро перенесено в Supabase: столы с вкладками и участники с настройками.
create or replace function public.rows_core_live(p_workspace text) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (
    select count(*) from public.core_docs c
    where c.workspace_id = p_workspace and c.kind = 'meta' and c.parent_id = ''
      and c.id in ('imported_page', 'imported_member') and not c.deleted
  ) = 2
$$;

-- Единый выключатель всего нового (см. шапку).
create or replace function public.rows_tech_sync_on(p_workspace text, p_page text) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select w.tech_sync from public.rows_workspaces w where w.workspace_id = p_workspace), false)
     and coalesce(public.rows_tech_fills(p_workspace, p_page), false)
     and coalesce(public.rows_core_live(p_workspace), false)
$$;

-- Текущий период столов — по часам БАЗЫ и настройке периодов workspace.
-- null — документа настроек нет (тогда и связывать некуда).
create or replace function public.rows_period_now(p_workspace text) returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  d jsonb;
begin
  select c.data into d from public.core_docs c
  where c.workspace_id = p_workspace and c.kind = 'workspace' and c.parent_id = '' and c.id = p_workspace and not c.deleted;
  if not found then
    return null;
  end if;
  return public.rows_period_key(d -> 'periods', now(), public.rows_tz(p_workspace));
exception when others then
  return null;
end;
$$;

-- Карта столбцов стола технаря (page.osFieldKeys без времени). null — стола
-- нет, это стол ОС или карта неполная (нужны вкладка, ОС, статус и клиент).
create or replace function public.rows_tech_keys(p_workspace text, p_page text) returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when coalesce(c.data -> 'osDesk', 'false'::jsonb) = 'true'::jsonb then null
    when jsonb_typeof(c.data -> 'osFieldKeys') is distinct from 'object' then null
    when coalesce(c.data -> 'osFieldKeys' ->> 'tabId', '') = ''
      or coalesce(c.data -> 'osFieldKeys' ->> 'os', '') = ''
      or coalesce(c.data -> 'osFieldKeys' ->> 'status', '') = ''
      or coalesce(c.data -> 'osFieldKeys' ->> 'client', '') = '' then null
    else (c.data -> 'osFieldKeys') - 'at'
  end
  from public.core_docs c
  where c.workspace_id = p_workspace and c.kind = 'page' and c.parent_id = '' and c.id = p_page and not c.deleted
$$;

-- Ник технаря из документа участника. null — ника нет или тот же ник держит
-- ещё кто-то: в столбец «Технарь» стола ОС пишется только однозначный ник
-- (по нему проход стола ОС находит человека; чужой ник увёл бы заказ).
create or replace function public.rows_tech_nick(p_workspace text, p_uid text) returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v text;
begin
  select public.rows_js_trim(c.data ->> 'techNickValue') into v
  from public.core_docs c
  where c.workspace_id = p_workspace and c.kind = 'member' and c.parent_id = '' and c.id = p_uid and not c.deleted;
  if v is null or v = '' then
    return null;
  end if;
  if exists (
    select 1 from public.core_docs o
    where o.workspace_id = p_workspace and o.kind = 'member' and o.parent_id = '' and o.id <> p_uid and not o.deleted
      and public.rows_js_trim(o.data ->> 'techNickValue') = v
  ) then
    return null;
  end if;
  return v;
end;
$$;

-- Ключи ячеек вкладки стола ОС ('' — «Основная»). null — документа стола или
-- самой вкладки нет: тогда поля не пишутся вовсе, чужими ключами не гадаем.
create or replace function public.rows_os_tab_keys(p_workspace text, p_os_page text, p_tab text) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  pg jsonb;
  sub jsonb;
  cols jsonb;
begin
  select c.data into pg from public.core_docs c
  where c.workspace_id = p_workspace and c.kind = 'page' and c.parent_id = '' and c.id = p_os_page and not c.deleted;
  if not found then
    return null;
  end if;
  cols := pg -> 'columns';
  if coalesce(p_tab, '') <> '' then
    select c.data into sub from public.core_docs c
    where c.workspace_id = p_workspace and c.kind = 'subpage' and c.parent_id = p_os_page and c.id = p_tab and not c.deleted;
    if not found then
      return null;
    end if;
    if jsonb_typeof(sub -> 'columns') = 'array' and jsonb_array_length(sub -> 'columns') > 0 then
      cols := sub -> 'columns';
    end if;
  end if;
  return public.rows_os_cols_keys(cols);
end;
$$;

-- Куда на столе ОС ложится заказ периода: {tab, planned, keys}. Зеркало
-- openOsDeskCurrentTab (src/services/rows/osDeskIssue.ts) и ensureMonthTab
-- (monthTabService.ts) БЕЗ подбора вкладки по названию:
--   «Основная» ещё не названа периодом или названа этим периодом → '';
--   вкладка автопилота этого периода (autoMonthKey + autoMonthSubPageId);
--   вкладка month-{период}; вкладка с monthKey = период (не архив);
--   иначе — вкладки ещё нет: её будущий id month-{период} (planned) и столбцы,
--   которые новая вкладка получит (columnSource). Вкладку заводит сам стол ОС
--   или сессия Owner под ТЕМ ЖЕ id; у строк tab_id без внешнего ключа.
-- null — документа стола нет или период неизвестен.
create or replace function public.rows_os_target(p_workspace text, p_os_page text, p_period text) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  pg jsonb;
  main_key text;
  tab text;
  cols jsonb;
  src_cols jsonb;
begin
  if coalesce(p_period, '') = '' then
    return null;
  end if;
  select c.data into pg from public.core_docs c
  where c.workspace_id = p_workspace and c.kind = 'page' and c.parent_id = '' and c.id = p_os_page and not c.deleted;
  if not found then
    return null;
  end if;
  main_key := coalesce(pg ->> 'mainTabMonthKey', '');
  if main_key = '' or main_key = p_period then
    return jsonb_build_object('tab', '', 'planned', false, 'keys', public.rows_os_cols_keys(pg -> 'columns'));
  end if;

  if pg ->> 'autoMonthKey' = p_period and coalesce(pg ->> 'autoMonthSubPageId', '') <> '' and exists (
    select 1 from public.core_docs s
    where s.workspace_id = p_workspace and s.kind = 'subpage' and s.parent_id = p_os_page
      and s.id = pg ->> 'autoMonthSubPageId' and not s.deleted
  ) then
    tab := pg ->> 'autoMonthSubPageId';
  end if;
  if tab is null then
    select s.id into tab from public.core_docs s
    where s.workspace_id = p_workspace and s.kind = 'subpage' and s.parent_id = p_os_page and not s.deleted
      and coalesce(s.data ->> 'personalOwnerUid', '') = ''
      and s.id = 'month-' || p_period;
  end if;
  if tab is null then
    select s.id into tab from public.core_docs s
    where s.workspace_id = p_workspace and s.kind = 'subpage' and s.parent_id = p_os_page and not s.deleted
      and coalesce(s.data ->> 'personalOwnerUid', '') = ''
      and coalesce(s.data -> 'isArchived', 'false'::jsonb) <> 'true'::jsonb
      and s.data ->> 'monthKey' = p_period
    order by case when jsonb_typeof(s.data -> 'order') = 'number' then (s.data ->> 'order')::numeric end nulls last, s.id collate "C"
    limit 1;
  end if;
  if tab is not null then
    return jsonb_build_object('tab', tab, 'planned', false, 'keys', public.rows_os_tab_keys(p_workspace, p_os_page, tab));
  end if;

  -- Вкладки периода ещё нет. Столбцы — как у columnSource: вкладка, на
  -- которой стол открывается сейчас; иначе, если «Основная» скрыта, —
  -- последняя видимая; иначе столбцы самого стола.
  if coalesce(pg ->> 'defaultSubPageId', '') <> '' then
    select s.data -> 'columns' into src_cols from public.core_docs s
    where s.workspace_id = p_workspace and s.kind = 'subpage' and s.parent_id = p_os_page and not s.deleted
      and coalesce(s.data ->> 'personalOwnerUid', '') = ''
      and coalesce(s.data -> 'isArchived', 'false'::jsonb) <> 'true'::jsonb
      and s.id = pg ->> 'defaultSubPageId';
  end if;
  if not found or coalesce(pg ->> 'defaultSubPageId', '') = '' then
    src_cols := null;
    if coalesce(pg -> 'hideMainTab', 'false'::jsonb) = 'true'::jsonb then
      select s.data -> 'columns' into src_cols from public.core_docs s
      where s.workspace_id = p_workspace and s.kind = 'subpage' and s.parent_id = p_os_page and not s.deleted
        and coalesce(s.data ->> 'personalOwnerUid', '') = ''
        and coalesce(s.data -> 'isArchived', 'false'::jsonb) <> 'true'::jsonb
      order by case when jsonb_typeof(s.data -> 'order') = 'number' then (s.data ->> 'order')::numeric end desc nulls last, s.id collate "C" desc
      limit 1;
    end if;
  end if;
  cols := case when jsonb_typeof(src_cols) = 'array' then src_cols else pg -> 'columns' end;
  return jsonb_build_object('tab', 'month-' || p_period, 'planned', true, 'keys', public.rows_os_cols_keys(cols));
end;
$$;

revoke all on function public.rows_core_live(text) from public, anon, authenticated;
revoke all on function public.rows_tech_sync_on(text, text) from public, anon, authenticated;
revoke all on function public.rows_period_now(text) from public, anon, authenticated;
revoke all on function public.rows_tech_keys(text, text) from public, anon, authenticated;
revoke all on function public.rows_tech_nick(text, text) from public, anon, authenticated;
revoke all on function public.rows_os_tab_keys(text, text, text) from public, anon, authenticated;
revoke all on function public.rows_os_target(text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Г. Запись в источник от имени технаря — ОДНО место на триггер и RPC.
--
--    p_mode = 'delta' (триггер): что изменилось между p_old и p_new в ЭТОЙ
--      правке копии — статус, клиент, номер, ссылка, визитка, сумма.
--    p_mode = 'state' (RPC): чинится только статус (поля ездят триггером).
--
--    Пишется лишь строка стола ОС, на которую копия ссылается (src_*) и
--    которая сама показывает РОВНО на эту копию (mirror_*), и только на столе
--    `osdesk_{os_uid}` с записью прав этого ОС. Ключи — из столбцов вкладки
--    источника (core_docs), значения — из сохранённой строки технаря.
--    Не пишутся никогда: апсейл, способы оплаты и комиссии, даты, транш,
--    столбец «Технарь», адреса, вложения, order_id, sync_hash.
--
--    Замок источника — NOWAIT: lock_not_available уходит вызывающему (триггер
--    пропускает, RPC отвечает busy). Ждать источник, держа строку технаря,
--    нельзя: проход стола ОС берёт замки в обратном порядке.
--
--    Ответ: {code: ok | noop | no_source | not_linked, wrote, sum?, osTotal?}.
-- ---------------------------------------------------------------------
create or replace function public.rows_tech_apply(
  p_old public.desk_rows,
  p_new public.desk_rows,
  p_mode text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ws text := p_new.workspace_id;
  delta boolean := p_mode = 'delta';
  now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  tk jsonb;
  fields_ok boolean;
  ck text;
  st_changed boolean := false;
  ch_client boolean := false;
  ch_phone boolean := false;
  ch_link boolean := false;
  ch_price boolean := false;
  ch_extras boolean := false;
  s public.desk_rows%rowtype;
  k jsonb;
  skey text;
  theirs text;
  mine text;
  sent text;
  patch jsonb := '{}'::jsonb;
  set_extras boolean := false;
  set_status_key text;
  status_only boolean;
  f text;
  v text;
  sum_code text;
  os_total text;
  t_raw text;
  t_num numeric;
  cur numeric;
  up numeric;
  fee_p numeric;
  fee_u numeric;
  nu numeric;
  target numeric;
  price numeric;
  cand numeric;
  picked numeric;
  step numeric;
begin
  -- 1. Копия честно связана со столом ОС, а хранилище открыто на запись.
  if ws is null or ws not in (select public.rows_writable_workspaces())
     or p_new.os_uid is null or p_new.src_row_id is null
     or p_new.src_page_id is distinct from 'osdesk_' || p_new.os_uid
     or not exists (
       select 1 from public.rows_page_acl a
       where a.workspace_id = ws and a.page_id = p_new.src_page_id and a.os_desk and a.responsible_uid = p_new.os_uid
     ) then
    return jsonb_build_object('code', 'not_linked', 'wrote', false);
  end if;

  -- 2. Что изменилось. Поля — только во вкладке, для которой стол технаря
  --    опубликовал карту столбцов; в остальных вкладках ездит один статус.
  tk := public.rows_tech_keys(ws, p_new.page_id);
  fields_ok := tk is not null and tk ->> 'tabId' = p_new.tab_id;
  if delta then
    st_changed := p_new.status_key is not null
      and (p_old.cells ->> p_new.status_key) is distinct from (p_new.cells ->> p_new.status_key);
    if fields_ok then
      ck := tk ->> 'client';
      ch_client := ck is not null and (p_old.cells ->> ck) is distinct from (p_new.cells ->> ck);
      ck := tk ->> 'phone';
      ch_phone := ck is not null and (p_old.cells ->> ck) is distinct from (p_new.cells ->> ck);
      ck := tk ->> 'link';
      ch_link := ck is not null and (p_old.cells ->> ck) is distinct from (p_new.cells ->> ck);
      ck := tk ->> 'price';
      ch_price := ck is not null and (p_old.cells ->> ck) is distinct from (p_new.cells ->> ck);
      ch_extras := p_old.extras is distinct from p_new.extras;
    end if;
    if not (st_changed or ch_client or ch_phone or ch_link or ch_price or ch_extras) then
      return jsonb_build_object('code', 'noop', 'wrote', false);
    end if;
  end if;

  -- 3. Источник под замком, без ожидания. Он обязан показывать на эту копию.
  select * into s from public.desk_rows x
  where x.workspace_id = ws and x.page_id = p_new.src_page_id
    and x.tab_id = coalesce(p_new.src_tab_id, '') and x.id = p_new.src_row_id
  for update nowait;
  if not found then
    return jsonb_build_object('code', 'no_source', 'wrote', false);
  end if;
  if s.mirror_page_id is distinct from p_new.page_id
     or coalesce(s.mirror_tab_id, '') <> p_new.tab_id
     or s.mirror_row_id is distinct from p_new.id then
    return jsonb_build_object('code', 'not_linked', 'wrote', false);
  end if;

  -- 4. Ключи вкладки источника. Ключ статуса — настоящий столбец вкладки,
  --    иначе записанный на самой строке; нет обоих — статус не пишется
  --    (никакого зашитого 'status').
  k := public.rows_os_tab_keys(ws, p_new.src_page_id, s.tab_id);
  -- Период только начался: документа вкладки стола ОС ещё нет, а источник
  -- связь уже положила в её будущий id month-{период}. Ключи — те же, какими
  -- его собрала связь (rows_os_target), и только пока он лежит ровно там.
  if k is null and s.tab_id like 'month-%' then
    select t.j -> 'keys' into k
    from (select public.rows_os_target(ws, p_new.src_page_id, substr(s.tab_id, 7)) as j) t
    where t.j ->> 'tab' = s.tab_id and coalesce((t.j ->> 'planned')::boolean, false)
      and jsonb_typeof(t.j -> 'keys') = 'object';
  end if;
  skey := coalesce(k ->> 'status', s.status_key);

  -- 5. Статус. Пустой не ездит; недоставленный статус ОС (стоит у ОС, но ещё
  --    не «отправлен») не затирается — «обе стороны разошлись — прав ОС».
  --    Статус и osStatusSent пишутся ОДНИМ значением одной записью: такую
  --    правку desk_rows_os_status_push назад не шлёт.
  if (st_changed or not delta) and skey is not null and p_new.status_key is not null then
    theirs := public.rows_js_trim(p_new.cells ->> p_new.status_key);
    mine := public.rows_js_trim(s.cells ->> skey);
    sent := coalesce(s.cells ->> 'osStatusSent', '');
    if theirs = '' then
      null;
    elsif mine <> '' and mine <> sent and mine <> theirs then
      null;
    elsif theirs = mine then
      if sent <> theirs then
        patch := patch || jsonb_build_object('osStatusSent', theirs);
      end if;
    else
      patch := patch || jsonb_build_object(skey, theirs, 'osStatusSent', theirs);
      if s.status_key is null and skey <> 'status' then
        set_status_key := skey;
      end if;
    end if;
  end if;
  status_only := true;

  -- 6. Поля: только изменённое в этой правке и только если у ОС другое.
  if delta and fields_ok and k is not null then
    foreach f in array array['client', 'phone', 'link'] loop
      if (f = 'client' and ch_client) or (f = 'phone' and ch_phone) or (f = 'link' and ch_link) then
        v := public.rows_js_trim(p_new.cells ->> (tk ->> f));
        if v <> public.rows_js_trim(s.cells ->> (k ->> f)) then
          patch := patch || jsonb_build_object(k ->> f, v);
          status_only := false;
        end if;
      end if;
    end loop;
    if ch_extras and p_new.extras is distinct from s.extras then
      set_extras := true;
      status_only := false;
    end if;
  end if;

  -- 7. Сумма. У технаря один денежный столбец — это «Итого» ОС. Нет апсейла
  --    и комиссий — цена = сумма технаря. Есть — цена ДО комиссии подбирается
  --    так, чтобы «Итого» сошлось с суммой технаря; апсейл, способ оплаты и
  --    комиссии не трогаются. Не подбирается (сумма меньше апсейла, комиссия
  --    100 %, сумму стёрли при апсейле, в ячейке не число) — ничего не пишем,
  --    ответ `sum: refused` с суммой ОС. Разница меньше копейки — равенство.
  --    В режиме state сумма только сверяется (отказ виден клиенту), не пишется.
  if fields_ok and k is not null and (ch_price or not delta) and (tk ->> 'price') is not null then
    t_raw := public.rows_js_trim(p_new.cells ->> (tk ->> 'price'));
    t_num := public.rows_num_loose(t_raw);
    cur := coalesce(public.rows_os_total(s.cells, k ->> 'price', k ->> 'upsell'), 0);
    os_total := case when cur = 0 then '' else public.rows_num_text(cur) end;
    if t_raw <> '' and t_num is null then
      sum_code := 'refused';
    elsif abs(coalesce(t_num, 0) - cur) < 0.011 then
      null;
    else
      up := public.rows_cell_num(s.cells, k ->> 'upsell');
      fee_p := least(100, greatest(0, public.rows_cell_num(s.cells, (k ->> 'price') || '__fee')));
      fee_u := least(100, greatest(0, public.rows_cell_num(s.cells, (k ->> 'upsell') || '__fee')));
      nu := up * (1 - fee_u / 100);
      if coalesce(t_num, 0) = 0 then
        if up = 0 then
          if delta then
            patch := patch || jsonb_build_object(k ->> 'price', '', k ->> 'total', '');
            status_only := false;
          end if;
        else
          sum_code := 'refused';
        end if;
      elsif fee_p < 100 and t_num >= nu then
        target := round(t_num, 2);
        price := round((t_num - nu) / (1 - fee_p / 100), 2);
        foreach step in array array[0, 0.01, -0.01, 0.02, -0.02] loop
          cand := price + step;
          if picked is null and cand >= 0 and round(cand * (1 - fee_p / 100) + nu, 2) = target then
            picked := cand;
          end if;
        end loop;
        if picked is null and abs(round(price * (1 - fee_p / 100) + nu, 2) - target) < 0.011 then
          picked := price;
        end if;
        if picked is null then
          sum_code := 'refused';
        elsif delta then
          patch := patch || jsonb_build_object(
            k ->> 'price', public.rows_num_text(picked),
            k ->> 'total', public.rows_num_text(round(picked * (1 - fee_p / 100) + nu, 2)));
          status_only := false;
        end if;
      else
        sum_code := 'refused';
      end if;
    end if;
  end if;

  -- 8. Одна запись. Правка «только статус» идёт под nova.lead_move: статус
  --    уже записан в историю событием копии (field = 'tech'), второе событие
  --    с источника было бы тем же самым (читает GUC только desk_rows_events).
  if patch = '{}'::jsonb and not set_extras and set_status_key is null then
    return jsonb_strip_nulls(jsonb_build_object('code', 'ok', 'wrote', false, 'sum', sum_code,
      'osTotal', case when sum_code is not null then os_total end));
  end if;
  if status_only then
    perform set_config('nova.lead_move', '1', true);
  end if;
  update public.desk_rows x set
    cells = x.cells || patch,
    extras = case when set_extras then p_new.extras else x.extras end,
    status_key = coalesce(set_status_key, x.status_key),
    updated_at = now_ms
  where x.workspace_id = ws and x.page_id = s.page_id and x.tab_id = s.tab_id and x.id = s.id;
  if status_only then
    perform set_config('nova.lead_move', '', true);
  end if;
  return jsonb_strip_nulls(jsonb_build_object('code', 'ok', 'wrote', true, 'sum', sum_code,
    'osTotal', case when sum_code is not null then os_total end));
end;
$$;

revoke all on function public.rows_tech_apply(public.desk_rows, public.desk_rows, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Д. Триггер на копии: правка технаря (Owner, Тимлид с «Успешкой») связанной
--    строки сразу доезжает до источника — для любого клиента, и для вкладок
--    на старом коде тоже.
--
--    AFTER и по имени раньше desk_rows_zz_events: список BEFORE-триггеров
--    (стражи → статус → rev) не меняется, а событие копии пишется после.
--
--    Выходит, ничего не делая:
--      • вложенная правка (pg_trigger_depth() > 1) — копию правит
--        desk_rows_os_status_push изнутри правки источника; писать назад в
--        строку, которую меняет текущая команда, нельзя;
--      • перенос периода, переезд к другому ОС, собственная метка связи (GUC);
--      • сессия без токена; сменились опорные поля или подпись полей
--        (sync_hash меняет только пересылка ОС → технарь);
--      • правит сам ОС этой строки (если он же не её технарь) — источник он
--        ведёт у себя;
--      • новое выключено (rows_tech_sync_on).
--    Правку человека не роняет НИКОГДА: источник занят — три попытки через
--    40 мс и пропуск; любая другая ошибка — WARNING и пропуск. Пропущенный
--    статус чинит rows_tech_sync (клиент после своей записи и при открытии
--    стола).
-- ---------------------------------------------------------------------
create or replace function public.desk_rows_tech_push() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me text;
  attempt integer := 0;
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  if coalesce(current_setting('nova.carry_over', true), '') = '1'
     or coalesce(current_setting('nova.lead_move', true), '') = '1'
     or coalesce(current_setting('nova.tech_sync', true), '') = '1' then
    return null;
  end if;
  me := public.rows_uid();
  if me is null then
    return null;
  end if;
  if new.os_uid is distinct from old.os_uid
     or new.tech_uid is distinct from old.tech_uid
     or new.status_key is distinct from old.status_key
     or new.src_page_id is distinct from old.src_page_id
     or new.src_tab_id is distinct from old.src_tab_id
     or new.src_row_id is distinct from old.src_row_id
     or new.sync_hash is distinct from old.sync_hash then
    return null;
  end if;
  if me = new.os_uid and me is distinct from new.tech_uid then
    return null;
  end if;
  if not coalesce(public.rows_tech_sync_on(new.workspace_id, new.page_id), false) then
    return null;
  end if;
  loop
    begin
      perform public.rows_tech_apply(old, new, 'delta');
      exit;
    exception
      when lock_not_available then
        attempt := attempt + 1;
        if attempt >= 3 then
          exit;
        end if;
        perform pg_sleep(0.04);
      when others then
        raise warning 'desk_rows_tech_push: % (%)', sqlerrm, sqlstate;
        exit;
    end;
  end loop;
  return null;
exception when others then
  raise warning 'desk_rows_tech_push: % (%)', sqlerrm, sqlstate;
  return null;
end;
$$;

revoke all on function public.desk_rows_tech_push() from public, anon, authenticated;

drop trigger if exists desk_rows_tech_push on public.desk_rows;
create trigger desk_rows_tech_push after update on public.desk_rows
  for each row
  when (new.os_uid is not null and new.src_row_id is not null
        and (new.cells is distinct from old.cells or new.extras is distinct from old.extras))
  execute function public.desk_rows_tech_push();

-- ---------------------------------------------------------------------
-- Е1. Одна строка технаря: связать, перевесить на другого ОС или починить
--     статус. Зовёт её только rows_tech_sync — в своём под-блоке на строку
--     (ошибка откатывает строку целиком вместе с GUC nova.tech_sync).
--
--     СВЯЗАННАЯ строка:
--       а) ник в столбце ОС больше не ник её ОС, а ОС источник ещё не трогал
--          (id выведен из строки, показывает на неё, подсветка «новый» не
--          снята, нет заказа с биржи и вложений, технарь в нём прежний, нет
--          ни одной своей ячейки и заказ ему не передавали из «Общей
--          таблицы») — источник удаляется, связь снимается, и
--          строка идёт дальше как несвязанная. Тронул — заказ остаётся у
--          прежнего ОС (osFixed), сменить ОС может Owner / Тимлид+;
--       б) rows_tech_apply(state) — статус.
--     НЕСВЯЗАННАЯ: отказы по порядку (первый — ответ), потом источник на
--     столе единственного ОС с этим ником во вкладке текущего периода и
--     метка связи на строке технаря — одной транзакцией. Ячейки источника
--     база собирает сама из сохранённой строки (как buildClaimSource).
--     Источник без адреса копии (ОС снял технаря, «Вернуть») со стороны
--     технаря не берётся никогда — `released`; p_force (Owner / Тимлид+,
--     «Передать ОС») берёт его снова и снимает отметку «вернули технарю».
-- ---------------------------------------------------------------------
create or replace function public.rows_tech_sync_item(
  p_workspace text,
  p_page text,
  p_tab text,
  p_row text,
  p_force boolean,
  p_resp text,
  p_tk jsonb,
  p_period text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  tab text := coalesce(p_tab, '');
  now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  r public.desk_rows%rowtype;
  s public.desk_rows%rowtype;
  src public.desk_rows%rowtype;
  src_found boolean := false;
  src_id text;
  src_tab text;
  cand text;
  cand1 text;
  cand2 text;
  k jsonb;
  res jsonb;
  os_fixed boolean := false;
  s_found boolean;
  cur_nick text;
  linked_nick text;
  tech_nick text;
  nick text;
  v_os text;
  os_count integer;
  os_page text;
  target jsonb;
  built jsonb := '{}'::jsonb;
  merged jsonb;
  v text;
  n numeric;
  total numeric;
  order_ms bigint;
  src_status_key text;
  released_mark boolean;
begin
  -- Строка технаря — под замком до конца транзакции (ожидание ограничено
  -- lock_timeout вызывающего: дольше — ответ busy).
  select * into r from public.desk_rows x
  where x.workspace_id = p_workspace and x.page_id = p_page and x.tab_id = tab and x.id = p_row
  for update;
  if not found then
    return jsonb_build_object('row', p_row, 'code', 'gone');
  end if;
  cand1 := public.rows_claim_src_id(r.id);
  cand2 := cand1 || '_' || substr(md5(p_page || '/' || tab), 1, 8);

  if r.os_uid is not null then
    -- а) В столбце ОС другой ник (или его стёрли).
    if p_tk is not null and p_tk ->> 'tabId' = tab and r.src_row_id is not null
       and r.src_page_id = 'osdesk_' || r.os_uid then
      cur_nick := public.rows_js_trim(r.cells ->> (p_tk ->> 'os'));
      select public.rows_js_trim(m.os_nick_value) into linked_nick
      from public.rows_members m where m.workspace_id = p_workspace and m.uid = r.os_uid;
      if cur_nick <> coalesce(linked_nick, '') then
        select * into s from public.desk_rows x
        where x.workspace_id = p_workspace and x.page_id = r.src_page_id
          and x.tab_id = coalesce(r.src_tab_id, '') and x.id = r.src_row_id
        for update nowait;
        s_found := found;
        if s_found then
          k := public.rows_os_tab_keys(p_workspace, s.page_id, s.tab_id);
          tech_nick := public.rows_tech_nick(p_workspace, p_resp);
        end if;
        if s_found and k is not null
           and s.id in (cand1, cand2)
           and s.mirror_page_id = p_page and coalesce(s.mirror_tab_id, '') = tab and s.mirror_row_id = r.id
           and s.highlight and s.order_id is null
           and (s.attachments is null or jsonb_typeof(s.attachments) = 'null' or s.attachments = '[]'::jsonb)
           and public.rows_js_trim(s.cells ->> (k ->> 'technician')) = coalesce(tech_nick, '')
           and not exists (
             select 1 from jsonb_each(s.cells) e
             where e.key not in (k ->> 'client', k ->> 'phone', k ->> 'price', k ->> 'total', k ->> 'link', k ->> 'note',
                                 k ->> 'technician', k ->> 'status', 'osStatusSent', 'osIssuedAt', 'osLostFor')
               and not public.desk_cells_blank(jsonb_build_object(e.key, e.value))
           )
           -- «Примечание» ОС — пусто или ровно пожелание из визитки, которое
           -- положила связь: своя заметка ОС значит «тронул».
           and public.rows_js_trim(s.cells ->> (k ->> 'note')) in ('', public.rows_js_trim(r.extras ->> 'note'))
           -- Заказ этому ОС передал Owner / Тимлид+ («Общая таблица») — его
           -- решение ник в ячейке технаря не отменяет. И любая правка самого
           -- ОС, оставившая событие (статус, сумма, технарь), — тоже «тронул».
           and not exists (
             select 1 from public.order_events ev
             where ev.workspace_id = p_workspace and ev.order_key = s.id
               and (ev.kind = 'os' or ev.actor_uid = r.os_uid)
           ) then
          delete from public.desk_rows x
          where x.workspace_id = p_workspace and x.page_id = s.page_id and x.tab_id = s.tab_id and x.id = s.id;
          perform set_config('nova.tech_sync', '1', true);
          update public.desk_rows x set
            os_uid = null, tech_uid = null, status_key = null,
            src_page_id = null, src_tab_id = null, src_row_id = null, sync_hash = null
          where x.workspace_id = p_workspace and x.page_id = p_page and x.tab_id = tab and x.id = r.id;
          perform set_config('nova.tech_sync', '', true);
          select * into r from public.desk_rows x
          where x.workspace_id = p_workspace and x.page_id = p_page and x.tab_id = tab and x.id = p_row;
        else
          os_fixed := true;
        end if;
      end if;
    end if;
    -- б) Статус.
    if r.os_uid is not null then
      res := public.rows_tech_apply(r, r, 'state');
      return jsonb_strip_nulls(jsonb_build_object(
        'row', r.id, 'code', res ->> 'code', 'wrote', res -> 'wrote',
        'srcPage', r.src_page_id, 'srcTab', coalesce(r.src_tab_id, ''), 'srcRow', r.src_row_id, 'osUid', r.os_uid,
        'osFixed', case when os_fixed then true end,
        'sum', res -> 'sum', 'osTotal', res -> 'osTotal'));
    end if;
  end if;

  -- Несвязанная строка: отказы по порядку.
  if public.desk_cells_blank(r.cells) then
    return jsonb_build_object('row', r.id, 'code', 'blank');
  end if;
  if not p_force and exists (
    select 1 from public.rows_owner_only o where o.workspace_id = p_workspace and o.page_id = p_page
  ) then
    return jsonb_build_object('row', r.id, 'code', 'owner_only');
  end if;
  if p_tk is null or p_tk ->> 'tabId' is distinct from tab then
    return jsonb_build_object('row', r.id, 'code', 'no_keys');
  end if;
  if p_period is null or (tab like 'month-%' and tab <> 'month-' || p_period) then
    return jsonb_build_object('row', r.id, 'code', 'period_mismatch');
  end if;
  -- Копия, которую ОС выдал со своего стола, а Owner вернул технарю.
  if not p_force and starts_with(r.id, 'os_') then
    return jsonb_build_object('row', r.id, 'code', 'released');
  end if;
  nick := public.rows_js_trim(r.cells ->> (p_tk ->> 'os'));
  if nick = '' then
    return jsonb_build_object('row', r.id, 'code', 'no_os');
  end if;
  if public.rows_js_trim(r.cells ->> (p_tk ->> 'client')) = '' then
    return jsonb_build_object('row', r.id, 'code', 'no_client');
  end if;
  released_mark := public.rows_js_trim(r.cells ->> 'osReleasedFrom') <> '';
  if not p_force and public.rows_js_trim(r.cells ->> 'osReleasedFrom') = nick then
    return jsonb_build_object('row', r.id, 'code', 'released');
  end if;
  -- Ник — ровно у одного участника с ролью ОС (копия прав, её ведёт руководство).
  select count(*), min(m.uid) into os_count, v_os
  from public.rows_members m
  where m.workspace_id = p_workspace and public.rows_js_trim(m.os_nick_value) = nick
    and (m.role = 'os' or 'os' = any (m.extra_roles));
  if os_count = 0 then
    return jsonb_build_object('row', r.id, 'code', 'no_os_member');
  end if;
  if os_count > 1 then
    return jsonb_build_object('row', r.id, 'code', 'nick_ambiguous');
  end if;
  -- Ник технаря — только из документа участника: без него первый же проход
  -- стола ОС удалил бы строку как «заказ, у которого стёрли технаря».
  tech_nick := public.rows_tech_nick(p_workspace, p_resp);
  if tech_nick is null then
    return jsonb_build_object('row', r.id, 'code', 'no_tech_nick');
  end if;
  os_page := 'osdesk_' || v_os;
  if not exists (
    select 1 from public.rows_page_acl a
    where a.workspace_id = p_workspace and a.page_id = os_page and a.os_desk and a.responsible_uid = v_os
  ) then
    return jsonb_build_object('row', r.id, 'code', 'no_os_desk', 'osUid', v_os);
  end if;
  target := public.rows_os_target(p_workspace, os_page, p_period);
  if target is null or target -> 'keys' is null or jsonb_typeof(target -> 'keys') <> 'object' then
    return jsonb_build_object('row', r.id, 'code', 'no_os_map', 'osUid', v_os);
  end if;

  -- Один источник на заказ: все, кто заводит `adopt_<id>` на этом столе ОС,
  -- идут по очереди.
  perform pg_advisory_xact_lock(hashtextextended(p_workspace || '/' || os_page || '/' || cand1, 0));

  -- «Передать ОС» у копии `os_<источник>`, возвращённой технарю: на столе ОС
  -- жива ИСХОДНАЯ строка — подключаем её, а не заводим рядом вторую.
  if p_force and starts_with(r.id, 'os_') and length(r.id) > 3 then
    select * into src from public.desk_rows x
    where x.workspace_id = p_workspace and x.page_id = os_page and x.id = substr(r.id, 4)
      -- Строка без адреса копии — только та, которую вернули ЭТОМУ технарю
      -- (osLostFor = его ник): иначе id `os_<любой id>` подключал бы строку
      -- технаря к любой строке стола ОС и переписывал её.
      and ((x.mirror_row_id is null and public.rows_js_trim(x.cells ->> 'osLostFor') = tech_nick)
        or (x.mirror_page_id = p_page and coalesce(x.mirror_tab_id, '') = tab and x.mirror_row_id = r.id))
    order by (x.mirror_row_id is not null) desc, (x.tab_id = target ->> 'tab') desc
    limit 1
    for update nowait;
    if found then
      src_id := src.id;
      src_found := true;
    end if;
  end if;

  -- Поиск источника — как у rows_os_claim_order (20261041): выведенный id,
  -- потом он же с хвостом от адреса стола, по ВСЕМ вкладкам стола ОС.
  if src_id is null then
    foreach cand in array array[cand1, cand2] loop
      select * into src from public.desk_rows x
      where x.workspace_id = p_workspace and x.page_id = os_page and x.id = cand
      order by (x.mirror_page_id = p_page and coalesce(x.mirror_tab_id, '') = tab and x.mirror_row_id = r.id) desc nulls last,
               (x.mirror_row_id is null) desc,
               (x.tab_id = target ->> 'tab') desc
      limit 1
      for update nowait;
      if not found then
        src_id := cand;
        src_found := false;
        exit;
      end if;
      if src.mirror_page_id = p_page and coalesce(src.mirror_tab_id, '') = tab and src.mirror_row_id = r.id then
        src_id := cand;
        src_found := true;
        exit;
      end if;
      if src.mirror_row_id is null then
        -- Отличие от забора ОС: источник без адреса копии сторона технаря не
        -- берёт (иначе выдуманным id строки подключались бы к чужому заказу).
        if not p_force then
          return jsonb_build_object('row', r.id, 'code', 'released', 'osUid', v_os);
        end if;
        -- p_force: пустой osLostFor (ОС сам снял технаря) или ник этого технаря.
        if public.rows_js_trim(src.cells ->> 'osLostFor') in ('', tech_nick) then
          src_id := cand;
          src_found := true;
          exit;
        end if;
        continue;  -- источник вернули ДРУГОМУ технарю: не берём, следующий id
      end if;
      -- Источник показывает на копию, которую ОС завёл из него сам.
      if src.mirror_row_id = 'os_' || cand then
        return jsonb_build_object('row', r.id, 'code', 'released', 'osUid', v_os);
      end if;
    end loop;
  end if;
  if src_id is null then
    return jsonb_build_object('row', r.id, 'code', 'src_conflict', 'osUid', v_os);
  end if;

  -- Ячейки источника — под ключами ЕГО вкладки (если он уже лежит), иначе
  -- вкладки периода.
  k := target -> 'keys';
  src_tab := target ->> 'tab';
  if src_found then
    src_tab := src.tab_id;
    k := coalesce(public.rows_os_tab_keys(p_workspace, os_page, src.tab_id), k);
  end if;
  order_ms := coalesce(nullif(greatest(coalesce(r.created_at, 0), coalesce(r.filled_at, 0)), 0), now_ms);

  v := public.rows_js_trim(r.cells ->> (p_tk ->> 'client'));
  if v <> '' then built := built || jsonb_build_object(k ->> 'client', v); end if;
  v := public.rows_js_trim(r.cells ->> (p_tk ->> 'phone'));
  if v <> '' then built := built || jsonb_build_object(k ->> 'phone', v); end if;
  -- Цена у технаря — уже сумма заказа; апсейл отдельной цифрой ОС ставит сам.
  v := public.rows_js_trim(r.cells ->> (p_tk ->> 'price'));
  if v <> '' then
    n := public.rows_num_loose(v);
    -- Переиспользуемый источник с апсейлом или комиссией на цене: сумма
    -- технаря — это «Итого», а не цена. Цену ОС не трогаем.
    if not (src_found and (
         public.rows_cell_num(src.cells, k ->> 'upsell') <> 0
         or public.rows_cell_num(src.cells, (k ->> 'price') || '__fee') <> 0)) then
      built := built || jsonb_build_object(k ->> 'price', case when n is null then v else public.rows_num_text(n) end);
    end if;
  end if;
  v := public.rows_js_trim(r.cells ->> (p_tk ->> 'link'));
  if v <> '' then built := built || jsonb_build_object(k ->> 'link', v); end if;
  -- Пожелания из визитки — в «Примечание», только пока своё у ОС пусто.
  v := public.rows_js_trim(r.extras ->> 'note');
  if v <> '' and (not src_found or public.rows_js_trim(src.cells ->> (k ->> 'note')) = '') then
    built := built || jsonb_build_object(k ->> 'note', v);
  end if;
  built := built || jsonb_build_object(k ->> 'technician', tech_nick, 'osIssuedAt', order_ms::text, 'osLostFor', '');
  -- Статус технаря — сразу и в столбец ОС, и как «синхронизированный».
  v := public.rows_js_trim(r.cells ->> (p_tk ->> 'status'));
  if v <> '' then
    built := built || jsonb_build_object(k ->> 'status', v, 'osStatusSent', v);
  end if;
  merged := case when src_found then src.cells || built else built end;
  total := public.rows_os_total(merged, k ->> 'price', k ->> 'upsell');
  if total is not null and total > 0 then
    built := built || jsonb_build_object(k ->> 'total', public.rows_num_text(total));
  end if;
  src_status_key := case when k ->> 'status' <> 'status' then k ->> 'status' end;

  if src_found then
    update public.desk_rows x set
      cells = x.cells || built,
      extras = coalesce(r.extras, x.extras),
      status_key = coalesce(src_status_key, x.status_key),
      mirror_page_id = p_page,
      mirror_tab_id = tab,
      mirror_row_id = r.id,
      highlight = true,
      updated_at = now_ms
    where x.workspace_id = p_workspace and x.page_id = os_page and x.tab_id = src_tab and x.id = src_id;
  else
    insert into public.desk_rows (
      workspace_id, page_id, tab_id, id, cells, extras, sort_order,
      created_at, updated_at, highlight, status_key, mirror_page_id, mirror_tab_id, mirror_row_id
    ) values (
      p_workspace, os_page, src_tab, src_id, built,
      case when r.extras is null or jsonb_typeof(r.extras) = 'null' then null else r.extras end,
      public.rows_append_order(p_workspace, os_page, src_tab),
      order_ms, now_ms, true, src_status_key, p_page, tab, r.id
    );
  end if;

  -- Метка связи на строке технаря. Ячейки не трогаются (кроме снятия отметки
  -- «вернули технарю» при p_force — это правка Owner / Тимлид+, её пускает
  -- обычная ветка замка). Подпись полей не пишется.
  perform set_config('nova.tech_sync', '1', true);
  update public.desk_rows x set
    cells = case when p_force and released_mark then x.cells || jsonb_build_object('osReleasedFrom', '') else x.cells end,
    os_uid = v_os,
    tech_uid = p_resp,
    status_key = p_tk ->> 'status',
    src_page_id = os_page,
    src_tab_id = src_tab,
    src_row_id = src_id
  where x.workspace_id = p_workspace and x.page_id = p_page and x.tab_id = tab and x.id = r.id;
  perform set_config('nova.tech_sync', '', true);

  return jsonb_strip_nulls(jsonb_build_object(
    'row', r.id, 'code', 'linked', 'srcPage', os_page, 'srcTab', src_tab, 'srcRow', src_id, 'osUid', v_os,
    'planned', case when not src_found and coalesce((target ->> 'planned')::boolean, false) then true end));
end;
$$;

revoke all on function public.rows_tech_sync_item(text, text, text, text, boolean, text, jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Е2. Пачка строк стола технаря. p_items — [{row}] (≤ 50, прочие поля
--     элемента не читаются) или null: все несвязанные строки вкладки с
--     непустым столбцом ОС (≤ 200, занятые другой транзакцией пропускаются).
--     Ответ: {status: ok | off | no_core | out_of_scope, period, items, more}.
--     Каждая строка — в своём под-блоке: занята → busy, сбой → error, на
--     остальные строки пачки это не влияет.
-- ---------------------------------------------------------------------
create or replace function public.rows_tech_sync(
  p_workspace text,
  p_page text,
  p_tab text,
  p_items jsonb default null,
  p_force boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  tab text := coalesce(p_tab, '');
  force boolean := coalesce(p_force, false);
  edit_all boolean;
  acl public.rows_page_acl%rowtype;
  tk jsonb;
  period text;
  ids text[];
  rid text;
  item jsonb;
  items jsonb := '[]'::jsonb;
  more boolean := false;
  prev_timeout text;
begin
  if me is null then
    raise exception 'rows_tech_sync: нужен вход' using errcode = '42501';
  end if;
  if p_workspace is null or p_workspace not in (select public.rows_writable_workspaces()) then
    raise exception 'rows_tech_sync: хранилище строк закрыто' using errcode = '42501';
  end if;
  if p_items is not null and jsonb_typeof(p_items) <> 'null' then
    if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 50 or exists (
      select 1 from jsonb_array_elements(p_items) e
      where jsonb_typeof(e.value) <> 'object'
         or coalesce(jsonb_typeof(e.value -> 'row'), '') <> 'string'
         or e.value ->> 'row' = ''
    ) then
      raise exception 'rows_tech_sync: p_items — массив до 50 элементов {row}' using errcode = '22023';
    end if;
  end if;

  select * into acl from public.rows_page_acl a where a.workspace_id = p_workspace and a.page_id = p_page;
  if not found or acl.os_desk or starts_with(coalesce(p_page, ''), 'osdesk_') or acl.responsible_uid is null then
    return jsonb_build_object('status', 'out_of_scope', 'items', '[]'::jsonb);
  end if;
  edit_all := p_workspace in (select public.rows_edit_all_workspaces());
  if not edit_all and not ((p_workspace, p_page) in (select e.workspace_id, e.page_id from public.rows_editable_pages() e)) then
    raise exception 'rows_tech_sync: не редактор стола' using errcode = '42501';
  end if;
  -- Стол «только для Owner» ведёт только Owner (Тимлид+ его строк не видит).
  if exists (select 1 from public.rows_owner_only o where o.workspace_id = p_workspace and o.page_id = p_page)
     and not coalesce(public.rows_is_owner(p_workspace), false) then
    raise exception 'rows_tech_sync: стол только для Owner' using errcode = '42501';
  end if;
  if force and not edit_all then
    raise exception 'rows_tech_sync: «Передать ОС» — Owner или Тимлид+' using errcode = '42501';
  end if;
  if not coalesce(public.rows_tech_fills(p_workspace, p_page), false) then
    return jsonb_build_object('status', 'out_of_scope', 'items', '[]'::jsonb);
  end if;
  if not coalesce((select w.tech_sync from public.rows_workspaces w where w.workspace_id = p_workspace), false) then
    return jsonb_build_object('status', 'off', 'items', '[]'::jsonb);
  end if;
  if not coalesce(public.rows_core_live(p_workspace), false) then
    return jsonb_build_object('status', 'no_core', 'items', '[]'::jsonb);
  end if;

  tk := public.rows_tech_keys(p_workspace, p_page);
  period := public.rows_period_now(p_workspace);

  if p_items is null or jsonb_typeof(p_items) = 'null' then
    -- Все несвязанные строки вкладки с ником в столбце ОС.
    if tk is not null and tk ->> 'tabId' = tab then
      select coalesce(array_agg(q.id), '{}') into ids from (
        select x.id from public.desk_rows x
        where x.workspace_id = p_workspace and x.page_id = p_page and x.tab_id = tab
          and x.os_uid is null and btrim(coalesce(x.cells ->> (tk ->> 'os'), '')) <> ''
        order by x.sort_order, x.id
        limit 201
        for update skip locked
      ) q;
      if cardinality(ids) > 200 then
        more := true;
        ids := ids[1:200];
      end if;
    else
      ids := '{}';
    end if;
  else
    select coalesce(array_agg(q.id order by q.id), '{}') into ids from (
      select distinct e.value ->> 'row' as id from jsonb_array_elements(p_items) e
    ) q;
  end if;

  -- Ждать чужую правку строки дольше нельзя: пачка держит замки прежних
  -- строк. Не дождались — busy, клиент повторит.
  prev_timeout := current_setting('lock_timeout', true);
  perform set_config('lock_timeout', '400ms', true);
  foreach rid in array ids loop
    begin
      item := public.rows_tech_sync_item(p_workspace, p_page, tab, rid, force, acl.responsible_uid, tk, period);
    exception
      when lock_not_available or deadlock_detected then
        item := jsonb_build_object('row', rid, 'code', 'busy');
      when unique_violation then
        item := jsonb_build_object('row', rid, 'code', 'src_conflict');
      when others then
        item := jsonb_build_object('row', rid, 'code', 'error', 'detail', sqlstate);
    end;
    items := items || jsonb_build_array(item);
  end loop;
  perform set_config('lock_timeout', coalesce(nullif(prev_timeout, ''), '0'), true);

  return jsonb_build_object('status', 'ok', 'period', period, 'items', items, 'more', more);
end;
$$;

revoke all on function public.rows_tech_sync(text, text, text, jsonb, boolean) from public;
grant execute on function public.rows_tech_sync(text, text, text, jsonb, boolean) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Е3. Что на вкладке разошлось — одним запросом, без записи. SECURITY
--     INVOKER: считается под политиками спрашивающего (стол ОС читает любой
--     участник, стол технаря — кто его читает); чужому — пустые списки.
--       drift — связанные строки, чей непустой статус ≠ osStatusSent источника;
--       dead  — связанные строки, чьего источника нет, он показывает не на них
--               или лежит не на столе их ОС.
-- ---------------------------------------------------------------------
create or replace function public.rows_tech_sync_scan(p_workspace text, p_page text, p_tab text) returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with linked as (
    select c.id, c.sort_order,
           btrim(coalesce(c.cells ->> c.status_key, '')) as st,
           s.id as src_id,
           (c.src_page_id = 'osdesk_' || c.os_uid
             and s.mirror_page_id = c.page_id and coalesce(s.mirror_tab_id, '') = c.tab_id and s.mirror_row_id = c.id) as back,
           coalesce(s.cells ->> 'osStatusSent', '') as sent
    from public.desk_rows c
    left join public.desk_rows s
      on s.workspace_id = c.workspace_id and s.page_id = c.src_page_id
     and s.tab_id = coalesce(c.src_tab_id, '') and s.id = c.src_row_id
    where c.workspace_id = p_workspace and c.page_id = p_page and c.tab_id = coalesce(p_tab, '')
      and c.os_uid is not null and c.src_row_id is not null
  )
  select jsonb_build_object(
    'drift', coalesce((select jsonb_agg(q.id) from (
        select l.id from linked l
        where l.src_id is not null and coalesce(l.back, false) and l.st <> '' and l.st <> l.sent
        order by l.sort_order, l.id limit 500) q), '[]'::jsonb),
    'dead', coalesce((select jsonb_agg(q.id) from (
        select l.id from linked l
        where l.src_id is null or not coalesce(l.back, false)
        order by l.sort_order, l.id limit 500) q), '[]'::jsonb)
  )
$$;

revoke all on function public.rows_tech_sync_scan(text, text, text) from public;
grant execute on function public.rows_tech_sync_scan(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Е4. Состояние для клиента: {on, core, period}; Owner (все столы ОС) и ОС
--     (свой стол) получают ещё desks — куда база положит заказ периода, какими
--     ключами, и вкладки, где строки уже лежат, а документа вкладки нет
--     (orphans): по ним сессия Owner сверяет ключи с JS и заводит вкладки.
-- ---------------------------------------------------------------------
create or replace function public.rows_tech_sync_state(p_workspace text) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.rows_uid();
  is_owner boolean;
  period text;
  desks jsonb;
begin
  if me is null or not coalesce(public.rows_is_member(p_workspace), false) then
    raise exception 'rows_tech_sync_state: только участник' using errcode = '42501';
  end if;
  is_owner := coalesce(public.rows_is_owner(p_workspace), false);
  period := public.rows_period_now(p_workspace);
  if is_owner or coalesce(public.rows_has_role(p_workspace, 'os'), false) then
    select coalesce(jsonb_agg(
      jsonb_build_object('page', a.page_id, 'tab', t.target -> 'tab', 'planned', coalesce(t.target -> 'planned', 'false'::jsonb),
        'keys', t.target -> 'keys',
        'orphans', coalesce((
          select jsonb_agg(o.tab_id order by o.tab_id) from (
            select distinct r.tab_id from public.desk_rows r
            where r.workspace_id = p_workspace and r.page_id = a.page_id and r.tab_id <> ''
              and not exists (
                select 1 from public.core_docs s
                where s.workspace_id = p_workspace and s.kind = 'subpage' and s.parent_id = a.page_id
                  and s.id = r.tab_id and not s.deleted)
          ) o), '[]'::jsonb))
      order by a.page_id), '[]'::jsonb) into desks
    from public.rows_page_acl a
    cross join lateral (select public.rows_os_target(p_workspace, a.page_id, period) as target) t
    where a.workspace_id = p_workspace and a.os_desk and a.page_id like 'osdesk\_%'
      and (is_owner or a.page_id = 'osdesk_' || me);
  end if;
  -- on: null — ещё не включали (ключ в ответе есть всегда).
  return jsonb_build_object(
      'on', (select w.tech_sync from public.rows_workspaces w where w.workspace_id = p_workspace),
      'core', coalesce(public.rows_core_live(p_workspace), false),
      'period', period)
    || case when desks is null then '{}'::jsonb else jsonb_build_object('desks', desks) end;
end;
$$;

revoke all on function public.rows_tech_sync_state(text) from public;
grant execute on function public.rows_tech_sync_state(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Е5. Выключатель — только Owner.
-- ---------------------------------------------------------------------
create or replace function public.rows_set_tech_sync(p_workspace text, p_on boolean) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not coalesce(public.rows_is_owner(p_workspace), false) then
    raise exception 'rows_set_tech_sync: только Owner' using errcode = '42501';
  end if;
  if p_on is null then
    raise exception 'rows_set_tech_sync: нужно true или false' using errcode = '22023';
  end if;
  update public.rows_workspaces set tech_sync = p_on where workspace_id = p_workspace;
  if not found then
    raise exception 'rows_set_tech_sync: workspace не заведён' using errcode = 'P0002';
  end if;
  return p_on;
end;
$$;

revoke all on function public.rows_set_tech_sync(text, boolean) from public;
grant execute on function public.rows_set_tech_sync(text, boolean) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Ж. Замок строки-заказа: полная копия из 20261007 + три вставки (помечены
--    «20261045»). Остальной текст не менялся.
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
  -- ПЕРЕНОС в новый период (rows_carry_over, 20261007): функция ставит GUC
  -- nova.carry_over на транзакцию и меняет только адресные поля (tab_id,
  -- sort_order, carried_*, mirror_tab_id / src_tab_id) — содержимое строки и
  -- опорные поля заказа при этом не трогаются, что и проверяется ниже. Через
  -- PostgREST set_config недоступен, так что снаружи ветку не включить.
  if tg_op = 'UPDATE' and coalesce(current_setting('nova.carry_over', true), '') = '1'
     and new.cells is not distinct from old.cells
     and new.extras is not distinct from old.extras
     and new.attachments is not distinct from old.attachments
     and new.os_uid is not distinct from old.os_uid
     and new.tech_uid is not distinct from old.tech_uid
     and new.status_key is not distinct from old.status_key
     and new.src_page_id is not distinct from old.src_page_id
     and new.src_row_id is not distinct from old.src_row_id
     and new.order_id is not distinct from old.order_id
     and new.sync_hash is not distinct from old.sync_hash
     and new.filled_at is not distinct from old.filled_at then
    return new;
  end if;

  -- 20261045. МЕТКА СВЯЗИ от rows_tech_sync: функция ставит GUC
  -- nova.tech_sync на время одной своей записи и сразу снимает (через
  -- PostgREST set_config недоступен). Ветка пускает РОВНО две формы правки
  -- строки стола «Заполняет сам», и только при нетронутых содержимом,
  -- визитке, вложениях, заказе с биржи и просьбе об «Успешке»:
  --   (а) связать: os_uid ставится на участника с ролью ОС, источник — на
  --       ЕГО столе `osdesk_{os_uid}`, tech_uid — ответственный стола;
  --   (в) снять связь: все опорные поля и подпись обнуляются разом.
  -- Любая другая правка под GUC идёт обычными ветками ниже.
  if tg_op = 'UPDATE' and coalesce(current_setting('nova.tech_sync', true), '') = '1'
     and new.cells is not distinct from old.cells
     and new.extras is not distinct from old.extras
     and new.attachments is not distinct from old.attachments
     and new.order_id is not distinct from old.order_id
     and new.filled_at is not distinct from old.filled_at
     and new.success_requested_at is not distinct from old.success_requested_at
     and new.success_requested_by is not distinct from old.success_requested_by
     and coalesce(public.rows_tech_sync_on(new.workspace_id, new.page_id), false) then
    if old.os_uid is null and new.os_uid is not null
       and new.sync_hash is not distinct from old.sync_hash
       and new.src_page_id = 'osdesk_' || new.os_uid
       and new.src_row_id is not null and new.tech_uid is not null and new.status_key is not null
       and exists (
         select 1 from public.rows_members m
         where m.workspace_id = new.workspace_id and m.uid = new.os_uid
           and (m.role = 'os' or 'os' = any (m.extra_roles)))
       and exists (
         select 1 from public.rows_page_acl a
         where a.workspace_id = new.workspace_id and a.page_id = new.page_id
           and not a.os_desk and a.responsible_uid = new.tech_uid) then
      return new;
    end if;
    if old.os_uid is not null and new.os_uid is null
       and new.tech_uid is null and new.status_key is null
       and new.src_page_id is null and new.src_tab_id is null and new.src_row_id is null
       and new.sync_hash is null then
      return new;
    end if;
  end if;

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

  -- 20261045. Отметку «вернули технарю» (ячейка osReleasedFrom, её ставит
  -- «Вернуть») на столе с авто-передачей меняет только Owner / Тимлид+: иначе
  -- технарь стёр бы её одной правкой, и заказ сам вернулся бы к ОС.
  if me is not null and not is_owner
     and public.rows_js_trim(old.cells ->> 'osReleasedFrom') <> ''
     and (new.cells ->> 'osReleasedFrom') is distinct from (old.cells ->> 'osReleasedFrom')
     and coalesce(public.rows_tech_sync_on(new.workspace_id, new.page_id), false) then
    raise exception 'desk_rows: отметку «вернули технарю» меняет только Owner' using errcode = '42501';
  end if;

  -- 20261045. Адрес копии со строки-источника не снимается, пока копия на
  -- столе с авто-передачей жива и ссылается на эту строку: проход стола ОС,
  -- не успевший прочитать свежую связь, объявил бы заказ «потерянным» и
  -- разорвал её. Сначала снимается связь с копии («Вернуть», удаление) —
  -- потом адрес. Действует на всех, Owner тоже.
  if me is not null and old.mirror_row_id is not null and new.mirror_row_id is null
     and old.mirror_page_id is not null
     and coalesce(public.rows_tech_sync_on(old.workspace_id, old.mirror_page_id), false)
     and exists (
       select 1 from public.desk_rows c
       where c.workspace_id = old.workspace_id and c.page_id = old.mirror_page_id
         and c.tab_id = coalesce(old.mirror_tab_id, '') and c.id = old.mirror_row_id
         and c.os_uid is not null and c.src_page_id = old.page_id and c.src_row_id = old.id) then
    raise exception 'desk_rows: копия заказа у технаря жива — адрес копии не снимается' using errcode = '42501';
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

drop trigger if exists desk_rows_guard on public.desk_rows;
create trigger desk_rows_guard before insert or update on public.desk_rows
  for each row execute function public.desk_rows_guard();

-- ---------------------------------------------------------------------
-- З. Версия схемы.
-- ---------------------------------------------------------------------
create or replace function public.nova_schema_version() returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select '20261045'
$$;
revoke all on function public.nova_schema_version() from public, anon, authenticated;
grant execute on function public.nova_schema_version() to anon, authenticated;
