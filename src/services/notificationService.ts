import { onSnapshot, query, serverTimestamp, setDoc, where, writeBatch } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths, withErrorReporting } from "@/firebase/firestore";
import { generateId } from "@/utils/id";
import { normalizeTimestamp } from "@/utils/date";
import type { Notification, NotificationTargetKind, Role, WorkspaceMember, WorkspacePage } from "@/types";

export interface SendNotificationInput {
  workspaceId: string;
  title: string;
  body: string;
  priority: "normal" | "important" | "urgent";
  fromUid: string;
  fromName: string;
  relatedAnnouncementId?: string | null;
  target: NotificationTargetKind;
  /** Required when target === "selected" */
  selectedUids?: string[];
  /** Required when target === "role" */
  role?: Role;
}

/** Resolves the target picker's choice down to a concrete list of member uids to notify. */
export function resolveNotificationTargets(
  target: NotificationTargetKind,
  members: WorkspaceMember[],
  pages: WorkspacePage[],
  opts: { selectedUids?: string[]; role?: Role } = {}
): string[] {
  const active = members.filter((m) => m.status === "active");
  switch (target) {
    case "all":
      return active.map((m) => m.uid);
    case "selected":
      return opts.selectedUids ?? [];
    case "role":
      return active.filter((m) => m.role === opts.role).map((m) => m.uid);
    case "responsible": {
      const uids = new Set(pages.map((p) => p.responsibleUserId).filter((id): id is string => Boolean(id)));
      return Array.from(uids);
    }
    default:
      return [];
  }
}

/** Fan-out write: one notification doc per targeted user, so each person's own query stays a simple, safe `where(targetUid == me)`. */
export async function sendNotification(input: SendNotificationInput, targetUids: string[]) {
  if (!db) throw new Error("Firebase не настроен");
  if (targetUids.length === 0) return;
  const batch = writeBatch(db);
  const uniqueTargets = Array.from(new Set(targetUids));
  for (const targetUid of uniqueTargets) {
    const id = generateId("notif");
    const notification: Notification = {
      id,
      workspaceId: input.workspaceId,
      targetUid,
      title: input.title,
      body: input.body,
      priority: input.priority,
      fromUid: input.fromUid,
      fromName: input.fromName,
      read: false,
      createdAt: Date.now(),
      relatedAnnouncementId: input.relatedAnnouncementId ?? null,
    };
    batch.set(paths.notification(input.workspaceId, id), { ...notification, serverOrderAt: serverTimestamp() });
  }
  await batch.commit();
}

export function subscribeToMyNotifications(
  workspaceId: string,
  uid: string,
  onData: (notifications: Notification[]) => void,
  onError?: (error: import("firebase/firestore").FirestoreError) => void
) {
  const q = query(paths.notifications(workspaceId), where("targetUid", "==", uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }) as unknown as Notification)
        .map((n) => ({ ...n, createdAt: normalizeTimestamp(n.createdAt) }))
        .sort((a, b) => b.createdAt - a.createdAt);
      onData(items);
    },
    withErrorReporting(onError)
  );
}

export async function markNotificationRead(workspaceId: string, id: string) {
  if (!db) return;
  await setDoc(paths.notification(workspaceId, id), { read: true }, { merge: true });
}

export async function markAllNotificationsRead(workspaceId: string, notifications: Notification[]) {
  if (!db) return;
  const unread = notifications.filter((n) => !n.read);
  if (unread.length === 0) return;
  const batch = writeBatch(db);
  unread.forEach((n) => batch.set(paths.notification(workspaceId, n.id), { read: true }, { merge: true }));
  await batch.commit();
}

/** Pings each @mentioned person with a lightweight notification. Never blocks/breaks sending the chat message itself if it fails. */
export async function notifyMentions(
  workspaceId: string,
  fromUid: string,
  fromName: string,
  mentionedUids: string[],
  context: string
) {
  const targets = mentionedUids.filter((uid) => uid !== fromUid);
  if (targets.length === 0) return;
  try {
    await sendNotification(
      {
        workspaceId,
        title: `${fromName} упомянул(а) вас`,
        body: context.slice(0, 140),
        priority: "normal",
        fromUid,
        fromName,
        target: "selected",
      },
      targets
    );
  } catch (error) {
    console.error("notifyMentions failed:", error);
  }
}
