import {
  GoogleAuthProvider,
  browserPopupRedirectResolver,
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
const REDIRECT_FLAG_MAX_AGE_MS = 10 * 60 * 1000;
const REDIRECT_RESULT_TIMEOUT_MS = 6000;

function requireAuth() {
  if (!auth) throw new Error("Firebase не настроен: заполните .env.local");
  return auth;
}

function authErrorCode(error: unknown): string | undefined {
  return (error as { code?: string })?.code;
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
  const code = authErrorCode(error);
  return (
    code === "auth/popup-closed-by-user" ||
    code === "auth/cancelled-popup-request" ||
    code === "auth/redirect-cancelled-by-user" ||
    code === "auth/redirect-operation-pending" ||
    code === "auth/no-auth-event"
  );
}

function writeRedirectFlag() {
  const payload = String(Date.now());
  try {
    sessionStorage.setItem(GOOGLE_REDIRECT_FLAG, payload);
  } catch {
    /* private mode */
  }
  try {
    localStorage.setItem(GOOGLE_REDIRECT_FLAG, payload);
  } catch {
    /* private mode */
  }
}

function clearRedirectFlag() {
  try {
    sessionStorage.removeItem(GOOGLE_REDIRECT_FLAG);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(GOOGLE_REDIRECT_FLAG);
  } catch {
    /* ignore */
  }
}

function flagLooksPending(raw: string | null): boolean {
  if (!raw) return false;
  const ts = Number(raw);
  if (!Number.isFinite(ts)) return true;
  return Date.now() - ts < REDIRECT_FLAG_MAX_AGE_MS;
}

export function wasGoogleRedirectPending(): boolean {
  try {
    if (flagLooksPending(sessionStorage.getItem(GOOGLE_REDIRECT_FLAG))) return true;
  } catch {
    /* ignore */
  }
  try {
    if (flagLooksPending(localStorage.getItem(GOOGLE_REDIRECT_FLAG))) return true;
  } catch {
    /* ignore */
  }
  try {
    return Object.keys(sessionStorage).some((key) => key.includes("pendingRedirect"));
  } catch {
    return false;
  }
}

export async function signInWithGoogle() {
  const authInstance = requireAuth();
  if (shouldUseRedirectSignIn()) {
    writeRedirectFlag();
    try {
      await signInWithRedirect(authInstance, googleProvider(), browserPopupRedirectResolver);
      return null;
    } catch (error) {
      clearRedirectFlag();
      throw error;
    }
  }
  const result = await signInWithPopup(authInstance, googleProvider(), browserPopupRedirectResolver);
  return result.user;
}

let redirectResultPromise: Promise<User | null> | null = null;
let lastGoogleRedirectError: unknown = null;

export function getGoogleRedirectError(): unknown {
  return lastGoogleRedirectError;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(Object.assign(new Error("redirect-timeout"), { code: "auth/network-request-failed" }));
    }, ms);
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

/**
 * Completes a mobile Google redirect. Never throws: a hung/failed
 * getRedirectResult must not block the email+password form.
 */
export function completeGoogleRedirectIfNeeded(): Promise<User | null> {
  if (!auth) return Promise.resolve(null);
  if (!redirectResultPromise) {
    redirectResultPromise = (async () => {
      lastGoogleRedirectError = null;
      try {
        const result = await withTimeout(
          getRedirectResult(auth, browserPopupRedirectResolver),
          REDIRECT_RESULT_TIMEOUT_MS
        );
        return result?.user ?? null;
      } catch (error: unknown) {
        if (!isIgnorableGoogleAuthError(error)) {
          lastGoogleRedirectError = error;
          console.error("getRedirectResult failed:", error);
        }
        return null;
      } finally {
        clearRedirectFlag();
      }
    })();
  }
  return redirectResultPromise;
}

async function waitBriefly(ms: number) {
  await new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function signUpWithEmail(email: string, password: string, name: string) {
  const authInstance = requireAuth();
  try {
    await authInstance.authStateReady();
  } catch {
    /* continue */
  }
  const credential = await createUserWithEmailAndPassword(authInstance, email.trim(), password);
  await updateProfile(credential.user, { displayName: name });
  return credential.user;
}

export async function signInWithEmail(email: string, password: string) {
  const authInstance = requireAuth();
  try {
    await authInstance.authStateReady();
  } catch {
    /* continue */
  }
  const trimmed = email.trim();
  try {
    const credential = await signInWithEmailAndPassword(authInstance, trimmed, password);
    return credential.user;
  } catch (error) {
    const code = authErrorCode(error);
    if (code === "auth/redirect-operation-pending" || code === "auth/cancelled-popup-request") {
      await waitBriefly(600);
      const credential = await signInWithEmailAndPassword(authInstance, trimmed, password);
      return credential.user;
    }
    throw error;
  }
}

/** Explicit user logout only. Never call this from a Firestore permission error. */
export async function signOutUser() {
  clearRedirectFlag();
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
