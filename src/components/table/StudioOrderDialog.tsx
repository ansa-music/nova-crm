import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { STUDIO_CUSTOM_FIELDS, STUDIO_PAY_BANK_FIELD_ID, STUDIO_WORK_TYPE_FIELD_ID } from "@/config/studio";
import { isOptionColumn } from "@/utils/columnOptions";
import { parseLooseNumber } from "@/utils/numberInput";
import { findStudioOrderColumns, studioOrderCells, studioOrderExtras, type StudioOrderForm, type StudioOrderTargets } from "@/utils/quickOrder";
import type { RowExtras } from "@/utils/rowExtras";
import { cn } from "@/utils/cn";
import type { PageColumn, StatusOption } from "@/types";

const EMPTY: StudioOrderForm = {
  client: "",
  contact: "",
  workType: "",
  topic: "",
  subject: "",
  deadline: "",
  amount: "",
  prepaid: "",
  payBank: "",
  note: "",
};

/** Варианты столбца DataTable кладёт в `statusOptions` (getColumnOptions) — форма workspace не читает. */
const optionsOf = (column: PageColumn): StatusOption[] => column.statusOptions ?? [];

/**
 * Чипы выбора: у столбца-списка — его варианты (пишется значение), у
 * текстового — варианты пресета студии (пишется подпись). Неактуальные не
 * предлагаем. Пусто — поле не показываем: писать было бы нечего.
 */
function choicesFor(column: PageColumn | undefined, fieldId: string): StatusOption[] {
  if (!column) return [];
  const options = isOptionColumn(column.type) ? optionsOf(column) : (STUDIO_CUSTOM_FIELDS.find((f) => f.id === fieldId)?.options ?? []);
  return options.filter((o) => !o.inactive);
}

/** Числовое поле с числовым столбцом: ввод должен разобраться, иначе в ячейку лёг бы текст. */
function numberBad(column: PageColumn | undefined, raw: string): boolean {
  if (!column || !raw.trim()) return false;
  if (column.type !== "number" && column.type !== "currency") return false;
  return parseLooseNumber(raw) == null;
}

interface StudioOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Все столбцы таблицы в порядке схемы (и скрытые), с вариантами в `statusOptions`. */
  columns: PageColumn[];
  /**
   * Ключ столбца → значение в формате ячейки, и визитка строки: срок, если
   * у стола нет столбца срока (`studioOrderExtras`), иначе null. Отказ —
   * форма остаётся открытой с введённым.
   */
  onSave: (cells: Record<string, string>, extras: RowExtras | null) => Promise<void>;
}

/**
 * «+ Заказ» на столе NOVA Studio (вместо «Быстрого заказа» Nova — без ОС,
 * персонажей и минут). Поля — те, что команда записывает про учебную
 * работу; столбцы подбираются по ключам шаблона студии, иначе по названию
 * (`findStudioOrderColumns`), поле без столбца не показывается — кроме
 * дедлайна: без столбца срока он ляжет в визитку строки. «Дата заказа» —
 * сегодня, статус — «Новый». Enter ведёт к следующему полю; на телефоне —
 * нижняя шторка, чипы и поля 44px.
 */
