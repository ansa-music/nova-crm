import { collection, deleteDoc, doc, getDoc, onSnapshot, query, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { supabaseRows } from "@/lib/supabaseRows";
import { sendNotification } from "@/services/notificationService";
import {
  isSbMissingError,
  markSbTableMissing,
  markSbTablePresent,
  sbBackendOf,
  sbTableRecheckDue,
  sbTargetOf,
  useSbBackend,
  type SbBackend,
} from "@/services/sb/sbCollections";
import { listenTopic, ringTopic } from "@/services/sb/topicDoorbell";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { deskRowHref } from "@/utils/deskLinks";

/**
 * Запрос технаря к ОС по заказу, который ведёт ОС (просьба Nurba 23.09.2026:
 * «добавь технарю заявку на удаление или изменение статуса — отправлять к
 * ОС»). Технарь в такой строке статус не меняет и строку не удаляет (это
 * держит база), поэтому просит — а решает ОС этого заказа.
 *
 * Один документ на строку-заказ: id = стол технаря + строка. Повторная
 * просьба перезаписывает прежнюю, а не копит их. Правила: пишет технарь за
 * себя и только `pending`; решает ОС этого заказа (или руководство) — только
 * `state` и отметки о решении; читают трое — технарь, ОС и руководство.
 * «Успешка» живёт своим путём (`successRequestedAt` на строке) и сюда не
 * переносится.
 */

export type OrderRequestKind = "delete" | "status";
export type OrderRequestState = "pending" | "approved" | "rejected";

export interface OrderRequest {
  id: string;
  workspaceId: string;
  kind: OrderRequestKind;
  /** Для `status` — какой статус просят (значение варианта) и его подпись. */
  status: string | null;
  statusLabel: string | null;
  /** Почему — пишет технарь. */
  note: string;
  techUid: string;
  techName: string;
  osUid: string;
  client: string;
  /** Строка-копия в столе технаря. */
  deskPageId: string;
  deskTabId: string | null;
  rowId: string;
  /** Строка-источник на столе ОС. */
  srcPageId: string;
  srcTabId: string | null;
  srcRowId: string;
  state: OrderRequestState;
  createdAt: number;
  resolvedAt: number | null;
  resolvedBy: string | null;
}

export const ORDER_REQUEST_NOTE_MAX = 300;

// ---------------------------------------------------------------------
// Где живут запросы (26.09.2026, SQL 20261010): таблица order_requests в
// Supabase, пока её нет — Firestore, как раньше. Просьбы Firestore-эпохи
// (до переезда) читаются оттуда же и решаются там, где лежат: база отвечает
// «просьбы нет» — идём в Firestore.
// ---------------------------------------------------------------------

const REQUESTS_TABLE = "order_requests";
const REQUEST_COLUMNS = "id,data,rev,deleted,state,server_at";

export function orderRequestsBackendFor(workspaceId: string): SbBackend {
  const docWs = useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId);
  if (!docWs) return "firestore";
  const backend = sbBackendOf(docWs, "orderRequests");
  if (backend === "firestore" && sbTargetOf(docWs, "orderRequests") === "supabase" && sbTableRecheckDue("orderRequests")) {
    return "supabase";
  }
  return backend;
}

export function useOrderRequestsBackend(workspaceId: string | null): SbBackend | null {
  const workspace = useWorkspaceStore((s) => (workspaceId ? (s.workspaces.find((w) => w.id === workspaceId) ?? null) : null));
  return useSbBackend(workspace, "orderRequests");
}

function requestsTopic(workspaceId: string) {
  return `nova:${workspaceId}:orderreq`;
}

interface RequestRow {
  id: string;
  data: Record<string, unknown> | null;
  rev: number | string;
  deleted: boolean;
  state: string;
  server_at?: string;
}

function rowToRequest(row: RequestRow, workspaceId: string): OrderRequest {
  return { ...(row.data as unknown as OrderRequest), id: row.id, workspaceId };
}

function sbFail(error: { code?: string; message?: string }): Error {
  return Object.assign(new Error(error.message || "Supabase"), { code: error.code || "unavailable" });
}

/** Нет таблицы (SQL не накатан) или записи — вызывающий идёт в Firestore. */
class NotInSupabase extends Error {}

async function sbRpc<T>(name: string, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabaseRows.rpc(name, params);
  if (error) {
    if (isSbMissingError(error)) {
      markSbTableMissing("orderRequests");
      throw new NotInSupabase(name);
    }
    if (error.code === "P0002") throw new NotInSupabase(name);
    throw sbFail(error);
  }
  markSbTablePresent("orderRequests");
  return data as T;
}

/** Открытые подписки вкладки: своя запись ложится в них сразу. */
const liveRequestSinks = new Map<string, Set<(row: RequestRow) => void>>();

