import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { readTelegramSessionMark, useTelegramAccess } from "@/services/telegram/telegramAccess";
import { listenTgInbox } from "@/services/telegram/tgInboxPulse";
import { myDisplayName } from "@/utils/displayName";

/**
 * Telegram держит соединение на любой странице Nova, а не только в разделе
 * (жалоба Nurba 26.09.2026: «должно быть постоянным, как WhatsApp в amoCRM»).
 * Тем, кто уже входил в этом браузере, через 3 с после загрузки поднимаем
 * клиент в фоне: сообщения приходят, непрочитанные горят в меню, раздел
 * открывается сразу. Соединение одно на браузер (блокировка в tgClient):
 * остальные вкладки ждут в очереди и подхватывают его, когда эта закроется.
 * Кто не входил — ничего не грузим (библиотека Telegram ~300 КБ).
 */
export function TelegramBackground() {
  const { activeWorkspaceId, members } = useWorkspace();
  const { profile } = useAuth();
  const { isResolved } = usePermissions();
  const uid = profile?.uid ?? null;
  const access = useTelegramAccess(activeWorkspaceId, uid, isResolved);
  const config = access.config;
  const granted = access.granted;
  const deviceName = `Nova · ${myDisplayName(profile, members)}`;

  useEffect(() => {
    if (!granted || !config || !activeWorkspaceId || !uid) return;
    if (!readTelegramSessionMark(activeWorkspaceId, uid)) return;
    const timer = setTimeout(() => {
      void import("@/services/telegram/tgClient")
        .then((m) => m.openTelegram({ workspaceId: activeWorkspaceId, uid, config, deviceName }))
        .catch((error) => console.warn("[telegram] фоновый запуск не удался", error));
    }, 3000);
    return () => clearTimeout(timer);
    // deviceName меняется с ником — соединение из-за этого не пересоздаём.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granted, config?.apiId, config?.apiHash, activeWorkspaceId, uid]);

  useEffect(() => {
    if (!granted || !activeWorkspaceId || !uid) return;
    return listenTgInbox(`${activeWorkspaceId}:${uid}`);
  }, [granted, activeWorkspaceId, uid]);

  return null;
}
