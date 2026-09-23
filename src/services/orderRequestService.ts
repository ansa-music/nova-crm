import { collection, deleteDoc, doc, getDoc, onSnapshot, query, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { sendNotification } from "@/services/notificationService";

/**
 * Запрос технаря к ОС по заказу, который ведёт ОС (просьба Nurba 23.09.2026:
 * «добавь технарю заявку на удаление или изменение статуса — отправлять к
 * ОС»). Технарь в такой строке статус не меняет и строку не удаляет (это
 * держит база), поэтому просит — а решает ОС этого заказа.
 *
 * Один документ на строку-заказ: id = стол технаря + строка. Повторная
 * просьба перезаписывает прежнюю, а не копит их. Правила: пишет технарь за
 * себя и только `pending`; решает ОС этого заказа (или руководство) — только
 * `state` и отметки о решении; читают трое — технарь, ОС и руководство.
 * «Успешка» живёт своим путём (`successRequestedAt` на строке) и сюда не
 * переносится.
 */

export type OrderRequestKind = "delete" | "status";
export type OrderRequestState = "pending" | "approved" | "rejected";

export interface OrderRequest {
  id: string;
  workspaceId: string;
  kind: OrderRequestKind;
  /** Для `status` — какой статус просят (значение варианта) и его подпись. */
  status: string | null;
  statusLabel: string | null;
  /** Почему — пишет технарь. */
  note: string;
  techUid: string;
  techName: string;
  osUid: string;
  client: string;
  /** Строка-копия в столе технаря. */
  deskPageId: string;
  deskTabId: string | null;
  rowId: string;
  /** Строка-источник на столе ОС. */
  srcPageId: string;
  srcTabId: string | null;
  srcRowId: string;
  state: OrderRequestState;
  createdAt: number;
  resolvedAt: number | null;
  resolvedBy: string | null;
}

export const ORDER_REQUEST_NOTE_MAX = 300;

function requestsCol(workspaceId: string) {
  if (!db) throw new Error("Firebase не настроен");
  return collection(db, "workspaces", workspaceId, "orderRequests");
}

export function orderRequestId(deskPageId: string, rowId: string): string {
  return `${deskPageId}_${rowId}`.replace(/[^A-Za-z0-9_-]/g, "");
}

export type NewOrderRequest = Omit<OrderRequest, "id" | "workspaceId" | "state" | "createdAt" | "resolvedAt" | "resolvedBy">;

/** Технарь просит ОС. Уведомление уходит ОС этого заказа. */
export async function submitOrderRequest(workspaceId: string, input: NewOrderRequest): Promise<void> {
  const id = orderRequestId(input.deskPageId, input.rowId);
  const now = Date.now();
  const data: Omit<OrderRequest, "id"> = {
    ...input,
    note: input.note.trim().slice(0, ORDER_REQUEST_NOTE_MAX),
    workspaceId,
    state: "pending",
    createdAt: now,
    resolvedAt: null,
    resolvedBy: null,
  };
  await setDoc(doc(requestsCol(workspaceId), id), data);
  const what = input.kind === "delete" ? "удалить заказ" : `статус «${input.statusLabel ?? input.status ?? ""}»`;
  await sendNotification(
    {
      workspaceId,
      title: `Технарь просит: ${what}`,
      body: `${input.techName}${input.client ? ` · ${input.client}` : ""}${input.note.trim() ? ` · ${input.note.trim()}` : ""}`,
      priority: "important",
      fromUid: input.techUid,
      fromName: input.techName,
      target: "selected",
      selectedUids: [input.osUid],
      pageId: input.srcPageId,
      href: `/page/${input.srcPageId}`,
      kind: "order-request",
    },
    [input.osUid]
  ).catch(() => undefined);
}

/** Отозвать свою просьбу, пока её не рассмотрели. */
export async function withdrawOrderRequest(workspaceId: string, id: string): Promise<void> {
  await deleteDoc(doc(requestsCol(workspaceId), id));
}

export async function fetchOrderRequest(workspaceId: string, id: string): Promise<OrderRequest | null> {
  const snap = await getDoc(doc(requestsCol(workspaceId), id));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as OrderRequest) : null;
}

/** ОС решил. Технарю — уведомление с итогом. */
export async function resolveOrderRequest(
  workspaceId: string,
  request: OrderRequest,
  approved: boolean,
  me: { uid: string; name: string }
): Promise<void> {
  await updateDoc(doc(requestsCol(workspaceId), request.id), {
    state: approved ? "approved" : "rejected",
    resolvedAt: Date.now(),
    resolvedBy: me.uid,
  });
  const what = request.kind === "delete" ? "удалить заказ" : `статус «${request.statusLabel ?? request.status ?? ""}»`;
  await sendNotification(
    {
      workspaceId,
      title: approved ? `ОС принял: ${what}` : `ОС отклонил: ${what}`,
      body: request.client || "Заказ",
      priority: "normal",
      fromUid: me.uid,
      fromName: me.name,
      target: "selected",
      selectedUids: [request.techUid],
      pageId: request.deskPageId,
      href: `/page/${request.deskPageId}`,
      kind: "order-request",
    },
    [request.techUid]
  ).catch(() => undefined);
}

/** Ожидающие запросы к этому ОС — живой список (два равенства, индекс не нужен). */
export function subscribePendingOrderRequests(
  workspaceId: string,
  osUid: string,
  onData: (requests: OrderRequest[]) => void,
  onError: (error: Error) => void
): () => void {
  const q = query(requestsCol(workspaceId), where("osUid", "==", osUid), where("state", "==", "pending"));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as OrderRequest).sort((a, b) => a.createdAt - b.createdAt)),
    onError
  );
}
