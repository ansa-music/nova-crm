import { useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { useWorkspace } from "@/hooks/useWorkspace";
import { updatePaymentMethods } from "@/services/workspaceService";
import { cn } from "@/utils/cn";
import { firestoreErrorText } from "@/utils/dbError";
import { formatFee, paymentMethodsOf, sanitizePaymentMethods } from "@/utils/payment";
import { parseLooseNumber } from "@/utils/numberInput";
import type { PaymentMethod } from "@/types";

const SWATCHES = ["#f14635", "#7c5cff", "#22a06b", "#f5a623", "#1e88e5", "#e91e63", "#607d8b"];

interface Draft {
  id: string;
  label: string;
  pct: string;
  color?: string;
  inactive?: boolean;
  /** Способ заведён в этом окне — удалить можно без вопросов. */
  fresh?: boolean;
}

function toDraft(m: PaymentMethod): Draft {
  return { id: m.id, label: m.label, pct: String(m.commissionPct).replace(".", ","), color: m.color, inactive: m.inactive };
}

/**
 * Способы оплаты кассы ОС — правит только Owner. Способ, по которому уже
 * есть заказы, лучше уводить в «неактуальные», а не удалять: у старых строк
 * останется только id, и в чипе вместо «Lavatop» будет «lavatop».
 * Комиссия записывается в строку в момент выбора способа, поэтому новая
 * цифра действует на заказы, где способ выберут после сохранения.
 */
export function PaymentMethodsEditor({ onSaved }: { onSaved?: () => void }) {
  const { activeWorkspaceId, activeWorkspace } = useWorkspace();
  const saved = useMemo(() => paymentMethodsOf(activeWorkspace), [activeWorkspace]);
  const [drafts, setDrafts] = useState<Draft[]>(() => saved.map(toDraft));
  const [busy, setBusy] = useState(false);
  const savedKey = JSON.stringify(saved);
  useEffect(() => {
    setDrafts(saved.map(toDraft));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const parsed = drafts.map((d) => ({ d, pct: parseLooseNumber(d.pct.replace("%", "").trim() || "0") }));
  const invalid = parsed.some(({ d, pct }) => !d.label.trim() || pct === null || pct < 0 || pct > 100);
  const dirty = JSON.stringify(drafts.map((d) => ({ ...d, fresh: undefined }))) !== JSON.stringify(saved.map(toDraft));

  function patch(index: number, next: Partial<Draft>) {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...next } : d)));
  }

  async function save() {
    if (!activeWorkspaceId || invalid) return;
    setBusy(true);
    try {
      const list: PaymentMethod[] = parsed.map(({ d, pct }) => ({
        id: d.id,
        label: d.label,
        commissionPct: pct ?? 0,
        ...(d.color ? { color: d.color } : {}),
        ...(d.inactive ? { inactive: true } : {}),
      }));
      await updatePaymentMethods(activeWorkspaceId, sanitizePaymentMethods(list));
      toast.success("Способы оплаты сохранены", { description: "Новая комиссия действует на заказы, где способ выберут после этого." });
      onSaved?.();
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось сохранить способы оплаты"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {drafts.map((d, i) => {
          const pct = parsed[i]?.pct;
          const bad = !d.label.trim() || pct === null || (pct ?? 0) < 0 || (pct ?? 0) > 100;
          return (
            <li
              key={d.id}
              className={cn(
                "flex flex-wrap items-center gap-2 rounded-xl border border-border p-2",
                d.inactive && "opacity-60",
                bad && "border-destructive/50"
              )}
            >
              <div className="flex shrink-0 gap-1" role="radiogroup" aria-label="Цвет">
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Цвет ${c}`}
                    aria-checked={d.color === c}
                    role="radio"
                    onClick={() => patch(i, { color: c })}
                    className={cn("h-5 w-5 rounded-full ring-offset-2 ring-offset-background", d.color === c && "ring-2 ring-primary")}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <Input
                value={d.label}
                onChange={(e) => patch(i, { label: e.target.value })}
                placeholder="Название (Kaspi, Lavatop…)"
                maxLength={40}
                className="h-10 min-w-0 flex-1 basis-40"
                aria-label="Название способа"
              />
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">комиссия</span>
                <Input
                  value={d.pct}
                  onChange={(e) => patch(i, { pct: e.target.value })}
                  inputMode="decimal"
                  className="h-10 w-16 text-right tabular-nums"
                  aria-label="Комиссия, %"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
              <span className="w-24 text-xs text-muted-foreground">{pct !== null && !bad ? formatFee(pct) : "0–100 %"}</span>
              <div className="ml-auto flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10"
                  title={d.inactive ? "Вернуть в выбор" : "В неактуальные — не предлагать при выборе"}
                  onClick={() => patch(i, { inactive: !d.inactive })}
                >
                  {d.inactive ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 text-muted-foreground hover:text-destructive"
                  title={d.fresh ? "Убрать" : "Удалить — у старых заказов останется только его код; лучше «в неактуальные»"}
                  onClick={() => setDrafts((prev) => prev.filter((_, k) => k !== i))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="gap-1.5"
          onClick={() =>
            setDrafts((prev) => [
              ...prev,
              { id: `pm_${Date.now().toString(36)}`, label: "", pct: "0", color: SWATCHES[prev.length % SWATCHES.length], fresh: true },
            ])
          }
        >
          <Plus className="h-4 w-4" />
          Добавить способ
        </Button>
        <Button type="button" className="ml-auto gap-1.5" disabled={!dirty || invalid || busy} onClick={() => void save()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Сохранить
        </Button>
      </div>
      {invalid ? <p className="text-xs text-destructive">У каждого способа нужно название и комиссия от 0 до 100 %.</p> : null}
    </div>
  );
}
