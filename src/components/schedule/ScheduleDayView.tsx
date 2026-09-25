import { useEffect, useMemo, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import {
  CELL_KIND_LOOK,
  daysOfMonth,
  initialsName,
  isWeekend,
  weekdayOf,
  WEEKDAY_LETTERS,
  type ScheduleRow,
} from "@/components/schedule/scheduleShared";
import type { ScheduleDensity } from "@/components/schedule/scheduleDensity";
import { cn } from "@/utils/cn";
import {
  formatScheduleHours,
  scheduleHoursOf,
  scheduleStateOf,
  type ScheduleDayState,
  type ScheduleHours,
  type TechSchedule,
} from "@/types";

export interface DaySection {
  id: string;
  title: string;
  icon: LucideIcon;
  rows: ScheduleRow[];
  /** Норма на смене (0 — без нормы). */
  min: number;
}

interface PersonDay {
  row: ScheduleRow;
  state: ScheduleDayState;
  hours: ScheduleHours | null;
  came: boolean;
}

function dayOf(row: ScheduleRow, schedules: Map<string, TechSchedule>, dayKey: string): PersonDay {
  const schedule = schedules.get(row.uid) ?? null;
  const state = scheduleStateOf(schedule, dayKey);
  return {
    row,
    state,
    hours: state === "work" ? scheduleHoursOf(schedule, dayKey) : null,
    came: Boolean(schedule?.selfWork?.[dayKey]) && Boolean(schedule?.days?.[dayKey]),
  };
}

/** Сколько на смене в день — для полоски дней наверху. */
export function onShiftCount(rows: ScheduleRow[], schedules: Map<string, TechSchedule>, dayKey: string): number {
  return rows.filter((row) => scheduleStateOf(schedules.get(row.uid) ?? null, dayKey) === "work").length;
}

/**
 * «День» — кто работает в выбранный день, списком, крупно. Это вид для
 * мониторинга: «кто сегодня на смене, у кого смена с 12, кого нет» — в сетке
 * на 31 колонку его приходилось собирать глазами по столбцу. С телефона это
 * вообще единственный удобный способ посмотреть чужой день.
 *
 * Кто правит график, тапает по человеку — та же палитра, что в сетке
 * месяца («Выходной», «Отпросился», смена, «Весь месяц»).
 */
export function ScheduleDayView({
  monthKey,
  dayKey,
  todayKey,
  sections,
  schedules,
  canEdit,
  density,
  selectedUid,
  onSelectDay,
  onPickPerson,
  onOpenPerson,
}: {
  monthKey: string;
  dayKey: string;
  todayKey: string | null;
  sections: DaySection[];
  schedules: Map<string, TechSchedule>;
  canEdit: boolean;
  density: ScheduleDensity;
  /** Чей день сейчас открыт в палитре — подсветить чип. */
  selectedUid?: string | null;
  onSelectDay: (dayKey: string) => void;
  /** Тап по человеку у того, кто правит: палитра у этого чипа. */
  onPickPerson: (row: ScheduleRow, anchor: HTMLElement) => void;
  onOpenPerson: (row: ScheduleRow) => void;
}) {
  const days = useMemo(() => daysOfMonth(monthKey), [monthKey]);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const allRows = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  const big = density === "large";
  const small = density === "compact";

  // Выбранный день — в середину полоски (только её горизонтальная прокрутка).
  useEffect(() => {
    const strip = stripRef.current;
    const cell = strip?.querySelector<HTMLElement>(`[data-strip-day="${dayKey}"]`);
    if (!strip || !cell) return;
    const cellBox = cell.getBoundingClientRect();
    const box = strip.getBoundingClientRect();
    strip.scrollLeft += cellBox.left - box.left - box.width / 2 + cellBox.width / 2;
  }, [dayKey, monthKey]);

  const shortDays = useMemo(() => {
    // День «не хватает людей» — хоть в одном разделе с нормой меньше нормы.
    const out = new Set<string>();
    for (const d of days) {
      if (sections.some((s) => s.min > 0 && onShiftCount(s.rows, schedules, d) < s.min)) out.add(d);
    }
    return out;
  }, [days, sections, schedules]);

  const weekday = weekdayOf(monthKey, dayKey);
  const [year, month] = monthKey.split("-").map(Number);
  const dateLabel = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", weekday: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, Number(dayKey)))
  );

  return (
    <div className="flex flex-col gap-4">
      <div ref={stripRef} className="-mx-1 overflow-x-auto px-1 pb-1">
        <div className="flex gap-1">
          {days.map((d) => {
            const count = onShiftCount(allRows, schedules, d);
            const on = d === dayKey;
            const short = shortDays.has(d);
            return (
              <button
                key={d}
                type="button"
                data-strip-day={d}
                onClick={() => onSelectDay(d)}
                aria-pressed={on}
                title={short ? `${d}: людей меньше нормы` : `${d}: на смене ${count}`}
                className={cn(
                  "flex min-w-[3rem] shrink-0 flex-col items-center rounded-lg border px-1 py-1.5 transition-colors",
                  on
                    ? "border-primary bg-primary text-primary-foreground"
                    : d === todayKey
                      ? "border-primary/60 text-primary"
                      : isWeekend(monthKey, d)
                        ? "border-border/60 bg-foreground/[0.05]"
                        : "border-border/60 hover:border-primary/40"
                )}
              >
                <span className={cn("text-[11px]", on ? "opacity-90" : "text-muted-foreground")}>
                  {WEEKDAY_LETTERS[weekdayOf(monthKey, d)]}
                </span>
                <span className="font-mono text-[16px] font-semibold tabular-nums leading-tight">{d}</span>
                <span
                  className={cn(
                    "mt-0.5 rounded-sm px-1 font-mono text-[10px] tabular-nums",
                    on ? "bg-primary-foreground/20" : short ? "bg-destructive/15 font-semibold text-destructive" : "text-muted-foreground"
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <p className={cn("font-semibold first-letter:uppercase", big ? "text-xl" : "text-lg")}>
        {dateLabel}
        {dayKey === todayKey && <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 align-middle text-[12px] font-medium text-primary">сегодня</span>}
        {(weekday === 0 || weekday === 6) && dayKey !== todayKey && (
          <span className="ml-2 align-middle text-[12px] font-normal text-muted-foreground">выходные дни недели</span>
        )}
      </p>

      {sections.map((section) => {
        const people = section.rows.map((row) => dayOf(row, schedules, dayKey));
        const full = people.filter((p) => p.state === "work" && !p.hours);
        const partial = people
          .filter((p) => p.state === "work" && p.hours)
          .sort((a, b) => (a.hours!.from || "").localeCompare(b.hours!.from || ""));
        const off = people.filter((p) => p.state === "off");
        const excused = people.filter((p) => p.state === "excused");
        const working = full.length + partial.length;
        const short = section.min > 0 && working < section.min;
        const Icon = section.icon;
        const chip = (p: PersonDay) => (
          <button
            key={p.row.uid}
            type="button"
            data-schedule-grid
            onClick={(event) => (canEdit ? onPickPerson(p.row, event.currentTarget) : onOpenPerson(p.row))}
            title={`${p.row.label}${p.hours ? ` · ${formatScheduleHours(p.hours)}` : ""}`}
            aria-pressed={selectedUid === p.row.uid}
            className={cn(
              "flex min-h-11 min-w-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-[filter] hover:brightness-110",
              p.came ? CELL_KIND_LOOK.came : p.state === "off" ? CELL_KIND_LOOK.off : p.state === "excused" ? CELL_KIND_LOOK.excused : p.hours ? CELL_KIND_LOOK.hours : "border-border/70 bg-card",
              "text-foreground",
              selectedUid === p.row.uid && "ring-2 ring-primary"
            )}
          >
            <MemberAvatar
              id={p.row.member?.uid ?? p.row.uid}
              name={p.row.member?.name ?? initialsName(p.row.label)}
              nickname={p.row.member?.nickname}
              photoURL={p.row.member?.photoURL}
              className={cn("shrink-0", big ? "h-9 w-9" : small ? "h-6 w-6" : "h-7 w-7")}
            />
            <span className="flex min-w-0 flex-col">
              <span className={cn("truncate font-medium", big ? "text-[16px]" : small ? "text-[13px]" : "text-[14px]")}>
                {p.row.label}
              </span>
              {(p.hours || p.came) && (
                <span className={cn("font-mono tabular-nums", big ? "text-[14px]" : "text-[12px]", p.hours ? "text-primary" : "text-success")}>
                  {p.hours ? formatScheduleHours(p.hours) : "вышел в выходной"}
                </span>
              )}
            </span>
          </button>
        );
        const group = (title: string, list: PersonDay[], tone?: string) =>
          list.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className={cn("text-[12px] font-medium", tone ?? "text-muted-foreground")}>
                {title} <span className="tabular-nums opacity-70">{list.length}</span>
              </p>
              <div className="grid grid-cols-1 gap-1.5 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">{list.map(chip)}</div>
            </div>
          );
        return (
          <section key={section.id} className="flex min-w-0 flex-col gap-3 rounded-xl border border-border/70 bg-card p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Icon className="h-4 w-4 shrink-0 text-primary" />
              <p className="text-sm font-medium">{section.title}</p>
              <span
                className={cn(
                  "rounded-md px-2 py-0.5 text-[13px] font-semibold tabular-nums",
                  short ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success"
                )}
              >
                на смене {working} из {people.length}
              </span>
              {section.min > 0 && (
                <span className={cn("text-[12px]", short ? "font-medium text-destructive" : "text-muted-foreground")}>
                  {short ? `не хватает ${section.min - working} до нормы ${section.min}` : `норма ${section.min}`}
                </span>
              )}
            </div>
            {group("Смена с/до", partial, "text-primary")}
            {group("Весь день", full)}
            {group("Выходной", off, "text-destructive")}
            {group("Отпросились", excused, "text-warning")}
          </section>
        );
      })}
    </div>
  );
}

/**
 * «Сегодня на смене» — одна строка над неделей и месяцем: по каждому разделу
 * «на смене N из M» и кого сегодня нет. Тап — вид «День».
 */
export function TodayOnShift({
  sections,
  schedules,
  todayKey,
  onOpen,
}: {
  sections: DaySection[];
  schedules: Map<string, TechSchedule>;
  todayKey: string;
  onOpen: () => void;
}) {
  const shown = sections.filter((s) => s.id !== "leads" && s.rows.length > 0);
  if (shown.length === 0) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-border/70 bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/40"
    >
      <span className="text-[13px] font-medium">Сегодня на смене</span>
      {shown.map((section) => {
        const working = onShiftCount(section.rows, schedules, todayKey);
        const short = section.min > 0 && working < section.min;
        const absent = section.rows
          .map((row) => ({ row, state: scheduleStateOf(schedules.get(row.uid) ?? null, todayKey) }))
          .filter((p) => p.state !== "work");
        return (
          <span key={section.id} className="flex min-w-0 flex-wrap items-center gap-1.5 text-[13px]">
            <span className="text-muted-foreground">{section.title}</span>
            <span
              className={cn(
                "rounded-md px-1.5 font-semibold tabular-nums",
                short ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success"
              )}
            >
              {working} из {section.rows.length}
            </span>
            {absent.length > 0 && (
              <span className="min-w-0 truncate text-[12px] text-muted-foreground">
                нет:{" "}
                {absent
                  .slice(0, 4)
                  .map((p) => `${p.row.label}${p.state === "excused" ? " (отпр.)" : ""}`)
                  .join(", ")}
                {absent.length > 4 && ` и ещё ${absent.length - 4}`}
              </span>
            )}
          </span>
        );
      })}
      <span className="ml-auto text-[12px] font-medium text-primary">Кто сегодня →</span>
    </button>
  );
}
