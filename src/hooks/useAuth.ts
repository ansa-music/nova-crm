// PATH: src/hooks/useAuth.ts  (REPLACES EXISTING)
import { useEffect, useRef } from "react";
import {
  completeGoogleRedirectIfNeeded,
  subscribeToAuthChanges,
  wasGoogleRedirectPending,
} from "@/firebase/auth";
import { auth, isFirestoreCompatMode, reloadInCompatMode } from "@/firebase/firebase";
import {
  ensureUserProfileCacheFirst,
  fetchUserProfileFresh,
  syncNicknameIfChanged,
  type FreshProfileResult,
} from "@/services/authService";
import { claimPendingInvites } from "@/services/memberService";
import { paths, subscribeToDoc } from "@/firebase/firestore";
import { useAuthStore } from "@/store/authStore";
import { useBootstrapStore } from "@/store/bootstrapStore";
import { toast } from "@/components/ui/sonner";
import type { AppUser } from "@/types";

/**
 * Приглашения по почте ищутся collection-group запросом — это чтение на КАЖДЫЙ
 * вход, даже когда приглашений нет (пустой ответ тоже списывается). Человеку
 * без единого workspace ищем всегда (он ждёт именно приглашения), остальным —
 * не чаще раза в час: новое приглашение в ещё один workspace подождёт.
 */
const INVITES_CHECK_KEY = (uid: string) => `nova:invites-checked:${uid}`;
const INVITES_CHECK_EVERY_MS = 60 * 60 * 1000;

function invitesCheckDue(uid: string, workspaceIds: string[] | undefined): boolean {
  if (!workspaceIds?.length) return true;
  try {
    const at = Number(window.localStorage.getItem(INVITES_CHECK_KEY(uid)) ?? 0);
    return !(at > 0 && Date.now() - at < INVITES_CHECK_EVERY_MS);
  } catch {
    return true;
  }
}

function markInvitesChecked(uid: string) {
  try {
    window.localStorage.setItem(INVITES_CHECK_KEY(uid), String(Date.now()));
  } catch {
    /* без localStorage проверяем на каждом входе, как раньше */
  }
}

function errorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
}

/**
 * Поиск приглашений по почте. true — сделано (или не пора), false — не
 * вышло, стоит повторить. `quietOffline` — о связи человеку уже сказали
 * отдельным предупреждением, второй тост про то же не нужен.
 */
async function runInviteCheck(
  uid: string,
  basis: AppUser,
  quietOffline: boolean,
  stillHere: () => boolean
): Promise<boolean> {
  if (!invitesCheckDue(uid, basis.workspaceIds)) return true;
  try {
    await claimPendingInvites(uid, basis.email, basis.name, basis.photoURL, basis.nickname);
    markInvitesChecked(uid);
    return true;
  } catch (inviteError) {
    console.error("claimPendingInvites failed:", inviteError);
    const code = errorCode(inviteError);
    // Collection-group scan is denied unless rules match the query shape.
    // Don't scare Owner/members on every reload when there is no invite to claim.
    if (code === "permission-denied") {
      markInvitesChecked(uid);
      return true;
    }
    if (stillHere() && !(quietOffline && code === "unavailable")) {
      toast.error("Не удалось принять приглашение", {
        description: inviteError instanceof Error ? inviteError.message : "Обновите страницу или напишите Owner.",
      });
    }
    return false;
  }
}

const DB_UNREACHABLE_TOAST_ID = "nova:db-unreachable";
const SERVER_RETRY_PAUSE_MS = 15_000;

/**
 * Старт из кэша на диске не ждёт сервера, поэтому экран загрузки больше не
 * ловит «соединение есть, данных нет» (расширение-«ускоритель», прокси, сбой
 * узла Google — см. firebase.ts и AppBootScreen): приложение открывается на
 * данных с устройства, а записи Firestore копятся в локальной очереди и на
 * сервер не уходят. Человек должен об этом знать — как раньше на экране
 * загрузки, с той же кнопкой режима совместимости. И главное — не выходить:
 * выход стирает кэш вместе с очередью неотправленных правок.
 */
function showDbUnreachable() {
  toast.warning("База не отвечает — показаны данные с этого устройства", {
    id: DB_UNREACHABLE_TOAST_ID,
    duration: Infinity,
    description:
      "Правки дойдут до сервера, только когда связь вернётся, — не выходите из аккаунта, иначе они пропадут. " +
      "Проверьте интернет; если он есть, а база молчит, помогает DNS от Google или VPN, а расширения-«ускорители» стоит отключить для этого сайта.",
    action: {
      label: isFirestoreCompatMode ? "Обновить страницу" : "Обновить в режиме совместимости",
      onClick: reloadInCompatMode,
    },
  });
}

