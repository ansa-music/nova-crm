import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EMPTY_OS_DESK_ORDER, osDeskOrderMissing, type OsDeskOrderForm } from "@/utils/osDeskOrder";
import type { PaymentMethod } from "@/types";

/**
 * «Заказ» на столе ОС: все поля, которые ОС ведёт про продажу — имя, номер,
 * цена и апсейл со способами оплаты, ссылка, персонажи, минуты, дедлайн,
 * пожелания. Строка ложится в первый пустой слот «на утверждении»; «Итого»
 * стол считает сам. Enter ведёт к следующему полю.
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

  const payItems = (
    <>
      <SelectItem value="__none">Без способа</SelectItem>
      {activeMethods.map((m) => (
        <SelectItem key={m.id} value={m.id}>
          {m.label}
          {m.commissionPct ? ` −${String(m.commissionPct).replace(".", ",")}%` : ""}
        </SelectItem>
      ))}
    </>
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Новый заказ</DialogTitle>
          <DialogDescription>Ляжет в первую пустую строку «на утверждении». «Итого» стол посчитает сам.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onKeyDown={onKeyDown}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="oo-client">
                Имя <span className="text-primary">*</span>
              </Label>
              <Input id="oo-client" ref={clientRef} value={form.client} onChange={set("client")} enterKeyHint="next" autoComplete="off" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="oo-phone">Номер</Label>
              <Input id="oo-phone" value={form.phone} onChange={set("phone")} enterKeyHint="next" inputMode="tel" autoComplete="off" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="oo-price">Цена</Label>
              <Input id="oo-price" value={form.price} onChange={set("price")} enterKeyHint="next" inputMode="decimal" autoComplete="off" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Оплата цены</Label>
              <Select value={form.pricePay?.id ?? "__none"} onValueChange={setPay("pricePay")}>
                <SelectTrigger aria-label="Оплата цены">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>{payItems}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="oo-upsell">Апсейл</Label>
              <Input id="oo-upsell" value={form.upsell} onChange={set("upsell")} enterKeyHint="next" inputMode="decimal" autoComplete="off" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Оплата апсейла</Label>
              <Select value={form.upsellPay?.id ?? "__none"} onValueChange={setPay("upsellPay")}>
                <SelectTrigger aria-label="Оплата апсейла">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>{payItems}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="oo-link">AmoCRM ссылка</Label>
              <Input id="oo-link" value={form.link} onChange={set("link")} enterKeyHint="next" inputMode="url" autoComplete="off" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="oo-persons">Персонажей</Label>
              <Input id="oo-persons" value={form.persons} onChange={set("persons")} enterKeyHint="next" inputMode="numeric" autoComplete="off" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="oo-minutes">Минут</Label>
              <Input id="oo-minutes" value={form.minutes} onChange={set("minutes")} enterKeyHint="next" inputMode="numeric" autoComplete="off" />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="oo-deadline">Дедлайн сдачи</Label>
              <Input id="oo-deadline" type="date" value={form.deadline} onChange={set("deadline")} />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="oo-note">Пожелания</Label>
              <Textarea id="oo-note" value={form.note} onChange={set("note")} rows={2} placeholder="Попадёт в визитку клиента — её увидит технарь" />
            </div>
          </div>
          {missing && !saving ? <p className="text-[12.5px] text-muted-foreground">{missing}</p> : null}
          <Button type="submit" disabled={Boolean(missing) || saving} className="min-h-11 gap-1.5 sm:min-h-9">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            В стол
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
