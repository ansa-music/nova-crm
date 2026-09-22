import {
  deleteDoc,
  deleteField,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  onSnapshot,
  query,
  runTransaction,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths, withErrorReporting } from "@/firebase/firestore";
import { COLOR_PRESETS } from "@/components/common/ColorPicker";
import { displayNameOf, realNameOf } from "@/utils/displayName";
import { generateId } from "@/utils/id";
import { withDbTimeout } from "@/utils/dbError";
import { addOwnWorkspaceId } from "@/services/authService";
import { EXTRA_ROLES, type Role, type StatusOption, type Workspace, type WorkspaceMember } from "@/types";

function sortMembers(members: WorkspaceMember[]) {
  return members.sort((a, b) => a.invitedAt - b.invitedAt);
}

export function normalizeMemberEmail(email?: string | null): string {
  return email?.trim().toLowerCase() ?? "";
}

/** Hide invite stubs that already have an active member or a pending join on the same email. */
export function visibleMemberRoster(
  members: WorkspaceMember[],
  pendingJoinEmails: Iterable<string>
): WorkspaceMember[] {
  const joinEmails = new Set(Array.from(pendingJoinEmails, normalizeMemberEmail).filter(Boolean));
  const activeEmails = new Set(
    members
      .filter((m) => m.status === "active")
      .map((m) => normalizeMemberEmail(m.email))
      .filter(Boolean)
  );
  const seenInvited = new Set<string>();
  const out: WorkspaceMember[] = [];
  for (const member of members) {
    if (member.status !== "invited") {
      out.push(member);
      continue;
    }
    const email = normalizeMemberEmail(member.email);
    if (!email || seenInvited.has(email)) continue;
    if (joinEmails.has(email) || activeEmails.has(email)) continue;
    seenInvited.add(email);
    out.push(member);
  }
  return out;
}

export const QUIET_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** Active members silent for 7 days. lastActiveAt, else joinedAt. Not presence (10 min). */
export function quietActiveMembers(
  members: WorkspaceMember[],
  myUid?: string | null,
  now = Date.now()
): WorkspaceMember[] {
  return members
    .filter((m) => {
      if (m.status !== "active") return false;
      if (myUid && m.uid && m.uid === myUid) return false;
      const ts = m.lastActiveAt || m.joinedAt;
      if (!ts) return false;
      return now - ts > QUIET_AFTER_MS;
    })
    .sort((a, b) => (a.lastActiveAt || a.joinedAt || 0) - (b.lastActiveAt || b.joinedAt || 0));
}


export async function fetchMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  const snapshot = await getDocs(paths.members(workspaceId));
  return sortMembers(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as WorkspaceMember));
}

/**
 * Live listener for THIS user's membership only (role, hidden pages, simulation).
 * Does not listen to the rest of the members collection — presence heartbeats
 * on other docs would otherwise fan out a billed snapshot to every client.
 */
/** Backoff before re-attaching the own-member listener after a failed snapshot. */
const OWN_MEMBER_RETRY_DELAYS_MS = [1500, 4000, 10000];

export function subscribeToOwnMember(
  workspaceId: string,
  uid: string,
  onData: (member: WorkspaceMember | null) => void,
  onError?: (error: import("firebase/firestore").FirestoreError) => void
) {
  let cancelled = false;
  let emittedOnce = false;
  let attempt = 0;
  let unsubscribe: (() => void) | null = null;
  let retryTimer: number | null = null;

  function attach() {
    unsubscribe = onSnapshot(
      paths.member(workspaceId, uid),
      (snapshot) => {
        if (cancelled) return;
        // Same race as the old collection listener: a missing cache doc is not "not a member".
        if (snapshot.metadata.fromCache && !snapshot.exists() && !emittedOnce) {
          return;
        }
        emittedOnce = true;
        attempt = 0;
        onData(snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as unknown as WorkspaceMember) : null);
      },
      (error) => {
        if (cancelled) return;
        // A denied read is NOT the same fact as "this account has no member
        // row". It used to be reported through onData(null) — the SUCCESS
        // path — which made useWorkspace mark members as CONFIRMED-ready with
        // no member data at all, so findOwnMembership found nothing and the
        // role silently fell back to "viewer": a fully authorized Технарь saw
        // «нет доступа» / read-only everywhere. The Owner never reproduced it
        // because usePermissions short-circuits them via isOwnerOfWorkspace
        // (read off the workspace doc, not the member doc). Current rules do
        // allow reading your own member doc even when it doesn't exist, so a
        // denial here means something anomalous (usually the auth token not
        // attached yet on a cold boot) — report it as unconfirmed and retry,
        // never as an authoritative "no membership".
        //
        // onSnapshot does not re-attach itself after an error, so without
        // this retry an unconfirmed state was terminal until a full reload.
        unsubscribe?.();
        unsubscribe = null;
        const delay = OWN_MEMBER_RETRY_DELAYS_MS[attempt];
        if (delay !== undefined) {
          attempt += 1;
          retryTimer = window.setTimeout(() => {
            retryTimer = null;
            if (!cancelled) attach();
          }, delay);
        }
        withErrorReporting(onError)(error);
      }
    );
  }

  attach();

  return () => {
    cancelled = true;
    if (retryTimer !== null) window.clearTimeout(retryTimer);
    unsubscribe?.();
  };
}

