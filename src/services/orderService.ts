import { deleteDoc, deleteField, onSnapshot, query, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { deskRowHref } from "@/utils/deskLinks";
import { generateId } from "@/utils/id";
import { formatOrderDate } from "@/utils/date";
import { formatCurrency } from "@/utils/format";
import { buildQuickOrderRow, mergeColumnPicks } from "@/utils/quickOrder";
import { sendNotification } from "@/services/notificationService";
import { addRow, deleteRow, fetchRows, markRowOrder, updateRowCellsBulk } from "@/services/pageService";
import { addSubPageRow, deleteSubPageRow, fetchSubPageRows, fetchSubPages, updateSubPageRowCellsBulk } from "@/services/subPageService";
import { usesSupabaseRows } from "@/services/rows/rowsBackend";
import { sbDeleteRow, sbDropOrderRow, sbPatchRow } from "@/services/rows/supabaseRowStore";
import { sbFindDeskRowTab } from "@/services/rows/osOrderClaim";
import { findInProgressStatusOption, getColumnOptions } from "@/utils/columnOptions";
import { isBlankRow, isFilledCellValue } from "@/utils/blankRow";
import { currentMonthSubPageId, ensureMonthTab, isMonthlyDesk } from "@/services/monthTabService";
import {
  countOrdersAnywhere,
  fetchMergedHistoryPage,
  fetchOrderAnywhere,
  initialHistoryCursor,
  mapFirestoreOrder,
  ordersBackendFor,
  OrderNotInSupabase,
  routeOrderWrite,
  sbOrderWrite,
  subscribeLiveOrdersFeed,
  type OrderHistoryCursor,
} from "@/services/orderStore";
import type { SbBackend } from "@/services/sb/sbCollections";

export type { OrderHistoryCursor };
import { WORK_ORDER_URGENCY_LABELS } from "@/types";
import type {
  PageColumn,
  WorkOrder,
  WorkOrderOsSource,
  WorkOrderClaim,
  WorkOrderClaimScope,
  WorkOrderStatus,
  WorkOrderUrgency,
  Workspace,
  WorkspaceMember,
  WorkspacePage,
} from "@/types";

const mapOrder = mapFirestoreOrder;

/**
 * Статусы, которые живут на бирже и нужны вживую. «В столах» и «Отменённые» —
 * история: она только растёт (сотни заказов за месяц), а живая подписка на
 * всю коллекцию перечитывала её целиком при каждом открытии «Заказов» и
 * платила чтение за каждое изменение любого заказа — квота Spark.
 */
export const LIVE_ORDER_STATUSES = ["open", "assigned"] as const satisfies readonly WorkOrderStatus[];
export type HistoryOrderStatus = Exclude<WorkOrderStatus, (typeof LIVE_ORDER_STATUSES)[number]>;

export function isHistoryOrderStatus(status: WorkOrderStatus): status is HistoryOrderStatus {
  return status === "taken" || status === "cancelled";
}

/**
 * Живые заказы (открытые и выданные), новые сверху. Подписка живёт только
 * пока открыта страница «Заказы».
 *
 * Сортировка — на клиенте: `in` вместе с `orderBy` по другому полю требует
 * составного индекса, а живых заказов единицы. `fromCache` отдаётся вторым
 * аргументом (снимки метаданных включены): странице нужно знать, какой снимок
 * уже подтверждён сервером, — только по таким она считает, что заказ ушёл с
 * биржи, и только ими кормит зелёный пункт меню.
 */
export function subscribeOrders(
  workspaceId: string,
  cb: (orders: WorkOrder[], fromCache: boolean) => void,
  onError?: (e: unknown) => void,
  /** Где биржа (useOrdersBackend); нет — по стору в момент подписки. */
  backend?: SbBackend | null
) {
  // Supabase: общий поток живых заказов (оба хранилища) — см. orderStore.
  if ((backend ?? ordersBackendFor(workspaceId)) === "supabase") return subscribeLiveOrdersFeed(workspaceId, cb, onError);
  const q = query(paths.orders(workspaceId), where("status", "in", [...LIVE_ORDER_STATUSES]));
  return onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snap) =>
      cb(
        snap.docs.map((d) => mapOrder(d.data(), d.id)).sort((a, b) => b.createdAt - a.createdAt),
        snap.metadata.fromCache
      ),
    (error) => onError?.(error)
  );
}

