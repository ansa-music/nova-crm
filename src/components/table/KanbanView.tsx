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
import { Plus } from "lucide-react";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { formatCurrency } from "@/utils/format";
import { isOptionColumn } from "@/utils/columnOptions";
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
}

export function KanbanView({ columns, rows, statusColumn, canEdit, onStatusChange, onAddOrder }: KanbanViewProps) {
  const options = statusColumn.statusOptions ?? [];
  const titleColKey = columns.find((c) => !isOptionColumn(c.type) && c.type !== "date" && c.type !== "url")?.key;
  const currencyCol = columns.find((c) => c.type === "currency");
  const responsibleCol = columns.find((c) => c.type === "responsible");

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
            canEdit={canEdit}
            dragActive={dragActive}
            onAddOrder={onAddOrder}
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
  canEdit: boolean;
  dragActive: boolean;
  onAddOrder?: (statusValue: string) => void;
}

function KanbanColumn({ option, rows, titleColKey, currencyColKey, responsibleCol, canEdit, dragActive, onAddOrder }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: option.value });
  const isUnassigned = option.value === UNASSIGNED_VALUE;

  return (
    <div
      className={cn("flex h-full w-72 shrink-0 flex-col rounded-lg", dragActive ? "overflow-visible" : "overflow-hidden")}
      style={{ backgroundColor: `hsl(${option.color} / 0.05)` }}
    >
      <div
        className="h-[3px] shrink-0"
        style={{ backgroundColor: `hsl(${option.color})`, boxShadow: `0 0 10px -1px hsl(${option.color} / 0.65)` }}
      />
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: `hsl(${option.color})` }} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{option.label}</span>
        <span
          className="tabular shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-medium"
          style={{ backgroundColor: `hsl(${option.color} / 0.16)`, color: `hsl(${option.color})` }}
        >
          {rows.length}
        </span>
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
          dragActive ? "overflow-visible" : "overflow-y-auto"
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
            canEdit={canEdit}
          />
        ))}
      </div>
    </div>
  );
}

interface KanbanCardProps {
  row: PageRow;
  titleColKey?: string;
  currencyColKey?: string;
  responsibleCol?: PageColumn;
  canEdit: boolean;
}

function KanbanCard({ row, titleColKey, currencyColKey, responsibleCol, canEdit }: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: row.id, disabled: !canEdit });
  const title = titleColKey ? String(row.cells[titleColKey] ?? "").trim() : "";
  const amount = currencyColKey ? row.cells[currencyColKey] : null;
  const hasAmount = amount !== null && amount !== undefined && amount !== "" && !Number.isNaN(Number(amount));
  const responsibleValue = responsibleCol ? String(row.cells[responsibleCol.key] ?? "") : "";
  const responsibleOption = responsibleCol?.statusOptions?.find((o) => o.value === responsibleValue);

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
        "relative rounded-md border border-border bg-card p-2.5 text-sm shadow-sm",
        canEdit && "cursor-grab touch-none active:cursor-grabbing",
        isDragging && "opacity-30 shadow-lg"
      )}
    >
      {responsibleOption && (
        <MemberAvatar id={responsibleOption.value} name={responsibleOption.label} className="absolute right-2 top-2 h-5 w-5" />
      )}
      {title ? <p className={cn("truncate font-medium", responsibleOption && "pr-6")}>{title}</p> : null}
      {hasAmount && (
        <p className={cn("text-xs text-muted-foreground", title && "mt-1")}>{formatCurrency(Number(amount))}</p>
      )}
    </div>
  );
}
