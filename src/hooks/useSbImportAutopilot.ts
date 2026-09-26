import { useEffect } from "react";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { ensureAnnouncementsImported } from "@/services/announcementService";

// Раз на загрузку страницы для workspace. Сбой ждёт следующей загрузки.
const attempted = new Set<string>();

/**
 * Разовый перенос коллекций Firestore → Supabase (объявления, Грок), когда
 * Owner включил Supabase и SQL накатан. Переносит сессия руководства ПО
 * НАСТОЯЩЕЙ роли: симуляция роли — про интерфейс, а не про фоновую работу.
 * Пока отметки переноса нет, все читают и пишут Firestore, так что до
 * первого входа руководства ничего не меняется. Трое суток после переноса
 * та же сессия дочитывает правки вкладок на старом коде.
 */
export function useSbImportAutopilot() {
  const { activeWorkspaceId, activeWorkspace } = useWorkspace();
  const permissions = usePermissions();
  const lead = permissions.upkeepRetire;
  const rowsBackend = activeWorkspace?.rowsBackend ?? null;

  useEffect(() => {
    if (!lead || !activeWorkspaceId || rowsBackend !== "supabase") return;
    const key = `${activeWorkspaceId}:ann`;
    if (attempted.has(key)) return;
    attempted.add(key);
    void ensureAnnouncementsImported(activeWorkspaceId)
      .then((n) => {
        if (n > 0) console.info(`[announcements] перенесено в Supabase: ${n}`);
      })
      .catch((error) => console.warn("[announcements] перенос в Supabase не удался — повторим при следующей загрузке", error));
  }, [lead, activeWorkspaceId, rowsBackend]);
}
