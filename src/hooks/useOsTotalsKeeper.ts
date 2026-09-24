import { useEffect, useRef } from "react";
import { updateRowCellsBulk } from "@/services/pageService";
import { updateSubPageRowCellsBulk } from "@/services/subPageService";
import type { OsDeskKeys } from "@/utils/osDeskKeys";
import { parseLooseNumber } from "@/utils/numberInput";
import { feeKeyOf, osRowTotal } from "@/utils/payment";
import { planUpsellStamp, upsellAtKeyOf, upsellWasKeyOf } from "@/utils/osDates";
import { isFilledCellValue } from "@/utils/blankRow";
import { OS_ISSUED_ON_KEY, OS_RECEIVED_ON_KEY } from "@/utils/reservedCellKeys";
import type { PageColumn, PageRow } from "@/types";

const DEBOUNCE_MS = 800;

function sameAmount(cell: unknown, expected: number | null): boolean {
  const raw = cell === null || cell === undefined ? "" : String(cell).trim();
  if (expected === null) return raw === "";
  if (!raw) return false;
  const n = parseLooseNumber(raw);
  return n !== null && Math.abs(n - expected) < 0.005;
}

/**
 * Держит столбец «Итого» стола ОС в согласии с ценой, апсейлом и их
 * способами оплаты (utils/payment.ts).
 *
 * «Итого» хранится ячейкой, а не считается на лету: по ячейкам работают
 * нижняя полоса итогов, фильтры, сортировка, копирование и сводка «Столов ОС».
 * Пишет его САМ стол — кто бы ни поменял цену (правка ячейки, вставка из
 * Excel, заполнение маркером, карточка строки), через секунду «Итого» догонит.
 * Считать можно только по строкам с сервера: по старому снимку из кэша стол
 * записал бы сумму от прошлой цены.
 *
 * Той же записью ставится ДАТА АПСЕЙЛА (`{апсейл}__at`, utils/osDates.ts):
 * когда вкладка видит, что апсейл строки сменился, — «сейчас». Старым
 * строкам дату не выдумываем: она ставится только за смену на наших глазах.
 */
export function useOsTotalsKeeper(input: {
  workspaceId: string | null;
  pageId: string;
  subPageId: string | null;
  rows: PageRow[];
  columns: readonly PageColumn[] | null | undefined;
  keys: OsDeskKeys;
  enabled: boolean;
  rowsFromServer: boolean;
}) {
  const latest = useRef(input);
  latest.current = input;
  const busy = useRef(new Set<string>());
  /** Апсейл, который вкладка увидела у строки первым (см. planUpsellStamp). */
  const upsellSeen = useRef(new Map<string, string>());
  const activatedAt = useRef(0);
  const { keys } = input;
  const hasTotal = Boolean(input.columns?.some((c) => c.key === keys.total));
  // Без «Итого» (стол ещё не дописан) дата апсейла всё равно ставится.
  const active = Boolean(input.enabled && input.workspaceId && input.rowsFromServer);
  const signature = active
    ? input.rows
        .map(
          (r) =>
            `${r.id}:${r.cells[keys.price] ?? ""}:${r.cells[feeKeyOf(keys.price)] ?? ""}:${r.cells[keys.upsell] ?? ""}:${r.cells[feeKeyOf(keys.upsell)] ?? ""}:${r.cells[keys.total] ?? ""}:${r.cells[upsellAtKeyOf(keys.upsell)] ?? ""}:${r.cells[upsellWasKeyOf(keys.upsell)] ?? ""}:${r.cells[OS_RECEIVED_ON_KEY] ?? ""}:${r.cells[OS_ISSUED_ON_KEY] ?? ""}:${(input.columns ?? []).some((c) => isFilledCellValue(r.cells[c.key])) ? 1 : 0}`
        )
        .join("|")
    : "";

  // Первые значения апсейла — с того снимка, которым стол стал «с сервера».
  // Строка, заведённая уже после этого, считается пришедшей с пустым.
  useEffect(() => {
    if (!active) return;
    if (!activatedAt.current) activatedAt.current = Date.now();
    const cur = latest.current;
    for (const row of cur.rows) {
      if (upsellSeen.current.has(row.id)) continue;
      const fresh = (row.createdAt ?? 0) > activatedAt.current - 2_000;
      const v = row.cells[cur.keys.upsell];
      upsellSeen.current.set(row.id, fresh ? "" : v === null || v === undefined ? "" : String(v).trim());
    }
  }, [active, signature]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => {
      const cur = latest.current;
      if (!cur.workspaceId) return;
      const now = Date.now();
      for (const row of cur.rows) {
        if (busy.current.has(row.id)) continue;
        const patch: Record<string, string | null> = {};
        const expected = osRowTotal(row, cur.keys);
        if (hasTotal && !sameAmount(row.cells[cur.keys.total], expected)) {
          patch[cur.keys.total] = expected === null ? null : String(expected);
        }
        const stamp = planUpsellStamp({ row, upsellKey: cur.keys.upsell, baseline: upsellSeen.current.get(row.id), now });
        if (stamp) Object.assign(patch, stamp);
        // Строку очистили целиком (выделили и Delete) — поставленные ОС даты
        // «получен/выдан» ей больше не нужны. Иначе строка так и осталась бы
        // «заказом» (isBlankRow видит любую ячейку): в счётчиках, в карточках
        // и мимо «первого пустого слота» для нового заказа.
        const emptied = !(cur.columns ?? []).some((c) => isFilledCellValue(row.cells[c.key]));
        if (emptied) {
          if (isFilledCellValue(row.cells[OS_RECEIVED_ON_KEY])) patch[OS_RECEIVED_ON_KEY] = null;
          if (isFilledCellValue(row.cells[OS_ISSUED_ON_KEY])) patch[OS_ISSUED_ON_KEY] = null;
        }
        if (Object.keys(patch).length === 0) continue;
        busy.current.add(row.id);
        const write = cur.subPageId
          ? updateSubPageRowCellsBulk(cur.workspaceId, cur.pageId, cur.subPageId, row.id, patch)
          : updateRowCellsBulk(cur.workspaceId, cur.pageId, row.id, patch);
        void write
          .then(() => {
            // Дату поставили — под это значение она и стоит.
            if (stamp) upsellSeen.current.set(row.id, String(row.cells[cur.keys.upsell] ?? "").trim());
          })
          .catch((error) => console.warn("[касса] «Итого» / дата апсейла не записаны:", error))
          .finally(() => busy.current.delete(row.id));
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, signature]);
}
