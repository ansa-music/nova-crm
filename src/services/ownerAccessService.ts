import { getDoc, getDocs, setDoc } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { normalizeTimestamp } from "@/utils/date";
import { pingInboxChanged } from "@/utils/inboxEvents";
import { sendNotification } from "@/services/notificationService";
import { changeMemberRole } from "@/services/memberService";
import type { OwnerAccessRequest } from "@/types";

/**
 * Ключ доступа из «Настройки → Ключ доступа».
 *
 * Это НЕ секрет и не граница безопасности: репозиторий публичный, так что
 * ключ виден всем, кто откроет исходники. Он лишь открывает кнопку «отправить
 * запрос» — реальные права Owner выдаёт только сам Owner, подтверждая заявку
 * в колокольчике, а записать `members/{uid}.role = 'owner'` по firestore.rules
 * может опять же только Owner. Поэтому утечка ключа в худшем
 * случае стоит лишнего запроса в уведомлениях, а не чужого доступа.
 */
export const OWNER_ACCESS_KEY = "21122005";

/** Пробелы по краям и внутри игнорируем — ключ часто вставляют копипастой. */
export function isOwnerAccessKey(input: string): boolean {
  return input.replace(/\s+/g, "") === OWNER_ACCESS_KEY;
}

function mapRequest(data: Record<string, unknown>, id: string): OwnerAccessRequest {
  const row = { id, ...data } as OwnerAccessRequest;
  return {
    ...row,
    createdAt: normalizeTimestamp(row.createdAt),
    updatedAt: normalizeTimestamp(row.updatedAt),
  };
}

/** Своя заявка (id документа = uid). Разовое чтение — экран настроек второстепенный, постоянный listener ему не нужен. */
export async function fetchMyOwnerAccessRequest(
  workspaceId: string,
  uid: string
): Promise<OwnerAccessRequest | null> {
  if (!db) return null;
  const snap = await getDoc(paths.ownerAccessRequest(workspaceId, uid));
  if (!snap.exists()) return null;
  return mapRequest(snap.data(), snap.id);
}

/** Все заявки workspace — читает только Owner (правило `ownerAccessRequests`). */
export async function fetchOwnerAccessRequests(workspaceId: string): Promise<OwnerAccessRequest[]> {
  if (!db) return [];
  const snap = await getDocs(paths.ownerAccessRequests(workspaceId));
  return snap.docs
    .map((d) => mapRequest(d.data(), d.id))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Ввод ключа: пишет заявку и шлёт уведомление всем Owner workspace.
 *
 * Список Owner приходит от вызывающего (у него уже есть roster) — если он
 * пуст, заявку не пишем вовсе: висящий запрос, которого никто не увидит,
 * хуже честной ошибки.
 */
export async function requestOwnerAccess(input: {
  workspaceId: string;
  key: string;
  fromUid: string;
  fromName: string;
  fromEmail: string;
  ownerUids: string[];
  existing?: OwnerAccessRequest | null;
}): Promise<OwnerAccessRequest> {
  if (!db) throw new Error("Firebase не настроен");
  if (!isOwnerAccessKey(input.key)) throw new Error("Неверный ключ доступа");
  if (input.existing?.status === "pending") return input.existing;
  const targets = input.ownerUids.filter((uid) => uid && uid !== input.fromUid);
  if (targets.length === 0) throw new Error("В workspace не найден Owner, некому отправить запрос");

  const now = Date.now();
  const row: OwnerAccessRequest = {
    id: input.fromUid,
    workspaceId: input.workspaceId,
    fromUid: input.fromUid,
    fromName: input.fromName,
    fromEmail: input.fromEmail,
    status: "pending",
    createdAt: input.existing?.createdAt ?? now,
    updatedAt: now,
    resolvedByUid: null,
    resolvedByName: null,
  };
  await setDoc(paths.ownerAccessRequest(input.workspaceId, input.fromUid), row);
  await sendNotification(
    {
      workspaceId: input.workspaceId,
      title: `${input.fromName} просит права Owner`,
      body: "Ключ доступа введён верно. Выдать полный доступ Owner или отклонить?",
      priority: "urgent",
      fromUid: input.fromUid,
      fromName: input.fromName,
      target: "selected",
      href: "/users",
      kind: "owner-request",
      ownerRequestId: input.fromUid,
    },
    targets
  ).catch(() => {
    /* заявка уже сохранена — уведомление вторично */
  });
  pingInboxChanged();
  return row;
}

/**
 * Подтверждение/отказ — только Owner.
 *
 * Роль пишем ДО смены статуса, по тому же уроку, что и в
 * `resolveDeskViewRequest`: настоящий доступ — это `role: 'owner'` в member-
 * документе, заявка лишь след в истории, а кнопки в колокольчике живут, пока
 * заявка `pending`. Упавшая выдача прав при обратном порядке оставила бы
 * заявку навсегда «approved» без прав и без кнопки, которую можно нажать ещё раз.
 */
export async function resolveOwnerAccessRequest(input: {
  workspaceId: string;
  request: OwnerAccessRequest;
  status: "approved" | "denied";
  actorUid: string;
  actorName: string;
}) {
  if (!db) throw new Error("Firebase не настроен");
  if (input.status === "approved") {
    await changeMemberRole(input.workspaceId, input.request.fromUid, "owner");
  }
  await setDoc(
    paths.ownerAccessRequest(input.workspaceId, input.request.fromUid),
    {
      status: input.status,
      updatedAt: Date.now(),
      resolvedByUid: input.actorUid,
      resolvedByName: input.actorName,
    },
    { merge: true }
  );
  await sendNotification(
    {
      workspaceId: input.workspaceId,
      title: input.status === "approved" ? "Вам выдали права Owner" : "Запрос на права Owner отклонён",
      body:
        input.status === "approved"
          ? "Полный доступ открыт. Обновите страницу, если меню ещё старое."
          : "Owner отклонил запрос по ключу доступа.",
      priority: input.status === "approved" ? "important" : "normal",
      fromUid: input.actorUid,
      fromName: input.actorName,
      target: "selected",
      href: "/settings",
      kind: "owner-request-result",
      ownerRequestId: input.request.fromUid,
    },
    [input.request.fromUid]
  ).catch(() => {
    /* статус уже записан */
  });
  pingInboxChanged();
}
