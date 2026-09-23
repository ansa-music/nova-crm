import { ensureOsDesk, findOsDeskOf, OS_DESK_COLUMNS } from "@/services/osDeskService";
import { fetchPagesFresh, updatePageOsFieldKeys } from "@/services/pageService";
import { fetchSubPageFresh } from "@/services/subPageService";
import { currentMonthKey, currentMonthSubPageId, isMonthlyDesk } from "@/services/monthTabService";
import { computeOsFieldKeys, sameOsFieldKeys } from "@/utils/osFieldKeys";
import { sbFetchAllPageRows, sbFetchRows, sbPatchRow } from "@/services/rows/supabaseRowStore";
import { usesSupabaseRows } from "@/services/rows/rowsBackend";
import { mirrorSyncHash } from "@/services/rows/osOrderMirror";
import { isBlankRow } from "@/utils/blankRow";
import { personLabel } from "@/utils/peopleDesks";
import type { OsFieldKeys, PageRow, WorkspaceMember, WorkspacePage } from "@/types";

/**
 * Перенос уже заведённых заказов под управление ОС (разово, Owner).
 *
 * До этого заказы жили только в столах технарей, а ОС видел их лишь сводкой.
 * Теперь заказ ведёт ОС, поэтому у каждого заказа ТЕКУЩЕГО месяца, где указан
 * ник ОС, появляется строка-источник в столе этого ОС, а строка технаря
 * получает метку `osUid` — с этой минуты статус и сумму в ней меняет ОС.
 *
 * Границы (решение Nurba 23.09.2026):
 * - только текущий месяц; прошлые месяцы остаются историей технаря;
 * - строки без ника ОС не трогаем — они остаются полностью его;
 * - ник ОС без живого аккаунта пропускаем: писать заказ некому.
 *
 * Идемпотентно: id строки-источника выведен из id строки технаря, повторный
 * запуск обновит те же строки, а не размножит их.
 */

export interface OsAdoptionReport {
  /** Столов просмотрено (из скольких — `deskTotal`). */
  desks: number;
  /** Сколько столов подходило под перенос вообще. */
  deskTotal: number;
  /** Столов, которым Owner записал карту столбцов вместо них. */
  publishedKeys: number;
  adopted: number;
  alreadyManaged: number;
  skippedNoOs: number;
  skippedNoAccount: number;
  /** Ники ОС, за которыми нет живого аккаунта — их закрепляют на «Команде». */
  unknownOsNicks: string[];
  createdOsDesks: number;
  errors: string[];
}

export interface OsAdoptionProgress {
  done: number;
  total: number;
  label: string;
}

/** Строка-источник в столе ОС выводится из строки технаря — повтор не размножает. */
export function sourceRowIdFor(techRowId: string): string {
  return `adopt_${techRowId.replace(/[^A-Za-z0-9_-]/g, "")}`;
}

function cellText(row: PageRow, key: string | undefined): string {
  if (!key) return "";
  const value = row.cells[key];
  return value === null || value === undefined ? "" : String(value);
}

/**
 * Карта столбцов месячной вкладки чужого стола.
 *
 * Обычно её публикует сессия САМОГО технаря (`useOsFieldKeysPublisher`), но
 * ждать, пока полтора десятка человек откроют свои столы, нельзя: без карты
 * ОС не может ни выдать заказ, ни забрать старый. Owner читает подвкладки
 * любого стола и пишет документ стола, поэтому карту он считает и
 * записывает сам — теми же правилами (`computeOsFieldKeys`), что и хозяин
 * стола, и только когда она отличается от записанной.
 */
async function ensureOsFieldKeys(
  workspaceId: string,
  page: WorkspacePage,
  tabId: string
): Promise<{ keys: OsFieldKeys; published: boolean }> {
  const current = page.osFieldKeys;
  // Записанная карта годится, только если она от ЭТОЙ вкладки И в ней есть
  // столбец ОС: по нему и определяется владелец заказа. Карта без него
  // попадает в базу штатно (стол без «Ответственного», вкладка, размеченная
  // по столбцам «Основной»), и раньше такой стол молча отчитывался «все
  // заказы без ника ОС» — Owner шёл искать ники, которых не теряли.
  if (current && current.tabId === tabId && current.os) return { keys: current, published: false };

  const tab = await fetchSubPageFresh(workspaceId, page.id, tabId);
  if (!tab) throw new Error("вкладка текущего месяца не нашлась — пусть стол откроют и повторите");
  const keys = computeOsFieldKeys(tabId, tab.columns ?? [], Date.now());
  if (!keys.os) {
    throw new Error("в этой вкладке нет столбца «Ответственный» — заказы стола НЕ проверялись");
  }
  if (sameOsFieldKeys(current, keys)) return { keys, published: false };
  await updatePageOsFieldKeys(workspaceId, page.id, keys);
  return { keys, published: true };
}

