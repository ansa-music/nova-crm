import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Music, Play, Square, Trash2, Upload, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/sonner";
import { useWorkspace } from "@/hooks/useWorkspace";
import { updateOrderSound } from "@/services/workspaceService";
import {
  MAX_ORDER_SOUND_SECONDS,
  removeOrderSoundFile,
  uploadOrderSoundFile,
  validateOrderSoundFile,
} from "@/services/orderSoundService";
import { audioFileDuration, previewOrderSound, stopOrderSoundPreview } from "@/utils/browserNotify";
import { firestoreErrorText } from "@/utils/dbError";
import { cn } from "@/utils/cn";
import { ORDER_SOUND_PRESETS, orderSoundOf, sanitizeOrderSound, type OrderSoundPreset, type OrderSoundSettings } from "@/types";

const REPEATS = [1, 2, 3] as const;
const REPEAT_LABEL: Record<number, string> = { 1: "1 раз", 2: "2 раза", 3: "3 раза" };

/**
 * «Настройки → Звук заказа» (Owner, просьба Nurba 25.09.2026): какой звук
 * играет у ВСЕХ, когда приходит заказ — готовая мелодия или свой файл,
 * громкость и сколько раз повторить. Выбор пишется сразу (`updateOrderSound`),
 * у открытых вкладок звук меняется без перезагрузки (`useOrderSoundBridge`).
 * Выключить звук у себя каждый по-прежнему может в колокольчике.
 */
