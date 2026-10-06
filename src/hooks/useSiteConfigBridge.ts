import { useEffect } from "react";
import { currentSiteConfig, flushSiteConfig, setSavedSiteConfig, useSiteConfig } from "@/config/siteTerms";
import { useWorkspaceStore } from "@/store/workspaceStore";
import type { SiteBackground, SiteConfig, SiteFx } from "@/types/siteConfig";

/**
 * «Конструктор сайта» — из документа workspace в живое хранилище
 * (`config/siteTerms.ts`) и на страницу: цвета, особый вид (`theme.fx`),
 * иконка вкладки, запомненный бренд для экранов без workspace (вход,
 * загрузка, 404). Особый вид в запомненный бренд НЕ попадает.
 *
 * Сохранённую настройку кладёт ПРИ ОТРИСОВКЕ (как регион): меню и страницы
 * рисуются после AppLayout и должны сразу видеть свои слова. Нет поля —
 * сайт Nova как был, CSS-переменные не трогаются вовсе.
 */
export function useSiteConfigBridge() {
  const site = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId)?.site ?? null);
  setSavedSiteConfig(site, { silent: true });
  const effective = useSiteConfig();

  useEffect(() => {
    flushSiteConfig();
  });

  useEffect(() => {
    applySiteTheme(effective);
    applyFavicon(effective.brand?.logoUrl ?? null);
    rememberBrand(effective);
  }, [effective]);

  useEffect(
    () => () => {
      applySiteTheme({});
      applyFavicon(null);
    },
    []
  );
}

// ---------------------------------------------------------------------
// Цвета.
// ---------------------------------------------------------------------

/** Поверхности тёмной темы. «Графит» — прежние значения из index.css (не пишем). */
const BACKGROUNDS: Record<Exclude<SiteBackground, "graphite">, { h: number; s: number; base: number }> = {
  navy: { h: 224, s: 34, base: 6 },
  warm: { h: 28, s: 16, base: 5 },
  forest: { h: 158, s: 18, base: 5 },
  black: { h: 0, s: 0, base: 3 },
};

const SURFACE_VARS = [
  "--background",
  "--card",
  "--popover",
  "--muted",
  "--accent",
  "--border",
  "--input",
  "--sidebar",
  "--sidebar-border",
  "--sidebar-accent",
] as const;

const PRIMARY_VARS = ["--primary", "--ring", "--primary-foreground", "--accent-foreground"] as const;

function parseHsl(value: string): { h: number; s: number; l: number } | null {
  const m = /^(\d+(?:\.\d+)?) (\d+(?:\.\d+)?)% (\d+(?:\.\d+)?)%$/.exec(value.trim());
  if (!m) return null;
  return { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) };
}

/** Переменные для главного цвета: текст на заливке — тёмный на светлой, белый на тёмной. */
export function primaryVars(hsl: string): Record<string, string> | null {
  const p = parseHsl(hsl);
  if (!p) return null;
  return {
    "--primary": hsl,
    "--ring": hsl,
    "--primary-foreground": p.l >= 55 ? `${p.h} 70% 8%` : "0 0% 100%",
    "--accent-foreground": `${p.h} 60% 78%`,
  };
}

export function backgroundVars(key: SiteBackground | undefined): Record<string, string> | null {
  if (!key || key === "graphite") return null;
  const b = BACKGROUNDS[key];
  if (!b) return null;
  const s = (d: number) => Math.max(0, b.s - d);
  const surface = `${b.h} ${s(2)}% ${b.base + 2}%`;
  return {
    "--background": `${b.h} ${b.s}% ${b.base}%`,
    "--card": surface,
    "--popover": `${b.h} ${s(2)}% ${b.base + 4}%`,
    "--muted": `${b.h} ${s(4)}% ${b.base + 7}%`,
    "--accent": `${b.h} ${s(4)}% ${b.base + 8}%`,
    "--border": `${b.h} ${s(4)}% ${b.base + 10}%`,
    "--input": `${b.h} ${s(4)}% ${b.base + 8}%`,
    "--sidebar": surface,
    "--sidebar-border": `${b.h} ${s(4)}% ${b.base + 8}%`,
    "--sidebar-accent": `${b.h} ${s(4)}% ${b.base + 8}%`,
  };
}

export function applySiteTheme(config: SiteConfig) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const cosmos = config.theme?.fx === "cosmos";
  const primary = config.theme?.primary ? primaryVars(config.theme.primary) : null;
  for (const name of PRIMARY_VARS) {
    if (primary?.[name]) root.style.setProperty(name, primary[name]);
    else root.style.removeProperty(name);
  }
  // «Космос» перекрывает фон из «Цветов»: поверхности у него свои.
  const surfaces = cosmos ? COSMOS_SURFACES : backgroundVars(config.theme?.background);
  for (const name of SURFACE_VARS) {
    if (surfaces?.[name]) root.style.setProperty(name, surfaces[name]);
    else root.style.removeProperty(name);
  }
  for (const name of FX_VARS) {
    if (cosmos) root.style.setProperty(name, COSMOS_FX_VARS[name]);
    else root.style.removeProperty(name);
  }
  applySiteFx(root, cosmos ? "cosmos" : null);
}

// ---------------------------------------------------------------------
// Вид «космос» (воркспейс «NOVA Studio», 06.10.2026).
// ---------------------------------------------------------------------

