import { deleteDoc, onSnapshot, orderBy, query, setDoc } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths, withErrorReporting } from "@/firebase/firestore";
import { generateId } from "@/utils/id";
import { normalizeTimestamp } from "@/utils/date";
import { stripUndefined } from "@/services/pageService";
import type { PageColumn, PageIconName, SubPage } from "@/types";

export interface PersonalZone {
  uid: string;
  pageId: string;
  workspaceId: string;
  createdAt: number;
  updatedAt: number;
}

/** Personal Space is nested under a page and never appears in the main page list. */
export async function ensurePersonalZone(workspaceId: string, pageId: string, uid: string): Promise<PersonalZone> {
  if (!db) throw new Error("Firebase не настроен");
  const zone: PersonalZone = { uid, pageId, workspaceId, createdAt: Date.now(), updatedAt: Date.now() };
  await setDoc(paths.personalZone(workspaceId, pageId, uid), zone, { merge: true });
  return zone;
}

// ---------------------------------------------------------------------------
// Monthly reports. Deliberately a SEPARATE collection from the shared
// `subpages` used by ordinary page tabs — not a marked/flagged doc in the
// same collection. Mixing them would require the shared subpages LIST query
// (which has no where-filter, since ordinary tabs need to show everything
// under a page) to depend on a per-document field like `personalOwnerUid`.
// Firestore can only prove a list query safe when its rule condition is
// UNIFORM across every document the query can return; a per-doc-varying
// condition there is exactly the bug class that has twice broken this app's
// page lists before. Keeping reports in their own uid-scoped collection
// sidesteps that risk entirely — this collection is only ever queried
// already-scoped to one specific uid, never listed unfiltered.
// ---------------------------------------------------------------------------

export interface PersonalReportInput {
  workspaceId: string;
  pageId: string;
  uid: string;
  name: string;
  columns: PageColumn[];
  icon?: PageIconName;
  order: number;
  color?: string;
}

export async function createPersonalMonthlyReport(input: PersonalReportInput): Promise<SubPage> {
  if (!db) throw new Error("Firebase не настроен");
  await ensurePersonalZone(input.workspaceId, input.pageId, input.uid);
  const id = generateId("report");
  const report: SubPage = {
    id,
    pageId: input.pageId,
    workspaceId: input.workspaceId,
    name: input.name.trim(),
    color: input.color ?? "243 75% 59%",
    icon: input.icon ?? "ClipboardList",
    order: input.order,
    isArchived: false,
    personalOwnerUid: input.uid,
    columns: stripUndefined(input.columns),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdBy: input.uid,
  };
  await setDoc(paths.personalReport(input.workspaceId, input.pageId, input.uid, id), stripUndefined(report));
  return report;
}

export function subscribeToPersonalReports(
  workspaceId: string,
  pageId: string,
  uid: string,
  onData: (reports: SubPage[]) => void,
  onError?: (error: import("firebase/firestore").FirestoreError) => void
) {
  const q = query(paths.personalReports(workspaceId, pageId, uid), orderBy("order", "asc"));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as SubPage);
      items.forEach((r) => (r.createdAt = normalizeTimestamp(r.createdAt)));
      onData(items);
    },
    withErrorReporting(onError)
  );
}

export async function deletePersonalReport(workspaceId: string, pageId: string, uid: string, reportId: string) {
  if (!db) return;
  await deleteDoc(paths.personalReport(workspaceId, pageId, uid, reportId));
}

const REPORT_MONTHS_RU = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

function guessNextReportName(currentName: string): string {
  const trimmed = currentName.trim();
  const match = trimmed.match(/^(\p{L}+)(\s+(\d{4}))?$/u);
  if (!match) return "Новый отчёт";
  const word = match[1].toLowerCase();
  const year = match[3] ? parseInt(match[3], 10) : null;
  const idx = REPORT_MONTHS_RU.findIndex((m) => m === word);
  if (idx === -1) return "Новый отчёт";
  const nextIdx = (idx + 1) % 12;
  const nextWord = REPORT_MONTHS_RU[nextIdx][0].toUpperCase() + REPORT_MONTHS_RU[nextIdx].slice(1);
  const nextYear = year !== null ? (nextIdx === 0 ? year + 1 : year) : null;
  return nextYear ? `${nextWord} ${nextYear}` : nextWord;
}

