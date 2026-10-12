import { lazy, Suspense, useState } from "react";
import { NavLink, useLocation } from "react-router";
import { Gamepad2, Home, LayoutGrid, Table2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { MORE_ITEM_KEY, isNavItemActive, pathMatches, type NavItem } from "@/config/nav";
import { preloadRoute } from "@/config/pageLoaders";
import { TOP_NAV_KEYS, topDeskTarget } from "@/config/signatureNav";
import { useStudioMode } from "@/config/studio";
import { term, useSiteConfig } from "@/config/siteTerms";
import { isHomeActive, useNavModel } from "@/hooks/useNavModel";
import { cn } from "@/utils/cn";

const MiniGame = lazy(() => import("@/components/common/MiniGame"));

/**
 * Верхняя панель NOVA Signature — частое одним нажатием с любого экрана
 * (просьба Nurba 12.10.2026): «Мой стол», «Заказы», ABS, «График», «Промты»,
 * «Грок лимит» и кнопка-значок «Все разделы». В боковой панели этих пунктов
 * нет (`signatureTopKeys`) — одна кнопка на раздел.
 *
 * Пункты — из модели меню: чего у роли нет (или что выключено в Конструкторе),
 * того нет и здесь; бейджи и «зелёные» пункты те же.
 */
export function SignatureTopNav({ className }: { className?: string }) {
  const nav = useNavModel();
  const { pathname } = useLocation();
  useSiteConfig();
  const studio = useStudioMode();
  const desk = topDeskTarget(nav);
  const byKey = new Map(nav.items.map((i) => [i.key, i]));
  const more = byKey.get(MORE_ITEM_KEY);
  const [gameOpen, setGameOpen] = useState(false);

  const linkClass = (active: boolean, alert = false) =>
    cn(
      "relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors duration-150",
      active
        ? "bg-primary/[0.14] text-foreground shadow-[inset_0_-2px_0_hsl(var(--primary))]"
        : alert
          ? "text-success hover:bg-success/10"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
    );

  function link(to: string, label: string, Icon: LucideIcon, active: boolean, opts: { alert?: boolean; badge?: number; hint?: string } = {}) {
    return (
      <NavLink
        key={to}
        to={to}
        onPointerEnter={() => preloadRoute(to)}
        onFocus={() => preloadRoute(to)}
        className={linkClass(active, opts.alert)}
        title={opts.hint ? `${label} · ${opts.hint}` : undefined}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span>{label}</span>
        {opts.alert && !opts.badge ? <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-success" /> : null}
        {opts.badge ? (
          <span className="rounded-full bg-primary px-1.5 font-mono text-[10px] font-semibold leading-4 text-primary-foreground">
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
    return link(to, label, item.icon, isNavItemActive(item, pathname), { alert: item.alert, badge, hint: item.hint });
  }

  return (
    <nav className={cn("flex min-w-0 items-center gap-1", className)} aria-label="Быстрый доступ">
      {desk
        ? link(
            desk.to,
            `Мой ${term("desk", "one").toLowerCase()}`,
            nav.isOs ? Table2 : Home,
            nav.isOs ? pathMatches(pathname, "/os-desk") : isHomeActive(pathname, { to: nav.myDeskTo, myDeskId: nav.home.myDeskId }),
            // У ОС счётчик просьб технарей висел на пункте «Стол ОС» бокового меню —
            // пункта там больше нет, счётчик переезжает сюда.
            { alert: nav.home.alert, badge: nav.isOs ? byKey.get("os-desk")?.badge : undefined }
          )
        : null}
      {TOP_NAV_KEYS.map((key) => {
        const item = byKey.get(key);
        return item ? itemLink(item) : null;
      })}
      {/* Игра для перерыва — значок без подписи рядом с «Грок лимитом» (просьба
          Nurba 12.10.2026). Окно и сама игра грузятся только по нажатию. */}
      <button
        type="button"
        aria-label="Игра"
        title="Перерыв: игра"
        onClick={() => setGameOpen(true)}
        className={cn(linkClass(false), "w-9 justify-center px-0")}
      >
        <Gamepad2 className="h-4 w-4" />
      </button>
      {gameOpen ? (
        <Suspense fallback={null}>
          <MiniGame open onOpenChange={setGameOpen} />
        </Suspense>
      ) : null}
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
    </nav>
  );
}
