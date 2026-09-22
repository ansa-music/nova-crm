import { useEffect } from "react";
import { refreshWorkspaceMembers } from "@/hooks/useWorkspace";

/**
 * Освежить список участников (он в браузере не живой) — при открытии экрана
 * и при возвращении на вкладку, но не чаще раза в 5 минут. Раньше
 * «Пользователи» и «Команда» перечитывали весь список КАЖДУЮ минуту, пока
 * открыты: ~40 чтений в минуту, до 2 400 в час на открытую вкладку — заметная
 * доля дневной квоты Spark (50 000), которая 22.09.2026 кончилась к обеду.
 * Точность от этого не страдает: занятость ника при записи всё равно
 * проверяется свежим запросом к серверу (`assertNickFree`).
 */
const MIN_GAP_MS = 5 * 60_000;
const lastRefreshAt = new Map<string, number>();

export function useMembersRefresh(
  workspaceId: string | null | undefined,
  enabled: boolean,
  /**
   * Освежать и при возвращении на вкладку. На «Пользователях»/«Команде» — да
   * (там раньше был опрос раз в минуту), на «Дашборде», «Технарях» и
   * «Графике» — нет: там список читали только при открытии, и возврат на
   * вкладку не должен добавлять чтений.
   */
  refreshOnVisible = true
) {
  useEffect(() => {
    if (!workspaceId || !enabled) return;
    const refresh = (force: boolean) => {
      const now = Date.now();
      const last = lastRefreshAt.get(workspaceId) ?? 0;
      if (!force && now - last < MIN_GAP_MS) return;
      lastRefreshAt.set(workspaceId, now);
      void refreshWorkspaceMembers(workspaceId).catch(() => undefined);
    };
    // Открыли экран — один раз, но тоже не чаще раза в 5 минут: переходы
    // «Пользователи» ↔ «Команда» туда-обратно иначе читали бы список каждый раз.
    refresh(false);
    if (!refreshOnVisible) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [workspaceId, enabled, refreshOnVisible]);
}
