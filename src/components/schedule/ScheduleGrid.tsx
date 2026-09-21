import { useEffect, useMemo, useRef, useState } from "react";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/utils/cn";
import { personLabel } from "@/utils/peopleDesks";
import { setScheduleDay } from "@/services/techScheduleService";
import {
  SCHEDULE_DAY_LABELS,
  scheduleStateOf,
  type ScheduleDayState,
  type TechSchedule,
  type WorkspaceMember,
} from "@/types";

export const SCHEDULE_STATE_STYLE: Record<ScheduleDayState, string> = {
  work: "border-border/50 text-muted-foreground/70",
  off: "border-destructive/45 bg-destructive/15 text-destructive",
  excused: "border-warning/45 bg-warning/15 text-warning",
};

/** Клик по дню перебирает состояния по кругу — меню на каждую из 31 клетки было бы пыткой. */
const NEXT_STATE: Record<ScheduleDayState, ScheduleDayState> = {
  work: "off",
  off: "excused",
  excused: "work",
};

export function daysOfMonth(monthKey: string): string[] {
  const [year, month] = monthKey.split("-").map(Number);
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => String(i + 1));
}

/** Суббота и воскресенье — только подсветка заголовка, выходным днём сами по себе не считаются. */
function isWeekend(monthKey: string, dayKey: string): boolean {
  const [year, month] = monthKey.split("-").map(Number);
  const dow = new Date(Date.UTC(year, month - 1, Number(dayKey))).getUTCDay();
  return dow === 0 || dow === 6;
}

/**
 * Сетка графика: люди по строкам, дни месяца по колонкам.
 *
 * Одна строка = один человек = один документ графика, даже если у него две
 * роли. Иначе Тимлид + Технарь получил бы две строки на один и тот же
 * документ, и правка в одной молча меняла бы вторую.
 */
export function ScheduleGrid({
  workspaceId,
  monthKey,
  todayKey,
  people,
  schedules,
  canEdit,
  actorUid,
}: {
  workspaceId: string;
  monthKey: string;
  /** Сегодняшний день месяца по Алматы, или null — если смотрим не текущий месяц. */
  todayKey: string | null;
  people: WorkspaceMember[];
  schedules: Map<string, TechSchedule>;
  canEdit: boolean;
  actorUid: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const days = useMemo(() => daysOfMonth(monthKey), [monthKey]);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // На телефоне в сетку влезает неделя, а нужен всегда сегодняшний день —
  // подкручиваем ТОЛЬКО горизонтальную прокрутку самой сетки. scrollIntoView
  // утащил бы за собой и страницу, и человек открывал бы «График» где-то
  // посередине экрана.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !todayKey) return;
    const cell = scroller.querySelector<HTMLElement>(`[data-day="${todayKey}"]`);
    if (!cell) return;
    // Считаем от прямоугольников, а не от offsetLeft: у ячейки нет
    // позиционированного предка, и offsetLeft мерил бы от чего попало.
    const cellBox = cell.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    scroller.scrollLeft += cellBox.left - box.left - box.width / 2 + cellBox.width / 2;
  }, [todayKey, monthKey, people.length]);

  async function cycleDay(member: WorkspaceMember, dayKey: string) {
    if (!canEdit) return;
    const current = scheduleStateOf(schedules.get(member.uid), dayKey);
    setBusy(`${member.uid}:${dayKey}`);
    try {
      await setScheduleDay({
        workspaceId,
        uid: member.uid,
        monthKey,
        dayKey,
        state: NEXT_STATE[current],
        actorUid,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось изменить график");
    } finally {
      setBusy(null);
    }
  }

  if (people.length === 0) return null;

  return (
    <div ref={scrollerRef} className="overflow-x-auto">
      <table className="border-separate border-spacing-0 text-[11px]">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 w-28 min-w-[7rem] bg-card px-2 py-1 sm:w-40 sm:min-w-[10rem] text-left font-medium text-muted-foreground">
              Кто
            </th>
            {days.map((d) => (
              <th
                key={d}
                className={cn(
                  "w-7 px-0 py-1 text-center font-mono text-[10px] font-medium tabular-nums",
                  d === todayKey
                    ? "text-primary"
                    : isWeekend(monthKey, d)
                      ? "text-foreground/70"
                      : "text-muted-foreground/60"
                )}
              >
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {people.map((member) => {
            const schedule = schedules.get(member.uid) ?? null;
            return (
              <tr key={member.uid}>
                <td className="sticky left-0 z-10 w-28 min-w-[7rem] bg-card py-0.5 pr-2 sm:w-40 sm:min-w-[10rem] sm:pr-3">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <MemberAvatar
                      id={member.uid}
                      name={member.name}
                      nickname={member.nickname}
                      photoURL={member.photoURL}
                      className="h-6 w-6 shrink-0"
                    />
                    <span className="min-w-0 flex-1 truncate text-[12px]">{personLabel(member)}</span>
                  </span>
                </td>
                {days.map((d) => {
                  const state = scheduleStateOf(schedule, d);
                  const selfWork = Boolean(schedule?.selfWork?.[d]);
                  return (
                    <td key={d} data-day={d} className="p-px text-center">
                      <button
                        type="button"
                        disabled={!canEdit || busy !== null}
                        onClick={() => void cycleDay(member, d)}
                        title={`${personLabel(member)} · ${d} — ${SCHEDULE_DAY_LABELS[state]}${
                          selfWork ? " (вышел на смену сам)" : ""
                        }`}
                        className={cn(
                          "h-7 w-7 rounded-sm border text-[10px] font-semibold transition-colors",
                          SCHEDULE_STATE_STYLE[state],
                          state === "work" && isWeekend(monthKey, d) && "bg-foreground/[0.07]",
                          d === todayKey && "ring-1 ring-primary/60",
                          canEdit ? "cursor-pointer hover:brightness-125" : "cursor-default"
                        )}
                      >
                        {busy === `${member.uid}:${d}`
                          ? "·"
                          : state === "off"
                            ? "В"
                            : state === "excused"
                              ? "О"
                              : selfWork
                                ? "✓"
                                : ""}
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ScheduleLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span className={cn("h-4 w-4 rounded-sm border", SCHEDULE_STATE_STYLE.off)} /> Выходной
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className={cn("h-4 w-4 rounded-sm border", SCHEDULE_STATE_STYLE.excused)} /> Отпросился
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="flex h-4 w-4 items-center justify-center rounded-sm border border-border/50 text-[9px]">✓</span>
        Вышел на смену сам
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-4 w-4 rounded-sm border border-border/50 bg-foreground/[0.07]" /> Суббота и воскресенье
      </span>
    </div>
  );
}
