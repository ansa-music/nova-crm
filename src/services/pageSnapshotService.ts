import { getDoc, getDocs, setDoc, writeBatch } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { usesSupabaseRows } from "@/services/rows/rowsBackend";
import { sbFetchAllPageRows, sbFetchRows, sbPutRows } from "@/services/rows/supabaseRowStore";
import { putPageAcl } from "@/services/rows/rowAclService";
import type { PageRow, WorkspacePage } from "@/types";

type SnapshotRow = { id: string; data: Record<string, unknown> };

function toSnapshotRows(rows: PageRow[]): SnapshotRow[] {
  return rows.map((row) => ({ id: row.id, data: row as unknown as Record<string, unknown> }));
}

function fromSnapshotRows(rows: SnapshotRow[]): PageRow[] {
  return rows.map((r) => ({ ...(r.data as unknown as PageRow), id: r.id }));
}

/**
 * Reads a page's own doc + all its rows + every subpage (each with its own
 * rows) — everything `pageService.deletePage` is about to permanently
 * remove. Used to make page deletion undo-able: without a full snapshot
 * taken BEFORE the delete, there'd be nothing to restore from.
 *
 * Строки берутся из того хранилища, где они сейчас живут (Firestore или
 * Supabase), и туда же возвращаются.
 */
export async function snapshotPage(workspaceId: string, pageId: string) {
  const onSupabase = usesSupabaseRows(workspaceId);
  const [pageSnap, rowsSnap, subPagesSnap, rowsByTab] = await Promise.all([
    getDoc(paths.page(workspaceId, pageId)),
    onSupabase ? null : getDocs(paths.rows(workspaceId, pageId)),
    getDocs(paths.subPages(workspaceId, pageId)),
    onSupabase ? sbFetchAllPageRows(workspaceId, pageId) : null,
  ]);

  const subPages = await Promise.all(
    subPagesSnap.docs.map(async (subPageDoc) => {
      const rows: SnapshotRow[] = rowsByTab
        ? toSnapshotRows(rowsByTab.get(subPageDoc.id) ?? [])
        : (await getDocs(paths.subPageRows(workspaceId, pageId, subPageDoc.id))).docs.map((r) => ({ id: r.id, data: r.data() }));
      return { id: subPageDoc.id, data: subPageDoc.data(), rows };
    })
  );

  return {
    pageData: pageSnap.exists() ? pageSnap.data() : null,
    rows: rowsByTab
      ? toSnapshotRows(rowsByTab.get("") ?? [])
      : (rowsSnap?.docs.map((r) => ({ id: r.id, data: r.data() })) ?? []),
    subPages,
  };
}

export type PageSnapshot = Awaited<ReturnType<typeof snapshotPage>>;

/** Writes a page snapshot back exactly as it was — same page/row/subpage ids, so any comments, chat, or history referencing them stay valid. */
export async function restorePageSnapshot(workspaceId: string, pageId: string, snapshot: PageSnapshot) {
  if (!snapshot.pageData) return;
  const CHUNK_SIZE = 450;

  await setDoc(paths.page(workspaceId, pageId), snapshot.pageData);

  const onSupabase = usesSupabaseRows(workspaceId);
  const subPageWrites = snapshot.subPages.map((sp) => ({ ref: paths.subPage(workspaceId, pageId, sp.id), data: sp.data }));
  const rowWrites = onSupabase ? [] : snapshot.rows.map((r) => ({ ref: paths.row(workspaceId, pageId, r.id), data: r.data }));
  const subRowWrites = onSupabase
    ? []
    : snapshot.subPages.flatMap((sp) =>
        sp.rows.map((r) => ({ ref: paths.subPageRow(workspaceId, pageId, sp.id, r.id), data: r.data }))
      );

  const all = [...rowWrites, ...subPageWrites, ...subRowWrites];
  for (let i = 0; i < all.length; i += CHUNK_SIZE) {
    const batch = writeBatch(db);
    all.slice(i, i + CHUNK_SIZE).forEach(({ ref, data }) => batch.set(ref, data));
    await batch.commit();
  }

  if (onSupabase) {
    // Вернули стол (Ctrl+Z после удаления) — вернуть и его запись в копии прав:
    // удаление стола её снесло, а без неё политика Supabase не отдаёт ни одной
    // строки, и восстановленный стол выглядел бы пустым до сверки у Owner.
    try {
      await putPageAcl(workspaceId, { ...(snapshot.pageData as WorkspacePage), id: pageId });
    } catch (error) {
      console.warn("[rows-acl] права восстановленного стола не записаны — доведёт сверка", error);
    }
    await sbPutRows(workspaceId, pageId, null, fromSnapshotRows(snapshot.rows));
    for (const sp of snapshot.subPages) await sbPutRows(workspaceId, pageId, sp.id, fromSnapshotRows(sp.rows));
  }
}

/** Same idea as snapshotPage, scoped to a single subpage (and its rows). */
export async function snapshotSubPage(workspaceId: string, pageId: string, subPageId: string) {
  const onSupabase = usesSupabaseRows(workspaceId);
  const [subPageSnap, rows] = await Promise.all([
    getDoc(paths.subPage(workspaceId, pageId, subPageId)),
    onSupabase
      ? sbFetchRows(workspaceId, pageId, subPageId).then(toSnapshotRows)
      : getDocs(paths.subPageRows(workspaceId, pageId, subPageId)).then((snap) =>
          snap.docs.map((r) => ({ id: r.id, data: r.data() }) as SnapshotRow)
        ),
  ]);
  return {
    subPageData: subPageSnap.exists() ? subPageSnap.data() : null,
    rows,
  };
}

export type SubPageSnapshot = Awaited<ReturnType<typeof snapshotSubPage>>;

export async function restoreSubPageSnapshot(
  workspaceId: string,
  pageId: string,
  subPageId: string,
  snapshot: SubPageSnapshot
) {
  if (!snapshot.subPageData) return;
  await setDoc(paths.subPage(workspaceId, pageId, subPageId), snapshot.subPageData);
  if (usesSupabaseRows(workspaceId)) {
    await sbPutRows(workspaceId, pageId, subPageId, fromSnapshotRows(snapshot.rows));
    return;
  }
  const CHUNK_SIZE = 450;
  for (let i = 0; i < snapshot.rows.length; i += CHUNK_SIZE) {
    const batch = writeBatch(db);
    snapshot.rows.slice(i, i + CHUNK_SIZE).forEach((r) => batch.set(paths.subPageRow(workspaceId, pageId, subPageId, r.id), r.data));
    await batch.commit();
  }
}
