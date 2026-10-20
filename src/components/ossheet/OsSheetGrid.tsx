import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { Check, Square, SquareCheck } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/EmptyState";
import { effectiveValue, type CellEditInput, type OsSheetSnapshot } from "@/services/osSheetService";
import { paintOf } from "@/utils/absSheet";
import { cn } from "@/utils/cn";
import {
  buildOsSheetLayout,
  checkOsSheetValue,
  columnTitle,
  isCheckedText,
  isEditableCell,
  isFormulaCell,
  osEditReasonText,
  styleOf,
  type OsSheetTab,
} from "@/utils/osSheet";

/** Высота строки — одна на всю сетку: по ней липнет шапка и считается окно строк. */
const ROW_H = 30;
/** Сколько строк рисовать за краем окна. */
const OVERSCAN = 12;

interface Cell {
  r: number;
  c: number;
}

interface Editing extends Cell {
  draft: string;
}

/**
 * «Таблица ОС» — лист Google-таблицы с правкой прямо в Nova. Вид как у ABS
 * (цвета, ширины, закреплённое), плюс выбор ячейки, редактор по типу столбца
 * (выпадающий список, дата, число, галочка), клавиатура как в таблицах и
 * вставка блоком. Шапку и формулы не правят. Длинный лист рисуется окном:
 * строки за экраном — пустые распорки.
 */