function applyLocalRequest(workspaceId: string, value: unknown) {
  const obj = (typeof value === "string" ? JSON.parse(value) : value) as Record<string, unknown> | null;
  if (!obj || typeof obj.id !== "string") return;
  const row: RequestRow = {
    id: obj.id,
    data: obj,
    rev: Number(obj.rev) || 0,
    deleted: Boolean(obj.deleted),
    state: String(obj.state ?? ""),
  };
  for (const sink of [...(liveRequestSinks.get(workspaceId) ?? [])]) sink(row);
  ringTopic(requestsTopic(workspaceId));
}

const REQ_RING_SETTLE_MS = 250;
const REQ_POLL_MS = 45_000;
const REQ_HIDDEN_POLL_EVERY = 4;
const REQ_RETRY_MS = [3_000, 10_000, 30_000];
const REQ_SAFETY_MS = 15_000;

/**
 * Ожидающие запросы, где я — `field` (ОС заказа или технарь), из обоих
 * хранилищ. Supabase — окно ожидающих + дельта по rev по звонку и опросу;
 * Firestore — прежний узкий запрос (просьбы до переезда).
 */
function sbSubscribePending(
  workspaceId: string,
  field: "osUid" | "techUid",
  uid: string,
  onData: (requests: OrderRequest[]) => void,
  onError: (error: Error) => void
): () => void {
  const column = field === "osUid" ? "os_uid" : "tech_uid";
  let stopped = false;
  let synced = false;
  let fsReady = !db;
  let inFlight = false;
  let again = false;
  let failures = 0;
  let cursorRev = 0;
  let revLog: { rev: number; seenAt: number }[] = [];
  let ringTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTick = 0;
  let told = false;
  const sb = new Map<string, OrderRequest>();
  const sbRev = new Map<string, number>();
  let fs: OrderRequest[] = [];

  const emit = () => {
    if (stopped || !synced || !fsReady) return;
    const byId = new Map<string, OrderRequest>();
    for (const r of fs) byId.set(r.id, r);
    for (const r of sb.values()) byId.set(r.id, r);
    onData([...byId.values()].sort((a, b) => a.createdAt - b.createdAt));
  };

  const take = (row: RequestRow): boolean => {
    const rev = Number(row.rev) || 0;
    if (rev === 0 && row.deleted) return sb.delete(row.id);
    const known = sbRev.get(row.id);
    if (known !== undefined && known >= rev) return false;
    sbRev.set(row.id, rev);
    const request = rowToRequest(row, workspaceId);
    if (row.deleted || request.state !== "pending" || request[field] !== uid) return sb.delete(row.id);
    sb.set(row.id, request);
    return true;
  };

  const cursor = () => {
    const now = Date.now();
    for (const e of revLog) if (now - e.seenAt >= REQ_SAFETY_MS && e.rev > cursorRev) cursorRev = e.rev;
    revLog = revLog.filter((e) => e.rev > cursorRev);
    return cursorRev;
  };

  async function fetchRows() {
    if (stopped) return;
    if (inFlight) {
      again = true;
      return;
    }
    inFlight = true;
    try {
      let changed = false;
      const base = () => supabaseRows.from(REQUESTS_TABLE).select(REQUEST_COLUMNS).eq("workspace_id", workspaceId);
      if (!synced) {
        const head = await supabaseRows.from(REQUESTS_TABLE).select("rev").eq("workspace_id", workspaceId).order("rev", { ascending: false }).limit(30);
        if (stopped) return;
        if (head.error) throw head.error;
        const { data, error } = await base().eq(column, uid).eq("state", "pending").eq("deleted", false).limit(500);
        if (stopped) return;
        if (error) throw error;
        for (const row of (data ?? []) as RequestRow[]) take(row);
        const heads = ((head.data ?? []) as { rev: number | string }[]).map((r) => Number(r.rev) || 0);
        cursorRev = heads.length >= 30 ? Math.min(...heads) - 1 : 0;
        const seenAt = Date.now();
        for (const rev of heads) if (rev > cursorRev) revLog.push({ rev, seenAt });
        synced = true;
        changed = true;
      } else {
        const after = cursor();
        const { data, error } = await base().gt("rev", after).order("rev", { ascending: true }).limit(500);
        if (stopped) return;
        if (error) throw error;
        const seenAt = Date.now();
        for (const row of (data ?? []) as RequestRow[]) {
          if (take(row)) changed = true;
          const rev = Number(row.rev) || 0;
          if (rev > cursorRev) revLog.push({ rev, seenAt });
        }
      }
      markSbTablePresent("orderRequests");
      failures = 0;
      told = false;
      if (changed) emit();
    } catch (error) {
      if (stopped) return;
      if (isSbMissingError(error)) {
        // SQL не накатан: дальше только Firestore (экран переподпишется сам).
        markSbTableMissing("orderRequests");
        synced = true;
        sb.clear();
        emit();
        return;
      }
      const delay = REQ_RETRY_MS[Math.min(failures, REQ_RETRY_MS.length - 1)];
      failures += 1;
      if (!retryTimer) {
        retryTimer = setTimeout(() => {
          retryTimer = null;
          void fetchRows();
        }, delay);
      }
      if (!synced && !told) {
        told = true;
        onError(sbFail(error as { code?: string; message?: string }));
      }
    } finally {
      inFlight = false;
      if (again) {
        again = false;
        void fetchRows();
      }
    }
  }

  const schedule = () => {
    if (stopped || ringTimer) return;
    ringTimer = setTimeout(() => {
      ringTimer = null;
      void fetchRows();
    }, REQ_RING_SETTLE_MS);
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") schedule();
  };
  const sink = (row: RequestRow) => {
    if (take(row)) emit();
  };
  let sinks = liveRequestSinks.get(workspaceId);
  if (!sinks) liveRequestSinks.set(workspaceId, (sinks = new Set()));
  sinks.add(sink);

  const stopRing = listenTopic(requestsTopic(workspaceId), schedule);
  document.addEventListener("visibilitychange", onVisible);
  const poll = setInterval(() => {
    pollTick += 1;
    if (document.visibilityState === "visible" || pollTick % REQ_HIDDEN_POLL_EVERY === 0) void fetchRows();
  }, REQ_POLL_MS);

  let stopFs: () => void = () => {};
  if (db) {
    stopFs = onSnapshot(
      query(requestsCol(workspaceId), where(field, "==", uid), where("state", "==", "pending")),
      (snap) => {
        fs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as OrderRequest);
        fsReady = true;
        emit();
      },
      (error) => {
        // Firestore отказал — считаем, что старых просьб нет, но Supabase живёт.
        console.error("Старые запросы технарей (Firestore) не прочитаны:", error.message);
        fs = [];
        fsReady = true;
        emit();
      }
    );
  }
  void fetchRows();

  return () => {
    stopped = true;
    stopRing();
    stopFs();
    clearInterval(poll);
    if (ringTimer) clearTimeout(ringTimer);
    if (retryTimer) clearTimeout(retryTimer);
    document.removeEventListener("visibilitychange", onVisible);
    sinks?.delete(sink);
  };
}

