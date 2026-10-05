import { useEffect, useSyncExternalStore } from "react";
import { supabaseRows } from "@/lib/supabaseRows";
import { toast } from "@/components/ui/sonner";
import { nudgeOpenDesk } from "@/services/rows/osOrderClaim";
import { ringRowsDoorbell } from "@/services/rows/rowsDoorbell";
import { subscribeRowsBackend, usesSupabaseRows } from "@/services/rows/rowsBackend";
import { sbPatchRow, sbWaitForPendingWrites } from "@/services/rows/supabaseRowStore";
import { currentPeriodKeyOf } from "@/services/periodService";
import { isSbMissingError } from "@/services/sb/sbCollections";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { personLabel } from "@/utils/peopleDesks";
import {
  periodTabOf,
  planTechItems,
  sameMoneyText,
  techDeskKey,
  techKeysFor,
  techSyncFingerprint,
  TECH_SYNC_MAX_ITEMS,
  type TechSyncAck,
} from "@/utils/techSyncPlan";
import type { PageRow } from "@/types";

/**
 * Авто-передача ОС — клиентская сторона (просьба Nurba 05.10.2026: технарь,
 * который заполняет стол сам, правит таблицу — и заказ сам и сразу оказывается
 * у ОС, без кнопки «Передать ОС»).
 *
 * В стол ОС пишет ТОЛЬКО база (SQL 20261045_tech_sync.sql):
 *  - триггер на строке технаря, которую уже ведёт ОС, в той же записи везёт
 *    статус и поля (клиент, номер, ссылка, визитка, сумма) в строку-источник;
 *  - `rows_tech_sync` связывает новые строки с ником ОС (то, что делали
 *    «Передать ОС» и подхват ОС), перевешивает заказ, пока ОС его не тронул, и
 *    чинит разошедшийся статус.
 * Клиент присылает одни id строк — все значения база берёт из своей копии
 * строки. Здесь: состояние функции (включена ли, есть ли ядро в Supabase),
 * вызовы, очередь «свои правки → один вызов на серию» и память ответов.
 *
 * Работает только когда строки в Supabase, стол — «Заполняет сам» и Owner не
 * выключил авто-передачу («Правка столов»). Нет функций в базе (SQL не
 * вставлен: PGRST202 / 42883) — всё молчит 10 минут и ни о чём базу не
 * спрашивает; «Передать ОС», подхват ОС и статус через проход стола ОС
 * работают как раньше.
 */

export type TechSyncState = {
  /** В базе есть функции авто-передачи (SQL 20261045). */
  supported: boolean;
  /** null — ещё не включали, true — включено, false — Owner выключил. */
  on: boolean | null;
  /** Столы и участники лежат в Supabase (без них база не знает столбцов стола ОС). */
  core: boolean;
  /** Текущий период по часам базы. */
  period: string | null;
  /** Столы ОС (Owner — все, ОС — свой): куда лягут заказы и чьи вкладки ещё без документа. */
  desks?: { page: string; tab: string; planned: boolean; keys: Record<string, string>; orphans: string[] }[];
};

export type TechSyncItem = {
  row: string;
  code: string;
  srcPage?: string;
  srcTab?: string;
  srcRow?: string;
  osUid?: string;
  planned?: boolean;
  sum?: "refused";
  osTotal?: string;
  /** База записала что-то в строку-источник этим вызовом (если она это сообщает). */
  wrote?: boolean;
  /** Пометка к ответу (например, `os_fixed` — ОС уже ведёт заказ, ячейку ОС не перевесить). */
  flag?: string;
};

export type TechSyncResult = {
  status: "ok" | "off" | "no_core" | "out_of_scope" | "unsupported";
  period?: string | null;
  items: TechSyncItem[];
  more?: boolean;
};

/** Отказ базы или сети при вызове авто-передачи (код Postgres/PostgREST, '' — сеть). */
export class TechSyncError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "TechSyncError";
    this.code = code;
  }
}

/** Почему строка «не у ОС» — подсказка у ячейки ОС. Коды — ответы `rows_tech_sync`. */
export const TECH_SYNC_REASON_TEXT: Record<string, string> = {
  no_os_member: "Ник ОС не закреплён за аккаунтом — закрепите на «Команде»",
  nick_ambiguous: "Ник ОС закреплён за несколькими людьми",
  no_tech_nick: "У технаря стола нет своего ника (или он занят другим)",
  no_os_desk: "У этого ОС ещё нет стола — появится, когда он откроет «Стол ОС»",
  released: "Заказ вернули технарю — снова отдать его ОС может Owner или Тимлид+ («Передать ОС»)",
  owner_only: "Стол только для Owner — заказы ОС передаёт Owner",
  no_keys: "Заказы уходят ОС из вкладки текущего периода",
  period_mismatch: "Заказы уходят ОС из вкладки текущего периода",
  no_os_map: "Столбцы стола ОС не распознаны — заказ заберёт сам ОС",
};

/** Тосты авто-передачи — одни тексты на очередь и на «Передать ОС». */
export const TECH_SYNC_TOAST = {
  linked: (count: number) => `На стол ОС ушло заказов: ${count}`,
  sumRefused: "Сумму этого заказа ведёт ОС (апсейл / комиссия) — в ячейку возвращена сумма ОС",
  sumCleared: "Сумму этого заказа ведёт ОС — у ОС суммы пока нет, ячейка очищена",
  osFixed: (osNick: string) =>
    `Заказ уже ведёт ОС${osNick ? ` ${osNick}` : ""} — сменить ОС может Owner или Тимлид+ в «Общей таблице»`,
};

