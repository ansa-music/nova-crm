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

/**
 * Стол работает в режиме «заказы ведёт ОС» (`workspace.osManagedDesks`).
 * Приходит только для столов ТЕХНАРЕЙ: свой стол ОС ведёт сам, а Owner не
 * ограничен вовсе.
 */
export interface OsManagedContext {
  osManaged?: boolean;
  /**
   * Технарь заполняет этот стол сам (Owner включил «технари заполняют сами»
   * для всех или для этого стола — `workspace.techFillsAll` / `page.techEditable`):
   * ячейки строк-заказов ОС он тоже правит, статус проход стола ОС подтянет к
   * ОС. В базе то же держит ветка `rows_tech_fills` в `desk_rows_guard`
   * (20261001_tech_fill.sql).
   */
  techFills?: boolean;
}

/** Почему ячейку нельзя править. null — можно. */
export function cellLockReason(
  row: Pick<PageRow, "osUid" | "statusKey"> | null | undefined,
  colKey: string,
  viewer: RowViewer,
  ctx?: OsManagedContext
): string | null {
  // «Заказы ведёт ОС»: в столе технаря ему остаются ровно свои два поля — и
  // в перенесённых заказах, и в старых строках, которые перенести не вышло.
  // Человеку обещали правило целиком, а не «в части строк»; в базе его держат
  // триггеры desk_rows_guard и desk_rows_os_managed.
  if (ctx?.osManaged && !viewer.isOwner && !viewer.isTeamLead && row?.osUid !== viewer.uid) {
    if (!TECH_EDITABLE_CELL_KEYS.includes(colKey)) {
      return "Заказы ведёт ОС — статус и сумму меняет он. В карточке строки можно попросить «Успешку»";
    }
    return null;
  }
  if (!row?.osUid) return null;
  if (viewer.isOwner) return null;
  if (row.osUid === viewer.uid) return null;
  if (TECH_EDITABLE_CELL_KEYS.includes(colKey)) return null;
  // Тимлид и здесь ставит только статус — его ветка в базе стоит раньше.
  if (ctx?.techFills && !viewer.isTeamLead) return null;
  if (viewer.isTeamLead && row.statusKey && colKey === row.statusKey) return null;
  if (viewer.isTeamLead) return "В заказе ОС Тимлид меняет только статус";
  return "Этот заказ ведёт ОС — статус, сумму и клиента меняет он";
}

/** Почему строку нельзя удалить. null — можно. */
export function rowDeleteLockReason(
  row: Pick<PageRow, "osUid" | "cells"> | null | undefined,
  viewer: RowViewer,
  ctx?: OsManagedContext
): string | null {
  if (row?.osUid) {
    if (viewer.isOwner || row.osUid === viewer.uid) return null;
    return "Заказ убирает ОС, который его завёл";
  }
  // Удаление — обход замка в два шага: убрать строку и завести заново с
  // нужным статусом. Поэтому под «заказы ведёт ОС» технарь удаляет только
  // пустые слоты (то же правило — в политике desk_rows_delete_os_managed).
  if (ctx?.osManaged && !viewer.isOwner && !viewer.isTeamLead) {
    const filled = Object.values(row?.cells ?? {}).some((v) => String(v ?? "").trim() !== "");
    if (filled) return "Заказы ведёт ОС — строку убирает он";
  }
  return null;
}
