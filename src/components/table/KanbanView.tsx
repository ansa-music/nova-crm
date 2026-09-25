import { carriedLabel } from "@/utils/carryOver";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  pointerWithin,
  rectIntersection,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
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
  /** Имена вкладок по id — метка «перенос» у строк из прошлого периода. */
  tabNames?: Readonly<Record<string, string>>;
}

export function KanbanView({ columns, rows, statusColumn, canEdit, onStatusChange, onAddOrder, onOpenRow, tabNames }: KanbanViewProps) {
  const options = statusColumn.statusOptions ?? [];
  const titleColKey = columns.find((c) => !isOptionColumn(c.type) && c.type !== "date" && c.type !== "url" && c.type !== "phone" && c.type !== "email" && c.type !== "number" && c.type !== "currency")?.key ?? columns.find((c) => !isOptionColumn(c.type))?.key;
  const currencyCol = columns.find((c) => c.type === "currency");
  const responsibleCol = columns.find((c) => c.type === "responsible");
  const dateCol = columns.find((c) => c.type === "date");
  const phoneCol = columns.find((c) => c.type === "phone");

  const [draggingRowId, setDraggingRowId] = useState<string | null>(null);
  const dragActive = draggingRowId !== null;
  // Mouse drags right away; a finger has to hold the card first, so a
  // normal swipe still scrolls the board instead of grabbing a card.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } })
  );

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

  function handleDragStart(event: DragStartEvent) {
    setDraggingRowId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggingRowId(null);
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
  // rows) — this order must not change mid-drag, or the columns under the
  // pointer shift and the drop lands in the wrong one. While dragging, any
  // currently-hidden column that needs to reappear as a drop target is
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

  const draggingRow = draggingRowId ? rows.find((r) => r.id === draggingRowId) ?? null : null;
  const cardFields = {
    tabNames,
    titleColKey,
    currencyColKey: currencyCol?.key,
    responsibleCol,
    dateColKey: dateCol?.key,
    phoneColKey: phoneCol?.key,
  };

  return (
    <DndContext
      sensors={sensors}
      /**
       * Цель — колонка ПОД КУРСОРОМ, и геометрия колонок перемеряется постоянно.
       *
       * По умолчанию dnd-kit сравнивает прямоугольник перетаскиваемой карточки
       * с прямоугольниками колонок, снятыми один раз в начале жеста. Это дважды
       * подводило: снимок устаревал при прокрутке доски, а сама карточка-оверлей
       * уезжала от курсора (position: fixed внутри предка с backdrop-filter —
       * см. портал ниже). Замер показывал карточку над «Заморозкой» (887..1155),
       * а выбранной — «Ждём оплату» (1177..1465), с нулевым пересечением: заказ
       * стабильно падал на колонку правее. `pointerWithin` берёт то, на что
       * человек смотрит, `MeasuringStrategy.Always` держит рамки свежими, а
       * `rectIntersection` остаётся запасным, если курсор попал в зазор.
       */
      collisionDetection={(args) => {
        const byPointer = pointerWithin(args);
        return byPointer.length > 0 ? byPointer : rectIntersection(args);
      }}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      // Авто-прокрутка ВЫКЛЮЧЕНА намеренно. В начале жеста на доску
      // добавляются колонки всех пустых статусов (dragOnlyColumns): она разом
      // становится в разы шире экрана и вдруг оказывается прокручиваемой, а
      // dnd-kit реагирует на это сразу, не дожидаясь, пока рука дойдёт до
      // края. Замер: за один бросок доска уехала вбок на 2698px — до самого
      // конца, колонки ушли из-под курсора. Узкий порог и малое ускорение не
      // помогают, прокрутка стартует и в середине доски. Цена — до колонки за
      // краем экрана не дотянуться одним движением, доску нужно прокрутить
      // заранее; это дешевле, чем молча испорченный статус заказа.
      autoScroll={false}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDraggingRowId(null)}
    >
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
      {/* В ПОРТАЛ в document.body — обязательно, а не для красоты.
          DragOverlay позиционируется через position: fixed, а любой предок
          с backdrop-filter (их в index.css хватает: .glass-*, панели, шапки)
          становится для fixed новым контейнером — координаты начинают
          считаться от него, а не от окна. Курсор оставался на месте, а
          карточка висела в стороне на величину смещения этого предка.
          Комментарий тут раньше уверял, что оверлей в портале, хотя портала
          не было; в body над ним не висит ничего, и смещать его нечему. */}
      {createPortal(
        <DragOverlay dropAnimation={null}>
          {draggingRow ? (
            <KanbanCardBody row={draggingRow} {...cardFields} className="rotate-1 cursor-grabbing shadow-xl ring-1 ring-primary/40" />
          ) : null}
        </DragOverlay>,
        document.body
      )}
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
        "kanban-column flex h-full shrink-0 flex-col overflow-hidden rounded-lg border border-transparent",
        collapsed && !dragActive ? "w-12" : "w-72"
      )}
      style={{
        backgroundColor: `hsl(${option.color} / ${isOver ? 0.08 : 0.05})`,
        borderColor: isOver ? `hsl(${option.color} / 0.55)` : undefined,
      }}
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
      {/* Зона сброса — весь столбец (иначе не попасть мимо карточек), но
          КРАСИТЬ её целиком нельзя: пунктир и заливка растягивались на всю
          высоту колонки, и над пустой колонкой это был огромный жёлтый
          прямоугольник во весь экран. Подсветок было три сразу — рамка
          колонки, рамка зоны и её фон. Осталась одна рамка колонки, а
          «куда упадёт» показывает placeholder размером с карточку. */}
      <div
        ref={setNodeRef}
        className={cn("flex-1 space-y-2 overflow-y-auto px-2 pb-2", collapsed && !dragActive && "hidden")}
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
        {isOver && (
          <div
            className="flex items-center justify-center rounded-lg border border-dashed px-3 py-5 text-[11px] font-medium"
            style={{
              borderColor: `hsl(${option.color} / 0.6)`,
              color: `hsl(${option.color})`,
              backgroundColor: `hsl(${option.color} / 0.1)`,
            }}
          >
            Перенести в «{option.label}»
          </div>
        )}
        {/* «Пусто» скрывается только когда тащат ИМЕННО сюда — иначе при
            любом перетаскивании все пустые колонки молча пустели. */}
        {rows.length === 0 && !isOver && (
          <p className="px-2 py-6 text-center text-[11px] text-muted-foreground">Пусто</p>
        )}
      </div>
    </div>
  );
}

