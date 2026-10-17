/**
 * ABS → «Таблица» (17.10.2026, SQL 20261051_abs_sheet.sql): разбор листов,
 * которые присылает скрипт Google-таблицы (src/utils/absSheetScript.ts), и
 * сетка для отрисовки. Чистый модуль — без React и сети.
 *
 * Формат листа (v1), всё сжато ради трафика:
 *   name, gid, fr/fc — закреплённые строки/столбцы,
 *   rows — значения КАК НА ЭКРАНЕ («₸1 301 768»), прямоугольник строк,
 *   s — номер стиля каждой ячейки (той же формы), st — сами стили:
 *     { b: фон, c: цвет текста, w: 1 — жирный, i: 1 — курсив, a: "l"|"c"|"r" },
 *   m — объединения [строка, столбец, строк, столбцов] (с нуля),
 *   w — ширины столбцов в px, hc / hr — скрытые столбцы / строки.
 *
 * Данные пишет чужой скрипт по секрету — верим только форме: цвета проходят
 * строгую проверку `#rrggbb`, всё остальное режется пределами ниже.
 */

export type SheetAlign = "l" | "c" | "r";

export interface SheetStyle {
  bg: string | null;
  color: string | null;
  bold: boolean;
  italic: boolean;
  align: SheetAlign | null;
}

export interface SheetTab {
  name: string;
  gid: number | null;
  rows: string[][];
  styles: number[][];
  palette: SheetStyle[];
  merges: Array<[number, number, number, number]>;
  widths: number[];
  hiddenCols: number[];
  hiddenRows: number[];
  frozenRows: number;
  frozenCols: number;
}

export interface AbsSheet {
  id: string | null;
  title: string;
  tabs: SheetTab[];
}

