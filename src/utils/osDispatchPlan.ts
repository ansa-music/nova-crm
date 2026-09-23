import { buildMirrorCells, mirrorSyncHash } from "@/services/rows/osOrderMirror";
import type { MirrorInput } from "@/services/rows/osOrderMirror";
import type { OsFieldKeys, PageRow } from "@/types";

/**
 * Что делать со строкой стола ОС в очередном проходе (см. useOsDeskDispatch).
 *
 * Чистая функция: весь спор «кто главный — стол ОС или стол технаря»
 * решается здесь, и его можно проверить без базы.
 *
 * - `push` — заказ уезжает технарю: его ещё нет у него, либо ОС что-то
 *   поменял у себя (подпись `syncHash` разошлась с посчитанной сейчас);
 * - `pull` — статус поменяли в строке технаря (Тимлид поставил «Успешку»,
 *   Owner закрыл заказ), и его надо показать у ОС;
 * - `none` — всё сходится;
 * - `wait` — это ещё не заказ (нет технаря или имени клиента).
 */
export type OsDispatchAction = "push" | "pull" | "none" | "wait";

export interface OsDispatchPlan {
  action: OsDispatchAction;
  /** Статус, который поедет технарю (для `push`) или к ОС (для `pull`). */
  status: string;
  /** Подпись зеркалируемых полей после действия. */
  hash: string;
  /** Был ли заказ уже выдан — для тоста «Заказ у технаря». */
  hadMirror: boolean;
}

export interface OsDispatchInput {
  row: PageRow;
  /** Строка этого заказа в столе технаря, если он уже выдан. */
  mirror: PageRow | null;
  keys: OsFieldKeys;
  osColumns: MirrorInput["osColumns"];
  osNickValue: string;
  /** Ключ столбца статуса НА СТОЛЕ ОС. */
  osStatusKey: string | null;
  /** Ник технаря из строки (пусто — заказ ещё никому не адресован). */
  techNick: string;
  /** Имя клиента из строки. */
  client: string;
  /** Статус для нового заказа, если ни у кого его ещё нет («В работе»). */
  fallbackStatus: string;
}

export function planOsDispatch(input: OsDispatchInput): OsDispatchPlan {
  const { row, mirror, osStatusKey } = input;
  const mine = osStatusKey ? String(row.cells[osStatusKey] ?? "").trim() : "";
  const theirs = mirror?.statusKey ? String(mirror.cells[mirror.statusKey] ?? "").trim() : "";
  const hadMirror = Boolean(mirror);

  // Ещё не заказ: без технаря отправлять некуда, без имени — нечего.
  if (!input.techNick || (!input.client && !mirror)) {
    return { action: "wait", status: mine, hash: row.syncHash ?? "", hadMirror };
  }

  /**
   * Подпись считается ТОЛЬКО по своим полям — статус у технаря в неё не
   * входит. Иначе «Успешка», поставленная Тимлидом, меняла бы подпись, проход
   * счёл бы это правкой ОС и отправил бы технарю обратно его же старый
   * статус, затерев решение руководства.
   */
  const hashOf = (status: string, cellsOverride?: Record<string, string>) =>
    mirrorSyncHash(
      buildMirrorCells({
        source: cellsOverride ? ({ ...row, cells: { ...row.cells, ...cellsOverride } } as PageRow) : row,
        osColumns: input.osColumns,
        keys: input.keys,
        osNickValue: input.osNickValue,
        status,
        // Дата получения заказа — она же в подписи, поэтому берётся ТОЛЬКО из
        // строки: `Date.now()` менял бы подпись каждый проход, и заказ уезжал
        // бы технарю бесконечно.
        dateMs: row.createdAt || 0,
      }),
      row.extras
    );

  // 1. Заказа у технаря ещё нет — выдаём. Пустой статус у ОС означает
  //    «в работе»: заказ в столе технаря без статуса не считается нигде.
  if (!mirror) {
    const status = mine || input.fallbackStatus;
    return { action: "push", status, hash: hashOf(status), hadMirror };
  }

  // 2. У себя статуса нет, а у технаря есть — показываем настоящий. Сюда же
  //    попадают перенесённые заказы (`osOrderAdoption`): у их строки-источника
  //    столбец статуса пустой, а заказ давно в работе.
  if (!mine && theirs && osStatusKey) {
    return { action: "pull", status: theirs, hash: hashOf(theirs, { [osStatusKey]: theirs }), hadMirror };
  }

  // 3. ОС что-то поменял у себя — уезжает технарю.
  const status = mine || input.fallbackStatus;
  const hash = hashOf(status);
  if (hash !== (row.syncHash ?? "")) {
    return { action: "push", status, hash, hadMirror };
  }

  // 4. Статус поменяли в строке технаря (Тимлид поставил «Успешку», Owner
  //    закрыл заказ) — показываем его у ОС.
  if (theirs !== mine && osStatusKey) {
    return { action: "pull", status: theirs, hash: hashOf(theirs, { [osStatusKey]: theirs }), hadMirror };
  }

  return { action: "none", status: mine, hash, hadMirror };
}
