import { NavLink } from "react-router";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/utils/cn";

export interface PageModeTab {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Счётчик справа (0 — не рисуется). */
  count?: number;
}

/**
 * Переключатель двух страниц, которые в меню — ОДИН пункт (просьба Nurba
 * 25.09.2026): «Чат» = «Общий / Личные», «Дашборд · ABS» = «Дашборд / ABS
 * система». Адреса у страниц остаются свои, чтобы старые ссылки вели куда
 * вели; переключатель — обычные ссылки с подсветкой текущей.
 */
export function PageModeSwitch({ tabs, label, className }: { tabs: PageModeTab[]; label: string; className?: string }) {
  return (
    <nav className={cn("inline-flex w-fit rounded-lg border border-border p-0.5", className)} aria-label={label}>
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          className={({ isActive }) =>
            cn(
              "inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors sm:h-8",
              isActive ? "bg-primary/[0.12] text-primary" : "text-muted-foreground hover:text-foreground"
            )
          }
        >
          <tab.icon className="h-3.5 w-3.5" />
          {tab.label}
          {tab.count ? (
            <span className="rounded-full bg-primary px-1.5 font-mono text-[10px] font-semibold leading-4 text-primary-foreground">
              {tab.count > 9 ? "9+" : tab.count}
            </span>
          ) : null}
        </NavLink>
      ))}
    </nav>
  );
}
