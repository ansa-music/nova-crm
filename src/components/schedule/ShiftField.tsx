import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/utils/cn";
import { parseShiftText } from "@/utils/weekTemplate";
import { formatScheduleHours, sameScheduleHours, type ScheduleHours } from "@/types";

/**
 * Неполная смена ОДНИМ полем: «12:30-15», «с 12:45», «10-12, 15-19» — как её
 * и пишут в таблице. Раньше было два `type=time`: на телефоне это колёсики,
 * на компьютере — часы и минуты по отдельности, и одна смена стоила десятка
 * касаний. Рядом — частые смены команды одной кнопкой.
 *
 * `onChange` получает смену, когда текст понят, и null, когда нет: кнопку
 * «Применить» снаружи выключают по null.
 */
export function ShiftField({
  value,
  presets,
  onChange,
  autoFocus = false,
  compact = false,
  onSubmit,
}: {
  value: ScheduleHours | null;
  /** `name` — подпись смены команды из «Настройки графика» («Утро»). */
  presets: Array<ScheduleHours & { name?: string }>;
  onChange: (hours: ScheduleHours | null) => void;
  autoFocus?: boolean;
  /** В панели кисти: поле уже, подсказка короче. */
  compact?: boolean;
  /** Enter в поле — «применить», если смена понята. */
  onSubmit?: () => void;
}) {
  const [text, setText] = useState(value ? formatScheduleHours(value) : "");
  const parsed = parseShiftText(text);
  const lastSent = useRef<ScheduleHours | null>(value);

  // Смену поменяли снаружи (выбрали другую клетку) — показываем её, если
  // это не то, что только что пришло отсюда же.
  useEffect(() => {
    if (sameScheduleHours(value, lastSent.current)) return;
    lastSent.current = value;
    setText(value ? formatScheduleHours(value) : "");
  }, [value]);

  function set(next: string) {
    setText(next);
    const hours = parseShiftText(next);
    lastSent.current = hours;
    onChange(hours);
  }

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", compact && "gap-1")}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Input
          autoFocus={autoFocus}
          value={text}
          onChange={(e) => set(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && parsed && onSubmit) {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder="12:30-15 или с 12:45"
          aria-label="Смена: с какого и до какого часа"
          inputMode="text"
          className={cn("h-10 w-44 font-mono text-[13px] sm:h-9", compact && "w-40")}
        />
        {presets.map((hours) => {
          const label = formatScheduleHours(hours);
          const on = sameScheduleHours(parsed, hours);
          return (
            <button
              key={label}
              type="button"
              onClick={() => set(label)}
              className={cn(
                "min-h-10 rounded-md border px-2 font-mono text-[12px] tabular-nums transition-colors sm:min-h-8",
                on ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
              )}
            >
              {hours.name ? (
                <>
                  <span className="mr-1 font-sans font-medium text-foreground/90">{hours.name}</span>
                  {label}
                </>
              ) : (
                label
              )}
            </button>
          );
        })}
      </div>
      <p className={cn("text-[11px]", text.trim() && !parsed ? "text-destructive" : "text-muted-foreground")}>
        {!text.trim()
          ? "Начало и конец через дефис; конца может не быть: «с 12:45»."
          : parsed
            ? `Смена ${formatScheduleHours(parsed)}`
            : "Не понял. Пишите «12:30-15», «с 12:45» или «10-12, 15-19»."}
      </p>
    </div>
  );
}
