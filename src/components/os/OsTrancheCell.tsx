import { useState } from "react";
import { Check, Hourglass, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/utils/cn";
import { formatNumber } from "@/utils/format";
import { almatyDay, dateInputValue, formatDayMonth, formatFullDate, parseDateInput } from "@/utils/osDates";
import { parseTrancheAmount, type TrancheInfo } from "@/utils/osTranche";

/**
 * Записать второй транш строки: переданное поле пишется, `null` стирает;
 * `"clear"` — стереть транш целиком. Нет сеттера — только показ (чужой стол).
 */
export type TrancheSetter = (change: { amount?: number | null; paidOn?: number | null } | "clear") => void;

/** Нажатие внутри ячейки не должно выделять её и открывать правку. */
const swallow = {
  onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
  onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
  onDoubleClick: (e: React.MouseEvent) => e.stopPropagation(),
};

function money(n: number): string {
  return formatNumber(n);
}

/** Подсказка к траншу: «Второй транш 50 000 — ждём» / «принят 3 октября». */
export function trancheTitle(info: TrancheInfo): string {
  if (info.state === "none") return "Второй транш не указан";
  const sum = info.amount !== null ? ` ${money(info.amount)}` : "";
  if (info.state === "paid" && info.paidOn) return `Второй транш${sum} — принят ${formatFullDate(info.paidOn)}`;
  return `Второй транш${sum} — ждём`;
}

/** Окно правки: сумма, «Принят сегодня» / другой день, «Стереть». */
function TrancheEditor({ info, onSet, onDone }: { info: TrancheInfo; onSet: TrancheSetter; onDone: () => void }) {
  // Поля — черновики: пишем по Enter / кнопке, а не на каждую цифру.
  const [amountDraft, setAmountDraft] = useState(() => (info.amount !== null ? String(info.amount) : ""));
  const [dayDraft, setDayDraft] = useState(() => dateInputValue(info.paidOn ?? almatyDay(Date.now())));
  const parsed = parseTrancheAmount(amountDraft);
  const amountChanged = amountDraft.trim() !== "" ? parsed !== null && parsed !== info.amount : info.amount !== null;
  const amountInvalid = amountDraft.trim() !== "" && parsed === null;
  const dayMs = parseDateInput(dayDraft);
  const today = almatyDay(Date.now());

  const saveAmount = () => {
    if (amountInvalid || !amountChanged) return;
    onSet({ amount: parsed });
    onDone();
  };
  /** Отметить принятым; если сумма вписана, но не сохранена — заодно и её. */
  const markPaid = (day: number) => {
    const change: { amount?: number | null; paidOn: number } = { paidOn: day };
    if (amountChanged && !amountInvalid) change.amount = parsed;
    onSet(change);
    onDone();
  };

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-xs font-medium">Второй транш</p>
      <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
        Сумма
        <div className="flex gap-1.5">
          <Input
            autoFocus
            inputMode="decimal"
            placeholder="например, 50 000"
            value={amountDraft}
            aria-invalid={amountInvalid}
            aria-label="Сумма второго транша"
            onChange={(e) => setAmountDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                saveAmount();
              }
            }}
            className="font-mono tabular-nums"
          />
          <Button size="sm" className="min-h-11 shrink-0 sm:min-h-9" disabled={amountInvalid || !amountChanged} onClick={saveAmount}>
            Сохранить
          </Button>
        </div>
        {amountInvalid ? <span className="text-destructive">Впишите сумму числом</span> : null}
      </label>

      {info.state === "paid" && info.paidOn ? (
        <div className="flex flex-col gap-1.5 rounded-md border border-success/30 bg-success/10 px-2.5 py-2 text-xs">
          <span className="inline-flex items-center gap-1.5 font-medium text-success">
            <Check className="h-3.5 w-3.5" /> Принят {formatFullDate(info.paidOn)}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="min-h-11 sm:min-h-8"
            onClick={() => {
              onSet({ paidOn: null });
              onDone();
            }}
          >
            Отменить отметку — ещё ждём
          </Button>
        </div>
      ) : (
        <Button size="sm" className="min-h-11 justify-start gap-2 bg-success text-success-foreground hover:bg-success/90 sm:min-h-9" onClick={() => markPaid(today)}>
          <Check className="h-4 w-4" /> Принят сегодня
        </Button>
      )}

      <div className="flex flex-col gap-1 text-[11px] text-muted-foreground">
        {info.state === "paid" ? "Поменять день приёма" : "Принят в другой день"}
        <div className="flex gap-1.5">
          <Input type="date" aria-label="День, когда второй транш принят" value={dayDraft} onChange={(e) => setDayDraft(e.target.value)} />
          <Button
            size="sm"
            variant="outline"
            className="min-h-11 shrink-0 sm:min-h-9"
            disabled={dayMs === null || dayMs === info.paidOn}
            onClick={() => dayMs !== null && markPaid(dayMs)}
          >
            Поставить
          </Button>
        </div>
      </div>

      {info.state !== "none" ? (
        <Button
          size="sm"
          variant="ghost"
          className="min-h-11 justify-start gap-2 text-muted-foreground sm:min-h-8"
          onClick={() => {
            onSet("clear");
            onDone();
          }}
        >
          <X className="h-3.5 w-3.5" /> Стереть транш
        </Button>
      ) : null}
      <p className="text-[11px] leading-snug text-muted-foreground">
        Пометка только для вас: технарю, в кассу и в ABS уходит общая сумма заказа.
      </p>
    </div>
  );
}

