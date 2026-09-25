import { onSnapshot, query, runTransaction, where } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { getDocResumable, getDocsResumable, paths, withErrorReporting } from "@/firebase/firestore";
import { supabaseRows } from "@/lib/supabaseRows";
import { currentMonthSubPageId } from "@/services/monthTabService";
import { periodSettingsOf } from "@/services/periodService";
import {
  isSbMissingError,
  markSbTableMissing,
  markSbTablePresent,
  sbTablesVersion,
  type SbBackend,
} from "@/services/sb/sbCollections";
import { readSnapshot, snapshotUid, writeSnapshot } from "@/services/sb/snapshotCache";
import { listenTopic, ringTopic } from "@/services/sb/topicDoorbell";
import { joinSharedSubscription } from "@/utils/sharedSubscription";
import { withDbTimeout } from "@/utils/dbError";
import { fetchSubPageRows } from "@/services/subPageService";
import { publishOsOrders } from "@/services/osOrdersService";
import {
  collectOsOrders,
  countDeskLoad,
  deskLoadNeedsPublish,
  deskLoadSignature,
  mergeOsLastOrderAt,
  osOrdersSignature,
} from "@/utils/techLoad";
import type { DeskLoad, DeskLoadArchive, StatusOption, SubPage, WorkspacePage } from "@/types";

/**
 * Неизменившийся документ переписываем не чаще, чем раз в столько. Один стол
 * пишут сразу несколько сессий — технарь, его вторая вкладка, Owner,
 * заглянувший на стол, — и каждая раньше заново записывала те же самые цифры.
 * Совсем не переписывать тоже нельзя: `updatedAt` — это «обновлено …» на
 * «Технарях» и признак свежести для useOwnerDeskRecount, который читает ВСЕ
 * строки стола, чьи счётчики старше 2 часов. 90 минут — с запасом до этих
 * двух часов.
 */
const REWRITE_UNCHANGED_AFTER_MS = 90 * 60 * 1000;

/**
 * Overwrites the desk's month counts. Allowed for anyone who can edit the
 * desk's rows (firestore.rules → deskLoad). A transaction, because the
 * stored ОС activity outlives the month tab: ОС whose orders left the tab
 * keep their last order day until it's too old to rate by. The first
 * publish of a new month also archives the finished month
 * (deskLoadHistory) for the month-by-month chart on «Дашборд».
 * Resolves to whether the doc was actually written (see
 * REWRITE_UNCHANGED_AFTER_MS) and WHERE it went — see DeskLoadPublishResult.
 *
 * `backend = "supabase"` (useSbBackend решил, что счётчики живут там): строка
 * desk_loads + звонок читателям, а в Firestore — только поля правила оценок
 * (syncDeskLoadRatingFields), единицы раз в день. Таблицы нет — как раньше.
 */
export interface DeskLoadPublishResult {
  written: boolean;
  /**
   * Куда запись ушла НА ДЕЛЕ. Просили Supabase, а SQL не вставлен — ушла в
   * Firestore, и память «уже опубликовано» обязана лечь под ключ Firestore:
   * под ключом Supabase она закрыла бы первую настоящую запись в desk_loads,
   * когда SQL вставят (стола там не было бы до пересчёта Owner).
   */
  backend: SbBackend;
}

/** Сколько ждать транзакцию полей оценок: без связи с Firestore она не падает, а висит. */
const RATING_SYNC_TIMEOUT_MS = 15_000;

export async function publishDeskLoad(
  load: Omit<DeskLoad, "updatedAt">,
  backend: SbBackend = "firestore"
): Promise<DeskLoadPublishResult> {
  if (backend !== "supabase") return { written: await fsPublishDeskLoad(load), backend: "firestore" };

  // Сначала Supabase и БЕЗ ожидания Firestore: счётчики переносили ради
  // независимости от него, а транзакция без связи (сбой узла Google 22.09,
  // расширения-«ускорители») висит — цифры стола не уходили бы никуда.
  // «Последний заказ от ОС», который этот браузер уже видел в Firestore
  // (память синхронизации), уходит сразу: там могут быть ОС, чьи заказы
  // ушли из вкладки ещё ДО переезда. Карты база сливает сама.
  const memory = readRatingMemory(load.workspaceId, load.pageId);
  const now = Date.now();
  const sent = memory ? mergeOsLastOrderAt(memory.o, load.osLastOrderAt ?? {}, now) : load.osLastOrderAt ?? {};
  let written: boolean;
  try {
    written = await sbPublishDeskLoad({ ...load, osLastOrderAt: sent });
  } catch (error) {
    // SQL коллекции ещё не вставлен — молча по-старому, в Firestore. Поля
    // оценок до этого места НЕ трогали: их транзакция переписала бы месяц
    // документа без архива, и fsPublishDeskLoad уже не увидел бы смены месяца.
    if (!isSbMissingError(error)) throw error;
    markSbTableMissing("deskLoads");
    return { written: await fsPublishDeskLoad(load), backend: "firestore" };
  }

  // Правило оценок ОС (hasRecentOrderFrom) читает deskLoad в Firestore —
  // держим там ответственного и «последний заказ от ОС». Сбой или таймаут
  // (например, кончилась квота) счётчики не останавливает: повторим при
  // следующей публикации.
  try {
    const synced = await withDbTimeout(syncDeskLoadRatingFields(load), "Поля оценок стола", RATING_SYNC_TIMEOUT_MS);
    // В Firestore нашлись ОС, которых в отправленной карте не было (новый
    // браузер без памяти) — дописать их и в Supabase: экран «Технари» читает
    // Supabase и иначе не дал бы им оценку, которую правила пропустили бы.
    // Одна лишняя запись на стол, дальше их несёт память.
    const merged = mergeOsLastOrderAt(synced.osLastOrderAt, sent, now);
    if (Object.entries(merged).some(([os, at]) => (sent[os] ?? 0) < at)) {
      written = (await sbPublishDeskLoad({ ...load, osLastOrderAt: merged })) || written;
    }
  } catch (error) {
    console.warn(`Не удалось обновить поля оценок стола ${load.pageId} в Firestore:`, error);
  }
  return { written, backend: "supabase" };
}

