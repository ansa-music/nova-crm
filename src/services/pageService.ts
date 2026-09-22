import {
  deleteDoc,
  deleteField,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  where,
  writeBatch,
  type FirestoreError,
  type Query,
} from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths, subscribe, withErrorReporting } from "@/firebase/firestore";
import { generateId } from "@/utils/id";
import { hasRowExtras } from "@/utils/rowExtras";
import { logChange } from "@/services/historyService";
import type { PageColumn, PageIconName, PageRow, Role, StatusOption, WorkspacePage } from "@/types";
import {
  mirrorDeleteRow,
  mirrorDeleteRowsForPage,
  mirrorPatchRowCells,
  mirrorPatchRowCellsBulk,
  mirrorReorderRows,
  mirrorUpsertRow,
} from "@/services/rowRecordsService";

// ---------------------------------------------------------------------------
// Убирает поля со значением undefined перед записью в Firestore
// (Firestore не разрешает undefined, даже во вложенных объектах/массивах —
// например statusOptions у текстовых/телефонных/датных колонок)
// ---------------------------------------------------------------------------
export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as unknown as T;
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (val !== undefined) result[key] = stripUndefined(val);
    }
    return result as T;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/**
 * Pages list. Do not orderBy("order") — that drops docs missing the field
 * and then looks like «Страница недоступна» for the person whose desk it is.
 *
 * Owner: unfiltered collection query only (isOwner does not depend on
 * resource.data, so the live list is allowed).
 *
 * Other members: try the same unfiltered list first so every member gets
 * desk covers (live rules `allow read: if isMember` on pages). If that is
 * permission-denied / failed-precondition (older canAccessPage list rules),
 * silently fall back to two scoped queries and merge by page id:
 *   1) where("responsibleUserId","==",uid) — own desk even if not in allowedUsers
 *   2) where("allowedUsers","array-contains",uid) — shared desks
 * Never keep unfiltered AND the fallbacks attached. Do not toast if the
 * fallback produces a list. Toast only if both scoped queries fail.
 */
export function subscribeToPages(
  workspaceId: string,
  onData: (pages: WorkspacePage[]) => void,
  onError?: (error: FirestoreError) => void,
  currentUserUid?: string,
  isOwnerOfWorkspace?: boolean
) {
  let cancelled = false;
  let emittedOnce = false;
  let pendingEmptyCacheTimer: ReturnType<typeof setTimeout> | null = null;
  const report = withErrorReporting(onError);
  const unsubscribers: Array<() => void> = [];

  const emit = (pages: WorkspacePage[]) => {
    if (cancelled) return;
    emittedOnce = true;
    onData([...pages].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
  };

  const handleSnapPages = (fromCache: boolean, pages: WorkspacePage[]) => {
    if (cancelled) return;
    if (pendingEmptyCacheTimer) {
      clearTimeout(pendingEmptyCacheTimer);
      pendingEmptyCacheTimer = null;
    }
    // Fresh navigation can surface a stale empty cache before the server
    // snapshot. Do not flash "Access denied"/empty Home in that window.
    if (fromCache && pages.length === 0 && !emittedOnce) {
      pendingEmptyCacheTimer = setTimeout(() => {
        if (!cancelled) emit([]);
      }, 1200);
      return;
    }
    emit(pages);
  };

  const clearListeners = () => {
    unsubscribers.splice(0).forEach((u) => u());
  };

  const attachUnfiltered = (onListDenied?: (error: FirestoreError) => void) => {
    unsubscribers.push(
      onSnapshot(
        query(paths.pages(workspaceId)),
        (snapshot) => {
          const pages = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as WorkspacePage);
          handleSnapPages(snapshot.metadata.fromCache, pages);
        },
        (error) => {
          if (cancelled) return;
          if (
            onListDenied &&
            (error.code === "permission-denied" || error.code === "failed-precondition")
          ) {
            onListDenied(error);
            return;
          }
          report(error);
        }
      )
    );
  };

  const attachScopedFallbacks = (uid: string) => {
    const responsibleById = new Map<string, WorkspacePage>();
    const allowedById = new Map<string, WorkspacePage>();
    let responsibleFailed = false;
    let allowedFailed = false;

    const mergedPages = () => {
      const merged = new Map<string, WorkspacePage>();
      for (const [id, page] of responsibleById) merged.set(id, page);
      for (const [id, page] of allowedById) merged.set(id, page);
      return Array.from(merged.values());
    };

    const attachScoped = (
      q: Query,
      bucket: Map<string, WorkspacePage>,
      markFailed: () => void,
      otherFailed: () => boolean
    ) => {
      unsubscribers.push(
        onSnapshot(
          q,
          (snapshot) => {
            if (cancelled) return;
            bucket.clear();
            for (const d of snapshot.docs) {
              bucket.set(d.id, { id: d.id, ...d.data() } as WorkspacePage);
            }
            handleSnapPages(snapshot.metadata.fromCache, mergedPages());
          },
          (error) => {
            if (cancelled) return;
            if (error.code === "permission-denied" || error.code === "failed-precondition") {
              markFailed();
              // Skip this query. Toast only if the other also failed.
              if (otherFailed()) report(error);
              else handleSnapPages(false, mergedPages());
              return;
            }
            report(error);
          }
        )
      );
    };

    attachScoped(
      query(paths.pages(workspaceId), where("responsibleUserId", "==", uid)),
      responsibleById,
      () => {
        responsibleFailed = true;
      },
      () => allowedFailed
    );
    attachScoped(
      query(paths.pages(workspaceId), where("allowedUsers", "array-contains", uid)),
      allowedById,
      () => {
        allowedFailed = true;
      },
      () => responsibleFailed
    );
  };

  if (isOwnerOfWorkspace) {
    attachUnfiltered();
  } else if (currentUserUid) {
    attachUnfiltered(() => {
      // Unfiltered list denied — drop it and keep only the two scoped queries.
      clearListeners();
      attachScopedFallbacks(currentUserUid);
    });
  }

  return () => {
    cancelled = true;
    if (pendingEmptyCacheTimer) clearTimeout(pendingEmptyCacheTimer);
    unsubscribers.forEach((u) => u());
  };
}

