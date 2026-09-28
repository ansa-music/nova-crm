import { useEffect, useState } from "react";
import { Bot, Eye, EyeOff, Loader2, Paperclip } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { callTgEdge, TgEdgeError } from "@/services/telegram/tgServer";
import { confirmDialog } from "@/utils/appDialog";

function errText(error: unknown, fallback: string) {
  if (error instanceof TgEdgeError) return error.message;
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Owner: служебный бот, через который технари отправляют клиентам файлы
 * (просьба Nurba 28.09.2026). Бот создаётся у @BotFather, токен хранит
 * функция `tg` (таблица tg_master закрыта всем, кроме неё). При подключении
 * аккаунт workspace заводит скрытую группу «Nova · файлы технарей» с ботом —
 * без звука и в архиве.
 */
export function TgCourierDialog({ open, onOpenChange, workspaceId }: { open: boolean; onOpenChange: (open: boolean) => void; workspaceId: string }) {
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [bot, setBot] = useState<{ username: string | null } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setLoadError(null);
    setError(null);
    setToken("");
    setShowToken(false);
    setEditing(false);
    callTgEdge<{ connected: boolean; bot?: { username: string | null } | null }>(workspaceId, "status")
      .then((res) => {
        if (!alive) return;
        setConnected(res.connected === true);
        setBot(res.bot ?? null);
      })
      .catch((e) => alive && setLoadError(errText(e, "Сервер Telegram не ответил")))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open, workspaceId]);

  const tokenOk = /^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token.trim());

  async function connect() {
    if (!tokenOk || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await callTgEdge<{ bot: { username: string } }>(workspaceId, "bot_set", { token: token.trim() });
      setBot(res.bot);
      setEditing(false);
      setToken("");
      toast.success(`Бот @${res.bot.username} подключён — технари могут отправлять файлы`);
    } catch (e) {
      setError(errText(e, "Бот не подключился"));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    const ok = await confirmDialog({
      title: "Отключить бота для файлов?",
      description: "Технари перестанут отправлять клиентам файлы через Nova, текст — по-прежнему. Подключить снова можно тем же токеном.",
      confirmLabel: "Отключить",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await callTgEdge(workspaceId, "bot_clear");
      setBot(null);
      toast.success("Бот для файлов отключён");
    } catch (e) {
      toast.error(errText(e, "Не удалось отключить"));
    } finally {
      setBusy(false);
    }
  }

  const showForm = !loading && !loadError && connected && (!bot || editing);

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-lg gap-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Paperclip className="h-4 w-4 text-primary" /> Файлы технарей
          </DialogTitle>
          <DialogDescription>
            Технарь отправляет клиенту видео и файлы до 2 ГБ прямо из Nova. Файл уходит с его компьютера в Telegram через служебного
            бота, а клиенту приходит от рабочего аккаунта. Бот не видит переписку и сам никому не пишет.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Проверяю…
          </p>
        ) : loadError ? (
          <Alert tone="error" title="Не удалось проверить">
            {loadError}
          </Alert>
        ) : !connected ? (
          <Alert tone="warning" title="Сначала подключите аккаунт">
            Бот работает вместе с аккаунтом Telegram workspace — подключите его на странице раздела.
          </Alert>
        ) : bot && !editing ? (
          <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
              <Bot className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1 text-[13px]">
              <p className="font-medium">Подключён бот {bot.username ? `@${bot.username}` : ""}</p>
              <p className="text-muted-foreground">
                Группа «Nova · файлы технарей» лежит в архиве аккаунта без звука — файлы проходят через неё и сразу убираются.
              </p>
            </div>
          </div>
        ) : null}

        {showForm && (
          <section className="space-y-3">
            <ol className="list-decimal space-y-1.5 pl-5 text-[13px] text-muted-foreground">
              <li>
                В Telegram откройте{" "}
                <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">
                  @BotFather
                </a>{" "}
                → <span className="font-mono">/newbot</span> → имя и адрес бота (например, <span className="font-mono">storylove_files_bot</span>).
              </li>
              <li>Скопируйте токен — строку вида <span className="font-mono">123456789:AAE…</span> — и вставьте сюда.</li>
            </ol>
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                void connect();
              }}
            >
              <div className="relative min-w-0 flex-1">
                <Input
                  value={token}
                  onChange={(e) => {
                    setToken(e.target.value);
                    setError(null);
                  }}
                  placeholder="Токен бота"
                  type={showToken ? "text" : "password"}
                  className="pr-10 font-mono"
                  autoComplete="off"
                  disabled={busy}
                  aria-label="Токен бота"
                />
                <button
                  type="button"
                  className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                  onClick={() => setShowToken((v) => !v)}
                  aria-label={showToken ? "Скрыть" : "Показать"}
                >
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button type="submit" disabled={busy || !tokenOk} className="min-h-11 gap-1.5 sm:min-h-9">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Подключить
              </Button>
            </form>
            {token.trim() && !tokenOk && <p className="text-[12px] text-destructive">Токен выглядит так: 123456789:AAE… — скопируйте его у @BotFather целиком.</p>}
            {error && <Alert tone="error">{error}</Alert>}
          </section>
        )}

        {connected && !loading && !loadError && (
          <p className="text-[11px] leading-5 text-muted-foreground">
            Токен бота получают браузеры технарей, когда отправляют файл. Если технарь ушёл, выпустите новый токен (@BotFather →{" "}
            <span className="font-mono">/revoke</span>) и вставьте его здесь.
          </p>
        )}

        <DialogFooter className="gap-2">
          {bot && !editing && connected && (
            <>
              <Button variant="ghost" onClick={() => void disconnect()} disabled={busy}>
                Отключить
              </Button>
              <Button variant="outline" onClick={() => setEditing(true)} disabled={busy}>
                Сменить бота
              </Button>
            </>
          )}
          <Button variant={bot && !editing ? "default" : "outline"} onClick={() => onOpenChange(false)} disabled={busy}>
            Готово
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
