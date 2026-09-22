import { arrayRemove, arrayUnion, doc, getDoc, setDoc } from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import type { AppUser } from "@/types";

/** Ensures a `users/{uid}` profile document exists after sign-in. */
export async function ensureUserProfile(user: User): Promise<AppUser> {
  if (!db) throw new Error("Firebase не настроен");
  const ref = paths.user(user.uid);
  const snapshot = await getDoc(ref);
  if (snapshot.exists()) {
    return snapshot.data() as AppUser;
  }
  const profile: AppUser = {
    uid: user.uid,
    email: user.email ?? "",
    name: user.displayName ?? user.email?.split("@")[0] ?? "Пользователь",
    photoURL: user.photoURL ?? null,
    createdAt: Date.now(),
    workspaceIds: [],
  };
  // Date.now() here, not serverTimestamp() — createdAt is typed `number` on
  // AppUser and gets read back both by this function's own existing-doc
  // branch (snapshot.data() as AppUser) and by useAuth.ts's live
  // subscribeToDoc<AppUser> listener. A serverTimestamp() sentinel resolves
  // to a Firestore Timestamp object once persisted, silently mismatching
  // that number type on every later read.
  await setDoc(ref, profile);
  return profile;
}

export async function updateUserDoc(uid: string, patch: Partial<AppUser>) {
  if (!db) return;
  await setDoc(doc(paths.users(), uid), patch, { merge: true });
}

/**
 * Best-effort: after a person sets/changes their nickname, sync it onto
 * their own member doc in every workspace they already belong to (each
 * write is self-service — allowed by rules to touch only the nickname
 * field on one's own member record). Any single workspace failing here
 * (e.g. a stale id) is silently skipped, never blocks the others.
 */
export async function syncNicknameToMemberships(uid: string, workspaceIds: string[], nickname: string) {
  await Promise.all(
    workspaceIds.map(async (workspaceId) => {
      try {
        await setDoc(paths.member(workspaceId, uid), { nickname }, { merge: true });
      } catch (error) {
        console.error(`Failed to sync nickname to workspace ${workspaceId}:`, error);
      }
    })
  );
}

/**
 * То же, что syncNicknameToMemberships, но для личной аватарки: ссылка из
 * `users/{uid}` разъезжается по member-документам, потому что ростер
 * участников читают из них, а не из чужих профилей — без этой синхронизации
 * человек видел бы новое фото только у себя.
 *
 * `null` стирает фото. Правило members пускает `photoURL` в self-service
 * список — ровно это поле и только на своём документе.
 */
export async function syncPhotoToMemberships(uid: string, workspaceIds: string[], photoURL: string | null) {
  await Promise.all(
    workspaceIds.map(async (workspaceId) => {
      try {
        await setDoc(paths.member(workspaceId, uid), { photoURL }, { merge: true });
      } catch (error) {
        console.error(`Failed to sync avatar to workspace ${workspaceId}:`, error);
      }
    })
  );
}

/**
 * Presence heartbeat: refreshes `lastActiveAt` on the person's own member
 * doc in every workspace they belong to. Called periodically while the app
 * is open (see usePresenceHeartbeat) — never blocks on failure.
 *
 * `at` приходит от хука: он же пишет это время в межвкладочный штамп
 * `nova:beat:{uid}`, и оба должны совпадать с тем, что легло в документ.
 * Возвращает true, если запись дошла хотя бы в один workspace, — только
 * тогда хук ставит штамп. «Хотя бы один», а не «все»: устаревший id в
 * workspaceIds отказывал бы вечно и навсегда отключал общие на вкладки
 * ворота, а с ними — всю экономию записей.
 */
export async function updatePresenceHeartbeat(uid: string, workspaceIds: string[], at: number = Date.now()): Promise<boolean> {
  const results = await Promise.all(
    workspaceIds.map(async (workspaceId) => {
      try {
        await setDoc(paths.member(workspaceId, uid), { lastActiveAt: at }, { merge: true });
        return true;
      } catch (error) {
        console.error(`Failed to update presence heartbeat for workspace ${workspaceId}:`, error);
        return false;
      }
    })
  );
  return results.some(Boolean);
}

/**
 * Self-service only (the rules only allow a user to write their own doc):
 * call this as the person who just gained membership, right after their own
 * member doc was created (workspace creation, invite acceptance, or a
 * join-request they see flip to "approved").
 */
export async function addOwnWorkspaceId(uid: string, workspaceId: string) {
  if (!db) return;
  await setDoc(doc(paths.users(), uid), { workspaceIds: arrayUnion(workspaceId) }, { merge: true });
}

/** Self-service removal — call as the person leaving/losing access. */
export async function removeOwnWorkspaceId(uid: string, workspaceId: string) {
  if (!db) return;
  await setDoc(doc(paths.users(), uid), { workspaceIds: arrayRemove(workspaceId) }, { merge: true });
}
