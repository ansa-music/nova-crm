import { useEffect, useRef } from "react";
import { updateRowCellsBulk } from "@/services/pageService";
import { updateSubPageRowCellsBulk } from "@/services/subPageService";
import type { OsDeskKeys } from "@/utils/osDeskKeys";
import { parseLooseNumber } from "@/utils/numberInput";
import { feeKeyOf, osRowTotal } from "@/utils/payment";
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
  const { keys } = input;
  const hasTotal = Boolean(input.columns?.some((c) => c.key === keys.total));
  const active = Boolean(input.enabled && input.workspaceId && input.rowsFromServer && hasTotal);
  const signature = active
    ? input.rows
        .map(
          (r) =>
            `${r.id}:${r.cells[keys.price] ?? ""}:${r.cells[feeKeyOf(keys.price)] ?? ""}:${r.cells[keys.upsell] ?? ""}:${r.cells[feeKeyOf(keys.upsell)] ?? ""}:${r.cells[keys.total] ?? ""}`
        )
        .join("|")
    : "";

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => {
      const cur = latest.current;
      if (!cur.workspaceId) return;
      for (const row of cur.rows) {
        if (busy.current.has(row.id)) continue;
        const expected = osRowTotal(row, cur.keys);
        if (sameAmount(row.cells[cur.keys.total], expected)) continue;
        const patch = { [cur.keys.total]: expected === null ? null : String(expected) };
        busy.current.add(row.id);
        const write = cur.subPageId
          ? updateSubPageRowCellsBulk(cur.workspaceId, cur.pageId, cur.subPageId, row.id, patch)
          : updateRowCellsBulk(cur.workspaceId, cur.pageId, row.id, patch);
        void write
          .catch((error) => console.warn("[касса] «Итого» не записано:", error))
          .finally(() => busy.current.delete(row.id));
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, signature]);
}
