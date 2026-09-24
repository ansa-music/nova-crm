import { getDocFromServer, updateDoc } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { createOrder } from "@/services/orderService";
import { fetchRows, markRowOrder } from "@/services/pageService";
import { fetchSubPageRows } from "@/services/subPageService";
import {
  findTechTarget,
  pushOrderToTech,
  sbFetchRowById,
  techTargetProblem,
  type MirrorCopyRef,
} from "@/services/rows/osOrderMirror";
import { sbDeleteRow, sbPatchRow } from "@/services/rows/supabaseRowStore";
import { OS_DESK_KEYS, resolveOsDeskKeys, type OsDeskKeys } from "@/services/osDeskService";
import { findInProgressStatusOption, isApprovalStatusValue } from "@/utils/columnOptions";
import { osRowTotal } from "@/utils/payment";
import { OS_ISSUED_ON_KEY } from "@/utils/reservedCellKeys";
import type { PageRow, StatusOption, WorkOrder, WorkOrderUrgency, WorkspaceMember, WorkspacePage } from "@/types";

/**
 * «Общий» заказ со стола ОС — через биржу «Заказы».
 *
 * ОС поставил «В работе» и выбрал «Общий»: заказ выставляется на «Заказы»
 * всем технарям, они откликаются, ОС (или Тимлид/Owner) отдаёт его одному. А
 * дальше заказ приезжает к технарю ТАК ЖЕ, как выданный со стола напрямую, —
 * строкой-заказом с замком (её ведёт ОС), а не обычной строкой, которую
 * технарь правит сам. Поэтому технарь такой заказ сам не забирает
 * (useOrderAutoPickup его пропускает): его заводит сессия ОС —
 * `handOffExchangeOrder` из useOsExchangeHandoff.
 */

/**
 * Строки, которые прямо сейчас переносит с биржи сессия ОС: проход стола
 * (useOsDeskDispatch) не пишет их в журнал «Выдачи ОС» — это не выборочная
 * выдача, её и так видно на «Заказах».
 */
const handoffRows = new Set<string>();

export function isExchangeHandoffRow(rowId: string): boolean {
  return handoffRows.has(rowId);
}

function cell(row: PageRow, key: string): string {
  const v = row.cells[key];
  return v === null || v === undefined ? "" : String(v).trim();
}

export interface SendToExchangeInput {
  workspaceId: string;
  pageId: string;
  tabId: string | null;
  row: PageRow;
  me: { uid: string; name: string };
  osValue: string;
  osLabel: string;
  technicianUids: string[];
  statusOptions: readonly StatusOption[];
  /** Ключи ячеек открытой таблицы (resolveOsDeskKeys); нет — ключи по умолчанию. */
  keys?: OsDeskKeys;
  /** Срочность на «Заказах» (выдача со страницы «Заказы»); нет — «Нейтральный». */
  urgency?: WorkOrderUrgency;
}

/** Заказ строки уже висит на бирже — второй выставлять нельзя. */
export class AlreadyOnExchangeError extends Error {}

/** «Общий»: заказ со стола ОС уходит на биржу «Заказы». */
export async function sendOsRowToExchange(input: SendToExchangeInput): Promise<WorkOrder> {
  const { row } = input;
  // Выставляют ЗАНОВО (у строки уже был заказ) — сверяем прежний с сервером:
  // списки «что висит на бирже» у экрана могли ещё не дочитаться или прийти
  // из кэша, а два заказа на одну строку — два отклика и два технаря.
  if (row.orderId && db) {
    const prev = await getDocFromServer(paths.order(input.workspaceId, row.orderId)).catch(() => null);
    if (prev === null) throw new Error("Не удалось проверить прежний заказ на «Заказах» — проверьте связь и повторите");
    const status = prev.exists() ? (prev.data() as Partial<WorkOrder>).status : undefined;
    if (status === "open" || status === "assigned") {
      throw new AlreadyOnExchangeError("Этот заказ уже на «Заказах» — второй раз его не выставить");
    }
  }
  const k = input.keys ?? OS_DESK_KEYS;
  // Касса: за вычетом комиссии способов оплаты — та же сумма, что уедет технарю.
  const total = osRowTotal(row, k) ?? 0;
  const order = await createOrder({
    workspaceId: input.workspaceId,
    client: cell(row, k.client),
    phone: cell(row, k.phone),
    link: cell(row, k.link) || row.extras?.link || "",
    deadline: row.extras?.deadline ?? null,
    urgency: input.urgency ?? "normal",
    price: total > 0 ? total : null,
    persons: row.extras?.persons ?? null,
    minutes: row.extras?.minutes ?? null,
    note: cell(row, k.note) || row.extras?.note || "",
    osValue: input.osValue,
    osLabel: input.osLabel,
    createdBy: input.me.uid,
    createdByName: input.me.name,
    technicianUids: input.technicianUids.filter((uid) => uid !== input.me.uid),
    osSource: { pageId: input.pageId, tabId: input.tabId, rowId: row.id },
  });
  // Строка знает свой заказ на бирже: если ОС потом отдаст его сам, проход
  // закроет заказ на «Заказах», а не оставит технарей откликаться впустую.
  await markRowOrder(input.workspaceId, input.pageId, input.tabId, row.id, order.id);
  // «Утверждение» с заказа снимается: он уже в работе, просто ещё без технаря.
  if (isApprovalStatusValue(cell(row, k.status), input.statusOptions)) {
    const inProgress = findInProgressStatusOption([...input.statusOptions])?.value;
    if (inProgress) {
      await sbPatchRow(input.workspaceId, input.pageId, input.tabId, row.id, { cells: { [k.status]: inProgress } });
    }
  }
  return order;
}

