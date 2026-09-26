import { getDoc, getDocs } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { supabaseRows } from "@/lib/supabaseRows";
import { watchSbDocs, type DocFeedConfig, type DocView, type SbDoc } from "@/services/sb/docFeed";
import { createDocStore, plainFirestoreData, sbError, type DocWrite } from "@/services/sb/docStore";
import { sbTargetOf, type SbBackend } from "@/services/sb/sbCollections";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { GROK_ACCESS_DOC_ID } from "@/types";

/**
 * Где живёт «Грок лимит» (26.09.2026, SQL 20261021): таблица grok_docs в
 * Supabase или пять коллекций Firestore, как раньше.
 *
 * Переезд — разовым переносом из сессии Owner (он один читает все пять
 * коллекций целиком, включая закрытые аккаунты): `ensureGrokImported` в
 * автопилоте AppLayout. Пока отметки переноса нет, все читают и пишут
 * Firestore. Трое суток после переноса та же сессия дочитывает правки
 * вкладок на старом коде (база берёт только более свежие).
 *
 * Права на чтение в Supabase — RLS по каждой строке (закрытый аккаунт видят
 * руководство, допущенные и управляющий провайдера), поэтому одна выборка
 * вместо трёх запросов Firestore. Закрыли аккаунт — строка пропадает из
 * выдачи без правки; это ловит голова `grok_ids_head`.
 */

export const GROK_FEED: DocFeedConfig = { table: "grok_docs", topic: "grok", collection: "grok", headRpc: "grok_ids_head" };

export type GrokKind = "account" | "app" | "settings" | "stub" | "request";
export type GrokWrite = DocWrite<GrokKind>;

const store = createDocStore<GrokKind>({
  feed: GROK_FEED,
  collection: "grok",
  writeRpc: "grok_write",
  importedStorageKey: "nova:grok-imported:",
  firestoreRef: (workspaceId, write) => {
    switch (write.kind) {
      case "account":
        return paths.grokAccount(workspaceId, write.id);
      case "app":
        return paths.grokAppAccount(workspaceId, write.id);
      case "settings":
        return paths.grokSettings(workspaceId, write.id);
      case "stub":
        return paths.grokAccessStub(workspaceId, write.id);
      case "request":
        return paths.grokAccessRequest(workspaceId, write.id);
    }
  },
});

export function grokBackendFor(workspaceId: string): SbBackend {
  return store.backendFor(workspaceId);
}

export function useGrokBackend(workspaceId: string | null): SbBackend | null {
  return store.useBackend(workspaceId);
}

/** Пачка записей в Supabase (Firestore-ветки сервисов остаются прежними). */
export async function commitGrokWrites(workspaceId: string, writes: GrokWrite[]): Promise<SbDoc[] | null> {
  return store.commit(workspaceId, writes, "supabase");
}

/** Документы Supabase в вид снимка Firestore — для общих map-функций сервисов. */
export function sbDocsAsSnapshot(docs: SbDoc[]): { id: string; data: () => Record<string, unknown> }[] {
  return docs.map((d) => ({ id: d.id, data: () => d.data }));
}

/**
 * Вид потока Грока. Нет таблицы — `onMissing`: вызывающий уходит в Firestore.
 */
export function watchGrok(
  workspaceId: string,
  view: DocView,
  onData: (docs: SbDoc[]) => void,
  onMissing: () => void,
  onError?: (error: Error) => void
): () => void {
  return watchSbDocs(GROK_FEED, workspaceId, view, (docs) => onData(docs), { onMissing, onError });
}

// ---------------------------------------------------------------------
// Перенос Firestore → Supabase (сессия Owner).
// ---------------------------------------------------------------------

const TAIL_MS = 3 * 24 * 60 * 60_000;
const IMPORT_CHUNK = 400;

/**
 * Перенести Грок в Supabase, если пора. Документов десятки — каждый раз
 * берутся все пять коллекций, база оставляет только более свежие.
 * Возвращает, сколько документов отправлено (0 — ничего не делали).
 */
export async function ensureGrokImported(workspaceId: string): Promise<number> {
  const docWs = useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId) ?? null;
  if (!db || !docWs || sbTargetOf(docWs, "grok") !== "supabase") return 0;
  const meta = await store.readImportMeta(workspaceId);
  if (meta === undefined) return 0;
  if (meta && typeof meta.at === "number" && Date.now() - meta.at > TAIL_MS) {
    store.setImported(workspaceId, true);
    return 0;
  }
  const docs: Array<{ kind: GrokKind; id: string; data: unknown }> = [];
  const [accounts, apps, stubs, requests] = await Promise.all([
    getDocs(paths.grokAccounts(workspaceId)),
    getDocs(paths.grokAppAccounts(workspaceId)),
    getDocs(paths.grokAccessStubs(workspaceId)),
    getDocs(paths.grokAccessRequests(workspaceId)),
  ]);
  for (const d of accounts.docs) docs.push({ kind: "account", id: d.id, data: plainFirestoreData(d.data()) });
  for (const d of apps.docs) docs.push({ kind: "app", id: d.id, data: plainFirestoreData(d.data()) });
  for (const d of stubs.docs) docs.push({ kind: "stub", id: d.id, data: plainFirestoreData(d.data()) });
  for (const d of requests.docs) docs.push({ kind: "request", id: d.id, data: plainFirestoreData(d.data()) });
  const settings = await getDoc(paths.grokSettings(workspaceId, GROK_ACCESS_DOC_ID));
  if (settings.exists()) docs.push({ kind: "settings", id: settings.id, data: plainFirestoreData(settings.data()) });

  for (let i = 0; i < Math.max(docs.length, 1); i += IMPORT_CHUNK) {
    const chunk = docs.slice(i, i + IMPORT_CHUNK);
    const last = i + IMPORT_CHUNK >= docs.length;
    const { error } = await supabaseRows.rpc("grok_import", { p_workspace: workspaceId, p_docs: chunk, p_done: last });
    if (error) throw sbError(error);
  }
  store.setImported(workspaceId, true);
  return docs.length;
}
