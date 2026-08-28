import { useEffect, useMemo, useState } from "react";
import { Trash2, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/sonner";
import {
  addPersonalFinanceEntry,
  deletePersonalFinanceEntry,
  subscribeToPersonalFinance,
  type PersonalFinanceEntry,
} from "@/services/personalSpaceService";
import { parseFinanceInput, type FinanceType } from "@/utils/financeParser";
import { formatDate } from "@/utils/date";
import { cn } from "@/utils/cn";

interface FinanceTabProps {
  workspaceId: string;
  pageId: string;
  uid: string;
}

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatMinor(minor: number): string {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "KZT", maximumFractionDigits: 0 }).format(
    minor / 100
  );
}

export function FinanceTab({ workspaceId, pageId, uid }: FinanceTabProps) {
  const [entries, setEntries] = useState<PersonalFinanceEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [type, setType] = useState<FinanceType>("expense");
  const month = currentMonthKey();

  useEffect(
    () => subscribeToPersonalFinance(workspaceId, pageId, uid, setEntries),
    [workspaceId, pageId, uid]
  );

  const monthEntries = useMemo(() => entries.filter((e) => e.month === month), [entries, month]);
  const { income, expense, balance } = useMemo(() => {
    let income = 0;
    let expense = 0;
    monthEntries.forEach((e) => (e.type === "income" ? (income += e.amountMinor) : (expense += e.amountMinor)));
    return { income, expense, balance: income - expense };
  }, [monthEntries]);

  const overallBalance = useMemo(() => {
    let total = 0;
    entries.forEach((e) => (total += e.type === "income" ? e.amountMinor : -e.amountMinor));
    return total;
  }, [entries]);

  async function handleAdd() {
    const parsed = parseFinanceInput(draft, type);
    if (!parsed.valid) {
      toast.error("Не удалось распознать сумму — начните с числа, например «2000 еда»");
      return;
    }
    try {
      await addPersonalFinanceEntry(workspaceId, pageId, {
        uid,
        pageId,
        month,
        type: parsed.type,
        amountMinor: parsed.amountMinor,
        category: parsed.category,
        description: parsed.description,
      });
      setDraft("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить запись");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-4">
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Wallet className="h-3 w-3" /> Всего у вас есть
          </p>
          <p className="mt-1 text-2xl font-bold">{formatMinor(overallBalance)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Сумма всех доходов минус расходы за всё время</p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-2">
        <Card>
          <CardContent className="p-3">
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <TrendingUp className="h-3 w-3" /> Доход
            </p>
            <p className="mt-1 text-sm font-semibold text-success">{formatMinor(income)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <TrendingDown className="h-3 w-3" /> Расход
            </p>
            <p className="mt-1 text-sm font-semibold text-destructive">{formatMinor(expense)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Wallet className="h-3 w-3" /> Баланс за месяц
            </p>
            <p className="mt-1 text-sm font-semibold">{formatMinor(balance)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
        <div className="flex gap-1.5">
          <button
            onClick={() => setType("expense")}
            className={cn(
              "flex-1 rounded-lg py-1.5 text-sm font-medium transition-colors",
              type === "expense" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"
            )}
          >
            Расход
          </button>
          <button
            onClick={() => setType("income")}
            className={cn(
              "flex-1 rounded-lg py-1.5 text-sm font-medium transition-colors",
              type === "income" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
            )}
          >
            Доход
          </button>
        </div>
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="2000 еда"
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            className="flex-1"
          />
          <Button onClick={handleAdd} disabled={!draft.trim()}>
            Добавить
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {monthEntries.map((e) => (
          <div key={e.id} className="flex items-center gap-2 rounded-lg border border-border p-2.5">
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                e.type === "income" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
              )}
            >
              {e.category}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{e.description || e.category}</p>
              <p className="text-xs text-muted-foreground">{formatDate(e.createdAt, "d MMM, HH:mm")}</p>
            </div>
            <span className={cn("shrink-0 text-sm font-medium", e.type === "income" ? "text-success" : "text-destructive")}>
              {e.type === "income" ? "+" : "−"} {formatMinor(e.amountMinor)}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Удалить запись"
              className="h-7 w-7 shrink-0 text-muted-foreground"
              onClick={() => deletePersonalFinanceEntry(workspaceId, pageId, uid, e.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        {monthEntries.length === 0 && (
          <p className="py-6 text-center text-xs text-muted-foreground">Записей за этот месяц пока нет</p>
        )}
      </div>
    </div>
  );
}
