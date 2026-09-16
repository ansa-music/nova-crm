import { isBlankRow } from "@/utils/blankRow";
import { isDoneStatusLabel, isFreezeStatusLabel } from "@/utils/columnOptions";
import type { DeskLoad, PageColumn, PageRow, StatusOption, TechLoadKind, Workspace } from "@/types";

/**
 * Key for orders with an empty status. Not "__none__": Firestore reserves
 * field names matching __.*__.
 */
export const NO_STATUS_KEY = "_none";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * An ОС may rate a Технар while an order from them was created or touched
 * within this window. Mirrored in firestore.rules (techRatings) — change both.
 */
export const OS_RATING_WINDOW_MS = 30 * DAY_MS;

/** How long a desk remembers an ОС's last order after it left the month tab. */
const OS_ACTIVITY_KEEP_MS = 40 * DAY_MS;

export type DeskLoadCounts = Pick<DeskLoad, "total" | "statusCounts"> &
  Required<Pick<DeskLoad, "osCounts" | "osStatusCounts" | "osLastOrderAt">>;

/** «ОС» typed as plain text still counts, matched to the shared list by label. */
const OS_COLUMN_LABEL = /^(ос|os)$/i;

function millisOf(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object") {
    const ts = value as { toMillis?: () => number; seconds?: number };
    if (typeof ts.toMillis === "function") return ts.toMillis();
    if (typeof ts.seconds === "number") return ts.seconds * 1000;
  }
  return 0;
}

/** Resolves the ОС cells of one row to «Ответственный» option values. */
function rowOsValues(
  cells: PageRow["cells"],
  osColumns: PageColumn[],
  byValue: Map<string, StatusOption>,
  byLabel: Map<string, StatusOption>
): Set<string> {
  const values = new Set<string>();
  for (const column of osColumns) {
    const raw = String(cells[column.key] ?? "").trim();
    if (!raw) continue;
    const option = byValue.get(raw) ?? byLabel.get(raw.toLowerCase());
    if (option) values.add(option.value);
    else if (column.type === "responsible" && byValue.size === 0) values.add(raw);
  }
  return values;
}

/**
 * Order counts for one desk tab. A blank row isn't an order. ОС columns are
 * every «Ответственный» column plus a text column named «ОС»; their values
 * are the shared «Ответственный» options, where a Тимлид puts each ОС nick.
 */
export function countDeskLoad(
  columns: PageColumn[],
  rows: PageRow[],
  responsibleOptions: StatusOption[] = []
): DeskLoadCounts {
  const statusCol = columns.find((c) => c.type === "status");
  const osColumns = columns.filter(
    (c) => c.type === "responsible" || (c.type === "text" && OS_COLUMN_LABEL.test(c.label.trim()))
  );
  const byValue = new Map(responsibleOptions.map((o) => [o.value, o]));
  const byLabel = new Map(responsibleOptions.map((o) => [o.label.trim().toLowerCase(), o]));
  const statusCounts: Record<string, number> = {};
  const osCounts: Record<string, number> = {};
  const osStatusCounts: Record<string, Record<string, number>> = {};
  const osLastOrderAt: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    if (isBlankRow(row)) continue;
    const cells = row.cells ?? {};
    total += 1;
    const raw = statusCol ? String(cells[statusCol.key] ?? "").trim() : "";
    const key = raw || NO_STATUS_KEY;
    statusCounts[key] = (statusCounts[key] ?? 0) + 1;
    if (osColumns.length === 0) continue;
    const touchedDay = Math.floor(Math.max(millisOf(row.createdAt), millisOf(row.updatedAt)) / DAY_MS) * DAY_MS;
    for (const os of rowOsValues(cells, osColumns, byValue, byLabel)) {
      osCounts[os] = (osCounts[os] ?? 0) + 1;
      const perStatus = osStatusCounts[os] ?? {};
      perStatus[key] = (perStatus[key] ?? 0) + 1;
      osStatusCounts[os] = perStatus;
      if (touchedDay > 0) osLastOrderAt[os] = Math.max(osLastOrderAt[os] ?? 0, touchedDay);
    }
  }
  return { total, statusCounts, osCounts, osStatusCounts, osLastOrderAt };
}

function sortedEntries<T>(record: Record<string, T> | undefined): [string, T][] {
  return Object.entries(record ?? {}).sort(([a], [b]) => a.localeCompare(b));
}

