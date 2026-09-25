import { useEffect, useState } from "react";
import { subscribePendingOrderRequests, useOrderRequestsBackend, type OrderRequest } from "@/services/orderRequestService";
import { joinSharedSubscription } from "@/utils/sharedSubscription";

/**
 * Ожидающие просьбы технарей к этому ОС — ОДНА подписка на приложение: её
 * читают счётчик на пункте «Стол ОС» в меню, метка «Просит: …» в ячейке
 * статуса и плашка «Запросы технарей» над столом. Запрос узкий
 * (`osUid == я && state == pending`, два равенства — индекс не нужен), обычно
 * пустой. Отказ чтения = «не знаем»: счётчик молчит, а не врёт «0».
 */
export interface OsPendingRequests {
  requests: OrderRequest[];
  loaded: boolean;
}

const EMPTY: OsPendingRequests = { requests: [], loaded: false };

export function useOsPendingOrderRequests(workspaceId: string | null, osUid: string | null, enabled: boolean): OsPendingRequests {
  const [state, setState] = useState<OsPendingRequests>(EMPTY);
  const backend = useOrderRequestsBackend(workspaceId);
  useEffect(() => {
    setState(EMPTY);
    if (!workspaceId || !osUid || !enabled || !backend) return;
    return joinSharedSubscription<OsPendingRequests>(
      `os-order-requests:${workspaceId}:${osUid}:${backend}`,
      (emit) =>
        subscribePendingOrderRequests(
          workspaceId,
          osUid,
          (requests) => emit({ requests, loaded: true }),
          (error) => {
            console.error("Запросы технарей не прочитаны:", error.message);
            emit(EMPTY);
          },
          backend
        ),
      setState
    );
  }, [workspaceId, osUid, enabled, backend]);
  return state;
}
