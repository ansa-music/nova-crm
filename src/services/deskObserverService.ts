import { deleteDoc, getDoc, getDocs, getDocsFromServer, setDoc } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { usesSupabaseRows } from "@/services/rows/rowsBackend";
import { setObserverAcl } from "@/services/rows/rowAclService";

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
  /** `${workspaceId}:${uid}` — под кого загружено. */
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

/**
 * Разовое чтение своего документа — без `onSnapshot`: право выдают раз в
 * полгода, а постоянных слушателей на Spark и так впритык. Выдали при
 * открытом приложении — человек увидит столы после перезагрузки.
 */
export async function loadDeskObserver(workspaceId: string | null, uid: string | null) {
  if (!db || !workspaceId || !uid) {
    publish({ key: "", observer: false, loaded: false });
    return;
  }
  const key = `${workspaceId}:${uid}`;
  if (state.key === key && state.loaded) return;
  try {
    const snap = await getDoc(paths.deskObserver(workspaceId, uid));
    publish({ key, observer: snap.exists(), loaded: true });
  } catch {
    // Отказ чтения = «не подтверждено», а не «прав нет»: молча считаем, что
    // наблюдателем не является, но и `loaded` не ставим — повторим позже.
    publish({ key: "", observer: false, loaded: false });
  }
}

/** Наблюдатели — С СЕРВЕРА, мимо кэша: для сверки прав строк в Supabase (см. fetchMembersFresh). */
export async function fetchDeskObserverUidsFresh(workspaceId: string): Promise<string[]> {
  if (!db) throw new Error("Firebase не настроен");
  const snap = await getDocsFromServer(paths.deskObservers(workspaceId));
  return snap.docs.map((d) => d.id);
}

/** Список наблюдателей — читает только Owner. */
export async function fetchDeskObservers(workspaceId: string): Promise<DeskObserver[]> {
  if (!db) throw new Error("Firebase не настроен");
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
  await setDoc(paths.deskObserver(input.workspaceId, input.uid), {
    uid: input.uid,
    label: input.label,
    grantedAt: Date.now(),
    grantedBy: input.ownerUid,
  });
  await mirrorObserver(input.workspaceId, input.uid, true);
}

export async function revokeDeskObserver(workspaceId: string, uid: string) {
  if (!db) throw new Error("Firebase не настроен");
  await deleteDoc(paths.deskObserver(workspaceId, uid));
  await mirrorObserver(workspaceId, uid, false);
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
