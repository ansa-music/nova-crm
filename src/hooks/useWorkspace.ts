// PATH: src/hooks/useWorkspace.ts  (REPLACES EXISTING)
import { useEffect, useRef } from "react";
import { subscribeToUserWorkspaces } from "@/services/workspaceService";
import { fetchMembers, findOwnMembership, mergeOwnMember, subscribeToOwnMember } from "@/services/memberService";
import { subscribeToPages } from "@/services/pageService";
import { useAuthStore } from "@/store/authStore";
import { useBootstrapStore } from "@/store/bootstrapStore";
import { useWorkspaceStore } from "@/store/workspaceStore";
import type { WorkspaceMember, WorkspacePage } from "@/types";

/** Subscribes to the list of workspaces the current user belongs to. Call once near the app root. */
export function useWorkspaceListBootstrap() {
  const uid = useAuthStore((s) => s.firebaseUser?.uid);
  const profileResolved = useBootstrapStore((s) => s.profileResolved);
  const setWorkspaces = useWorkspaceStore((s) => s.setWorkspaces);
  const setLoadingWorkspaces = useWorkspaceStore((s) => s.setLoadingWorkspaces);
  const setActiveWorkspaceId = useWorkspaceStore((s) => s.setActiveWorkspaceId);

  useEffect(() => {
    const { setWorkspaceListResolved } = useBootstrapStore.getState();

    if (!uid) {
      setWorkspaces([]);
      setLoadingWorkspaces(false);
      setWorkspaceListResolved(false);
      return;
    }

    // Wait for the profile before subscribing: subscribeToUserWorkspaces reads
    // users/{uid}.workspaceIds, and firing it before ensureUserProfile() has
    // created that doc is one of the ways the list came back empty on a first
    // ever sign-in and never self-corrected without a reload.
    if (!profileResolved) return;

    setLoadingWorkspaces(true);
    setWorkspaceListResolved(false);

    const unsubscribe = subscribeToUserWorkspaces(uid, (workspaces) => {
      setWorkspaces(workspaces);
      setLoadingWorkspaces(false);

      // Read activeWorkspaceId from the store at callback time instead of
      // closing over a render-time value — the old closure captured a stale id
      // and could "correct" a perfectly valid selection to workspaces[0],
      // which is the "opens the wrong workspace" bug.
      const currentActiveId = useWorkspaceStore.getState().activeWorkspaceId;
      const stillValid = workspaces.some((w) => w.id === currentActiveId);
      if (!stillValid) setActiveWorkspaceId(workspaces.length > 0 ? workspaces[0].id : null);

      // Only NOW is "do I have any workspaces" a real answer.
      setWorkspaceListResolved(true);
    });

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, profileResolved]);
}

/**
 * What the members bootstrap last saw from each of its two sources: the
 * one-shot roster read and the live own-member doc. It lives OUTSIDE the
 * effect so refreshWorkspaceMembers() can write the refreshed roster into the
 * same cell.
 *
 * It used to be two `let`s inside the effect, and publishMembers() re-emitted
 * them on every own-member snapshot. The presence heartbeat (authService
 * rewrites lastActiveAt on your own member doc) fires that snapshot on a
 * timer, so any roster change made after page load — unpinning someone's ОС
 * nick, a role change, a removal — was published once by
 * refreshWorkspaceMembers and then overwritten by the roster captured at load,
 * within seconds and with no action from the user. For the ОС nick that reads
 * as "открепил, а ник вернулся": the Firestore write did land.
 */
const membersCache: {
  workspaceId: string | null;
  roster: WorkspaceMember[];
  ownMember: WorkspaceMember | null;
} = { workspaceId: null, roster: [], ownMember: null };

/** Структурное сравнение без учёта порядка ключей: снимок Firestore не обещает тот же порядок полей. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, i) => deepEqual(value, b[i]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && deepEqual(left[key], right[key]));
}

/**
 * Новый own-member снимок отличается от прошлого ТОЛЬКО `lastActiveAt` —
 * то есть это пульс присутствия, а не правка роли/ника/extraRoles.
 * Такой снимок не публикуется новым массивом `members`: каждый эффект,
 * зависящий от [members] (включая useOwnerDeskRecount), перезапускался по
 * таймеру пульса, раньше каждые 3 минуты, и тянул за собой лишние чтения.
 * Первый снимок (prev === null) и исчезновение документа (next === null)
 * публикуются всегда.
 */
function differsOnlyInPresence(prev: WorkspaceMember | null, next: WorkspaceMember | null): boolean {
  if (!prev || !next) return false;
  const a: Partial<WorkspaceMember> = { ...prev };
  const b: Partial<WorkspaceMember> = { ...next };
  delete a.lastActiveAt;
  delete b.lastActiveAt;
  return deepEqual(a, b);
}

