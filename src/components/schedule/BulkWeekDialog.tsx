import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ShiftField } from "@/components/schedule/ShiftField";
import { CELL_KIND_LOOK, initialsName, QUICK_WEEKS, type ScheduleRow } from "@/components/schedule/scheduleShared";
import { cn } from "@/utils/cn";
import { matchesPersonQuery } from "@/utils/weekTemplate";
import { WEEK_DOW_SHORT, WEEK_DOWS, type ScheduleHours, type ScheduleShiftPreset, type WeekCell } from "@/types";

export interface BulkWeekSection {
  id: string;
  title: string;
  rows: ScheduleRow[];
}

export interface BulkWeekResult {
  row: ScheduleRow;
  /** Обычная неделя человека целиком — как её запишут. */
  cells: Record<string, WeekCell>;
}

type HoursMode = "keep" | "full" | "shift";

const HOURS_MODES: Array<{ value: HoursMode; label: string; hint: string }> = [
  { value: "keep", label: "Не менять", hint: "У кого стояла смена — останется, у остальных весь день" },
  { value: "full", label: "Весь день", hint: "Смены в рабочие дни снимаются" },
  { value: "shift", label: "Одна смена", hint: "Всем выбранным — одна и та же смена в рабочие дни" },
];

function sameSet(a: ReadonlySet<number>, b: readonly number[]): boolean {
  return a.size === b.length && b.every((dow) => a.has(dow));
}

/**
 * «Настроить нескольким» — обычная неделя сразу группе людей (просьба Nurba
 * 13.10.2026: «чтобы было удобно настраивать»). Три шага в одном окне: кому →
 * какие дни выходные → какие часы в рабочие дни. Раньше то же делалось
 * клетка за клеткой или окном на каждого человека.
 *
 * Окно только собирает недели: что записать и как отменить, решает страница
 * (одна правка, один «Отменить»).
 */