/**
 * Resolve THIS signed-in account's member row.
 * Must prefer uid. Matching any row with the same email (old `find` OR) lets an
 * email-keyed invite stub (uid "", role viewer) win over the real uid-keyed
 * owner/admin doc — after Users panel refetches the roster, canAccessPage then
 * treats the signed-in user as a Viewer and every table looks locked.
 */
export function findOwnMembership(
  members: WorkspaceMember[],
  uid?: string | null,
  email?: string | null
): WorkspaceMember | null {
  const normalizedEmail = email?.trim().toLowerCase() || "";
  if (uid) {
    const active = members.find((m) => m.uid === uid && m.status !== "invited");
    if (active) return active;
  }
  if (!normalizedEmail) return null;
  // Invite stubs are email-keyed and have no uid / status invited — never treat them as the signed-in row.
  return (
    members.find(
      (m) =>
        Boolean(m.uid) &&
        m.status !== "invited" &&
        m.email?.trim().toLowerCase() === normalizedEmail &&
        (!uid || m.uid === uid)
    ) ?? null
  );
}

export function mergeOwnMember(members: WorkspaceMember[], own: WorkspaceMember | null): WorkspaceMember[] {
  if (!own) return members;
  let idx = own.uid ? members.findIndex((m) => m.uid === own.uid) : -1;
  if (idx === -1 && own.email) {
    const email = own.email.trim().toLowerCase();
    idx = members.findIndex((m) => !m.uid && m.email?.trim().toLowerCase() === email);
  }
  if (idx === -1) return sortMembers([...members, own]);
  const next = members.slice();
  next[idx] = { ...next[idx], ...own };
  return next;
}

/** Creates a pending invite, keyed temporarily by email until the user signs in. */
export async function inviteMember(
  workspaceId: string,
  email: string,
  role: Role,
  invitedBy: string
) {
  if (!db) throw new Error("Firebase не настроен");
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) throw new Error("Введите email");
  const existing = (await fetchMembers(workspaceId)).find(
    (m) => m.email?.trim().toLowerCase() === normalizedEmail
  );
  if (existing) {
    throw new Error(
      existing.status === "invited"
        ? "Этому email уже отправлено приглашение"
        : "Этот email уже в workspace"
    );
  }
  // Email-keyed stub: no uid field. Empty uid:"" made findOwnMembership treat
  // the invite as a real row and locked tables after claim.
  const member: Omit<WorkspaceMember, "uid"> = {
    email: normalizedEmail,
    name: normalizedEmail.split("@")[0],
    role,
    status: "invited",
    invitedAt: Date.now(),
    invitedBy,
    inviteToken: generateId("inv"),
  };
  await setDoc(paths.member(workspaceId, normalizedEmail), member);
  return member as WorkspaceMember;
}


/** Delete an email-keyed invite stub only. Never members/{uid} and never uid "". */
export async function cancelInvite(workspaceId: string, email: string) {
  if (!db) return;
  const normalized = email.trim().toLowerCase();
  if (!normalized) throw new Error("Нет email для отмены приглашения");
  const snap = await getDoc(paths.member(workspaceId, normalized));
  const data = snap.exists() ? (snap.data() as WorkspaceMember) : null;
  if (!data || data.status !== "invited") {
    throw new Error("Приглашение не найдено");
  }
  await deleteDoc(snap.ref);
}

