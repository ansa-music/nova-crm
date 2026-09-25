import { DESK_ROWS_TABLE, supabaseRows } from "@/lib/supabaseRows";
import { recordToRow, sbPatchRow } from "@/services/rows/supabaseRowStore";
import { currentMonthSubPageId } from "@/services/monthTabService";
import { currentPeriodKeyOf } from "@/services/periodService";
import { osRowTotal } from "@/utils/payment";
import { OS_ISSUED_AT_KEY } from "@/utils/reservedCellKeys";
import type { OsFieldKeys, PageRow, WorkspaceMember, WorkspacePage } from "@/types";

/**
 * Заказ ОС в столе технаря — «зеркало».
 *
 * Заказ ведёт ОС у себя (стол ОС), а работает по нему технарь, и все счётчики
 * («Технари», дашборд, оценки, загрузка) считаются по строкам СТОЛА ТЕХНАРЯ —
 * их за день читают десятки мест. Поэтому заказ не переезжает, а ОТРАЖАЕТСЯ:
 * в столе технаря лежит строка-копия с меткой `osUid`, которую он не правит
 * (политики `desk_rows` и триггер `desk_rows_guard`), а ОС правит.
 *
 * Пишет зеркало СЕССИЯ ОС: у него есть право на свои строки в чужом столе.
 * Ключи ячеек чужой вкладки берём из `page.osFieldKeys` — подвкладки чужого
 * стола ОС не прочитает, а документ стола читают все участники.
 */

/** Ключи столбцов стола ОС, которые уезжают технарю (см. osDeskService). */
export const OS_MIRROR_COLUMNS = {
  client: "client",
  phone: "phone",
  price: "price",
  upsell: "upsell",
  note: "note",
  link: "link",
} as const;

/** Id строки-копии выводится из строки-источника: повтор пишет в ту же строку. */
export function mirrorRowId(srcRowId: string): string {
  return `os_${srcRowId.replace(/[^A-Za-z0-9_-]/g, "")}`;
}

export interface TechTarget {
  page: WorkspacePage;
  tabId: string;
  keys: OsFieldKeys;
}

/** Почему стол не годится для заказа ОС. null — годится. */
function deskProblem(page: WorkspacePage): string | null {
  // Именно ТЕКУЩЕГО месяца: 1-го числа `autoMonthSubPageId` ещё показывает на
  // прошлую вкладку, и заказ уезжал бы в сентябрь, где его «Технари» и
  // дашборд уже не считают. Автопилот переведёт стол при первом заходе.
  if (!currentMonthSubPageId(page, currentPeriodKeyOf(page.workspaceId))) {
    return "У технаря ещё нет вкладки текущего месяца — пусть откроет свой стол";
  }
  if (!page.osFieldKeys || page.osFieldKeys.tabId !== page.autoMonthSubPageId) {
    return "Стол технаря ещё не сообщил, куда писать — пусть откроет свой стол и обновит страницу";
  }
  // Без ключа `os` заказ уехал бы БЕЗ ника ОС: он бы не попал ни в счётчики
  // этого ОС, ни в его оценки, а через 30 дней тихо пропало бы право
  // оценивать технаря. Лучше честный отказ.
  if (!page.osFieldKeys.os) {
    return "В таблице технаря нет столбца «Ответственный» — без него заказ уедет без вашего ника";
  }
  return null;
}

/**
 * Столы технаря в порядке предпочтения: сначала тот, где заказ УЖЕ лежит
 * (`preferPageId`), потом остальные. У одного человека бывает несколько
 * столов (у Owner — почти всегда): раньше брался первый попавшийся, и заказ
 * то «переезжал» между столами одного и того же человека, то не выдавался
 * вовсе, если у первого стола не было карты столбцов.
 */
function techDesks(pages: readonly WorkspacePage[], techUid: string, preferPageId?: string | null): WorkspacePage[] {
  const own = pages.filter((p) => p.responsibleUserId === techUid && !p.inactive && !p.osDesk && !p.isDashboard);
  if (!preferPageId) return own;
  return [...own.filter((p) => p.id === preferPageId), ...own.filter((p) => p.id !== preferPageId)];
}

