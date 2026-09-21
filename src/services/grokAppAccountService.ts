import { deleteDoc, getDocs, onSnapshot, query, setDoc, where, writeBatch } from "firebase/firestore";
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
  return sortAccounts(items);
}

function sortAccounts(items: GrokAppAccount[]): GrokAppAccount[] {
  const now = Date.now();
  return [...items].sort((a, b) => {
    const rankDiff = STATUS_RANK[getGrokAccountStatus(a, now)] - STATUS_RANK[getGrokAccountStatus(b, now)];
    if (rankDiff !== 0) return rankDiff;
    if (a.limitResetAt == null && b.limitResetAt == null) return b.createdAt - a.createdAt;
    if (a.limitResetAt == null) return 1;
    if (b.limitResetAt == null) return -1;
    return a.limitResetAt - b.limitResetAt;
  });
}

/**
 * Живой список аккаунтов подписок.
 *
 * Owner и Тимлид читают коллекцию целиком. Остальным правила отдают только
 * открытые аккаунты и те, куда их пустили, поэтому у них ДВА запроса —
 * «открытые» и «мои» — и результат склеивается. Одним запросом нельзя:
 * list-запрос в Firestore падает целиком, если хоть один документ в выдаче
 * закрыт правилами (см. CLAUDE.md).
 *
 * Документы без поля `restricted` в запрос «открытые» НЕ попадают — Firestore
 * не возвращает записи без поля фильтра. Поэтому у старых аккаунтов поле
 * проставляется разово: `backfillGrokAppRestricted` из сессии руководства.
 */
export function subscribeToGrokAppAccounts(
  workspaceId: string,
  cb: (accounts: GrokAppAccount[]) => void,
  viewer: { seesAll: boolean; uid: string }
) {
  if (viewer.seesAll) {
    return onSnapshot(paths.grokAppAccounts(workspaceId), (snapshot) => {
      cb(mapAccounts(snapshot.docs));
    });
  }

  const open = new Map<string, GrokAppAccount>();
  const mine = new Map<string, GrokAppAccount>();
  const emit = () => {
    const merged = new Map<string, GrokAppAccount>();
    for (const [id, account] of open) merged.set(id, account);
    for (const [id, account] of mine) merged.set(id, account);
    cb(sortAccounts(Array.from(merged.values())));
  };

  const unsubOpen = onSnapshot(
    query(paths.grokAppAccounts(workspaceId), where("restricted", "==", false)),
    (snapshot) => {
      open.clear();
      for (const account of mapAccounts(snapshot.docs)) open.set(account.id, account);
      emit();
    }
  );
  const unsubMine = onSnapshot(
    query(paths.grokAppAccounts(workspaceId), where("allowedUids", "array-contains", viewer.uid)),
    (snapshot) => {
      mine.clear();
      for (const account of mapAccounts(snapshot.docs)) mine.set(account.id, account);
      emit();
    }
  );
  return () => {
    unsubOpen();
    unsubMine();
  };
}

/**
 * Открыть аккаунт списку людей. Пустой список = аккаунт снова открыт всем:
 * «закрыт и никому не открыт» — состояние, из которого его никто, кроме
 * руководства, уже не увидит, и заводить его случайным кликом незачем.
 */
export async function setGrokAppAccess(input: {
  workspaceId: string;
  id: string;
  allowedUids: string[];
  actorUid: string;
  actorName: string;
}) {
  if (!db) throw new Error("Firebase не настроен");
  await setDoc(
    paths.grokAppAccount(input.workspaceId, input.id),
    {
      restricted: input.allowedUids.length > 0,
      allowedUids: input.allowedUids,
      updatedByUid: input.actorUid,
      updatedByName: input.actorName,
      updatedAt: Date.now(),
    },
    { merge: true }
  );
}

/**
 * Разовая простановка `restricted: false` старым записям. Без неё они не
 * попадают в запрос «открытые» и пропадают у всех, кроме руководства.
 * Вызывается из сессии Owner/Тимлида, которая видит коллекцию целиком.
 */
export async function backfillGrokAppRestricted(workspaceId: string, accounts: GrokAppAccount[]) {
  if (!db) return;
  const legacy = accounts.filter((a) => a.restricted === undefined);
  if (legacy.length === 0) return;
  const batch = writeBatch(db);
  for (const account of legacy) {
    batch.set(paths.grokAppAccount(workspaceId, account.id), { restricted: false }, { merge: true });
  }
  await batch.commit();
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
    restricted: false,
    allowedUids: [],
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
