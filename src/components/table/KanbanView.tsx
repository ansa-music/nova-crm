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

interface KanbanViewProps {
  columns: PageColumn[];
  rows: PageRow[];
  statusColumn: PageColumn;
  canEdit: boolean;
  onStatusChange: (rowId: string, colKey: string, value: string) => void;
}

export function KanbanView({ columns, rows, statusColumn, canEdit, onStatusChange }: KanbanViewProps) {
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

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setDragActive(false)}>
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
        {rowsByStatus.hasUnassigned && (
          <KanbanColumn
            option={{ value: UNASSIGNED_VALUE, label: "Без статуса", color: "240 4% 60%" }}
            rows={rowsByStatus.map.get(UNASSIGNED_VALUE) ?? []}
            titleColKey={titleColKey}
            currencyColKey={currencyCol?.key}
            responsibleCol={responsibleCol}
            canEdit={canEdit}
            dragActive={dragActive}
          />
        )}
        {options.map((option) => (
          <KanbanColumn
            key={option.value}
            option={option}
            rows={rowsByStatus.map.get(option.value) ?? []}
            titleColKey={titleColKey}
            currencyColKey={currencyCol?.key}
            responsibleCol={responsibleCol}
            canEdit={canEdit}
            dragActive={dragActive}
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
}

function KanbanColumn({ option, rows, titleColKey, currencyColKey, responsibleCol, canEdit, dragActive }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: option.value });

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
  const title = titleColKey ? String(row.cells[titleColKey] ?? "") : "";
  const amount = currencyColKey ? row.cells[currencyColKey] : null;
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
      <p className="truncate pr-6 font-medium">{title || <span className="italic text-muted-foreground">Без названия</span>}</p>
      {currencyColKey && amount !== null && amount !== "" && (
        <p className="mt-1 text-xs text-muted-foreground">{formatCurrency(Number(amount))}</p>
      )}
    </div>
  );
}
