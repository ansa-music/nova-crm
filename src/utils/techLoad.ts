import { isDoneStatusLabel, isFreezeStatusLabel } from "@/utils/columnOptions";
import type { DeskLoad, PageColumn, PageRow, StatusOption, TechLoadKind } from "@/types";

/**
 * Key for orders with an empty status. Not "__none__": Firestore reserves
 * field names matching __.*__.
 */
export const NO_STATUS_KEY = "_none";

function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  return String(value).trim() !== "";
}

/** Order counts for one desk tab. A row counts as an order once any cell is filled — a blank row isn't an order. */
export function countDeskLoad(columns: PageColumn[], rows: PageRow[]): Pick<DeskLoad, "total" | "statusCounts"> {
  const statusCol = columns.find((c) => c.type === "status");
  const statusCounts: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    const cells = row.cells ?? {};
    if (!Object.values(cells).some(isFilled)) continue;
    total += 1;
    const raw = statusCol ? String(cells[statusCol.key] ?? "").trim() : "";
    const key = raw || NO_STATUS_KEY;
    statusCounts[key] = (statusCounts[key] ?? 0) + 1;
  }
  return { total, statusCounts };
}

/** Stable comparison key — publish only when the numbers actually changed. */
export function deskLoadSignature(load: Pick<DeskLoad, "total" | "statusCounts" | "subPageId" | "monthKey">): string {
  const counts = Object.entries(load.statusCounts).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([load.monthKey, load.subPageId, load.total, counts]);
}

export const TECH_LOAD_KIND_LABELS: Record<TechLoadKind, string> = {
  free: "Свободен",
  busy: "Занят",
  rework: "Переделка",
  freeze: "Заморозка",
};

/** Label-based default: «Заморозка», «Переделка», done-like and cancelled statuses; anything else is work in progress. */
export function autoTechLoadKind(label: string, value: string): TechLoadKind {
  const l = label.toLowerCase();
  if (isFreezeStatusLabel(label) || value === "freeze") return "freeze";
  if (l.includes("передел")) return "rework";
  if (isDoneStatusLabel(label) || value === "done") return "free";
  if (l.includes("отмен") || l.includes("cancel") || value === "cancelled") return "free";
  return "busy";
}

export function techLoadKindForOption(option: StatusOption, kinds: Record<string, TechLoadKind> | undefined): TechLoadKind {
  return kinds?.[option.value] ?? autoTechLoadKind(option.label, option.value);
}

export interface TechLoadSummary {
  total: number;
  busy: number;
  free: number;
  rework: number;
  freeze: number;
}

export const EMPTY_TECH_LOAD: TechLoadSummary = { total: 0, busy: 0, free: 0, rework: 0, freeze: 0 };

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
    let kind: TechLoadKind;
    if (raw === NO_STATUS_KEY) {
      kind = "free";
    } else {
      const lower = raw.toLowerCase();
      const option =
        statusOptions.find((o) => o.value === raw) ?? statusOptions.find((o) => o.label.toLowerCase() === lower);
      kind = option ? techLoadKindForOption(option, kinds) : autoTechLoadKind(raw, raw);
    }
    summary[kind] += count;
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
  };
}
