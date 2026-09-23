import { addDoc, collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
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

const LIVE_LIMIT = 100;

export interface OsDispatchLogState {
  workspaceId: string | null;
  entries: OsDispatchLogEntry[];
  loaded: boolean;
  error: string | null;
  /** Сколько записей новее, чем человек последний раз открывал вкладку. */
  unseen: number;
}

let state: OsDispatchLogState = { workspaceId: null, entries: [], loaded: false, error: null, unseen: 0 };
const listeners = new Set<() => void>();
let current: { workspaceId: string; uid: string; unsubscribe: () => void } | null = null;

function emit(next: Partial<OsDispatchLogState>) {
  state = { ...state, ...next };
  listeners.forEach((fn) => fn());
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
    emit({ workspaceId: null, entries: [], loaded: false, error: null, unseen: 0 });
  }
  if (!db || !workspaceId || !uid || current) return () => undefined;
  const known = new Set<string>();
  let first = true;
  const q = query(collection(db, "workspaces", workspaceId, "osDispatchLog"), orderBy("createdAt", "desc"), limit(LIVE_LIMIT));
  const unsubscribe = onSnapshot(
    q,
    (snap) => {
      const entries = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as OsDispatchLogEntry);
      const fresh = first ? [] : entries.filter((e) => !known.has(e.id));
      entries.forEach((e) => known.add(e.id));
      first = false;
      emit({ workspaceId, entries, loaded: true, error: null, unseen: countUnseen(entries, readSeen(workspaceId, uid)) });
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
      emit({ workspaceId: null, entries: [], loaded: false, error: null, unseen: 0 });
    }
  };
}