/**
 * One-shot page get for a direct desk URL when the list store is still empty.
 * `seesAllDesks` — Тимлид + Технарь: чужой стол открывается по ссылке без
 * запроса просмотра, как и в правилах (`isTeamLeadTech`).
 */
export async function fetchPageIfAccessible(
  workspaceId: string,
  pageId: string,
  uid: string,
  seesAllDesks = false
): Promise<WorkspacePage | null> {
  const snap = await getDoc(paths.page(workspaceId, pageId));
  if (!snap.exists()) return null;
  const page = { id: snap.id, ...snap.data() } as WorkspacePage;
  if (seesAllDesks) return page;
  if (page.responsibleUserId === uid || (page.allowedUsers ?? []).includes(uid)) return page;
  return null;
}

export interface CreatePageInput {
  workspaceId: string;
  name: string;
  icon: PageIconName;
  color: string;
  columns: Omit<PageColumn, "id">[];
  /** Uids of members (besides the Owner, who always has access) allowed to see this page. */
  allowedUsers: string[];
  createdBy: string;
  order: number;
  responsibleUserId?: string | null;
  editableUsers?: string[];
  visibility?: "public" | "private";
}

export async function createPage(input: CreatePageInput): Promise<WorkspacePage> {
  if (!db) throw new Error("Firebase не настроен");
  const id = generateId("page");
  const allowedUsers = Array.from(new Set([...input.allowedUsers, input.createdBy]));
  const page: WorkspacePage = {
    id,
    workspaceId: input.workspaceId,
    name: input.name,
    icon: input.icon,
    color: input.color,
    order: input.order,
    allowedUsers,
    // The creator becomes this page's responsible person by default — matters
    // most for a Manager/Admin, who has no blanket workspace access otherwise
    // and would be unable to see the page they themselves just made. Callers
    // (e.g. Owner-created pages) may explicitly pass null to opt out.
    responsibleUserId: input.responsibleUserId !== undefined ? input.responsibleUserId : input.createdBy,
    editableUsers: input.editableUsers ?? [],
    visibility: input.visibility ?? "public",
    columns: input.columns.map((c, i) => stripUndefined({ ...c, id: generateId("col"), order: i })),
    hideMainTab: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdBy: input.createdBy,
  };
  await setDoc(paths.page(input.workspaceId, id), stripUndefined(page));
  return seedCurrentMonthDesk(page);
}

/**
 * After the page doc exists: month tab, then default. Never part of the
 * manager claim batch.
 *
 * MUST NOT reject. Both callers reach this line with the page doc already
 * committed — and for a Manager, with the one-shot managerPageClaims/{uid}
 * doc committed alongside it in the same batch. Letting a failure here
 * propagate made desk creation self-locking for a Технарь: the dialog toasted
 * «Не удалось создать страницу» while the page and its quota claim were
 * already durable, so every retry from then on hit «Достигнут лимит страниц»
 * and the account could never create its desk again. The desk is also left
 * with hideMainTab and no month tab, i.e. no visible tab at all — so on
 * failure clear hideMainTab and hand back a desk that opens on «Основная».
 */
