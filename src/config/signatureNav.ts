import { MORE_ITEM_KEY, isNavItemActive, pathMatches, type NavItem, type NavSection } from "@/config/nav";
import type { NavModel } from "@/hooks/useNavModel";

/**
 * Меню NOVA Signature: те же пункты модели (`useNavModel`), разложенные заново.
 * Чистая перекладка: права ролей, модули Конструктора, подписи, порядок и бейджи
 * остаются из модели — здесь нет ни одного своего пункта и ни одной проверки.
 *
 * Частое — в ВЕРХНЕЙ панели (просьба Nurba 12.10.2026): «Мой стол», «Заказы»,
 * «Все столы» (13.10.2026), ABS, «График», «Промты», «Грок лимит» и кнопка
 * «все разделы». В боковой
 * панели их нет — одна кнопка на раздел. Там же слиты «Столы» + «Столы ОС» и
 * «Технари» + «Команда» + «Пользователи» + «Люди»: один пункт, внутри страницы
 * переключатель (`SignatureSwitches`). Пункт с незнакомым ключом не теряется —
 * уходит в «Прочее».
 */

/** Разделы верхней панели, по порядку. «Мой стол» панель рисует сама. */
export const TOP_NAV_KEYS = ["orders", "dashboard", "schedule", "prompts", "grok"] as const;

/** Куда ведёт «Мой стол» верхней панели: свой стол, у ОС — стол ОС; нет стола — `null`. */
export function topDeskTarget(nav: Pick<NavModel, "items" | "isOs" | "home" | "myDeskTo">): { to: string; key: string } | null {
  if (nav.isOs) return nav.items.some((i) => i.key === "os-desk") ? { to: "/os-desk", key: "os-desk" } : null;
  if (!nav.home.myDeskId) return null;
  // «Главная» модели — тот же стол: тогда пункт «home» в боковой панели лишний.
  return { to: nav.myDeskTo, key: nav.home.to === nav.myDeskTo ? "home" : "" };
}

/** Ключи пунктов, которые показывает верхняя панель, — их в боковой нет. */
export function signatureTopKeys(nav: Pick<NavModel, "items" | "isOs" | "home" | "myDeskTo">): Set<string> {
  const keys = new Set<string>(TOP_NAV_KEYS.filter((k) => nav.items.some((i) => i.key === k)));
  const desk = topDeskTarget(nav);
  if (desk?.key) keys.add(desk.key);
  return keys;
}

/** Один пункт «Столы»: внутри «Столы / Столы ОС». */
export const DESKS_GROUP_KEYS = ["desks", "os-desks"] as const;

/**
 * «Все столы» верхней панели (просьба Nurba 13.10.2026: «добавь туда кнопку
 * все столы — там и ОС, и тех»). Ведёт на первую доступную роли вкладку
 * раздела «Столы / Столы ОС» и горит на любой из них; на «Столах» ниже
 * списка технарей стоят и столы ОС (`DesksPage`). Вкладок у роли нет — `null`.
 * В боковой панели пункт «Столы» ОСТАЁТСЯ (в `signatureTopKeys` его нет):
 * под ним живут закреплённые столы.
 */
export function topAllDesksTarget(items: NavItem[]): { to: string; activeOn: (pathname: string) => boolean } | null {
  const tabs = groupTabs(items, DESKS_GROUP_KEYS);
  if (tabs.length === 0) return null;
  return { to: tabs[0].to, activeOn: (pathname) => tabs.some((tab) => isNavItemActive(tab, pathname)) };
}

/**
 * Один пункт «Команда». Порядок — и порядок вкладок, и «куда ведёт пункт»
 * (первый доступный роли).
 */
export const TEAM_GROUP_KEYS = ["technicians", "team", "users", "people"] as const;

