import { deleteDoc, deleteField, onSnapshot, orderBy, query, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { generateId } from "@/utils/id";
import { normalizeTimestamp } from "@/utils/date";
import { buildQuickOrderRow } from "@/utils/quickOrder";
import { sendNotification } from "@/services/notificationService";
import { addRow, fetchRows, updateRowCellsBulk } from "@/services/pageService";
import { addSubPageRow, fetchSubPageRows, fetchSubPages, updateSubPageRowCellsBulk } from "@/services/subPageService";
import { findInProgressStatusOption, getColumnOptions } from "@/utils/columnOptions";
import { isBlankRow, isFilledCellValue } from "@/utils/blankRow";
import { currentMonthSubPageId, ensureMonthTab, isMonthlyDesk } from "@/services/monthTabService";
import type { PageColumn, WorkOrder, WorkOrderClaim, WorkOrderUrgency, Workspace, WorkspaceMember, WorkspacePage } from "@/types";

function mapOrder(data: Record<string, unknown>, id: string): WorkOrder {
  const row = { id, ...data } as WorkOrder;
  return {
    ...row,
    claims: row.claims ?? {},
    createdAt: normalizeTimestamp(row.createdAt),
    updatedAt: normalizeTimestamp(row.updatedAt),
  };
}

/** Живой список заказов workspace, новые сверху. Подписка живёт только пока открыта страница «Заказы». */
export function subscribeOrders(workspaceId: string, cb: (orders: WorkOrder[]) => void, onError?: (e: unknown) => void) {
  const q = query(paths.orders(workspaceId), orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => mapOrder(d.data(), d.id))),
    (error) => onError?.(error)
  );
}

export interface CreateOrderInput {
  workspaceId: string;
  client: string;
  phone: string;
  link: string;
  deadline: number | null;
  urgency: WorkOrderUrgency;
  price: number | null;
  persons: number | null;
  minutes: number | null;
  note: string;
  osValue: string;
  osLabel: string;
  createdBy: string;
  createdByName: string;
  /** Кого позвать: uid всех активных технарей. */
  technicianUids: string[];
}

export function orderSummary(order: Pick<WorkOrder, "client" | "minutes" | "persons">): string {
  const parts: string[] = [];
  if (order.minutes != null) parts.push(`${order.minutes} мин`);
  if (order.persons != null) parts.push(`${order.persons} перс`);
  return parts.length ? `${order.client} · ${parts.join(" · ")}` : order.client;
}

