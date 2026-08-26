// PATH: src/hooks/useAuth.ts  (REPLACES EXISTING)
import { useEffect, useRef } from "react";
import {
  completeGoogleRedirectIfNeeded,
  subscribeToAuthChanges,
  wasGoogleRedirectPending,
} from "@/firebase/auth";
import { auth } from "@/firebase/firebase";
import { ensureUserProfile, syncNicknameToMemberships } from "@/services/authService";
import { claimPendingInvites } from "@/services/memberService";
import { paths, subscribeToDoc } from "@/firebase/firestore";
import { useAuthStore } from "@/store/authStore";
import { useBootstrapStore } from "@/store/bootstrapStore";
import { toast } from "@/components/ui/sonner";
import type { AppUser } from "@/types";

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
      resetBootstrap,
    } = useBootstrapStore.getState();

    let authCallbackSettled = false;
    let initialAuthReady = false;
    let lastAppliedUid: string | null | undefined;

    function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
      return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("timeout")), ms);
        promise.then(
          (value) => {
            window.clearTimeout(timer);
            resolve(value);
          },
          (err) => {
            window.clearTimeout(timer);
            reject(err);
          }
        );
      });
    }

    async function applyUser(user: import("firebase/auth").User | null) {
      if (!user && auth?.currentUser) {
        user = auth.currentUser;
      }
      if (!user && wasGoogleRedirectPending()) {
        return;
      }

      const uid = user?.uid ?? null;
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

      try {
        if (user) {
          await withTimeout(user.getIdToken(), 4000);
        }
      } catch (tokenError) {
        console.error("Failed to obtain ID token:", tokenError);
      }

      try {
        if (user) {
          const profile = await ensureUserProfile(user);
          setProfile(profile);
          setProfileResolved(true);

          unsubscribeProfileRef.current = subscribeToDoc<AppUser>(
            paths.user(user.uid),
            (liveProfile) => {
              if (liveProfile) setProfile(liveProfile);
            },
            (error) => {
              console.error("users/{uid} listener failed:", error.code, error.message);
            }
          );

          try {
            await claimPendingInvites(user.uid, profile.email, profile.name, profile.photoURL, profile.nickname);
          } catch (inviteError) {
            console.error("claimPendingInvites failed:", inviteError);
            toast.error("Не удалось принять приглашение", {
              description: inviteError instanceof Error ? inviteError.message : "Обновите страницу или напишите Owner.",
            });
          }

          if (profile.nickname && profile.workspaceIds?.length) {
            syncNicknameToMemberships(user.uid, profile.workspaceIds, profile.nickname).catch((err) =>
              console.error("Nickname self-heal sync failed:", err)
            );
          }
        } else {
          setProfile(null);
          setProfileResolved(true);
        }
      } catch (error) {
        console.error("Auth bootstrap failed:", error);
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
        await redirectPromise;
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