// ---------------------------------------------------------------------------
// «SQL не вставлен» — память на 10 минут, общая для вкладок браузера.
// ---------------------------------------------------------------------------

const MISSING_KEY = "nova:tech-sync-missing";
const MISSING_QUIET_MS = 10 * 60_000;
/** Без localStorage — память на вкладку. */
let missingMemo = 0;

function readMissingAt(): number {
  try {
    const raw = window.localStorage.getItem(MISSING_KEY);
    return raw ? Number(raw) || 0 : 0;
  } catch {
    return missingMemo;
  }
}

function writeMissingAt(at: number) {
  missingMemo = at;
  try {
    if (at) window.localStorage.setItem(MISSING_KEY, String(at));
    else window.localStorage.removeItem(MISSING_KEY);
  } catch {
    /* см. readMissingAt */
  }
}

/** Функций авто-передачи в базе нет (узнали меньше 10 минут назад) — запросов не шлём. */
export function techSyncSqlMissing(now: number = Date.now()): boolean {
  const at = readMissingAt();
  return at > 0 && now - at < MISSING_QUIET_MS;
}

function missingFunction(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "42883" || isSbMissingError(error);
}

// ---------------------------------------------------------------------------
// Состояние функции: включена ли, есть ли ядро, период.
// ---------------------------------------------------------------------------

const UNSUPPORTED: TechSyncState = { supported: false, on: null, core: false, period: null };
/** База ответила, но ничего не разрешила (не участник, сбой) — функция есть, а не работает. */
const INERT: TechSyncState = { supported: true, on: null, core: false, period: null };

const STATE_TTL_MS = 5 * 60_000;
/** Вернулись на вкладку — переспросить, если ответу больше минуты. */
const STATE_RETURN_MS = 60_000;
/** Сеть не ответила — не дёргать базу на каждую правку. */
const STATE_FAIL_RETRY_MS = 30_000;
/** «Ядро не в Supabase» — спросим снова через столько (Owner мог перенести). */
const NO_CORE_RETRY_MS = 2 * 60_000;

interface StateEntry {
  state: TechSyncState;
  /** Когда ответ считать полученным (для срока годности). */
  at: number;
}

const states = new Map<string, StateEntry>();
const stateFlights = new Map<string, Promise<TechSyncState>>();
const stateListeners = new Set<() => void>();
let stateVersion = 0;

function putState(workspaceId: string, state: TechSyncState, at: number = Date.now()) {
  const prev = states.get(workspaceId);
  states.set(workspaceId, { state, at });
  if (prev && JSON.stringify(prev.state) === JSON.stringify(state)) return;
  stateVersion += 1;
  stateListeners.forEach((fn) => fn());
}

function patchState(workspaceId: string, patch: Partial<TechSyncState>, at?: number) {
  const prev = states.get(workspaceId);
  putState(workspaceId, { ...(prev?.state ?? INERT), ...patch }, at ?? prev?.at ?? Date.now());
}

/**
 * «Не поддерживается» своего срока годности не имеет (at = 0): сколько молчать,
 * решает память «SQL не вставлен» или хранилище строк, и следующий вопрос
 * сверяется с ними заново — без запроса, пока они не изменились.
 */
function putUnsupported(workspaceId: string) {
  putState(workspaceId, UNSUPPORTED, 0);
}

/** Что известно прямо сейчас, без запроса (может быть несвежим). null — не спрашивали. */
export function techSyncStateOf(workspaceId: string): TechSyncState | null {
  return states.get(workspaceId)?.state ?? null;
}

function stateFresh(workspaceId: string, now: number): boolean {
  const entry = states.get(workspaceId);
  return Boolean(entry && now - entry.at < STATE_TTL_MS);
}

