import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Check, CircleSlash, Clock, Sun, UserMinus, X } from "lucide-react";
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
import { MONTH_SIZES, type ScheduleDensity } from "@/components/schedule/scheduleDensity";
import {
  formatScheduleHours,
  SCHEDULE_DAY_LABELS,
  scheduleHoursOf,
  scheduleStateOf,
  type ScheduleDayState,
  type ScheduleHours,
  type TechSchedule,
} from "@/types";

export const SCHEDULE_STATE_STYLE: Record<ScheduleDayState, string> = {
  work: "border-border/50 text-muted-foreground/70",
  off: "border-destructive/45 bg-destructive/15 text-destructive",
  excused: "border-warning/45 bg-warning/15 text-warning",
};

export const WEEKDAY_LETTERS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

/**
 * Что выбрали в меню дня: состояние дня, отметка «пришёл в рабочий день» или
 * часы гибридной смены («hours» открывает диалог, «clear-hours» их снимает).
 */
export type ScheduleDayAction = ScheduleDayState | "came" | "not-came" | "hours" | "clear-hours";

/**
 * Инициалы аватарки берутся по первым буквам слов, а своих людей пишут как
 * «Асхат (монтаж)» — скобка попадала в кружок. Оставляем только буквы.
 */
export function initialsName(label: string): string {
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

export function weekdayOf(monthKey: string, dayKey: string): number {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, Number(dayKey))).getUTCDay();
}

