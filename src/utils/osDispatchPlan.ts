import { buildMirrorCells, mirrorSyncHash } from "@/services/rows/osOrderMirror";
import type { MirrorInput } from "@/services/rows/osOrderMirror";
import { OS_ISSUED_AT_KEY, OS_LOST_FOR_KEY, OS_STATUS_SENT_KEY } from "@/utils/reservedCellKeys";
import type { OsFieldKeys, PageRow } from "@/types";

/**
 * Что делать со строкой стола ОС в очередном проходе (см. useOsDeskDispatch).
 *
 * Чистая функция: весь спор «кто главный — стол ОС или стол технаря»
 * решается здесь, и его можно проверить без базы.
 *
 * ПОЛЯ и СТАТУС живут раздельно — главный урок ревью 23.09.2026:
 * - поля заказа (клиент, номер, сумма, ссылка, ник ОС, визитка) — их источник
 *   стол ОС; подпись `syncHash` считается ТОЛЬКО по ним. Разошлась — ОС
 *   что-то поменял, поля уезжают технарю. Статус в подпись не входит, и
 *   правка телефона больше не увозит технарю устаревший статус;
 * - статус может поменять любая сторона: ОС у себя, Тимлид/Owner в строке
 *   технаря. Кто менял последним, видно по `osStatusSent` — служебной ячейке
 *   на строке-источнике, куда пишется последний СИНХРОНИЗИРОВАННЫЙ статус.
 *   `mine !== sent` — менял ОС, его статус едет технарю; `theirs !== sent` —
 *   меняли у технаря, статус едет к ОС. Обе стороны разошлись — прав ОС:
 *   он смотрит на экран прямо сейчас.
 *
 * Действия:
 * - `push` — поля (и, если менял ОС, статус) уезжают технарю; копии ещё нет —
 *   заводится;
 * - `move` — ОС сменил технаря: копия убирается у прежнего и заводится у нового;
 * - `unassign` — технаря стёрли: копия уходит со стола;
 * - `lost` — список заказов прочитан, а копии по записанному адресу нет
 *   (Owner удалил её в столе технаря, вкладку удалили). Адрес снимаем,
 *   заказ заново НЕ выдаём: удаление — решение, а не сбой; выдать снова
 *   можно кнопкой или сменой технаря;
 * - `pull` — статус поменяли у технаря, показываем его у ОС;
 * - `none` — всё сходится;
 * - `wait` — это ещё не заказ (нет технаря или имени клиента), либо копию
 *   удалили и ОС её пока не перевыдал.
 */
export type OsDispatchAction = "push" | "move" | "unassign" | "lost" | "pull" | "none" | "wait";

export interface OsDispatchPlan {
  action: OsDispatchAction;
  /** Статус, который поедет технарю (для `push`/`move`) или к ОС (для `pull`). */
  status: string;
  /** Отправлять ли статус технарю (для `push`): только если его менял ОС. */
  withStatus: boolean;
  /** Подпись полей после действия. */
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
  /** Откуда убрать копию: смена технаря, снятие заказа, потерянная копия. */
  removeAt?: { pageId: string; tabId: string | null; rowId: string };
  /** Что дописать в ячейки строки-источника после действия (служебные ключи, статус). */
  sourceCells: Record<string, string>;
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

/**
 * Копия ЭТОЙ строки среди всех заказов ОС: сначала та, на которую показывает
 * адрес на строке, иначе самая свежая с таким `srcRowId`. Раньше карта
 * «источник → копия» держала случайную из копий, и уборка дублей с планом
 * прохода смотрели на разные строки.
 */
export function mirrorForRow(row: PageRow, orders: readonly PageRow[]): PageRow | null {
  const copies = orders.filter((o) => o.srcRowId === row.id);
  if (copies.length === 0) return null;
  return (
    copies.find((c) => c.id === row.mirrorRowId && c.deskPageId === row.mirrorPageId) ??
    [...copies].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]
  );
}

