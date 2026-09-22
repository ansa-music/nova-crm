import {
  collection,
  collectionGroup,
  doc,
  type CollectionReference,
  type DocumentReference,
  type Query,
  onSnapshot,
  type DocumentData,
  type FirestoreError,
} from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { toast } from "@/components/ui/sonner";

function requireDb() {
  if (!db) throw new Error("Firebase не настроен: заполните .env.local");
  return db;
}

let permissionHintShown = false;

/**
 * Firestore denies every request by default until firestore.rules is actually
 * deployed to the project (`firebase deploy --only firestore:rules`). That is
 * the single most common "why doesn't anything load" cause for a fresh clone
 * of this project, so surface it once, clearly, instead of a silent failure.
 */
function reportFirestoreError(error: FirestoreError) {
  // A single denied read (pages list, viewRequests, member doc, …) must never
  // sign the user out or send them to /login. Auth stays until they tap Выйти.
  if (error.code === "permission-denied" && !permissionHintShown) {
    permissionHintShown = true;
    toast.error("Нет доступа к части данных", {
      description:
        "Один запрос отклонён правилами Firestore. Сессия сохранена — обновите страницу или попросите доступ.",
      duration: 8000,
    });
  }
}

export function withErrorReporting(onError?: (error: FirestoreError) => void) {
  return (error: FirestoreError) => {
    reportFirestoreError(error);
    onError?.(error);
  };
}

