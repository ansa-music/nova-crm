import { TECH_LINK_KEY, TECH_NOTE_KEY } from "@/utils/reservedCellKeys";
import type { PageRow } from "@/types";

/**
 * Строка-заказ, которую ведёт ОС.
 *
 * Правило одно и то же на клиенте и в базе, но держит его БАЗА (политики
 * `desk_rows` и триггер `desk_rows_guard`): технарь — ответственный за свой
 * стол, и запрет, живущий только в кнопках, он обошёл бы. Здесь — чтобы
 * человек видел замок сразу, а не ловил отказ после ввода: `useCellCommit`
 * при ошибке НЕ откатывает введённое, и «молчаливый» запрет выглядел бы как
 * «значение сохранилось, а потом само пропало».
 */

/** Что технарь всё-таки пишет в своей строке-заказе. */
export const TECH_EDITABLE_CELL_KEYS: readonly string[] = [TECH_LINK_KEY, TECH_NOTE_KEY];

export interface RowViewer {
  uid: string;
  /** Owner workspace — может всё, включая снятие управления. */
  isOwner: boolean;
  /** Тимлид — ставит «Успешку» по просьбе технаря (только статус). */
  isTeamLead: boolean;
}

export function isManagedRow(row: Pick<PageRow, "osUid"> | null | undefined): boolean {
  return Boolean(row?.osUid);
}

/** Почему ячейку нельзя править. null — можно. */
export function cellLockReason(
  row: Pick<PageRow, "osUid" | "statusKey"> | null | undefined,
  colKey: string,
  viewer: RowViewer
): string | null {
  if (!row?.osUid) return null;
  if (viewer.isOwner) return null;
  if (row.osUid === viewer.uid) return null;
  if (TECH_EDITABLE_CELL_KEYS.includes(colKey)) return null;
  if (viewer.isTeamLead && row.statusKey && colKey === row.statusKey) return null;
  if (viewer.isTeamLead) return "В заказе ОС Тимлид меняет только статус";
  return "Этот заказ ведёт ОС — статус, сумму и клиента меняет он";
}

/** Почему строку нельзя удалить. null — можно. */
export function rowDeleteLockReason(row: Pick<PageRow, "osUid"> | null | undefined, viewer: RowViewer): string | null {
  if (!row?.osUid) return null;
  if (viewer.isOwner || row.osUid === viewer.uid) return null;
  return "Заказ убирает ОС, который его завёл";
}
