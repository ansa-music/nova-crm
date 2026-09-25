import { DESK_ROWS_TABLE, supabaseRows } from "@/lib/supabaseRows";
import { recordToRow, sbSetOrder } from "@/services/rows/supabaseRowStore";
import { ringRowsDoorbell } from "@/services/rows/rowsDoorbell";
import { findTechTarget, mirrorRowId, techUidByNick } from "@/services/rows/osOrderMirror";
import { currentMonthSubPageId } from "@/services/monthTabService";
import { isSbMissingError } from "@/services/sb/sbCollections";
import { OS_LOST_FOR_KEY, OS_RELEASED_FROM_KEY } from "@/utils/reservedCellKeys";
import type { OsFieldKeys, PageRow, WorkspaceMember, WorkspacePage } from "@/types";

/**
 * Заказ, записанный ЛЮБЫМ человеком у себя в столе с ником ОС в столбце
 * «Ответственный», сам приезжает на стол этого ОС (жалоба Nurba 24.09.2026:
 * «если пользователь напишет в странице и поставит ОС ответственным — у ОС
 * тоже должно появиться»).
 *
 * Связать такую строку со столом ОС может только сам ОС (или Owner переносом
 * `osOrderAdoption`): технарю база не даёт поставить чужой `os_uid`, а ОС —
 * править строку, которая ещё не его. Поэтому ОС ЗАБИРАЕТ заказ функцией
 * базы (SQL 20261002): `rows_os_claimable` — что можно забрать (ник ОС именно
 * в столбце ОС этой вкладки — ключ база берёт из своей копии карты столбцов
 * стола, `rows_page_acl.os_key`), `rows_os_claim_order` — строка-источник на
 * столе ОС и метка на строке технаря одной транзакцией. Дальше заказ живёт
 * как любой заказ ОС: статус и поля ведёт проход стола ОС.
 *
 * Пока SQL не вставлен (функции нет: PGRST202/42883), всё молча выключено —
 * хук спросит снова через 10 минут.
 */

/** Стол ОС открыли — хук забора проверяет сразу, не дожидаясь двух минут. */
export const OS_CLAIM_KICK_EVENT = "nova:os-claim-kick";
/** Забрали заказы — стол ОС перечитывает свои заказы (`useMyOrderRows`). */
export const OS_CLAIMED_EVENT = "nova:os-claimed";

/** В базе ещё нет функций забора — SQL 20261002 не вставлен. */
export class ClaimUnsupportedError extends Error {
  constructor() {
    super("В базе строк ещё нет функций забора заказов — нужен свежий SQL");
  }
}

function missingFunction(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "42883" || isSbMissingError(error);
}

/** Строка, которую ОС может забрать (ответ `rows_os_claimable`). */
export interface ClaimCandidate {
  row: PageRow;
  pageId: string;
  /** '' — «Основная». */
  tabId: string;
  /** Номер правки строки: база сверит его при заборе (null — не сверять). */
  rev: number | null;
  /** Ответственный за стол — по копии прав. */
  techUid: string | null;
  /** Ключ столбца ОС и статуса — из копии карты столбцов в базе. */
  osKey: string | null;
  statusKey: string | null;
}

type RawRecord = Parameters<typeof recordToRow>[0] & { rev?: number | null };

