import {
  deleteDoc,
  deleteField,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths, subscribe, withErrorReporting } from "@/firebase/firestore";
import { generateId } from "@/utils/id";
import { hasRowExtras } from "@/utils/rowExtras";
import { ymdPartsInTimeZone } from "@/utils/date";
import { ROW_REORDER_CHUNK, rowsToRenumber, stripUndefined } from "@/services/pageService";
import type { PageColumn, PageIconName, PageRow, StatusOption, SubPage } from "@/types";
import {
  mirrorDeleteRow,
  mirrorDeleteRowsForSubPage,
  mirrorPatchRowCells,
  mirrorPatchRowCellsBulk,
  mirrorReorderRows,
  mirrorUpsertRow,
} from "@/services/rowRecordsService";

// ---------------------------------------------------------------------------
// Subpages themselves (the tabs)
// ---------------------------------------------------------------------------

export function subscribeToSubPages(
  workspaceId: string,
  pageId: string,
  onData: (subPages: SubPage[]) => void,
  onError?: (error: import("firebase/firestore").FirestoreError) => void
) {
  const q = query(paths.subPages(workspaceId, pageId), orderBy("order", "asc"));

  // Same stale-empty-cache guard used elsewhere in the app: avoids a flash
  // of "no tabs yet" before the real server snapshot arrives.
  let cancelled = false;
  let emittedOnce = false;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      if (cancelled) return;
      const subPages = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as SubPage);
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
      if (snapshot.metadata.fromCache && subPages.length === 0 && !emittedOnce) {
        pendingTimer = setTimeout(() => {
          if (!cancelled) {
            emittedOnce = true;
            onData([]);
          }
        }, 1200);
        return;
      }
      emittedOnce = true;
      onData(subPages);
    },
    withErrorReporting(onError)
  );

  return () => {
    cancelled = true;
    if (pendingTimer) clearTimeout(pendingTimer);
    unsubscribe();
  };
}

export interface CreateSubPageInput {
  workspaceId: string;
  pageId: string;
  name: string;
  color: string;
  icon: PageIconName;
  columns: PageColumn[];
  order: number;
  createdBy: string;
  /** Fixed document id instead of a generated one — month tabs use `month-YYYY-MM` so two clients can't create the same month twice. */
  id?: string;
  /** "YYYY-MM" for a month tab — see monthTabService.ts. */
  monthKey?: string;
  /** Marks this subpage as a Personal Space monthly report, not an ordinary shared one — see canAccessSubPage in firestore.rules. */
  personalOwnerUid?: string;
  personalAllowedUsers?: string[];
}

export async function createSubPage(input: CreateSubPageInput): Promise<SubPage> {
  if (!db) throw new Error("Firebase не настроен");
  const id = input.id ?? generateId("sub");
  const subPage: SubPage = {
    id,
    pageId: input.pageId,
    workspaceId: input.workspaceId,
    name: input.name,
    color: input.color,
    icon: input.icon,
    order: input.order,
    isArchived: false,
    monthKey: input.monthKey,
    personalOwnerUid: input.personalOwnerUid,
    personalAllowedUsers: input.personalAllowedUsers,
    columns: stripUndefined(input.columns),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdBy: input.createdBy,
  };
  await setDoc(paths.subPage(input.workspaceId, input.pageId, id), stripUndefined(subPage));
  return subPage;
}

export async function renameSubPage(workspaceId: string, pageId: string, subPageId: string, name: string) {
  if (!db) return;
  await setDoc(paths.subPage(workspaceId, pageId, subPageId), { name, updatedAt: Date.now() }, { merge: true });
}

export async function updateSubPageAppearance(
  workspaceId: string,
  pageId: string,
  subPageId: string,
  patch: { color?: string; icon?: PageIconName }
) {
  if (!db) return;
  await setDoc(paths.subPage(workspaceId, pageId, subPageId), { ...patch, updatedAt: Date.now() }, { merge: true });
}

export async function updateSubPageColumns(
  workspaceId: string,
  pageId: string,
  subPageId: string,
  columns: PageColumn[]
) {
  if (!db) return;
  await setDoc(
    paths.subPage(workspaceId, pageId, subPageId),
    { columns: stripUndefined(columns), updatedAt: Date.now() },
    { merge: true }
  );
}

