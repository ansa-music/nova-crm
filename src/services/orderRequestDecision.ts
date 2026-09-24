import { resolveOrderRequest, type OrderRequest } from "@/services/orderRequestService";
import { sbDeleteRow, sbPatchRow } from "@/services/rows/supabaseRowStore";
import type { PageRow } from "@/types";

/**
 * ОС решает просьбу технаря — одно место на плашку «Запросы технарей» и на
 * метку «Просит: …» в ячейке статуса стола ОС.
 *
 * «Поставить» делает ровно то, о чём просили: статус — в строку ОС (оттуда
 * его увезёт база/проход) и сразу в строку технаря; «удалить» — копию у
 * технаря и строку-источник у ОС. Адреса берутся из СВОЕЙ строки-заказа ОС
 * (`useMyOrderRows`: база отдаёт ОС только строки с его os_uid), а не из
 * запроса: запрос пишет технарь, и подложенный srcRowId заставил бы ОС
 * стереть или поменять не тот заказ.
 */
export async function decideOrderRequest(input: {
  workspaceId: string;
  request: OrderRequest;
  approved: boolean;
  osUid: string;
  /** Заказы этого ОС в столах технарей (useMyOrderRows). */
  mirrors: PageRow[];
  /** Ключ статуса на столе ОС (`resolveOsDeskKeys().status`). */
  statusKey: string;
  me: { uid: string; name: string };
}): Promise<void> {
  const { workspaceId, request, approved, osUid, mirrors, statusKey, me } = input;
  if (approved) {
    const mirror = findRequestMirror(request, mirrors, osUid);
    if (!mirror || !mirror.srcPageId || !mirror.srcRowId) {
      throw new Error("Заказ у технаря не найден среди ваших — возможно, его уже убрали или передали. Отклоните запрос.");
    }
    const tabId = mirror.tabId ?? "";
    if (request.kind === "status" && request.status) {
      await sbPatchRow(workspaceId, mirror.srcPageId, mirror.srcTabId ?? "", mirror.srcRowId, {
        cells: { [statusKey]: request.status },
      });
      if (mirror.statusKey) {
        await sbPatchRow(workspaceId, request.deskPageId, tabId, mirror.id, {
          cells: { [mirror.statusKey]: request.status },
        });
      }
    }
    if (request.kind === "delete") {
      await sbDeleteRow(workspaceId, request.deskPageId, tabId, mirror.id);
      await sbDeleteRow(workspaceId, mirror.srcPageId, mirror.srcTabId ?? "", mirror.srcRowId);
    }
  }
  await resolveOrderRequest(workspaceId, request, approved, me);
}

/** Строка-заказ ОС у технаря, о которой просьба, — только своя и только этого технаря. */
export function findRequestMirror(request: OrderRequest, mirrors: PageRow[], osUid: string): PageRow | null {
  const mirror = mirrors.find((m) => m.id === request.rowId && m.deskPageId === request.deskPageId);
  if (!mirror || mirror.osUid !== osUid || mirror.techUid !== request.techUid) return null;
  return mirror;
}
