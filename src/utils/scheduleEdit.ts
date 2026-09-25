import {
  formatScheduleHours,
  normalizeWeekEntry,
  sameScheduleHours,
  sameWeek,
  scheduleHoursOf,
  scheduleStateOf,
  type ScheduleHours,
  type TechSchedule,
  type WeekCell,
  type WeekTemplateEntry,
} from "@/types";
import type { ScheduleDraftChange } from "@/services/techScheduleService";
import { planScheduleBulk, type ScheduleBulkAction } from "@/utils/scheduleBulk";
import { weekdayOfDay } from "@/utils/weekTemplate";

/**
 * Правка графика прямо в сетке: выделили клетки (одну, протяжкой или по
 * столбцу) — выбрали, что поставить. Здесь — чистая логика: что именно
 * пишется, у кого и как это вернуть одним «Отменить». Страница только
 * показывает и отправляет.
 */

const WORK_CELL: WeekCell = { off: false, hours: null };

/** Клетка месяца в выделении: человек (id документа графика) и день месяца. */
export interface MonthCellRef {
  uid: string;
  dayKey: string;
}

/** Клетка недели в выделении: человек и день недели (`getUTCDay()` строкой). */
export interface WeekCellRef {
  personId: string;
  dow: string;
}

export interface MonthEditPlan {
  /** По человеку — ровно тронутые дни (формат `saveScheduleDraft`). */
  changes: ScheduleDraftChange[];
  /** Обратная правка: вернуть тронутые дни как были. */
  undo: ScheduleDraftChange[];
  /** Сколько клеток реально меняется. */
  touched: number;
  /** У скольких людей. */
  people: number;
}

/** Порядок людей — как в выделении: так и тост, и отмена читаются в том же порядке. */
function groupByUid(cells: MonthCellRef[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const cell of cells) {
    const list = out.get(cell.uid) ?? [];
    if (!list.includes(cell.dayKey)) list.push(cell.dayKey);
    out.set(cell.uid, list);
  }
  return out;
}

/**
 * Действие над выделенными клетками месяца — у многих людей разом. Что
 * пишется у каждого, решает `planScheduleBulk` (то же правило, что в окне
 * «Месяц человека»): дни, где «уже так», не пишутся, и отмена возвращает
 * тронутые дни целиком — с часами и «пришёл».
 */
export function planMonthEdit(
  schedules: ReadonlyMap<string, TechSchedule>,
  cells: MonthCellRef[],
  action: ScheduleBulkAction,
  shift?: ScheduleHours | null
): MonthEditPlan {
  const changes: ScheduleDraftChange[] = [];
  const undo: ScheduleDraftChange[] = [];
  let touched = 0;
  for (const [uid, dayKeys] of groupByUid(cells)) {
    const plan = planScheduleBulk(schedules.get(uid) ?? null, dayKeys, action, shift);
    if (plan.touched.length === 0) continue;
    changes.push({ uid, ...plan.change });
    undo.push({ uid, ...plan.undo });
    touched += plan.touched.length;
  }
  return { changes, undo, touched, people: changes.length };
}

/**
 * «Как в постоянной неделе»: выделенные дни — к тому, что стоит у человека в
 * неделе в этот день недели (выходной / смена / рабочий). Отпуск закончился,
 * «поменялись» отработали — вернуть обычный распорядок одной кнопкой, не
 * вспоминая, у кого какой выходной.
 */