async function fsPublishDeskLoad(load: Omit<DeskLoad, "updatedAt">): Promise<boolean> {
  if (!db) return false;
  const ref = paths.deskLoad(load.workspaceId, load.pageId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const previous = snap.exists() ? (snap.data() as Partial<DeskLoad>) : null;
    const now = Date.now();
    // Та же вкладка того же месяца у того же технаря, цифры те же, записаны
    // недавно — чтение транзакции уже потрачено, а запись не нужна.
    // `responsibleUserId` сверяем отдельно: его нет в счётчиках, а правила
    // оценок (techRatings) верят именно ему.
    if (
      previous &&
      previous.monthKey === load.monthKey &&
      previous.subPageId === load.subPageId &&
      previous.responsibleUserId === load.responsibleUserId &&
      typeof previous.updatedAt === "number" &&
      now - previous.updatedAt < REWRITE_UNCHANGED_AFTER_MS &&
      !deskLoadNeedsPublish(previous as DeskLoad, load)
    ) {
      return false;
    }
    if (previous?.monthKey && previous.monthKey !== load.monthKey) {
      tx.set(paths.deskLoadHistoryDoc(load.workspaceId, `${load.pageId}_${previous.monthKey}`), {
        ...previous,
        pageId: load.pageId,
        workspaceId: load.workspaceId,
        archivedAt: now,
      });
    }
    tx.set(ref, {
      ...load,
      osCounts: load.osCounts ?? {},
      osStatusCounts: load.osStatusCounts ?? {},
      osLastOrderAt: mergeOsLastOrderAt(previous?.osLastOrderAt, load.osLastOrderAt ?? {}, now),
      updatedAt: now,
    });
    return true;
  });
}

// ---------------------------------------------------------------------
// Счётчики в Supabase (supabase/migrations/20260928_desk_loads.sql).
// ---------------------------------------------------------------------

const DESK_LOADS_TABLE = "desk_loads";
const DESK_LOAD_HISTORY_TABLE = "desk_load_history";
const DESK_LOAD_COLUMNS = "workspace_id,page_id,responsible_uid,month_key,sub_page_id,data,updated_by,rev,server_at";

/** Тема звонка счётчиков workspace — без данных, см. topicDoorbell. */
export function deskLoadsTopic(workspaceId: string) {
  return `nova:${workspaceId}:deskloads`;
}

interface DeskLoadRow {
  workspace_id: string;
  page_id: string;
  responsible_uid: string;
  month_key: string;
  sub_page_id: string;
  data: Partial<DeskLoad> | null;
  updated_by: string | null;
  rev: number | string;
  server_at: string;
}

type DeskLoadHistoryRow = Omit<DeskLoadRow, "sub_page_id" | "responsible_uid"> & {
  sub_page_id: string | null;
  responsible_uid: string | null;
  archived_at: string;
  /** server_at строки месяца на момент архивации — «цифры верны на …». */
  counts_at: string | null;
};

function sbError(error: { code?: string; message?: string }): Error {
  return Object.assign(new Error(error.message || "Supabase: запрос не прошёл"), { code: error.code ?? "" });
}

