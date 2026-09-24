import { useEffect, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, ClipboardList, PackageCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/cn";
import type { Notification } from "@/types";

/**
 * Окно заказа поверх ЛЮБОГО экрана (просьба Nurba 25.09.2026: «когда
 * выдаётся заказ, он приходит окошком в любую часть сайта с кнопкой перейти
 * на заказ»). Тост в углу для этого мал: его не замечают в полноэкранной
 * таблице, и он гаснет через 12 с.
 *
 * Показывается по уведомлению о заказе (`useNotificationAlerts` →
 * `showOrderPopup`): «Вам выдан заказ» — крупно, «Новый заказ» (на бирже) —
 * тоже. Висит, пока не нажмут «Перейти» или «Позже»; второе окно за это время
 * встаёт в очередь. Не модальное: под ним можно продолжать работать, Escape
 * убирает. Живёт в `AppLayout` (`OrderPopupHost`) — там же, где остальные
 * мосты уведомлений.
 */
export interface OrderPopupItem {
  id: string;
  title: string;
  body: string;
  href: string;
  /** «Вам выдан заказ» — самое важное: другой цвет и подпись. */
  assigned: boolean;
}

let queue: OrderPopupItem[] = [];
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

export function showOrderPopup(item: OrderPopupItem) {
  if (queue.some((q) => q.id === item.id)) return;
  queue = [...queue, item];
  emit();
}

function dismissOrderPopup(id: string) {
  queue = queue.filter((q) => q.id !== id);
  emit();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function snapshot() {
  return queue;
}

/** Уведомление про заказ → окно. «Отклик» и «отозван» — не окно, а обычный тост. */
export function orderPopupOf(n: Notification): OrderPopupItem | null {
  const href = typeof n.href === "string" && n.href.startsWith("/orders") ? n.href : null;
  if (!href) return null;
  const assigned = /^Вам выдан заказ/i.test(n.title);
  const fresh = /^Новый заказ/i.test(n.title) || /открыт всем/i.test(n.title);
  if (!assigned && !fresh) return null;
  return { id: n.id, title: n.title, body: n.body, href, assigned };
}

export function OrderPopupHost() {
  const items = useSyncExternalStore(subscribe, snapshot, snapshot);
  const navigate = useNavigate();
  const current = items[0] ?? null;
  const rest = items.length - 1;
  // Появление: чуть снизу, чтобы взгляд зацепился, но без прыжка.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!current) {
      setShown(false);
      return;
    }
    const t = window.setTimeout(() => setShown(true), 20);
    return () => window.clearTimeout(t);
  }, [current?.id]);

  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismissOrderPopup(current.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current?.id]);

  if (!current) return null;
  const Icon = current.assigned ? PackageCheck : ClipboardList;
  return (
    <div
      role="status"
      aria-live="assertive"
      className={cn(
        // Над всем (диалоги z-[310], тосты у sonner ниже), но без затемнения:
        // окно зовёт к заказу, а не запирает экран.
        "pointer-events-none fixed inset-x-0 top-3 z-[400] flex justify-center px-3 sm:top-5",
        "transition-[opacity,transform] duration-200 ease-out",
        shown ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"
      )}
    >
      <div
        className={cn(
          "pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border bg-popover p-3.5 text-popover-foreground shadow-lg sm:p-4",
          current.assigned ? "border-success/50 shadow-[0_0_0_4px_hsl(var(--success)/0.15)]" : "border-primary/45 shadow-[0_0_0_4px_hsl(var(--primary)/0.12)]"
        )}
      >
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
            current.assigned ? "bg-success/15 text-success" : "bg-primary/15 text-primary"
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="eyebrow">{current.assigned ? "Вам выдан заказ" : "Новый заказ на «Заказах»"}</p>
          <p className="mt-0.5 text-[15px] font-semibold leading-snug">{current.title.replace(/^(Вам выдан заказ|Новый заказ):\s*/i, "")}</p>
          {current.body ? <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{current.body}</p> : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              className={cn("min-h-11 gap-1.5 sm:min-h-9", current.assigned && "bg-success text-success-foreground hover:bg-success/90")}
              onClick={() => {
                dismissOrderPopup(current.id);
                navigate(current.href);
              }}
            >
              Перейти к заказу <ArrowRight className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" className="min-h-11 sm:min-h-9" onClick={() => dismissOrderPopup(current.id)}>
              Позже
            </Button>
            {rest > 0 ? <span className="ml-auto text-[11px] text-muted-foreground">ещё {rest}</span> : null}
          </div>
        </div>
        <button
          type="button"
          aria-label="Закрыть"
          onClick={() => dismissOrderPopup(current.id)}
          className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
