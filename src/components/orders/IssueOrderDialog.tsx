import { useEffect, useRef, useState } from "react";
import { Banknote, CalendarDays, Clock3, Link2, Loader2, Phone, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { parseOptionalNumber } from "@/utils/quickOrder";
import { isHttpUrl } from "@/utils/httpUrl";
import { cn } from "@/utils/cn";
import { WORK_ORDER_URGENCY_LABELS, type StatusOption, type WorkOrderUrgency } from "@/types";

export interface IssueOrderForm {
  client: string;
  phone: string;
  link: string;
  /** «YYYY-MM-DD» из поля даты; пусто — дедлайна нет. */
  deadline: string;
  urgency: WorkOrderUrgency;
  price: string;
  persons: string;
  minutes: string;
  note: string;
  osValue: string;
}

const EMPTY: IssueOrderForm = { client: "", phone: "", link: "", deadline: "", urgency: "normal", price: "", persons: "", minutes: "", note: "", osValue: "" };

const URGENCY_PICKS: Array<{ value: WorkOrderUrgency; tone: string }> = [
  { value: "normal", tone: "border-border text-muted-foreground" },
  { value: "urgent", tone: "border-amber-400/50 bg-amber-400/12 text-amber-200" },
  { value: "fire", tone: "border-destructive/50 bg-destructive/12 text-destructive" },
];
const PERSON_CHIPS = [1, 2, 3, 4, 5, 6];
const MINUTE_CHIPS = [1, 2, 3, 5, 10];

interface IssueOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Ник ОС самого выдающего, если он есть. Он подставляется по умолчанию и
   * стоит первым в списке, но список открыт всем: и ОС, и Тимлид могут
   * выставить заказ на любого ОС — просто свой ник в приоритете.
   */
  myOs: StatusOption | null;
  osOptions: StatusOption[];
  onSubmit: (form: IssueOrderForm) => Promise<void>;
}

