import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router";
import { ClipboardList, LayoutGrid, Menu, Table2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useNavModel } from "@/hooks/useNavModel";
import { pathMatches } from "@/config/nav";
import { cn } from "@/utils/cn";
import { MoreSheet } from "@/components/layout/MoreSheet";

/**
 * Открыта ли экранная клавиатура: visualViewport ниже трёх четвертей окна.
 * Нижняя панель под клавиатурой лишь отнимала бы у поля ввода ещё 56px.
 */
export function useKeyboardOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const check = () => setOpen(vv.height < window.innerHeight * 0.75);
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
    "flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium leading-none transition-colors duration-200",
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
    return (
      <NavLink to={to} aria-current={active ? "page" : undefined} className={className}>
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
 * клавиатура) — здесь только четыре кнопки и лист «Ещё».
 */
export function BottomNav() {
  const { pathname } = useLocation();
  const nav = useNavModel();
  const [moreOpen, setMoreOpen] = useState(false);
  const home = nav.home;
  const orders = nav.items.find((i) => i.key === "orders");
  // «Стол»: у ОС — личный стол ОС, у остальных — список столов (свой стол и
  // так стоит «Главной»; две кнопки на один адрес путали бы). Кому «Столы»
  // закрыты (Тимлид без Технаря) — «Столы ОС», они видны всем.
  const desksItem = nav.items.find((i) => i.key === "desks");
  const deskTo = nav.isOs ? "/os-desk" : (desksItem?.to ?? "/os-desks");
  const deskLabel = nav.isOs ? "Стол ОС" : desksItem ? "Столы" : "Столы ОС";
  const deskActive = pathMatches(pathname, deskTo) && !home.active;
  const moreActive = !home.active && !deskActive && !pathMatches(pathname, "/orders");
  // Бейдж «Ещё» — всё непрочитанное, что не видно на трёх других кнопках.
  const moreBadge = nav.badgeTotal - (orders?.badge ?? 0);

  return (
    <>
      <nav
        aria-label="Нижняя панель"
        className="grid h-14 shrink-0 grid-cols-4 border-t border-border bg-background pb-[env(safe-area-inset-bottom)]"
      >
        <Tab to={home.to} label={home.label} icon={home.icon} active={home.active} alert={home.alert} />
        <Tab to={deskTo} label={deskLabel} icon={nav.isOs ? Table2 : LayoutGrid} active={deskActive} />
        <Tab to="/orders" label="Заказы" icon={ClipboardList} active={pathMatches(pathname, "/orders")} alert={nav.ordersAlert} />
        <Tab label="Ещё" icon={Menu} active={moreOpen || moreActive} badge={moreBadge} onClick={() => setMoreOpen(true)} />
      </nav>
      <MoreSheet open={moreOpen} onOpenChange={setMoreOpen} />
    </>
  );
}