export function BulkWeekDialog({
  sections,
  currentOf,
  presets,
  onClose,
  onApply,
}: {
  sections: BulkWeekSection[];
  /** Обычная неделя человека сейчас — ради «Не менять» у часов. */
  currentOf: (personId: string) => Record<string, WeekCell>;
  presets: ScheduleShiftPreset[];
  onClose: () => void;
  onApply: (list: BulkWeekResult[]) => void;
}) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [off, setOff] = useState<ReadonlySet<number>>(new Set([6, 0]));
  const [hoursMode, setHoursMode] = useState<HoursMode>("keep");
  const [shift, setShift] = useState<ScheduleHours | null>(null);
  const [query, setQuery] = useState("");

  const everyone = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  const searching = query.trim().length > 0;
  const shown = useMemo(
    () =>
      sections
        .map((s) => ({
          ...s,
          rows: searching ? s.rows.filter((row) => matchesPersonQuery(query, [row.label, row.member?.name, row.member?.nickname])) : s.rows,
        }))
        .filter((s) => s.rows.length > 0),
    [sections, query, searching]
  );

  function toggle(uid: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }

  /** Раздел целиком: все отмечены — снять, иначе отметить всех. */
  function toggleSection(rows: ScheduleRow[]) {
    setPicked((prev) => {
      const next = new Set(prev);
      const all = rows.every((row) => next.has(row.uid));
      for (const row of rows) {
        if (all) next.delete(row.uid);
        else next.add(row.uid);
      }
      return next;
    });
  }

  function toggleDay(dow: number) {
    setOff((prev) => {
      const next = new Set(prev);
      if (next.has(dow)) next.delete(dow);
      else next.add(dow);
      return next;
    });
  }

  const chosen = everyone.filter((row) => picked.has(row.uid));
  const offNames = WEEK_DOWS.filter((dow) => off.has(dow)).map((dow) => WEEK_DOW_SHORT[dow].toLowerCase());
  const blocked = chosen.length === 0 || (hoursMode === "shift" && !shift);

  function apply() {
    if (blocked) return;
    onApply(
      chosen.map((row) => {
        const before = currentOf(row.uid);
        const cells: Record<string, WeekCell> = {};
        for (const dow of WEEK_DOWS) {
          const key = String(dow);
          if (off.has(dow)) cells[key] = { off: true, hours: null };
          else if (hoursMode === "shift") cells[key] = { off: false, hours: shift };
          else if (hoursMode === "full") cells[key] = { off: false, hours: null };
          else cells[key] = { off: false, hours: before[key]?.off ? null : before[key]?.hours ?? null };
        }
        return { row, cells };
      })
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex max-h-[92dvh] flex-col gap-4 sm:max-w-2xl"
        // Фокус — на само окно: первым полем стоит поиск, и на телефоне
        // вместе с окном сразу выезжала бы клавиатура.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Обычная неделя — нескольким сразу</DialogTitle>
          <DialogDescription>
            Отметьте людей и их выходные — правило запишется всем выбранным. Действует с сегодняшнего дня; разовые выходные и
            смены на конкретные даты оно не трогает.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
          <section className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[13px] font-semibold">
                1. Кому
                <span className="ml-1.5 font-mono text-[11px] font-normal tabular-nums text-muted-foreground">
                  {chosen.length} из {everyone.length}
                </span>
              </h3>
              {everyone.length > 8 && (
                <div className="relative ml-auto w-full sm:w-52">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Найти человека"
                    aria-label="Найти человека"
                    className="h-9 pl-8 text-[13px]"
                  />
                </div>
              )}
            </div>
            {shown.length === 0 && <p className="text-[12px] text-muted-foreground">Никого не нашли.</p>}
            {shown.map((section) => {
              const all = section.rows.every((row) => picked.has(row.uid));
              return (
                <div key={section.id} className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{section.title}</span>
                    <button
                      type="button"
                      onClick={() => toggleSection(section.rows)}
                      className="min-h-9 text-[12px] font-medium text-primary hover:underline sm:min-h-0"
                    >
                      {all ? "снять всех" : "выбрать всех"}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {section.rows.map((row) => {
                      const on = picked.has(row.uid);
                      return (
                        <button
                          key={row.uid}
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggle(row.uid)}
                          className={cn(
                            "inline-flex min-h-10 max-w-full items-center gap-1.5 rounded-lg border px-2 text-[13px] transition-colors sm:min-h-8",
                            on ? "border-primary bg-primary/15 text-primary" : "border-border text-foreground hover:border-primary/50"
                          )}
                        >
                          {on ? (
                            <Check className="h-4 w-4 shrink-0" />
                          ) : (
                            <MemberAvatar
                              id={row.member?.uid ?? row.uid}
                              name={row.member?.name ?? initialsName(row.label)}
                              nickname={row.member?.nickname}
                              photoURL={row.member?.photoURL}
                              className="h-5 w-5 shrink-0"
                            />
                          )}
                          <span className="min-w-0 truncate">{row.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-[13px] font-semibold">2. Выходные дни</h3>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_WEEKS.map((quick) => {
                const on = sameSet(off, quick.off);
                return (
                  <button
                    key={quick.label}
                    type="button"
                    aria-pressed={on}
                    title={quick.hint}
                    onClick={() => setOff(new Set(quick.off))}
                    className={cn(
                      "min-h-10 rounded-lg border px-3 text-[13px] font-medium transition-colors sm:min-h-8",
                      on ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {quick.label}
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {WEEK_DOWS.map((dow) => {
                const isOff = off.has(dow);
                return (
                  <button
                    key={dow}
                    type="button"
                    aria-pressed={isOff}
                    aria-label={`${WEEK_DOW_SHORT[dow]} — ${isOff ? "выходной" : "рабочий"}`}
                    onClick={() => toggleDay(dow)}
                    className={cn(
                      "flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-lg border font-semibold transition-[filter] hover:brightness-125",
                      CELL_KIND_LOOK[isOff ? "off" : "work"]
                    )}
                  >
                    <span className="text-[13px] leading-none">{WEEK_DOW_SHORT[dow]}</span>
                    <span className="text-[11px] font-medium leading-none opacity-90">{isOff ? "вых" : "раб"}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-[12px] text-muted-foreground">Нажмите на день, чтобы сделать его выходным или рабочим.</p>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-[13px] font-semibold">3. Часы в рабочие дни</h3>
            <div className="inline-flex w-fit max-w-full flex-wrap rounded-lg border border-border p-0.5" role="group" aria-label="Часы в рабочие дни">
              {HOURS_MODES.map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  aria-pressed={hoursMode === mode.value}
                  title={mode.hint}
                  onClick={() => setHoursMode(mode.value)}
                  className={cn(
                    "min-h-10 rounded-md px-3 text-[13px] transition-colors sm:min-h-8",
                    hoursMode === mode.value ? "bg-primary/15 font-medium text-primary" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <p className="text-[12px] text-muted-foreground">{HOURS_MODES.find((mode) => mode.value === hoursMode)?.hint}.</p>
            {hoursMode === "shift" && <ShiftField value={shift} presets={presets} onChange={setShift} onSubmit={apply} />}
          </section>
        </div>

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <p className="min-w-0 text-[12px] text-muted-foreground">
            {chosen.length === 0
              ? "Выберите хотя бы одного человека."
              : `${chosen.length} чел. · ${offNames.length > 0 ? `выходные: ${offNames.join(", ")}` : "без выходных"}`}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" onClick={onClose}>
              Отмена
            </Button>
            <Button onClick={apply} disabled={blocked}>
              Применить
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
