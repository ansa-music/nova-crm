import { useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { GrokPeoplePicker } from "@/components/grok/GrokPeoplePicker";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { fetchTelegramAccessList, setTelegramAccess, setTelegramConfig, type TelegramConfig } from "@/services/telegram/telegramAccess";
import { pickerInitialSelection } from "@/utils/grokPeople";
import type { TeamGroup } from "@/utils/teamGroup";
import type { WorkspaceMember } from "@/types";

/** ОС — главные пользователи раздела, их группа первой. */
const TG_GROUP_ORDER: readonly TeamGroup[] = ["os", "tech", "other"];

/**
 * Owner: кому открыт раздел «Telegram» и ключи приложения Telegram с
 * my.telegram.org. Отметить можно любого участника — по группам «ОС /
 * Технари / Другие» (просьба Nurba 26.09.2026), с поиском и «все / снять» у
 * группы. Пишет базу RPC tg_set_access / tg_set_config (20261011 + 20261012):
 * не участников база отбросит сама.
 */
export function TelegramAccessDialog({
  open,
  onOpenChange,
  workspaceId,
  members,
  config,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  members: WorkspaceMember[];
  config: TelegramConfig | null;
}) {
  const candidates = useMemo(() => members.filter((m) => m.status === "active" && Boolean(m.uid)), [members]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [showHash, setShowHash] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    setLoadError(null);
    setApiId(config ? String(config.apiId) : "");
    setApiHash(config?.apiHash ?? "");
    setShowHash(false);
    let alive = true;
    fetchTelegramAccessList(workspaceId)
      .then((uids) => {
        if (!alive) return;
        setSelected(pickerInitialSelection(uids, candidates));
        setLoaded(true);
      })
      .catch((error: Error) => {
        if (!alive) return;
        setLoadError(error.message);
        setLoaded(true);
      });
    return () => {
      alive = false;
    };
    // Кандидаты — по открытию окна: снимок ростера посреди выбора не сбрасывает галочки.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspaceId, config]);

  const idNum = Number(apiId.trim());
  const hash = apiHash.trim().toLowerCase();
  const keysEmpty = !apiId.trim() && !hash;
  const keysValid = keysEmpty || (Number.isInteger(idNum) && idNum > 0 && /^[0-9a-f]{32}$/.test(hash));
  const keysChanged = keysEmpty ? Boolean(config) : !config || config.apiId !== idNum || config.apiHash !== hash;

  async function save() {
    if (!keysValid) return;
    setBusy(true);
    try {
      if (keysChanged) await setTelegramConfig(workspaceId, keysEmpty ? null : { apiId: idNum, apiHash: hash });
      const granted = await setTelegramAccess(workspaceId, selected);
      toast.success(granted.length ? `Раздел Telegram открыт: ${granted.length}` : "Раздел Telegram закрыт для всех");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="flex max-h-[90vh] max-w-lg flex-col gap-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" /> Доступ к Telegram
          </DialogTitle>
          <DialogDescription>
            Кто видит раздел и входит в рабочий аккаунт. Отметить можно любого из команды. Каждый вошедший видит все чаты
            аккаунта.
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-2">
          <p className="text-[12px] font-medium text-muted-foreground">
            Ключи приложения ·{" "}
            <a href="https://my.telegram.org/apps" target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">
              my.telegram.org
            </a>{" "}
            → API development tools
          </p>
          <div className="grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)]">
            <Input value={apiId} onChange={(e) => setApiId(e.target.value.replace(/\D/g, ""))} placeholder="api_id" inputMode="numeric" disabled={busy} />
            <div className="relative">
              <Input
                value={apiHash}
                onChange={(e) => setApiHash(e.target.value)}
                placeholder="api_hash"
                type={showHash ? "text" : "password"}
                className="pr-10 font-mono"
                autoComplete="off"
                disabled={busy}
              />
              <button
                type="button"
                className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                onClick={() => setShowHash((v) => !v)}
                aria-label={showHash ? "Скрыть" : "Показать"}
              >
                {showHash ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          {!keysValid && <p className="text-[12px] text-destructive">api_id — число, api_hash — 32 знака (0-9, a-f).</p>}
        </section>

        <section className="flex min-h-0 flex-1 flex-col gap-2">
          <p className="text-[12px] font-medium text-muted-foreground">С доступом · {selected.length}</p>
          {!loaded ? (
            <p className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Загружаю…
            </p>
          ) : loadError ? (
            <Alert tone="error" title="Список не прочитался">
              {loadError}
            </Alert>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <GrokPeoplePicker candidates={candidates} selected={selected} onChange={setSelected} disabled={busy} groupOrder={TG_GROUP_ORDER} />
            </div>
          )}
        </section>

        <p className="text-[11px] leading-5 text-muted-foreground">
          Сняли доступ — Nova сама выйдет из Telegram у этого человека, как только он откроет сайт. Надёжнее сразу отключить его
          устройство «Nova · Имя» в Telegram: Настройки → Устройства.
        </p>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Отмена
          </Button>
          <Button onClick={() => void save()} disabled={busy || !loaded || Boolean(loadError) || !keysValid} className="gap-1.5">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
