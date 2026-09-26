import { deleteDoc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { supabaseRows } from "@/lib/supabaseRows";
import { fetchSbDocs, watchSbDocs, type DocFeedConfig, type DocView, type SbDoc } from "@/services/sb/docFeed";
import { createDocStore, plainFirestoreData, sbError, toFirestoreData, type DocWrite } from "@/services/sb/docStore";
import { sbTargetOf, type SbBackend } from "@/services/sb/sbCollections";
import { ringTopic } from "@/services/sb/topicDoorbell";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { WORKSPACE_CONTROL_KEYS, type JoinRequest, type SubPage, type Workspace, type WorkspaceMember, type WorkspacePage } from "@/types";

/**
 * Ядро — столы, вкладки, участники, приглашения, заявки на вход и настройки
 * workspace — в Supabase (SQL 20261029 и 20261030, таблица core_docs):
 * просьба Nurba «всё в Supabase». Документ workspace в Firestore остаётся
 * «управляющим» (ownerId, rowsBackend, sbCollections, reloadEpoch, name…):
 * его читают правила и выключатели хранилищ; профиль `users/{uid}` — тоже
 * Firestore (этап C).
 *
 * Переезд — разовым переносом из сессии Owner (`ensureCoreImported` в
 * автопилоте AppLayout), две отметки: `meta/imported_page` (столы и
 * вкладки) и `meta/imported_member` (участники, приглашения, заявки и
 * настройки). Пока отметки нет, ВСЕ читают и пишут Firestore, как раньше;
 * после — только Supabase. Трое суток после переноса та же сессия
 * дочитывает документы, добавленные вкладками на старом коде.
 *
 * В Firestore у стола и у участника остаётся ТЕНЬ — документ с полями,
 * которые читают правила остальных коллекций (`SHADOW_KEYS`,
 * `MEMBER_SHADOW_KEYS`). Тень пишется best-effort тем же действием; в
 * сессии Owner её сверяет `reconcileMemberShadows`.
 *
 * Копию прав `rows_page_acl` / `rows_members` и копию настроек в
 * `rows_workspaces` ведут ТРИГГЕРЫ базы — сверка на клиенте остаётся
 * страховкой (и в режиме Supabase участников не трогает).
 */

export const CORE_FEED: DocFeedConfig = { table: "core_docs", topic: "core", collection: "core", withParent: true };
export const CORE_MARK = "imported_page";
export const CORE_MEMBERS_MARK = "imported_member";

export type CoreKind = "page" | "subpage" | "member" | "invite" | "join" | "workspace";
export type CoreWrite = DocWrite<CoreKind>;

/** Поля стола, копия которых держится в Firestore-тени (их читают правила). */
export const SHADOW_KEYS: ReadonlySet<string> = new Set([
  "name",
  "workspaceId",
  "allowedUsers",
  "editableUsers",
  "responsibleUserId",
  "hiddenByResponsible",
  "personalZoneAllowedUsers",
  "osDesk",
  "createdBy",
  "inactive",
  "inactiveAt",
  "inactiveBy",
  "techEditable",
  "technicianDesk",
  "updatedAt",
]);

/**
 * Поля участника, копия которых держится в Firestore-тени: роль, вторая
 * роль, статус, почта — их читают isMember/myRole/hasRole у оставшихся
 * коллекций; ники — вкладкам на старом коде и правилу оценок. Поля
 * самообслуживания (nickname, photoURL, activeRole, hiddenPageIds,
 * lastActiveAt) в тень не пишутся.
 */
export const MEMBER_SHADOW_KEYS: ReadonlySet<string> = new Set([
  "uid",
  "email",
  "name",
  "role",
  "extraRoles",
  "status",
  "invitedAt",
  "invitedBy",
  "joinedAt",
  "osNick",
  "osNickValue",
  "techNick",
  "techNickValue",
  "otherNick",
  "otherNickValue",
]);

/** Поля настроек, копия которых нужна правилам Firestore (график до переезда, режим «кто заполняет столы»). */
export const SETTINGS_SHADOW_KEYS: ReadonlySet<string> = new Set(["scheduleSettings", "osManagedDesks", "techFillsAll"]);

const store = createDocStore<CoreKind>({
  feed: CORE_FEED,
  collection: "core",
  writeRpc: "core_write",
  importedStorageKey: "nova:core-imported:",
  firestoreRef: (workspaceId, write) => {
    switch (write.kind) {
      case "page":
        return paths.page(workspaceId, write.id);
      case "subpage":
        return paths.subPage(workspaceId, String(write.extra?.page ?? ""), write.id);
      case "member":
      case "invite":
        return paths.member(workspaceId, write.id);
      case "join":
        return paths.joinRequest(workspaceId, write.id);
      case "workspace":
        return paths.workspace(workspaceId);
    }
  },
});

function workspaceDoc(workspaceId: string) {
  return useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId) ?? null;
}

