import type { ColumnType, PageColumn } from "@/types/page";
import type { Role } from "@/types/role";

/**
 * «Конструктор сайта» (просьба Nurba 26.09.2026: «возможность полной
 * реконструкции сайта под другую компанию — изменить любую часть сайта»).
 *
 * Одно поле `workspace.site` в документе workspace: его и так слушает каждая
 * вкладка, лишних чтений нет. Пишет только Owner (правило workspace закрывает
 * поле Тимлиду). Нет поля или ключа — ровно прежний сайт Nova: все умолчания
 * ниже совпадают с тем, что было зашито в коде.
 */

// ---------------------------------------------------------------------
// Слова интерфейса.
// ---------------------------------------------------------------------

export type TermKey =
  | "studio"
  | "desk"
  | "osDesk"
  | "order"
  | "technician"
  | "os"
  | "grok"
  | "abs"
  | "dashboard"
  | "schedule"
  | "chat"
  | "reports"
  | "people"
  | "team"
  | "announcements"
  | "telegram";

export interface TermForms {
  /** Один: «Стол», «Заказ», «Технарь». */
  one: string;
  /** Много: «Столы», «Заказы», «Технари». */
  many: string;
}

export interface TermMeta {
  key: TermKey;
  /** Что это — подпись в конструкторе. */
  title: string;
  hint?: string;
  defaults: TermForms;
  /** Только одна форма (название раздела). */
  single?: boolean;
}

export const TERM_META: TermMeta[] = [
  { key: "desk", title: "Стол", hint: "Личная таблица сотрудника", defaults: { one: "Стол", many: "Столы" } },
  { key: "order", title: "Заказ", hint: "Раздел биржи и строка в столе", defaults: { one: "Заказ", many: "Заказы" } },
  { key: "technician", title: "Исполнитель", hint: "Кто выполняет заказы (роль «Технарь»)", defaults: { one: "Технарь", many: "Технари" } },
  { key: "os", title: "Продавец", hint: "Кто продаёт и ведёт заказ (роль «ОС»)", defaults: { one: "ОС", many: "ОС" } },
  {
    key: "osDesk",
    title: "Стол продавца",
    hint: "По умолчанию — «Стол» + «ОС»",
    defaults: { one: "Стол ОС", many: "Столы ОС" },
  },
  { key: "grok", title: "Аккаунты сервисов", defaults: { one: "Грок лимит", many: "Грок лимит" }, single: true },
  { key: "abs", title: "Зарплатный рейтинг", defaults: { one: "ABS система", many: "ABS система" }, single: true },
  { key: "dashboard", title: "Дашборд", defaults: { one: "Дашборд", many: "Дашборд" }, single: true },
  { key: "schedule", title: "График", defaults: { one: "График", many: "График" }, single: true },
  { key: "chat", title: "Чат", defaults: { one: "Чат", many: "Чат" }, single: true },
  { key: "reports", title: "Отчёты", defaults: { one: "Отчёты", many: "Отчёты" }, single: true },
  { key: "people", title: "Люди", defaults: { one: "Люди", many: "Люди" }, single: true },
  { key: "team", title: "Команда", defaults: { one: "Команда", many: "Команда" }, single: true },
  { key: "announcements", title: "Объявления", defaults: { one: "Объявления", many: "Объявления" }, single: true },
  { key: "telegram", title: "Telegram", defaults: { one: "Telegram", many: "Telegram" }, single: true },
  { key: "studio", title: "Надзаголовок разделов", hint: "Мелкая строка над заголовком", defaults: { one: "Студия", many: "Студия" }, single: true },
];

export const TERM_KEYS = TERM_META.map((t) => t.key);

// ---------------------------------------------------------------------
// Модули и меню.
// ---------------------------------------------------------------------

export type ModuleKey =
  | "orders"
  | "osDesk"
  | "technicians"
  | "grok"
  | "telegram"
  | "schedule"
  | "chat"
  | "dashboard"
  | "reports"
  | "announcements"
  | "people";

export interface ModuleMeta {
  key: ModuleKey;
  title: string;
  hint: string;
  /** Ключи пунктов меню модуля. */
  navKeys: string[];
  /** Первые сегменты адресов (`/orders` → "orders"). */
  paths: string[];
}