function countsSignature(load: Partial<DeskLoadCounts> & Pick<DeskLoad, "subPageId" | "monthKey">) {
  return [
    load.monthKey,
    load.subPageId,
    load.total ?? 0,
    sortedEntries(load.statusCounts),
    sortedEntries(load.osCounts),
    sortedEntries(load.osStatusCounts).map(([os, counts]) => [os, sortedEntries(counts)]),
  ];
}

/** Stable comparison key of everything counted from the rows — publish only when it changed. */
export function deskLoadSignature(load: Partial<DeskLoadCounts> & Pick<DeskLoad, "subPageId" | "monthKey">): string {
  return JSON.stringify([...countsSignature(load), sortedEntries(load.osLastOrderAt)]);
}

/**
 * Whether freshly counted rows would change the stored doc. The stored
 * `osLastOrderAt` also keeps ОС from past months, so it only has to be at
 * least as new as the rows say.
 */
export function deskLoadNeedsPublish(
  current: DeskLoad | undefined,
  next: DeskLoadCounts & Pick<DeskLoad, "subPageId" | "monthKey">
): boolean {
  if (!current) return true;
  if (JSON.stringify(countsSignature(current)) !== JSON.stringify(countsSignature(next))) return true;
  return Object.entries(next.osLastOrderAt).some(([os, at]) => (current.osLastOrderAt?.[os] ?? 0) < at);
}

/** Keeps each ОС's newest order day, drops ones older than the keep window. */
export function mergeOsLastOrderAt(
  previous: Record<string, number> | undefined,
  next: Record<string, number>,
  now: number
): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const [os, at] of Object.entries(previous ?? {})) {
    if (typeof at === "number" && at > now - OS_ACTIVITY_KEEP_MS) merged[os] = at;
  }
  for (const [os, at] of Object.entries(next)) merged[os] = Math.max(merged[os] ?? 0, at);
  return merged;
}

/** True while this desk had an order from the ОС (by option value) recently enough to rate. */
export function hasRecentOsOrder(load: DeskLoad | undefined, osValue: string, now: number): boolean {
  const at = load?.osLastOrderAt?.[osValue];
  return typeof at === "number" && at > now - OS_RATING_WINDOW_MS;
}

export const TECH_LOAD_KIND_LABELS: Record<TechLoadKind, string> = {
  free: "Свободен",
  busy: "Занят",
  rework: "Переделка",
  freeze: "Заморозка",
  payment: "Ждём оплату",
};

/** «Ждём оплату», «Ждем оплату», «Ожидание оплаты», «Ждёт оплаты»… — not «Оплачено». */
export function isAwaitingPaymentLabel(label: string): boolean {
  return /(ожид|жд[её]|жду).{0,12}оплат/i.test(label);
}

function isCancelledStatus(label: string, value: string): boolean {
  const l = label.toLowerCase();
  return l.includes("отмен") || l.includes("cancel") || value === "cancelled";
}

/** Label-based default: «Заморозка», «Переделка», done-like and cancelled statuses; anything else is work in progress. */
export function autoTechLoadKind(label: string, value: string): TechLoadKind {
  const l = label.toLowerCase();
  if (isFreezeStatusLabel(label) || value === "freeze") return "freeze";
  if (l.includes("передел")) return "rework";
  if (isAwaitingPaymentLabel(label)) return "payment";
  if (isDoneStatusLabel(label) || value === "done") return "free";
  if (isCancelledStatus(label, value)) return "free";
  return "busy";
}

export function techLoadKindForOption(option: StatusOption, kinds: Record<string, TechLoadKind> | undefined): TechLoadKind {
  return kinds?.[option.value] ?? autoTechLoadKind(option.label, option.value);
}

/**
 * The Owner's status mapping as it should be read now. A map saved before
 * version 2 recorded every status, including ones never touched — and back
 * then «Ждём оплату» fell into «Занят» on its own. Those entries go back to
 * the automatic kind; everything else the Owner saved stays.
 */
export function effectiveTechLoadKinds(
  workspace: Pick<Workspace, "techLoadStatusKinds" | "techLoadStatusKindsVersion" | "statusOptions"> | null | undefined
): Record<string, TechLoadKind> | undefined {
  const kinds = workspace?.techLoadStatusKinds;
  if (!kinds || (workspace?.techLoadStatusKindsVersion ?? 0) >= 2) return kinds;
  const next = { ...kinds };
  for (const option of workspace?.statusOptions ?? []) {
    if (next[option.value] === "busy" && autoTechLoadKind(option.label, option.value) === "payment") delete next[option.value];
  }
  return next;
}

