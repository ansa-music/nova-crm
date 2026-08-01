import { deleteDoc, orderBy, query, setDoc, limit as fsLimit } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths, subscribe } from "@/firebase/firestore";
import { generateId } from "@/utils/id";
import type { HistoryAction, HistoryEntry } from "@/types";

export interface LogChangeInput {
  workspaceId: string;
  pageId?: string;
  pageName?: string;
  rowId?: string;
  field?: string;
  fieldLabel?: string;
  oldValue: string | number | null;
  newValue: string | number | null;
  action: HistoryAction;
  userId: string;
  userName: string;
}

export async function logChange(input: LogChangeInput) {
  if (!db) return;
  const id = generateId("hist");
  const entry: HistoryEntry = { id, timestamp: Date.now(), ...input };
  await setDoc(paths.historyEntry(input.workspaceId, id), entry);
}

export function subscribeToHistory(
  workspaceId: string,
  onData: (entries: HistoryEntry[]) => void,
  max = 200
) {
  const q = query(paths.history(workspaceId), orderBy("timestamp", "desc"), fsLimit(max));
  return subscribe<HistoryEntry>(q, onData);
}

export async function deleteHistoryEntry(workspaceId: string, entryId: string) {
  if (!db) return;
  await deleteDoc(paths.historyEntry(workspaceId, entryId));
}
