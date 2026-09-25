import { useEffect, useState } from "react";
import { orderRequestId, subscribeMyPendingOrderRequests, useOrderRequestsBackend, type OrderRequest } from "@/services/orderRequestService";

/**
 * Мои ожидающие просьбы к ОС — метка «Просит: Готово» в ячейке статуса.
 * Слушатель живёт, только пока открыт свой стол (`enabled`). Ключ карты —
 * тот же id, что у документа просьбы (`orderRequestId(стол, строка)`).
 */
export function useMyPendingOrderRequests(
  workspaceId: string | null,
  uid: string,
  enabled: boolean
): Map<string, OrderRequest> {
  const [map, setMap] = useState<Map<string, OrderRequest>>(() => new Map());
  const backend = useOrderRequestsBackend(workspaceId);
  useEffect(() => {
    setMap(new Map());
    if (!workspaceId || !uid || !enabled || !backend) return;
    return subscribeMyPendingOrderRequests(
      workspaceId,
      uid,
      (requests) => setMap(new Map(requests.map((r) => [orderRequestId(r.deskPageId, r.rowId), r]))),
      // Отказ = «не знаем»: метки «просит» не рисуем, кнопка «Готово?» остаётся.
      (error) => console.error("Свои просьбы к ОС не прочитаны:", error.message),
      backend
    );
  }, [workspaceId, uid, enabled, backend]);
  return map;
}
