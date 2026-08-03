import { useEffect, useRef } from "react";
import { subscribeToAuthChanges } from "@/firebase/auth";
import { ensureUserProfile, syncNicknameToMemberships } from "@/services/authService";
import { claimPendingInvites } from "@/services/memberService";
import { paths, subscribeToDoc } from "@/firebase/firestore";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/components/ui/sonner";
import type { AppUser } from "@/types";

/** Wires the Firebase auth listener into the auth store. Call once near the app root. */
export function useAuthBootstrap() {
  const setFirebaseUser = useAuthStore((s) => s.setFirebaseUser);
  const setProfile = useAuthStore((s) => s.setProfile);
  const setLoading = useAuthStore((s) => s.setLoading);
  const unsubscribeProfileRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToAuthChanges(async (user) => {
      // Tear down any previous live profile subscription (e.g. on sign-out
      // or switching accounts) before starting a new one.
      unsubscribeProfileRef.current?.();
      unsubscribeProfileRef.current = null;

      try {
        if (user) {
          // Force-refresh/await the ID token BEFORE exposing this user to
          // the rest of the app. Without this, firebaseUser can be set (and
          // downstream Firestore listeners like the workspace list can fire)
          // a moment before the token Firestore's SDK actually sends is
          // ready — which surfaces as a permanent "permission-denied" that
          // only a lucky reload fixes, even though the person genuinely has
          // access. getIdToken() resolves only once a valid token exists.
          await user.getIdToken();
        }
      } catch (tokenError) {
        console.error("Failed to obtain ID token:", tokenError);
      }
      setFirebaseUser(user);
      try {
        if (user) {
          const profile = await ensureUserProfile(user);
          setProfile(profile);

          // From here on, keep `profile` LIVE — a plain one-time fetch was
          // the root cause of the nickname modal never closing (it saved
          // successfully, but the in-memory profile object never updated to
          // reflect that) and of the nickname not showing up anywhere else
          // without a full page reload. Any future field (name, photo,
          // nickname, workspaceIds) now propagates instantly everywhere
          // `useAuth().profile` is read.
          unsubscribeProfileRef.current = subscribeToDoc<AppUser>(paths.user(user.uid), (liveProfile) => {
            if (liveProfile) setProfile(liveProfile);
          });

          // Best-effort: claiming pending invites must never block sign-in.
          // A failure here (rules edge case, no invites, offline, etc.)
          // should not leave the whole app stuck on the loading screen.
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
        }
      } catch (error) {
        console.error("Auth bootstrap failed:", error);
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