export function OsSheetGrid({
  tab,
  snap,
  canEdit,
  onEdit,
}: {
  tab: OsSheetTab;
  snap: OsSheetSnapshot;
  canEdit: boolean;
  onEdit: (cells: CellEditInput[]) => void;
}) {
  const layout = useMemo(() => buildOsSheetLayout(tab), [tab]);
  const name = tab.meta.name;
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState({ top: 0, height: 600 });
  const [sel, setSel] = useState<Cell | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const listId = useId();

  // Свои ждущие правки и отказы — по ячейкам этого листа.
  const marks = useMemo(() => {
    const pending = new Map<string, string>();
    const failed = new Map<string, string>();
    for (const e of snap.edits) {
      if (e.tab !== name || e.r === null || e.c === null) continue;
      const k = `${e.r}:${e.c}`;
      if (e.status === "failed") failed.set(k, osEditReasonText(e.reason));
      else pending.set(k, e.value);
    }
    return { pending, failed };
  }, [snap.edits, name]);

  const valueAt = useCallback((r: number, c: number) => effectiveValue(snap, tab, r, c), [snap, tab]);

  // Окно строк. Объединения в теле листа окно разорвало бы — тогда рисуем всё.
  const bodyRows = layout.rows.slice(layout.frozenRows);
  const bodyMerged = tab.meta.merges.some(([r]) => r >= tab.meta.hdr);
  const windowed = !bodyMerged && bodyRows.length > 120;
  const firstBody = windowed ? Math.max(0, Math.floor(view.top / ROW_H) - layout.frozenRows - OVERSCAN) : 0;
  const lastBody = windowed
    ? Math.min(bodyRows.length, Math.ceil((view.top + view.height) / ROW_H) - layout.frozenRows + OVERSCAN)
    : bodyRows.length;

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const top = box.scrollTop;
      const height = box.clientHeight;
      // Новый объект — только если числа сменились (иначе цикл перерисовок).
      setView((prev) => (prev.top === top && prev.height === height ? prev : { top, height }));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    box.addEventListener("scroll", onScroll, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onScroll) : null;
    ro?.observe(box);
    return () => {
      box.removeEventListener("scroll", onScroll);
      ro?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  // Другой лист — выбор и редактор сбрасываются.
  useEffect(() => {
    setSel(null);
    setEditing(null);
  }, [name]);

  const leftOf = useMemo(() => {
    const out = new Map<number, number>();
    let x = 0;
    layout.cols.forEach((c, i) => {
      if (i < layout.frozenCols) out.set(c.col, x);
      x += c.width;
    });
    return out;
  }, [layout]);
  const totalWidth = layout.cols.reduce((n, c) => n + c.width, 0);
  const rowIndex = useMemo(() => new Map(layout.rows.map((r, i) => [r, i])), [layout]);
  const colIndex = useMemo(() => new Map(layout.cols.map((c, i) => [c.col, i])), [layout]);

  const editable = (r: number, c: number) => canEdit && isEditableCell(tab, r, c);

  const focusBox = () => boxRef.current?.focus({ preventScroll: true });

  /** Довести ячейку до видимой части окна (по вертикали — сами: строки могут быть не нарисованы). */
  const reveal = (cell: Cell) => {
    const box = boxRef.current;
    const i = rowIndex.get(cell.r);
    if (!box || i === undefined) return;
    const frozenH = layout.frozenRows * ROW_H;
    const y = i * ROW_H;
    if (i >= layout.frozenRows) {
      if (y < box.scrollTop + frozenH) box.scrollTop = y - frozenH;
      else if (y + ROW_H > box.scrollTop + box.clientHeight) box.scrollTop = y + ROW_H - box.clientHeight;
    }
    requestAnimationFrame(() => {
      box.querySelector<HTMLElement>(`[data-cell="${cell.r}:${cell.c}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  };

  const select = (cell: Cell) => {
    setSel(cell);
    reveal(cell);
  };

  const move = (from: Cell, dr: number, dc: number): Cell => {
    const ri = Math.min(layout.rows.length - 1, Math.max(0, (rowIndex.get(from.r) ?? 0) + dr));
    const ci = Math.min(layout.cols.length - 1, Math.max(0, (colIndex.get(from.c) ?? 0) + dc));
    return { r: layout.rows[ri], c: layout.cols[ci].col };
  };

  const beginEdit = (cell: Cell, draft?: string) => {
    if (!editable(cell.r, cell.c)) {
      if (canEdit && isFormulaCell(tab, cell.r, cell.c)) toast.info("Это формула — она считается в таблице сама");
      return;
    }
    const col = tab.meta.cols[cell.c];
    if (col?.kind === "b") {
      // Галочка — без редактора: нажатие и есть правка.
      onEdit([{ ...cell, value: isCheckedText(valueAt(cell.r, cell.c)) ? "FALSE" : "TRUE" }]);
      return;
    }
    setEditing({ ...cell, draft: draft ?? valueAt(cell.r, cell.c) });
  };

  /** true — правка принята (редактор закрывается). */
  const commit = (cell: Cell, draft: string): boolean => {
    const col = tab.meta.cols[cell.c];
    const checked = checkOsSheetValue(col, draft);
    if (!checked.ok) {
      toast.error(`${columnTitle(tab, cell.c)}: ${osEditReasonText(checked.reason)}`);
      return false;
    }
    if (checked.value !== valueAt(cell.r, cell.c)) onEdit([{ ...cell, value: checked.value }]);
    return true;
  };

  const finishEdit = (next: "down" | "right" | "stay" | "cancel") => {
    if (!editing) return;
    const cell = { r: editing.r, c: editing.c };
    if (next !== "cancel" && !commit(cell, editing.draft)) return;
    setEditing(null);
    if (next === "down") select(move(cell, 1, 0));
    else if (next === "right") select(move(cell, 0, 1));
    focusBox();
  };

  const onBoxKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (editing || e.target !== e.currentTarget) return;
    if (!sel) {
      if (e.key.startsWith("Arrow") && layout.rows.length > tab.meta.hdr) {
        e.preventDefault();
        const first = layout.rows.find((r) => r >= tab.meta.hdr) ?? layout.rows[0];
        select({ r: first, c: layout.cols[0]?.col ?? 0 });
      }
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    // Горячие клавиши — по e.code: на русской раскладке e.key у C — «с».
    if (mod && e.code === "KeyC") {
      e.preventDefault();
      void navigator.clipboard?.writeText(valueAt(sel.r, sel.c)).catch(() => undefined);
      return;
    }
    if (mod) return;
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (arrows[e.key]) {
      e.preventDefault();
      select(move(sel, arrows[e.key][0], arrows[e.key][1]));
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      select(move(sel, 0, e.shiftKey ? -1 : 1));
      return;
    }
    if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      beginEdit(sel);
      return;
    }
    if (e.key === " " && tab.meta.cols[sel.c]?.kind === "b") {
      e.preventDefault();
      beginEdit(sel);
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && editable(sel.r, sel.c)) {
      e.preventDefault();
      if (valueAt(sel.r, sel.c) !== "") onEdit([{ ...sel, value: "" }]);
      return;
    }
    if (e.key.length === 1 && !e.altKey) {
      const kind = tab.meta.cols[sel.c]?.kind;
      if (kind === "l" || kind === "b") return;
      e.preventDefault();
      beginEdit(sel, e.key);
    }
  };

  // Вставка блоком (из Excel/Google — строки через \n, ячейки через \t) от выбранной ячейки.
  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    if (editing || !sel || !canEdit) return;
    const textData = e.clipboardData.getData("text/plain");
    if (!textData) return;
    e.preventDefault();
    const lines = textData.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
    const out: CellEditInput[] = [];
    let skipped = 0;
    const r0 = rowIndex.get(sel.r) ?? 0;
    const c0 = colIndex.get(sel.c) ?? 0;
    lines.forEach((line, i) => {
      const r = layout.rows[r0 + i];
      if (r === undefined) return;
      line.split("\t").forEach((raw, j) => {
        const c = layout.cols[c0 + j]?.col;
        if (c === undefined) return;
        if (!editable(r, c)) {
          skipped++;
          return;
        }
        const checked = checkOsSheetValue(tab.meta.cols[c], raw);
        if (!checked.ok) {
          skipped++;
          return;
        }
        if (checked.value !== valueAt(r, c)) out.push({ r, c, value: checked.value });
      });
    });
    if (out.length > 200) {
      toast.error("За раз — не больше 200 ячеек");
      return;
    }
    if (out.length) onEdit(out);
    if (skipped) toast.warning(`Пропущено ячеек: ${skipped} — шапка, формулы или неподходящие значения`);
  };

  if (layout.rows.length === 0 || layout.cols.length === 0) {
    return <EmptyState bordered title="Лист пуст" description="В таблице на этом листе пока нет данных." />;
  }

  const renderRow = (r: number, ri: number) => {
    const frozenRow = ri < layout.frozenRows;
    const header = r < tab.meta.hdr;
    return (
      <tr key={r} style={{ height: ROW_H }}>
        {layout.cols.map(({ col: c }) => {
          const k = `${r}:${c}`;
          if (layout.covered.has(k)) return null;
          const span = layout.spans.get(k);
          const style = styleOf(tab, r, c);
          const paint = paintOf(style);
          const left = leftOf.get(c);
          const sticky = frozenRow || left !== undefined;
          const align = style.align === "r" ? "right" : style.align === "c" ? "center" : "left";
          const col = tab.meta.cols[c];
          const isEditing = editing?.r === r && editing.c === c;
          const selected = sel?.r === r && sel.c === c;
          const pending = marks.pending.has(k);
          const failed = marks.failed.get(k);
          const value = valueAt(r, c);
          const formula = !header && isFormulaCell(tab, r, c);
          return (
            <td
              key={c}
              data-cell={k}
              rowSpan={span && span.rowSpan > 1 ? span.rowSpan : undefined}
              colSpan={span && span.colSpan > 1 ? span.colSpan : undefined}
              title={failed ? `Не применилось: ${failed}` : formula ? "Формула — считается в таблице сама" : value.length > 14 ? value : undefined}
              onMouseDown={(e) => {
                if (isEditing) return;
                e.preventDefault();
                focusBox();
                if (selected && !header && e.detail === 1 && col?.kind === "b") beginEdit({ r, c });
                setSel({ r, c });
              }}
              onDoubleClick={() => !header && beginEdit({ r, c })}
              className={cn(
                "relative overflow-hidden text-ellipsis whitespace-nowrap border-b border-r border-border/60 px-2 tabular-nums",
                sticky && "sticky",
                sticky && !paint.background && "bg-card",
                !header && canEdit && !formula && "cursor-cell",
                pending && "text-muted-foreground"
              )}
              style={{
                height: ROW_H * (span?.rowSpan ?? 1),
                textAlign: align,
                background: paint.background ?? undefined,
                color: pending ? undefined : (paint.color ?? undefined),
                fontWeight: style.bold ? 600 : undefined,
                fontStyle: style.italic || pending ? "italic" : undefined,
                top: frozenRow ? ri * ROW_H : undefined,
                left,
                zIndex: isEditing ? 5 : frozenRow && left !== undefined ? 3 : sticky ? 2 : undefined,
                boxShadow: selected ? "inset 0 0 0 2px hsl(var(--primary))" : failed ? "inset 0 0 0 1px hsl(var(--destructive))" : undefined,
              }}
            >
              {isEditing ? (
                <CellEditor
                  editing={editing}
                  kind={col?.kind ?? "t"}
                  options={col?.options ?? []}
                  allowInvalid={Boolean(col?.allowInvalid)}
                  listId={`${listId}-${c}`}
                  onDraft={(draft) => setEditing((prev) => (prev ? { ...prev, draft } : prev))}
                  onPick={(value) => {
                    // Выбор из списка — сразу правка.
                    if (commit({ r, c }, value)) {
                      setEditing(null);
                      focusBox();
                    }
                  }}
                  onFinish={finishEdit}
                />
              ) : !header && col?.kind === "b" ? (
                isCheckedText(value) ? (
                  <SquareCheck className="inline h-4 w-4 text-primary" aria-label="Да" />
                ) : (
                  <Square className="inline h-4 w-4 text-muted-foreground/60" aria-label="Нет" />
                )
              ) : !header && col?.kind === "l" && value ? (
                <span className="inline-block max-w-full truncate rounded-full border border-border/70 bg-muted/60 px-2 py-px text-[12px] leading-5 text-foreground">
                  {value}
                </span>
              ) : (
                value
              )}
              {pending && !isEditing && (
                <span className="absolute right-1 top-1 h-1.5 w-1.5 animate-pulse rounded-full bg-primary" aria-label="Отправляется в таблицу" />
              )}
            </td>
          );
        })}
      </tr>
    );
  };

  const topPad = firstBody * ROW_H;
  const bottomPad = (bodyRows.length - lastBody) * ROW_H;

  return (
    <div
      ref={boxRef}
      tabIndex={0}
      onKeyDown={onBoxKey}
      onPaste={onPaste}
      className="max-h-[calc(100dvh-16rem)] min-h-40 w-fit max-w-full overflow-auto rounded-xl border border-border bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring"
      // Без этого браузер «якорит» прокрутку к видимой строке, пока распорка
      // окна строк меняет высоту, — и лист сам уезжает вниз до конца.
      style={{ overflowAnchor: "none" }}
      data-os-sheet-table
      aria-label={`Лист «${name}»`}
    >
      <table className="border-separate border-spacing-0 text-[13px] leading-tight" style={{ tableLayout: "fixed", width: totalWidth }}>
        <colgroup>
          {layout.cols.map((c) => (
            <col key={c.col} style={{ width: c.width }} />
          ))}
        </colgroup>
        <tbody>
          {layout.rows.slice(0, layout.frozenRows).map((r, i) => renderRow(r, i))}
          {topPad > 0 && (
            <tr aria-hidden style={{ height: topPad }}>
              <td colSpan={layout.cols.length} />
            </tr>
          )}
          {bodyRows.slice(firstBody, lastBody).map((r, i) => renderRow(r, layout.frozenRows + firstBody + i))}
          {bottomPad > 0 && (
            <tr aria-hidden style={{ height: bottomPad }}>
              <td colSpan={layout.cols.length} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function CellEditor({
  editing,
  kind,
  options,
  allowInvalid,
  listId,
  onDraft,
  onPick,
  onFinish,
}: {
  editing: Editing;
  kind: string;
  options: string[];
  allowInvalid: boolean;
  listId: string;
  onDraft: (draft: string) => void;
  onPick: (value: string) => void;
  onFinish: (next: "down" | "right" | "stay" | "cancel") => void;
}) {
  const ref = useRef<HTMLInputElement & HTMLSelectElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    if (el instanceof HTMLInputElement) {
      const end = el.value.length;
      el.setSelectionRange(end, end);
    }
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onFinish("down");
    } else if (e.key === "Tab") {
      e.preventDefault();
      onFinish("right");
    } else if (e.key === "Escape") {
      e.preventDefault();
      onFinish("cancel");
    }
    e.stopPropagation();
  };

  const box = "absolute inset-0 z-[5] h-full w-full border-0 bg-background px-2 text-[13px] text-foreground outline-none ring-2 ring-inset ring-primary";

  if (kind === "l" && !allowInvalid && options.length > 0) {
    const known = options.includes(editing.draft);
    return (
      <select
        ref={ref}
        className={box}
        value={known ? editing.draft : ""}
        onChange={(e) => onPick(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => onFinish("cancel")}
        aria-label="Выберите значение"
      >
        <option value="">—</option>
        {!known && editing.draft && (
          <option value={editing.draft} disabled>
            {editing.draft}
          </option>
        )}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }

  return (
    <>
      <input
        ref={ref}
        className={box}
        value={editing.draft}
        inputMode={kind === "n" ? "decimal" : undefined}
        placeholder={kind === "d" ? "ДД.ММ.ГГГГ" : undefined}
        list={kind === "l" ? listId : undefined}
        onChange={(e) => onDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => onFinish("stay")}
        aria-label="Новое значение"
      />
      {kind === "l" && (
        <datalist id={listId}>
          {options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      )}
      {kind === "l" && <Check className="pointer-events-none absolute right-1 top-1/2 z-[6] h-3.5 w-3.5 -translate-y-1/2 text-primary" />}
    </>
  );
}
