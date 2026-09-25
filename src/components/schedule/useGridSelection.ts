import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cellKey, movePoint, rectKeys, type GridPoint } from "@/utils/scheduleEdit";

interface SelectionState {
  keys: Set<string>;
  anchor: GridPoint | null;
  focus: GridPoint | null;
}

const EMPTY: SelectionState = { keys: new Set(), anchor: null, focus: null };

export interface GridSelection {
  /** Ключи `строка|столбец` выделенных клеток. */
  selected: ReadonlySet<string>;
  /** Клетка, к которой привязана палитра и от которой ходят стрелки. */
  focus: GridPoint | null;
  focusKey: string | null;
  clear: () => void;
  /** Выделить набор клеток целиком (столбец раздела, день из «Дня»). */
  setKeys: (keys: string[], focus: GridPoint) => void;
  /** Мышь: нажали на клетку (с Shift — прямоугольник от прошлой, с Ctrl — добавить/убрать). */
  onCellPointerDown: (event: React.PointerEvent, point: GridPoint) => void;
  /** Мышь протянута на клетку — прямоугольник от точки нажатия. */
  onCellPointerEnter: (point: GridPoint) => void;
  /** Касание и Enter/пробел с клавиатуры — клик; мышь обрабатывается по нажатию. */
  onCellClick: (event: React.MouseEvent, point: GridPoint) => void;
  /** Стрелки: сдвинуть клетку, с Shift — растянуть выделение. */
  move: (dRow: number, dCol: number, extend: boolean) => void;
}

/**
 * Выделение в сетке графика — как в Google Sheets, где руководство график и
 * вело: клик выделяет клетку, протяжка — прямоугольник, Shift — от прошлой
 * клетки до этой, Ctrl — добавить клетку. Когда жест закончен, зовём
 * `onCommit` — страница открывает палитру «что поставить».
 *
 * На касании протяжки нет: палец листает сетку. Там касание = одна клетка.
 */
export function useGridSelection({
  rowIds,
  colIds,
  resetKey,
  dragEnabled,
  onCommit,
  onGestureStart,
}: {
  rowIds: readonly string[];
  colIds: readonly string[];
  /** Сменился месяц/вид/набор строк — старое выделение к новой сетке не относится. */
  resetKey: string;
  /**
   * Протяжка, Shift и Ctrl — только у того, кто правит. Кто график смотрит,
   * кликом открывает одну клетку (посмотреть смену «12:00–15:00»).
   */
  dragEnabled: boolean;
  onCommit: () => void;
  /** Начали новый жест мышью — палитра прошлого выделения мешала бы протяжке. */
  onGestureStart?: () => void;
}): GridSelection {
  const [state, setState] = useState<SelectionState>(EMPTY);
  const stateRef = useRef(state);
  stateRef.current = state;
  const dragRef = useRef(false);
  const gestureRef = useRef(false);
  const pointerTypeRef = useRef<string>("mouse");
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const gestureStartRef = useRef(onGestureStart);
  gestureStartRef.current = onGestureStart;
  const gridRef = useRef({ rowIds, colIds });
  gridRef.current = { rowIds, colIds };
  const dragEnabledRef = useRef(dragEnabled);
  dragEnabledRef.current = dragEnabled;

  useEffect(() => {
    setState(EMPTY);
    dragRef.current = false;
    gestureRef.current = false;
  }, [resetKey]);

  // Жест мышью заканчивается где угодно — в том числе за пределами сетки.
  useEffect(() => {
    function end() {
      if (!gestureRef.current) return;
      gestureRef.current = false;
      dragRef.current = false;
      if (stateRef.current.keys.size > 0) commitRef.current();
    }
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, []);

  const keyOf = useCallback((point: GridPoint) => {
    const { rowIds: rows, colIds: cols } = gridRef.current;
    const row = rows[point.row];
    const col = cols[point.col];
    return row !== undefined && col !== undefined ? cellKey(row, col) : null;
  }, []);

  const onCellPointerDown = useCallback(
    (event: React.PointerEvent, point: GridPoint) => {
      pointerTypeRef.current = event.pointerType || "mouse";
      if (!dragEnabledRef.current) {
        // Смотрящий: клик обработает onCellClick — как касание.
        pointerTypeRef.current = "tap";
        return;
      }
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      // Иначе браузер начнёт выделять текст и уводить фокус.
      event.preventDefault();
      // Но и фокус там, где он был, оставлять нельзя: после поиска он в поле,
      // и «В» печаталась бы в поиск (сетка перестраивалась и выделение
      // пропадало), а Enter нажимал бы прошлую клетку вместо выделенных.
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body) active.blur();
      const key = keyOf(point);
      if (!key) return;
      const { rowIds: rows, colIds: cols } = gridRef.current;
      const prev = stateRef.current;
      gestureRef.current = true;
      gestureStartRef.current?.();
      if (event.shiftKey && prev.anchor) {
        setState({ keys: new Set(rectKeys(rows, cols, prev.anchor, point)), anchor: prev.anchor, focus: point });
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        const keys = new Set(prev.keys);
        if (keys.has(key)) keys.delete(key);
        else keys.add(key);
        setState({ keys, anchor: point, focus: point });
        return;
      }
      dragRef.current = true;
      setState({ keys: new Set([key]), anchor: point, focus: point });
    },
    [keyOf]
  );

  const onCellPointerEnter = useCallback((point: GridPoint) => {
    if (!dragRef.current) return;
    const prev = stateRef.current;
    if (!prev.anchor) return;
    if (prev.focus && prev.focus.row === point.row && prev.focus.col === point.col) return;
    const { rowIds: rows, colIds: cols } = gridRef.current;
    setState({ keys: new Set(rectKeys(rows, cols, prev.anchor, point)), anchor: prev.anchor, focus: point });
  }, []);

  const onCellClick = useCallback(
    (event: React.MouseEvent, point: GridPoint) => {
      // Мышь уже отработала по нажатию. Клик с клавиатуры (detail === 0) и
      // касание — здесь: касание не мешает листать сетку пальцем.
      if (pointerTypeRef.current === "mouse" && event.detail !== 0) return;
      const key = keyOf(point);
      if (!key) return;
      setState({ keys: new Set([key]), anchor: point, focus: point });
      pointerTypeRef.current = "mouse";
      commitRef.current();
    },
    [keyOf]
  );

  const move = useCallback((dRow: number, dCol: number, extend: boolean) => {
    const prev = stateRef.current;
    const { rowIds: rows, colIds: cols } = gridRef.current;
    if (rows.length === 0 || cols.length === 0) return;
    const from = prev.focus ?? { row: 0, col: 0 };
    const next = prev.focus ? movePoint(from, dRow, dCol, rows.length, cols.length) : from;
    if (extend && prev.anchor) {
      setState({ keys: new Set(rectKeys(rows, cols, prev.anchor, next)), anchor: prev.anchor, focus: next });
    } else {
      setState({ keys: new Set([cellKey(rows[next.row], cols[next.col])]), anchor: next, focus: next });
    }
  }, []);

  const clear = useCallback(() => setState(EMPTY), []);
  const setKeys = useCallback((keys: string[], focus: GridPoint) => {
    setState({ keys: new Set(keys), anchor: focus, focus });
  }, []);

  const focusKey = useMemo(() => (state.focus ? keyOf(state.focus) : null), [state.focus, keyOf]);

  return {
    selected: state.keys,
    focus: state.focus,
    focusKey,
    clear,
    setKeys,
    onCellPointerDown,
    onCellPointerEnter,
    onCellClick,
    move,
  };
}
