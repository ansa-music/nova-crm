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
 * - `move` — ОС сменил технаря: заказ убирается из стола прежнего и
 *   заводится в столе нового (иначе он висел бы у обоих);
 * - `unassign` — технаря стёрли: заказ уходит со стола совсем;
 * - `pull` — статус поменяли в строке технаря (Тимлид поставил «Успешку»,
 *   Owner закрыл заказ), и его надо показать у ОС;
 * - `none` — всё сходится;
 * - `wait` — это ещё не заказ (нет технаря или имени клиента).
 */
export type OsDispatchAction = "push" | "move" | "unassign" | "pull" | "none" | "wait";

export interface OsDispatchPlan {
  action: OsDispatchAction;
  /** Статус, который поедет технарю (для `push`) или к ОС (для `pull`). */
  status: string;
  /** Подпись зеркалируемых полей после действия. */
  hash: string;
  /** Был ли заказ уже выдан — для тоста «Заказ у технаря». */
  hadMirror: boolean;
  /**
   * В какую строку писать копию. Пусто — завести новую (id выведется из
   * строки-источника). Если копия уже где-то есть, сюда попадает ЕЁ id —
   * иначе рядом появился бы второй такой же заказ.
   */
  mirrorRowId?: string;
  /** Вкладка, где копия лежит сейчас (на переломе месяца она не текущая). */
  mirrorTabId?: string | null;
  /** Откуда убрать копию: смена технаря и снятие заказа. */
  removeAt?: { pageId: string; tabId: string | null; rowId: string };
}

/** Где лежит копия заказа. */
export interface MirrorAddress {
  pageId: string;
  tabId: string | null;
  rowId: string;
}

/**
 * Адрес копии: сначала то, что реально нашлось в столах (`useMyOrderRows`),
 * иначе — то, что записано на самой строке-источнике.
 *
 * Вторая половина и есть защита от ДУБЛЕЙ: список своих заказов читается
 * отдельным запросом и в момент прохода может быть ещё не загружен или
 * неполным (отказ чтения, свежая выдача). Без адреса на строке проход решил
 * бы «заказа у технаря нет» и завёл бы ВТОРОЙ.
 */
export function mirrorAddressOf(row: PageRow, mirror: PageRow | null): MirrorAddress | null {
  if (mirror) return { pageId: mirror.deskPageId ?? "", tabId: mirror.tabId || null, rowId: mirror.id };
  if (row.mirrorRowId && row.mirrorPageId) {
    return { pageId: row.mirrorPageId, tabId: row.mirrorTabId || null, rowId: row.mirrorRowId };
  }
  return null;
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
  /**
   * Стол, в котором заказ должен лежать СЕЙЧАС (по нынешнему нику технаря).
   * Пусто — ник не разобран, тогда ничего не двигаем.
   */
  targetPageId: string;
}

export function planOsDispatch(input: OsDispatchInput): OsDispatchPlan {
  const { row, mirror, osStatusKey } = input;
  const mine = osStatusKey ? String(row.cells[osStatusKey] ?? "").trim() : "";
  const theirs = mirror?.statusKey ? String(mirror.cells[mirror.statusKey] ?? "").trim() : "";
  const at = mirrorAddressOf(row, mirror);
  const hadMirror = Boolean(at);

  // Технаря стёрли — заказ уходит с его стола: держать у человека работу,
  // которую у него забрали, нельзя.
  if (!input.techNick) {
    if (at) return { action: "unassign", status: mine, hash: row.syncHash ?? "", hadMirror, removeAt: at };
    return { action: "wait", status: mine, hash: row.syncHash ?? "", hadMirror };
  }
  // Ещё не заказ: без имени клиента отправлять нечего.
  if (!input.client && !at) {
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
  if (!at) {
    const status = mine || input.fallbackStatus;
    return { action: "push", status, hash: hashOf(status), hadMirror };
  }

  // 2. Сменили технаря: заказ лежит не в том столе. Статус переезжает вместе
  //    с заказом — работа-то та же.
  if (input.targetPageId && at.pageId && at.pageId !== input.targetPageId) {
    const status = mine || theirs || input.fallbackStatus;
    return { action: "move", status, hash: hashOf(status), hadMirror, removeAt: at };
  }

  // 3. У себя статуса нет, а у технаря есть — показываем настоящий. Сюда же
  //    попадают перенесённые заказы (`osOrderAdoption`): у их строки-источника
  //    столбец статуса пустой, а заказ давно в работе.
  if (!mine && theirs && osStatusKey) {
    return { action: "pull", status: theirs, hash: hashOf(theirs, { [osStatusKey]: theirs }), hadMirror };
  }

  // 4. ОС что-то поменял у себя — уезжает технарю.
  const status = mine || input.fallbackStatus;
  const hash = hashOf(status);
  if (hash !== (row.syncHash ?? "")) {
    return { action: "push", status, hash, hadMirror, mirrorRowId: at.rowId, mirrorTabId: at.tabId };
  }

  // 5. Статус поменяли в строке технаря (Тимлид поставил «Успешку», Owner
  //    закрыл заказ) — показываем его у ОС.
  if (theirs !== mine && osStatusKey) {
    return { action: "pull", status: theirs, hash: hashOf(theirs, { [osStatusKey]: theirs }), hadMirror };
  }

  return { action: "none", status: mine, hash, hadMirror };
}

/**
 * Лишние копии одного заказа — те самые «дубли у технарей».
 *
 * Появлялись, когда проход не видел уже выданный заказ (список своих заказов
 * ещё читался) и выдавал его второй раз. Причину закрыли, но строки,
 * заведённые до этого, надо убрать: у технаря один заказ считается дважды —
 * и в загрузке, и в деньгах.
 *
 * Правило выбора «настоящей»: та, на которую показывает сама строка-источник;
 * если такой нет — та, что лежит в нынешнем столе технаря; если и таких
 * несколько — самая свежая. Остальные идут на удаление.
 */
export function findDuplicateMirrors(input: {
  /** Строки стола ОС. */
  rows: PageRow[];
  /** Все заказы этого ОС в столах технарей. */
  orders: PageRow[];
  /** Стол технаря по id строки-источника (пусто — стол не определён). */
  targetPageOf: (srcRowId: string) => string;
}): MirrorAddress[] {
  const bySource = new Map<string, PageRow[]>();
  for (const order of input.orders) {
    const src = order.srcRowId;
    if (!src) continue;
    const list = bySource.get(src);
    if (list) list.push(order);
    else bySource.set(src, [order]);
  }
  const extra: MirrorAddress[] = [];
  for (const row of input.rows) {
    const copies = bySource.get(row.id);
    if (!copies || copies.length < 2) continue;
    const target = input.targetPageOf(row.id);
    const keep =
      copies.find((c) => c.id === row.mirrorRowId && c.deskPageId === row.mirrorPageId) ??
      copies.find((c) => c.deskPageId === target) ??
      [...copies].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
    for (const copy of copies) {
      if (copy === keep) continue;
      extra.push({ pageId: copy.deskPageId ?? "", tabId: copy.tabId || null, rowId: copy.id });
    }
  }
  return extra;
}
