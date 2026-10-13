import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Archive, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NumberPicks, ORDER_FIELD_CLASS, OrderFormShell } from "@/components/table/OrderFormParts";
import { StatusBadge } from "@/components/table/StatusBadge";
import { splitOptionsByActivity } from "@/utils/columnOptions";
import { formatCurrency } from "@/utils/format";
import { parseOptionalNumber, type QuickOrderInput } from "@/utils/quickOrder";
import type { StatusOption } from "@/types";

const EMPTY: QuickOrderInput = {
  client: "",
  number: "",
  os: "",
  check: "",
  persons: "",
  minutes: "",
  note: "",
};

/** Те же частые значения, что чипами в визитке клиента. */
const PERSON_PICKS = [1, 2, 3, 4, 5, 6];
const MINUTE_PICKS = [1, 2, 3, 5, 10];

export function QuickOrderDialog({
  open,
  onOpenChange,
  onSubmit,
  osOptions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: QuickOrderInput) => Promise<void>;
  osOptions?: StatusOption[] | null;
}) {
  // Считаем по ПОЛНОМУ списку: если все ники увели в неактуальные, поле
  // обязано остаться выпадашкой. Иначе оно превратится в свободный ввод и
  // запишет в ячейку произвольный текст вместо значения варианта.
  const osSelect = Boolean(osOptions && osOptions.length > 0);
  const osSplit = splitOptionsByActivity(osOptions ?? []);
  const [showInactiveOs, setShowInactiveOs] = useState(false);
  const [form, setForm] = useState<QuickOrderInput>(EMPTY);
  const [saving, setSaving] = useState(false);
  const clientRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setForm(EMPTY);
      const t = window.setTimeout(() => clientRef.current?.focus(), 40);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  const client = form.client.trim();
  const checkNum = parseOptionalNumber(form.check);
  const canSave = Boolean(client && checkNum != null) && !saving;

  function setField<K extends keyof QuickOrderInput>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit() {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSubmit(form);
      setForm(EMPTY);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  // Enter («Далее» на клавиатуре телефона) — к следующему полю, а не
  // отправка недозаполненного заказа. На последнем — «В стол».
  function onKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    const target = e.target as HTMLElement;
    if (!(target instanceof HTMLInputElement)) return;
    const fields = [...e.currentTarget.querySelectorAll<HTMLInputElement>("input:not([type=hidden]):not([disabled])")];
    const next = fields[fields.indexOf(target) + 1];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  }

  return (
    <OrderFormShell
      open={open}
      onOpenChange={onOpenChange}
      title="Заказ"
      description="Ляжет в первую пустую строку стола."
      desktopClassName="max-w-sm gap-3 p-4"
      formClassName="gap-2.5"
      onSubmit={() => void submit()}
      onKeyDown={onKeyDown}
      footer={
        <>
          {!canSave && !saving && (
            // Кнопка выключена — пусть будет видно почему (на телефоне иначе «не нажимается»).
            <p className="text-[12px] text-muted-foreground">
              {!client && checkNum == null ? "Впишите клиента и сумму чека" : !client ? "Впишите клиента" : "Впишите сумму чека — только цифры"}
            </p>
          )}
          <Button type="submit" disabled={!canSave} className="h-9 w-full gap-1.5 sm:w-auto sm:self-end [@media(pointer:coarse)]:h-12">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            В стол
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="qo-client">
          Клиент <span className="text-primary">*</span>
        </Label>
        <Input
          id="qo-client"
          ref={clientRef}
          value={form.client}
          onChange={(e) => setField("client", e.target.value)}
          enterKeyHint="next"
          autoComplete="off"
          required
          className={ORDER_FIELD_CLASS}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="qo-number">Номер</Label>
          <Input
            id="qo-number"
            value={form.number}
            onChange={(e) => setField("number", e.target.value)}
            enterKeyHint="next"
            autoComplete="off"
            inputMode="tel"
            className={ORDER_FIELD_CLASS}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="qo-os">ОС</Label>
          {osSelect ? (
            <Select value={form.os || undefined} onValueChange={(v) => setField("os", v === "__clear__" ? "" : v)}>
              <SelectTrigger id="qo-os" className={ORDER_FIELD_CLASS}>
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                {(showInactiveOs ? [...osSplit.active, ...osSplit.inactive] : osSplit.active).map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className={opt.inactive ? "opacity-70" : undefined}>
                    <StatusBadge value={opt.value} options={osOptions!} showTick />
                  </SelectItem>
                ))}
                {osSplit.inactive.length > 0 && !showInactiveOs && (
                  <button
                    type="button"
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setShowInactiveOs(true);
                    }}
                    className="mt-1 flex w-full items-center gap-1.5 rounded-sm border-t border-border/60 px-2 pb-1 pt-2 text-left text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Archive className="h-3 w-3 shrink-0" /> Неактуальные ОС · {osSplit.inactive.length}
                  </button>
                )}
                <SelectItem value="__clear__" className="text-muted-foreground">
                  Очистить
                </SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <Input id="qo-os" value={form.os} onChange={(e) => setField("os", e.target.value)} autoComplete="off" className={ORDER_FIELD_CLASS} />
          )}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor="qo-check">
            Чек <span className="text-primary">*</span>
          </Label>
          {/* Длинное число проще проверить глазами с разрядами: «120 000 ₸». */}
          {checkNum != null && <span className="text-[12px] tabular-nums text-muted-foreground">{formatCurrency(checkNum)}</span>}
        </div>
        <Input
          id="qo-check"
          value={form.check}
          onChange={(e) => setField("check", e.target.value)}
          enterKeyHint="next"
          autoComplete="off"
          inputMode="numeric"
          required
          className={ORDER_FIELD_CLASS}
        />
      </div>
      <NumberPicks id="qo-persons" label="Персонажей" picks={PERSON_PICKS} value={form.persons} onChange={(v) => setField("persons", v)} />
      {/* Последнее поле цепочки Enter (пожелания — textarea, в неё не входят):
          Enter здесь записывает заказ, поэтому на клавиатуре «Готово», а не «Далее». */}
      <NumberPicks id="qo-minutes" label="Минут" picks={MINUTE_PICKS} value={form.minutes} onChange={(v) => setField("minutes", v)} enterKeyHint="done" />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="qo-note">Пожелания</Label>
        <Textarea
          id="qo-note"
          value={form.note}
          onChange={(e) => setField("note", e.target.value)}
          rows={2}
          placeholder="По желанию — попадёт в визитку клиента"
        />
      </div>
    </OrderFormShell>
  );
}
