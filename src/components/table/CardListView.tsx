import { useMemo, useState } from "react";
import { CalendarDays, ChevronRight, Phone, Plus } from "lucide-react";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { StatusBadge } from "@/components/table/StatusBadge";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/utils/format";
import { formatOrderDate } from "@/utils/date";
import { parseLooseNumber } from "@/utils/numberInput";
import { pickRowCardColumns } from "@/utils/rowCardColumns";
import { isBlankRow } from "@/utils/blankRow";
import { cn } from "@/utils/cn";
import type { PageColumn, PageRow } from "@/types";

/** Сколько карточек показываем сразу: телефонный экран всё равно не покажет больше. */
const PAGE_SIZE = 40;

interface CardListViewProps {
  columns: PageColumn[];
  rows: PageRow[];
  canEdit: boolean;
  onOpenRow: (rowId: string) => void;
  onAddOrder?: () => void;
}

/**
 * Список заказов карточками — режим стола для телефона.
 *
 * Таблица на узком экране показывает два столбца из десяти, остальное — вбок
 * прокруткой; здесь одна строка = одна карточка с тем, ради чего в неё
 * смотрят: клиент, сумма, статус, дата, телефон. Правка — по тапу, в той же
 * карточке строки (`RowCardSheet`), что открывается из таблицы и канбана,
 * поэтому отдельного редактора здесь нет и расходиться нечему.
 *
 * На телефоне карточки идут одной колонкой, на широком экране — сеткой:
 * иначе на десктопе это была бы одна колонка во всю ширину стола.
 */
export function CardListView({ columns, rows, canEdit, onOpenRow, onAddOrder }: CardListViewProps) {
  const fields = useMemo(() => pickRowCardColumns(columns), [columns]);
  const [limit, setLimit] = useState(PAGE_SIZE);

  // Пустые строки — это свободные слоты таблицы, а не заказы: в списке они
  // были бы рядом одинаковых пустых карточек.
  const orders = useMemo(() => rows.filter((row) => !isBlankRow(row)), [rows]);
  const visible = orders.slice(0, limit);

  const total = useMemo(() => {
    if (!fields.currency) return null;
    let sum = 0;
    let any = false;
    for (const row of orders) {
      const n = parseLooseNumber(String(row.cells[fields.currency.key] ?? ""));
      if (n !== null) {
        sum += n;
        any = true;
      }
    }
    return any ? sum : null;
  }, [orders, fields.currency]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-background p-3 pb-[max(env(safe-area-inset-bottom,0px),12px)] scrollbar-thin">
      <div className="mb-2 flex items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
        <span>
          {orders.length} {orders.length === 1 ? "заказ" : "заказов"}
        </span>
        {total !== null && <span className="tabular text-foreground">{formatCurrency(total)}</span>}
      </div>

      {orders.length === 0 ? (
        <p className="px-1 py-8 text-center text-sm text-muted-foreground">Заказов пока нет.</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((row) => {
            const title = fields.title ? String(row.cells[fields.title.key] ?? "").trim() : "";
            const amount = fields.currency
              ? parseLooseNumber(String(row.cells[fields.currency.key] ?? ""))
              : null;
            const statusValue = fields.status ? String(row.cells[fields.status.key] ?? "") : "";
            const responsibleValue = fields.responsible ? String(row.cells[fields.responsible.key] ?? "") : "";
            const responsibleOption = fields.responsible?.statusOptions?.find((o) => o.value === responsibleValue);
            const dateValue = fields.date ? Number(row.cells[fields.date.key] ?? 0) : 0;
            const phone = fields.phone ? String(row.cells[fields.phone.key] ?? "").trim() : "";

            return (
              <button
                key={row.id}
                type="button"
                onClick={() => onOpenRow(row.id)}
                className={cn(
                  "flex w-full items-start gap-2 rounded-lg border p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40",
                  // Заказ, приехавший с «Заказов», должен быть виден и здесь:
                  // на телефоне стол открывается карточками, а чип «N новых»
                  // в тулбаре не показывает, КАКАЯ из карточек новая.
                  row.highlight ? "border-primary/55 bg-primary/10" : "border-border bg-card"
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    {title ? (
                      <p className="min-w-0 flex-1 truncate font-medium leading-snug">{title}</p>
                    ) : (
                      <p className="min-w-0 flex-1 truncate italic text-muted-foreground">Без названия</p>
                    )}
                    {amount !== null && (
                      <span className="tabular shrink-0 text-sm font-medium">{formatCurrency(amount)}</span>
                    )}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground">
                    {fields.status && statusValue && (
                      <StatusBadge value={statusValue} options={fields.status.statusOptions ?? []} />
                    )}
                    {dateValue > 0 && (
                      <span className="inline-flex items-center gap-1 tabular">
                        <CalendarDays className="h-3 w-3" /> {formatOrderDate(dateValue)}
                      </span>
                    )}
                    {phone && (
                      <span className="inline-flex items-center gap-1 tabular">
                        <Phone className="h-3 w-3" /> {phone}
                      </span>
                    )}
                    {responsibleOption && (
                      <span className="inline-flex items-center gap-1">
                        <MemberAvatar
                          id={responsibleOption.value}
                          name={responsibleOption.label}
                          className="h-4 w-4 text-[9px]"
                        />
                        {responsibleOption.label}
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            );
          })}
        </div>
      )}

      {orders.length > visible.length && (
        <Button
          variant="outline"
          className="mt-2 w-full"
          onClick={() => setLimit((v) => v + PAGE_SIZE)}
        >
          Показать ещё ({orders.length - visible.length})
        </Button>
      )}

      {canEdit && onAddOrder && (
        <Button variant="outline" className={cn("mt-2 w-full gap-1.5")} onClick={onAddOrder}>
          <Plus className="h-4 w-4" /> Новый заказ
        </Button>
      )}
    </div>
  );
}
