import type { HistoryEntry } from "@/types";

/**
 * Документ коллекции `history` бывает ДВУХ видов, и это сознательно:
 *
 * - старый — одна запись прямо в документе (так писали до сентября 2026);
 * - новый — пачка `entries`, несколько изменений в ОДНОМ документе.
 *
 * Пачки появились ради квоты бесплатного Firebase: она считается по
 * ДОКУМЕНТАМ, а не по вызовам, поэтому writeBatch из тридцати записей стоит
 * ровно тридцать записей и ничего не экономит. Экономит только объединение
 * изменений в один документ — правка ячейки перестала стоить две записи
 * (строка + история). Старые документы переписывать не стали: их сотни, а
 * читаются они одной и той же функцией.
 */
export function expandHistoryDoc(docId: string, data: Record<string, unknown>): HistoryEntry[] {
  const batch = data.entries;
  if (!Array.isArray(batch)) return [{ ...(data as unknown as HistoryEntry), id: docId }];
  return batch
    .filter((entry): entry is HistoryEntry => Boolean(entry) && typeof entry === "object")
    // id нужен ключом в списке: у записи он есть свой, но документ мог приехать
    // и без него (запись пачки — чужой код мог положить что угодно).
    .map((entry, index) => ({ ...entry, id: entry.id || `${docId}_${index}` }));
}

/** Пачки приходят по времени ПОСЛЕДНЕЙ записи — внутри порядок восстанавливаем сами. */
export function sortHistoryDesc(rows: HistoryEntry[], max: number): HistoryEntry[] {
  return [...rows].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0)).slice(0, max);
}