/** After approve/claim: drop leftover members/{email} invite stub if it is still invited. */
export async function deleteInvitedStubIfPresent(workspaceId: string, email: string, keepUid?: string) {
  if (!db) return;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;
  if (keepUid && normalized === keepUid) return;
  const snap = await getDoc(paths.member(workspaceId, normalized));
  if (!snap.exists()) return;
  const data = snap.data() as WorkspaceMember;
  if (data.status !== "invited") return;
  await deleteDoc(snap.ref);
}

export async function resendInvite(workspaceId: string, email: string) {
  if (!db) return;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;
  await setDoc(
    paths.member(workspaceId, normalized),
    { invitedAt: Date.now(), inviteToken: generateId("inv") },
    { merge: true }
  );
}

export async function changeMemberRole(workspaceId: string, uid: string, role: Role, currentExtraRoles?: Role[]) {
  if (!db) return;
  // The new main role can't stay an add-on as well.
  const extrasPatch: { extraRoles?: Role[] } =
    currentExtraRoles?.includes(role)
      ? { extraRoles: (currentExtraRoles.filter((r) => r !== role).length ? currentExtraRoles.filter((r) => r !== role) : deleteField()) as Role[] }
      : {};
  if (role === "manager") {
    const pagesSnap = await getDocs(paths.pages(workspaceId));
    const pages = pagesSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as Array<{
      id: string;
      responsibleUserId?: string | null;
    }>;
    const own = pages.filter((page) => page.responsibleUserId === uid);
    if (own.length > 1) {
      throw new Error("Сначала заберите лишние столы — у технаря может быть только один свой стол");
    }
    const only = own.length === 1 ? own[0] : undefined;
    if (only) {
      const batch = writeBatch(db);
      batch.set(paths.member(workspaceId, uid), { role, ...extrasPatch }, { merge: true });
      batch.set(paths.managerPageClaim(workspaceId, uid), {
        uid,
        pageId: only.id,
        createdAt: Date.now(),
      });
      await batch.commit();
      return;
    }
  }
  await setDoc(paths.member(workspaceId, uid), { role, ...extrasPatch }, { merge: true });
}

/**
 * Add-on roles (Технарь, ОС) on top of the main one — Owner + Технарь, Тимлид +
 * Технарь, Тимлид + ОС. Owner/Тимлид only, and a Тимлид never on their own
 * doc (firestore.rules). A Тимлид/ОС/Viewer who becomes a Технарь with exactly
 * one own desk gets the one-desk claim, same as changeMemberRole(manager).
 */
export async function setMemberExtraRoles(workspaceId: string, uid: string, mainRole: Role, extraRoles: Role[]) {
  if (!db) return;
  const next = EXTRA_ROLES.filter((r) => r !== mainRole && extraRoles.includes(r));
  const patch = { extraRoles: (next.length ? next : deleteField()) as Role[] };
  if (next.includes("manager") && mainRole !== "owner" && mainRole !== "admin") {
    const pagesSnap = await getDocs(paths.pages(workspaceId));
    const own = pagesSnap.docs.filter((d) => (d.data() as { responsibleUserId?: string | null }).responsibleUserId === uid);
    if (own.length === 1) {
      const batch = writeBatch(db);
      batch.set(paths.member(workspaceId, uid), patch, { merge: true });
      batch.set(paths.managerPageClaim(workspaceId, uid), { uid, pageId: own[0].id, createdAt: Date.now() });
      await batch.commit();
      return;
    }
  }
  await setDoc(paths.member(workspaceId, uid), patch, { merge: true });
}

export const OS_NICK_MAX_LENGTH = 32;
export const NICK_MAX_LENGTH = OS_NICK_MAX_LENGTH;

/**
 * Три вида ников с ОДНОЙ моделью — по разделам «Команды»: ник ОС живёт в
 * «Ответственном» (`responsibleOptions`, по нему считаются заказы ОС), ник
 * технаря — в своём списке `techNickOptions`, ник раздела «Другие» (Owner,
 * Admin, Тимлид без второй роли, Viewer) — в `otherNickOptions`. Смешивать
 * списки нельзя: любой столбец «Ответственный» считается ОС-столбцом, а
 * технари и «Другие» — разные разделы графика и «Технарей».
 */
export type NickKind = "os" | "tech" | "other";