/**
 * Куда писать заказ технарю: его активный стол и текущая месячная вкладка.
 * Карта столбцов обязана быть от ЭТОЙ вкладки — иначе значения ушли бы в
 * чужие ключи (этим уже ломался заезд заказов с биржи).
 */
export function findTechTarget(
  pages: readonly WorkspacePage[],
  techUid: string,
  preferPageId?: string | null
): TechTarget | null {
  const page = techDesks(pages, techUid, preferPageId).find((p) => !deskProblem(p));
  if (!page || !page.autoMonthSubPageId || !page.osFieldKeys) return null;
  return { page, tabId: page.autoMonthSubPageId, keys: page.osFieldKeys };
}

/** Почему заказ нельзя выдать — текст человеку. null — можно. */
export function techTargetProblem(
  pages: readonly WorkspacePage[],
  techUid: string | null,
  preferPageId?: string | null
): string | null {
  if (!techUid) return "У этого ника технаря нет аккаунта — закрепите ник на «Команде»";
  const desks = techDesks(pages, techUid, preferPageId);
  if (desks.length === 0) return "У технаря нет активного стола";
  if (desks.some((p) => !deskProblem(p))) return null;
  return deskProblem(desks[0]);
}

/** uid технаря по его нику (столбец «Технарь» на столе ОС). */
export function techUidByNick(members: readonly WorkspaceMember[], nickValue: string | null | undefined): string | null {
  if (!nickValue) return null;
  const found = members.find((m) => m.status === "active" && m.techNickValue === nickValue && m.uid);
  return found?.uid ?? null;
}

export interface MirrorInput {
  /** Строка стола ОС — источник. */
  source: PageRow;
  /** Ключи столбцов стола ОС (они фиксированы — см. osDeskService). */
  osColumns: { client: string; phone: string; price: string; upsell: string; note: string; link: string };
  keys: OsFieldKeys;
  /** Ник ОС — в столбец «Ответственный» стола технаря (по нему считаются его заказы). */
  osNickValue: string;
  /** Статус заказа: его ведёт ОС. */
  status: string;
  /**
   * Класть ли статус в ячейки. false — правка полей без статуса: его могли
   * поменять у технаря (Тимлид поставил «Успешку»), и затирать нельзя.
   */
  withStatus?: boolean;
  /**
   * Дата получения заказа технарём. Ноль — столбец-дату не трогаем: подпись
   * (`mirrorSyncHash`) обязана быть ОДИНАКОВОЙ при повторном расчёте, а
   * `Date.now()` в ней означал бы «строка всё время меняется» и бесконечную
   * пересылку заказа.
   */
  dateMs: number;
}

/**
 * Ячейки строки технаря. Цена и апсейл складываются в ОДНУ сумму (так просил
 * Nurba: 50 000 + 50 000 = 100 000), и с 23.09.2026 — ЗА ВЫЧЕТОМ комиссии
 * способа оплаты («Итого» стола ОС): у технаря один денежный столбец, по нему
 * считаются его касса, загрузка, дашборд, рейтинг и премии.
 */
export function buildMirrorCells(input: MirrorInput): Record<string, string | number | null> {
  const { source, osColumns, keys } = input;
  const cells: Record<string, string | number | null> = {};
  // Пустое значение пишется ТОЖЕ: слияние ячеек в базе (`cells || patch`)
  // иначе оставило бы технарю стёртые у ОС цену, имя или ссылку.
  const set = (key: string | undefined, value: string) => {
    if (key) cells[key] = value;
  };
  set(keys.client, String(source.cells[osColumns.client] ?? "").trim());
  set(keys.phone, String(source.cells[osColumns.phone] ?? "").trim());
  // Касса: цена и апсейл за вычетом комиссии их способов оплаты — «Итого»
  // стола ОС (utils/payment). Без способов это ровно цена + апсейл, как было.
  const total = osRowTotal(source, osColumns) ?? 0;
  set(keys.price, total > 0 ? String(total) : "");
  if (input.osNickValue) set(keys.os, input.osNickValue);
  set(keys.link, String(source.cells[osColumns.link] ?? "").trim());
  if (input.withStatus !== false && input.status) set(keys.status, input.status);
  if (keys.date && input.dateMs > 0) cells[keys.date] = String(input.dateMs);
  return cells;
}

