import { useEffect, useMemo, useState } from "react";
import { CalendarRange, Loader2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";
import { useWorkspace } from "@/hooks/useWorkspace";
import { currentMonthKey, nextMonthKey } from "@/services/monthTabService";
import { updatePeriods } from "@/services/workspaceService";
import { cn } from "@/utils/cn";
import { firestoreErrorText } from "@/utils/dbError";
import {
  currentPeriodKey,
  isHalfMonth,
  nextPeriodKey,
  periodLabel,
  periodRange,
  periodsOf,
  PERIOD_SPLIT_MAX,
  PERIOD_SPLIT_MIN,
  sanitizePeriods,
  type PeriodSettings,
} from "@/utils/periods";

const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

/** «1 октября 2026» из ключа месяца. */
function firstDayLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return `1 ${MONTHS_GEN[month - 1] ?? ""} ${year}`;
}

/**
 * «Настройки → Периоды» (Owner): столы технарей ведутся по целым месяцам
 * или по двум половинам месяца (просьба Nurba 26.09.2026). Модель — в
 * utils/periods.ts. Включить половины можно только со СЛЕДУЮЩЕГО месяца
 * (текущий не трогаем: его строки уже лежат в целой вкладке), выключить —
 * тоже со следующего (`until`), чтобы текущий месяц доработал половинами.
 * День раздела заперт, пока половины идут: старые ключи «-1/-2» иначе
 * перечитались бы по-другому.
 */
