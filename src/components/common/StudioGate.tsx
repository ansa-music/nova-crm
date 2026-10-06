import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { useStudioMode } from "@/config/studio";
import { useNavTargets } from "@/hooks/useNavModel";

/**
 * Разделы Nova, которых у «NOVA Studio» нет (воркспейс студии, 06.10.2026:
 * только Owner и «Менеджер», без ОС, технарей, ABS и отчётов). В студии они
 * не открываются и по прямому адресу — закладка, старая ссылка из
 * уведомления, — а ведут на «Главную». Пункты меню прячет сама настройка
 * студии (`nav.hidden`, выключенные модули).
 *
 * Только ВИД, как `ModuleGate`: флаг с черновиком Конструктора
 * (`useStudioMode`), перерисовка — лишь когда флаг сменился. Без флага
 * студии — просто дети, как будто обёртки нет.
 */
export const STUDIO_BLOCKED_PATHS: readonly string[] = [
  "/leads",
  "/big-orders",
  "/desk-editing",
  "/os-desk",
  "/os-desks",
  "/os-dispatch",
  "/dispatch",
  "/observers",
  "/team",
  "/abs",
  "/weekly-rating",
  "/technicians",
  "/reports",
];

/** Адрес (с `?`/`#` или без) ведёт в раздел, которого у студии нет. */
export function isStudioBlockedPath(to: string): boolean {
  const path = to.split(/[?#]/)[0];
  return STUDIO_BLOCKED_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

export function StudioGate({ children }: { children: ReactNode }) {
  const studio = useStudioMode();
  if (studio) return <StudioRedirect />;
  return <>{children}</>;
}

/**
 * «/» сам уводит на дом человека (`HomePage` → `home.to`). Если дом —
 * закрытый здесь раздел (Owner смотрит «как Тимлид+» — его дом «Общая
 * таблица»), «/» замкнул бы круг; тогда — на «Столы», они есть у всех.
 * Отдельным компонентом: вне студии модель навигации здесь не читается.
 */
function StudioRedirect() {
  const { homeTo } = useNavTargets();
  return <Navigate to={isStudioBlockedPath(homeTo) ? "/desks" : "/"} replace />;
}
