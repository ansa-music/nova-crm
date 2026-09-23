import { useEffect, useMemo, useState } from "react";
import { CreditCard, Loader2, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { PaymentMethodsEditor } from "@/components/cashbox/PaymentMethodsEditor";
import { OsPaySettingsCard } from "@/components/cashbox/OsPaySettingsCard";
import { useWorkspace } from "@/hooks/useWorkspace";
import { updateTechBonuses } from "@/services/workspaceService";
import { firestoreErrorText } from "@/utils/dbError";
import { formatCurrency } from "@/utils/format";
import { parseLooseNumber } from "@/utils/numberInput";
import { techBonusesOf } from "@/utils/payment";

const PLACES = ["1-е место", "2-е место", "3-е место"];

/**
 * «Настройки → Касса» — только Owner (просьба Nurba 23.09.2026):
 * - способы оплаты заказов ОС и их комиссия — из них стол ОС считает «Итого»,
 *   которое уходит технарю как цена заказа;
 * - премии технарям за 1–3 место по сумме «Готово» за месяц — их показывает
 *   рейтинг на «Дашборде».
 */
export function CashboxSettingsPanel() {
  const { activeWorkspaceId, activeWorkspace } = useWorkspace();
  const saved = useMemo(() => techBonusesOf(activeWorkspace), [activeWorkspace]);
  const [bonuses, setBonuses] = useState<string[]>(() => saved.map(String));
  const [busy, setBusy] = useState(false);
  const savedKey = saved.join(",");
  useEffect(() => {
    setBonuses(saved.map(String));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const parsed = PLACES.map((_, i) => parseLooseNumber((bonuses[i] ?? "0").replace(/\s/g, "") || "0"));
  const invalid = parsed.some((n) => n === null || n < 0);
  const dirty = parsed.map((n) => Math.round(n ?? 0)).join(",") !== PLACES.map((_, i) => saved[i] ?? 0).join(",");

  async function saveBonuses() {
    if (!activeWorkspaceId || invalid) return;
    setBusy(true);
    try {
      await updateTechBonuses(activeWorkspaceId, parsed.map((n) => n ?? 0));
      toast.success("Премии сохранены");
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось сохранить премии"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-primary" />
            Способы оплаты
          </CardTitle>
          <CardDescription>
            На столе ОС у «Цены» и у «Апсейла» выбирается свой способ. Его комиссия вычитается из суммы, остаток — столбец
            «Итого» — уходит технарю как цена заказа и считается в его кассу. Комиссия запоминается в заказе в момент выбора:
            правка процента не меняет уже проданные заказы.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PaymentMethodsEditor />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-warning" />
            Премии технарям
          </CardTitle>
          <CardDescription>
            За места в рейтинге по сумме «Готово» за месяц. Видны всем на «Дашборде»: в текущем месяце — кто сейчас идёт на
            премию, сверху — итог прошлого месяца. 0 — премии за место нет.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid gap-2 sm:grid-cols-3">
            {PLACES.map((place, i) => (
              <label key={place} className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">{place}</span>
                <Input
                  value={bonuses[i] ?? ""}
                  onChange={(e) => setBonuses((prev) => PLACES.map((_, k) => (k === i ? e.target.value : prev[k] ?? "0")))}
                  inputMode="numeric"
                  className="h-10 tabular-nums"
                />
                <span className="text-[11px] text-muted-foreground">
                  {parsed[i] !== null && (parsed[i] ?? 0) > 0 ? `+${formatCurrency(parsed[i] ?? 0)} к зарплате` : "без премии"}
                </span>
              </label>
            ))}
          </div>
          <div className="flex justify-end">
            <Button type="button" className="gap-1.5" disabled={!dirty || invalid || busy} onClick={() => void saveBonuses()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Сохранить премии
            </Button>
          </div>
        </CardContent>
      </Card>

      <OsPaySettingsCard />
    </>
  );
}
