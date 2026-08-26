import { deleteField, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { generateId } from "@/utils/id";
import { stripUndefined } from "@/services/pageService";
import { normalizeTimestamp, ymdInTimeZone } from "@/utils/date";
import type { DailyDispatch } from "@/types";

function requireDb() {
  if (!db) throw new Error("Firebase не настроен");
  return db;
}

function mapDispatch(id: string, raw: Record<string, unknown>): DailyDispatch {
  const marksRaw = (raw.marks && typeof raw.marks === "object" ? raw.marks : {}) as Record<string, unknown>;
  const marks: Record<string, true> = {};
  for (const [uid, value] of Object.entries(marksRaw)) {
    if (value) marks[uid] = true;
  }
  const requestStatus = raw.requestStatus === "pending" || raw.requestStatus === "accepted" ? raw.requestStatus : null;
  return {
    id,
    workspaceId: String(raw.workspaceId ?? ""),
    checkNo: String(raw.checkNo ?? ""),
    technicianName: String(raw.technicianName ?? ""),
    technicianRosterId: typeof raw.technicianRosterId === "string" ? raw.technicianRosterId : null,
    technicianUid: typeof raw.technicianUid === "string" ? raw.technicianUid : null,
    amount: Number(raw.amount) || 0,
    minutes: typeof raw.minutes === "number" && Number.isFinite(raw.minutes) ? raw.minutes : null,
    character: String(raw.character ?? ""),
    os: String(raw.os ?? ""),
    linkedPageId: typeof raw.linkedPageId === "string" ? raw.linkedPageId : null,
    linkedPageName: typeof raw.linkedPageName === "string" ? raw.linkedPageName : null,
    requestStatus,
    acceptedAt: typeof raw.acceptedAt === "number" ? raw.acceptedAt : null,
    dayKey: String(raw.dayKey ?? ""),
    marks,
    createdAt: normalizeTimestamp(raw.createdAt),
    createdBy: String(raw.createdBy ?? ""),
  };
}

export async function listDailyDispatches(workspaceId: string): Promise<DailyDispatch[]> {
  requireDb();
  const snap = await getDocs(paths.dailyDispatches(workspaceId));
  return snap.docs
    .map((d) => mapDispatch(d.id, d.data() as Record<string, unknown>))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Scoped query so a plain (non-owner/admin) technician can read only the entries assigned to them — see firestore.rules dailyDispatches read rule. */
export async function listMyDispatchRequests(workspaceId: string, uid: string): Promise<DailyDispatch[]> {
  requireDb();
  const snap = await getDocs(query(paths.dailyDispatches(workspaceId), where("technicianUid", "==", uid)));
  return snap.docs
    .map((d) => mapDispatch(d.id, d.data() as Record<string, unknown>))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function createDailyDispatch(input: {
  workspaceId: string;
  checkNo: string;
  technicianRosterId: string;
  technicianName: string;
  technicianUid: string | null;
  amount?: number;
  minutes?: number | null;
  character?: string;
  os?: string;
  createdBy: string;
}): Promise<DailyDispatch> {
  requireDb();
  const checkNo = input.checkNo.trim();
  const technicianName = input.technicianName.trim();
  if (!checkNo) throw new Error("Напиши чек");
  if (!technicianName) throw new Error("Выбери технаря");
  const now = Date.now();
  const id = generateId("disp");
  const row: DailyDispatch = {
    id,
    workspaceId: input.workspaceId,
    checkNo,
    technicianName,
    technicianRosterId: input.technicianRosterId,
    technicianUid: input.technicianUid,
    amount: Number.isFinite(input.amount) ? Number(input.amount) : 0,
    minutes: typeof input.minutes === "number" && Number.isFinite(input.minutes) ? input.minutes : null,
    character: (input.character ?? "").trim(),
    os: (input.os ?? "").trim(),
    linkedPageId: null,
    linkedPageName: null,
    requestStatus: input.technicianUid ? "pending" : null,
    acceptedAt: null,
    dayKey: ymdInTimeZone(now),
    marks: {},
    createdAt: now,
    createdBy: input.createdBy,
  };
  await setDoc(paths.dailyDispatch(input.workspaceId, id), stripUndefined(row));
  return row;
}

/** Writes only the current uid into marks. Uncheck removes that key, never other people's. */
export async function toggleDailyDispatchMark(
  workspaceId: string,
  id: string,
  uid: string,
  marked: boolean
): Promise<void> {
  requireDb();
  await updateDoc(paths.dailyDispatch(workspaceId, id), {
    [`marks.${uid}`]: marked ? true : deleteField(),
  });
}

export async function bindDailyDispatchToSheet(input: {
  workspaceId: string;
  id: string;
  technicianUid: string | null;
  linkedPageId: string;
  linkedPageName: string;
}): Promise<void> {
  requireDb();
  await updateDoc(
    paths.dailyDispatch(input.workspaceId, input.id),
    stripUndefined({
      technicianUid: input.technicianUid,
      linkedPageId: input.linkedPageId,
      linkedPageName: input.linkedPageName,
    })
  );
}

/** The assigned technician accepting their own pending request — only touches requestStatus/acceptedAt, see firestore.rules. */
export async function acceptDispatchRequest(workspaceId: string, id: string): Promise<void> {
  requireDb();
  await updateDoc(paths.dailyDispatch(workspaceId, id), {
    requestStatus: "accepted",
    acceptedAt: Date.now(),
  });
}
