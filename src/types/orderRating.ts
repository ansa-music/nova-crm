/**
 * Оценка заказа — ЕДИНСТВЕННАЯ оценка технаря (просьба Nurba 25.09.2026:
 * «оставь только одну систему — оценка на каждый заказ, 10-балльная»).
 * Общей оценки «ОС → технарь за месяц» больше нет.
 *
 * Ставит её ОС этого заказа: в Supabase (`order_ratings`, функция
 * `rate_order`) право проверяет база по САМОЙ строке заказа, в Firestore
 * (откат, пока SQL не вставлен) — правила через `deskLoad.osLastOrderAt`.
 *
 * `id` на клиенте — `${pageId}_${rowId}`: заказ живёт ровно в одной строке
 * одного стола. `monthKey` — месяц вкладки заказа, а не день оценки.
 */
export interface OrderRating {
  id: string;
  workspaceId: string;
  pageId: string;
  /** Вкладка строки ('' — «Основная» или неизвестна у старых оценок Firestore). */
  tabId: string;
  rowId: string;
  osUid: string;
  /** Ник ОС (значение варианта «Ответственный») на момент оценки. */
  osValue: string;
  technicianUid: string;
  /** 1–10. Старые оценки Firestore по 5-балльной шкале приходят уже ×2. */
  score: number;
  /** «YYYY-MM» месячной вкладки, в которой лежит заказ. */
  monthKey: string;
  /** Снимок названия заказа — чтобы оценку было видно и без доступа к строке. */
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Где лежит: снять/сменить её надо там же. */
  source: "supabase" | "firestore";
}

/**
 * Сумма и число оценок одной пары ОС↔Технарь за месяц — по ним «Технари» и
 * «Дашборд» показывают средний балл ВСЕМ, не читая сами оценки (в них
 * названия заказов). Сумма — всегда в 10-балльной шкале.
 */
export interface OrderRatingTotals {
  id: string;
  osUid: string;
  technicianUid: string;
  /** «YYYY-MM» — итоги считаются заново каждый месяц. */
  monthKey: string;
  count: number;
  sum: number;
}

export const ORDER_RATING_MAX = 10;

/** Среднее по набору «сумма/количество»; null, когда оценок нет. */
export function averageOfTotals(totals: readonly OrderRatingTotals[]): number | null {
  let count = 0;
  let sum = 0;
  for (const t of totals) {
    count += t.count;
    sum += t.sum;
  }
  return count > 0 ? sum / count : null;
}

/** «8,5» — балл с одним знаком, без лишнего нуля. */
export function formatScore(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace(".", ",");
}
