import { getDoc, getDocs, onSnapshot, query, runTransaction, setDoc, where } from "firebase/firestore";
import type { FirestoreError } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths, subscribeToDoc } from "@/firebase/firestore";
import {
  assertNickFree,
  assertSameNick,
  NICK_KIND_META,
  nickOptionsOf,
  pushMemberToRowsAcl,
  NICK_MAX_LENGTH,
  resolveNickOption,
  type NickKind,
  type NickTarget,
} from "@/services/memberService";
import type { JoinRequest, JoinRequestRole, Role, Workspace, WorkspaceMember } from "@/types";
import { realNameOf } from "@/utils/displayName";
import { withDbTimeout } from "@/utils/dbError";

/** Если человек роль не выбрал (старые заявки) — предлагаем Технаря, как было раньше. */
export const DEFAULT_JOIN_ROLE: Role = "manager";

/**
 * Какой ник положен роли при одобрении — ник её раздела «Команды»: Технарь —
 * ник технаря, ОС — ник ОС, Тимлид/Admin/Viewer — ник «Другие». Owner через
 * заявку не выдаётся (в `RoleSelect` его нет).
 */
export function nickKindForRole(role: Role): NickKind | null {
  if (role === "owner") return null;
  return role === "manager" ? "tech" : role === "os" ? "os" : "other";
}

/** Minimal public info shown on the /join/:workspaceId page before the person is a member. */
export async function getPublicWorkspaceInfo(workspaceId: string): Promise<Workspace | null> {
  if (!db) return null;
  try {
    const snap = await getDoc(paths.workspace(workspaceId));
    return snap.exists() ? ({ id: snap.id, ...snap.data() } as Workspace) : null;
  } catch (error) {
    console.error("getPublicWorkspaceInfo failed:", error);
    return null;
  }
}

export function subscribeToPublicWorkspaceInfo(
  workspaceId: string,
  onData: (workspace: Workspace | null) => void
) {
  return subscribeToDoc<Workspace>(paths.workspace(workspaceId), onData);
}

/**
 * Заявка на вход — её пишет сам человек. Новый пользователь приходит БЕЗ
 * роли: он выбирает, кем работает (Технарь или ОС), и ник, если он у него
 * уже есть. Решает Тимлид или выше — может одобрить как есть или поменять.
 * Документ пишется ЦЕЛИКОМ (без merge): правило проверяет точный набор ключей.
 */
export async function submitJoinRequest(
  workspaceId: string,
  uid: string,
  email: string,
  name: string,
  photoURL?: string | null,
  wish?: { role: JoinRequestRole; nick?: string }
): Promise<JoinRequest> {
  if (!db) throw new Error("Firebase не настроен");
  const nick = wish?.nick?.trim().slice(0, NICK_MAX_LENGTH) ?? "";
  const request: JoinRequest = {
    id: uid,
    uid,
    email: email.trim().toLowerCase(),
    name,
    photoURL: photoURL ?? null,
    workspaceId,
    status: "pending",
    requestedAt: Date.now(),
    ...(wish ? { requestedRole: wish.role } : {}),
    ...(nick ? { requestedNick: nick } : {}),
  };
  await setDoc(paths.joinRequest(workspaceId, uid), request);
  return request;
}

/** So the requester's own UI can show "your request is pending / was rejected". */
export function subscribeToOwnJoinRequest(
  workspaceId: string,
  uid: string,
  onData: (request: JoinRequest | null) => void,
  onError?: (error: FirestoreError) => void
) {
  return subscribeToDoc<JoinRequest>(paths.joinRequest(workspaceId, uid), onData, onError);
}

/**
 * Только заявки «на рассмотрении». Раньше выборка шла по всей коллекции и
 * отсеивала рассмотренные на клиенте: у руководства («Ждут вас» на дашборде,
 * «Пользователи») каждый холодный вход читал все заявки за всё время, хотя
 * показываются только ждущие. Правило чтения — `hasFullAccess` (Owner и
 * Тимлид) — от фильтра не зависит; одно равенство составного индекса не просит.
 */
function pendingJoinRequestsQuery(workspaceId: string) {
  return query(paths.joinRequests(workspaceId), where("status", "==", "pending"));
}

function mapPending(docs: { id: string; data: () => unknown }[]): JoinRequest[] {
  return docs
    .map((d) => ({ id: d.id, ...(d.data() as object) }) as unknown as JoinRequest)
    .filter((r) => r.status === "pending")
    .sort((a, b) => a.requestedAt - b.requestedAt);
}

/** Owner-only: list of everyone currently waiting to be let in. */
export async function fetchJoinRequests(workspaceId: string): Promise<JoinRequest[]> {
  const snap = await getDocs(pendingJoinRequestsQuery(workspaceId));
  return mapPending(snap.docs);
}

