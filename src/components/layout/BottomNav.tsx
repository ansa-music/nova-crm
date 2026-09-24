import { memo, useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router";
import { ClipboardList, Menu } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { bottomBarSlot, isHomeActive, useNavModel } from "@/hooks/useNavModel";
import { pathMatches } from "@/config/nav";
import { preloadRoute } from "@/config/pageLoaders";
import { cn } from "@/utils/cn";

/**
 * Открыта ли экранная клавиатура: visualViewport ниже трёх четвертей окна.
 * Нижняя панель под клавиатурой лишь отнимала бы у поля ввода ещё 56px.
 * Высота умножается на `scale`: при pinch-zoom visualViewport тоже
 * «сжимается», и без поправки увеличенная таблица прятала панель.
 */
export function useKeyboardOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const check = () => setOpen(vv.height * vv.scale < window.innerHeight * 0.75);
    check();
    vv.addEventListener("resize", check);
    return () => vv.removeEventListener("resize", check);
  }, []);
  return open;
}

function Tab({
  to,
  label,
  icon: Icon,
  active,
  alert,
  badge,
  onClick,
}: {
  to?: string;
  label: string;
  icon: LucideIcon;
  active?: boolean;
  alert?: boolean;
  badge?: number;
  onClick?: () => void;
}) {
  const className = cn(
    "flex h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium leading-none transition-colors duration-200",
    active ? "text-primary" : alert ? "text-success" : "text-muted-foreground"
  );
  const body = (
    <>
      <span className="relative">
        <Icon className="h-5 w-5" />
        {/* Не только цвет: точка отличает «зелёный пункт» от просто активного. */}
        {alert && !badge ? (
          <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-success motion-safe:animate-pulse" />
        ) : null}
        {badge ? (
          <span className="absolute -right-2 -top-1.5 rounded-full bg-primary px-1 py-0.5 font-mono text-[9px] font-semibold leading-none text-primary-foreground">
            {badge > 9 ? "9+" : badge}
          </span>
        ) : null}
      </span>
      <span>{label}</span>
    </>
  );
  if (to) {
    // Касание приходит раньше клика на ~100 мс — chunk страницы начинает
    // качаться уже тогда: касание пункта панели — намерение перейти (листа
    // под ним нет, тянуть нечего), поэтому без проверок «экономия трафика /
    // человек занят». Наведение и фокус — догадка, с проверками.
    const preload = () => preloadRoute(to);
    return (
      <NavLink
        to={to}
        aria-current={active ? "page" : undefined}
        className={className}
        onPointerEnter={preload}
        onPointerDown={() => preloadRoute(to, { intent: true })}
        onFocus={preload}
      >
        {body}
      </NavLink>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  );
}

/**
 * Нижняя панель телефона (≤767px). Стоит В ПОТОКЕ flex-колонки AppLayout
 * после <main>, а не fixed: иначе панель массовых действий и итоги стола
 * ложились бы под неё. Показ/скрытие решает AppLayout (полный экран стола,
 * клавиатура); лист «Ещё» и его диалоги тоже живут там — под клавиатурой
 * панель прячется, и всё, что смонтировано внутри неё, пропадало бы вместе
 * с набранным текстом.
 */
export const BottomNav = memo(function BottomNav({
  hidden = false,
  moreOpen = false,
  onMore,
}: {
  /** Спрятать, не размонтируя: клавиатура открывается и закрывается часто. */
  hidden?: boolean;
  moreOpen?: boolean;
  onMore: () => void;
}) {
  const { pathname } = useLocation();
  const nav = useNavModel();
  const home = nav.home;
  const homeActive = isHomeActive(pathname, home);
  const orders = nav.items.find((i) => i.key === "orders");
  const slot = bottomBarSlot(nav);
  const slotActive = pathMatches(pathname, slot.to) && !homeActive;
  const moreActive = !homeActive && !slotActive && !pathMatches(pathname, "/orders");
  // Бейдж «Ещё» — всё непрочитанное, что не видно на трёх других кнопках.
  const moreBadge = nav.badgeTotal - (orders?.badge ?? 0);

  return (
    // min-h, а не h: при border-box отступ под home indicator съедал высоту
    // фиксированной панели, и кнопки уезжали под полосу жеста.
    <nav
      aria-label="Нижняя панель"
      className={cn(
        "grid min-h-14 shrink-0 grid-cols-4 border-t border-border bg-background pb-[env(safe-area-inset-bottom)]",
        hidden && "hidden"
      )}
    >
      <Tab to={home.to} label={home.label} icon={home.icon} active={homeActive} alert={home.alert} />
      <Tab to={slot.to} label={slot.label} icon={slot.icon} active={slotActive} />
      <Tab to="/orders" label="Заказы" icon={ClipboardList} active={pathMatches(pathname, "/orders")} alert={nav.ordersAlert} />
      <Tab label="Ещё" icon={Menu} active={moreOpen || moreActive} badge={moreBadge} onClick={onMore} />
    </nav>
  );
});
