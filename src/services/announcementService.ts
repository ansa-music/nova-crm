import { deleteDoc, getDocs, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { generateId } from "@/utils/id";
import { supabaseRows } from "@/lib/supabaseRows";
import { normalizeTimestamp } from "@/utils/date";
import { watchSbDocs, type DocFeedConfig, type SbDoc } from "@/services/sb/docFeed";
import { createDocStore, plainFirestoreData } from "@/services/sb/docStore";
import { sbTargetOf, type SbBackend } from "@/services/sb/sbCollections";
import { useWorkspaceStore } from "@/store/workspaceStore";
import type { Announcement, AnnouncementPriority } from "@/types";

/**
 * Объявления: Firestore `announcements/{id}` или Supabase `announcement_docs`
 * (26.09.2026, SQL 20261020). Переезд — разовым переносом из сессии
 * руководства (`ensureAnnouncementsImported`, автопилот в AppLayout); пока
 * отметки переноса нет, все читают и пишут Firestore.
 */

export const ANNOUNCEMENTS_FEED: DocFeedConfig = { table: "announcement_docs", topic: "ann", collection: "announcements" };

const store = createDocStore<"ann">({
  feed: ANNOUNCEMENTS_FEED,
  collection: "announcements",
  writeRpc: "announcement_write",
  importedStorageKey: "nova:ann-imported:",
  firestoreRef: (workspaceId, write) => paths.announcement(workspaceId, write.id),
});

export const announcementsBackendFor = store.backendFor;
export const useAnnouncementsBackend = (workspaceId: string | null) => store.useBackend(workspaceId);

type RawAnnouncement = Announcement & { serverOrderAt?: unknown };

function sortAnnouncements(items: RawAnnouncement[]): Announcement[] {
  items.forEach((a) => (a.createdAt = normalizeTimestamp(a.createdAt)));
  items.sort((a, b) => {
    const keyA = a.serverOrderAt ? normalizeTimestamp(a.serverOrderAt) : a.createdAt;
    const keyB = b.serverOrderAt ? normalizeTimestamp(b.serverOrderAt) : b.createdAt;
    return keyB - keyA;
  });
  return items;
}

function mapAnnouncements(docs: { id: string; data: () => import("firebase/firestore").DocumentData }[]): Announcement[] {
  return sortAnnouncements(docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as RawAnnouncement));
}

function mapSbAnnouncements(docs: SbDoc[]): Announcement[] {
  return sortAnnouncements(docs.map((d) => ({ ...d.data, id: d.id }) as unknown as RawAnnouncement));
}

export async function fetchAnnouncements(workspaceId: string): Promise<Announcement[]> {
  const snapshot = await getDocs(paths.announcements(workspaceId));
  return mapAnnouncements(snapshot.docs);
}

export function subscribeToAnnouncements(workspaceId: string, cb: (items: Announcement[]) => void, backend: SbBackend = "firestore") {
  if (backend === "supabase") {
    let fallback: (() => void) | null = null;
    const stop = watchSbDocs(
      ANNOUNCEMENTS_FEED,
      workspaceId,
      { initial: (q) => q.eq("kind", "ann"), match: (d) => d.kind === "ann" },
      (docs) => cb(mapSbAnnouncements(docs)),
      {
        onMissing: () => {
          if (!fallback) fallback = subscribeToAnnouncements(workspaceId, cb, "firestore");
        },
      }
    );
    return () => {
      stop();
      fallback?.();
    };
  }
  return onSnapshot(paths.announcements(workspaceId), (snapshot) => {
    cb(mapAnnouncements(snapshot.docs));
  });
}

export interface CreateAnnouncementInput {
  workspaceId: string;
  title: string;
  body: string;
  priority: AnnouncementPriority;
  pinned: boolean;
  authorUid: string;
  authorName: string;
  authorPhotoURL?: string | null;
}

export async function createAnnouncement(input: CreateAnnouncementInput): Promise<Announcement> {
  if (!db) throw new Error("Firebase не настроен");
  const id = generateId("ann");
  const announcement: Announcement = {
    id,
    workspaceId: input.workspaceId,
    title: input.title,
    body: input.body,
    priority: input.priority,
    pinned: input.pinned,
    isArchived: false,
    authorUid: input.authorUid,
    authorName: input.authorName,
    authorPhotoURL: input.authorPhotoURL ?? null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  if (announcementsBackendFor(input.workspaceId) === "supabase") {
    // serverOrderAt ставит база (серверное время создания).
    await store.commit(input.workspaceId, [{ kind: "ann", id, op: "set", data: { ...announcement } }], "supabase");
    return announcement;
  }
  await setDoc(paths.announcement(input.workspaceId, id), { ...announcement, serverOrderAt: serverTimestamp() });
  return announcement;
}

async function mergeAnnouncement(workspaceId: string, id: string, patch: Record<string, unknown>) {
  if (!db) return;
  const data = { ...patch, updatedAt: Date.now() };
  if (announcementsBackendFor(workspaceId) === "supabase") {
    await store.commit(workspaceId, [{ kind: "ann", id, op: "merge", data }], "supabase");
    return;
  }
  await setDoc(paths.announcement(workspaceId, id), data, { merge: true });
}

export async function updateAnnouncement(
  workspaceId: string,
  id: string,
  patch: Partial<Pick<Announcement, "title" | "body" | "priority" | "pinned">>
) {
  await mergeAnnouncement(workspaceId, id, patch);
}

export async function togglePinAnnouncement(workspaceId: string, id: string, pinned: boolean) {
  await mergeAnnouncement(workspaceId, id, { pinned });
}

export async function archiveAnnouncement(workspaceId: string, id: string, archived: boolean) {
  await mergeAnnouncement(workspaceId, id, { isArchived: archived });
}

export async function deleteAnnouncement(workspaceId: string, id: string) {
  if (!db) return;
  if (announcementsBackendFor(workspaceId) === "supabase") {
    await store.commit(workspaceId, [{ kind: "ann", id, op: "delete" }], "supabase");
    return;
  }
  await deleteDoc(paths.announcement(workspaceId, id));
}

// ---------------------------------------------------------------------
// Перенос Firestore → Supabase (сессия руководства).
// ---------------------------------------------------------------------

/** Сколько после переноса ещё дочитывать правки вкладок на старом коде. */
const TAIL_MS = 3 * 24 * 60 * 60_000;

/**
 * Перенести объявления в Supabase, если пора: строки в Supabase, таблица
 * есть, отметки нет (или идёт трёхдневная дочитка). Объявлений единицы —
 * каждый раз берутся все, база оставляет только более свежие.
 */
export async function ensureAnnouncementsImported(workspaceId: string): Promise<number> {
  const docWs = useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId) ?? null;
  if (!db || !docWs || sbTargetOf(docWs, "announcements") !== "supabase") return 0;
  const meta = await store.readImportMeta(workspaceId);
  if (meta === undefined) return 0;
  if (meta && typeof meta.at === "number" && Date.now() - meta.at > TAIL_MS) {
    store.setImported(workspaceId, true);
    return 0;
  }
  const snapshot = await getDocs(paths.announcements(workspaceId));
  const docs = snapshot.docs.map((d) => ({ id: d.id, data: plainFirestoreData(d.data()) }));
  const { error } = await supabaseRows.rpc("announcement_import", { p_workspace: workspaceId, p_docs: docs, p_done: true });
  if (error) throw Object.assign(new Error(error.message || "Supabase"), { code: error.code });
  store.setImported(workspaceId, true);
  return docs.length;
}
