import { Check, CreditCard, Settings2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/utils/cn";
import { findPaymentMethod, formatFee, payKeyOf, rowFeePct } from "@/utils/payment";
import type { PageRow, PaymentMethod } from "@/types";

/**
 * Способ оплаты внутри денежной ячейки стола ОС («Цена», «Апсейл»): чип слева
 * от суммы, по нажатию — список способов с комиссией. У цены и у апсейла
 * способ свой. Комиссия в чипе — СНИМОК из строки (`__fee`), а не нынешняя
 * настройка: заказ продан по той комиссии, что была тогда.
 */
export function PaymentChip({
  row,
  colKey,
  methods,
  canEdit,
  canConfigure,
  compact,
  onPick,
  onConfigure,
}: {
  row: PageRow;
  colKey: string;
  methods: readonly PaymentMethod[];
  canEdit: boolean;
  /** Owner: пункт «Настроить способы…». */
  canConfigure?: boolean;
  /** Узкая ячейка таблицы (а не карточка строки). */
  compact?: boolean;
  onPick: (method: PaymentMethod | null) => void;
  onConfigure?: () => void;
}) {
  const id = row.cells[payKeyOf(colKey)];
  const method = findPaymentMethod(methods, id);
  const fee = rowFeePct(row, colKey);
  const label = method?.label ?? (id ? String(id) : "");
  if (!label && !canEdit) return null;
  const active = methods.filter((m) => !m.inactive || m.id === id);

  const chip = (
    <span
      className={cn(
        "inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border text-[10px] font-medium leading-none",
        compact ? "h-5 px-1.5" : "h-7 px-2.5 text-xs",
        label
          ? "border-border bg-muted/60 text-foreground"
          : "border-dashed border-border px-1.5 text-muted-foreground opacity-50 group-hover/row:opacity-100"
      )}
      title={label ? `${label} · ${formatFee(fee)}` : "Способ оплаты"}
    >
      {label ? (
        <>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: method?.color ?? "hsl(var(--muted-foreground))" }} />
          <span className="truncate">{label}</span>
          {fee > 0 ? <span className="shrink-0 text-muted-foreground">−{String(fee).replace(".", ",")}%</span> : null}
        </>
      ) : (
        <>
          <CreditCard className="h-3 w-3 shrink-0" />
          {compact ? null : <span>Способ оплаты</span>}
        </>
      )}
    </span>
  );

  if (!canEdit) return chip;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        asChild
        // Нажатие по чипу не должно выделять ячейку и открывать правку суммы.
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" data-payment-chip className="inline-flex min-w-0 max-w-full items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          {chip}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Способ оплаты</DropdownMenuLabel>
        {active.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">Способов нет — их добавляет Owner.</p>
        ) : (
          active.map((m) => (
            <DropdownMenuItem key={m.id} onSelect={() => onPick(m)} className="gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: m.color ?? "hsl(var(--muted-foreground))" }} />
              <span className="min-w-0 flex-1 truncate">{m.label}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatFee(m.commissionPct)}</span>
              {m.id === id ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
            </DropdownMenuItem>
          ))
        )}
        {id ? (
          <DropdownMenuItem onSelect={() => onPick(null)} className="text-muted-foreground">
            Без способа
          </DropdownMenuItem>
        ) : null}
        {canConfigure && onConfigure ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onConfigure()} className="gap-2">
              <Settings2 className="h-3.5 w-3.5" />
              Настроить способы…
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
