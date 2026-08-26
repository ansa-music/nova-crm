import { deleteDoc, getDocs, setDoc } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { generateId } from "@/utils/id";
import { normalizeTimestamp } from "@/utils/date";
import type { GrokAccount } from "@/types";

/** Missing `available` (accounts created before that field existed) reads as available. */
export function isGrokAccountAvailable(account: GrokAccount): boolean {
  return account.available ?? true;
}

function mapAccounts(docs: { id: string; data: () => import("firebase/firestore").DocumentData }[]): GrokAccount[] {
  const items = docs.map((d) => ({ id: d.id, ...d.data() }) as GrokAccount);
  items.forEach((a) => {
    a.createdAt = normalizeTimestamp(a.createdAt);
    a.updatedAt = normalizeTimestamp(a.updatedAt);
    if (a.limitResetAt != null) a.limitResetAt = normalizeTimestamp(a.limitResetAt);
  });
  // Available accounts first (that's what people are scanning for); among
  // the unavailable ones, soonest-to-refresh first, unknown reset time last.
  items.sort((a, b) => {
    const aAvail = isGrokAccountAvailable(a);
    const bAvail = isGrokAccountAvailable(b);
    if (aAvail !== bAvail) return aAvail ? -1 : 1;
    if (a.limitResetAt == null && b.limitResetAt == null) return b.createdAt - a.createdAt;
    if (a.limitResetAt == null) return 1;
    if (b.limitResetAt == null) return -1;
    return a.limitResetAt - b.limitResetAt;
  });
  return items;
}

export async function fetchGrokAccounts(workspaceId: string): Promise<GrokAccount[]> {
  const snapshot = await getDocs(paths.grokAccounts(workspaceId));
  return mapAccounts(snapshot.docs);
}

export interface CreateGrokAccountInput {
  workspaceId: string;
  email: string;
  password: string;
  limitResetAt: number | null;
  actorUid: string;
  actorName: string;
}

export async function createGrokAccount(input: CreateGrokAccountInput): Promise<GrokAccount> {
  if (!db) throw new Error("Firebase не настроен");
  const id = generateId("grok");
  const now = Date.now();
  const account: GrokAccount = {
    id,
    workspaceId: input.workspaceId,
    email: input.email.trim(),
    password: input.password,
    // A newly added account is assumed usable until someone says otherwise —
    // only relevant if a reset time in the future was already typed in.
    available: input.limitResetAt == null || input.limitResetAt <= now,
    limitResetAt: input.limitResetAt,
    updatedByUid: input.actorUid,
    updatedByName: input.actorName,
    updatedAt: now,
    createdAt: now,
    createdBy: input.actorUid,
  };
  await setDoc(paths.grokAccount(input.workspaceId, id), account);
  return account;
}

export interface UpdateGrokAccountInput {
  email?: string;
  password?: string;
  limitResetAt?: number | null;
  available?: boolean;
}

/** Any edit — including just hitting "Актуализировать" with an empty patch — re-stamps who touched it last. */
export async function updateGrokAccount(
  workspaceId: string,
  id: string,
  patch: UpdateGrokAccountInput,
  actorUid: string,
  actorName: string
) {
  if (!db) return;
  await setDoc(
    paths.grokAccount(workspaceId, id),
    { ...patch, updatedByUid: actorUid, updatedByName: actorName, updatedAt: Date.now() },
    { merge: true }
  );
}

export async function deleteGrokAccount(workspaceId: string, id: string) {
  if (!db) return;
  await deleteDoc(paths.grokAccount(workspaceId, id));
}