/** Сколько заказов истории читается за раз («Показать ещё» — следующие столько же). */
export const ORDER_HISTORY_PAGE_SIZE = 60;

export interface OrderHistoryPage {
  orders: WorkOrder[];
  /** Курсор для «Показать ещё»; null — начать сначала. */
  cursor: OrderHistoryCursor | null;
  hasMore: boolean;
}

/**
 * Страница истории заказов — разово, по запросу, новые сверху.
 *
 * Без фильтра по статусу, одним потоком на обе вкладки истории: `status ==`
 * вместе с `orderBy("createdAt")` требует составного индекса, а сортировка по
 * одному полю идёт по одиночному. В странице попадутся и живые заказы — их
 * страница берёт из подписки, а отсюда отбрасывает.
 */
export async function fetchOrderHistoryPage(workspaceId: string, after: OrderHistoryCursor | null): Promise<OrderHistoryPage> {
  // Оба хранилища слиянием по дате (в режиме Firestore Supabase сразу «прочитан»).
  return fetchMergedHistoryPage(workspaceId, after ?? initialHistoryCursor(workspaceId), ORDER_HISTORY_PAGE_SIZE);
}

/**
 * Сколько заказов в этом статусе — для чипов «В столах» / «Отменённые».
 * Агрегат считается на сервере и стоит одно чтение на каждую тысячу
 * заказов, а не по чтению на заказ; одно равенство индекса не требует.
 */
export async function countOrdersWithStatus(workspaceId: string, status: WorkOrderStatus): Promise<number> {
  return countOrdersAnywhere(workspaceId, status);
}

/** Один заказ разово: куда он ушёл с биржи (в стол, в отмену или удалён — null). */
export async function fetchOrder(workspaceId: string, orderId: string): Promise<WorkOrder | null> {
  return fetchOrderAnywhere(workspaceId, orderId, false);
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
  /** Заказ со стола ОС — см. WorkOrder.osSource. */
  osSource?: WorkOrderOsSource | null;
}

export function orderSummary(order: Pick<WorkOrder, "client" | "minutes" | "persons">): string {
  const parts: string[] = [];
  if (order.minutes != null) parts.push(`${order.minutes} мин`);
  if (order.persons != null) parts.push(`${order.persons} перс`);
  return parts.length ? `${order.client} · ${parts.join(" · ")}` : order.client;
}

/**
 * Текст уведомления о новом заказе. Он же уходит во всплывашку браузера, где
 * видно ровно заголовок и две строки — поэтому срочность и дедлайн стоят
 * первыми: по ним решают, бросать ли текущее дело.
 */
