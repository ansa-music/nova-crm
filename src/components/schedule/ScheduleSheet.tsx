import { memo, useCallback, useEffect, useRef, type ReactNode, type RefObject } from "react";
import { X, type LucideIcon } from "lucide-react";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { SHEET_SIZES, type ScheduleDensity } from "@/components/schedule/scheduleDensity";
import {
  CELL_KIND_LOOK,
  initialsName,
  WEEKEND_WORK_LOOK,
  type CellKind,
  type ScheduleRow,
} from "@/components/schedule/scheduleShared";
import type { GridSelection } from "@/components/schedule/useGridSelection";
import { cellKey } from "@/utils/scheduleEdit";
import { cn } from "@/utils/cn";

export interface SheetColumn {
  /** День месяца («7») или день недели («1» = пн … «0» = вс). */
  id: string;
  /** Крупно в шапке: «7» / «Пн». */
  top: string;
  /** Мелко под ним: «пн». */
  sub?: string;
  weekend: boolean;
  today: boolean;
  /** Прошедший день текущего месяца — приглушён: смотрят вперёд. */
  past: boolean;
}

export interface SheetSection {
  id: string;
  title: string;
  icon: LucideIcon;
  rows: ScheduleRow[];
  /** Норма на смене: меньше — число дня красное. 0 — без нормы. */
  min: number;
  /** Кнопка у названия раздела (свой раздел: переименовать, добавить человека). */
  menu?: ReactNode;
  /** Раздел пуст — что показать вместо строк (иначе раздел не рисуется). */
  emptyText?: string;
}

export interface SheetCell {
  kind: CellKind;
  text: string;
  title: string;
}

/**
 * Сетка графика — ОДНА таблица на все разделы (Технари, ОС, Руководство,
 * свой): дни у всех разделов стоят друг под другом, шапка с датами и колонка
 * имён закреплены, строка раздела сразу показывает «на смене» по каждому
 * дню. Та же сетка и для месяца (31 день), и для недели (Пн…Вс).
 *
 * Правится она выделением (см. `useGridSelection`): клик, протяжка, Shift,
 * Ctrl, стрелки, клик по дню в шапке — весь столбец. Что поставить,
 * выбирают в палитре — сетка только выделяет и показывает.
 */