// ---------------------------------------------------------------------
// Где что живёт.
// ---------------------------------------------------------------------

/** Где столы и вкладки этого workspace сейчас. */
export function corePagesBackendFor(workspaceId: string): SbBackend {
  return store.backendFor(workspaceId, CORE_MARK);
}

/** То же для экрана (переподписка, когда перенос сделан). */
export function useCorePagesBackend(workspaceId: string | null): SbBackend | null {
  return store.useBackend(workspaceId, CORE_MARK);
}

/** Вне React: подписка сервиса переподписывается при смене хранилища. */
export function watchCoreBackend(workspaceId: string, onChange: (backend: SbBackend) => void): () => void {
  return store.watchBackend(workspaceId, CORE_MARK, onChange);
}

/** Где участники, приглашения, заявки и настройки этого workspace сейчас. */
export function coreMembersBackendFor(workspaceId: string): SbBackend {
  return store.backendFor(workspaceId, CORE_MEMBERS_MARK);
}

/**
 * То же по ДОКУМЕНТУ workspace, которого может не быть в сторе: страница
 * заявки на вход у постороннего (он читает документ отдельно).
 */
export function coreMembersBackendForDoc(workspaceId: string, doc: Workspace | null | undefined): SbBackend {
  if (!doc) return "firestore";
  return store.backendForDoc(workspaceId, doc, CORE_MEMBERS_MARK);
}

/** Спросить базу, стоит ли отметка переноса участников (посторонний тоже может: отметку читает любой вошедший). */
export function checkCoreMembersImported(workspaceId: string): Promise<boolean> {
  return store.checkImported(workspaceId, CORE_MEMBERS_MARK);
}

export function useCoreMembersBackend(workspaceId: string | null): SbBackend | null {
  return store.useBackend(workspaceId, CORE_MEMBERS_MARK);
}

export function watchCoreMembersBackend(workspaceId: string, onChange: (backend: SbBackend) => void): () => void {
  return store.watchBackend(workspaceId, CORE_MEMBERS_MARK, onChange);
}

/** Пачка записей в Supabase (одной транзакцией). */
export async function commitCore(workspaceId: string, writes: CoreWrite[], opts: { optimistic?: boolean } = {}): Promise<SbDoc[]> {
  const docs = await store.commit(workspaceId, writes, "supabase", CORE_MARK, opts);
  return docs ?? [];
}

export function waitCoreWrites(): Promise<void> {
  return store.waitWrites();
}

export function pageWrite(id: string, op: CoreWrite["op"], data?: Record<string, unknown>): CoreWrite {
  return { kind: "page", id, op, data };
}

export function subPageWrite(pageId: string, id: string, op: CoreWrite["op"], data?: Record<string, unknown>): CoreWrite {
  return { kind: "subpage", id, op, data, extra: { page: pageId } };
}

export function memberWrite(uid: string, op: CoreWrite["op"], data?: Record<string, unknown>): CoreWrite {
  return { kind: "member", id: uid, op, data };
}

export function inviteWrite(email: string, op: CoreWrite["op"], data?: Record<string, unknown>): CoreWrite {
  return { kind: "invite", id: email.trim().toLowerCase(), op, data };
}

