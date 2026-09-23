import { sbPatchRow } from "@/services/rows/supabaseRowStore";
import { parseLooseNumber } from "@/utils/numberInput";
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

/** Id строки-копии выводится из строки-источника: повтор пишет в ту же строку. */
export function mirrorRowId(srcRowId: string): string {
  return `os_${srcRowId.replace(/[^A-Za-z0-9_-]/g, "")}`;
}

export interface TechTarget {
  page: WorkspacePage;
  tabId: string;
  keys: OsFieldKeys;
}

/**
 * Куда писать заказ технарю: его активный стол и текущая месячная вкладка.
 * Карта столбцов обязана быть от ЭТОЙ вкладки — иначе значения ушли бы в
 * чужие ключи (этим уже ломался заезд заказов с биржи).
 */
export function findTechTarget(pages: readonly WorkspacePage[], techUid: string): TechTarget | null {
  const page = pages.find((p) => p.responsibleUserId === techUid && !p.inactive && !p.osDesk);
  if (!page) return null;
  const tabId = page.autoMonthSubPageId;
  const keys = page.osFieldKeys;
  // Без ключа `os` заказ уехал бы БЕЗ ника ОС: он бы не попал ни в счётчики
  // этого ОС, ни в его оценки, а через 30 дней тихо пропало бы право
  // оценивать технаря. Лучше честный отказ.
  if (!tabId || !keys || keys.tabId !== tabId || !keys.os) return null;
  return { page, tabId, keys };
}

/** Почему заказ нельзя выдать — текст человеку. null — можно. */
export function techTargetProblem(pages: readonly WorkspacePage[], techUid: string | null): string | null {
  if (!techUid) return "У этого ника технаря нет аккаунта — закрепите ник на «Команде»";
  const page = pages.find((p) => p.responsibleUserId === techUid && !p.inactive && !p.osDesk);
  if (!page) return "У технаря нет активного стола";
  if (!page.autoMonthSubPageId) return "У технаря ещё нет вкладки текущего месяца — пусть откроет свой стол";
  if (!page.osFieldKeys || page.osFieldKeys.tabId !== page.autoMonthSubPageId) {
    return "Стол технаря ещё не сообщил, куда писать — пусть откроет свой стол и обновит страницу";
  }
  if (!page.osFieldKeys.os) {
    return "В таблице технаря нет столбца «Ответственный» — без него заказ уедет без вашего ника";
  }
  return null;
}

/** uid технаря по его нику (столбец «Технарь» на столе ОС). */
export function techUidByNick(members: readonly WorkspaceMember[], nickValue: string | null | undefined): string | null {
  if (!nickValue) return null;
  const found = members.find((m) => m.status === "active" && m.techNickValue === nickValue && m.uid);
  return found?.uid ?? null;
}

function num(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = parseLooseNumber(String(value ?? ""));
  return parsed ?? 0;
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
  /** Дата получения заказа технарём. */
  dateMs: number;
}

/**
 * Ячейки строки технаря. Цена и апсейл складываются в ОДНУ сумму (так просил
 * Nurba: 50 000 + 50 000 = 100 000): у технаря один денежный столбец, по нему
 * считаются его загрузка, дашборд и рейтинг.
 */
export function buildMirrorCells(input: MirrorInput): Record<string, string | number | null> {
  const { source, osColumns, keys } = input;
  const cells: Record<string, string | number | null> = {};
  const put = (key: string | undefined, value: string | number | null) => {
    if (key && value !== null && value !== "") cells[key] = value;
  };
  put(keys.client, String(source.cells[osColumns.client] ?? ""));
  put(keys.phone, String(source.cells[osColumns.phone] ?? ""));
  const total = num(source.cells[osColumns.price]) + num(source.cells[osColumns.upsell]);
  if (keys.price && total > 0) cells[keys.price] = String(total);
  put(keys.os, input.osNickValue);
  put(keys.link, String(source.cells[osColumns.link] ?? ""));
  put(keys.status, input.status);
  if (keys.date) cells[keys.date] = String(input.dateMs);
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
}

/**
 * Выдать заказ в работу: строка появляется в столе технаря и с этой минуты
 * принадлежит ОС. Повторный вызов — обновление той же строки (id выведен из
 * строки-источника), поэтому «выдать» и «обновить» — одно и то же действие.
 */
export async function pushOrderToTech(input: PushOrderInput): Promise<{ rowId: string; syncHash: string }> {
  const rowId = input.mirrorRowId || mirrorRowId(input.source.id);
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
  await sbPatchRow(input.workspaceId, input.target.page.id, input.target.tabId, rowId, {
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
    mirrorTabId: input.target.tabId,
    mirrorRowId: rowId,
  });
  return { rowId, syncHash };
}
