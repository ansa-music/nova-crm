import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronDown, ExternalLink, KeyRound, QrCode, ShieldCheck, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchTelegramAccessList, type TelegramConfig } from "@/services/telegram/telegramAccess";
import { cn } from "@/utils/cn";

/**
 * Инструкция для Owner «Как подключить Telegram» (просьба Nurba 26.09.2026:
 * «дай инструкцию как подключить»). Три шага с отметкой, что уже сделано:
 * ключи есть (tg_config), ОС отмечены (tg_access — Owner читает весь список).
 * Вход в аккаунт делает сам ОС, Owner его не видит — третий шаг без отметки.
 * Когда первые два шага готовы, инструкция сворачивается в строку.
 */
export function TelegramSetupGuide({
  workspaceId,
  config,
  refreshKey,
  onOpenAccess,
}: {
  workspaceId: string;
  config: TelegramConfig | null;
  /** Меняется после закрытия «Доступ и ключи» — перечитать, сколько ОС отмечено. */
  refreshKey: number;
  onOpenAccess: () => void;
}) {
  const [granted, setGranted] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    fetchTelegramAccessList(workspaceId)
      .then((uids) => alive && setGranted(uids.length))
      .catch(() => alive && setGranted(null));
    return () => {
      alive = false;
    };
  }, [workspaceId, refreshKey, config]);

  const keysDone = Boolean(config);
  const accessDone = keysDone && (granted ?? 0) > 0;
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? !accessDone;

  return (
    <div className="space-y-3">
      {accessDone && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-success/30 bg-success/[0.07] px-4 py-3 text-sm">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-success/20 text-success">
            <Check className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="font-medium">Раздел подключён.</span>{" "}
            <span className="text-muted-foreground">
              Ключи введены, ОС с доступом: {granted}. Дальше ОС сам входит по QR-коду.
            </span>
          </span>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card">
        <button
          type="button"
          onClick={() => setOpen(!expanded)}
          aria-expanded={expanded}
          className="flex w-full items-center gap-2 px-4 py-3 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Как подключить Telegram</span>
            <span className="block text-[12px] text-muted-foreground">Три шага, один раз. Займёт 5 минут.</span>
          </span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} />
        </button>

        {expanded && (
          <ol className="space-y-5 border-t border-border px-4 py-4">
            <Step
              n={1}
              done={keysDone}
              icon={<KeyRound className="h-4 w-4" />}
              title="Получите ключи на my.telegram.org"
              action={
                <Button asChild variant="outline" size="sm" className="gap-1.5">
                  <a href="https://my.telegram.org/apps" target="_blank" rel="noopener noreferrer">
                    Открыть my.telegram.org <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </Button>
              }
            >
              <li>
                Откройте сайт на компьютере и введите <b>рабочий</b> номер телефона. Код входа придёт в сам Telegram, а не по SMS.
              </li>
              <li>
                Нажмите <b>API development tools</b>.
              </li>
              <li>
                Заполните форму: <b>App title</b> — «Nova CRM», <b>Short name</b> — «novacrm» (только латиница и цифры),{" "}
                <b>Platform</b> — Web. Остальные поля можно не трогать. Нажмите <b>Create application</b>.
              </li>
              <li>
                На странице появятся <b>App api_id</b> (число) и <b>App api_hash</b> (32 знака). Их и нужно скопировать.
              </li>
              <li className="text-muted-foreground">
                Если сайт отвечает «ERROR», выключите VPN и блокировщик рекламы или откройте его в другом браузере. Приложение
                создаётся один раз на номер.
              </li>
            </Step>

            <Step
              n={2}
              done={accessDone}
              icon={<ShieldCheck className="h-4 w-4" />}
              title="Введите ключи и отметьте ОС"
              action={
                <Button size="sm" className="gap-1.5" onClick={onOpenAccess}>
                  <ShieldCheck className="h-4 w-4" /> Доступ и ключи
                </Button>
              }
            >
              <li>
                Нажмите <b>Доступ и ключи</b>, вставьте api_id и api_hash.
              </li>
              <li>Отметьте галочками ОС, которым нужен рабочий Telegram, и нажмите «Сохранить».</li>
              <li className="text-muted-foreground">
                {keysDone ? "Ключи введены. " : "Ключей пока нет. "}
                {granted === null ? "" : granted > 0 ? `ОС с доступом: ${granted}.` : "ОС пока не отмечены."}
              </li>
            </Step>

            <Step n={3} done={false} icon={<QrCode className="h-4 w-4" />} title="ОС входит в рабочий аккаунт">
              <li>
                У отмеченного ОС в меню слева появится <b>Telegram</b>. Он открывает его и нажимает <b>Показать QR-код</b>.
              </li>
              <li>
                <Smartphone className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
                На телефоне, где открыт рабочий аккаунт: <b>Настройки</b>, <b>Устройства</b>, <b>Подключить устройство</b>. Навести
                камеру на код.
              </li>
              <li>Если в аккаунте стоит облачный пароль, Nova его спросит. Можно войти и по номеру телефона с кодом.</li>
              <li className="text-muted-foreground">
                Вход держится в этом браузере. На другом компьютере ОС входит так же, один раз.
              </li>
            </Step>
          </ol>
        )}
      </div>

      <div className="rounded-xl border border-border px-4 py-3 text-[12px] leading-5 text-muted-foreground">
        <p className="mb-1 font-medium text-foreground">Важно</p>
        <ul className="list-disc space-y-1 pl-4">
          <li>Все допущенные ОС видят все чаты рабочего аккаунта: аккаунт один на всех.</li>
          <li>
            Сняли галочку — Nova сама выйдет из Telegram у этого ОС, когда он откроет сайт. Отключить сразу: в Telegram на
            телефоне «Настройки», «Устройства», сеанс «Nova · имя ОС».
          </li>
          <li>Файлы до 2 ГБ, с Telegram Premium до 4 ГБ. Переписка идёт напрямую в Telegram, мимо базы Nova.</li>
        </ul>
      </div>
    </div>
  );
}

function Step({
  n,
  done,
  icon,
  title,
  action,
  children,
}: {
  n: number;
  done: boolean;
  icon: ReactNode;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span
        className={cn(
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold",
          done ? "bg-success/20 text-success" : "bg-primary/[0.12] text-primary"
        )}
        aria-label={done ? `Шаг ${n}: сделано` : `Шаг ${n}`}
      >
        {done ? <Check className="h-4 w-4" /> : n}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <span className="text-muted-foreground">{icon}</span>
          {title}
          {done && <span className="text-[11px] font-normal text-success">готово</span>}
        </p>
        <ul className="list-disc space-y-1 pl-4 text-[13px] leading-5">{children}</ul>
        {action && <div className="pt-1">{action}</div>}
      </div>
    </li>
  );
}
