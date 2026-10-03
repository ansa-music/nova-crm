import { useEffect, useMemo, useState } from "react";
import { Dices, Loader2, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { toast } from "@/components/ui/sonner";
import { useOrderAssignment } from "@/hooks/useOrderAssignment";
import { useWorkspace } from "@/hooks/useWorkspace";
import { updateRandomSettings } from "@/services/workspaceService";
import { cn } from "@/utils/cn";
import { firestoreErrorText } from "@/utils/dbError";
import { displayNameOf } from "@/utils/displayName";
import {
  RANDOM_WEIGHT_STEPS,
  chancePercents,
  personalRandomWeight,
  randomSettingsOf,
  randomWeightOf,
  sanitizeRandomSettings,
  type RandomSettings,
} from "@/types";

const BOOST_STEPS = [0, 0.5, 1, 1.5, 2, 3] as const;

function times(n: number): string {
  return `×${String(n).replace(".", ",")}`;
}

/**
 * «Настройки → Рандом» — только Owner (просьба Nurba 03.10.2026: «подкрутка
 * шансов и настройка коэффициента»). Личный множитель каждому технарю и
 * коэффициент «меньше заказов за период — выше шанс». Колесо у всех остаётся с
 * равными секторами — шансы видит только Owner, здесь и в окне выдачи.
 */
export function RandomSettingsPanel() {
  const { activeWorkspaceId, activeWorkspace } = useWorkspace();
  const { technicians, deskByUid, orderCounts } = useOrderAssignment(true);
  const saved = useMemo(() => randomSettingsOf(activeWorkspace), [activeWorkspace]);
  const savedKey = JSON.stringify(saved);
  const [draft, setDraft] = useState<RandomSettings>(saved);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setDraft(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const clean = sanitizeRandomSettings(draft);
  const dirty = JSON.stringify(clean) !== savedKey;
  const boost = clean.fewerOrdersBoost ?? 0;

  const sorted = useMemo(
    () => [...technicians].sort((a, b) => displayNameOf(a).localeCompare(displayNameOf(b), "ru")),
    [technicians]
  );
  // Превью: шанс, если откликнутся все технари со столом.
  const poolUids = sorted.filter((m) => deskByUid.has(m.uid)).map((m) => m.uid);
  const chances = chancePercents(poolUids, (uid) => randomWeightOf(uid, clean, orderCounts, poolUids));

  function setWeight(uid: string, w: number) {
    setDraft((prev) => ({ ...prev, weights: { ...(prev.weights ?? {}), [uid]: w } }));
  }

  async function save(next: RandomSettings) {
    if (!activeWorkspaceId) return;
    setBusy(true);
    try {
      await updateRandomSettings(activeWorkspaceId, next);
      toast.success("Шансы «Рандома» сохранены");
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось сохранить шансы"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="h-4 w-4 text-primary" />
            Меньше заказов — выше шанс
          </CardTitle>
          <CardDescription>
            Коэффициент для тех, у кого за текущий период меньше заказов. Считается среди тех, кто крутится в колесе: у кого
            заказов меньше всех, шанс выше в (1 + коэффициент) раз, чем у того, у кого больше всех. 0 — правило выключено.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Коэффициент «меньше заказов — выше шанс»">
            {BOOST_STEPS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={boost === k}
                disabled={busy}
                onClick={() => setDraft((prev) => ({ ...prev, fewerOrdersBoost: k }))}
                className={cn(
                  "min-h-9 rounded-md border px-3 font-mono text-[13px] transition-colors",
                  boost === k ? "border-primary/40 bg-primary/12 text-primary" : "border-border hover:bg-accent"
                )}
              >
                {k === 0 ? "выкл" : String(k).replace(".", ",")}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {boost === 0
              ? "Сейчас число заказов на шанс не влияет."
              : `Сейчас: у кого заказов меньше всех — шанс ${times(1 + boost)} против того, у кого больше всех.`}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Dices className="h-4 w-4 text-primary" />
            Личный шанс технаря
          </CardTitle>
          <CardDescription>
            ×1 — обычный шанс, ×2 — вдвое выше, ×0 — человек в «Рандом» и «Свою рулетку» не попадает (отдать вручную можно).
            Справа — шанс, если на заказ откликнутся все технари со столом. Колесо у всех рисуется ровным: шансы видите
            только вы.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5" data-random-weights>
          {sorted.length === 0 ? <p className="text-sm text-muted-foreground">Технарей пока нет.</p> : null}
          {sorted.map((m) => {
            const w = personalRandomWeight(clean, m.uid);
            const hasDesk = deskByUid.has(m.uid);
            return (
              <div key={m.uid} className="flex flex-col gap-2 rounded-lg border border-border p-2.5 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <MemberAvatar id={m.uid} name={m.name} nickname={m.nickname} photoURL={m.photoURL} className="h-8 w-8 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{displayNameOf(m)}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {hasDesk ? `заказов за период: ${orderCounts.get(m.uid) ?? 0}` : "стола нет — в рандом не попадает"}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-[13px] tabular-nums text-primary" title="Шанс, если откликнутся все">
                    {hasDesk ? `${chances.get(m.uid) ?? 0} %` : "—"}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={`Шанс ${displayNameOf(m)}`}>
                  {RANDOM_WEIGHT_STEPS.map((step) => (
                    <button
                      key={step}
                      type="button"
                      role="radio"
                      aria-checked={w === step}
                      disabled={busy}
                      onClick={() => setWeight(m.uid, step)}
                      className={cn(
                        "min-h-8 min-w-10 rounded-md border px-2 font-mono text-[12px] transition-colors [@media(pointer:coarse)]:min-h-10",
                        w === step
                          ? step === 0
                            ? "border-destructive/40 bg-destructive/10 text-destructive"
                            : "border-primary/40 bg-primary/12 text-primary"
                          : "border-border hover:bg-accent"
                      )}
                    >
                      {times(step)}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button disabled={!dirty || busy} onClick={() => void save(clean)} className="gap-2">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Сохранить
        </Button>
        <Button variant="outline" disabled={busy || (Object.keys(saved).length === 0 && !dirty)} onClick={() => void save({})}>
          Как было — всем поровну
        </Button>
        {dirty ? (
          <Button variant="ghost" disabled={busy} onClick={() => setDraft(saved)}>
            Отменить правки
          </Button>
        ) : null}
      </div>
    </>
  );
}
