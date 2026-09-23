import { parseLooseNumber } from "@/utils/numberInput";
import type { PageRow, PaymentMethod, Workspace } from "@/types";

/**
 * Касса ОС: способы оплаты, комиссия и «Итого» строки стола ОС.
 *
 * «Итого» = цена за вычетом комиссии её способа + апсейл за вычетом комиссии
 * его способа. Эта сумма и уезжает технарю как цена заказа — по ней считается
 * касса технаря (загрузка, «Готово», рейтинг и премии).
 *
 * Считается ТОЛЬКО по самой строке (сумма и снимок комиссии в ячейке `__fee`),
 * без текущих настроек: подпись выдачи технарю (`mirrorSyncHash`) обязана быть
 * одинаковой при каждом расчёте, а правка процента Owner'ом не должна молча
 * пересылать технарям все заказы месяца с новыми суммами.
 */

export const DEFAULT_PAYMENT_METHODS: PaymentMethod[] = [
  { id: "kaspi", label: "Kaspi", commissionPct: 0, color: "#f14635" },
  { id: "lavatop", label: "Lavatop", commissionPct: 8, color: "#7c5cff" },
];

/** Премии за 1-е, 2-е и 3-е место по «Готово». */
export const DEFAULT_TECH_BONUSES = [100_000, 50_000, 50_000];

export function paymentMethodsOf(workspace: Pick<Workspace, "paymentMethods"> | null | undefined): PaymentMethod[] {
  return workspace?.paymentMethods ?? DEFAULT_PAYMENT_METHODS;
}

export function techBonusesOf(workspace: Pick<Workspace, "techBonuses"> | null | undefined): number[] {
  const list = workspace?.techBonuses;
  if (!list || list.length === 0) return DEFAULT_TECH_BONUSES;
  return list.map((n) => (Number.isFinite(n) && n > 0 ? Math.round(n) : 0));
}

/** Ячейка со способом оплаты денежного столбца. */
export function payKeyOf(colKey: string): string {
  return `${colKey}__pay`;
}

/** Ячейка со снимком комиссии способа (проценты). */
export function feeKeyOf(colKey: string): string {
  return `${colKey}__fee`;
}

function amountOf(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined || value === "") return 0;
  return parseLooseNumber(String(value)) ?? 0;
}

/** Комиссия, записанная в строке для этого столбца (0, если способа нет). */
export function rowFeePct(row: Pick<PageRow, "cells">, colKey: string): number {
  const fee = amountOf(row.cells[feeKeyOf(colKey)]);
  return Math.min(100, Math.max(0, fee));
}

/** Сумма столбца после комиссии его способа. */
export function netOf(row: Pick<PageRow, "cells">, colKey: string): number {
  return amountOf(row.cells[colKey]) * (1 - rowFeePct(row, colKey) / 100);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * «Итого» строки стола ОС: (цена − комиссия) + (апсейл − комиссия).
 * null — денег в строке нет вовсе (пустой слот, заказ без суммы).
 */
export function osRowTotal(row: Pick<PageRow, "cells">, keys: { price: string; upsell: string }): number | null {
  const gross = amountOf(row.cells[keys.price]) + amountOf(row.cells[keys.upsell]);
  if (gross === 0) return null;
  return round2(netOf(row, keys.price) + netOf(row, keys.upsell));
}

/** Сколько съела комиссия в строке (для подсказки «−12 000 комиссия»). */
export function osRowFees(row: Pick<PageRow, "cells">, keys: { price: string; upsell: string }): number {
  const gross = amountOf(row.cells[keys.price]) + amountOf(row.cells[keys.upsell]);
  const total = osRowTotal(row, keys) ?? 0;
  return round2(gross - total);
}

/** «−8 %» / «без комиссии». */
export function formatFee(pct: number): string {
  if (!pct) return "без комиссии";
  return `−${String(round2(pct)).replace(".", ",")} %`;
}

/** Способ по id; вариант, которого уже нет в списке, показываем по id. */
export function findPaymentMethod(methods: readonly PaymentMethod[], id: unknown): PaymentMethod | null {
  if (!id) return null;
  return methods.find((m) => m.id === id) ?? null;
}

/** Ячейки, которые пишет выбор способа: id, снимок комиссии. */
export function paymentPatch(colKey: string, method: PaymentMethod | null): Record<string, string | number | null> {
  return {
    [payKeyOf(colKey)]: method ? method.id : null,
    [feeKeyOf(colKey)]: method ? round2(method.commissionPct) : null,
  };
}

/** Приводит список из редактора к виду для записи: имена, проценты, уникальные id. */
export function sanitizePaymentMethods(list: readonly PaymentMethod[]): PaymentMethod[] {
  const seen = new Set<string>();
  const out: PaymentMethod[] = [];
  for (const m of list) {
    const label = m.label.trim().slice(0, 40);
    if (!label) continue;
    let id = (m.id || label).toLowerCase().replace(/[^a-z0-9а-яё_-]+/gi, "-").replace(/^-+|-+$/g, "") || "pm";
    while (seen.has(id)) id = `${id}-2`;
    seen.add(id);
    const pct = Number.isFinite(m.commissionPct) ? Math.min(100, Math.max(0, round2(m.commissionPct))) : 0;
    const item: PaymentMethod = { id, label, commissionPct: pct };
    // undefined в элементе массива роняет запись всего списка — ключи без значения не пишем.
    if (m.color) item.color = m.color;
    if (m.inactive) item.inactive = true;
    out.push(item);
  }
  return out;
}