/** Подпись зеркалируемых полей: по ней видно, доехала ли правка. */
export function mirrorSyncHash(cells: Record<string, string | number | null>, extras: PageRow["extras"]): string {
  return JSON.stringify([Object.entries(cells).sort(), extras ?? null]);
}

/**
 * Строка по первичному ключу — один крошечный запрос мимо подписок и кэша.
 * Нужен там, где решение «строки нет» необратимо (удалить копию-сироту,
 * завести копию заново): списки столов и заказов читаются отдельно и могут
 * отставать на секунды. null — строки нет (или её не видно этой сессии);
 * ошибка чтения — исключение: «не узнали» не значит «нет».
 */
export async function sbFetchRowById(
  workspaceId: string,
  pageId: string,
  tab: string | null,
  rowId: string
): Promise<PageRow | null> {
  const { data, error } = await supabaseRows
    .from(DESK_ROWS_TABLE)
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("page_id", pageId)
    .eq("tab_id", tab ?? "")
    .eq("id", rowId)
    .limit(1);
  if (error) throw new Error(error.message || "Не удалось прочитать строку");
  const record = Array.isArray(data) ? data[0] : null;
  return record ? recordToRow(record as Parameters<typeof recordToRow>[0]) : null;
}

/**
 * Есть ли на этих столах (любой вкладке) строка с одним из этих id — один
 * запрос. Ошибка чтения — исключение: «не узнали» не значит «нет».
 */
export async function sbDeskRowExists(
  workspaceId: string,
  pageIds: readonly string[],
  rowIds: readonly string[]
): Promise<boolean> {
  if (pageIds.length === 0 || rowIds.length === 0) return false;
  const { data, error } = await supabaseRows
    .from(DESK_ROWS_TABLE)
    .select("id")
    .eq("workspace_id", workspaceId)
    .in("page_id", [...new Set(pageIds)])
    .in("id", [...new Set(rowIds)])
    .limit(1);
  if (error) throw new Error(error.message || "Не удалось прочитать стол технаря");
  return Array.isArray(data) && data.length > 0;
}

/**
 * Опорные поля копии, какими они лежат в базе СЕЙЧАС (строка из
 * `useMyOrderRows`). Любую их смену `desk_rows_guard` отклоняет всем, кроме
 * Owner, — вместе со всей записью, статусом в том числе.
 */
export interface MirrorCopyRef {
  statusKey?: string | null;
  techUid?: string | null;
  srcPageId?: string | null;
  srcTabId?: string | null;
  srcRowId?: string | null;
  osUid?: string | null;
}

