import { NavLink, useLocation } from "react-router";
import { ChevronRight, Search } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { MORE_SECTION_KEY, isNavItemActive, type NavItem } from "@/config/nav";
import { preloadRoute } from "@/config/pageLoaders";
import { useNavModel } from "@/hooks/useNavModel";
import { cn } from "@/utils/cn";

/**
 * «Ещё» — отдельная страница со всеми разделами, которых нет в быстром
 * доступе меню (просьба Nurba 25.09.2026: «в левой части слишком много
 * кнопок — оставить нужные, остальное в отдельное меню»). Плитки — из той
 * же навигационной модели (секция «Остальное»), с теми же бейджами: список
 * один, разъехаться нечему. Секция на странице: «Люди», «Связь», «Настройки».
 */
const GROUPS: Array<{ title: string; keys: string[] }> = [
  { title: "Работа", keys: ["reports", "os-dispatch", "desk-editing", "telegram-admin", "dispatch"] },
  { title: "Люди", keys: ["people", "team", "users"] },
  { title: "Связь", keys: ["announcements"] },
  { title: "Настройки", keys: ["settings"] },
];

const DESCRIPTIONS: Record<string, string> = {
  dashboard: "Рейтинги, KPI месяца, заказы по дням",
  reports: "Касса технарей и KPI ОС за прошлые периоды",
  "os-dispatch": "Журнал выборочных выдач ОС",
  "desk-editing": "Кто заполняет столы технарей",
  "telegram-admin": "Рабочий Telegram: кому из ОС открыт и ключи",
  dispatch: "Старая выдача",
  people: "Участники и их столы",
  team: "Технари, ОС и ники",
  users: "Роли, доступы, заявки на вход",
  schedule: "Смены, выходные, неделя",
  messages: "Личные переписки",
  chat: "Общий чат workspace",
  announcements: "Объявления команде",
  settings: "Профиль, касса, хранилища",
};

export default function MorePage() {
  const nav = useNavModel();
  const { pathname } = useLocation();
  const section = nav.sections.find((s) => s.key === MORE_SECTION_KEY);
  const items = section?.items ?? [];
  const byKey = new Map(items.map((i) => [i.key, i]));
  const groups = GROUPS.map((g) => ({ title: g.title, items: g.keys.map((k) => byKey.get(k)).filter((i): i is NavItem => Boolean(i)) })).filter(
    (g) => g.items.length > 0
  );
  // Пункты модели, которых нет в группах (появятся позже), — в конец.
  const grouped = new Set(GROUPS.flatMap((g) => g.keys));
  const rest = items.filter((i) => !grouped.has(i.key));
  if (rest.length > 0) groups.push({ title: "Другое", items: rest });

  return (
    <div className="mx-auto w-full min-w-0 max-w-4xl p-5 sm:p-8">
      <PageHeader
        eyebrow="Nova"
        title="Ещё"
        description="Остальные разделы. Частое — в меню слева: стол, заказы, технари, столы ОС, Грок лимит, чат, график, дашборд и ABS."
        actions={
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("nova:command-palette"))}
            className="flex min-h-11 items-center gap-2 rounded-lg border border-border bg-card px-3 text-[13px] text-muted-foreground hover:text-foreground sm:min-h-9"
          >
            <Search className="h-3.5 w-3.5" />
            Поиск и переход
            <kbd className="hidden rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px] sm:inline">Ctrl K</kbd>
          </button>
        }
      />
      <div className="flex flex-col gap-6">
        {groups.map((group) => (
          <section key={group.title} className="flex flex-col gap-2">
            <p className="eyebrow px-0.5">{group.title}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = isNavItemActive(item, pathname);
                return (
                  <NavLink
                    key={item.key}
                    to={item.to}
                    onPointerEnter={() => preloadRoute(item.to)}
                    onFocus={() => preloadRoute(item.to)}
                    className={cn(
                      "flex min-h-[64px] items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                      active ? "border-primary/40 bg-primary/[0.08]" : "border-border bg-card hover:border-primary/40 hover:bg-accent"
                    )}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[14px] font-medium">{item.label}</span>
                        {item.badge ? (
                          <span className="shrink-0 rounded-full bg-primary px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none text-primary-foreground">
                            {item.badge > 9 ? "9+" : item.badge}
                          </span>
                        ) : null}
                      </span>
                      {DESCRIPTIONS[item.key] ? (
                        <span className="block truncate text-[12px] text-muted-foreground">{DESCRIPTIONS[item.key]}</span>
                      ) : null}
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </NavLink>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
