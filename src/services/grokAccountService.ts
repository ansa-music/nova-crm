import { deleteDoc, getDocs, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { generateId } from "@/utils/id";
import { normalizeTimestamp, ymdInTimeZone } from "@/utils/date";
import type { GrokAccount, GrokLoginMethod } from "@/types";
import { grokLoginMethodOf } from "@/types/grokAccount";

/** Missing `available` (accounts created before that field existed) reads as available. */
export function isGrokAccountAvailable(account: { available?: boolean }): boolean {
  return account.available ?? true;
}

export type GrokAccountStatus = "available" | "resetToday" | "unavailable";

/**
 * Three-tier status the card's color and sort position both key off:
 * green "available" (the Доступно/Недоступно toggle), amber "resetToday"
 * (still marked unavailable, but its typed reset date is today — worth
 * checking again soon), red "unavailable" otherwise.
 */
export function getGrokAccountStatus(account: { available?: boolean; limitResetAt: number | null }, now: number = Date.now()): GrokAccountStatus {
  if (isGrokAccountAvailable(account)) return "available";
  // Asia/Almaty, not isSameLocalDay's device-local day — this status is
  // shared across everyone viewing the same account pool, and comparing by
  // the viewer's own OS timezone let two people looking at the exact same
  // account disagree on whether it "resets today."
  if (account.limitResetAt != null && ymdInTimeZone(account.limitResetAt) === ymdInTimeZone(now)) return "resetToday";
  return "unavailable";
}

const STATUS_RANK: Record<GrokAccountStatus, number> = { available: 0, resetToday: 1, unavailable: 2 };

function mapAccounts(docs: { id: string; data: () => import("firebase/firestore").DocumentData }[]): GrokAccount[] {
  const items = docs.map((d) => {
    const data = d.data();
    return { id: d.id, ...data, loginMethod: grokLoginMethodOf(data.loginMethod) } as GrokAccount;
  });
  items.forEach((a) => {
    a.createdAt = normalizeTimestamp(a.createdAt);
    a.updatedAt = normalizeTimestamp(a.updatedAt);
    if (a.limitResetAt != null) a.limitResetAt = normalizeTimestamp(a.limitResetAt);
  });
  // Available accounts at the top (that's what people are scanning for),
  // then ones resetting today, then everything else at the bottom —
  // soonest-to-refresh first within a tier, unknown reset time last.
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

export async function fetchGrokAccounts(workspaceId: string): Promise<GrokAccount[]> {
  const snapshot = await getDocs(paths.grokAccounts(workspaceId));
  return mapAccounts(snapshot.docs);
}

/**
 * Live listener for the GROK LIMIT screen. Unlike secondary dashboard
 * widgets (which deliberately poll — see SPARK_POLL_MS — to stay under the
 * Spark plan's concurrent-listener cap), this is the single, dedicated
 * listener for one full-page route, opened only while the user is actually
 * on /grok-limit and closed on unmount — same footprint as the live row
 * listener for whichever desk is currently open. This is what makes the
 * shared account pool actually feel shared: one person marking an account
 * unavailable shows up for everyone else looking at the page right away,
 * instead of after up to a minute of polling.
 */
export function subscribeToGrokAccounts(workspaceId: string, cb: (accounts: GrokAccount[]) => void) {
  return onSnapshot(paths.grokAccounts(workspaceId), (snapshot) => {
    cb(mapAccounts(snapshot.docs));
  });
}

/** Case/whitespace-insensitive match against already-saved accounts, to block accidental duplicate entries. */
export function findDuplicateGrokAccount(
  accounts: GrokAccount[],
  email: string,
  excludeId?: string
): GrokAccount | undefined {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return undefined;
  return accounts.find((a) => a.id !== excludeId && a.email.trim().toLowerCase() === normalized);
}

export interface CreateGrokAccountInput {
  workspaceId: string;
  email: string;
  password: string;
  phone?: string;
  loginMethod?: GrokLoginMethod;
  nickname?: string;
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
    phone: input.phone?.trim() ?? "",
    loginMethod: grokLoginMethodOf(input.loginMethod),
    nickname: input.nickname?.trim() ?? "",
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
  phone?: string;
  loginMethod?: GrokLoginMethod;
  nickname?: string;
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