/** Элемент ответа `setof jsonb` — PostgREST отдаёт его как есть или обёрнутым именем функции. */
function unwrapItem(item: unknown): Record<string, unknown> | null {
  let value = item;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const wrapped = (value as Record<string, unknown>).rows_os_claimable;
  if (wrapped !== undefined) return unwrapItem(wrapped);
  return value as Record<string, unknown>;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/** Разбор ответа `rows_os_claimable` — осторожно: формат `setof jsonb` на живом сервере не сверяли. */
export function parseClaimable(data: unknown): ClaimCandidate[] {
  const list = Array.isArray(data) ? data : data ? [data] : [];
  const out: ClaimCandidate[] = [];
  for (const raw of list) {
    const item = unwrapItem(raw);
    const record = item?.row as RawRecord | undefined;
    if (!item || !record || typeof record !== "object" || !record.id || !record.page_id) continue;
    const row = recordToRow(record);
    const rev = Number(record.rev);
    out.push({
      row,
      pageId: record.page_id,
      tabId: record.tab_id ?? "",
      rev: record.rev != null && Number.isFinite(rev) ? rev : null,
      techUid: str(item.techUid),
      osKey: str(item.osKey),
      statusKey: str(item.statusKey),
    });
  }
  return out;
}

/** Что ОС может забрать сейчас — один запрос на весь workspace. */
export async function sbFetchOsClaimable(workspaceId: string, limit = 200): Promise<ClaimCandidate[]> {
  const { data, error } = await supabaseRows.rpc("rows_os_claimable", { p_workspace: workspaceId, p_limit: limit });
  if (error) {
    if (missingFunction(error)) throw new ClaimUnsupportedError();
    throw new Error(error.message || "Не удалось спросить заказы с ником ОС");
  }
  return parseClaimable(data);
}

export type ClaimStatus =
  | "claimed"
  | "already"
  | "taken"
  | "gone"
  | "stale"
  | "not_mine"
  /** Строка с биржи — так отвечает только база без SQL 20261004 (там их уже забирают). */
  | "exchange"
  | "no_nick"
  | "no_keys"
  | "not_tech_desk"
  | "no_os_desk"
  | "src_conflict"
  /** Owner вернул эту строку технарю («Правка столов» → «Вернуть») — снова не забираем. */
  | "released"
  | "unknown";

export interface ClaimResult {
  status: ClaimStatus;
  srcPageId?: string;
  srcTabId?: string;
  srcRowId?: string;
  techUid?: string;
}

export interface ClaimOrderInput {
  workspaceId: string;
  /** Строка технаря. */
  pageId: string;
  tabId: string;
  rowId: string;
  expectRev: number | null;
  /** Вкладка стола ОС (null / '' — «Основная»). */
  srcTabId: string | null;
  cells: Record<string, string>;
  extras: PageRow["extras"] | null;
  syncHash: string;
  orderAt: number;
  /**
   * Ключ «Статуса» на столе ОС: не «status» — ляжет в `status_key`
   * строки-источника (по нему база везёт статус ОС в копию технаря).
   */
  srcStatusKey?: string | null;
}

const CLAIM_STATUSES = new Set<ClaimStatus>([
  "claimed",
  "already",
  "taken",
  "gone",
  "stale",
  "not_mine",
  "exchange",
  "no_nick",
  "no_keys",
  "not_tech_desk",
  "no_os_desk",
  "src_conflict",
  "released",
]);

/**
 * Забрать заказ: строка-источник на своём столе ОС + метка на строке технаря —
 * одной транзакцией базы. Ожидаемые гонки (взяли, поменяли, удалили) —
 * статусом, а не исключением. Функция пишет мимо `optimistic`, поэтому звонок
 * столам — здесь (как `sbDropOrderRow`): у технаря строка тут же закрывается
 * замком, у ОС появляется заказ.
 */
export async function sbClaimOsOrder(input: ClaimOrderInput): Promise<ClaimResult> {
  const { data, error } = await supabaseRows.rpc("rows_os_claim_order", {
    p_workspace: input.workspaceId,
    p_page: input.pageId,
    p_tab: input.tabId ?? "",
    p_row: input.rowId,
    p_expect_rev: input.expectRev,
    p_src_tab: input.srcTabId ?? "",
    p_src_cells: input.cells,
    p_src_extras: input.extras ?? null,
    p_sync_hash: input.syncHash,
    p_order_at: input.orderAt || null,
    // Только когда ключ не «status»: иначе вызов совпадает и с функцией без
    // этого параметра (прототип разбора).
    ...(input.srcStatusKey && input.srcStatusKey !== "status" ? { p_src_status_key: input.srcStatusKey } : {}),
  });
  if (error) {
    if (missingFunction(error)) throw new ClaimUnsupportedError();
    throw new Error(error.message || "Не удалось забрать заказ");
  }
  const value = unwrapResult(data);
  const status = (CLAIM_STATUSES.has(value.status as ClaimStatus) ? value.status : "unknown") as ClaimStatus;
  const result: ClaimResult = {
    status,
    srcPageId: str(value.srcPageId) ?? undefined,
    srcTabId: typeof value.srcTabId === "string" ? value.srcTabId : undefined,
    srcRowId: str(value.srcRowId) ?? undefined,
    techUid: str(value.techUid) ?? undefined,
  };
  if (status === "claimed" || status === "already") {
    ringRowsDoorbell(input.workspaceId, input.pageId, input.tabId ?? "");
    if (result.srcPageId) ringRowsDoorbell(input.workspaceId, result.srcPageId, result.srcTabId ?? "");
  }
  return result;
}

function unwrapResult(data: unknown): Record<string, unknown> {
  let value = Array.isArray(data) ? data[0] : data;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  for (const name of ["rows_os_claim_order", "rows_os_release_claim"]) {
    if (record[name] && typeof record[name] === "object") return record[name] as Record<string, unknown>;
  }
  return record;
}

/**
 * Вернуть взятую строку технарю: снимается ровно метка заказа (и, если
 * `clearOs`, свой ник в столбце ОС — иначе строку тут же забрали бы снова).
 * Только строки, взятые со стола технаря (источник `adopt_…`); свои заказы
 * ОС убирает удалением копии, как раньше. Функции нет (SQL не вставлен) —
 * `"unsupported"`: сама функция строку не трогает, а проход стола ОС тогда
 * удаляет копию, как до забора (`useOsDeskDispatch`). `"not_claimed"` —
 * строка не взятая у технаря (её завёл ОС): её тоже удаляют.
 */
export async function sbReleaseOsClaim(
  workspaceId: string,
  pageId: string,
  tabId: string | null,
  rowId: string,
  clearOs: boolean
): Promise<"released" | "gone" | "not_claimed" | "unsupported" | "unknown"> {
  const { data, error } = await supabaseRows.rpc("rows_os_release_claim", {
    p_workspace: workspaceId,
    p_page: pageId,
    p_tab: tabId ?? "",
    p_row: rowId,
    p_clear_os: clearOs,
  });
  if (error) {
    if (missingFunction(error)) return "unsupported";
    throw new Error(error.message || "Не удалось вернуть строку технарю");
  }
  const status = String(unwrapResult(data).status ?? "");
  if (status === "released") {
    ringRowsDoorbell(workspaceId, pageId, tabId ?? "");
    return "released";
  }
  return status === "gone" || status === "not_claimed" ? status : "unknown";
}

/**
 * Свой открытый стол ОС — дочитать. Функция базы пишет мимо `optimistic`, а
 * свои «звонки» вкладка не слушает (rowsDoorbell: `from === instanceId`),
 * поэтому забранный заказ появился бы на открытом у ОС столе только с опросом
 * головы таблицы (до минуты) — после тоста «заказ на вашем столе». Пустой
 * `rows_set_order` в базе не меняет ничего, а открытая таблица после своей
 * «записи» дочитывает дельту (`settled` в supabaseRowStore). Стол не открыт —
 * просто крошечный запрос.
 */
export function nudgeOpenDesk(workspaceId: string, pageId: string, tabId: string | null): void {
  void sbSetOrder(workspaceId, pageId, tabId || null, []).catch(() => undefined);
}

/**
 * Копия — это исходная строка технаря, взятая ОС (перенос Owner или забор), а
 * не заведённая ОС. У источника `adopt_…` копия бывает и заведённой ОС: после
 * смены технаря, «снять → выдать снова», выдачи после потери и повтора
 * «копии нет — заводим» проход кладёт новому технарю строку `os_<источник>`
 * (`mirrorRowId`). Такую копию при удалении заказа удаляем, как раньше, а не
 * «возвращаем» — иначе у технаря остался бы заказ, которого он не писал.
 */
export function isClaimedOriginal(m: Pick<PageRow, "id" | "srcRowId">): boolean {
  return Boolean(m.srcRowId && m.srcRowId.startsWith("adopt_") && m.id !== mirrorRowId(m.srcRowId));
}

/**
 * На какой вкладке стола лежит строка с этим id (любой вкладке) — один запрос.
 * '' — «Основная», undefined — такой строки нет.
 */
export async function sbFindDeskRowTab(workspaceId: string, pageId: string, rowId: string): Promise<string | undefined> {
  const { data, error } = await supabaseRows
    .from(DESK_ROWS_TABLE)
    .select("tab_id")
    .eq("workspace_id", workspaceId)
    .eq("page_id", pageId)
    .eq("id", rowId)
    .limit(1);
  if (error) throw new Error(error.message || "Не удалось прочитать строку");
  const record = Array.isArray(data) ? (data[0] as { tab_id?: string | null } | undefined) : undefined;
  return record ? (record.tab_id ?? "") : undefined;
}

/**
 * Строки-источники на столе ОС, чей заказ ВЕРНУЛИ технарю («Правка столов» →
 * «Вернуть» / «вернуть все»): адрес копии снят, в `osLostFor` — ник технаря.
 * Такие строки у технаря остаются с ником ОС, но забирать их снова нельзя —
 * это решение Owner, а вернуть заказ ОС он может там же («Передать ОС»).
 * Возвращает id источников (`adopt_…`), которые так помечены.
 */
export async function sbFetchReturnedSources(
  workspaceId: string,
  osDeskPageId: string,
  srcIds: readonly string[]
): Promise<Set<string>> {
  const out = new Set<string>();
  if (srcIds.length === 0) return out;
  const { data, error } = await supabaseRows
    .from(DESK_ROWS_TABLE)
    .select(`id, mirror_row_id, lost:cells->>${OS_LOST_FOR_KEY}`)
    .eq("workspace_id", workspaceId)
    .eq("page_id", osDeskPageId)
    .in("id", [...new Set(srcIds)]);
  if (error) throw new Error(error.message || "Не удалось прочитать свой стол");
  for (const raw of (data ?? []) as Array<{ id?: string; mirror_row_id?: string | null; lost?: string | null }>) {
    if (raw.id && !raw.mirror_row_id && typeof raw.lost === "string" && raw.lost.trim()) out.add(raw.id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Что забирать в этот заход — чистая функция (проверки без базы).
// ---------------------------------------------------------------------------

/** Строка должна «отлежаться» (технарь дописывает её) — 3 минуты. */
export const CLAIM_QUIET_MS = 180_000;
/** Не больше стольких заборов за заход: остальное — в следующий. */
export const CLAIM_MAX_PER_RUN = 25;

/**
 * Память «эту версию строки я уже видел и с какого момента» — по ней одной
 * считается, что строка «отлежалась» (часы технаря могут и спешить, и отставать).
 */
export type ClaimSeenMemory = Map<string, { version: string; at: number }>;

export interface ClaimPick {
  candidate: ClaimCandidate;
  page: WorkspacePage;
  techUid: string;
  techNick: string;
  techKeys: OsFieldKeys;
  /** id строки-источника, какой её выведет база (`rows_claim_src_id`). */
  srcId: string;
}

export type ClaimSkipReason =
  | "desk"
  | "tab"
  | "keys"
  | "client"
  | "quiet"
  | "tech"
  | "target"
  | "returned";

export interface ClaimPickResult {
  ready: ClaimPick[];
  /** Готовых больше лимита — остались на следующий заход. */
  deferred: number;
  /** Через сколько мс «отлежится» ближайшая строка (null — ждать нечего). */
  waitMs: number | null;
  skipped: Partial<Record<ClaimSkipReason, number>>;
}

/** Id строки-источника для строки технаря — как `sourceRowIdFor` и `rows_claim_src_id`. */
export function claimSourceId(techRowId: string): string {
  return `adopt_${techRowId.replace(/[^A-Za-z0-9_-]/g, "")}`;
}

function cellOf(row: PageRow, key: string | undefined): string {
  if (!key) return "";
  const value = row.cells[key];
  return value === null || value === undefined ? "" : String(value).trim();
}

/**
 * Какие строки забирать. Строка годится, если:
 * - стол — живой стол технаря (не стол ОС, не дашборд, не «Неактуальный»);
 * - вкладка — ТЕКУЩЕГО месяца, и карта столбцов стола от неё же, а ключ ОС в
 *   карте тот же, что в копии базы (иначе проход стола ОС писал бы не туда);
 * - в строке есть клиент — иначе это ещё не заказ;
 * - строка «отлежалась» `quietMs`: эту же версию (rev) ЭТА сессия видит без
 *   изменений уже столько времени — по своим часам. Время правки строки
 *   (`updatedAt`) не годится: это часы устройства технаря, и отстающие на
 *   3 минуты часы делали только что начатую строку «старой» — ОС забирал её
 *   посреди набора, и следующая правка цены падала на замке. Цена — строка,
 *   давно лежащая у технаря, при первом взгляде тоже ждёт 3 минуты;
 * - у ответственного есть ник технаря, и ник ведёт на него же, а стол — тот,
 *   куда проход стола ОС сам положил бы заказ (иначе он «переехал» бы);
 * - это не строка, которую Owner вернул технарю (`os_…` — копия заказа ОС,
 *   `osReleasedFrom` на самой строке = ник ОС в ней, `returned` — источник
 *   помечен «забрали у технаря»).
 * `seen` дописывается: версия строки и когда её впервые увидели.
 */
export function pickClaims(input: {
  candidates: readonly ClaimCandidate[];
  pages: readonly WorkspacePage[];
  members: readonly WorkspaceMember[];
  monthKey: string;
  now: number;
  seen: ClaimSeenMemory;
  returned?: ReadonlySet<string>;
  quietMs?: number;
  limit?: number;
}): ClaimPickResult {
  const quietMs = input.quietMs ?? CLAIM_QUIET_MS;
  const limit = input.limit ?? CLAIM_MAX_PER_RUN;
  const skipped: ClaimPickResult["skipped"] = {};
  const skip = (reason: ClaimSkipReason) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };
  const ready: ClaimPick[] = [];
  let waitMs: number | null = null;
  const alive = new Set<string>();
  for (const candidate of input.candidates) {
    const { row } = candidate;
    const key = `${candidate.pageId}/${candidate.tabId}/${row.id}`;
    alive.add(key);
    const page = input.pages.find((p) => p.id === candidate.pageId);
    if (!page || page.inactive || page.osDesk || page.isDashboard || !page.responsibleUserId) {
      skip("desk");
      continue;
    }
    const monthTab = currentMonthSubPageId(page, input.monthKey);
    const keys = page.osFieldKeys;
    if (!monthTab || candidate.tabId !== monthTab || !keys || keys.tabId !== candidate.tabId) {
      skip("tab");
      continue;
    }
    if (!keys.os || keys.os !== candidate.osKey) {
      skip("keys");
      continue;
    }
    if (!cellOf(row, keys.client)) {
      skip("client");
      continue;
    }
    // Копия заказа, который вёл ОС, а Owner вернул технарю, — не забираем.
    // Метка на самой строке технаря (`osReleasedFrom`) держит решение Owner,
    // даже если ОС потом удалил свою строку-источник или выдал её другому.
    const releasedFrom = cellOf(row, OS_RELEASED_FROM_KEY);
    if (
      row.id.startsWith("os_") ||
      (releasedFrom && releasedFrom === cellOf(row, keys.os)) ||
      input.returned?.has(claimSourceId(row.id))
    ) {
      skip("returned");
      continue;
    }
    const version = candidate.rev != null ? `r${candidate.rev}` : `u${row.updatedAt}`;
    const prev = input.seen.get(key);
    const seenAt = prev && prev.version === version ? prev.at : input.now;
    if (!prev || prev.version !== version) input.seen.set(key, { version, at: input.now });
    // Только по своим часам и своему наблюдению (см. JSDoc).
    const quietLeft = quietMs - (input.now - seenAt);
    if (quietLeft > 0) {
      skip("quiet");
      waitMs = waitMs === null ? quietLeft : Math.min(waitMs, quietLeft);
      continue;
    }
    const techUid = page.responsibleUserId;
    if (candidate.techUid && candidate.techUid !== techUid) {
      skip("tech");
      continue;
    }
    const techNick = input.members.find((m) => m.uid === techUid)?.techNickValue ?? "";
    // Без ника технаря в столбце «Технарь» у ОС было бы пусто, и первый же
    // проход стола ОС снял бы заказ у технаря как «технаря стёрли».
    if (!techNick || techUidByNick(input.members, techNick) !== techUid) {
      skip("tech");
      continue;
    }
    if (findTechTarget(input.pages, techUid, page.id)?.page.id !== page.id) {
      skip("target");
      continue;
    }
    ready.push({ candidate, page, techUid, techNick, techKeys: keys, srcId: claimSourceId(row.id) });
  }
  // Память о строках, которых больше нет в ответе, не копим.
  for (const key of [...input.seen.keys()]) if (!alive.has(key)) input.seen.delete(key);
  const deferred = Math.max(0, ready.length - limit);
  return { ready: ready.slice(0, limit), deferred, waitMs, skipped };
}
