import { useState } from "react";
import { ArrowRight, Download, Pencil, Settings2 } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/utils/cn";
import { downloadCsv } from "@/utils/csv";
import { formatCurrency } from "@/utils/format";
import { useAnimatedNumber } from "@/hooks/useAnimatedNumber";
import { setPageMonthlyGoal } from "@/services/pageService";
import type { PageColumn, PageRow, WorkspacePage } from "@/types";

export function MyProgressCard({
  workspaceId,
  page,
  doneTotal,
  grandTotal,
  percent,
  rowCount,
  columns,
  rows,
  large,
  onCustomize,
}: {
  workspaceId: string;
  page: WorkspacePage;
  doneTotal: number;
  grandTotal: number;
  percent: number;
  rowCount: number;
  columns: PageColumn[];
  rows: PageRow[];
  large?: boolean;
  onCustomize?: () => void;
}) {
  const animatedDone = useAnimatedNumber(doneTotal);
  const animatedTotal = useAnimatedNumber(grandTotal);
  const animatedPercent = useAnimatedNumber(percent);

  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState(String(page.monthlyGoal ?? ""));
  const goal = page.monthlyGoal ?? 0;
  const goalPercent = goal > 0 ? Math.min(100, Math.round((doneTotal / goal) * 100)) : null;

  async function saveGoal() {
    const value = Number(goalInput);
    await setPageMonthlyGoal(workspaceId, page.id, Number.isFinite(value) && value > 0 ? value : null);
    setEditingGoal(false);
  }

  function handleExport() {
    const header = columns.map((c) => c.label);
    const lines = rows.map((row) => columns.map((c) => String(row.cells[c.key] ?? "")));
    downloadCsv(`${page.name}.csv`, header, lines);
  }

  return (
    <Card className="overflow-hidden rounded-2xl border-border bg-card">
      <CardContent className={large ? "p-6" : "p-5"}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow mb-1 text-primary">Мой стол</p>
            <Link
              to={`/page/${page.id}`}
              className={
                large
                  ? "truncate font-serif text-lg font-medium tracking-[-0.02em] hover:text-primary"
                  : "truncate text-sm font-medium hover:text-primary"
              }
            >
              {page.name}
            </Link>
            <p className="mt-0.5 text-xs text-muted-foreground">{rowCount} записей</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {onCustomize && (
              <Button variant="outline" size="sm" className="h-9 gap-1.5 rounded-full" onClick={onCustomize}>
                <Settings2 className="h-3.5 w-3.5" />
                Настроить стол
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-9 w-9" title="Скачать мой отчёт (CSV)" onClick={handleExport}>
              <Download className="h-3.5 w-3.5" />
            </Button>
            {large && (
              <Button asChild size="sm" className="h-9 rounded-full">
                <Link to={`/page/${page.id}`}>
                  Открыть лист <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            )}
          </div>
        </div>
        <div className="mb-2 flex items-end justify-between">
          <div>
            <p className="eyebrow">Готово</p>
            <p className={cn(large ? "text-2xl" : "text-xl", "display tabular text-success")}>{formatCurrency(animatedDone)}</p>
          </div>
          <div className="text-right">
            <p className="eyebrow">Общий</p>
            <p className={cn(large ? "text-2xl" : "text-xl", "display tabular")}>{formatCurrency(animatedTotal)}</p>
          </div>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-success transition-all"
            style={{ width: `${Math.min(100, animatedPercent)}%` }}
          />
        </div>
        <p className="mt-1.5 text-right text-xs font-medium text-muted-foreground">{Math.round(animatedPercent)}% готово</p>

        <div className="mt-4 rounded-xl border border-border bg-muted/30 p-3">
          <p className="eyebrow mb-2 text-primary">Моя цель</p>
          {editingGoal ? (
            <div className="flex items-center gap-2">
              <Input
                autoFocus
                type="number"
                value={goalInput}
                onChange={(e) => setGoalInput(e.target.value)}
                placeholder="Например, 200000"
                className="h-9"
                onKeyDown={(e) => e.code === "Enter" && void saveGoal()}
              />
              <Button size="sm" className="h-9 rounded-full" onClick={() => void saveGoal()}>
                Сохранить
              </Button>
            </div>
          ) : (
            <button
              type="button"
              className="flex w-full items-center justify-between text-left"
              onClick={() => {
                setGoalInput(String(page.monthlyGoal ?? ""));
                setEditingGoal(true);
              }}
            >
              {goal > 0 ? (
                <>
                  <span className="text-sm">
                    <span className="text-muted-foreground">На месяц: </span>
                    <span className="font-medium">{formatCurrency(goal)}</span>
                  </span>
                  <span className="flex items-center gap-1 text-xs font-medium text-primary">
                    {goalPercent}% <Pencil className="h-3 w-3" />
                  </span>
                </>
              ) : (
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
                  <Pencil className="h-3.5 w-3.5" /> Поставить свою цель на месяц
                </span>
              )}
            </button>
          )}
          {goal > 0 && !editingGoal && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${goalPercent}%` }} />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
