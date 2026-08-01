import { useEffect } from "react";
import { subscribeToAuthChanges } from "@/firebase/auth";
import { ensureUserProfile } from "@/services/authService";
import { claimPendingInvites } from "@/services/memberService";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/components/ui/sonner";

/** Wires the Firebase auth listener into the auth store. Call once near the app root. */
export function useAuthBootstrap() {
  const setFirebaseUser = useAuthStore((s) => s.setFirebaseUser);
  const setProfile = useAuthStore((s) => s.setProfile);
  const setLoading = useAuthStore((s) => s.setLoading);

  useEffect(() => {
    const unsubscribe = subscribeToAuthChanges(async (user) => {
      setFirebaseUser(user);
      try {
        if (user) {
          const profile = await ensureUserProfile(user);
          setProfile(profile);
          // Best-effort: claiming pending invites must never block sign-in.
          // A failure here (rules edge case, no invites, offline, etc.)
          // should not leave the whole app stuck on the loading screen.
          try {
            await claimPendingInvites(user.uid, profile.email, profile.name, profile.photoURL);
          } catch (inviteError) {
            console.error("claimPendingInvites failed:", inviteError);
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
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function useAuth() {
  const firebaseUser = useAuthStore((s) => s.firebaseUser);
  const profile = useAuthStore((s) => s.profile);
  const isLoading = useAuthStore((s) => s.isLoading);
  return { user: firebaseUser, profile, isLoading, isAuthenticated: Boolean(firebaseUser) };
}
