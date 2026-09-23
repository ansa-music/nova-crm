import { useMemo, useState } from "react";
import { CalendarRange, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ShiftField } from "@/components/schedule/ShiftField";
import type { ScheduleRow } from "@/components/schedule/ScheduleGrid";
import { cn } from "@/utils/cn";
import { weekCellText } from "@/utils/weekTemplate";
import { sameScheduleHours, WEEK_DOW_SHORT, WEEK_DOWS, type ScheduleHours, type WeekCell } from "@/types";

type Kind = "work" | "off" | "hours";

interface DayDraft {
  kind: Kind;
  hours: ScheduleHours | null;
}

const WORK: WeekCell = { off: false, hours: null };

function toDraft(cell: WeekCell | undefined): DayDraft {
  if (!cell) return { kind: "work", hours: null };
  if (cell.off) return { kind: "off", hours: null };
  return cell.hours ? { kind: "hours", hours: cell.hours } : { kind: "work", hours: null };
}

function toCell(day: DayDraft): WeekCell | null {
  if (day.kind === "off") return { off: true, hours: null };
  if (day.kind === "work") return WORK;
  return day.hours ? { off: false, hours: day.hours } : null;
}

function sameCell(a: WeekCell, b: WeekCell): boolean {
  return a.off === b.off && sameScheduleHours(a.hours, b.hours);
}

const KIND_LABEL: Record<Kind, string> = { work: "Работа", off: "Выходной", hours: "Смена" };

/**
 * Неделя одного человека — все семь дней в одном окне. Открывается кликом по
 * имени: чтобы поставить человеку выходной и неполную смену, раньше надо было
 * выбрать кисть, прокрутить таблицу до его строки и попасть в клетку, а время
 * набирать в панели наверху. Здесь день — три кнопки и поле смены текстом.
 *
 * «Как у …» копирует неделю другого человека: у технарей со сменой «2/2» или
 * одинаковыми выходными её незачем прокликивать заново.
 *
 * Результат уходит в черновик недели, как кисть и вставка — в базу по «Сохранить».
 */
export function PersonWeekDialog({
  row,
  cells,
  stored,
  presets,
  others,
  onClose,
  onApply,
}: {
  row: ScheduleRow;
  /** Неделя с учётом черновика. */
  cells: Record<string, WeekCell>;
  /** Сохранённая неделя — чтобы пометить, какие дни будут изменены. */
  stored: Record<string, WeekCell>;
  presets: ScheduleHours[];
  /** Остальные люди графика — для «Как у …». */
  others: Array<{ row: ScheduleRow; cells: Record<string, WeekCell> }>;
  onClose: () => void;
  onApply: (cells: Record<string, WeekCell>) => void;
}) {
  const [days, setDays] = useState<Record<string, DayDraft>>(() =>
    Object.fromEntries(WEEK_DOWS.map((dow) => [String(dow), toDraft(cells[String(dow)])]))
  );
  const [copyFrom, setCopyFrom] = useState("");

  const result = useMemo(() => {
    const out: Record<string, WeekCell> = {};
    for (const dow of WEEK_DOWS) {
      const cell = toCell(days[String(dow)]);
      if (!cell) return null;
      out[String(dow)] = cell;
    }
    return out;
  }, [days]);

  const offCount = WEEK_DOWS.filter((dow) => days[String(dow)].kind === "off").length;

  function setDay(dow: number, next: Partial<DayDraft>) {
    setDays((prev) => {
      const current = prev[String(dow)];
      const merged = { ...current, ...next };
      // Переключили на «Смену» без часов — подставим частую, чтобы не начинать с пустого поля.
      if (merged.kind === "hours" && !merged.hours && presets[0]) merged.hours = presets[0];
      if (merged.kind !== "hours") merged.hours = null;
      return { ...prev, [String(dow)]: merged };
    });
  }

  function copyWeek(id: string) {
    setCopyFrom(id);
    const source = others.find((o) => o.row.uid === id);
    if (!source) return;
    setDays(Object.fromEntries(WEEK_DOWS.map((dow) => [String(dow), toDraft(source.cells[String(dow)])])));
  }

  function apply() {
    if (result) onApply(result);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[92vh] max-w-xl flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarRange className="h-4 w-4 shrink-0 text-primary" />
            Неделя: {row.label}
          </DialogTitle>
          <DialogDescription>
            Постоянные выходные и смены по дням недели. Уйдёт в график по «Сохранить» наверху страницы.
          </DialogDescription>
        </DialogHeader>

        {others.length > 0 && (
          <label className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
            <Copy className="h-3.5 w-3.5 shrink-0" />
            Как у
            <select
              value={copyFrom}
              onChange={(e) => copyWeek(e.target.value)}
              className="h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[12px] text-foreground sm:h-8 sm:flex-none sm:w-56"
            >
              <option value="">— выбрать человека —</option>
              {others.map((o) => (
                <option key={o.row.uid} value={o.row.uid}>
                  {o.row.label} · {WEEK_DOWS.filter((dow) => o.cells[String(dow)]?.off).map((dow) => WEEK_DOW_SHORT[dow]).join(", ") || "без выходных"}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          <div className="flex flex-col divide-y divide-border/60">
            {WEEK_DOWS.map((dow) => {
              const key = String(dow);
              const day = days[key];
              const cell = toCell(day);
              const changed = cell ? !sameCell(cell, stored[key] ?? WORK) : true;
              return (
                <div key={dow} className="flex flex-col gap-2 py-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={cn(
                        "w-8 shrink-0 text-[13px] font-semibold",
                        dow === 0 || dow === 6 ? "text-foreground/80" : "text-foreground"
                      )}
                    >
                      {WEEK_DOW_SHORT[dow]}
                    </span>
                    {(["work", "off", "hours"] as const).map((kind) => (
                      <button
                        key={kind}
                        type="button"
                        onClick={() => setDay(dow, { kind })}
                        className={cn(
                          "min-h-10 rounded-md border px-3 text-[12px] transition-colors sm:min-h-8",
                          day.kind === kind
                            ? kind === "off"
                              ? "border-destructive/50 bg-destructive/15 font-medium text-destructive"
                              : "border-primary/60 bg-primary/15 font-medium text-primary"
                            : "border-border text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {KIND_LABEL[kind]}
                      </button>
                    ))}
                    {changed && (
                      <span
                        className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary"
                        title={`Было: ${weekCellText(stored[key])}`}
                      >
                        было: {weekCellText(stored[key])}
                      </span>
                    )}
                  </div>
                  {day.kind === "hours" && (
                    <div className="pl-9">
                      <ShiftField
                        value={day.hours}
                        presets={presets}
                        onChange={(hours) => setDays((prev) => ({ ...prev, [key]: { kind: "hours", hours } }))}
                        onSubmit={apply}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
          <Button className="min-h-11 sm:min-h-0" disabled={!result} onClick={apply}>
            Готово
          </Button>
          <span className="text-[12px] text-muted-foreground">
            выходных: <span className="font-medium tabular-nums text-foreground">{offCount}</span>
            {!result && <span className="text-destructive"> · у смены не понятно время</span>}
          </span>
          <Button variant="ghost" className="ml-auto min-h-11 sm:min-h-0" onClick={onClose}>
            Отмена
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
