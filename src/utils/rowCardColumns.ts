import { isOptionColumn } from "@/utils/columnOptions";
import type { PageColumn } from "@/types";

export interface RowCardColumns {
  /** Первый «человеческий» текстовый столбец — «Клиент»/«Название». */
  title?: PageColumn;
  currency?: PageColumn;
  responsible?: PageColumn;
  date?: PageColumn;
  phone?: PageColumn;
  status?: PageColumn;
}

/**
 * Какие столбцы показывать на карточке заказа. Один источник правды для
 * канбана и списка карточек: раньше эвристика жила внутри `KanbanView`, и
 * второй экран с карточками неизбежно разошёлся бы с ним в мелочах —
 * например, показывал бы в заголовке телефон, потому что «первый текстовый».
 */
export function pickRowCardColumns(columns: PageColumn[]): RowCardColumns {
  const isPlainText = (c: PageColumn) =>
    !isOptionColumn(c.type) &&
    c.type !== "date" &&
    c.type !== "url" &&
    c.type !== "phone" &&
    c.type !== "email" &&
    c.type !== "number" &&
    c.type !== "currency";
  return {
    title: columns.find(isPlainText) ?? columns.find((c) => !isOptionColumn(c.type)),
    currency: columns.find((c) => c.type === "currency"),
    responsible: columns.find((c) => c.type === "responsible"),
    date: columns.find((c) => c.type === "date"),
    phone: columns.find((c) => c.type === "phone"),
    status: columns.find((c) => c.type === "status"),
  };
}
