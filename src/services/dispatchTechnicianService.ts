import { deleteDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { generateId } from "@/utils/id";
import { normalizeTimestamp } from "@/utils/date";
import type { DispatchTechnician } from "@/types";

function requireDb() {
  if (!db) throw new Error("Firebase не настроен");
  return db;
}

function mapTechnician(id: string, raw: Record<string, unknown>): DispatchTechnician {
  return {
    id,
    workspaceId: String(raw.workspaceId ?? ""),
    nickname: String(raw.nickname ?? ""),
    memberUid: typeof raw.memberUid === "string" ? raw.memberUid : null,
    createdAt: normalizeTimestamp(raw.createdAt),
    createdBy: String(raw.createdBy ?? ""),
    updatedAt: normalizeTimestamp(raw.updatedAt),
  };
}

export async function listDispatchTechnicians(workspaceId: string): Promise<DispatchTechnician[]> {
  requireDb();
  const snap = await getDocs(paths.dispatchTechnicians(workspaceId));
  return snap.docs
    .map((d) => mapTechnician(d.id, d.data() as Record<string, unknown>))
    .sort((a, b) => a.nickname.localeCompare(b.nickname, "ru"));
}

export async function createDispatchTechnician(input: {
  workspaceId: string;
  nickname: string;
  createdBy: string;
}): Promise<DispatchTechnician> {
  requireDb();
  const nickname = input.nickname.trim();
  if (!nickname) throw new Error("Напиши ник технаря");
  const now = Date.now();
  const id = generateId("tech");
  const row: DispatchTechnician = {
    id,
    workspaceId: input.workspaceId,
    nickname,
    memberUid: null,
    createdAt: now,
    createdBy: input.createdBy,
    updatedAt: now,
  };
  await setDoc(paths.dispatchTechnician(input.workspaceId, id), row);
  return row;
}

export async function renameDispatchTechnician(workspaceId: string, id: string, nickname: string): Promise<void> {
  requireDb();
  const trimmed = nickname.trim();
  if (!trimmed) throw new Error("Напиши ник технаря");
  await updateDoc(paths.dispatchTechnician(workspaceId, id), { nickname: trimmed, updatedAt: Date.now() });
}

/** Manually links (or unlinks, with memberUid null) a roster nickname to a real account. Owner-only, enforced by the caller/UI and by firestore.rules. */
export async function bindDispatchTechnician(workspaceId: string, id: string, memberUid: string | null): Promise<void> {
  requireDb();
  await updateDoc(paths.dispatchTechnician(workspaceId, id), { memberUid, updatedAt: Date.now() });
}

export async function deleteDispatchTechnician(workspaceId: string, id: string): Promise<void> {
  requireDb();
  await deleteDoc(paths.dispatchTechnician(workspaceId, id));
}
