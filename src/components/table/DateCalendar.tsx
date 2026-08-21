import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/cn";

const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTH_LABELS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

interface DateCalendarProps {
  /** Epoch millis, or null/undefined for "no date set" (nothing highlighted). */
  value: number | null | undefined;
  onChange: (millis: number) => void;
  onClear?: () => void;
}

export function DateCalendar({ value, onChange, onClear }: DateCalendarProps) {
  const selected = value ? new Date(value) : null;
  const [viewDate, setViewDate] = useState(() => selected ?? new Date());

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  // Monday-first grid: JS getDay() is 0=Sunday, shift so Monday=0.
  const leadingBlanks = (firstOfMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();

  const cells: (number | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  function pick(day: number) {
    onChange(new Date(year, month, day, 12, 0, 0).getTime());
  }

  function pickToday() {
    const t = new Date();
    onChange(new Date(t.getFullYear(), t.getMonth(), t.getDate(), 12, 0, 0).getTime());
    setViewDate(t);
  }

  return (
    <div className="w-64 select-none p-1">
      <div className="mb-2 flex items-center justify-between">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setViewDate(new Date(year, month - 1, 1))}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <p className="text-sm font-medium">
          {MONTH_LABELS[month]} {year}
        </p>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setViewDate(new Date(year, month + 1, 1))}>
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
          const cellDate = new Date(year, month, day);
          const isSelected = selected && isSameDay(cellDate, selected);
          const isToday = isSameDay(cellDate, today);
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
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={pickToday}>
          Сегодня
        </Button>
        {onClear && (
          <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={onClear}>
            Очистить
          </Button>
        )}
      </div>
    </div>
  );
}
