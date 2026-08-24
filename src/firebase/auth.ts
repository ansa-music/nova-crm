import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getRedirectResult,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updatePassword,
  updateProfile,
  type User,
} from "firebase/auth";
import { auth } from "@/firebase/firebase";

const GOOGLE_REDIRECT_FLAG = "nova-crm:google-redirect";

function requireAuth() {
  if (!auth) throw new Error("Firebase не настроен: заполните .env.local");
  return auth;
}

/** iOS/Android, coarse pointer, or a small viewport — popups get killed there. */
export function shouldUseRedirectSignIn(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent || "";
  const isIOS =
    /iPad|iPhone|iPod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const small = window.matchMedia("(max-width: 900px)").matches;
  return isIOS || isAndroid || coarse || small;
}

function googleProvider() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return provider;
}

export function isIgnorableGoogleAuthError(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return (
    code === "auth/popup-closed-by-user" ||
    code === "auth/cancelled-popup-request" ||
    code === "auth/redirect-cancelled-by-user" ||
    code === "auth/redirect-operation-pending" ||
    code === "auth/no-auth-event"
  );
}

export async function signInWithGoogle() {
  const authInstance = requireAuth();
  if (shouldUseRedirectSignIn()) {
    try {
      sessionStorage.setItem(GOOGLE_REDIRECT_FLAG, "1");
    } catch {
      /* private mode */
    }
    try {
      await signInWithRedirect(authInstance, googleProvider());
      return null;
    } catch (error) {
      try {
        sessionStorage.removeItem(GOOGLE_REDIRECT_FLAG);
      } catch {
        /* ignore */
      }
      throw error;
    }
  }
  const result = await signInWithPopup(authInstance, googleProvider());
  return result.user;
}

let redirectResultPromise: Promise<User | null> | null = null;

/**
 * Completes a mobile Google redirect. Must run on every load (login and
 * bootstrap) so a return from Google is never treated as «окно закрыто».
 */
export function completeGoogleRedirectIfNeeded(): Promise<User | null> {
  if (!auth) return Promise.resolve(null);
  if (!redirectResultPromise) {
    redirectResultPromise = getRedirectResult(auth)
      .then((result) => result?.user ?? null)
      .catch((error: unknown) => {
        if (isIgnorableGoogleAuthError(error)) return null;
        throw error;
      })
      .finally(() => {
        try {
          sessionStorage.removeItem(GOOGLE_REDIRECT_FLAG);
        } catch {
          /* ignore */
        }
      });
  }
  return redirectResultPromise;
}

export function wasGoogleRedirectPending(): boolean {
  try {
    return sessionStorage.getItem(GOOGLE_REDIRECT_FLAG) === "1";
  } catch {
    return false;
  }
}

export async function signUpWithEmail(email: string, password: string, name: string) {
  const credential = await createUserWithEmailAndPassword(requireAuth(), email, password);
  await updateProfile(credential.user, { displayName: name });
  return credential.user;
}

export async function signInWithEmail(email: string, password: string) {
  const credential = await signInWithEmailAndPassword(requireAuth(), email, password);
  return credential.user;
}

/** Explicit user logout only. Never call this from a Firestore permission error. */
export async function signOutUser() {
  await signOut(requireAuth());
}

export function subscribeToAuthChanges(callback: (user: User | null) => void) {
  if (!auth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, callback);
}

export async function updateUserProfile(displayName: string, photoURL?: string) {
  const current = requireAuth().currentUser;
  if (!current) return;
  await updateProfile(current, { displayName, photoURL });
}

export async function updateUserPassword(newPassword: string) {
  const current = requireAuth().currentUser;
  if (!current) throw new Error("Не удалось определить текущего пользователя");
  await updatePassword(current, newPassword);
}
