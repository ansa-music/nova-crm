import { useEffect, useMemo, useState } from "react";
import { Banknote, Dices, Loader2, Plus, Scale, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { toast } from "@/components/ui/sonner";
import { useOrderAssignment } from "@/hooks/useOrderAssignment";
import { useWorkspace } from "@/hooks/useWorkspace";
import { bigQueueView, shortMoney, useBigOrderQueue } from "@/services/bigOrderQueueService";
import { saveRandomSettings, useRandomSettings } from "@/services/randomService";
import { cn } from "@/utils/cn";
import { displayNameOf } from "@/utils/displayName";
import {
  RANDOM_BANDS_MAX,
  RANDOM_BAND_MIN,
  RANDOM_WEIGHT_STEPS,
  bandRandomWeight,
  chancePercents,
  checkBandLabels,
  personalRandomWeight,
  randomSettingsKey,
  randomWeightOf,
  sanitizeRandomSettings,
  type RandomSettings,
} from "@/types";

const BOOST_STEPS = [0, 0.5, 1, 1.5, 2, 3] as const;
const QUICK_BANDS = [100_000, 200_000, 300_000, 500_000] as const;

function times(n: number): string {
  return `×${String(n).replace(".", ",")}`;
}

/**
 * «Настройки → Рандом» — только Owner (просьбы Nurba 03.10.2026: «подкрутка
 * шансов и настройка коэффициента», «подкрутить шансы на большие чеки»,
 * «никто другой не должен про них знать»).
 *
 * Хранится в Supabase `random_settings` — читает и пишет только Owner; бросок
 * делает база. Колесо у всех ровное, проценты видит только Owner.
 */
export function RandomSettingsPanel() {
  const { activeWorkspaceId, activeWorkspace } = useWorkspace();
  const { technicians, deskByUid, orderCounts } = useOrderAssignment(true);
  const snap = useRandomSettings(activeWorkspaceId, true, activeWorkspace?.randomSettings);
  const saved = snap.data;
  const savedKey = randomSettingsKey(saved);
  const [draft, setDraft] = useState<RandomSettings>(saved);
  const [busy, setBusy] = useState(false);
  const [bandInput, setBandInput] = useState("");
  const [previewBand, setPreviewBand] = useState(-1);
  useEffect(() => {
    setDraft(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const bigView = bigQueueView(useBigOrderQueue(activeWorkspaceId, true));

  const clean = sanitizeRandomSettings(draft);
  const dirty = randomSettingsKey(clean) !== savedKey;
  const boost = clean.fewerOrdersBoost ?? 0;
  const bands = clean.checkBands ?? [];
  const bandLabels = checkBandLabels(bands);
  const shownBand = previewBand < bandLabels.length ? previewBand : -1;
  // Сумма-представитель группы — для превью (порог группы или чуть ниже первого).
  const previewCheck = shownBand < 0 ? null : shownBand === 0 ? Math.max(1, bands[0] - 1) : bands[shownBand - 1];

  const sorted = useMemo(
    () => [...technicians].sort((a, b) => displayNameOf(a).localeCompare(displayNameOf(b), "ru")),
    [technicians]
  );
  // Превью: шанс, если откликнутся все со столом.
  const poolUids = sorted.filter((m) => deskByUid.has(m.uid)).map((m) => m.uid);
  const chances = chancePercents(poolUids, (uid) => randomWeightOf(uid, clean, orderCounts, poolUids, previewCheck));

  function setWeight(uid: string, w: number) {
    setDraft((prev) => ({ ...prev, weights: { ...(prev.weights ?? {}), [uid]: w } }));
  }

  function setBandWeight(uid: string, band: number, w: number) {
    setDraft((prev) => {
      const groups = (sanitizeRandomSettings(prev).checkBands?.length ?? 0) + 1;
      const row = Array.from({ length: groups }, (_, i) => bandRandomWeight(sanitizeRandomSettings(prev), uid, i));
      row[band] = w;
      return { ...prev, bandWeights: { ...(prev.bandWeights ?? {}), [uid]: row } };
    });
  }

  /** Пороги меняются — множители групп переезжают по сумме, а не по номеру. */
  function setBands(next: number[]) {
    setDraft((prev) => {
      const old = sanitizeRandomSettings(prev);
      const oldBands = old.checkBands ?? [];
      const nextClean = sanitizeRandomSettings({ checkBands: next }).checkBands ?? [];
      const sample = (i: number) => (i === 0 ? Math.max(1, (nextClean[0] ?? 1) - 1) : nextClean[i - 1]);
      const bandWeights: Record<string, number[]> = {};
      for (const uid of Object.keys(old.bandWeights ?? {})) {
        bandWeights[uid] = Array.from({ length: nextClean.length + 1 }, (_, i) => {
          const oldIndex = oldBands.filter((b) => b <= sample(i)).length;
          return bandRandomWeight(old, uid, oldIndex);
        });
      }
      return { ...prev, checkBands: nextClean, bandWeights };
    });
    setPreviewBand(-1);
  }

  function addBand(value: number) {
    if (!Number.isFinite(value) || value < RANDOM_BAND_MIN) {
      toast.error(`Порог — сумма от ${RANDOM_BAND_MIN.toLocaleString("ru-RU")}`);
      return;
    }
    if (bands.length >= RANDOM_BANDS_MAX) {
      toast.error(`Порогов — не больше ${RANDOM_BANDS_MAX}`);
      return;
    }
    if (bands.includes(Math.round(value))) return;
    setBands([...bands, Math.round(value)]);
    setBandInput("");
  }

  async function save(next: RandomSettings) {
    if (!activeWorkspaceId) return;
    setBusy(true);
    try {
      await saveRandomSettings(activeWorkspaceId, next);
      toast.success("Шансы «Рандома» сохранены");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить шансы");
    } finally {
      setBusy(false);
    }
  }

  if (snap.status === "missing") {
    return (
      <Alert tone="warning">
        Шансы «Рандома» ещё не включены в базе: обновите SQL (плашка сверху). До этого барабан крутит всех поровну.
      </Alert>
    );
  }
  if (snap.status === "idle" || snap.status === "loading") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Загружаю шансы…
      </div>
    );
  }

  return (
    <>
      {snap.status === "error" ? (
        <Alert tone="error">Не удалось прочитать шансы из базы — сохранять сейчас не стоит, обновите страницу.</Alert>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Эти настройки видите только вы. Победителя выбирает база по этим шансам, а колесо у всех рисуется ровным — по нему о
        настройке не догадаться.
      </p>

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

      <Card data-random-bands>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Banknote className="h-4 w-4 text-primary" />
            Сумма чека
          </CardTitle>
          <CardDescription>
            Пороги делят заказы на группы по сумме чека. У каждого технаря ниже появится свой множитель на каждую группу —
            например, ×2 на крупных чеках и ×0 на мелких.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {bands.map((b) => (
              <span
                key={b}
                className="inline-flex min-h-9 items-center gap-1 rounded-md border border-primary/30 bg-primary/10 pl-3 pr-1 font-mono text-[13px] text-primary"
              >
                {shortMoney(b)}
                <button
                  type="button"
                  aria-label={`Убрать порог ${shortMoney(b)}`}
                  disabled={busy}
                  onClick={() => setBands(bands.filter((x) => x !== b))}
                  className="grid h-7 w-7 place-items-center rounded hover:bg-primary/15"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
            {bands.length === 0 ? <span className="text-sm text-muted-foreground">Порогов нет — сумма чека не влияет.</span> : null}
          </div>
          {bands.length < RANDOM_BANDS_MAX ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <form
                className="flex items-center gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  addBand(Number(bandInput.replace(/\s/g, "")));
                }}
              >
                <Input
                  inputMode="numeric"
                  placeholder="Порог, ₸"
                  value={bandInput}
                  onChange={(e) => setBandInput(e.target.value.replace(/[^\d\s]/g, ""))}
                  className="h-9 w-32"
                  aria-label="Новый порог суммы чека"
                />
                <Button type="submit" size="sm" variant="outline" disabled={busy || !bandInput.trim()} className="h-9 gap-1">
                  <Plus className="h-3.5 w-3.5" /> Порог
                </Button>
              </form>
              {QUICK_BANDS.filter((q) => !bands.includes(q)).map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={busy}
                  onClick={() => addBand(q)}
                  className="min-h-9 rounded-md border border-dashed border-border px-2.5 font-mono text-[12px] text-muted-foreground hover:bg-accent"
                >
                  + {shortMoney(q)}
                </button>
              ))}
            </div>
          ) : null}
          {bandLabels.length > 0 ? (
            <p className="text-xs text-muted-foreground">Группы: {bandLabels.join(" · ")}</p>
          ) : null}
          {bigView && bigView.queue.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Чеки от {shortMoney(bigView.threshold)} выдаются через очередь «Заказы от {shortMoney(bigView.threshold)}+» —
              «Рандом» там не крутится.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Dices className="h-4 w-4 text-primary" />
            Личный шанс технаря
          </CardTitle>
          <CardDescription>
            ×1 — обычный шанс, ×2 — вдвое выше, ×0 — на «Рандоме» и в «Своей рулетке» не выпадает (отдать вручную можно).
            Справа — шанс, если на заказ откликнутся все со столом.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5" data-random-weights>
          {bandLabels.length > 0 ? (
            <div className="mb-1 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Шанс для чека">
              <span className="text-xs text-muted-foreground">Шанс для чека:</span>
              {[-1, ...bandLabels.map((_, i) => i)].map((i) => (
                <button
                  key={i}
                  type="button"
                  role="radio"
                  aria-checked={shownBand === i}
                  onClick={() => setPreviewBand(i)}
                  className={cn(
                    "min-h-8 rounded-md border px-2.5 text-[12px] transition-colors",
                    shownBand === i ? "border-primary/40 bg-primary/12 text-primary" : "border-border hover:bg-accent"
                  )}
                >
                  {i < 0 ? "любой" : bandLabels[i]}
                </button>
              ))}
            </div>
          ) : null}
          {sorted.length === 0 ? <p className="text-sm text-muted-foreground">Технарей пока нет.</p> : null}
          {sorted.map((m) => {
            const w = personalRandomWeight(clean, m.uid);
            const hasDesk = deskByUid.has(m.uid);
            return (
              <div key={m.uid} className="flex flex-col gap-2 rounded-lg border border-border p-2.5" data-random-row={m.uid}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
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
                {bandLabels.length > 0 ? (
                  <div className="flex flex-wrap items-end gap-2 border-t border-border/60 pt-2" data-random-bands-row>
                    <span className="self-center text-xs text-muted-foreground">По чеку:</span>
                    {bandLabels.map((label, i) => {
                      const bw = bandRandomWeight(clean, m.uid, i);
                      return (
                        <label key={label} className="flex flex-col gap-0.5">
                          <span className="text-[11px] text-muted-foreground">{label}</span>
                          <Select value={String(bw)} disabled={busy} onValueChange={(v) => setBandWeight(m.uid, i, Number(v))}>
                            <SelectTrigger
                              aria-label={`${displayNameOf(m)}: ${label}`}
                              className={cn(
                                "h-8 w-[76px] font-mono text-[12px]",
                                bw === 0 ? "text-destructive" : bw !== 1 ? "text-primary" : ""
                              )}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {RANDOM_WEIGHT_STEPS.map((step) => (
                                <SelectItem key={step} value={String(step)}>
                                  {times(step)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </label>
                      );
                    })}
                  </div>
                ) : null}
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
