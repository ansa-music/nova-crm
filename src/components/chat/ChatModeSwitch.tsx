import { NavLink } from "react-router";
import { MessageCircle, MessageSquare } from "lucide-react";
import { useNavModel } from "@/hooks/useNavModel";
import { cn } from "@/utils/cn";

/**
 * «Общий / Личные» — переключатель одного пункта меню «Чат» (просьба Nurba
 * 25.09.2026: «чат в быстром доступе — одна страница, внутри переключиться
 * на общий и личный»). Адреса прежние (`/chat` и `/messages`), чтобы ссылки
 * из уведомлений, с «Технарей» и старые закладки вели куда вели. Счётчики —
 * из навигационной модели: там уже одна подписка на непрочитанное.
 */
export function ChatModeSwitch({ className }: { className?: string }) {
  const { chatUnread } = useNavModel();
  const tabs = [
    { to: "/chat", label: "Общий", icon: MessageSquare, count: chatUnread.workspace },
    { to: "/messages", label: "Личные", icon: MessageCircle, count: chatUnread.private },
  ];
  return (
    <nav className={cn("inline-flex rounded-lg border border-border p-0.5", className)} aria-label="Чат">
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
          {tab.count > 0 && (
            <span className="rounded-full bg-primary px-1.5 font-mono text-[10px] font-semibold leading-4 text-primary-foreground">
              {tab.count > 9 ? "9+" : tab.count}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
