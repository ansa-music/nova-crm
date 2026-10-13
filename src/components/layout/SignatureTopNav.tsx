import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router";
import { Gamepad2, Home, LayoutGrid, LayoutList, Table2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { MORE_ITEM_KEY, isNavItemActive, pathMatches, type NavItem } from "@/config/nav";
import { preloadRoute } from "@/config/pageLoaders";
import { TOP_NAV_KEYS, topAllDesksTarget, topDeskTarget } from "@/config/signatureNav";
import { useStudioMode } from "@/config/studio";
import { term, useSiteConfig } from "@/config/siteTerms";
import { useAuth } from "@/hooks/useAuth";
import { isHomeActive, useNavModel } from "@/hooks/useNavModel";
import { osDeskId } from "@/services/osDeskService";
import { cn } from "@/utils/cn";
import { openMiniGame } from "@/components/common/MiniGameHost";

/**
 * Верхняя панель NOVA Signature — частое одним нажатием с любого экрана
 * (просьба Nurba 12.10.2026): «Мой стол», «Заказы», ABS, «График», «Промты»,
 * «Грок лимит» и кнопка-значок «Все разделы». В боковой панели этих пунктов
 * нет (`signatureTopKeys`) — одна кнопка на раздел.
 *
 * 13.10.2026 (просьба Nurba: «кнопки неудобно — сделай по центру, подсвети
 * „Мой стол“ и „Заказы“, добавь „Все столы“»): ряд стоит ПО ЦЕНТРУ панели;
 * две главные кнопки — заливкой акцента всегда, а на своём экране — сплошной;
 * «Все столы» — сразу за «Заказами» (`topAllDesksTarget`).
 *
 * Пункты — из модели меню: чего у роли нет (или что выключено в Конструкторе),
 * того нет и здесь; бейджи и «зелёные» пункты те же.
 */
export function SignatureTopNav({ className }: { className?: string }) {
  const nav = useNavModel();
  const { profile } = useAuth();
  const { pathname } = useLocation();
  useSiteConfig();
  const studio = useStudioMode();
  const desk = topDeskTarget(nav);
  const allDesks = topAllDesksTarget(nav.items);
  const byKey = new Map(nav.items.map((i) => [i.key, i]));
  const more = byKey.get(MORE_ITEM_KEY);

  /**
   * `main` — главная кнопка («Мой стол», «Заказы»): видна всегда (заливка и
   * кольцо акцента), на своём экране — сплошная. Остальные — как были:
   * приглушённые, на своём экране — заливка с чертой снизу.
   */
  const linkClass = (active: boolean, alert = false, main = false) =>
    cn(
      "relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors duration-150",
      main
        ? active
          ? "bg-primary text-primary-foreground"
          : alert
            ? "bg-success/10 text-success ring-1 ring-inset ring-success/35 hover:bg-success/[0.16]"
            : "bg-primary/[0.12] text-primary ring-1 ring-inset ring-primary/35 hover:bg-primary/20"
        : active
          ? "bg-primary/[0.14] text-foreground shadow-[inset_0_-2px_0_hsl(var(--primary))]"
          : alert
            ? "text-success hover:bg-success/10"
            : "text-muted-foreground hover:bg-accent hover:text-foreground"
    );

  function link(
    to: string,
    label: string,
    Icon: LucideIcon,
    active: boolean,
    opts: { alert?: boolean; badge?: number; hint?: string; main?: boolean } = {}
  ) {
    // На сплошной кнопке бейдж цвета акцента слился бы с фоном — рисуем его тёмным.
    const solid = Boolean(opts.main && active);
    return (
      <NavLink
        key={to}
        to={to}
        onPointerEnter={() => preloadRoute(to)}
        onFocus={() => preloadRoute(to)}
        className={linkClass(active, opts.alert, opts.main)}
        title={opts.hint ? `${label} · ${opts.hint}` : undefined}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span>{label}</span>
        {opts.alert && !opts.badge ? (
          <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", solid ? "bg-primary-foreground" : "bg-success")} />
        ) : null}
        {opts.badge ? (
          <span
            className={cn(
              "rounded-full px-1.5 font-mono text-[10px] font-semibold leading-4",
              solid ? "bg-primary-foreground/20 text-primary-foreground" : "bg-primary text-primary-foreground"
            )}
          >
            {opts.badge > 9 ? "9+" : opts.badge}
          </span>
        ) : null}
      </NavLink>
    );
  }

  function itemLink(item: NavItem) {
    // «Дашборд · ABS» в панели — «ABS»: ведёт туда, куда ведёт модель (к оценке
    // недели, пока есть кого оценить), внутри — переключатель «Дашборд / ABS / Оценки».
    const isStats = item.key === "dashboard";
    const to = isStats && !studio && item.to === "/dashboard" ? "/abs" : item.to;
    const label = isStats && !studio ? "ABS" : item.label;
    const badge = item.key === "orders" ? nav.openOrdersCount || item.badge : item.badge;
    return link(to, label, item.icon, isNavItemActive(item, pathname), {
      alert: item.alert,
      badge,
      hint: item.hint,
      main: item.key === "orders",
    });
  }

  const items: ReactNode[] = [];
  if (desk) {
    items.push(
      link(
        desk.to,
        `Мой ${term("desk", "one").toLowerCase()}`,
        nav.isOs ? Table2 : Home,
        // У ОС «/os-desk» сразу уводит на сам стол — `/page/osdesk_{uid}`: кнопка горит и там.
        nav.isOs
          ? pathMatches(pathname, "/os-desk") || Boolean(profile?.uid && pathname === `/page/${osDeskId(profile.uid)}`)
          : isHomeActive(pathname, { to: nav.myDeskTo, myDeskId: nav.home.myDeskId }),
        // У ОС счётчик просьб технарей висел на пункте «Стол ОС» бокового меню —
        // пункта там больше нет, счётчик переезжает сюда.
        { alert: nav.home.alert, badge: nav.isOs ? byKey.get("os-desk")?.badge : undefined, main: true }
      )
    );
  }
  for (const key of TOP_NAV_KEYS) {
    const item = byKey.get(key);
    if (item) items.push(itemLink(item));
    // «Все столы» — сразу за «Заказами»: столы технарей и столы ОС в одном месте.
    if (key === "orders" && allDesks) {
      items.push(link(allDesks.to, `Все ${term("desk", "many").toLowerCase()}`, LayoutList, allDesks.activeOn(pathname)));
    }
  }

  return (
    <nav className={cn("flex min-w-0", className)} aria-label="Быстрый доступ">
      {/* Ряд по центру панели. Авто-отступы, а не justify-center: когда кнопки
          не помещаются, отступы схлопываются в ноль и ряд прокручивается с
          начала — при justify-center левый край уехал бы за границу. */}
      <div className="mx-auto flex shrink-0 items-center gap-1">
      {items}
      {/* Игра для перерыва — значок без подписи рядом с «Грок лимитом» (просьба
          Nurba 12.10.2026). Окно держит `MiniGameHost` в каркасе; игра грузится по нажатию. */}
      <button
        type="button"
        aria-label="Игра"
        title="Перерыв: игра"
        onClick={openMiniGame}
        className={cn(linkClass(false), "w-9 justify-center px-0")}
      >
        <Gamepad2 className="h-4 w-4" />
      </button>
      {more ? (
        <NavLink
          to={more.to}
          onPointerEnter={() => preloadRoute(more.to)}
          aria-label="Все разделы"
          title="Все разделы"
          className={cn(linkClass(isNavItemActive(more, pathname)), "ml-1 w-9 justify-center px-0")}
        >
          <LayoutGrid className="h-4 w-4" />
          {more.badge ? <span aria-hidden className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-primary" /> : null}
        </NavLink>
      ) : null}
      </div>
    </nav>
  );
}
