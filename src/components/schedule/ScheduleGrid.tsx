import { useEffect, useMemo, useRef } from "react";
import { Check, CircleSlash, Sun, UserMinus, X } from "lucide-react";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/utils/cn";
import { SCHEDULE_DAY_LABELS, scheduleStateOf, type ScheduleDayState, type TechSchedule } from "@/types";

export const SCHEDULE_STATE_STYLE: Record<ScheduleDayState, string> = {
  work: "border-border/50 text-muted-foreground/70",
  off: "border-destructive/45 bg-destructive/15 text-destructive",
  excused: "border-warning/45 bg-warning/15 text-warning",
};

const WEEKDAY_LETTERS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

/** Что выбрали в меню дня: состояние дня или отметка «пришёл в рабочий день». */
export type ScheduleDayAction = ScheduleDayState | "came" | "not-came";

/**
 * Инициалы аватарки берутся по первым буквам слов, а своих людей пишут как
 * «Асхат (монтаж)» — скобка попадала в кружок. Оставляем только буквы.
 */
function initialsName(label: string): string {
  return label.replace(/[^\p{L}\p{N}\s]+/gu, " ").replace(/\s+/g, " ").trim() || label;
}

/**
 * Строка графика. `uid` — это id документа `techSchedule`, поэтому для своих
 * людей из настраиваемого раздела сюда приходит их синтетический id: сетке
 * всё равно, чей это график, лишь бы ключ был один на человека.
 */
export interface ScheduleRow {
  uid: string;
  label: string;
  /** Участник workspace — ради аватарки; у своих людей его нет. */
  member?: { uid: string; name?: string; nickname?: string; photoURL?: string | null } | null;
  /** Бейдж справа от имени: «Owner», «Тимлид» и т.п. */
  note?: string | null;
}

export function daysOfMonth(monthKey: string): string[] {
  const [year, month] = monthKey.split("-").map(Number);
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => String(i + 1));
}

function weekdayOf(monthKey: string, dayKey: string): number {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, Number(dayKey))).getUTCDay();
}

/** Суббота и воскресенье — только подсветка колонки, выходным днём сами по себе не считаются. */
function isWeekend(monthKey: string, dayKey: string): boolean {
  const dow = weekdayOf(monthKey, dayKey);
  return dow === 0 || dow === 6;
}

export function draftKey(uid: string, dayKey: string): string {
  return `${uid}:${dayKey}`;
}

/**
 * Сетка графика: люди по строкам, дни месяца по колонкам.
 *
 * График правит только руководство и только осознанно. В обычном виде клик по
 * дню открывает МЕНЮ (пришёл в рабочий день / отпросился / выходной), чтобы
 * случайное касание не переписывало месяц; выходные на месяц вперёд ставят в
 * режиме правки — там клик переключает только «выходной», а уезжает всё одним
 * сохранением.
 *
 * Одна строка = один человек = один документ графика, даже если у него две
 * роли. Иначе Тимлид + Технарь получил бы две строки на один и тот же
 * документ, и правка в одной молча меняла бы вторую.
 */
