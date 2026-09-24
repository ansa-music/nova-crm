import {
  CollectionReference,
  DocumentData,
  deleteDoc,
  doc,
  getCountFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { getDocsResumable, withErrorReporting } from "@/firebase/firestore";
import { generateId } from "@/utils/id";
import { normalizeTimestamp } from "@/utils/date";
import type { ChatMessage } from "@/types";

/**
 * Messages are ordered by `serverOrderAt` (a Firestore serverTimestamp()),
 * NOT by `createdAt` — different people's devices can have clocks that are
 * minutes off from each other, and ordering by a client-set number made
 * messages appear scrambled/out of sequence for other participants. The
 * server timestamp is authoritative and always consistent regardless of
 * whose device sent what. `createdAt` stays a plain client number used only
 * for display (kept for date-fns formatting safety — never render a raw
 * Firestore Timestamp object directly, that's what caused the earlier
 * "Invalid time value" crash).
 */
/**
 * Только ПОСЛЕДНИЕ `max` сообщений. Подписка на весь чат читала каждое
 * сообщение за всё время — при каждом открытии, у каждого человека (счётчик
 * непрочитанных в меню висит у всех), и это съедало дневную квоту Spark.
 * Сортируем по `serverOrderAt` (он есть у всех сообщений после перехода на
 * серверное время); совсем старые сообщения без него сюда не попадают —
 * их показывает «Показать ранние» (`fetchChat`, разово по кнопке).
 *
 * Третий аргумент `onData` — снимок из кэша на диске (`fromCache`): по нему
 * можно рисовать, но не решать (правило CLAUDE.md). Подписка идёт с
 * `includeMetadataChanges`, чтобы переход «кэш → сервер» пришёл, даже если
 * сообщения не изменились; снимки, где поменялись только метаданные (своё
 * сообщение подтвердил сервер), а источник тот же, дальше не отдаём — общему
 * чату и личкам лишняя перерисовка ни к чему.
 */
export function subscribeToRecentChat(
  ref: CollectionReference<DocumentData>,
  max: number,
  onData: (messages: ChatMessage[], hasEarlier: boolean, fromCache: boolean) => void,
  onError?: (error: import("firebase/firestore").FirestoreError) => void
) {
  let lastFromCache: boolean | null = null;
  return onSnapshot(
    query(ref, orderBy("serverOrderAt", "desc"), limit(max)),
    { includeMetadataChanges: true },
    (snapshot) => {
      const fromCache = snapshot.metadata.fromCache;
      if (lastFromCache === fromCache && snapshot.docChanges().length === 0) return;
      lastFromCache = fromCache;
      const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as ChatMessage & { serverOrderAt?: unknown });
      items.forEach((m) => (m.createdAt = normalizeTimestamp(m.createdAt)));
      items.sort((a, b) => orderKey(a) - orderKey(b));
      onData(items, snapshot.size >= max, fromCache);
    },
    withErrorReporting(onError)
  );
}

function orderKey(m: ChatMessage & { serverOrderAt?: unknown }): number {
  return m.serverOrderAt ? normalizeTimestamp(m.serverOrderAt) : m.createdAt;
}

function mapChatDocs(docs: { id: string; data: () => DocumentData }[]): ChatMessage[] {
  const items = docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as ChatMessage & { serverOrderAt?: unknown });
  items.forEach((m) => (m.createdAt = normalizeTimestamp(m.createdAt)));
  items.sort((a, b) => orderKey(a) - orderKey(b));
  return items;
}

/**
 * Вся нить разово — через `getDocsResumable`, а не `getDocs` (правило CLAUDE.md
 * о разовых чтениях): с кэшем на диске повторное чтение той же нити платит
 * только за изменившееся.
 */
export async function fetchChat(ref: CollectionReference<DocumentData>): Promise<ChatMessage[]> {
  const snapshot = await getDocsResumable(ref);
  return mapChatDocs(snapshot.docs);
}

/**
 * Сообщения без `serverOrderAt` (писались до перехода на серверное время),
 * уже найденные в этой сессии: путь нити → они сами. Пустой массив — «проверено,
 * таких нет». Такие сообщения больше никто не создаёт, поэтому один раз за
 * сессию достаточно.
 *
 * Это статичный снимок: в живое окно такие сообщения не попадают никогда
 * (правка и удаление `serverOrderAt` не ставят). Поэтому СВОЮ правку и
 * удаление (`editChatMessage`/`deleteChatMessage`) переносим сюда сами и
 * будим открытые панели этой нити (`legacyListeners`); чужую правку старого
 * сообщения человек увидит в следующей сессии.
 */
const legacyByPath = new Map<string, ChatMessage[]>();
/** Открытые панели нити → перерисовать при правке старого сообщения. */
const legacyListeners = new Map<string, Set<() => void>>();

function patchLegacy(path: string, messageId: string, patch: Partial<ChatMessage> | null) {
  const list = legacyByPath.get(path);
  if (!list || !list.some((m) => m.id === messageId)) return;
  legacyByPath.set(
    path,
    patch ? list.map((m) => (m.id === messageId ? { ...m, ...patch } : m)) : list.filter((m) => m.id !== messageId)
  );
  legacyListeners.get(path)?.forEach((fn) => fn());
}

