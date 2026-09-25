import { useSortable } from "@dnd-kit/sortable";
import { CellActionButton, sameCellAction, type CellActionView } from "@/components/table/CellActionButton";
import { CSS } from "@dnd-kit/utilities";
import { motion } from "framer-motion";
import { memo, useEffect, useReducer, useRef, useState } from "react";
import { Copy, GripVertical, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { TableCell } from "@/components/table/TableCell";
import { rowExtrasSummary } from "@/utils/rowExtras";
import { carriedLabel } from "@/utils/carryOver";
import { rowCardLayoutId } from "@/components/table/RowCardSheet";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/utils/cn";
import type { CellAddress, PageColumn, PageRow } from "@/types";

const ROW_GUTTER_WIDTH = 56;

interface TableRowProps {
  row: PageRow;
  rowNumber: number;
  columns: PageColumn[];
  rowHeight: number;
  activeCell: CellAddress | null;
  rangeCells: Set<string>;
  editingCell: CellAddress | null;
  editValue: string;
  canEdit: boolean;
  /**
   * Замок ячейки: причина, по которой её нельзя править (заказ ведёт ОС).
   * Нужен именно здесь, а не только при записи: иначе выпадашка статуса
   * открывается, человек выбирает — и ловит тост «нельзя» уже после выбора.
   */
  cellLock?: (row: PageRow, colKey: string) => string | null;
  /** Столбцы, чьи ячейки открывают внешний выбор вместо выпадашки. */
  pickerKeys?: readonly string[];
  onOpenCellPicker?: (rowId: string, colKey: string) => void;
  canReorder: boolean;
  isRowFullySelected: boolean;
  isChecked: boolean;
  pinnedKeys: string[];
  onToggleChecked: (rowId: string, shiftKey?: boolean) => void;
  onCellMouseDown: (rowId: string, colKey: string, e: React.MouseEvent) => void;
  onCellClick: (rowId: string, colKey: string) => void;
  onCellMouseEnter: (rowId: string, colKey: string) => void;
  onCellStartEdit: (rowId: string, colKey: string) => void;
  onEditValueChange: (value: string) => void;
  onCommitEdit: (direction?: "down" | "right" | "left" | "none") => void;
  onCancelEdit: () => void;
  onStatusChange: (rowId: string, colKey: string, value: string) => void;
  onRowNumberMouseDown: (rowId: string, e: React.MouseEvent) => void;
  onRowResizeStart: (rowId: string, e: React.MouseEvent) => void;
  onContextMenuOpen: (rowId: string) => void;
  onExpandRow: (rowId: string) => void;
  onDuplicateRow?: (rowId: string) => void;
  onDeleteRow?: (rowId: string) => void;
  onCopyDiskUrl?: (rowId: string) => void;
  diskUrl?: string | null;
  onUndoLast?: () => void;
  isExpanded?: boolean;
  coarsePointer?: boolean;
  /**
   * Цвет статуса строки. Оставлен в типах, но на фон больше НЕ ложится:
   * тонировка строки цветом статуса спорила с зеброй, а статус и так виден
   * в ячейке («● Слово») и рейлом в гаттере (accentColor).
   */
  statusTint?: string;
  /** Чётная строка группы — фон чуть светлее (класс table-row-zebra в index.css). */
  zebra?: boolean;
  onMarkDone?: (rowId: string) => void;
  onInsertRowAbove?: (rowId: string) => void;
  onInsertRowBelow?: (rowId: string) => void;
  onCopyRow?: (rowId: string) => void;
  expandedColKey?: string | null;
  gutterWidth?: number;
  extrasHintKey?: string | null;
  /** Кнопка «Карточка клиента» в столбце клиента — открывает карточку строки (визитка наверху). */
  onOpenClientCard?: (rowId: string) => void;
  /** Имена вкладок стола по id — подпись у строки, переехавшей из прошлого периода. */
  tabNames?: Readonly<Record<string, string>>;
  /** Some row is ticked — keep every checkbox visible so more can be added. */
  anyChecked?: boolean;
  searchQuery?: string;
  /** Bumped by DataTable when Enter/Space should open the active picker cell. */
  openRequest?: number;
  /** Status colour (hsl triplet) for the thin rail on the gutter. */
  accentColor?: string;
  /** Column key whose bottom-right selection corner sits on this row (fill handle). */
  fillHandleColKey?: string | null;
  onFillStart?: (rowId: string, colKey: string, e: React.PointerEvent) => void;
  /** Column keys of this row inside the drag-to-fill preview. */
  fillColKeys?: string[] | null;
  /** Phone/email columns whose value in this row repeats elsewhere. */
  duplicateColKeys?: string[] | null;
  onFindDuplicates?: (rowId: string, colKey: string) => void;
  /**
   * Nothing typed into this row yet: a free slot, not an order. Drawn
   * muted, with a «+» for a number and a hint in the first column — the
   * counts, footer and «Технари» skip it (see utils/blankRow.ts).
   */
  blank?: boolean;
  /**
   * Кнопка поверх ячейки `cellActionKey` — см. DataTable.cellAction. Метку
   * считает сама ячейка (`getCellAction` по id строки) и пересчитывает по
   * `cellActionPulse`: таблица «пульсирует» после своего рендера и по таймеру,
   * а строка перерисовывается, только если метка правда сменилась.
   */
  /** Ключи столбцов с меткой, через «\u0001» (строка — чтобы memo сравнивал по значению). */
  cellActionKeys?: string | null;
  getCellAction?: (rowId: string, colKey: string) => CellActionView | null;
  cellActionPulse?: CellActionPulse;
  onCellAction?: (rowId: string, colKey: string) => void;
  /** Добавка слева внутри ячеек этих столбцов — см. DataTable.cellAddon. */
  cellAddonKeys?: readonly string[];
  cellAddonVersion?: string;
  renderCellAddon?: (row: PageRow, colKey: string) => React.ReactNode;
  /**
   * Своя отрисовка значения в ячейках этих столбцов — см. DataTable.cellDisplay.
   * `cellDisplayVersion` меняется, когда меняется то, что рисует `render`
   * помимо самой строки (люди, фото, ники): строка сравнивает пропсы (memo).
   */
  cellDisplayKeys?: readonly string[];
  cellDisplayVersion?: string;
  renderCellDisplay?: (row: PageRow, colKey: string) => React.ReactNode | undefined;
}

/**
 * «Пульс» меток поверх ячеек: таблица зовёт `emit` после своего рендера и по
 * таймеру (метка стола ОС «статус не совпал» зависит от времени), каждая
 * метка сверяет себя и перерисовывается одна. Раньше ради этого раз в 10 с
 * перерисовывалась вся страница стола вместе с таблицей.
 */
export interface CellActionPulse {
  subscribe: (listener: () => void) => () => void;
  emit: () => void;
}

export function createCellActionPulse(): CellActionPulse {
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit() {
      for (const listener of [...listeners]) listener();
    },
  };
}

