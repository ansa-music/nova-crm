import {
  deleteDoc,
  deleteField,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths, subscribe, withErrorReporting } from "@/firebase/firestore";
import { generateId } from "@/utils/id";
import { logChange } from "@/services/historyService";
import type { PageColumn, PageIconName, PageRow, StatusOption, WorkspacePage } from "@/types";
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
 * `isOwner` bypasses the per-doc `allowedUsers` check entirely, so a plain
 * unfiltered list is safe for the Owner (rule evaluation doesn't depend on
 * resource.data at all for them). For everyone else, Firestore CANNOT
 * validate an unfiltered list query against a per-document rule condition
 * like "uid in allowedUsers" — that combination is always denied outright,
 * regardless of whether the data itself would actually pass. The fix is to
 * make the query itself carry the same condition the rule checks, via an
 * explicit `where("allowedUsers", "array-contains", uid)` — then Firestore
 * can prove every possible result already satisfies the rule.
 */
export function subscribeToPages(
  workspaceId: string,
  onData: (pages: WorkspacePage[]) => void,
  onError?: (error: import("firebase/firestore").FirestoreError) => void,
  currentUserUid?: string,
  isOwnerOfWorkspace?: boolean
) {
  const q =
    !isOwnerOfWorkspace && currentUserUid
      ? query(paths.pages(workspaceId), where("allowedUsers", "array-contains", currentUserUid))
      : query(paths.pages(workspaceId), orderBy("order", "asc"));

  let cancelled = false;
  let emittedOnce = false;
  let pendingEmptyCacheTimer: ReturnType<typeof setTimeout> | null = null;

  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      if (cancelled) return;
      const pages = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as WorkspacePage);

      if (pendingEmptyCacheTimer) {
        clearTimeout(pendingEmptyCacheTimer);
        pendingEmptyCacheTimer = null;
      }

      // Same class of fix as the workspace list: a fresh navigation/reload
      // can surface a stale, empty local cache (e.g. right after gaining
      // page access) before the real server snapshot arrives. Give the
      // server a brief window rather than flashing "Access denied"/an empty
      // page and requiring a manual reload to fix it.
      if (snapshot.metadata.fromCache && pages.length === 0 && !emittedOnce) {
        pendingEmptyCacheTimer = setTimeout(() => {
          if (!cancelled) {
            emittedOnce = true;
            onData([]);
          }
        }, 1200);
        return;
      }

      emittedOnce = true;
      onData([...pages].sort((a, b) => a.order - b.order));
    },
    withErrorReporting(onError)
  );

  return () => {
    cancelled = true;
    if (pendingEmptyCacheTimer) clearTimeout(pendingEmptyCacheTimer);
    unsubscribe();
  };
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
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdBy: input.createdBy,
  };
  await setDoc(paths.page(input.workspaceId, id), stripUndefined(page));
  return page;
}

/**
 * Creates a page appropriate for the caller's role. A plain Manager (without
 * elevated create permission) is routed through the atomic one-page quota;
 * everyone else (Owner, Admin, or a Manager who's been granted elevated
 * permission) goes through the normal unlimited createPage.
 */
export async function createPageForCurrentRole(
  input: CreatePageInput & {
    role: "owner" | "admin" | "manager" | "viewer";
    uid: string;
    hasElevatedCreatePermission?: boolean;
  }
): Promise<WorkspacePage> {
  if (input.role === "viewer") throw new Error("Viewer не может создавать страницы");
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
  return createPage({
    ...input,
    responsibleUserId: input.responsibleUserId ?? (input.role === "manager" ? input.uid : null),
    allowedUsers: Array.from(new Set([...input.allowedUsers, ...(input.role === "manager" ? [input.uid] : [])])),
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
  const allowedUsers = show
    ? Array.from(new Set(allActiveMemberUids))
    : responsibleUserId
      ? [responsibleUserId]
      : [];
  await setDoc(
    paths.page(workspaceId, pageId),
    { allowedUsers, hiddenByResponsible: !show, updatedAt: Date.now() },
    { merge: true }
  );
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
  const next = grant
    ? Array.from(new Set([...page.allowedUsers, uid]))
    : page.allowedUsers.filter((id) => id !== uid);
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
  const columns = existingColumns.map((c) =>
    c.key === columnKey ? stripUndefined({ ...c, type: newType, statusOptions, customFieldId }) : c
  );
  await updatePageColumns(workspaceId, pageId, columns);
}

/**
 * Updates just a "status" column's own option list (add/rename/recolor/
 * remove values) without touching its type. Owner-only in the UI
 * (src/components/table/ManageOptionsDialog.tsx) — kept separate from
 * changeColumnType so editing existing statuses never risks flipping the
 * column's type by mistake.
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
  const refsToDelete = [
    ...rowsSnapshot.docs.map((d) => d.ref),
    ...historySnapshot.docs.map((d) => d.ref),
    paths.page(workspaceId, pageId),
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
  rowsSnapshot.docs.forEach((d) => {
    const rowId = generateId("row");
    batch.set(paths.row(workspaceId, newId, rowId), { ...d.data(), id: rowId, pageId: newId });
  });
  await batch.commit();
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
  order: number
) {
  if (!db) throw new Error("Firebase не настроен");
  const id = generateId("row");
  const row: PageRow = { id, pageId, cells, order, createdAt: Date.now(), updatedAt: Date.now() };
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
}

export async function updateRowCell(ctx: UpdateCellContext) {
  if (!db) return;
  await setDoc(
    paths.row(ctx.workspaceId, ctx.pageId, ctx.rowId),
    { cells: { [ctx.field]: ctx.newValue }, updatedAt: Date.now() },
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

export async function updateRowCellsBulk(
  workspaceId: string,
  pageId: string,
  rowId: string,
  patch: Record<string, string | number | null>
) {
  if (!db) return;
  await setDoc(
    paths.row(workspaceId, pageId, rowId),
    { cells: patch, updatedAt: Date.now() },
    { merge: true }
  );
  mirrorPatchRowCellsBulk(rowId, patch);
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

export async function reorderRows(workspaceId: string, pageId: string, orderedRowIds: string[]) {
  if (!db) return;
  const batch = writeBatch(db);
  orderedRowIds.forEach((rowId, index) => {
    batch.set(paths.row(workspaceId, pageId, rowId), { order: index }, { merge: true });
  });
  await batch.commit();
  mirrorReorderRows(orderedRowIds);
}
