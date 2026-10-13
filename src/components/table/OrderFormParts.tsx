import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { cn } from "@/utils/cn";

/**
 * Общие части форм «Заказ» (стол технаря) и «Новый заказ» (стол ОС).
 *
 * Жалоба Nurba 14.10.2026: «мобильный интерфейс — сделай удобным для
 * заполнения». На телефоне обе формы были окном по центру с полями 36 px, а у
 * ОС — одиннадцать полей столбиком, и «В стол» уезжала за прокрутку. Теперь на
 * телефоне форма — лист снизу: шапка и кнопка записи закреплены, прокручиваются
 * только поля; поля — под палец; числа, которые почти всегда одни и те же
 * (персонажи, минуты), способ оплаты и срок ставятся одним касанием.
 */

/** Высота поля формы: на таче — под палец (шрифт 16 px там даёт index.css). */
export const ORDER_FIELD_CLASS = "h-9 [@media(pointer:coarse)]:h-12";

/** Чип-вариант: число, способ оплаты, срок. На таче — 44 px. */
export function orderChipClass(active: boolean): string {
  return cn(
    // На таче 44 px в высоту и 40 в ширину: шесть чипов «1…6» и поле «другое»
    // помещаются в одну строку телефона 375 px.
    "inline-flex h-9 min-w-9 shrink-0 items-center justify-center rounded-lg border px-3 text-sm font-medium tabular-nums transition-colors [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-w-10",
    active
      ? "border-primary/40 bg-primary/12 text-primary"
      : "border-border bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
  );
}

/**
 * Оболочка формы заказа. Телефон — лист снизу с закреплёнными шапкой и
 * подвалом (клавиатуру учитывает `.nova-sheet-bottom` в index.css). Компьютер —
 * прежнее окно: поля и подвал идут одним столбцом.
 */
export function OrderFormShell({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  onSubmit,
  onKeyDown,
  desktopClassName,
  formClassName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** Поля формы. */
  children: ReactNode;
  /** Подсказка «чего не хватает» и кнопка записи: на телефоне приклеены к низу листа. */
  footer: ReactNode;
  onSubmit: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLFormElement>) => void;
  /** Классы окна на компьютере (ширина, отступы). */
  desktopClassName?: string;
  /** Классы столбца полей на компьютере. */
  formClassName?: string;
}) {
  const mobile = useIsMobile();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  if (mobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" hideClose hideHandle className="flex max-h-[94dvh] flex-col gap-0 p-0">
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit} onKeyDown={onKeyDown}>
            <SheetHeader className="shrink-0 gap-0 border-b border-border px-4 pb-3 pt-2">
              <div aria-hidden className="mx-auto mb-2 h-1 w-9 rounded-sm bg-foreground/20" />
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <SheetTitle>{title}</SheetTitle>
                  <SheetDescription className="mt-0.5 text-[12px] leading-snug">{description}</SheetDescription>
                </div>
                <SheetClose asChild>
                  <Button type="button" variant="ghost" size="icon" aria-label="Закрыть" className="-mr-2 -mt-1 shrink-0">
                    <X className="h-4 w-4" />
                  </Button>
                </SheetClose>
              </div>
            </SheetHeader>
            <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto overscroll-contain px-4 py-3">{children}</div>
            <div className="flex shrink-0 flex-col gap-2 border-t border-border bg-background px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3">
              {footer}
            </div>
          </form>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={desktopClassName}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form className={cn("flex flex-col gap-3", formClassName)} onSubmit={submit} onKeyDown={onKeyDown}>
          {children}
          {footer}
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Число чипами: частые значения — одним касанием, остальное — в поле «другое».
 * Чип и поле показывают одно и то же значение; повторное касание чипа снимает.
 */
export function NumberPicks({
  id,
  label,
  picks,
  value,
  onChange,
  inputMode = "numeric",
  enterKeyHint = "next",
  className,
}: {
  id: string;
  label: string;
  picks: readonly number[];
  value: string;
  onChange: (next: string) => void;
  inputMode?: "numeric" | "decimal";
  /** «done» — у последнего поля формы: Enter на нём отправляет заказ. */
  enterKeyHint?: "next" | "done";
  className?: string;
}) {
  const current = value.trim();
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex flex-wrap items-center gap-1.5">
        {picks.map((n) => {
          const on = current === String(n);
          return (
            <button key={n} type="button" aria-pressed={on} className={orderChipClass(on)} onClick={() => onChange(on ? "" : String(n))}>
              {n}
            </button>
          );
        })}
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode={inputMode}
          enterKeyHint={enterKeyHint}
          autoComplete="off"
          placeholder="другое"
          className={cn(ORDER_FIELD_CLASS, "w-24 min-w-16 flex-1 basis-16 px-2.5 [@media(pointer:coarse)]:h-11")}
        />
      </div>
    </div>
  );
}

/** Один вариант из нескольких чипами (способ оплаты). */
export function OptionChips({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-sm font-medium leading-none">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-1.5">
        {options.map((option) => {
          const on = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={on}
              className={orderChipClass(on)}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