/**
 * Повторяет серверное чтение профиля, пока база не ответит (или пока вход
 * не сменился). Каждая попытка — resumable-подписка на ту же цель, что живая
 * подписка профиля: без изменений документа сервер её не списывает.
 */
async function waitForServerProfile(
  uid: string,
  stillHere: () => boolean
): Promise<{ profile: AppUser; failure: null } | null> {
  while (stillHere()) {
    await new Promise((resolve) => window.setTimeout(resolve, SERVER_RETRY_PAUSE_MS));
    if (!stillHere()) return null;
    const result = await fetchUserProfileFresh(uid);
    if (result.failure === null) return result;
    // База ответила, но профиль не отдала (отказ, документа нет) — связь
    // есть, предупреждение о ней больше не правда.
    if (result.failure !== "unreachable") {
      toast.dismiss(DB_UNREACHABLE_TOAST_ID);
      return null;
    }
  }
  return null;
}

/** Wires the Firebase auth listener into the auth store. Call once near the app root. */
export function useAuthBootstrap() {
  const setFirebaseUser = useAuthStore((s) => s.setFirebaseUser);
  const setProfile = useAuthStore((s) => s.setProfile);
  const setLoading = useAuthStore((s) => s.setLoading);
  const unsubscribeProfileRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const {
      setAuthResolved,
      setProfileResolved,
      setBootError,
      resetBootstrap,
    } = useBootstrapStore.getState();

    let authCallbackSettled = false;
    let initialAuthReady = false;
    let lastAppliedUid: string | null | undefined;

    async function applyUser(user: import("firebase/auth").User | null) {
      if (!user && auth?.currentUser) {
        user = auth.currentUser;
      }
      if (!user && wasGoogleRedirectPending()) {
        return;
      }

      const uid = user?.uid ?? null;
      // Вошедший человек сменился (вышел, в том числе в ДРУГОЙ вкладке — вход
      // общий на браузер, или вошёл другой) — начать с чистой страницы: кэш
      // Firestore в памяти и кэши на модулях принадлежат прошлому. Первый
      // вход (было «никого») страницу не трогает.
      if (authCallbackSettled && typeof lastAppliedUid === "string" && lastAppliedUid !== uid) {
        window.location.replace("/");
        return;
      }
      const isSameUser = lastAppliedUid === uid && authCallbackSettled;
      lastAppliedUid = uid;
      authCallbackSettled = true;
      window.clearTimeout(authHangTimer);
      window.clearTimeout(authGiveUpTimer);

      unsubscribeProfileRef.current?.();
      unsubscribeProfileRef.current = null;

      if (!isSameUser) {
        resetBootstrap();
      }

      setFirebaseUser(user);
      setAuthResolved(true);

      // Токен здесь больше НЕ ждём (было `await getIdToken()` до 4 с перед
      // чтением профиля): Firestore и клиент строк Supabase берут его сами,
      // когда он им нужен, а лишнее ожидание стояло последовательно перед
      // первым экраном.

      try {
        if (user) {
          const { profile, fromCache } = await ensureUserProfileCacheFirst(user);
          // A slow/suspended call (flaky connection) can still be awaiting the
          // above when a sign-out + sign-in-as-someone-else fires a second,
          // faster applyUser for a different uid. Bail out of this call's
          // remaining side effects once a newer call has taken over —
          // otherwise this stale call's setProfile/subscription would land
          // AFTER the newer one and overwrite the live session with the
          // previous user's data, and leak its own profile listener (never
          // unsubscribed) on top of it.
          if (lastAppliedUid !== uid) return;
          setBootError(null);
          setProfile(profile);
          setProfileResolved(true);

          unsubscribeProfileRef.current = subscribeToDoc<AppUser>(
            paths.user(user.uid),
            (liveProfile) => {
              if (lastAppliedUid !== uid) return;
              if (liveProfile) setProfile(liveProfile);
            },
            (error) => {
              console.error("users/{uid} listener failed:", error.code, error.message);
            }
          );

          // Фоновые дела входа — не держат первый экран.
          void (async () => {
            const stillHere = () => lastAppliedUid === uid;
            let fresh: FreshProfileResult = fromCache
              ? await fetchUserProfileFresh(user.uid)
              : { profile, failure: null };
            if (!stillHere()) return;
            const unreachable = fresh.failure === "unreachable";
            if (unreachable) showDbUnreachable();

            // Поиск приглашений — ВСЕГДА, даже если серверный профиль не
            // прочитался: claimPendingInvites сам спрашивает сервер, так что
            // запускать его безопасно, а пропуск оставил бы человека без
            // workspace на «нет workspace» до перезагрузки. Устаревший кэш
            // здесь опасен только в одну сторону (`workspaceIds` из кэша
            // непустой, а на сервере его уже убрали — проверка отложится на
            // час), поэтому база решения — серверный профиль, когда он есть.
            // Не ждём его перед ожиданием связи: на «висящем» соединении
            // запрос приглашений тоже висит без ошибки, и предупреждение
            // так бы и не снялось.
            const invitesFirst = runInviteCheck(user.uid, fresh.profile ?? profile, unreachable, stillHere);

            if (unreachable) {
              // Ждём, пока база ответит: тогда убираем предупреждение и
              // доделываем то, что без связи не прошло.
              const recovered = await waitForServerProfile(user.uid, stillHere);
              if (!recovered || !stillHere()) return;
              toast.dismiss(DB_UNREACHABLE_TOAST_ID);
              fresh = recovered;
            }

            // Синхронизация ника ПИШЕТ — только по профилю, подтверждённому
            // сервером (снимок из кэша только для отрисовки).
            const serverProfile = fresh.profile;
            if (serverProfile?.nickname && serverProfile.workspaceIds?.length) {
              syncNicknameIfChanged(user.uid, serverProfile.workspaceIds, serverProfile.nickname).catch((err) =>
                console.error("Nickname self-heal sync failed:", err)
              );
            }

            // Без связи поиск приглашений упал — повторить по свежему профилю.
            if (unreachable && serverProfile && !(await invitesFirst) && stillHere()) {
              await runInviteCheck(user.uid, serverProfile, false, stillHere);
            }
          })();
        } else {
          setProfile(null);
          setProfileResolved(true);
        }
      } catch (error) {
        console.error("Auth bootstrap failed:", error);
        // Профиль не прочитался: фаза так и останется «profile», поэтому
        // ошибку показывает сам экран загрузки (AppBootScreen) — с кнопками,
        // а не только тостом, который легко не заметить.
        if (lastAppliedUid === uid) {
          setBootError(error instanceof Error ? error.message : String(error));
        }
        setProfileResolved(true);
        toast.error("Не удалось загрузить профиль", {
          description: error instanceof Error ? error.message : "Попробуйте обновить страницу.",
        });
      } finally {
        setLoading(false);
      }
    }

    const authHangTimer = window.setTimeout(() => {
      if (authCallbackSettled) return;
      const current = auth?.currentUser ?? null;
      if (!current && !initialAuthReady) return;
      void applyUser(current);
    }, 8000);

    const authGiveUpTimer = window.setTimeout(() => {
      if (authCallbackSettled) return;
      initialAuthReady = true;
      void applyUser(auth?.currentUser ?? null);
    }, 15000);

    void (async () => {
      try {
        if (auth) {
          await auth.authStateReady();
        }
      } catch (error) {
        console.error("authStateReady failed:", error);
      }

      const pendingGoogle = wasGoogleRedirectPending();
      const redirectPromise = completeGoogleRedirectIfNeeded();

      if (pendingGoogle && !auth?.currentUser) {
        // The "pending" flag can be up to REDIRECT_FLAG_MAX_AGE_MS (10min)
        // stale — e.g. the user backed out of the Google redirect without
        // completing it, then reloaded and is now trying plain email+
        // password login. completeGoogleRedirectIfNeeded()'s own timeout is
        // REDIRECT_RESULT_TIMEOUT_MS (20s), which would otherwise block the
        // whole login screen (RedirectIfAuthed keeps showing AppBootScreen
        // until initialAuthReady flips) for that long on every such reload.
        // Cap the actual wait here much shorter — a genuine in-flight
        // redirect result resolves almost immediately once Auth is ready,
        // and if it doesn't, subscribeToAuthChanges below already re-applies
        // the user the moment Firebase eventually reports one (its pending-
        // aware guard skips a premature "signed out" in the meantime), so
        // nothing is lost by not blocking the UI on the slow path.
        await Promise.race([redirectPromise, new Promise((resolve) => window.setTimeout(resolve, 4000))]);
      } else {
        void redirectPromise;
      }

      initialAuthReady = true;
      if (!authCallbackSettled) {
        void applyUser(auth?.currentUser ?? null);
      }
    })();

    const unsubscribe = subscribeToAuthChanges((user) => {
      if (!user && auth?.currentUser) {
        void applyUser(auth.currentUser);
        return;
      }
      if (!user && (wasGoogleRedirectPending() || (!initialAuthReady && !authCallbackSettled))) {
        return;
      }
      void applyUser(user);
    });

    return () => {
      window.clearTimeout(authHangTimer);
      window.clearTimeout(authGiveUpTimer);
      unsubscribeProfileRef.current?.();
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function useAuth() {
  const firebaseUser = useAuthStore((s) => s.firebaseUser);
  const profile = useAuthStore((s) => s.profile);
  const isLoading = useAuthStore((s) => s.isLoading);
  return { user: firebaseUser, profile, isLoading, isAuthenticated: Boolean(firebaseUser) };
}
