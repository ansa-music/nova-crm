import { useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, CircleSlash, Clock, Loader2, Sun, UserMinus, X } from "lucide-react";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ShiftField } from "@/components/schedule/ShiftField";
import {
  daysOfMonth,
  initialsName,
  isWeekend,
  weekdayOf,
  type ScheduleRow,
} from "@/components/schedule/ScheduleGrid";
import { cn } from "@/utils/cn";
import { planScheduleBulk, scheduleMonthStats, type ScheduleBulkAction, type ScheduleBulkPlan } from "@/utils/scheduleBulk";
import {
  formatScheduleHours,
  scheduleHoursOf,
  scheduleStateOf,
  type ScheduleHours,
  type TechSchedule,
} from "@/types";

const DOW_HEAD = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const ACTION_DONE: Record<ScheduleBulkAction, string> = {
  off: "Поставлен выходной",
  work: "Сделано рабочим",
  excused: "Отмечено «отпросился»",
  hours: "Поставлена смена",
  came: "Отмечено «пришёл»",
  "clear-hours": "Часы сняты",
};

/**
 * «Месяц человека» — график одного человека крупным календарём. Открывается
 * кликом по имени (и пунктом «Весь месяц» в меню дня): в общей сетке на 30
 * человек и 31 день чужой график читают, щурясь, а ставят — попадая пальцем в
 * клетку 28 px.
 *
 * Кто правит график, здесь ВЫБИРАЕТ дни (касание только отмечает, ничего не
 * пишет) и применяет к ним действие кнопкой — «Выходной», «Смена 12:30–15»…
 * Запись одна на всё действие, и тост даёт «Отменить». Случайное касание
 * поэтому ничего не меняет — то, от чего меню дня и защищает в общей сетке.
 */
