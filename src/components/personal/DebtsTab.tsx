import { useEffect, useMemo, useState } from "react";
import { Check, Plus, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/sonner";
import {
  addPersonalDebt,
  deletePersonalDebt,
  setPersonalDebtPaid,
  subscribeToPersonalDebts,
  type PersonalDebt,
} from "@/services/personalSpaceService";
import { parseAmount } from "@/utils/money";
import { formatDate } from "@/utils/date";
import { cn } from "@/utils/cn";
import { confirmDialog } from "@/utils/appDialog";

interface DebtsTabProps {
  workspaceId: string;
  pageId: string;
  uid: string;
}

function formatMinor(minor: number): string {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "KZT", maximumFractionDigits: 0 }).format(
    minor / 100
  );
}

export function DebtsTab({ workspaceId, pageId, uid }: DebtsTabProps) {
  const [debts, setDebts] = useState<PersonalDebt[]>([]);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => subscribeToPersonalDebts(workspaceId, pageId, uid, setDebts), [workspaceId, pageId, uid]);

  const unpaid = useMemo(() => debts.filter((d) => !d.paid), [debts]);
  const paid = useMemo(() => debts.filter((d) => d.paid), [debts]);
  const totalOwed = useMemo(() => unpaid.reduce((sum, d) => sum + d.amountMinor, 0), [unpaid]);

  async function handleAdd() {
    const major = parseAmount(amount);
    if (!name.trim()) {
      toast.error("Укажите имя");
      return;
    }
    if (!Number.isFinite(major) || major <= 0) {
      toast.error("Укажите сумму");
      return;
    }
    try {
      await addPersonalDebt(workspaceId, pageId, uid, {
        personName: name.trim(),
        amountMinor: Math.round(major * 100),
        note,
      });
      setName("");
      setAmount("");
      setNote("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось добавить долг");
    }
  }

  async function handleDelete(debt: PersonalDebt) {
    if (!(await confirmDialog({ title: `Удалить запись «${debt.personName}»?`, destructive: true }))) return;
    await deletePersonalDebt(workspaceId, pageId, uid, debt.id);
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Всего мне должны</p>
          <p className="mt-1 text-2xl font-bold">{formatMinor(totalOwed)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {unpaid.length === 0 ? "Непогашенных долгов нет" : `Неоплачено записей: ${unpaid.length}`}
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Кто должен (имя)" className="flex-1" />
          <Input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Сумма"
            inputMode="decimal"
            className="sm:w-32"
          />
        </div>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="За что (необязательно)" />
        <Button onClick={handleAdd} disabled={!name.trim() || !amount.trim()} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Добавить долг
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        {unpaid.map((d) => (
          <div key={d.id} className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 p-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{d.personName}</p>
              {d.note && <p className="truncate text-xs text-muted-foreground">{d.note}</p>}
              <p className="text-xs text-muted-foreground">{formatDate(d.createdAt, "d MMM yyyy")}</p>
            </div>
            <span className="shrink-0 text-sm font-semibold text-warning">
              {formatMinor(d.amountMinor)}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 shrink-0 gap-1 text-xs"
              onClick={() => setPersonalDebtPaid(workspaceId, pageId, uid, d.id, true)}
            >
              <Check className="h-3 w-3" /> Оплатил
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Удалить долг"
              className="h-7 w-7 shrink-0 text-muted-foreground"
              onClick={() => handleDelete(d)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        {unpaid.length === 0 && paid.length === 0 && (
          <p className="py-6 text-center text-xs text-muted-foreground">Долгов пока нет</p>
        )}
      </div>

      {paid.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Оплачено</p>
          {paid.map((d) => (
            <div key={d.id} className="flex items-center gap-2 rounded-lg border border-border p-2.5 opacity-60">
              <div className="min-w-0 flex-1">
                <p className={cn("truncate text-sm line-through")}>{d.personName}</p>
                <p className="text-xs text-muted-foreground">
                  {d.paidAt ? `Оплачено ${formatDate(d.paidAt, "d MMM yyyy")}` : ""}
                </p>
              </div>
              <span className="shrink-0 text-sm">{formatMinor(d.amountMinor)}</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 shrink-0 gap-1 text-xs"
                onClick={() => setPersonalDebtPaid(workspaceId, pageId, uid, d.id, false)}
              >
                <Undo2 className="h-3 w-3" /> Вернуть
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Удалить долг"
                className="h-7 w-7 shrink-0 text-muted-foreground"
                onClick={() => handleDelete(d)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