export const NICK_KIND_META: Record<
  NickKind,
  {
    list: "responsibleOptions" | "techNickOptions" | "otherNickOptions";
    label: "osNick" | "techNick" | "otherNick";
    value: "osNickValue" | "techNickValue" | "otherNickValue";
    title: string;
    listName: string;
  }
> = {
  os: { list: "responsibleOptions", label: "osNick", value: "osNickValue", title: "Ник ОС", listName: "«Ответственный»" },
  tech: { list: "techNickOptions", label: "techNick", value: "techNickValue", title: "Ник технаря", listName: "«Ники технарей»" },
  other: { list: "otherNickOptions", label: "otherNick", value: "otherNickValue", title: "Ник", listName: "«Ники: другие»" },
};

export function nickOptionsOf(workspace: Partial<Workspace> | null | undefined, kind: NickKind): StatusOption[] {
  return (workspace?.[NICK_KIND_META[kind].list] as StatusOption[] | undefined) ?? [];
}

export function memberNickValue(member: Partial<WorkspaceMember> | null | undefined, kind: NickKind): string | null {
  return (member?.[NICK_KIND_META[kind].value] as string | undefined) || null;
}

/** Ник как его показывать: текущая подпись варианта, иначе сохранённая. */
export function nickLabelOf(
  member: Partial<WorkspaceMember> | null | undefined,
  kind: NickKind,
  options: StatusOption[] | undefined
): string | null {
  const value = memberNickValue(member, kind);
  if (!value) return null;
  const option = options?.find((o) => o.value === value);
  return option?.label.trim() || (member?.[NICK_KIND_META[kind].label] as string | undefined)?.trim() || null;
}

/** The ОС nick as shown everywhere: its «Ответственный» option's current label, else the saved nick. */
export function osNickLabel(
  member: Pick<WorkspaceMember, "osNick" | "osNickValue"> | null | undefined,
  responsibleOptions: StatusOption[] | undefined
): string | null {
  return nickLabelOf(member, "os", responsibleOptions);
}

export type NickTarget = { optionValue: string } | { newNick: string };

export const displayNameOfMember = displayNameOf;

/**
 * Свободен ли ник — по СВЕЖЕМУ запросу к серверу, а не по списку участников в
 * браузере: тот не живой, и ник, закреплённый другим руководителем минуту
 * назад, выглядел бы свободным. Два ОС с одним `osNickValue` читали бы заказы
 * и ставили оценки друг за друга (правила смотрят только на свой ник).
 * Запрос внутри транзакции SDK не умеет — поэтому здесь, прямо перед ней, а
 * транзакция сверяет, что ник всё тот же (`expectedValue`).
 *
 * Возвращает value существующего варианта, в который попадёт выбор, или null,
 * если ник будет новым (держателей у нового быть не может).
 */
export async function assertNickFree(input: {
  workspaceId: string;
  kind: NickKind;
  target: NickTarget;
  selfUid: string;
  previous?: { label?: string | null; value?: string | null } | null;
}): Promise<string | null> {
  if (!db) return null;
  const meta = NICK_KIND_META[input.kind];
  // Оба чтения — строго с сервера (кэш соврал бы про занятость), а значит,
  // без связи они висят: потолок ожидания обязателен.
  const workspaceSnap = await withDbTimeout(getDocFromServer(paths.workspace(input.workspaceId)), "Проверка ника");
  const options = nickOptionsOf(workspaceSnap.data() as Partial<Workspace> | undefined, input.kind);
  const { option } = resolveNickOption(options, input.target, input.previous);
  if (!options.some((o) => o.value === option.value)) return null;
  const holders = await withDbTimeout(
    getDocsFromServer(query(paths.members(input.workspaceId), where(meta.value, "==", option.value))),
    "Проверка ника"
  );
  const other = holders.docs.map((d) => d.data() as WorkspaceMember).find((m) => m.uid !== input.selfUid);
  if (other) throw new Error(`Ник «${option.label}» уже закреплён за ${realNameOf(other)}`);
  return option.value;
}

/** Ник в транзакции должен совпасть с тем, что проверили на свободу. */
export function assertSameNick(option: StatusOption, existedBefore: boolean, expectedValue: string | null) {
  if (existedBefore ? option.value !== expectedValue : expectedValue !== null) {
    throw new Error("Список ников только что изменился — попробуйте ещё раз");
  }
}

