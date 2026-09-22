import {
  deleteDoc,
  deleteField,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  startAfter,
  updateDoc,
  where,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { generateId } from "@/utils/id";
import { formatOrderDate, normalizeTimestamp } from "@/utils/date";
import { formatCurrency } from "@/utils/format";
import { buildQuickOrderRow } from "@/utils/quickOrder";
import { sendNotification } from "@/services/notificationService";
import { addRow, fetchRows, markRowOrder, updateRowCellsBulk } from "@/services/pageService";
import { addSubPageRow, fetchSubPageRows, fetchSubPages, updateSubPageRowCellsBulk } from "@/services/subPageService";
import { findInProgressStatusOption, getColumnOptions } from "@/utils/columnOptions";
import { isBlankRow, isFilledCellValue } from "@/utils/blankRow";
import { currentMonthSubPageId, ensureMonthTab, isMonthlyDesk } from "@/services/monthTabService";
import { WORK_ORDER_URGENCY_LABELS } from "@/types";
import type {
  PageColumn,
  WorkOrder,
  WorkOrderClaim,
  WorkOrderClaimScope,
  WorkOrderStatus,
  WorkOrderUrgency,
  Workspace,
  WorkspaceMember,
  WorkspacePage,
} from "@/types";

function mapOrder(data: Record<string, unknown>, id: string): WorkOrder {
  const row = { id, ...data } as WorkOrder;
  return {
    ...row,
    claims: row.claims ?? {},
    createdAt: normalizeTimestamp(row.createdAt),
    updatedAt: normalizeTimestamp(row.updatedAt),
  };
}

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
  onError?: (e: unknown) => void
) {
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
  /** Курсор для «Показать ещё» — последний прочитанный заказ; null — не прочитано ни одного. */
  cursor: QueryDocumentSnapshot | null;
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
export async function fetchOrderHistoryPage(workspaceId: string, after: QueryDocumentSnapshot | null): Promise<OrderHistoryPage> {
  const q = after
    ? query(paths.orders(workspaceId), orderBy("createdAt", "desc"), startAfter(after), limit(ORDER_HISTORY_PAGE_SIZE))
    : query(paths.orders(workspaceId), orderBy("createdAt", "desc"), limit(ORDER_HISTORY_PAGE_SIZE));
  const snapshot = await getDocs(q);
  return {
    orders: snapshot.docs.map((d) => mapOrder(d.data(), d.id)),
    cursor: snapshot.docs[snapshot.docs.length - 1] ?? after,
    hasMore: snapshot.size === ORDER_HISTORY_PAGE_SIZE,
  };
}

/**
 * Сколько заказов в этом статусе — для чипов «В столах» / «Отменённые».
 * Агрегат считается на сервере и стоит одно чтение на каждую тысячу
 * заказов, а не по чтению на заказ; одно равенство индекса не требует.
 */
export async function countOrdersWithStatus(workspaceId: string, status: WorkOrderStatus): Promise<number> {
  const snapshot = await getCountFromServer(query(paths.orders(workspaceId), where("status", "==", status)));
  return snapshot.data().count;
}

/** Один заказ разово: куда он ушёл с биржи (в стол, в отмену или удалён — null). */
export async function fetchOrder(workspaceId: string, orderId: string): Promise<WorkOrder | null> {
  const snapshot = await getDoc(paths.order(workspaceId, orderId));
  return snapshot.exists() ? mapOrder(snapshot.data(), snapshot.id) : null;
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
  await setDoc(paths.order(input.workspaceId, order.id), order);
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
  return order;
}

/** Технарь откликается (или снимает отклик). Меняется только свой ключ в `claims` — это и проверяет правило. */
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
  /**
   * «сегодня выходной» / «отпросился» / «уже есть заказ в работе»; null —
   * свободен. Для ВЫДАЮЩЕГО это пометка (бейдж и приоритет «Рандома»);
   * откликнуться занятый может, только если заказ открыт «Всем».
   */
  blockedReason?: string | null;
  /**
   * Сегодня по графику человека НЕТ (выходной или отпросился). Отдельным
   * флагом, а не по тексту причины: запасной вариант «Рандома» пускает
   * занятых, но присутствующих, и обязан отличать их от отсутствующих.
   */
  absentToday?: boolean;
}

