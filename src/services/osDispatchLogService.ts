import {
  addDoc,
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { supabaseRows } from "@/lib/supabaseRows";
import {
  isSbMissingError,
  markSbTableMissing,
  markSbTablePresent,
  sbBackendOf,
  sbTableRecheckDue,
  sbTargetOf,
  type SbBackend,
} from "@/services/sb/sbCollections";
import { readSnapshot, writeSnapshot } from "@/services/sb/snapshotCache";
import { listenTopic, ringTopic } from "@/services/sb/topicDoorbell";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { generateId } from "@/utils/id";

/**
 * Журнал выдач ОС — вкладка «Выдачи ОС» у Тимлида и Owner (просьба Nurba
 * 23.09.2026: «когда ОС дал заказ выборочно кому-то, Тимлиду и всем выше в
 * отдельную вкладку приходит уведомление — чтобы мониторить заказы»).
 *
 * Пишет СЕССИЯ ОС в момент выдачи со своего стола (useOsDeskDispatch):
 * выбрал технаря сам, сменил технаря, снял заказ. Заказы, отданные через
 * биржу «Заказы», сюда не пишутся — их и так видно на «Заказах».
 *
 * Отдельная коллекция, а не колокольчик: уведомление в колокольчике — это
 * документ на КАЖДОГО получателя, а журнал один на всех и читается только
 * руководством (правило). Читают его одной подпиской на приложение, и только
 * Owner/Тимлид — остальным она не ставится вовсе.
 *
 * Где живёт журнал — `workspace.sbCollections.osDispatchLog` (26.09.2026,
 * SQL 20261008): в Supabase — окно 25 + звонок `nova:{ws}:osdispatch` +
 * опрос раз в минуту на видимой вкладке, «Показать ещё» — страницами по
 * created_at; нет таблицы — молча Firestore, как раньше.
 */

export type OsDispatchKind = "assign" | "move" | "unassign";

export interface OsDispatchLogEntry {
  id: string;
  workspaceId: string;
  kind: OsDispatchKind;
  osUid: string;
  osName: string;
  techUid: string | null;
  techName: string;
  /** Прежний технарь — при смене и снятии. */
  prevTechName: string | null;
  client: string;
  phone: string;
  /** Цена + апсейл, как у технаря в столе. */
  amount: number | null;
  srcPageId: string;
  srcRowId: string;
  createdAt: number;
}

export const OS_DISPATCH_KIND_LABELS: Record<OsDispatchKind, string> = {
  assign: "выдал",
  move: "передал",
  unassign: "забрал",
};

const TABLE = "os_dispatch_log";
const COLUMNS = "workspace_id,id,kind,os_uid,os_name,tech_uid,tech_name,prev_tech_name,client,phone,amount,src_page_id,src_row_id,created_at";
const SNAPSHOT_NAME = "osDispatchLog";
/** Опрос окна без звонка — только на видимой вкладке. */
const POLL_MS = 60_000;
/** Звонки за четверть секунды — одна выборка. */
const RING_SETTLE_MS = 250;

interface OsDispatchRow {
  workspace_id: string;
  id: string;
  kind: OsDispatchKind;
  os_uid: string;
  os_name: string | null;
  tech_uid: string | null;
  tech_name: string | null;
  prev_tech_name: string | null;
  client: string | null;
  phone: string | null;
  amount: number | string | null;
  src_page_id: string | null;
  src_row_id: string | null;
  created_at: number | string;
}

export function osDispatchTopic(workspaceId: string) {
  return `nova:${workspaceId}:osdispatch`;
}

/** Куда писать выдачу — по документу workspace из стора (как у уведомлений). */
export function osDispatchBackendFor(workspaceId: string): SbBackend {
  const doc = useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId);
  if (!doc) return "firestore";
  const backend = sbBackendOf(doc, "osDispatchLog");
  if (backend === "firestore" && sbTargetOf(doc, "osDispatchLog") === "supabase" && sbTableRecheckDue("osDispatchLog")) {
    return "supabase";
  }
  return backend;
}

function sbError(error: { code?: string; message?: string }): Error {
  return Object.assign(new Error(error.message || "Supabase"), { code: error.code });
}

