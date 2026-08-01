import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
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
  };
  await setDoc(ref, { ...profile, createdAt: serverTimestamp() });
  return profile;
}

export async function updateUserDoc(uid: string, patch: Partial<AppUser>) {
  if (!db) return;
  await setDoc(doc(paths.users(), uid), patch, { merge: true });
}
