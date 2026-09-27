import { useEffect } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { watchOpenOrders } from "@/services/openOrdersPulse";
import { useSiteConfig } from "@/config/siteTerms";
import { isModuleEnabled } from "@/types/siteConfig";
import { useOrdersBackend } from "@/services/orderStore";

/**
 * Один слушатель открытых заказов на приложение — зажигает «Заказы» в меню.
 * Висит, только пока вкладку видно, а на самой странице «Заказы» его заменяет
 * её собственная подписка (подробности — в openOrdersPulse.ts).
 */
export function useOpenOrdersWatch() {
  const { activeWorkspaceId } = useWorkspace();
  const backend = useOrdersBackend(activeWorkspaceId);
  const ordersOn = isModuleEnabled(useSiteConfig(), "orders");
  useEffect(
    () => (backend && ordersOn ? watchOpenOrders(activeWorkspaceId, backend) : undefined),
    [activeWorkspaceId, backend, ordersOn]
  );
}