export function joinWrite(uid: string, op: CoreWrite["op"], data?: Record<string, unknown>): CoreWrite {
  return { kind: "join", id: uid, op, data };
}

export function workspaceWrite(workspaceId: string, op: "merge" | "set", data: Record<string, unknown>): CoreWrite {
  return { kind: "workspace", id: workspaceId, op, data };
}

// ---------------------------------------------------------------------
// Документы ↔ типы клиента.
// ---------------------------------------------------------------------

export function docToPage(doc: SbDoc): WorkspacePage {
  return { ...(doc.data as unknown as WorkspacePage), id: doc.id };
}

export function docToSubPage(doc: SbDoc, pageId: string): SubPage {
  return { ...(doc.data as unknown as SubPage), id: doc.id, pageId: (doc.data.pageId as string) || pageId };
}

/** Участник или приглашение по почте — как документ `members/{id}` Firestore (у приглашения нет uid). */
export function docToMember(doc: SbDoc): WorkspaceMember {
  const data = doc.data as unknown as WorkspaceMember & { id?: string };
  if (doc.kind === "invite") return { ...data, id: doc.id, email: data.email || doc.id, status: "invited" } as WorkspaceMember;
  return { ...data, id: doc.id, uid: data.uid || doc.id } as WorkspaceMember;
}

export function docToJoin(doc: SbDoc): JoinRequest {
  return { ...(doc.data as unknown as JoinRequest), id: doc.id };
}

export const PAGES_VIEW: DocView = {
  initial: (q) => q.eq("kind", "page"),
  match: (d) => d.kind === "page",
};

export function subPagesView(pageId: string): DocView {
  return {
    initial: (q) => q.eq("kind", "subpage").eq("parent_id", pageId),
    match: (d) => d.kind === "subpage" && (d.parent ?? "") === pageId,
  };
}

/** Ростер: участники и приглашения по почте (как коллекция members Firestore). */
export const MEMBERS_VIEW: DocView = {
  initial: (q) => q.in("kind", ["member", "invite"]),
  match: (d) => d.kind === "member" || d.kind === "invite",
};

export const WORKSPACE_VIEW: DocView = {
  initial: (q) => q.eq("kind", "workspace"),
  match: (d) => d.kind === "workspace",
};

/** Ждущие заявки — руководству. */
export const PENDING_JOINS_VIEW: DocView = {
  initial: (q) => q.eq("kind", "join"),
  match: (d) => d.kind === "join" && d.data.status === "pending",
};

/** Своя заявка — самому человеку (посторонний читает только её). */
export function ownJoinView(uid: string): DocView {
  return {
    initial: (q) => q.eq("kind", "join").eq("id", uid),
    match: (d) => d.kind === "join" && d.id === uid,
  };
}

/** Вид потока ядра. Нет таблицы — `onMissing`: вызывающий уходит в Firestore. */
export function watchCore(
  workspaceId: string,
  view: DocView,
  onData: (docs: SbDoc[]) => void,
  onMissing: () => void,
  onError?: (error: Error) => void
): () => void {
  return watchSbDocs(CORE_FEED, workspaceId, view, (docs) => onData(docs), { onMissing, onError });
}

/** Столы — разово с сервера (null — таблицы нет). */
export async function fetchCorePages(workspaceId: string): Promise<WorkspacePage[] | null> {
  const docs = await fetchSbDocs(CORE_FEED, workspaceId, (q) => q.eq("kind", "page"));
  return docs ? docs.map(docToPage) : null;
}

export async function fetchCorePage(workspaceId: string, pageId: string): Promise<WorkspacePage | null | undefined> {
  const docs = await fetchSbDocs(CORE_FEED, workspaceId, (q) => q.eq("kind", "page").eq("id", pageId));
  if (docs === null) return undefined;
  return docs[0] ? docToPage(docs[0]) : null;
}

