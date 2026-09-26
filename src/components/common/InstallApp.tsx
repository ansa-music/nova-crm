import { useEffect, useState } from "react";
import { Download, MoreVertical, PlusSquare, Share, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import { brandName, useSiteConfig } from "@/config/siteTerms";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useLocation } from "react-router";
import { isIos, promptInstall, useInstallMode, type InstallMode } from "@/utils/pwa";

/**
 * Установка Nova как приложения — без Google Play и App Store (PWA).
 * Окно одно на приложение (`InstallAppHost` в AppLayout) и открывается
 * событием: меню аккаунта закрывается при клике и унесло бы окно с собой.
 */

export const INSTALL_APP_EVENT = "nova:install-app";

export function openInstallApp() {
  window.dispatchEvent(new Event(INSTALL_APP_EVENT));
}

/** Нажали «Установить»: где можно — сразу окно браузера, иначе — шаги. */
export async function startInstall(mode: InstallMode) {
  if (mode === "prompt") {
    const result = await promptInstall();
    if (result === "accepted") toast.success("Приложение установлено — ищите значок на рабочем столе");
    if (result !== "unavailable") return;
  }
  openInstallApp();
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[12px] font-semibold text-primary">{n}</span>
      <span className="min-w-0 pt-0.5 text-[14px] leading-snug">{children}</span>
    </li>
  );
}

export function InstallAppHost() {
  const [open, setOpen] = useState(false);
  const mode = useInstallMode();
  const name = brandName(useSiteConfig());

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(INSTALL_APP_EVENT, onOpen);
    return () => window.removeEventListener(INSTALL_APP_EVENT, onOpen);
  }, []);

  // Установили, пока окно открыто, — закрываем.
  useEffect(() => {
    if (mode === "installed" && open) {
      setOpen(false);
      toast.success("Приложение установлено");
    }
  }, [mode, open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-primary" />
            Приложение {name}
          </DialogTitle>
          <DialogDescription>
            Без Google Play и App Store: значок на экране, своё окно без адресной строки, уведомления о заказах.
          </DialogDescription>
        </DialogHeader>
        {mode === "prompt" ? (
          <div className="flex flex-col gap-3">
            <p className="text-[14px]">Браузер умеет установить приложение сам — одно нажатие.</p>
            <Button onClick={() => void startInstall("prompt").then(() => setOpen(false))}>
              <Download className="mr-2 h-4 w-4" />
              Установить
            </Button>
          </div>
        ) : mode === "ios" ? (
          <ol className="flex flex-col gap-3">
            <Step n={1}>
              Нажмите <Share className="mx-0.5 inline h-4 w-4 -translate-y-0.5 text-primary" aria-label="Поделиться" /> «Поделиться» — внизу
              экрана в Safari (в Chrome — справа вверху).
            </Step>
            <Step n={2}>
              Прокрутите список вниз и выберите <PlusSquare className="mx-0.5 inline h-4 w-4 -translate-y-0.5 text-primary" /> «На экран
              «Домой»».
            </Step>
            <Step n={3}>Нажмите «Добавить». Открывайте {name} значком с экрана — так работают уведомления о заказах.</Step>
            <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground">
              Уведомления на iPhone бывают только у приложения с экрана «Домой» (iOS 16.4 и новее). После установки откройте его и
              включите уведомления в колокольчике.
            </p>
          </ol>
        ) : mode === "ios-other" ? (
          <p className="text-[14px]">Откройте этот сайт в Safari — там есть «Поделиться → На экран «Домой»».</p>
        ) : mode === "installed" ? (
          <p className="text-[14px]">Приложение уже установлено и открыто.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            <Step n={1}>
              Откройте меню браузера <MoreVertical className="mx-0.5 inline h-4 w-4 -translate-y-0.5 text-primary" /> (три точки).
            </Step>
            <Step n={2}>Выберите «Установить приложение» или «Добавить на главный экран».</Step>
            <Step n={3}>Если пункта нет — откройте сайт в Chrome, Edge или Safari.</Step>
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}

const BANNER_KEY = "nova:install-banner-hidden-until";

/**
 * Плашка на телефоне: «Установите приложение». Только в браузере (не в
 * установленном приложении), скрыть — на 30 дней.
 */
export function InstallAppBanner() {
  const mobile = useIsMobile();
  const mode = useInstallMode();
  const { pathname } = useLocation();
  const name = brandName(useSiteConfig());
  const [hidden, setHidden] = useState(() => {
    try {
      return Number(localStorage.getItem(BANNER_KEY) ?? 0) > Date.now();
    } catch {
      return false;
    }
  });
  if (!mobile || hidden || mode === "installed" || mode === "unsupported") return null;
  // На «Заказах» у iPhone своя плашка «установите приложение» — не дублируем.
  if (isIos() && pathname.startsWith("/orders")) return null;

  const hide = () => {
    setHidden(true);
    try {
      localStorage.setItem(BANNER_KEY, String(Date.now() + 30 * 24 * 60 * 60_000));
    } catch {
      /* без localStorage — скроется до перезагрузки */
    }
  };

  return (
    // Одна строка: плашка стоит на каждом экране телефона, и две строки текста
    // съедали высоту, нужную столу.
    <div className="flex shrink-0 items-center gap-2 border-b border-border bg-primary/[0.08] py-1 pl-3 pr-1">
      <Smartphone className="h-4 w-4 shrink-0 text-primary" />
      <p className="min-w-0 flex-1 truncate text-[13px]">
        <span className="font-medium">Приложение {name}</span>
        <span className="text-muted-foreground"> · уведомления о заказах</span>
      </p>
      <Button size="sm" className="h-8 shrink-0 px-3" onClick={() => void startInstall(mode)}>
        Установить
      </Button>
      <button
        type="button"
        onClick={hide}
        aria-label="Скрыть"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