/** «Выдать заказ» — те же поля, что попадут в строку стола технаря. */
export function IssueOrderDialog({ open, onOpenChange, myOs, osOptions, onSubmit }: IssueOrderDialogProps) {
  // Свой ник первым, остальные — как в общем списке «Ответственный».
  const orderedOs = myOs
    ? [myOs, ...osOptions.filter((o) => o.value !== myOs.value)]
    : osOptions;
  const [form, setForm] = useState<IssueOrderForm>(EMPTY);
  const [saving, setSaving] = useState(false);
  const clientRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setForm({ ...EMPTY, osValue: myOs?.value ?? "" });
    const t = window.setTimeout(() => clientRef.current?.focus(), 40);
    return () => window.clearTimeout(t);
  }, [open, myOs?.value]);

  const set = <K extends keyof IssueOrderForm>(key: K, value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  const personsNum = parseOptionalNumber(form.persons);
  const minutesNum = parseOptionalNumber(form.minutes);
  const personsBad = form.persons.trim() !== "" && personsNum == null;
  const minutesBad = form.minutes.trim() !== "" && minutesNum == null;
  const priceNum = parseOptionalNumber(form.price);
  const priceBad = form.price.trim() !== "" && priceNum == null;
  // Без схемы браузер считает адрес относительным и уводит внутрь CRM.
  const linkBad = form.link.trim() !== "" && !isHttpUrl(form.link);
  const needsOs = orderedOs.length > 0;
  const canSave = Boolean(form.client.trim()) && !personsBad && !minutesBad && !priceBad && (!needsOs || Boolean(form.osValue)) && !saving;

  async function handleSubmit() {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSubmit(form);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  const chip = (active: boolean) =>
    cn(
      "h-8 min-w-8 rounded-full border px-2.5 text-xs font-medium transition-colors",
      active ? "border-primary/50 bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Выдать заказ</DialogTitle>
          <DialogDescription>Технари увидят заказ на «Заказах» и смогут откликнуться.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="io-client">Имя клиента</Label>
            <Input id="io-client" ref={clientRef} value={form.client} onChange={(e) => set("client", e.target.value)} placeholder="Айгерим" autoComplete="off" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="io-phone" className="flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5 text-muted-foreground" /> Номер
              </Label>
              <Input id="io-phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+7 701 000 00 00" inputMode="tel" autoComplete="off" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="io-os">ОС</Label>
              {orderedOs.length > 0 ? (
                <Select value={form.osValue || undefined} onValueChange={(v) => set("osValue", v)}>
                  <SelectTrigger id="io-os">
                    <SelectValue placeholder="Кто ведёт клиента" />
                  </SelectTrigger>
                  <SelectContent>
                    {orderedOs.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                        {o.value === myOs?.value ? " · вы" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input id="io-os" value="—" disabled />
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="io-link" className="flex items-center gap-1.5">
                <Link2 className="h-3.5 w-3.5 text-muted-foreground" /> Ссылка на клиента
              </Label>
              <Input
                id="io-link"
                value={form.link}
                onChange={(e) => set("link", e.target.value)}
                className={cn(linkBad && "border-destructive")}
                placeholder="https://…"
                inputMode="url"
                autoComplete="off"
              />
              {linkBad && <p className="text-[11px] text-muted-foreground">Нужен полный адрес с https://</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="io-deadline" className="flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" /> Дедлайн сдачи
              </Label>
              <Input id="io-deadline" type="date" value={form.deadline} onChange={(e) => set("deadline", e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="io-price" className="flex items-center gap-1.5">
              <Banknote className="h-3.5 w-3.5 text-muted-foreground" /> Цена заказа
            </Label>
            <Input
              id="io-price"
              value={form.price}
              onChange={(e) => set("price", e.target.value)}
              className={cn(priceBad && "border-destructive")}
              inputMode="numeric"
              placeholder="60 000"
              autoComplete="off"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="io-persons" className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-muted-foreground" /> Персонажи
              </Label>
              <div className="flex flex-wrap items-center gap-1">
                {PERSON_CHIPS.map((n) => (
                  <button key={n} type="button" className={chip(personsNum === n)} onClick={() => set("persons", personsNum === n ? "" : String(n))}>
                    {n}
                  </button>
                ))}
                <Input id="io-persons" value={form.persons} onChange={(e) => set("persons", e.target.value)} className={cn("h-8 w-16 text-sm", personsBad && "border-destructive")} inputMode="numeric" placeholder="—" />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="io-minutes" className="flex items-center gap-1.5">
                <Clock3 className="h-3.5 w-3.5 text-muted-foreground" /> Минуты
              </Label>
              <div className="flex flex-wrap items-center gap-1">
                {MINUTE_CHIPS.map((n) => (
                  <button key={n} type="button" className={chip(minutesNum === n)} onClick={() => set("minutes", minutesNum === n ? "" : String(n))}>
                    {n}
                  </button>
                ))}
                <Input id="io-minutes" value={form.minutes} onChange={(e) => set("minutes", e.target.value)} className={cn("h-8 w-16 text-sm", minutesBad && "border-destructive")} inputMode="numeric" placeholder="—" />
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Срочность</Label>
            <div className="flex flex-wrap gap-1.5">
              {URGENCY_PICKS.map((pick) => {
                const active = form.urgency === pick.value;
                return (
                  <button
                    key={pick.value}
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, urgency: pick.value }))}
                    className={cn(
                      "h-8 rounded-full border px-3 text-xs font-medium transition-colors",
                      active ? pick.tone : "border-border text-muted-foreground hover:text-foreground",
                      active && pick.value === "normal" && "border-primary/50 bg-primary/12 text-primary"
                    )}
                  >
                    {WORK_ORDER_URGENCY_LABELS[pick.value]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="io-note">Пожелания</Label>
            <Textarea id="io-note" rows={2} value={form.note} onChange={(e) => set("note", e.target.value)} placeholder="Попадут в визитку клиента в столе" />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!canSave}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Выдать заказ
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