function rowToEntry(row: OsDispatchRow): OsDispatchLogEntry {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    kind: row.kind,
    osUid: row.os_uid,
    osName: row.os_name ?? "",
    techUid: row.tech_uid ?? null,
    techName: row.tech_name ?? "",
    prevTechName: row.prev_tech_name ?? null,
    client: row.client ?? "",
    phone: row.phone ?? "",
    amount: row.amount === null || row.amount === undefined ? null : Number(row.amount),
    srcPageId: row.src_page_id ?? "",
    srcRowId: row.src_row_id ?? "",
    createdAt: Number(row.created_at),
  };
}

export async function logOsDispatch(workspaceId: string, entry: Omit<OsDispatchLogEntry, "id" | "workspaceId" | "createdAt">) {
  if (osDispatchBackendFor(workspaceId) === "supabase") {
    try {
      const { error } = await supabaseRows.rpc("log_os_dispatch", {
        p_workspace: workspaceId,
        p_entry: { id: generateId("osd"), ...entry },
      });
      if (error) throw sbError(error);
      markSbTablePresent("osDispatchLog");
      ringTopic(osDispatchTopic(workspaceId));
      return;
    } catch (error) {
      if (!isSbMissingError(error)) throw error;
      // SQL 20261008 ещё не вставлен — по-старому, документом Firestore.
      markSbTableMissing("osDispatchLog");
    }
  }
  if (!db) return;
  await addDoc(collection(db, "workspaces", workspaceId, "osDispatchLog"), {
    ...entry,
    workspaceId,
    createdAt: Date.now(),
  });
}

// ---------------------------------------------------------------------------
// Живой список — одна подписка на приложение (её ставит AppLayout).
// ---------------------------------------------------------------------------

/**
 * Живое окно — последние 25 выдач. Было 100: подписка стоит у каждой вкладки
 * Owner/Тимлида на всё приложение, и каждый холодный вход (перерыв больше
 * 30 минут, автообновление после деплоя) читал 100 документов ради счётчика в
 * меню и тоста. Старее — на самой вкладке по «Показать ещё» (`loadMoreOsDispatchLog`).
 */
export const OS_DISPATCH_LIVE_LIMIT = 25;
/** «Показать ещё» дочитывает столько за раз — разовой выборкой, без подписки. */
export const OS_DISPATCH_PAGE_SIZE = 25;

export interface OsDispatchLogState {
  workspaceId: string | null;
  /**
   * Всё, что вкладка уже знает, новые сверху: живое окно, дочитанные страницы
   * и записи, которые за время сессии выехали из окна (их не выбрасываем —
   * иначе между окном и дочитанной страницей образовалась бы дыра).
   */
  entries: OsDispatchLogEntry[];
  loaded: boolean;
  error: string | null;
  /** Сколько записей новее, чем человек последний раз открывал вкладку. */
  unseen: number;
  /** Есть ли на сервере записи старее самой старой из `entries`. */
  hasMore: boolean;
  loadingMore: boolean;
  /**
   * Список — из кэша (диск Firestore или снимок Supabase), сервер ещё не
   * ответил. Рисовать можно, но сколько выдач «на самом деле», неизвестно:
   * счётчики — «не меньше».
   */
  fromCache: boolean;
}

const EMPTY: OsDispatchLogState = {
  workspaceId: null,
  entries: [],
  loaded: false,
  error: null,
  unseen: 0,
  hasMore: false,
  loadingMore: false,
  fromCache: false,
};

let state: OsDispatchLogState = EMPTY;
const listeners = new Set<() => void>();
let current: { workspaceId: string; uid: string; backend: SbBackend; unsubscribe: () => void } | null = null;
/** Известные записи; у Firestore — со снимком документа (курсор `startAfter`). */
const known = new Map<string, { entry: OsDispatchLogEntry; snap?: QueryDocumentSnapshot }>();
/** Поколение подписки: страница, дочитанная для прежней, в новую не попадёт. */
let generation = 0;
/** null — страниц ещё не дочитывали; true — дочитали до самой первой выдачи. */
let pagedToEnd: boolean | null = null;
/**
 * Последний применённый снимок окна пришёл из кэша (`fromCache`). Пока так,
 * «Показать ещё» не работает: курсор из кэша — это решение по снимку из
 * кэша (правило CLAUDE.md), а окно из кэша может быть утренним.
 */