/** Вкладки объединённого раздела — те из `keys`, что есть у роли в модели. */
export function groupTabs(items: NavItem[], keys: readonly string[]): NavItem[] {
  const byKey = new Map(items.map((i) => [i.key, i]));
  const tabs = keys.map((k) => byKey.get(k)).filter((i): i is NavItem => Boolean(i));
  // «Люди» — тот же список, что «Пользователи», только без управления: кому
  // доступны «Пользователи», второй список не нужен.
  return tabs.some((t) => t.key === "users") ? tabs.filter((t) => t.key !== "people") : tabs;
}

/** Слить пункты группы в один: ведёт на первую вкладку, горит на любой из них. */
function mergeItems(items: NavItem[], keys: readonly string[], label?: string): NavItem[] {
  const all = items.filter((i) => keys.includes(i.key));
  if (all.length < 2) return items;
  const tabs = groupTabs(items, keys);
  const head = tabs[0];
  const merged: NavItem = {
    ...head,
    label: label ?? head.label,
    badge: all.reduce((sum, i) => sum + (i.badge ?? 0), 0) || undefined,
    alert: all.some((i) => i.alert) || undefined,
    children: all.flatMap((i) => i.children ?? []),
    // Скрытая вкладка («Люди») тоже подсвечивает пункт: адрес живой, по ссылке открыть можно.
    activeOn: (pathname) => all.some((i) => (i.activeOn ? i.activeOn(pathname) : pathMatches(pathname, i.to))),
  };
  const out: NavItem[] = [];
  let placed = false;
  for (const item of items) {
    if (!keys.includes(item.key)) out.push(item);
    else if (!placed) {
      out.push(merged);
      placed = true;
    }
  }
  return out;
}

const GROUPS: { key: string; title?: string; keys: string[] }[] = [
  { key: "sig-home", keys: ["home"] },
  { key: "sig-orders", title: "Заказы", keys: ["orders", "leads", "big-orders", "os-desk", "os-sheet"] },
  { key: "sig-work", title: "Работа", keys: ["desks", "os-desks", "technicians", "people", "team", "users", "schedule"] },
  { key: "sig-flows", title: "Процессы", keys: ["os-dispatch", "dispatch", "desk-editing"] },
  { key: "sig-analytics", title: "Аналитика", keys: ["dashboard", "reports"] },
  { key: "sig-tools", title: "Инструменты", keys: ["grok", "prompts", "telegram"] },
  { key: "sig-messages", title: "Сообщения", keys: ["chat", "announcements"] },
  { key: "sig-admin", title: "Управление", keys: ["platform"] },
];

const OTHER_KEY = "sig-other";

/**
 * @param topKeys Ключи, которые сейчас показывает верхняя панель (их в боковой
 * не дублируем). «home» там — только если «Мой стол» панели ведёт туда же.
 */
export function signatureSections(sections: NavSection[], topKeys: ReadonlySet<string>): NavSection[] {
  // «Ещё» — кнопка-значок верхней панели; «Настройки» — в меню аккаунта внизу.
  const skip = new Set<string>([MORE_ITEM_KEY, "settings", ...topKeys]);
  let items = sections.flatMap((s) => s.items);
  items = mergeItems(items, DESKS_GROUP_KEYS);
  items = mergeItems(items, TEAM_GROUP_KEYS, "Команда");

  const groupOf = new Map<string, string>();
  for (const g of GROUPS) for (const k of g.keys) groupOf.set(k, g.key);

  const buckets = new Map<string, NavItem[]>();
  for (const item of items) {
    if (skip.has(item.key)) continue;
    const key = groupOf.get(item.key) ?? OTHER_KEY;
    const list = buckets.get(key);
    if (list) list.push(item);
    else buckets.set(key, [item]);
  }

  const out: NavSection[] = [];
  for (const g of GROUPS) {
    const list = buckets.get(g.key);
    if (!list?.length) continue;
    out.push({ key: g.key, title: g.title, items: list, collapsible: Boolean(g.title), defaultOpen: true });
  }
  const other = buckets.get(OTHER_KEY);
  if (other?.length) out.push({ key: OTHER_KEY, title: "Прочее", items: other, collapsible: true, defaultOpen: true });
  return out;
}