export async function seedCurrentMonthDesk(page: WorkspacePage): Promise<WorkspacePage> {
  const { createSubPage, monthTabNameForKey } = await import("@/services/subPageService");
  const { currentMonthKey, markMonthTab, monthTabId } = await import("@/services/monthTabService");
  try {
    // Same id/monthKey the month autopilot uses, so it recognizes this tab
    // as the month's instead of adding a second one.
    const monthKey = currentMonthKey();
    const sub = await createSubPage({
      workspaceId: page.workspaceId,
      pageId: page.id,
      id: monthTabId(monthKey),
      monthKey,
      name: monthTabNameForKey(monthKey),
      color: page.color,
      icon: page.icon,
      columns: page.columns,
      order: 0,
      createdBy: page.createdBy,
    });
    await markMonthTab(page.workspaceId, page.id, sub.id, monthKey);
    return { ...page, defaultSubPageId: sub.id, autoMonthKey: monthKey, autoMonthSubPageId: sub.id, hideMainTab: true };
  } catch (error) {
    console.error(`seedCurrentMonthDesk failed for page ${page.id}; falling back to the main tab:`, error);
    // Best-effort repair only — the desk is usable either way, and the
    // creation itself must still be reported as the success it was.
    try {
      if (db) {
        await setDoc(
          paths.page(page.workspaceId, page.id),
          { hideMainTab: false, updatedAt: Date.now() },
          { merge: true }
        );
      }
    } catch (repairError) {
      console.error(`Could not clear hideMainTab on page ${page.id}:`, repairError);
    }
    return { ...page, hideMainTab: false };
  }
}

/**
 * Creates a page appropriate for the caller's role. A plain Manager (without
 * elevated create permission) is routed through the atomic one-page quota;
 * everyone else (Owner, Admin, or a Manager who's been granted elevated
 * permission) goes through the normal unlimited createPage.
 */
export async function createPageForCurrentRole(
  input: CreatePageInput & {
    role: Role;
    uid: string;
    hasElevatedCreatePermission?: boolean;
  }
): Promise<WorkspacePage> {
  if (input.role === "viewer") throw new Error("Viewer не может создавать страницы");
  if (input.role === "os") throw new Error("У ОС нет своего стола");
  if (input.role === "manager" && !input.hasElevatedCreatePermission) {
    const { createManagerOwnedPage } = await import("@/services/managerPageQuota");
    return createManagerOwnedPage({
      workspaceId: input.workspaceId,
      name: input.name,
      icon: input.icon,
      color: input.color,
      columns: input.columns,
      managerUid: input.uid,
      order: input.order,
    });
  }
  // firestore.rules' create rule requires an Admin's own page create to
  // set responsibleUserId to themselves and include themselves in
  // allowedUsers — same contract as Manager, just without the one-page
  // quota. Only a real Owner create should end up with responsibleUserId
  // null (an Owner has blanket workspace access regardless).
  const selfAssign = input.role === "manager" || input.role === "admin";
  return createPage({
    ...input,
    responsibleUserId: input.responsibleUserId ?? (selfAssign ? input.uid : null),
    allowedUsers: Array.from(new Set([...input.allowedUsers, ...(selfAssign ? [input.uid] : [])])),
  });
}

export async function renamePage(workspaceId: string, pageId: string, name: string) {
  if (!db) return;
  await setDoc(paths.page(workspaceId, pageId), { name, updatedAt: Date.now() }, { merge: true });
}

/** Sets which tab (a subpage id, or null for "Основная") opens by default whenever anyone navigates to this page. */
export async function setDefaultSubPage(workspaceId: string, pageId: string, subPageId: string | null) {
  if (!db) return;
  await setDoc(
    paths.page(workspaceId, pageId),
    { defaultSubPageId: (subPageId ?? deleteField()) as string, updatedAt: Date.now() },
    { merge: true }
  );
}

/** Owner opts a non-Технарь desk (e.g. their own) into month tabs and «Технари» — see monthTabService.isMonthlyDesk. */
export async function setPageTechnicianDesk(workspaceId: string, pageId: string, technicianDesk: boolean) {
  if (!db) return;
  await setDoc(
    paths.page(workspaceId, pageId),
    { technicianDesk: (technicianDesk ? true : deleteField()) as boolean, updatedAt: Date.now() },
    { merge: true }
  );
}

