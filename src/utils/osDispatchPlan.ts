import { buildMirrorCells, mirrorSyncHash } from "@/services/rows/osOrderMirror";
import type { MirrorInput } from "@/services/rows/osOrderMirror";
import { OS_ISSUED_AT_KEY, OS_ISSUED_ON_KEY, OS_LOST_FOR_KEY, OS_STATUS_SENT_KEY } from "@/utils/reservedCellKeys";
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
    if (at)
      return keep("unassign", {
        removeAt: at,
        // Заказ забрали — «выдан» (и авто, и поставленная ОС дата) больше не про него.
        sourceCells: { [OS_STATUS_SENT_KEY]: "", [OS_ISSUED_AT_KEY]: "", [OS_ISSUED_ON_KEY]: "" },
      });
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
        // Заказ забирали у ДРУГОГО технаря («Вернуть» на «Правке столов»,
        // потерянная копия) и теперь отдают этому — поставленная ОС дата
        // выдачи была про прежнего.
        ...(lostFor && lostFor !== input.techNick ? { [OS_ISSUED_ON_KEY]: "" } : {}),
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
      sourceCells: { [OS_LOST_FOR_KEY]: input.techNick, [OS_STATUS_SENT_KEY]: "", [OS_ISSUED_AT_KEY]: "", [OS_ISSUED_ON_KEY]: "" },
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
        // Новый технарь — новая дата выдачи: рекомендацию даст запись копии
        // (osIssuedAt), поставленную ОС дату прежнему технарю снимаем.
        [OS_ISSUED_ON_KEY]: "",
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

// ---------------------------------------------------------------------------
// Проход по устаревшему списку заказов (гонка, найденная 24.09.2026)
// ---------------------------------------------------------------------------

/**
 * Что в строке стола ОС решает «тянуть статус от технаря» и «копия пропала»:
 * статус ОС, последний синхронизированный статус и адрес копии.
 */
export function rowSyncFingerprint(row: PageRow, osStatusKey: string | null | undefined): string {
  return [
    cellOf(row, osStatusKey),
    cellOf(row, OS_STATUS_SENT_KEY),
    row.mirrorPageId ?? "",
    row.mirrorTabId ?? "",
    row.mirrorRowId ?? "",
  ].join("|");
}

/** Память прохода: как строка выглядела и когда (performance.now()) она поменялась ЗДЕСЬ. */
export interface RowChangeMemory {
  seen: Map<string, string>;
  changedAt: Map<string, number>;
}

/**
 * Отметить строки, которые поменялись с прошлого взгляда. Первый взгляд на
 * таблицу (`seen` пуст) — строки старые (отметки нет): список заказов читался
 * одновременно с ними. Строка, появившаяся ПОЗЖЕ (источник, заведённый
 * функцией базы, пришёл звонком), — новая: её копии в прочитанном списке ещё
 * может не быть.
 */
export function noteRowChanges(
  memory: RowChangeMemory,
  rows: readonly PageRow[],
  osStatusKey: string | null | undefined,
  now: number
): void {
  const initial = memory.seen.size === 0;
  for (const row of rows) {
    const next = rowSyncFingerprint(row, osStatusKey);
    const prev = memory.seen.get(row.id);
    if (prev === next) continue;
    memory.seen.set(row.id, next);
    if (prev !== undefined || !initial) memory.changedAt.set(row.id, now);
  }
}

/**
 * Список заказов старше правки строки: его чтение началось ДО того, как
 * строка поменялась здесь (статус ОС, `osStatusSent`, адрес копии). По такому
 * списку нельзя решать «статус поменяли у технаря — тянем» (вернули бы ОС его
 * же прежний статус) и «копии нет — её удалили» (сняли бы адрес у только что
 * выданного заказа) — сначала перечитать. `fetchedAtLocal` не передан (старый
 * вызов) — прежнее поведение; 0 — список ещё ни разу не прочитан.
 */
export function orderListStaleFor(changedAt: number | undefined, fetchedAtLocal: number | undefined): boolean {
  if (fetchedAtLocal === undefined) return false;
  if (!(fetchedAtLocal > 0)) return true;
  return (changedAt ?? 0) > fetchedAtLocal;
}

/**
 * Один проход за раз. Проход асинхронный (десятки записей в базу), а таймер
 * взводится на каждую правку строки — второй проход, начатый поверх первого,
 * решал по списку, который первый как раз менял. Вызов во время прохода
 * только просит «ещё раз» — текущий, закончив, пройдёт снова (пока
 * `shouldRerun()`: стол не закрыт, список не перечитывается).
 */
export function createSingleFlight(run: () => Promise<void>, shouldRerun: () => boolean = () => true) {
  let running = false;
  let again = false;
  return {
    isRunning: () => running,
    async trigger(): Promise<void> {
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        do {
          again = false;
          await run();
        } while (again && shouldRerun());
      } finally {
        running = false;
        again = false;
      }
    },
  };
}

/**
 * Когда перечитывать свои заказы за проход: сразу после ПЕРВОЙ удачной записи
 * в копию (окно, в котором следующий проход видит старый список, — как можно
 * короче), остальное — одним чтением в конце: на 25 выдач 25 полных чтений
 * списка не нужны.
 */
export function createPassRefresher(refresh: () => void) {
  let requested = false;
  let pending = false;
  return {
    /** Записали в копию — перечитать сейчас (или в конце, если уже перечитывали). */
    now() {
      if (requested) {
        pending = true;
        return;
      }
      requested = true;
      pending = false;
      refresh();
    },
    /** Перечитать в конце прохода. */
    later() {
      pending = true;
    },
    flush() {
      if (!pending) return;
      pending = false;
      requested = true;
      refresh();
    },
  };
}
