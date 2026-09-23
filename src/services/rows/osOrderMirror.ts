import { sbPatchRow } from "@/services/rows/supabaseRowStore";
import { osRowTotal } from "@/utils/payment";
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
  if (!page.autoMonthSubPageId) return "У технаря ещё нет вкладки текущего месяца — пусть откроет свой стол";
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
  const put = (key: string | undefined, value: string | number | null) => {
    if (key && value !== null && value !== "") cells[key] = value;
  };
  put(keys.client, String(source.cells[osColumns.client] ?? ""));
  put(keys.phone, String(source.cells[osColumns.phone] ?? ""));
  // Касса: цена и апсейл за вычетом комиссии их способов оплаты — «Итого»
  // стола ОС (utils/payment). Без способов это ровно цена + апсейл, как было.
  const total = osRowTotal(source, osColumns) ?? 0;
  if (keys.price && total > 0) cells[keys.price] = String(total);
  put(keys.os, input.osNickValue);
  put(keys.link, String(source.cells[osColumns.link] ?? ""));
  put(keys.status, input.status);
  if (keys.date && input.dateMs > 0) cells[keys.date] = String(input.dateMs);
  return cells;
}

/** Подпись зеркалируемых полей: по ней видно, доехала ли правка. */
export function mirrorSyncHash(cells: Record<string, string | number | null>, extras: PageRow["extras"]): string {
  return JSON.stringify([Object.entries(cells).sort(), extras ?? null]);
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
}

/**
 * Выдать заказ в работу: строка появляется в столе технаря и с этой минуты
 * принадлежит ОС. Повторный вызов — обновление той же строки (id выведен из
 * строки-источника), поэтому «выдать» и «обновить» — одно и то же действие.
 */
export async function pushOrderToTech(input: PushOrderInput): Promise<{ rowId: string; syncHash: string }> {
  const rowId = input.mirrorRowId || mirrorRowId(input.source.id);
  const tabId = input.mirrorTabId ?? input.target.tabId;
  const cells = buildMirrorCells({
    source: input.source,
    osColumns: input.osColumns,
    keys: input.target.keys,
    osNickValue: input.osNickValue,
    status: input.status,
    dateMs: input.dateMs ?? Date.now(),
  });
  const extras = input.source.extras;
  const syncHash = mirrorSyncHash(cells, extras);
  await sbPatchRow(input.workspaceId, input.target.page.id, tabId, rowId, {
    cells,
    extras: extras ?? undefined,
    // Подсветка — чтобы технарь не пропустил новый заказ, как и с биржи.
    highlight: true,
    osUid: input.osUid,
    techUid: input.techUid,
    statusKey: input.target.keys.status,
    syncHash,
    srcPageId: input.srcPageId,
    srcTabId: input.srcTabId ?? "",
    srcRowId: input.source.id,
  });
  // На строке-источнике — адрес копии: по нему ОС потом её обновляет.
  await sbPatchRow(input.workspaceId, input.srcPageId, input.srcTabId, input.source.id, {
    cells: {},
    syncHash,
    mirrorPageId: input.target.page.id,
    mirrorTabId: tabId,
    mirrorRowId: rowId,
  });
  return { rowId, syncHash };
}