let windowFromCache = true;
/** Откуда сейчас читается окно (после отката «нет таблицы» — Firestore). */
let liveBackend: SbBackend = "firestore";

function emit(next: Partial<OsDispatchLogState>) {
  state = { ...state, ...next };
  listeners.forEach((fn) => fn());
}

function sortedEntries(): OsDispatchLogEntry[] {
  return Array.from(known.values(), (k) => k.entry).sort((a, b) => b.createdAt - a.createdAt);
}

function oldestKnown(): { entry: OsDispatchLogEntry; snap?: QueryDocumentSnapshot } | null {
  let oldest: { entry: OsDispatchLogEntry; snap?: QueryDocumentSnapshot } | null = null;
  for (const k of known.values()) if (!oldest || k.entry.createdAt < oldest.entry.createdAt) oldest = k;
  return oldest;
}

function reset() {
  known.clear();
  generation += 1;
  pagedToEnd = null;
  windowFromCache = true;
  emit(EMPTY);
}

function seenKey(workspaceId: string, uid: string) {
  return `nova:os-dispatch-seen:${workspaceId}:${uid}`;
}

function readSeen(workspaceId: string, uid: string): number {
  try {
    return Number(localStorage.getItem(seenKey(workspaceId, uid)) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function countUnseen(entries: OsDispatchLogEntry[], seenAt: number): number {
  return entries.filter((e) => e.createdAt > seenAt).length;
}

export function osDispatchLogState(): OsDispatchLogState {
  return state;
}

export function subscribeOsDispatchLogState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Человек открыл вкладку — всё, что там сейчас, считается просмотренным. */
export function markOsDispatchLogSeen() {
  if (!current) return;
  const newest = state.entries.reduce((max, e) => Math.max(max, e.createdAt), 0);
  const at = Math.max(newest, Date.now());
  try {
    localStorage.setItem(seenKey(current.workspaceId, current.uid), String(at));
  } catch {
    /* без localStorage счётчик просто не запомнится между загрузками */
  }
  emit({ unseen: 0 });
}

/** Firestore: окно 25 живой подпиской. */
function startFs(workspaceId: string, uid: string, onFresh?: (entries: OsDispatchLogEntry[]) => void): (() => void) | null {
  if (!db) return null;
  liveBackend = "firestore";
  const seenIds = new Set<string>();
  /** Первый снимок С СЕРВЕРА ещё не приходил — тост молчит. */
  let serverSeen = false;
  pagedToEnd = null;
  windowFromCache = true;
  const q = query(
    collection(db, "workspaces", workspaceId, "osDispatchLog"),
    orderBy("createdAt", "desc"),
    limit(OS_DISPATCH_LIVE_LIMIT)
  );
  // includeMetadataChanges — чтобы переход «кэш → сервер» пришёл, даже если
  // документы окна не изменились (иначе вкладка так и осталась бы на кэше).
  return onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snap) => {
      const fromCache = snap.metadata.fromCache;
      // Окно из кэша может быть утренним (#1..#25), а следом придёт серверное
      // (#61..#85): сложи их в known — и между ними дыра #26..#60, которую
      // «Показать ещё» уже не закроет (курсор возьмёт самую старую, #1).
      // Поэтому копить выехавшие из окна записи можно только между ДВУМЯ
      // серверными снимками подряд: они смежные. Снимок из кэша и первый
      // серверный после кэша начинают known заново (и дочитанные страницы
      // тоже — их курсор мог стоять за дырой).
      if (fromCache || windowFromCache) {
        known.clear();
        generation += 1;
        pagedToEnd = null;
      }
      windowFromCache = fromCache;
      const live = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as OsDispatchLogEntry);
      snap.docs.forEach((d, index) => known.set(d.id, { entry: live[index], snap: d }));
      // Тост — только о том, что сервер прислал после своего первого снимка:
      // иначе холодный вход с утренним кэшем «поздравил» бы 25 старыми выдачами.
      const fresh = !fromCache && serverSeen ? live.filter((e) => !seenIds.has(e.id)) : [];
      if (!fromCache) {
        live.forEach((e) => seenIds.add(e.id));
        serverSeen = true;
      }
      const entries = sortedEntries();
      emit({
        workspaceId,
        entries,
        // Рисовать по кэшу можно — решать («есть ли старее») нельзя.
        loaded: true,
        error: null,
        unseen: countUnseen(entries, readSeen(workspaceId, uid)),
        // Пока «Показать ещё» не нажимали, «есть старее» — если окно полное;
        // после — решает последняя дочитанная страница. Окно из кэша — «не
        // знаем»: кнопка появится с серверным снимком.
        hasMore: fromCache ? false : pagedToEnd === null ? snap.size >= OS_DISPATCH_LIVE_LIMIT : !pagedToEnd,
        loadingMore: fromCache ? false : state.loadingMore,
        fromCache,
      });
      if (fresh.length && onFresh) onFresh(fresh);
    },
    (error) => {
      // Отказ — это «не знаем», а не «выдач не было».
      emit({ workspaceId, loaded: false, error: error.code || error.message });
    }
  );
}