export class HandoffProblem extends Error {}

export interface HandoffInput {
  workspaceId: string;
  order: WorkOrder;
  osUid: string;
  osNickValue: string;
  pages: readonly WorkspacePage[];
  members: readonly WorkspaceMember[];
  statusOptions: readonly StatusOption[];
}

/**
 * Заказ со стола ОС выдан на бирже — завести его технарю строкой-заказом.
 * Пишет СЕССИЯ ОС (у технаря нет права ставить на строку чужую метку ОС).
 * Повтор безопасен: id строки-копии выведен из строки-источника.
 */
export async function handOffExchangeOrder(input: HandoffInput): Promise<{ techName: string }> {
  const { order, workspaceId } = input;
  const src = order.osSource;
  if (!src || !order.assignedUid) throw new HandoffProblem("Заказ не со стола ОС");
  const tech = input.members.find((m) => m.uid === order.assignedUid && m.status === "active");
  const nick = tech?.techNickValue ?? "";
  if (!nick) throw new HandoffProblem(`У технаря ${order.assignedName ?? ""} нет ника — закрепите его на «Команде»`);
  const rows = src.tabId ? await fetchSubPageRows(workspaceId, src.pageId, src.tabId) : await fetchRows(workspaceId, src.pageId);
  const row = rows.find((r) => r.id === src.rowId);
  if (!row) throw new HandoffProblem("Строки этого заказа на вашем столе уже нет");

  const problem = techTargetProblem(input.pages, order.assignedUid, row.mirrorPageId);
  const target = findTechTarget(input.pages, order.assignedUid, row.mirrorPageId);
  if (problem || !target) throw new HandoffProblem(problem ?? "У технаря нет стола");
  // Ключи ячеек — от столбцов стола ОС (вкладки месяцев копируют их как есть).
  const k = resolveOsDeskKeys(input.pages.find((p) => p.id === src.pageId)?.columns);
  const TECH_KEY = k.technician;
  const STATUS_KEY = k.status;

  const current = cell(row, STATUS_KEY);
  const status = isApprovalStatusValue(current, input.statusOptions)
    ? (findInProgressStatusOption([...input.statusOptions])?.value ?? "")
    : current;

  handoffRows.add(row.id);
  try {
    // Заказ уже лежал у другого технаря (отдавали напрямую, потом выставили
    // на биржу) — убрать оттуда, иначе он висел бы у двоих.
    const keepAt = row.mirrorPageId === target.page.id ? row : null;
    // Дата выдачи, поставленная ОС прежнему технарю, к новому не относится.
    const movedFrom = Boolean(row.mirrorPageId && row.mirrorRowId && !keepAt);
    // Ник технаря — в строку ОС: у себя в таблице ОС видит, у кого заказ, и
    // дальше ведёт его как выданный напрямую (смена, снятие, статус).
    const cells: Record<string, string> = { [TECH_KEY]: nick, [STATUS_KEY]: status, ...(movedFrom ? { [OS_ISSUED_ON_KEY]: "" } : {}) };
    await sbPatchRow(workspaceId, src.pageId, src.tabId, row.id, { cells });
    const source: PageRow = { ...row, cells: { ...row.cells, ...cells } };

    if (row.mirrorPageId && row.mirrorRowId && !keepAt) {
      await sbDeleteRow(workspaceId, row.mirrorPageId, row.mirrorTabId || null, row.mirrorRowId);
    }
    // Копия у этого же технаря уже есть — её опорные поля и ключ статуса берём
    // с НЕЁ (страж базы отклоняет их смену). Не прочиталась — правка уйдёт без
    // опорных полей, база оставит их как есть.
    let copy: MirrorCopyRef | undefined;
    if (keepAt?.mirrorPageId && keepAt.mirrorRowId) {
      copy =
        (await sbFetchRowById(workspaceId, keepAt.mirrorPageId, keepAt.mirrorTabId || null, keepAt.mirrorRowId).catch(
          () => null
        )) ?? undefined;
    }
    const pushed = await pushOrderToTech({
      workspaceId,
      osUid: input.osUid,
      osNickValue: input.osNickValue,
      source,
      srcPageId: src.pageId,
      srcTabId: src.tabId,
      osColumns: { client: k.client, phone: k.phone, price: k.price, upsell: k.upsell, note: k.note, link: k.link },
      target,
      techUid: order.assignedUid,
      status,
      // Дата заказа — как у прохода стола ОС: max(createdAt, filledAt) —
      // слот могли завести заранее и заполнить через дни.
      dateMs: Math.max(row.createdAt || 0, row.filledAt || 0) || 0,
      mirrorRowId: keepAt?.mirrorRowId || undefined,
      mirrorTabId: keepAt ? keepAt.mirrorTabId || null : undefined,
      copy,
      osStatusKey: STATUS_KEY,
    });
    if (db) {
      const now = Date.now();
      await updateDoc(paths.order(workspaceId, order.id), {
        status: "taken",
        takenAt: now,
        takenPageId: target.page.id,
        takenSubPageId: keepAt ? keepAt.mirrorTabId || null : target.tabId,
        takenRowId: pushed.rowId,
        updatedAt: now,
      });
    }
  } finally {
    // Проход стола может прийти чуть позже записи — даём ему увидеть метку.
    setTimeout(() => handoffRows.delete(row.id), 10_000);
  }
  return { techName: order.assignedName ?? nick };
}
