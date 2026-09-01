import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/cn";
import { USER_TIMEZONE, almatyNoonMillis, ymdPartsInTimeZone } from "@/utils/date";

const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTH_LABELS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

interface DateCalendarProps {
  /** Epoch millis, or null/undefined for "no date set" (nothing highlighted). */
  value: number | null | undefined;
  onChange: (millis: number) => void;
  onClear?: () => void;
}

export function DateCalendar({ value, onChange, onClear }: DateCalendarProps) {
  const selected = value ? ymdPartsInTimeZone(value, USER_TIMEZONE) : null;
  const today = ymdPartsInTimeZone(Date.now(), USER_TIMEZONE);
  const [view, setView] = useState(() =>
    selected ? { year: selected.year, month: selected.month } : { year: today.year, month: today.month }
  );

  const year = view.year;
  const month = view.month;
  const firstWeekday = new Date(almatyNoonMillis(year, month, 1)).getUTCDay();
  // Monday-first: JS UTC getUTCDay() is 0=Sunday. Noon Almaty is 07:00 UTC same calendar day.
  const leadingBlanks = (firstWeekday + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  const cells: (number | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  function pick(day: number) {
    onChange(almatyNoonMillis(year, month, day));
  }

  function pickToday() {
    onChange(almatyNoonMillis(today.year, today.month, today.day));
    setView({ year: today.year, month: today.month });
  }

  /** ±N calendar days from today, in Almaty wall-clock. */
  function pickRelative(deltaDays: number) {
    const base = almatyNoonMillis(today.year, today.month, today.day) + deltaDays * 24 * 60 * 60 * 1000;
    const parts = ymdPartsInTimeZone(base, USER_TIMEZONE);
    onChange(almatyNoonMillis(parts.year, parts.month, parts.day));
    setView({ year: parts.year, month: parts.month });
  }

  function shiftMonth(delta: number) {
    const next = month + delta;
    if (next < 0) setView({ year: year - 1, month: 11 });
    else if (next > 11) setView({ year: year + 1, month: 0 });
    else setView({ year, month: next });
  }

  return (
    <div className="w-64 select-none p-1">
      <div className="mb-2 flex items-center justify-between">
        <Button variant="ghost" size="icon" aria-label="Предыдущий месяц" className="h-8 w-8" onClick={() => shiftMonth(-1)}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <button
          type="button"
          className="rounded px-2 py-0.5 text-sm font-medium hover:bg-accent"
          onClick={() => setView({ year: today.year, month: today.month })}
          title="К текущему месяцу"
        >
          {MONTH_LABELS[month]} {year}
        </button>
        <Button variant="ghost" size="icon" aria-label="Следующий месяц" className="h-8 w-8" onClick={() => shiftMonth(1)}>
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {WEEKDAY_LABELS.map((d) => (
          <div key={d} className="eyebrow py-1 text-center !text-[10px]">
            {d}
          </div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`blank-${i}`} />;
          const isSelected = Boolean(selected && selected.year === year && selected.month === month && selected.day === day);
          const isToday = today.year === year && today.month === month && today.day === day;
          return (
            <button
              key={day}
              type="button"
              onClick={() => pick(day)}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full text-sm transition-colors hover:bg-accent",
                isSelected && "bg-primary text-primary-foreground hover:bg-primary/90",
                !isSelected && isToday && "font-semibold text-primary"
              )}
            >
              {day}
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => pickRelative(-1)} title="Вчера">
            Вчера
          </Button>
          <Button variant="secondary" size="sm" className="h-8 px-2.5 text-xs" onClick={pickToday}>
            Сегодня
          </Button>
          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => pickRelative(1)} title="Завтра">
            Завтра
          </Button>
        </div>
        {onClear && (
          <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={onClear}>
            Очистить
          </Button>
        )}
      </div>
    </div>
  );
}