/**
 * Supabase: снимок из localStorage (рисовать можно, решать нельзя), затем
 * окно 25 с сервера; дальше — по звонку `nova:{ws}:osdispatch` и опросу раз
 * в минуту на видимой вкладке. Нет таблицы — молча Firestore.
 */
function startSb(workspaceId: string, uid: string, onFresh?: (entries: OsDispatchLogEntry[]) => void): () => void {
  liveBackend = "supabase";
  const seenIds = new Set<string>();
  let serverSeen = false;
  let active = true;
  let stopFs: (() => void) | null = null;
  let stopRing: (() => void) | null = null;
  let settle: ReturnType<typeof setTimeout> | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  pagedToEnd = null;
  windowFromCache = true;

  const cached = readSnapshot<OsDispatchLogEntry[]>(workspaceId, SNAPSHOT_NAME);
  if (cached && Array.isArray(cached.value)) {
    for (const e of cached.value) known.set(e.id, { entry: e });
    const entries = sortedEntries();
    emit({ workspaceId, entries, loaded: true, error: null, unseen: countUnseen(entries, readSeen(workspaceId, uid)), hasMore: false, loadingMore: false, fromCache: true });
  }

  const load = async () => {
    if (!active) return;
    const { data, error } = await supabaseRows
      .from(TABLE)
      .select(COLUMNS)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(OS_DISPATCH_LIVE_LIMIT);
    if (!active) return;
    if (error) {
      if (isSbMissingError(error)) {
        markSbTableMissing("osDispatchLog");
        stopRing?.();
        stopRing = null;
        if (poll) clearInterval(poll);
        poll = null;
        known.clear();
        generation += 1;
        stopFs = startFs(workspaceId, uid, onFresh);
        return;
      }
      emit({ workspaceId, error: error.code || error.message });
      return;
    }
    markSbTablePresent("osDispatchLog");
    const live = ((data ?? []) as OsDispatchRow[]).map(rowToEntry);
    // Снимок → сервер: начать заново, как Firestore после кэша (см. startFs).
    if (windowFromCache) {
      known.clear();
      generation += 1;
      pagedToEnd = null;
    }
    windowFromCache = false;
    live.forEach((e) => known.set(e.id, { entry: e }));
    const fresh = serverSeen ? live.filter((e) => !seenIds.has(e.id)) : [];
    live.forEach((e) => seenIds.add(e.id));
    serverSeen = true;
    writeSnapshot(workspaceId, SNAPSHOT_NAME, live);
    const entries = sortedEntries();
    emit({
      workspaceId,
      entries,
      loaded: true,
      error: null,
      unseen: countUnseen(entries, readSeen(workspaceId, uid)),
      hasMore: pagedToEnd === null ? live.length >= OS_DISPATCH_LIVE_LIMIT : !pagedToEnd,
      loadingMore: state.loadingMore,
      fromCache: false,
    });
    if (fresh.length && onFresh) onFresh(fresh);
  };
  const schedule = () => {
    if (settle) return;
    settle = setTimeout(() => {
      settle = null;
      void load();
    }, RING_SETTLE_MS);
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") schedule();
  };
  stopRing = listenTopic(osDispatchTopic(workspaceId), schedule);
  document.addEventListener("visibilitychange", onVisible);
  poll = setInterval(() => {
    if (document.visibilityState === "visible") void load();
  }, POLL_MS);
  void load();
  return () => {
    active = false;
    stopRing?.();
    document.removeEventListener("visibilitychange", onVisible);
    if (settle) clearTimeout(settle);
    if (poll) clearInterval(poll);
    stopFs?.();
  };
}