/** Вкладки стола — разово с сервера, по порядку (null — таблицы нет). */
export async function fetchCoreSubPages(workspaceId: string, pageId: string): Promise<SubPage[] | null> {
  const docs = await fetchSbDocs(CORE_FEED, workspaceId, (q) => q.eq("kind", "subpage").eq("parent_id", pageId));
  return docs ? sortSubPages(docs.map((d) => docToSubPage(d, pageId))) : null;
}

export async function fetchCoreSubPage(workspaceId: string, pageId: string, subPageId: string): Promise<SubPage | null | undefined> {
  const docs = await fetchSbDocs(CORE_FEED, workspaceId, (q) => q.eq("kind", "subpage").eq("parent_id", pageId).eq("id", subPageId));
  if (docs === null) return undefined;
  return docs[0] ? docToSubPage(docs[0], pageId) : null;
}

export function sortSubPages(subPages: SubPage[]): SubPage[] {
  return [...subPages].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/** Ростер (участники + приглашения) — разово с сервера, по времени приглашения (null — таблицы нет). */
export async function fetchCoreMembers(workspaceId: string): Promise<WorkspaceMember[] | null> {
  const docs = await fetchSbDocs(CORE_FEED, workspaceId, (q) => q.in("kind", ["member", "invite"]));
  return docs ? sortMembers(docs.map(docToMember)) : null;
}

export async function fetchCoreMember(workspaceId: string, uid: string): Promise<WorkspaceMember | null | undefined> {
  const docs = await fetchSbDocs(CORE_FEED, workspaceId, (q) => q.eq("kind", "member").eq("id", uid));
  if (docs === null) return undefined;
  return docs[0] ? docToMember(docs[0]) : null;
}

export async function fetchCoreInvite(workspaceId: string, email: string): Promise<WorkspaceMember | null | undefined> {
  const docs = await fetchSbDocs(CORE_FEED, workspaceId, (q) => q.eq("kind", "invite").eq("id", email.trim().toLowerCase()));
  if (docs === null) return undefined;
  return docs[0] ? docToMember(docs[0]) : null;
}

/** Настройки workspace — разово (null — таблицы нет; {} — документа ещё нет). */
export async function fetchCoreSettings(workspaceId: string): Promise<Record<string, unknown> | null> {
  const docs = await fetchSbDocs(CORE_FEED, workspaceId, (q) => q.eq("kind", "workspace").eq("id", workspaceId));
  if (docs === null) return null;
  return docs[0]?.data ?? {};
}

export async function fetchCoreJoin(workspaceId: string, uid: string): Promise<JoinRequest | null | undefined> {
  const docs = await fetchSbDocs(CORE_FEED, workspaceId, (q) => q.eq("kind", "join").eq("id", uid));
  if (docs === null) return undefined;
  return docs[0] ? docToJoin(docs[0]) : null;
}

export async function fetchCorePendingJoins(workspaceId: string): Promise<JoinRequest[] | null> {
  const docs = await fetchSbDocs(CORE_FEED, workspaceId, (q) => q.eq("kind", "join"));
  if (docs === null) return null;
  return docs
    .map(docToJoin)
    .filter((r) => r.status === "pending")
    .sort((a, b) => a.requestedAt - b.requestedAt);
}

export function sortMembers(members: WorkspaceMember[]): WorkspaceMember[] {
  return [...members].sort((a, b) => (a.invitedAt ?? 0) - (b.invitedAt ?? 0));
}

/** Настройки из объединённого документа workspace — без управляющих полей. */
export function settingsOf(workspace: Partial<Workspace>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(workspace)) {
    if (!(WORKSPACE_CONTROL_KEYS as readonly string[]).includes(key) && value !== undefined) out[key] = value;
  }
  return out;
}

// ---------------------------------------------------------------------
// Функции-действия (транзакции участников, которые раньше собирал клиент).
// Сообщения базы (`raise exception`) отдаются человеку как есть.
// ---------------------------------------------------------------------

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabaseRows.rpc(fn, args).then(
    (r) => r,
    (e: unknown) => ({ data: null, error: { code: "unavailable", message: e instanceof Error ? e.message : String(e) } })
  );
  if (error) throw sbError(error);
  // Функция сама записала документы — звонок, чтобы поток ядра (и своя
  // вкладка, и остальные) дочитал их дельтой сразу, а не по опросу.
  if (typeof args.p_workspace === "string") ringTopic(`nova:${args.p_workspace}:${CORE_FEED.topic}`);
  return data as T;
}

