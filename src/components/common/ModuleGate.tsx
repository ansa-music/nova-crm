import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { useSiteConfig } from "@/config/siteTerms";
import { isModuleEnabled, type ModuleKey } from "@/types/siteConfig";

/**
 * Раздел, выключенный в «Конструкторе сайта», не открывается и по прямому
 * адресу (закладка, ссылка из старого уведомления): ведёт на «Главную».
 * Пункт меню модель навигации уже убрала сама (`applySiteNav`).
 */
export function ModuleGate({ module, children }: { module: ModuleKey; children: ReactNode }) {
  const site = useSiteConfig();
  if (!isModuleEnabled(site, module)) return <Navigate to="/" replace />;
  return <>{children}</>;
}
