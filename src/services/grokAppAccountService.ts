import { deleteDoc, getDocs, onSnapshot, query, setDoc, where, writeBatch, type Query } from "firebase/firestore";
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
 * открытые аккаунты, те, куда их пустили, и — тем, кто управляет разделом
 * (право страницы, не роль, см. types/grokAccess.ts), — все аккаунты своих
 * провайдеров. Поэтому у них НЕСКОЛЬКО запросов, и результат склеивается.
 * Одним запросом нельзя: list-запрос в Firestore падает целиком, если хоть
 * один документ в выдаче закрыт правилами (см. CLAUDE.md).
 *
 * Документы без поля `restricted` в запрос «открытые» НЕ попадают — Firestore
 * не возвращает записи без поля фильтра. Поэтому у старых аккаунтов поле
 * проставляется разово: `backfillGrokAppRestricted` из сессии руководства.
 *
 * `complete` — все запросы уже ответили С СЕРВЕРА. Только после этого список
 * полный, и сверка витрины закрытых аккаунтов не удалит карточку живого
 * аккаунта, который просто ещё не доехал.
 */
export function subscribeToGrokAppAccounts(
  workspaceId: string,
  cb: (accounts: GrokAppAccount[], complete: boolean) => void,
  viewer: { seesAll: boolean; uid: string; managedProviders?: GrokAppProvider[] }
) {
  if (viewer.seesAll) {
    return onSnapshot(paths.grokAppAccounts(workspaceId), { includeMetadataChanges: true }, (snapshot) => {
      cb(mapAccounts(snapshot.docs), !snapshot.metadata.fromCache);
    });
  }

  const parts = new Map<string, Map<string, GrokAppAccount>>();
  const confirmed = new Set<string>();
  const sources: Array<{ key: string; q: Query }> = [
    { key: "open", q: query(paths.grokAppAccounts(workspaceId), where("restricted", "==", false)) },
    { key: "mine", q: query(paths.grokAppAccounts(workspaceId), where("allowedUids", "array-contains", viewer.uid)) },
    ...(viewer.managedProviders ?? []).map((provider) => ({
      key: `provider:${provider}`,
      q: query(paths.grokAppAccounts(workspaceId), where("provider", "==", provider)),
    })),
  ];
  const emit = () => {
    const merged = new Map<string, GrokAppAccount>();
    for (const part of parts.values()) for (const [id, account] of part) merged.set(id, account);
    cb(sortAccounts(Array.from(merged.values())), sources.every((s) => confirmed.has(s.key)));
  };
  const stops = sources.map(({ key, q }) =>
    onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snapshot) => {
        parts.set(key, new Map(mapAccounts(snapshot.docs).map((a) => [a.id, a])));
        if (!snapshot.metadata.fromCache) confirmed.add(key);
        emit();
      },
      // Отказ одной части не роняет остальные: открытые и «мои» аккаунты
      // человек всё равно видит. Но и «полным» список после отказа не
      // считается — иначе сверка витрины удалила бы карточки этой части.
      (error) => {
        console.error(`Не удалось прочитать аккаунты подписок (${key}):`, error);
        parts.set(key, new Map());
        confirmed.delete(key);
        emit();
      }
    )
  );
  return () => stops.forEach((stop) => stop());
}

/**
 * Разовая простановка `restricted: false` старым записям. Без неё они не
 * попадают в запрос «открытые» и пропадают у всех, кроме руководства.
 * Вызывается из сессии Owner/Тимлида, которая видит коллекцию целиком.
 */
export async function backfillGrokAppRestricted(
  workspaceId: string,
  accounts: GrokAppAccount[],
  actor: { uid: string; name: string }
) {
  if (!db) return;
  const legacy = accounts.filter((a) => a.restricted === undefined);
  if (legacy.length === 0) return;
  const batch = writeBatch(db);
  // Правило правки требует `updatedByUid == я`: запись одного `restricted`
  // оставляла чужой uid последнего редактора и падала — вся пачка, молча.
  for (const account of legacy) {
    batch.set(
      paths.grokAppAccount(workspaceId, account.id),
      { restricted: false, updatedByUid: actor.uid, updatedByName: actor.name, updatedAt: Date.now() },
      { merge: true }
    );
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

/**
 * Удалить аккаунт. Тот, кто управляет разделом, заодно убирает его карточку
 * с витрины закрытых; у технаря на неё прав нет — её уберёт сверка витрины
 * в сессии управляющего.
 */
export async function deleteGrokAppAccount(
  workspaceId: string,
  id: string,
  cleanup?: { stub: boolean; requestIds: string[] }
) {
  if (!db) return;
  if (!cleanup || (!cleanup.stub && cleanup.requestIds.length === 0)) {
    await deleteDoc(paths.grokAppAccount(workspaceId, id));
    return;
  }
  const batch = writeBatch(db);
  batch.delete(paths.grokAppAccount(workspaceId, id));
  if (cleanup.stub) batch.delete(paths.grokAccessStub(workspaceId, id));
  // Запросы к удалённому аккаунту решать уже нечего — иначе они висели бы в
  // списке и в счётчике раздела, а «Открыть доступ» падало бы.
  for (const requestId of cleanup.requestIds) batch.delete(paths.grokAccessRequest(workspaceId, requestId));
  await batch.commit();
}