function LiveCellAction({
  rowId,
  colKey,
  getView,
  pulse,
  coarsePointer,
  inline,
  onRun,
}: {
  rowId: string;
  colKey: string;
  getView: (rowId: string, colKey: string) => CellActionView | null;
  pulse?: CellActionPulse;
  coarsePointer?: boolean;
  /** Чип в строке рядом со значением (ячейка с внешним выбором), а не поверх. */
  inline?: boolean;
  onRun: (rowId: string, colKey: string) => void;
}) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  // Считаем метку при каждом своём рендере: строка перерисовалась — значит,
  // и данные для метки могли смениться.
  const view = getView(rowId, colKey);
  const shownRef = useRef(view);
  shownRef.current = view;
  useEffect(() => {
    if (!pulse) return;
    return pulse.subscribe(() => {
      if (!sameCellAction(shownRef.current, getView(rowId, colKey))) rerender();
    });
  }, [pulse, getView, rowId, colKey]);
  if (!view) return null;
  return <CellActionButton view={view} coarsePointer={coarsePointer} inline={inline} onRun={() => onRun(rowId, colKey)} />;
}

function TableRowInner({
  row,
  rowNumber,
  columns,
  rowHeight,
  activeCell,
  rangeCells,
  editingCell,
  editValue,
  canEdit,
  cellLock,
  pickerKeys,
  onOpenCellPicker,
  canReorder,
  isRowFullySelected,
  isChecked,
  pinnedKeys,
  onToggleChecked,
  onCellMouseDown,
  onCellClick,
  onCellMouseEnter,
  onCellStartEdit,
  onEditValueChange,
  onCommitEdit,
  onCancelEdit,
  onStatusChange,
  onRowNumberMouseDown,
  onRowResizeStart,
  onContextMenuOpen,
  onExpandRow,
  onDuplicateRow,
  onDeleteRow,
  onCopyDiskUrl,
  diskUrl,
  onUndoLast,
  isExpanded,
  coarsePointer,
  zebra = false,
  onMarkDone,
  onInsertRowAbove,
  onInsertRowBelow,
  onCopyRow,
  expandedColKey,
  gutterWidth = ROW_GUTTER_WIDTH,
  extrasHintKey,
  onOpenClientCard,
  tabNames,
  anyChecked = false,
  searchQuery = "",
  openRequest,
  accentColor,
  fillHandleColKey,
  onFillStart,
  fillColKeys,
  duplicateColKeys,
  onFindDuplicates,
  blank = false,
  cellActionKeys,
  getCellAction,
  cellActionPulse,
  onCellAction,
  cellAddonKeys,
  renderCellAddon,
  cellDisplayKeys,
  renderCellDisplay,
}: TableRowProps) {
  const allowRowDrag = canReorder && !coarsePointer;
  const [menuOpen, setMenuOpen] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
    disabled: !allowRowDrag,
  });

  const pinnedCols = columns.filter((c) => pinnedKeys.includes(c.key));
  let cumulativeLeft = gutterWidth;
  const pinnedOffsets = new Map<string, number>();
  pinnedCols.forEach((c) => {
    pinnedOffsets.set(c.key, cumulativeLeft);
    cumulativeLeft += c.width;
  });
  const lastStickyKey = pinnedCols.length ? pinnedCols[pinnedCols.length - 1].key : null;

  const isNew = Date.now() - row.createdAt < 24 * 60 * 60 * 1000;

  const rowMenu = (
          <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-row-menu
                className={cn(
                  "inline-flex rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground",
                  coarsePointer || menuOpen ? "opacity-100" : "opacity-0 group-hover/row:opacity-100"
                )}
                title="Действия со строкой"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              side="bottom"
              className="z-[320]"
              onCloseAutoFocus={(e) => e.preventDefault()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <DropdownMenuItem onClick={() => onInsertRowAbove?.(row.id)} disabled={!canEdit}>
                Вставить строку выше
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onInsertRowBelow?.(row.id)} disabled={!canEdit}>
                Вставить строку ниже
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onCopyRow?.(row.id)}>
                Копировать строку
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDuplicateRow?.(row.id)} disabled={!canEdit}>
                Дублировать
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onCopyDiskUrl?.(row.id)} disabled={!diskUrl}>
                <Copy className="h-3.5 w-3.5" /> Копировать ссылку Диск
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onDeleteRow?.(row.id)}
                disabled={!canEdit}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" /> Удалить
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
  );

  return (
    <tr
      ref={setNodeRef}
      style={{
        height: rowHeight,
        // Rows being passed over shift too, so the drop position is visible.
        transform: allowRowDrag && transform ? CSS.Translate.toString(transform) : undefined,
        transition: allowRowDrag ? transition : undefined,
        position: isDragging ? "relative" : undefined,
        zIndex: isDragging ? 35 : undefined,
        opacity: isDragging ? 0.75 : 1,
      }}
      data-row-id={row.id}
      data-row-number={rowNumber}
      className={cn(
        "group/row table-data-row relative",
        zebra && "table-row-zebra",
        blank && "table-row-blank",
        row.highlight && "table-row-new",
        (isRowFullySelected || isChecked) && "table-data-row-selected",
        activeCell?.rowId === row.id && "table-data-row-active"
      )}
      onContextMenu={() => onContextMenuOpen(row.id)}
    >
      <td
        onMouseDown={(e) => {
          // The row menu, the drag grip and the checkbox live in this cell;
          // using them must not also select the whole row. The checkbox
          // especially: selecting the row on mousedown and then toggling it
          // on click un-ticked it again, so a single row could never be ticked.
          if ((e.target as HTMLElement | null)?.closest("[data-row-menu], [data-row-drag], [data-row-check]")) return;
          onRowNumberMouseDown(row.id, e);
        }}
        onDoubleClick={() => onExpandRow(row.id)}
        title="Двойной клик — открыть строку карточкой"
        className={cn(
          "table-sticky-col sticky left-0 z-[22] !overflow-visible select-none border-b border-r border-border/40 bg-background text-center font-mono text-[11px] tabular text-muted-foreground",
          !lastStickyKey && "table-sticky-edge",
          isRowFullySelected && "bg-primary/10 font-medium text-primary"
        )}
        style={{ width: gutterWidth, minWidth: gutterWidth }}
      >
        <div className="relative flex h-full w-full items-center justify-center gap-0.5 px-0.5">
          {!isExpanded && (
            <motion.div
              layoutId={rowCardLayoutId(row.id)}
              className="pointer-events-none absolute inset-0 rounded-md"
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
            />
          )}
          {accentColor && (
            <span
              className="table-row-rail pointer-events-none absolute left-0 top-0 h-full w-[3px]"
              style={{ backgroundColor: `hsl(${accentColor})` }}
              aria-hidden
            />
          )}
          {isNew && (
            <span
              className={cn("absolute top-1/2 h-3.5 w-[3px] -translate-y-1/2 rounded-full bg-primary", accentColor ? "left-[4px]" : "left-0")}
              title="Добавлено недавно"
            />
          )}
          {allowRowDrag && (
          <button
            {...attributes}
            {...listeners}
            type="button"
            data-row-drag
            className="hidden cursor-grab touch-none text-muted-foreground group-hover/row:block active:cursor-grabbing"
            title="Перетащить строку"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
          )}
          <Checkbox
            data-row-check
            checked={isChecked}
            aria-label={`Выбрать строку ${rowNumber}`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleChecked(row.id, e.shiftKey);
            }}
            className={cn(
              "h-4 w-4 max-md:h-5 max-md:w-5",
              coarsePointer && !isChecked && !anyChecked && "hidden",
              !isChecked && !coarsePointer && !anyChecked && "opacity-0 group-hover/row:opacity-100"
            )}
          />
          <span className="flex min-w-[1.1rem] items-center justify-center text-[11px]" title={blank ? "Пустая строка — не считается заказом" : undefined}>
            {blank ? <Plus className="h-3 w-3 text-muted-foreground/60" aria-label="Пустая строка" /> : rowNumber}
          </span>
          {/* На таче в гаттере — только номер (просьба Nurba 25.09.2026:
              «оставить только нумерацию»): «⋯» стоял у каждой строки и
              съедал ширину у имени клиента. Действия со строкой на телефоне —
              долгое нажатие (то же контекстное меню) и карточка строки. */}
          {!coarsePointer && rowMenu}
          {/* Row height is a write on the row doc — a pure viewer (allowedUsers
              without editableUsers) could grab this, see the height follow the
              drag, then watch it snap back when the rejected write never
              landed. Every other row action here is already !canEdit-gated. */}
          {canEdit && (
            <div
              onMouseDown={(e) => {
                e.stopPropagation();
                onRowResizeStart(row.id, e);
              }}
              className="absolute -bottom-[1px] left-0 h-[3px] w-full cursor-row-resize opacity-0 hover:opacity-100 hover:bg-primary"
            />
          )}
        </div>
      </td>
      {columns.map((column) => {
        const isActive = activeCell?.rowId === row.id && activeCell?.colKey === column.key;
        const isEditing = editingCell?.rowId === row.id && editingCell?.colKey === column.key;
        const isInRange = rangeCells.has(`${row.id}:${column.key}`);
        const stickyLeft = pinnedOffsets.get(column.key);
        const isPicker = Boolean(onOpenCellPicker && pickerKeys?.includes(column.key));
        return (
          <TableCell
            key={column.id}
            column={column}
            value={row.cells[column.key] ?? ""}
            isActive={isActive}
            isInRange={isInRange || isActive}
            isEditing={isEditing}
            editValue={editValue}
            canEdit={canEdit && !cellLock?.(row, column.key)}
            lockedReason={cellLock?.(row, column.key) ?? null}
            onOpenPicker={isPicker && onOpenCellPicker ? () => onOpenCellPicker(row.id, column.key) : undefined}
            display={
              renderCellDisplay && !blank && cellDisplayKeys?.includes(column.key) ? renderCellDisplay(row, column.key) : undefined
            }
            onMouseDown={(e) => onCellMouseDown(row.id, column.key, e)}
            onClick={() => onCellClick(row.id, column.key)}
            onMouseEnter={() => onCellMouseEnter(row.id, column.key)}
            onStartEdit={() => onCellStartEdit(row.id, column.key)}
            onEditValueChange={onEditValueChange}
            onCommitEdit={onCommitEdit}
            onCancelEdit={onCancelEdit}
            onUndoLast={onUndoLast}
            onStatusChange={(v) => onStatusChange(row.id, column.key, v)}
            onMarkDone={column.type === "status" ? () => onMarkDone?.(row.id) : undefined}
            stickyLeft={stickyLeft}
            isLastSticky={column.key === lastStickyKey}
            isExpanded={expandedColKey === column.key}
            clientCard={
              column.key === extrasHintKey && !blank && onOpenClientCard
                ? {
                    summary: rowExtrasSummary(row.extras),
                    canEdit,
                    onOpen: () => onOpenClientCard(row.id),
                    fromOrder: Boolean(row.orderId),
                    isNewOrder: Boolean(row.highlight),
                    carriedLabel: carriedLabel(row, tabNames),
                  }
                : null
            }
            coarsePointer={coarsePointer}
            leading={
              renderCellAddon && !blank && cellAddonKeys?.includes(column.key) ? renderCellAddon(row, column.key) : undefined
            }
            trailing={
              getCellAction && onCellAction && cellActionKeys && cellActionKeys.split("\u0001").includes(column.key) && !blank ? (
                <LiveCellAction
                  rowId={row.id}
                  colKey={column.key}
                  getView={getCellAction}
                  pulse={cellActionPulse}
                  coarsePointer={coarsePointer}
                  inline={isPicker}
                  onRun={onCellAction}
                />
              ) : undefined
            }
            searchQuery={searchQuery}
            openRequest={isActive ? openRequest : undefined}
            showFillHandle={fillHandleColKey === column.key}
            onFillStart={onFillStart ? (colKey, e) => onFillStart(row.id, colKey, e) : undefined}
            placeholder={blank && canEdit && column.key === columns[0]?.key ? "Новый заказ — начните печатать" : undefined}
            isInFill={Boolean(fillColKeys && fillColKeys.includes(column.key))}
            isDuplicate={Boolean(duplicateColKeys && duplicateColKeys.includes(column.key))}
            onFindDuplicates={onFindDuplicates ? () => onFindDuplicates(row.id, column.key) : undefined}
            rowHeight={rowHeight}
          />
        );
      })}
    </tr>
  );
}

