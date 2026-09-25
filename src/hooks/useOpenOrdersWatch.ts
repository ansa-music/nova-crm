import { useEffect } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { watchOpenOrders } from "@/services/openOrdersPulse";
import { useOrdersBackend } from "@/services/orderStore";

/**
 * Один слушатель открытых заказов на приложение — зажигает «Заказы» в меню.
 * Висит, только пока вкладку видно, а на самой странице «Заказы» его заменяет
 * её собственная подписка (подробности — в openOrdersPulse.ts).
 */
export function useOpenOrdersWatch() {
  const { activeWorkspaceId } = useWorkspace();
  const backend = useOrdersBackend(activeWorkspaceId);
  useEffect(() => (backend ? watchOpenOrders(activeWorkspaceId, backend) : undefined), [activeWorkspaceId, backend]);
}