function requestsCol(workspaceId: string) {
  if (!db) throw new Error("Firebase не настроен");
  return collection(db, "workspaces", workspaceId, "orderRequests");
}

export function orderRequestId(deskPageId: string, rowId: string): string {
  return `${deskPageId}_${rowId}`.replace(/[^A-Za-z0-9_-]/g, "");
}

export type NewOrderRequest = Omit<OrderRequest, "id" | "workspaceId" | "state" | "createdAt" | "resolvedAt" | "resolvedBy">;

/** Технарь просит ОС. Уведомление уходит ОС этого заказа. */
export async function submitOrderRequest(workspaceId: string, input: NewOrderRequest): Promise<void> {
  const id = orderRequestId(input.deskPageId, input.rowId);
  const now = Date.now();
  const data: Omit<OrderRequest, "id"> = {
    ...input,
    note: input.note.trim().slice(0, ORDER_REQUEST_NOTE_MAX),
    workspaceId,
    state: "pending",
    createdAt: now,
    resolvedAt: null,
    resolvedBy: null,
  };
  let saved = false;
  if (orderRequestsBackendFor(workspaceId) === "supabase") {
    try {
      applyLocalRequest(workspaceId, await sbRpc<unknown>("order_request_submit", { p_workspace: workspaceId, p_req: { ...data, id } }));
      saved = true;
    } catch (error) {
      if (!(error instanceof NotInSupabase)) throw error;
    }
  }
  if (!saved) await setDoc(doc(requestsCol(workspaceId), id), data);
  const what = input.kind === "delete" ? "удалить заказ" : `статус «${input.statusLabel ?? input.status ?? ""}»`;
  await sendNotification(
    {
      workspaceId,
      title: `Технарь просит: ${what}`,
      body: `${input.techName}${input.client ? ` · ${input.client}` : ""}${input.note.trim() ? ` · ${input.note.trim()}` : ""}`,
      priority: "important",
      fromUid: input.techUid,
      fromName: input.techName,
      target: "selected",
      selectedUids: [input.osUid],
      pageId: input.srcPageId,
      // Сразу на вкладку и строку-источник у ОС, а не на стол в целом.
      href: deskRowHref(input.srcPageId, input.srcTabId, input.srcRowId),
      kind: "order-request",
    },
    [input.osUid]
  ).catch(() => undefined);
}