/** Personal monthly revenue target — purely a motivational number for the page's own responsible person. */
export async function setPageMonthlyGoal(workspaceId: string, pageId: string, goal: number | null) {
  if (!db) return;
  await setDoc(
    paths.page(workspaceId, pageId),
    { monthlyGoal: (goal ?? deleteField()) as number, updatedAt: Date.now() },
    { merge: true }
  );
}

/** Per-page accent override, scoped only to this page's own view — see WorkspacePage.accentColor. */
export async function setPageAccentColor(workspaceId: string, pageId: string, color: string | null) {
  if (!db) return;
  await setDoc(
    paths.page(workspaceId, pageId),
    { accentColor: (color ?? deleteField()) as string, updatedAt: Date.now() },
    { merge: true }
  );
}

/** Desk cover on the dashboard. Merge-only; never deletes the page document. Pass null to clear fields. */
export async function setPageCover(
  workspaceId: string,
  pageId: string,
  cover: { coverUrl: string; coverPath: string } | null
) {
  if (!db) return;
  if (cover) {
    await setDoc(
      paths.page(workspaceId, pageId),
      { coverUrl: cover.coverUrl, coverPath: cover.coverPath, updatedAt: Date.now() },
      { merge: true }
    );
    return;
  }
  await setDoc(
    paths.page(workspaceId, pageId),
    { coverUrl: deleteField(), coverPath: deleteField(), updatedAt: Date.now() },
    { merge: true }
  );
}

export async function updatePageAppearance(
  workspaceId: string,
  pageId: string,
  patch: { icon?: PageIconName; color?: string }
) {
  if (!db) return;
  await setDoc(paths.page(workspaceId, pageId), { ...patch, updatedAt: Date.now() }, { merge: true });
}

export async function updatePagePermissions(workspaceId: string, pageId: string, allowedUsers: string[]) {
  if (!db) return;
  await setDoc(paths.page(workspaceId, pageId), { allowedUsers, updatedAt: Date.now() }, { merge: true });
}

/**
 * Все поля доступа стола одним merge — их правят вместе в «Доступ к столу».
 * Раздельные записи allowedUsers / editableUsers / hiddenByResponsible давали
 * промежуточные состояния (просмотр уже снят, правка ещё есть) и три
 * срабатывания подписки вместо одного.
 */
export async function updatePageAccess(
  workspaceId: string,
  pageId: string,
  patch: { allowedUsers: string[]; editableUsers: string[]; hiddenByResponsible?: boolean }
) {
  if (!db) return;
  await setDoc(paths.page(workspaceId, pageId), { ...patch, updatedAt: Date.now() }, { merge: true });
}

/** Owner/responsible: grant or revoke EDIT rights for someone who already has view access. */
export async function updatePageEditableUsers(workspaceId: string, pageId: string, editableUsers: string[]) {
  if (!db) return;
  await setDoc(paths.page(workspaceId, pageId), { editableUsers, updatedAt: Date.now() }, { merge: true });
}

/** Owner-only: assign (or clear) who's responsible for this page. */
export async function setPageResponsible(
  workspaceId: string,
  pageId: string,
  responsibleUserId: string | null,
  currentAllowedUsers: string[]
) {
  if (!db) return;
  const allowedUsers = responsibleUserId
    ? Array.from(new Set([...currentAllowedUsers, responsibleUserId]))
    : currentAllowedUsers;
  await setDoc(
    paths.page(workspaceId, pageId),
    { responsibleUserId, hiddenByResponsible: false, allowedUsers, updatedAt: Date.now() },
    { merge: true }
  );
}

/** Only the assigned responsible person may call this — hides/shows the page for everyone else in allowedUsers. */
/**
 * "Показать" grants VIEW access (not edit) to every active member at once —
 * "Скрыть" removes everyone's access again (Owner and the responsible
 * person always see it regardless). Implemented purely via `allowedUsers`
 * (the same mechanism already used for individual grants) rather than a
 * separate visibility field, so it never risks the Firestore list-query
 * safety issue a per-doc "visibility" field would reintroduce for the
 * pages list query.
 */
export async function togglePageVisibility(
  workspaceId: string,
  pageId: string,
  show: boolean,
  allActiveMemberUids: string[],
  responsibleUserId?: string | null
) {
  if (!db) return;
  const keep = [responsibleUserId].filter((id): id is string => Boolean(id));
  const allowedUsers = show
    ? Array.from(new Set([...allActiveMemberUids, ...keep]))
    : keep;
  await setDoc(
    paths.page(workspaceId, pageId),
    { allowedUsers, hiddenByResponsible: !show, updatedAt: Date.now() },
    { merge: true }
  );
}

