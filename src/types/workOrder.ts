export type WorkOrderStatus = "open" | "assigned" | "taken" | "cancelled";

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
  persons: number | null;
  minutes: number | null;
  /** Пожелания — уходят в визитку клиента (`row.extras.note`). */
  note: string;
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
