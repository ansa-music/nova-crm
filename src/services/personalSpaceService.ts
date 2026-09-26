import { deleteDoc, getDocs, onSnapshot, orderBy, query, setDoc } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths, withErrorReporting } from "@/firebase/firestore";
import { generateId } from "@/utils/id";
import { normalizeTimestamp } from "@/utils/date";
import { stripUndefined } from "@/services/pageService";
import { supabaseRows } from "@/lib/supabaseRows";
import { watchSbDocs, type DocFeedConfig, type SbDoc } from "@/services/sb/docFeed";
import { createDocStore, plainFirestoreData, sbError, type DocWrite } from "@/services/sb/docStore";
import { sbTargetOf, type SbBackend } from "@/services/sb/sbCollections";
import { useWorkspaceStore } from "@/store/workspaceStore";
import type { PageColumn, PageIconName, SubPage } from "@/types";

// ---------------------------------------------------------------------------
// Где живёт личная зона (26.09.2026, SQL 20261022): таблица personal_docs в
// Supabase или подколлекции Firestore, как раньше. Переезжает КАЖДАЯ зона
// отдельно, при первом открытии её хозяином (или Owner): `ensurePersonalZoneImported`
// переносит документы и ставит отметку `imported_{стол}_{uid}`; пока её нет,
// зона читается и пишется в Firestore.
// ---------------------------------------------------------------------------

type PersonalKind = "zone" | "report" | "row" | "finance" | "note" | "debt";

export const PERSONAL_FEED: DocFeedConfig = { table: "personal_docs", topic: "personal", collection: "personal" };

const store = createDocStore<PersonalKind>({
  feed: PERSONAL_FEED,
  collection: "personal",
  writeRpc: "personal_write",
  importedStorageKey: "nova:personal-imported:",
  firestoreRef: (workspaceId, write) => {
    const page = String(write.extra?.page ?? "");
    const zone = String(write.extra?.zone ?? "");
    switch (write.kind) {
      case "zone":
        return paths.personalZone(workspaceId, page, zone);
      case "report":
        return paths.personalReport(workspaceId, page, zone, write.id);
      case "row":
        return paths.personalReportRow(workspaceId, page, zone, String(write.extra?.parent ?? ""), write.id);
      case "finance":
        return paths.personalFinanceEntry(workspaceId, page, zone, write.id);
      case "note":
        return paths.personalNote(workspaceId, page, zone, write.id);
      case "debt":
        return paths.personalDebt(workspaceId, page, zone, write.id);
    }
  },
});

function zoneMark(pageId: string, uid: string) {
  return `imported_${pageId}_${uid}`;
}

export function personalBackendFor(workspaceId: string, pageId: string, uid: string): SbBackend {
  return store.backendFor(workspaceId, zoneMark(pageId, uid));
}

/** Хранилище зоны для экрана: переподписка, когда зону перенесли. */
export function usePersonalBackend(workspaceId: string, pageId: string, uid: string): SbBackend | null {
  return store.useBackend(workspaceId, zoneMark(pageId, uid));
}

function zoneWrite(
  pageId: string,
  uid: string,
  kind: PersonalKind,
  id: string,
  op: DocWrite["op"],
  data?: Record<string, unknown>,
  parent?: string
): DocWrite<PersonalKind> {
  return {
    kind,
    id,
    op,
    data,
    extra: {
      page: pageId,
      zone: uid,
      ...(parent ? { parent } : {}),
      // Метки для показа ДО ответа базы (их ставит и сама база).
      stamp: { _page: pageId, _zone: uid, ...(parent ? { _parent: parent } : {}) },
    },
  };
}

async function commitZone(workspaceId: string, writes: DocWrite<PersonalKind>[]) {
  await store.commit(workspaceId, writes, "supabase", "imported", { optimistic: true });
}

