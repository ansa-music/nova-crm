export type WorkOrderStatus = "open" | "assigned" | "taken" | "cancelled";

/** Срочность заказа — её выставляет выдающий. */
export type WorkOrderUrgency = "normal" | "urgent" | "fire";

export const WORK_ORDER_URGENCY_LABELS: Record<WorkOrderUrgency, string> = {
  normal: "Нейтральный",
  urgent: "Срочный",
  fire: "Горит",
};

/** Отклик технаря на заказ. Ключ в `WorkOrder.claims` — uid, так правило пускает менять только свой. */
export interface WorkOrderClaim {
  uid: string;
  name: string;
  at: number;
}

/**
 * Заказ на «Заказах» (`workspaces/{ws}/orders/{id}`) — биржа между ОС и
 * технарями: ОС/Тимлид/Owner выдаёт, технари откликаются, выдающий
 * назначает (или рандом), назначенный забирает заказ в свой стол — тогда
 * в столе появляется строка с теми же полями, и заказ переходит в `taken`.
 *
 * Сам заказ ничего в столах не пишет и не читает: строка создаётся сессией
 * технаря по его же правам на свой стол, а здесь остаётся только ссылка на неё.
 */
export interface WorkOrder {
  id: string;
  workspaceId: string;
  /** Имя клиента — в столе уйдёт в столбец «Клиент»/первый текстовый. */
  client: string;
  phone: string;
  /** Ссылка на сайт/страницу с клиентом — в столбец типа «ссылка», если он есть. */
  link: string;
  /** Цена заказа. Уходит в денежный столбец стола («Цена»). */
  price: number | null;
  persons: number | null;
  minutes: number | null;
  /** Пожелания — уходят в визитку клиента (`row.extras.note`). */
  note: string;
  /** Дедлайн сдачи (мс). Уходит в столбец-дату стола, когда заказ попадает к технарю. */
  deadline: number | null;
  /** «Горит» / «Срочный» / «Нейтральный». Старые заказы без поля считаются нейтральными. */
  urgency: WorkOrderUrgency;
  /** Ник ОС: значение варианта общего списка «Ответственный» и его подпись на момент выдачи. */
  osValue: string;
  osLabel: string;
  createdBy: string;
  createdByName: string;
  status: WorkOrderStatus;
  claims: Record<string, WorkOrderClaim>;
  assignedUid: string | null;
  assignedName: string | null;
  assignedAt: number | null;
  assignedBy: string | null;
  takenAt: number | null;
  takenPageId: string | null;
  takenSubPageId: string | null;
  takenRowId: string | null;
  cancelledAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  open: "Открыт",
  assigned: "Выдан",
  taken: "В столе",
  cancelled: "Отменён",
};