export function ScheduleSheet({
  mode,
  columns,
  sections,
  cellOf,
  countOf,
  totalOf,
  totalHead,
  density,
  meUid,
  canEdit,
  selection,
  pending,
  onSelectColumn,
  onOpenPerson,
  onRemoveRow,
  removableIds,
  personHint,
  scrollerRef,
  scrollToColumn,
}: {
  mode: "month" | "week";
  columns: SheetColumn[];
  sections: SheetSection[];
  cellOf: (row: ScheduleRow, column: SheetColumn) => SheetCell;
  countOf: (section: SheetSection, column: SheetColumn) => number;
  totalOf: (row: ScheduleRow) => number;
  totalHead: { label: string; title: string };
  density: ScheduleDensity;
  meUid?: string;
  canEdit: boolean;
  selection: GridSelection;
  /** Клетки, запись которых ещё не подтверждена. */
  pending: ReadonlySet<string>;
  /** Клик по дню в шапке (все строки) или по числу в строке раздела (строки раздела). */
  onSelectColumn?: (rowIds: string[], colIndex: number) => void;
  onOpenPerson?: (row: ScheduleRow) => void;
  onRemoveRow?: (row: ScheduleRow) => void;
  removableIds?: ReadonlySet<string>;
  personHint: string;
  scrollerRef: RefObject<HTMLDivElement | null>;
  /** Столбец, к которому прокрутить по горизонтали (сегодня). */
  scrollToColumn?: string | null;
}) {
  const size = SHEET_SIZES[density];
  const visibleSections = sections.filter((s) => s.rows.length > 0 || s.emptyText);
  const allRowIds = visibleSections.flatMap((s) => s.rows.map((row) => row.uid));

  // Колбэки строк — через ref: строки мемоизированы и сравнивают только
  // данные, а свежие функции берут отсюда.
  const openRef = useRef(onOpenPerson);
  openRef.current = onOpenPerson;
  const removeRef = useRef(onRemoveRow);
  removeRef.current = onRemoveRow;
  const openPerson = useCallback((row: ScheduleRow) => openRef.current?.(row), []);
  const removeRow = useCallback((row: ScheduleRow) => removeRef.current?.(row), []);

  // Сегодняшний день — посередине окна сетки (только её прокрутка вбок:
  // scrollIntoView потащил бы за собой и страницу).
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !scrollToColumn) return;
    const head = scroller.querySelector<HTMLElement>(`[data-col-id="${scrollToColumn}"]`);
    if (!head) return;
    const box = scroller.getBoundingClientRect();
    const cell = head.getBoundingClientRect();
    if (cell.right <= box.right && cell.left >= box.left + 120) return;
    scroller.scrollLeft += cell.left - box.left - box.width / 2 + cell.width / 2;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToColumn, columns.length, density]);

  function pointOf(target: EventTarget | null) {
    const el = (target as HTMLElement | null)?.closest<HTMLElement>("[data-cell]");
    if (!el) return null;
    return { row: Number(el.dataset.r), col: Number(el.dataset.c) };
  }

  const colsSig = columns.map((c) => `${c.id}${c.today ? "t" : ""}${c.weekend ? "w" : ""}${c.past ? "p" : ""}`).join(",");
  let rowIndex = 0;

  return (
    <div
      ref={scrollerRef}
      data-schedule-grid
      className="relative overflow-auto md:max-h-[calc(100dvh-8.5rem)]"
    >
      <table className={cn("border-separate border-spacing-0", mode === "week" ? "w-full min-w-[36rem]" : "")}>
        <thead>
          <tr>
            <th
              className={cn(
                "sticky left-0 top-0 z-30 border-b border-border/70 bg-card px-2 py-1.5 text-left text-[11px] font-medium text-muted-foreground",
                size.nameCol
              )}
            >
              Кто
            </th>
            {columns.map((column, c) => {
              const head = (
                <>
                  <span
                    className={cn(
                      "mx-auto flex w-fit items-center justify-center rounded-full font-mono tabular-nums leading-none",
                      mode === "month" ? "h-6 w-6" : "h-6 min-w-[2.5rem] px-2 font-sans",
                      size.head,
                      column.today && "bg-primary font-semibold text-primary-foreground"
                    )}
                  >
                    {column.top}
                  </span>
                  {column.sub && <span className={cn("mt-0.5 block leading-none", size.headSub)}>{column.sub}</span>}
                </>
              );
              return (
                <th
                  key={column.id}
                  data-col-id={column.id}
                  className={cn(
                    "sticky top-0 z-20 border-b border-border/70 bg-card px-0 pb-1 pt-1.5 text-center font-medium",
                    column.today
                      ? "text-primary"
                      : column.past
                        ? "text-muted-foreground/45"
                        : column.weekend
                          ? "text-foreground/85"
                          : "text-muted-foreground"
                  )}
                >
                  {canEdit && onSelectColumn ? (
                    <button
                      type="button"
                      onClick={() => onSelectColumn(allRowIds, c)}
                      title={mode === "month" ? `Выделить ${column.top}-е у всех` : `Выделить «${column.top}» у всех`}
                      className="w-full rounded-md py-0.5 transition-colors hover:bg-primary/10"
                    >
                      {head}
                    </button>
                  ) : (
                    head
                  )}
                </th>
              );
            })}
            <th
              title={totalHead.title}
              className="sticky top-0 z-20 border-b border-border/70 bg-card px-2 pb-1 pt-1.5 text-center text-[11px] font-medium text-muted-foreground/70"
            >
              {totalHead.label}
            </th>
          </tr>
        </thead>
        <tbody
          onPointerDown={(event) => {
            const point = pointOf(event.target);
            if (point) selection.onCellPointerDown(event, point);
          }}
          onPointerOver={(event) => {
            const point = pointOf(event.target);
            if (point) selection.onCellPointerEnter(point);
          }}
          onClick={(event) => {
            const point = pointOf(event.target);
            if (point) selection.onCellClick(event, point);
          }}
        >
          {visibleSections.map((section) => {
            const Icon = section.icon;
            const sectionRowIds = section.rows.map((row) => row.uid);
            const sectionRow = (
              <tr key={`s:${section.id}`}>
                <td className={cn("sticky left-0 z-10 bg-card px-2 pb-1 pt-3", size.nameCol)}>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="min-w-0 truncate text-[13px] font-semibold">{section.title}</span>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">{section.rows.length}</span>
                    {section.menu}
                  </span>
                </td>
                {columns.map((column, c) => {
                  if (section.rows.length === 0) return <td key={column.id} />;
                  const count = countOf(section, column);
                  const short = section.min > 0 && count < section.min;
                  const pill = (
                    <span
                      className={cn(
                        "mx-auto flex h-5 min-w-5 items-center justify-center rounded-md px-1 font-mono tabular-nums",
                        size.count,
                        short
                          ? "bg-destructive/15 font-semibold text-destructive"
                          : column.today
                            ? "font-semibold text-primary"
                            : column.past
                              ? "text-muted-foreground/45"
                              : "text-muted-foreground"
                      )}
                    >
                      {count}
                    </span>
                  );
                  const title = short
                    ? `На смене ${count} — меньше нормы ${section.min}`
                    : `На смене ${count} из ${section.rows.length}`;
                  return (
                    <td key={column.id} className={cn("px-px pb-1 pt-3 text-center", column.today && "bg-primary/[0.07]")}>
                      {canEdit && onSelectColumn ? (
                        <button
                          type="button"
                          title={`${title} · выделить у раздела`}
                          onClick={() => onSelectColumn(sectionRowIds, c)}
                          className="w-full rounded-md hover:bg-primary/10"
                        >
                          {pill}
                        </button>
                      ) : (
                        <span title={title}>{pill}</span>
                      )}
                    </td>
                  );
                })}
                <td />
              </tr>
            );
            if (section.rows.length === 0) {
              return [
                sectionRow,
                <tr key={`e:${section.id}`}>
                  <td colSpan={columns.length + 2} className="px-2 pb-2 text-[12px] text-muted-foreground">
                    {section.emptyText}
                  </td>
                </tr>,
              ];
            }
            const rows = section.rows.map((row) => {
              const r = rowIndex++;
              const cells = columns.map((column) => cellOf(row, column));
              let selMask = "";
              let pendMask = "";
              for (const column of columns) {
                const key = cellKey(row.uid, column.id);
                selMask += selection.selected.has(key) ? "1" : "0";
                pendMask += pending.has(key) ? "1" : "0";
              }
              const focusCol = selection.focus && selection.focus.row === r ? selection.focus.col : -1;
              return (
                <SheetRow
                  key={row.uid}
                  row={row}
                  rowIndex={r}
                  mode={mode}
                  columns={columns}
                  colsSig={colsSig}
                  cells={cells}
                  cellsSig={cells.map((cell) => `${cell.kind}:${cell.text}:${cell.title}`).join("|")}
                  selMask={selMask}
                  pendMask={pendMask}
                  focusCol={focusCol}
                  isMe={Boolean(meUid) && row.uid === meUid}
                  total={totalOf(row)}
                  density={density}
                  canEdit={canEdit}
                  removable={Boolean(canEdit && removableIds?.has(row.uid))}
                  personHint={personHint}
                  onOpenPerson={onOpenPerson ? openPerson : undefined}
                  onRemoveRow={removeRow}
                />
              );
            });
            return [sectionRow, ...rows];
          })}
        </tbody>
      </table>
    </div>
  );
}

