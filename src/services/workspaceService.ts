import { deleteDoc, onSnapshot, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths, subscribeToDoc } from "@/firebase/firestore";
import { toast } from "@/components/ui/sonner";
import { generateId } from "@/utils/id";
import type { Workspace } from "@/types";

export interface CreateWorkspaceInput {
  name: string;
  icon: string;
  color: string;
  ownerId: string;
  ownerEmail: string;
  ownerName: string;
}

export async function createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
  if (!db) throw new Error("Firebase не настроен");
  const id = generateId("ws");
  const workspace: Workspace = {
    id,
    name: input.name,
    icon: input.icon,
    color: input.color,
    ownerId: input.ownerId,
    createdAt: Date.now(),
  };
  await setDoc(paths.workspace(id), { ...workspace, createdAt: serverTimestamp() });
  await setDoc(paths.member(id, input.ownerId), {
    uid: input.ownerId,
    email: input.ownerEmail,
    name: input.ownerName,
    role: "owner",
    status: "active",
    invitedAt: Date.now(),
    invitedBy: input.ownerId,
    joinedAt: Date.now(),
  });
  return workspace;
}

export async function deleteWorkspace(workspaceId: string) {
  if (!db) return;
  await deleteDoc(paths.workspace(workspaceId));
}

export async function updateWorkspace(workspaceId: string, patch: Partial<Workspace>) {
  if (!db) return;
  await setDoc(paths.workspace(workspaceId), patch, { merge: true });
}

/**
 * Subscribes to all workspaces a given user belongs to, keeping both the
 * membership list *and* each workspace's own document in realtime sync.
 * Returns an unsubscribe function that tears down all nested listeners.
 */
export function subscribeToUserWorkspaces(
  uid: string,
  onData: (workspaces: Workspace[]) => void
): () => void {
  if (!db) {
    onData([]);
    return () => {};
  }

  const workspaceUnsubs = new Map<string, () => void>();
  const workspaceData = new Map<string, Workspace>();
  let cancelled = false;

  function emit() {
    if (cancelled) return;
    onData(Array.from(workspaceData.values()).sort((a, b) => a.createdAt - b.createdAt));
  }

  // A real realtime listener on the collectionGroup query: membership
  // changes (invite accepted, role changed, removed) are reflected the
  // instant Firestore pushes the update — no polling involved. Requires the
  // composite index in firestore.indexes.json (`firebase deploy --only
  // firestore:indexes`), otherwise Firestore returns a console link to
  // create it on first run.
  const membershipQuery = query(paths.memberGroup(), where("uid", "==", uid));
  const unsubscribeMembership = onSnapshot(
    membershipQuery,
    (snapshot) => {
      if (cancelled) return;

      const currentWorkspaceIds = new Set(
        snapshot.docs.map((d) => d.ref.parent.parent?.id).filter((id): id is string => Boolean(id))
      );

      // Tear down listeners for workspaces the user no longer belongs to.
      for (const [wsId, unsub] of workspaceUnsubs) {
        if (!currentWorkspaceIds.has(wsId)) {
          unsub();
          workspaceUnsubs.delete(wsId);
          workspaceData.delete(wsId);
        }
      }

      // Attach listeners for newly-visible workspaces.
      for (const wsId of currentWorkspaceIds) {
        if (workspaceUnsubs.has(wsId)) continue;
        const unsub = subscribeToDoc<Workspace>(paths.workspace(wsId), (ws) => {
          if (ws) workspaceData.set(wsId, ws);
          else workspaceData.delete(wsId);
          emit();
        });
        workspaceUnsubs.set(wsId, unsub);
      }
      emit();
    },
    (error) => {
      if (cancelled) return;
      // Two likely first-run failure modes for this specific query:
      // rules not deployed yet (permission-denied), or the composite
      // collectionGroup index not deployed yet (failed-precondition, which
      // includes a direct "create it" link from Firestore in error.message).
      if (error.code === "failed-precondition") {
        toast.error("Firestore требует индекс для списка workspace", {
          description:
            "Выполните firebase deploy --only firestore:indexes, либо откройте ссылку из консоли браузера для создания индекса вручную.",
          duration: 12000,
        });
      } else if (error.code === "permission-denied") {
        toast.error("Firestore отклонил запрос (permission-denied)", {
          description: "Похоже, firestore.rules ещё не задеплоены. См. README.",
          duration: 10000,
        });
      }
      // Don't leave the caller's loading state spinning forever.
      emit();
    }
  );

  return () => {
    cancelled = true;
    unsubscribeMembership();
    workspaceUnsubs.forEach((unsub) => unsub());
    workspaceUnsubs.clear();
  };
}