export interface NickRpcTarget {
  optionValue?: string;
  newNick?: string;
}

/** Закрепить (или снять — `target` null) ник участника; вариант дописывается в список. */
export function rpcNickLink(workspaceId: string, uid: string, kind: "os" | "tech" | "other", target: NickRpcTarget | null): Promise<{ value: string; label: string } | null> {
  return rpc<{ value: string; label: string } | null>("core_nick_link", { p_workspace: workspaceId, p_uid: uid, p_kind: kind, p_target: target });
}

export function rpcNickAdd(workspaceId: string, kind: "os" | "tech" | "other", label: string): Promise<{ value: string; label: string; color: string }> {
  return rpc("core_nick_add", { p_workspace: workspaceId, p_kind: kind, p_label: label });
}

export function rpcNickInactive(workspaceId: string, kind: "os" | "tech" | "other", value: string, inactive: boolean): Promise<void> {
  return rpc("core_nick_inactive", { p_workspace: workspaceId, p_kind: kind, p_value: value, p_inactive: inactive });
}

export function rpcApproveJoin(workspaceId: string, uid: string, role: string, nick: NickRpcTarget | null): Promise<{ nickLabel: string | null }> {
  return rpc("core_approve_join", { p_workspace: workspaceId, p_uid: uid, p_role: role, p_nick: nick });
}

export function rpcMemberPurge(workspaceId: string, uid: string, email: string): Promise<{ member: boolean; invite: boolean; joinRequests: number }> {
  return rpc("core_member_purge", { p_workspace: workspaceId, p_uid: uid, p_email: email });
}

export function rpcSeedStatus(workspaceId: string, option: { value: string; label: string; color: string }): Promise<boolean> {
  return rpc("core_seed_status", { p_workspace: workspaceId, p_option: option });
}

/** Приглашения по почте из токена → участник; отдаёт id workspace, куда приняли. Нет функции — []. */
export async function rpcClaimInvites(name: string, photo: string | null, nickname: string | null): Promise<string[]> {
  const { data, error } = await supabaseRows.rpc("core_claim_invites", { p_name: name, p_photo: photo, p_nickname: nickname });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") return [];
    throw sbError(error);
  }
  const list = typeof data === "string" ? (JSON.parse(data) as unknown) : data;
  const claimed = Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  for (const ws of claimed) ringTopic(`nova:${ws}:${CORE_FEED.topic}`);
  return claimed;
}

// ---------------------------------------------------------------------
// Тени в Firestore (best-effort).
// ---------------------------------------------------------------------

function pick(data: Record<string, unknown>, keys: ReadonlySet<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) if (keys.has(key) && value !== undefined) out[key] = value;
  return out;
}

/** Новый участник или приглашение — полная тень (поля правил). */
export async function shadowMemberSet(workspaceId: string, id: string, data: Record<string, unknown>) {
  if (!db) return;
  try {
    await setDoc(paths.member(workspaceId, id), toFirestoreData(pick(data, MEMBER_SHADOW_KEYS)) as Record<string, unknown>);
  } catch (error) {
    console.warn("[core] тень участника в Firestore не записана", error);
  }
}

/** Правка участника — в тень уходят только поля правил (SB_DEL → deleteField). */
export async function shadowMemberPatch(workspaceId: string, id: string, patch: Record<string, unknown>) {
  if (!db) return;
  const shadow = pick(patch, MEMBER_SHADOW_KEYS);
  if (Object.keys(shadow).length === 0) return;
  try {
    await setDoc(paths.member(workspaceId, id), toFirestoreData(shadow) as Record<string, unknown>, { merge: true });
  } catch (error) {
    console.warn("[core] тень участника в Firestore не обновлена", error);
  }
}