/**
 * Разделы, которые Owner вправе выключить. «Главная», «Столы», «Ещё» и
 * «Настройки» не выключаются: иначе Owner закрыл бы себе вход обратно.
 */
export const MODULES: ModuleMeta[] = [
  { key: "orders", title: "Заказы (биржа)", hint: "Выдача заказов, отклики, автозаезд в стол", navKeys: ["orders"], paths: ["orders"] },
  {
    key: "osDesk",
    title: "Столы продавцов (ОС)",
    hint: "Стол ОС, «Столы ОС», «Выдачи ОС»",
    navKeys: ["os-desk", "os-desks", "os-dispatch"],
    paths: ["os-desk", "os-desks", "os-dispatch"],
  },
  { key: "technicians", title: "Загрузка исполнителей", hint: "Кто свободен, кто занят", navKeys: ["technicians"], paths: ["technicians"] },
  { key: "grok", title: "Аккаунты сервисов (Грок)", hint: "Лимиты и пароли общих аккаунтов", navKeys: ["grok"], paths: ["grok-limit"] },
  { key: "telegram", title: "Telegram", hint: "Рабочий Telegram прямо в CRM", navKeys: ["telegram"], paths: ["telegram"] },
  { key: "schedule", title: "График смен", hint: "Выходные и смены сотрудников", navKeys: ["schedule"], paths: ["schedule"] },
  { key: "chat", title: "Чат", hint: "Общий чат и личные сообщения", navKeys: ["chat", "messages"], paths: ["chat", "messages"] },
  { key: "dashboard", title: "Дашборд и рейтинг", hint: "Дашборд, ABS, отчёты", navKeys: ["dashboard", "abs"], paths: ["dashboard", "abs"] },
  { key: "reports", title: "Отчёты за периоды", hint: "Итоги прошлых месяцев", navKeys: ["reports"], paths: ["reports"] },
  { key: "announcements", title: "Объявления", hint: "Новости для команды", navKeys: ["announcements"], paths: ["announcements"] },
  { key: "people", title: "Люди", hint: "Список сотрудников и их столов", navKeys: ["people"], paths: ["people"] },
];

export const MODULE_KEYS = MODULES.map((m) => m.key);

/** Пункты меню, которые нельзя скрыть: без них не вернуться в настройки. */
export const LOCKED_NAV_KEYS = ["home", "settings", "more-page"];

/** Куда может вести «Главная» (выбор Owner по ролям). */
export const HOME_TARGETS: Array<{ path: string; title: string; module?: ModuleKey }> = [
  { path: "/desks", title: "Список столов" },
  { path: "/orders", title: "Заказы", module: "orders" },
  { path: "/dashboard", title: "Дашборд", module: "dashboard" },
  { path: "/technicians", title: "Загрузка исполнителей", module: "technicians" },
  { path: "/os-desk", title: "Стол продавца", module: "osDesk" },
  { path: "/schedule", title: "График", module: "schedule" },
  { path: "/people", title: "Люди", module: "people" },
];

// ---------------------------------------------------------------------
// Бренд и цвета.
// ---------------------------------------------------------------------

export type SiteBackground = "graphite" | "navy" | "warm" | "black" | "forest";

export const SITE_BACKGROUNDS: Array<{ key: SiteBackground; title: string }> = [
  { key: "graphite", title: "Графит (как у Nova)" },
  { key: "navy", title: "Ночной синий" },
  { key: "warm", title: "Тёплый" },
  { key: "forest", title: "Лесной" },
  { key: "black", title: "Чёрный" },
];

export const PRIMARY_PRESETS: Array<{ title: string; hsl: string }> = [
  { title: "Бирюза (Nova)", hsl: "189 67% 70%" },
  { title: "Синий", hsl: "217 91% 65%" },
  { title: "Фиолетовый", hsl: "262 83% 72%" },
  { title: "Розовый", hsl: "330 81% 70%" },
  { title: "Оранжевый", hsl: "27 96% 64%" },
  { title: "Зелёный", hsl: "142 64% 58%" },
  { title: "Золото", hsl: "45 93% 58%" },
];