export const SHEET_MAX_TABS = 8;
export const SHEET_MAX_ROWS = 300;
export const SHEET_MAX_COLS = 40;
const MAX_TEXT = 500;
const MAX_PALETTE = 2000;
const DEFAULT_WIDTH = 100;
const PLAIN: SheetStyle = { bg: null, color: null, bold: false, italic: false, align: null };

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function int(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function sheetColor(v: unknown): string | null {
  return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null;
}

function parseStyle(v: unknown): SheetStyle {
  const o = asObject(v);
  if (!o) return PLAIN;
  const a = o.a === "l" || o.a === "c" || o.a === "r" ? o.a : null;
  return { bg: sheetColor(o.b), color: sheetColor(o.c), bold: o.w === 1 || o.w === true, italic: o.i === 1 || o.i === true, align: a };
}

function indexList(v: unknown, limit: number): number[] {
  if (!Array.isArray(v)) return [];
  const out = new Set<number>();
  for (const x of v) {
    const n = typeof x === "number" ? x : Number(x);
    if (Number.isInteger(n) && n >= 0 && n < limit) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

export function parseSheetTab(v: unknown): SheetTab | null {
  const o = asObject(v);
  if (!o || typeof o.name !== "string" || !Array.isArray(o.rows)) return null;
  const rawRows = o.rows.slice(0, SHEET_MAX_ROWS);
  let cols = 0;
  for (const r of rawRows) if (Array.isArray(r)) cols = Math.max(cols, Math.min(r.length, SHEET_MAX_COLS));
  const palette = (Array.isArray(o.st) ? o.st.slice(0, MAX_PALETTE) : []).map(parseStyle);
  const rawStyles = Array.isArray(o.s) ? o.s : [];
  const rows: string[][] = [];
  const styles: number[][] = [];
  rawRows.forEach((r, ri) => {
    const line: string[] = [];
    const sline: number[] = [];
    const srow = Array.isArray(rawStyles[ri]) ? (rawStyles[ri] as unknown[]) : [];
    for (let c = 0; c < cols; c++) {
      const cell = Array.isArray(r) ? r[c] : "";
      line.push(cell == null ? "" : String(cell).slice(0, MAX_TEXT));
      const si = srow[c];
      sline.push(typeof si === "number" && Number.isInteger(si) && si >= 0 && si < palette.length ? si : -1);
    }
    rows.push(line);
    styles.push(sline);
  });
  const nRows = rows.length;
  const merges: Array<[number, number, number, number]> = [];
  if (Array.isArray(o.m)) {
    for (const m of o.m.slice(0, 2000)) {
      if (!Array.isArray(m) || m.length < 4) continue;
      const [r, c, rs, cs] = m.map((x) => (typeof x === "number" ? x : Number(x)));
      if (![r, c, rs, cs].every(Number.isInteger) || r < 0 || c < 0 || rs < 1 || cs < 1) continue;
      if (r >= nRows || c >= cols) continue;
      const span: [number, number, number, number] = [r, c, Math.min(rs, nRows - r), Math.min(cs, cols - c)];
      if (span[2] * span[3] > 1) merges.push(span);
    }
  }
  const widths: number[] = [];
  const rawWidths = Array.isArray(o.w) ? o.w : [];
  for (let c = 0; c < cols; c++) widths.push(int(rawWidths[c], 24, 600, DEFAULT_WIDTH));
  return {
    name: o.name.slice(0, 100),
    gid: Number.isInteger(o.gid) ? (o.gid as number) : null,
    rows,
    styles,
    palette,
    merges,
    widths,
    hiddenCols: indexList(o.hc, cols),
    hiddenRows: indexList(o.hr, nRows),
    frozenRows: int(o.fr, 0, 20, 0),
    frozenCols: int(o.fc, 0, 10, 0),
  };
}

export function parseAbsSheet(payload: unknown): AbsSheet | null {
  let o = asObject(payload);
  if (!o && typeof payload === "string") {
    try {
      o = asObject(JSON.parse(payload));
    } catch {
      o = null;
    }
  }
  if (!o || !Array.isArray(o.tabs)) return null;
  const tabs = o.tabs
    .slice(0, SHEET_MAX_TABS)
    .map(parseSheetTab)
    .filter((t): t is SheetTab => t !== null);
  return {
    id: typeof o.id === "string" && /^[A-Za-z0-9_-]{10,100}$/.test(o.id) ? o.id : null,
    title: typeof o.title === "string" ? o.title.slice(0, 200) : "",
    tabs,
  };
}

// ---------------------------------------------------------------------------
// Сетка для отрисовки: скрытое убрано, объединения — в rowSpan/colSpan.

export interface GridCell {
  col: number;
  text: string;
  style: SheetStyle;
  rowSpan: number;
  colSpan: number;
}

export interface GridRow {
  row: number;
  cells: GridCell[];
}

export interface SheetGrid {
  /** Видимые столбцы листа и их ширины — порядок <col>. */
  cols: Array<{ col: number; width: number }>;
  rows: GridRow[];
  /** Сколько первых ВИДИМЫХ строк / столбцов закреплено. */
  frozenRows: number;
  frozenCols: number;
}

function styleAt(tab: SheetTab, r: number, c: number): SheetStyle {
  const i = tab.styles[r]?.[c] ?? -1;
  return i >= 0 ? (tab.palette[i] ?? PLAIN) : PLAIN;
}

export function buildSheetGrid(tab: SheetTab): SheetGrid {
  const nRows = tab.rows.length;
  const nCols = tab.widths.length;
  const hiddenRows = new Set(tab.hiddenRows);
  const hiddenCols = new Set(tab.hiddenCols);
  const visibleCols: number[] = [];
  for (let c = 0; c < nCols; c++) if (!hiddenCols.has(c)) visibleCols.push(c);
  const visibleRows: number[] = [];
  for (let r = 0; r < nRows; r++) if (!hiddenRows.has(r)) visibleRows.push(r);

  // Объединение рисуется с левой верхней ячейки; если она скрыта — объединение
  // не рисуем вовсе (ячейки как есть), как ведёт себя и сама таблица при
  // скрытом начале объединения.
  const anchor = new Map<string, { rowSpan: number; colSpan: number }>();
  const covered = new Set<string>();
  const taken = new Set<string>();
  for (const [r, c, rs, cs] of tab.merges) {
    if (hiddenRows.has(r) || hiddenCols.has(c)) continue;
    const keys: string[] = [];
    for (let i = r; i < r + rs; i++) for (let j = c; j < c + cs; j++) keys.push(`${i}:${j}`);
    // Объединения не должны налезать друг на друга — кривое пропускаем.
    if (keys.some((k) => taken.has(k))) continue;
    let rowSpan = 0;
    for (let i = r; i < r + rs; i++) if (!hiddenRows.has(i)) rowSpan++;
    let colSpan = 0;
    for (let j = c; j < c + cs; j++) if (!hiddenCols.has(j)) colSpan++;
    const key = `${r}:${c}`;
    anchor.set(key, { rowSpan, colSpan });
    for (const k of keys) {
      taken.add(k);
      if (k !== key) covered.add(k);
    }
  }

  const rows: GridRow[] = visibleRows.map((r) => {
    const cells: GridCell[] = [];
    for (const c of visibleCols) {
      const key = `${r}:${c}`;
      if (covered.has(key)) continue;
      const span = anchor.get(key);
      cells.push({ col: c, text: tab.rows[r]?.[c] ?? "", style: styleAt(tab, r, c), rowSpan: span?.rowSpan ?? 1, colSpan: span?.colSpan ?? 1 });
    }
    return { row: r, cells };
  });

  return {
    cols: visibleCols.map((c) => ({ col: c, width: tab.widths[c] ?? DEFAULT_WIDTH })),
    rows,
    frozenRows: visibleRows.filter((r) => r < tab.frozenRows).length,
    frozenCols: visibleCols.filter((c) => c < tab.frozenCols).length,
  };
}

// ---------------------------------------------------------------------------
// Цвета в теме Nova: белый фон таблицы становится фоном Nova (и тёмная тема не
// превращает отчёт в белый лист), чёрный текст на нём — цветом текста Nova.
// Цветные заливки (зелёные/жёлтые/красные строки, тёмная шапка) — как в таблице.

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export interface CellPaint {
  /** null — фон Nova. */
  background: string | null;
  /** null — цвет текста Nova. */
  color: string | null;
}

export function paintOf(style: SheetStyle): CellPaint {
  const bg = style.bg && luminance(style.bg) < 0.93 ? style.bg : null;
  if (!bg) {
    // На фоне Nova оставляем только заметные цвета текста; чёрный и почти чёрный — цвет темы.
    const color = style.color && luminance(style.color) > 0.02 && luminance(style.color) < 0.9 ? style.color : null;
    return { background: null, color };
  }
  return { background: bg, color: style.color ?? "#000000" };
}

// ---------------------------------------------------------------------------
// Состояние копии на вкладке (services/absSheetService.ts) и разбор ответа
// `abs_sheet_get` — здесь, чтобы проверять без сети.

export type AbsSheetStatus = "idle" | "loading" | "ready" | "missing" | "error";

export interface AbsSheetState {
  status: AbsSheetStatus;
  connected: boolean;
  /** false — Owner открыл таблицу только руководству. */
  allowed: boolean;
  audience: "all" | "lead";
  hash: string | null;
  sheet: AbsSheet | null;
  /** Когда таблица последний раз МЕНЯЛАСЬ (мс сервера). */
  pushedAt: number | null;
  /** Когда скрипт последний раз выходил на связь (мс сервера). */
  seenAt: number | null;
  /** Когда эта вкладка последний раз спросила базу (мс её часов). */
  checkedAt: number;
}

export const ABS_SHEET_IDLE: AbsSheetState = {
  status: "idle",
  connected: false,
  allowed: true,
  audience: "all",
  hash: null,
  sheet: null,
  pushedAt: null,
  seenAt: null,
  checkedAt: 0,
};

function millisOf(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return v != null && Number.isFinite(n) && n > 0 ? n : null;
}

function responseObject(data: unknown): Record<string, unknown> {
  if (typeof data === "string") {
    try {
      return asObject(JSON.parse(data)) ?? {};
    } catch {
      return {};
    }
  }
  return asObject(data) ?? {};
}

/** Ответ `abs_sheet_get` поверх прежнего состояния (таблица не пришла — та же). */
export function applyAbsSheetResponse(prev: AbsSheetState, data: unknown, now = Date.now()): AbsSheetState {
  const o = responseObject(data);
  const connected = o.connected === true;
  const allowed = o.allowed !== false;
  const audience = o.audience === "lead" ? "lead" : "all";
  if (!connected || !allowed) {
    return { ...ABS_SHEET_IDLE, status: "ready", connected, allowed, audience, checkedAt: now };
  }
  const hash = typeof o.hash === "string" ? o.hash : null;
  let sheet = prev.hash === hash ? prev.sheet : null;
  if (o.payload != null) sheet = parseAbsSheet(o.payload);
  return {
    status: "ready",
    connected,
    allowed,
    audience,
    hash: sheet ? hash : null,
    sheet: hash ? sheet : null,
    pushedAt: millisOf(o.pushedAt),
    seenAt: millisOf(o.seenAt),
    checkedAt: now,
  };
}

