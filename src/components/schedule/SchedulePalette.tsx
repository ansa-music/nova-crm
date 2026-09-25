import { useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Clock, RotateCcw, X } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/cn";
import { parseShiftText } from "@/utils/weekTemplate";
import {
  CELL_KIND_LETTER,
  CELL_KIND_LOOK,
  type CellKind,
} from "@/components/schedule/scheduleShared";
import { formatScheduleHours, sameScheduleHours, type ScheduleHours, type ScheduleShiftPreset } from "@/types";

export type PaletteAction = "work" | "off" | "excused" | "came" | "hours" | "restore";

export interface SchedulePaletteProps {
  open: boolean;
  onClose: () => void;
  /** Где показать на компьютере: клетка сетки или чип «Дня». */
  anchor: HTMLElement | null;
  /** Телефон: палитра — шторка снизу, а не всплывашка у клетки. */
  mobile: boolean;
  mode: "month" | "week";
  title: string;
  subtitle: ReactNode;
  canEdit: boolean;
  /** Почему именно сейчас править нельзя («график ещё загружается»). */
  blocked?: string | null;
  /** Что стоит во всём выделении — подсвечиваем; разное — null. */
  current: CellKind | null;
  /** «Пришёл» — только для выходных и «отпросился». */
  cameAvailable: boolean;
  presets: ScheduleShiftPreset[];
  /** Смена в клетке сейчас — ею заполнено поле. */
  currentShift: ScheduleHours | null;
  /** «Каждую неделю» (только в месяце): подпись дня недели или причина, почему нельзя. */
  weekly: { label: string; disabledReason?: string | null } | null;
  onApply: (action: PaletteAction, opts: { shift: ScheduleHours | null; weekly: boolean }) => void;
  /** «Весь месяц · Имя» / «Вся неделя · Имя». */
  extraLink?: { label: string; onClick: () => void } | null;
  /**
   * «Как в постоянной неделе» (месяц): вернуть выделенные дни к обычному
   * распорядку. `touched` — сколько клеток изменится (0 — уже так).
   */
  restore?: { touched: number } | null;
}

type MainAction = Exclude<PaletteAction, "hours" | "restore">;

const MONTH_ACTIONS: MainAction[] = ["off", "work", "excused", "came"];
const WEEK_ACTIONS: MainAction[] = ["off", "work"];

const ACTION_LABEL: Record<MainAction, { month: string; week: string }> = {
  off: { month: "Выходной", week: "Выходной" },
  work: { month: "Рабочий", week: "Рабочий весь день" },
  excused: { month: "Отпросился", week: "" },
  came: { month: "Пришёл", week: "" },
};

/**
 * Палитра клетки: выделили клетки — выбираете, что поставить. Всё главное —
 * крупными кнопками с буквой клавиши (В, Р, О, П), смены команды — в одно
 * касание, своя смена — одним полем текстом. Записывается сразу, «Отменить» —
 * Ctrl+Z или кнопка в панели сетки.
 *
 * Та же палитра — у того, кто график только смотрит: без кнопок, с тем, что
 * стоит в клетке («смена 12:00–15:00») — на телефоне подсказок на наведение нет.
 */
export function SchedulePalette(props: SchedulePaletteProps) {
  const anchorRef = useRef<{ getBoundingClientRect: () => DOMRect }>({
    getBoundingClientRect: () => props.anchor?.getBoundingClientRect() ?? new DOMRect(),
  });
  anchorRef.current.getBoundingClientRect = () => props.anchor?.getBoundingClientRect() ?? new DOMRect();

  if (props.mobile) {
    return (
      <Sheet open={props.open} onOpenChange={(open) => !open && props.onClose()}>
        <SheetContent side="bottom" className="flex flex-col gap-3">
          <SheetTitle className="pr-10 text-[15px]">{props.title}</SheetTitle>
          <SheetDescription asChild>
            <div className="-mt-2 text-[13px] text-muted-foreground">{props.subtitle}</div>
          </SheetDescription>
          <PaletteBody {...props} big />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={6}
        updatePositionStrategy="always"
        data-schedule-palette
        className="w-[20rem] p-3"
        // Фокус остаётся на странице: иначе буквы В/Р/О/П и стрелки уходили
        // бы в палитру, а не в сетку.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          // Клик по другой клетке — это новое выделение, а не «закрыть»:
          // палитра переедет к ней сама.
          const target = event.target as HTMLElement | null;
          if (target?.closest("[data-schedule-grid]")) event.preventDefault();
        }}
      >
        <div className="mb-2.5 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold">{props.title}</p>
            <div className="text-[12px] text-muted-foreground">{props.subtitle}</div>
          </div>
          <button
            type="button"
            aria-label="Закрыть"
            onClick={props.onClose}
            className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <PaletteBody {...props} />
      </PopoverContent>
    </Popover>
  );
}