/**
 * Найти или завести вариант ника в списке. `{ optionValue }` — уже есть в
 * списке; `{ newNick }` — берём вариант с таким именем (без учёта регистра),
 * иначе дописываем новый (со СТАРЫМ value человека, если его вариант когда-то
 * удалили и имя совпало — тогда вернутся и его старые заказы). Неактуальный
 * вариант, закреплённый за живым человеком, снова актуален. `nextOptions` —
 * новый список, если его нужно записать, иначе null.
 */
export function resolveNickOption(
  options: StatusOption[],
  target: NickTarget,
  previous?: { label?: string | null; value?: string | null } | null
): { option: StatusOption; nextOptions: StatusOption[] | null } {
  if ("optionValue" in target) {
    const option = options.find((o) => o.value === target.optionValue);
    if (!option) throw new Error("Этого ника уже нет в списке");
    return { option, nextOptions: option.inactive ? reviveOption(options, option.value) : null };
  }
  const nick = target.newNick.trim().slice(0, NICK_MAX_LENGTH);
  if (!nick) throw new Error("Введите ник");
  const lower = nick.toLowerCase();
  const existing = options.find((o) => o.label.trim().toLowerCase() === lower);
  if (existing) return { option: existing, nextOptions: existing.inactive ? reviveOption(options, existing.value) : null };
  const oldValueFree =
    Boolean(previous?.value) &&
    !options.some((o) => o.value === previous!.value) &&
    (previous?.label ?? "").trim().toLowerCase() === lower;
  const option: StatusOption = {
    value: oldValueFree ? previous!.value! : generateId("opt"),
    label: nick,
    color: COLOR_PRESETS[options.length % COLOR_PRESETS.length],
  };
  return { option, nextOptions: [...options, option] };
}

/**
 * Ник закрепили за живым аккаунтом — значит он снова в работе, и прятать его
 * в «Неактуальных» больше незачем. Ключ УДАЛЯЕМ: `undefined` внутри элемента
 * массива роняет запись целиком (ignoreUndefinedProperties выключен), а
 * `false` осталось бы мусором во всех документах.
 */
function reviveOption(options: StatusOption[], value: string): StatusOption[] {
  return options.map((o) => {
    if (o.value !== value) return o;
    const next = { ...o };
    delete next.inactive;
    return next;
  });
}

/**
 * Закрепить за участником ник (любого вида) или открепить (`target`
 * null). Тимлид/Owner only: self-service правило участника эти поля не
 * пускает, а Тимлид не может поставить ник сам себе. Варианты в списке
 * никогда не переименовываются и не удаляются: на нике могут висеть месяцы
 * заказов. Возвращает value закреплённого варианта.
 *
 * «Ник уже у другого» проверяется по списку участников на клиенте — правила
 * уникальность не держат (как и у ников ОС).
 */
export async function linkMemberNick(input: {
  workspaceId: string;
  uid: string;
  kind: NickKind;
  target: NickTarget | null;
  members: WorkspaceMember[];
}): Promise<string | null> {
  if (!db) return null;
  const meta = NICK_KIND_META[input.kind];
  const workspaceRef = paths.workspace(input.workspaceId);
  const memberRef = paths.member(input.workspaceId, input.uid);
  const target = input.target;
  let expectedValue: string | null = null;
  if (target) {
    const current = input.members.find((m) => m.uid === input.uid);
    expectedValue = await assertNickFree({
      workspaceId: input.workspaceId,
      kind: input.kind,
      target,
      selfUid: input.uid,
      previous: current
        ? { label: current[meta.label] as string | undefined, value: current[meta.value] as string | undefined }
        : null,
    });
  }
  return withDbTimeout(runTransaction(db, async (tx) => {
    const workspaceSnap = await tx.get(workspaceRef);
    const memberSnap = await tx.get(memberRef);
    if (!memberSnap.exists()) throw new Error("Участник не найден");
    const member = memberSnap.data() as WorkspaceMember;
    if (!target) {
      tx.set(memberRef, { [meta.label]: deleteField(), [meta.value]: deleteField() }, { merge: true });
      return null;
    }
    const options = nickOptionsOf(workspaceSnap.data() as Partial<Workspace> | undefined, input.kind);
    const { option, nextOptions } = resolveNickOption(options, target, {
      label: member[meta.label] as string | undefined,
      value: member[meta.value] as string | undefined,
    });
    assertSameNick(option, options.some((o) => o.value === option.value), expectedValue);
    const takenBy = input.members.find((m) => m.uid !== input.uid && m[meta.value] === option.value);
    if (takenBy) throw new Error(`Ник «${option.label}» уже закреплён за ${realNameOf(takenBy)}`);
    if (nextOptions) tx.set(workspaceRef, { [meta.list]: nextOptions }, { merge: true });
    tx.set(memberRef, { [meta.label]: option.label, [meta.value]: option.value }, { merge: true });
    return option.value;
  }), "Ник");
}

