import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NumberPicks, OptionChips, ORDER_FIELD_CLASS, orderChipClass, OrderFormShell } from "@/components/table/OrderFormParts";
import { ymdInTimeZone } from "@/utils/date";
import { formatCurrency } from "@/utils/format";
import { parseLooseNumber } from "@/utils/numberInput";
import { EMPTY_OS_DESK_ORDER, osDeskOrderMissing, type OsDeskOrderForm } from "@/utils/osDeskOrder";
import { addDays } from "@/utils/scheduleWeek";
import type { PaymentMethod } from "@/types";

const PERSON_PICKS = [1, 2, 3, 4, 5, 6];
const MINUTE_PICKS = [1, 2, 3, 5, 10];
/** Срок одним касанием: через сколько дней сдача. */
const DEADLINE_PICKS = [
  { days: 0, label: "Сегодня" },
  { days: 1, label: "Завтра" },
  { days: 3, label: "+3 дня" },
  { days: 7, label: "Неделя" },
];
const NO_METHOD = "__none";

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * «Заказ» на столе ОС: все поля, которые ОС ведёт про продажу — имя, номер,
 * цена и апсейл со способами оплаты, ссылка, персонажи, минуты, дедлайн,
 * пожелания. Строка ложится в первый пустой слот «на утверждении»; «Итого»
 * стол считает сам. Enter ведёт к следующему полю.
 *
 * С 14.10.2026 (жалоба Nurba на телефон): способ оплаты, персонажи, минуты и
 * срок — чипами в одно касание; в подвале — «Итого» с учётом комиссии, каким
 * его посчитает стол (то же правило, что `osRowTotal`).
 */
