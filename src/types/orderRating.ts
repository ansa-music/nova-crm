/**
 * Оценка за КОНКРЕТНЫЙ заказ — вторая, независимая шкала рядом с общей
 * оценкой технаря (`TechRating`). Общая — «как мне работается с этим
 * технарём вообще», одна на пару ОС↔Технарь. Эта — «как сделан вот этот
 * заказ», одна на заказ, и их у пары может быть сколько угодно.
 *
 * Doc id — `${pageId}_${rowId}`: заказ живёт ровно в одной строке одного
 * стола, поэтому оценка у него одна, и ставит её тот ОС, чей ник стоит в
 * заказе. Правила проверяют ник так же, как у общей оценки — через
 * `deskLoad.osLastOrderAt`, потому что самой строки ОС не видит.
 *
 * `monthKey` — месяц, за который заказ считается. Месяц берётся из вкладки
 * стола, в которой заказ лежит, а не из даты оценки: заказ конца месяца,
 * оценённый первого числа, всё равно относится к своему месяцу.
 */
export interface OrderRating {
  id: string;
  workspaceId: string;
  pageId: string;
  rowId: string;
  osUid: string;
  /** Ник ОС (значение варианта «Ответственный») на момент оценки. */
  osValue: string;
  technicianUid: string;
  stars: number;
  /** «YYYY-MM» месячной вкладки, в которой лежит заказ. */
  monthKey: string;
  /** Снимок названия заказа — чтобы оценку было видно и без доступа к строке. */
  title: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Сумма и количество оценок за заказы одной пары ОС↔Технарь ЗА ОДИН МЕСЯЦ,
 * doc id `${osUid}_${technicianUid}_${monthKey}` — как у `TechRating`.
 *
 * Отдельный маленький документ, а не подсчёт по всей коллекции
 * `orderRatings`: та растёт на каждый оценённый заказ и за год превращается
 * в тысячи документов, а «Дашборд» и «Технари» показывают рейтинг ВСЕМ.
 * Читать ради среднего всю историю — прямой путь в лимиты Spark (см.
 * CLAUDE.md про onSnapshot). Здесь документов ровно столько же, сколько
 * общих оценок, и содержимого заказов в них нет — поэтому читать их может
 * любой участник, в отличие от самих `orderRatings`.
 */
export interface OrderRatingTotals {
  id: string;
  workspaceId: string;
  osUid: string;
  technicianUid: string;
  /** «YYYY-MM» — итоги считаются заново каждый месяц. */
  monthKey: string;
  /** Сколько заказов этого месяца этот ОС оценил у этого технаря. */
  count: number;
  /** Сумма звёзд — среднее считается как sum / count. */
  sum: number;
  updatedAt: number;
}

export const ORDER_RATING_MAX = 5;

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