function millis(value: string | null | undefined): number {
  const ms = value ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Строка таблицы → тот же DeskLoad, что читают экраны из Firestore.
 * `updatedAt` — СЕРВЕРНОЕ время записи (часы клиентов тут не годятся): по нему
 * «обновлено …» на «Технарях» и свежесть для пересчёта Owner.
 */
function rowToDeskLoad(row: Omit<DeskLoadRow, "rev">): DeskLoad {
  const data = (row.data ?? {}) as Partial<DeskLoad>;
  return {
    ...data,
    total: Number(data.total ?? 0),
    statusCounts: data.statusCounts ?? {},
    pageId: row.page_id,
    workspaceId: row.workspace_id,
    responsibleUserId: row.responsible_uid,
    monthKey: row.month_key,
    subPageId: row.sub_page_id,
    updatedAt: millis(row.server_at),
    updatedBy: row.updated_by ?? "",
  };
}

/**
 * upsert одной строки стола. Слияние osLastOrderAt, архив прошлого месяца и
 * «те же цифры — не переписывать» делает сама база (триггер desk_loads_guard):
 * прочитал-склеил-записал в браузере терял бы чужого ОС при двух сессиях
 * одного стола. Пропущенная базой запись возвращает 0 строк — тогда и звонить
 * некому. Возвращает, записано ли.
 */
async function sbPublishDeskLoad(load: Omit<DeskLoad, "updatedAt">): Promise<boolean> {
  const { pageId, workspaceId, responsibleUserId, monthKey, subPageId, updatedBy, ...counts } = load;
  const { data, error } = await supabaseRows
    .from(DESK_LOADS_TABLE)
    .upsert(
      {
        workspace_id: workspaceId,
        page_id: pageId,
        responsible_uid: responsibleUserId,
        month_key: monthKey,
        sub_page_id: subPageId,
        data: {
          ...counts,
          osCounts: counts.osCounts ?? {},
          osStatusCounts: counts.osStatusCounts ?? {},
          osLastOrderAt: counts.osLastOrderAt ?? {},
        },
        updated_by: updatedBy,
      },
      { onConflict: "workspace_id,page_id" }
    )
    .select("rev");
  if (error) throw sbError(error);
  markSbTablePresent("deskLoads");
  const written = Array.isArray(data) && data.length > 0;
  if (written) ringTopic(deskLoadsTopic(workspaceId));
  return written;
}

/*
 * Минимальный deskLoad в Firestore при счётчиках в Supabase. Правило оценок
 * (hasRecentOrderFrom в firestore.rules) пускает ОС ставить оценку, только
 * если в deskLoad/{pageId} ответственный — этот технарь и там есть свежий
 * заказ от его ника (osLastOrderAt). Эти поля меняются редко — день заказа у
 * ОС дневной (utils/techLoad.ts), ответственный почти никогда, — поэтому
 * Firestore пишется единицы раз в день, а не на каждую правку счётчиков.
 * Документ пишется целиком (текущими цифрами): вкладки на старом коде читают
 * его до перезагрузки, и документ без счётчиков сломал бы им экран.
 *
 * Память «в Firestore уже так» — в localStorage (6 часов): без неё каждая
 * публикация стоила бы чтения транзакции. Память устарела или другой браузер
 * успел переписать — транзакция сверяет с сервером и пишет только при
 * расхождении.
 */
const RATING_FIELDS_MEMORY_MS = 6 * 60 * 60_000;

interface RatingFieldsMemory {
  r: string;
  o: Record<string, number>;
  at: number;
}

function ratingFieldsKey(workspaceId: string, pageId: string) {
  return `nova:deskload-fs:${workspaceId}:${pageId}`;
}

/** Поля оценок в `stored` уже покрывают `load`: тот же ответственный и дни заказов не старее. */
export function ratingFieldsCovered(
  stored: { responsibleUserId?: string; osLastOrderAt?: Record<string, number> } | null | undefined,
  load: Pick<DeskLoad, "responsibleUserId" | "osLastOrderAt">
): boolean {
  if (!stored || stored.responsibleUserId !== load.responsibleUserId) return false;
  return Object.entries(load.osLastOrderAt ?? {}).every(([os, at]) => (stored.osLastOrderAt?.[os] ?? 0) >= at);
}

function readRatingMemory(workspaceId: string, pageId: string): RatingFieldsMemory | null {
  try {
    const raw = window.localStorage.getItem(ratingFieldsKey(workspaceId, pageId));
    const parsed = raw ? (JSON.parse(raw) as RatingFieldsMemory) : null;
    if (!parsed || typeof parsed.at !== "number" || Date.now() - parsed.at > RATING_FIELDS_MEMORY_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function rememberRatingFields(workspaceId: string, pageId: string, responsibleUserId: string, osLastOrderAt: Record<string, number>) {
  try {
    const memory: RatingFieldsMemory = { r: responsibleUserId, o: osLastOrderAt, at: Date.now() };
    window.localStorage.setItem(ratingFieldsKey(workspaceId, pageId), JSON.stringify(memory));
  } catch {
    /* без памяти следующий раз спросит транзакция */
  }
}

/**
 * Resolves to whether the Firestore doc was written, and its «последний заказ
 * от ОС» as it now stands (по памяти или по серверу).
 */
export async function syncDeskLoadRatingFields(
  load: Omit<DeskLoad, "updatedAt">
): Promise<{ written: boolean; osLastOrderAt: Record<string, number> }> {
  if (!db) return { written: false, osLastOrderAt: {} };
  const memory = readRatingMemory(load.workspaceId, load.pageId);
  if (memory && ratingFieldsCovered({ responsibleUserId: memory.r, osLastOrderAt: memory.o }, load)) {
    return { written: false, osLastOrderAt: memory.o };
  }
  const ref = paths.deskLoad(load.workspaceId, load.pageId);
  const result = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const previous = snap.exists() ? (snap.data() as Partial<DeskLoad>) : null;
    const now = Date.now();
    if (previous && ratingFieldsCovered(previous, load)) {
      return { written: false, osLastOrderAt: previous.osLastOrderAt ?? {} };
    }
    const osLastOrderAt = mergeOsLastOrderAt(previous?.osLastOrderAt, load.osLastOrderAt ?? {}, now);
    // Документ прошлого месяца переписывается новым — архивируем его, как
    // fsPublishDeskLoad (одна запись на стол в месяц). Основной архив теперь
    // в Supabase (desk_load_history), но без этого после отката на Firestore
    // (или если строки вернут в Firestore целиком) месяц пропал бы из
    // «Премий» и графика. Цифры тут бывают старыми — последней синхронизации;
    // склейка архивов (mergeHistory) выбирает по `updatedAt`, а его эта
    // запись не освежает (ниже), так что архив Supabase её перекрывает.
    if (previous?.monthKey && previous.monthKey !== load.monthKey) {
      tx.set(paths.deskLoadHistoryDoc(load.workspaceId, `${load.pageId}_${previous.monthKey}`), {
        ...previous,
        pageId: load.pageId,
        workspaceId: load.workspaceId,
        archivedAt: now,
      });
    }
    tx.set(ref, {
      ...load,
      osCounts: load.osCounts ?? {},
      osStatusCounts: load.osStatusCounts ?? {},
      osLastOrderAt,
      // `updatedAt` — «счётчики верны на …»: по нему «обновлено …» и свежесть
      // для пересчёта Owner. Здесь пишутся поля оценок, а не свежие счётчики,
      // поэтому время прежнее: после отката на Firestore пересчёт должен
      // увидеть, что цифры тут старые, а не счесть стол свежим на 2 часа.
      updatedAt: typeof previous?.updatedAt === "number" ? previous.updatedAt : 0,
      ratingSyncedAt: now,
    });
    return { written: true, osLastOrderAt };
  });
  rememberRatingFields(load.workspaceId, load.pageId, load.responsibleUserId, result.osLastOrderAt);
  return result;
}

/*
 * Что ЭТОТ браузер уже опубликовал — подписи счётчиков стола (deskLoad) и
 * списков заказов ОС (osOrders), в localStorage. Раньше подпись жила только в
 * памяти хука до перезагрузки, и каждое открытие стола, вторая вкладка и
 * Owner, заглянувший на стол, заново писали те же самые цифры: транзакция
 * deskLoad (чтение + запись) и по записи на каждого ОС стола (аудит квоты
 * 22.09.2026). Храним короткий хеш, а не саму подпись: список заказов ОС —
 * десятки килобайт, а у Owner таких столов и ОС десятки, и ~5 МБ localStorage
 * кончились бы. localStorage может бросать (приватный режим, переполнение) —
 * тогда просто пишем, как раньше.
 */

/**
 * Память у каждого хранилища своя: цифры, записанные в Supabase, в Firestore
 * не попали — после отката (или до включения) память Supabase не должна
 * закрывать запись в Firestore, и наоборот.
 */
export function deskLoadSignatureKey(pageId: string, subPageId: string, backend: SbBackend = "firestore") {
  return backend === "supabase" ? `nova:deskload-sig:sb:${pageId}:${subPageId}` : `nova:deskload-sig:${pageId}:${subPageId}`;
}

export function osOrdersSignatureKey(pageId: string, osValue: string) {
  return `nova:osorders-sig:${pageId}:${osValue}`;
}

/** cyrb53 — 53-битный некриптографический хеш, плюс длина: случайное совпадение практически исключено. */
function signatureHash(signature: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < signature.length; i++) {
    const ch = signature.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${signature.length.toString(36)}.${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
}

/**
 * Сколько доверять памяти «этот браузер уже записал»: дольше — пусть решает
 * транзакция (она сверяет с сервером: 1 чтение, запись только при
 * расхождении). Другой человек мог с тех пор переписать документ, и память
 * навсегда закрыла бы исправление; заодно раз в 90 минут обновляется
 * updatedAt — по нему пересчёт Owner видит, что стол жив.
 */
const MEMORY_TRUST_MS = 90 * 60_000;

/** Эту подпись этот браузер уже опубликовал недавно — сервер её принял (в этой вкладке или в другой). */
export function isPublishedSignature(key: string, signature: string): boolean {
  try {
    const stored = window.localStorage.getItem(key) ?? "";
    const [hash, at] = stored.split("@");
    if (hash !== signatureHash(signature)) return false;
    // Старый формат (без времени) — не доверяем: пусть решит транзакция.
    return Boolean(at) && Date.now() - Number(at) < MEMORY_TRUST_MS;
  } catch {
    return false;
  }
}

export function rememberPublishedSignature(key: string, signature: string) {
  try {
    window.localStorage.setItem(key, `${signatureHash(signature)}@${Date.now()}`);
  } catch {
    /* без localStorage в следующий раз просто запишем ещё раз */
  }
}

/**
 * Запись не прошла — забыть, чтобы следующий раз её повторил. Только если
 * там именно эта подпись: другая вкладка могла уже записать новее.
 */
export function forgetPublishedSignature(key: string, signature: string) {
  try {
    const stored = window.localStorage.getItem(key) ?? "";
    if (stored.split("@")[0] === signatureHash(signature)) window.localStorage.removeItem(key);
  } catch {
    /* нечего забывать */
  }
}

/**
 * Recounts one desk straight from its month tab (one-shot reads) and
 * publishes only if the numbers differ from `current`. The Owner's
 * «Технари» screen uses this to catch desks nobody has opened since their
 * counts last changed. Resolves to whether the desk's counts were written.
 */
export async function refreshDeskLoadFromRows(
  page: WorkspacePage,
  monthKey: string,
  uid: string,
  current: DeskLoad | undefined,
  responsibleOptions: StatusOption[],
  backend: SbBackend = "firestore"
): Promise<boolean> {
  const subPageId = currentMonthSubPageId(page, monthKey);
  const responsibleUserId = page.responsibleUserId;
  if (!db || !subPageId || !responsibleUserId) return false;
  const [subSnap, rows] = await Promise.all([
    getDocResumable(paths.subPage(page.workspaceId, page.id, subPageId)),
    fetchSubPageRows(page.workspaceId, page.id, subPageId),
  ]);
  if (!subSnap.exists()) return false;
  const columns = (subSnap.data() as SubPage).columns ?? [];
  const counts = countDeskLoad(columns, rows, responsibleOptions, monthKey, periodSettingsOf(page.workspaceId));
  const next = { ...counts, subPageId, monthKey };
  // Подмешанный из Firestore счётчик (sbFallback) — не строка Supabase:
  // совпади цифры, запись в desk_loads была бы пропущена, и стола там так и
  // не было бы.
  const known = backend === "supabase" && current?.sbFallback ? undefined : current;
  if (!deskLoadNeedsPublish(known, next)) return false;
  const base = { pageId: page.id, workspaceId: page.workspaceId, responsibleUserId, updatedBy: uid };
  const result = await publishDeskLoad({ ...base, ...next }, backend);
  const published = result.written;
  // Owner, открыв потом этот стол, не перепишет те же цифры ещё раз. Память —
  // того хранилища, куда запись ушла на деле (см. DeskLoadPublishResult).
  rememberPublishedSignature(deskLoadSignatureKey(page.id, subPageId, result.backend), deskLoadSignature({ ...next, responsibleUserId }));
  // The ОС order lists go with the counts — same trigger, same desk.
  const osOrders = collectOsOrders(columns, rows, responsibleOptions);
  await Promise.all(
    Object.entries(osOrders).map(async ([osValue, orders]) => {
      const key = osOrdersSignatureKey(page.id, osValue);
      const signature = osOrdersSignature(orders, subPageId, monthKey, responsibleUserId);
      // Здесь память «уже записано» НЕ спрашиваем: пересчёт — путь догнать
      // стол, который мог переписать кто-то другой, и собственная память
      // Owner оставила бы в базе чужой устаревший список. Сюда и так
      // доходят только столы, у которых цифры реально разошлись.
      try {
        await publishOsOrders({ ...base, osValue, monthKey, subPageId, orders });
        rememberPublishedSignature(key, signature);
      } catch (error) {
        console.warn(`Не удалось обновить заказы ОС «${osValue}» на столе ${page.id}:`, error);
      }
    })
  );
  return published;
}

// ---------------------------------------------------------------------
// Переархив прошлого периода после переноса незавершённых (26.09.2026).
// ---------------------------------------------------------------------

export interface DeskLoadRearchiveInput {
  workspaceId: string;
  pageId: string;
  /** Ключ ПРОШЛОГО периода, чьи цифры пересчитаны по оставшимся строкам. */
  monthKey: string;
  subPageId: string;
  counts: ReturnType<typeof countDeskLoad>;
  responsibleUserId: string;
  uid: string;
}

/**
 * После переноса строк в новый период старый период считал бы их «в работе»
 * и дальше — его архив (и живая строка, если стол ещё не опубликовал новый
 * период) переписывается цифрами по ОСТАВШИМСЯ строкам. Supabase —
 * `desk_load_rearchive` (20261007; клиент в desk_load_history напрямую не
 * пишет); нет функции — как в Firestore: транзакция правит deskLoad, пока он
 * за тот же период, и пишет deskLoadHistory/{page}_{period}. Отдаёт, куда
 * записалось; null — некуда (нет Firebase).
 */
export async function rearchiveDeskLoad(input: DeskLoadRearchiveInput, backend: SbBackend): Promise<SbBackend | null> {
  const load: Omit<DeskLoad, "updatedAt"> = {
    ...input.counts,
    pageId: input.pageId,
    workspaceId: input.workspaceId,
    responsibleUserId: input.responsibleUserId,
    monthKey: input.monthKey,
    subPageId: input.subPageId,
    updatedBy: input.uid,
    osCounts: input.counts.osCounts ?? {},
    osStatusCounts: input.counts.osStatusCounts ?? {},
    osLastOrderAt: input.counts.osLastOrderAt ?? {},
  };
  if (backend === "supabase") {
    try {
      await sbRearchiveDeskLoad(load);
      return "supabase";
    } catch (error) {
      if (!isSbMissingError(error)) throw error;
      // SQL 20261007 ещё не вставлен — архив Firestore, как до переезда.
    }
  }
  return (await fsRearchiveDeskLoad(load)) ? "firestore" : null;
}

async function sbRearchiveDeskLoad(load: Omit<DeskLoad, "updatedAt">): Promise<void> {
  const { pageId, workspaceId, responsibleUserId: _resp, monthKey, subPageId, updatedBy: _by, ...data } = load;
  void _resp;
  void _by;
  const { error } = await supabaseRows.rpc("desk_load_rearchive", {
    p_workspace: workspaceId,
    p_page: pageId,
    p_month_key: monthKey,
    p_sub_page_id: subPageId,
    p_data: data,
  });
  if (error) throw sbError(error);
  ringTopic(deskLoadsTopic(workspaceId));
}

async function fsRearchiveDeskLoad(load: Omit<DeskLoad, "updatedAt">): Promise<boolean> {
  if (!db) return false;
  const ref = paths.deskLoad(load.workspaceId, load.pageId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const previous = snap.exists() ? (snap.data() as Partial<DeskLoad>) : null;
    const now = Date.now();
    if (previous?.monthKey && previous.monthKey < load.monthKey) {
      throw new Error("Период новее живых счётчиков стола — переархив невозможен");
    }
    // Стол ещё не опубликовал новый период: правится и живая строка, её
    // потом заархивирует первая публикация нового периода (fsPublishDeskLoad).
    if (!previous || previous.monthKey === load.monthKey) {
      tx.set(ref, {
        ...load,
        osLastOrderAt: mergeOsLastOrderAt(previous?.osLastOrderAt, load.osLastOrderAt ?? {}, now),
        updatedAt: now,
      });
    }
    tx.set(paths.deskLoadHistoryDoc(load.workspaceId, `${load.pageId}_${load.monthKey}`), { ...load, updatedAt: now, archivedAt: now });
    return true;
  });
}

// ---------------------------------------------------------------------
// Архив месяцев («Дашборд» → по месяцам, «Премии за прошлый месяц»).
// ---------------------------------------------------------------------

/**
 * Архив меняется раз в месяц (первая публикация нового месяца), поэтому
 * живая подписка ему не нужна: разовое чтение при открытии экрана.
 * Firestore — `getDocsResumable` (с кэшем на диске платит только за
 * изменения, если перерыв < ~30 мин). Supabase — снимок в localStorage на
 * час (квоты там нет, но и гонять архив на каждое открытие незачем) плюс
 * СТАРЫЙ архив из Firestore: месяцы до переезда лежат только там, а в режиме
 * Supabase туда больше никто не пишет — его снимок живёт неделю.
 * Одинаковый стол и месяц в обоих — см. mergeHistory.
 *
 * Firestore при строках в Supabase (Owner выключил счётчики в Supabase —
 * откат): месяцы, заархивированные за время работы в Supabase, лежат только
 * в desk_load_history — их дочитываем и склеиваем (`withSupabase`), иначе
 * «Премии за прошлый месяц» и график теряли бы их.
 */
const SB_HISTORY_TTL_MS = 60 * 60_000;
const FS_LEGACY_HISTORY_TTL_MS = 7 * 24 * 60 * 60_000;

async function fsFetchDeskLoadHistory(workspaceId: string, fromMonthKey: string): Promise<DeskLoadArchive[]> {
  if (!db) return [];
  const snapshot = await getDocsResumable(query(paths.deskLoadHistory(workspaceId), where("monthKey", ">=", fromMonthKey)));
  return snapshot.docs.map((d) => d.data() as DeskLoadArchive);
}

async function sbFetchDeskLoadHistory(workspaceId: string, fromMonthKey: string): Promise<DeskLoadArchive[]> {
  const out: DeskLoadArchive[] = [];
  // Страницами: PostgREST отдаёт не больше max_rows (урок гибрида).
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseRows
      .from(DESK_LOAD_HISTORY_TABLE)
      .select("workspace_id,page_id,responsible_uid,month_key,sub_page_id,data,updated_by,rev,server_at,archived_at,counts_at")
      .eq("workspace_id", workspaceId)
      .gte("month_key", fromMonthKey)
      .order("month_key", { ascending: true })
      .order("page_id", { ascending: true })
      .range(from, from + 999);
    if (error) throw sbError(error);
    const rows = (data ?? []) as DeskLoadHistoryRow[];
    for (const row of rows) {
      out.push({
        // updatedAt — на когда верны ЦИФРЫ (counts_at), а не время архивации:
        // по нему mergeHistory выбирает между архивами Supabase и Firestore.
        ...rowToDeskLoad({
          ...row,
          responsible_uid: row.responsible_uid ?? "",
          sub_page_id: row.sub_page_id ?? "",
          server_at: row.counts_at ?? row.server_at,
        }),
        archivedAt: millis(row.archived_at),
      });
    }
    if (rows.length < 1000) return out;
  }
}

/**
 * Один стол и месяц в обоих архивах — побеждает тот, чьи цифры СВЕЖЕЕ
 * (`updatedAt` — «счётчики верны на …»), при равенстве — позже
 * заархивированный, дальше — Supabase. Не «всегда Supabase» и не «позже
 * заархивированный»: после отката на Firestore и возврата обратно Supabase
 * архивирует свою замёрзшую строку позже, чем Firestore — настоящие итоги, а
 * архив Firestore из syncDeskLoadRatingFields несёт цифры последней
 * синхронизации полей оценок и перекрыть Supabase не должен.
 */
function mergeHistory(legacy: DeskLoadArchive[], fresh: DeskLoadArchive[]): DeskLoadArchive[] {
  const byKey = new Map<string, DeskLoadArchive>();
  for (const doc of legacy) byKey.set(`${doc.pageId}_${doc.monthKey}`, doc);
  for (const doc of fresh) {
    const key = `${doc.pageId}_${doc.monthKey}`;
    const other = byKey.get(key);
    const mine = doc.updatedAt ?? 0;
    const theirs = other?.updatedAt ?? 0;
    if (!other || mine > theirs || (mine === theirs && (doc.archivedAt ?? 0) >= (other.archivedAt ?? 0))) byKey.set(key, doc);
  }
  return [...byKey.values()];
}

/** Finished months from `fromMonthKey` on — a few docs per desk per month. */
export function subscribeDeskLoadHistory(
  workspaceId: string,
  fromMonthKey: string,
  onData: (docs: DeskLoadArchive[]) => void,
  onError?: (error: unknown) => void,
  backend: SbBackend = "firestore",
  opts: { withSupabase?: boolean } = {}
) {
  if (!db) {
    onData([]);
    return () => {};
  }
  let cancelled = false;
  const stop = () => {
    cancelled = true;
  };
  const deliver = (docs: DeskLoadArchive[]) => {
    if (!cancelled) onData(docs);
  };
  const fail = (error: unknown) => {
    if (!cancelled) onError?.(error);
  };
  if (backend === "firestore") {
    if (!opts.withSupabase) {
      fsFetchDeskLoadHistory(workspaceId, fromMonthKey).then(deliver, fail);
      return stop;
    }
    // Откат на Firestore при строках в Supabase: архив, набранный в Supabase,
    // дочитываем молча — нет таблицы, нет прав, нет сети — просто без него.
    // Состояние «таблицы нет» тут не трогаем: коллекция и так в Firestore.
    void Promise.all([
      fsFetchDeskLoadHistory(workspaceId, fromMonthKey),
      sbFetchDeskLoadHistory(workspaceId, fromMonthKey).catch(() => [] as DeskLoadArchive[]),
    ]).then(([legacy, fresh]) => deliver(mergeHistory(legacy, fresh)), fail);
    return stop;
  }

  const sbKey = `deskLoadHistory:sb:${fromMonthKey}`;
  const fsKey = `deskLoadHistory:fs:${fromMonthKey}`;
  const sbCached = readSnapshot<DeskLoadArchive[]>(workspaceId, sbKey);
  const fsCached = readSnapshot<DeskLoadArchive[]>(workspaceId, fsKey);
  // Архив только рисуется (графики, премии) — снимок годится сразу.
  if (sbCached || fsCached) onData(mergeHistory(fsCached?.value ?? [], sbCached?.value ?? []));
  const now = Date.now();
  const sbFresh = sbCached && now - sbCached.savedAt < SB_HISTORY_TTL_MS ? sbCached.value : null;
  const fsFresh = fsCached && now - fsCached.savedAt < FS_LEGACY_HISTORY_TTL_MS ? fsCached.value : null;
  if (sbFresh && fsFresh) return stop;
  void (async () => {
    let fresh: DeskLoadArchive[];
    try {
      fresh = sbFresh ?? (await sbFetchDeskLoadHistory(workspaceId, fromMonthKey));
      if (!sbFresh) writeSnapshot(workspaceId, sbKey, fresh);
    } catch (error) {
      if (!isSbMissingError(error)) {
        if (!sbCached && !fsCached) fail(error);
        return;
      }
      // SQL не накатан — архив целиком из Firestore, как раньше.
      markSbTableMissing("deskLoads");
      fsFetchDeskLoadHistory(workspaceId, fromMonthKey).then(deliver, fail);
      return;
    }
    let legacy = fsFresh ?? fsCached?.value ?? [];
    if (!fsFresh) {
      try {
        legacy = await fsFetchDeskLoadHistory(workspaceId, fromMonthKey);
        writeSnapshot(workspaceId, fsKey, legacy);
      } catch (error) {
        console.warn("Не удалось прочитать старый архив счётчиков из Firestore:", error);
      }
    }
    deliver(mergeHistory(legacy, fresh));
  })();
  return stop;
}

// ---------------------------------------------------------------------
// Живые счётчики всех столов.
// ---------------------------------------------------------------------

/**
 * Firestore: live, but only while a screen that needs it is open — one
 * listener on a small collection. `fromCache` — снимок из кэша SDK (на диске:
 * после перезагрузки приходит первым и может быть старым). По такому снимку
 * можно рисовать, но нельзя РЕШАТЬ — пересчёт Owner решал бы «устарело» по
 * кэшу и перечитывал все столы. `includeMetadataChanges` нужен, чтобы переход
 * кэш → сервер без изменений в документах тоже дошёл до подписчика.
 */
function fsSubscribeDeskLoads(
  workspaceId: string,
  onData: (loads: DeskLoad[], fromCache: boolean) => void,
  onError?: (error: unknown) => void
) {
  if (!db) {
    onData([], false);
    return () => {};
  }
  return onSnapshot(
    paths.deskLoads(workspaceId),
    { includeMetadataChanges: true },
    (snapshot) =>
      onData(
        snapshot.docs.map((d) => ({ ...(d.data() as DeskLoad), pageId: d.id })),
        snapshot.metadata.fromCache
      ),
    withErrorReporting(onError)
  );
}

type DeskLoadsFeed =
  | { kind: "data"; loads: DeskLoad[]; fromCache: boolean }
  | { kind: "error"; error: unknown }
  | { kind: "missing" }
  /** Таблица есть, но меня нет в копии прав (rows_members) — читать Firestore, «таблицы нет» не помечать. */
  | { kind: "notMember" };

/**
 * Запас курсора. Номер правки (rev) база выдаёт внутри транзакции, а видна
 * правка после фиксации: транзакция с rev 10 может зафиксироваться ПОСЛЕ
 * правки с rev 11, и курсор «11» потерял бы её навсегда. Поэтому курсор —
 * наибольший rev среди строк, записанных (по СЕРВЕРНОМУ времени) хотя бы на
 * 15 с раньше самой свежей увиденной: всё, что получило номер раньше них, к
 * моменту той выборки уже зафиксировано (записи PostgREST — короткие
 * одиночные транзакции). Часы клиента здесь не участвуют вовсе. Цена —
 * последние секунды активности приходят в дельте повторно (пара строк),
 * дубли снимаются по rev.
 */
const CURSOR_SAFETY_MS = 15_000;
/** Склейка звонков: серия публикаций разных столов — одна дельта. */
const RING_SETTLE_MS = 2_000;
/** Без звонка (канал не поднялся, писатель в обход клиента) — опрос на видимой вкладке. */
const POLL_MS = 60_000;
const RETRY_MS = [3_000, 10_000, 30_000];
/** Общая подписка живёт ещё минуту после ухода последнего экрана (переходы Дашборд ↔ Технари). */
const SHARED_LINGER_MS = 60_000;

/*
 * Столы, которых в desk_loads ещё нет. «Авто» включает Supabase в ту минуту,
 * когда Nurba вставил SQL, а таблица в эту минуту пустая: строки появляются
 * у столов, которые открыли технари, или после пересчёта Owner (а он идёт,
 * только пока у Owner открыт дашборд или «Технари»). До тех пор тихие столы
 * выглядели бы «0 заказов · свободен» — «Рандом» отдавал бы заказы занятым.
 * Пустота в Supabase — не «данные с сервера» (урок гибрида), поэтому для
 * таких столов подмешиваем документ Firestore (`sbFallback`) — разовым
 * getDocsResumable (≈20 документов; с кэшем на диске платит за изменения).
 * Сверка — первый раз в браузере, дальше не чаще раза в час и только пока у
 * текущего месяца есть пробелы; подмешанное лежит снимком (стирается при
 * выходе, как остальные) и само уходит, как только стол появился в Supabase.
 */
const FS_FILL_SNAPSHOT = "deskLoads:fsfill";
const FS_FILL_EVERY_MS = 60 * 60_000;
/** Первая выдача с сервера ждёт подмешивание не дольше — Firestore может висеть. */
const FS_FILL_WAIT_MS = 10_000;

function startSbDeskLoads(workspaceId: string, emit: (feed: DeskLoadsFeed) => void): () => void {
  let stopped = false;
  let serverSynced = false;
  const byPage = new Map<string, { row: DeskLoadRow; rev: number; at: number }>();
  let inFlight = false;
  let again = false;
  let dirtyWhileHidden = false;
  let failures = 0;
  let ringTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const cached = readSnapshot<DeskLoad[]>(workspaceId, "deskLoads");
  if (cached) {
    // Снимок — сразу, но после возврата из subscribe: подписчик ещё не готов.
    queueMicrotask(() => {
      if (!stopped && !serverSynced) emit({ kind: "data", loads: cached.value, fromCache: true });
    });
  }

  const fillCached = readSnapshot<DeskLoad[]>(workspaceId, FS_FILL_SNAPSHOT);
  let fsFill: DeskLoad[] = fillCached?.value ?? [];
  let fsFillAt = fillCached?.savedAt ?? 0;
  let fsFillRunning: Promise<void> | null = null;

  /** Пора ли сверить с Firestore: ни разу в этом браузере или час прошёл, а пробелы этого месяца остались. */
  function fillDue(): boolean {
    if (!db || fsFillRunning) return false;
    if (fsFillAt === 0) return true;
    if (Date.now() - fsFillAt < FS_FILL_EVERY_MS) return false;
    let newest = "";
    for (const entry of byPage.values()) if (entry.row.month_key > newest) newest = entry.row.month_key;
    for (const doc of fsFill) if ((doc.monthKey ?? "") > newest) newest = doc.monthKey;
    // Пробелы прошлых месяцев (неактуальные столы) сверку не будят: их в
    // Supabase может не оказаться никогда, а чтение каждый час — это квота.
    return fsFill.some((doc) => doc.monthKey === newest && !byPage.has(doc.pageId));
  }

  function runFill(): Promise<void> {
    if (fsFillRunning) return fsFillRunning;
    fsFillRunning = (async () => {
      try {
        const snapshot = await getDocsResumable(paths.deskLoads(workspaceId));
        fsFill = snapshot.docs.map((d) => ({ ...(d.data() as DeskLoad), pageId: d.id }));
        fsFillAt = Date.now();
        writeSnapshot(workspaceId, FS_FILL_SNAPSHOT, fsFill);
      } catch (error) {
        // Не вышло — подмешиваем прежнее (если было) и пробуем через час.
        fsFillAt = Date.now();
        console.warn("Не удалось дочитать счётчики столов из Firestore:", error);
      } finally {
        fsFillRunning = null;
      }
    })();
    return fsFillRunning;
  }

  /** Первая выдача с сервера пуста — а есть ли я в копии прав? Иначе пустота — отказ, а не «столов нет». */
  async function notMember(): Promise<boolean> {
    try {
      const { data, error } = await supabaseRows.rpc("rows_whoami", { p_workspace: workspaceId });
      if (error || !data || typeof data !== "object") return false;
      return !(data as { role?: unknown }).role;
    } catch {
      return false;
    }
  }

  function cursor(): number {
    let newest = 0;
    for (const entry of byPage.values()) newest = Math.max(newest, entry.at);
    let best = 0;
    for (const entry of byPage.values()) {
      if (entry.at <= newest - CURSOR_SAFETY_MS && entry.rev > best) best = entry.rev;
    }
    return best;
  }

  function publish() {
    const loads = [...byPage.values()].map((entry) => rowToDeskLoad(entry.row));
    for (const doc of fsFill) if (!byPage.has(doc.pageId)) loads.push({ ...doc, sbFallback: true });
    loads.sort((a, b) => a.pageId.localeCompare(b.pageId));
    writeSnapshot(workspaceId, "deskLoads", loads);
    emit({ kind: "data", loads, fromCache: false });
  }

  function visible() {
    return typeof document === "undefined" || document.visibilityState === "visible";
  }

  async function fetchRows() {
    if (stopped) return;
    if (inFlight) {
      again = true;
      return;
    }
    inFlight = true;
    try {
      // Первая выборка — целиком (столов десятки); дальше — только новее курсора.
      const after = serverSynced ? cursor() : 0;
      let changed = !serverSynced;
      for (let from = 0; ; from += 1000) {
        let request = supabaseRows.from(DESK_LOADS_TABLE).select(DESK_LOAD_COLUMNS).eq("workspace_id", workspaceId);
        if (after > 0) request = request.gt("rev", after);
        const { data, error } = await request.order("rev", { ascending: true }).range(from, from + 999);
        if (stopped) return;
        if (error) throw error;
        const rows = (data ?? []) as DeskLoadRow[];
        for (const row of rows) {
          const rev = Number(row.rev);
          const known = byPage.get(row.page_id);
          // Дубли из запаса курсора и обгоны — по rev, а не по времени прихода.
          if (known && known.rev >= rev) continue;
          byPage.set(row.page_id, { row, rev, at: millis(row.server_at) });
          changed = true;
        }
        if (rows.length < 1000) break;
      }
      markSbTablePresent("deskLoads");
      if (!serverSynced) {
        if (byPage.size === 0 && (await notMember())) {
          // RLS отдаёт пустоту и тем, кого ещё нет в копии прав: «0 заказов у
          // всех» было бы ложью. Остаёмся на Firestore, но «таблицы нет» не
          // помечаем — остальные на других устройствах читают Supabase.
          if (stopped) return;
          stop();
          emit({ kind: "notMember" });
          return;
        }
        if (stopped) return;
        if (fillDue()) {
          let filled = false;
          const fill = runFill().then(() => {
            filled = true;
          });
          await Promise.race([fill, new Promise<void>((resolve) => setTimeout(resolve, FS_FILL_WAIT_MS))]);
          if (stopped) return;
          // Не дождались — выдадим без подмешанного, а придёт — дорисуем.
          if (!filled) {
            void fill.then(() => {
              if (!stopped) publish();
            });
          }
        }
      } else if (fillDue()) {
        void runFill().then(() => {
          if (!stopped) publish();
        });
      }
      serverSynced = true;
      failures = 0;
      if (changed) publish();
    } catch (error) {
      if (stopped) return;
      if (isSbMissingError(error)) {
        markSbTableMissing("deskLoads");
        stop();
        emit({ kind: "missing" });
        return;
      }
      // Пока сервер ни разу не ответил — это «неизвестно», экран должен знать.
      if (!serverSynced) emit({ kind: "error", error });
      const delay = RETRY_MS[Math.min(failures, RETRY_MS.length - 1)];
      failures += 1;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void fetchRows();
      }, delay);
    } finally {
      inFlight = false;
      if (again && !stopped) {
        again = false;
        void fetchRows();
      }
    }
  }

  function onRing() {
    if (stopped) return;
    if (!visible()) {
      // Свёрнутая вкладка не качает — дочитает при возврате.
      dirtyWhileHidden = true;
      return;
    }
    if (ringTimer) return;
    ringTimer = setTimeout(() => {
      ringTimer = null;
      void fetchRows();
    }, RING_SETTLE_MS);
  }

  const stopListening = listenTopic(deskLoadsTopic(workspaceId), onRing);
  const pollTimer = setInterval(() => {
    if (visible() && serverSynced) void fetchRows();
  }, POLL_MS);
  // Возврат на вкладку — сразу дельта: минуту опроса на телефоне не ждать.
  const onVisibility = () => {
    if (!visible() || !serverSynced) return;
    dirtyWhileHidden = false;
    void fetchRows();
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);

  function stop() {
    if (stopped) return;
    stopped = true;
    stopListening();
    clearInterval(pollTimer);
    if (ringTimer) clearTimeout(ringTimer);
    if (retryTimer) clearTimeout(retryTimer);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
  }

  void fetchRows();
  return stop;
}

