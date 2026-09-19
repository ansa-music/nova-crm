import { deleteDoc, deleteField, onSnapshot, orderBy, query, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { generateId } from "@/utils/id";
import { normalizeTimestamp } from "@/utils/date";
import { buildQuickOrderRow } from "@/utils/quickOrder";
import { sendNotification } from "@/services/notificationService";
import { addRow, fetchRows } from "@/services/pageService";
import { addSubPageRow, fetchSubPageRows } from "@/services/subPageService";
import { currentMonthSubPageId, ensureMonthTab, isMonthlyDesk } from "@/services/monthTabService";
import type { WorkOrder, WorkOrderClaim, WorkspaceMember, WorkspacePage } from "@/types";

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
      body: "Заберите его в свой стол на «Заказах» — строка заполнится сама.",
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
  members: WorkspaceMember[];
  monthKey: string;
  me: { uid: string; name: string };
}) {
  if (!db) throw new Error("Firebase не настроен");
  const { workspaceId, order, page, me } = input;
  const subPageId = isMonthlyDesk(page, input.members)
    ? (currentMonthSubPageId(page, input.monthKey) ?? (await ensureMonthTab(page, input.monthKey, me.uid)))
    : null;
  const visible = page.columns.filter((c) => !c.hidden);
  const { cells, extras } = buildQuickOrderRow(page.columns, visible.length ? visible : page.columns, {
    client: order.client,
    number: order.phone,
    os: order.osValue,
    check: "",
    persons: order.persons == null ? "" : String(order.persons),
    minutes: order.minutes == null ? "" : String(order.minutes),
    note: order.note,
    link: order.link,
  });
  const rows = subPageId ? await fetchSubPageRows(workspaceId, page.id, subPageId) : await fetchRows(workspaceId, page.id);
  const nextOrder = rows.reduce((max, r) => Math.max(max, typeof r.order === "number" ? r.order : 0), 0) + 1;
  const row = subPageId
    ? await addSubPageRow(workspaceId, page.id, subPageId, cells, nextOrder, extras)
    : await addRow(workspaceId, page.id, cells, nextOrder, extras);
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