export function OsDeskOrderDialog({
  open,
  onOpenChange,
  methods,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  methods: readonly PaymentMethod[];
  /** Отказ — форма остаётся открытой с введённым. */
  onSave: (form: OsDeskOrderForm) => Promise<void>;
}) {
  const [form, setForm] = useState<OsDeskOrderForm>(EMPTY_OS_DESK_ORDER);
  const [saving, setSaving] = useState(false);
  const clientRef = useRef<HTMLInputElement>(null);
  const activeMethods = methods.filter((m) => !m.inactive);

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY_OS_DESK_ORDER);
    const t = window.setTimeout(() => clientRef.current?.focus(), 40);
    return () => window.clearTimeout(t);
  }, [open]);

  const set = (key: "client" | "phone" | "price" | "upsell" | "link" | "persons" | "minutes" | "deadline" | "note") =>
    (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const setValue = (key: "persons" | "minutes" | "deadline") => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const setPay = (key: "pricePay" | "upsellPay") => (id: string) =>
    setForm((f) => ({ ...f, [key]: methods.find((m) => m.id === id) ?? null }));
  const missing = osDeskOrderMissing(form);

  async function submit() {
    if (missing || saving) return;
    setSaving(true);
    try {
      await onSave(form);
      onOpenChange(false);
    } catch {
      // Отказ уже показал тот, кто пишет строку (тостом); введённое остаётся в форме.
    } finally {
      setSaving(false);
    }
  }

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

  const payOptions = [
    { value: NO_METHOD, label: "Без способа" },
    ...activeMethods.map((m) => ({
      value: m.id,
      label: `${m.label}${m.commissionPct ? ` −${String(m.commissionPct).replace(".", ",")}%` : ""}`,
    })),
  ];

  // «Итого», каким его посчитает стол: (цена − комиссия) + (апсейл − комиссия).
  const priceNum = parseLooseNumber(form.price) ?? 0;
  const upsellNum = parseLooseNumber(form.upsell) ?? 0;
  const gross = priceNum + upsellNum;
  const net = round2(
    priceNum * (1 - (form.pricePay?.commissionPct ?? 0) / 100) + upsellNum * (1 - (form.upsellPay?.commissionPct ?? 0) / 100)
  );
  const fees = round2(gross - net);
  // Дни прибавляем к календарной дате компании, а не миллисекундами: в поясе
  // с переводом часов сутки бывают длиннее 24 ч, и «Завтра» дало бы сегодня.
  const todayYmd = ymdInTimeZone(Date.now());

  return (
    <OrderFormShell
      open={open}
      onOpenChange={(v) => !saving && onOpenChange(v)}
      title="Новый заказ"
      description="Ляжет в первую пустую строку «на утверждении». «Итого» стол посчитает сам."
      desktopClassName="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
      onSubmit={() => void submit()}
      onKeyDown={onKeyDown}
      footer={
        <>
          {gross > 0 && !missing ? (
            <p className="flex flex-wrap items-baseline gap-x-2 text-sm" data-os-order-total>
              <span className="text-muted-foreground">Итого</span>
              <span className="font-semibold tabular-nums">{formatCurrency(net)}</span>
              {fees > 0 ? <span className="text-[12px] text-muted-foreground">комиссия −{formatCurrency(fees)}</span> : null}
            </p>
          ) : null}
          {missing && !saving ? <p className="text-[12.5px] text-muted-foreground">{missing}</p> : null}
          <Button type="submit" disabled={Boolean(missing) || saving} className="h-9 w-full gap-1.5 [@media(pointer:coarse)]:h-12">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            В стол
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="oo-client">
            Имя <span className="text-primary">*</span>
          </Label>
          <Input id="oo-client" ref={clientRef} value={form.client} onChange={set("client")} enterKeyHint="next" autoComplete="off" className={ORDER_FIELD_CLASS} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="oo-phone">Номер</Label>
          <Input id="oo-phone" value={form.phone} onChange={set("phone")} enterKeyHint="next" inputMode="tel" autoComplete="off" className={ORDER_FIELD_CLASS} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="oo-price">Цена</Label>
          <Input id="oo-price" value={form.price} onChange={set("price")} enterKeyHint="next" inputMode="decimal" autoComplete="off" className={ORDER_FIELD_CLASS} />
        </div>
        <OptionChips label="Оплата цены" options={payOptions} value={form.pricePay?.id ?? NO_METHOD} onChange={setPay("pricePay")} />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="oo-upsell">Апсейл</Label>
          <Input id="oo-upsell" value={form.upsell} onChange={set("upsell")} enterKeyHint="next" inputMode="decimal" autoComplete="off" className={ORDER_FIELD_CLASS} />
        </div>
        <OptionChips label="Оплата апсейла" options={payOptions} value={form.upsellPay?.id ?? NO_METHOD} onChange={setPay("upsellPay")} />
        <NumberPicks id="oo-persons" label="Персонажей" picks={PERSON_PICKS} value={form.persons} onChange={setValue("persons")} className="sm:col-span-2" />
        <NumberPicks id="oo-minutes" label="Минут" picks={MINUTE_PICKS} value={form.minutes} onChange={setValue("minutes")} className="sm:col-span-2" />
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="oo-deadline">Дедлайн сдачи</Label>
          <div className="flex flex-wrap items-center gap-1.5">
            {DEADLINE_PICKS.map((pick) => {
              const ymd = addDays(todayYmd, pick.days);
              const on = form.deadline === ymd;
              return (
                <button key={pick.days} type="button" aria-pressed={on} className={orderChipClass(on)} onClick={() => setValue("deadline")(on ? "" : ymd)}>
                  {pick.label}
                </button>
              );
            })}
            <Input id="oo-deadline" type="date" value={form.deadline} onChange={set("deadline")} className={`${ORDER_FIELD_CLASS} w-auto min-w-[9.5rem] flex-1 [@media(pointer:coarse)]:h-11`} />
          </div>
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="oo-link">AmoCRM ссылка</Label>
          <Input id="oo-link" value={form.link} onChange={set("link")} enterKeyHint="next" inputMode="url" autoComplete="off" className={ORDER_FIELD_CLASS} />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="oo-note">Пожелания</Label>
          <Textarea id="oo-note" value={form.note} onChange={set("note")} rows={2} placeholder="Попадёт в визитку клиента — её увидит технарь" />
        </div>
      </div>
    </OrderFormShell>
  );
}