export interface SiteBrand {
  /** Название компании в меню и во вкладке браузера. */
  name?: string;
  /** 1–3 знака для узкой рейки меню. */
  mark?: string;
  logoUrl?: string;
  logoPath?: string;
}

export interface SiteTheme {
  /** Главный цвет — HSL-триплет «189 67% 70%». */
  primary?: string;
  background?: SiteBackground;
}

export interface SiteNav {
  hidden?: string[];
  order?: string[];
  labels?: Record<string, string>;
  /** «Главная» по ролям: путь из HOME_TARGETS. */
  home?: Partial<Record<Role, string>>;
}

export interface SiteDeskTemplate {
  columns: Array<Pick<PageColumn, "key" | "label" | "type" | "width">>;
}

export interface SiteConfig {
  brand?: SiteBrand;
  theme?: SiteTheme;
  terms?: Partial<Record<TermKey, Partial<TermForms>>>;
  roles?: Partial<Record<Role, string>>;
  nav?: SiteNav;
  modules?: Partial<Record<ModuleKey, boolean>>;
  deskTemplate?: SiteDeskTemplate;
}

// ---------------------------------------------------------------------
// Очистка.
// ---------------------------------------------------------------------

const HSL_RE = /^\d{1,3}(\.\d+)? \d{1,3}(\.\d+)?% \d{1,3}(\.\d+)?%$/;
const ALL_ROLES: Role[] = ["owner", "teamlead", "admin", "manager", "os", "viewer"];
const ALLOWED_COLUMN_TYPES: ColumnType[] = ["text", "number", "currency", "status", "responsible", "technician", "date", "email", "phone", "url"];
const HOME_PATHS = new Set(HOME_TARGETS.map((t) => t.path));
const NAV_KEY_RE = /^[a-z][a-z0-9-]{0,40}$/;

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim().slice(0, max);
  return text || undefined;
}

function cleanUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const url = value.trim();
  return /^https:\/\/[^\s"'<>]{1,500}$/.test(url) ? url : undefined;
}

function pruneEmpty<T extends object>(obj: T): T | undefined {
  return Object.keys(obj).length ? obj : undefined;
}

/**
 * Приводит настройку к допустимому виду: известные ключи, пределы длины,
 * HSL по шаблону. Пустое снимается — «нет ключа» и есть «как у Nova».
 */
