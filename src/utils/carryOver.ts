import { isBlankRow } from "@/utils/blankRow";
import { isApprovalStatusValue, isDoneStatusLabel } from "@/utils/columnOptions";
import { techLoadKindForOption } from "@/utils/techLoad";
import type { PageColumn, PageRow, StatusOption, TechLoadKind } from "@/types";

/**
 * Что переносить в новый период (просьба Nurba 26.09.2026). Чистый модуль —
 * гоняется в esbuild-риге без Firebase.
 *
 *  • unfinished — в работе: пустой статус / «Утверждение», виды busy /
 *    rework / freeze по тем же правилам, что «Технари»; переносятся по умолчанию;
 *  • payment — «Ждём оплату»: работа сделана, деньги придут за прошлый
 *    период — по умолчанию НЕ переносим, но отметить можно;
 *  • done / cancelled — остаются в прошлом периоде и в окне не показываются.
 * Пустые строки-слоты (isBlankRow) — не заказы.
 */
export interface CarryGroups {
  unfinished: PageRow[];
  payment: PageRow[];
  done: PageRow[];
  cancelled: PageRow[];
}

function isCancelledLabel(label: string, value: string): boolean {
  const l = label.toLowerCase();
  return l.includes("отмен") || l.includes("cancel") || value === "cancelled";
}

export function classifyCarryCandidates(
  rows: readonly PageRow[],
  columns: readonly PageColumn[],
  statusOptions: readonly StatusOption[],
  kinds: Record<string, TechLoadKind> | undefined
): CarryGroups {
  const statusCol = columns.find((c) => c.type === "status");
  const byValue = new Map(statusOptions.map((o) => [o.value, o]));
  const byLabel = new Map(statusOptions.map((o) => [o.label.trim().toLowerCase(), o]));
  const groups: CarryGroups = { unfinished: [], payment: [], done: [], cancelled: [] };
  const optionList = [...statusOptions];
  for (const row of rows) {
    if (isBlankRow(row)) continue;
    const raw = statusCol ? String(row.cells?.[statusCol.key] ?? "").trim() : "";
    if (!raw || isApprovalStatusValue(raw, optionList)) {
      groups.unfinished.push(row);
      continue;
    }
    const option = byValue.get(raw) ?? byLabel.get(raw.toLowerCase());
    const label = option?.label ?? raw;
    const value = option?.value ?? raw;
    const kind = option ? techLoadKindForOption(option, kinds) : techLoadKindForOption({ value, label, color: "" }, kinds);
    if (kind === "payment") groups.payment.push(row);
    else if (kind === "free") {
      if (isDoneStatusLabel(label) || value === "done") groups.done.push(row);
      else if (isCancelledLabel(label, value)) groups.cancelled.push(row);
      else groups.unfinished.push(row);
    } else groups.unfinished.push(row);
  }
  return groups;
}

/** Что отмечено по умолчанию — всё «в работе». */
export function carryDefaultIds(groups: CarryGroups): Set<string> {
  return new Set(groups.unfinished.map((r) => r.id));
}

/** Подпись перенесённой строки: имя вкладки-источника по id, иначе «прошлый период». */
export function carriedLabel(row: Pick<PageRow, "carriedFrom">, tabNames?: Readonly<Record<string, string>>): string | null {
  if (!row.carriedFrom) return null;
  return tabNames?.[row.carriedFrom] ?? "прошлый период";
}

/** Ключ «Не сейчас» плашки переноса — на вкладку браузера. */
export function carryDismissKey(pageId: string, tabId: string): string {
  return `nova:carry-dismissed:${pageId}:${tabId}`;
}

/** Строка менялась только что — гонка с проходом стола ОС; в окне такие не предлагаем. */
export const CARRY_SETTLE_MS = 30_000;
