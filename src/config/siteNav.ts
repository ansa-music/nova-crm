import type { NavSection } from "@/config/nav";
import { isModuleEnabled, LOCKED_NAV_KEYS, moduleOfNavKey, type SiteConfig } from "@/types/siteConfig";

/**
 * Настройка меню из «Конструктора сайта»: свои подписи по ключу пункта,
 * скрытые пункты и выключенные модули (`show: false` — `buildPageMeta` всё
 * равно найдёт заголовок), порядок внутри секции. «Главная», «Ещё» и
 * «Настройки» не скрываются — иначе в настройки не вернуться.
 */
export function applySiteNav(sections: NavSection[], site: SiteConfig): NavSection[] {
  const nav = site.nav;
  const hasModules = Boolean(site.modules && Object.keys(site.modules).length);
  if (!nav && !hasModules) return sections;
  const hidden = new Set(nav?.hidden ?? []);
  const order = nav?.order ?? [];
  return sections.map((section) => {
    const items = section.items.map((item) => {
      let next = item;
      const label = nav?.labels?.[item.key];
      if (label) next = { ...next, label };
      if (!LOCKED_NAV_KEYS.includes(item.key)) {
        const mod = moduleOfNavKey(item.key);
        if (hidden.has(item.key) || (mod && !isModuleEnabled(site, mod))) next = { ...next, show: false };
      }
      return next;
    });
    if (order.length) {
      const rank = (key: string, index: number) => {
        const at = order.indexOf(key);
        return at < 0 ? order.length + index : at;
      };
      const ranked = items.map((item, index) => ({ item, r: rank(item.key, index) }));
      ranked.sort((a, b) => a.r - b.r);
      return { ...section, items: ranked.map((x) => x.item) };
    }
    return { ...section, items };
  });
}
