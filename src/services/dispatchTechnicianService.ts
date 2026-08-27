import { deleteDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { generateId } from "@/utils/id";
import { normalizeTimestamp } from "@/utils/date";
import type { DispatchColumnMap, DispatchTechnician } from "@/types";


function mapColumnMap(raw: unknown): DispatchColumnMap | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const checkNo = typeof o.checkNo === "string" ? o.checkNo : "";
  const amount = typeof o.amount === "string" ? o.amount : "";
  const minutes = typeof o.minutes === "string" ? o.minutes : "";
  const character = typeof o.character === "string" ? o.character : "";
  const os = typeof o.os === "string" ? o.os : "";
  if (!checkNo && !amount && !minutes && !character && !os) return null;
  return { checkNo, amount, minutes, character, os };
}

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
    deskTarget: typeof raw.deskTarget === "string" && raw.deskTarget ? (raw.deskTarget as DispatchTechnician["deskTarget"]) : null,
    columnMap: mapColumnMap(raw.columnMap),
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
    deskTarget: "own",
    columnMap: null,
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

export async function getMyDispatchTechnician(workspaceId: string, uid: string): Promise<DispatchTechnician | null> {
  requireDb();
  const snap = await getDocs(query(paths.dispatchTechnicians(workspaceId), where("memberUid", "==", uid)));
  if (snap.empty) return null;
  return mapTechnician(snap.docs[0].id, snap.docs[0].data() as Record<string, unknown>);
}

/** Owner-only in the UI. Saves destination desk + column keys. Does not guess columns by label. */
export async function updateDispatchSheetMapping(
  workspaceId: string,
  id: string,
  deskTarget: DispatchTechnician["deskTarget"],
  columnMap: DispatchColumnMap | null
): Promise<void> {
  requireDb();
  await updateDoc(paths.dispatchTechnician(workspaceId, id), {
    deskTarget,
    columnMap,
    updatedAt: Date.now(),
  });
}
