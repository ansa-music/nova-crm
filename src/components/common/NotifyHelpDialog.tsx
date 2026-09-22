import { useEffect, useState, useSyncExternalStore } from "react";
import { BellRing, Check, Copy, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import {
  browserNotifyState,
  detectNotifyBrowser,
  playOrderSound,
  refreshBrowserNotifyState,
  requestBrowserNotify,
  subscribeBrowserNotify,
  type NotifyBrowser,
} from "@/utils/browserNotify";

/**
 * «Как включить уведомления» — для тех, у кого браузер их уже ЗАПРЕТИЛ.
 * Сайт по правилам браузера не может сам снять этот запрет (повторный
 * `requestPermission` молча возвращает «denied»), поэтому единственное, что
 * мы можем, — показать ровно те шаги, что нужны в ЕГО браузере, дать
 * скопировать адрес настроек сайта и самим заметить, когда он разрешит.
 *
 * Окно одно на приложение (`NotifyHelpHost` в AppLayout) и открывается
 * событием: кнопка живёт и в выпадашке колокольчика, которая закрывается при
 * клике, — со своим состоянием окно закрывалось бы вместе с ней.
 */

const OPEN_EVENT = "nova:notify-help";

/** Открыть окно из любого места (кнопка в колокольчике, плашка на «Заказах»). */
export function openNotifyHelp(reason: "denied" | "dismissed" = "denied") {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: reason }));
}

const STEPS: Record<NotifyBrowser, { name: string; steps: string[]; settingsUrl?: (origin: string) => string }> = {
  chrome: {
    name: "Chrome",
    steps: [
      "Слева в адресной строке нажмите на значок сайта — замок или два ползунка.",
      "В строке «Уведомления» выберите «Разрешить». Если строки нет — «Настройки сайтов» → «Уведомления» → «Разрешить».",
      "Вернитесь на эту вкладку — мы проверим сами.",
    ],
    settingsUrl: (origin) => `chrome://settings/content/siteDetails?site=${encodeURIComponent(origin)}`,
  },
  edge: {
    name: "Edge",
    steps: [
      "Слева в адресной строке нажмите на значок замка.",
      "«Разрешения для этого сайта» → «Уведомления» → «Разрешить».",
      "Вернитесь на эту вкладку — мы проверим сами.",
    ],
    settingsUrl: (origin) => `edge://settings/content/siteDetails?site=${encodeURIComponent(origin)}`,
  },
  yandex: {
    name: "Яндекс Браузер",
    steps: [
      "Слева в адресной строке нажмите на значок замка.",
      "Включите переключатель «Уведомления» (или «Подробнее» → «Уведомления» → «Разрешить»).",
      "Вернитесь на эту вкладку — мы проверим сами.",
    ],
  },
  opera: {
    name: "Opera",
    steps: [
      "Слева в адресной строке нажмите на значок замка.",
      "«Настройки сайта» → «Уведомления» → «Разрешить».",
      "Вернитесь на эту вкладку — мы проверим сами.",
    ],
  },
  firefox: {
    name: "Firefox",
    steps: [
      "Слева в адресной строке нажмите на значок замка или перечёркнутого колокольчика.",
      "У «Отправлять уведомления» уберите запрет (крестик).",
      "Обновите страницу и нажмите «Включить уведомления» ещё раз.",
    ],
  },
  "safari-mac": {
    name: "Safari",
    steps: [
      "В меню сверху: Safari → «Настройки» → вкладка «Веб-сайты».",
      "Слева «Уведомления», справа найдите этот сайт и поставьте «Разрешить».",
      "Вернитесь на эту вкладку — мы проверим сами.",
    ],
  },
  android: {
    name: "Chrome на Android",
    steps: [
      "Нажмите на значок слева от адреса сайта → «Разрешения» (или «Настройки сайта»).",
      "«Уведомления» → «Разрешить».",
      "Если всё равно тихо: Настройки телефона → Приложения → Chrome → Уведомления → включить.",
    ],
  },
  ios: {
    name: "iPhone / iPad",
    steps: [
      "На iPhone всплывашки сайта работают только у приложения, добавленного на экран «Домой», — в обычной вкладке Safari их нет совсем.",
      "Пока вкладка открыта, новый заказ придёт звуком и в колокольчике — проверьте звук кнопкой ниже.",
    ],
  },
  other: {
    name: "браузер",
    steps: [
      "Откройте настройки сайта — обычно значок слева в адресной строке.",
      "Найдите «Уведомления» и поставьте «Разрешить».",
      "Вернитесь на эту вкладку — мы проверим сами.",
    ],
  },
};