export async function shadowMemberDelete(workspaceId: string, id: string) {
  if (!db) return;
  try {
    await deleteDoc(paths.member(workspaceId, id));
  } catch (error) {
    console.warn("[core] тень участника в Firestore не удалена", error);
  }
}

/** Настройки, которые читают правила Firestore (график до переезда), — в управляющий документ. */
export async function shadowSettingsPatch(workspaceId: string, patch: Record<string, unknown>) {
  if (!db) return;
  const shadow = pick(patch, SETTINGS_SHADOW_KEYS);
  if (Object.keys(shadow).length === 0) return;
  try {
    await setDoc(paths.workspace(workspaceId), toFirestoreData(shadow) as Record<string, unknown>, { merge: true });
  } catch (error) {
    console.warn("[core] тень настроек в Firestore не обновлена", error);
  }
}

/**
 * Сессия Owner: тени участников в Firestore равны документам Supabase —
 * недостающие и разошедшиеся дописываются, а тени тех, кого в Supabase
 * больше нет (убрали, приглашение погашено), удаляются: иначе по правилам
 * Firestore убранный оставался бы участником. Пустой ростер из Supabase —
 * «не знаем» (у Owner своя запись есть всегда), тогда ничего не трогаем.
 * Возвращает число поправленных документов (null — участники не в Supabase).
 */
export async function reconcileMemberShadows(workspaceId: string): Promise<number | null> {
  if (!db || coreMembersBackendFor(workspaceId) !== "supabase") return null;
  const members = await fetchCoreMembers(workspaceId);
  if (!members || members.length === 0) return null;
  const snap = await getDocs(paths.members(workspaceId));
  const current = new Map(snap.docs.map((d) => [d.id, d.data() as Record<string, unknown>]));
  const live = new Set<string>();
  let fixed = 0;
  for (const member of members) {
    const id = member.uid || (member as unknown as { id?: string }).id || member.email;
    if (!id) continue;
    live.add(id);
    const want = pick(member as unknown as Record<string, unknown>, MEMBER_SHADOW_KEYS);
    const have = current.get(id);
    const same = have && Object.keys(want).every((key) => JSON.stringify(have[key] ?? null) === JSON.stringify(want[key] ?? null));
    if (same) continue;
    try {
      await setDoc(paths.member(workspaceId, id), toFirestoreData(want) as Record<string, unknown>, { merge: true });
      fixed += 1;
    } catch (error) {
      console.warn(`[core] тень участника ${id} не выровнена`, error);
    }
  }
  for (const id of current.keys()) {
    if (live.has(id)) continue;
    try {
      await deleteDoc(paths.member(workspaceId, id));
      fixed += 1;
    } catch (error) {
      console.warn(`[core] лишняя тень участника ${id} не удалена`, error);
    }
  }
  return fixed;
}

// ---------------------------------------------------------------------
// Перенос Firestore → Supabase (сессия Owner).
// ---------------------------------------------------------------------

const TAIL_MS = 3 * 24 * 60 * 60_000;
const IMPORT_CHUNK = 200;

interface ImportDoc {
  kind: CoreKind;
  id: string;
  page?: string;
  data: unknown;
}

async function importDocs(workspaceId: string, docs: ImportDoc[], mark: string) {
  for (let i = 0; i < Math.max(docs.length, 1); i += IMPORT_CHUNK) {
    const chunk = docs.slice(i, i + IMPORT_CHUNK);
    const last = i + IMPORT_CHUNK >= docs.length;
    const { error } = await supabaseRows.rpc("core_import", { p_workspace: workspaceId, p_docs: chunk, p_mark: mark, p_done: last });
    if (error) throw sbError(error);
  }
}

/**
 * Перенести столы и вкладки в Supabase, если пора. Первый раз — всё; трое
 * суток после — только документы, правленные после прошлой дочитки (база
 * оставляет более свежие по updatedAt). Возвращает число отправленных
 * документов (0 — ничего не делали).
 */
