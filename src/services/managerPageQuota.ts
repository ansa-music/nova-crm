import { writeBatch } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { generateId } from "@/utils/id";
import { stripUndefined } from "@/services/pageService";
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

/**
 * Creates a Manager's single owned page and its one-time claim atomically.
 * Firestore Rules must require the claim and page to exist in the same write
 * batch. Existing page IDs and all legacy documents remain untouched.
 */
export async function createManagerOwnedPage(input: CreateManagerPageInput): Promise<WorkspacePage> {
  if (!db) throw new Error("Firebase не настроен");
  const pageId = generateId("page");
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
  await batch.commit();
  return page;
}