export function planMonthRestore(
  schedules: ReadonlyMap<string, TechSchedule>,
  cells: MonthCellRef[],
  monthKey: string,
  weekCellsOf: (personId: string) => Record<string, WeekCell>
): MonthEditPlan {
  const groups = new Map<string, { action: ScheduleBulkAction; shift: ScheduleHours | null; cells: MonthCellRef[] }>();
  for (const cell of cells) {
    const dow = String(weekdayOfDay(monthKey, cell.dayKey));
    const week = weekCellsOf(cell.uid)[dow] ?? WORK_CELL;
    const key = week.off ? "off" : week.hours ? `hours:${formatScheduleHours(week.hours)}` : "work";
    const group = groups.get(key) ?? {
      action: week.off ? "off" : week.hours ? "hours" : "work",
      shift: week.off ? null : week.hours,
      cells: [],
    };
    group.cells.push(cell);
    groups.set(key, group);
  }
  let changes: ScheduleDraftChange[] = [];
  let undo: ScheduleDraftChange[] = [];
  let touched = 0;
  for (const group of groups.values()) {
    const plan = planMonthEdit(schedules, group.cells, group.action, group.shift);
    changes = mergeDraftChanges(changes, plan.changes);
    undo = mergeDraftChanges(undo, plan.undo);
    touched += plan.touched;
  }
  return { changes, undo, touched, people: changes.length };
}

/** Что сейчас стоит в клетке месяца — для подсветки текущего варианта в палитре. */
export type MonthCellKind = "work" | "off" | "excused" | "hours" | "came";

export function monthCellKind(schedule: TechSchedule | null | undefined, dayKey: string): MonthCellKind {
  const state = scheduleStateOf(schedule, dayKey);
  if (state === "off") return "off";
  if (state === "excused") return "excused";
  if (schedule?.selfWork?.[dayKey] && schedule?.days?.[dayKey]) return "came";
  return scheduleHoursOf(schedule, dayKey) ? "hours" : "work";
}

/** Сколько клеток каждого вида в выделении — палитра подсвечивает тот, что у всех одинаковый. */
export function monthSelectionKinds(
  schedules: ReadonlyMap<string, TechSchedule>,
  cells: MonthCellRef[]
): Map<MonthCellKind, number> {
  const out = new Map<MonthCellKind, number>();
  for (const cell of cells) {
    const kind = monthCellKind(schedules.get(cell.uid) ?? null, cell.dayKey);
    out.set(kind, (out.get(kind) ?? 0) + 1);
  }
  return out;
}

/**
 * Слить правки одного месяца: у одного человека ключи из `extra` сильнее.
 * Нужно, когда к раскладке недели добавлена разовая правка тех же дней (или
 * её отмена) — в одну пачку и по одному документу на человека.
 */
export function mergeDraftChanges(base: ScheduleDraftChange[], extra: ScheduleDraftChange[]): ScheduleDraftChange[] {
  const byUid = new Map<string, ScheduleDraftChange>();
  for (const change of [...base, ...extra]) {
    const found = byUid.get(change.uid);
    if (!found) {
      byUid.set(change.uid, {
        uid: change.uid,
        ...(change.days ? { days: { ...change.days } } : {}),
        ...(change.hours ? { hours: { ...change.hours } } : {}),
        ...(change.came ? { came: { ...change.came } } : {}),
      });
      continue;
    }
    if (change.days) found.days = { ...(found.days ?? {}), ...change.days };
    if (change.hours) found.hours = { ...(found.hours ?? {}), ...change.hours };
    if (change.came) found.came = { ...(found.came ?? {}), ...change.came };
  }
  return [...byUid.values()];
}

// ---------------------------------------------------------------------------
// Неделя
// ---------------------------------------------------------------------------

export type WeekAction = "work" | "off" | "hours";

export function sameWeekCell(a: WeekCell | undefined, b: WeekCell | undefined): boolean {
  const x = a ?? WORK_CELL;
  const y = b ?? WORK_CELL;
  return x.off === y.off && sameScheduleHours(x.hours, y.hours);
}

export function weekActionCell(action: WeekAction, shift?: ScheduleHours | null): WeekCell | null {
  if (action === "off") return { off: true, hours: null };
  if (action === "work") return WORK_CELL;
  return shift?.from ? { off: false, hours: shift } : null;
}

export interface WeekPersonChange {
  personId: string;
  /** Неделя человека целиком после правки — её и пишет `saveWeekTemplate`. */
  cells: Record<string, WeekCell>;
  entry: WeekTemplateEntry;
}

export interface WeekEditPlan {
  changes: WeekPersonChange[];
  /** Недели этих же людей ДО правки — ими «Отменить» и пишется. */
  undo: WeekPersonChange[];
  touched: number;
}

