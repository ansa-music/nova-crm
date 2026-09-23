import { findQuickOrderColumns, mergeColumnPicks } from "@/utils/quickOrder";
import type { OsFieldKeys, PageColumn } from "@/types";

/**
 * Карта «роль → ключ столбца» для месячной вкладки стола технаря.
 *
 * Считается ровно теми же правилами, что подбирает столбцы «Быстрый заказ» и
 * заезд заказа с биржи (`findQuickOrderColumns`) — второй набор правил «какой
 * столбец считать номером» разошёлся бы с первым за месяц. Сверху — столбец
 * статуса: его `findQuickOrderColumns` не ищет, а зеркалу он нужен больше
 * всего (статус меняет только ОС).
 *
 * Скрытые столбцы В КАРТУ ВХОДЯТ: спрятали «Цену» — значение всё равно должно
 * попасть в неё, иначе суммы стола и дашборда недосчитаются (этим уже
 * ошибались в `takeOrderToDesk`).
 */
export function computeOsFieldKeys(tabId: string, columns: PageColumn[], now: number): OsFieldKeys {
  // Ровно как у заезда заказа с биржи (`mergeColumnPicks`): сначала видимые,
  // следом скрытые. Фильтр «только видимые» тут уже стоял и врал комментарию
  // выше: стол со СПРЯТАННЫМ «Ответственным» отдавал карту без ключа `os`,
  // и заказ уезжал технарю без ника ОС — а `osColumnsOf` скрытый столбец
  // читает, то есть в счётчиках ОС этот заказ и не появлялся.
  const forPick = mergeColumnPicks(columns.filter((c) => !c.hidden), columns);
  const picked = findQuickOrderColumns(forPick);
  const status = forPick.find((c) => c.type === "status");
  const map: OsFieldKeys = { tabId, at: now };
  if (picked.client) map.client = picked.client.key;
  if (picked.number) map.phone = picked.number.key;
  if (picked.receipt) map.price = picked.receipt.key;
  if (status) map.status = status.key;
  if (picked.os) map.os = picked.os.key;
  if (picked.link) map.link = picked.link.key;
  if (picked.date) map.date = picked.date.key;
  if (picked.deadline) map.deadline = picked.deadline.key;
  if (picked.persons) map.persons = picked.persons.key;
  if (picked.minutes) map.minutes = picked.minutes.key;
  return map;
}

/** Одинаковы ли карты по СУТИ — время `at` не считаем. */
export function sameOsFieldKeys(a: OsFieldKeys | undefined, b: OsFieldKeys): boolean {
  if (!a) return false;
  const keys: Array<keyof OsFieldKeys> = [
    "tabId",
    "client",
    "phone",
    "price",
    "status",
    "os",
    "link",
    "date",
    "deadline",
    "persons",
    "minutes",
  ];
  return keys.every((k) => (a[k] ?? null) === (b[k] ?? null));
}