export async function archiveSubPage(workspaceId: string, pageId: string, subPageId: string, archived: boolean) {
  if (!db) return;
  await setDoc(
    paths.subPage(workspaceId, pageId, subPageId),
    { isArchived: archived, updatedAt: Date.now() },
    { merge: true }
  );
}

/** Permanently removes the subpage and (best-effort) all of its rows. */
export async function deleteSubPage(workspaceId: string, pageId: string, subPageId: string) {
  if (!db) return;
  const rowsSnap = await getDocs(paths.subPageRows(workspaceId, pageId, subPageId));
  const batch = writeBatch(db);
  rowsSnap.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(paths.subPage(workspaceId, pageId, subPageId));
  await batch.commit();
  mirrorDeleteRowsForSubPage(pageId, subPageId);
}

export async function reorderSubPages(workspaceId: string, pageId: string, orderedIds: string[]) {
  if (!db) return;
  const batch = writeBatch(db);
  orderedIds.forEach((id, index) => {
    batch.set(paths.subPage(workspaceId, pageId, id), { order: index }, { merge: true });
  });
  await batch.commit();
}

/**
 * Duplicates a subpage. `includeData: false` copies only the column
 * structure (a fresh, empty table) — `includeData: true` also copies every
 * row's cells.
 */
export async function duplicateSubPage(
  workspaceId: string,
  pageId: string,
  source: SubPage,
  nextOrder: number,
  createdBy: string,
  includeData: boolean
): Promise<SubPage> {
  if (!db) throw new Error("Firebase не настроен");
  const copy = await createSubPage({
    workspaceId,
    pageId,
    name: `${source.name} (копия)`,
    color: source.color,
    icon: source.icon,
    columns: source.columns,
    order: nextOrder,
    createdBy,
  });
  if (includeData) {
    const rowsSnap = await getDocs(paths.subPageRows(workspaceId, pageId, source.id));
    const batch = writeBatch(db);
    const newRows: PageRow[] = [];
    rowsSnap.docs.forEach((d, i) => {
      const data = d.data() as PageRow;
      const newRowId = generateId("row");
      const row: PageRow = {
        ...data,
        id: newRowId,
        pageId: copy.id,
        order: i,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      batch.set(paths.subPageRow(workspaceId, pageId, copy.id, newRowId), row);
      newRows.push(row);
    });
    await batch.commit();
    // Mirror after the batch commits, same as every other row-creating write.
    newRows.forEach((row) => mirrorUpsertRow(workspaceId, pageId, copy.id, row));
  }
  return copy;
}

const MONTHS_RU = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

function titleMonth(word: string): string {
  return word[0].toUpperCase() + word.slice(1);
}

/** Current calendar month in Asia/Almaty, e.g. "Август 2026" — parsable by guessNextMonthName. */
export function currentMonthTabName(now: number = Date.now()): string {
  const { year, month } = ymdPartsInTimeZone(now);
  return `${titleMonth(MONTHS_RU[month])} ${year}`;
}

/** "2026-09" → "Сентябрь 2026", same shape as currentMonthTabName. */
export function monthTabNameForKey(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return `${titleMonth(MONTHS_RU[month - 1])} ${year}`;
}

/** Guesses "next month" from a subpage name like "Январь" or "Июль 2026", falling back to a generic name if it doesn't recognize a month. */
function guessNextMonthName(currentName: string): string {
  const trimmed = currentName.trim();
  const match = trimmed.match(/^(\p{L}+)(\s+(\d{4}))?$/u);
  if (!match) return "Новый месяц";
  const word = match[1].toLowerCase();
  const year = match[3] ? parseInt(match[3], 10) : null;
  const idx = MONTHS_RU.findIndex((m) => m === word);
  if (idx === -1) return "Новый месяц";
  const nextIdx = (idx + 1) % 12;
  const nextWord = titleMonth(MONTHS_RU[nextIdx]);
  const nextYear = year !== null ? (nextIdx === 0 ? year + 1 : year) : null;
  return nextYear ? `${nextWord} ${nextYear}` : nextWord;
}

/** "Создать следующий месяц" — clones the current subpage's column structure (never its data) into a new, smartly-named subpage. */
export async function createNextMonthSubPage(
  workspaceId: string,
  pageId: string,
  current: SubPage,
  nextOrder: number,
  createdBy: string
): Promise<SubPage> {
  return createSubPage({
    workspaceId,
    pageId,
    name: guessNextMonthName(current.name),
    color: current.color,
    icon: current.icon,
    columns: current.columns,
    order: nextOrder,
    createdBy,
  });
}

// ---------------------------------------------------------------------------
// Rows within a subpage — mirrors pageService's row functions exactly,
// nested one level deeper under /subpages/{subPageId}/rows.
// ---------------------------------------------------------------------------

export function subscribeToSubPageRows(
  workspaceId: string,
  pageId: string,
  subPageId: string,
  onData: (rows: PageRow[]) => void
) {
  const q = query(paths.subPageRows(workspaceId, pageId, subPageId), orderBy("order", "asc"));
  return subscribe<PageRow>(q, onData);
}

export async function fetchSubPages(workspaceId: string, pageId: string): Promise<SubPage[]> {
  const snap = await getDocs(query(paths.subPages(workspaceId, pageId), orderBy("order", "asc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as SubPage);
}

export async function fetchSubPageRows(
  workspaceId: string,
  pageId: string,
  subPageId: string
): Promise<PageRow[]> {
  const snap = await getDocs(
    query(paths.subPageRows(workspaceId, pageId, subPageId), orderBy("order", "asc"))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as PageRow);
}

export async function addSubPageRow(
  workspaceId: string,
  pageId: string,
  subPageId: string,
  cells: Record<string, string | number | null>,
  order: number,
  extras?: PageRow["extras"],
  /** Подсветить строку как новую — см. PageRow.highlight. */
  highlight?: boolean,
  /** Явный id для идемпотентной записи — см. addRow. */
  explicitId?: string,
  /** Заказ с «Заказов», из которого выросла строка — постоянная метка. */
  orderId?: string
) {
  if (!db) throw new Error("Firebase не настроен");
  const id = explicitId ?? generateId("row");
  const row: PageRow = { id, pageId: subPageId, cells, order, createdAt: Date.now(), updatedAt: Date.now() };
  if (hasRowExtras(extras)) row.extras = extras;
  if (highlight) row.highlight = true;
  if (orderId) row.orderId = orderId;
  await setDoc(paths.subPageRow(workspaceId, pageId, subPageId, id), row);
  mirrorUpsertRow(workspaceId, pageId, subPageId, row);
  return row;
}

export async function updateSubPageRowCell(
  workspaceId: string,
  pageId: string,
  subPageId: string,
  rowId: string,
  field: string,
  newValue: string | number | null,
  /** Пустую строку заполнили впервые — см. PageRow.filledAt. */
  filledAt?: number
) {
  if (!db) return;
  await setDoc(
    paths.subPageRow(workspaceId, pageId, subPageId, rowId),
    { cells: { [field]: newValue }, updatedAt: Date.now(), ...(filledAt ? { filledAt } : {}) },
    { merge: true }
  );
  mirrorPatchRowCells(rowId, field, newValue);
}

/** `extras`: undefined leaves them alone, null removes them. */
export async function updateSubPageRowCellsBulk(
  workspaceId: string,
  pageId: string,
  subPageId: string,
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
    paths.subPageRow(workspaceId, pageId, subPageId, rowId),
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

export async function updateSubPageRowHeight(
  workspaceId: string,
  pageId: string,
  subPageId: string,
  rowId: string,
  height: number
) {
  if (!db) return;
  await setDoc(paths.subPageRow(workspaceId, pageId, subPageId, rowId), { height }, { merge: true });
}

export async function deleteSubPageRow(workspaceId: string, pageId: string, subPageId: string, rowId: string) {
  if (!db) return;
  await deleteDoc(paths.subPageRow(workspaceId, pageId, subPageId, rowId));
  mirrorDeleteRow(rowId);
}

export async function duplicateSubPageRow(
  workspaceId: string,
  pageId: string,
  subPageId: string,
  row: PageRow,
  order: number
) {
  if (!db) return;
  const id = generateId("row");
  const copy: PageRow = {
    ...row,
    id,
    order,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await setDoc(paths.subPageRow(workspaceId, pageId, subPageId, id), copy);
  mirrorUpsertRow(workspaceId, pageId, subPageId, copy);
  return copy;
}

/** `currentOrders` — см. reorderRows: строки, уже стоящие на месте, не пишутся. */
export async function reorderSubPageRows(
  workspaceId: string,
  pageId: string,
  subPageId: string,
  orderedRowIds: string[],
  currentOrders?: ReadonlyMap<string, number>
) {
  if (!db) return;
  const changed = rowsToRenumber(orderedRowIds, currentOrders);
  for (let start = 0; start < changed.length; start += ROW_REORDER_CHUNK) {
    const batch = writeBatch(db);
    changed.slice(start, start + ROW_REORDER_CHUNK).forEach(({ rowId, order }) => {
      batch.set(paths.subPageRow(workspaceId, pageId, subPageId, rowId), { order }, { merge: true });
    });
    await batch.commit();
  }
  mirrorReorderRows(orderedRowIds);
}

/**
 * Marks a tab as hand-ordered (see DataTable.manualRowOrder). subPageId null
 * means the page's own «Основная» table, whose flag lives on the page doc.
 */
export async function setTabRowOrderManual(workspaceId: string, pageId: string, subPageId: string | null) {
  if (!db) return;
  const ref = subPageId ? paths.subPage(workspaceId, pageId, subPageId) : paths.page(workspaceId, pageId);
  await setDoc(ref, { rowOrder: "manual", updatedAt: Date.now() }, { merge: true });
}

// ---------------------------------------------------------------------------
// Columns within a subpage — mirrors pageService's column functions.
// ---------------------------------------------------------------------------

export async function addSubPageColumn(
  workspaceId: string,
  pageId: string,
  subPageId: string,
  existingColumns: PageColumn[],
  input: { key: string; label: string; type: PageColumn["type"]; statusOptions?: StatusOption[]; customFieldId?: string }
): Promise<PageColumn> {
  if (!db) throw new Error("Firebase не настроен");
  const newColumn: PageColumn = {
    id: generateId("col"),
    key: input.key,
    label: input.label,
    type: input.type,
    width: 160,
    order: existingColumns.length,
    statusOptions: input.statusOptions,
    customFieldId: input.customFieldId,
  };
  const columns = [...existingColumns, stripUndefined(newColumn)];
  await updateSubPageColumns(workspaceId, pageId, subPageId, columns);
  return newColumn;
}

export async function duplicateSubPageColumn(
  workspaceId: string,
  pageId: string,
  subPageId: string,
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
  await updateSubPageColumns(workspaceId, pageId, subPageId, columns);
  return copy;
}

export async function deleteSubPageColumn(
  workspaceId: string,
  pageId: string,
  subPageId: string,
  existingColumns: PageColumn[],
  columnKey: string
) {
  const columns = existingColumns.filter((c) => c.key !== columnKey).map((c, i) => ({ ...c, order: i }));
  await updateSubPageColumns(workspaceId, pageId, subPageId, columns);
}

export async function renameSubPageColumn(
  workspaceId: string,
  pageId: string,
  subPageId: string,
  existingColumns: PageColumn[],
  columnKey: string,
  newLabel: string
) {
  const columns = existingColumns.map((c) => (c.key === columnKey ? { ...c, label: newLabel } : c));
  await updateSubPageColumns(workspaceId, pageId, subPageId, columns);
}

export async function changeSubPageColumnType(
  workspaceId: string,
  pageId: string,
  subPageId: string,
  existingColumns: PageColumn[],
  columnKey: string,
  newType: PageColumn["type"],
  statusOptions?: StatusOption[],
  customFieldId?: string
) {
  // See changeColumnType in pageService.ts — preserve the existing
  // statusOptions when the caller doesn't pass a new list, instead of
  // dropping the field, or a legacy status column's stale non-empty
  // statusOptions trips columnStatusOptionsPreserved() and silently
  // rejects the whole write for a non-Owner responsible person.
  const columns = existingColumns.map((c) =>
    c.key === columnKey
      ? stripUndefined({ ...c, type: newType, statusOptions: statusOptions ?? c.statusOptions, customFieldId })
      : c
  );
  await updateSubPageColumns(workspaceId, pageId, subPageId, columns);
}

/** Mirrors pageService's updateColumnStatusOptions for a subpage's nested columns. */
export async function updateSubPageColumnStatusOptions(
  workspaceId: string,
  pageId: string,
  subPageId: string,
  existingColumns: PageColumn[],
  columnKey: string,
  statusOptions: StatusOption[]
) {
  const columns = existingColumns.map((c) => (c.key === columnKey ? { ...c, statusOptions } : c));
  await updateSubPageColumns(workspaceId, pageId, subPageId, columns);
}
