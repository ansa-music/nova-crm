// PATH: src/hooks/useAuth.ts  (REPLACES EXISTING)
import { useEffect, useRef } from "react";
import { subscribeToAuthChanges } from "@/firebase/auth";
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

    const unsubscribe = subscribeToAuthChanges(async (user) => {
      unsubscribeProfileRef.current?.();
      unsubscribeProfileRef.current = null;

      // Every auth transition (sign-in, sign-out, account switch) restarts the
      // downstream boot sequence. Without this, a logout->login cycle would
      // briefly report "ready" using the PREVIOUS account's resolved flags.
      resetBootstrap();

      try {
        if (user) {
          // Force-await the ID token BEFORE exposing this user to the rest of
          // the app, otherwise downstream Firestore listeners can fire a
          // moment before the token the SDK sends is valid -> a permanent
          // "permission-denied" that only a lucky reload fixed.
          await user.getIdToken();
        }
      } catch (tokenError) {
        console.error("Failed to obtain ID token:", tokenError);
      }

      setFirebaseUser(user);
      // Auth itself is now definitively resolved (signed in or signed out).
      setAuthResolved(true);

      try {
        if (user) {
          const profile = await ensureUserProfile(user);
          setProfile(profile);
          // The profile is now known — downstream phases may proceed.
          setProfileResolved(true);

          unsubscribeProfileRef.current = subscribeToDoc<AppUser>(paths.user(user.uid), (liveProfile) => {
            if (liveProfile) setProfile(liveProfile);
          });

          try {
            await claimPendingInvites(user.uid, profile.email, profile.name, profile.photoURL, profile.nickname);
          } catch (inviteError) {
            console.error("claimPendingInvites failed:", inviteError);
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
        // Still mark resolved: a hard failure must surface a real error state,
        // never an infinite skeleton the user can only escape by reloading.
        setProfileResolved(true);
        toast.error("Не удалось загрузить профиль", {
          description: error instanceof Error ? error.message : "Попробуйте обновить страницу.",
        });
      } finally {
        setLoading(false);
      }
    });

    return () => {
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
