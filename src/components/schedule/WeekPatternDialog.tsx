import { useState } from "react";
import { CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/utils/cn";
import { pageChipClass } from "@/components/common/PageHeader";
import type { ScheduleRow } from "@/components/schedule/ScheduleGrid";
import type { ScheduleHours } from "@/types";

/** Понедельник первым: так неделю читают, а не так, как её нумерует JS. */
export const WEEK_DAYS: { dow: number; label: string }[] = [
  { dow: 1, label: "Пн" },
  { dow: 2, label: "Вт" },
  { dow: 3, label: "Ср" },
  { dow: 4, label: "Чт" },
  { dow: 5, label: "Пт" },
  { dow: 6, label: "Сб" },
  { dow: 0, label: "Вс" },
];

export interface WeekPattern {
  /** Кому: uid человека или «all» — всем строкам раздела. */
  target: string;
  /** Дни недели, которые становятся выходными. */
  offDows: number[];
  hoursMode: "keep" | "set" | "clear";
  hours: ScheduleHours;
  /** Дни недели, на которые ставятся часы; пусто — на все рабочие. */
  hoursDows: number[];
}

/**
 * Шаблон недели: «два выходных в неделю» раскладывается на весь месяц одним
 * нажатием. Ставить каждому человеку по 8 клеток руками — это и есть то, на
 * что жаловались.
 *
 * Результат кладётся в ЧЕРНОВИК режима правки: месяц можно посмотреть, руками
 * поправить исключения и только потом сохранить.
 */
export function WeekPatternDialog({
  rows,
  monthLabel,
  onClose,
  onApply,
}: {
  rows: ScheduleRow[];
  monthLabel: string;
  onClose: () => void;
  onApply: (pattern: WeekPattern) => void;
}) {
  const [target, setTarget] = useState<string>(rows.length === 1 ? rows[0].uid : "all");
  const [offDows, setOffDows] = useState<number[]>([0, 6]);
  const [hoursMode, setHoursMode] = useState<WeekPattern["hoursMode"]>("keep");
  const [hoursDows, setHoursDows] = useState<number[]>([]);
  const [from, setFrom] = useState("12:00");
  const [to, setTo] = useState("15:00");

  const hoursValid = hoursMode !== "set" || (Boolean(from && to) && from < to);

  function toggle(list: number[], setList: (next: number[]) => void, dow: number) {
    setList(list.includes(dow) ? list.filter((d) => d !== dow) : [...list, dow]);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarRange className="h-4 w-4 shrink-0 text-primary" />
            Шаблон недели
          </DialogTitle>
          <DialogDescription>
            Отметьте выходные дни недели — они разложатся на весь {monthLabel}. Дни «отпросился» не трогаются, а сам месяц
            уйдёт в график только после «Сохранить».
          </DialogDescription>
        </DialogHeader>

        <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
          Кому
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="h-10 rounded-lg border border-border bg-background px-2 text-[13px] text-foreground"
          >
            <option value="all">Всем в разделе ({rows.length})</option>
            {rows.map((row) => (
              <option key={row.uid} value={row.uid}>
                {row.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-1.5">
          <p className="text-[12px] text-muted-foreground">Выходные по дням недели</p>
          <div className="flex flex-wrap gap-1.5">
            {WEEK_DAYS.map((d) => (
              <button
                key={d.dow}
                type="button"
                onClick={() => toggle(offDows, setOffDows, d.dow)}
                className={pageChipClass(offDows.includes(d.dow))}
              >
                {d.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {offDows.length === 0
              ? "Ни одного — все дни месяца станут рабочими."
              : `Выходных в неделю: ${offDows.length}.`}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <p className="text-[12px] text-muted-foreground">Смена с/до</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setHoursMode("keep")} className={pageChipClass(hoursMode === "keep")}>
              не трогать
            </button>
            <button type="button" onClick={() => setHoursMode("set")} className={pageChipClass(hoursMode === "set")}>
              поставить
            </button>
            <button type="button" onClick={() => setHoursMode("clear")} className={pageChipClass(hoursMode === "clear")}>
              снять
            </button>
          </div>
          {hoursMode === "set" && (
            <>
              <div className="flex items-end gap-2">
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-[12px] text-muted-foreground">
                  С
                  <Input type="time" value={from} onChange={(e) => setFrom(e.target.value)} className="h-10" />
                </label>
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-[12px] text-muted-foreground">
                  До
                  <Input type="time" value={to} onChange={(e) => setTo(e.target.value)} className="h-10" />
                </label>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {WEEK_DAYS.map((d) => (
                  <button
                    key={d.dow}
                    type="button"
                    onClick={() => toggle(hoursDows, setHoursDows, d.dow)}
                    className={cn(pageChipClass(hoursDows.includes(d.dow)), offDows.includes(d.dow) && "opacity-40")}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {hoursDows.length === 0 ? "Ни одного дня не отмечено — часы встанут на все рабочие дни." : "Часы встанут только на отмеченные рабочие дни."}
              </p>
              {!hoursValid && <p className="text-[11px] text-destructive">Начало должно быть раньше конца.</p>}
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            className="min-h-11 sm:min-h-0"
            disabled={!hoursValid}
            onClick={() => onApply({ target, offDows, hoursMode, hours: { from, to }, hoursDows })}
          >
            Разложить на месяц
          </Button>
          <Button variant="ghost" className="ml-auto min-h-11 sm:min-h-0" onClick={onClose}>
            Отмена
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