export function PeriodsSettingsPanel() {
  const { activeWorkspace, activeWorkspaceId } = useWorkspace();
  const saved = periodsOf(activeWorkspace);
  const [draft, setDraft] = useState<PeriodSettings>(saved);
  const [saving, setSaving] = useState(false);
  const savedKey = JSON.stringify(saved);

  useEffect(() => {
    setDraft((prev) => (JSON.stringify(prev) === savedKey ? prev : JSON.parse(savedKey)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const month = currentMonthKey();
  const nextMonth = nextMonthKey(month);
  // Половины уже идут (по сохранённой настройке) — от начала и дня раздела
  // нельзя отступать: вкладки и счётчики этого месяца уже под ними.
  const runningNow = isHalfMonth(month, saved);
  // Переключатель: половины включены и не выключаются раньше следующего месяца.
  const halvesOn = draft.from !== "" && (draft.until === "" || draft.until > month);
  const changed = JSON.stringify(sanitizePeriods(draft)) !== savedKey;

  const preview = useMemo(() => {
    const clean = sanitizePeriods(draft);
    const now = currentPeriodKey(clean);
    const next = nextPeriodKey(now, clean);
    return { now: periodLabel(now, clean), next: periodLabel(next, clean), after: periodLabel(nextPeriodKey(next, clean), clean) };
  }, [draft]);

  function toggle(on: boolean) {
    if (on) {
      setDraft((prev) => ({ ...prev, from: prev.from && prev.from > month ? prev.from : nextMonth, until: "" }));
      return;
    }
    // Идут — доработать текущий месяц половинами и выключить со следующего;
    // ещё не начались — просто снять.
    setDraft((prev) => (runningNow ? { ...prev, until: nextMonth } : { ...prev, from: "", until: "" }));
  }

  async function save() {
    if (!activeWorkspaceId || saving) return;
    setSaving(true);
    try {
      await updatePeriods(activeWorkspaceId, draft);
      toast.success("Периоды сохранены");
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось сохранить"));
    } finally {
      setSaving(false);
    }
  }

  const splitFirstLast = periodRange(`${nextMonth}-2`, { ...draft, from: nextMonth, until: "" });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarRange className="h-4 w-4 text-primary" /> Периоды столов
        </CardTitle>
        <CardDescription>
          Столы технарей ведутся по периодам: целый месяц или две половины. По периодам считаются вкладки столов, «Технари»,
          дашборд, премии, оценки заказов и «ABS система». График смен всегда по календарным месяцам.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-wrap gap-1 rounded-lg border border-border p-0.5" role="tablist" aria-label="Период">
          {[
            { on: false, label: "Целый месяц" },
            { on: true, label: "Две половины месяца" },
          ].map((opt) => (
            <button
              key={String(opt.on)}
              type="button"
              role="tab"
              aria-selected={halvesOn === opt.on}
              onClick={() => toggle(opt.on)}
              className={cn(
                "min-h-9 flex-1 rounded-md px-3 text-sm font-medium transition-colors",
                halvesOn === opt.on ? "bg-primary/12 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {halvesOn && (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">День раздела</span>
              <Input
                type="number"
                min={PERIOD_SPLIT_MIN}
                max={PERIOD_SPLIT_MAX}
                value={draft.splitDay}
                disabled={runningNow}
                onChange={(e) => setDraft((prev) => ({ ...prev, splitDay: Number(e.target.value) }))}
                className="h-9 max-w-[8rem]"
              />
              <span className="text-xs text-muted-foreground">
                Первая половина — с 1-го по {sanitizePeriods(draft).splitDay}-е, вторая — с {sanitizePeriods(draft).splitDay + 1}-го до конца месяца.
                {runningNow ? " Пока половины идут, день раздела не меняется." : ""}
              </span>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Начиная с месяца</span>
              <Input
                type="month"
                min={nextMonth}
                value={draft.from || nextMonth}
                disabled={runningNow}
                onChange={(e) => setDraft((prev) => ({ ...prev, from: e.target.value && e.target.value >= nextMonth ? e.target.value : nextMonth }))}
                className="h-9 max-w-[12rem]"
              />
              <span className="text-xs text-muted-foreground">
                Раньше следующего месяца нельзя: текущий месяц остаётся целым, история не меняется.
              </span>
            </label>
          </div>
        )}

        {draft.from && draft.until && draft.until > month && (
          <Alert tone="info" title={`Половины выключатся с ${firstDayLabel(draft.until)}`}>
            Текущий месяц дорабатывается половинами.{" "}
            <button type="button" className="underline underline-offset-2" onClick={() => setDraft((prev) => ({ ...prev, until: "" }))}>
              Оставить включёнными
            </button>
          </Alert>
        )}

        {halvesOn && draft.from && draft.from > month && (
          <Alert tone="warning" title={`Вступит в силу с ${firstDayLabel(draft.from)}`}>
            С этого дня у каждого стола технаря появится вкладка «1–{sanitizePeriods(draft).splitDay}», а {sanitizePeriods(draft).splitDay + 1}-го —
            «{splitFirstLast.dayFrom}–{splitFirstLast.dayTo}». Вкладки прошлых месяцев не трогаются; счётчики, оценки и премии считаются по каждой
            половине отдельно.
          </Alert>
        )}

        <label className="flex items-start gap-3 rounded-lg border border-border p-3">
          <Switch checked={draft.autoCarry} onCheckedChange={(v) => setDraft((prev) => ({ ...prev, autoCarry: Boolean(v) }))} className="mt-0.5" />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">Переносить незавершённые заказы автоматически при смене периода</span>
            <span className="text-xs text-muted-foreground">
              Заказы в работе из прошлого периода сами переедут в новую вкладку стола. Иначе — вручную: в новом периоде на столе появится
              плашка с кнопкой «Перенести».
            </span>
          </span>
        </label>

        <p className="text-xs text-muted-foreground">
          Сейчас: <span className="text-foreground">{preview.now}</span> · дальше: <span className="text-foreground">{preview.next}</span> ·{" "}
          {preview.after}
        </p>

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <Button type="button" onClick={() => void save()} disabled={saving || !changed} className="gap-1.5">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Сохранить
          </Button>
          {changed && <span className="text-[12px] text-muted-foreground">есть несохранённые изменения</span>}
        </div>
      </CardContent>
    </Card>
  );
}
