import { deleteDoc, getDocs, onSnapshot, orderBy, query, setDoc, limit as fsLimit } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { generateId } from "@/utils/id";
import { expandHistoryDoc, sortHistoryDesc } from "@/utils/historyDocs";
import type { HistoryAction, HistoryEntry } from "@/types";

export interface LogChangeInput {
  workspaceId: string;
  pageId?: string;
  pageName?: string;
  rowId?: string;
  field?: string;
  fieldLabel?: string;
  oldValue: string | number | null;
  newValue: string | number | null;
  action: HistoryAction;
  userId: string;
  userName: string;
}

/**
 * Записи истории копятся в памяти и уезжают ПАЧКОЙ в один документ.
 *
 * Зачем: на бесплатном Firebase (Spark) 20 000 записей в сутки, а каждая
 * правка ячейки стоила ДВЕ — саму строку и запись истории. То есть половину
 * дневной квоты съедал журнал. Квота считается по документам, поэтому
 * writeBatch тут не помог бы вовсе: тридцать записей одной пачкой стоят
 * тридцать записей. Помогает только один документ на несколько изменений.
 *
 * Цена решения — окно в {@link FLUSH_MS}: если вкладку убьют жёстко (не
 * закроют, а оборвут), последние секунды журнала пропадут. Для аудит-лога
 * это приемлемо, для строк таблицы было бы нет — строки пишутся как и
 * раньше, сразу.
 */
const FLUSH_MS = 10_000;
/** Больше полусотни в документ не кладём — 1 МиБ на документ никто не отменял. */
const MAX_ENTRIES = 50;

let buffer = new Map<string, HistoryEntry[]>();
let timer: ReturnType<typeof setTimeout> | null = null;

async function writeBatchDoc(workspaceId: string, entries: HistoryEntry[]) {
  const id = generateId("hist");
  const last = entries[entries.length - 1];
  await setDoc(paths.historyEntry(workspaceId, id), {
    id,
    workspaceId,
    // Документы сортируются по этому полю, внутри пачки порядок восстанавливает
    // читающая сторона (sortHistoryDesc).
    timestamp: last?.timestamp ?? Date.now(),
    entries,
  });
}

/**
 * Отдать накопленное в базу. Зовётся по таймеру, при уходе со вкладки и перед
 * перезагрузкой на новую версию. Отказ НЕ возвращает записи в буфер: самая
 * частая причина отказа — кончившаяся квота, и вечный повтор только добавил бы
 * отказов к уже случившимся.
 */
export async function flushHistory(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (buffer.size === 0) return;
  const pending = buffer;
  buffer = new Map();
  await Promise.all(
    [...pending].map(async ([workspaceId, entries]) => {
      try {
        await writeBatchDoc(workspaceId, entries);
      } catch (error) {
        console.warn("[history] пачка не записалась", error);
      }
    })
  );
}

export async function logChange(input: LogChangeInput) {
  if (!db) return;
  const entry: HistoryEntry = { id: generateId("hist"), timestamp: Date.now(), ...input };
  const list = buffer.get(input.workspaceId) ?? [];
  list.push(entry);
  buffer.set(input.workspaceId, list);
  if (list.length >= MAX_ENTRIES) {
    void flushHistory();
    return;
  }
  if (!timer) {
    timer = setTimeout(() => {
      timer = null;
      void flushHistory();
    }, FLUSH_MS);
  }
}

if (typeof window !== "undefined") {
  // `visibilitychange` — основной путь: он срабатывает и при переключении
  // вкладки, и когда телефон уводит браузер в фон, то есть пока страница ещё
  // жива и запись успевает уйти. `pagehide` — последний шанс перед закрытием.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushHistory();
  });
  window.addEventListener("pagehide", () => {
    void flushHistory();
  });
}

export async function fetchHistory(workspaceId: string, max = 200): Promise<HistoryEntry[]> {
  const q = query(paths.history(workspaceId), orderBy("timestamp", "desc"), fsLimit(max));
  const snap = await getDocs(q);
  return sortHistoryDesc(
    snap.docs.flatMap((d) => expandHistoryDoc(d.id, d.data() as Record<string, unknown>)),
    max
  );
}

export async function deleteHistoryEntry(workspaceId: string, entryId: string) {
  if (!db) return;
  await deleteDoc(paths.historyEntry(workspaceId, entryId));
}

export function subscribeToHistory(workspaceId: string, cb: (rows: HistoryEntry[]) => void, max = 200) {
  if (!db) {
    cb([]);
    return () => {};
  }
  // Свои последние правки ещё лежат в буфере — без этого Owner открывал бы
  // журнал и не видел того, что сделал десять секунд назад.
  void flushHistory();
  const q = query(paths.history(workspaceId), orderBy("timestamp", "desc"), fsLimit(max));
  return onSnapshot(q, (snap) => {
    cb(sortHistoryDesc(snap.docs.flatMap((d) => expandHistoryDoc(d.id, d.data() as Record<string, unknown>)), max));
  });
}