const SYSTEM_TIP =
  "Разрешили, а всплывашек нет — значит, их выключила сама система: Windows → «Параметры» → «Система» → «Уведомления» → включите браузер (и выключите «Не беспокоить»); macOS → «Системные настройки» → «Уведомления» → браузер → «Разрешить».";

export function NotifyHelpHost() {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<"denied" | "dismissed">("denied");
  const [copied, setCopied] = useState(false);
  const { permission } = useSyncExternalStore(subscribeBrowserNotify, browserNotifyState);
  const browser = detectNotifyBrowser();
  const info = STEPS[browser];
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const settingsUrl = info.settingsUrl?.(origin) ?? null;

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<"denied" | "dismissed">).detail;
      setReason(detail === "dismissed" ? "dismissed" : "denied");
      setCopied(false);
      refreshBrowserNotifyState();
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  // Разрешили в настройках, пока окно открыто, — закрываем и радуемся.
  useEffect(() => {
    if (open && permission === "granted") {
      setOpen(false);
      toast.success("Уведомления включены", { description: "Новый заказ придёт всплывашкой и звуком." });
    }
  }, [open, permission]);

  async function copySettingsUrl() {
    if (!settingsUrl) return;
    try {
      await navigator.clipboard.writeText(settingsUrl);
      setCopied(true);
      toast.success("Адрес скопирован", { description: "Вставьте его в адресную строку новой вкладки и нажмите Enter." });
    } catch {
      toast.error("Не удалось скопировать", { description: settingsUrl });
    }
  }

  async function checkAgain() {
    refreshBrowserNotifyState();
    const state = browserNotifyState().permission;
    if (state === "granted") return; // эффект выше закроет окно
    if (state === "default") {
      // Запрет сняли до «Спросить» — можно спросить заново, прямо этим кликом.
      const next = await requestBrowserNotify();
      if (next === "granted") return;
    }
    toast.info("Пока не разрешено", { description: "Проверьте шаги выше — после них нажмите «Проверить» ещё раз." });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BellRing className="h-4 w-4 shrink-0 text-primary" /> Как включить уведомления
          </DialogTitle>
          <DialogDescription>
            {reason === "dismissed"
              ? "Браузер не показал вопрос или его закрыли. В Chrome вопрос иногда прячется в адресную строку — значок колокольчика справа: нажмите на него → «Разрешить». Или по шагам ниже."
              : `Уведомления для сайта запрещены в браузере (${info.name}). Сайт сам снять запрет не может — это делается в настройках, два клика:`}
          </DialogDescription>
        </DialogHeader>

        <ol className="flex flex-col gap-2">
          {info.steps.map((step, index) => (
            <li key={index} className="flex gap-2.5 text-sm">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">{step}</span>
            </li>
          ))}
        </ol>

        {settingsUrl && (
          <div className="flex flex-col gap-1.5 rounded-lg border border-border/70 p-2.5">
            <p className="text-[12px] text-muted-foreground">
              Или сразу настройки этого сайта: скопируйте адрес, вставьте в новую вкладку и нажмите Enter.
            </p>
            <Button variant="outline" size="sm" className="min-h-11 gap-1.5 self-start sm:min-h-9" onClick={() => void copySettingsUrl()}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              Скопировать адрес настроек
            </Button>
          </div>
        )}

        {browser !== "ios" && <p className="text-[11px] text-muted-foreground">{SYSTEM_TIP}</p>}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button variant="ghost" className="min-h-11 gap-1.5 sm:min-h-9" onClick={() => playOrderSound()}>
            <Volume2 className="h-4 w-4" /> Проверить звук
          </Button>
          <Button className="min-h-11 sm:min-h-9" onClick={() => void checkAgain()}>
            Проверить
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