export function StudioOrderDialog({ open, onOpenChange, columns, onSave }: StudioOrderDialogProps) {
  const mobile = useIsMobile();
  const targets: StudioOrderTargets = useMemo(() => findStudioOrderColumns(columns), [columns]);
  const workTypes = useMemo(() => choicesFor(targets.workType, STUDIO_WORK_TYPE_FIELD_ID), [targets.workType]);
  const banks = useMemo(() => choicesFor(targets.payBank, STUDIO_PAY_BANK_FIELD_ID), [targets.payBank]);
  const [form, setForm] = useState<StudioOrderForm>(EMPTY);
  const [saving, setSaving] = useState(false);
  const clientRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY);
    const t = window.setTimeout(() => clientRef.current?.focus(), 40);
    return () => window.clearTimeout(t);
  }, [open]);

  const set = <K extends keyof StudioOrderForm>(key: K, value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  const client = form.client.trim();
  const amountBad = numberBad(targets.amount, form.amount);
  const prepaidBad = numberBad(targets.prepaid, form.prepaid);
  const canSave = Boolean(client) && !amountBad && !prepaidBad && !saving;

  async function submit() {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave(studioOrderCells(columns, form, { now: Date.now(), optionsOf }), studioOrderExtras(columns, form));
      onOpenChange(false);
    } catch {
      // Отказ уже показал тот, кто пишет строку (тостом); введённое остаётся в форме.
    } finally {
      setSaving(false);
    }
  }

  /** Enter («Далее» на клавиатуре телефона) — к следующему полю, а не отправка недозаполненного заказа. */
  function onKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    const target = e.target as HTMLElement;
    if (!(target instanceof HTMLInputElement)) return;
    const fields = [...e.currentTarget.querySelectorAll<HTMLElement>("input:not([type=hidden]):not([disabled]), textarea:not([disabled])")];
    const next = fields[fields.indexOf(target) + 1];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  }

  const labelOf = (field: keyof StudioOrderTargets, fallback: string) => targets[field]?.label ?? fallback;
  const inputClass = "[@media(pointer:coarse)]:h-11";

  const body = (
    <form
      className="grid gap-3"
      onKeyDown={onKeyDown}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field id="so-client" label={<>{labelOf("client", "Клиент")} <span className="text-primary">*</span></>}>
        <Input
          id="so-client"
          ref={clientRef}
          value={form.client}
          onChange={(e) => set("client", e.target.value)}
          placeholder="Айгерим"
          enterKeyHint="next"
          autoComplete="off"
          className={inputClass}
          required
        />
      </Field>
      {targets.contact && (
        <Field id="so-contact" label={labelOf("contact", "Телефон / Telegram")}>
          <Input
            id="so-contact"
            value={form.contact}
            onChange={(e) => set("contact", e.target.value)}
            placeholder="+7 701 000 00 00 или @username"
            enterKeyHint="next"
            autoComplete="off"
            className={inputClass}
          />
        </Field>
      )}
      {workTypes.length > 0 && (
        <ChoiceChips
          label={labelOf("workType", "Тип работы")}
          options={workTypes}
          value={form.workType}
          onChange={(label) => set("workType", label)}
          disabled={saving}
        />
      )}
      {targets.topic && (
        <Field id="so-topic" label={labelOf("topic", "Тема")}>
          <Input
            id="so-topic"
            value={form.topic}
            onChange={(e) => set("topic", e.target.value)}
            placeholder="Инфляция в Казахстане"
            enterKeyHint="next"
            autoComplete="off"
            className={inputClass}
          />
        </Field>
      )}
      {/* Дедлайн — всегда: нет столбца срока — он уходит в визитку строки. */}
      <div className="grid grid-cols-2 gap-2">
        {targets.subject && (
          <Field id="so-subject" label={labelOf("subject", "Предмет")}>
            <Input
              id="so-subject"
              value={form.subject}
              onChange={(e) => set("subject", e.target.value)}
              placeholder="Экономика"
              enterKeyHint="next"
              autoComplete="off"
              className={inputClass}
            />
          </Field>
        )}
        <Field id="so-deadline" label={labelOf("deadline", "Дедлайн")}>
          <Input
            id="so-deadline"
            type="date"
            value={form.deadline}
            onChange={(e) => set("deadline", e.target.value)}
            enterKeyHint="next"
            className={inputClass}
          />
        </Field>
      </div>
      {(targets.amount || targets.prepaid) && (
        <div className="grid grid-cols-2 gap-2">
          {targets.amount && (
            <Field id="so-amount" label={labelOf("amount", "Сумма")}>
              <Input
                id="so-amount"
                value={form.amount}
                onChange={(e) => set("amount", e.target.value)}
                placeholder="15 000"
                inputMode="numeric"
                enterKeyHint="next"
                autoComplete="off"
                className={cn(inputClass, amountBad && "border-destructive")}
              />
            </Field>
          )}
          {targets.prepaid && (
            <Field id="so-prepaid" label={labelOf("prepaid", "Предоплата")}>
              <Input
                id="so-prepaid"
                value={form.prepaid}
                onChange={(e) => set("prepaid", e.target.value)}
                placeholder="5 000"
                inputMode="numeric"
                enterKeyHint="next"
                autoComplete="off"
                className={cn(inputClass, prepaidBad && "border-destructive")}
              />
            </Field>
          )}
        </div>
      )}
      {banks.length > 0 && (
        <ChoiceChips
          label={labelOf("payBank", "Оплата")}
          options={banks}
          value={form.payBank}
          onChange={(label) => set("payBank", label)}
          disabled={saving}
        />
      )}
      {targets.note && (
        <Field id="so-note" label={labelOf("note", "Комментарий")}>
          <Textarea
            id="so-note"
            rows={2}
            value={form.note}
            onChange={(e) => set("note", e.target.value)}
            placeholder="Объём, оформление, оригинальность"
          />
        </Field>
      )}
      {!canSave && !saving && (
        // Кнопка выключена — пусть будет видно почему (на телефоне иначе «не нажимается»).
        <p className="text-[12px] text-muted-foreground">{!client ? "Впишите клиента" : "Сумму — только цифрами"}</p>
      )}
      <DialogFooter className="mt-1">
        <Button type="submit" disabled={!canSave} className="h-9 [@media(pointer:coarse)]:h-11">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          В стол
        </Button>
      </DialogFooter>
    </form>
  );

  const description = "Ляжет строкой в стол: дата заказа — сегодня, статус — «Новый».";

  if (mobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="flex flex-col gap-3">
          <SheetHeader className="pr-10">
            <SheetTitle>Новый заказ</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          {body}
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-3 p-5">
        <DialogHeader>
          <DialogTitle>Новый заказ</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}

function Field({ id, label, children }: { id: string; label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

/** Выбор одного варианта чипами (не выпадашкой): повторное нажатие снимает выбор. Значение — ПОДПИСЬ варианта. */
function ChoiceChips({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: StatusOption[];
  value: string;
  onChange: (label: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium leading-none">{label}</span>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
        {options.map((o) => {
          const on = value === o.label;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => onChange(on ? "" : o.label)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition-colors disabled:opacity-60 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:px-3.5",
                on ? "border-primary/50 bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: `hsl(${o.color})` }} />
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
