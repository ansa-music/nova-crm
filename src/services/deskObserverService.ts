import { deleteDoc, getDoc, getDocs, getDocsFromServer, setDoc } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { accessBackendNow, accessErrorText, commitAccess, fetchAccessDocs } from "@/services/accessStore";
import { usesSupabaseRows } from "@/services/rows/rowsBackend";
import { setObserverAcl } from "@/services/rows/rowAclService";
import type { SbDoc } from "@/services/sb/docFeed";
import type { SbBackend } from "@/services/sb/sbCollections";

/**
 * «Наблюдатель» — человек, которому Owner открыл ЧУЖИЕ столы на ЧТЕНИЕ.
 *
 * Функция сделана тихой по просьбе владельца: выдаётся со скрытой страницы
 * `/observers` (её нет ни в меню, ни в поиске), а сам факт выдачи лежит
 * отдельным документом `deskObservers/{uid}`, который по правилам читают
 * ТОЛЬКО Owner и сам наблюдатель. В `members` он не пишется намеренно:
 * member-документы читает весь workspace, и признак был бы виден каждому.
 * В `allowedUsers` стола наблюдатель тоже не попадает — иначе ответственный
 * увидел бы его в «Доступе к столу».
 *
 * Права ровно на просмотр: правка (`canEditPage`) по-прежнему требует
 * ответственного или явный `editableUsers`, личная зона чужого стола
 * (`canUsePersonalZone`) не открывается.
 *
 * С 13.10.2026 документ живёт в Supabase (`access_docs`, вид `observer`, см.
 * `accessStore`): `access_write` пишет его вместе с `rows_desk_observers` —
 * той копией, по которой RLS открывает строки. В Firestore остаётся ТЕНЬ
 * `deskObservers/{uid}` (best-effort): её читает правило `canAccessPage` у
 * коллекций, которые ещё не переехали, и вкладки на старом коде. Пока
 * отметки переноса нет — всё в Firestore, как раньше.
 *
 * Честная граница: код проекта лежит в ПУБЛИЧНОМ репозитории, поэтому
 * «скрытая» здесь значит «не видно в интерфейсе», а не «невозможно узнать о
 * существовании». Не выводится именно то, что важно: КТО наблюдатель.
 */
export interface DeskObserver {
  uid: string;
  grantedAt: number;
  grantedBy: string;
  /** Подпись на момент выдачи — чтобы список Owner читался, даже если человека убрали. */
  label?: string;
}

interface ObserverState {
  /** `${workspaceId}:${uid}:${хранилище}` — под кого загружено. */
  key: string;
  observer: boolean;
  loaded: boolean;
}

let state: ObserverState = { key: "", observer: false, loaded: false };
const listeners = new Set<() => void>();

function publish(next: ObserverState) {
  // Ссылка меняется только при настоящем изменении: снимок читает
  // useSyncExternalStore и сравнивает его по ссылке.
  if (next.key === state.key && next.observer === state.observer && next.loaded === state.loaded) return;
  state = next;
  listeners.forEach((fn) => fn());
}

export function deskObserverState(): ObserverState {
  return state;
}

export function subscribeDeskObserverState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function mapObserver(doc: SbDoc): DeskObserver {
  const data = doc.data as Partial<DeskObserver>;
  return {
    uid: doc.id,
    grantedAt: Number(data.grantedAt ?? 0),
    grantedBy: String(data.grantedBy ?? ""),
    ...(data.label !== undefined ? { label: String(data.label) } : {}),
  };
}

/**
 * Разовое чтение своего документа — без `onSnapshot`: право выдают раз в
 * полгода, а постоянных слушателей на Spark и так впритык. Выдали при
 * открытом приложении — человек увидит столы после перезагрузки.
 * `backend` даёт экран (`useAccessBackend`), чтобы не читать Firestore, пока
 * хранилище ещё не известно.
 */
export async function loadDeskObserver(workspaceId: string | null, uid: string | null, backend?: SbBackend) {
  if (!db || !workspaceId || !uid) {
    publish({ key: "", observer: false, loaded: false });
    return;
  }
  const where = backend ?? (await accessBackendNow(workspaceId));
  const key = `${workspaceId}:${uid}:${where}`;
  if (state.key === key && state.loaded) return;
  try {
    let observer: boolean | null = null;
    if (where === "supabase") {
      const docs = await fetchAccessDocs(workspaceId, "observer", uid);
      if (docs !== null) observer = docs.length > 0;
    }
    if (observer === null) {
      const snap = await getDoc(paths.deskObserver(workspaceId, uid));
      observer = snap.exists();
    }
    publish({ key, observer, loaded: true });
  } catch {
    // Отказ чтения = «не подтверждено», а не «прав нет»: молча считаем, что
    // наблюдателем не является, но и `loaded` не ставим — повторим позже.
    publish({ key: "", observer: false, loaded: false });
  }
}

