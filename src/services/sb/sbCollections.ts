import { useEffect, useSyncExternalStore } from "react";
import { deleteField, updateDoc } from "firebase/firestore";
import { paths } from "@/firebase/firestore";
import { supabaseRows } from "@/lib/supabaseRows";
import type { SbCollectionKey, SbCollectionOverride, Workspace } from "@/types";

/**
 * Где живёт переносимая коллекция — Firestore или Supabase.
 *
 * Правило (решение 24.09.2026, без действий Nurba, кроме вставки SQL):
 *  • строки таблиц не в Supabase (`rowsBackend !== "supabase"`) — Firestore
 *    ВСЕГДА: копию прав rows_* ведёт useRowAclSync только при строках в
 *    Supabase, и без неё политики новых таблиц отказали бы всем;
 *  • `sbCollections[key] === "firestore"` — выключатель Owner (откат);
 *  • ключа нет — АВТО: Supabase, если таблица коллекции есть в базе.
 *    Деплой SQL в Supabase НЕ накатывает (секрета нет), Nurba вставляет его
 *    руками — поэтому код обязан молча работать по-старому, пока таблицы
 *    нет. «Нет таблицы» узнаём по первому же запросу (коды ниже) и помним в
 *    localStorage, чтобы не спрашивать отсутствующую таблицу на каждом
 *    экране; раз в 10 минут экран сам переспрашивает (useSbBackend) — SQL
 *    могли уже вставить — и переключается, только когда таблица НАШЛАСЬ.
 *    Просто «память устарела» коллекцию не переключает: иначе каждые 10
 *    минут все экраны пробовали бы Supabase и падали обратно;
 *  • `"supabase"` — принудительно: память «SQL не накатан» не слушаем и
 *    каждый раз пробуем Supabase (отказ «нет таблицы» всё равно уводит в
 *    Firestore — иначе экран был бы пустым).
 */

export type CollectionKey = SbCollectionKey;
export type SbBackend = "firestore" | "supabase";
export type SbSetting = "auto" | SbCollectionOverride;
export type SbTableState = "unknown" | "present" | "missing";

type WorkspaceLike = Pick<Workspace, "rowsBackend" | "sbCollections"> | null | undefined;

/** Таблица каждой коллекции — её же спрашивает проба. */
export const SB_TABLES: Record<CollectionKey, string> = {
  deskLoads: "desk_loads",
  presence: "member_presence",
  notifications: "notifications",
  osOrders: "os_orders",
  chat: "chat_messages",
  history: "history_log",
  ratings: "order_ratings",
  osDispatchLog: "os_dispatch_log",
  orders: "work_orders",
  orderRequests: "order_requests",
  schedule: "schedule_docs",
  announcements: "announcement_docs",
  grok: "grok_docs",
  personal: "personal_docs",
};

export const SB_COLLECTION_LABELS: Record<CollectionKey, string> = {
  deskLoads: "Счётчики столов (Технари, Дашборд, ABS)",
  presence: "Присутствие («в сети»)",
  notifications: "Уведомления",
  osOrders: "Заказы ОС",
  chat: "Чаты",
  history: "Журнал истории",
  ratings: "Оценки заказов",
  osDispatchLog: "Выдачи ОС",
  orders: "Биржа «Заказы»",
  orderRequests: "Запросы технарей к ОС",
  schedule: "График",
  announcements: "Объявления",
  grok: "Грок лимит",
  personal: "Личная зона столов",
};

export const SB_COLLECTION_KEYS = Object.keys(SB_TABLES) as CollectionKey[];

export function sbSettingOf(workspace: WorkspaceLike, key: CollectionKey): SbSetting {
  return workspace?.sbCollections?.[key] ?? "auto";
}

/** Куда коллекция должна идти по настройкам — без учёта «SQL не накатан». */
export function sbTargetOf(workspace: WorkspaceLike, key: CollectionKey): SbBackend {
  if (workspace?.rowsBackend !== "supabase") return "firestore";
  return sbSettingOf(workspace, key) === "firestore" ? "firestore" : "supabase";
}

/** Куда коллекция идёт сейчас: настройки + память «таблицы нет». */
export function sbBackendOf(workspace: WorkspaceLike, key: CollectionKey): SbBackend {
  if (sbTargetOf(workspace, key) === "firestore") return "firestore";
  if (sbSettingOf(workspace, key) === "supabase") return "supabase";
  return sbTableState(key) === "missing" ? "firestore" : "supabase";
}

// ---------------------------------------------------------------------
// «Нет таблицы / столбца / функции» — SQL коллекции ещё не накатан.
// ---------------------------------------------------------------------

/**
 * 42P01 — нет таблицы (Postgres), 42703 — нет столбца, 42883 — нет функции,
 * PGRST205 — таблицы нет в кэше схемы PostgREST, PGRST202 — функции нет,
 * PGRST204 — столбца нет в кэше схемы. Так же разбирается stampMissing у
 * строк (supabaseRowStore).
 *
 * Решаем ТОЛЬКО по коду. PGRST000–003 — временные сбои PostgREST («не смог
 * прочитать кэш схемы, повторяю», 503 при перезапуске базы, сбое пулера,
 * пробуждении проекта Free): их текст тоже говорит про «schema cache», и
 * разбор текста принимал такой сбой за «SQL не накатан» — все экраны уходили
 * в Firestore минимум на 10 минут, а столы, закрытые за это время, оставались
 * в Supabase со старыми цифрами. Запасной разбор текста — только для ошибки
 * вовсе без кода, и только узкими шаблонами.
 */
