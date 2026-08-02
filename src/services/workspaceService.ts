import { deleteDoc, DocumentData, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { generateId } from "@/utils/id";
import { addOwnWorkspaceId } from "@/services/authService";
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
  await addOwnWorkspaceId(input.ownerId, id);
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
 *
 * Deliberately does NOT use a `collectionGroup` query on `members` — that
 * approach turned out to be unreliable in practice. Instead this reads the
 * cached `workspaceIds` array off the user's own profile doc (a plain,
 * simple, always-reliable read) and subscribes to each workspace doc
 * individually. If one cached id turns out to be stale (e.g. removed while
 * offline), only that single doc read is denied and it's just quietly
 * dropped from the list — it can never take down the whole subscription.
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
  let emittedOnce = false;
  let pendingEmptyCacheTimer: ReturnType<typeof setTimeout> | null = null;

  function emit() {
    if (cancelled) return;
    emittedOnce = true;
    onData(Array.from(workspaceData.values()).sort((a, b) => a.createdAt - b.createdAt));
  }

  function applyWorkspaceIds(currentWorkspaceIds: Set<string>) {
    // Tear down listeners for workspaces no longer in the cached list.
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
      const unsub = onSnapshot(
        paths.workspace(wsId),
        (snap) => {
          if (snap.exists()) {
            workspaceData.set(wsId, { id: snap.id, ...(snap.data() as DocumentData) } as Workspace);
          } else {
            workspaceData.delete(wsId);
          }
          emit();
        },
        () => {
          // A stale/removed id in the cache — drop it silently, never
          // surface a toast for this, it's expected eventual-consistency.
          workspaceData.delete(wsId);
          emit();
        }
      );
      workspaceUnsubs.set(wsId, unsub);
    }
    emit();
  }

  const unsubscribeUser = onSnapshot(paths.user(uid), (snapshot) => {
    if (cancelled) return;
    const userDoc = snapshot.exists() ? (snapshot.data() as { workspaceIds?: string[] }) : undefined;
    const currentWorkspaceIds = new Set(userDoc?.workspaceIds ?? []);

    if (pendingEmptyCacheTimer) {
      clearTimeout(pendingEmptyCacheTimer);
      pendingEmptyCacheTimer = null;
    }

    // Fresh full page load: the very first snapshot can come from a stale
    // local cache captured before this account had any workspaces cached
    // (or before a just-approved join finished syncing). Trusting an EMPTY
    // result straight from cache is exactly what causes "opens on the 2nd
    // reload but not the 1st" — give the real server snapshot a brief
    // window to arrive before treating "no workspaces" as final. A non-
    // empty cached result is trusted immediately (worst case a stale id
    // gets silently dropped once its own doc read is denied).
    if (snapshot.metadata.fromCache && currentWorkspaceIds.size === 0 && !emittedOnce) {
      pendingEmptyCacheTimer = setTimeout(() => {
        if (!cancelled) applyWorkspaceIds(currentWorkspaceIds);
      }, 1500);
      return;
    }

    applyWorkspaceIds(currentWorkspaceIds);
  });

  return () => {
    cancelled = true;
    if (pendingEmptyCacheTimer) clearTimeout(pendingEmptyCacheTimer);
    unsubscribeUser();
    workspaceUnsubs.forEach((unsub) => unsub());
    workspaceUnsubs.clear();
  };
}