export const paths = {
  users: () => collection(requireDb(), "users"),
  user: (uid: string) => doc(requireDb(), "users", uid),

  workspaces: () => collection(requireDb(), "workspaces"),
  workspace: (workspaceId: string) => doc(requireDb(), "workspaces", workspaceId),

  members: (workspaceId: string) =>
    collection(requireDb(), "workspaces", workspaceId, "members"),
  member: (workspaceId: string, uid: string) =>
    doc(requireDb(), "workspaces", workspaceId, "members", uid),
  memberGroup: () => collectionGroup(requireDb(), "members"),

  joinRequests: (workspaceId: string) =>
    collection(requireDb(), "workspaces", workspaceId, "joinRequests"),
  joinRequest: (workspaceId: string, uid: string) =>
    doc(requireDb(), "workspaces", workspaceId, "joinRequests", uid),

  pages: (workspaceId: string) => collection(requireDb(), "workspaces", workspaceId, "pages"),
  page: (workspaceId: string, pageId: string) =>
    doc(requireDb(), "workspaces", workspaceId, "pages", pageId),

  rows: (workspaceId: string, pageId: string) =>
    collection(requireDb(), "workspaces", workspaceId, "pages", pageId, "rows"),
  row: (workspaceId: string, pageId: string, rowId: string) =>
    doc(requireDb(), "workspaces", workspaceId, "pages", pageId, "rows", rowId),
  rowComments: (workspaceId: string, pageId: string, rowId: string) =>
    collection(requireDb(), "workspaces", workspaceId, "pages", pageId, "rows", rowId, "comments"),
  rowComment: (workspaceId: string, pageId: string, rowId: string, id: string) =>
    doc(requireDb(), "workspaces", workspaceId, "pages", pageId, "rows", rowId, "comments", id),

  subPages: (workspaceId: string, pageId: string) =>
    collection(requireDb(), "workspaces", workspaceId, "pages", pageId, "subpages"),
  subPage: (workspaceId: string, pageId: string, subPageId: string) =>
    doc(requireDb(), "workspaces", workspaceId, "pages", pageId, "subpages", subPageId),
  subPageRows: (workspaceId: string, pageId: string, subPageId: string) =>
    collection(requireDb(), "workspaces", workspaceId, "pages", pageId, "subpages", subPageId, "rows"),
  subPageRow: (workspaceId: string, pageId: string, subPageId: string, rowId: string) =>
    doc(requireDb(), "workspaces", workspaceId, "pages", pageId, "subpages", subPageId, "rows", rowId),

  dailyDispatches: (workspaceId: string) =>
    collection(requireDb(), "workspaces", workspaceId, "dailyDispatches"),
  dailyDispatch: (workspaceId: string, id: string) =>
    doc(requireDb(), "workspaces", workspaceId, "dailyDispatches", id),

  dispatchTechnicians: (workspaceId: string) =>
    collection(requireDb(), "workspaces", workspaceId, "dispatchTechnicians"),
  dispatchTechnician: (workspaceId: string, id: string) =>
    doc(requireDb(), "workspaces", workspaceId, "dispatchTechnicians", id),

  history: (workspaceId: string) => collection(requireDb(), "workspaces", workspaceId, "history"),
  historyEntry: (workspaceId: string, entryId: string) =>
    doc(requireDb(), "workspaces", workspaceId, "history", entryId),

  deskLoads: (workspaceId: string) => collection(requireDb(), "workspaces", workspaceId, "deskLoad"),
  deskLoad: (workspaceId: string, pageId: string) => doc(requireDb(), "workspaces", workspaceId, "deskLoad", pageId),

  deskLoadHistory: (workspaceId: string) => collection(requireDb(), "workspaces", workspaceId, "deskLoadHistory"),
  deskLoadHistoryDoc: (workspaceId: string, id: string) =>
    doc(requireDb(), "workspaces", workspaceId, "deskLoadHistory", id),

  osOrdersAll: (workspaceId: string) => collection(requireDb(), "workspaces", workspaceId, "osOrders"),
  osOrders: (workspaceId: string, id: string) => doc(requireDb(), "workspaces", workspaceId, "osOrders", id),

  techSchedulesAll: (workspaceId: string) => collection(requireDb(), "workspaces", workspaceId, "techSchedule"),
  techSchedule: (workspaceId: string, scheduleId: string) =>
    doc(requireDb(), "workspaces", workspaceId, "techSchedule", scheduleId),
  scheduleGroup: (workspaceId: string, groupId: string) =>
    doc(requireDb(), "workspaces", workspaceId, "scheduleGroups", groupId),
  scheduleTemplate: (workspaceId: string, templateId: string) =>
    doc(requireDb(), "workspaces", workspaceId, "scheduleTemplates", templateId),
  scheduleRequestsAll: (workspaceId: string) =>
    collection(requireDb(), "workspaces", workspaceId, "scheduleRequests"),
  scheduleRequest: (workspaceId: string, requestId: string) =>
    doc(requireDb(), "workspaces", workspaceId, "scheduleRequests", requestId),
  orderRatingsAll: (workspaceId: string) => collection(requireDb(), "workspaces", workspaceId, "orderRatings"),
  orderRating: (workspaceId: string, ratingId: string) =>
    doc(requireDb(), "workspaces", workspaceId, "orderRatings", ratingId),
  orderRatingTotalsAll: (workspaceId: string) =>
    collection(requireDb(), "workspaces", workspaceId, "orderRatingTotals"),
  orderRatingTotals: (workspaceId: string, id: string) =>
    doc(requireDb(), "workspaces", workspaceId, "orderRatingTotals", id),
  techRatings: (workspaceId: string) => collection(requireDb(), "workspaces", workspaceId, "techRatings"),
  techRating: (workspaceId: string, ratingId: string) =>
    doc(requireDb(), "workspaces", workspaceId, "techRatings", ratingId),

  leaderboard: (workspaceId: string) => collection(requireDb(), "workspaces", workspaceId, "leaderboard"),
  leaderboardEntry: (workspaceId: string, pageId: string) =>
    doc(requireDb(), "workspaces", workspaceId, "leaderboard", pageId),

  announcements: (workspaceId: string) =>
    collection(requireDb(), "workspaces", workspaceId, "announcements"),
  announcement: (workspaceId: string, id: string) =>
    doc(requireDb(), "workspaces", workspaceId, "announcements", id),

  grokAccounts: (workspaceId: string) =>
    collection(requireDb(), "workspaces", workspaceId, "grokAccounts"),
  grokAccount: (workspaceId: string, id: string) =>
    doc(requireDb(), "workspaces", workspaceId, "grokAccounts", id),

  grokAppAccounts: (workspaceId: string) =>
    collection(requireDb(), "workspaces", workspaceId, "grokAppAccounts"),
  grokAppAccount: (workspaceId: string, id: string) =>
    doc(requireDb(), "workspaces", workspaceId, "grokAppAccounts", id),
  grokSettings: (workspaceId: string, id: string) => doc(requireDb(), "workspaces", workspaceId, "grokSettings", id),

  /** «Наблюдатели» — кому Owner тихо открыл чужие столы на чтение. Читают только Owner и сам человек. */
  deskObservers: (workspaceId: string) => collection(requireDb(), "workspaces", workspaceId, "deskObservers"),
  deskObserver: (workspaceId: string, uid: string) =>
    doc(requireDb(), "workspaces", workspaceId, "deskObservers", uid),
  grokAccessStubs: (workspaceId: string) => collection(requireDb(), "workspaces", workspaceId, "grokAccessStubs"),
  grokAccessStub: (workspaceId: string, id: string) => doc(requireDb(), "workspaces", workspaceId, "grokAccessStubs", id),
  grokAccessRequests: (workspaceId: string) =>
    collection(requireDb(), "workspaces", workspaceId, "grokAccessRequests"),
  grokAccessRequest: (workspaceId: string, id: string) =>
    doc(requireDb(), "workspaces", workspaceId, "grokAccessRequests", id),

  viewRequests: (workspaceId: string) =>
    collection(requireDb(), "workspaces", workspaceId, "viewRequests"),
  viewRequest: (workspaceId: string, id: string) =>
    doc(requireDb(), "workspaces", workspaceId, "viewRequests", id),

  /** Заявки на права Owner («Ключ доступа»). id документа = uid заявителя. */
  ownerAccessRequests: (workspaceId: string) =>
    collection(requireDb(), "workspaces", workspaceId, "ownerAccessRequests"),
  ownerAccessRequest: (workspaceId: string, uid: string) =>
    doc(requireDb(), "workspaces", workspaceId, "ownerAccessRequests", uid),

  /** «Заказы» — биржа заказов между ОС и технарями. */
  orders: (workspaceId: string) => collection(requireDb(), "workspaces", workspaceId, "orders"),
  order: (workspaceId: string, id: string) => doc(requireDb(), "workspaces", workspaceId, "orders", id),

  notifications: (workspaceId: string) =>
    collection(requireDb(), "workspaces", workspaceId, "notifications"),
  notification: (workspaceId: string, id: string) =>
    doc(requireDb(), "workspaces", workspaceId, "notifications", id),

  workspaceChat: (workspaceId: string) =>
    collection(requireDb(), "workspaces", workspaceId, "workspaceChat"),
  workspaceChatMessage: (workspaceId: string, id: string) =>
    doc(requireDb(), "workspaces", workspaceId, "workspaceChat", id),

  privateChatMessages: (workspaceId: string, chatId: string) =>
    collection(requireDb(), "workspaces", workspaceId, "privateChats", chatId, "messages"),
  privateChatMessage: (workspaceId: string, chatId: string, id: string) =>
    doc(requireDb(), "workspaces", workspaceId, "privateChats", chatId, "messages", id),
  privateChats: (workspaceId: string) =>
    collection(requireDb(), "workspaces", workspaceId, "privateChats"),
  privateChatMeta: (workspaceId: string, chatId: string) =>
    doc(requireDb(), "workspaces", workspaceId, "privateChats", chatId),

  readMarkers: (workspaceId: string) =>
    collection(requireDb(), "workspaces", workspaceId, "readMarkers"),
  readMarker: (workspaceId: string, id: string) =>
    doc(requireDb(), "workspaces", workspaceId, "readMarkers", id),

  pageChat: (workspaceId: string, pageId: string) =>
    collection(requireDb(), "workspaces", workspaceId, "pages", pageId, "chat"),
  pageChatMessage: (workspaceId: string, pageId: string, id: string) =>
    doc(requireDb(), "workspaces", workspaceId, "pages", pageId, "chat", id),

  managerPageClaim: (workspaceId: string, uid: string) =>
    doc(requireDb(), "workspaces", workspaceId, "managerPageClaims", uid),

  personalZone: (workspaceId: string, pageId: string, uid: string) =>
    doc(requireDb(), "workspaces", workspaceId, "pages", pageId, "personalZones", uid),
  personalReports: (workspaceId: string, pageId: string, uid: string) =>
    collection(requireDb(), "workspaces", workspaceId, "pages", pageId, "personalZones", uid, "reports"),
  personalReport: (workspaceId: string, pageId: string, uid: string, reportId: string) =>
    doc(requireDb(), "workspaces", workspaceId, "pages", pageId, "personalZones", uid, "reports", reportId),
  personalReportRows: (workspaceId: string, pageId: string, uid: string, reportId: string) =>
    collection(requireDb(), "workspaces", workspaceId, "pages", pageId, "personalZones", uid, "reports", reportId, "rows"),
  personalReportRow: (workspaceId: string, pageId: string, uid: string, reportId: string, rowId: string) =>
    doc(requireDb(), "workspaces", workspaceId, "pages", pageId, "personalZones", uid, "reports", reportId, "rows", rowId),
  personalFinance: (workspaceId: string, pageId: string, uid: string) =>
    collection(requireDb(), "workspaces", workspaceId, "pages", pageId, "personalZones", uid, "finance"),
  personalFinanceEntry: (workspaceId: string, pageId: string, uid: string, entryId: string) =>
    doc(requireDb(), "workspaces", workspaceId, "pages", pageId, "personalZones", uid, "finance", entryId),
  personalNotes: (workspaceId: string, pageId: string, uid: string) =>
    collection(requireDb(), "workspaces", workspaceId, "pages", pageId, "personalZones", uid, "notes"),
  personalNote: (workspaceId: string, pageId: string, uid: string, noteId: string) =>
    doc(requireDb(), "workspaces", workspaceId, "pages", pageId, "personalZones", uid, "notes", noteId),

  personalDebts: (workspaceId: string, pageId: string, uid: string) =>
    collection(requireDb(), "workspaces", workspaceId, "pages", pageId, "personalZones", uid, "debts"),
  personalDebt: (workspaceId: string, pageId: string, uid: string, debtId: string) =>
    doc(requireDb(), "workspaces", workspaceId, "pages", pageId, "personalZones", uid, "debts", debtId),
};