/** Ответ `setof`/обёртку PostgREST — к объекту; не объект — пусто. */
function unwrapObject(data: unknown, name: string): Record<string, unknown> {
  let value = Array.isArray(data) ? data[0] : data;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const wrapped = record[name];
  if (wrapped && typeof wrapped === "object" && !Array.isArray(wrapped)) return wrapped as Record<string, unknown>;
  return record;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function parseState(data: unknown): TechSyncState | null {
  const value = unwrapObject(data, "rows_tech_sync_state");
  if (!("on" in value) && !("core" in value)) return null;
  const state: TechSyncState = {
    supported: true,
    on: value.on === true ? true : value.on === false ? false : null,
    core: value.core === true,
    period: typeof value.period === "string" && value.period ? value.period : null,
  };
  if (Array.isArray(value.desks)) {
    state.desks = [];
    for (const raw of value.desks) {
      if (!raw || typeof raw !== "object") continue;
      const desk = raw as Record<string, unknown>;
      if (typeof desk.page !== "string" || !desk.page) continue;
      const keys: Record<string, string> = {};
      if (desk.keys && typeof desk.keys === "object") {
        for (const [key, v] of Object.entries(desk.keys as Record<string, unknown>)) if (typeof v === "string") keys[key] = v;
      }
      state.desks.push({
        page: desk.page,
        tab: typeof desk.tab === "string" ? desk.tab : "",
        planned: desk.planned === true,
        keys,
        orphans: strings(desk.orphans),
      });
    }
  }
  return state;
}

/**
 * Состояние авто-передачи этого workspace (`rows_tech_sync_state`). Ответ
 * помнится 5 минут; `force` — спросить заново. Строки не в Supabase или SQL не
 * вставлен — «не поддерживается» без единого запроса.
 */
export function fetchTechSyncState(workspaceId: string, opts?: { force?: boolean }): Promise<TechSyncState> {
  if (!usesSupabaseRows(workspaceId)) {
    // Хранилище строк могло быть ещё не известно — спросим снова, когда узнаем.
    putUnsupported(workspaceId);
    return Promise.resolve(UNSUPPORTED);
  }
  const now = Date.now();
  if (techSyncSqlMissing(now)) {
    putUnsupported(workspaceId);
    return Promise.resolve(UNSUPPORTED);
  }
  if (!opts?.force && stateFresh(workspaceId, now)) return Promise.resolve(states.get(workspaceId)!.state);
  const flying = stateFlights.get(workspaceId);
  if (flying) return flying;
  const flight = (async (): Promise<TechSyncState> => {
    const fallback = () => {
      // Сеть или отказ: прежний ответ остаётся, повтор — не раньше чем через полминуты.
      const prev = states.get(workspaceId)?.state ?? INERT;
      putState(workspaceId, prev, Date.now() - STATE_TTL_MS + STATE_FAIL_RETRY_MS);
      return prev;
    };
    try {
      const { data, error } = await supabaseRows.rpc("rows_tech_sync_state", { p_workspace: workspaceId });
      if (error) {
        if (missingFunction(error)) {
          writeMissingAt(Date.now());
          putUnsupported(workspaceId);
          return UNSUPPORTED;
        }
        if (error.code === "42501") {
          // Не участник (или копия прав ещё не доехала) — функция есть, но не для нас.
          putState(workspaceId, INERT);
          return INERT;
        }
        return fallback();
      }
      const state = parseState(data);
      if (!state) {
        // Ответ не того вида (стенд без SQL) — как «функции нет».
        writeMissingAt(Date.now());
        putUnsupported(workspaceId);
        return UNSUPPORTED;
      }
      writeMissingAt(0);
      // «Ядро не в Supabase» переспросим раньше: Owner мог только что перенести.
      putState(workspaceId, state, state.core ? Date.now() : Date.now() - STATE_TTL_MS + NO_CORE_RETRY_MS);
      return state;
    } catch {
      return fallback();
    }
  })().finally(() => {
    stateFlights.delete(workspaceId);
  });
  stateFlights.set(workspaceId, flight);
  return flight;
}

/** Авто-передача работает: функции есть, Owner включил, ядро в Supabase. */
export function techSyncActive(state: TechSyncState | null): boolean {
  return Boolean(state && state.supported && state.on === true && state.core);
}

function subscribeState(listener: () => void): () => void {
  stateListeners.add(listener);
  return () => {
    stateListeners.delete(listener);
  };
}

/**
 * Состояние авто-передачи для экрана; null — ещё не знаем. Спрашивает базу при
 * появлении на экране, при возврате на вкладку (если ответу больше минуты) и
 * при смене хранилища строк. Опроса по таймеру нет.
 */
export function useTechSyncState(workspaceId: string | null | undefined): TechSyncState | null {
  useSyncExternalStore(
    subscribeState,
    () => stateVersion,
    () => stateVersion
  );
  useEffect(() => {
    if (!workspaceId) return;
    void fetchTechSyncState(workspaceId);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const at = states.get(workspaceId)?.at ?? 0;
      void fetchTechSyncState(workspaceId, { force: Date.now() - at >= STATE_RETURN_MS });
    };
    document.addEventListener("visibilitychange", onVisible);
    const stopBackend = subscribeRowsBackend(() => void fetchTechSyncState(workspaceId));
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      stopBackend();
    };
  }, [workspaceId]);
  return workspaceId ? techSyncStateOf(workspaceId) : null;
}

// ---------------------------------------------------------------------------
// Вызовы базы.
// ---------------------------------------------------------------------------

const RESULT_STATUSES = new Set(["ok", "off", "no_core", "out_of_scope"]);

function parseItem(raw: unknown): TechSyncItem | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.row !== "string" || !value.row) return null;
  const item: TechSyncItem = { row: value.row, code: typeof value.code === "string" && value.code ? value.code : "unknown" };
  if (typeof value.srcPage === "string" && value.srcPage) item.srcPage = value.srcPage;
  if (typeof value.srcTab === "string") item.srcTab = value.srcTab;
  if (typeof value.srcRow === "string" && value.srcRow) item.srcRow = value.srcRow;
  if (typeof value.osUid === "string" && value.osUid) item.osUid = value.osUid;
  if (value.planned === true) item.planned = true;
  if (value.sum === "refused") item.sum = "refused";
  if (typeof value.osTotal === "string" || typeof value.osTotal === "number") item.osTotal = String(value.osTotal);
  if (typeof value.wrote === "boolean") item.wrote = value.wrote;
  // «ОС уже ведёт заказ» база может прислать пометкой в любом из этих видов.
  if (typeof value.flag === "string" && value.flag) item.flag = value.flag;
  else if (
    value.osFixed === true ||
    value.os_fixed === true ||
    value.code === "os_fixed" ||
    (Array.isArray(value.flags) && value.flags.includes("os_fixed"))
  ) {
    item.flag = "os_fixed";
  }
  return item;
}

function parseResult(data: unknown): TechSyncResult | null {
  const value = unwrapObject(data, "rows_tech_sync");
  const status = typeof value.status === "string" && RESULT_STATUSES.has(value.status) ? (value.status as TechSyncResult["status"]) : null;
  if (!status) return null;
  const items: TechSyncItem[] = [];
  if (Array.isArray(value.items)) {
    for (const raw of value.items) {
      const item = parseItem(raw);
      if (item) items.push(item);
    }
  }
  return {
    status,
    period: typeof value.period === "string" && value.period ? value.period : null,
    items,
    ...(value.more === true ? { more: true } : {}),
  };
}

