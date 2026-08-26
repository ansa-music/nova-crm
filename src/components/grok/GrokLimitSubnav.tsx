import { NavLink } from "react-router";
import { cn } from "@/utils/cn";

const ITEMS = [
  { to: "/grok-limit", label: "Grok", end: true },
  { to: "/grok-limit/apps", label: "Подписки", end: false },
] as const;

export function GrokLimitSubnav() {
  return (
    <nav className="flex items-center gap-1 rounded-lg border border-border/70 bg-background/40 p-0.5" aria-label="Грок лимит">
      {ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              isActive ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