/** Subscribes to members + pages of whichever workspace is currently active. Call once in the app layout. */
export function useActiveWorkspaceDataBootstrap() {
  const uid = useAuthStore((s) => s.firebaseUser?.uid);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const workspaceListResolved = useBootstrapStore((s) => s.workspaceListResolved);
  const setResolvedDataWorkspaceId = useBootstrapStore((s) => s.setResolvedDataWorkspaceId);
  const setMembers = useWorkspaceStore((s) => s.setMembers);
  const setPages = useWorkspaceStore((s) => s.setPages);
  const setLoadingWorkspaceData = useWorkspaceStore((s) => s.setLoadingWorkspaceData);
  const setMembersLoadState = useWorkspaceStore((s) => s.setMembersLoadState);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;
  const isConfirmedActive = Boolean(activeWorkspaceId && activeWorkspace);
  const isOwnerOfActive = Boolean(activeWorkspace && uid && activeWorkspace.ownerId === uid);

  // Guards against a late snapshot from a workspace we already switched away
  // from marking the NEW workspace as resolved.
  const generationRef = useRef(0);

  useEffect(() => {
    if (!workspaceListResolved) return;

    const generation = ++generationRef.current;

    if (!isConfirmedActive || !activeWorkspaceId) {
      membersCache.workspaceId = null;
      membersCache.roster = [];
      membersCache.ownMember = null;
      setMembers([]);
      setPages([]);
      setMembersLoadState("loading");
      setLoadingWorkspaceData(false);
      setResolvedDataWorkspaceId(null);
      return;
    }

    setLoadingWorkspaceData(true);
    setMembersLoadState("loading");
    useWorkspaceStore.getState().setRosterWorkspaceId(null);
    // Clear immediately so the phase drops back to "workspace-data" the moment
    // a switch starts, instead of briefly reporting ready with stale members.
    setResolvedDataWorkspaceId(null);

    let membersLoaded = false;
    let pagesLoaded = false;

    function maybeDone() {
      if (generation !== generationRef.current) return; // superseded
      if (membersLoaded && pagesLoaded) {
        setLoadingWorkspaceData(false);
        // Members carry the ROLE and pages carry ACCESS — permissions are only
        // meaningful once both have landed. This is the single gate that stops
        // "нет доступа" from rendering against an empty members array.
        setResolvedDataWorkspaceId(activeWorkspaceId);
      }
    }

    const hangTimer = window.setTimeout(() => {
      if (generation !== generationRef.current) return;
      if (!membersLoaded) {
        // Boot must not sit on «Проверяем вход…» / workspace-data forever.
        // An unconfirmed empty list is NOT "not a member" — permissions stay unresolved.
        setMembersLoadState("unconfirmed");
        membersLoaded = true;
      }
      if (!pagesLoaded) pagesLoaded = true;
      maybeDone();
    }, 10000);

    // Full roster is a one-shot read (presence lastActiveAt lives on these docs).
    // Live listener is only the current user's member doc — needed for access/role.
    membersCache.workspaceId = activeWorkspaceId;
    membersCache.roster = [];
    membersCache.ownMember = null;
    // Membership positively CONFIRMED by either source. Once true, a later
    // listener error must not drag the state back to "unconfirmed" — for a
    // non-owner that would switch every capability in usePermissions off.
    let membersConfirmed = false;
    function publishMembers() {
      setMembers(mergeOwnMember(membersCache.roster, membersCache.ownMember));
    }
    function confirmMembers() {
      membersConfirmed = true;
      setMembersLoadState("ready");
      membersLoaded = true;
      maybeDone();
    }

    void fetchMembers(activeWorkspaceId)
      .then((list) => {
        if (generation !== generationRef.current) return;
        membersCache.roster = list;
        publishMembers();
        useWorkspaceStore.getState().setRosterWorkspaceId(activeWorkspaceId);
        // The roster read is independent proof of membership: its Firestore
        // rule requires isMember(workspaceId), so a successful list that
        // contains this uid means the account IS a member — regardless of
        // what the own-member listener did. This is what actually resolved
        // the role before the listener's denial path was corrected, and
        // without it a denied own-member snapshot leaves a fully authorized
        // Технарь with isResolved=false, i.e. no rights anywhere: can't
        // create a desk, can't add/rename/drag columns on their own desk.
        if (!membersConfirmed && uid && findOwnMembership(list, uid)) confirmMembers();
      })
      .catch((error) => {
        if (generation !== generationRef.current) return;
        console.error(`fetchMembers failed for workspace ${activeWorkspaceId}:`, error);
      });

    const unsubMembers = uid
      ? subscribeToOwnMember(
          activeWorkspaceId,
          uid,
          (own) => {
            if (generation !== generationRef.current) return;
            const prevOwn = membersCache.ownMember;
            // Кэш обновляем всегда — следующая публикация (дочитанный ростер,
            // refreshWorkspaceMembers, правка роли) возьмёт свежий lastActiveAt.
            // А сам массив members пульс больше не пересобирает — см.
            // differsOnlyInPresence.
            membersCache.ownMember = own;
            if (!differsOnlyInPresence(prevOwn, own)) publishMembers();
            confirmMembers();
          },
          (error) => {
            if (generation !== generationRef.current) return;
            console.error(`subscribeToOwnMember denied for workspace ${activeWorkspaceId}:`, error.code, error.message);
            // permission-denied ≠ signed out and ≠ "not a member". Keep boot
            // moving, but never downgrade a membership the roster already
            // confirmed — "unconfirmed" turns every capability off for a
            // non-owner, so claiming it after we have proof would lock a
            // legitimate member out of their own desk.
            if (membersConfirmed) return;
            setMembersLoadState("unconfirmed");
            membersLoaded = true;
            maybeDone();
          }
        )
      : () => {};

    const unsubPages = subscribeToPages(
      activeWorkspaceId,
      (pages) => {
        if (generation !== generationRef.current) return;
        setPages(pages);
        pagesLoaded = true;
        maybeDone();
      },
      (error) => {
        if (generation !== generationRef.current) return;
        console.error(`subscribeToPages denied for workspace ${activeWorkspaceId}:`, error.code, error.message);
        // Keep last pages. A denied list must not look like logout / wipe data.
        pagesLoaded = true;
        maybeDone();
      },
      uid,
      isOwnerOfActive
    );

    return () => {
      window.clearTimeout(hangTimer);
      unsubMembers();
      unsubPages();
    };
  }, [
    activeWorkspaceId,
    isConfirmedActive,
    isOwnerOfActive,
    workspaceListResolved,
    uid,
    setMembers,
    setPages,
    setLoadingWorkspaceData,
    setMembersLoadState,
    setResolvedDataWorkspaceId,
  ]);
}