/** Ответы, после которых на столе ОС ничего не появилось и не поменялось. */
const NOTHING_WRITTEN = new Set(["noop", "busy", "gone", "blank", "not_linked", "no_source", "src_conflict", "error", "unknown"]);

/**
 * База что-то записала на стол ОС по этой строке (новая связь, починенный
 * статус). Сказала сама (`wrote`) — верим; нет — судим по коду ответа.
 */
function wroteToOsDesk(item: TechSyncItem): boolean {
  if (!item.srcPage) return false;
  if (item.code !== "linked" && item.wrote !== undefined) return item.wrote;
  return !NOTHING_WRITTEN.has(item.code) && !(item.code in TECH_SYNC_REASON_TEXT);
}

/**
 * Передать строки стола технаря ОС — `rows_tech_sync`. `items` — id строк
 * (`null` — база сама возьмёт несвязанные строки вкладки с ником ОС, до 200);
 * `force` — «Передать ОС» от Owner / Тимлид+ (снимает «вернули технарю»).
 * Больше 50 строк уходят несколькими вызовами подряд. Пустой список — ни
 * одного вызова (ответ `ok`), кроме `probe`: тогда уходит один вызов с пустым
 * списком — база ничего не пишет, но отвечает, её ли это стол (`out_of_scope`,
 * `off`, `no_core`, отказ прав).
 *
 * `status`: `ok` — смотрите `items`; `off` — Owner выключил; `no_core` — столы
 * и участники не в Supabase; `out_of_scope` — стол не «Заполняет сам»;
 * `unsupported` — строки не в Supabase или SQL не вставлен (молчим 10 минут).
 * Отказ прав (42501), кривые данные и сеть — исключение `TechSyncError`.
 *
 * Функция пишет мимо `optimistic`, поэтому звонок столам — здесь, ПОСЛЕ
 * ответа: столу ОС, где появилась или поменялась строка, и своей открытой
 * вкладке (на строке технаря появилась метка ОС).
 */
export async function sbTechSync(
  workspaceId: string,
  pageId: string,
  tab: string,
  items: { row: string }[] | null,
  opts?: { force?: boolean; probe?: boolean }
): Promise<TechSyncResult> {
  if (!usesSupabaseRows(workspaceId) || techSyncSqlMissing()) return { status: "unsupported", items: [] };
  const tabId = tab ?? "";
  const parts: Array<{ row: string }[] | null> = [];
  if (items === null) parts.push(null);
  else {
    const ids = [...new Set(items.map((item) => item.row).filter(Boolean))];
    for (let i = 0; i < ids.length; i += TECH_SYNC_MAX_ITEMS) parts.push(ids.slice(i, i + TECH_SYNC_MAX_ITEMS).map((row) => ({ row })));
    if (ids.length === 0 && opts?.probe) parts.push([]);
  }
  const merged: TechSyncResult = { status: "ok", period: null, items: [] };
  for (const part of parts) {
    const { data, error } = await supabaseRows.rpc("rows_tech_sync", {
      p_workspace: workspaceId,
      p_page: pageId,
      p_tab: tabId,
      p_items: part,
      p_force: Boolean(opts?.force),
    });
    if (error) {
      if (missingFunction(error)) {
        writeMissingAt(Date.now());
        putUnsupported(workspaceId);
        return { status: "unsupported", items: merged.items };
      }
      throw new TechSyncError(error.message || "Не удалось передать заказы ОС", error.code ?? "");
    }
    const result = parseResult(data);
    if (!result) {
      // Ответ не того вида (стенд без SQL) — как «функции нет».
      writeMissingAt(Date.now());
      putUnsupported(workspaceId);
      return { status: "unsupported", items: merged.items };
    }
    merged.period = result.period ?? merged.period;
    if (result.status !== "ok") {
      // База знает лучше нашей памяти: поправить её, чтобы остальные не спрашивали зря.
      if (result.status === "off") patchState(workspaceId, { supported: true, on: false });
      if (result.status === "no_core") patchState(workspaceId, { supported: true, core: false }, Date.now() - STATE_TTL_MS + NO_CORE_RETRY_MS);
      return { ...merged, status: result.status };
    }
    let linked = false;
    for (const item of result.items) {
      if (!wroteToOsDesk(item) || !item.srcPage) continue;
      ringRowsDoorbell(workspaceId, item.srcPage, item.srcTab ?? "");
      if (item.code === "linked") linked = true;
    }
    if (linked) nudgeOpenDesk(workspaceId, pageId, tabId || null);
    merged.items.push(...result.items);
    if (result.more) merged.more = true;
  }
  return merged;
}

/**
 * Что разошлось у ведомых ОС строк этой вкладки (`rows_tech_sync_scan`, один
 * запрос): `drift` — статус у технаря не тот, что получил стол ОС; `dead` —
 * источника на столе ОС нет или он показывает не сюда. null — узнать не
 * удалось (SQL не вставлен, сеть).
 */
export async function sbTechSyncScan(
  workspaceId: string,
  pageId: string,
  tab: string
): Promise<{ drift: string[]; dead: string[] } | null> {
  if (!usesSupabaseRows(workspaceId) || techSyncSqlMissing()) return null;
  try {
    const { data, error } = await supabaseRows.rpc("rows_tech_sync_scan", {
      p_workspace: workspaceId,
      p_page: pageId,
      p_tab: tab ?? "",
    });
    if (error) {
      if (missingFunction(error)) {
        writeMissingAt(Date.now());
        putUnsupported(workspaceId);
      } else {
        console.warn("[tech-sync] сверка статусов не удалась", error.message);
      }
      return null;
    }
    const value = unwrapObject(data, "rows_tech_sync_scan");
    return { drift: strings(value.drift), dead: strings(value.dead) };
  } catch {
    return null;
  }
}

