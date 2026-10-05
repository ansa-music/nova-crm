import { isBlankRow } from "@/utils/blankRow";
import { parseLooseNumber } from "@/utils/numberInput";
import { resolveOsDeskKeys } from "@/utils/osDeskKeys";
import { OS_RELEASED_FROM_KEY } from "@/utils/reservedCellKeys";
import type { OsFieldKeys, PageColumn, PageRow, Role, WorkspacePage } from "@/types";

/**
 * Авто-передача ОС (просьба Nurba 05.10.2026): технарь, который заполняет
 * свой стол сам («Заполняет сам»), правит таблицу — и заказ сам появляется у
 * ОС, без кнопки «Передать ОС». Пишет в стол ОС только база
 * (`rows_tech_sync`, SQL 20261045); здесь — чистые решения клиента: какие
 * строки вообще стоит слать и что не слать повторно.
 *
 * Модуль чистый (без React, Firebase и Supabase) — гоняется в esbuild-риге.
 */

/** Не больше стольких строк в одном вызове `rows_tech_sync` (база отклонит 51-ю). */
export const TECH_SYNC_MAX_ITEMS = 50;
/** Отказы, которые могут пройти сами (ОС открыл стол, закрепили ник) — спросим снова. */
export const TECH_SYNC_RETRY_MS = 2 * 60_000;

/** Ключ стола в очереди и памяти: вкладка '' — «Основная». */
export function techDeskKey(workspaceId: string, pageId: string, tab: string | null | undefined): string {
  return `${workspaceId}|${pageId}|${tab ?? ""}`;
}

type ScopeWorkspace = { techFillsAll?: boolean } | null | undefined;
type ScopePage = Pick<WorkspacePage, "osDesk" | "techEditable" | "responsibleUserId" | "isDashboard"> | null | undefined;

/**
 * Стол «Заполняет сам»: режим «Технари заполняют сами» у всех или переключатель
 * у этого стола — тот же предикат, что `rows_tech_fills` в базе. Стол ОС,
 * дашборд и стол без ответственного не в счёт: база ответит им `out_of_scope`.
 */
export function techFillsDesk(page: ScopePage, workspace: ScopeWorkspace): boolean {
  return Boolean(
    page &&
      !page.osDesk &&
      !page.isDashboard &&
      page.responsibleUserId &&
      (workspace?.techFillsAll || page.techEditable)
  );
}

/** Вкладка текущего периода стола (как `currentMonthSubPageId`), null — автопилот до неё не дошёл. */
export function periodTabOf(
  page: Pick<WorkspacePage, "autoMonthKey" | "autoMonthSubPageId"> | null | undefined,
  periodKey: string | null | undefined
): string | null {
  return page && periodKey && page.autoMonthKey === periodKey && page.autoMonthSubPageId ? page.autoMonthSubPageId : null;
}

/** Строку уже ведёт ОС: метка и адрес источника на его столе. */
export function techRowLinked(row: Pick<PageRow, "osUid" | "srcRowId">): boolean {
  return Boolean(row.osUid && row.srcRowId);
}

function cellOf(row: Pick<PageRow, "cells">, key: string | null | undefined): string {
  if (!key) return "";
  const value = row.cells?.[key];
  return value === null || value === undefined ? "" : String(value).trim();
}

/** JSON с ключами по алфавиту: локальный объект и ответ базы дают одну строку. */
function stableJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Карта столбцов стола годится для этой вкладки (ключи у вкладок разные). */
export function techKeysFor(
  page: Pick<WorkspacePage, "osFieldKeys"> | null | undefined,
  tabId: string
): OsFieldKeys | null {
  const keys = page?.osFieldKeys;
  return keys && keys.tabId === tabId ? keys : null;
}

/** Ключ статуса строки: у ведомой ОС строки он записан на ней самой. */
export function techStatusKeyOf(row: Pick<PageRow, "statusKey">, keys: OsFieldKeys | null | undefined): string | null {
  return row.statusKey || keys?.status || null;
}

/**
 * Касается ли правка ведомой ОС строки того, что видит ОС: статус — в любой
 * вкладке; клиент, номер, ссылка, сумма, ячейка ОС и визитка — только во
 * вкладке, для которой у стола есть карта столбцов (в остальных база везёт
 * один статус). Свою ссылку и примечание технаря ОС не получает вовсе.
 */
export function techEditTouchesOs(
  row: Pick<PageRow, "statusKey">,
  keys: OsFieldKeys | null | undefined,
  cellKeys: readonly string[],
  extras: boolean
): boolean {
  if (extras && keys) return true;
  const watched = new Set<string>();
  const status = techStatusKeyOf(row, keys);
  if (status) watched.add(status);
  for (const key of [keys?.os, keys?.client, keys?.phone, keys?.link, keys?.price]) if (key) watched.add(key);
  return cellKeys.some((key) => watched.has(key));
}

