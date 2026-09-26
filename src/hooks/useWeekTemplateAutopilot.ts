import { useEffect } from "react";
import { useCurrentMonthKey } from "@/hooks/useCurrentMonthKey";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { layWeekTemplateAhead } from "@/services/scheduleTemplateService";
import { ensureScheduleImported } from "@/services/scheduleStore";
import { ymdInTimeZone } from "@/utils/date";

// Раз на загрузку страницы для пары workspace+месяц. Сбой ждёт следующей
// загрузки, а не повторяется на каждом снимке.
const attempted = new Set<string>();

/**
 * Держит недельный график разложенным на месяц вперёд (см.
 * `layWeekTemplateAhead`). Живёт в AppLayout, а не на «Графике»: 1-го числа
 * «Заказы» и «Технари» должны видеть выходные нового месяца, даже если
 * «График» в этот день никто не открывал. Пишет график только руководство —
 * значит, и автопилот запускает только его сессия (по НАСТОЯЩЕЙ роли:
 * симуляция роли — это про интерфейс, а не про фоновую работу).
 */
export function useWeekTemplateAutopilot() {
  const { activeWorkspaceId } = useWorkspace();
  const permissions = usePermissions();
  const monthKey = useCurrentMonthKey();
  const uid = permissions.uid;
  const enabled = permissions.upkeepRetire && Boolean(uid && activeWorkspaceId);

  useEffect(() => {
    if (!enabled || !activeWorkspaceId || !uid) return;
    // Месяц и день — из ОДНОГО чтения часов. `monthKey` из хука отстаёт до
    // минуты после полуночи 1-го, и пара «прошлый месяц + день 1» разложила бы
    // неделю по уже прошедшему месяцу. Хук здесь — только повод перепроверить.
    const ymd = ymdInTimeZone(Date.now());
    const currentMonth = ymd.slice(0, 7);
    const key = `${activeWorkspaceId}:${currentMonth}`;
    if (attempted.has(key)) return;
    attempted.add(key);
    // Сначала — перенос графика в Supabase (разово; трое суток после —
    // дочитка правок старых вкладок), потом раскладка уже там, где график.
    void ensureScheduleImported(activeWorkspaceId)
      .then((n) => {
        if (n > 0) console.info(`[schedule] перенесено в Supabase документов: ${n}`);
      })
      .catch((error) => console.warn("[schedule] перенос графика в Supabase не удался — повторим при следующей загрузке", error))
      .then(() =>
        layWeekTemplateAhead({
          workspaceId: activeWorkspaceId,
          actorUid: uid,
          window: { currentMonth, today: Number(ymd.slice(8, 10)) },
        })
      )
      .catch((error) => {
        console.error("Не удалось разложить недельный график на месяц вперёд:", error);
      });
  }, [enabled, activeWorkspaceId, uid, monthKey]);
}