/**
 * Включить или выключить авто-передачу (только Owner). true — записано;
 * false — нечем (строки не в Supabase или SQL не вставлен). Отказ прав и сеть —
 * исключение `TechSyncError` с текстом для тоста.
 */
export async function sbSetTechSync(workspaceId: string, on: boolean): Promise<boolean> {
  if (!usesSupabaseRows(workspaceId)) return false;
  const { error } = await supabaseRows.rpc("rows_set_tech_sync", { p_workspace: workspaceId, p_on: on });
  if (error) {
    if (missingFunction(error)) {
      writeMissingAt(Date.now());
      putUnsupported(workspaceId);
      return false;
    }
    throw new TechSyncError(
      error.code === "42501" ? "Авто-передачу ОС включает и выключает только Owner" : error.message || "Не удалось переключить авто-передачу ОС",
      error.code ?? ""
    );
  }
  writeMissingAt(0);
  patchState(workspaceId, { supported: true, on }, 0);
  if (!on) dropQueues(workspaceId);
  // Остальное (ядро, период, столы ОС) — свежим ответом базы.
  void fetchTechSyncState(workspaceId, { force: true });
  return true;
}

// ---------------------------------------------------------------------------
// Память ответов и строки открытых столов.
// ---------------------------------------------------------------------------

const acks = new Map<string, Map<string, TechSyncAck>>();
const memoryListeners = new Set<() => void>();
let memoryVersion = 0;
const NO_ACKS: ReadonlyMap<string, TechSyncAck> = new Map();

function bumpMemory() {
  memoryVersion += 1;
  memoryListeners.forEach((fn) => fn());
}

/** Что база ответила по строкам стола (ключ — `techDeskKey`). */
export function techSyncAcksOf(deskKey: string): ReadonlyMap<string, TechSyncAck> {
  return acks.get(deskKey) ?? NO_ACKS;
}

export function subscribeTechSyncMemory(listener: () => void): () => void {
  memoryListeners.add(listener);
  return () => {
    memoryListeners.delete(listener);
  };
}

/** Растёт при каждом новом ответе базы — для useSyncExternalStore. */
export function techSyncMemoryVersion(): number {
  return memoryVersion;
}

function remember(deskKey: string, rowId: string, ack: TechSyncAck) {
  let desk = acks.get(deskKey);
  if (!desk) {
    desk = new Map();
    acks.set(deskKey, desk);
  }
  desk.set(rowId, ack);
}

type RowsGetter = () => readonly PageRow[] | null;
const deskRows = new Map<string, RowsGetter[]>();

/**
 * Открытый стол отдаёт очереди свои строки (ключ — `techDeskKey`): по ним она
 * не шлёт то, на что база уже ответила, и знает адрес источника для звонка.
 * `getRows` отдаёт null, пока строки не с сервера. Возвращает «снять».
 */
export function registerDeskRows(key: string, getRows: RowsGetter): () => void {
  const list = deskRows.get(key) ?? [];
  list.push(getRows);
  deskRows.set(key, list);
  return () => {
    const cur = deskRows.get(key);
    if (!cur) return;
    const next = cur.filter((fn) => fn !== getRows);
    if (next.length) deskRows.set(key, next);
    else deskRows.delete(key);
  };
}

/** Строки открытого стола (с сервера) или null — стол не открыт. */
export function techSyncDeskRows(key: string): readonly PageRow[] | null {
  const list = deskRows.get(key);
  if (!list?.length) return null;
  try {
    return list[list.length - 1]() ?? null;
  } catch {
    return null;
  }
}

/** Стол, которому база отказала целиком (не «Заполняет сам», нет прав) — не спрашиваем 10 минут. */
const DESK_PAUSE_MS = 10 * 60_000;
const deskPauses = new Map<string, number>();

function deskPaused(key: string, now: number): boolean {
  const until = deskPauses.get(key);
  if (!until) return false;
  if (until > now) return true;
  deskPauses.delete(key);
  return false;
}

/** Стол снова в деле (Owner переключил «Заполняет сам») — снять паузу. */
export function resumeTechSyncDesk(workspaceId: string, pageId: string) {
  const prefix = `${workspaceId}|${pageId}|`;
  for (const key of [...deskPauses.keys()]) if (key.startsWith(prefix)) deskPauses.delete(key);
}

// ---------------------------------------------------------------------------
// Очередь: свои правки → один вызов на серию.
// ---------------------------------------------------------------------------

/** Пауза после последней своей правки. */
const DEBOUNCE_MS = 500;
/** Правят без остановки — всё равно шлём не реже. */
const MAX_WAIT_MS = 1500;
/** Строка только на проверку (звонок ОС уже ушёл) — с ближайшим вызовом или через столько. */
const LAZY_MS = 20_000;
/** Источник на столе ОС занят чужой записью — повтор через столько, дважды. */
const BUSY_RETRY_MS = 1200;
const BUSY_RETRIES = 2;
/** Сеть не ответила — повтор через столько, дважды; дальше — при следующем открытии стола. */
const NET_RETRY_MS = 5000;
const NET_RETRIES = 2;

