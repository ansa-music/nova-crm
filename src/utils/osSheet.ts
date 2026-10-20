/**
 * «Таблица ОС» (20.10.2026, SQL 20261053_os_sheet.sql): разбор копии
 * Google-таблицы ОС, которую присылает скрипт таблицы
 * (src/utils/osSheetScript.ts), слияние изменившихся строк и проверка
 * значений перед правкой. Чистый модуль — без React и сети.
 *
 * Отличие от ABS (utils/absSheet.ts): база отдаёт не лист целиком, а
 * описание листов (`meta`, только когда менялось) и строки новее версии
 * читателя: `[лист, номер строки, ячейки, ключи стилей, столбцы-формулы]`.
 * Стили — по ключу из палитры листа (`st`), ключ стабилен между передачами.
 *
 * Данные пишет чужой скрипт по секрету — верим только форме: цвета проходят
 * строгую проверку `#rrggbb`, всё остальное режется пределами ниже.
 */

import { sheetColor, type SheetAlign, type SheetStyle } from "@/utils/absSheet";

export type OsColKind = "t" | "n" | "d" | "l" | "b";

export interface OsSheetCol {
  kind: OsColKind;
  /** Варианты выпадающего списка (только `l`). */
  options: string[];
  /** Список пускает и значения не из списка. */
  allowInvalid: boolean;
  /** Столбец-формула: правится в таблице сама. */
  formula: boolean;
}

export interface OsSheetTabMeta {
  name: string;
  gid: number | null;
  frozenRows: number;
  frozenCols: number;
  /** Строк шапки: их в Nova не правят. */
  hdr: number;
  widths: number[];
  hiddenCols: number[];
  hiddenRows: number[];
  merges: Array<[number, number, number, number]>;
  cols: OsSheetCol[];
  /** Столбцы-ключ строки: по ним скрипт находит строку, если она сдвинулась. */
  key: number[];
  palette: Record<string, SheetStyle>;
  /** Строк в листе. */
  n: number;
}

export interface OsSheetRow {
  cells: string[];
  styles: string[];
  /** Столбцы, где в этой строке формула. */
  fx: number[];
}

export interface OsSheetTab {
  meta: OsSheetTabMeta;
  /** Длина — `meta.n`; строка, которой ещё нет, — undefined. */
  rows: Array<OsSheetRow | undefined>;
}

export interface OsSheetData {
  id: string | null;
  tabs: OsSheetTab[];
}

