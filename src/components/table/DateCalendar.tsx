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

  function shiftMonth(delta: number) {
    const next = month + delta;
    if (next < 0) setView({ year: year - 1, month: 11 });
    else if (next > 11) setView({ year: year + 1, month: 0 });
    else setView({ year, month: next });
  }

  return (
    <div className="w-64 select-none p-1">
      <div className="mb-2 flex items-center justify-between">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => shiftMonth(-1)}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <p className="text-sm font-medium">
          {MONTH_LABELS[month]} {year}
        </p>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => shiftMonth(1)}>
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
        <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={pickToday}>
          Сегодня
        </Button>
        {onClear && (
          <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={onClear}>
            Очистить
          </Button>
        )}
      </div>
    </div>
  );
}