function newOrderBody(order: WorkOrder): string {
  const parts: string[] = [];
  if (order.urgency && order.urgency !== "normal") parts.push(WORK_ORDER_URGENCY_LABELS[order.urgency]);
  if (order.deadline) parts.push(`до ${formatOrderDate(order.deadline)}`);
  if (order.price != null) parts.push(formatCurrency(order.price));
  if (order.osLabel) parts.push(`ОС: ${order.osLabel}`);
  const head = parts.join(" · ");
  return head ? `${head} — откликнитесь на «Заказах»` : "Откликнитесь на «Заказах», если готовы взять.";
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
  if (input.osSource) order.osSource = input.osSource;
  let saved: WorkOrder = order;
  let inFirestore = ordersBackendFor(input.workspaceId) === "firestore";
  if (!inFirestore) {
    try {
      saved = await sbOrderWrite(input.workspaceId, order.id, "create", { ...order });
    } catch (error) {
      // SQL не накатан — молча по-старому.
      if (!(error instanceof OrderNotInSupabase)) throw error;
      inFirestore = true;
    }
  }
  if (inFirestore) await setDoc(paths.order(input.workspaceId, order.id), order);
  await sendNotification(
    {
      workspaceId: input.workspaceId,
      title: `Новый заказ: ${orderSummary(order)}`,
      body: newOrderBody(order),
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
  return saved;
}

/** Технарь откликается (или снимает отклик). Меняется только свой ключ в `claims` — это и проверяет правило. */
export async function setOrderClaim(workspaceId: string, order: WorkOrder, me: { uid: string; name: string }, claim: boolean) {
  if (!db) throw new Error("Firebase не настроен");
  const value: WorkOrderClaim | ReturnType<typeof deleteField> = claim
    ? { uid: me.uid, name: me.name, at: Date.now() }
    : deleteField();
  await routeOrderWrite(workspaceId, order, "claim", { on: claim, name: me.name }, () =>
    setDoc(paths.order(workspaceId, order.id), { claims: { [me.uid]: value }, updatedAt: Date.now() }, { merge: true })
  );
  if (claim && order.createdBy !== me.uid) {
    await sendNotification(
      {
        workspaceId,
        title: `${me.name} готов взять заказ ${order.client}`,
        body: order.osSource
          ? "Выберите технаря прямо на своём столе — окно откроется само."
          : "Выдайте заказ ему или выберите другого технаря.",
        priority: "normal",
        fromUid: me.uid,
        fromName: me.name,
        target: "selected",
        // Заказ со стола ОС — ведём на его строку с открытым выбором
        // технаря (`?pick=`), а не на «Заказы».
        href: order.osSource
          ? `${deskRowHref(order.osSource.pageId, order.osSource.tabId, order.osSource.rowId)}&pick=${encodeURIComponent(order.id)}`
          : "/orders",
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
  /**
   * «сегодня выходной» / «отпросился» / «уже есть заказ в работе»; null —
   * свободен. Для ВЫДАЮЩЕГО это пометка (бейдж); откликнуться занятый может,
   * только если заказ открыт «Всем», — так же его отклик считает и «Рандом».
   */
  blockedReason?: string | null;
  /**
   * Сегодня по графику человека НЕТ (выходной или отпросился). Отдельным
   * флагом, а не по тексту причины: запасной вариант «Рандома» пускает
   * занятых, но присутствующих, и обязан отличать их от отсутствующих.
   */
  absentToday?: boolean;
}

/** Вес кандидата в броске; нет функции — у всех поровну. */
export type RandomWeightOf = (uid: string) => number;

const EQUAL_WEIGHT: RandomWeightOf = () => 1;

/**
 * Пул «Рандома» — ТОЛЬКО откликнувшиеся (просьба Nurba 03.10.2026: «заказы при
 * нажатии на рандом распределяются среди тех, кто откликнулся»). Запасных
 * пулов «свободные молчащие» / «все со столом» больше нет: без откликов
 * «Рандом» отвечает причиной (`randomPoolProblem`), а выдающий крутит «Свою
 * рулетку» среди тех, кого выберет сам (`customRandomPool`).
 *
 * В пуле: откликнулся, есть стол (забрать заказ некуда — не выиграет), сегодня
 * на смене (выходной из случайного выбора выпадает всегда), шанс у Owner не ×0,
 * и при заказе «Свободным» — без заказа «в работе»: старый отклик человека,
 * который с тех пор занят, не считается. При «Все» отклик занятого — обычный.
 * Диалог и карточка обязаны звать именно эту функцию, иначе кнопка в одном
 * месте работает, а в другом выключена.
 */
export function orderRandomPool(
  candidates: OrderCandidate[],
  scope: WorkOrderClaimScope = "free",
  weightOf: RandomWeightOf = EQUAL_WEIGHT
): OrderCandidate[] {
  return candidates.filter(
    (c) =>
      c.claimedAt != null &&
      c.hasDesk &&
      !c.absentToday &&
      (scope === "all" || !c.blockedReason) &&
      weightOf(c.uid) > 0
  );
}

/** Почему пул «Рандома» пуст — понятной фразой для кнопки и тоста; null — не пуст. */
export function randomPoolProblem(
  candidates: OrderCandidate[],
  scope: WorkOrderClaimScope = "free",
  weightOf: RandomWeightOf = EQUAL_WEIGHT
): string | null {
  if (orderRandomPool(candidates, scope, weightOf).length > 0) return null;
  const claimed = candidates.filter((c) => c.claimedAt != null);
  if (claimed.length === 0) return "Никто не откликнулся — подождите отклика или «Своя рулетка»";
  const withDesk = claimed.filter((c) => c.hasDesk);
  if (withDesk.length === 0) return "У откликнувшихся нет стола — забрать заказ некуда";
  const present = withDesk.filter((c) => !c.absentToday);
  if (present.length === 0) return "Откликнувшихся сегодня нет на смене — «Своя рулетка» или выдайте вручную";
  const allowed = present.filter((c) => scope === "all" || !c.blockedReason);
  if (allowed.length === 0) return "Откликнулись только занятые — откройте заказ «Всем» или «Своя рулетка»";
  return "У откликнувшихся шанс ×0 в настройках «Рандома» — выдайте вручную";
}

/**
 * «Своя рулетка»: выдающий сам выбрал, среди кого крутить. Отклик и занятость
 * не важны — людей выбрал человек; стол обязателен, а тех, кого сегодня нет,
 * случай не выбирает никогда (как и в обычном «Рандоме»). Порядок — как в
 * списке кандидатов.
 */
export function customRandomPool(
  candidates: OrderCandidate[],
  uids: readonly string[],
  weightOf: RandomWeightOf = EQUAL_WEIGHT
): OrderCandidate[] {
  const picked = new Set(uids);
  return candidates.filter((c) => picked.has(c.uid) && c.hasDesk && !c.absentToday && weightOf(c.uid) > 0);
}

function randomUnit(): number {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] / 4294967296;
}

/**
 * Бросок по уже посчитанному пулу с весами (шансы Owner). Отдельно от пула,
 * потому что барабан «Рандома» рисует ТОТ ЖЕ пул, из которого тянули: считать
 * пул дважды — верный способ показать одно, а выдать другое. При равных весах
 * — равная вероятность, как раньше.
 */
export function pickWeighted(pool: OrderCandidate[], weightOf: RandomWeightOf = EQUAL_WEIGHT, unit: () => number = randomUnit): OrderCandidate | null {
  const weights = pool.map((c) => Math.max(0, weightOf(c.uid)));
  const total = weights.reduce((a, b) => a + b, 0);
  if (pool.length === 0 || total <= 0) return null;
  let target = unit() * total;
  for (let i = 0; i < pool.length; i += 1) {
    if (weights[i] <= 0) continue;
    if (target < weights[i]) return pool[i];
    target -= weights[i];
  }
  // Погрешность плавающей точки: последний с ненулевым весом.
  for (let i = pool.length - 1; i >= 0; i -= 1) if (weights[i] > 0) return pool[i];
  return null;
}

export function pickFromPool(pool: OrderCandidate[]): OrderCandidate | null {
  return pickWeighted(pool);
}

export function pickRandomCandidate(candidates: OrderCandidate[], scope: WorkOrderClaimScope = "free"): OrderCandidate | null {
  return pickFromPool(orderRandomPool(candidates, scope));
}

/**
 * «Свободные / Все» у заказа — кто может откликнуться. Пишут Owner, Тимлид и
 * любой ОС — у любого открытого заказа (правило заказов пускает ОС менять в
 * чужом заказе только это поле). Открыли всем —
 * занятым технарям, которые сегодня на смене, уходит уведомление: сами они
 * до этого видели «Отклик закрыт» и на заказ больше не смотрели.
 */
export async function setOrderClaimScope(input: {
  workspaceId: string;
  order: WorkOrder;
  scope: WorkOrderClaimScope;
  actor: { uid: string; name: string };
  notifyUids: string[];
}) {
  if (!db) throw new Error("Firebase не настроен");
  await routeOrderWrite(input.workspaceId, input.order, "scope", { scope: input.scope }, () =>
    updateDoc(paths.order(input.workspaceId, input.order.id), { claimScope: input.scope, updatedAt: Date.now() })
  );
  if (input.scope === "all" && input.notifyUids.length > 0) {
    await sendNotification(
      {
        workspaceId: input.workspaceId,
        title: `Заказ ${input.order.client} открыт всем`,
        body: "Можно откликнуться, даже если у вас уже есть заказ в работе.",
        priority: "normal",
        fromUid: input.actor.uid,
        fromName: input.actor.name,
        target: "selected",
        href: "/orders",
      },
      input.notifyUids
    ).catch(() => {});
  }
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
  await routeOrderWrite(input.workspaceId, input.order, "assign", { uid: input.technician.uid, name: input.technician.name }, () =>
    updateDoc(paths.order(input.workspaceId, input.order.id), {
      status: "assigned",
      assignedUid: input.technician.uid,
      assignedName: input.technician.name,
      assignedAt: now,
      assignedBy: input.actorUid,
      updatedAt: now,
    })
  );
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
  await routeOrderWrite(workspaceId, order, "unassign", {}, () =>
    updateDoc(paths.order(workspaceId, order.id), {
      status: "open",
      assignedUid: null,
      assignedName: null,
      assignedAt: null,
      assignedBy: null,
      updatedAt: now,
    })
  );
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
  await routeOrderWrite(workspaceId, order, "cancel", { cancelled }, () =>
    updateDoc(paths.order(workspaceId, order.id), {
      status: cancelled ? "cancelled" : "open",
      cancelledAt: cancelled ? now : null,
      assignedUid: null,
      assignedName: null,
      assignedAt: null,
      assignedBy: null,
      updatedAt: now,
    })
  );
}

export async function deleteOrder(workspaceId: string, order: Pick<WorkOrder, "id" | "source"> | string) {
  if (!db) throw new Error("Firebase не настроен");
  const id = typeof order === "string" ? order : order.id;
  await routeOrderWrite(workspaceId, order, "delete", {}, () => deleteDoc(paths.order(workspaceId, id)));
}

/**
 * Заказ ушёл в стол технаря (строка `rowId` вкладки `subPageId` стола
 * `pageId`). Пишет назначенный технарь — или сам выдающий, когда заказ со
 * стола ОС довозит до технаря сессия ОС.
 */
export async function markOrderTaken(
  workspaceId: string,
  order: Pick<WorkOrder, "id" | "source"> | string,
  at: { pageId: string; subPageId: string | null; rowId: string }
) {
  const id = typeof order === "string" ? order : order.id;
  const now = Date.now();
  await routeOrderWrite(workspaceId, order, "take", { pageId: at.pageId, subPageId: at.subPageId, rowId: at.rowId }, () =>
    db
      ? updateDoc(paths.order(workspaceId, id), {
          status: "taken",
          takenAt: now,
          takenPageId: at.pageId,
          takenSubPageId: at.subPageId,
          takenRowId: at.rowId,
          updatedAt: now,
        })
      : Promise.resolve()
  );
}

/** Строку взятого заказа перенесли в новый период — заказ помнит её новый адрес. */
export async function retabOrder(workspaceId: string, orderId: string, at: { subPageId: string | null; rowId: string }) {
  await routeOrderWrite(workspaceId, orderId, "retab", { subPageId: at.subPageId, rowId: at.rowId }, () =>
    db ? updateDoc(paths.order(workspaceId, orderId), { takenSubPageId: at.subPageId, takenRowId: at.rowId, updatedAt: Date.now() }) : Promise.resolve()
  );
}

/**
 * Убрать из стола технаря строку, которую туда привёз заказ, — перед
 * удалением самого заказа (просьба Nurba: удалил заказ — пропал и у
 * технаря). Удаляют заказ его ОС, Тимлид и Owner, а в чужой стол из них
 * пишет только Owner, поэтому право даёт не стол, а сам заказ: правило
 * Firestore сверяет строку с `takenRowId` заказа и автора заказа, в Supabase
 * — функция `rows_drop_order_row`. Строки уже нет — не ошибка.
 */
export async function removeOrderDeskRow(
  workspaceId: string,
  order: WorkOrder,
  /** Удаляющий вправе убрать строку-заказ ОС: это сам ОС-автор или Owner. */
  canDropOsOrder = false
): Promise<void> {
  const pageId = order.takenPageId;
  if (!pageId) return;
  const rowId = order.takenRowId ?? orderRowId(order.id);
  const tab = order.takenSubPageId ?? null;
  // Заказ со стола ОС: у технаря лежит строка-заказ с меткой ОС (её ведёт ОС),
  // а не строка с биржи, и `rows_drop_order_row` её не найдёт. Убирает её сам
  // ОС (или Owner), и вместе с ней снимается ник технаря в строке ОС — иначе
  // проход стола ОС завёл бы копию заново.
  if (order.osSource && usesSupabaseRows(workspaceId)) {
    if (!canDropOsOrder) throw new Error("Заказ со стола ОС убирает у технаря сам ОС или Owner");
    await sbDeleteRow(workspaceId, pageId, tab, rowId);
    await sbPatchRow(workspaceId, order.osSource.pageId, order.osSource.tabId, order.osSource.rowId, {
      cells: { technician: "" },
    });
    return;
  }
  if (usesSupabaseRows(workspaceId)) {
    // Строку могли перенести в новый период (rows_carry_over) до того, как
    // заказ узнал новый адрес — ищем её по id на любой вкладке стола.
    const actualTab = await sbFindDeskRowTab(workspaceId, pageId, rowId).catch(() => undefined);
    await sbDropOrderRow(workspaceId, pageId, actualTab === undefined ? tab : actualTab || null, rowId, order.id);
    return;
  }
  if (tab) await deleteSubPageRow(workspaceId, pageId, tab, rowId);
  else await deleteRow(workspaceId, pageId, rowId);
}

/**
 * Назначенный технарь забирает заказ в свой стол: строка в текущую месячную
 * вкладку (или в основную таблицу, если стол не помесячный) с клиентом,
 * номером, ссылкой, ОС, персами и минутами — тем же подбором столбцов, что
 * и «Быстрый заказ» в столе. Пишется сессией технаря по его правам на стол.
 */
/**
 * Столбцы для подбора: сначала видимые, а на каждый незанятый слот —
 * первый подходящий из полного набора (включая скрытые). Порядок в массиве
 * решает, потому что findQuickOrderColumns берёт первое совпадение.
 */
/** Строка стола, рождённая заказом: id выводится из заказа, поэтому запись идемпотентна. */
export function orderRowId(orderId: string): string {
  return `row_${orderId.replace(/[^A-Za-z0-9_-]/g, "")}`;
}

/**
 * Заказ уже не ждёт этого технаря: его забрали в стол (с другого устройства),
 * передали другому или отменили. Это не сбой — автозаезд такой заказ молча
 * пропускает.
 */
export class OrderNotAssignedError extends Error {
  constructor() {
    super("Заказ уже не ждёт вас: его забрали в стол, передали другому или отменили");
    this.name = "OrderNotAssignedError";
  }
}

/** Нет связи с сервером — заказ не сверить; автозаезд повторит сам, когда связь вернётся. */
export class OrderOfflineError extends Error {
  constructor() {
    super("Нет связи с сервером — заказ заберётся, когда появится сеть");
    this.name = "OrderOfflineError";
  }
}

export async function takeOrderToDesk(input: {
  workspaceId: string;
  order: WorkOrder;
  page: WorkspacePage;
  /** Нужен для вариантов статуса и ОС — они общие на workspace, а не на столбце. */
  workspace: Workspace | null | undefined;
  members: WorkspaceMember[];
  monthKey: string;
  me: { uid: string; name: string };
  /**
   * Кому выдан заказ, если кладёт не он сам: стол технаря закрыт «только
   * для Owner», и заказ за него кладёт сессия Owner (useOwnerOnlyUpkeep).
   * Действует по-прежнему `me` — он же в уведомлении.
   */
  assigneeUid?: string;
}) {
  if (!db) throw new Error("Firebase не настроен");
  const { workspaceId, page, me } = input;
  // Заказ сверяем С СЕРВЕРОМ, а не верим тому, что пришло в подписке: с
  // LRU-кэшем повторная подписка (смена workspace, выход и вход в той же
  // вкладке) сначала отдаёт заказы, какими они были в кэше, — «выдан вам»,
  // хотя телефон технаря давно забрал его в стол или Owner передал другому.
  // По такому снимку в стол ложилась вторая строка того же заказа, а
  // `status: taken` потом отклоняли правила. Одно чтение на заезд.
  let fresh: WorkOrder | null;
  try {
    fresh = await fetchOrderAnywhere(workspaceId, input.order.id, true);
  } catch (error) {
    if ((error as { code?: string } | null)?.code === "unavailable") throw new OrderOfflineError();
    throw error;
  }
  if (!fresh || fresh.status !== "assigned" || fresh.assignedUid !== (input.assigneeUid ?? me.uid)) throw new OrderNotAssignedError();
  // Заказ со стола ОС заводит в стол сам ОС (строкой-заказом с его меткой).
  if (fresh.osSource) throw new Error("Этот заказ приедет в стол от ОС — забирать его не нужно");
  const order = fresh;
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
    // Молчаливый откат на page.columns был ловушкой: если вкладку удалили,
    // а ссылка на неё осталась в page.autoMonthSubPageId, строка писалась в
    // подколлекцию несуществующей вкладки ключами «Основной» — заказ
    // помечался «В столе», а технарь не видел его нигде. Лучше честно
    // отказаться: заказ останется `assigned` и приедет позже, а кнопка
    // «Забрать в стол» на «Заказах» останется рабочей.
    if (!tab?.columns?.length) {
      throw new Error("Вкладка месяца недоступна — заказ не записан в стол");
    }
    targetColumns = tab.columns;
  }
  // Подбор идёт по видимым столбцам, но скрытый столбец не должен СЪЕДАТЬ
  // значение: у цены, в отличие от персов/минут/ссылки, запасного места в
  // визитке нет — спрятали «Цену», и сумма заказа не попадала никуда, а
  // grandTotal/statusSums/дашборд недосчитывались. Запись в скрытый столбец
  // безвредна: значение в нём хранится и появится, когда столбец покажут.
  const visible = targetColumns.filter((c) => !c.hidden);
  const forPick = mergeColumnPicks(visible, targetColumns);
  const { cells, extras } = buildQuickOrderRow(targetColumns, forPick, {
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
  // Строка этого заказа уже может лежать в столе — после повтора, второй
  // вкладки того же технаря или сбоя записи статуса. Тогда пишем в неё, а не
  // занимаем ещё один слот.
  // Своя строка — и по выведенному id, и по метке `orderId`: заказ, занявший
  // пустой слот, лежит под id слота.
  const mine = rows.find((r) => r.id === orderRowId(order.id) || r.orderId === order.id);
  const blank = mine ?? rows.find((r) => isBlankRow(r));
  let row;
  if (blank) {
    const patch: Record<string, string | number | null> = {};
    for (const [key, value] of Object.entries(cells)) if (isFilledCellValue(value)) patch[key] = value;
    // Слот заняли сейчас — время внесения (порядок «новые снизу», дата заказа)
    // считается от этой минуты, а не от того, когда завели пустую строку.
    const filledAt = !mine && isBlankRow(blank) ? Date.now() : undefined;
    if (subPageId) await updateSubPageRowCellsBulk(workspaceId, page.id, subPageId, blank.id, patch, extras ?? null, true, filledAt);
    else await updateRowCellsBulk(workspaceId, page.id, blank.id, patch, extras ?? null, true, filledAt);
    // Занятый слот тоже метим: «пришло с биржи» видно и через месяц, когда
    // подсветку давно сняли.
    await markRowOrder(workspaceId, page.id, subPageId, blank.id, order.id);
    row = { ...blank, cells: { ...blank.cells, ...patch }, extras: extras ?? blank.extras, highlight: true, orderId: order.id };
  } else {
    const nextOrder = rows.reduce((max, r) => Math.max(max, typeof r.order === "number" ? r.order : 0), 0) + 1;
    // Id строки выводится из id заказа, а не случайный. Замерено: два окна
    // одного технаря (или повтор после сбоя записи статуса) клали в стол по
    // строке на попытку — три строки «ДваОкна» на один заказ. С детерминированным
    // id повторная запись попадает в ту же строку и остаётся одна.
    row = subPageId
      ? await addSubPageRow(workspaceId, page.id, subPageId, cells, nextOrder, extras, true, orderRowId(order.id), order.id)
      : await addRow(workspaceId, page.id, cells, nextOrder, extras, true, orderRowId(order.id), order.id);
  }
  await markOrderTaken(workspaceId, order, { pageId: page.id, subPageId, rowId: row.id });
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
        // На «Заказы», а не в стол: автор заказа — как правило ОС, а чужой
        // стол он не откроет, и переход упирался в «нет доступа».
        href: "/orders",
      },
      [order.createdBy]
    ).catch(() => {});
  }
  return row;
}
