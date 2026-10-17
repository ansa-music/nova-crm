import { useEffect, useState } from "react";
import { Check, Copy, KeyRound, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  absSheetErrorText,
  absSheetScriptFor,
  disconnectAbsSheet,
  fetchAbsSheetConfig,
  newAbsSheetToken,
  saveAbsSheetOptions,
  type AbsSheetConfig,
} from "@/services/absSheetService";
import { copyText } from "@/services/promptService";
import { isSbMissingError } from "@/services/sb/sbCollections";
import { confirmDialog } from "@/utils/appDialog";
import { cn } from "@/utils/cn";
import { formatDate, timeAgo } from "@/utils/date";

const MAX_PICK = 8;

/**
 * Подключение Google-таблицы к ABS (только Owner): секрет → текст скрипта для
 * Apps Script → шаги установки; какие листы показывать и кому. Секрет живёт в
 * базе (`abs_sheet_config` отдаёт его только Owner), поэтому скрипт можно
 * скопировать заново в любой момент.
 */
export function AbsSheetSetupDialog({
  workspaceId,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [cfg, setCfg] = useState<AbsSheetConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [audience, setAudience] = useState<"all" | "lead">("all");
  const [pick, setPick] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setCopied(false);
    fetchAbsSheetConfig(workspaceId)
      .then((next) => {
        if (cancelled) return;
        setCfg(next);
        setAudience(next.audience);
        setPick(next.pick);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(isSbMissingError(e) ? "Таблица в ABS ещё не включена в базе — вставьте свежий SQL." : absSheetErrorText(e, "Не удалось прочитать настройку"));
      });
    return () => {
      cancelled = true;
    };
  }, [open, workspaceId]);

  const apply = (next: AbsSheetConfig) => {
    setCfg(next);
    setAudience(next.audience);
    setPick(next.pick);
  };

  const run = async (key: string, action: () => Promise<AbsSheetConfig>, done?: string) => {
    setBusy(key);
    try {
      apply(await action());
      if (done) toast.success(done);
    } catch (e) {
      toast.error(absSheetErrorText(e));
    } finally {
      setBusy(null);
    }
  };

  const script = cfg ? absSheetScriptFor(workspaceId, cfg) : null;

  const copyScript = async () => {
    if (!script) return;
    if (await copyText(script)) {
      setCopied(true);
      toast.success("Скрипт скопирован");
    } else {
      toast.error("Не удалось скопировать — выделите текст скрипта вручную");
    }
  };

  const rotate = async () => {
    const ok = await confirmDialog({
      title: "Выдать новый ключ?",
      description: "Скрипт, который уже стоит в таблице, перестанет передавать данные — его нужно будет заменить новым.",
      confirmLabel: "Новый ключ",
    });
    if (ok) await run("token", () => newAbsSheetToken(workspaceId), "Ключ обновлён — вставьте скрипт заново");
  };

  const disconnect = async () => {
    const ok = await confirmDialog({
      title: "Отключить таблицу?",
      description: "Копия таблицы в ABS удалится, скрипт в таблице перестанет передавать данные. Подключить снова можно в любой момент.",
      confirmLabel: "Отключить",
      destructive: true,
    });
    if (ok) await run("off", () => disconnectAbsSheet(workspaceId), "Таблица отключена");
  };

  const dirty = cfg !== null && (audience !== cfg.audience || pick.join("\u0001") !== cfg.pick.join("\u0001"));
  const togglePick = (name: string, on: boolean) =>
    setPick((prev) => (on ? (prev.includes(name) || prev.length >= MAX_PICK ? prev : [...prev, name]) : prev.filter((n) => n !== name)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" data-abs-sheet-setup>
        <DialogHeader>
          <DialogTitle>Google-таблица в ABS</DialogTitle>
          <DialogDescription>
            Листы фин. отчёта приходят сюда сами — через секунды после правки в таблице. Таблица остаётся закрытой:
            её передаёт скрипт внутри неё, по секретному ключу.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <Alert tone="error">{error}</Alert>
        ) : !cfg ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-24" />
          </div>
        ) : !cfg.token ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Сначала Nova выдаст ключ и соберёт скрипт для вашей таблицы. Вставлять его нужно с компьютера.
            </p>
            <Button onClick={() => void run("token", () => newAbsSheetToken(workspaceId))} disabled={busy !== null}>
              <KeyRound className="h-4 w-4" />
              Создать скрипт
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <ConnectionStatus cfg={cfg} />

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Установка — один раз, с компьютера</h3>
              <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-muted-foreground marker:text-foreground">
                <li>
                  Откройте Google-таблицу фин. отчёта → меню <b className="text-foreground">Расширения</b> →{" "}
                  <b className="text-foreground">Apps Script</b>.
                </li>
                <li>
                  Удалите всё, что в редакторе, и вставьте скрипт:
                  <div className="mt-1.5">
                    <Button size="sm" onClick={() => void copyScript()} data-abs-sheet-copy>
                      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      {copied ? "Скопировано" : "Скопировать скрипт"}
                    </Button>
                  </div>
                </li>
                <li>
                  Слева <b className="text-foreground">Сервисы</b> (+) → <b className="text-foreground">Google Sheets API</b> →{" "}
                  <b className="text-foreground">Добавить</b> — тогда придут и цвета условного форматирования (зелёные,
                  жёлтые, красные строки).
                </li>
                <li>
                  Сохраните (значок дискеты), вверху выберите функцию <code className="text-foreground">novaSetup</code> и
                  нажмите <b className="text-foreground">Выполнить</b>. Google попросит разрешение: если покажет
                  «Приложение не проверено» — «Дополнительно» → «Перейти к проекту».
                </li>
                <li>Готово: листы появятся во вкладке «Таблица» через несколько секунд.</li>
              </ol>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Какие листы показывать</h3>
              {cfg.sheets.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Список листов появится после первой передачи. Пока не выбрано — передаются листы со словом «OUTPUT» в
                  названии, а если таких нет — первый лист.
                </p>
              ) : (
                <>
                  <div className="flex max-h-52 flex-col gap-0.5 overflow-y-auto rounded-lg border border-border p-1">
                    {cfg.sheets.map((name) => {
                      const on = pick.includes(name);
                      const disabled = !on && pick.length >= MAX_PICK;
                      return (
                        <label
                          key={name}
                          className={cn(
                            "flex min-h-10 cursor-pointer items-center gap-2.5 rounded-md px-2 text-sm hover:bg-accent",
                            disabled && "cursor-not-allowed opacity-50"
                          )}
                        >
                          <Checkbox checked={on} disabled={disabled} onCheckedChange={(v) => togglePick(name, v === true)} />
                          <span className="min-w-0 truncate">{name}</span>
                          {on && pick.length > 1 && (
                            <span className="ml-auto text-xs text-muted-foreground">{pick.indexOf(name) + 1}</span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {pick.length === 0
                      ? "Ничего не выбрано — передаются листы со словом «OUTPUT», иначе первый."
                      : `Выбрано ${pick.length} из ${MAX_PICK}. Новый выбор таблица применит при следующей правке или в течение 5 минут.`}
                  </p>
                </>
              )}
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Кто видит</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ["all", "Все участники", "Технари, ОС и остальные видят таблицу в ABS."],
                    ["lead", "Только руководство", "Owner, Тимлиды и Тимлид+."],
                  ] as const
                ).map(([value, label, hint]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={audience === value}
                    onClick={() => setAudience(value)}
                    className={cn(
                      "flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left text-sm",
                      audience === value ? "border-primary/50 bg-primary/10 text-primary" : "border-border hover:bg-accent"
                    )}
                  >
                    <span className="font-medium">{label}</span>
                    <span className="text-xs text-muted-foreground">{hint}</span>
                  </button>
                ))}
              </div>
            </section>

            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
              <Button
                onClick={() => void run("save", () => saveAbsSheetOptions(workspaceId, audience, pick), "Сохранено")}
                disabled={!dirty || busy !== null}
              >
                Сохранить
              </Button>
              <Button variant="outline" onClick={() => void rotate()} disabled={busy !== null}>
                <KeyRound className="h-4 w-4" />
                Новый ключ
              </Button>
              <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => void disconnect()} disabled={busy !== null}>
                <Unplug className="h-4 w-4" />
                Отключить
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ConnectionStatus({ cfg }: { cfg: AbsSheetConfig }) {
  if (!cfg.seenAt) {
    return (
      <Alert tone="info" title="Ждём первую передачу">
        Скрипт ещё не выходил на связь. После шага 4 таблица появится сама.
      </Alert>
    );
  }
  return (
    <Alert tone="success" title={cfg.title ? `Подключено: «${cfg.title}»` : "Подключено"}>
      На связи {timeAgo(cfg.seenAt)}
      {cfg.pushedAt ? ` · таблица менялась ${formatDate(cfg.pushedAt, "d MMM, HH:mm")}` : ""}
    </Alert>
  );
}
