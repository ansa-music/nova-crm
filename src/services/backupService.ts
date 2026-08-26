import { getDoc, getDocs } from "firebase/firestore";
import { paths } from "@/firebase/firestore";

/**
 * Reads the whole workspace tree once (not a live subscription) and returns
 * a plain JSON-serializable snapshot: the workspace doc itself, its
 * members, and every page with its rows and subpages (each subpage with
 * its own rows). Intentionally leaves out chat/announcements/notifications
 * — this is a data-safety backup for the CRM content itself, not a full
 * account export.
 */
export async function buildWorkspaceBackup(workspaceId: string) {
  const [workspaceSnap, membersSnap, pagesSnap] = await Promise.all([
    getDoc(paths.workspace(workspaceId)),
    getDocs(paths.members(workspaceId)),
    getDocs(paths.pages(workspaceId)),
  ]);

  const pages = await Promise.all(
    pagesSnap.docs.map(async (pageDoc) => {
      const pageId = pageDoc.id;
      const [rowsSnap, subPagesSnap] = await Promise.all([
        getDocs(paths.rows(workspaceId, pageId)),
        getDocs(paths.subPages(workspaceId, pageId)),
      ]);
      const subPages = await Promise.all(
        subPagesSnap.docs.map(async (subPageDoc) => {
          const subPageRowsSnap = await getDocs(paths.subPageRows(workspaceId, pageId, subPageDoc.id));
          return {
            ...subPageDoc.data(),
            id: subPageDoc.id,
            rows: subPageRowsSnap.docs.map((r) => ({ ...r.data(), id: r.id })),
          };
        })
      );
      return {
        ...pageDoc.data(),
        id: pageId,
        rows: rowsSnap.docs.map((r) => ({ ...r.data(), id: r.id })),
        subPages,
      };
    })
  );

  return {
    exportedAt: new Date().toISOString(),
    workspace: workspaceSnap.exists() ? { ...workspaceSnap.data(), id: workspaceSnap.id } : null,
    members: membersSnap.docs.map((m) => ({ ...m.data(), uid: m.id })),
    pages,
  };
}

/** Builds the backup and triggers a browser download of the JSON file. */
export async function downloadWorkspaceBackup(workspaceId: string, workspaceName: string) {
  const data = await buildWorkspaceBackup(workspaceId);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const datestamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  const safeName = (workspaceName || "workspace")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[\\/:*?"<>|]+/g, "") || "workspace";
  a.download = `${safeName}-backup-${datestamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