interface QueuedRow {
  /** Строку правила эта вкладка: после ответа позвонить столу ОС, даже если база ничего не меняла. */
  own: boolean;
  /** Сверить со строками открытого стола (не слать то, на что ответ уже есть). */
  check: boolean;
  /** Сама вызов не торопит — уйдёт с ближайшим или в срок `dueAt`. */
  dueAt: number;
  /** Раньше этого не слать (повтор «занято» / «нет сети»). */
  holdUntil: number;
  busy: number;
  net: number;
}

interface DeskQueue {
  workspaceId: string;
  pageId: string;
  tab: string;
  rows: Map<string, QueuedRow>;
}

const queues = new Map<string, DeskQueue>();
/** Срок серии своих правок (дебаунс), 0 — серии нет. */
let burstDueAt = 0;
let burstStartedAt = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let timerAt = 0;
let running: Promise<void> | null = null;
let again = false;

export interface TechSyncEnqueueOptions {
  /**
   * Своя правка содержимого: после ответа стол ОС получит звонок, даже если
   * вызов ничего не записал (поля связанной строки уже увёз триггер базы).
   * По умолчанию true, у «ленивой» строки — false.
   */
  own?: boolean;
  /** false — слать как есть (строки уже отобраны `planTechItems`). По умолчанию true. */
  check?: boolean;
  /** Не торопить вызов: строка уйдёт с ближайшим или через 20 секунд. */
  lazy?: boolean;
}

function dropQueues(workspaceId: string) {
  for (const [key, queue] of [...queues]) if (queue.workspaceId === workspaceId) queues.delete(key);
}

function nextDue(): number {
  let due = burstDueAt || Number.POSITIVE_INFINITY;
  for (const queue of queues.values()) {
    for (const row of queue.rows.values()) if (row.dueAt && row.dueAt < due) due = row.dueAt;
  }
  return due;
}

function arm() {
  const due = nextDue();
  if (!Number.isFinite(due)) {
    if (timer) clearTimeout(timer);
    timer = null;
    timerAt = 0;
    return;
  }
  if (timer && timerAt === due) return;
  if (timer) clearTimeout(timer);
  timerAt = due;
  timer = setTimeout(
    () => {
      timer = null;
      timerAt = 0;
      void kick();
    },
    Math.max(0, due - Date.now())
  );
}

/**
 * Поставить строки стола в очередь авто-передачи. Серия правок за полсекунды
 * (но не дольше полутора секунд подряд) уходит ОДНИМ вызовом на стол.
 */
export function enqueueTechSync(
  workspaceId: string,
  pageId: string,
  tab: string,
  rowIds: readonly string[],
  opts?: TechSyncEnqueueOptions
): void {
  if (rowIds.length === 0) return;
  const tabId = tab ?? "";
  const key = techDeskKey(workspaceId, pageId, tabId);
  let queue = queues.get(key);
  if (!queue) {
    queue = { workspaceId, pageId, tab: tabId, rows: new Map() };
    queues.set(key, queue);
  }
  const now = Date.now();
  const own = opts?.own ?? !opts?.lazy;
  const check = opts?.check ?? true;
  for (const id of rowIds) {
    if (!id) continue;
    const prev = queue.rows.get(id);
    queue.rows.set(id, {
      own: Boolean(prev?.own) || own,
      // Отобранную строку (check = false) свежая своя правка не делает «проверяемой» обратно.
      check: prev ? prev.check && check : check,
      dueAt: opts?.lazy ? (prev ? prev.dueAt : now + LAZY_MS) : 0,
      holdUntil: 0,
      busy: prev?.busy ?? 0,
      net: prev?.net ?? 0,
    });
  }
  if (!opts?.lazy) {
    if (!burstStartedAt) burstStartedAt = now;
    burstDueAt = Math.min(now + DEBOUNCE_MS, burstStartedAt + MAX_WAIT_MS);
  }
  arm();
}

function kick(all = false): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await flushOnce(all);
    } while (again);
  })()
    .catch((error) => console.warn("[tech-sync] очередь авто-передачи упала", error))
    .finally(() => {
      running = null;
      arm();
    });
  return running;
}

interface DeskBatch {
  workspaceId: string;
  pageId: string;
  tab: string;
  rows: Map<string, QueuedRow>;
}

function takeDue(all: boolean): DeskBatch[] {
  const now = Date.now();
  const out: DeskBatch[] = [];
  for (const [key, queue] of [...queues]) {
    const rows = new Map<string, QueuedRow>();
    for (const [id, row] of [...queue.rows]) {
      if (!all && row.holdUntil > now) continue;
      rows.set(id, row);
      queue.rows.delete(id);
    }
    if (queue.rows.size === 0) queues.delete(key);
    if (rows.size > 0) out.push({ workspaceId: queue.workspaceId, pageId: queue.pageId, tab: queue.tab, rows });
  }
  return out;
}

async function flushOnce(all: boolean): Promise<void> {
  burstDueAt = 0;
  burstStartedAt = 0;
  // Свои записи строк должны быть в базе: она читает строку у себя.
  await sbWaitForPendingWrites();
  for (const batch of takeDue(all)) {
    try {
      await flushDesk(batch);
    } catch (error) {
      console.warn("[tech-sync] стол не передан", batch.pageId, error);
    }
  }
}

function requeue(batch: DeskBatch, id: string, row: QueuedRow, delay: number) {
  const key = techDeskKey(batch.workspaceId, batch.pageId, batch.tab);
  let queue = queues.get(key);
  if (!queue) {
    queue = { workspaceId: batch.workspaceId, pageId: batch.pageId, tab: batch.tab, rows: new Map() };
    queues.set(key, queue);
  }
  // Строку успели поправить снова — она уже стоит в очереди свежей.
  if (queue.rows.has(id)) return;
  const at = Date.now() + delay;
  queue.rows.set(id, { ...row, check: false, dueAt: at, holdUntil: at });
}

