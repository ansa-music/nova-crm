import { resolveOrderRequest, type OrderRequest } from "@/services/orderRequestService";
import { sbDeleteRow, sbPatchRow } from "@/services/rows/supabaseRowStore";
import type { PageRow } from "@/types";
import type { ClaimedForRequest } from "@/hooks/useOsOrderClaims";

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
  /**
   * Просьба по заказу, который ОС ещё не ведёт (заказ с «Заказов» или
   * вписанный технарём с ником ОС — подхват его не забрал): сначала забрать
   * строку к себе на стол (`claimRowForRequest`). Есть только у самого ОС —
   * забирать заказ база пускает только его.
   */
  claimUnclaimed?: (request: OrderRequest) => Promise<ClaimedForRequest>;
}): Promise<void> {
  const { workspaceId, request, approved, osUid, mirrors, statusKey, me } = input;
  if (approved && !request.srcRowId && !findRequestMirror(request, mirrors, osUid)) {
    if (!input.claimUnclaimed) {
      throw new Error("Этот заказ ОС ещё не взял к себе на стол — решить просьбу может только сам ОС. Отклоните или подождите его.");
    }
    const claimed = await input.claimUnclaimed(request);
    const techTab = request.deskTabId ?? "";
    if (request.kind === "status" && request.status) {
      await sbPatchRow(workspaceId, claimed.srcPageId, claimed.srcTabId, claimed.srcRowId, {
        cells: { [statusKey]: request.status },
      });
      await sbPatchRow(workspaceId, request.deskPageId, techTab, request.rowId, {
        cells: { [claimed.techStatusKey || "status"]: request.status },
      });
    }
    if (request.kind === "delete") {
      await sbDeleteRow(workspaceId, request.deskPageId, techTab, request.rowId);
      await sbDeleteRow(workspaceId, claimed.srcPageId, claimed.srcTabId, claimed.srcRowId);
    }
    await resolveOrderRequest(workspaceId, request, approved, me);
    return;
  }
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