/**
 * Поставить (или снять — `workspaceId = null`) подписку на журнал.
 * `onFresh` получает записи, пришедшие ПОСЛЕ первого снимка, — для тоста.
 * `backend` — где живёт журнал (useSbBackend в хуке); сменился — подписка
 * ставится заново.
 */
export function watchOsDispatchLog(
  workspaceId: string | null,
  uid: string | null,
  onFresh?: (entries: OsDispatchLogEntry[]) => void,
  backend: SbBackend = "firestore"
): () => void {
  if (current && (current.workspaceId !== workspaceId || current.uid !== uid || current.backend !== backend)) {
    current.unsubscribe();
    current = null;
    reset();
  }
  if (!workspaceId || !uid || current) return () => undefined;
  const unsubscribe = backend === "supabase" ? startSb(workspaceId, uid, onFresh) : startFs(workspaceId, uid, onFresh);
  if (!unsubscribe) return () => undefined;
  current = { workspaceId, uid, backend, unsubscribe };
  emit({ workspaceId });
  return () => {
    if (current?.unsubscribe === unsubscribe) {
      unsubscribe();
      current = null;
      reset();
    }
  };
}

/**
 * «Показать ещё» на вкладке: следующие `OS_DISPATCH_PAGE_SIZE` записей старее
 * самой старой из уже известных. Разовая выборка, не подписка: старые выдачи
 * не меняются, а живой слушатель на всю историю читал бы её заново при
 * каждом холодном входе. Правило журнала (читают Owner и Тимлид) от
 * фильтров запроса не зависит — выборка проходит его так же, как окно.
 */
export async function loadMoreOsDispatchLog(): Promise<void> {
  // Окно из кэша — курсор из него может стоять за дырой (см. startFs).
  if (!current || windowFromCache || state.loadingMore || !state.hasMore) return;
  const cursor = oldestKnown();
  if (!cursor) return;
  const gen = generation;
  const { workspaceId } = current;
  emit({ loadingMore: true });
  try {
    if (liveBackend === "supabase") {
      const { data, error } = await supabaseRows
        .from(TABLE)
        .select(COLUMNS)
        .eq("workspace_id", workspaceId)
        .lt("created_at", cursor.entry.createdAt)
        .order("created_at", { ascending: false })
        .limit(OS_DISPATCH_PAGE_SIZE);
      if (error) throw sbError(error);
      if (gen !== generation) return;
      const page = ((data ?? []) as OsDispatchRow[]).map(rowToEntry);
      page.forEach((e) => known.set(e.id, { entry: e }));
      pagedToEnd = page.length < OS_DISPATCH_PAGE_SIZE;
    } else {
      if (!db || !cursor.snap) return;
      const snap = await getDocs(
        query(
          collection(db, "workspaces", workspaceId, "osDispatchLog"),
          orderBy("createdAt", "desc"),
          startAfter(cursor.snap),
          limit(OS_DISPATCH_PAGE_SIZE)
        )
      );
      if (gen !== generation) return;
      snap.docs.forEach((d) => known.set(d.id, { entry: { id: d.id, ...d.data() } as OsDispatchLogEntry, snap: d }));
      pagedToEnd = snap.size < OS_DISPATCH_PAGE_SIZE;
    }
    emit({ entries: sortedEntries(), hasMore: !pagedToEnd, loadingMore: false });
  } catch (error) {
    if (gen !== generation) return;
    emit({ loadingMore: false });
    throw error;
  }
}
