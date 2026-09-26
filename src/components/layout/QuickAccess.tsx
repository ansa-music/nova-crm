import { NavLink, useLocation } from "react-router";
import { ClipboardList, Home, Table2 } from "lucide-react";
import { pathMatches } from "@/config/nav";
import { preloadRoute } from "@/config/pageLoaders";
import { isHomeActive, useNavModel } from "@/hooks/useNavModel";
import { cn } from "@/utils/cn";
import { term, useSiteConfig } from "@/config/siteTerms";

/**
 * «Мой стол · Заказы» — две главные кнопки там, где бокового меню нет
 * (просьба Nurba 25.09.2026: «заказы — как главная, с удобным доступом из
 * любой части сайта, как и кнопка „Мой стол“ для ОС и технарей»): полоса
 * стола на весь экран и шапка планшета. На телефоне те же кнопки стоят в
 * нижней панели, на десктопе — первыми пунктами меню.
 *
 * «Мой стол» — только у того, у кого он есть: технарь (свой стол) и ОС (стол
 * ОС). «Заказы» — у всех; горят зелёным, пока на бирже есть открытый заказ.
 */
export function QuickAccess({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const nav = useNavModel();
  const { pathname } = useLocation();
  useSiteConfig();
  const ordersItem = nav.items.find((i) => i.key === "orders");
  const osDeskItem = nav.items.find((i) => i.key === "os-desk");
  const deskTo = nav.isOs
    ? osDeskItem
      ? "/os-desk"
      : null
    : nav.home.myDeskId
      ? nav.myDeskTo
      : null;
  const myDeskLabel = `Мой ${term("desk", "one").toLowerCase()}`;
  const ordersLabel = ordersItem?.label ?? term("order", "many");
  const deskActive = deskTo
    ? nav.isOs
      ? pathMatches(pathname, "/os-desk")
      : isHomeActive(pathname, {
          to: nav.myDeskTo,
          myDeskId: nav.home.myDeskId,
        })
    : false;
  const ordersActive = pathMatches(pathname, "/orders");
  const DeskIcon = nav.isOs ? Table2 : Home;

  const itemClass = (active: boolean, alert = false) =>
    cn(
      "relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-semibold transition-colors",
      active
        ? "bg-primary/[0.14] text-primary"
        : alert
          ? "text-success hover:bg-success/10"
          : "text-foreground hover:bg-accent",
    );

  return (
    <nav
      className={cn("flex items-center gap-1", className)}
      aria-label="Быстрый доступ"
    >
      {deskTo ? (
        <NavLink
          to={deskTo}
          onPointerEnter={() => preloadRoute(deskTo)}
          className={itemClass(deskActive, nav.home.alert)}
          title={myDeskLabel}
        >
          <DeskIcon className="h-4 w-4" />
          {compact ? null : <span>{myDeskLabel}</span>}
          {nav.home.alert ? (
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-success" />
          ) : null}
        </NavLink>
      ) : null}
      {ordersItem ? (
        <NavLink
          to="/orders"
          onPointerEnter={() => preloadRoute("/orders")}
          className={itemClass(ordersActive, nav.ordersAlert)}
          title={
            nav.openOrdersCount > 0
              ? `${ordersLabel} · открытых ${nav.openOrdersCount}`
              : ordersLabel
          }
        >
          <ClipboardList className="h-4 w-4" />
          {compact ? null : <span>{ordersLabel}</span>}
          {nav.openOrdersCount > 0 ? (
            <span className="rounded-full bg-success px-1.5 font-mono text-[10px] font-semibold leading-4 text-background">
              {nav.openOrdersCount > 9 ? "9+" : nav.openOrdersCount}
            </span>
          ) : null}
        </NavLink>
      ) : null}
    </nav>
  );
}
