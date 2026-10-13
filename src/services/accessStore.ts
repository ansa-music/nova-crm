import { getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { supabaseRows } from "@/lib/supabaseRows";
import { fetchSbDocs, type DocFeedConfig, type SbDoc } from "@/services/sb/docFeed";
import { createDocStore, plainFirestoreData, sbError, type DocWrite } from "@/services/sb/docStore";
import { isSbMissingError, sbTargetOf, type SbBackend } from "@/services/sb/sbCollections";
import { useWorkspaceStore } from "@/store/workspaceStore";

/**
 * Доступы в Supabase — таблица `access_docs` (SQL 20261049, 14.10.2026, этап
 * C переезда с Firestore): запросы на просмотр стола (`viewreq`),
 * «наблюдатели» (`observer`), ключ доступа (`ownerkey`, id всегда `key`) и
 * заявки по ключу (`ownerreq`, id = uid просителя).
 *
 * Та же механика, что у графика, Грока и объявлений (`docStore`): пока в
 * таблице нет отметки `meta/imported`, ВСЕ читают и пишут Firestore, как
 * раньше; отметку ставит сессия Owner, перенеся старые документы
 * (`ensureAccessImported`, автопилот в AppLayout). Пишет только `access_write`
 * — права в ней повторяют firestore.rules: адресата запроса база берёт из
 * копии прав стола, хеш ключа считает и сверяет сама, наблюдателя сразу
 * кладёт в `rows_desk_observers` (по нему RLS открывает строки).
 *
 * Границы: запросы на просмотр ДРУГИХ людей, ожидавшие в момент переезда, не
 * переносятся (Owner читает в Firestore только свои) — просят заново;
 * заявки по ключу переносит сессия создателя (их читает только он). Документ
 * `deskObservers/{uid}` в Firestore остаётся тенью: его читает правило
 * `canAccessPage` для коллекций, которые ещё не переехали.
 */

export type AccessKind = "viewreq" | "observer" | "ownerkey" | "ownerreq";
export type AccessWrite = DocWrite<AccessKind>;

export const ACCESS_FEED: DocFeedConfig = { table: "access_docs", topic: "access", collection: "access" };

const store = createDocStore<AccessKind>({
  feed: ACCESS_FEED,
  collection: "access",
  writeRpc: "access_write",
  importedStorageKey: "nova:access-imported:",
  firestoreRef: (workspaceId, write) => {
    switch (write.kind) {
      case "viewreq":
        return paths.viewRequest(workspaceId, write.id);
      case "observer":
        return paths.deskObserver(workspaceId, write.id);
      case "ownerkey":
        return paths.ownerAccessKey(workspaceId);
      default:
        return paths.ownerAccessRequest(workspaceId, write.id);
    }
  },
});

/** Где доступы сейчас по памяти вкладки (Supabase — только после отметки переноса). */
export const accessBackendFor = (workspaceId: string): SbBackend => store.backendFor(workspaceId);

/** То же для экрана: переподписка, когда перенос сделан. */
export const useAccessBackend = (workspaceId: string | null): SbBackend | null => store.useBackend(workspaceId);

/** То же вне React — для подписок сервисов. */
export const watchAccessBackend = (workspaceId: string, onChange: (backend: SbBackend) => void): (() => void) =>
  store.watchBackend(workspaceId, "imported", onChange);

/**
 * Где доступы сейчас — спросив базу об отметке переноса, если вкладка её ещё
 * не видела (разовые действия из настроек идут без экрана с `useBackend`).
 */
export async function accessBackendNow(workspaceId: string): Promise<SbBackend> {
  if (store.targetFor(workspaceId) === "supabase" && !store.readImported(workspaceId)) await store.checkImported(workspaceId);
  return store.backendFor(workspaceId);
}

/** Пачка записей в Supabase (одна транзакция); отказ — ошибкой с кодом базы. */
export function commitAccess(workspaceId: string, writes: AccessWrite[]): Promise<SbDoc[] | null> {
  return store.commit(workspaceId, writes, "supabase");
}

/** Разовая выборка документов вида (и одного id). `null` — таблицы нет. */
export function fetchAccessDocs(workspaceId: string, kind: AccessKind, id?: string): Promise<SbDoc[] | null> {
  return fetchSbDocs(ACCESS_FEED, workspaceId, (q) => (id ? q.eq("kind", kind).eq("id", id) : q.eq("kind", kind)));
}

/** Текст отказа базы для человека — без префикса функции. */
export function accessErrorText(error: unknown, fallback = "Не удалось сохранить"): string {
  if (isSbMissingError(error)) return "В базе Supabase нет свежего SQL — Owner должен обновить его («Настройки → Строки таблиц»)";
  const message = error instanceof Error ? error.message : String(error ?? "");
  const text = message.replace(/^access_(write|import):\s*/, "").trim();
  return text || fallback;
}

// ---------------------------------------------------------------------
// Перенос Firestore → Supabase (сессия Owner).
// ---------------------------------------------------------------------

/** Сколько после переноса ещё дочитывать правки вкладок на старом коде. */
const TAIL_MS = 3 * 24 * 60 * 60_000;
const IMPORT_CHUNK = 500;

interface ImportDoc {
  kind: AccessKind;
  id: string;
  data: unknown;
}

/**
 * Перенести доступы в Supabase, если пора: строки в Supabase, таблица есть,
 * отметки нет (или идёт трёхдневная дочитка — тогда снова всё, база оставляет
 * более свежее и не воскрешает удалённое). Что не читается этой сессией
 * (заявки по ключу у выданного Owner), пропускается — доберёт сессия
 * создателя в те же трое суток.
 */
export async function ensureAccessImported(workspaceId: string, me: string): Promise<number> {
  const docWs = useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId) ?? null;
  if (!db || !docWs || !me || sbTargetOf(docWs, "access") !== "supabase") return 0;
  const meta = await store.readImportMeta(workspaceId);
  if (meta === undefined) return 0;
  if (meta && typeof meta.at === "number" && Date.now() - meta.at > TAIL_MS) {
    store.setImported(workspaceId, true);
    return 0;
  }
  const docs: ImportDoc[] = [];
  const read = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (error) {
      console.warn(`[access] ${label} из Firestore не прочитаны — переносим остальное`, error);
    }
  };
  await read("наблюдатели", async () => {
    const snap = await getDocs(paths.deskObservers(workspaceId));
    for (const d of snap.docs) docs.push({ kind: "observer", id: d.id, data: plainFirestoreData(d.data()) });
  });
  await read("ключ доступа", async () => {
    const snap = await getDoc(paths.ownerAccessKey(workspaceId));
    if (snap.exists()) docs.push({ kind: "ownerkey", id: "key", data: plainFirestoreData(snap.data()) });
  });
  await read("заявки по ключу", async () => {
    const snap = await getDocs(paths.ownerAccessRequests(workspaceId));
    for (const d of snap.docs) docs.push({ kind: "ownerreq", id: d.id, data: plainFirestoreData(d.data()) });
  });
  await read("запросы на просмотр", async () => {
    // Правило Firestore пускает только свои (от меня и ко мне) — их и берём.
    const base = paths.viewRequests(workspaceId);
    const [from, to] = await Promise.all([getDocs(query(base, where("fromUid", "==", me))), getDocs(query(base, where("toUid", "==", me)))]);
    const seen = new Set<string>();
    for (const snap of [from, to]) {
      for (const d of snap.docs) {
        if (seen.has(d.id)) continue;
        seen.add(d.id);
        docs.push({ kind: "viewreq", id: d.id, data: plainFirestoreData(d.data()) });
      }
    }
  });
  for (let i = 0; i < Math.max(docs.length, 1); i += IMPORT_CHUNK) {
    const chunk = docs.slice(i, i + IMPORT_CHUNK);
    const last = i + IMPORT_CHUNK >= docs.length;
    const { error } = await supabaseRows.rpc("access_import", { p_workspace: workspaceId, p_docs: chunk, p_done: last });
    if (error) throw sbError(error);
  }
  store.setImported(workspaceId, true);
  return docs.length;
}
