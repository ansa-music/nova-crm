import { useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { CalendarDays, Maximize2, Phone, Plus } from "lucide-react";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { formatCurrency } from "@/utils/format";
import { formatOrderDate } from "@/utils/date";
import { isOptionColumn } from "@/utils/columnOptions";
import { parseLooseNumber } from "@/utils/numberInput";
import { cn } from "@/utils/cn";
import type { PageColumn, PageRow, StatusOption } from "@/types";

// Bucket for rows whose status doesn't match any current option (cleared,
// or the option that held it was since deleted) — shown only when at least
// one such row exists, so it never adds visual noise to a page where every
// row is properly categorized.
const UNASSIGNED_VALUE = "__unassigned__";
const UNASSIGNED_OPTION: StatusOption = { value: UNASSIGNED_VALUE, label: "Без статуса", color: "240 4% 60%" };

interface KanbanViewProps {
  columns: PageColumn[];
  rows: PageRow[];
  statusColumn: PageColumn;
  canEdit: boolean;
  onStatusChange: (rowId: string, colKey: string, value: string) => void;
  onAddOrder?: (statusValue: string) => void;
  /** Open the row card (click on a card). */
  onOpenRow?: (rowId: string) => void;
}

export function KanbanView({ columns, rows, statusColumn, canEdit, onStatusChange, onAddOrder, onOpenRow }: KanbanViewProps) {
  const options = statusColumn.statusOptions ?? [];
  const titleColKey = columns.find((c) => !isOptionColumn(c.type) && c.type !== "date" && c.type !== "url" && c.type !== "phone" && c.type !== "email" && c.type !== "number" && c.type !== "currency")?.key ?? columns.find((c) => !isOptionColumn(c.type))?.key;
  const currencyCol = columns.find((c) => c.type === "currency");
  const responsibleCol = columns.find((c) => c.type === "responsible");
  const dateCol = columns.find((c) => c.type === "date");
  const phoneCol = columns.find((c) => c.type === "phone");

  const [dragActive, setDragActive] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const rowsByStatus = useMemo(() => {
    const map = new Map<string, PageRow[]>();
    let hasUnassigned = false;
    for (const row of rows) {
      const raw = String(row.cells[statusColumn.key] ?? "");
      const key = options.some((o) => o.value === raw) ? raw : UNASSIGNED_VALUE;
      if (key === UNASSIGNED_VALUE) hasUnassigned = true;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    return { map, hasUnassigned };
  }, [rows, statusColumn.key, options]);

  function handleDragStart(_event: DragStartEvent) {
    setDragActive(true);
  }

  function handleDragEnd(event: DragEndEvent) {
    setDragActive(false);
    const { active, over } = event;
    if (!over) return;
    const rowId = String(active.id);
    const newValue = String(over.id) === UNASSIGNED_VALUE ? "" : String(over.id);
    const row = rows.find((r) => r.id === rowId);
    if (!row) return;
    const oldValue = String(row.cells[statusColumn.key] ?? "");
    if (oldValue === newValue) return;
    onStatusChange(rowId, statusColumn.key, newValue);
  }

  // Columns visible at rest (non-empty ones, "Без статуса" first if it has
  // rows) — this order is what's already on screen the instant a drag
  // starts, and it must never change mid-drag. A dragged card is moved
  // purely via a raw pointer-delta transform (see KanbanCard), which has no
  // idea where its column actually sits in the DOM — if an empty column
  // got inserted BEFORE it right as the drag began, the card would render
  // at its (now shifted) new position plus the old delta and visibly jump
  // out from under the cursor. That's the exact "flying card" bug this
  // file has already been fixed for twice (see git log). So while dragging,
  // any currently-hidden column that needs to reappear as a drop target is
  // APPENDED after everything already on screen, never inserted among it.
  const restColumns = useMemo(() => {
    const list: StatusOption[] = [];
    if (rowsByStatus.hasUnassigned) list.push(UNASSIGNED_OPTION);
    for (const option of options) {
      if ((rowsByStatus.map.get(option.value)?.length ?? 0) > 0) list.push(option);
    }
    return list;
  }, [options, rowsByStatus]);

  const dragOnlyColumns = useMemo(() => {
    if (!dragActive) return [];
    const shown = new Set(restColumns.map((o) => o.value));
    const extra: StatusOption[] = [];
    if (!shown.has(UNASSIGNED_VALUE)) extra.push(UNASSIGNED_OPTION);
    for (const option of options) {
      if (!shown.has(option.value)) extra.push(option);
    }
    return extra;
  }, [dragActive, options, restColumns]);

  // Never show a totally blank board (e.g. a fresh page with no rows yet) —
  // fall back to every column so there's always a place to add the first order.
  const displayedColumns =
    restColumns.length === 0 && dragOnlyColumns.length === 0
      ? [UNASSIGNED_OPTION, ...options]
      : [...restColumns, ...dragOnlyColumns];

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setDragActive(false)}>
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
        {displayedColumns.map((option) => (
          <KanbanColumn
            key={option.value}
            option={option}
            rows={rowsByStatus.map.get(option.value) ?? []}
            titleColKey={titleColKey}
            currencyColKey={currencyCol?.key}
            responsibleCol={responsibleCol}
            dateColKey={dateCol?.key}
            phoneColKey={phoneCol?.key}
            canEdit={canEdit}
            dragActive={dragActive}
            onAddOrder={onAddOrder}
            onOpenRow={onOpenRow}
          />
        ))}
      </div>
    </DndContext>
  );
}