/** Что знает вкладка о столе: карта столбцов, вкладка периода, участники. null — стол не из этого workspace. */
function planContext(workspaceId: string, pageId: string, tab: string, state: TechSyncState) {
  const store = useWorkspaceStore.getState();
  if (store.activeWorkspaceId !== workspaceId) return null;
  const page = store.pages.find((p) => p.id === pageId);
  if (!page) return null;
  return {
    page,
    tabId: tab,
    periodTabId: periodTabOf(page, state.period ?? currentPeriodKeyOf(workspaceId)),
    members: store.members,
  };
}

async function flushDesk(batch: DeskBatch): Promise<void> {
  const { workspaceId, pageId, tab } = batch;
  const key = techDeskKey(workspaceId, pageId, tab);
  const now = Date.now();
  if (!usesSupabaseRows(workspaceId) || techSyncSqlMissing(now) || deskPaused(key, now)) return;
  const state = stateFresh(workspaceId, now) ? techSyncStateOf(workspaceId) : await fetchTechSyncState(workspaceId);
  if (!techSyncActive(state) || !state) return;

  // Что слать: при открытом столе — только то, на что ответа ещё нет.
  const rowsNow = techSyncDeskRows(key);
  const ctx = rowsNow ? planContext(workspaceId, pageId, tab, state) : null;
  const send: string[] = [];
  /** Отпечаток строки на момент отправки — с ним запомнится ответ базы. */
  const fingerprints = new Map<string, string>();
  /**
   * Текст ячейки суммы на момент отправки: отказ базы по сумме относится к
   * НЕМУ. Ячейку успели поправить снова — возвращать сумму ОС поверх нельзя.
   */
  const sentPrice = new Map<string, string>();
  if (rowsNow && ctx) {
    const byId = new Map(rowsNow.map((row) => [row.id, row]));
    const checked = new Set<string>();
    for (const [id, row] of batch.rows) {
      // Отобранные заранее и те, которых на экране ещё нет, — как есть: решит база.
      if (!row.check || !byId.has(id)) send.push(id);
      else checked.add(id);
    }
    if (checked.size > 0) {
      const plan = planTechItems({
        ...ctx,
        rows: rowsNow,
        acked: techSyncAcksOf(key),
        dirty: checked,
        only: checked,
        now,
        limit: Number.POSITIVE_INFINITY,
      });
      for (const item of plan.items) send.push(item.row);
    }
    const keys = techKeysFor(ctx.page, tab);
    for (const id of send) {
      const row = byId.get(id);
      if (!row) continue;
      fingerprints.set(id, techSyncFingerprint(row, keys));
      if (keys?.price) sentPrice.set(id, String(row.cells?.[keys.price] ?? ""));
    }
  } else {
    send.push(...batch.rows.keys());
  }
  if (send.length === 0) return;

  const linkedItems: TechSyncItem[] = [];
  try {
    for (let i = 0; i < send.length; i += TECH_SYNC_MAX_ITEMS) {
      const ids = send.slice(i, i + TECH_SYNC_MAX_ITEMS);
      let result: TechSyncResult;
      try {
        result = await sbTechSync(workspaceId, pageId, tab, ids.map((row) => ({ row })));
      } catch (error) {
        const code = (error as { code?: string } | null)?.code ?? "";
        if (code === "42501") {
          // Этому человеку стол передавать нельзя (или права ещё не доехали).
          deskPauses.set(key, Date.now() + DESK_PAUSE_MS);
          return;
        }
        if (code === "22023") {
          console.warn("[tech-sync] база не приняла список строк", error);
          return;
        }
        // Сеть / временный сбой: эти и оставшиеся строки — ещё раз чуть позже.
        for (const id of send.slice(i)) {
          const row = batch.rows.get(id);
          if (row && row.net < NET_RETRIES) requeue(batch, id, { ...row, net: row.net + 1 }, NET_RETRY_MS);
        }
        return;
      }
      if (result.status === "out_of_scope") {
        deskPauses.set(key, Date.now() + DESK_PAUSE_MS);
        return;
      }
      if (result.status !== "ok") return;

      const answeredAt = Date.now();
      const rowsAfter = techSyncDeskRows(key);
      for (const item of result.items) {
        const queued = batch.rows.get(item.row);
        if (item.code === "busy" && queued && queued.busy < BUSY_RETRIES) {
          requeue(batch, item.row, { ...queued, busy: queued.busy + 1 }, BUSY_RETRY_MS);
          continue;
        }
        remember(key, item.row, { fp: fingerprints.get(item.row) ?? "", code: item.code, at: answeredAt });
        const local = rowsAfter?.find((row) => row.id === item.row);
        if (item.code === "linked") {
          linkedItems.push(item);
        } else if (queued?.own) {
          // Поля и статус связанной строки уже увёз триггер базы той же записью,
          // что и сама правка, — столу ОС нужен только звонок.
          const srcPage = item.srcPage ?? local?.srcPageId ?? "";
          const srcTab = item.srcTab ?? local?.srcTabId ?? "";
          if (srcPage && item.code !== "gone" && item.code !== "not_linked" && item.code !== "no_source") {
            ringRowsDoorbell(workspaceId, srcPage, srcTab);
          }
        }
        if (item.sum === "refused" && item.osTotal !== undefined) revertRefusedSum(batch, item, local, sentPrice.get(item.row));
        if (item.flag === "os_fixed") tellOsFixed(key, item);
      }
      bumpMemory();
    }
  } finally {
    // Что успело лечь на стол ОС до сбоя следующей пачки — тоже сказать.
    if (linkedItems.length > 0) {
      toast.success(TECH_SYNC_TOAST.linked(linkedItems.length));
      emitLinked({ workspaceId, pageId, tab, items: linkedItems });
    }
  }
}

