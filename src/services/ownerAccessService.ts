import { getDoc, getDocs, setDoc } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { normalizeTimestamp } from "@/utils/date";
import { pingInboxChanged } from "@/utils/inboxEvents";
import { sendNotification } from "@/services/notificationService";
import { changeMemberRole } from "@/services/memberService";
import { ROLE_LABELS, type OwnerAccessRequest, type Role } from "@/types";

/**
 * Ключ доступа из «Настройки → Ключ доступа».
 *
 * Ключ по умолчанию — пока Owner не задал свой (`ownerAccess/key`). Он в
 * публичном репозитории, поэтому Owner может сменить его в «Настройках»: новый
 * лежит в документе, который читает только Owner, а заявка несёт лишь хеш
 * `sha256("{workspaceId}:{ключ}")`, и правило `ownerAccessRequests` сверяет его
 * с хешем в документе (нет документа — с хешем ключа по умолчанию). Ключ
 * всё равно не даёт прав сам — роль выдаёт Owner, подтверждая заявку.
 */
export const OWNER_ACCESS_KEY = "21122005";
export const OWNER_ACCESS_KEY_MIN = 4;
export const OWNER_ACCESS_KEY_MAX = 64;

/** Пробелы по краям и внутри игнорируем — ключ часто вставляют копипастой. */
export function normalizeOwnerAccessKey(input: string): string {
  return input.replace(/\s+/g, "");
}

export async function ownerAccessKeyHash(workspaceId: string, key: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${workspaceId}:${normalizeOwnerAccessKey(key)}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface OwnerAccessKeyInfo {
  /** Текущий ключ; `custom: false` — действует ключ по умолчанию. */
  key: string;
  custom: boolean;
  updatedAt: number | null;
  updatedByName: string | null;
}

/** Текущий ключ — только Owner (правило `ownerAccess`). */
export async function fetchOwnerAccessKey(workspaceId: string): Promise<OwnerAccessKeyInfo> {
  if (!db) return { key: OWNER_ACCESS_KEY, custom: false, updatedAt: null, updatedByName: null };
  const snap = await getDoc(paths.ownerAccessKey(workspaceId));
  if (!snap.exists()) return { key: OWNER_ACCESS_KEY, custom: false, updatedAt: null, updatedByName: null };
  const data = snap.data() as { key?: string; updatedAt?: unknown; updatedByName?: string };
  return {
    key: String(data.key ?? ""),
    custom: true,
    updatedAt: data.updatedAt ? normalizeTimestamp(data.updatedAt as number) : null,
    updatedByName: data.updatedByName ?? null,
  };
}

/** Сменить ключ — только Owner. Старые заявки остаются, новые проходят только с новым ключом. */
export async function setOwnerAccessKey(input: {
  workspaceId: string;
  key: string;
  actorUid: string;
  actorName: string;
}) {
  if (!db) throw new Error("Firebase не настроен");
  const key = normalizeOwnerAccessKey(input.key);
  if (key.length < OWNER_ACCESS_KEY_MIN) throw new Error(`Ключ — не короче ${OWNER_ACCESS_KEY_MIN} символов`);
  if (key.length > OWNER_ACCESS_KEY_MAX) throw new Error(`Ключ — не длиннее ${OWNER_ACCESS_KEY_MAX} символов`);
  await setDoc(paths.ownerAccessKey(input.workspaceId), {
    key,
    hash: await ownerAccessKeyHash(input.workspaceId, key),
    updatedAt: Date.now(),
    updatedByUid: input.actorUid,
    updatedByName: input.actorName,
  });
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
  if (!normalizeOwnerAccessKey(input.key)) throw new Error("Введите ключ доступа");
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
    keyHash: await ownerAccessKeyHash(input.workspaceId, input.key),
    grantedRole: null,
  };
  try {
    await setDoc(paths.ownerAccessRequest(input.workspaceId, input.fromUid), row);
  } catch (error) {
    // Ключ сверяет правило (текущий ключ знает только Owner), поэтому неверный
    // ключ приходит отказом прав.
    if ((error as { code?: string })?.code === "permission-denied") throw new Error("Неверный ключ доступа");
    throw error;
  }
  await sendNotification(
    {
      workspaceId: input.workspaceId,
      title: `${input.fromName} ввёл ключ доступа`,
      body: "Ключ введён верно. Выберите роль в «Настройки → Ключ доступа» или отклоните.",
      priority: "urgent",
      fromUid: input.fromUid,
      fromName: input.fromName,
      target: "selected",
      href: "/settings?tab=access-key",
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
 * Подтверждение/отказ — только Owner. При подтверждении Owner выбирает роль
 * (`role`, по умолчанию Owner) — ключ не обязан давать именно Owner.
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
  /** Какую роль выдать при подтверждении. */
  role?: Role;
  /** Нынешние доп. роли человека — новая основная не может остаться доп. ролью. */
  currentExtraRoles?: Role[];
  actorUid: string;
  actorName: string;
}) {
  if (!db) throw new Error("Firebase не настроен");
  const role: Role = input.role ?? "owner";
  if (input.status === "approved") {
    await changeMemberRole(input.workspaceId, input.request.fromUid, role, input.currentExtraRoles);
  }
  await setDoc(
    paths.ownerAccessRequest(input.workspaceId, input.request.fromUid),
    {
      status: input.status,
      updatedAt: Date.now(),
      resolvedByUid: input.actorUid,
      resolvedByName: input.actorName,
      grantedRole: input.status === "approved" ? role : null,
    },
    { merge: true }
  );
  await sendNotification(
    {
      workspaceId: input.workspaceId,
      title:
        input.status === "approved"
          ? role === "owner"
            ? "Вам выдали права Owner"
            : `Вам выдали роль «${ROLE_LABELS[role] ?? role}»`
          : "Запрос по ключу доступа отклонён",
      body:
        input.status === "approved"
          ? "Доступ открыт. Обновите страницу, если меню ещё старое."
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

/**
 * Забрать права Owner — ТИХО: уведомление человеку не уходит (просьба Nurba).
 * Главного Owner (`workspace.ownerId`) и себя не трогаем — у первого права
 * идут от документа workspace и роль их не снимет, а себя снять — остаться
 * без Owner-экрана посреди действия.
 */
export async function revokeOwnerRole(input: {
  workspaceId: string;
  uid: string;
  role: Role;
  currentExtraRoles?: Role[];
  workspaceOwnerId?: string | null;
  actorUid: string;
}) {
  if (input.role === "owner") return;
  if (input.uid === input.workspaceOwnerId) throw new Error("Это главный Owner workspace — его права не снимаются");
  if (input.uid === input.actorUid) throw new Error("Свои права Owner снять нельзя");
  await changeMemberRole(input.workspaceId, input.uid, input.role, input.currentExtraRoles);
}