export function OrderSoundSettingsPanel() {
  const { activeWorkspace, activeWorkspaceId } = useWorkspace();
  const saved = orderSoundOf(activeWorkspace);
  const savedKey = JSON.stringify(saved);
  const [draft, setDraft] = useState<OrderSoundSettings>(saved);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const volumeTimer = useRef<number | null>(null);

  // Чужая правка (другая вкладка Owner) — подтягиваем, пока сами ничего не пишем.
  useEffect(() => {
    if (!saving) setDraft(JSON.parse(savedKey) as OrderSoundSettings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  useEffect(
    () => () => {
      stopOrderSoundPreview();
      if (volumeTimer.current) window.clearTimeout(volumeTimer.current);
    },
    []
  );

  async function save(next: OrderSoundSettings, quiet = false) {
    if (!activeWorkspaceId) return false;
    setDraft(next);
    setSaving(true);
    try {
      await updateOrderSound(activeWorkspaceId, next);
      if (!quiet) toast.success("Звук заказа сохранён — у всех");
      return true;
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось сохранить звук"));
      setDraft(saved);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function listen(settings: OrderSoundSettings, key: string) {
    if (playing === key) {
      stopOrderSoundPreview();
      setPlaying(null);
      return;
    }
    setPlaying(key);
    const ok = await previewOrderSound(settings);
    if (!ok) {
      setPlaying(null);
      toast.error("Не удалось проиграть звук", { description: "Браузер не смог открыть файл." });
      return;
    }
    // Индикатор «играет» — примерно на время звука.
    window.setTimeout(() => setPlaying((cur) => (cur === key ? null : cur)), 1600 * settings.repeat);
  }

  function pick(preset: OrderSoundPreset) {
    const next = sanitizeOrderSound({ ...draft, preset });
    void listen(next, preset);
    if (next.preset !== saved.preset) void save(next);
  }

  function setVolume(volume: number) {
    const next = sanitizeOrderSound({ ...draft, volume });
    setDraft(next);
    if (volumeTimer.current) window.clearTimeout(volumeTimer.current);
    volumeTimer.current = window.setTimeout(() => void save(next, true), 600);
  }

  function setRepeat(repeat: number) {
    void save(sanitizeOrderSound({ ...draft, repeat }), true);
  }

  async function upload(file: File) {
    if (!activeWorkspaceId) return;
    const invalid = validateOrderSoundFile(file);
    if (invalid) {
      toast.error(invalid);
      return;
    }
    setUploading(true);
    try {
      const duration = await audioFileDuration(file);
      if (duration === null) throw new Error("Браузер не смог прочитать звук — попробуйте mp3");
      if (duration > MAX_ORDER_SOUND_SECONDS) {
        throw new Error(`Звук длиннее ${MAX_ORDER_SOUND_SECONDS} с — обрежьте до короткого сигнала`);
      }
      const previousPath = saved.customPath;
      const { url, path } = await uploadOrderSoundFile(activeWorkspaceId, file);
      const next = sanitizeOrderSound({ ...draft, preset: "custom", customUrl: url, customPath: path, customName: file.name });
      if (await save(next)) {
        if (previousPath && previousPath !== path) void removeOrderSoundFile(previousPath).catch(() => undefined);
        void listen(next, "custom");
      } else {
        void removeOrderSoundFile(path).catch(() => undefined);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить звук");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeCustom() {
    const path = saved.customPath;
    const next = sanitizeOrderSound({
      ...draft,
      preset: draft.preset === "custom" ? "default" : draft.preset,
      customUrl: null,
      customPath: null,
      customName: null,
    });
    if (await save(next)) void removeOrderSoundFile(path).catch(() => undefined);
  }

  const hasCustom = Boolean(draft.customUrl);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Music className="h-4 w-4 text-primary" /> Звук заказа
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </CardTitle>
        <CardDescription>
          Играет у всех, когда приходит заказ. Нажмите на звук — он прозвучит и сразу станет звуком заказа. Выключить
          звук у себя каждый может в колокольчике.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {ORDER_SOUND_PRESETS.map((preset) => {
            const on = draft.preset === preset.id;
            return (
              <SoundTile
                key={preset.id}
                on={on}
                label={preset.label}
                hint={preset.hint}
                playing={playing === preset.id}
                onPick={() => pick(preset.id)}
                onListen={() => void listen(sanitizeOrderSound({ ...draft, preset: preset.id }), preset.id)}
              />
            );
          })}
          {hasCustom && (
            <SoundTile
              on={draft.preset === "custom"}
              label="Свой звук"
              hint={draft.customName ?? "загруженный файл"}
              playing={playing === "custom"}
              onPick={() => pick("custom")}
              onListen={() => void listen(sanitizeOrderSound({ ...draft, preset: "custom" }), "custom")}
            />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border p-3">
          <Upload className="h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="min-w-0 flex-1 text-[13px]">
            <span className="font-medium">{hasCustom ? "Свой звук загружен" : "Свой звук"}</span>
            <span className="block text-[12px] text-muted-foreground">
              mp3, wav, ogg или m4a · до 2 МБ и {MAX_ORDER_SOUND_SECONDS} секунд
            </span>
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*,.mp3,.wav,.ogg,.m4a"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <Button variant="outline" size="sm" className="gap-1.5" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {hasCustom ? "Заменить" : "Загрузить файл"}
          </Button>
          {hasCustom && (
            <Button variant="ghost" size="sm" className="gap-1.5 text-destructive" disabled={uploading || saving} onClick={() => void removeCustom()}>
              <Trash2 className="h-3.5 w-3.5" /> Удалить
            </Button>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-1.5 text-[13px] font-medium">
              <Volume2 className="h-4 w-4 text-muted-foreground" /> Громкость
              <span className="ml-auto font-mono text-[12px] tabular-nums text-muted-foreground">
                {Math.round(draft.volume * 100)} %
              </span>
            </p>
            <input
              type="range"
              min={20}
              max={100}
              step={5}
              value={Math.round(draft.volume * 100)}
              onChange={(e) => setVolume(Number(e.target.value) / 100)}
              aria-label="Громкость звука заказа"
              className="w-full accent-[hsl(var(--primary))]"
            />
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-[13px] font-medium">Сколько раз проиграть</p>
            <div className="flex gap-1.5">
              {REPEATS.map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={draft.repeat === n}
                  onClick={() => setRepeat(n)}
                  className={cn(
                    "min-h-9 rounded-md border px-3 text-[13px] transition-colors",
                    draft.repeat === n
                      ? "border-primary/40 bg-primary/12 font-medium text-primary"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {REPEAT_LABEL[n]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SoundTile({
  on,
  label,
  hint,
  playing,
  onPick,
  onListen,
}: {
  on: boolean;
  label: string;
  hint: string;
  playing: boolean;
  onPick: () => void;
  onListen: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border p-2 transition-colors",
        on ? "border-primary/50 bg-primary/[0.07]" : "border-border hover:border-primary/30"
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={on}
        onClick={onPick}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-md px-1 text-left"
      >
        <span
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
            on ? "border-primary bg-primary text-primary-foreground" : "border-border"
          )}
        >
          {on && <Check className="h-3 w-3" />}
        </span>
        <span className="min-w-0">
          <span className={cn("block truncate text-[13px] font-medium", on && "text-primary")}>{label}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{hint}</span>
        </span>
      </button>
      <Button
        variant="ghost"
        size="icon"
        data-compact
        className="h-9 w-9 shrink-0"
        onClick={onListen}
        title={playing ? "Остановить" : "Прослушать"}
        aria-label={playing ? `Остановить «${label}»` : `Прослушать «${label}»`}
      >
        {playing ? <Square className="h-3.5 w-3.5" /> : <Play className="h-4 w-4" />}
      </Button>
    </div>
  );
}
