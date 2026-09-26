import { getDocs, query, where } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { supabaseRows } from "@/lib/supabaseRows";
import { fetchSbDocs, watchSbDocs, type DocFeedConfig, type DocView, type SbDoc } from "@/services/sb/docFeed";
import { createDocStore, plainFirestoreData, sbError, type DocWrite } from "@/services/sb/docStore";
import { sbTargetOf, type SbBackend } from "@/services/sb/sbCollections";
import { useWorkspaceStore } from "@/store/workspaceStore";
import type { SubPage, WorkspacePage } from "@/types";

/**
 * Ядро — столы и вкладки — в Supabase (27.09.2026, SQL 20261029, таблица
 * core_docs): просьба Nurba «всё в Supabase». Участники и документ workspace
 * пока остаются в Firestore: на них держатся все прочие правила.
 *
 * Переезд — разовым переносом из сессии Owner (`ensureCoreImported` в
 * автопилоте AppLayout), отметка `meta/imported_page`. Пока отметки нет,
 * ВСЕ читают и пишут Firestore, как раньше; после — только Supabase.
 * Трое суток после переноса та же сессия дочитывает правки вкладок на
 * старом коде (только более свежие по updatedAt).
 *
 * В Firestore у стола остаётся ТЕНЬ — документ с полями доступа
 * (`SHADOW_KEYS`): их читают правила остальных коллекций Firestore
 * (запросы на просмотр, наблюдатели, счётчики в режиме Firestore, заказы).
 * Тень пишется best-effort вместе с правкой доступа; имя и столбцы там не
 * обновляются. Вкладки тени не имеют.
 *
 * Копию прав `rows_page_acl` (политики строк) ведёт ТРИГГЕР базы по документу
 * стола — сверка на клиенте остаётся страховкой.
 */

export const CORE_FEED: DocFeedConfig = { table: "core_docs", topic: "core", collection: "core", withParent: true };
export const CORE_MARK = "imported_page";

export type CoreKind = "page" | "subpage";
export type CoreWrite = DocWrite<CoreKind>;

/** Поля стола, копия которых держится в Firestore-тени (их читают правила). */
export const SHADOW_KEYS: ReadonlySet<string> = new Set([
  "name",
  "workspaceId",
  "allowedUsers",
  "editableUsers",
  "responsibleUserId",
  "hiddenByResponsible",
  "personalZoneAllowedUsers",
  "osDesk",
  "createdBy",
  "inactive",
  "inactiveAt",
  "inactiveBy",
  "techEditable",
  "technicianDesk",
  "updatedAt",
]);

const store = createDocStore<CoreKind>({
  feed: CORE_FEED,
  collection: "core",
  writeRpc: "core_write",
  importedStorageKey: "nova:core-imported:",
  firestoreRef: (workspaceId, write) =>
    write.kind === "page" ? paths.page(workspaceId, write.id) : paths.subPage(workspaceId, String(write.extra?.page ?? ""), write.id),
});

function workspaceDoc(workspaceId: string) {
  return useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId) ?? null;
}

/** Где столы и вкладки этого workspace сейчас. */
export function corePagesBackendFor(workspaceId: string): SbBackend {
  return store.backendFor(workspaceId, CORE_MARK);
}

/** То же для экрана (переподписка, когда перенос сделан). */
export function useCorePagesBackend(workspaceId: string | null): SbBackend | null {
  return store.useBackend(workspaceId, CORE_MARK);
}

/** Вне React: подписка сервиса переподписывается при смене хранилища. */
export function watchCoreBackend(workspaceId: string, onChange: (backend: SbBackend) => void): () => void {
  return store.watchBackend(workspaceId, CORE_MARK, onChange);
}

/** Пачка записей в Supabase (одной транзакцией). */
export async function commitCore(workspaceId: string, writes: CoreWrite[], opts: { optimistic?: boolean } = {}): Promise<SbDoc[]> {
  const docs = await store.commit(workspaceId, writes, "supabase", CORE_MARK, opts);
  return docs ?? [];
}

export function waitCoreWrites(): Promise<void> {
  return store.waitWrites();
}

export function pageWrite(id: string, op: CoreWrite["op"], data?: Record<string, unknown>): CoreWrite {
  return { kind: "page", id, op, data };
}

export function subPageWrite(pageId: string, id: string, op: CoreWrite["op"], data?: Record<string, unknown>): CoreWrite {
  return { kind: "subpage", id, op, data, extra: { page: pageId } };
}

export function docToPage(doc: SbDoc): WorkspacePage {
  return { ...(doc.data as unknown as WorkspacePage), id: doc.id };
}

export function docToSubPage(doc: SbDoc, pageId: string): SubPage {
  return { ...(doc.data as unknown as SubPage), id: doc.id, pageId: (doc.data.pageId as string) || pageId };
}

export const PAGES_VIEW: DocView = {
  initial: (q) => q.eq("kind", "page"),
  match: (d) => d.kind === "page",
};

