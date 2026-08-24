import { deleteDoc, getDocs, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { generateId } from "@/utils/id";
import { normalizeTimestamp } from "@/utils/date";
import type { Announcement, AnnouncementPriority } from "@/types";

function mapAnnouncements(docs: { id: string; data: () => import("firebase/firestore").DocumentData }[]): Announcement[] {
  const items = docs.map(
    (d) => ({ id: d.id, ...d.data() }) as unknown as Announcement & { serverOrderAt?: unknown }
  );
  items.forEach((a) => (a.createdAt = normalizeTimestamp(a.createdAt)));
  items.sort((a, b) => {
    const keyA = a.serverOrderAt ? normalizeTimestamp(a.serverOrderAt) : a.createdAt;
    const keyB = b.serverOrderAt ? normalizeTimestamp(b.serverOrderAt) : b.createdAt;
    return keyB - keyA;
  });
  return items;
}

export async function fetchAnnouncements(workspaceId: string): Promise<Announcement[]> {
  const snapshot = await getDocs(paths.announcements(workspaceId));
  return mapAnnouncements(snapshot.docs);
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
  await setDoc(paths.announcement(input.workspaceId, id), { ...announcement, serverOrderAt: serverTimestamp() });
  return announcement;
}

export async function updateAnnouncement(
  workspaceId: string,
  id: string,
  patch: Partial<Pick<Announcement, "title" | "body" | "priority" | "pinned">>
) {
  if (!db) return;
  await setDoc(paths.announcement(workspaceId, id), { ...patch, updatedAt: Date.now() }, { merge: true });
}

export async function togglePinAnnouncement(workspaceId: string, id: string, pinned: boolean) {
  if (!db) return;
  await setDoc(paths.announcement(workspaceId, id), { pinned, updatedAt: Date.now() }, { merge: true });
}

export async function archiveAnnouncement(workspaceId: string, id: string, archived: boolean) {
  if (!db) return;
  await setDoc(paths.announcement(workspaceId, id), { isArchived: archived, updatedAt: Date.now() }, { merge: true });
}

export async function deleteAnnouncement(workspaceId: string, id: string) {
  if (!db) return;
  await deleteDoc(paths.announcement(workspaceId, id));
}
