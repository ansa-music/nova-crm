import { ensureOsDesk, findOsDeskOf, OS_DESK_COLUMNS } from "@/services/osDeskService";
import { fetchPagesFresh } from "@/services/pageService";
import { sbFetchAllPageRows, sbFetchRows, sbPatchRow } from "@/services/rows/supabaseRowStore";
import { usesSupabaseRows } from "@/services/rows/rowsBackend";
import { mirrorSyncHash } from "@/services/rows/osOrderMirror";
import { isBlankRow } from "@/utils/blankRow";
import { personLabel } from "@/utils/peopleDesks";
import type { PageRow, WorkspaceMember, WorkspacePage } from "@/types";

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
  desks: number;
  adopted: number;
  alreadyManaged: number;
  skippedNoOs: number;
  skippedNoAccount: number;
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

export async function adoptOrdersToOsDesks(input: {
  workspaceId: string;
  members: readonly WorkspaceMember[];
  onProgress?: (p: OsAdoptionProgress) => void;
}): Promise<OsAdoptionReport> {
  const { workspaceId, members } = input;
  const report: OsAdoptionReport = {
    desks: 0,
    adopted: 0,
    alreadyManaged: 0,
    skippedNoOs: 0,
    skippedNoAccount: 0,
    createdOsDesks: 0,
    errors: [],
  };
  if (!usesSupabaseRows(workspaceId)) {
    throw new Error("Заказы переносятся только когда строки живут в Supabase");
  }

  // Список столов — СВЕЖИЙ с сервера: неполный список молча оставил бы часть
  // заказов у технарей (урок прошлого переноса).
  const pages = await fetchPagesFresh(workspaceId);
  const techDesks = pages.filter((p) => !p.osDesk && !p.inactive && p.autoMonthSubPageId && p.responsibleUserId);
  const osDeskByUid = new Map<string, WorkspacePage>();
  for (const page of pages) if (page.osDesk && page.responsibleUserId) osDeskByUid.set(page.responsibleUserId, page);

  let done = 0;
  for (const page of techDesks) {
    done += 1;
    input.onProgress?.({ done, total: techDesks.length, label: page.name });
    const tabId = page.autoMonthSubPageId as string;
    const keys = page.osFieldKeys;
    if (!keys || keys.tabId !== tabId) {
      report.errors.push(`«${page.name}»: стол не сообщил ключи столбцов — пусть его откроют и повторите`);
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
        report.skippedNoAccount += 1;
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
