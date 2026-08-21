import { getDoc, getDocs, setDoc, writeBatch } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";

/**
 * Reads a page's own doc + all its rows + every subpage (each with its own
 * rows) — everything `pageService.deletePage` is about to permanently
 * remove. Used to make page deletion undo-able: without a full snapshot
 * taken BEFORE the delete, there'd be nothing to restore from.
 */
export async function snapshotPage(workspaceId: string, pageId: string) {
  const [pageSnap, rowsSnap, subPagesSnap] = await Promise.all([
    getDoc(paths.page(workspaceId, pageId)),
    getDocs(paths.rows(workspaceId, pageId)),
    getDocs(paths.subPages(workspaceId, pageId)),
  ]);

  const subPages = await Promise.all(
    subPagesSnap.docs.map(async (subPageDoc) => {
      const subRowsSnap = await getDocs(paths.subPageRows(workspaceId, pageId, subPageDoc.id));
      return {
        id: subPageDoc.id,
        data: subPageDoc.data(),
        rows: subRowsSnap.docs.map((r) => ({ id: r.id, data: r.data() })),
      };
    })
  );

  return {
    pageData: pageSnap.exists() ? pageSnap.data() : null,
    rows: rowsSnap.docs.map((r) => ({ id: r.id, data: r.data() })),
    subPages,
  };
}

export type PageSnapshot = Awaited<ReturnType<typeof snapshotPage>>;

/** Writes a page snapshot back exactly as it was — same page/row/subpage ids, so any comments, chat, or history referencing them stay valid. */
export async function restorePageSnapshot(workspaceId: string, pageId: string, snapshot: PageSnapshot) {
  if (!snapshot.pageData) return;
  const CHUNK_SIZE = 450;

  await setDoc(paths.page(workspaceId, pageId), snapshot.pageData);

  const rowWrites = snapshot.rows.map((r) => ({ ref: paths.row(workspaceId, pageId, r.id), data: r.data }));
  const subPageWrites = snapshot.subPages.map((sp) => ({ ref: paths.subPage(workspaceId, pageId, sp.id), data: sp.data }));
  const subRowWrites = snapshot.subPages.flatMap((sp) =>
    sp.rows.map((r) => ({ ref: paths.subPageRow(workspaceId, pageId, sp.id, r.id), data: r.data }))
  );

  const all = [...rowWrites, ...subPageWrites, ...subRowWrites];
  for (let i = 0; i < all.length; i += CHUNK_SIZE) {
    const batch = writeBatch(db);
    all.slice(i, i + CHUNK_SIZE).forEach(({ ref, data }) => batch.set(ref, data));
    await batch.commit();
  }
}

/** Same idea as snapshotPage, scoped to a single subpage (and its rows). */
export async function snapshotSubPage(workspaceId: string, pageId: string, subPageId: string) {
  const [subPageSnap, rowsSnap] = await Promise.all([
    getDoc(paths.subPage(workspaceId, pageId, subPageId)),
    getDocs(paths.subPageRows(workspaceId, pageId, subPageId)),
  ]);
  return {
    subPageData: subPageSnap.exists() ? subPageSnap.data() : null,
    rows: rowsSnap.docs.map((r) => ({ id: r.id, data: r.data() })),
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
  const CHUNK_SIZE = 450;
  for (let i = 0; i < snapshot.rows.length; i += CHUNK_SIZE) {
    const batch = writeBatch(db);
    snapshot.rows.slice(i, i + CHUNK_SIZE).forEach((r) => batch.set(paths.subPageRow(workspaceId, pageId, subPageId, r.id), r.data));
    await batch.commit();
  }
}
