import { writeBatch } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { generateDeskId, generateId } from "@/utils/id";
import { corePagesOnSupabase, ensureNewDeskAcl, seedCurrentMonthDesk, stripUndefined } from "@/services/pageService";
import { commitCore, pageWrite } from "@/services/coreStore";
import type { PageColumn, PageIconName, WorkspacePage } from "@/types";

export interface CreateManagerPageInput {
  workspaceId: string;
  name: string;
  icon: PageIconName;
  color: string;
  columns: Omit<PageColumn, "id">[];
  managerUid: string;
  order: number;
}

/** Own desks = pages this uid is responsible for. Does not delete or rewrite existing pages. */
export function countOwnDesks(
  pages: Array<{ responsibleUserId?: string | null }>,
  uid: string
): number {
  if (!uid) return 0;
  return pages.filter((page) => page.responsibleUserId === uid).length;
}

/** A plain Технарь may create until they already have one own desk. */
export function managerHasReachedPageQuota(
  pages: Array<{ responsibleUserId?: string | null }>,
  uid: string
): boolean {
  return countOwnDesks(pages, uid) >= 1;
}

/**
 * Creates a Manager's single owned page and its one-time claim atomically.
 * Firestore Rules must require the claim and page to exist in the same write
 * batch. Existing page IDs and all legacy documents remain untouched.
 */
export async function createManagerOwnedPage(input: CreateManagerPageInput): Promise<WorkspacePage> {
  if (!db) throw new Error("Firebase не настроен");
  const pageId = generateDeskId(input.managerUid);
  const now = Date.now();
  const page: WorkspacePage = {
    id: pageId,
    workspaceId: input.workspaceId,
    name: input.name.trim(),
    icon: input.icon,
    color: input.color,
    order: input.order,
    allowedUsers: [input.managerUid],
    responsibleUserId: input.managerUid,
    createdBy: input.managerUid,
    columns: input.columns.map((column, index) =>
      stripUndefined({ ...column, id: generateId("col"), order: index })
    ),
    hideMainTab: true,
    createdAt: now,
    updatedAt: now,
  };

  const batch = writeBatch(db);
  batch.set(paths.page(input.workspaceId, pageId), stripUndefined(page));
  batch.set(paths.managerPageClaim(input.workspaceId, input.managerUid), {
    uid: input.managerUid,
    pageId,
    createdAt: now,
  });
  if (corePagesOnSupabase(input.workspaceId)) {
    // Столы в Supabase: квоту «один свой стол» держит core_write (считает
    // живые столы технаря в базе); тень стола и claim в Firestore — следом,
    // best-effort (claim нужен правилам Firestore и снятию/возврату стола).
    try {
      await commitCore(input.workspaceId, [pageWrite(pageId, "set", stripUndefined(page) as unknown as Record<string, unknown>)]);
    } catch (error) {
      if ((error as { code?: string }).code === "42501") throw new Error("Достигнут лимит страниц: у технаря может быть только один свой стол");
      throw error;
    }
    await batch.commit().catch((error) => console.warn("[core] тень стола технаря / claim в Firestore не записаны", error));
    return seedCurrentMonthDesk(page);
  }
  await batch.commit();
  await ensureNewDeskAcl(input.workspaceId, page);
  // Month tab after the atomic page+claim batch — never inside it.
  return seedCurrentMonthDesk(page);
}
