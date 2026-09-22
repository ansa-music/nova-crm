import { useEffect } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { watchOpenOrders } from "@/services/openOrdersPulse";

/** Один слушатель открытых заказов на приложение — зажигает «Заказы» в меню. */
export function useOpenOrdersWatch() {
  const { activeWorkspaceId } = useWorkspace();
  useEffect(() => watchOpenOrders(activeWorkspaceId), [activeWorkspaceId]);
}