/** Суббота и воскресенье — только подсветка колонки, выходным днём сами по себе не считаются. */
export function isWeekend(monthKey: string, dayKey: string): boolean {
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
  meUid,
  canEdit,
  editing,
  draft,
  hoursDraft,
  onToggleDraft,
  onPickDay,
  onRemoveRow,
  onOpenPerson,
  density = "normal",
  minOnShift = 0,
}: {
  monthKey: string;
  /** Сегодняшний день месяца по Алматы, или null — если смотрим не текущий месяц. */
  todayKey: string | null;
  rows: ScheduleRow[];
  schedules: Map<string, TechSchedule>;
  /** Кто смотрит: своя строка подсвечивается, её ищут первой. */
  meUid?: string;
  /** Owner, Тимлид или назначенный Owner редактор графика. */
  canEdit: boolean;
  editing: boolean;
  /** Несохранённые выходные из режима правки: ключ `uid:день`. */
  draft: Map<string, ScheduleDayState>;
  /** Несохранённые часы оттуда же; `null` — «снять часы». */
  hoursDraft?: Map<string, ScheduleHours | null>;
  onToggleDraft?: (row: ScheduleRow, dayKey: string) => void;
  onPickDay?: (row: ScheduleRow, dayKey: string, action: ScheduleDayAction) => void;
  /** Есть только у своих людей — участника workspace из графика не убирают. */
  onRemoveRow?: (row: ScheduleRow) => void;
  /** Клик по имени — весь месяц человека крупно (и правка пачкой у тех, кто правит). */
  onOpenPerson?: (row: ScheduleRow) => void;
  /** Масштаб — см. scheduleDensity.ts. */
  density?: ScheduleDensity;
  /** Норма на смене из «Настройки графика»: меньше — число дня красное. 0 — без нормы. */
  minOnShift?: number;
}) {
  const days = useMemo(() => daysOfMonth(monthKey), [monthKey]);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const size = MONTH_SIZES[density];

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
  }, [todayKey, monthKey, rows.length, density]);

  const stateOfRow = (row: ScheduleRow, dayKey: string): ScheduleDayState =>
    draft.get(draftKey(row.uid, dayKey)) ?? scheduleStateOf(schedules.get(row.uid) ?? null, dayKey);

  // «На смене» по дню — то, ради чего руководство и смотрит месяц: в какой
  // день людей не хватает. С учётом черновика — видно ДО «Сохранить».
  const onShift = useMemo(
    () => new Map(days.map((d) => [d, rows.filter((row) => stateOfRow(row, d) === "work").length])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [days, rows, schedules, draft]
  );

  if (rows.length === 0) return null;

  // Крестик «убрать» занимает место, и без поправки колонка с именами в этом
  // разделе шире остальных — сетки разных секций перестают совпадать по дням.
  const nameWidth = onRemoveRow ? size.nameMaxRm : size.nameMax;

  return (
    <div ref={scrollerRef} className="overflow-x-auto">
      <table className="border-separate border-spacing-0">
        <thead>
          <tr>
            <th className={cn("sticky left-0 z-10 bg-card px-2 py-1 text-left text-[11px] font-medium text-muted-foreground", size.nameCol)}>
              Кто
            </th>
            {days.map((d) => {
              const weekend = isWeekend(monthKey, d);
              return (
                <th
                  key={d}
                  className={cn(
                    "px-0 pb-1 text-center font-medium",
                    d === todayKey ? "text-primary" : weekend ? "text-foreground/80" : "text-muted-foreground/70"
                  )}
                >
                  {/* Сегодня видно сразу: число в кружке акцентного цвета —
                      тонкой рамки вокруг клетки в сетке на 31 колонку мало. */}
                  <span
                    className={cn(
                      "mx-auto block rounded-full font-mono tabular-nums",
                      size.dayNum,
                      size.dayNumBox,
                      d === todayKey && "bg-primary font-semibold text-primary-foreground"
                    )}
                  >
                    {d}
                  </span>
                  <span className={cn("block opacity-80", size.dow, weekend && d !== todayKey && "font-semibold")}>
                    {WEEKDAY_LETTERS[weekdayOf(monthKey, d)]}
                  </span>
                </th>
              );
            })}
            <th className="px-2 pb-1 text-center text-[11px] font-medium text-muted-foreground/70" title="Выходных за месяц">
              В
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const schedule = schedules.get(row.uid) ?? null;
            const isMe = Boolean(meUid) && row.uid === meUid;
            const offCount = days.filter((d) => stateOfRow(row, d) === "off").length;
            const nameInner = (
              <>
                <MemberAvatar
                  id={row.member?.uid ?? row.uid}
                  name={row.member?.name ?? initialsName(row.label)}
                  nickname={row.member?.nickname}
                  photoURL={row.member?.photoURL}
                  className={cn("shrink-0", size.avatar)}
                />
                <span
                  className={cn("min-w-0 flex-1 truncate", size.name, nameWidth, isMe && "font-semibold text-primary")}
                  title={row.label}
                >
                  {row.label}
                </span>
                {isMe && (
                  <span className="shrink-0 rounded-full bg-primary/15 px-1.5 text-[10px] leading-4 text-primary">вы</span>
                )}
                {row.note && (
                  <span className="hidden shrink-0 rounded-sm bg-muted px-1 text-[10px] text-muted-foreground sm:inline">
                    {row.note}
                  </span>
                )}
              </>
            );
            return (
              // Наведение подсвечивает всю строку: в сетке на 31 колонку глаз
              // съезжает на соседнего человека.
              <tr key={row.uid} className={cn("group", isMe && "bg-primary/[0.06]")}>
                <td
                  className={cn(
                    "sticky left-0 z-10 py-0.5 pr-2 sm:pr-3",
                    size.nameCol,
                    // Липкая колонка рисует свой фон поверх строки, поэтому
                    // подсветку «это я» и наведения ей задаём отдельно.
                    isMe ? "bg-[hsl(var(--card))] shadow-[inset_0_0_0_9999px_hsl(var(--primary)/0.06)]" : "bg-card",
                    "group-hover:shadow-[inset_0_0_0_9999px_hsl(var(--foreground)/0.05)]"
                  )}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    {onOpenPerson ? (
                      <button
                        type="button"
                        onClick={() => onOpenPerson(row)}
                        title={`${row.label} — весь месяц крупно`}
                        className="flex min-h-9 min-w-0 flex-1 items-center gap-1.5 rounded-md text-left transition-colors hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                      >
                        {nameInner}
                      </button>
                    ) : (
                      <span className="flex min-w-0 flex-1 items-center gap-1.5">{nameInner}</span>
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
                  const key = draftKey(row.uid, d);
                  const state = stateOfRow(row, d);
                  const hoursPending = hoursDraft?.has(key) ?? false;
                  const pending = draft.has(key) || hoursPending;
                  const came = Boolean(schedule?.selfWork?.[d]) && !draft.has(key);
                  // Частичная смена показывается только у рабочего дня: если
                  // день сделали выходным, часы к нему уже не относятся.
                  const hours =
                    state === "work"
                      ? hoursPending
                        ? hoursDraft?.get(key) ?? null
                        : scheduleHoursOf(schedule, d)
                      : null;
                  const cell = (
                    <button
                      type="button"
                      // Клетку со сменой открыть можно и без права правки: в ней
                      // виден только час начала, а подсказок на касание нет —
                      // технарь с телефона иначе не узнал бы, до скольки смена.
                      disabled={!canEdit && !(hours && !editing)}
                      title={`${row.label} · ${d} — ${SCHEDULE_DAY_LABELS[state]}${
                        came ? " (пришёл в рабочий день)" : ""
                      }${hours ? ` · ${formatScheduleHours(hours)}` : ""}`}
                      onClick={editing ? () => onToggleDraft?.(row, d) : undefined}
                      className={cn(
                        "rounded-sm border font-semibold transition-colors",
                        size.cell,
                        size.cellText,
                        SCHEDULE_STATE_STYLE[state],
                        state === "work" && isWeekend(monthKey, d) && "bg-foreground/[0.07]",
                        hours && "border-primary/50 bg-primary/15 text-primary",
                        d === todayKey && "ring-1 ring-primary",
                        pending && "ring-2 ring-primary ring-offset-1 ring-offset-card",
                        canEdit || hours ? "cursor-pointer hover:brightness-125" : "cursor-default"
                      )}
                    >
                      {state === "off"
                        ? "В"
                        : state === "excused"
                          ? "О"
                          : hours
                            ? hours.from.slice(0, 2).replace(/^0/, "")
                            : came
                              ? "✓"
                              : ""}
                    </button>
                  );
                  return (
                    <td
                      key={d}
                      data-day={d}
                      className={cn(
                        "p-px text-center group-hover:bg-foreground/[0.04]",
                        d === todayKey && "bg-primary/[0.07]"
                      )}
                    >
                      {canEdit && !editing ? (
                        <DayMenu
                          row={row}
                          dayKey={d}
                          state={state}
                          came={came}
                          hours={hours}
                          onPick={onPickDay}
                          onOpenPerson={onOpenPerson}
                        >
                          {cell}
                        </DayMenu>
                      ) : !canEdit && hours ? (
                        <DayMenu readOnly row={row} dayKey={d} state={state} came={came} hours={hours}>
                          {cell}
                        </DayMenu>
                      ) : (
                        cell
                      )}
                    </td>
                  );
                })}
                <td className="px-2 text-center font-mono text-[12px] tabular-nums text-muted-foreground group-hover:bg-foreground/[0.04]">
                  {offCount || ""}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td
              className={cn("sticky left-0 z-10 bg-card px-2 pt-1.5 text-[11px] text-muted-foreground", size.nameCol)}
              title={minOnShift > 0 ? `Норма на смене — ${minOnShift}` : undefined}
            >
              На смене{minOnShift > 0 && <span className="ml-1 opacity-70">· норма {minOnShift}</span>}
            </td>
            {days.map((d) => {
              const count = onShift.get(d) ?? 0;
              const short = minOnShift > 0 && count < minOnShift;
              return (
                <td key={d} className={cn("pt-1.5 text-center", d === todayKey && "bg-primary/[0.07]")}>
                  <span
                    title={short ? `${d}: на смене ${count}, норма ${minOnShift}` : `${d}: на смене ${count}`}
                    className={cn(
                      "mx-auto block rounded-sm font-mono tabular-nums",
                      size.dayNum,
                      size.dayNumBox,
                      short
                        ? "bg-destructive/15 font-semibold text-destructive"
                        : d === todayKey
                          ? "font-semibold text-primary"
                          : "text-foreground/75"
                    )}
                  >
                    {count}
                  </span>
                </td>
              );
            })}
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/**
 * Меню дня. Именно меню, а не перебор по клику: по графику ходят пальцем с
 * телефона, и одно случайное касание раньше меняло человеку день.
 */
export function DayMenu({
  row,
  dayKey,
  state,
  came,
  hours,
  onPick,
  onOpenPerson,
  readOnly = false,
  children,
}: {
  row: ScheduleRow;
  dayKey: string;
  state: ScheduleDayState;
  came: boolean;
  hours: ScheduleHours | null;
  onPick?: (row: ScheduleRow, dayKey: string, action: ScheduleDayAction) => void;
  /** «Весь месяц человека» — отдельное окно, где удобно править пачкой. */
  onOpenPerson?: (row: ScheduleRow) => void;
  /** Только посмотреть: подпись дня со сменой, без действий. */
  readOnly?: boolean;
  children: React.ReactNode;
}) {
  // Radix открывает меню на pointerdown, не глядя на тип указателя. На
  // телефоне pointerdown приходит в НАЧАЛЕ касания — раньше, чем браузер
  // поймёт, что это свайп, — и любая попытка пролистать сетку пальцем
  // открывала меню (а модальное меню дальше гасит прокрутку). Для касания
  // гасим открытие на pointerdown и открываем по click: после свайпа click не
  // приходит, после тапа — приходит. Мышь работает как прежде.
  const [open, setOpen] = useState(false);
  const touchRef = useRef(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        asChild
        onPointerDown={(e) => {
          touchRef.current = e.pointerType !== "mouse";
          if (touchRef.current) e.preventDefault();
        }}
        onClick={() => {
          if (touchRef.current) setOpen(true);
        }}
      >
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-56">
        <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
          {row.label} · {dayKey} — {came ? "пришёл в рабочий день" : SCHEDULE_DAY_LABELS[state]}
          {hours && ` · ${formatScheduleHours(hours)}`}
        </DropdownMenuLabel>
        {!readOnly && <DropdownMenuSeparator />}
        {!readOnly && (
          <>
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
        {/* Часы бывают только у рабочего дня. У выходного пункт писал в базу
            часы, которых не видно ни в клетке, ни в меню, а при возврате дня в
            рабочие они молча всплывали. */}
        {state === "work" && <DropdownMenuSeparator />}
        {state === "work" && (
          <DropdownMenuItem onClick={() => onPick?.(row, dayKey, "hours")}>
            <Clock className="h-4 w-4" />
            {hours ? `Часы: ${formatScheduleHours(hours)}` : "Часы работы…"}
          </DropdownMenuItem>
        )}
        {hours && (
          <DropdownMenuItem onClick={() => onPick?.(row, dayKey, "clear-hours")}>
            <Clock className="h-4 w-4" />
            Убрать часы — весь день
          </DropdownMenuItem>
        )}
        {onOpenPerson && <DropdownMenuSeparator />}
        {onOpenPerson && (
          <DropdownMenuItem onClick={() => onOpenPerson(row)}>
            <CalendarDays className="h-4 w-4" />
            Весь месяц · {row.label}
          </DropdownMenuItem>
        )}
          </>
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
        <span className="flex h-4 w-4 items-center justify-center rounded-sm border border-primary/50 bg-primary/15 text-[9px] text-primary">
          12
        </span>
        Смена с/до (в клетке — час начала)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-4 w-4 rounded-sm border border-border/50 bg-foreground/[0.07]" /> Суббота и воскресенье
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="font-mono">В</span> — выходных за месяц
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="rounded-sm bg-destructive/15 px-1 font-mono font-semibold text-destructive">3</span>
        На смене меньше нормы
      </span>
    </div>
  );
}
