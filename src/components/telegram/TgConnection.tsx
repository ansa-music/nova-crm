import { useEffect, useState } from "react";
import { MonitorSmartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TgEnded, TgState } from "@/services/telegram/tgClient";
import { zonedDateFormat } from "@/utils/date";
import { cn } from "@/utils/cn";

/**
 * Состояние соединения с Telegram (жалоба Nurba 26.09.2026: «вылетает, должно
 * быть постоянным»): точка «в сети» в шапке, экран «открыт в другой вкладке»,
 * отсчёт до переподключения и понятная причина, почему закончился прошлый вход.
 */

export function TgConnDot({ conn }: { conn: TgState["conn"] }) {
  const look =
    conn === "connected" || conn === "updating"
      ? { dot: "bg-success", text: "в сети" }
      : conn === "connecting"
        ? { dot: "bg-warning animate-pulse", text: "подключаюсь…" }
        : conn === "offline"
          ? { dot: "bg-destructive", text: "нет связи — переподключусь сам" }
          : null;
  if (!look) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-normal text-muted-foreground" title="Соединение с Telegram">
      <span className={cn("h-1.5 w-1.5 rounded-full", look.dot)} aria-hidden />
      {look.text}
    </span>
  );
}

export function TgRetryIn({ at }: { at: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, Math.ceil((at - now) / 1000));
  return <span className="mt-1 block text-[12px] opacity-80">{left > 0 ? `Следующая попытка через ${left} с.` : "Пробую…"}</span>;
}

export function TgElsewhere({ onTakeOver }: { onTakeOver: () => void }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/[0.12] text-primary">
          <MonitorSmartphone className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Telegram открыт в другой вкладке Nova</h2>
          <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">
            В браузере работает одно соединение с Telegram — так вход не слетает. Когда ту вкладку закроют, эта подхватит
            Telegram сама.
          </p>
        </div>
      </div>
      <Button onClick={onTakeOver}>Работать здесь</Button>
      <p className="mt-2 text-[12px] text-muted-foreground">В той вкладке Telegram встанет на паузу. Отправку файла там лучше дождаться.</p>
    </div>
  );
}

const DATE_OPTIONS: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" };

/** Почему закончился прошлый вход — одна строка над экраном входа. */
export function TgEndedNote({ ended }: { ended: TgEnded | null }) {
  if (!ended || ended.reason === "button") return null;
  const when = zonedDateFormat("ru-RU", DATE_OPTIONS).format(new Date(ended.at));
  const text =
    ended.reason === "revoked"
      ? `Прошлый вход закрыт ${when}: Owner снял вам доступ к разделу.`
      : ended.reason === "storage"
        ? `Прошлый вход пропал ${when} вместе с данными этого браузера: очистили историю или данные сайтов, либо это другой профиль браузера. Nova хранит вход в самом браузере.`
        : `Прошлый вход завершил Telegram ${when}${ended.code ? ` (${ended.code})` : ""}: сеанс «Nova» закрыли на телефоне в «Устройствах» или Telegram отключил его сам. Проверьте на телефоне «Настройки → Устройства → Автоматически завершать сеансы».`;
  return <p className="mb-3 rounded-lg border border-warning/30 bg-warning/[0.08] px-3 py-2 text-[12.5px] leading-5 text-foreground">{text}</p>;
}
