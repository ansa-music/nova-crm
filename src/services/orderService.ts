import { deleteDoc, deleteField, onSnapshot, orderBy, query, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { generateId } from "@/utils/id";
import { normalizeTimestamp } from "@/utils/date";
import { buildQuickOrderRow } from "@/utils/quickOrder";
import { sendNotification } from "@/services/notificationService";
import { addRow, fetchRows, markRowOrder, updateRowCellsBulk } from "@/services/pageService";
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
  /** «сегодня выходной» / «отпросился» / «уже есть заказ в работе»; null — свободен. */
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
 * Занятые и те, у кого сегодня выходной, из СЛУЧАЙНОГО выбора выпадают: если
 * человека сегодня нет, отдавать ему заказ броском монеты — прямой способ
 * уронить срок. Руками отдать всё равно можно (и ОС об этом просил) — это
 * осознанное решение живого человека, а не случайность.
 *
 * Последний фоллбэк — все со столом: «Рандом» не должен превращаться в
 * мёртвую кнопку в день, когда свободных нет вовсе.
 */
export function orderRandomPool(candidates: OrderCandidate[]): OrderCandidate[] {
  // Кого сегодня нет, в случайный выбор не попадает НИКОГДА — ни в основной
  // пул, ни в запасной. Раньше запасной вариант («свободных нет — берём всех
  // со столом») возвращал и выходных: в воскресенье при трёх технарях, из
  // которых один выходной, один отпросился и один занят, заказ с вероятностью
  // 2/3 уходил тому, кого нет.
  const withDesk = candidates.filter((c) => c.hasDesk && !c.absentToday);
  const free = withDesk.filter((c) => !c.blockedReason);
  const claimedFree = free.filter((c) => c.claimedAt != null);
  if (claimedFree.length > 0) return claimedFree;
  if (free.length > 0) return free;
  // Свободных нет — остаются только занятые, но вышедшие сегодня: лучше
  // заказ в очередь живому человеку, чем мёртвая кнопка.
  const claimed = withDesk.filter((c) => c.claimedAt != null);
  return claimed.length > 0 ? claimed : withDesk;
}

export function pickRandomCandidate(candidates: OrderCandidate[]): OrderCandidate | null {
  const pool = orderRandomPool(candidates);
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