/** Отозвать свою просьбу, пока её не рассмотрели. */
export async function withdrawOrderRequest(workspaceId: string, id: string): Promise<void> {
  if (orderRequestsBackendFor(workspaceId) === "supabase") {
    try {
      const done = await sbRpc<boolean>("order_request_withdraw", { p_workspace: workspaceId, p_id: id });
      if (done) {
        // rev 0 — «убрать с экрана», номер правки придёт дельтой.
        applyLocalRequest(workspaceId, { id, deleted: true, rev: 0, state: "pending" });
        return;
      }
      // В базе просьбы нет — она из Firestore (подана до переезда).
    } catch (error) {
      if (!(error instanceof NotInSupabase)) throw error;
    }
  }
  await deleteDoc(doc(requestsCol(workspaceId), id));
}

export async function fetchOrderRequest(workspaceId: string, id: string): Promise<OrderRequest | null> {
  if (orderRequestsBackendFor(workspaceId) === "supabase") {
    const { data, error } = await supabaseRows.from(REQUESTS_TABLE).select(REQUEST_COLUMNS).eq("workspace_id", workspaceId).eq("id", id).limit(1);
    if (error && isSbMissingError(error)) markSbTableMissing("orderRequests");
    else if (error) throw sbFail(error);
    const row = ((data ?? []) as RequestRow[])[0];
    if (row) return row.deleted ? null : rowToRequest(row, workspaceId);
  }
  const snap = await getDoc(doc(requestsCol(workspaceId), id));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as OrderRequest) : null;
}

/** ОС решил. Технарю — уведомление с итогом. */
export async function resolveOrderRequest(
  workspaceId: string,
  request: OrderRequest,
  approved: boolean,
  me: { uid: string; name: string }
): Promise<void> {
  let saved = false;
  if (orderRequestsBackendFor(workspaceId) === "supabase") {
    try {
      applyLocalRequest(
        workspaceId,
        await sbRpc<unknown>("order_request_resolve", { p_workspace: workspaceId, p_id: request.id, p_approved: approved })
      );
      saved = true;
    } catch (error) {
      if (!(error instanceof NotInSupabase)) throw error;
    }
  }
  if (!saved) {
    await updateDoc(doc(requestsCol(workspaceId), request.id), {
      state: approved ? "approved" : "rejected",
      resolvedAt: Date.now(),
      resolvedBy: me.uid,
    });
  }
  const what = request.kind === "delete" ? "удалить заказ" : `статус «${request.statusLabel ?? request.status ?? ""}»`;
  await sendNotification(
    {
      workspaceId,
      title: approved ? `ОС принял: ${what}` : `ОС отклонил: ${what}`,
      body: request.client || "Заказ",
      priority: "normal",
      fromUid: me.uid,
      fromName: me.name,
      target: "selected",
      selectedUids: [request.techUid],
      pageId: request.deskPageId,
      // Технарю — сразу на его строку-заказ.
      href: deskRowHref(request.deskPageId, request.deskTabId, request.rowId),
      kind: "order-request",
    },
    [request.techUid]
  ).catch(() => undefined);
}

/** Ожидающие запросы к этому ОС — живой список (два равенства, индекс не нужен). */
export function subscribePendingOrderRequests(
  workspaceId: string,
  osUid: string,
  onData: (requests: OrderRequest[]) => void,
  onError: (error: Error) => void,
  backend?: SbBackend | null
): () => void {
  if ((backend ?? orderRequestsBackendFor(workspaceId)) === "supabase") return sbSubscribePending(workspaceId, "osUid", osUid, onData, onError);
  const q = query(requestsCol(workspaceId), where("osUid", "==", osUid), where("state", "==", "pending"));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as OrderRequest).sort((a, b) => a.createdAt - b.createdAt)),
    onError
  );
}

/**
 * Мои ожидающие просьбы (я — технарь, в том числе Owner за своим столом):
 * метка «Просит: Готово» в ячейке статуса. Два равенства — индекс не нужен,
 * а правило чтения (`techUid == я`) запрос проходит целиком.
 */
export function subscribeMyPendingOrderRequests(
  workspaceId: string,
  techUid: string,
  onData: (requests: OrderRequest[]) => void,
  onError: (error: Error) => void,
  backend?: SbBackend | null
): () => void {
  if ((backend ?? orderRequestsBackendFor(workspaceId)) === "supabase") return sbSubscribePending(workspaceId, "techUid", techUid, onData, onError);
  const q = query(requestsCol(workspaceId), where("techUid", "==", techUid), where("state", "==", "pending"));
  return onSnapshot(q, (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as OrderRequest)), onError);
}