/**
 * Owner/Тимлид: move a desk to «Неактуальные» or bring it back — nothing is
 * deleted. Retiring a Технарь's desk also frees their one-desk claim when it
 * points at this desk, so they can start a new one; bringing it back
 * re-claims it only while the claim is free.
 */
export async function setPageInactive(
  workspaceId: string,
  page: WorkspacePage,
  inactive: boolean,
  byUid: string,
  responsibleIsTechnician: boolean
) {
  if (!db) return;
  const now = Date.now();
  const batch = writeBatch(db);
  batch.update(paths.page(workspaceId, page.id), {
    inactive,
    inactiveAt: inactive ? now : null,
    inactiveBy: inactive ? byUid : null,
    updatedAt: now,
  });
  const claimUid = page.responsibleUserId;
  if (claimUid && responsibleIsTechnician) {
    try {
      const claim = await getDoc(paths.managerPageClaim(workspaceId, claimUid));
      if (inactive && claim.exists() && claim.data()?.pageId === page.id) batch.delete(claim.ref);
      if (!inactive && !claim.exists()) batch.set(claim.ref, { uid: claimUid, pageId: page.id, createdAt: now });
    } catch {
      /* the claim is upkeep; the desk still moves */
    }
  }
  await batch.commit();
}

/**
 * Instantly grants or revokes one member's access to one page — used by the
 * Workspace → Users checkbox grid, where every toggle applies immediately.
 */
export async function toggleUserPageAccess(
  workspaceId: string,
  page: WorkspacePage,
  uid: string,
  grant: boolean
) {
  const current = page.allowedUsers ?? [];
  if (!grant && page.responsibleUserId === uid) return;
  const next = grant
    ? Array.from(new Set([...current, uid, ...(page.responsibleUserId ? [page.responsibleUserId] : [])]))
    : current.filter((id) => id !== uid);
  await updatePagePermissions(workspaceId, page.id, next);
}

export async function updatePageColumns(workspaceId: string, pageId: string, columns: PageColumn[]) {
  if (!db) return;
  await setDoc(paths.page(workspaceId, pageId), { columns: stripUndefined(columns), updatedAt: Date.now() }, { merge: true });
}

/** Airtable-style: append a brand new column to a page. Owner/Admin only (enforced by caller via permissions). */
/**
 * Guarantees a page has a "Цена" (currency) column, inserting one just
 * before a "Примечание"/note-like column if present, otherwise appending it
 * at the end. Used to retrofit the Price column onto pages/workspaces that
 * were created before it became a standard column. No-ops if a currency
 * column already exists.
 */
export async function ensurePriceColumn(
  workspaceId: string,
  pageId: string,
  existingColumns: PageColumn[]
): Promise<PageColumn[]> {
  if (existingColumns.some((c) => c.type === "currency")) return existingColumns;
  const noteIndex = existingColumns.findIndex(
    (c) => c.key === "note" || c.label.toLowerCase().includes("примечан")
  );
  const priceColumn: PageColumn = {
    id: generateId("col"),
    key: "price",
    label: "Цена",
    type: "currency",
    width: 140,
    order: 0,
  };
  const withoutOrder = noteIndex === -1 ? [...existingColumns, priceColumn] : [
    ...existingColumns.slice(0, noteIndex),
    priceColumn,
    ...existingColumns.slice(noteIndex),
  ];
  const columns = withoutOrder.map((c, i) => ({ ...c, order: i }));
  await updatePageColumns(workspaceId, pageId, columns);
  return columns;
}

/**
 * Guarantees a page has a "Диск" (url) column for Drive/Yandex (and any
 * http(s)) links. Inserts before a note-like column when present. No-ops
 * if a url column already exists. Never touches row cells or attachments.
 */
export async function ensureDiskColumn(
  workspaceId: string,
  pageId: string,
  existingColumns: PageColumn[]
): Promise<PageColumn[]> {
  if (existingColumns.some((c) => c.type === "url")) return existingColumns;
  const existingKeys = new Set(existingColumns.map((c) => c.key));
  const key = existingKeys.has("disk") ? "disk_url" : "disk";
  const noteIndex = existingColumns.findIndex(
    (c) => c.key === "note" || c.label.toLowerCase().includes("примечан")
  );
  const diskColumn: PageColumn = {
    id: generateId("col"),
    key,
    label: "Диск",
    type: "url",
    width: 132,
    order: 0,
  };
  const withoutOrder = noteIndex === -1 ? [...existingColumns, diskColumn] : [
    ...existingColumns.slice(0, noteIndex),
    diskColumn,
    ...existingColumns.slice(noteIndex),
  ];
  const columns = withoutOrder.map((c, i) => ({ ...c, order: i }));
  await updatePageColumns(workspaceId, pageId, columns);
  return columns;
}