/** Вид одной подколлекции зоны. */
function watchZone<T>(
  workspaceId: string,
  pageId: string,
  uid: string,
  kind: PersonalKind,
  parent: string | null,
  map: (docs: SbDoc[]) => T[],
  onData: (items: T[]) => void,
  fallback: () => () => void,
  onError?: (error: import("firebase/firestore").FirestoreError) => void
): () => void {
  let stopFallback: (() => void) | null = null;
  const stop = watchSbDocs(
    PERSONAL_FEED,
    workspaceId,
    {
      initial: (q) => {
        const base = q.eq("kind", kind).eq("page_id", pageId).eq("zone_uid", uid);
        return parent ? base.eq("parent_id", parent) : base;
      },
      match: (d) => d.kind === kind && d.data._page === pageId && d.data._zone === uid && (!parent || d.data._parent === parent),
    },
    (docs) => onData(map(docs)),
    {
      onMissing: () => {
        if (!stopFallback) stopFallback = fallback();
      },
      onError: (error) => onError?.(error as unknown as import("firebase/firestore").FirestoreError),
    }
  );
  return () => {
    stop();
    stopFallback?.();
  };
}

function withoutMarks<T>(doc: SbDoc): T {
  const { _page: _p, _zone: _z, _parent: _pr, ...rest } = doc.data as Record<string, unknown>;
  return { ...rest, id: doc.id } as T;
}

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
  if (personalBackendFor(workspaceId, pageId, uid) === "supabase") {
    await store.commit(workspaceId, [zoneWrite(pageId, uid, "zone", `zone_${pageId}_${uid}`, "merge", { ...zone })], "supabase");
    return zone;
  }
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
  if (personalBackendFor(input.workspaceId, input.pageId, input.uid) === "supabase") {
    await commitZone(input.workspaceId, [
      zoneWrite(input.pageId, input.uid, "report", id, "set", stripUndefined(report) as unknown as Record<string, unknown>),
    ]);
    return report;
  }
  await setDoc(paths.personalReport(input.workspaceId, input.pageId, input.uid, id), stripUndefined(report));
  return report;
}