/**
 * Поверхности «космоса» — тёмный индиго НИЗКОЙ насыщенности: цвета статусов на
 * нём не «плывут», а текст `--foreground` читается так же, как на графите.
 * Все значения без альфы — таблицы, липкие ячейки и шапка остаются
 * непрозрачными (урок про зебру: color-mix, не alpha).
 */
const COSMOS_SURFACES: Record<(typeof SURFACE_VARS)[number], string> = {
  "--background": "250 30% 6%",
  "--card": "250 26% 9%",
  "--popover": "250 26% 11%",
  "--muted": "250 22% 13%",
  "--accent": "250 22% 14%",
  "--border": "250 22% 17%",
  "--input": "250 22% 14%",
  "--sidebar": "250 28% 8%",
  "--sidebar-border": "250 22% 13%",
  "--sidebar-accent": "250 22% 13%",
};

/** Переменные, которые пишет ТОЛЬКО «космос»: без флага снимаются (значения из index.css). */
const FX_VARS = ["--destructive"] as const;

const COSMOS_FX_VARS: Record<(typeof FX_VARS)[number], string> = {
  // Оранжевый акцент студии (20°) стоит вплотную к красному «удалить» (8°) —
  // под «космосом» красный уводим к малиновому 352°, чтобы их не путали.
  // Светлота 52 %: белая подпись на кнопке «Удалить» — 4.65:1 (при 60 % было 3.76:1).
  "--destructive": "352 72% 52%",
};

/** Цвет полосы браузера/PWA: прежний из index.html и фон «космоса» (hsl 250 30% 6%). */
const DEFAULT_THEME_COLOR = "#0b0c0e";
const COSMOS_THEME_COLOR = "#0c0b14";

/**
 * Шрифты «космоса» (Unbounded — заголовки, Onest — текст) качаются ТОЛЬКО при
 * флаге: остальным компаниям лишние байты не нужны. Применяются они тоже только
 * под `html[data-site-fx="cosmos"]` (index.css).
 */
const COSMOS_FONTS_ID = "nova-cosmos-fonts";
const COSMOS_FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Onest:wght@300..700&family=Unbounded:wght@300..700&display=swap";

/**
 * Всё «не-переменное» особого вида — атрибут для CSS, цвет полосы браузера,
 * шрифты — ставится и снимается здесь же, внутри `applySiteTheme`: и
 * размонтирование моста, и смена workspace проходят через неё, так что
 * в обычной компании от «космоса» не остаётся ничего. Нет флага — ничего не
 * пишется (атрибута нет, цвет полосы и так прежний, ссылки на шрифты нет).
 */
function applySiteFx(root: HTMLElement, fx: SiteFx | null) {
  if (fx) {
    if (root.dataset.siteFx !== fx) root.dataset.siteFx = fx;
  } else if (root.dataset.siteFx !== undefined) {
    delete root.dataset.siteFx;
  }
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const color = fx === "cosmos" ? COSMOS_THEME_COLOR : DEFAULT_THEME_COLOR;
  if (meta && meta.getAttribute("content") !== color) meta.setAttribute("content", color);
  toggleCosmosFonts(fx === "cosmos");
}

function toggleCosmosFonts(on: boolean) {
  const existing = document.getElementById(COSMOS_FONTS_ID);
  if (!on) {
    existing?.remove();
    return;
  }
  if (existing) return;
  const link = document.createElement("link");
  link.id = COSMOS_FONTS_ID;
  link.rel = "stylesheet";
  link.href = COSMOS_FONTS_HREF;
  // Не держим отрисовку — как шрифты в index.html: print → all по загрузке
  // (display=swap до этого рисует запасным шрифтом).
  link.media = "print";
  link.onload = () => {
    link.media = "all";
  };
  document.head.appendChild(link);
}

// ---------------------------------------------------------------------
// Иконка вкладки и запомненный бренд.
// ---------------------------------------------------------------------

const DEFAULT_ICON = "/logo.svg";

function applyFavicon(url: string | null) {
  if (typeof document === "undefined") return;
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) return;
  const next = url ?? DEFAULT_ICON;
  if (link.getAttribute("href") !== next) link.setAttribute("href", next);
}

export const BRAND_CACHE_KEY = "nova:site-brand";

export interface CachedBrand {
  name?: string;
  mark?: string;
  logoUrl?: string;
  primary?: string;
}

function rememberBrand(config: SiteConfig) {
  try {
    const brand: CachedBrand = {};
    if (config.brand?.name) brand.name = config.brand.name;
    if (config.brand?.mark) brand.mark = config.brand.mark;
    if (config.brand?.logoUrl) brand.logoUrl = config.brand.logoUrl;
    if (config.theme?.primary) brand.primary = config.theme.primary;
    if (Object.keys(brand).length) localStorage.setItem(BRAND_CACHE_KEY, JSON.stringify(brand));
    else localStorage.removeItem(BRAND_CACHE_KEY);
  } catch {
    /* без localStorage — экраны без workspace рисуют Nova */
  }
}

/** Последний бренд на этом устройстве — для входа, загрузки и 404. */
export function cachedBrand(): CachedBrand | null {
  try {
    const raw = localStorage.getItem(BRAND_CACHE_KEY);
    return raw ? (JSON.parse(raw) as CachedBrand) : null;
  } catch {
    return null;
  }
}

/** Настройка сейчас (для не-React кода, например заголовка вкладки). */
export function siteConfigNow(): SiteConfig {
  return currentSiteConfig();
}
