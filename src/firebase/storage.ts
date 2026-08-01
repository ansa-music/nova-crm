import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { storage } from "@/firebase/firebase";

export async function uploadAvatar(uid: string, file: File): Promise<string> {
  if (!storage) throw new Error("Firebase не настроен: заполните .env.local");
  const fileRef = ref(storage, `avatars/${uid}/${Date.now()}-${file.name}`);
  await uploadBytes(fileRef, file);
  return getDownloadURL(fileRef);
}