export async function createOrder(input: CreateOrderInput): Promise<WorkOrder> {
  if (!db) throw new Error("Firebase не настроен");
  const now = Date.now();
  const order: WorkOrder = {
    id: generateId("order"),
    workspaceId: input.workspaceId,
    client: input.client.trim(),
    phone: input.phone.trim(),
    link: input.link.trim(),
    deadline: input.deadline,
    urgency: input.urgency,
    price: input.price,
    persons: input.persons,
    minutes: input.minutes,
    note: input.note.trim(),
    osValue: input.osValue,
    osLabel: input.osLabel,
    createdBy: input.createdBy,
    createdByName: input.createdByName,
    status: "open",
    claims: {},
    assignedUid: null,
    assignedName: null,
    assignedAt: null,
    assignedBy: null,
    takenAt: null,
    takenPageId: null,
    takenSubPageId: null,
    takenRowId: null,
    cancelledAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await setDoc(paths.order(input.workspaceId, order.id), order);
  await sendNotification(
    {
      workspaceId: input.workspaceId,
      title: `Новый заказ: ${orderSummary(order)}`,
      body: "Откликнитесь на «Заказах», если готовы взять.",
      priority: "important",
      fromUid: input.createdBy,
      fromName: input.createdByName,
      target: "selected",
      href: "/orders",
    },
    input.technicianUids
  ).catch(() => {
    /* заказ уже записан */
  });
  return order;
}

/** Технар откликается (или снимает отклик). Меняется только свой ключ в `claims` — это и проверяет правило. */
export async function setOrderClaim(workspaceId: string, order: WorkOrder, me: { uid: string; name: string }, claim: boolean) {
  if (!db) throw new Error("Firebase не настроен");
  const value: WorkOrderClaim | ReturnType<typeof deleteField> = claim
    ? { uid: me.uid, name: me.name, at: Date.now() }
    : deleteField();
  await setDoc(paths.order(workspaceId, order.id), { claims: { [me.uid]: value }, updatedAt: Date.now() }, { merge: true });
  if (claim && order.createdBy !== me.uid) {
    await sendNotification(
      {
        workspaceId,
        title: `${me.name} готов взять заказ ${order.client}`,
        body: "Выдайте заказ ему или выберите другого технаря.",
        priority: "normal",
        fromUid: me.uid,
        fromName: me.name,
        target: "selected",
        href: "/orders",
      },
      [order.createdBy]
    ).catch(() => {});
  }
}

export interface OrderCandidate {
  uid: string;
  name: string;
  /** Есть ли у технаря стол — без стола заказ забрать некуда. */
  hasDesk: boolean;
  claimedAt: number | null;
}

/**
 * «Рандом»: среди откликнувшихся со столом, а если таких нет — среди всех
 * технарей со столом. Никогда не выбирает того, кому заказ некуда забрать.
 */
export function pickRandomCandidate(candidates: OrderCandidate[]): OrderCandidate | null {
  const withDesk = candidates.filter((c) => c.hasDesk);
  const claimed = withDesk.filter((c) => c.claimedAt != null);
  const pool = claimed.length > 0 ? claimed : withDesk;
  if (pool.length === 0) return null;
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return pool[bytes[0] % pool.length];
}

export async function assignOrder(input: {
  workspaceId: string;
  order: WorkOrder;
  technician: { uid: string; name: string };
  actorUid: string;
  actorName: string;
}) {
  if (!db) throw new Error("Firebase не настроен");
  const now = Date.now();
  await updateDoc(paths.order(input.workspaceId, input.order.id), {
    status: "assigned",
    assignedUid: input.technician.uid,
    assignedName: input.technician.name,
    assignedAt: now,
    assignedBy: input.actorUid,
    updatedAt: now,
  });
  await sendNotification(
    {
      workspaceId: input.workspaceId,
      title: `Вам выдан заказ: ${orderSummary(input.order)}`,
      body: "Заказ уже едет в ваш стол — строка появится подсвеченной.",
      priority: "urgent",
      fromUid: input.actorUid,
      fromName: input.actorName,
      target: "selected",
      href: "/orders",
    },
    [input.technician.uid]
  ).catch(() => {});
}

/** Вернуть выданный заказ в открытые (назначенный ещё не забрал). */
export async function unassignOrder(workspaceId: string, order: WorkOrder, actor: { uid: string; name: string }) {
  if (!db) throw new Error("Firebase не настроен");
  const now = Date.now();
  await updateDoc(paths.order(workspaceId, order.id), {
    status: "open",
    assignedUid: null,
    assignedName: null,
    assignedAt: null,
    assignedBy: null,
    updatedAt: now,
  });
  if (order.assignedUid && order.assignedUid !== actor.uid) {
    await sendNotification(
      {
        workspaceId,
        title: `Заказ ${order.client} отозван`,
        body: "Выдающий вернул его в открытые.",
        priority: "normal",
        fromUid: actor.uid,
        fromName: actor.name,
        target: "selected",
        href: "/orders",
      },
      [order.assignedUid]
    ).catch(() => {});
  }
}

export async function setOrderCancelled(workspaceId: string, order: WorkOrder, cancelled: boolean) {
  if (!db) throw new Error("Firebase не настроен");
  const now = Date.now();
  await updateDoc(paths.order(workspaceId, order.id), {
    status: cancelled ? "cancelled" : "open",
    cancelledAt: cancelled ? now : null,
    assignedUid: null,
    assignedName: null,
    assignedAt: null,
    assignedBy: null,
    updatedAt: now,
  });
}

export async function deleteOrder(workspaceId: string, orderId: string) {
  if (!db) throw new Error("Firebase не настроен");
  await deleteDoc(paths.order(workspaceId, orderId));
}

/**
 * Назначенный технар забирает заказ в свой стол: строка в текущую месячную
 * вкладку (или в основную таблицу, если стол не помесячный) с клиентом,
 * номером, ссылкой, ОС, персами и минутами — тем же подбором столбцов, что
 * и «Быстрый заказ» в столе. Пишется сессией технаря по его правам на стол.
 */
export async function takeOrderToDesk(input: {
  workspaceId: string;
  order: WorkOrder;
  page: WorkspacePage;
  /** Нужен для вариантов статуса и ОС — они общие на workspace, а не на столбце. */
  workspace: Workspace | null | undefined;
  members: WorkspaceMember[];
  monthKey: string;
  me: { uid: string; name: string };
}) {
  if (!db) throw new Error("Firebase не настроен");
  const { workspaceId, order, page, me } = input;
  const subPageId = isMonthlyDesk(page, input.members)
    ? (currentMonthSubPageId(page, input.monthKey) ?? (await ensureMonthTab(page, input.monthKey, me.uid)))
    : null;

  // Столбцы БЕРЁМ У ТОЙ ТАБЛИЦЫ, КУДА ПИШЕМ. У месячной вкладки свой набор
  // столбцов со своими ключами: если подставлять ключи «Основной», значения
  // уходят в никуда — так ОС, номер и дата приезжали пустыми, хотя в заказе
  // были заполнены.
  let targetColumns: PageColumn[] = page.columns;
  if (subPageId) {
    const subPages = await fetchSubPages(workspaceId, page.id);
    const tab = subPages.find((sp) => sp.id === subPageId);
    if (tab?.columns?.length) targetColumns = tab.columns;
  }
  const visible = targetColumns.filter((c) => !c.hidden);
  const { cells, extras } = buildQuickOrderRow(targetColumns, visible.length ? visible : targetColumns, {
    client: order.client,
    number: order.phone,
    os: order.osValue,
    check: order.price == null ? "" : String(order.price),
    persons: order.persons == null ? "" : String(order.persons),
    minutes: order.minutes == null ? "" : String(order.minutes),
    note: order.note,
    link: order.link,
    deadline: order.deadline,
  });

  // Заказ приезжает сразу «В работе» — технарю не нужно проставлять статус
  // руками, и заказ сразу считается загрузкой на «Технарях».
  const statusColumn = (visible.length ? visible : targetColumns).find((c) => c.type === "status");
  if (statusColumn) {
    const inProgress = findInProgressStatusOption(getColumnOptions(statusColumn, input.workspace));
    if (inProgress) cells[statusColumn.key] = inProgress.value;
  }

  const rows = subPageId ? await fetchSubPageRows(workspaceId, page.id, subPageId) : await fetchRows(workspaceId, page.id);
  // Свободный слот занимаем, а не добавляем строку под пустыми — то же
  // правило, что у «Добавить строку» и «Быстрого заказа».
  const blank = rows.find((r) => isBlankRow(r));
  let row;
  if (blank) {
    const patch: Record<string, string | number | null> = {};
    for (const [key, value] of Object.entries(cells)) if (isFilledCellValue(value)) patch[key] = value;
    if (subPageId) await updateSubPageRowCellsBulk(workspaceId, page.id, subPageId, blank.id, patch, extras ?? null, true);
    else await updateRowCellsBulk(workspaceId, page.id, blank.id, patch, extras ?? null, true);
    row = { ...blank, cells: { ...blank.cells, ...patch }, extras: extras ?? blank.extras, highlight: true };
  } else {
    const nextOrder = rows.reduce((max, r) => Math.max(max, typeof r.order === "number" ? r.order : 0), 0) + 1;
    row = subPageId
      ? await addSubPageRow(workspaceId, page.id, subPageId, cells, nextOrder, extras, true)
      : await addRow(workspaceId, page.id, cells, nextOrder, extras, true);
  }
  const now = Date.now();
  await updateDoc(paths.order(workspaceId, order.id), {
    status: "taken",
    takenAt: now,
    takenPageId: page.id,
    takenSubPageId: subPageId,
    takenRowId: row.id,
    updatedAt: now,
  });
  if (order.createdBy !== me.uid) {
    await sendNotification(
      {
        workspaceId,
        title: `${me.name} забрал заказ ${order.client} в стол`,
        body: `Стол «${page.name}».`,
        priority: "normal",
        fromUid: me.uid,
        fromName: me.name,
        target: "selected",
        href: `/page/${page.id}`,
        pageId: page.id,
      },
      [order.createdBy]
    ).catch(() => {});
  }
  return row;
}