/** Clones only the column structure of `current` into a new report — matches the app-wide "next month" convention: structure copies, data never does. */
export async function createNextMonthPersonalReport(
  workspaceId: string,
  pageId: string,
  uid: string,
  current: SubPage,
  nextOrder: number
): Promise<SubPage> {
  return createPersonalMonthlyReport({
    workspaceId,
    pageId,
    uid,
    name: guessNextReportName(current.name),
    columns: current.columns,
    icon: current.icon,
    color: current.color,
    order: nextOrder,
  });
}

export async function updatePersonalReportColumns(
  workspaceId: string,
  pageId: string,
  uid: string,
  reportId: string,
  columns: PageColumn[]
) {
  if (!db) return;
  await setDoc(paths.personalReport(workspaceId, pageId, uid, reportId), { columns: stripUndefined(columns), updatedAt: Date.now() }, { merge: true });
}

// ---------------------------------------------------------------------------
// Rows within a personal report
// ---------------------------------------------------------------------------

export function subscribeToPersonalReportRows(
  workspaceId: string,
  pageId: string,
  uid: string,
  reportId: string,
  onData: (rows: PersonalReportRow[]) => void
) {
  const q = query(paths.personalReportRows(workspaceId, pageId, uid, reportId), orderBy("order", "asc"));
  return onSnapshot(q, (snapshot) => {
    onData(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as PersonalReportRow));
  });
}

export interface PersonalReportRow {
  id: string;
  cells: Record<string, string | number | null>;
  order: number;
  createdAt: number;
  updatedAt: number;
}

export async function addPersonalReportRow(
  workspaceId: string,
  pageId: string,
  uid: string,
  reportId: string,
  cells: Record<string, string | number | null>,
  order: number
) {
  if (!db) throw new Error("Firebase не настроен");
  const id = generateId("prow");
  const row: PersonalReportRow = { id, cells, order, createdAt: Date.now(), updatedAt: Date.now() };
  await setDoc(paths.personalReportRow(workspaceId, pageId, uid, reportId, id), row);
  return row;
}

export async function updatePersonalReportRowCell(
  workspaceId: string,
  pageId: string,
  uid: string,
  reportId: string,
  rowId: string,
  field: string,
  value: string | number | null
) {
  if (!db) return;
  await setDoc(
    paths.personalReportRow(workspaceId, pageId, uid, reportId, rowId),
    { cells: { [field]: value }, updatedAt: Date.now() },
    { merge: true }
  );
}

export async function deletePersonalReportRow(
  workspaceId: string,
  pageId: string,
  uid: string,
  reportId: string,
  rowId: string
) {
  if (!db) return;
  await deleteDoc(paths.personalReportRow(workspaceId, pageId, uid, reportId, rowId));
}

// ---------------------------------------------------------------------------
// Finance journal
// ---------------------------------------------------------------------------

export interface PersonalFinanceEntry {
  id: string;
  uid: string;
  pageId: string;
  month: string;
  type: "income" | "expense";
  amountMinor: number;
  category: string;
  description: string;
  createdAt: number;
}

export function subscribeToPersonalFinance(
  workspaceId: string,
  pageId: string,
  uid: string,
  onData: (entries: PersonalFinanceEntry[]) => void,
  onError?: (error: import("firebase/firestore").FirestoreError) => void
) {
  const q = query(paths.personalFinance(workspaceId, pageId, uid), orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as PersonalFinanceEntry);
      items.forEach((e) => (e.createdAt = normalizeTimestamp(e.createdAt)));
      onData(items);
    },
    withErrorReporting(onError)
  );
}

