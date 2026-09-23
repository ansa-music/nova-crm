import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Target, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { useWorkspace } from "@/hooks/useWorkspace";
import { updateOsPay } from "@/services/workspaceService";
import { firestoreErrorText } from "@/utils/dbError";
import { formatCurrency } from "@/utils/format";
import { parseLooseNumber } from "@/utils/numberInput";
import { osPayOf } from "@/utils/payment";

interface TierDraft {
  id: string;
  minPct: string;
  amount: string;
}

const num = (v: string) => parseLooseNumber(v.replace(/[\s%₸]/g, "") || "0");

/**
 * Система ОС на «ABS» — только Owner: процент от апсейла после комиссии,
 * доп. оклад лучшему по KPI, минимум заказов для KPI и пороги KPI с
 * фиксированным окладом (добавляются вариантами).
 */
export function OsPaySettingsCard() {
  const { activeWorkspaceId, activeWorkspace } = useWorkspace();
  const saved = useMemo(() => osPayOf(activeWorkspace), [activeWorkspace]);
  const [upsellPct, setUpsellPct] = useState("");
  const [topBonus, setTopBonus] = useState("");
  const [minOrders, setMinOrders] = useState("");
  const [tiers, setTiers] = useState<TierDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const savedKey = JSON.stringify(saved);
  const reset = () => {
    setUpsellPct(String(saved.upsellPct).replace(".", ","));
    setTopBonus(String(saved.kpiTopBonus));
    setMinOrders(String(saved.kpiMinOrders));
    setTiers(saved.kpiTiers.map((t) => ({ id: t.id, minPct: String(t.minPct).replace(".", ","), amount: String(t.amount) })));
  };
  useEffect(reset, [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const pct = num(upsellPct);
  const bonus = num(topBonus);
  const min = num(minOrders);
  const tierVals = tiers.map((t) => ({ id: t.id, minPct: num(t.minPct), amount: num(t.amount) }));
  const invalid =
    pct === null || pct < 0 || pct > 100 || bonus === null || bonus < 0 || min === null || min < 0 ||
    tierVals.some((t) => t.minPct === null || t.minPct < 0 || t.minPct > 100 || t.amount === null || t.amount <= 0);

  async function save() {
    if (!activeWorkspaceId || invalid) return;
    setBusy(true);
    try {
      await updateOsPay(activeWorkspaceId, {
        upsellPct: pct ?? 0,
        kpiTopBonus: bonus ?? 0,
        kpiMinOrders: min ?? 0,
        kpiTiers: tierVals.map((t) => ({ id: t.id, minPct: t.minPct ?? 0, amount: t.amount ?? 0 })),
      });
      toast.success("Система ОС сохранена");
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось сохранить систему ОС"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          ABS: зарплата ОС
        </CardTitle>
        <CardDescription>
          KPI ОС — доля его заказов месяца в «Готово». На странице «ABS система» по этим правилам считаются доплаты каждому ОС.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">% от апсейла (после комиссии)</span>
            <Input value={upsellPct} onChange={(e) => setUpsellPct(e.target.value)} inputMode="decimal" className="h-10 tabular-nums" aria-label="Процент от апсейла" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Доп. оклад за 1-е место по KPI</span>
            <Input value={topBonus} onChange={(e) => setTopBonus(e.target.value)} inputMode="numeric" className="h-10 tabular-nums" aria-label="Доп. оклад за топ KPI" />
            <span className="text-[11px] text-muted-foreground">{bonus ? formatCurrency(bonus) : "0 — не платится"}</span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">KPI считается от, заказов</span>
            <Input value={minOrders} onChange={(e) => setMinOrders(e.target.value)} inputMode="numeric" className="h-10 tabular-nums" aria-label="Минимум заказов для KPI" />
            <span className="text-[11px] text-muted-foreground">чтобы 1 заказ не давал 100 %</span>
          </label>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Фикс. оклад за порог KPI</p>
          <p className="text-xs text-muted-foreground">Берётся самый высокий добитый порог. Например: от 60 % — 30 000, от 80 % — 60 000.</p>
          {tiers.length === 0 ? <p className="text-xs text-muted-foreground">Порогов пока нет.</p> : null}
          <ul className="flex flex-col gap-2">
            {tiers.map((t, i) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-2">
                <span className="text-sm text-muted-foreground">KPI от</span>
                <Input
                  value={t.minPct}
                  onChange={(e) => setTiers((prev) => prev.map((x, k) => (k === i ? { ...x, minPct: e.target.value } : x)))}
                  inputMode="decimal"
                  className="h-10 w-20 text-right tabular-nums"
                  aria-label="Порог KPI, %"
                />
                <span className="text-sm text-muted-foreground">% → оклад</span>
                <Input
                  value={t.amount}
                  onChange={(e) => setTiers((prev) => prev.map((x, k) => (k === i ? { ...x, amount: e.target.value } : x)))}
                  inputMode="numeric"
                  className="h-10 w-32 tabular-nums"
                  aria-label="Оклад за порог"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="ml-auto h-10 w-10 text-muted-foreground hover:text-destructive"
                  aria-label="Убрать порог"
                  onClick={() => setTiers((prev) => prev.filter((_, k) => k !== i))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            variant="outline"
            className="gap-1.5 self-start"
            onClick={() => setTiers((prev) => [...prev, { id: `tier_${Date.now().toString(36)}`, minPct: "", amount: "" }])}
          >
            <Plus className="h-4 w-4" />
            Добавить порог
          </Button>
        </div>

        {invalid ? <p className="text-xs text-destructive">Проценты — от 0 до 100, суммы порогов — больше нуля.</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={reset} disabled={busy}>
            Сбросить
          </Button>
          <Button type="button" className="gap-1.5" onClick={() => void save()} disabled={busy || invalid}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Сохранить систему ОС
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
