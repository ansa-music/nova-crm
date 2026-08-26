import { deleteDoc, getDocs, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { generateId } from "@/utils/id";
import { isSameLocalDay, normalizeTimestamp } from "@/utils/date";
import { grokLoginMethodOf, type GrokLoginMethod } from "@/types/grokAccount";
import type { GrokAppAccount, GrokAppProvider } from "@/types/grokAppAccount";
import { getGrokAccountStatus, isGrokAccountAvailable, type GrokAccountStatus } from "@/services/grokAccountService";

export { getGrokAccountStatus, isGrokAccountAvailable };
export type { GrokAccountStatus };

const STATUS_RANK: Record<GrokAccountStatus, number> = { available: 0, resetToday: 1, unavailable: 2 };

function mapAccounts(docs: { id: string; data: () => import("firebase/firestore").DocumentData }[]): GrokAppAccount[] {
  const items = docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      loginMethod: grokLoginMethodOf(data.loginMethod),
      provider: (data.provider as GrokAppProvider) || "other",
    } as GrokAppAccount;
  });
  items.forEach((a) => {
    a.createdAt = normalizeTimestamp(a.createdAt);
    a.updatedAt = normalizeTimestamp(a.updatedAt);
    if (a.limitResetAt != null) a.limitResetAt = normalizeTimestamp(a.limitResetAt);
  });
  const now = Date.now();
  items.sort((a, b) => {
    const rankDiff = STATUS_RANK[getGrokAccountStatus(a, now)] - STATUS_RANK[getGrokAccountStatus(b, now)];
    if (rankDiff !== 0) return rankDiff;
    if (a.limitResetAt == null && b.limitResetAt == null) return b.createdAt - a.createdAt;
    if (a.limitResetAt == null) return 1;
    if (b.limitResetAt == null) return -1;
    return a.limitResetAt - b.limitResetAt;
  });
  return items;
}

export function subscribeToGrokAppAccounts(workspaceId: string, cb: (accounts: GrokAppAccount[]) => void) {
  return onSnapshot(paths.grokAppAccounts(workspaceId), (snapshot) => {
    cb(mapAccounts(snapshot.docs));
  });
}

export function findDuplicateGrokAppAccount(
  accounts: GrokAppAccount[],
  provider: GrokAppProvider,
  email: string,
  excludeId?: string
): GrokAppAccount | undefined {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return undefined;
  return accounts.find(
    (a) => a.id !== excludeId && a.provider === provider && a.email.trim().toLowerCase() === normalized
  );
}

export interface CreateGrokAppAccountInput {
  workspaceId: string;
  provider: GrokAppProvider;
  providerOther?: string;
  email: string;
  password: string;
  loginMethod: GrokLoginMethod;
  phone: string;
  note: string;
  nickname?: string;
  limitResetAt: number | null;
  actorUid: string;
  actorName: string;
}

export async function createGrokAppAccount(input: CreateGrokAppAccountInput): Promise<GrokAppAccount> {
  if (!db) throw new Error("Firebase не настроен");
  const id = generateId("gapp");
  const now = Date.now();
  const account: GrokAppAccount = {
    id,
    workspaceId: input.workspaceId,
    provider: input.provider,
    providerOther: input.provider === "other" ? input.providerOther?.trim() || "" : "",
    email: input.email.trim(),
    password: input.password,
    loginMethod: input.loginMethod,
    phone: input.phone.trim(),
    note: input.note.trim(),
    nickname: input.nickname?.trim() ?? "",
    available: input.limitResetAt == null || input.limitResetAt <= now,
    limitResetAt: input.limitResetAt,
    updatedByUid: input.actorUid,
    updatedByName: input.actorName,
    updatedAt: now,
    createdAt: now,
    createdBy: input.actorUid,
  };
  await setDoc(paths.grokAppAccount(input.workspaceId, id), account);
  return account;
}

export interface UpdateGrokAppAccountInput {
  provider?: GrokAppProvider;
  providerOther?: string;
  email?: string;
  password?: string;
  loginMethod?: GrokLoginMethod;
  phone?: string;
  note?: string;
  nickname?: string;
  limitResetAt?: number | null;
  available?: boolean;
}

export async function updateGrokAppAccount(
  workspaceId: string,
  id: string,
  patch: UpdateGrokAppAccountInput,
  actorUid: string,
  actorName: string
) {
  if (!db) return;
  await setDoc(
    paths.grokAppAccount(workspaceId, id),
    { ...patch, updatedByUid: actorUid, updatedByName: actorName, updatedAt: Date.now() },
    { merge: true }
  );
}

export async function deleteGrokAppAccount(workspaceId: string, id: string) {
  if (!db) return;
  await deleteDoc(paths.grokAppAccount(workspaceId, id));
}