function PaletteBody({
  mode,
  canEdit,
  blocked,
  current,
  cameAvailable,
  presets,
  currentShift,
  weekly,
  onApply,
  extraLink,
  restore,
  big = false,
}: SchedulePaletteProps & { big?: boolean }) {
  const [text, setText] = useState(currentShift ? formatScheduleHours(currentShift) : "");
  const [repeat, setRepeat] = useState(false);
  const parsed = useMemo(() => parseShiftText(text), [text]);
  const actions = mode === "month" ? MONTH_ACTIONS : WEEK_ACTIONS;
  const locked = Boolean(blocked);
  const weeklyOn = Boolean(weekly && !weekly.disabledReason && repeat);

  function apply(action: PaletteAction, shift: ScheduleHours | null = null) {
    if (!canEdit || locked) return;
    onApply(action, { shift, weekly: weeklyOn });
  }

  if (!canEdit) {
    return extraLink ? <ExtraLink {...extraLink} /> : null;
  }

  return (
    <div className="flex flex-col gap-3">
      {blocked && <p className="rounded-md bg-warning/10 px-2 py-1.5 text-[12px] text-warning">{blocked}</p>}

      <div className="grid grid-cols-2 gap-1.5">
        {actions.map((action) => {
          const disabled = locked || (action === "came" && !cameAvailable);
          const on = current === action;
          return (
            <button
              key={action}
              type="button"
              disabled={disabled}
              onClick={() => apply(action)}
              title={
                action === "came" && !cameAvailable
                  ? "«Пришёл» — для выходного или «отпросился»: человек всё-таки вышел"
                  : undefined
              }
              className={cn(
                "flex items-center gap-2 rounded-lg border px-2.5 text-left font-medium transition-[filter,box-shadow] disabled:cursor-not-allowed disabled:opacity-40",
                big ? "min-h-12 text-[15px]" : "min-h-10 text-[13px]",
                CELL_KIND_LOOK[action],
                action === "work" && "border-border text-foreground",
                on ? "ring-2 ring-primary ring-offset-1 ring-offset-popover" : "hover:brightness-125"
              )}
            >
              <span
                className={cn(
                  "flex shrink-0 items-center justify-center rounded-md bg-background/60 font-mono font-semibold",
                  big ? "h-7 w-7 text-[14px]" : "h-6 w-6 text-[12px]"
                )}
                aria-hidden
              >
                {CELL_KIND_LETTER[action]}
              </span>
              <span className="min-w-0 truncate">{ACTION_LABEL[action][mode]}</span>
            </button>
          );
        })}
      </div>

      {restore && (
        <button
          type="button"
          disabled={locked || restore.touched === 0}
          onClick={() => apply("restore")}
          title={restore.touched === 0 ? "Выделенные дни и так как в постоянной неделе" : undefined}
          className={cn(
            "-mt-1 flex items-center gap-2 rounded-lg border border-dashed border-border px-2.5 text-left text-[12px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-40",
            big ? "min-h-11" : "min-h-8"
          )}
        >
          <RotateCcw className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">Как в постоянной неделе</span>
          {restore.touched > 0 && <span className="shrink-0 font-mono tabular-nums">{restore.touched}</span>}
        </button>
      )}

      <div className="flex flex-col gap-1.5">
        <p className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
          <Clock className="h-3.5 w-3.5" /> Смена с/до
        </p>
        {presets.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {presets.map((preset) => {
              const label = formatScheduleHours(preset);
              const on = current === "hours" && sameScheduleHours(currentShift, preset);
              return (
                <button
                  key={label}
                  type="button"
                  disabled={locked}
                  onClick={() => apply("hours", { from: preset.from, to: preset.to || "", ...(preset.label ? { label: preset.label } : {}) })}
                  className={cn(
                    "rounded-md border px-2 font-mono tabular-nums transition-colors disabled:opacity-40",
                    big ? "min-h-11 text-[13px]" : "min-h-8 text-[12px]",
                    on
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-primary/30 text-primary hover:border-primary hover:bg-primary/10"
                  )}
                >
                  {preset.name ? <span className="mr-1 font-sans font-medium text-foreground/90">{preset.name}</span> : null}
                  {label}
                </button>
              );
            })}
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <Input
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && parsed) {
                event.preventDefault();
                apply("hours", parsed);
              }
            }}
            disabled={locked}
            placeholder="12:30-15 или с 12:45"
            aria-label="Своя смена: с какого и до какого часа"
            className={cn("min-w-0 flex-1 font-mono", big ? "h-11" : "h-9 text-[13px]")}
          />
          <Button
            size="sm"
            disabled={locked || !parsed}
            onClick={() => parsed && apply("hours", parsed)}
            className={cn("shrink-0", big ? "h-11" : "h-9")}
          >
            Поставить
          </Button>
        </div>
        {text.trim() && !parsed && (
          <p className="text-[11px] text-destructive">Не понял. Пишите «12:30-15», «с 12:45» или «10-12, 15-19».</p>
        )}
      </div>

      {weekly && (
        <label
          className={cn(
            "flex items-center gap-2.5 rounded-lg border border-border/70 px-2.5 py-2",
            weekly.disabledReason ? "opacity-60" : "cursor-pointer"
          )}
        >
          <Switch checked={weeklyOn} disabled={Boolean(weekly.disabledReason)} onCheckedChange={setRepeat} />
          <span className="min-w-0 flex-1 text-[12px] leading-4">
            <span className="font-medium">Повторять {weekly.label}</span>
            <span className="block text-muted-foreground">
              {weekly.disabledReason ?? "Для «Выходной», «Рабочий» и смены — станет постоянной неделей"}
            </span>
          </span>
        </label>
      )}

      {extraLink && <ExtraLink {...extraLink} />}
    </div>
  );
}

function ExtraLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-9 items-center justify-between gap-2 rounded-md px-1 text-left text-[12px] font-medium text-primary hover:underline"
    >
      <span className="min-w-0 truncate">{label}</span>
      <ArrowRight className="h-3.5 w-3.5 shrink-0" />
    </button>
  );
}