export function sanitizeSiteConfig(input: unknown): SiteConfig {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: SiteConfig = {};

  const b = (src.brand ?? {}) as Record<string, unknown>;
  const brand: SiteBrand = {};
  const name = cleanText(b.name, 40);
  if (name) brand.name = name;
  const mark = cleanText(b.mark, 3);
  if (mark) brand.mark = mark;
  const logoUrl = cleanUrl(b.logoUrl);
  if (logoUrl) {
    brand.logoUrl = logoUrl;
    const logoPath = cleanText(b.logoPath, 300);
    if (logoPath) brand.logoPath = logoPath;
  }
  const brandClean = pruneEmpty(brand);
  if (brandClean) out.brand = brandClean;

  const t = (src.theme ?? {}) as Record<string, unknown>;
  const theme: SiteTheme = {};
  if (typeof t.primary === "string" && HSL_RE.test(t.primary.trim())) theme.primary = t.primary.trim();
  if (typeof t.background === "string" && SITE_BACKGROUNDS.some((bg) => bg.key === t.background) && t.background !== "graphite") {
    theme.background = t.background as SiteBackground;
  }
  const themeClean = pruneEmpty(theme);
  if (themeClean) out.theme = themeClean;

  const terms = (src.terms ?? {}) as Record<string, unknown>;
  const termsOut: SiteConfig["terms"] = {};
  for (const key of TERM_KEYS) {
    const raw = (terms[key] ?? {}) as Record<string, unknown>;
    const forms: Partial<TermForms> = {};
    const one = cleanText(raw.one, 32);
    const many = cleanText(raw.many, 32);
    if (one) forms.one = one;
    if (many) forms.many = many;
    const clean = pruneEmpty(forms);
    if (clean) termsOut[key] = clean;
  }
  const termsClean = pruneEmpty(termsOut);
  if (termsClean) out.terms = termsClean;

  const roles = (src.roles ?? {}) as Record<string, unknown>;
  const rolesOut: SiteConfig["roles"] = {};
  for (const role of ALL_ROLES) {
    const label = cleanText(roles[role], 24);
    if (label) rolesOut[role] = label;
  }
  const rolesClean = pruneEmpty(rolesOut);
  if (rolesClean) out.roles = rolesClean;

  const n = (src.nav ?? {}) as Record<string, unknown>;
  const nav: SiteNav = {};
  const keyList = (v: unknown) =>
    Array.isArray(v) ? [...new Set(v.filter((k): k is string => typeof k === "string" && NAV_KEY_RE.test(k)))].slice(0, 60) : [];
  const hidden = keyList(n.hidden).filter((k) => !LOCKED_NAV_KEYS.includes(k));
  if (hidden.length) nav.hidden = hidden;
  const order = keyList(n.order);
  if (order.length) nav.order = order;
  const labels = (n.labels ?? {}) as Record<string, unknown>;
  const labelsOut: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels).slice(0, 60)) {
    if (!NAV_KEY_RE.test(key)) continue;
    const label = cleanText(value, 32);
    if (label) labelsOut[key] = label;
  }
  if (Object.keys(labelsOut).length) nav.labels = labelsOut;
  const home = (n.home ?? {}) as Record<string, unknown>;
  const homeOut: Partial<Record<Role, string>> = {};
  for (const role of ALL_ROLES) {
    const path = home[role];
    if (typeof path === "string" && HOME_PATHS.has(path)) homeOut[role] = path;
  }
  if (Object.keys(homeOut).length) nav.home = homeOut;
  const navClean = pruneEmpty(nav);
  if (navClean) out.nav = navClean;

  const m = (src.modules ?? {}) as Record<string, unknown>;
  const modules: Partial<Record<ModuleKey, boolean>> = {};
  for (const key of MODULE_KEYS) if (m[key] === false) modules[key] = false;
  const modulesClean = pruneEmpty(modules);
  if (modulesClean) out.modules = modulesClean;

  const tpl = (src.deskTemplate ?? null) as { columns?: unknown } | null;
  if (tpl && Array.isArray(tpl.columns)) {
    const seen = new Set<string>();
    const columns: SiteDeskTemplate["columns"] = [];
    for (const raw of tpl.columns.slice(0, 30)) {
      const c = (raw ?? {}) as Record<string, unknown>;
      const label = cleanText(c.label, 40);
      const type = ALLOWED_COLUMN_TYPES.includes(c.type as ColumnType) ? (c.type as ColumnType) : "text";
      let key = typeof c.key === "string" && /^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(c.key) ? c.key : "";
      if (!label) continue;
      if (!key || seen.has(key)) key = `col${columns.length + 1}`;
      while (seen.has(key)) key = `${key}_`;
      seen.add(key);
      const width = typeof c.width === "number" && Number.isFinite(c.width) ? Math.min(600, Math.max(60, Math.round(c.width))) : 150;
      columns.push({ key, label, type, width });
    }
    if (columns.length) out.deskTemplate = { columns };
  }

  return out;
}

export function siteConfigOf(workspace: { site?: SiteConfig } | null | undefined): SiteConfig {
  return workspace?.site ?? {};
}

export function isModuleEnabled(site: SiteConfig | null | undefined, key: ModuleKey): boolean {
  return site?.modules?.[key] !== false;
}

/** Модуль, которому принадлежит адрес (первый сегмент пути), или null. */
export function moduleOfPath(pathname: string): ModuleKey | null {
  const seg = pathname.replace(/^\/+/, "").split(/[/?#]/)[0];
  if (!seg) return null;
  return MODULES.find((m) => m.paths.includes(seg))?.key ?? null;
}

/** Модуль, которому принадлежит пункт меню, или null. */
export function moduleOfNavKey(key: string): ModuleKey | null {
  return MODULES.find((m) => m.navKeys.includes(key))?.key ?? null;
}