export function subPagesView(pageId: string): DocView {
  return {
    initial: (q) => q.eq("kind", "subpage").eq("parent_id", pageId),
    match: (d) => d.kind === "subpage" && (d.parent ?? "") === pageId,
  };
}

/** Вид потока ядра. Нет таблицы — `onMissing`: вызывающий уходит в Firestore. */
export function watchCore(
  workspaceId: string,
  view: DocView,
  onData: (docs: SbDoc[]) => void,
  onMissing: () => void,
  onError?: (error: Error) => void
): () => void {
  return watchSbDocs(CORE_FEED, workspaceId, view, (docs) => onData(docs), { onMissing, onError });
}

/** Столы — разово с сервера (null — таблицы нет). */
export async function fetchCorePages(workspaceId: string): Promise<WorkspacePage[] | null> {
  const docs = await fetchSbDocs(CORE_FEED, workspaceId, (q) => q.eq("kind", "page"));
  return docs ? docs.map(docToPage) : null;
}

export async function fetchCorePage(workspaceId: string, pageId: string): Promise<WorkspacePage | null | undefined> {
  const docs = await fetchSbDocs(CORE_FEED, workspaceId, (q) => q.eq("kind", "page").eq("id", pageId));
  if (docs === null) return undefined;
  return docs[0] ? docToPage(docs[0]) : null;
}

/** Вкладки стола — разово с сервера, по порядку (null — таблицы нет). */
export async function fetchCoreSubPages(workspaceId: string, pageId: string): Promise<SubPage[] | null> {
  const docs = await fetchSbDocs(CORE_FEED, workspaceId, (q) => q.eq("kind", "subpage").eq("parent_id", pageId));
  return docs ? sortSubPages(docs.map((d) => docToSubPage(d, pageId))) : null;
}

export async function fetchCoreSubPage(workspaceId: string, pageId: string, subPageId: string): Promise<SubPage | null | undefined> {
  const docs = await fetchSbDocs(CORE_FEED, workspaceId, (q) => q.eq("kind", "subpage").eq("parent_id", pageId).eq("id", subPageId));
  if (docs === null) return undefined;
  return docs[0] ? docToSubPage(docs[0], pageId) : null;
}

export function sortSubPages(subPages: SubPage[]): SubPage[] {
  return [...subPages].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

// ---------------------------------------------------------------------
// Перенос Firestore → Supabase (сессия Owner).
// ---------------------------------------------------------------------

const TAIL_MS = 3 * 24 * 60 * 60_000;
const IMPORT_CHUNK = 200;

interface ImportDoc {
  kind: CoreKind;
  id: string;
  page?: string;
  data: unknown;
}

/**
 * Перенести столы и вкладки в Supabase, если пора. Первый раз — всё; трое
 * суток после — только документы, правленные после прошлой дочитки (база
 * оставляет более свежие по updatedAt). Возвращает число отправленных
 * документов (0 — ничего не делали).
 */
export async function ensureCoreImported(workspaceId: string): Promise<number> {
  const docWs = workspaceDoc(workspaceId);
  if (!db || !docWs || sbTargetOf(docWs, "core") !== "supabase") return 0;
  const meta = await store.readImportMeta(workspaceId, CORE_MARK);
  if (meta === undefined) return 0;
  const now = Date.now();
  if (meta && typeof meta.at === "number" && now - meta.at > TAIL_MS) {
    store.setImported(workspaceId, true, CORE_MARK);
    return 0;
  }
  const tailAt = typeof meta?.tailAt === "number" ? meta.tailAt : typeof meta?.at === "number" ? meta.at : 0;
  const since = meta ? tailAt - 10 * 60_000 : 0;

  const docs: ImportDoc[] = [];
  const pagesSnap = await getDocs(paths.pages(workspaceId));
  for (const d of pagesSnap.docs) {
    const data = plainFirestoreData(d.data()) as Record<string, unknown>;
    if (!since || Number(data.updatedAt ?? 0) > since) docs.push({ kind: "page", id: d.id, data });
    const subsRef = paths.subPages(workspaceId, d.id);
    const subs = since ? await getDocs(query(subsRef, where("updatedAt", ">", since))) : await getDocs(subsRef);
    for (const s of subs.docs) {
      const sub = plainFirestoreData(s.data()) as Record<string, unknown>;
      docs.push({ kind: "subpage", id: s.id, page: d.id, data: { ...sub, pageId: d.id } });
    }
  }

  for (let i = 0; i < Math.max(docs.length, 1); i += IMPORT_CHUNK) {
    const chunk = docs.slice(i, i + IMPORT_CHUNK);
    const last = i + IMPORT_CHUNK >= docs.length;
    const { error } = await supabaseRows.rpc("core_import", { p_workspace: workspaceId, p_docs: chunk, p_mark: CORE_MARK, p_done: last });
    if (error) throw sbError(error);
  }
  // Время дочитки (`tailAt`) в отметке ставит сама `core_import`; `at` —
  // время первого переноса — она не трогает.
  store.setImported(workspaceId, true, CORE_MARK);
  return docs.length;
}
