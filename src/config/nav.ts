import type { LucideIcon } from "lucide-react";

/**
 * Единая модель навигации — типы и статические таблицы. Живую модель (с
 * гейтами по ролям, бейджами и «где дом») собирает `useNavModel`
 * (`hooks/useNavModel.ts`); её рисуют Sidebar, BottomNav, MoreSheet, палитра
 * Ctrl+K и G-аккорды. Раньше «где дом» лежало в HomePage и Sidebar порознь,
 * а список разделов — только в Sidebar, и палитра поиска знала половину.
 * «Закрыть drawer/лист после перехода» — забота того, кто рисует пункт:
 * модель общая, и колбэк одного меню в ней не живёт.
 */

/** Пункт меню. `show: false` — пункта у этой роли нет (модель его отфильтрует). */
export interface NavItem {
  key: string;
  to: string;
  label: string;
  icon: LucideIcon;
  show?: boolean;
  /** Счётчик (непрочитанные, непросмотренные выдачи). */
  badge?: number;
  /** Зелёная подсветка «здесь вас ждёт заказ». */
  alert?: boolean;
  /**
   * Активность считается не по `to` (дом активен и на «/», и на своём столе).
   * Функция пути, а не готовый флаг: модель одна на приложение и от адреса не
   * зависит — иначе каждый переход пересобирал бы её и перерисовывал всё меню.
   */
  activeOn?: (pathname: string) => boolean;
  /** Точное совпадение пути, без вложенных. */
  end?: boolean;
  /** Подпункты — закреплённые и недавние столы под «Столами». */
  children?: NavChild[];
  /**
   * Подпись-подсказка справа от названия: у «Грок лимита» — «3 из 8»
   * доступных аккаунтов. Не счётчик-бейдж (тот про непрочитанное).
   */
  hint?: string;
  /** Жирная строка меню — «Грок лимит»: частая функция, её ищут глазами. */
  emphasis?: boolean;
}

/** Подпункт (стол): цвет — HSL-триплет обложки, как у `page.color`. */
export interface NavChild {
  key: string;
  to: string;
  label: string;
  icon: LucideIcon;
  color?: string;
}

/**
 * Секция меню: работа → столы → люди → связь → остальное. «Ещё» свёрнута по
 * умолчанию — там то, что открывают раз в неделю.
 */
export interface NavSection {
  key: string;
  title?: string;
  items: NavItem[];
  /** Можно свернуть; состояние помнится в localStorage (`NAV_SECTIONS_KEY`). */
  collapsible?: boolean;
  defaultOpen?: boolean;
}

/** Заголовок экрана для шапки телефона и `document.title`. */
export interface PageMeta {
  title: string;
  /** Надзаголовок — секция меню («Столы», «Связь») или «Nova». */
  eyebrow: string;
}

export const NAV_SECTIONS_KEY = "nova:nav-sections";

/** Ключ пункта секции «Столы», под которым висят закреплённые/недавние столы. */
export const DESKS_ITEM_KEY = "desks";

/** Секция «Остальное» — её пункты живут на странице «Ещё» (`/more`), а не в меню. */
export const MORE_SECTION_KEY = "more";

/** Пункт меню «Ещё» → страница со всеми остальными разделами. */
export const MORE_ITEM_KEY = "more-page";

/**
 * Сколько последних столов показывать подпунктами «Столов» (просьба Nurba
 * 25.09.2026: «у стола оставь только 2 варианта последних посещений»).
 */
export const DESK_SHORTCUTS_LIMIT = 2;

/**
 * Экраны, которых нет в меню, но заголовок им нужен (шапка телефона, вкладка
 * браузера). Всё, что есть в меню, берёт подпись из самого пункта — второй
 * список названий разошёлся бы с меню за месяц.
 */
export const EXTRA_ROUTE_META: Array<{ prefix: string; title: string; eyebrow: string }> = [
  { prefix: "/observers", title: "Наблюдатели", eyebrow: "Nova" },
  { prefix: "/history", title: "История", eyebrow: "Nova" },
];

/** Активен ли путь: точно или с вложенными («/messages/abc» под «/messages»). */
export function pathMatches(pathname: string, to: string, end?: boolean) {
  if (end || to === "/") return pathname === to;
  return pathname === to || pathname.startsWith(`${to}/`);
}

/** Тот же путь без query/hash — пункт «/orders#new» активен на «/orders». */
export function pathOnly(to: string) {
  const cut = to.search(/[?#]/);
  return cut === -1 ? to : to.slice(0, cut);
}

/** Горит ли пункт на этом пути — одно правило для меню, листа «Ещё» и панели. */
export function isNavItemActive(item: Pick<NavItem, "to" | "end" | "activeOn">, pathname: string) {
  return item.activeOn ? item.activeOn(pathname) : pathMatches(pathname, item.to, item.end);
}