export async function addColumn(
  workspaceId: string,
  pageId: string,
  existingColumns: PageColumn[],
  input: { key: string; label: string; type: PageColumn["type"]; statusOptions?: StatusOption[]; customFieldId?: string }
): Promise<PageColumn> {
  if (!db) throw new Error("Firebase не настроен");
  const newColumn: PageColumn = {
    id: generateId("col"),
    key: input.key,
    label: input.label,
    type: input.type,
    width: input.type === "url" ? 132 : 160,
    order: existingColumns.length,
    statusOptions: input.statusOptions,
    customFieldId: input.customFieldId,
  };
  const columns = [...existingColumns, stripUndefined(newColumn)];
  await updatePageColumns(workspaceId, pageId, columns);
  return newColumn;
}

/** Duplicate an existing column definition (data is not copied, only the column shape). */
export async function duplicateColumn(
  workspaceId: string,
  pageId: string,
  existingColumns: PageColumn[],
  columnKey: string
): Promise<PageColumn> {
  const source = existingColumns.find((c) => c.key === columnKey);
  if (!source) throw new Error("Столбец не найден");
  const copy: PageColumn = {
    ...source,
    id: generateId("col"),
    key: generateId("col"),
    label: `${source.label} (копия)`,
    order: existingColumns.length,
  };
  const columns = [...existingColumns, stripUndefined(copy)];
  await updatePageColumns(workspaceId, pageId, columns);
  return copy;
}

/** Remove a column definition entirely (row data for that key is left in place but no longer shown). */
export async function deleteColumn(workspaceId: string, pageId: string, existingColumns: PageColumn[], columnKey: string) {
  const columns = existingColumns.filter((c) => c.key !== columnKey).map((c, i) => ({ ...c, order: i }));
  await updatePageColumns(workspaceId, pageId, columns);
}

/** Rename a column's display label. */
export async function renameColumn(workspaceId: string, pageId: string, existingColumns: PageColumn[], columnKey: string, newLabel: string) {
  const columns = existingColumns.map((c) => (c.key === columnKey ? { ...c, label: newLabel } : c));
  await updatePageColumns(workspaceId, pageId, columns);
}

/** Change a column's type (e.g. text -> currency). Existing cell values are left as-is. */
export async function changeColumnType(
  workspaceId: string,
  pageId: string,
  existingColumns: PageColumn[],
  columnKey: string,
  newType: PageColumn["type"],
  statusOptions?: StatusOption[],
  customFieldId?: string
) {
  // Preserve the column's existing statusOptions when the caller doesn't
  // pass a new list, instead of dropping the field entirely. A legacy
  // "status"-type column can still carry a stale non-empty statusOptions
  // value from before status became fully workspace-wide (see
  // src/types/page.ts) — dropping it here changes the diff Firestore
  // rules' columnStatusOptionsPreserved() sees for that column key from
  // "unchanged" to "removed", which fails the check and silently rejects
  // the whole column-type change for any non-Owner responsible person
  // (Owner is unaffected, they bypass that check).
  const columns = existingColumns.map((c) =>
    c.key === columnKey
      ? stripUndefined({ ...c, type: newType, statusOptions: statusOptions ?? c.statusOptions, customFieldId })
      : c
  );
  await updatePageColumns(workspaceId, pageId, columns);
}

/**
 * Updates just a "status" column's own option list (add/rename/recolor/
 * remove values) without touching its type. Owner-only: UI hides this from
 * Технарь/manager/viewer, and Firestore rejects non-owner statusOptions diffs
 * on existing columns (columnStatusOptionsPreserved).
 */
export async function updateColumnStatusOptions(
  workspaceId: string,
  pageId: string,
  existingColumns: PageColumn[],
  columnKey: string,
  statusOptions: StatusOption[]
) {
  const columns = existingColumns.map((c) => (c.key === columnKey ? { ...c, statusOptions } : c));
  await updatePageColumns(workspaceId, pageId, columns);
}

export async function reorderPages(workspaceId: string, orderedIds: string[]) {
  if (!db) return;
  const batch = writeBatch(db);
  orderedIds.forEach((id, index) => {
    batch.set(paths.page(workspaceId, id), { order: index }, { merge: true });
  });
  await batch.commit();
}

