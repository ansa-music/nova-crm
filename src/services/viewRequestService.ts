import { getDocs, onSnapshot, query, setDoc, where } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { generateId } from "@/utils/id";
import { normalizeTimestamp } from "@/utils/date";
import { pingInboxChanged } from "@/utils/inboxEvents";
import { sendNotification } from "@/services/notificationService";
import { toggleUserPageAccess } from "@/services/pageService";
import type { ViewRequest, WorkspacePage } from "@/types";

function mapRequests(docs: { id: string; data: () => import("firebase/firestore").DocumentData }[]): ViewRequest[] {
  return docs
    .map((d) => ({ id: d.id, ...d.data() }) as ViewRequest)
    .map((r) => ({
      ...r,
      createdAt: normalizeTimestamp(r.createdAt),
      updatedAt: normalizeTimestamp(r.updatedAt),
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function fetchMyViewRequests(workspaceId: string, uid: string): Promise<ViewRequest[]> {
  const fromSnap = await getDocs(query(paths.viewRequests(workspaceId), where("fromUid", "==", uid)));
  const toSnap = await getDocs(query(paths.viewRequests(workspaceId), where("toUid", "==", uid)));
  const byId = new Map<string, ViewRequest>();
  for (const row of mapRequests([...fromSnap.docs, ...toSnap.docs])) byId.set(row.id, row);
  return Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export function subscribeToMyViewRequests(
  workspaceId: string,
  uid: string,
  cb: (rows: ViewRequest[]) => void
) {
  const fromQ = query(paths.viewRequests(workspaceId), where("fromUid", "==", uid));
  const toQ = query(paths.viewRequests(workspaceId), where("toUid", "==", uid));
  let fromRows: ViewRequest[] = [];
  let toRows: ViewRequest[] = [];
  const emit = () => {
    const byId = new Map<string, ViewRequest>();
    for (const row of [...fromRows, ...toRows]) byId.set(row.id, row);
    cb(Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt));
  };
  const unsubFrom = onSnapshot(fromQ, (snap) => {
    fromRows = mapRequests(snap.docs);
    emit();
  });
  const unsubTo = onSnapshot(toQ, (snap) => {
    toRows = mapRequests(snap.docs);
    emit();
  });
  return () => {
    unsubFrom();
    unsubTo();
  };
}

export function latestRequestForPage(requests: ViewRequest[], pageId: string, fromUid: string): ViewRequest | null {
  return requests.find((r) => r.pageId === pageId && r.fromUid === fromUid) ?? null;
}

export async function requestDeskView(input: {
  workspaceId: string;
  page: WorkspacePage;
  fromUid: string;
  fromName: string;
  toUid: string;
  existing: ViewRequest[];
}): Promise<ViewRequest | null> {
  if (!db) throw new Error("Firebase не настроен");
  const current = latestRequestForPage(input.existing, input.page.id, input.fromUid);
  if (current?.status === "pending") return current;
  const id = generateId("viewreq");
  const now = Date.now();
  const row: ViewRequest = {
    id,
    workspaceId: input.workspaceId,
    pageId: input.page.id,
    pageName: input.page.name,
    fromUid: input.fromUid,
    fromName: input.fromName,
    toUid: input.toUid,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
  await setDoc(paths.viewRequest(input.workspaceId, id), row);
  await sendNotification(
    {
      workspaceId: input.workspaceId,
      title: `${input.fromName} просит смотреть стол ${input.page.name}`,
      body: "Принять или отклонить запрос на просмотр.",
      priority: "important",
      fromUid: input.fromUid,
      fromName: input.fromName,
      target: "selected",
      href: "/desks",
      pageId: input.page.id,
      kind: "view-request",
      viewRequestId: id,
    },
    [input.toUid]
  ).catch(() => {
    /* request itself already saved */
  });
  pingInboxChanged();
  return row;
}

export async function resolveDeskViewRequest(input: {
  workspaceId: string;
  request: ViewRequest;
  page: WorkspacePage | undefined;
  status: "approved" | "denied";
  actorUid: string;
  actorName: string;
}) {
  if (!db) throw new Error("Firebase не настроен");
  await setDoc(
    paths.viewRequest(input.workspaceId, input.request.id),
    { status: input.status, updatedAt: Date.now() },
    { merge: true }
  );
  if (input.status === "approved" && input.page) {
    await toggleUserPageAccess(input.workspaceId, input.page, input.request.fromUid, true);
  }
  await sendNotification(
    {
      workspaceId: input.workspaceId,
      title:
        input.status === "approved"
          ? `Доступ к столу «${input.request.pageName}» открыт`
          : `Запрос к столу «${input.request.pageName}» отклонён`,
      body:
        input.status === "approved"
          ? "Можно открыть стол."
          : "Можно отправить запрос ещё раз.",
      priority: "normal",
      fromUid: input.actorUid,
      fromName: input.actorName,
      target: "selected",
      href: input.status === "approved" ? `/page/${input.request.pageId}` : "/desks",
      pageId: input.request.pageId,
      kind: "view-request-result",
      viewRequestId: input.request.id,
    },
    [input.request.fromUid]
  ).catch(() => {
    /* status already written */
  });
  pingInboxChanged();
}