export async function addPersonalFinanceEntry(
  workspaceId: string,
  pageId: string,
  entry: Omit<PersonalFinanceEntry, "id" | "createdAt">
): Promise<PersonalFinanceEntry> {
  if (!db) throw new Error("Firebase не настроен");
  const id = generateId("finance");
  const value: PersonalFinanceEntry = { ...entry, id, createdAt: Date.now() };
  await setDoc(paths.personalFinanceEntry(workspaceId, pageId, entry.uid, id), value);
  return value;
}

export async function deletePersonalFinanceEntry(workspaceId: string, pageId: string, uid: string, entryId: string) {
  if (!db) return;
  await deleteDoc(paths.personalFinanceEntry(workspaceId, pageId, uid, entryId));
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export interface PersonalNote {
  id: string;
  authorId: string;
  pageId: string;
  title: string;
  text: string;
  createdAt: number;
  updatedAt: number;
}

export function subscribeToPersonalNotes(
  workspaceId: string,
  pageId: string,
  uid: string,
  onData: (notes: PersonalNote[]) => void,
  onError?: (error: import("firebase/firestore").FirestoreError) => void
) {
  const q = query(paths.personalNotes(workspaceId, pageId, uid), orderBy("updatedAt", "desc"));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as PersonalNote);
      items.forEach((n) => {
        n.createdAt = normalizeTimestamp(n.createdAt);
        n.updatedAt = normalizeTimestamp(n.updatedAt);
      });
      onData(items);
    },
    withErrorReporting(onError)
  );
}

export async function savePersonalNote(workspaceId: string, pageId: string, note: PersonalNote) {
  if (!db) throw new Error("Firebase не настроен");
  await setDoc(
    paths.personalNote(workspaceId, pageId, note.authorId, note.id),
    { ...note, updatedAt: Date.now() },
    { merge: true }
  );
  return note;
}

export async function deletePersonalNote(workspaceId: string, pageId: string, uid: string, noteId: string) {
  if (!db) return;
  await deleteDoc(paths.personalNote(workspaceId, pageId, uid, noteId));
}

// ---------------------------------------------------------------------------
// Debts — "кто мне сколько должен". Quick add, mark paid, delete.
// ---------------------------------------------------------------------------

export interface PersonalDebt {
  id: string;
  uid: string;
  personName: string;
  amountMinor: number;
  note: string;
  paid: boolean;
  createdAt: number;
  paidAt: number | null;
}

export function subscribeToPersonalDebts(
  workspaceId: string,
  pageId: string,
  uid: string,
  onData: (debts: PersonalDebt[]) => void,
  onError?: (error: import("firebase/firestore").FirestoreError) => void
) {
  const q = query(paths.personalDebts(workspaceId, pageId, uid), orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as PersonalDebt);
      items.forEach((e) => {
        e.createdAt = normalizeTimestamp(e.createdAt);
        if (e.paidAt) e.paidAt = normalizeTimestamp(e.paidAt);
      });
      onData(items);
    },
    withErrorReporting(onError)
  );
}

export async function addPersonalDebt(
  workspaceId: string,
  pageId: string,
  uid: string,
  input: { personName: string; amountMinor: number; note?: string }
): Promise<PersonalDebt> {
  if (!db) throw new Error("Firebase не настроен");
  const id = generateId("debt");
  const debt: PersonalDebt = {
    id,
    uid,
    personName: input.personName.trim(),
    amountMinor: input.amountMinor,
    note: input.note?.trim() ?? "",
    paid: false,
    createdAt: Date.now(),
    paidAt: null,
  };
  await setDoc(paths.personalDebt(workspaceId, pageId, uid, id), debt);
  return debt;
}

export async function setPersonalDebtPaid(workspaceId: string, pageId: string, uid: string, debtId: string, paid: boolean) {
  if (!db) return;
  await setDoc(
    paths.personalDebt(workspaceId, pageId, uid, debtId),
    { uid, paid, paidAt: paid ? Date.now() : null },
    { merge: true }
  );
}

export async function deletePersonalDebt(workspaceId: string, pageId: string, uid: string, debtId: string) {
  if (!db) return;
  await deleteDoc(paths.personalDebt(workspaceId, pageId, uid, debtId));
}