/** Pins an ОС account to its «Ответственный» nick — see `linkMemberNick`. */
export async function linkMemberOsNick(input: {
  workspaceId: string;
  uid: string;
  target: NickTarget | null;
  members: WorkspaceMember[];
}): Promise<string | null> {
  return linkMemberNick({ ...input, kind: "os" });
}

/**
 * Завести свободный ник в списке — под него ещё нет аккаунта (человек
 * придёт позже и попросит его в заявке). Транзакцией: список пишется
 * целиком, и параллельная правка иначе потеряла бы чужой ник.
 */
export async function addNickOption(input: { workspaceId: string; kind: NickKind; label: string }): Promise<StatusOption> {
  if (!db) throw new Error("Firebase не настроен");
  const meta = NICK_KIND_META[input.kind];
  const workspaceRef = paths.workspace(input.workspaceId);
  return withDbTimeout(runTransaction(db, async (tx) => {
    const snap = await tx.get(workspaceRef);
    const options = nickOptionsOf(snap.data() as Partial<Workspace> | undefined, input.kind);
    const label = input.label.trim().slice(0, NICK_MAX_LENGTH);
    if (!label) throw new Error("Введите ник");
    if (options.some((o) => o.label.trim().toLowerCase() === label.toLowerCase())) {
      throw new Error(`Ник «${label}» уже есть в списке`);
    }
    const option: StatusOption = { value: generateId("opt"), label, color: COLOR_PRESETS[options.length % COLOR_PRESETS.length] };
    tx.set(workspaceRef, { [meta.list]: [...options, option] }, { merge: true });
    return option;
  }), "Новый ник");
}

/**
 * «В неактуальные» / «Вернуть» — вместо удаления: ник уходит из быстрого
 * выбора, но остаётся в заказах и подписях. Флаг при возврате УДАЛЯЕТСЯ.
 */
export async function setNickOptionInactive(input: {
  workspaceId: string;
  kind: NickKind;
  value: string;
  inactive: boolean;
}) {
  if (!db) throw new Error("Firebase не настроен");
  const meta = NICK_KIND_META[input.kind];
  const workspaceRef = paths.workspace(input.workspaceId);
  await withDbTimeout(runTransaction(db, async (tx) => {
    const snap = await tx.get(workspaceRef);
    const options = nickOptionsOf(snap.data() as Partial<Workspace> | undefined, input.kind);
    if (!options.some((o) => o.value === input.value)) throw new Error("Этого ника уже нет в списке");
    const next = input.inactive
      ? options.map((o) => (o.value === input.value ? { ...o, inactive: true } : o))
      : reviveOption(options, input.value);
    tx.set(workspaceRef, { [meta.list]: next }, { merge: true });
  }), "Неактуальный ник");
}

/**
 * "Переключение режима привилегий" — self-service, changes only how THIS
 * person's own client behaves (effectiveRole), never their real `role`.
 * Firestore Rules independently cap which values are accepted based on the
 * caller's real role, so this can never be used to self-escalate even via a
 * raw write. Pass `null` to stop simulating and return to the real role.
 */
export async function setActiveRole(workspaceId: string, uid: string, activeRole: Role | null) {
  if (!db) return;
  await setDoc(paths.member(workspaceId, uid), { activeRole }, { merge: true });
}

/** Toggles a page in/out of this member's OWN "hidden from my sidebar" list — purely personal, never affects access. */
export async function toggleHiddenPage(workspaceId: string, uid: string, pageId: string, hide: boolean, currentHiddenPageIds: string[]) {
  if (!db) return;
  const hiddenPageIds = hide
    ? Array.from(new Set([...currentHiddenPageIds, pageId]))
    : currentHiddenPageIds.filter((id) => id !== pageId);
  await setDoc(paths.member(workspaceId, uid), { hiddenPageIds }, { merge: true });
}

export async function removeMember(workspaceId: string, uid: string) {
  if (!db) return;
  await deleteDoc(paths.member(workspaceId, uid));
}