/** Generic helper to subscribe to any query/collection with typed converter output. */
export function subscribe<T>(
  ref: Query<DocumentData> | CollectionReference<DocumentData>,
  onData: (items: T[]) => void,
  onError?: (error: FirestoreError) => void
) {
  return onSnapshot(
    ref,
    (snapshot) => {
      const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
      onData(items);
    },
    withErrorReporting(onError)
  );
}

/**
 * Как `subscribe`, но ещё говорит, пришёл ли снимок С СЕРВЕРА.
 *
 * С LRU-кэшем в памяти (firebase.ts) повторная подписка сначала отдаёт то,
 * что лежало в кэше с прошлого раза, — сколько угодно старое. Рисовать это
 * можно, а решать по нему (публиковать счётчики стола, класть заказ в стол)
 * нельзя. `includeMetadataChanges` нужен, чтобы переход «кэш → сервер»
 * пришёл отдельным событием, даже если ни один документ не поменялся;
 * прочие события «поменялась только служебная метка» (запись подтвердилась)
 * отбрасываем — без этой опции их не было бы вовсе.
 */
export function subscribeWithSource<T>(
  ref: Query<DocumentData> | CollectionReference<DocumentData>,
  onData: (items: T[], fromServer: boolean) => void,
  onError?: (error: FirestoreError) => void
) {
  let delivered = false;
  let lastFromServer = false;
  return onSnapshot(
    ref,
    { includeMetadataChanges: true },
    (snapshot) => {
      const fromServer = !snapshot.metadata.fromCache;
      if (delivered && fromServer === lastFromServer && snapshot.docChanges().length === 0) return;
      delivered = true;
      lastFromServer = fromServer;
      const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
      onData(items, fromServer);
    },
    withErrorReporting(onError)
  );
}

export function subscribeToDoc<T>(
  ref: DocumentReference<DocumentData>,
  onData: (item: T | null) => void,
  onError?: (error: FirestoreError) => void
) {
  return onSnapshot(
    ref,
    (snapshot) => {
      onData(snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as T) : null);
    },
    withErrorReporting(onError)
  );
}