export interface TechLoadSummary {
  total: number;
  busy: number;
  free: number;
  rework: number;
  freeze: number;
  /** «Ждём оплату» — separate, never busy. */
  payment: number;
  /** Finished orders: `free` statuses except cancelled ones and orders without a status. */
  done: number;
}

export const EMPTY_TECH_LOAD: TechLoadSummary = { total: 0, busy: 0, free: 0, rework: 0, freeze: 0, payment: 0, done: 0 };

function findStatusOption(raw: string, statusOptions: StatusOption[]): StatusOption | undefined {
  const lower = raw.toLowerCase();
  return statusOptions.find((o) => o.value === raw) ?? statusOptions.find((o) => o.label.toLowerCase() === lower);
}

/**
 * Classifies a desk's raw status counts with the CURRENT status list and
 * mapping. A raw value is matched by option value first, then by label
 * (legacy rows stored the label); an empty status never makes anyone busy.
 */
export function summarizeDeskLoad(
  load: Pick<DeskLoad, "total" | "statusCounts">,
  statusOptions: StatusOption[],
  kinds: Record<string, TechLoadKind> | undefined
): TechLoadSummary {
  const summary: TechLoadSummary = { ...EMPTY_TECH_LOAD, total: load.total };
  for (const [raw, count] of Object.entries(load.statusCounts)) {
    if (raw === NO_STATUS_KEY) {
      summary.free += count;
      continue;
    }
    const option = findStatusOption(raw, statusOptions);
    const kind = option ? techLoadKindForOption(option, kinds) : autoTechLoadKind(raw, raw);
    summary[kind] += count;
    if (kind === "free" && !isCancelledStatus(option?.label ?? raw, option?.value ?? raw)) summary.done += count;
  }
  return summary;
}

export function addTechLoad(a: TechLoadSummary, b: TechLoadSummary): TechLoadSummary {
  return {
    total: a.total + b.total,
    busy: a.busy + b.busy,
    free: a.free + b.free,
    rework: a.rework + b.rework,
    freeze: a.freeze + b.freeze,
    payment: a.payment + b.payment,
    done: a.done + b.done,
  };
}

export function addStatusCounts(into: Record<string, number>, counts: Record<string, number> | undefined) {
  for (const [key, n] of Object.entries(counts ?? {})) into[key] = (into[key] ?? 0) + n;
  return into;
}

export interface StatusBreakdownItem {
  key: string;
  label: string;
  /** HSL triplet, or null for «Без статуса». */
  color: string | null;
  count: number;
  kind: TechLoadKind;
}

/** Every status with orders, in the order of the shared status list; unknown legacy values last. */
export function statusBreakdown(
  statusCounts: Record<string, number>,
  statusOptions: StatusOption[],
  kinds: Record<string, TechLoadKind> | undefined
): StatusBreakdownItem[] {
  const merged = new Map<string, StatusBreakdownItem & { rank: number }>();
  for (const [raw, count] of Object.entries(statusCounts)) {
    if (!count) continue;
    if (raw === NO_STATUS_KEY) {
      const item = merged.get(NO_STATUS_KEY);
      if (item) item.count += count;
      else merged.set(NO_STATUS_KEY, { key: NO_STATUS_KEY, label: "Без статуса", color: null, count, kind: "free", rank: Number.MAX_SAFE_INTEGER });
      continue;
    }
    const option = findStatusOption(raw, statusOptions);
    const key = option?.value ?? raw;
    const existing = merged.get(key);
    if (existing) {
      existing.count += count;
      continue;
    }
    merged.set(key, {
      key,
      label: option?.label ?? raw,
      color: option?.color ?? null,
      count,
      kind: option ? techLoadKindForOption(option, kinds) : autoTechLoadKind(raw, raw),
      rank: option ? statusOptions.indexOf(option) : statusOptions.length,
    });
  }
  return [...merged.values()]
    .sort((a, b) => a.rank - b.rank || b.count - a.count)
    .map((item) => ({ key: item.key, label: item.label, color: item.color, count: item.count, kind: item.kind }));
}