/**
 * Пул «Рандома»: сначала отсекаем тех, кому заказ некуда забрать, и только
 * потом смотрим на отклики. Порядок важен: если сначала брать откликнувшихся,
 * один отклик от технаря БЕЗ стола съедал весь фоллбэк и рандом оказывался
 * пустым. Диалог и карточка обязаны звать именно эту функцию, иначе кнопка
 * в одном месте работает, а в другом выключена.
 *
 * Те, у кого сегодня выходной, из СЛУЧАЙНОГО выбора выпадают всегда: если
 * человека сегодня нет, отдавать ему заказ броском монеты — прямой способ
 * уронить срок. Руками отдать всё равно можно (и ОС об этом просил) — это
 * осознанное решение живого человека, а не случайность.
 *
 * Порядок зависит от того, кому открыт отклик (`WorkOrder.claimScope`):
 * - «Свободные» (по умолчанию): свободные откликнувшиеся → свободные
 *   молчащие → занятые откликнувшиеся → все со столом. Руководство сказало
 *   «только свободные» — старый отклик занятого (он мог откликнуться, пока
 *   заказ был открыт всем) свободного не перебивает.
 * - «Все»: свободные откликнувшиеся → занятые откликнувшиеся → свободные
 *   молчащие → все со столом. Здесь отклик занятого значит «возьму ещё
 *   один», и он важнее свободного, который промолчал.
 * Последний фоллбэк — все со столом: «Рандом» не должен превращаться в
 * мёртвую кнопку в день, когда свободных нет вовсе.
 */
export function orderRandomPool(candidates: OrderCandidate[], scope: WorkOrderClaimScope = "free"): OrderCandidate[] {
  // Кого сегодня нет, в случайный выбор не попадает НИКОГДА — ни в основной
  // пул, ни в запасной. Раньше запасной вариант («свободных нет — берём всех
  // со столом») возвращал и выходных: в воскресенье при трёх технарях, из
  // которых один выходной, один отпросился и один занят, заказ с вероятностью
  // 2/3 уходил тому, кого нет.
  const withDesk = candidates.filter((c) => c.hasDesk && !c.absentToday);
  const free = withDesk.filter((c) => !c.blockedReason);
  const claimedFree = free.filter((c) => c.claimedAt != null);
  if (claimedFree.length > 0) return claimedFree;
  const claimed = withDesk.filter((c) => c.claimedAt != null);
  if (scope === "all" && claimed.length > 0) return claimed;
  if (free.length > 0) return free;
  if (claimed.length > 0) return claimed;
  // Никто не откликнулся и свободных нет — все вышедшие сегодня со столом:
  // лучше заказ в очередь живому человеку, чем мёртвая кнопка.
  return withDesk;
}

/**
 * Бросок по уже посчитанному пулу. Отдельно от `pickRandomCandidate`, потому
 * что барабан «Рандома» рисует ТОТ ЖЕ пул, из которого тянули: считать пул
 * дважды — верный способ показать одно, а выдать другое.
 */
export function pickFromPool(pool: OrderCandidate[]): OrderCandidate | null {
  if (pool.length === 0) return null;
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return pool[bytes[0] % pool.length];
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
  await updateDoc(paths.order(input.workspaceId, input.order.id), { claimScope: input.scope, updatedAt: Date.now() });
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
function mergeColumnPicks(visible: PageColumn[], all: PageColumn[]): PageColumn[] {
  if (visible.length === 0) return all;
  const seen = new Set(visible.map((c) => c.key));
  return [...visible, ...all.filter((c) => !seen.has(c.key))];
}

/** Строка стола, рождённая заказом: id выводится из заказа, поэтому запись идемпотентна. */
export function orderRowId(orderId: string): string {
  return `row_${orderId.replace(/[^A-Za-z0-9_-]/g, "")}`;
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
  const mine = rows.find((r) => r.id === orderRowId(order.id));
  const blank = mine ?? rows.find((r) => isBlankRow(r));
  let row;
  if (blank) {
    const patch: Record<string, string | number | null> = {};
    for (const [key, value] of Object.entries(cells)) if (isFilledCellValue(value)) patch[key] = value;
    if (subPageId) await updateSubPageRowCellsBulk(workspaceId, page.id, subPageId, blank.id, patch, extras ?? null, true);
    else await updateRowCellsBulk(workspaceId, page.id, blank.id, patch, extras ?? null, true);
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
        // На «Заказы», а не в стол: автор заказа — как правило ОС, а чужой
        // стол он не откроет, и переход упирался в «нет доступа».
        href: "/orders",
      },
      [order.createdBy]
    ).catch(() => {});
  }
  return row;
}
