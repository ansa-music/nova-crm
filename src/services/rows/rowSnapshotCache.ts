import { onAuthStateChanged } from "firebase/auth";
import { auth, FIRESTORE_WIPE_KEY, firestoreCacheWipedAtLoad } from "@/firebase/firebase";

/**
 * Снимок строк стола в IndexedDB — чтобы стол из Supabase открывался СРАЗУ.
 *
 * У Firestore был кэш на диске: повторное открытие стола рисовалось мгновенно
 * и докачивало только изменения. У Supabase своего кэша нет, и каждое
 * открытие ждало всю выборку из Франкфурта (0,3–0,8 с, на телефоне дольше).
 * Теперь `sbSubscribeRows` сначала отдаёт строки из снимка (`fromServer =
 * false` — как `fromCache` у Firestore: РИСОВАТЬ можно, РЕШАТЬ нельзя), а с
 * сервера докачивает только `rev > курсор` снимка и сверяет голову таблицы.
 *
 * Ключ — uid:workspace:стол:вкладка: на общем устройстве снимок одного
 * человека другому не отдаётся даже до стирания. Выход из аккаунта стирает
 * все снимки (как кэш Firestore): при `onAuthStateChanged(null)` — и в той
 * вкладке, где вышли, и при следующей загрузке без входа. Метку
 * `nova:firestore-wipe` сама `firebase.ts` снимает при загрузке раньше, чем
 * дойдёт до этого модуля, поэтому она тут лишь запасная.
 *
 * Всё тихо: нет IndexedDB (приватный режим), база заблокирована, квота диска
 * — снимка просто нет, и стол читается с сервера, как раньше.
 */

const DB_NAME = "nova-row-snapshots";
const STORE = "tables";
/** Столько последних столов держим — снимок большого стола сотни КБ. */
const MAX_ENTRIES = 40;
/** Снимок старше этого не рисуем: неделю назад закрытый стол лучше показать честным скелетом. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Длиннее ждать диск не станем — сервер к этому времени мог уже ответить. */
const READ_TIMEOUT_MS = 400;
/** Серия правок пишет снимок один раз, а не на каждую. */
const WRITE_DEBOUNCE_MS = 2000;
/** Стол длиннее не кладём: снимок сериализуется в главном потоке. */
const MAX_RECORDS = 5000;

export interface RowSnapshot<R> {
  records: R[];
  /** Курсор, с которого дочитывать (`rev > cursor`), — с запасом на обгон фиксаций. */
  cursor: number;
  savedAt: number;
}

interface StoredSnapshot<R> extends RowSnapshot<R> {
  uid: string;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;
const pendingWrites = new Map<string, { timer: ReturnType<typeof setTimeout>; run: () => void }>();

function currentUid(): string | null {
  try {
    return auth.currentUser?.uid ?? null;
  } catch {
    return null;
  }
}

function keyOf(uid: string, workspaceId: string, pageId: string, tabId: string): string {
  return `${uid}:${workspaceId}:${pageId}:${tabId}`;
}

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === "undefined") {
        resolve(null);
        return;
      }
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE).createIndex("savedAt", "savedAt");
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        // Другая вкладка стирает снимки (выход) — отпускаем базу, иначе удаление ждало бы нас.
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}

/** Снимок стола этого человека или null (нет, чужой, устарел, диск не ответил вовремя). */
export function readRowSnapshot<R>(workspaceId: string, pageId: string, tabId: string): Promise<RowSnapshot<R> | null> {
  const uid = currentUid();
  if (!uid) return Promise.resolve(null);
  const key = keyOf(uid, workspaceId, pageId, tabId);
  const read = openDb().then(
    (db) =>
      new Promise<RowSnapshot<R> | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        try {
          const request = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
          request.onsuccess = () => {
            const value = request.result as StoredSnapshot<R> | undefined;
            if (
              !value ||
              value.uid !== uid ||
              !Array.isArray(value.records) ||
              typeof value.cursor !== "number" ||
              Date.now() - value.savedAt > MAX_AGE_MS
            ) {
              resolve(null);
              return;
            }
            resolve({ records: value.records, cursor: value.cursor, savedAt: value.savedAt });
          };
          request.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      })
  );
  return withTimeout(read, READ_TIMEOUT_MS, null);
}

