import { useEffect } from "react";
import { currentSiteConfig, flushSiteConfig, setSavedSiteConfig, useSiteConfig } from "@/config/siteTerms";
import { useWorkspaceStore } from "@/store/workspaceStore";
import type { SiteBackground, SiteConfig } from "@/types/siteConfig";

/**
 * «Конструктор сайта» — из документа workspace в живое хранилище
 * (`config/siteTerms.ts`) и на страницу: цвета, иконка вкладки, запомненный
 * бренд для экранов без workspace (вход, загрузка, 404).
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
  const primary = config.theme?.primary ? primaryVars(config.theme.primary) : null;
  for (const name of PRIMARY_VARS) {
    if (primary?.[name]) root.style.setProperty(name, primary[name]);
    else root.style.removeProperty(name);
  }
  const surfaces = backgroundVars(config.theme?.background);
  for (const name of SURFACE_VARS) {
    if (surfaces?.[name]) root.style.setProperty(name, surfaces[name]);
    else root.style.removeProperty(name);
  }
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
