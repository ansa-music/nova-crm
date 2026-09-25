import { useState } from "react";
import { Loader2, Star } from "lucide-react";
import { ScorePicker, SCORE_TONE } from "@/components/technicians/ScoreRating";
import { toast } from "@/components/ui/sonner";
import { useCurrentMonthKey } from "@/hooks/useCurrentMonthKey";
import { useOrderRatings } from "@/hooks/useDeskLoads";
import { useWorkspace } from "@/hooks/useWorkspace";
import { orderRatingId, rateOrder, RatingDeniedError, removeOrderRating } from "@/services/orderRatingService";
import { cn } from "@/utils/cn";
import { timeAgo } from "@/utils/date";
import type { PageRow } from "@/types";

/** Месяц заказа — из id месячной вкладки `month-YYYY-MM`, иначе текущий. */
function monthOfTab(tabId: string | undefined, fallback: string): string {
  const match = /^month-(\d{4}-\d{2})$/.exec(tabId ?? "");
  return match ? match[1] : fallback;
}

/**
 * Оценка работы технаря прямо в карточке заказа на столе ОС (1–10). ОС
 * работает здесь, а не на «Технари»: выдал, получил «Готово» — оценил, не
 * уходя со стола. Показывается только ОС этого заказа (строка-копия у
 * технаря ведётся им — `mirror.osUid`); право всё равно проверяет база.
 */
export function OsOrderRating({
  mirror,
  osUid,
  osNickValue,
  title,
  done,
}: {
  /** Копия заказа в столе технаря (из `useMyOrderRows`). */
  mirror: PageRow;
  osUid: string;
  osNickValue: string;
  title: string;
  /** У технаря заказ уже в «Готово» — зовём оценить заметнее. */
  done: boolean;
}) {
  const { activeWorkspaceId, pages } = useWorkspace();
  const monthKey = useCurrentMonthKey();
  const { ratings, backend } = useOrderRatings(activeWorkspaceId, { kind: "os", uid: osUid }, monthKey, Boolean(osUid));
  const [saving, setSaving] = useState(false);
  const pageId = mirror.deskPageId ?? mirror.pageId;
  const tabId = mirror.tabId ?? "";
  const current = ratings?.find((r) => r.id === orderRatingId(pageId, mirror.id)) ?? null;
  const technicianUid = mirror.techUid || pages.find((p) => p.id === pageId)?.responsibleUserId || "";

  async function handle(score: number | null) {
    if (!activeWorkspaceId || saving) return;
    if (score === null && !current) return;
    setSaving(true);
    try {
      if (score === null && current) {
        await removeOrderRating(activeWorkspaceId, current);
        toast.success("Оценка снята");
      } else if (score !== null) {
        await rateOrder({
          workspaceId: activeWorkspaceId,
          backend: backend ?? "firestore",
          pageId,
          tabId,
          rowId: mirror.id,
          osUid,
          osValue: osNickValue,
          technicianUid,
          score,
          title,
          monthKey: monthOfTab(tabId, monthKey),
          previous: current,
        });
        toast.success(current ? `Оценка изменена: ${score} из 10` : `Заказ оценён: ${score} из 10`);
      }
    } catch (error) {
      toast.error(error instanceof RatingDeniedError ? error.message : "Не удалось сохранить оценку");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border p-2.5",
        current ? "border-border/70" : done ? "border-amber-400/40 bg-amber-400/[0.06]" : "border-dashed border-border/70"
      )}
    >
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
        <Star className={cn("h-4 w-4 shrink-0", current || done ? SCORE_TONE.text : "text-muted-foreground")} />
        <span className="font-medium">Оценка работы технаря</span>
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
        <span className="ml-auto text-xs text-muted-foreground">
          {current
            ? `${current.score} из 10 · ${timeAgo(current.updatedAt)}`
            : ratings === null
              ? "…"
              : done
                ? "заказ готов — оцените"
                : "из 10, можно поменять"}
        </span>
      </p>
      <ScorePicker value={current?.score ?? null} onChange={(score) => void handle(score)} disabled={saving || ratings === null} label="Оценка работы технаря" />
    </div>
  );
}
