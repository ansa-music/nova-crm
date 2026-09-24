import { onAuthStateChanged } from "firebase/auth";
import { auth, FIRESTORE_WIPE_KEY, firestoreCacheWipedAtLoad } from "@/firebase/firebase";

/**
 * Снимок данных Supabase в localStorage — чтобы экран рисовался СРАЗУ.
 *
 * У Firestore есть кэш на диске: подписка отдаёт снимок мгновенно и
 * продолжает с resume-токена. У Supabase такого нет, и каждый экран ждал бы
 * сеть до eu-central-1. Поэтому последний ответ сервера лежит здесь и
 * отдаётся первым — с пометкой «из кэша» (`fromCache`). Правило то же, что у
 * кэша Firestore (CLAUDE.md): по снимку из кэша можно РИСОВАТЬ, но нельзя
 * РЕШАТЬ — пересчёт Owner, публикации и автозаезд ждут ответа сервера.
 *
 * Ключ — uid:workspace:коллекция: чужой снимок не отдаётся даже на общем
 * устройстве. И всё равно стираем при выходе — теми же событиями, что кэш
 * Firestore (метка `nova:firestore-wipe`, её ставит signOutUser ДО выхода):
 * данные вышедшего не должны лежать на чужом компьютере.
 *
 * localStorage может бросать (приватный режим, переполнение) — тогда снимка
 * просто нет, и экран ждёт сервер, как раньше.
 */

const PREFIX = "nova:sbsnap:";

interface Stored<T> {
  v: T;
  at: number;
}

function keyOf(uid: string, workspaceId: string, collection: string) {
  return `${PREFIX}${uid}:${workspaceId}:${collection}`;
}

/** Текущий вошедший (снимки — только его). */
export function snapshotUid(): string | null {
  try {
    return auth?.currentUser?.uid ?? null;
  } catch {
    return null;
  }
}

export function readSnapshot<T>(workspaceId: string, collection: string): { value: T; savedAt: number } | null {
  const uid = snapshotUid();
  if (!uid) return null;
  try {
    const raw = window.localStorage.getItem(keyOf(uid, workspaceId, collection));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored<T>;
    if (!parsed || typeof parsed.at !== "number" || !("v" in parsed)) return null;
    return { value: parsed.v, savedAt: parsed.at };
  } catch {
    return null;
  }
}

export function writeSnapshot<T>(workspaceId: string, collection: string, value: T) {
  const uid = snapshotUid();
  if (!uid) return;
  const key = keyOf(uid, workspaceId, collection);
  try {
    window.localStorage.setItem(key, JSON.stringify({ v: value, at: Date.now() } satisfies Stored<T>));
  } catch {
    // Переполнение: старый снимок хуже, чем никакого (он бы так и остался).
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* нет хранилища */
    }
  }
}

/** Стереть снимки: все или всех, кроме `keepUid`. */
export function clearSnapshots(keepUid?: string | null) {
  try {
    const keep = keepUid ? `${PREFIX}${keepUid}:` : null;
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(PREFIX) && !(keep && key.startsWith(keep))) doomed.push(key);
    }
    for (const key of doomed) window.localStorage.removeItem(key);
  } catch {
    /* нет хранилища — нечего стирать */
  }
}

function installWipe() {
  if (typeof window === "undefined") return;
  // Выход был в прошлой загрузке: метку снимает firebase.ts при загрузке —
  // раньше этого модуля (он импортирует `auth` оттуда), поэтому смотрим и на
  // флаг «эта загрузка стёрла кэш по метке», и на саму метку.
  try {
    if (firestoreCacheWipedAtLoad || window.localStorage.getItem(FIRESTORE_WIPE_KEY) === "1") clearSnapshots();
  } catch {
    /* нет хранилища */
  }
  // Выход (signOut) и вход другим человеком: localStorage синхронный, так что
  // это успевает и на самом выходе, до ухода страницы, — не как IndexedDB.
  // При следующей загрузке первым приходит настоящий вошедший (или никто).
  try {
    if (!auth) return;
    onAuthStateChanged(auth, (user) => clearSnapshots(user?.uid ?? null));
  } catch {
    /* без Auth снимков и так нет: ключ требует uid */
  }
}

installWipe();
