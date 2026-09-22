import { useSyncExternalStore } from "react";
import { AlertTriangle, X } from "lucide-react";
import { clearDbQuotaHit, dbQuotaHit, subscribeDbQuota } from "@/utils/dbError";

/**
 * «Кончилась дневная квота базы» — одной полосой на всё приложение.
 *
 * Без неё это выглядит как набор несвязанных поломок: не сохраняется ячейка,
 * не одобряется заявка, не ставится статус — каждый думает, что сломалось
 * именно его. Полоса говорит прямо: до сброса квоты записи не проходят НИ У
 * КОГО, и ждать надо, а не чинить.
 *
 * Закрыть можно — но флаг поднимется снова на следующем же отказе: пока
 * квоты нет, это правда, а не уведомление, которое «прочитали».
 */
export function DbQuotaBanner() {
  const hit = useSyncExternalStore(subscribeDbQuota, dbQuotaHit, () => false);
  if (!hit) return null;
  return (
    <div className="pointer-events-auto fixed inset-x-0 top-0 z-[60] flex items-start gap-2 border-b border-destructive/40 bg-destructive/15 px-3 py-2 backdrop-blur-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <p className="min-w-0 flex-1 text-[12px] leading-snug text-destructive">
        <span className="font-semibold">Кончилась дневная квота базы.</span> До её сброса (около 13:00 по Алматы)
        ничего не сохраняется — ни заказы, ни график, ни настройки. Это не поломка приложения и не ваша ошибка:
        открытые страницы работают, но любые изменения не запишутся.
      </p>
      <button
        type="button"
        onClick={clearDbQuotaHit}
        aria-label="Скрыть"
        className="-m-1 shrink-0 rounded-md p-1 text-destructive/80 transition-colors hover:text-destructive"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
