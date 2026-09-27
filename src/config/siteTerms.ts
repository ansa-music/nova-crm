import { useSyncExternalStore } from "react";
import { TERM_META, type SiteConfig, type TermKey } from "@/types/siteConfig";

/**
 * Живая настройка «Конструктора сайта» на модуле (как `USER_TIMEZONE`):
 * `term()` и `roleLabel()` зовутся и из не-React кода (тосты, сервисы).
 *
 * Значение кладёт мост `useSiteConfigBridge` (AppLayout) из документа
 * workspace ПРИ ОТРИСОВКЕ. Конструктор в настройках ставит поверх черновик
 * (`setSiteDraft`) — предпросмотр до «Сохранить»; компоненты, которым нужна
 * перерисовка, подписываются через `useSiteConfig()`.
 */

let saved: SiteConfig = {};
let draft: SiteConfig | null = null;
let effective: SiteConfig = {};
let version = 0;
let pendingEmit = false;
const listeners = new Set<() => void>();

function emit() {
  pendingEmit = false;
  version += 1;
  for (const listener of [...listeners]) listener();
}

function recompute() {
  const next = draft ?? saved;
  if (next === effective) return false;
  effective = next;
  return true;
}

/**
 * Сохранённая настройка активного workspace (мост). `silent` — при
 * отрисовке: значение ставится сразу (дети, которые рисуются следом, его
 * видят), а подписчиков будит `flushSiteConfig()` из эффекта — будить их
 * посреди чужой отрисовки React не разрешает.
 */
export function setSavedSiteConfig(config: SiteConfig | null | undefined, opts: { silent?: boolean } = {}): boolean {
  const next = config ?? EMPTY;
  if (sameConfig(next, saved)) return false;
  saved = next;
  if (!recompute()) return false;
  if (opts.silent) pendingEmit = true;
  else emit();
  return true;
}

/** Разбудить подписчиков после тихой смены (эффект моста). */
export function flushSiteConfig() {
  if (pendingEmit) emit();
}

/** Черновик конструктора (предпросмотр); null — снять. */
export function setSiteDraft(config: SiteConfig | null) {
  draft = config;
  if (recompute()) emit();
}

const EMPTY: SiteConfig = {};

function sameConfig(a: SiteConfig, b: SiteConfig): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

export function currentSiteConfig(): SiteConfig {
  return effective;
}

export function subscribeSiteConfig(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Действующая настройка (с черновиком) — перерисовывает при смене. */
export function useSiteConfig(): SiteConfig {
  return useSyncExternalStore(subscribeSiteConfig, currentSiteConfig, currentSiteConfig);
}

/** Номер версии — для memo, которым важен сам факт смены. */
export function siteConfigVersion(): number {
  return version;
}

// ---------------------------------------------------------------------
// Слова.
// ---------------------------------------------------------------------

const DEFAULTS = new Map(TERM_META.map((t) => [t.key, t.defaults]));

function override(key: TermKey, form: "one" | "many", config: SiteConfig): string | undefined {
  const forms = config.terms?.[key];
  if (!forms) return undefined;
  if (form === "one") return forms.one ?? undefined;
  return forms.many ?? (TERM_META.find((t) => t.key === key)?.single ? forms.one : undefined);
}

/**
 * Слово интерфейса компании: «Столы», «Заказ», «Технари». Нет своего —
 * умолчание Nova. «Стол ОС» по умолчанию собирается из «Стол» + «ОС», чтобы
 * переименование одного слова не оставляло старое внутри составного.
 */
export function term(key: TermKey, form: "one" | "many" = "many", config: SiteConfig = effective): string {
  const own = override(key, form, config);
  if (own) return own;
  if (key === "osDesk") {
    const hasParts = config.terms?.desk || config.terms?.os;
    if (hasParts) return `${term("desk", form, config)} ${term("os", "one", config)}`;
  }
  const d = DEFAULTS.get(key);
  return d ? d[form] : key;
}

/** Слово с маленькой буквы — для середины фразы («нет заказов»). */
export function termLower(key: TermKey, form: "one" | "many" = "many", config: SiteConfig = effective): string {
  const word = term(key, form, config);
  // Аббревиатуры («ОС», «ABS») не опускаем.
  return word.length > 1 && word === word.toUpperCase() ? word : word.charAt(0).toLowerCase() + word.slice(1);
}

/** Название компании в меню и во вкладке (или «Nova»). */
export function brandName(config: SiteConfig = effective): string {
  return config.brand?.name || "Nova";
}

/** 1–3 знака для узкой рейки (или «N»). */
export function brandMark(config: SiteConfig = effective): string {
  if (config.brand?.mark) return config.brand.mark;
  const name = config.brand?.name;
  return name ? name.charAt(0).toUpperCase() : "N";
}

/**
 * Слова компании для компонента: перерисовывает при смене настройки
 * (и при предпросмотре в конструкторе). `t("order")` → «Заказы».
 */
export function useTerms(): (key: TermKey, form?: "one" | "many") => string {
  const config = useSiteConfig();
  return (key, form = "many") => term(key, form, config);
}