// ---------------------------------------------------------------------------
// Ответы, о которых надо сказать человеку.
// ---------------------------------------------------------------------------

/**
 * Сумму ОС вернули в ячейку — на такой же ответ по той же строке второй раз
 * не возвращаем: правка-возврат сама проходит очередь, и база могла ответить
 * раньше, чем увидела её. Стол открыт — хватает нескольких секунд (дальше
 * видно по самой ячейке), закрыт — минута.
 */
const REVERT_SETTLE_MS = 5_000;
const REVERT_ONCE_MS = 60_000;
const reverted = new Map<string, { value: string; at: number }>();

/**
 * Сумму заказа ведёт ОС (апсейл, комиссия способа оплаты): число технаря не
 * раскладывается обратно в цену. База ничего не записала и прислала «Итого»
 * стола ОС — возвращаем его в ячейку обычной правкой строки и говорим почему.
 * `sent` — текст ячейки, с которым строка ушла в базу (стол был открыт):
 * в ячейке уже другое — это новая своя правка, она стоит в очереди и получит
 * свой ответ; старая сумма ОС поверх неё не пишется и тоста нет.
 */
function revertRefusedSum(batch: DeskBatch, item: TechSyncItem, local: PageRow | undefined, sent: string | undefined) {
  const { workspaceId, pageId, tab } = batch;
  const osTotal = item.osTotal ?? "";
  const page = useWorkspaceStore.getState().pages.find((p) => p.id === pageId);
  const priceKey = techKeysFor(page, tab)?.price;
  if (!priceKey) return;
  // В ячейке уже сумма ОС — возвращать нечего (ответ пришёл на прежнее значение).
  if (local && sameMoneyText(local.cells?.[priceKey], osTotal)) return;
  // Ячейку поменяли после отправки этой пачки — ответ уже не про неё.
  if (local && sent !== undefined && !sameMoneyText(local.cells?.[priceKey], sent)) return;
  const memoKey = `${techDeskKey(workspaceId, pageId, tab)}|${item.row}`;
  const prev = reverted.get(memoKey);
  const now = Date.now();
  if (prev && prev.value === osTotal && now - prev.at < (local ? REVERT_SETTLE_MS : REVERT_ONCE_MS)) return;
  reverted.set(memoKey, { value: osTotal, at: now });
  toast.info(osTotal ? TECH_SYNC_TOAST.sumRefused : TECH_SYNC_TOAST.sumCleared);
  void sbPatchRow(workspaceId, pageId, tab || null, item.row, { cells: { [priceKey]: osTotal } }).catch((error) =>
    console.warn("[tech-sync] сумма ОС не вернулась в ячейку", error)
  );
}

const toldOsFixed = new Set<string>();

/** ОС уже работает с заказом — другой ник в ячейке ОС заказ не перевесит. Один раз на строку и ОС. */
function tellOsFixed(deskKey: string, item: TechSyncItem) {
  const memoKey = `${deskKey}|${item.row}|${item.osUid ?? ""}`;
  if (toldOsFixed.has(memoKey)) return;
  toldOsFixed.add(memoKey);
  const member = item.osUid ? useWorkspaceStore.getState().members.find((m) => m.uid === item.osUid) : undefined;
  toast.info(TECH_SYNC_TOAST.osFixed(member?.osNick || personLabel(member)));
}

/** Заказы только что легли на стол ОС (ответ `linked`). */
export interface TechSyncLinkedEvent {
  workspaceId: string;
  pageId: string;
  tab: string;
  items: TechSyncItem[];
}

const linkedListeners = new Set<(event: TechSyncLinkedEvent) => void>();

/** Слушать новые связи «строка технаря → стол ОС» из очереди этой вкладки. */
export function onTechSyncLinked(listener: (event: TechSyncLinkedEvent) => void): () => void {
  linkedListeners.add(listener);
  return () => {
    linkedListeners.delete(listener);
  };
}

function emitLinked(event: TechSyncLinkedEvent) {
  for (const listener of [...linkedListeners]) {
    try {
      listener(event);
    } catch (error) {
      console.warn("[tech-sync] слушатель новых связей упал", error);
    }
  }
}

/**
 * Дождаться, пока очередь авто-передачи опустеет: всё, что ждёт паузы, уходит
 * сразу. Для перезагрузки страницы (`reloadSafely`) — правка, сделанная за
 * секунду до обновления сайта, не должна остаться без передачи ОС. Повторы
 * «занято» и «нет сети» не ждём — их подберёт открытие стола.
 */
export async function waitTechSyncIdle(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    if (running) await running;
    if (queues.size === 0) return;
    if (timer) clearTimeout(timer);
    timer = null;
    timerAt = 0;
    await kick(round === 0);
  }
}

/** Для проверок: забыть всё (состояние, память ответов, очередь, паузы). */
export function resetTechSyncForTests() {
  if (timer) clearTimeout(timer);
  timer = null;
  timerAt = 0;
  burstDueAt = 0;
  burstStartedAt = 0;
  queues.clear();
  states.clear();
  stateFlights.clear();
  acks.clear();
  deskRows.clear();
  deskPauses.clear();
  reverted.clear();
  toldOsFixed.clear();
  writeMissingAt(0);
  again = false;
}