export interface PushOrderInput {
  workspaceId: string;
  /** Кто выдаёт — ОС. */
  osUid: string;
  osNickValue: string;
  source: PageRow;
  /** Стол ОС и его вкладка (источник). */
  srcPageId: string;
  srcTabId: string | null;
  osColumns: MirrorInput["osColumns"];
  target: TechTarget;
  techUid: string;
  status: string;
  dateMs?: number;
  /**
   * Строка-копия уже есть — писать в НЕЁ. У заказов, заведённых до перехода
   * на «стол ОС — источник» (перенос `osOrderAdoption`), копия — это исходная
   * строка технаря, и её id из id источника не выводится: без этого
   * «Обновить у технаря» завело бы рядом вторую строку того же заказа.
   */
  mirrorRowId?: string;
  /**
   * Вкладка, в которой копия УЖЕ лежит. Нужна на переломе месяца: стол тот
   * же, а месячная вкладка новая, и без этого заказ, выданный в сентябре,
   * завёлся бы ВТОРОЙ строкой в октябре. Заказ остаётся там, где его выдали;
   * в новую вкладку уезжают только новые заказы.
   */
  mirrorTabId?: string | null;
  /** Слать ли статус (см. MirrorInput.withStatus). По умолчанию — да. */
  withStatus?: boolean;
  /** Служебные ячейки для строки-источника (osStatusSent, osLostFor, статус). */
  sourceCells?: Record<string, string>;
  /** Когда заказ отдан (для «Даты» стола ОС); нет — сейчас. Только при заведении копии. */
  issuedAt?: number;
  /**
   * Копия, которую правим (`mirrorRowId` задан), — строка из `useMyOrderRows`
   * (`mirrorForRow`/`myOrders.bySource`). Статус пишется под ЕЁ `statusKey`, а
   * опорные поля уходят её же значениями: карта столбцов текущего месяца у
   * технаря могла смениться (пересоздали «Статус», копия лежит в прошлой
   * вкладке, у старой копии `src_tab_id` пуст), и прежняя запись с ключами
   * `target.keys` целиком падала 42501 — статус не доезжал вовсе. Нет копии на
   * руках — опорные поля при правке не шлём совсем (база их не трогает).
   * Значения `target` уходят только при ЗАВЕДЕНИИ копии.
   */
  copy?: MirrorCopyRef | null;
  /**
   * Ключ столбца статуса НА СТОЛЕ ОС. Не «status» — пишется в `status_key`
   * строки-источника: по нему база (`desk_rows_os_status_push`, SQL
   * 20261002) сама везёт статус ОС в копию технаря той же записью.
   */
  osStatusKey?: string | null;
}

/** Отказ базы в правах (42501 → `permission-denied`, см. supabaseRowStore). */
function isPermissionDenied(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "permission-denied");
}

/** Отказ записи именно КОПИИ (строку-источник ещё не трогали). */
class CopyWriteError extends Error {
  original: unknown;
  constructor(original: unknown) {
    super(original instanceof Error ? original.message : String(original));
    this.original = original;
  }
}

/**
 * Выдать заказ в работу: строка появляется в столе технаря и с этой минуты
 * принадлежит ОС. Повторный вызов — обновление той же строки (id выведен из
 * строки-источника), поэтому «выдать» и «обновить» — одно и то же действие.
 *
 * Как звать (проход стола ОС, карточка строки `OsOrderPanel`, довоз с биржи):
 * ```ts
 * pushOrderToTech({
 *   ...,
 *   mirrorRowId: at?.rowId,     // копия уже есть — правим её
 *   mirrorTabId: at?.tabId,
 *   copy: mirror ?? undefined,  // строка копии из useMyOrderRows: её ключ статуса и опорные поля
 *   osStatusKey: keys.status,   // ключ «Статуса» на столе ОС (resolveOsDeskKeys)
 * });
 * ```
 * Копию, которая пропала между чтением списка и записью (Owner удалил её,
 * вкладку убрали), правка не находит, и `rows_patch` уходит во вставку —
 * отказ 42501. Тогда один раз сверяем по первичному ключу, что строки правда
 * нет, и заводим копию заново, как при первой выдаче (так вела себя и
 * прежняя запись, славшая опорные поля цели). Строка есть, но не наша (её
 * вернули технарю на «Правке столов») — отказ остаётся отказом: вторую
 * копию рядом с вернувшейся строкой не заводим.
 */
export async function pushOrderToTech(input: PushOrderInput): Promise<{ rowId: string; syncHash: string }> {
  try {
    return await writeOrder(input);
  } catch (error) {
    const original = error instanceof CopyWriteError ? error.original : error;
    if (!(error instanceof CopyWriteError) || !input.mirrorRowId || !isPermissionDenied(original)) throw original;
    let still: PageRow | null;
    try {
      still = await sbFetchRowById(input.workspaceId, input.target.page.id, input.mirrorTabId ?? input.target.tabId, input.mirrorRowId);
    } catch {
      throw original;
    }
    if (still) throw original;
    try {
      return await writeOrder({ ...input, mirrorRowId: undefined, mirrorTabId: undefined, copy: undefined });
    } catch (retryError) {
      throw retryError instanceof CopyWriteError ? retryError.original : retryError;
    }
  }
}