function toChange(personId: string, cells: Record<string, WeekCell>): WeekPersonChange {
  return { personId, cells, entry: normalizeWeekEntry(cells) };
}

/**
 * Действие над выделенными клетками недели. Неделя человека пишется целиком
 * (все семь дней), поэтому считаем её из ТОГО, что сейчас на экране
 * (`cellsOf` — сохранённое плюс ещё не записанное), а не из снимка базы:
 * иначе вторая быстрая правка того же человека откатывала бы первую.
 */
export function planWeekEdit(
  cellsOf: (personId: string) => Record<string, WeekCell>,
  cells: WeekCellRef[],
  action: WeekAction,
  shift?: ScheduleHours | null
): WeekEditPlan {
  const target = weekActionCell(action, shift);
  const out: WeekEditPlan = { changes: [], undo: [], touched: 0 };
  if (!target) return out;
  const byPerson = new Map<string, string[]>();
  for (const cell of cells) {
    const list = byPerson.get(cell.personId) ?? [];
    if (!list.includes(cell.dow)) list.push(cell.dow);
    byPerson.set(cell.personId, list);
  }
  for (const [personId, dows] of byPerson) {
    const before = cellsOf(personId);
    const after: Record<string, WeekCell> = { ...before };
    let touched = 0;
    for (const dow of dows) {
      if (sameWeekCell(before[dow], target)) continue;
      after[dow] = target;
      touched += 1;
    }
    if (touched === 0) continue;
    const change = toChange(personId, after);
    if (sameWeek(change.entry, normalizeWeekEntry(before))) continue;
    out.changes.push(change);
    out.undo.push(toChange(personId, before));
    out.touched += touched;
  }
  return out;
}

/**
 * «Каждую неделю» из месяца: выделенные дни месяца → дни недели каждого
 * человека. Выходной в субботу 26-го с этой галочкой — это «выходной каждую
 * субботу».
 */
export function monthCellsToWeekCells(monthKey: string, cells: MonthCellRef[]): WeekCellRef[] {
  const out: WeekCellRef[] = [];
  const seen = new Set<string>();
  for (const cell of cells) {
    const dow = String(weekdayOfDay(monthKey, cell.dayKey));
    const key = `${cell.uid}|${dow}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ personId: cell.uid, dow });
  }
  return out;
}

/** Действие месяца, которое имеет смысл повторять каждую неделю. */
export function weekActionOf(action: ScheduleBulkAction): WeekAction | null {
  return action === "off" || action === "work" || action === "hours" ? action : null;
}

// ---------------------------------------------------------------------------
// Выделение прямоугольником
// ---------------------------------------------------------------------------

export interface GridPoint {
  row: number;
  col: number;
}

export function cellKey(rowId: string, colId: string): string {
  return `${rowId}|${colId}`;
}

export function splitCellKey(key: string): [string, string] {
  const at = key.lastIndexOf("|");
  return [key.slice(0, at), key.slice(at + 1)];
}

/** Все клетки прямоугольника между двумя точками (включительно), по строкам сверху вниз. */
export function rectKeys(rowIds: readonly string[], colIds: readonly string[], a: GridPoint, b: GridPoint): string[] {
  const top = Math.max(0, Math.min(a.row, b.row));
  const bottom = Math.min(rowIds.length - 1, Math.max(a.row, b.row));
  const left = Math.max(0, Math.min(a.col, b.col));
  const right = Math.min(colIds.length - 1, Math.max(a.col, b.col));
  const out: string[] = [];
  for (let r = top; r <= bottom; r += 1) {
    for (let c = left; c <= right; c += 1) out.push(cellKey(rowIds[r], colIds[c]));
  }
  return out;
}

/** Точка на сетке после стрелки: не выходит за края. */
export function movePoint(point: GridPoint, dRow: number, dCol: number, rows: number, cols: number): GridPoint {
  return {
    row: Math.max(0, Math.min(rows - 1, point.row + dRow)),
    col: Math.max(0, Math.min(cols - 1, point.col + dCol)),
  };
}