export function subscribeToPersonalReports(
  workspaceId: string,
  pageId: string,
  uid: string,
  onData: (reports: SubPage[]) => void,
  onError?: (error: import("firebase/firestore").FirestoreError) => void,
  backend: SbBackend = "firestore"
): () => void {
  if (backend === "supabase") {
    return watchZone<SubPage>(
      workspaceId,
      pageId,
      uid,
      "report",
      null,
      (docs) => {
        const items = docs.map((d) => withoutMarks<SubPage>(d));
        items.forEach((r) => (r.createdAt = normalizeTimestamp(r.createdAt)));
        return items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      },
      onData,
      () => subscribeToPersonalReports(workspaceId, pageId, uid, onData, onError, "firestore"),
      onError
    );
  }
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
  if (personalBackendFor(workspaceId, pageId, uid) === "supabase") {
    await commitZone(workspaceId, [zoneWrite(pageId, uid, "report", reportId, "delete")]);
    return;
  }
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
  if (personalBackendFor(workspaceId, pageId, uid) === "supabase") {
    // Столбцы — список: при слиянии он заменяется целиком, как в Firestore.
    await commitZone(workspaceId, [
      zoneWrite(pageId, uid, "report", reportId, "merge", { columns: stripUndefined(columns), updatedAt: Date.now() }),
    ]);
    return;
  }
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
  onData: (rows: PersonalReportRow[]) => void,
  backend: SbBackend = "firestore"
): () => void {
  if (backend === "supabase") {
    return watchZone<PersonalReportRow>(
      workspaceId,
      pageId,
      uid,
      "row",
      reportId,
      (docs) => docs.map((d) => withoutMarks<PersonalReportRow>(d)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
      onData,
      () => subscribeToPersonalReportRows(workspaceId, pageId, uid, reportId, onData, "firestore")
    );
  }
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
  if (personalBackendFor(workspaceId, pageId, uid) === "supabase") {
    await commitZone(workspaceId, [zoneWrite(pageId, uid, "row", id, "set", { ...row }, reportId)]);
    return row;
  }
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
  if (personalBackendFor(workspaceId, pageId, uid) === "supabase") {
    await commitZone(workspaceId, [
      zoneWrite(pageId, uid, "row", rowId, "merge", { cells: { [field]: value }, updatedAt: Date.now() }, reportId),
    ]);
    return;
  }
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
  if (personalBackendFor(workspaceId, pageId, uid) === "supabase") {
    await commitZone(workspaceId, [zoneWrite(pageId, uid, "row", rowId, "delete", undefined, reportId)]);
    return;
  }
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
  onError?: (error: import("firebase/firestore").FirestoreError) => void,
  backend: SbBackend = "firestore"
): () => void {
  if (backend === "supabase") {
    return watchZone<PersonalFinanceEntry>(
      workspaceId,
      pageId,
      uid,
      "finance",
      null,
      (docs) => {
        const items = docs.map((d) => withoutMarks<PersonalFinanceEntry>(d));
        items.forEach((e) => (e.createdAt = normalizeTimestamp(e.createdAt)));
        return items.sort((a, b) => b.createdAt - a.createdAt);
      },
      onData,
      () => subscribeToPersonalFinance(workspaceId, pageId, uid, onData, onError, "firestore"),
      onError
    );
  }
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
  if (personalBackendFor(workspaceId, pageId, entry.uid) === "supabase") {
    await commitZone(workspaceId, [zoneWrite(pageId, entry.uid, "finance", id, "set", { ...value })]);
    return value;
  }
  await setDoc(paths.personalFinanceEntry(workspaceId, pageId, entry.uid, id), value);
  return value;
}

export async function deletePersonalFinanceEntry(workspaceId: string, pageId: string, uid: string, entryId: string) {
  if (!db) return;
  if (personalBackendFor(workspaceId, pageId, uid) === "supabase") {
    await commitZone(workspaceId, [zoneWrite(pageId, uid, "finance", entryId, "delete")]);
    return;
  }
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
  onError?: (error: import("firebase/firestore").FirestoreError) => void,
  backend: SbBackend = "firestore"
): () => void {
  if (backend === "supabase") {
    return watchZone<PersonalNote>(
      workspaceId,
      pageId,
      uid,
      "note",
      null,
      (docs) => {
        const items = docs.map((d) => withoutMarks<PersonalNote>(d));
        items.forEach((n) => {
          n.createdAt = normalizeTimestamp(n.createdAt);
          n.updatedAt = normalizeTimestamp(n.updatedAt);
        });
        return items.sort((a, b) => b.updatedAt - a.updatedAt);
      },
      onData,
      () => subscribeToPersonalNotes(workspaceId, pageId, uid, onData, onError, "firestore"),
      onError
    );
  }
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
  if (personalBackendFor(workspaceId, pageId, note.authorId) === "supabase") {
    await commitZone(workspaceId, [zoneWrite(pageId, note.authorId, "note", note.id, "merge", { ...note, updatedAt: Date.now() })]);
    return note;
  }
  await setDoc(
    paths.personalNote(workspaceId, pageId, note.authorId, note.id),
    { ...note, updatedAt: Date.now() },
    { merge: true }
  );
  return note;
}

export async function deletePersonalNote(workspaceId: string, pageId: string, uid: string, noteId: string) {
  if (!db) return;
  if (personalBackendFor(workspaceId, pageId, uid) === "supabase") {
    await commitZone(workspaceId, [zoneWrite(pageId, uid, "note", noteId, "delete")]);
    return;
  }
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
  onError?: (error: import("firebase/firestore").FirestoreError) => void,
  backend: SbBackend = "firestore"
): () => void {
  if (backend === "supabase") {
    return watchZone<PersonalDebt>(
      workspaceId,
      pageId,
      uid,
      "debt",
      null,
      (docs) => {
        const items = docs.map((d) => withoutMarks<PersonalDebt>(d));
        items.forEach((e) => {
          e.createdAt = normalizeTimestamp(e.createdAt);
          if (e.paidAt) e.paidAt = normalizeTimestamp(e.paidAt);
        });
        return items.sort((a, b) => b.createdAt - a.createdAt);
      },
      onData,
      () => subscribeToPersonalDebts(workspaceId, pageId, uid, onData, onError, "firestore"),
      onError
    );
  }
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
  if (personalBackendFor(workspaceId, pageId, uid) === "supabase") {
    await commitZone(workspaceId, [zoneWrite(pageId, uid, "debt", id, "set", { ...debt })]);
    return debt;
  }
  await setDoc(paths.personalDebt(workspaceId, pageId, uid, id), debt);
  return debt;
}

export async function setPersonalDebtPaid(workspaceId: string, pageId: string, uid: string, debtId: string, paid: boolean) {
  if (!db) return;
  if (personalBackendFor(workspaceId, pageId, uid) === "supabase") {
    await commitZone(workspaceId, [zoneWrite(pageId, uid, "debt", debtId, "merge", { uid, paid, paidAt: paid ? Date.now() : null })]);
    return;
  }
  await setDoc(
    paths.personalDebt(workspaceId, pageId, uid, debtId),
    { uid, paid, paidAt: paid ? Date.now() : null },
    { merge: true }
  );
}

export async function deletePersonalDebt(workspaceId: string, pageId: string, uid: string, debtId: string) {
  if (!db) return;
  if (personalBackendFor(workspaceId, pageId, uid) === "supabase") {
    await commitZone(workspaceId, [zoneWrite(pageId, uid, "debt", debtId, "delete")]);
    return;
  }
  await deleteDoc(paths.personalDebt(workspaceId, pageId, uid, debtId));
}

// ---------------------------------------------------------------------------
// Перенос зоны Firestore → Supabase (её хозяин или Owner, при открытии).
// ---------------------------------------------------------------------------

const TAIL_MS = 3 * 24 * 60 * 60_000;
const IMPORT_CHUNK = 500;
const importRuns = new Map<string, Promise<number>>();

/**
 * Перенести зону, если пора: строки в Supabase, таблица есть, отметки зоны
 * нет (или идёт трёхдневная дочитка). Раз за загрузку страницы на зону.
 * Отказ (права ещё не доехали, нет сети) — зона остаётся в Firestore.
 */
export function ensurePersonalZoneImported(workspaceId: string, pageId: string, uid: string): Promise<number> {
  const key = `${workspaceId}|${pageId}|${uid}`;
  const running = importRuns.get(key);
  if (running) return running;
  const run = importZone(workspaceId, pageId, uid);
  importRuns.set(key, run);
  run.catch(() => importRuns.delete(key));
  return run;
}

async function importZone(workspaceId: string, pageId: string, uid: string): Promise<number> {
  const docWs = useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId) ?? null;
  if (!db || !docWs || sbTargetOf(docWs, "personal") !== "supabase") return 0;
  const mark = zoneMark(pageId, uid);
  const meta = await store.readImportMeta(workspaceId, mark);
  if (meta === undefined) return 0;
  if (meta && typeof meta.at === "number" && Date.now() - meta.at > TAIL_MS) {
    store.setImported(workspaceId, true, mark);
    return 0;
  }
  const docs: Array<{ kind: PersonalKind; id: string; data: unknown; parent?: string }> = [];
  const [reports, finance, notes, debts] = await Promise.all([
    getDocs(paths.personalReports(workspaceId, pageId, uid)),
    getDocs(paths.personalFinance(workspaceId, pageId, uid)),
    getDocs(paths.personalNotes(workspaceId, pageId, uid)),
    getDocs(paths.personalDebts(workspaceId, pageId, uid)),
  ]);
  for (const d of reports.docs) {
    docs.push({ kind: "report", id: d.id, data: plainFirestoreData(d.data()) });
    const rows = await getDocs(paths.personalReportRows(workspaceId, pageId, uid, d.id));
    for (const r of rows.docs) docs.push({ kind: "row", id: r.id, data: plainFirestoreData(r.data()), parent: d.id });
  }
  for (const d of finance.docs) docs.push({ kind: "finance", id: d.id, data: plainFirestoreData(d.data()) });
  for (const d of notes.docs) docs.push({ kind: "note", id: d.id, data: plainFirestoreData(d.data()) });
  for (const d of debts.docs) docs.push({ kind: "debt", id: d.id, data: plainFirestoreData(d.data()) });

  for (let i = 0; i < Math.max(docs.length, 1); i += IMPORT_CHUNK) {
    const chunk = docs.slice(i, i + IMPORT_CHUNK);
    const last = i + IMPORT_CHUNK >= docs.length;
    const { error } = await supabaseRows.rpc("personal_import", {
      p_workspace: workspaceId,
      p_page: pageId,
      p_zone: uid,
      p_docs: chunk,
      p_done: last,
    });
    if (error) throw sbError(error);
  }
  store.setImported(workspaceId, true, mark);
  return docs.length;
}