export async function deletePage(workspaceId: string, pageId: string) {
  if (!db) return;
  const database = db;
  const [rowsSnapshot, historySnapshot] = await Promise.all([
    getDocs(paths.rows(workspaceId, pageId)),
    getDocs(query(paths.history(workspaceId), where("pageId", "==", pageId))),
  ]);

  // Firestore batches cap out at 500 writes; chunk defensively for pages
  // with a lot of rows/history so deletion never silently fails partway.
  let claimUid: string | null = null;
  try {
    const pageSnap = await getDoc(paths.page(workspaceId, pageId));
    const createdBy = pageSnap.data()?.createdBy;
    if (typeof createdBy === "string" && createdBy) claimUid = createdBy;
  } catch {
    /* still delete the page */
  }
  const refsToDelete = [
    ...rowsSnapshot.docs.map((d) => d.ref),
    ...historySnapshot.docs.map((d) => d.ref),
    paths.page(workspaceId, pageId),
    ...(claimUid ? [paths.managerPageClaim(workspaceId, claimUid)] : []),
  ];
  const CHUNK_SIZE = 450;
  for (let i = 0; i < refsToDelete.length; i += CHUNK_SIZE) {
    const batch = writeBatch(database);
    refsToDelete.slice(i, i + CHUNK_SIZE).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
  // User deleted the page: drop matching row_records copies only.
  mirrorDeleteRowsForPage(pageId);
}

export async function duplicatePage(workspaceId: string, page: WorkspacePage, newOrder: number) {
  if (!db) throw new Error("Firebase не настроен");
  const newId = generateId("page");
  const duplicated: WorkspacePage = {
    ...page,
    id: newId,
    name: `${page.name} (копия)`,
    order: newOrder,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const batch = writeBatch(db);
  batch.set(paths.page(workspaceId, newId), duplicated);
  const rowsSnapshot = await getDocs(paths.rows(workspaceId, page.id));
  const newRows: PageRow[] = [];
  rowsSnapshot.docs.forEach((d) => {
    const rowId = generateId("row");
    const row = { ...(d.data() as PageRow), id: rowId, pageId: newId };
    batch.set(paths.row(workspaceId, newId, rowId), row);
    newRows.push(row);
  });
  await batch.commit();
  // Mirror after the batch commits, same as every other row-creating write —
  // best-effort, never blocks/throws (see mirrorUpsertRow).
  newRows.forEach((row) => mirrorUpsertRow(workspaceId, newId, null, row));
  return duplicated;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export function subscribeToRows(
  workspaceId: string,
  pageId: string,
  onData: (rows: PageRow[]) => void
) {
  const q = query(paths.rows(workspaceId, pageId), orderBy("order", "asc"));
  return subscribe<PageRow>(q, onData);
}

/** One-shot row read for dashboards — no live listener. */
export async function fetchRows(workspaceId: string, pageId: string): Promise<PageRow[]> {
  const snap = await getDocs(query(paths.rows(workspaceId, pageId), orderBy("order", "asc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as PageRow);
}

export async function addRow(
  workspaceId: string,
  pageId: string,
  cells: Record<string, string | number | null>,
  order: number,
  extras?: PageRow["extras"],
  /** Подсветить строку как новую — см. PageRow.highlight. */
  highlight?: boolean,
  /**
   * Явный id вместо случайного. Нужен, когда запись обязана быть
   * идемпотентной: два окна одного человека (или повтор после сбоя) должны
   * положить ОДНУ строку, а не по строке на попытку.
   */
  explicitId?: string,
  /** Заказ с «Заказов», из которого выросла строка — постоянная метка. */
  orderId?: string
) {
  if (!db) throw new Error("Firebase не настроен");
  const id = explicitId ?? generateId("row");
  const row: PageRow = { id, pageId, cells, order, createdAt: Date.now(), updatedAt: Date.now() };
  if (hasRowExtras(extras)) row.extras = extras;
  if (highlight) row.highlight = true;
  if (orderId) row.orderId = orderId;
  await setDoc(paths.row(workspaceId, pageId, id), row);
  mirrorUpsertRow(workspaceId, pageId, null, row);
  return row;
}

interface UpdateCellContext {
  workspaceId: string;
  pageId: string;
  pageName: string;
  rowId: string;
  field: string;
  fieldLabel: string;
  oldValue: string | number | null;
  newValue: string | number | null;
  userId: string;
  userName: string;
  action?: "update" | "restore";
  /** Пустую строку заполнили впервые — см. PageRow.filledAt. */
  filledAt?: number;
}

export async function updateRowCell(ctx: UpdateCellContext) {
  if (!db) return;
  await setDoc(
    paths.row(ctx.workspaceId, ctx.pageId, ctx.rowId),
    { cells: { [ctx.field]: ctx.newValue }, updatedAt: Date.now(), ...(ctx.filledAt ? { filledAt: ctx.filledAt } : {}) },
    { merge: true }
  );
  mirrorPatchRowCells(ctx.rowId, ctx.field, ctx.newValue);
  if (ctx.oldValue !== ctx.newValue) {
    await logChange({
      workspaceId: ctx.workspaceId,
      pageId: ctx.pageId,
      pageName: ctx.pageName,
      rowId: ctx.rowId,
      field: ctx.field,
      fieldLabel: ctx.fieldLabel,
      oldValue: ctx.oldValue,
      newValue: ctx.newValue,
      action: ctx.action ?? "update",
      userId: ctx.userId,
      userName: ctx.userName,
    });
  }
}

/** `extras`: undefined leaves them alone, null removes them. */
export async function updateRowCellsBulk(
  workspaceId: string,
  pageId: string,
  rowId: string,
  patch: Record<string, string | number | null>,
  extras?: PageRow["extras"] | null,
  /** Подсветить строку как новую — см. PageRow.highlight. */
  highlight?: boolean,
  /** Пустую строку заполнили впервые — см. PageRow.filledAt. */
  filledAt?: number
) {
  if (!db) return;
  await setDoc(
    paths.row(workspaceId, pageId, rowId),
    {
      cells: patch,
      updatedAt: Date.now(),
      ...(extras === undefined ? {} : { extras: extras ?? deleteField() }),
      ...(highlight ? { highlight: true } : {}),
      ...(filledAt ? { filledAt } : {}),
    },
    { merge: true }
  );
  mirrorPatchRowCellsBulk(rowId, patch);
}

/**
 * Снять подсветку «новая строка» — разом у нескольких строк текущей вкладки.
 * Один batch: подсветка снимается по кнопке, и полсотни отдельных записей
 * ради неё были бы расточительством на бесплатном плане.
 */
/** Метка «строка приехала заказом» — ставится и при занятии пустого слота. */
export async function markRowOrder(
  workspaceId: string,
  pageId: string,
  subPageId: string | null,
  rowId: string,
  orderId: string
) {
  if (!db) return;
  const ref = subPageId ? paths.subPageRow(workspaceId, pageId, subPageId, rowId) : paths.row(workspaceId, pageId, rowId);
  await setDoc(ref, { orderId, updatedAt: Date.now() }, { merge: true });
}

export async function clearRowHighlights(
  workspaceId: string,
  pageId: string,
  subPageId: string | null,
  rowIds: string[]
) {
  if (!db || rowIds.length === 0) return;
  const batch = writeBatch(db);
  for (const rowId of rowIds) {
    const ref = subPageId ? paths.subPageRow(workspaceId, pageId, subPageId, rowId) : paths.row(workspaceId, pageId, rowId);
    batch.set(ref, { highlight: deleteField(), updatedAt: Date.now() }, { merge: true });
  }
  await batch.commit();
}

export async function updateRowHeight(
  workspaceId: string,
  pageId: string,
  rowId: string,
  height: number
) {
  if (!db) return;
  await setDoc(paths.row(workspaceId, pageId, rowId), { height }, { merge: true });
}

export async function deleteRow(workspaceId: string, pageId: string, rowId: string) {
  if (!db) return;
  await deleteDoc(paths.row(workspaceId, pageId, rowId));
  mirrorDeleteRow(rowId);
}

export async function duplicateRow(workspaceId: string, pageId: string, row: PageRow, order: number) {
  if (!db) return;
  const id = generateId("row");
  const copy: PageRow = {
    ...row,
    id,
    order,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await setDoc(paths.row(workspaceId, pageId, id), copy);
  mirrorUpsertRow(workspaceId, pageId, null, copy);
  return copy;
}

/** Firestore batches cap at 500 writes; long desks renumber in chunks. */
export const ROW_REORDER_CHUNK = 450;

export async function reorderRows(workspaceId: string, pageId: string, orderedRowIds: string[]) {
  if (!db) return;
  for (let start = 0; start < orderedRowIds.length; start += ROW_REORDER_CHUNK) {
    const batch = writeBatch(db);
    orderedRowIds.slice(start, start + ROW_REORDER_CHUNK).forEach((rowId, i) => {
      batch.set(paths.row(workspaceId, pageId, rowId), { order: start + i }, { merge: true });
    });
    await batch.commit();
  }
  mirrorReorderRows(orderedRowIds);
}
