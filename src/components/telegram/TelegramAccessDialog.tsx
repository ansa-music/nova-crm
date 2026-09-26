import { useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { fetchTelegramAccessList, setTelegramAccess, setTelegramConfig, type TelegramConfig } from "@/services/telegram/telegramAccess";
import { cn } from "@/utils/cn";
import { personLabel } from "@/utils/peopleDesks";
import { memberHasRole, type WorkspaceMember } from "@/types";

/**
 * Owner: кому открыт раздел «Telegram» (пока только ОС) и ключи приложения
 * Telegram с my.telegram.org. Пишет базу RPC tg_set_access / tg_set_config
 * (20261011): не ОС и не участников база отбросит сама.
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
  const candidates = useMemo(
    () =>
      members
        .filter((m) => m.status === "active" && m.uid && memberHasRole(m, "os"))
        .sort((a, b) => personLabel(a).localeCompare(personLabel(b), "ru")),
    [members]
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
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
        setSelected(new Set(uids));
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
  }, [open, workspaceId, config]);

  const toggle = (uid: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(uid);
      else next.delete(uid);
      return next;
    });

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
      const granted = await setTelegramAccess(workspaceId, [...selected]);
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
            Кто видит раздел и входит в рабочий аккаунт. Пока — только ОС. Каждый вошедший видит все чаты аккаунта.
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-2">
          <p className="text-[12px] font-medium text-muted-foreground">Ключи приложения · my.telegram.org → API development tools</p>
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

        <section className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          <p className="text-[12px] font-medium text-muted-foreground">ОС с доступом · {selected.size}</p>
          {!loaded ? (
            <p className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Загружаю…
            </p>
          ) : loadError ? (
            <Alert tone="error" title="Список не прочитался">
              {loadError}
            </Alert>
          ) : candidates.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">В команде нет ОС — раздел открывается только им.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {candidates.map((m) => {
                const on = selected.has(m.uid);
                return (
                  <li key={m.uid}>
                    <label className={cn("flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-accent/40", on && "bg-primary/[0.06]")}>
                      <Checkbox checked={on} onCheckedChange={(v) => toggle(m.uid, v === true)} disabled={busy} />
                      <MemberAvatar id={m.uid} name={m.name} nickname={m.nickname} photoURL={m.photoURL} className="h-8 w-8 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{personLabel(m)}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">{m.email}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
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
