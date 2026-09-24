import { sendNotification } from "@/services/notificationService";
import { submitOrderRequest, type NewOrderRequest } from "@/services/orderRequestService";
import { patchTechOrderRow } from "@/services/pageService";
import { memberHasRole, type PageRow, type WorkspaceMember } from "@/types";
import { deskRowHref } from "@/utils/deskLinks";

/**
 * Просьба к ОС поставить статус заказу, который он ведёт (просьба Nurba
 * 25.09.2026: «технарю — запросить сменить статус на „Готово“ или другой,
 * приоритет на „Готово“»; «я как Owner тоже должен уметь запрашивать»).
 *
 * Одна функция на ячейку статуса в таблице и на карточку строки, чтобы две
 * кнопки не разошлись. Решает ОС этого заказа в «Запросах технарей»
 * (`OsOrderRequestsPanel`). Просьба «Готово» ещё и ставит на строку прежнюю
 * отметку «просят „Успешку“» и зовёт руководство: Тимлид вправе поставить
 * статус в заказе ОС сам, а ОС может быть не в сети.
 */
export async function requestOrderStatus(input: {
  workspaceId: string;
  row: PageRow;
  /** Стол и вкладка, где строка открыта (в режиме Firestore их нет в строке). */
  deskPageId: string;
  deskTabId: string | null;
  deskName: string;
  me: string;
  meName: string;
  status: string;
  statusLabel: string;
  note: string;
  client: string;
  done: boolean;
  members: WorkspaceMember[];
}): Promise<NewOrderRequest> {
  const { row } = input;
  if (!row.osUid || !row.srcPageId || !row.srcRowId) {
    throw new Error("Этот заказ не ведёт ОС — просить некого");
  }
  const request: NewOrderRequest = {
    kind: "status",
    status: input.status,
    statusLabel: input.statusLabel,
    note: input.note,
    techUid: input.me,
    techName: input.meName,
    osUid: row.osUid,
    client: input.client,
    deskPageId: input.deskPageId,
    deskTabId: input.deskTabId,
    rowId: row.id,
    srcPageId: row.srcPageId,
    srcTabId: row.srcTabId || null,
    srcRowId: row.srcRowId,
  };
  await submitOrderRequest(input.workspaceId, request);
  if (input.done) {
    // Отметка на строке — не главное: запрос уже у ОС. Её отказ не роняет просьбу.
    await patchTechOrderRow({
      workspaceId: input.workspaceId,
      pageId: input.deskPageId,
      subPageId: input.deskTabId,
      rowId: row.id,
      successRequestedAt: Date.now(),
      successRequestedBy: input.me,
    }).catch(() => undefined);
    const leadership = input.members
      .filter((m) => m.status === "active" && m.uid && (memberHasRole(m, "owner") || memberHasRole(m, "teamlead")))
      .map((m) => m.uid as string)
      // ОС своё уведомление уже получил вместе с запросом.
      .filter((uid) => uid !== row.osUid);
    if (leadership.length) {
      await sendNotification(
        {
          workspaceId: input.workspaceId,
          title: `Просят поставить «${input.statusLabel}»`,
          body: `${input.meName}${input.client ? ` · ${input.client}` : ""}${input.deskName ? ` · ${input.deskName}` : ""}`,
          priority: "important",
          fromUid: input.me,
          fromName: input.meName,
          target: "selected",
          selectedUids: leadership,
          pageId: input.deskPageId,
          href: deskRowHref(input.deskPageId, input.deskTabId, row.id),
          kind: "success-request",
        },
        leadership
      ).catch(() => undefined);
    }
  }
  return request;
}
