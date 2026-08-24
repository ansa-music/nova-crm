import type { RealtimeChannel } from "@supabase/supabase-js";
import { ROW_RECORDS_TABLE, supabase } from "@/lib/supabase";
import type { PageRow, RowAttachment } from "@/types";

export interface RowRecordPayload {
  id: string;
  workspace_id: string;
  page_id: string;
  sub_page_id: string | null;
  cells: Record<string, string | number | null>;
  attachments: RowAttachment[] | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

const CHUNK = 150;

function toIso(ms: number | undefined): string {
  const n = typeof ms === "number" && Number.isFinite(ms) ? ms : Date.now();
  return new Date(n).toISOString();
}

function fromIso(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

export function pageRowToRecord(
  workspaceId: string,
  parentPageId: string,
  subPageId: string | null,
  row: PageRow
): RowRecordPayload {
  return {
    id: row.id,
    workspace_id: workspaceId,
    page_id: parentPageId,
    sub_page_id: subPageId,
    cells: row.cells ?? {},
    attachments: row.attachments ?? null,
    sort_order: typeof row.order === "number" ? row.order : 0,
    created_at: toIso(row.createdAt),
    updated_at: toIso(row.updatedAt),
  };
}

export function recordToPageRow(record: RowRecordPayload): PageRow {
  const attachments = Array.isArray(record.attachments) ? record.attachments : undefined;
  return {
    id: record.id,
    pageId: record.sub_page_id || record.page_id,
    cells: (record.cells ?? {}) as PageRow["cells"],
    attachments,
    order: Number(record.sort_order) || 0,
    createdAt: fromIso(record.created_at),
    updatedAt: fromIso(record.updated_at),
  };
}

function matchesScope(record: RowRecordPayload, pageId: string, subPageId: string | null): boolean {
  if (record.page_id !== pageId) return false;
  if (subPageId) return record.sub_page_id === subPageId;
  return record.sub_page_id == null;
}

export async function upsertRowRecords(rows: RowRecordPayload[]): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from(ROW_RECORDS_TABLE).upsert(slice, { onConflict: "id" });
    if (error) throw error;
  }
}

/** Best-effort dual-write. Never throws — Firestore stays the durable copy. */
export function mirrorUpsertRow(
  workspaceId: string,
  parentPageId: string,
  subPageId: string | null,
  row: PageRow
): void {
  void upsertRowRecords([pageRowToRecord(workspaceId, parentPageId, subPageId, row)]).catch(() => undefined);
}

export async function patchRowRecord(
  rowId: string,
  patch: Partial<Pick<RowRecordPayload, "cells" | "attachments" | "sort_order">>
): Promise<void> {
  const { data, error } = await supabase.from(ROW_RECORDS_TABLE).select("*").eq("id", rowId).maybeSingle();
  if (error) throw error;
  if (!data) return;
  const current = data as RowRecordPayload;
  const next: RowRecordPayload = {
    ...current,
    cells: patch.cells !== undefined ? patch.cells : current.cells,
    attachments: patch.attachments !== undefined ? patch.attachments : current.attachments,
    sort_order: patch.sort_order !== undefined ? patch.sort_order : current.sort_order,
    updated_at: new Date().toISOString(),
  };
  await upsertRowRecords([next]);
}

export function mirrorPatchRowCells(rowId: string, field: string, value: string | number | null): void {
  void (async () => {
    const { data, error } = await supabase.from(ROW_RECORDS_TABLE).select("cells").eq("id", rowId).maybeSingle();
    if (error) throw error;
    if (!data) return;
    const cells = { ...((data.cells as PageRow["cells"]) ?? {}), [field]: value };
    await patchRowRecord(rowId, { cells });
  })().catch(() => undefined);
}

export function mirrorPatchRowCellsBulk(rowId: string, patch: Record<string, string | number | null>): void {
  void (async () => {
    const { data, error } = await supabase.from(ROW_RECORDS_TABLE).select("cells").eq("id", rowId).maybeSingle();
    if (error) throw error;
    if (!data) return;
    const cells = { ...((data.cells as PageRow["cells"]) ?? {}), ...patch };
    await patchRowRecord(rowId, { cells });
  })().catch(() => undefined);
}

export function mirrorPatchAttachments(rowId: string, attachments: RowAttachment[]): void {
  void patchRowRecord(rowId, { attachments }).catch(() => undefined);
}

export function mirrorReorderRows(orderedRowIds: string[]): void {
  void (async () => {
    await Promise.all(
      orderedRowIds.map((id, index) =>
        supabase.from(ROW_RECORDS_TABLE).update({ sort_order: index, updated_at: new Date().toISOString() }).eq("id", id)
      )
    );
  })().catch(() => undefined);
}

export function mirrorDeleteRow(rowId: string): void {
  void (async () => {
    const { error } = await supabase.from(ROW_RECORDS_TABLE).delete().eq("id", rowId);
    if (error) throw error;
  })().catch(() => undefined);
}

