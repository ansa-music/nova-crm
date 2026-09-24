import { useState, type ReactNode } from "react";
import { ArrowDownToLine, CalendarDays, Check, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/utils/cn";
import {
  almatyDay,
  dateInputValue,
  formatDayMonth,
  formatFullDate,
  OS_DATE_TITLES,
  parseDateInput,
  slotShown,
  type OsDateSlot,
} from "@/utils/osDates";

export interface OsDatesInfo {
  received: OsDateSlot;
  issued: OsDateSlot;
  /** Ник технаря — для подсказки. */
  techName?: string;
  /** Заказ сейчас на «Заказах» (ещё без технаря): open — ждёт откликов, assigned — отдан, едет. */
  exchange?: { status: "open" | "assigned" } | null;
}

/** Ставит дату строки (полдень дня по Алматы) или стирает её (`null`). Нет — только показ. */
export type OsDateSetter = (slot: OsDateSlot, value: number | null) => void;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Нажатие по кнопке даты не должно выделять ячейку и открывать её правку. */
const swallow = {
  onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
  onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
  onDoubleClick: (e: React.MouseEvent) => e.stopPropagation(),
};

/** Окно выбора дня: рекомендуемая дата крупно, «Сегодня/Вчера», календарь, «Стереть». */
function DatePickBody({ slot, onPick }: { slot: OsDateSlot; onPick: (value: number | null) => void }) {
  // Поле даты — ЧЕРНОВИК: браузер шлёт `input` на каждую цифру (день «15»
  // после «1» уже 2026-09-01), и запись по onChange сохраняла не тот день,
  // закрывала окно, а следующая цифра уходила в выбранную ячейку таблицы.
  // Пишем только по «Поставить» или Enter. Окно при каждом открытии
  // монтируется заново, так что черновик всегда свежий.
  const [draft, setDraft] = useState(() => dateInputValue(slot.value ?? slot.suggested));
  const draftMs = parseDateInput(draft);
  const canSetDraft = draftMs !== null && draftMs !== slot.value;
  const today = almatyDay(Date.now());
  const showSuggested = Boolean(slot.suggested && slot.suggested !== slot.value);
  // «Сегодня/Вчера» есть всегда; прячем только тот, что совпал с крупной
  // кнопкой рекомендуемой даты, — две кнопки с одной датой путают.
  const quick = [
    { label: "Сегодня", value: today },
    { label: "Вчера", value: almatyDay(today - DAY_MS) },
  ].filter((q) => !(showSuggested && q.value === slot.suggested));
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium">{OS_DATE_TITLES[slot.kind]}</p>
      {showSuggested && slot.suggested ? (
        <Button size="sm" className="min-h-11 justify-start gap-2 sm:min-h-9" onClick={() => onPick(slot.suggested)}>
          <Check className="h-4 w-4" />
          Поставить {formatDayMonth(slot.suggested)}
          <span className="ml-auto text-[11px] font-normal opacity-80">рекомендуем</span>
        </Button>
      ) : null}
      <div className="flex gap-1.5">
        {quick.map((q) => (
          <Button
            key={q.label}
            size="sm"
            variant="outline"
            className={cn("min-h-11 flex-1 sm:min-h-8", slot.value === q.value && "border-primary/40 bg-primary/12 text-primary")}
            aria-pressed={slot.value === q.value}
            onClick={() => onPick(q.value)}
          >
            {q.label}
          </Button>
        ))}
      </div>
      <div className="flex gap-1.5">
        <Input
          type="date"
          aria-label={OS_DATE_TITLES[slot.kind]}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSetDraft && draftMs !== null) {
              e.preventDefault();
              onPick(draftMs);
            }
          }}
        />
        <Button size="sm" className="min-h-11 shrink-0 sm:min-h-9" disabled={!canSetDraft} onClick={() => draftMs !== null && onPick(draftMs)}>
          Поставить
        </Button>
      </div>
      {slot.value ? (
        <Button size="sm" variant="ghost" className="min-h-11 justify-start gap-2 text-muted-foreground sm:min-h-8" onClick={() => onPick(null)}>
          <X className="h-3.5 w-3.5" /> Стереть дату
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Одна дата заказа как кнопка:
 * - поставлена ОС — обычный текст, нажатие открывает выбор дня;
 * - не поставлена, но есть рекомендация — ПУНКТИРНАЯ кнопка с этой датой:
 *   одно нажатие записывает её (просьба Nurba: «заполняют сами, рекомендовано —
 *   по кнопке»); поменять потом — нажать на поставленную;
 * - рекомендовать нечего — `empty` (подпись) и выбор дня по нажатию.
 * Без `onSet` (чужой стол, только чтение) — просто показ.
 */
export function OsDateButton({
  slot,
  icon,
  empty,
  emptyClassName,
  onSet,
  size = "cell",
  title,
}: {
  slot: OsDateSlot;
  icon: ReactNode;
  /** Что показать, когда даты нет и рекомендовать нечего («не выдан»). */
  empty: ReactNode;
  emptyClassName?: string;
  onSet?: OsDateSetter;
  /** `cell` — крошечная строка в ячейке; `card` — строка карточки (тач-размер). */
  size?: "cell" | "card";
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const cell = size === "cell";
  const shown = slotShown(slot);
  const label = shown ? formatDayMonth(shown) : null;
  const confirmed = slot.value !== null;
  const hint =
    title ??
    (confirmed
      ? `${OS_DATE_TITLES[slot.kind]}: ${formatFullDate(slot.value!)}`
      : slot.suggested
        ? `Рекомендуем ${formatFullDate(slot.suggested)} — нажмите, чтобы поставить`
        : `${OS_DATE_TITLES[slot.kind]} не поставлена`);
  const base = cn(
    "inline-flex max-w-full items-center gap-1 whitespace-nowrap font-mono tabular-nums",
    cell
      ? // На таче — 24 px (две кнопки + зазор = 50 px в строке от 52 px): 15 px пальцем не попасть.
        "h-[15px] rounded-[4px] px-1 text-[10.5px] leading-none [@media(pointer:coarse)]:h-6 [@media(pointer:coarse)]:px-1.5 [@media(pointer:coarse)]:text-xs"
      : "min-h-11 rounded-md px-2.5 text-sm sm:min-h-8"
  );
  const look = confirmed
    ? cn("border border-transparent text-foreground/90", onSet && "hover:border-border hover:bg-accent")
    : slot.suggested
      ? "border border-dashed border-primary/45 text-primary/90 hover:border-primary hover:bg-primary/10"
      : cn("border border-transparent text-muted-foreground/70", onSet && "hover:border-border hover:bg-accent", emptyClassName);
  const content = (
    <>
      {icon}
      {label ?? empty}
    </>
  );

  if (!onSet) {
    const readHint =
      title ??
      (confirmed
        ? `${OS_DATE_TITLES[slot.kind]}: ${formatFullDate(slot.value!)}`
        : shown
          ? `${OS_DATE_TITLES[slot.kind]}: ${formatFullDate(shown)} — рекомендуемая, ОС ещё не поставил`
          : `${OS_DATE_TITLES[slot.kind]} не поставлена`);
    return (
      <span
        className={cn(base, confirmed ? "text-foreground/90" : shown ? "text-muted-foreground" : cn("text-muted-foreground/70", emptyClassName))}
        title={readHint}
      >
        {content}
      </span>
    );
  }

  // Не поставлена, есть рекомендация — одно нажатие ставит её.
  if (!confirmed && slot.suggested) {
    return (
      <button
        type="button"
        data-os-date
        className={cn(base, look)}
        title={hint}
        aria-label={`${OS_DATE_TITLES[slot.kind]}: поставить ${formatFullDate(slot.suggested)}`}
        {...swallow}
        onClick={(e) => {
          e.stopPropagation();
          onSet(slot, slot.suggested);
        }}
      >
        {content}
      </button>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild {...swallow} onClick={(e) => e.stopPropagation()}>
        <button type="button" data-os-date className={cn(base, look)} title={hint} aria-label={hint}>
          {content}
        </button>
      </PopoverTrigger>
      {/* Клик и двойной клик внутри окна по дереву React (портал) дошли бы
          до ячейки таблицы и открыли бы в ней редактор. */}
      <PopoverContent
        align="start"
        className="w-64 p-3"
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <DatePickBody
          slot={slot}
          onPick={(value) => {
            onSet(slot, value);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Столбец «Даты» стола ОС: две крошечные строки моноширинным — «получен» и
 * «выдан», ТОЛЬКО ДАТА. Поставленная ОС — обычным текстом, рекомендуемая —
 * пунктирной кнопкой (одно нажатие записывает). Узко (≈92 px) и сразу за
 * именем, поэтому видно без прокрутки.
 */
export function OsDatesCell({ info, onSet }: { info: OsDatesInfo; onSet?: OsDateSetter }) {
  const { received, issued, exchange } = info;
  // Состояние выдачи («не выдан», «ждём отклики», «едет») показывает ячейка
  // «Технарь» — здесь только дата, без дубля: пока её нет, «—».
  return (
    <span className="flex min-w-0 flex-col items-start justify-center gap-px [@media(pointer:coarse)]:gap-0.5">
      <OsDateButton slot={received} icon={<ArrowDownToLine className="h-2.5 w-2.5 shrink-0 opacity-70" aria-hidden />} empty="—" onSet={onSet} />
      <OsDateButton
        slot={issued}
        icon={<Send className={cn("h-2.5 w-2.5 shrink-0", issued.value ? "text-success" : "opacity-60")} aria-hidden />}
        empty="—"
        onSet={onSet}
        title={
          !slotShown(issued)
            ? exchange
              ? exchange.status === "assigned"
                ? "Отдан с «Заказов» — едет в стол технаря"
                : "На «Заказах» — ждёт откликов"
              : "Технарю ещё не выдан"
            : undefined
        }
      />
    </span>
  );
}

/** Та же пара дат в одну строку — для «Карточек» на телефоне (только показ). */
export function OsDatesInline({ info }: { info: OsDatesInfo }) {
  const { received, issued } = info;
  const r = slotShown(received);
  const i = slotShown(issued);
  // Состояние выдачи — в подвале карточки («Технарь»), здесь только даты.
  if (!r && !i) return null;
  const tone = (slot: OsDateSlot) => (slot.value ? "text-foreground/85" : "opacity-70");
  return (
    <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
      {r ? (
        <span className={cn("inline-flex items-center gap-0.5", tone(received))} title={`Получен ${formatFullDate(r)}${received.value ? "" : " (рекомендуемая)"}`}>
          <ArrowDownToLine className="h-3 w-3 opacity-70" aria-hidden />
          {formatDayMonth(r)}
        </span>
      ) : null}
      {i ? (
        <span className={cn("inline-flex items-center gap-0.5", tone(issued))} title={`Выдан ${formatFullDate(i)}${issued.value ? "" : " (рекомендуемая)"}`}>
          <Send className="h-3 w-3 text-success" aria-hidden />
          {formatDayMonth(i)}
        </span>
      ) : null}
    </span>
  );
}

/** Дата апсейла в ячейке «Апсейл» (после чипа способа оплаты). Пустой апсейл — ничего. */
export function OsUpsellDate({ slot, hasUpsell, onSet }: { slot: OsDateSlot; hasUpsell: boolean; onSet?: OsDateSetter }) {
  if (!hasUpsell) return null;
  if (!slotShown(slot) && !onSet) return null;
  return (
    <OsDateButton
      slot={slot}
      icon={null}
      empty={<CalendarDays className="h-3 w-3" aria-label="Дата апсейла" />}
      onSet={onSet}
      title={!slotShown(slot) ? "Дата апсейла — нажмите, чтобы поставить" : undefined}
    />
  );
}