export async function adoptOrdersToOsDesks(input: {
  workspaceId: string;
  members: readonly WorkspaceMember[];
  onProgress?: (p: OsAdoptionProgress) => void;
}): Promise<OsAdoptionReport> {
  const { workspaceId, members } = input;
  const report: OsAdoptionReport = {
    desks: 0,
    deskTotal: 0,
    publishedKeys: 0,
    adopted: 0,
    alreadyManaged: 0,
    skippedNoOs: 0,
    skippedNoAccount: 0,
    unknownOsNicks: [],
    createdOsDesks: 0,
    errors: [],
  };
  if (!usesSupabaseRows(workspaceId)) {
    throw new Error("Заказы переносятся только когда строки живут в Supabase");
  }

  // Список столов — СВЕЖИЙ с сервера: неполный список молча оставил бы часть
  // заказов у технарей (урок прошлого переноса).
  const pages = await fetchPagesFresh(workspaceId);
  // Вкладка ТЕКУЩЕГО месяца — только та, что `currentMonthSubPageId` считает
  // текущей (сверка с autoMonthKey). Голый autoMonthSubPageId у отставшего
  // стола указывает на прошлый месяц: Owner записал бы ему карту от старой
  // вкладки, и заказы уехали бы в её ключи.
  const monthKey = currentMonthKey();
  // Круг столов — тот же, что у автопилота месячных вкладок (`isMonthlyDesk`):
  // стол Admin или дашборд месячных вкладок не имеют вовсе, и жаловаться на
  // них в отчёте — шум, за которым не видно настоящих отставших столов.
  const candidates = pages.filter((p) => !p.osDesk && !p.inactive && p.responsibleUserId && isMonthlyDesk(p, [...members]));
  const techDesks = candidates.filter((p) => currentMonthSubPageId(p, monthKey));
  for (const stale of candidates.filter((p) => !currentMonthSubPageId(p, monthKey))) {
    report.errors.push(
      `«${stale.name}»: вкладка этого месяца ещё не заведена — заказы стола НЕ проверялись, пусть его откроют`
    );
  }
  report.deskTotal = techDesks.length;
  const unknownNicks = new Set<string>();
  const osDeskByUid = new Map<string, WorkspacePage>();
  for (const page of pages) if (page.osDesk && page.responsibleUserId) osDeskByUid.set(page.responsibleUserId, page);

  let done = 0;
  for (const page of techDesks) {
    done += 1;
    input.onProgress?.({ done, total: techDesks.length, label: page.name });
    const tabId = currentMonthSubPageId(page, monthKey) as string;
    let keys: OsFieldKeys;
    try {
      const ensured = await ensureOsFieldKeys(workspaceId, page, tabId);
      keys = ensured.keys;
      if (ensured.published) report.publishedKeys += 1;
    } catch (error) {
      report.errors.push(`«${page.name}»: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    report.desks += 1;

    let rows: PageRow[];
    try {
      rows = await sbFetchRows(workspaceId, page.id, tabId);
    } catch (error) {
      report.errors.push(`«${page.name}»: строки не прочитались — ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    for (const row of rows) {
      if (isBlankRow(row)) continue;
      if (row.osUid) {
        report.alreadyManaged += 1;
        continue;
      }
      const osValue = cellText(row, keys.os);
      if (!osValue) {
        report.skippedNoOs += 1;
        continue;
      }
      const osMember = members.find((m) => m.status === "active" && m.osNickValue === osValue && m.uid);
      if (!osMember?.uid) {
        // Имя ника в отчёт: иначе «пропущено 9» — это девять заказов, про
        // которые непонятно, что чинить. Чинится закреплением ника на «Команде».
        report.skippedNoAccount += 1;
        unknownNicks.add(osValue);
        continue;
      }

      // Стола ОС может ещё не быть — заводим (это делает Owner).
      let osDesk = osDeskByUid.get(osMember.uid) ?? findOsDeskOf(pages, osMember.uid);
      if (!osDesk) {
        try {
          osDesk = await ensureOsDesk({ workspaceId, uid: osMember.uid, name: personLabel(osMember) });
          osDeskByUid.set(osMember.uid, osDesk);
          report.createdOsDesks += 1;
        } catch (error) {
          report.errors.push(`Стол ОС для «${personLabel(osMember)}» не завёлся — ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
      }

      const techNick = members.find((m) => m.uid === page.responsibleUserId)?.techNickValue ?? "";
      const srcId = sourceRowIdFor(row.id);
      const srcCells: Record<string, string> = {};
      const put = (key: string, value: string) => {
        if (value) srcCells[key] = value;
      };
      put("client", cellText(row, keys.client));
      put("phone", cellText(row, keys.phone));
      // Цена у технаря — это уже сумма заказа; апсейл отдельной цифрой ОС
      // проставит сам, разделить задним числом нельзя.
      put("price", cellText(row, keys.price));
      put("link", cellText(row, keys.link));
      put("note", String(row.extras?.note ?? ""));
      const techColumn = OS_DESK_COLUMNS.find((c) => c.type === "technician");
      if (techColumn && techNick) srcCells[techColumn.key] = techNick;

      const syncHash = mirrorSyncHash(row.cells, row.extras);
      try {
        // 1. Строка-источник в столе ОС (адрес копии — на неё).
        await sbPatchRow(workspaceId, osDesk.id, null, srcId, {
          cells: srcCells,
          extras: row.extras ?? undefined,
          syncHash,
          mirrorPageId: page.id,
          mirrorTabId: tabId,
          mirrorRowId: row.id,
        });
        // 2. Строка технаря переходит под управление ОС.
        await sbPatchRow(workspaceId, page.id, tabId, row.id, {
          cells: {},
          osUid: osMember.uid,
          techUid: page.responsibleUserId as string,
          // Только настоящий ключ столбца: по нему Тимлид получает право
          // поставить «Успешку», и выдуманный ключ дал бы право в никуда.
          statusKey: keys.status,
          syncHash,
          srcPageId: osDesk.id,
          srcTabId: "",
          srcRowId: srcId,
        });
        report.adopted += 1;
      } catch (error) {
        report.errors.push(`«${page.name}» / строка ${row.id} — ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  report.unknownOsNicks = [...unknownNicks].sort((a, b) => a.localeCompare(b, "ru"));
  return report;
}

/**
 * Снять управление со ВСЕХ заказов — аварийный выход, если ОС недоступен, а
 * заказы надо вести дальше. Строки остаются на месте и снова становятся
 * обычными строками технаря; строки-источники в столах ОС не трогаем — они
 * никому не мешают, а удалять чужие данные в аварийной кнопке нельзя.
 */
export async function releaseAllOrders(input: {
  workspaceId: string;
  onProgress?: (p: OsAdoptionProgress) => void;
}): Promise<{ released: number; errors: string[] }> {
  const { workspaceId } = input;
  if (!usesSupabaseRows(workspaceId)) {
    throw new Error("Управление снимается только когда строки живут в Supabase");
  }
  const pages = await fetchPagesFresh(workspaceId);
  const desks = pages.filter((p) => !p.osDesk);
  const errors: string[] = [];
  let released = 0;
  let done = 0;
  for (const page of desks) {
    done += 1;
    input.onProgress?.({ done, total: desks.length, label: page.name });
    try {
      released += await releaseDeskOrders(workspaceId, page);
    } catch (error) {
      errors.push(`«${page.name}» — ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { released, errors };
}

/**
 * Снять управление со всех заказов стола — по ВСЕМ вкладкам, а не только по
 * текущему месяцу: заказ, выданный в сентябре, в октябре лежит в прошлой
 * вкладке, и аварийная кнопка обязана расстегнуть и его.
 */
export async function releaseDeskOrders(workspaceId: string, page: WorkspacePage): Promise<number> {
  const byTab = await sbFetchAllPageRows(workspaceId, page.id);
  let released = 0;
  for (const [tabId, rows] of byTab) {
    for (const row of rows) {
      if (!row.osUid) continue;
      await sbPatchRow(workspaceId, page.id, tabId || null, row.id, { cells: {}, releaseOrder: true });
      released += 1;
    }
  }
  return released;
}