/**
 * Счётчики всех столов workspace. `backend` решает useSbBackend
 * (services/sb/sbCollections.ts). Supabase: сначала снимок из localStorage
 * (`fromCache = true` — рисовать можно, решать нельзя), затем выборка, затем
 * по звонку `nova:{ws}:deskloads` — дельта `rev > курсор`; без звонка — опрос
 * раз в минуту на видимой вкладке. Одна подписка на все экраны вкладки.
 * Столы, которых в Supabase ещё нет, — из Firestore (`sbFallback`, см.
 * FS_FILL_SNAPSHOT). Нет таблицы (SQL не накатан) или меня нет в копии прав —
 * молча Firestore.
 */
export function subscribeDeskLoads(
  workspaceId: string,
  /** `source` — откуда на деле пришли счётчики (Supabase мог уйти в Firestore). */
  onData: (loads: DeskLoad[], fromCache: boolean, source: SbBackend) => void,
  onError?: (error: unknown) => void,
  backend: SbBackend = "firestore"
) {
  const fromFirestore = (loads: DeskLoad[], fromCache: boolean) => onData(loads, fromCache, "firestore");
  if (backend !== "supabase") return fsSubscribeDeskLoads(workspaceId, fromFirestore, onError);
  let left = false;
  let fallback: (() => void) | null = null;
  const leave = joinSharedSubscription<DeskLoadsFeed>(
    `deskLoads:sb:${workspaceId}:${snapshotUid() ?? ""}:${sbTablesVersion()}`,
    (emit) => startSbDeskLoads(workspaceId, emit),
    (feed) => {
      if (left || fallback) return;
      if (feed.kind === "data") onData(feed.loads, feed.fromCache, "supabase");
      else if (feed.kind === "error") onError?.(feed.error);
      else fallback = fsSubscribeDeskLoads(workspaceId, fromFirestore, onError);
    },
    SHARED_LINGER_MS
  );
  return () => {
    left = true;
    leave();
    fallback?.();
  };
}
