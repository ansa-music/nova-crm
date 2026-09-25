/**
 * Диагностика стола — скрытая, включается адресом `?diag=table` (и живёт до
 * закрытия вкладки, sessionStorage), выключается `?diag=off` или кнопкой в
 * самой плашке. Нужна для жалоб, которые на стенде не повторяются («таблица
 * дрожит» 25.09.2026): человек открывает стол с `?diag=table`, ждёт 10 с и
 * присылает то, что скопировала кнопка «Скопировать». В базу ничего не пишет.
 *
 * Выключенная — один `if` на вызов: счётчики стоят в горячих местах (рендер
 * стола, приход строк), и в обычной работе они не должны стоить ничего.
 */

const FLAG_KEY = "nova:diag-table";
const MAX_EVENTS = 4000;

export interface DiagEvent {
  name: string;
  at: number;
  detail?: string;
}

let enabled = readFlag();
const events: DiagEvent[] = [];
const listeners = new Set<() => void>();

function readFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const param = new URLSearchParams(window.location.search).get("diag");
    if (param === "table") window.sessionStorage.setItem(FLAG_KEY, "1");
    if (param === "off") window.sessionStorage.removeItem(FLAG_KEY);
    return window.sessionStorage.getItem(FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

export function isTableDiagEnabled(): boolean {
  return enabled;
}

/** Адрес с `?diag=` пришёл уже в открытой вкладке (переход внутри сайта). */
export function syncTableDiagFlag(param: string | null) {
  if (param !== "table" && param !== "off") return;
  const next = param === "table";
  try {
    if (next) window.sessionStorage.setItem(FLAG_KEY, "1");
    else window.sessionStorage.removeItem(FLAG_KEY);
  } catch {
    /* без sessionStorage — только на эту загрузку */
  }
  if (next === enabled) return;
  enabled = next;
  events.length = 0;
  listeners.forEach((fn) => fn());
}

export function disableTableDiag() {
  syncTableDiagFlag("off");
}

export function subscribeTableDiag(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function tableDiagEnabledSnapshot(): boolean {
  return enabled;
}

/** Отметить событие. Выключенная диагностика — ничего не делает. */
export function diag(name: string, detail?: string) {
  if (!enabled) return;
  events.push({ name, at: Date.now(), detail: detail ? detail.slice(0, 160) : undefined });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

export function clearTableDiag() {
  events.length = 0;
}

export interface DiagSummary {
  name: string;
  count: number;
  /** Последние подробности (до трёх, самые свежие последними). */
  details: string[];
}

/** Счётчики за последние `windowMs`, самые частые — первыми. */
export function summarizeTableDiag(windowMs: number, now = Date.now()): DiagSummary[] {
  const from = now - windowMs;
  const byName = new Map<string, DiagSummary>();
  for (const event of events) {
    if (event.at < from) continue;
    const entry = byName.get(event.name) ?? { name: event.name, count: 0, details: [] };
    entry.count += 1;
    if (event.detail) {
      entry.details.push(event.detail);
      if (entry.details.length > 3) entry.details.shift();
    }
    byName.set(event.name, entry);
  }
  return [...byName.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
