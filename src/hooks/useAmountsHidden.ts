import { useEffect, useSyncExternalStore } from "react";
import { useWorkspaceStore } from "@/store/workspaceStore";
import type { Role } from "@/types";
import { hasFullAccess } from "@/utils/permissions";
import { amountsHiddenSnapshot, flushAmountsHidden, setAmountsHidden, subscribeAmountsHidden } from "@/utils/format";

/**
 * «Скрыть суммы» (просьба Nurba 15.10.2026): Owner включает
 * `workspace.hideAmounts` — и ОС, технари и остальные не из руководства вместо
 * денег везде видят «•••»: цены, апсейлы, «Итого», транши, кассы, премии, итоги
 * и статистику, в том числе по прошлым заказам. Вводить суммы они по-прежнему
 * могут (форма заказа, ячейка стола — редактор открывается пустым), а в момент
 * выдачи заказа (биржа «Заказы», окна выдачи ОС) сумма видна. Руководство
 * (Owner, Тимлид, Тимлид+) видит всё. Режим роли Owner считается по выбранной
 * роли — так Owner видит то же, что технарь.
 *
 * Это скрытие В ИНТЕРФЕЙСЕ, а не защита данных: строки по-прежнему приходят с
 * сервера целиком, и человек с инструментами разработчика сумму найдёт.
 *
 * Мост ставит флаг ПРИ ОТРИСОВКЕ каркаса (страницы рисуются после и сразу
 * маскируют), подписчиков будит эффектом. Пока роль не известна, суммы скрыты.
 */
export function useAmountsHiddenBridge(role: Role, isResolved: boolean) {
  const on = useWorkspaceStore((s) => Boolean(s.workspaces.find((w) => w.id === s.activeWorkspaceId)?.hideAmounts));
  const hidden = on && !(isResolved && hasFullAccess(role));
  setAmountsHidden(hidden);
  useEffect(() => {
    flushAmountsHidden();
  }, [hidden]);
}

/** Скрыты ли суммы от смотрящего — с перерисовкой, когда Owner переключил. */
export function useAmountsHidden(): boolean {
  return useSyncExternalStore(subscribeAmountsHidden, amountsHiddenSnapshot, amountsHiddenSnapshot);
}
