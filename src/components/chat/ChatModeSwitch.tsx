import { LayoutDashboard, MessageCircle, MessageSquare, Trophy } from "lucide-react";
import { PageModeSwitch } from "@/components/common/PageModeSwitch";
import { useNavModel } from "@/hooks/useNavModel";

/**
 * «Общий / Личные» — переключатель одного пункта меню «Чат» (просьба Nurba
 * 25.09.2026: «чат в быстром доступе — одна страница, внутри переключиться
 * на общий и личный»). Адреса прежние (`/chat` и `/messages`), чтобы ссылки
 * из уведомлений, с «Технарей» и старые закладки вели куда вели. Счётчики —
 * из навигационной модели: там уже одна подписка на непрочитанное.
 */
export function ChatModeSwitch({ className }: { className?: string }) {
  const { chatUnread } = useNavModel();
  return (
    <PageModeSwitch
      label="Чат"
      className={className}
      tabs={[
        { to: "/chat", label: "Общий", icon: MessageSquare, count: chatUnread.workspace },
        { to: "/messages", label: "Личные", icon: MessageCircle, count: chatUnread.private },
      ]}
    />
  );
}

/**
 * «Дашборд / ABS система» — один пункт меню «Дашборд · ABS» (просьба Nurba
 * 25.09.2026: «объедини так же Дашборд и ABS систему в одну вкладку»).
 */
export function StatsModeSwitch({ className }: { className?: string }) {
  return (
    <PageModeSwitch
      label="Дашборд и ABS"
      className={className}
      tabs={[
        { to: "/dashboard", label: "Дашборд", icon: LayoutDashboard },
        { to: "/abs", label: "ABS система", icon: Trophy },
      ]}
    />
  );
}
