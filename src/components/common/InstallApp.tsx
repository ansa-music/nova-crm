import { useEffect, useState, useSyncExternalStore } from "react";
import { Download, MoreVertical, PlusSquare, Share, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import { brandName, useSiteConfig } from "@/config/siteTerms";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useLocation } from "react-router";
import { cn } from "@/utils/cn";
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
/** Сколько плашка стоит на экране, прежде чем свернуться в значок. */
const STRIP_MS = 2000;
/** Длительность сворачивания (совпадает с `duration-300` у плашки). */
const STRIP_CLOSE_MS = 300;
/** Сколько значок «пульсирует» после того, как плашка в него свернулась. */
const ICON_PING_MS = 2400;

/**
 * Плашка «отыграла» — с этого момента в шапке стоит значок установки
 * (`InstallAppIcon`). Состояние одно на загрузку страницы и общее у плашки и
 * значка: они живут в разных местах каркаса (AppLayout, Topbar, Sidebar).
 */
let stripDone = false;
/** До какого момента значок пульсирует: только если плашка свернулась на глазах. */
let iconPingUntil = 0;
const stripListeners = new Set<() => void>();
function finishStrip(collapsed = false) {
  if (stripDone) return;
  stripDone = true;
  if (collapsed) iconPingUntil = Date.now() + ICON_PING_MS;
  for (const listener of [...stripListeners]) listener();
}
function subscribeStrip(listener: () => void) {
  stripListeners.add(listener);
  return () => stripListeners.delete(listener);
}
const stripSnapshot = () => stripDone;
function useStripDone(): boolean {
  return useSyncExternalStore(subscribeStrip, stripSnapshot, stripSnapshot);
}

/**
 * Есть ли что предлагать: на телефоне — всегда (кроме уже установленного), на
 * компьютере — только там, где браузер ставит приложение сам одним нажатием
 * (Chrome, Edge, Яндекс). В остальных — пункт «Установить приложение» в меню
 * аккаунта.
 */
function installOffered(mode: InstallMode, mobile: boolean): boolean {
  if (mode === "installed" || mode === "unsupported") return false;
  return mobile || mode === "prompt";
}

/**
 * Плашка «Приложение Nova · Установить». Просьба Nurba 14.10.2026: «убери
 * навязчивую вывеску — пусть появляется как раньше, но через 2 секунды
 * сворачивается в значок с подсветкой, откуда можно скачать». Плашка стоит
 * `STRIP_MS` после того, как приложение её предложило, и сворачивается сама;
 * дальше до перезагрузки — только значок в шапке. Пока на плашке курсор, палец
 * или фокус, она ждёт: иначе «Установить» уезжало бы из-под нажатия.
 * «×» — не показывать плашку 30 дней (значок остаётся).
 */
