import { arrayRemove, arrayUnion, doc, getDoc, onSnapshot, setDoc } from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "@/firebase/firebase";
import { getDocResumable, paths } from "@/firebase/firestore";
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

/**
 * Профиль для СТАРТА: сначала из кэша Firestore на диске, сервер — только при
 * промахе. Раньше вход ждал `getDoc` с сервера (открытие канала + чтение,
 * 0,3–1 с до первого экрана), хотя свежую версию профиля и так привозит живая
 * подписка `useAuth` сразу следом. Снимок из кэша годится только, чтобы
 * РИСОВАТЬ (правило про `fromCache` в CLAUDE.md): решения по профилю —
 * приглашения, синхронизация ника — `useAuth` принимает по серверному снимку.
 *
 * Сделано подпиской, а не `getDocFromCache`: первый снимок `onSnapshot` из
 * кэша приходит так же быстро, цель подписки общая с живой подпиской профиля
 * (второго чтения нет), а стенд-харнес `getDocFromCache` не знает.
 * Кэш сказал «документа нет» (или кэша нет вовсе и сеть молчит) — ведём себя
 * по-старому: `ensureUserProfile` с сервера, он же создаёт профиль при первом
 * входе. С сервера пришло «нет» — тоже он: создание только там.
 */
export function ensureUserProfileCacheFirst(user: User): Promise<{ profile: AppUser; fromCache: boolean }> {
  if (!db) return Promise.reject(new Error("Firebase не настроен"));
  const ref = paths.user(user.uid);
  return new Promise((resolve, reject) => {
    let done = false;
    let unsubscribe: (() => void) | null = null;
    const release = () => {
      // Отписка с запасом, а не сразу: `useAuth` вешает живую подписку на
      // этот же документ следом за ответом. Пока эта ещё висит, цель у них
      // общая, и SDK не делает второго Listen — иначе после перерыва дольше
      // ~30 минут (resume-токен протух) снятие и новый Listen списали бы
      // документ профиля дважды.
      const stop = unsubscribe;
      if (stop) window.setTimeout(stop, 1500);
    };
    const finish = () => {
      done = true;
      release();
    };
    const fallbackToServer = () => {
      finish();
      ensureUserProfile(user).then((profile) => resolve({ profile, fromCache: false }), reject);
    };
    unsubscribe = onSnapshot(
      ref,
      { includeMetadataChanges: true },
      (snapshot) => {
        if (done) return;
        if (snapshot.exists()) {
          finish();
          resolve({ profile: snapshot.data() as AppUser, fromCache: snapshot.metadata.fromCache });
          return;
        }
        fallbackToServer();
      },
      () => {
        if (done) return;
        // Отказ подписки (правила, сеть) — пусть ответит старый путь: у него
        // понятная ошибка для экрана загрузки.
        fallbackToServer();
      }
    );
    if (done) release();
  });
}

/**
 * Итог серверного чтения профиля. `unreachable` — база не ответила (нет сети
 * или соединение «висит»: `getDocResumable` отдаёт `unavailable` по таймауту);
 * `failed` — ответила отказом/ошибкой; `missing` — документа на сервере нет.
 */
export type FreshProfileResult =
  | { profile: AppUser; failure: null }
  | { profile: null; failure: "unreachable" | "failed" | "missing" };

/**
 * Свежий профиль с сервера (resumable: без изменений — без списания).
 * Причину неудачи возвращает, а не глотает: при старте из кэша это
 * ЕДИНСТВЕННАЯ проверка, что база вообще отвечает (`useAuth` по ней
 * предупреждает человека, что он смотрит на данные с устройства).
 */
export async function fetchUserProfileFresh(uid: string): Promise<FreshProfileResult> {
  try {
    const snapshot = await getDocResumable(paths.user(uid));
    return snapshot.exists()
      ? { profile: snapshot.data() as AppUser, failure: null }
      : { profile: null, failure: "missing" };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
    return { profile: null, failure: code === "unavailable" || code === "deadline-exceeded" ? "unreachable" : "failed" };
  }
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
 * Самолечение ника при входе — пишет ТОЛЬКО там, где ник в своём
 * member-документе отличается. Раньше вход безусловно переписывал ник во всех
 * workspace: запись на каждую перезагрузку, и каждая «пачкала» member-документ —
 * любое resumable-чтение ростера потом платило за него снова.
 * Документ читается resumable-подпиской: цель та же, что у живой подписки
 * своего участника (`useWorkspace`), без изменений сервер её не списывает.
 * Нет документа (не участник) — не пишем: merge создал бы его, и правила
 * всё равно отказали бы.
 */
export async function syncNicknameIfChanged(uid: string, workspaceIds: string[], nickname: string) {
  await Promise.all(
    workspaceIds.map(async (workspaceId) => {
      try {
        const snapshot = await getDocResumable(paths.member(workspaceId, uid));
        if (!snapshot.exists()) return;
        if ((snapshot.data() as { nickname?: string | null }).nickname === nickname) return;
        await setDoc(paths.member(workspaceId, uid), { nickname }, { merge: true });
      } catch (error) {
        console.error(`Failed to self-heal nickname in workspace ${workspaceId}:`, error);
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