const deskSplitCache = new WeakMap<WorkspacePage[], { active: WorkspacePage[]; inactive: WorkspacePage[]; os: WorkspacePage[] }>();

/** Active desks vs «Неактуальные», cached per snapshot so every caller shares the same arrays. */
/**
 * Столы ОС отделяются ЗДЕСЬ, одним местом на всё приложение: `pages` читают
 * «Столы», дашборд, «Технари», месячные вкладки, квота и график, и попади
 * стол ОС в этот список — он всплыл бы во всех шести сразу.
 */
function splitDesks(all: WorkspacePage[]) {
  let split = deskSplitCache.get(all);
  if (!split) {
    split = {
      active: all.filter((p) => !p.inactive && !p.osDesk),
      inactive: all.filter((p) => p.inactive && !p.osDesk),
      os: all.filter((p) => p.osDesk),
    };
    deskSplitCache.set(all, split);
  }
  return split;
}

export function useWorkspace() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActiveWorkspaceId = useWorkspaceStore((s) => s.setActiveWorkspaceId);
  const members = useWorkspaceStore((s) => s.members);
  const allPages = useWorkspaceStore((s) => s.pages);
  const { active: pages, inactive: inactivePages, os: osDesks } = splitDesks(allPages);
  const isLoadingWorkspaces = useWorkspaceStore((s) => s.isLoadingWorkspaces);
  const isLoadingWorkspaceData = useWorkspaceStore((s) => s.isLoadingWorkspaceData);
  const membersLoadState = useWorkspaceStore((s) => s.membersLoadState);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;

  return {
    workspaces,
    activeWorkspace,
    activeWorkspaceId,
    setActiveWorkspaceId,
    members,
    /** Active desks only — «Неактуальные» are left out everywhere by default. */
    pages,
    /** Desks retired to «Неактуальные». */
    inactivePages,
    /** «Столы ОС» — личные таблицы ОС, к работе технарей отношения не имеют. */
    osDesks,
    /** Every desk, retired ones included (opening a retired desk by link). */
    allPages,
    isLoadingWorkspaces,
    isLoadingWorkspaceData,
    membersLoadState,
  };
}

export async function refreshWorkspaceMembers(workspaceId: string) {
  const list = await fetchMembers(workspaceId);
  // Feed the bootstrap's cache too, or the next own-member snapshot that
  // publishes (any change beyond the heartbeat's lastActiveAt — those no
  // longer republish) re-emits the roster from page load and undoes this
  // refresh.
  if (membersCache.workspaceId === workspaceId) membersCache.roster = list;
  const uid = useAuthStore.getState().firebaseUser?.uid;
  const email = useAuthStore.getState().profile?.email;
  // The freshly read list wins — that is the entire point of a refresh. This
  // used to consult the store FIRST, and since mergeOwnMember spreads `own`
  // over the matching row, the stale copy overwrote the very fields the
  // caller had just changed. Deleted fields were the worst case: the fresh
  // row simply has no `osNick` key, so the stale spread put it straight back
  // and unpinning your own ОС nick never appeared to work at all.
  // The live own-member doc is the fallback, for a roster read that cannot
  // see the caller's own row; the store is the last resort.
  const own =
    findOwnMembership(list, uid, email) ??
    membersCache.ownMember ??
    findOwnMembership(useWorkspaceStore.getState().members, uid, email);
  useWorkspaceStore.getState().setMembers(mergeOwnMember(list, own));
  if (useWorkspaceStore.getState().activeWorkspaceId === workspaceId) {
    useWorkspaceStore.getState().setRosterWorkspaceId(workspaceId);
  }
}