/**
 * Отпечаток строки — то, от чего зависит ответ базы: метка ОС, статус, ячейка
 * ОС, клиент / номер / ссылка / сумма и визитка. Пока он не сменился, строку
 * повторно не шлём (правка примечания или своей ссылки ОС не касается).
 */
export function techSyncFingerprint(
  row: Pick<PageRow, "cells" | "osUid" | "statusKey" | "extras">,
  keys: OsFieldKeys | null | undefined
): string {
  return JSON.stringify([
    row.osUid ?? "",
    cellOf(row, techStatusKeyOf(row, keys)),
    cellOf(row, keys?.os),
    cellOf(row, keys?.client),
    cellOf(row, keys?.phone),
    cellOf(row, keys?.link),
    cellOf(row, keys?.price),
    stableJson(row.extras ?? null),
  ]);
}

/**
 * Почему строка не ушла — локальные причины (те же проверки и в том же
 * порядке, что в `rows_tech_sync`, чтобы не гонять заведомый отказ) и
 * служебные: `same` — ответ на этот отпечаток уже есть, `linked` — строку уже
 * ведёт ОС и слать нечего.
 */
export type TechSyncSkip =
  | "blank"
  | "owner_only"
  | "no_keys"
  | "period_mismatch"
  | "released"
  | "no_os"
  | "no_client"
  | "no_os_member"
  | "nick_ambiguous"
  | "same"
  | "linked";

/** Ответ базы на строку: с каким отпечатком и когда. */
export interface TechSyncAck {
  fp: string;
  code: string;
  at: number;
}

/**
 * Проходят сами: у ОС появился стол или вкладка, технарю закрепили ник, сменился
 * период; `busy` — источник был занят чужой записью, `error` — сбой базы на
 * этой строке (остальные строки пачки он не задел).
 */
const RETRYABLE_CODES = new Set(["no_os_desk", "no_os_map", "no_tech_nick", "no_core", "period_mismatch", "busy", "error"]);

/** Отказ может пройти сам — через `TECH_SYNC_RETRY_MS` спросим снова. */
export function isRetryableTechCode(code: string): boolean {
  return RETRYABLE_CODES.has(code);
}

/** Ответ ещё в силе: строка та же, и это не отказ, который пора переспросить. */
export function techAckFresh(ack: TechSyncAck | undefined, fp: string, now: number): boolean {
  if (!ack || ack.fp !== fp) return false;
  return !(isRetryableTechCode(ack.code) && now - ack.at >= TECH_SYNC_RETRY_MS);
}

export interface TechPlanMember {
  uid: string;
  role: Role;
  extraRoles?: readonly Role[] | null;
  status?: string;
  osNickValue?: string | null;
}

export interface TechPlanContext {
  page: Pick<WorkspacePage, "osFieldKeys" | "ownerOnly">;
  /** Вкладка строк ('' — «Основная»). */
  tabId: string;
  /** Вкладка текущего периода этого стола (`periodTabOf`). */
  periodTabId: string | null;
  members: readonly TechPlanMember[];
}

function hasOsRole(member: TechPlanMember): boolean {
  return member.role === "os" || Boolean(member.extraRoles?.includes("os"));
}

/** Ник ОС, который сейчас ведёт строку (по участникам), или null — не знаем. */
function linkedOsNick(row: Pick<PageRow, "osUid">, members: readonly TechPlanMember[]): string | null {
  if (!row.osUid) return null;
  const nick = members.find((m) => m.uid === row.osUid)?.osNickValue;
  return nick ? nick : null;
}

/**
 * Локальная причина, по которой НЕсвязанную строку база не примет. null —
 * слать можно. Порядок — как в базе: первая сработавшая проверка и есть ответ.
 */
export function techUnlinkedBlock(row: PageRow, ctx: TechPlanContext): TechSyncSkip | null {
  if (isBlankRow(row)) return "blank";
  // Стол «только для Owner»: сама не уходит ни одна строка, Owner тоже — «Передать ОС».
  if (ctx.page.ownerOnly) return "owner_only";
  const keys = techKeysFor(ctx.page, ctx.tabId);
  if (!keys || !keys.os || !keys.status || !keys.client) return "no_keys";
  if (!ctx.periodTabId || ctx.periodTabId !== ctx.tabId) return "period_mismatch";
  // Копия заказа ОС, который Owner вернул технарю («Вернуть»).
  if (row.id.startsWith("os_")) return "released";
  const os = cellOf(row, keys.os);
  if (!os) return "no_os";
  if (!cellOf(row, keys.client)) return "no_client";
  if (cellOf(row, OS_RELEASED_FROM_KEY) === os) return "released";
  const holders = ctx.members.filter((m) => m.uid && m.status === "active" && hasOsRole(m) && m.osNickValue === os);
  if (holders.length === 0) return "no_os_member";
  if (holders.length > 1) return "nick_ambiguous";
  return null;
}

