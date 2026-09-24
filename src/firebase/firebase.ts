import { type FirebaseApp, initializeApp, getApps } from "firebase/app";
import {
  type Auth,
  getAuth,
  initializeAuth,
  browserLocalPersistence,
  browserPopupRedirectResolver,
} from "firebase/auth";
import {
  clearIndexedDbPersistence,
  type Firestore,
  type FirestoreLocalCache,
  initializeFirestore,
  memoryLocalCache,
  memoryLruGarbageCollector,
  persistentLocalCache,
  persistentMultipleTabManager,
  terminate,
} from "firebase/firestore";
// firebase/storage и firebase/analytics больше не подключаются: хранилище
// Firebase сайт не использует (аватарки и файлы строк лежат в Supabase Storage,
// avatarService.ts), а analytics только тянул внешний gtag.js и вместе
// с storage давал ≈48 КБ стартового firebase-chunk. Не возвращать без нужды.

/**
 * Google OAuth authorized redirect is
 * https://nurba-6e70d.firebaseapp.com/__/auth/handler (Firebase default).
 * Do NOT derive authDomain from window.location (e.g. nurba-6e70d.web.app):
 * that sends redirect_uri=https://nurba-6e70d.web.app/__/auth/handler and
 * Google returns Error 400 redirect_uri_mismatch («Доступ заблокирован»).
 *
 * To use *.web.app as authDomain instead, add
 * https://nurba-6e70d.web.app/__/auth/handler as an Authorized redirect URI
 * in Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client.
 * That cannot be done from this repo.
 */
const configuredAuthDomain =
  import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "nurba-6e70d.firebaseapp.com";
// Never compile *.web.app as authDomain: Google only authorizes
// https://nurba-6e70d.firebaseapp.com/__/auth/handler
const authDomain = String(configuredAuthDomain).replace(/\.web\.app$/i, ".firebaseapp.com");

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyDvcnG_bcSt0ODT-hsbxRjamxSzIlnvvCc",
  authDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "nurba-6e70d",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "nurba-6e70d.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "890276594199",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:890276594199:web:e624cc48aba78720c2d252",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-JWGQFF1TBS",
};

export const isFirebaseConfigured = true;

export const app: FirebaseApp = getApps().length ? getApps()[0]! : initializeApp(firebaseConfig);