/** Наблюдатели — С СЕРВЕРА, мимо кэша: для сверки прав строк в Supabase (см. fetchMembersFresh). */
export async function fetchDeskObserverUidsFresh(workspaceId: string): Promise<string[]> {
  if (!db) throw new Error("Firebase не настроен");
  if ((await accessBackendNow(workspaceId)) === "supabase") {
    const docs = await fetchAccessDocs(workspaceId, "observer");
    if (docs !== null) return docs.map((d) => d.id);
  }
  const snap = await getDocsFromServer(paths.deskObservers(workspaceId));
  return snap.docs.map((d) => d.id);
}

/** Список наблюдателей — читает только Owner. */
export async function fetchDeskObservers(workspaceId: string): Promise<DeskObserver[]> {
  if (!db) throw new Error("Firebase не настроен");
  if ((await accessBackendNow(workspaceId)) === "supabase") {
    const docs = await fetchAccessDocs(workspaceId, "observer");
    if (docs !== null) return docs.map(mapObserver).sort((a, b) => (b.grantedAt ?? 0) - (a.grantedAt ?? 0));
  }
  const snap = await getDocs(paths.deskObservers(workspaceId));
  return snap.docs
    .map((d) => ({ uid: d.id, ...d.data() }) as DeskObserver)
    .sort((a, b) => (b.grantedAt ?? 0) - (a.grantedAt ?? 0));
}

export async function grantDeskObserver(input: {
  workspaceId: string;
  uid: string;
  label: string;
  ownerUid: string;
}) {
  if (!db) throw new Error("Firebase не настроен");
  const data = {
    uid: input.uid,
    label: input.label,
    grantedAt: Date.now(),
    grantedBy: input.ownerUid,
  };
  if ((await accessBackendNow(input.workspaceId)) === "supabase") {
    // База кладёт наблюдателя и в rows_desk_observers той же транзакцией.
    await commitAccess(input.workspaceId, [{ kind: "observer", id: input.uid, op: "set", data }]).catch((error) => {
      throw new Error(accessErrorText(error));
    });
    await shadow(() => setDoc(paths.deskObserver(input.workspaceId, input.uid), data));
    return;
  }
  await setDoc(paths.deskObserver(input.workspaceId, input.uid), data);
  await mirrorObserver(input.workspaceId, input.uid, true);
}

export async function revokeDeskObserver(workspaceId: string, uid: string) {
  if (!db) throw new Error("Firebase не настроен");
  if ((await accessBackendNow(workspaceId)) === "supabase") {
    await commitAccess(workspaceId, [{ kind: "observer", id: uid, op: "delete" }]).catch((error) => {
      throw new Error(accessErrorText(error));
    });
    await shadow(() => deleteDoc(paths.deskObserver(workspaceId, uid)));
    return;
  }
  await deleteDoc(paths.deskObserver(workspaceId, uid));
  await mirrorObserver(workspaceId, uid, false);
}

/**
 * Полное удаление человека: его документ наблюдателя в Supabase (если
 * доступы уже там) — best-effort; тень в Firestore и копию прав чистит сам
 * вызывающий.
 */
export async function dropDeskObserverDoc(workspaceId: string, uid: string): Promise<void> {
  if ((await accessBackendNow(workspaceId)) !== "supabase") return;
  await commitAccess(workspaceId, [{ kind: "observer", id: uid, op: "delete" }]).catch((error) =>
    console.warn("[access] документ наблюдателя в Supabase не удалён", error)
  );
}

/** Тень в Firestore — отказ не откатывает запись в базе. */
async function shadow(write: () => Promise<void>) {
  try {
    await write();
  } catch (error) {
    console.warn("[access] тень наблюдателя в Firestore не записана", error);
  }
}

/**
 * Строки в Supabase — наблюдатель в копии прав сразу (Owner-only и там).
 * Отказ не откатывает Firestore: сверка Owner доведёт копию сама.
 */
async function mirrorObserver(workspaceId: string, uid: string, on: boolean) {
  if (!usesSupabaseRows(workspaceId)) return;
  try {
    await setObserverAcl(workspaceId, uid, on);
  } catch (error) {
    console.warn("[rows-acl] наблюдатель не записан в копию прав — доделает сверка", error);
  }
}