/**
 * ПОЛНОЕ удаление человека — только Owner (просьба Nurba).
 *
 * «Убрать из workspace» (`removeMember`) снимает доступ, но адрес остаётся в
 * следах: приглашение по почте, заявка на вход, тихое право наблюдателя. Тут
 * вычищается всё, что привязано к АДРЕСУ и аккаунту:
 *   - участник `members/{uid}`;
 *   - приглашение `members/{email}` (оно заведено по почте);
 *   - ВСЕ заявки на вход с этим адресом — и по uid, и по почте: человек мог
 *     подаваться с другого аккаунта на ту же почту;
 *   - `deskObservers/{uid}` — иначе, вернув человека, ему молча вернулись бы
 *     чужие столы на чтение.
 *
 * НЕ ТРОГАЕТ (так и просили): **стол** — он остаётся со своим
 * `responsibleUserId`, строками и вкладками, и **ник** — вариант остаётся в
 * списке workspace, а значит подписи и цвета в старых заказах резолвятся как
 * раньше. Доступа это не даёт: и `isResponsiblePage`, и ветка `allowedUsers`
 * в правилах требуют членства, а его больше нет.
 *
 * Всё одним `writeBatch`: половинчатое удаление (участника нет, а заявка
 * «одобрена» висит) — ровно то состояние, из-за которого человек потом не
 * может ни зайти, ни подать заявку заново.
 */
export interface FullDeleteResult {
  /** Что именно удалили — для честного тоста. */
  removed: { member: boolean; invite: boolean; joinRequests: number; observer: boolean };
}

export async function deleteMemberCompletely(input: {
  workspaceId: string;
  member: Pick<WorkspaceMember, "uid" | "email">;
}): Promise<FullDeleteResult> {
  if (!db) throw new Error("Firebase не настроен");
  const { workspaceId } = input;
  const uid = input.member.uid?.trim() ?? "";
  const email = normalizeMemberEmail(input.member.email);
  if (!uid && !email) throw new Error("У записи нет ни аккаунта, ни адреса — удалять нечего");

  // Заявки ищем ДО батча: запрос внутри него SDK не умеет.
  const requestDocs = new Map<string, ReturnType<typeof paths.joinRequest>>();
  if (uid) requestDocs.set(uid, paths.joinRequest(workspaceId, uid));
  if (email) {
    const byEmail = await withDbTimeout(
      getDocs(query(paths.joinRequests(workspaceId), where("email", "==", email))),
      "Заявки на вход"
    );
    for (const d of byEmail.docs) requestDocs.set(d.id, paths.joinRequest(workspaceId, d.id));
  }

  const batch = writeBatch(db);
  if (uid) batch.delete(paths.member(workspaceId, uid));
  if (email) batch.delete(paths.member(workspaceId, email));
  for (const ref of requestDocs.values()) batch.delete(ref);
  if (uid) batch.delete(paths.deskObserver(workspaceId, uid));
  await withDbTimeout(batch.commit(), "Удаление пользователя");

  return {
    removed: {
      member: Boolean(uid),
      invite: Boolean(email),
      joinRequests: requestDocs.size,
      observer: Boolean(uid),
    },
  };
}

/**
 * Called right after a successful sign-in: converts any pending
 * email-keyed invites that match this account into active memberships.
 */
export async function claimPendingInvites(
  uid: string,
  email: string,
  name: string,
  photoURL?: string | null,
  nickname?: string
) {
  if (!db) return;
  const normalizedEmail = email.trim().toLowerCase();
  const q = query(
    paths.memberGroup(),
    where("email", "==", normalizedEmail),
    where("status", "==", "invited")
  );
  const snapshot = await getDocs(q);
  await Promise.all(
    snapshot.docs.map(async (docSnap) => {
      const workspaceId = docSnap.ref.parent.parent?.id;
      if (!workspaceId) return;
      const data = docSnap.data() as WorkspaceMember;
      await setDoc(paths.member(workspaceId, uid), {
        ...data,
        uid,
        name: name || data.name,
        nickname: nickname ?? data.nickname ?? null,
        photoURL: photoURL ?? null,
        status: "active",
        joinedAt: Date.now(),
      });
      await addOwnWorkspaceId(uid, workspaceId);
      if (docSnap.id !== uid) {
        await deleteDoc(docSnap.ref);
      }
    })
  );
}
