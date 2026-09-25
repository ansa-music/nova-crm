import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { pageChipClass } from "@/components/common/PageHeader";
import { subscribeTechSchedule } from "@/services/techScheduleService";
import { cn } from "@/utils/cn";
import { formatScheduleHours, scheduleHoursOf, scheduleStateOf, type TechSchedule } from "@/types";

const DOW_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const MONTH_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

interface DayInfo {
  ymd: string;
  monthKey: string;
  dayKey: string;
  dow: number;
  date: number;
  month: number;
}

function addDays(ymd: string, days: number): DayInfo {
  const [y, m, d] = ymd.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d + days));
  const iso = at.toISOString().slice(0, 10);
  return {
    ymd: iso,
    monthKey: iso.slice(0, 7),
    dayKey: String(at.getUTCDate()),
    dow: at.getUTCDay(),
    date: at.getUTCDate(),
    month: at.getUTCMonth(),
  };
}

/**
 * «Мой график» — свой график крупно и отдельно от общей таблицы: в сетке на
 * 30 человек и 31 день себя ищут глазами, а открывают «График» ровно затем,
 * чтобы узнать «когда у меня смена». Показывает РЕАЛЬНЫЕ дни этой и следующей
 * недели из месячного графика — с исключениями, «отпросился» и часами, — а не
 * недельный шаблон: шаблон не знает про отпуск в четверг.
 *
 * Неделя может перейти через месяц (28 сентября — 4 октября), поэтому
 * слушаем свои документы за все месяцы окна (один-два точечных слушателя).
 */
const OPEN_KEY = "nova:my-schedule-open";

function readOpen(fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(OPEN_KEY);
    if (value === "1") return true;
    if (value === "0") return false;
  } catch {
    // Нет хранилища — по умолчанию.
  }
  return fallback;
}