function addrOnRow(addr: CellAddress | null, rowId: string) {
  return addr?.rowId === rowId;
}

/**
 * Визитка по значению, а не по ссылке: строка из Firestore приходит новым
 * объектом на каждый снимок, и сравнение по ссылке перерисовывало её без
 * повода. Поля визитки — числа и строки, JSON тут честное сравнение.
 */
function sameExtras(a: PageRow["extras"], b: PageRow["extras"]): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Поля строки, которые рисует TableRow. Тот же объект (стор Supabase отдаёт
 * прежний PageRow, если `rev` не изменился) — сравнивать нечего.
 */
function sameRowContent(a: PageRow, b: PageRow): boolean {
  if (a === b) return true;
  if (a.id !== b.id) return false;
  if (a.updatedAt !== b.updatedAt || a.cells !== b.cells) {
    const keys = new Set([...Object.keys(a.cells), ...Object.keys(b.cells)]);
    for (const key of keys) {
      if (a.cells[key] !== b.cells[key]) return false;
    }
  }
  return (
    // Подсветка «новый заказ» живёт на самой строке: без этой пары строка
    // оставалась подсвеченной до перезагрузки, хотя чип «снять» уже пропал.
    Boolean(a.highlight) === Boolean(b.highlight) &&
    a.orderId === b.orderId &&
    // Замок строки-заказа и просьба об «Успешке» — тоже повод перерисовать.
    a.osUid === b.osUid &&
    a.statusKey === b.statusKey &&
    a.successRequestedAt === b.successRequestedAt &&
    a.createdAt === b.createdAt &&
    // Дата получения заказа (столбец «Даты» стола ОС) и адрес копии у технаря.
    a.filledAt === b.filledAt &&
    a.mirrorRowId === b.mirrorRowId &&
    // Метка «перенос» из нового периода.
    a.carriedFrom === b.carriedFrom &&
    sameExtras(a.extras, b.extras)
  );
}