/**
 * Связанную строку есть смысл слать, только когда ячейку ОС поменяли (другой
 * ник или пусто): база перевесит заказ, пока ОС его не тронул. Статус и поля
 * возит триггер базы в той же записи.
 */
export function techOsCellMoved(row: PageRow, ctx: TechPlanContext): boolean {
  const keys = techKeysFor(ctx.page, ctx.tabId);
  if (!keys?.os) return false;
  const nick = linkedOsNick(row, ctx.members);
  return nick !== null && cellOf(row, keys.os) !== nick;
}

export interface TechPlanInput extends TechPlanContext {
  rows: readonly PageRow[];
  /** Что база уже ответила по строкам этого стола. */
  acked: ReadonlyMap<string, TechSyncAck>;
  /** Строки, которые эта вкладка только что правила сама. */
  dirty?: ReadonlySet<string>;
  /** Строки, у которых статус разошёлся со столом ОС (`rows_tech_sync_scan`). */
  drift?: ReadonlySet<string>;
  /** Смотреть только эти строки. */
  only?: ReadonlySet<string>;
  now: number;
  /** Сколько строк взять (по умолчанию `TECH_SYNC_MAX_ITEMS`). */
  limit?: number;
}

export interface TechPlanResult {
  items: { row: string }[];
  /** Отпечатки отобранных строк — их запоминают вместе с ответом базы. */
  fingerprints: Map<string, string>;
  skipped: Map<string, TechSyncSkip>;
  /** Годных строк больше лимита — остальные в следующий заход. */
  more: boolean;
}

/**
 * Какие строки слать в `rows_tech_sync`.
 *
 * Несвязанная строка — кандидат, если прошла локальные проверки
 * (`techUnlinkedBlock`) и на её нынешний отпечаток ещё нет ответа.
 * Связанная — только по поводу: её правили здесь (`dirty`), у неё разошёлся
 * статус (`drift`) или сменили ячейку ОС; и тоже не чаще раза на отпечаток.
 */
export function planTechItems(input: TechPlanInput): TechPlanResult {
  const limit = input.limit ?? TECH_SYNC_MAX_ITEMS;
  const keys = techKeysFor(input.page, input.tabId);
  const items: { row: string }[] = [];
  const fingerprints = new Map<string, string>();
  const skipped = new Map<string, TechSyncSkip>();
  let more = false;
  for (const row of input.rows) {
    if (input.only && !input.only.has(row.id)) continue;
    if (techRowLinked(row)) {
      const wanted = Boolean(input.drift?.has(row.id) || input.dirty?.has(row.id) || techOsCellMoved(row, input));
      if (!wanted) {
        skipped.set(row.id, "linked");
        continue;
      }
    } else {
      const block = techUnlinkedBlock(row, input);
      if (block) {
        skipped.set(row.id, block);
        continue;
      }
    }
    const fp = techSyncFingerprint(row, keys);
    if (techAckFresh(input.acked.get(row.id), fp, input.now)) {
      skipped.set(row.id, "same");
      continue;
    }
    if (items.length >= limit) {
      more = true;
      continue;
    }
    items.push({ row: row.id });
    fingerprints.set(row.id, fp);
  }
  return { items, fingerprints, skipped, more };
}

/** Девять ключей стола ОС, которые база и сайт обязаны читать одинаково. */
export const OS_KEYS_COMPARED = ["client", "phone", "price", "upsell", "note", "link", "status", "technician", "total"] as const;

/**
 * Самопроверка Owner: ключи стола ОС, как их вывела база (`rows_os_cols_keys`),
 * против `resolveOsDeskKeys` по тем же столбцам. Возвращает разошедшиеся роли
 * (пусто — совпало). Разошлись — авто-передачу включать нельзя: база писала бы
 * заказ не в те ячейки, а проход стола ОС потом снял бы его у технаря.
 */
export function compareOsDeskKeys(
  sqlKeys: Record<string, unknown> | null | undefined,
  columns: readonly PageColumn[] | null | undefined
): string[] {
  const js = resolveOsDeskKeys(columns);
  return OS_KEYS_COMPARED.filter((key) => {
    const fromSql = sqlKeys?.[key];
    return typeof fromSql !== "string" || fromSql !== js[key];
  });
}

/** Два денежных значения равны с точностью до копейки (как в базе: |a − b| < 0.011). */
export function sameMoneyText(a: string | number | null | undefined, b: string | number | null | undefined): boolean {
  const left = a === null || a === undefined ? "" : String(a).trim();
  const right = b === null || b === undefined ? "" : String(b).trim();
  if (left === right) return true;
  const x = left ? parseLooseNumber(left) : 0;
  const y = right ? parseLooseNumber(right) : 0;
  if (x === null || y === null) return false;
  return Math.abs(x - y) < 0.011;
}