interface KanbanCardFields {
  /** Имена вкладок по id — подсказка у метки «перенос». */
  tabNames?: Readonly<Record<string, string>>;
  titleColKey?: string;
  currencyColKey?: string;
  responsibleCol?: PageColumn;
  dateColKey?: string;
  phoneColKey?: string;
}

interface KanbanCardProps extends KanbanCardFields {
  row: PageRow;
  canEdit: boolean;
  onOpenRow?: (rowId: string) => void;
}

function KanbanCard({ row, canEdit, onOpenRow, ...fields }: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: row.id, disabled: !canEdit });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        "group/card relative",
        canEdit && "cursor-grab touch-manipulation active:cursor-grabbing",
        // The moving copy lives in DragOverlay; this one marks the origin.
        isDragging && "opacity-30"
      )}
      onDoubleClick={() => onOpenRow?.(row.id)}
    >
      <KanbanCardBody row={row} {...fields} />
      {onOpenRow && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
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
    </div>
  );
}

function KanbanCardBody({
  row,
  titleColKey,
  currencyColKey,
  responsibleCol,
  dateColKey,
  phoneColKey,
  tabNames,
  className,
}: KanbanCardFields & { row: PageRow; className?: string }) {
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
      className={cn(
        "kanban-card relative rounded-md border p-2.5 text-sm shadow-sm",
        // Новый заказ виден и на доске — иначе технарь снимет подсветку,
        // так и не поняв, какая карточка приехала.
        row.highlight
          ? "border-warning/70 bg-warning/[0.12]"
          : row.orderId
            ? "border-violet-400/45 bg-violet-400/[0.07]"
            : "border-border bg-card",
        className
      )}
    >
      {responsibleOption && (
        <MemberAvatar id={responsibleOption.value} name={responsibleOption.label} className="absolute right-2 top-2 h-5 w-5" />
      )}
      {row.highlight && (
        <span className="mb-1 inline-block rounded-full border border-warning/60 bg-warning/20 px-1.5 text-[10px] font-semibold uppercase leading-4 text-warning">
          новый
        </span>
      )}
      {row.carriedFrom && (
        <span
          className="mb-1 ml-1 inline-block rounded-full border border-sky-400/50 bg-sky-400/15 px-1.5 text-[10px] font-semibold uppercase leading-4 text-sky-200"
          title={`Перенесён из «${carriedLabel(row, tabNames)}»`}
        >
          перенос
        </span>
      )}
      {title ? <p className={cn("line-clamp-2 font-medium leading-snug", responsibleOption && "pr-6")}>{title}</p> : <p className="italic text-muted-foreground">Без названия</p>}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground">
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
