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

export async function logOsDispatch(workspaceId: string, entry: Omit<OsDispatchLogEntry, "id" | "workspaceId" | "createdAt">) {
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
   * Список — из кэша на диске, сервер ещё не ответил. Рисовать можно, но
   * сколько выдач «на самом деле», неизвестно: счётчики — «не меньше».
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
let current: { workspaceId: string; uid: string; unsubscribe: () => void } | null = null;
/** Снимки документов — курсор `startAfter` для «Показать ещё». */
const known = new Map<string, { entry: OsDispatchLogEntry; snap: QueryDocumentSnapshot }>();
/** Поколение подписки: страница, дочитанная для прежней, в новую не попадёт. */
let generation = 0;
/** null — страниц ещё не дочитывали; true — дочитали до самой первой выдачи. */
let pagedToEnd: boolean | null = null;
/**
 * Последний применённый снимок окна пришёл из кэша на диске (`fromCache`).
 * Пока так, «Показать ещё» не работает: курсор из кэша — это решение по
 * снимку из кэша (правило CLAUDE.md), а окно из кэша может быть утренним.
 */
let windowFromCache = true;

function emit(next: Partial<OsDispatchLogState>) {
  state = { ...state, ...next };
  listeners.forEach((fn) => fn());
}

function sortedEntries(): OsDispatchLogEntry[] {
  return Array.from(known.values(), (k) => k.entry).sort((a, b) => b.createdAt - a.createdAt);
}

function oldestSnap(): QueryDocumentSnapshot | null {
  let oldest: { entry: OsDispatchLogEntry; snap: QueryDocumentSnapshot } | null = null;
  for (const k of known.values()) if (!oldest || k.entry.createdAt < oldest.entry.createdAt) oldest = k;
  return oldest?.snap ?? null;
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

/**
 * Поставить (или снять — `workspaceId = null`) подписку на журнал.
 * `onFresh` получает записи, пришедшие ПОСЛЕ первого снимка, — для тоста.
 */
export function watchOsDispatchLog(
  workspaceId: string | null,
  uid: string | null,
  onFresh?: (entries: OsDispatchLogEntry[]) => void
): () => void {
  if (current && (current.workspaceId !== workspaceId || current.uid !== uid)) {
    current.unsubscribe();
    current = null;
    reset();
  }
  if (!db || !workspaceId || !uid || current) return () => undefined;
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
  const unsubscribe = onSnapshot(
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
  current = { workspaceId, uid, unsubscribe };
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
 * самой старой из уже известных. Разовая выборка (`getDocs`), не подписка:
 * старые выдачи не меняются, а живой слушатель на всю историю читал бы её
 * заново при каждом холодном входе. Правило журнала (читают Owner и Тимлид)
 * от фильтров запроса не зависит — выборка проходит его так же, как окно.
 */
export async function loadMoreOsDispatchLog(): Promise<void> {
  // Окно из кэша — курсор из него может стоять за дырой (см. watchOsDispatchLog).
  if (!db || !current || windowFromCache || state.loadingMore || !state.hasMore) return;
  const cursor = oldestSnap();
  if (!cursor) return;
  const gen = generation;
  const { workspaceId } = current;
  emit({ loadingMore: true });
  try {
    const snap = await getDocs(
      query(
        collection(db, "workspaces", workspaceId, "osDispatchLog"),
        orderBy("createdAt", "desc"),
        startAfter(cursor),
        limit(OS_DISPATCH_PAGE_SIZE)
      )
    );
    if (gen !== generation) return;
    snap.docs.forEach((d) => known.set(d.id, { entry: { id: d.id, ...d.data() } as OsDispatchLogEntry, snap: d }));
    pagedToEnd = snap.size < OS_DISPATCH_PAGE_SIZE;
    emit({ entries: sortedEntries(), hasMore: !pagedToEnd, loadingMore: false });
  } catch (error) {
    if (gen !== generation) return;
    emit({ loadingMore: false });
    throw error;
  }
}