interface SheetRowProps {
  row: ScheduleRow;
  rowIndex: number;
  mode: "month" | "week";
  columns: SheetColumn[];
  colsSig: string;
  cells: SheetCell[];
  cellsSig: string;
  selMask: string;
  pendMask: string;
  focusCol: number;
  isMe: boolean;
  total: number;
  density: ScheduleDensity;
  canEdit: boolean;
  removable: boolean;
  personHint: string;
  onOpenPerson?: (row: ScheduleRow) => void;
  onRemoveRow: (row: ScheduleRow) => void;
}

/**
 * Строка человека. Мемоизирована по ДАННЫМ (виды клеток, выделение, запись в
 * пути): на протяжке выделения по месяцу из 30 строк перерисовываются только
 * строки, которых протяжка коснулась.
 */
const SheetRow = memo(function SheetRow({
  row,
  rowIndex,
  mode,
  columns,
  cells,
  selMask,
  pendMask,
  focusCol,
  isMe,
  total,
  density,
  canEdit,
  removable,
  personHint,
  onOpenPerson,
  onRemoveRow,
}: SheetRowProps) {
  const size = SHEET_SIZES[density];
  const nameInner = (
    <>
      <MemberAvatar
        id={row.member?.uid ?? row.uid}
        name={row.member?.name ?? initialsName(row.label)}
        nickname={row.member?.nickname}
        photoURL={row.member?.photoURL}
        className={cn("shrink-0", size.avatar)}
      />
      <span className={cn("min-w-0 flex-1 truncate", size.name, isMe && "font-semibold text-primary")} title={row.label}>
        {row.label}
      </span>
      {isMe && <span className="shrink-0 rounded-full bg-primary/15 px-1.5 text-[10px] leading-4 text-primary">вы</span>}
      {row.note && (
        <span className="hidden shrink-0 rounded-sm bg-muted px-1 text-[10px] text-muted-foreground lg:inline">{row.note}</span>
      )}
    </>
  );
  return (
    <tr className={cn("group/row", isMe && "bg-primary/[0.05]")}>
      <td
        className={cn(
          "sticky left-0 z-10 py-px pr-1.5",
          size.nameCol,
          isMe ? "bg-[hsl(var(--card))] shadow-[inset_0_0_0_9999px_hsl(var(--primary)/0.06)]" : "bg-card",
          "group-hover/row:shadow-[inset_0_0_0_9999px_hsl(var(--foreground)/0.05)]"
        )}
      >
        <span className="flex min-w-0 items-center gap-1">
          {onOpenPerson ? (
            <button
              type="button"
              onClick={() => onOpenPerson(row)}
              title={`${row.label} — ${personHint}`}
              className="flex min-h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 text-left transition-colors hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              {nameInner}
            </button>
          ) : (
            <span className="flex min-w-0 flex-1 items-center gap-1.5 px-1">{nameInner}</span>
          )}
          {removable && (
            <button
              type="button"
              onClick={() => onRemoveRow(row)}
              title={`Убрать ${row.label} из графика`}
              className="shrink-0 rounded-sm p-1 text-muted-foreground/0 transition-colors hover:text-destructive group-hover/row:text-muted-foreground/70 [@media(hover:none)]:text-muted-foreground/60"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      </td>
      {columns.map((column, c) => {
        const cell = cells[c];
        const selected = selMask[c] === "1";
        const isFocus = focusCol === c;
        const isPending = pendMask[c] === "1";
        return (
          <td
            key={column.id}
            className={cn("p-px text-center", column.today && "bg-primary/[0.07]", "group-hover/row:bg-foreground/[0.03]")}
          >
            <button
              type="button"
              data-cell
              data-r={rowIndex}
              data-c={c}
              aria-pressed={selected}
              aria-label={cell.title}
              title={cell.title}
              className={cn(
                "relative flex select-none items-center justify-center rounded-[5px] border font-semibold leading-none transition-[filter,opacity]",
                mode === "month" ? cn(size.monthCell, size.monthText) : cn("w-full truncate px-1", size.weekCell, size.weekText),
                CELL_KIND_LOOK[cell.kind],
                cell.kind === "work" && column.weekend && WEEKEND_WORK_LOOK,
                column.past && !selected && "opacity-55",
                selected && "z-[1] ring-2 ring-inset ring-primary brightness-110",
                isFocus && "ring-[3px]",
                isPending && "animate-pulse",
                canEdit ? "cursor-pointer hover:brightness-125" : "cursor-default"
              )}
            >
              <CellText text={cell.text} month={mode === "month"} />
            </button>
          </td>
        );
      })}
      <td className="px-2 text-center font-mono text-[12px] tabular-nums text-muted-foreground">{total || ""}</td>
    </tr>
  );
},
(prev, next) =>
  prev.row.uid === next.row.uid &&
  prev.row.label === next.row.label &&
  prev.row.note === next.row.note &&
  prev.row.member?.photoURL === next.row.member?.photoURL &&
  prev.rowIndex === next.rowIndex &&
  prev.mode === next.mode &&
  prev.colsSig === next.colsSig &&
  prev.cellsSig === next.cellsSig &&
  prev.selMask === next.selMask &&
  prev.pendMask === next.pendMask &&
  prev.focusCol === next.focusCol &&
  prev.isMe === next.isMe &&
  prev.total === next.total &&
  prev.density === next.density &&
  prev.canEdit === next.canEdit &&
  prev.removable === next.removable &&
  prev.personHint === next.personHint &&
  Boolean(prev.onOpenPerson) === Boolean(next.onOpenPerson));

/** «12:30» в клетку месяца 34 px не влезает — минуты мелко, как степень: 12³⁰. */
function CellText({ text, month }: { text: string; month: boolean }) {
  const time = month ? /^(\d{1,2}):(\d{2})$/.exec(text) : null;
  if (!time) return <>{text}</>;
  return (
    <span className="leading-none">
      {time[1]}
      <sup className="ml-px text-[0.62em] font-medium">{time[2]}</sup>
    </span>
  );
}