/**
 * Запомнить снимок (с паузой: серия правок — одна запись). `build` зовётся в
 * момент записи, чтобы положить самое свежее. Пустой стол не храним — и
 * стираем старый снимок, чтобы не рисовать удалённые строки.
 */
export function writeRowSnapshot<R>(
  workspaceId: string,
  pageId: string,
  tabId: string,
  build: () => RowSnapshot<R> | null
): void {
  const uid = currentUid();
  if (!uid) return;
  const key = keyOf(uid, workspaceId, pageId, tabId);
  const prev = pendingWrites.get(key);
  if (prev) clearTimeout(prev.timer);
  const run = () => {
    pendingWrites.delete(key);
    // Вышли, пока ждали паузу, — снимок уже не этого человека.
    if (currentUid() !== uid) return;
    const snapshot = build();
    void openDb().then((db) => {
      if (!db) return;
      try {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        if (!snapshot || snapshot.records.length === 0 || snapshot.records.length > MAX_RECORDS) {
          store.delete(key);
          return;
        }
        const value: StoredSnapshot<R> = { ...snapshot, uid };
        store.put(value, key);
        trim(store);
      } catch {
        /* квота диска или закрытая база — снимка просто не будет */
      }
    });
  };
  pendingWrites.set(key, { timer: setTimeout(run, WRITE_DEBOUNCE_MS), run });
}

/** Лишние (самые давние) снимки — вон, чтобы IndexedDB не росла без края. */
function trim(store: IDBObjectStore) {
  const countRequest = store.count();
  countRequest.onsuccess = () => {
    let extra = countRequest.result - MAX_ENTRIES;
    if (extra <= 0) return;
    const cursorRequest = store.index("savedAt").openKeyCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor || extra <= 0) return;
      store.delete(cursor.primaryKey);
      extra -= 1;
      cursor.continue();
    };
  };
}

/** Снимок стола больше не годится (например, права на стол сняли). */
export function dropRowSnapshot(workspaceId: string, pageId: string, tabId: string): void {
  const uid = currentUid();
  if (!uid) return;
  const key = keyOf(uid, workspaceId, pageId, tabId);
  const pending = pendingWrites.get(key);
  if (pending) {
    clearTimeout(pending.timer);
    pendingWrites.delete(key);
  }
  void openDb().then((db) => {
    if (!db) return;
    try {
      db.transaction(STORE, "readwrite").objectStore(STORE).delete(key);
    } catch {
      /* нет базы — и снимка нет */
    }
  });
}

/** Стереть ВСЕ снимки этого браузера — при выходе из аккаунта. */
export function wipeRowSnapshots(): void {
  for (const pending of pendingWrites.values()) clearTimeout(pending.timer);
  pendingWrites.clear();
  const opened = dbPromise;
  dbPromise = null;
  const remove = () => {
    try {
      if (typeof indexedDB !== "undefined") indexedDB.deleteDatabase(DB_NAME);
    } catch {
      /* нет хранилища — и снимков тоже нет */
    }
  };
  // Своё соединение закрываем ДО удаления: иначе удаление ждало бы его вечно.
  if (opened) {
    void opened.then((db) => {
      db?.close();
      remove();
    });
  } else {
    remove();
  }
}

function wipeIfMarked() {
  try {
    // Метку снимает firebase.ts при загрузке раньше этого модуля — поэтому
    // главный сигнал — флаг «эта загрузка стёрла кэш по метке».
    if (firestoreCacheWipedAtLoad || (typeof window !== "undefined" && window.localStorage.getItem(FIRESTORE_WIPE_KEY) === "1")) wipeRowSnapshots();
  } catch {
    /* без localStorage остаётся стирание по выходу */
  }
}

wipeIfMarked();
try {
  onAuthStateChanged(auth, (user) => {
    if (!user) wipeRowSnapshots();
  });
} catch {
  /* без Auth снимков не пишем вовсе (нет uid) */
}
