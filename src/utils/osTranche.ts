import type { PageRow } from "@/types";
import { cellMillis } from "@/utils/osDates";
import { OS_TRANCHE2_KEY, OS_TRANCHE2_ON_KEY } from "@/utils/reservedCellKeys";

/**
 * Второй транш заказа — ЛИЧНАЯ пометка ОС на его столе (просьба Nurba
 * 30.09.2026: «это только осникам, чтобы им удобно было; к технарям и в
 * систему уходит общая сумма»). Клиент платит цену в два захода, и ОС
 * отмечает у себя: сколько придёт вторым траншем и принял ли он его.
 *
 * Хранится двумя служебными ячейками строки стола ОС (`osTranche2` — сумма,
 * `osTranche2On` — день приёма, полдень по Алматы). Технарю они не уходят
 * (`buildMirrorCells` копирует только свои поля), кассу, ABS и счётчики не
 * меняют — там цена и апсейл, как раньше.
 */

export type TrancheState = "none" | "waiting" | "paid";

export interface TrancheInfo {
  /** Сумма второго транша; null — не указана. */
  amount: number | null;
  /** День приёма (мс, полдень по Алматы); null — ещё не принят. */
  paidOn: number | null;
  /** none — транша нет; waiting — указан, не принят; paid — принят. */
  state: TrancheState;
}

function amountOf(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const raw = typeof value === "number" ? value : Number(String(value).replace(/[\s ]/g, "").replace(",", "."));
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw * 100) / 100 : null;
}

export function trancheOf(row: Pick<PageRow, "cells"> | null | undefined): TrancheInfo {
  const amount = amountOf(row?.cells?.[OS_TRANCHE2_KEY]);
  const paidOn = cellMillis(row?.cells?.[OS_TRANCHE2_ON_KEY]);
  // Отметка «принят» без суммы тоже считается: ОС мог отметить и не вписать.
  const state: TrancheState = paidOn !== null ? "paid" : amount !== null ? "waiting" : "none";
  return { amount, paidOn, state };
}

/**
 * Ячейки для записи: переданное поле пишется, `null` стирает, не переданное
 * не трогается. Сумму «0» или пустую строку пишем как стирание.
 */
export function tranchePatch(input: { amount?: number | null; paidOn?: number | null }): Record<string, string | null> {
  const patch: Record<string, string | null> = {};
  if ("amount" in input) {
    const a = input.amount;
    patch[OS_TRANCHE2_KEY] = a !== null && a !== undefined && Number.isFinite(a) && a > 0 ? String(Math.round(a * 100) / 100) : null;
  }
  if ("paidOn" in input) {
    const d = input.paidOn;
    patch[OS_TRANCHE2_ON_KEY] = d !== null && d !== undefined && Number.isFinite(d) && d > 0 ? String(d) : null;
  }
  return patch;
}

/** Стереть транш целиком. */
export function trancheClearPatch(): Record<string, null> {
  return { [OS_TRANCHE2_KEY]: null, [OS_TRANCHE2_ON_KEY]: null };
}

export interface TrancheTotals {
  waitingCount: number;
  waitingSum: number;
  paidCount: number;
  paidSum: number;
}

/** Итоги по строкам: сколько вторых траншей ждём и сколько уже приняли. */
export function trancheTotals(rows: ReadonlyArray<Pick<PageRow, "cells">>): TrancheTotals {
  const t: TrancheTotals = { waitingCount: 0, waitingSum: 0, paidCount: 0, paidSum: 0 };
  for (const row of rows) {
    const info = trancheOf(row);
    if (info.state === "waiting") {
      t.waitingCount += 1;
      t.waitingSum += info.amount ?? 0;
    } else if (info.state === "paid") {
      t.paidCount += 1;
      t.paidSum += info.amount ?? 0;
    }
  }
  t.waitingSum = Math.round(t.waitingSum * 100) / 100;
  t.paidSum = Math.round(t.paidSum * 100) / 100;
  return t;
}

/** Разбор суммы, введённой человеком («50 000», «50000,5»); пусто/0 — null. */
export function parseTrancheAmount(raw: string): number | null {
  return amountOf(raw.trim());
}