export function subscribeJoinRequests(workspaceId: string, cb: (rows: JoinRequest[]) => void) {
  if (!db) {
    cb([]);
    return () => {};
  }
  return onSnapshot(
    pendingJoinRequestsQuery(workspaceId),
    (snap) => cb(mapPending(snap.docs)),
    // Отказ — это «не знаем», а не «заявок нет»: последний список остаётся.
    (error) => console.error("subscribeJoinRequests denied:", error.code, error.message)
  );
}

/**
 * Одобрить заявку: создать участника с ролью (и ником, если он положен
 * роли), дописать новый ник в список и закрыть заявку — ОДНОЙ транзакцией.
 * Раньше это были три записи подряд, и сбой между ними оставлял участника с
 * заявкой «на рассмотрении»: человек так и не узнавал, что его пустили.
 *
 * Отказывает, если участник уже есть (даже Owner): одобрение поверх живого
 * участника молча понизило бы ему роль. И если заявку уже рассмотрели —
 * второй Тимлид в соседней вкладке не должен её переиграть.
 */
export async function approveJoinRequest(input: {
  workspaceId: string;
  request: JoinRequest;
  role: Role;
  /** Ник для роли (Технарь/ОС); null — без ника. */
  nick: NickTarget | null;
  approvedBy: string;
  /** Список участников на клиенте — для проверки «ник уже у другого». */
  members: WorkspaceMember[];
}): Promise<{ nickLabel: string | null }> {
  if (!db) throw new Error("Firebase не настроен");
  const { workspaceId, request } = input;
  const kind = nickKindForRole(input.role);
  const workspaceRef = paths.workspace(workspaceId);
  const memberRef = paths.member(workspaceId, request.uid);
  const stubRef = paths.member(workspaceId, request.email);
  const requestRef = paths.joinRequest(workspaceId, request.uid);
  // Свободен ли ник — свежим запросом к серверу (см. assertNickFree): список
  // участников в браузере не живой, а занятый ник ОС открыл бы новичку чужие
  // заказы и оценки.
  const expectedValue = kind && input.nick
    ? await assertNickFree({ workspaceId, kind, target: input.nick, selfUid: request.uid })
    : null;
  const result = await withDbTimeout(runTransaction(db, async (tx) => {
    const workspaceSnap = await tx.get(workspaceRef);
    const memberSnap = await tx.get(memberRef);
    const stubSnap = request.email ? await tx.get(stubRef) : null;
    const requestSnap = await tx.get(requestRef);
    if (memberSnap.exists()) {
      throw new Error(
        `${request.name} уже состоит в этом workspace (роль: ${(memberSnap.data() as WorkspaceMember).role}). Обновите список участников.`
      );
    }
    if (!requestSnap.exists() || (requestSnap.data() as JoinRequest).status !== "pending") {
      throw new Error("Эту заявку уже рассмотрели — обновите страницу");
    }

    const now = Date.now();
    const member: WorkspaceMember = {
      uid: request.uid,
      email: request.email,
      name: request.name,
      photoURL: request.photoURL ?? null,
      role: input.role,
      status: "active",
      invitedAt: request.requestedAt,
      invitedBy: input.approvedBy,
      joinedAt: now,
    };
    let nickLabel: string | null = null;
    if (kind && input.nick) {
      const meta = NICK_KIND_META[kind];
      const options = nickOptionsOf(workspaceSnap.data() as Partial<Workspace> | undefined, kind);
      const { option, nextOptions } = resolveNickOption(options, input.nick);
      assertSameNick(option, options.some((o) => o.value === option.value), expectedValue);
      const takenBy = input.members.find((m) => m.uid !== request.uid && m[meta.value] === option.value);
      if (takenBy) throw new Error(`Ник «${option.label}» уже закреплён за ${realNameOf(takenBy)}`);
      if (nextOptions) tx.set(workspaceRef, { [meta.list]: nextOptions }, { merge: true });
      Object.assign(member, { [meta.label]: option.label, [meta.value]: option.value });
      nickLabel = option.label;
    }
    tx.set(memberRef, member);
    // Приглашение по почте на того же человека теряет смысл — он уже внутри.
    if (stubSnap?.exists() && (stubSnap.data() as WorkspaceMember).status === "invited") tx.delete(stubRef);
    tx.set(
      requestRef,
      {
        status: "approved",
        approvedRole: input.role,
        approvedNick: nickLabel,
        resolvedAt: now,
        resolvedBy: input.approvedBy,
      },
      { merge: true }
    );
    return { nickLabel };
  }), "Одобрение заявки");
  // Строки в Supabase: новичок попадает в копию прав сразу — иначе свой
  // стол он открыл бы только после сверки у руководства.
  await pushMemberToRowsAcl(workspaceId, request.uid);
  return result;
}

/** Отклонить: участник не создаётся, человек может подать заявку снова. */
export async function rejectJoinRequest(workspaceId: string, uid: string, resolvedBy?: string) {
  if (!db) return;
  await setDoc(
    paths.joinRequest(workspaceId, uid),
    { status: "rejected", resolvedAt: Date.now(), ...(resolvedBy ? { resolvedBy } : {}) },
    { merge: true }
  );
}