const MISSING_CODES = new Set(["42P01", "42703", "42883", "PGRST205", "PGRST202", "PGRST204"]);
const TRANSIENT_CODES = /^PGRST00\d$/;

export function isSbMissingError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  if (MISSING_CODES.has(code)) return true;
  if (code) return false;
  const message = String((error as { message?: unknown }).message ?? "");
  if (TRANSIENT_CODES.test(message)) return false;
  return /could not find the (table|function)|relation .* does not exist/i.test(message);
}

/** Как давно «таблицы нет» — пора спросить снова: SQL могли вставить. */
const MISSING_RECHECK_MS = 10 * 60_000;
const STATE_KEY_PREFIX = "nova:sb-table:";

interface StoredState {
  state: Exclude<SbTableState, "unknown">;
  at: number;
}

const states = new Map<CollectionKey, StoredState>();
const listeners = new Set<() => void>();
let version = 0;

function readStored(key: CollectionKey): StoredState | null {
  const inMemory = states.get(key);
  if (inMemory) return inMemory;
  try {
    const raw = window.localStorage.getItem(STATE_KEY_PREFIX + SB_TABLES[key]) ?? "";
    const [state, at] = raw.split("@");
    if ((state === "missing" || state === "present") && Number(at) > 0) {
      const stored: StoredState = { state, at: Number(at) };
      states.set(key, stored);
      return stored;
    }
  } catch {
    /* нет хранилища — память только на вкладку */
  }
  return null;
}

function writeState(key: CollectionKey, state: StoredState["state"]) {
  const prev = readStored(key);
  const next: StoredState = { state, at: Date.now() };
  states.set(key, next);
  try {
    window.localStorage.setItem(STATE_KEY_PREFIX + SB_TABLES[key], `${state}@${next.at}`);
  } catch {
    /* см. readStored */
  }
  if (prev?.state !== state) {
    version += 1;
    listeners.forEach((fn) => fn());
  }
}

/** Состояние таблицы коллекции: что последним сказала база (или «не спрашивали»). */
export function sbTableState(key: CollectionKey): SbTableState {
  return readStored(key)?.state ?? "unknown";
}

/** «Таблицы нет» сказано давно — пора переспросить. */
export function sbTableRecheckDue(key: CollectionKey): boolean {
  const stored = readStored(key);
  return stored?.state === "missing" && Date.now() - stored.at >= MISSING_RECHECK_MS;
}

export function markSbTableMissing(key: CollectionKey) {
  writeState(key, "missing");
}

export function markSbTablePresent(key: CollectionKey) {
  writeState(key, "present");
}

const probes = new Map<CollectionKey, Promise<SbTableState>>();

/**
 * Спросить базу, есть ли таблица коллекции: одна строка под политиками
 * спрашивающего (пустой ответ — тоже «есть»). Сетевые и прочие ошибки
 * состояние не меняют: «нет связи» не значит «нет таблицы».
 */
export function probeSbTable(key: CollectionKey): Promise<SbTableState> {
  const running = probes.get(key);
  if (running) return running;
  const probe = (async (): Promise<SbTableState> => {
    try {
      const { error } = await supabaseRows.from(SB_TABLES[key]).select("*").limit(1);
      if (!error) {
        markSbTablePresent(key);
        return "present";
      }
      if (isSbMissingError(error)) {
        markSbTableMissing(key);
        return "missing";
      }
    } catch {
      /* сеть — ответа нет */
    }
    return sbTableState(key);
  })().finally(() => probes.delete(key));
  probes.set(key, probe);
  return probe;
}

export function subscribeSbTables(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function tablesVersion() {
  return version;
}

/**
 * Растёт при каждой смене «таблица есть / нет» — для ключей общих подписок:
 * подписка, упёршаяся в «нет таблицы», не должна достаться экрану, который
 * открылся уже после того, как SQL вставили.
 */
export function sbTablesVersion(): number {
  return version;
}

/** Как часто вкладка перепроверяет «таблицы нет», пока экран открыт и на виду. */
const REPROBE_EVERY_MS = MISSING_RECHECK_MS;

/**
 * Хранилище коллекции для экрана. `null` — документ workspace ещё не пришёл:
 * подписываться рано (иначе сначала прочитали бы Firestore, а через миг
 * переподписались бы на Supabase — двойная цена на каждом старте).
 * Пока таблицы нет, экран сам раз в 10 минут спрашивает её снова: Nurba
 * вставил SQL — коллекция включается без перезагрузки.
 */
export function useSbBackend(workspace: WorkspaceLike, key: CollectionKey): SbBackend | null {
  useSyncExternalStore(subscribeSbTables, tablesVersion, tablesVersion);
  const target = workspace ? sbTargetOf(workspace, key) : null;
  const setting = workspace ? sbSettingOf(workspace, key) : "auto";
  useEffect(() => {
    if (target !== "supabase" || setting !== "auto") return;
    const check = () => {
      if (document.visibilityState !== "visible") return;
      if (sbTableRecheckDue(key)) void probeSbTable(key);
    };
    check();
    const timer = window.setInterval(check, REPROBE_EVERY_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [target, setting, key]);
  return workspace ? sbBackendOf(workspace, key) : null;
}

/** Owner: «Авто» (ключ убирается), «Firestore» (откат) или «Supabase» (принудительно). */
export async function setSbCollectionSetting(workspaceId: string, key: CollectionKey, setting: SbSetting) {
  await updateDoc(paths.workspace(workspaceId), {
    [`sbCollections.${key}`]: setting === "auto" ? deleteField() : setting,
  });
}