interface KanbanColumnProps {
  option: StatusOption;
  rows: PageRow[];
  titleColKey?: string;
  currencyColKey?: string;
  responsibleCol?: PageColumn;
  dateColKey?: string;
  phoneColKey?: string;
  canEdit: boolean;
  dragActive: boolean;
  onAddOrder?: (statusValue: string) => void;
  onOpenRow?: (rowId: string) => void;
}

function KanbanColumn({ option, rows, titleColKey, currencyColKey, responsibleCol, dateColKey, phoneColKey, canEdit, dragActive, onAddOrder, onOpenRow }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: option.value });
  const isUnassigned = option.value === UNASSIGNED_VALUE;
  const [collapsed, setCollapsed] = useState(false);
  const sum = useMemo(() => {
    if (!currencyColKey) return null;
    let total = 0;
    for (const row of rows) {
      const n = parseLooseNumber(String(row.cells[currencyColKey] ?? ""));
      if (n !== null) total += n;
    }
    return total;
  }, [rows, currencyColKey]);

  return (
    <div
      className={cn(
        "kanban-column flex h-full shrink-0 flex-col rounded-lg border border-transparent",
        collapsed && !dragActive ? "w-12" : "w-72",
        dragActive ? "overflow-visible" : "overflow-hidden"
      )}
      style={{ backgroundColor: `hsl(${option.color} / 0.05)`, borderColor: isOver ? `hsl(${option.color} / 0.5)` : undefined }}
    >
      <div
        className="h-[3px] shrink-0"
        style={{ backgroundColor: `hsl(${option.color})`, boxShadow: `0 0 10px -1px hsl(${option.color} / 0.65)` }}
      />
      {collapsed && !dragActive ? (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="flex flex-1 flex-col items-center gap-2 py-3 text-xs text-muted-foreground hover:text-foreground"
          title={`Развернуть «${option.label}»`}
        >
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: `hsl(${option.color})` }} />
          <span className="tabular rounded-full px-1.5 py-0.5 text-[11px] font-medium" style={{ backgroundColor: `hsl(${option.color} / 0.16)`, color: `hsl(${option.color})` }}>
            {rows.length}
          </span>
          <span className="[writing-mode:vertical-rl] truncate text-[11px] font-medium text-foreground" style={{ maxHeight: 160 }}>
            {option.label}
          </span>
        </button>
      ) : null}
      <div className={cn("flex items-center gap-2 px-3 py-2.5", collapsed && !dragActive && "hidden")}>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="h-2 w-2 shrink-0 rounded-full ring-offset-2 ring-offset-background hover:ring-2"
          style={{ backgroundColor: `hsl(${option.color})`, "--tw-ring-color": `hsl(${option.color} / 0.5)` } as React.CSSProperties}
          title="Свернуть колонку"
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{option.label}</span>
        <span
          className="tabular shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-medium"
          style={{ backgroundColor: `hsl(${option.color} / 0.16)`, color: `hsl(${option.color})` }}
        >
          {rows.length}
        </span>
        {sum !== null && sum !== 0 && (
          <span className="tabular shrink-0 text-[11px] text-muted-foreground" title="Сумма по колонке">
            {formatCurrency(sum)}
          </span>
        )}
        {canEdit && onAddOrder && !isUnassigned && (
          <button
            type="button"
            title="Заказ"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onAddOrder(option.value);
            }}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="sr-only">Заказ</span>
          </button>
        )}
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 space-y-2 rounded-md border border-dashed border-transparent px-2 pb-2 transition-colors",
          dragActive ? "overflow-visible" : "overflow-y-auto",
          collapsed && !dragActive && "hidden"
        )}
        style={isOver ? { borderColor: `hsl(${option.color} / 0.5)`, backgroundColor: `hsl(${option.color} / 0.08)` } : undefined}
      >
        {rows.map((row) => (
          <KanbanCard
            key={row.id}
            row={row}
            titleColKey={titleColKey}
            currencyColKey={currencyColKey}
            responsibleCol={responsibleCol}
            dateColKey={dateColKey}
            phoneColKey={phoneColKey}
            canEdit={canEdit}
            onOpenRow={onOpenRow}
          />
        ))}
        {rows.length === 0 && !dragActive && (
          <p className="px-2 py-6 text-center text-[11px] text-muted-foreground">Пусто</p>
        )}
      </div>
    </div>
  );
}