export function MyScheduleCard({
  workspaceId,
  uid,
  name,
  todayYmd,
  defaultOpen = true,
}: {
  workspaceId: string;
  uid: string;
  name: string;
  todayYmd: string;
  /**
   * Развёрнута ли карточка, пока человек сам её не свернул/развернул. У
   * руководства «График» открывают, чтобы ЗАПОЛНЯТЬ, — там свой график
   * свёрнут в одну строку и не отнимает пол-экрана у сетки.
   */
  defaultOpen?: boolean;
}) {
  const [week, setWeek] = useState<0 | 1>(0);
  const [open, setOpenState] = useState(() => readOpen(defaultOpen));
  function setOpen(next: boolean) {
    setOpenState(next);
    try {
      window.localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {
      // см. readOpen
    }
  }
  const days = useMemo(() => {
    const [y, m, d] = todayYmd.split("-").map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const mondayShift = -((dow + 6) % 7);
    return Array.from({ length: 14 }, (_, i) => addDays(todayYmd, mondayShift + i));
  }, [todayYmd]);
  const monthKeys = useMemo(() => Array.from(new Set(days.map((d) => d.monthKey))), [days]);
  const monthsId = monthKeys.join(",");

  const [schedules, setSchedules] = useState<Record<string, TechSchedule | null>>({});
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setSchedules({});
    setLoaded({});
    setFailed(false);
    const stops = monthsId.split(",").map((monthKey) =>
      subscribeTechSchedule(
        workspaceId,
        uid,
        monthKey,
        (schedule) => {
          setSchedules((prev) => ({ ...prev, [monthKey]: schedule }));
          setLoaded((prev) => ({ ...prev, [monthKey]: true }));
        },
        () => setFailed(true)
      )
    );
    return () => stops.forEach((stop) => stop());
  }, [workspaceId, uid, monthsId]);

  const ready = monthKeys.every((key) => loaded[key]);
  const shown = days.slice(week * 7, week * 7 + 7);
  const today = addDays(todayYmd, 0);
  const cellOf = (day: DayInfo) => {
    const schedule = schedules[day.monthKey] ?? null;
    const state = scheduleStateOf(schedule, day.dayKey);
    const came = Boolean(schedule?.selfWork?.[day.dayKey]) && Boolean(schedule?.days?.[day.dayKey]);
    const hours = state === "work" ? scheduleHoursOf(schedule, day.dayKey) : null;
    return { state, came, hours };
  };
  const offThisWeek = shown.filter((day) => cellOf(day).state === "off").length;
  const todayCell = cellOf(today);

  const todayText = !ready ? (
    "загружаем…"
  ) : (
    <span
      className={cn(
        "font-medium",
        todayCell.state === "off" ? "text-destructive" : todayCell.state === "excused" ? "text-warning" : "text-foreground"
      )}
    >
      {todayCell.state === "off"
        ? "выходной"
        : todayCell.state === "excused"
          ? "отпросились"
          : todayCell.hours
            ? `смена ${formatScheduleHours(todayCell.hours)}`
            : "рабочий день"}
    </span>
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-xl border border-primary/30 bg-primary/[0.04] px-3 py-2 text-left text-[13px] transition-colors hover:border-primary/50"
      >
        <CalendarDays className="h-4 w-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-semibold">Мой график</span>
          <span className="text-muted-foreground"> · сегодня </span>
          {todayText}
          {ready && !failed && (
            <span className="hidden text-muted-foreground sm:inline">
              {" "}· {offThisWeek === 0 ? "на этой неделе без выходных" : `выходных на неделе: ${offThisWeek}`}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[12px] text-primary">
          Показать <ChevronDown className="h-3.5 w-3.5" />
        </span>
      </button>
    );
  }

  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-xl border border-primary/35 bg-primary/[0.05] p-3 sm:p-4">
      {/* На телефоне кнопки недель — отдельной строкой: рядом с ними имя
          сжималось до столбика в три строки. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2">
        <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Мой график · {name}</p>
          <p className="text-[12px] text-muted-foreground">
            Сегодня {today.date} {MONTH_GEN[today.month]}, {DOW_SHORT[today.dow].toLowerCase()}: {todayText}
          </p>
        </div>
        </div>
        <div className="flex gap-1.5">
          <button type="button" onClick={() => setWeek(0)} className={pageChipClass(week === 0)}>
            Эта неделя
          </button>
          <button type="button" onClick={() => setWeek(1)} className={pageChipClass(week === 1)}>
            Следующая
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Свернуть мой график"
            title="Свернуть"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:h-8 sm:w-8"
          >
            <ChevronDown className="h-4 w-4 rotate-180" />
          </button>
        </div>
      </div>

      {failed ? (
        <p className="text-[12px] text-warning">Свой график не загрузился — обновите страницу.</p>
      ) : (
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-7">
          {shown.map((day) => {
            const { state, came, hours } = cellOf(day);
            const isToday = day.ymd === todayYmd;
            const past = day.ymd < todayYmd;
            const label = state === "off" ? "Выходной" : state === "excused" ? "Отпросился" : "Работа";
            return (
              <div
                key={day.ymd}
                className={cn(
                  "flex min-w-0 items-center justify-between gap-2 rounded-lg border px-3 py-2 sm:flex-col sm:items-start sm:justify-start sm:gap-1 sm:py-2.5",
                  !ready
                    ? "border-border/50 text-muted-foreground"
                    : state === "off"
                      ? "border-destructive/45 bg-destructive/10"
                      : state === "excused"
                        ? "border-warning/45 bg-warning/10"
                        : hours
                          ? "border-primary/45 bg-primary/10"
                          : "border-border/70 bg-card",
                  isToday && "ring-2 ring-primary ring-offset-1 ring-offset-card",
                  past && !isToday && "opacity-55"
                )}
              >
                <span className={cn("text-[12px] tabular-nums", isToday ? "font-semibold text-primary" : "text-muted-foreground")}>
                  {DOW_SHORT[day.dow]}, {day.date} {MONTH_GEN[day.month].slice(0, 3)}
                  {isToday && <span className="ml-1 sm:hidden">· сегодня</span>}
                </span>
                {ready && (
                  <span className="flex min-w-0 flex-col items-end sm:items-start">
                    <span
                      className={cn(
                        "text-[14px] font-semibold",
                        state === "off" ? "text-destructive" : state === "excused" ? "text-warning" : "text-foreground"
                      )}
                    >
                      {label}
                    </span>
                    {hours && <span className="text-[13px] font-medium tabular-nums text-primary">{formatScheduleHours(hours)}</span>}
                    {came && <span className="text-[11px] text-muted-foreground">вышел в выходной</span>}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {ready && !failed && (
        <p className="text-[11px] text-muted-foreground">
          {offThisWeek === 0 ? "Без выходных на этой неделе." : `Выходных за неделю: ${offThisWeek}.`}
        </p>
      )}
    </section>
  );
}