export function mirrorDeleteRowsForPage(pageId: string): void {
  void (async () => {
    const { error } = await supabase.from(ROW_RECORDS_TABLE).delete().eq("page_id", pageId);
    if (error) throw error;
  })().catch(() => undefined);
}

export function mirrorDeleteRowsForSubPage(pageId: string, subPageId: string): void {
  void (async () => {
    const { error } = await supabase.from(ROW_RECORDS_TABLE).delete().eq("page_id", pageId).eq("sub_page_id", subPageId);
    if (error) throw error;
  })().catch(() => undefined);
}

/**
 * Copy Firestore rows that are missing (or stale) in row_records.
 * Never deletes Firestore. Never bulk-deletes Firestore.
 */
export async function copyMissingRowRecords(
  workspaceId: string,
  parentPageId: string,
  subPageId: string | null,
  firestoreRows: PageRow[]
): Promise<void> {
  if (firestoreRows.length === 0) return;
  let query = supabase.from(ROW_RECORDS_TABLE).select("id, updated_at").eq("page_id", parentPageId);
  query = subPageId ? query.eq("sub_page_id", subPageId) : query.is("sub_page_id", null);
  const { data, error } = await query;
  if (error) throw error;
  const existing = new Map<string, number>();
  for (const row of data ?? []) {
    existing.set(row.id as string, fromIso(row.updated_at));
  }
  const toCopy = firestoreRows.filter((row) => {
    const sbUpdated = existing.get(row.id);
    if (sbUpdated === undefined) return true;
    return row.updatedAt > sbUpdated + 500;
  });
  if (toCopy.length === 0) return;
  await upsertRowRecords(toCopy.map((row) => pageRowToRecord(workspaceId, parentPageId, subPageId, row)));
}

export async function fetchRowRecords(pageId: string, subPageId: string | null): Promise<PageRow[]> {
  let query = supabase.from(ROW_RECORDS_TABLE).select("*").eq("page_id", pageId).order("sort_order", { ascending: true });
  query = subPageId ? query.eq("sub_page_id", subPageId) : query.is("sub_page_id", null);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => recordToPageRow(row as RowRecordPayload));
}

/**
 * Prefer Supabase cells/order when a copy exists; Firestore is the existence
 * source so a failed supabase delete cannot resurrect a user-deleted row.
 */
export function mergeFirestoreAndSupabaseRows(firestoreRows: PageRow[], supabaseRows: PageRow[] | null): PageRow[] {
  if (!supabaseRows) return [...firestoreRows].sort((a, b) => a.order - b.order);
  const sbMap = new Map(supabaseRows.map((row) => [row.id, row]));
  const merged = firestoreRows.map((fs) => {
    const sb = sbMap.get(fs.id);
    if (!sb) return fs;
    const firestoreNewer = fs.updatedAt > sb.updatedAt + 250;
    return {
      ...fs,
      cells: firestoreNewer ? fs.cells : sb.cells,
      attachments: firestoreNewer ? fs.attachments : (sb.attachments ?? fs.attachments),
      order: sb.order,
      updatedAt: Math.max(fs.updatedAt, sb.updatedAt),
    };
  });
  return merged.sort((a, b) => a.order - b.order);
}

export function subscribeToRowRecords(
  pageId: string,
  subPageId: string | null,
  onData: (rows: PageRow[]) => void,
  onStatus: (ok: boolean) => void
): () => void {
  let cancelled = false;
  let rowsById = new Map<string, PageRow>();
  let channel: RealtimeChannel | null = null;

  function emit() {
    if (cancelled) return;
    onData([...rowsById.values()].sort((a, b) => a.order - b.order));
  }

  void (async () => {
    try {
      const initial = await fetchRowRecords(pageId, subPageId);
      if (cancelled) return;
      rowsById = new Map(initial.map((row) => [row.id, row]));
      onStatus(true);
      emit();
    } catch {
      if (!cancelled) onStatus(false);
      return;
    }

    channel = supabase
      .channel(`row_records:${pageId}:${subPageId ?? "main"}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: ROW_RECORDS_TABLE, filter: `page_id=eq.${pageId}` },
        (payload) => {
          if (cancelled) return;
          if (payload.eventType === "DELETE") {
            const oldRow = payload.old as Partial<RowRecordPayload>;
            if (oldRow.id) rowsById.delete(oldRow.id);
            emit();
            return;
          }
          const next = payload.new as RowRecordPayload;
          if (!next?.id || !matchesScope(next, pageId, subPageId)) return;
          rowsById.set(next.id, recordToPageRow(next));
          emit();
        }
      )
      .subscribe();
  })();

  return () => {
    cancelled = true;
    if (channel) void supabase.removeChannel(channel);
  };
}