function createAuth(firebaseApp: FirebaseApp): Auth {
  try {
    return initializeAuth(firebaseApp, {
      persistence: browserLocalPersistence,
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch {
    const existing = getAuth(firebaseApp);
    void existing.setPersistence(browserLocalPersistence);
    return existing;
  }
}

export const auth: Auth = createAuth(app);

/**
 * «Режим совместимости» — принудительный long polling. Firestore держит связь
 * с базой одним длинным потоковым ответом, а расширения-«ускорители»,
 * антивирусы и корпоративные прокси иногда перехватывают такой ответ и копят
 * его до конца — который не наступает никогда. Снаружи это выглядит как
 * соединение «установлено», но ни одного документа не приходит: getDoc
 * профиля висит без ошибки, и приложение навсегда застывает на «Загружаем
 * профиль…» (так было у Nurba с SuperchargeBrowser). Long polling ходит
 * короткими запросами и такие ловушки переживает.
 *
 * По умолчанию его НЕ включаем: автоопределение дешевле и быстрее для всех,
 * у кого сеть в порядке. Включает его сам человек кнопкой на экране загрузки
 * (AppBootScreen), и выбор помнится на этом устройстве. Сбросить — удалить
 * ключ `nova:firestore-long-polling` из localStorage.
 */
export const FIRESTORE_COMPAT_KEY = "nova:firestore-long-polling";

function compatModeEnabled(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(FIRESTORE_COMPAT_KEY) === "1";
  } catch {
    return false;
  }
}

/** Включить режим совместимости на этом устройстве и перезагрузить страницу. */
export function reloadInCompatMode() {
  try {
    window.localStorage.setItem(FIRESTORE_COMPAT_KEY, "1");
  } catch {
    // Хранилище недоступно (приватный режим) — просто перезагрузим.
  }
  window.location.reload();
}

export const isFirestoreCompatMode = compatModeEnabled();

/**
 * Кэш Firestore — на ДИСКЕ (IndexedDB), общий для всех вкладок браузера.
 *
 * Было: кэш в памяти вкладки (LRU). Повторные подписки внутри одной вкладки
 * он удешевлял, но каждая ПЕРЕЗАГРУЗКА и каждая новая вкладка читали всё
 * заново: вход технаря — ~100 чтений на 28 человек, Owner на дашборде —
 * ~190 (замерено на стенде с эмулятором и счётчиком). А перезагрузок в день
 * сотни: автообновление после каждого деплоя, F5, телефон, который выгружает
 * фоновую вкладку. 22–23.09.2026 квота Spark (50 000 чтений в сутки) кончалась
 * два дня подряд — 141 000 и 89 000.
 *
 * С кэшем на диске подписка после перезагрузки продолжается с resume-токена:
 * если с прошлого раза прошло меньше ~30 минут, сервер присылает и списывает
 * только ИЗМЕНИВШИЕСЯ документы (так тарифицирует Firestore). Менеджер
 * нескольких вкладок вдобавок держит ОДНО соединение на браузер: две вкладки
 * с одним и тем же запросом не платят дважды.
 *
 * Цена та же, что и у LRU: первый снимок подписки может прийти из кэша
 * (`fromCache`), теперь и сразу после загрузки. Рисовать по нему можно,
 * РЕШАТЬ — нельзя; места, которые пишут по результату подписки, это уже
 * проверяют (см. CLAUDE.md, «Кэш Firestore — на ДИСКЕ»). Выход из аккаунта стирает кэш
 * (`clearFirestoreCache`), чтобы следующий человек не видел снимков прошлого.
 *
 * Выключатель на устройстве: `nova:firestore-memory-cache=1` в localStorage —
 * вернуться к кэшу в памяти. Нет IndexedDB (приватный режим старого Safari) —
 * SDK сам откатывается на память.
 */
export const FIRESTORE_MEMORY_CACHE_KEY = "nova:firestore-memory-cache";

function memoryCacheForced(): boolean {
  try {
    return typeof window === "undefined" || window.localStorage.getItem(FIRESTORE_MEMORY_CACHE_KEY) === "1";
  } catch {
    return false;
  }
}

function createLocalCache(): FirestoreLocalCache {
  const memory = () =>
    memoryLocalCache({ garbageCollector: memoryLruGarbageCollector({ cacheSizeBytes: 40 * 1024 * 1024 }) });
  if (memoryCacheForced() || typeof indexedDB === "undefined") return memory();
  try {
    return persistentLocalCache({ tabManager: persistentMultipleTabManager(), cacheSizeBytes: 40 * 1024 * 1024 });
  } catch {
    return memory();
  }
}

/**
 * Выход из аккаунта ставит метку, и кэш стирается при СЛЕДУЮЩЕЙ загрузке —
 * до того, как Firestore откроет базу. Стирать на выходе ненадёжно: вкладка
 * уходит на «/» раньше, чем terminate + clearIndexedDbPersistence успевают
 * (проверено на стенде — кэш оставался). `deleteDatabase` здесь выполнится
 * раньше любого открытия: запросы открытия IndexedDB ждут начатого удаления.
 */
export const FIRESTORE_WIPE_KEY = "nova:firestore-wipe";

function wipeCacheIfAsked(): boolean {
  try {
    if (typeof indexedDB === "undefined" || window.localStorage.getItem(FIRESTORE_WIPE_KEY) !== "1") return false;
    window.localStorage.removeItem(FIRESTORE_WIPE_KEY);
    indexedDB.deleteDatabase(`firestore/${app.name}/${firebaseConfig.projectId}/main`);
    return true;
  } catch {
    /* нет хранилища — и кэша на диске тоже нет */
    return false;
  }
}

/**
 * Эта загрузка стёрла кэш по метке выхода. Метку снимает `wipeCacheIfAsked`
 * при загрузке модуля — раньше всех остальных, — поэтому свои локальные
 * снимки (Supabase-кэши в localStorage/IndexedDB) проверяют этот флаг, а не
 * саму метку: к их первому чтению метки уже нет.
 */
export const firestoreCacheWipedAtLoad: boolean = wipeCacheIfAsked();
const localCache = createLocalCache();

// Две настройки long polling взаимоисключающие: вместе initializeFirestore бросает.
export const db: Firestore = initializeFirestore(
  app,
  isFirestoreCompatMode
    ? { localCache, experimentalForceLongPolling: true }
    : { localCache, experimentalAutoDetectLongPolling: true }
);

/**
 * Стереть кэш Firestore этого браузера — при выходе из аккаунта: метка для
 * следующей загрузки (см. `wipeCacheIfAsked`) и попытка стереть сразу. После
 * `terminate` база в этой вкладке больше не работает, поэтому вызывать только
 * прямо перед уходом со страницы.
 */
export function markFirestoreCacheForWipe() {
  try {
    window.localStorage.setItem(FIRESTORE_WIPE_KEY, "1");
  } catch {
    /* без localStorage остаётся попытка стереть сразу */
  }
}

export async function clearFirestoreCache() {
  markFirestoreCacheForWipe();
  try {
    await terminate(db);
    await clearIndexedDbPersistence(db);
  } catch (error) {
    console.warn("[firestore] кэш не стёрт при выходе", error);
  }
}
