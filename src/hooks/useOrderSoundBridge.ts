import { useEffect } from "react";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { setOrderSoundConfig } from "@/utils/browserNotify";

/**
 * Звук заказа, выбранный Owner (`workspace.orderSound`), — в проигрыватель
 * `browserNotify`. Узкий селектор по СТРОКЕ настройки: документ workspace
 * пересобирается на каждый снимок, а звук меняется редко. Owner сменил звук —
 * у открытых вкладок он меняется без перезагрузки.
 */
export function useOrderSoundBridge() {
  const key = useWorkspaceStore((s) => {
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
    return JSON.stringify(ws?.orderSound ?? null);
  });
  useEffect(() => {
    setOrderSoundConfig(JSON.parse(key));
  }, [key]);
}