export function ScheduleGrid({
  monthKey,
  todayKey,
  rows,
  schedules,
  canEdit,
  editing,
  draft,
  onToggleDraft,
  onPickDay,
  onRemoveRow,
}: {
  monthKey: string;
  /** Сегодняшний день месяца по Алматы, или null — если смотрим не текущий месяц. */
  todayKey: string | null;
  rows: ScheduleRow[];
  schedules: Map<string, TechSchedule>;
  /** Owner или Тимлид: только они вообще что-то меняют. */
  canEdit: boolean;
  editing: boolean;
  /** Несохранённые выходные из режима правки: ключ `uid:день`. */
  draft: Map<string, ScheduleDayState>;
  onToggleDraft?: (row: ScheduleRow, dayKey: string) => void;
  onPickDay?: (row: ScheduleRow, dayKey: string, action: ScheduleDayAction) => void;
  /** Есть только у своих людей — участника workspace из графика не убирают. */
  onRemoveRow?: (row: ScheduleRow) => void;
}) {
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
  }, [todayKey, monthKey, rows.length]);

  // Крестик «убрать» занимает место, и без поправки колонка с именами в этом
  // разделе шире остальных — сетки разных секций перестают совпадать по дням.
  const nameWidth = onRemoveRow
    ? "max-w-[3.25rem] sm:max-w-[6.25rem]"
    : "max-w-[4.5rem] sm:max-w-[7.5rem]";

  if (rows.length === 0) return null;

  return (
    <div ref={scrollerRef} className="overflow-x-auto">
      <table className="border-separate border-spacing-0 text-[11px]">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 w-28 min-w-[7rem] bg-card px-2 py-1 text-left font-medium text-muted-foreground sm:w-40 sm:min-w-[10rem]">
              Кто
            </th>
            {days.map((d) => (
              <th
                key={d}
                className={cn(
                  "w-7 px-0 pb-1 text-center font-medium",
                  d === todayKey
                    ? "text-primary"
                    : isWeekend(monthKey, d)
                      ? "text-foreground/70"
                      : "text-muted-foreground/60"
                )}
              >
                <span className="block font-mono text-[10px] tabular-nums">{d}</span>
                <span className="block text-[9px] opacity-70">{WEEKDAY_LETTERS[weekdayOf(monthKey, d)]}</span>
              </th>
            ))}
            <th className="px-2 pb-1 text-center font-medium text-muted-foreground/60" title="Выходных за месяц">
              В
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const schedule = schedules.get(row.uid) ?? null;
            const stateOf = (dayKey: string): ScheduleDayState =>
              draft.get(draftKey(row.uid, dayKey)) ?? scheduleStateOf(schedule, dayKey);
            const offCount = days.filter((d) => stateOf(d) === "off").length;
            return (
              <tr key={row.uid}>
                <td className="sticky left-0 z-10 w-28 min-w-[7rem] bg-card py-0.5 pr-2 sm:w-40 sm:min-w-[10rem] sm:pr-3">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <MemberAvatar
                      id={row.member?.uid ?? row.uid}
                      name={row.member?.name ?? initialsName(row.label)}
                      nickname={row.member?.nickname}
                      photoURL={row.member?.photoURL}
                      className="h-6 w-6 shrink-0"
                    />
                    <span className={cn("min-w-0 flex-1 truncate text-[12px]", nameWidth)} title={row.label}>
                      {row.label}
                    </span>
                    {row.note && (
                      <span className="hidden shrink-0 rounded-sm bg-muted px-1 text-[9px] text-muted-foreground sm:inline">
                        {row.note}
                      </span>
                    )}
                    {canEdit && onRemoveRow && (
                      <button
                        type="button"
                        onClick={() => onRemoveRow(row)}
                        title={`Убрать ${row.label} из графика`}
                        className="shrink-0 rounded-sm p-0.5 text-muted-foreground/60 transition-colors hover:text-destructive"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </span>
                </td>
                {days.map((d) => {
                  const state = stateOf(d);
                  const pending = draft.has(draftKey(row.uid, d));
                  const came = Boolean(schedule?.selfWork?.[d]) && !pending;
                  const cell = (
                    <button
                      type="button"
                      disabled={!canEdit}
                      title={`${row.label} · ${d} — ${SCHEDULE_DAY_LABELS[state]}${
                        came ? " (пришёл в рабочий день)" : ""
                      }`}
                      onClick={editing ? () => onToggleDraft?.(row, d) : undefined}
                      className={cn(
                        "h-7 w-7 rounded-sm border text-[10px] font-semibold transition-colors",
                        SCHEDULE_STATE_STYLE[state],
                        state === "work" && isWeekend(monthKey, d) && "bg-foreground/[0.07]",
                        d === todayKey && "ring-1 ring-primary/60",
                        pending && "ring-1 ring-primary ring-offset-1 ring-offset-card",
                        canEdit ? "cursor-pointer hover:brightness-125" : "cursor-default"
                      )}
                    >
                      {state === "off" ? "В" : state === "excused" ? "О" : came ? "✓" : ""}
                    </button>
                  );
                  return (
                    <td key={d} data-day={d} className="p-px text-center">
                      {canEdit && !editing ? (
                        <DayMenu row={row} dayKey={d} state={state} came={came} onPick={onPickDay}>
                          {cell}
                        </DayMenu>
                      ) : (
                        cell
                      )}
                    </td>
                  );
                })}
                <td className="px-2 text-center font-mono text-[11px] tabular-nums text-muted-foreground">
                  {offCount || ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Меню дня. Именно меню, а не перебор по клику: по графику ходят пальцем с
 * телефона, и одно случайное касание раньше меняло человеку день.
 */
function DayMenu({
  row,
  dayKey,
  state,
  came,
  onPick,
  children,
}: {
  row: ScheduleRow;
  dayKey: string;
  state: ScheduleDayState;
  came: boolean;
  onPick?: (row: ScheduleRow, dayKey: string, action: ScheduleDayAction) => void;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-56">
        <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
          {row.label} · {dayKey} — {came ? "пришёл в рабочий день" : SCHEDULE_DAY_LABELS[state]}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {(state !== "work" || came) && (
          <DropdownMenuItem onClick={() => onPick?.(row, dayKey, came ? "not-came" : "came")}>
            <Check className="h-4 w-4" />
            {came ? "Снять «пришёл»" : "Пришёл в рабочий день"}
          </DropdownMenuItem>
        )}
        {state !== "excused" && (
          <DropdownMenuItem onClick={() => onPick?.(row, dayKey, "excused")}>
            <UserMinus className="h-4 w-4" />
            Отпросился
          </DropdownMenuItem>
        )}
        {state !== "off" && (
          <DropdownMenuItem onClick={() => onPick?.(row, dayKey, "off")}>
            <CircleSlash className="h-4 w-4" />
            Выходной
          </DropdownMenuItem>
        )}
        {(state !== "work" || came) && (
          <DropdownMenuItem onClick={() => onPick?.(row, dayKey, "work")}>
            <Sun className="h-4 w-4" />
            Обычный рабочий
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
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
        Пришёл в рабочий день
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-4 w-4 rounded-sm border border-border/50 bg-foreground/[0.07]" /> Суббота и воскресенье
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="font-mono">В</span> — выходных за месяц
      </span>
    </div>
  );
}
