import { carriedLabel } from "@/utils/carryOver";
import { useMemo, useState, type ReactNode } from "react";
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
  /** Своя добавка в строку мета-данных карточки (стол ОС: «получен / выдан»). */
  renderMeta?: (row: PageRow) => ReactNode;
  /**
   * Полоса под карточкой со своим действием (стол ОС: технарь и «Выдать…»).
   * Стоит РЯДОМ с кнопкой карточки, а не внутри неё: кнопка в кнопке — это
   * невалидная разметка и двойной клик по одному касанию. Нет — карточка как
   * раньше. Технарь в строке мета-данных тогда не повторяется — он в полосе.
   */
  renderFooter?: (row: PageRow) => ReactNode;
  /** Текст пустого списка (стол ОС объясняет, с чего начать). */
  emptyText?: string;
  /** Имена вкладок по id — метка «перенос» у строк из прошлого периода. */
  tabNames?: Readonly<Record<string, string>>;
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
export function CardListView({ columns, rows, canEdit, onOpenRow, onAddOrder, renderMeta, renderFooter, emptyText, tabNames }: CardListViewProps) {
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
        <p className="px-1 py-8 text-center text-sm text-muted-foreground">{emptyText ?? "Заказов пока нет."}</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((row) => {
            const title = fields.title ? String(row.cells[fields.title.key] ?? "").trim() : "";
            const amount = fields.currency
              ? parseLooseNumber(String(row.cells[fields.currency.key] ?? ""))
              : null;
            const statusValue = fields.status ? String(row.cells[fields.status.key] ?? "") : "";
            const footer = renderFooter?.(row) ?? null;
            // Технарь (запасной «ответственный» стола ОС) при своей полосе под
            // карточкой уже стоит там — второй раз в мета-строке он не нужен.
            // Только когда полоса у ЭТОЙ карточки правда есть: у строки без
            // клиента её нет, и технарь не показывался бы нигде.
            const responsibleCol =
              footer && fields.responsible?.type === "technician" ? undefined : fields.responsible;
            const responsibleValue = responsibleCol ? String(row.cells[responsibleCol.key] ?? "") : "";
            const responsibleOption = responsibleCol?.statusOptions?.find((o) => o.value === responsibleValue);
            // Заказ, приехавший с «Заказов», должен быть виден и здесь: на
            // телефоне стол открывается карточками, а чип «N новых» в тулбаре
            // не показывает, КАКАЯ из карточек новая.
            const tone = row.highlight
              ? "border-warning/70 bg-warning/[0.12]"
              : row.orderId
                ? "border-violet-400/45 bg-violet-400/[0.07]"
                : "border-border bg-card";
            const dateValue = fields.date ? Number(row.cells[fields.date.key] ?? 0) : 0;
            const phone = fields.phone ? String(row.cells[fields.phone.key] ?? "").trim() : "";

            const card = (
              <button
                key={footer ? undefined : row.id}
                type="button"
                onClick={() => onOpenRow(row.id)}
                className={cn(
                  "flex w-full items-start gap-2 p-3 text-left transition-colors hover:bg-accent/40",
                  footer ? "rounded-t-lg" : cn("rounded-lg border hover:border-primary/40", tone)
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
                    {/* Не просто цвет: подпись «новый» читается и в чёрно-белом
                        режиме, и тем, кто цвета различает плохо. Стоит в строке
                        мета-данных, а не у заголовка — там он съедал имя клиента. */}
                    {row.highlight && (
                      <span className="rounded-full border border-warning/60 bg-warning/20 px-1.5 text-[10px] font-semibold uppercase leading-4 text-warning">
                        новый
                      </span>
                    )}
                    {row.carriedFrom && (
                      <span
                        className="rounded-full border border-sky-400/50 bg-sky-400/15 px-1.5 text-[10px] font-semibold uppercase leading-4 text-sky-200"
                        title={`Перенесён из «${carriedLabel(row, tabNames)}»`}
                      >
                        перенос
                      </span>
                    )}
                    {fields.status && statusValue && (
                      <StatusBadge value={statusValue} options={fields.status.statusOptions ?? []} />
                    )}
                    {renderMeta?.(row)}
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
            if (!footer) return card;
            return (
              <div key={row.id} className={cn("flex flex-col rounded-lg border transition-colors hover:border-primary/40", tone)}>
                {card}
                <div className="flex min-h-11 items-center gap-2 border-t border-border/60 px-3 py-1.5">{footer}</div>
              </div>
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