export async function ensureCorePagesImported(workspaceId: string): Promise<number> {
  const docWs = workspaceDoc(workspaceId);
  if (!db || !docWs || sbTargetOf(docWs, "core") !== "supabase") return 0;
  const meta = await store.readImportMeta(workspaceId, CORE_MARK);
  if (meta === undefined) return 0;
  const now = Date.now();
  if (meta && typeof meta.at === "number" && now - meta.at > TAIL_MS) {
    store.setImported(workspaceId, true, CORE_MARK);
    return 0;
  }
  const tailAt = typeof meta?.tailAt === "number" ? meta.tailAt : typeof meta?.at === "number" ? meta.at : 0;
  const since = meta ? tailAt - 10 * 60_000 : 0;

  const docs: ImportDoc[] = [];
  const pagesSnap = await getDocs(paths.pages(workspaceId));
  for (const d of pagesSnap.docs) {
    const data = plainFirestoreData(d.data()) as Record<string, unknown>;
    if (!since || Number(data.updatedAt ?? 0) > since) docs.push({ kind: "page", id: d.id, data });
    const subsRef = paths.subPages(workspaceId, d.id);
    const subs = since ? await getDocs(query(subsRef, where("updatedAt", ">", since))) : await getDocs(subsRef);
    for (const s of subs.docs) {
      const sub = plainFirestoreData(s.data()) as Record<string, unknown>;
      docs.push({ kind: "subpage", id: s.id, page: d.id, data: { ...sub, pageId: d.id } });
    }
  }
  await importDocs(workspaceId, docs, CORE_MARK);
  // Время дочитки (`tailAt`) в отметке ставит сама `core_import`; `at` —
  // время первого переноса — она не трогает.
  store.setImported(workspaceId, true, CORE_MARK);
  return docs.length;
}

/**
 * Перенести участников, приглашения по почте, заявки на вход и настройки
 * workspace. Документов десятки — трое суток после переноса берутся все (база
 * кладёт только новые: у участников нет `updatedAt`, старые не трогаются).
 */
export async function ensureCoreMembersImported(workspaceId: string): Promise<number> {
  const docWs = workspaceDoc(workspaceId);
  if (!db || !docWs || sbTargetOf(docWs, "core") !== "supabase") return 0;
  const meta = await store.readImportMeta(workspaceId, CORE_MEMBERS_MARK);
  if (meta === undefined) return 0;
  const now = Date.now();
  if (meta && typeof meta.at === "number" && now - meta.at > TAIL_MS) {
    store.setImported(workspaceId, true, CORE_MEMBERS_MARK);
    return 0;
  }
  const docs: ImportDoc[] = [];
  const [membersSnap, joinsSnap, wsSnap] = await Promise.all([
    getDocs(paths.members(workspaceId)),
    getDocs(paths.joinRequests(workspaceId)),
    getDoc(paths.workspace(workspaceId)),
  ]);
  for (const d of membersSnap.docs) {
    const data = plainFirestoreData(d.data()) as Record<string, unknown>;
    if (d.id.includes("@")) {
      if (data.status === "invited") docs.push({ kind: "invite", id: d.id.toLowerCase(), data: { ...data, email: d.id.toLowerCase(), status: "invited" } });
      continue;
    }
    if (data.status === "invited") continue;
    docs.push({ kind: "member", id: d.id, data: { ...data, uid: d.id } });
  }
  for (const d of joinsSnap.docs) docs.push({ kind: "join", id: d.id, data: plainFirestoreData(d.data()) });
  if (wsSnap.exists()) docs.push({ kind: "workspace", id: workspaceId, data: settingsOf(plainFirestoreData(wsSnap.data()) as Partial<Workspace>) });
  await importDocs(workspaceId, docs, CORE_MEMBERS_MARK);
  store.setImported(workspaceId, true, CORE_MEMBERS_MARK);
  return docs.length;
}

/** Обе части ядра по порядку: столы, потом участники. */
export async function ensureCoreImported(workspaceId: string): Promise<number> {
  const pages = await ensureCorePagesImported(workspaceId);
  const members = await ensureCoreMembersImported(workspaceId);
  return pages + members;
}