function tableRowEqual(prev: TableRowProps, next: TableRowProps) {
  if (!sameRowContent(prev.row, next.row)) return false;
  if (
    prev.rowNumber !== next.rowNumber ||
    prev.blank !== next.blank ||
    prev.columns !== next.columns ||
    prev.rowHeight !== next.rowHeight ||
    prev.canEdit !== next.canEdit ||
    prev.cellLock !== next.cellLock ||
    prev.pickerKeys !== next.pickerKeys ||
    prev.onOpenCellPicker !== next.onOpenCellPicker ||
    prev.canReorder !== next.canReorder ||
    prev.isRowFullySelected !== next.isRowFullySelected ||
    prev.isChecked !== next.isChecked ||
    prev.pinnedKeys !== next.pinnedKeys ||
    prev.diskUrl !== next.diskUrl ||
    prev.isExpanded !== next.isExpanded ||
    prev.coarsePointer !== next.coarsePointer ||
    prev.zebra !== next.zebra ||
    prev.expandedColKey !== next.expandedColKey ||
    prev.gutterWidth !== next.gutterWidth ||
    prev.extrasHintKey !== next.extrasHintKey ||
    prev.tabNames !== next.tabNames ||
    prev.searchQuery !== next.searchQuery ||
    prev.accentColor !== next.accentColor ||
    prev.fillHandleColKey !== next.fillHandleColKey ||
    (prev.fillColKeys?.join(",") ?? "") !== (next.fillColKeys?.join(",") ?? "") ||
    (prev.duplicateColKeys?.join(",") ?? "") !== (next.duplicateColKeys?.join(",") ?? "") ||
    prev.anyChecked !== next.anyChecked ||
    prev.cellActionKeys !== next.cellActionKeys ||
    prev.cellAddonKeys !== next.cellAddonKeys ||
    prev.cellAddonVersion !== next.cellAddonVersion ||
    prev.renderCellAddon !== next.renderCellAddon ||
    prev.cellDisplayKeys !== next.cellDisplayKeys ||
    prev.cellDisplayVersion !== next.cellDisplayVersion ||
    prev.renderCellDisplay !== next.renderCellDisplay ||
    prev.onCellAction !== next.onCellAction ||
    prev.getCellAction !== next.getCellAction ||
    prev.cellActionPulse !== next.cellActionPulse
  ) {
    return false;
  }
  const prevActive = addrOnRow(prev.activeCell, prev.row.id);
  const nextActive = addrOnRow(next.activeCell, next.row.id);
  if (prevActive !== nextActive) return false;
  if (nextActive && (prev.activeCell?.colKey !== next.activeCell?.colKey || prev.openRequest !== next.openRequest)) return false;
  const prevEditing = addrOnRow(prev.editingCell, prev.row.id);
  const nextEditing = addrOnRow(next.editingCell, next.row.id);
  if (prevEditing !== nextEditing) return false;
  if (nextEditing && (prev.editingCell?.colKey !== next.editingCell?.colKey || prev.editValue !== next.editValue)) {
    return false;
  }
  for (const col of next.columns) {
    const id = `${next.row.id}:${col.key}`;
    if (prev.rangeCells.has(id) !== next.rangeCells.has(id)) return false;
  }
  return true;
}

export const TableRow = memo(TableRowInner, tableRowEqual);

export { ROW_GUTTER_WIDTH };