/** Что видно в ячейке / карточке: сумма и «ждём» или «✓ 03.10». */
function TrancheFace({ info, size, editable }: { info: TrancheInfo; size: "cell" | "card"; editable: boolean }) {
  const cell = size === "cell";
  if (info.state === "none") {
    return editable ? (
      <span className={cn("inline-flex items-center gap-1", cell ? "text-[11px]" : "text-sm")}>
        <Plus className={cell ? "h-3 w-3" : "h-3.5 w-3.5"} aria-hidden /> транш
      </span>
    ) : (
      <span className={cell ? "text-[12px]" : "text-sm"}>—</span>
    );
  }
  const paid = info.state === "paid";
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", cell ? "text-[12px]" : "text-sm")}>
      {info.amount !== null ? <span className="font-mono tabular-nums text-foreground/90">{money(info.amount)}</span> : null}
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-0.5 rounded px-1 font-medium leading-4",
          cell ? "text-[10.5px]" : "text-[11.5px]",
          paid ? "bg-success/15 text-success" : "bg-warning/15 text-warning"
        )}
      >
        {paid ? <Check className="h-3 w-3" aria-hidden /> : <Hourglass className="h-3 w-3" aria-hidden />}
        {paid && info.paidOn ? formatDayMonth(info.paidOn) : "ждём"}
      </span>
    </span>
  );
}

/**
 * Второй транш строки стола ОС — в ячейке «2-й транш» (`size="cell"`) и в
 * карточке строки (`size="card"`). С `onSet` — кнопка с окном правки, без —
 * только показ.
 */
export function OsTrancheCell({ info, onSet, size = "cell" }: { info: TrancheInfo; onSet?: TrancheSetter | null; size?: "cell" | "card" }) {
  const [open, setOpen] = useState(false);
  const cell = size === "cell";
  const title = trancheTitle(info);
  const face = <TrancheFace info={info} size={size} editable={Boolean(onSet)} />;
  if (!onSet) {
    return (
      <span className={cn("inline-flex min-w-0 items-center", info.state === "none" && "text-muted-foreground/60")} title={title}>
        {face}
      </span>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild {...swallow} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          data-os-tranche
          title={info.state === "none" ? "Второй транш — указать сумму" : `${title} — нажмите, чтобы изменить`}
          aria-label={info.state === "none" ? "Указать второй транш" : title}
          className={cn(
            "inline-flex max-w-full items-center rounded-md border",
            cell ? "min-h-6 px-1.5 [@media(pointer:coarse)]:min-h-8" : "min-h-11 px-2.5 sm:min-h-9",
            info.state === "none"
              ? "border-dashed border-border text-muted-foreground hover:border-primary/50 hover:text-primary"
              : "border-transparent hover:border-border hover:bg-accent"
          )}
        >
          {face}
        </button>
      </PopoverTrigger>
      {/* Клики внутри окна (портал) по дереву React дошли бы до ячейки. */}
      <PopoverContent
        align="start"
        className="w-72 p-3"
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <TrancheEditor info={info} onSet={onSet} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

/** Одной строкой для «Карточек» на телефоне: «транш 50 000 · ждём». */
export function OsTrancheInline({ info }: { info: TrancheInfo }) {
  if (info.state === "none") return null;
  const paid = info.state === "paid";
  return (
    <span className={cn("inline-flex items-center gap-1 font-mono tabular-nums", paid ? "text-success" : "text-warning")} title={trancheTitle(info)}>
      транш{info.amount !== null ? ` ${money(info.amount)}` : ""} · {paid && info.paidOn ? `✓ ${formatDayMonth(info.paidOn)}` : "ждём"}
    </span>
  );
}