/**
 * Чат стола и комментарии к строке — окном последних `max` сообщений, как
 * общий чат (`subscribeToRecentChat`). Раньше подписка шла на ВСЮ нить без
 * limit: каждое открытие панели читало историю стола за всё время.
 *
 * Окно сортирует по `serverOrderAt`, а Firestore молча выкидывает из такой
 * выборки документы без этого поля — самые старые сообщения. В общем чате с
 * этим смирились; здесь нить могла состоять ТОЛЬКО из них, и панель
 * показала бы пустоту. Поэтому, когда окно НЕ полное (в нём вся новая
 * история), один раз за сессию на нить спрашиваем счётчик всей нити
 * (`getCountFromServer` — 1 чтение): больше, чем в окне, — значит, старые
 * есть, и их дочитываем разово. Полное окно ничего не проверяет: старые
 * сообщения старше любого нового и понадобятся, только когда «Показать
 * ранние» дойдёт до конца.
 *
 * Решает только снимок С СЕРВЕРА: окно из кэша — это, может быть, 30
 * сообщений прошлой недели, а в нити уже 400; «не полное» по кэшу и счётчик
 * 400 > 30 дочитали бы всю нить ради окна из 60. Дочитка берёт всю нить:
 * найти документы БЕЗ поля Firestore не умеет (`where(поле, "==", null)`
 * видит только явный null), — но после проверки по серверу нить заведомо
 * короче окна плюс старые сообщения.
 */
export function subscribeToRecentThread(
  ref: CollectionReference<DocumentData>,
  max: number,
  onData: (messages: ChatMessage[], hasEarlier: boolean) => void,
  onError?: (error: import("firebase/firestore").FirestoreError) => void
) {
  let stopped = false;
  let windowItems: ChatMessage[] = [];
  let windowFull = false;
  let checking = false;
  const emit = () => {
    const legacy = legacyByPath.get(ref.path) ?? [];
    if (!legacy.length) {
      onData(windowItems, windowFull);
      return;
    }
    const inWindow = new Set(windowItems.map((m) => m.id));
    const merged = [...legacy.filter((m) => !inWindow.has(m.id)), ...windowItems];
    merged.sort((a, b) => orderKey(a) - orderKey(b));
    onData(merged, windowFull);
  };
  const checkLegacy = async (windowSize: number) => {
    if (checking || legacyByPath.has(ref.path)) return;
    checking = true;
    try {
      const total = (await getCountFromServer(ref)).data().count;
      if (total <= windowSize) {
        legacyByPath.set(ref.path, []);
        return;
      }
      const all = await fetchChat(ref);
      legacyByPath.set(
        ref.path,
        all.filter((m) => !(m as ChatMessage & { serverOrderAt?: unknown }).serverOrderAt)
      );
      if (!stopped) emit();
    } catch {
      // Нет сети или отказ — просто без старых сообщений; окно уже на экране,
      // следующее открытие панели спросит снова.
    } finally {
      checking = false;
    }
  };
  const unsubscribe = subscribeToRecentChat(
    ref,
    max,
    (items, full, fromCache) => {
      windowItems = items;
      windowFull = full;
      emit();
      if (!full && !fromCache) void checkLegacy(items.length);
    },
    onError
  );
  let pathListeners = legacyListeners.get(ref.path);
  if (!pathListeners) legacyListeners.set(ref.path, (pathListeners = new Set()));
  pathListeners.add(emit);
  return () => {
    stopped = true;
    unsubscribe();
    pathListeners.delete(emit);
    if (!pathListeners.size) legacyListeners.delete(ref.path);
  };
}

export interface SendMessageInput {
  authorUid: string;
  authorName: string;
  authorPhotoURL?: string | null;
  text: string;
  replyTo?: ChatMessage | null;
}

export async function sendChatMessage(ref: CollectionReference<DocumentData>, input: SendMessageInput) {
  const id = generateId("msg");
  const message: ChatMessage = {
    id,
    authorUid: input.authorUid,
    authorName: input.authorName,
    authorPhotoURL: input.authorPhotoURL ?? null,
    text: input.text,
    createdAt: Date.now(),
    editedAt: null,
    deleted: false,
    replyToId: input.replyTo?.id ?? null,
    replyToAuthorName: input.replyTo?.authorName ?? null,
    replyToText: input.replyTo ? input.replyTo.text.slice(0, 140) : null,
  };
  await setDoc(doc(ref, id), { ...message, serverOrderAt: serverTimestamp() });
  return message;
}

export async function editChatMessage(ref: CollectionReference<DocumentData>, messageId: string, text: string) {
  const editedAt = Date.now();
  await setDoc(doc(ref, messageId), { text, editedAt }, { merge: true });
  // Старое сообщение без serverOrderAt живёт в статичном снимке — см. legacyByPath.
  patchLegacy(ref.path, messageId, { text, editedAt });
}

/** Soft-delete: keeps the doc (so replies referencing it still resolve) but clears the text and marks it deleted. */
export async function deleteChatMessage(ref: CollectionReference<DocumentData>, messageId: string) {
  const editedAt = Date.now();
  await setDoc(doc(ref, messageId), { text: "", deleted: true, editedAt }, { merge: true });
  patchLegacy(ref.path, messageId, { text: "", deleted: true, editedAt });
}

export async function hardDeleteChatMessage(ref: CollectionReference<DocumentData>, messageId: string) {
  await deleteDoc(doc(ref, messageId));
  patchLegacy(ref.path, messageId, null);
}
