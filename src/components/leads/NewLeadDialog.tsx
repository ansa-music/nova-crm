import { useEffect, useState, type FormEvent } from "react";
import { Loader2, UserPlus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { addLead, type NewLeadInput } from "@/services/leadBoardService";
import { firestoreErrorText } from "@/utils/dbError";
import { parseDateInput } from "@/utils/osDates";
import { personLabel } from "@/utils/peopleDesks";
import type { StatusOption, WorkspaceMember, WorkspacePage } from "@/types";

const EMPTY = { client: "", phone: "", price: "", upsell: "", link: "", note: "", persons: "", minutes: "", deadline: "" };

/**
 * «+ Клиент» в «Общей таблице»: Тимлид+ заводит нового клиента и сразу
 * назначает ОС. Строка ложится на стол ОС «на утверждении», ОС — уведомление
 * «Тимлид дал вам новый лид»; дальше ОС дополняет и выдаёт технарю, как свой
 * заказ.
 */
export function NewLeadDialog({
  open,
  onOpenChange,
  workspaceId,
  osMembers,
  osDesks,
  statusOptions,
  fromUid,
  fromName,
  defaultOsUid,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  osMembers: readonly WorkspaceMember[];
  osDesks: readonly WorkspacePage[];
  statusOptions: readonly StatusOption[];
  fromUid: string;
  fromName: string;
  defaultOsUid?: string | null;
  onCreated: () => void;
}) {
  const [form, setForm] = useState(EMPTY);
  const [osUid, setOsUid] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY);
    setOsUid(defaultOsUid && osMembers.some((m) => m.uid === defaultOsUid) ? defaultOsUid : "");
  }, [open, defaultOsUid, osMembers]);

  const set = (key: keyof typeof EMPTY) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const missing = !form.client.trim() ? "Впишите имя клиента" : !osUid ? "Выберите ОС" : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (missing || busy) return;
    const os = osMembers.find((m) => m.uid === osUid);
    if (!os) return;
    setBusy(true);
    const lead: NewLeadInput = {
      client: form.client,
      phone: form.phone,
      price: form.price,
      upsell: form.upsell,
      link: form.link,
      note: form.note,
      persons: Number(form.persons) || null,
      minutes: Number(form.minutes) || null,
      deadline: form.deadline ? parseDateInput(form.deadline) : null,
    };
    try {
      await addLead({ workspaceId, os, osDesks, lead, statusOptions, fromUid, fromName });
      toast.success(`${form.client.trim()} — у ОС ${personLabel(os)}`, { description: "ОС получил уведомление о новом лиде" });
      onCreated();
      onOpenChange(false);
    } catch (err) {
      toast.error("Клиент не добавлен", { description: firestoreErrorText(err, "Попробуйте ещё раз") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Новый клиент</DialogTitle>
          <DialogDescription>Ляжет строкой на стол выбранного ОС «на утверждении». ОС получит уведомление.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="lead-client">Имя *</Label>
              <Input id="lead-client" value={form.client} onChange={set("client")} autoFocus autoComplete="off" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lead-phone">Номер</Label>
              <Input id="lead-phone" value={form.phone} onChange={set("phone")} inputMode="tel" autoComplete="off" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>ОС *</Label>
              <Select value={osUid} onValueChange={setOsUid}>
                <SelectTrigger aria-label="ОС">
                  <SelectValue placeholder="Кому отдать" />
                </SelectTrigger>
                <SelectContent>
                  {osMembers.map((m) => (
                    <SelectItem key={m.uid} value={m.uid}>
                      {personLabel(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lead-price">Цена</Label>
              <Input id="lead-price" value={form.price} onChange={set("price")} inputMode="decimal" autoComplete="off" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lead-upsell">Апсейл</Label>
              <Input id="lead-upsell" value={form.upsell} onChange={set("upsell")} inputMode="decimal" autoComplete="off" />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="lead-link">AmoCRM ссылка</Label>
              <Input id="lead-link" value={form.link} onChange={set("link")} inputMode="url" autoComplete="off" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lead-persons">Персонажей</Label>
              <Input id="lead-persons" value={form.persons} onChange={set("persons")} inputMode="numeric" autoComplete="off" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lead-minutes">Минут</Label>
              <Input id="lead-minutes" value={form.minutes} onChange={set("minutes")} inputMode="numeric" autoComplete="off" />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="lead-deadline">Дедлайн сдачи</Label>
              <Input id="lead-deadline" type="date" value={form.deadline} onChange={set("deadline")} />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="lead-note">Пожелания</Label>
              <Textarea id="lead-note" value={form.note} onChange={set("note")} rows={2} />
            </div>
          </div>
          {missing ? <p className="text-[12.5px] text-muted-foreground">{missing}</p> : null}
          <Button type="submit" disabled={Boolean(missing) || busy} className="min-h-11 gap-1.5 sm:min-h-9">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Отдать ОС
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