export function InstallAppBanner() {
  const mobile = useIsMobile();
  const mode = useInstallMode();
  const { pathname } = useLocation();
  const name = brandName(useSiteConfig());
  const done = useStripDone();
  const [closing, setClosing] = useState(false);
  const [hold, setHold] = useState(false);
  const [dismissed] = useState(() => {
    try {
      return Number(localStorage.getItem(BANNER_KEY) ?? 0) > Date.now();
    } catch {
      return false;
    }
  });
  const offered = installOffered(mode, mobile);
  const suppressed =
    dismissed ||
    // На «Заказах» у iPhone своя плашка «установите приложение» — не дублируем.
    (isIos() && pathname.startsWith("/orders")) ||
    // Стол на телефоне — рабочий экран: полоса над списком сдвигала бы заказы.
    // Ровно «/os-desk» (переход на свой стол ОС), не «/os-desks» — там список.
    (mobile && (pathname.startsWith("/page/") || pathname === "/os-desk"));
  // «/» — только переход на дом человека (HomePage сразу уводит дальше). Пока
  // он не кончился, не решаем: иначе у технаря плашка мигала бы перед столом.
  const pending = pathname === "/";
  const visible = offered && !done && !suppressed && !pending;

  // Плашке здесь не место (скрыта на 30 дней, стол, «Заказы» на iPhone) —
  // сразу значок: всплывать позже, на случайном переходе, она не должна.
  useEffect(() => {
    if (offered && !done && suppressed && !pending) finishStrip();
  }, [offered, done, suppressed, pending]);

  useEffect(() => {
    if (!visible || hold || closing) return;
    const timer = window.setTimeout(() => setClosing(true), STRIP_MS);
    return () => window.clearTimeout(timer);
  }, [visible, hold, closing]);

  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(() => finishStrip(true), STRIP_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [closing]);

  if (!visible) return null;

  const hide = () => {
    try {
      localStorage.setItem(BANNER_KEY, String(Date.now() + 30 * 24 * 60 * 60_000));
    } catch {
      /* без localStorage — скроется до перезагрузки */
    }
    finishStrip();
  };

  return (
    // Сворачивание — высотой строки сетки (1fr → 0fr): высоту плашки знать не
    // нужно, а контент под ней поднимается плавно.
    <div
      data-install-banner
      className={cn(
        "grid shrink-0 transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
        closing ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"
      )}
      onPointerEnter={() => setHold(true)}
      onPointerLeave={() => setHold(false)}
      onFocusCapture={() => setHold(true)}
      onBlurCapture={() => setHold(false)}
    >
      <div className="min-h-0 overflow-hidden">
        {/* Одна строка: две строки текста съедали высоту, нужную экрану. */}
        <div className="flex items-center gap-2 border-b border-border bg-primary/[0.08] py-1 pl-3 pr-1">
          <Smartphone className="h-4 w-4 shrink-0 text-primary" />
          <p className="min-w-0 flex-1 truncate text-[13px]">
            <span className="font-medium">Приложение {name}</span>
            <span className="text-muted-foreground">
              {mobile ? " · уведомления о заказах" : " · своё окно, значок на рабочем столе и уведомления о заказах"}
            </span>
          </p>
          <Button
            size="sm"
            className="h-8 shrink-0 px-3"
            onClick={() => {
              finishStrip();
              void startInstall(mode);
            }}
          >
            Установить
          </Button>
          <button
            type="button"
            onClick={hide}
            aria-label="Скрыть"
            title="Не показывать плашку 30 дней — значок установки останется в шапке"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Значок установки в шапке — во что сворачивается плашка. Стоит, пока
 * приложение можно поставить; нажатие — то же, что «Установить» на плашке
 * (окно браузера одним нажатием, а где его нет — шаги). Подсвечен всегда
 * (акцент и мягкое кольцо, как «Статистика» стола); пульсирует только первые
 * секунды после того, как плашка свернулась на глазах — видно, куда она ушла.
 */
export function InstallAppIcon({ className }: { className?: string }) {
  const mobile = useIsMobile();
  const mode = useInstallMode();
  const done = useStripDone();
  const shown = done && installOffered(mode, mobile);
  const [fresh, setFresh] = useState(false);

  useEffect(() => {
    const left = iconPingUntil - Date.now();
    if (!shown || left <= 0) return;
    setFresh(true);
    const timer = window.setTimeout(() => setFresh(false), left);
    return () => window.clearTimeout(timer);
  }, [shown]);

  if (!shown) return null;

  return (
    <button
      type="button"
      data-install-app-icon
      title="Установить приложение"
      aria-label="Установить приложение"
      onClick={() => void startInstall(mode)}
      className={cn("group relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-primary", className)}
    >
      {fresh ? <span aria-hidden className="absolute h-8 w-8 rounded-lg bg-primary/30 motion-safe:animate-ping" /> : null}
      <span className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-primary/45 bg-primary/12 shadow-[0_0_0_3px_hsl(var(--primary)/0.12)] transition-colors group-hover:bg-primary/20">
        <Download className="h-4 w-4" />
      </span>
    </button>
  );
}
