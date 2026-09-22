import { useSyncExternalStore } from "react";
import { Bell, BellOff, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import {
  browserNotifyState,
  previewBrowserNotification,
  requestBrowserNotify,
  setBrowserNotifyMuted,
  subscribeBrowserNotify,
} from "@/utils/browserNotify";
import { cn } from "@/utils/cn";
import { openNotifyHelp } from "@/components/common/NotifyHelpDialog";

/**
 * Разрешение на всплывашки спрашивают ТОЛЬКО по клику: без жеста Chrome и
 * Safari молча отказывают, и второй раз спросить уже нельзя — человеку
 * пришлось бы лезть в настройки сайта. Поэтому кнопка, а не запрос при
 * загрузке.
 */
function useNotifyState() {
  const { permission, muted } = useSyncExternalStore(subscribeBrowserNotify, browserNotifyState);

  async function enable() {
    // Уже запрещено — спрашивать бесполезно (браузер молча ответит «нет»):
    // сразу показываем, как включить в ЕГО браузере.
    if (permission === "denied") {
      openNotifyHelp("denied");
      return;
    }
    const next = await requestBrowserNotify();
    setBrowserNotifyMuted(false);
    if (next === "granted") toast.success("Уведомления включены", { description: "Новый заказ придёт всплывашкой и звуком." });
    else if (next === "denied") openNotifyHelp("denied");
    // «default» после вопроса — его закрыли или Chrome спрятал вопрос в
    // адресную строку (тихий режим): тоже подсказываем.
    else if (next === "default") openNotifyHelp("dismissed");
    else if (next === "unsupported") {
      toast.info("Этот браузер не умеет всплывашки", { description: "Звук и уведомление в колокольчике работают." });
    }
  }

  function toggleMute() {
    setBrowserNotifyMuted(!muted);
  }

  return { permission, muted, enable, toggleMute };
}

/** Строка в выпадашке колокольчика. */
export function BrowserNotifyRow() {
  const { permission, muted, enable, toggleMute } = useNotifyState();

  if (permission === "unsupported") return null;

  if (permission !== "granted") {
    return (
      <button
        type="button"
        onClick={() => void enable()}
        className="flex w-full items-center gap-2 border-b border-border bg-primary/[0.06] px-3 py-2.5 text-left transition-colors hover:bg-primary/10"
      >
        <BellRing className="h-4 w-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Включить уведомления браузера</span>
          <span className="block text-xs text-muted-foreground">
            {permission === "denied"
              ? "Сейчас запрещены в браузере — нажмите, покажем, как включить"
              : "Новый заказ придёт со звуком, даже если вкладка свёрнута"}
          </span>
        </span>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-2">
      {muted ? (
        <BellOff className="h-4 w-4 shrink-0 text-muted-foreground" />
      ) : (
        <Bell className="h-4 w-4 shrink-0 text-primary" />
      )}
      <span className="min-w-0 flex-1 text-xs text-muted-foreground">
        {muted ? "Всплывашки и звук выключены" : "Всплывашки и звук включены"}
      </span>
      {!muted && (
        <button
          type="button"
          onClick={() => {
            if (!previewBrowserNotification()) {
              toast.info("Всплывашку показать не удалось", {
                description: "Проверьте разрешения для сайта в системе — звук при этом работает.",
              });
            }
          }}
          className="rounded-full border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          Проверить
        </button>
      )}
      <button
        type="button"
        onClick={toggleMute}
        className={cn(
          "rounded-full border px-2 py-1 text-[11px] font-medium transition-colors",
          muted ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
        )}
      >
        {muted ? "Включить" : "Выключить"}
      </button>
    </div>
  );
}

/**
 * Плашка на «Заказах» — там, где пропущенный заказ и стоит денег. Пока
 * разрешения нет, технарь узнаёт о заказе, только если сам откроет вкладку.
 */
export function OrdersNotifyBanner({ className }: { className?: string }) {
  const { permission, muted, enable, toggleMute } = useNotifyState();

  if (permission === "unsupported" || (permission === "granted" && !muted)) return null;

  const denied = permission === "denied";
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/[0.07] px-3 py-2.5 text-sm",
        className
      )}
    >
      <BellRing className="h-4 w-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1">
        {denied
          ? "Уведомления для сайта запрещены в браузере — новый заказ будет виден только в колокольчике."
          : muted
            ? "Всплывашки о новых заказах выключены вами."
            : "Включите уведомления — новый заказ придёт со звуком, даже если вкладка свёрнута."}
      </span>
      {denied ? (
        <Button size="sm" className="min-h-11 sm:h-9 sm:min-h-0" onClick={() => openNotifyHelp("denied")}>
          Как включить
        </Button>
      ) : (
        <Button size="sm" className="min-h-11 sm:h-9 sm:min-h-0" onClick={() => (muted ? toggleMute() : void enable())}>
          Включить
        </Button>
      )}
    </div>
  );
}
