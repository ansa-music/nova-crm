/**
 * Ссылки на стол и его строки — одно место, чтобы адрес строки везде
 * собирался одинаково: `/page/{id}?tab={вкладка}&row={строка}`.
 *
 * Раньше уведомления, дашборд и очередь технаря вели на `/page/{id}?row=…`
 * без вкладки: стол открывался на вкладке по умолчанию, строка из прошлого
 * месяца там не находилась, и человек искал её руками. Вкладка в адресе
 * решает это (её читает `DynamicTablePage`).
 */

/** Значение `?tab=` для «Основной» (activeSubPageId === null). */
export const MAIN_TAB_PARAM = "main";

/** Вкладка → значение `?tab=`: «Основная» — `main`. */
export function deskTabParam(subPageId: string | null | undefined): string {
  return subPageId ? subPageId : MAIN_TAB_PARAM;
}

/** Адрес стола, при известной вкладке — сразу на ней. */
export function deskHref(pageId: string, subPageId?: string | null): string {
  if (subPageId === undefined) return `/page/${pageId}`;
  return `/page/${pageId}?tab=${encodeURIComponent(deskTabParam(subPageId))}`;
}

/**
 * Адрес строки стола. `subPageId === undefined` — вкладка не известна
 * (стол сам попробует найти строку), `null` — строка на «Основной».
 */
export function deskRowHref(pageId: string, subPageId: string | null | undefined, rowId: string): string {
  const params = new URLSearchParams();
  if (subPageId !== undefined) params.set("tab", deskTabParam(subPageId));
  params.set("row", rowId);
  return `/page/${pageId}?${params.toString()}`;
}

/** Откуда пришли на стол — для кнопки «Назад» в его шапке. */
export interface DeskFrom {
  to: string;
  label: string;
}

/** `state` для `navigate`/`<Link>` при переходе на стол с другого экрана. */
export function deskNavState(from: DeskFrom): { from: DeskFrom } {
  return { from };
}

/** `location.state.from`, если он похож на наш — чужое состояние не верим. */
export function readDeskFrom(state: unknown): DeskFrom | null {
  if (!state || typeof state !== "object") return null;
  const from = (state as { from?: unknown }).from;
  if (!from || typeof from !== "object") return null;
  const { to, label } = from as { to?: unknown; label?: unknown };
  if (typeof to !== "string" || !to.startsWith("/")) return null;
  return { to, label: typeof label === "string" && label ? label : "Назад" };
}

const PATH_LABELS: Array<[prefix: string, label: string]> = [
  ["/dashboard", "Дашборд"],
  ["/orders", "Заказы"],
  ["/technicians", "Технари"],
  ["/people", "Люди"],
  ["/os-desks", "Столы ОС"],
  ["/os-dispatch", "Выдачи ОС"],
  ["/desks", "Столы"],
  ["/schedule", "График"],
  ["/abs", "ABS"],
  ["/messages", "Сообщения"],
  ["/page/", "Стол"],
];

/** Подпись экрана по адресу — для «Назад», когда уходим с текущей страницы. */
export function labelForPath(pathname: string): string {
  const hit = PATH_LABELS.find(([prefix]) => pathname === prefix || pathname.startsWith(prefix + "/") || (prefix.endsWith("/") && pathname.startsWith(prefix)));
  return hit ? hit[1] : "Назад";
}

/** «Откуда» = текущий экран (колокольчик, поиск — они не страницы). */
export function deskFromLocation(location: { pathname: string; search?: string }): DeskFrom {
  return { to: `${location.pathname}${location.search ?? ""}`, label: labelForPath(location.pathname) };
}

const TAB_STORAGE_PREFIX = "nova-crm:desk-tab:";

/**
 * Память последней вкладки стола — на этот браузер. Вместе с вкладкой
 * лежит месяц: в новом месяце память не действует, иначе она перебивала бы
 * автопилот месячных вкладок и стол открывался бы на прошлом месяце.
 */
export function readStoredDeskTab(pageId: string, monthKey: string): string | null | undefined {
  try {
    const raw = window.localStorage.getItem(TAB_STORAGE_PREFIX + pageId);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { tab?: unknown; month?: unknown };
    if (parsed.month !== monthKey) return undefined;
    if (parsed.tab === null) return null;
    return typeof parsed.tab === "string" && parsed.tab ? parsed.tab : undefined;
  } catch {
    return undefined;
  }
}

export function storeDeskTab(pageId: string, subPageId: string | null, monthKey: string): void {
  try {
    window.localStorage.setItem(TAB_STORAGE_PREFIX + pageId, JSON.stringify({ tab: subPageId, month: monthKey }));
  } catch {
    /* приватный режим — память не обязательна */
  }
}