export function PersonMonthDialog({
  row,
  monthKey,
  monthLabel,
  todayKey,
  schedule,
  ready,
  canEdit,
  presets,
  onMonth,
  onApply,
  onClose,
}: {
  row: ScheduleRow;
  monthKey: string;
  monthLabel: string;
  /** Сегодняшний день, если открыт текущий месяц. */
  todayKey: string | null;
  schedule: TechSchedule | null;
  /** График месяца прочитан с сервера — без этого правка выключена. */
  ready: boolean;
  canEdit: boolean;
  presets: ScheduleHours[];
  /** Листать месяц (страница переключает свой месяц; нет — стрелок нет). */
  onMonth?: (direction: -1 | 1) => void;
  /** Записать пакет; возвращает «Отменить». */
  onApply: (plan: ScheduleBulkPlan) => Promise<() => Promise<void>>;
  onClose: () => void;
}) {
  const days = useMemo(() => daysOfMonth(monthKey), [monthKey]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [shiftOpen, setShiftOpen] = useState(false);
  const [shift, setShift] = useState<ScheduleHours | null>(presets[0] ?? null);
  const [busy, setBusy] = useState(false);
  // Последнее действие и его «Отменить» — прямо в окне: тост с той же
  // кнопкой лежит под затемнением окна, и нажать его нельзя.
  const [done, setDone] = useState<{ text: string; undo: () => Promise<void> } | null>(null);

  // Другой месяц — другой набор дней: выбор прошлого месяца к нему не относится.
  useEffect(() => {
    setSelected(new Set());
    setShiftOpen(false);
    setDone(null);
  }, [monthKey, row.uid]);

  const stats = useMemo(() => scheduleMonthStats(schedule, days), [schedule, days]);
  const lead = (weekdayOf(monthKey, "1") + 6) % 7;
  const editable = canEdit && ready && !busy;

  function toggle(day: string) {
    if (!editable) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  /** Быстрый выбор: все субботы и воскресенья, будни, весь месяц, по дню недели. */
  function selectWhere(test: (day: string) => boolean) {
    if (!editable) return;
    const wanted = days.filter(test);
    setSelected((prev) => {
      const allIn = wanted.every((d) => prev.has(d));
      const next = new Set(prev);
      for (const d of wanted) {
        if (allIn) next.delete(d);
        else next.add(d);
      }
      return next;
    });
  }

  const picked = days.filter((d) => selected.has(d));
  const plans = useMemo(() => {
    const out = new Map<ScheduleBulkAction, ScheduleBulkPlan>();
    for (const action of ["work", "off", "excused", "came", "clear-hours"] as const) {
      out.set(action, planScheduleBulk(schedule, picked, action));
    }
    out.set("hours", planScheduleBulk(schedule, picked, "hours", shift));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule, selected, shift]);

  async function apply(action: ScheduleBulkAction) {
    const plan = plans.get(action);
    if (!plan || plan.touched.length === 0 || !editable) return;
    setBusy(true);
    try {
      const undo = await onApply(plan);
      setDone({ text: `${ACTION_DONE[action]} · дней: ${plan.touched.length}`, undo });
      setSelected(new Set());
      setShiftOpen(false);
    } catch {
      // Отказ уже показан тостом страницы; выбор оставляем — повторить.
    } finally {
      setBusy(false);
    }
  }

  const actionButton = (action: ScheduleBulkAction, label: string, Icon: typeof Check, tone?: string) => {
    const count = plans.get(action)?.touched.length ?? 0;
    return (
      <Button
        key={action}
        variant="outline"
        size="sm"
        disabled={!editable || count === 0}
        onClick={() => void apply(action)}
        className={cn("min-h-11 gap-1.5 sm:min-h-9", tone)}
        title={count === 0 ? "У выбранных дней уже так" : `Изменится дней: ${count}`}
      >
        <Icon className="h-4 w-4" />
        {label}
        {count > 0 && count !== picked.length && <span className="tabular-nums opacity-70">· {count}</span>}
      </Button>
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <MemberAvatar
              id={row.member?.uid ?? row.uid}
              name={row.member?.name ?? initialsName(row.label)}
              nickname={row.member?.nickname}
              photoURL={row.member?.photoURL}
              className="h-9 w-9 shrink-0"
            />
            <span className="min-w-0 truncate text-lg">{row.label}</span>
            {row.note && <span className="shrink-0 rounded-sm bg-muted px-1.5 text-[11px] font-normal text-muted-foreground">{row.note}</span>}
          </DialogTitle>
          <DialogDescription>
            {canEdit
              ? "Касанием отметьте дни, потом выберите, что поставить. Запишется одним действием, его можно отменить."
              : "График на месяц: выходные, отгулы и смены с/до."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          {onMonth && (
            <Button
              variant="outline"
              size="icon"
              className="h-11 w-11 sm:h-9 sm:w-9"
              aria-label="Предыдущий месяц"
              disabled={busy}
              onClick={() => onMonth(-1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
          <span className="min-w-[8.5rem] text-center text-[15px] font-semibold">{monthLabel}</span>
          {onMonth && (
            <Button
              variant="outline"
              size="icon"
              className="h-11 w-11 sm:h-9 sm:w-9"
              aria-label="Следующий месяц"
              disabled={busy}
              onClick={() => onMonth(1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}
          {!ready && <Loader2 className="ml-auto h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        {/* Итоги месяца — крупно, одним взглядом. */}
        {/* На телефоне — одной строкой: плитки занимали полэкрана над календарём. */}
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-[13px] sm:hidden">
          <span><span className="font-mono font-semibold tabular-nums">{stats.work}</span> рабочих</span>
          <span className="text-destructive"><span className="font-mono font-semibold tabular-nums">{stats.off}</span> вых.</span>
          {stats.excused > 0 && (
            <span className="text-warning"><span className="font-mono font-semibold tabular-nums">{stats.excused}</span> отпр.</span>
          )}
          {stats.shifts > 0 && (
            <span className="text-primary"><span className="font-mono font-semibold tabular-nums">{stats.shifts}</span> смен с/до</span>
          )}
          {stats.came > 0 && <span><span className="font-mono font-semibold tabular-nums">{stats.came}</span> вышел в вых.</span>}
        </p>
        <div className="hidden grid-cols-5 gap-2 sm:grid">
          <Stat label="Рабочих" value={stats.work} />
          <Stat label="Выходных" value={stats.off} tone="text-destructive" />
          <Stat label="Отпросился" value={stats.excused} tone="text-warning" />
          <Stat label="Смен с/до" value={stats.shifts} tone="text-primary" />
          <Stat label="Вышел в вых." value={stats.came} />
        </div>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
            <span className="text-muted-foreground">Выбрать:</span>
            {[
              ["сб и вс", (d: string) => isWeekend(monthKey, d)],
              ["будни", (d: string) => !isWeekend(monthKey, d)],
              ["весь месяц", () => true],
              ...(todayKey ? ([["с сегодня", (d: string) => Number(d) >= Number(todayKey)]] as const) : []),
            ].map(([label, test]) => (
              <button
                key={label as string}
                type="button"
                disabled={!editable}
                onClick={() => selectWhere(test as (d: string) => boolean)}
                className="min-h-10 rounded-md border border-border px-2.5 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-50 sm:min-h-8"
              >
                {label as string}
              </button>
            ))}
            {selected.size > 0 && (
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="ml-auto min-h-10 rounded-md px-2 text-muted-foreground hover:text-foreground sm:min-h-8"
              >
                снять выбор · {selected.size}
              </button>
            )}
          </div>
        )}

        <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
          {DOW_HEAD.map((label, i) => (
            <button
              key={label}
              type="button"
              disabled={!editable}
              // Клик по дню недели — все такие дни месяца (все пятницы).
              onClick={() => selectWhere((d) => (weekdayOf(monthKey, d) + 6) % 7 === i)}
              className={cn(
                "rounded-md py-1 text-center text-[12px] font-medium",
                i >= 5 ? "text-foreground/85" : "text-muted-foreground",
                editable && "hover:bg-primary/10"
              )}
              title={editable ? `Выбрать все ${label}` : undefined}
            >
              {label}
            </button>
          ))}
          {Array.from({ length: lead }, (_, i) => (
            <span key={`lead-${i}`} />
          ))}
          {days.map((d) => {
            const state = scheduleStateOf(schedule, d);
            const hours = state === "work" ? scheduleHoursOf(schedule, d) : null;
            const came = Boolean(schedule?.selfWork?.[d]) && Boolean(schedule?.days?.[d]);
            const isToday = d === todayKey;
            const past = todayKey != null && Number(d) < Number(todayKey);
            const on = selected.has(d);
            return (
              <button
                key={d}
                type="button"
                disabled={!editable}
                onClick={() => toggle(d)}
                aria-pressed={on}
                className={cn(
                  "relative flex min-h-[3.75rem] flex-col items-start justify-between rounded-lg border p-1.5 text-left transition-colors sm:min-h-[4.5rem] sm:p-2",
                  state === "off"
                    ? "border-destructive/45 bg-destructive/15"
                    : state === "excused"
                      ? "border-warning/45 bg-warning/15"
                      : hours
                        ? "border-primary/45 bg-primary/10"
                        : isWeekend(monthKey, d)
                          ? "border-border/60 bg-foreground/[0.05]"
                          : "border-border/60 bg-card",
                  isToday && "ring-2 ring-primary ring-offset-1 ring-offset-background",
                  on && "outline outline-2 outline-offset-1 outline-primary",
                  past && !on && "opacity-60",
                  editable ? "cursor-pointer hover:brightness-110" : "cursor-default"
                )}
              >
                <span
                  className={cn(
                    "font-mono text-[13px] tabular-nums sm:text-[14px]",
                    isToday ? "font-bold text-primary" : "text-foreground/85"
                  )}
                >
                  {d}
                </span>
                {/* Смена — в две строки («12:30» / «–15:00»): одной строкой
                    в клетку календаря на телефоне она не влезала. */}
                {hours && !hours.label ? (
                  <span className="flex w-full flex-col font-mono text-[11px] font-semibold leading-tight text-primary sm:text-[12px]">
                    <span>{hours.to ? hours.from : `с ${hours.from}`}</span>
                    {hours.to && <span className="opacity-80">–{hours.to}</span>}
                  </span>
                ) : (
                  <span
                    className={cn(
                      "line-clamp-2 w-full break-words text-[11px] font-semibold leading-tight sm:text-[12px]",
                      state === "off" ? "text-destructive" : state === "excused" ? "text-warning" : hours ? "text-primary" : "text-muted-foreground/70"
                    )}
                  >
                    {state === "off" ? "вых" : state === "excused" ? "отпр." : hours ? formatScheduleHours(hours) : came ? "✓ вышел" : ""}
                  </span>
                )}
                {on && (
                  <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="h-3 w-3" />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {done && picked.length === 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-[13px]">
            <Check className="h-4 w-4 shrink-0 text-success" />
            <span className="min-w-0 flex-1">{done.text}</span>
            <Button
              variant="outline"
              size="sm"
              className="min-h-10 sm:min-h-8"
              disabled={busy}
              onClick={async () => {
                const undo = done.undo;
                setBusy(true);
                try {
                  await undo();
                  setDone(null);
                } catch {
                  // Тост с причиной показала страница — плашка остаётся.
                } finally {
                  setBusy(false);
                }
              }}
            >
              Отменить
            </Button>
          </div>
        )}

        {canEdit && picked.length > 0 && (
          // Действия — внизу окна и всегда на виду: выбор мог быть длинным.
          <div className="sticky bottom-0 -mx-1 flex flex-col gap-2 rounded-xl border border-primary/35 bg-background/95 p-2.5 shadow-lg backdrop-blur">
            <p className="text-[12px]">
              Выбрано дней: <span className="font-semibold tabular-nums">{picked.length}</span>
              {picked.length <= 10 && <span className="text-muted-foreground"> · {picked.join(", ")}</span>}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {actionButton("off", "Выходной", CircleSlash, "text-destructive")}
              {actionButton("work", "Рабочий", Sun)}
              {actionButton("excused", "Отпросился", UserMinus, "text-warning")}
              <Button
                variant={shiftOpen ? "default" : "outline"}
                size="sm"
                disabled={!editable}
                onClick={() => setShiftOpen((v) => !v)}
                className="min-h-11 gap-1.5 sm:min-h-9"
              >
                <Clock className="h-4 w-4" />
                Смена с/до…
              </Button>
              {(plans.get("came")?.touched.length ?? 0) > 0 && actionButton("came", "Пришёл", Check)}
              {(plans.get("clear-hours")?.touched.length ?? 0) > 0 && actionButton("clear-hours", "Снять часы", X)}
            </div>
            {shiftOpen && (
              <div className="flex flex-col gap-2 border-t border-border/60 pt-2">
                <ShiftField autoFocus value={shift} presets={presets} onChange={setShift} onSubmit={() => void apply("hours")} />
                <Button
                  size="sm"
                  className="min-h-11 self-start sm:min-h-9"
                  disabled={!editable || !shift || (plans.get("hours")?.touched.length ?? 0) === 0}
                  onClick={() => void apply("hours")}
                >
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Поставить смену {shift ? formatScheduleHours(shift) : ""}
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="flex flex-col rounded-lg border border-border/60 bg-card px-2.5 py-1.5">
      <span className={cn("font-mono text-[20px] font-semibold leading-tight tabular-nums", tone)}>{value}</span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}
