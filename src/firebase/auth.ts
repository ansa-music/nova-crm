import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
  updateProfile,
  type User,
} from "firebase/auth";
import { auth } from "@/firebase/firebase";

function requireAuth() {
  if (!auth) throw new Error("Firebase не настроен: заполните .env.local");
  return auth;
}

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(requireAuth(), provider);
  return result.user;
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