interface KanbanCardProps {
  row: PageRow;
  titleColKey?: string;
  currencyColKey?: string;
  responsibleCol?: PageColumn;
  dateColKey?: string;
  phoneColKey?: string;
  canEdit: boolean;
  onOpenRow?: (rowId: string) => void;
}

function KanbanCard({ row, titleColKey, currencyColKey, responsibleCol, dateColKey, phoneColKey, canEdit, onOpenRow }: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: row.id, disabled: !canEdit });
  const title = titleColKey ? String(row.cells[titleColKey] ?? "").trim() : "";
  const amount = currencyColKey ? row.cells[currencyColKey] : null;
  const parsedAmount = amount === null || amount === undefined || amount === "" ? null : parseLooseNumber(String(amount));
  const hasAmount = parsedAmount !== null;
  const responsibleValue = responsibleCol ? String(row.cells[responsibleCol.key] ?? "") : "";
  const responsibleOption = responsibleCol?.statusOptions?.find((o) => o.value === responsibleValue);
  const dateValue = dateColKey ? Number(row.cells[dateColKey] ?? 0) : 0;
  const phone = phoneColKey ? String(row.cells[phoneColKey] ?? "").trim() : "";

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        zIndex: isDragging ? 50 : undefined,
        position: isDragging ? "relative" : undefined,
      }}
      {...attributes}
      {...listeners}
      className={cn(
        "kanban-card group/card relative rounded-md border border-border bg-card p-2.5 text-sm shadow-sm",
        canEdit && "cursor-grab touch-none active:cursor-grabbing",
        isDragging && "opacity-30 shadow-lg"
      )}
      onDoubleClick={() => onOpenRow?.(row.id)}
    >
      {responsibleOption && (
        <MemberAvatar id={responsibleOption.value} name={responsibleOption.label} className="absolute right-2 top-2 h-5 w-5" />
      )}
      {onOpenRow && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onOpenRow(row.id);
          }}
          className={cn(
            "absolute bottom-1.5 right-1.5 rounded p-1 text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover/card:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
            !canEdit && "opacity-100"
          )}
          title="Открыть карточку"
        >
          <Maximize2 className="h-3 w-3" />
        </button>
      )}
      {title ? <p className={cn("line-clamp-2 font-medium leading-snug", responsibleOption && "pr-6")}>{title}</p> : <p className="italic text-muted-foreground">Без названия</p>}
      <div className={cn("mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground")}>
        {hasAmount && <span className="tabular text-foreground">{formatCurrency(parsedAmount)}</span>}
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
      </div>
    </div>
  );
}