async function writeOrder(input: PushOrderInput): Promise<{ rowId: string; syncHash: string }> {
  const rowId = input.mirrorRowId || mirrorRowId(input.source.id);
  const tabId = input.mirrorTabId ?? input.target.tabId;
  // Копия уже есть — это правка. Дату получения и подсветку «новый заказ»
  // ставим только при заведении: иначе каждая правка ОС переписывала бы
  // технарю дату заказа датой строки ОС и снова красила строку в «новую».
  const creating = !input.mirrorRowId;
  const withStatus = input.withStatus !== false;
  const copy = creating ? null : (input.copy ?? null);
  // Статус правки — под ключом САМОЙ копии: у вкладки, где она лежит, ключ
  // «Статуса» мог быть другим, чем в нынешней карте столбцов технаря.
  const keys: OsFieldKeys = copy?.statusKey ? { ...input.target.keys, status: copy.statusKey } : input.target.keys;
  const cells = buildMirrorCells({
    source: input.source,
    osColumns: input.osColumns,
    keys,
    osNickValue: input.osNickValue,
    status: input.status,
    withStatus,
    dateMs: creating ? (input.dateMs ?? Date.now()) : 0,
  });
  const extras = input.source.extras;
  // Подпись — только по полям, без статуса и даты (utils/osDispatchPlan.ts).
  const syncHash = mirrorSyncHash(
    buildMirrorCells({
      source: input.source,
      osColumns: input.osColumns,
      keys: input.target.keys,
      osNickValue: input.osNickValue,
      status: "",
      withStatus: false,
      dateMs: 0,
    }),
    extras
  );
  // Опорные поля строки-заказа: при заведении — цели; при правке — ровно
  // нынешние значения копии (страж базы не видит смены), а без копии на
  // руках — никаких: `rows_patch` оставляет их как есть.
  const reference = creating
    ? {
        osUid: input.osUid,
        techUid: input.techUid,
        statusKey: input.target.keys.status,
        srcPageId: input.srcPageId,
        srcTabId: input.srcTabId ?? "",
        srcRowId: input.source.id,
      }
    : copy
      ? {
          osUid: copy.osUid || input.osUid,
          techUid: copy.techUid ?? undefined,
          statusKey: copy.statusKey ?? undefined,
          srcPageId: copy.srcPageId ?? undefined,
          srcTabId: copy.srcTabId ?? undefined,
          srcRowId: copy.srcRowId ?? undefined,
        }
      : {};
  try {
    await sbPatchRow(input.workspaceId, input.target.page.id, tabId, rowId, {
      cells,
      extras: extras ?? undefined,
      ...(creating ? { highlight: true } : {}),
      // Статус решили — просьба технаря об «Успешке» снята.
      ...(withStatus && input.status ? { clearSuccessRequest: true } : {}),
      ...reference,
      syncHash,
    });
  } catch (error) {
    throw new CopyWriteError(error);
  }
  // Ключ «Статуса» стола ОС — на строку-источник, если он не «status» (или
  // сменился): по нему база сама везёт статус ОС в копию. Строка-источник
  // лежит на столе ОС и `os_uid` не несёт — стражу опорных полей всё равно.
  const srcStatusKey =
    input.osStatusKey && input.osStatusKey !== (input.source.statusKey || "status") ? input.osStatusKey : undefined;
  // На строке-источнике — адрес копии (по нему ОС потом её обновляет) и
  // служебные ячейки: последний синхронизированный статус и прочее.
  await sbPatchRow(input.workspaceId, input.srcPageId, input.srcTabId, input.source.id, {
    // Копию завели — заказ отдан этому технарю сейчас (столбец «Даты» у ОС).
    // Правка существующей копии дату не трогает.
    cells: { ...(creating ? { [OS_ISSUED_AT_KEY]: String(input.issuedAt ?? Date.now()) } : {}), ...(input.sourceCells ?? {}) },
    syncHash,
    mirrorPageId: input.target.page.id,
    mirrorTabId: tabId,
    mirrorRowId: rowId,
    ...(srcStatusKey ? { statusKey: srcStatusKey } : {}),
  });
  return { rowId, syncHash };
}