export interface OsDispatchInput {
  row: PageRow;
  /** Строка этого заказа в столе технаря, если он уже выдан. */
  mirror: PageRow | null;
  /**
   * Список заказов ОС прочитан целиком. Только тогда «копии в списке нет»
   * значит «её удалили», а не «ещё не загрузилась».
   */
  ordersLoaded: boolean;
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

function cellOf(row: PageRow, key: string | null | undefined): string {
  if (!key) return "";
  const v = row.cells[key];
  return v === null || v === undefined ? "" : String(v).trim();
}

export function planOsDispatch(input: OsDispatchInput): OsDispatchPlan {
  const { row, mirror, osStatusKey } = input;
  const mine = cellOf(row, osStatusKey);
  const theirs = mirror?.statusKey ? cellOf(mirror, mirror.statusKey) : "";
  const sent = cellOf(row, OS_STATUS_SENT_KEY);
  const lostFor = cellOf(row, OS_LOST_FOR_KEY);
  const at = mirrorAddressOf(row, mirror);
  const hadMirror = Boolean(at);
  const keep = (action: OsDispatchAction, extra: Partial<OsDispatchPlan> = {}): OsDispatchPlan => ({
    action,
    status: mine,
    withStatus: false,
    hash: row.syncHash ?? "",
    hadMirror,
    sourceCells: {},
    ...extra,
  });

  // Технаря стёрли — заказ уходит с его стола: держать у человека работу,
  // которую у него забрали, нельзя.
  if (!input.techNick) {
    if (at) return keep("unassign", { removeAt: at, sourceCells: { [OS_STATUS_SENT_KEY]: "", [OS_ISSUED_AT_KEY]: "" } });
    return keep("wait");
  }
  // Ещё не заказ: без имени клиента отправлять нечего.
  if (!input.client && !at) return keep("wait");

  /** Подпись ТОЛЬКО по полям — без статуса и без даты (см. шапку файла). */
  const fieldsHash = mirrorSyncHash(
    buildMirrorCells({
      source: row,
      osColumns: input.osColumns,
      keys: input.keys,
      osNickValue: input.osNickValue,
      status: "",
      withStatus: false,
      dateMs: 0,
    }),
    row.extras
  );

  // 1. Копии нет вовсе — выдаём. Пустой статус у ОС означает «в работе»:
  //    заказ в столе технаря без статуса не считается нигде.
  if (!at) {
    // Копию удалили у ЭТОГО технаря, и ОС её не перевыдавал — не воскрешаем.
    if (lostFor && lostFor === input.techNick) return keep("wait");
    const status = mine || input.fallbackStatus;
    return keep("push", {
      status,
      withStatus: true,
      hash: fieldsHash,
      sourceCells: {
        [OS_STATUS_SENT_KEY]: status,
        [OS_LOST_FOR_KEY]: "",
        ...(osStatusKey && !mine ? { [osStatusKey]: status } : {}),
      },
    });
  }

  // 2. Адрес на строке есть, а в прочитанном списке копии нет — её удалили
  //    (Owner в столе технаря, удалили вкладку). Не «пустой статус у
  //    технаря», а «копии нет»: адрес снимаем, статус ОС не трогаем.
  if (!mirror) {
    if (!input.ordersLoaded) return keep("wait");
    return keep("lost", {
      removeAt: at,
      sourceCells: { [OS_LOST_FOR_KEY]: input.techNick, [OS_STATUS_SENT_KEY]: "", [OS_ISSUED_AT_KEY]: "" },
    });
  }

  // 3. Сменили технаря: копия лежит не в том столе. Статус переезжает вместе
  //    с заказом — работа-то та же.
  if (input.targetPageId && at.pageId && at.pageId !== input.targetPageId) {
    const status = mine || theirs || input.fallbackStatus;
    return keep("move", {
      status,
      withStatus: true,
      hash: fieldsHash,
      removeAt: at,
      sourceCells: {
        [OS_STATUS_SENT_KEY]: status,
        [OS_LOST_FOR_KEY]: "",
        ...(osStatusKey && !mine ? { [osStatusKey]: status } : {}),
      },
    });
  }

  const fieldsChanged = fieldsHash !== (row.syncHash ?? "");
  const osChangedStatus = Boolean(mine) && mine !== sent;
  const techChangedStatus = Boolean(theirs) && theirs !== sent;

  // 4. ОС поменял статус (и, может быть, поля) — едет технарю. Прав ОС: он
  //    смотрит на экран прямо сейчас.
  if (osChangedStatus) {
    return keep("push", {
      status: mine,
      withStatus: true,
      hash: fieldsHash,
      mirrorRowId: at.rowId,
      mirrorTabId: at.tabId,
      sourceCells: { [OS_STATUS_SENT_KEY]: mine },
    });
  }

  // 5. ОС поменял только поля — едут технарю БЕЗ статуса: его могли
  //    поменять у технаря, и затирать решение руководства нельзя.
  if (fieldsChanged) {
    return keep("push", { status: mine, withStatus: false, hash: fieldsHash, mirrorRowId: at.rowId, mirrorTabId: at.tabId });
  }

  // 6. Статус поменяли у технаря (Тимлид поставил «Успешку», Owner закрыл
  //    заказ) или его у ОС ещё нет (перенесённый заказ) — показываем у ОС.
  if (techChangedStatus && osStatusKey) {
    return keep("pull", {
      status: theirs,
      hash: fieldsHash,
      sourceCells: { [osStatusKey]: theirs, [OS_STATUS_SENT_KEY]: theirs },
    });
  }

  return keep("none", { hash: fieldsHash });
}

/**
 * Лишние копии одного заказа — те самые «дубли у технарей».
 *
 * Появлялись, когда проход не видел уже выданный заказ (список своих заказов
 * ещё читался) и выдавал его второй раз. Причину закрыли, но строки,
 * заведённые до этого, надо убрать: у технаря один заказ считается дважды —
 * и в загрузке, и в деньгах.
 *
 * Правило выбора «настоящей» — то же, что у `mirrorForRow`: та, на которую
 * показывает сама строка-источник; если такой нет — та, что лежит в
 * нынешнем столе технаря; если и таких несколько — самая свежая.
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
