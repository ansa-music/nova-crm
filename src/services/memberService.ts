import { deleteDoc, deleteField, getDoc, getDocs, onSnapshot, query, runTransaction, setDoc, where, writeBatch } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths, withErrorReporting } from "@/firebase/firestore";
import { COLOR_PRESETS } from "@/components/common/ColorPicker";
import { displayNameOf } from "@/utils/displayName";
import { generateId } from "@/utils/id";
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

/** The ОС nick as shown everywhere: its «Ответственный» option's current label, else the saved nick. */
export function osNickLabel(
  member: Pick<WorkspaceMember, "osNick" | "osNickValue"> | null | undefined,
  responsibleOptions: StatusOption[] | undefined
): string | null {
  if (!member?.osNickValue) return null;
  const option = responsibleOptions?.find((o) => o.value === member.osNickValue);
  return option?.label.trim() || member.osNick?.trim() || null;
}

/**
 * Pins an ОС account to its nick — an option of the shared «Ответственный»
 * list — or unpins it (`target` null). Тимлид/Owner only: the self-service
 * member rule doesn't allow these fields. Existing options are never renamed
 * or removed: nicks already in the list may sit on months of orders, and
 * pinning one makes all of them this ОС's at once.
 *   { optionValue } — an option already in the list;
 *   { newNick }     — reuses an option with that name, else appends one
 *                     (with the ОС's old value if the Owner had deleted it).
 * Returns the pinned option value.
 */
export async function linkMemberOsNick(input: {
  workspaceId: string;
  uid: string;
  target: { optionValue: string } | { newNick: string } | null;
  members: WorkspaceMember[];
}): Promise<string | null> {
  if (!db) return null;
  const workspaceRef = paths.workspace(input.workspaceId);
  const memberRef = paths.member(input.workspaceId, input.uid);
  return runTransaction(db, async (tx) => {
    const workspaceSnap = await tx.get(workspaceRef);
    const memberSnap = await tx.get(memberRef);
    if (!memberSnap.exists()) throw new Error("Участник не найден");
    const member = memberSnap.data() as WorkspaceMember;
    if (!input.target) {
      tx.set(memberRef, { osNick: deleteField(), osNickValue: deleteField() }, { merge: true });
      return null;
    }
    const options = (workspaceSnap.data() as Partial<Workspace> | undefined)?.responsibleOptions ?? [];
    let option: StatusOption | undefined;
    let appended = false;
    if ("optionValue" in input.target) {
      const value = input.target.optionValue;
      option = options.find((o) => o.value === value);
      if (!option) throw new Error("Этого ника уже нет в списке «Ответственный»");
    } else {
      const nick = input.target.newNick.trim().slice(0, OS_NICK_MAX_LENGTH);
      if (!nick) throw new Error("Введите ник");
      const lower = nick.toLowerCase();
      option = options.find((o) => o.label.trim().toLowerCase() === lower);
      if (!option) {
        const oldValueFree =
          member.osNickValue &&
          !options.some((o) => o.value === member.osNickValue) &&
          (member.osNick ?? "").trim().toLowerCase() === lower;
        option = {
          value: oldValueFree ? member.osNickValue! : generateId("opt"),
          label: nick,
          color: COLOR_PRESETS[options.length % COLOR_PRESETS.length],
        };
        appended = true;
      }
    }
    const takenBy = input.members.find((m) => m.uid !== input.uid && m.osNickValue === option!.value);
    if (takenBy) throw new Error(`Ник «${option.label}» уже закреплён за другим ОС: ${displayNameOf(takenBy)}`);
    if (appended) {
      tx.set(workspaceRef, { responsibleOptions: [...options, option] }, { merge: true });
    } else if (option.inactive) {
      // Ник закрепили за живым аккаунтом — значит он снова в работе, и прятать
      // его в «Неактуальных» больше незачем. Ключ УДАЛЯЕМ: `undefined` внутри
      // элемента массива роняет запись целиком (ignoreUndefinedProperties у нас
      // выключен), а `false` осталось бы мусором во всех документах.
      const revived = options.map((o) => {
        if (o.value !== option!.value) return o;
        const next = { ...o };
        delete next.inactive;
        return next;
      });
      tx.set(workspaceRef, { responsibleOptions: revived }, { merge: true });
    }
    tx.set(memberRef, { osNick: option.label, osNickValue: option.value }, { merge: true });
    return option.value;
  });
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