export const OS_SHEET_MAX_TABS = 4;
export const OS_SHEET_MAX_ROWS = 3000;
export const OS_SHEET_MAX_COLS = 40;
const MAX_TEXT = 1000;
const MAX_OPTIONS = 200;
const DEFAULT_WIDTH = 100;
export const OS_PLAIN_STYLE: SheetStyle = { bg: null, color: null, bold: false, italic: false, align: null };
const EMPTY_ROW: OsSheetRow = { cells: [], styles: [], fx: [] };

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function int(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function indexList(v: unknown, limit: number, max = 4000): number[] {
  if (!Array.isArray(v)) return [];
  const out = new Set<number>();
  for (const x of v.slice(0, max)) {
    const n = typeof x === "number" ? x : Number(x);
    if (Number.isInteger(n) && n >= 0 && n < limit) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

function text(v: unknown): string {
  return v == null ? "" : String(v).slice(0, MAX_TEXT);
}

function parseStyle(v: unknown): SheetStyle {
  const o = asObject(v);
  if (!o) return OS_PLAIN_STYLE;
  const a: SheetAlign | null = o.a === "l" || o.a === "c" || o.a === "r" ? o.a : null;
  return { bg: sheetColor(o.b), color: sheetColor(o.c), bold: o.w === 1 || o.w === true, italic: o.i === 1 || o.i === true, align: a };
}

function parseCol(v: unknown): OsSheetCol {
  const o = asObject(v) ?? {};
  const kind: OsColKind = o.k === "n" || o.k === "d" || o.k === "l" || o.k === "b" ? o.k : "t";
  const options: string[] = [];
  if (kind === "l" && Array.isArray(o.o)) {
    for (const x of o.o.slice(0, MAX_OPTIONS)) {
      const s = typeof x === "string" ? x.slice(0, 100) : "";
      if (s && !options.includes(s)) options.push(s);
    }
  }
  return { kind, options, allowInvalid: o.ai === 1 || o.ai === true, formula: o.f === 1 || o.f === true };
}

export function parseOsSheetTabMeta(v: unknown): OsSheetTabMeta | null {
  const o = asObject(v);
  if (!o || typeof o.name !== "string" || !o.name) return null;
  const rawCols = Array.isArray(o.cols) ? o.cols.slice(0, OS_SHEET_MAX_COLS) : [];
  const rawWidths = Array.isArray(o.w) ? o.w.slice(0, OS_SHEET_MAX_COLS) : [];
  const nCols = Math.max(rawCols.length, rawWidths.length);
  const cols: OsSheetCol[] = [];
  const widths: number[] = [];
  for (let c = 0; c < nCols; c++) {
    cols.push(parseCol(rawCols[c]));
    widths.push(int(rawWidths[c], 24, 600, DEFAULT_WIDTH));
  }
  const n = int(o.n, 0, OS_SHEET_MAX_ROWS, 0);
  const merges: Array<[number, number, number, number]> = [];
  if (Array.isArray(o.m)) {
    for (const m of o.m.slice(0, 2000)) {
      if (!Array.isArray(m) || m.length < 4) continue;
      const [r, c, rs, cs] = m.map((x) => (typeof x === "number" ? x : Number(x)));
      if (![r, c, rs, cs].every(Number.isInteger) || r < 0 || c < 0 || rs < 1 || cs < 1 || r >= n || c >= nCols) continue;
      const span: [number, number, number, number] = [r, c, Math.min(rs, n - r), Math.min(cs, nCols - c)];
      if (span[2] * span[3] > 1) merges.push(span);
    }
  }
  const palette: Record<string, SheetStyle> = {};
  const st = asObject(o.st);
  if (st) {
    let count = 0;
    for (const [k, style] of Object.entries(st)) {
      if (++count > 2000) break;
      if (k && k.length <= 40) palette[k] = parseStyle(style);
    }
  }
  const frozenRows = int(o.fr, 0, 20, 0);
  return {
    name: o.name.slice(0, 100),
    gid: Number.isInteger(o.gid) ? (o.gid as number) : null,
    frozenRows,
    frozenCols: int(o.fc, 0, 10, 0),
    hdr: int(o.hdr, 0, 20, frozenRows > 0 ? frozenRows : 1),
    widths,
    hiddenCols: indexList(o.hc, nCols),
    hiddenRows: indexList(o.hr, n),
    merges,
    cols,
    key: indexList(o.key, nCols, 6).slice(0, 3),
    palette,
    n,
  };
}

function parseRow(cells: unknown, styles: unknown, fx: unknown, nCols: number): OsSheetRow {
  const rawCells = Array.isArray(cells) ? cells.slice(0, OS_SHEET_MAX_COLS) : [];
  const rawStyles = Array.isArray(styles) ? styles : [];
  const width = Math.max(nCols, rawCells.length);
  const outCells: string[] = [];
  const outStyles: string[] = [];
  for (let c = 0; c < width; c++) {
    outCells.push(text(rawCells[c]));
    const s = rawStyles[c];
    outStyles.push(typeof s === "string" && s.length <= 40 ? s : "");
  }
  return { cells: outCells, styles: outStyles, fx: indexList(fx, width, OS_SHEET_MAX_COLS) };
}

// ---------------------------------------------------------------------------
// Состояние копии на вкладке и разбор ответа `os_sheet_get`.

export type OsSheetStatus = "idle" | "loading" | "ready" | "missing" | "error";

export interface OsSheetState {
  status: OsSheetStatus;
  connected: boolean;
  allowed: boolean;
  canEdit: boolean;
  audience: "os" | "all";
  /** Версия копии, до которой у вкладки всё есть (0 — ничего). */
  ver: number;
  data: OsSheetData | null;
  title: string | null;
  /** Адрес веб-приложения скрипта (только правщикам). */
  hook: string | null;
  pushedAt: number | null;
  seenAt: number | null;
  pulledAt: number | null;
  /** Правок в очереди у всей компании. */
  pending: number;
  checkedAt: number;
}

export const OS_SHEET_IDLE: OsSheetState = {
  status: "idle",
  connected: false,
  allowed: true,
  canEdit: false,
  audience: "os",
  ver: 0,
  data: null,
  title: null,
  hook: null,
  pushedAt: null,
  seenAt: null,
  pulledAt: null,
  pending: 0,
  checkedAt: 0,
};

export type OsEditStatus = "pending" | "done" | "failed";

export interface OsEditResult {
  id: number;
  status: OsEditStatus;
  reason: string | null;
  row: number | null;
}

export interface OsSheetResponse {
  state: OsSheetState;
  edits: OsEditResult[];
  /** Ответ пришёл дельтой, а копии у вкладки нет — читать целиком. */
  needFull: boolean;
}

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

function parseEdits(v: unknown): OsEditResult[] {
  if (!Array.isArray(v)) return [];
  const out: OsEditResult[] = [];
  for (const x of v.slice(0, 500)) {
    const o = asObject(x);
    const id = Number(o?.id);
    if (!o || !Number.isInteger(id)) continue;
    const status: OsEditStatus = o.status === "done" ? "done" : o.status === "failed" ? "failed" : "pending";
    const row = Number(o.row);
    out.push({ id, status, reason: typeof o.reason === "string" ? o.reason : null, row: o.row != null && Number.isInteger(row) ? row : null });
  }
  return out;
}

/** Ответ `os_sheet_get` поверх прежнего состояния: описание — если пришло, строки — дельтой. */
export function applyOsSheetResponse(prev: OsSheetState, raw: unknown, now = Date.now()): OsSheetResponse {
  const o = responseObject(raw);
  const connected = o.connected === true;
  const allowed = o.allowed !== false;
  const canEdit = o.canEdit === true;
  const audience = o.audience === "all" ? "all" : "os";
  const edits = parseEdits(o.edits);
  if (!connected || !allowed) {
    return { state: { ...OS_SHEET_IDLE, status: "ready", connected, allowed, canEdit, audience, checkedAt: now }, edits, needFull: false };
  }
  const ver = Number(o.ver);
  const full = o.full === true;
  const base = full ? null : prev.data;
  const metaRaw = asObject(o.meta);
  if (!metaRaw && !base) {
    return { state: { ...prev, checkedAt: now }, edits, needFull: true };
  }

  const prevTabs = new Map((base?.tabs ?? []).map((t) => [t.meta.name, t]));
  let tabs: OsSheetTab[];
  if (metaRaw) {
    const metas = (Array.isArray(metaRaw.tabs) ? metaRaw.tabs.slice(0, OS_SHEET_MAX_TABS) : [])
      .map(parseOsSheetTabMeta)
      .filter((m): m is OsSheetTabMeta => m !== null);
    tabs = metas.map((meta) => {
      const old = prevTabs.get(meta.name);
      const rows = old ? old.rows.slice(0, meta.n) : [];
      rows.length = meta.n;
      return { meta, rows };
    });
  } else {
    tabs = (base?.tabs ?? []).map((t) => ({ meta: t.meta, rows: t.rows.slice() }));
  }
  const byName = new Map(tabs.map((t) => [t.meta.name, t]));
  if (Array.isArray(o.rows)) {
    for (const item of o.rows) {
      if (!Array.isArray(item) || item.length < 3 || typeof item[0] !== "string") continue;
      const tab = byName.get(item[0]);
      const r = Number(item[1]);
      if (!tab || !Number.isInteger(r) || r < 0 || r >= tab.meta.n) continue;
      tab.rows[r] = parseRow(item[2], item[3], item[4], tab.meta.cols.length);
    }
  }
  const id = metaRaw
    ? typeof metaRaw.id === "string" && /^[A-Za-z0-9_-]{10,100}$/.test(metaRaw.id) ? metaRaw.id : null
    : (base?.id ?? null);
  return {
    state: {
      status: "ready",
      connected,
      allowed,
      canEdit,
      audience,
      ver: Number.isFinite(ver) && ver >= 0 ? ver : 0,
      data: { id, tabs },
      title: typeof o.title === "string" ? o.title.slice(0, 200) : null,
      hook: typeof o.hook === "string" && OS_SHEET_HOOK_RE.test(o.hook) ? o.hook : null,
      pushedAt: millisOf(o.pushedAt),
      seenAt: millisOf(o.seenAt),
      pulledAt: millisOf(o.pulledAt),
      pending: Math.max(0, Number(o.pending) || 0),
      checkedAt: now,
    },
    edits,
    needFull: false,
  };
}

/** Адрес веб-приложения Apps Script — тот же шаблон, что проверяет база. */
export const OS_SHEET_HOOK_RE = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{10,200}\/exec$/;

// ---------------------------------------------------------------------------
// Ячейки.

export function rowAt(tab: OsSheetTab, r: number): OsSheetRow {
  return tab.rows[r] ?? EMPTY_ROW;
}

export function styleOf(tab: OsSheetTab, r: number, c: number): SheetStyle {
  const key = tab.rows[r]?.styles[c];
  return key ? (tab.meta.palette[key] ?? OS_PLAIN_STYLE) : OS_PLAIN_STYLE;
}

export function isFormulaCell(tab: OsSheetTab, r: number, c: number): boolean {
  return Boolean(tab.rows[r]?.fx.includes(c));
}

/** Можно ли править ячейку в Nova: не шапка, не формула, в пределах листа. */
export function isEditableCell(tab: OsSheetTab, r: number, c: number): boolean {
  return r >= tab.meta.hdr && r < tab.meta.n && c >= 0 && c < tab.meta.cols.length && !isFormulaCell(tab, r, c);
}

/** Подпись столбца — текст последней строки шапки. */
export function columnTitle(tab: OsSheetTab, c: number): string {
  const r = tab.meta.hdr - 1;
  return (r >= 0 ? tab.rows[r]?.cells[c] : "")?.trim() || columnLetter(c);
}

export function columnLetter(n: number): string {
  let s = "";
  let x = n + 1;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

/** Сравнение ключей как в скрипте: регистр, пробелы (в том числе неразрывные) и апострофы не важны. */
export function normalizeForKey(v: string): string {
  return v.toLowerCase().replace(/[\s  ']/g, "");
}

/** Ключ строки для правки: столбцы-ключ листа без самого правимого столбца. */
export function rowKeyOf(tab: OsSheetTab, r: number, valueAt: (r: number, c: number) => string, exceptCol?: number): Array<[number, string]> {
  return tab.meta.key.filter((c) => c !== exceptCol).map((c) => [c, valueAt(r, c)]);
}

// ---------------------------------------------------------------------------
// Проверка значения до очереди — те же правила, что у скрипта (он решает
// окончательно: тип ячейки в таблице важнее типа столбца).

export type OsValueCheck = { ok: true; value: string } | { ok: false; reason: string };

const NUMBER_RE = /^-?\d+(\.\d+)?%?$/;

export function parseLooseSheetNumber(v: string): number | null {
  const s = v.replace(/[\s  '₸$€₽]/g, "").replace(",", ".");
  if (!NUMBER_RE.test(s)) return null;
  const n = Number(s.replace("%", ""));
  if (!Number.isFinite(n)) return null;
  return s.endsWith("%") ? n / 100 : n;
}

/** «1.10.2026», «01/10/26», «2026-10-01» → «01.10.2026»; не дата — null. */
export function normalizeSheetDate(v: string): string | null {
  const s = v.trim();
  let d: number;
  let m: number;
  let y: number;
  let match = /^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})$/.exec(s);
  if (match) {
    d = Number(match[1]);
    m = Number(match[2]);
    y = Number(match[3]);
    if (match[3].length === 2) y += 2000;
  } else if ((match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) {
    y = Number(match[1]);
    m = Number(match[2]);
    d = Number(match[3]);
  } else {
    return null;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}.${y}`;
}

const TRUE_WORDS = new Set(["true", "да", "1", "истина", "yes", "✓"]);
const FALSE_WORDS = new Set(["false", "нет", "0", "ложь", "no", ""]);

export function checkOsSheetValue(col: OsSheetCol | undefined, raw: string): OsValueCheck {
  const v = raw.trim();
  if (v.length > 2000) return { ok: false, reason: "too long" };
  if (!col || v === "") return { ok: true, value: v };
  switch (col.kind) {
    case "l": {
      const hit = col.options.find((o) => o.trim().toLowerCase() === v.toLowerCase());
      if (hit) return { ok: true, value: hit };
      return col.allowInvalid || col.options.length === 0 ? { ok: true, value: v } : { ok: false, reason: "not in list" };
    }
    case "n":
      return parseLooseSheetNumber(v) === null ? { ok: false, reason: "bad number" } : { ok: true, value: v };
    case "d": {
      const date = normalizeSheetDate(v);
      return date ? { ok: true, value: date } : { ok: false, reason: "bad date" };
    }
    case "b": {
      const w = v.toLowerCase();
      if (TRUE_WORDS.has(w)) return { ok: true, value: "TRUE" };
      if (FALSE_WORDS.has(w)) return { ok: true, value: "FALSE" };
      return { ok: false, reason: "bad value" };
    }
    default:
      return { ok: true, value: v };
  }
}

export function isCheckedText(v: string): boolean {
  return TRUE_WORDS.has(v.trim().toLowerCase());
}

/** Причина отказа скрипта или базы — по-человечески. */
export function osEditReasonText(reason: string | null | undefined): string {
  const r = reason ?? "";
  if (r === "moved") return "строка в таблице сдвинулась или изменилась — проверьте и повторите";
  if (r === "formula") return "это ячейка с формулой — она считается в таблице сама";
  if (r === "not in list") return "такого варианта нет в списке";
  if (r === "bad number") return "нужно число";
  if (r === "bad date") return "нужна дата ДД.ММ.ГГГГ";
  if (r === "bad value") return "недопустимое значение";
  if (r === "no tab") return "лист не найден в таблице";
  if (r === "timeout") return "таблица не ответила за сутки";
  if (r === "other sheet") return "Owner подключил другую таблицу";
  if (r === "too long") return "слишком длинный текст";
  if (r.startsWith("error:")) return `таблица ответила ошибкой (${r.slice(6).trim().slice(0, 120)})`;
  return r || "не применилось";
}

// ---------------------------------------------------------------------------
// Сетка: видимые столбцы и строки, объединения.

export interface OsGridCell {
  col: number;
  rowSpan: number;
  colSpan: number;
}

export interface OsSheetLayout {
  cols: Array<{ col: number; width: number }>;
  /** Видимые строки листа по порядку. */
  rows: number[];
  frozenRows: number;
  frozenCols: number;
  /** Левая верхняя ячейка объединения → размах; закрытые объединением ячейки — `covered`. */
  spans: Map<string, { rowSpan: number; colSpan: number }>;
  covered: Set<string>;
}

export function buildOsSheetLayout(tab: OsSheetTab): OsSheetLayout {
  const { meta } = tab;
  const hiddenRows = new Set(meta.hiddenRows);
  const hiddenCols = new Set(meta.hiddenCols);
  const cols: Array<{ col: number; width: number }> = [];
  for (let c = 0; c < meta.cols.length; c++) if (!hiddenCols.has(c)) cols.push({ col: c, width: meta.widths[c] ?? DEFAULT_WIDTH });
  const rows: number[] = [];
  for (let r = 0; r < meta.n; r++) if (!hiddenRows.has(r)) rows.push(r);
  const spans = new Map<string, { rowSpan: number; colSpan: number }>();
  const covered = new Set<string>();
  const taken = new Set<string>();
  for (const [r, c, rs, cs] of meta.merges) {
    if (hiddenRows.has(r) || hiddenCols.has(c)) continue;
    const keys: string[] = [];
    for (let i = r; i < r + rs; i++) for (let j = c; j < c + cs; j++) keys.push(`${i}:${j}`);
    if (keys.some((k) => taken.has(k))) continue;
    let rowSpan = 0;
    for (let i = r; i < r + rs; i++) if (!hiddenRows.has(i)) rowSpan++;
    let colSpan = 0;
    for (let j = c; j < c + cs; j++) if (!hiddenCols.has(j)) colSpan++;
    spans.set(`${r}:${c}`, { rowSpan, colSpan });
    for (const k of keys) {
      taken.add(k);
      if (k !== `${r}:${c}`) covered.add(k);
    }
  }
  return {
    cols,
    rows,
    frozenRows: rows.filter((r) => r < Math.max(meta.frozenRows, meta.hdr)).length,
    frozenCols: cols.filter((c) => c.col < meta.frozenCols).length,
    spans,
    covered,
  };
}
