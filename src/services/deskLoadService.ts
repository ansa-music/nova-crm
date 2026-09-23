import { onSnapshot, query, runTransaction, where, type FirestoreError } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { getDocResumable, paths, withErrorReporting } from "@/firebase/firestore";
import { currentMonthSubPageId } from "@/services/monthTabService";
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
 * Returns whether the doc was actually written (see REWRITE_UNCHANGED_AFTER_MS).
 */
export async function publishDeskLoad(load: Omit<DeskLoad, "updatedAt">): Promise<boolean> {
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

export function deskLoadSignatureKey(pageId: string, subPageId: string) {
  return `nova:deskload-sig:${pageId}:${subPageId}`;
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
  responsibleOptions: StatusOption[]
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
  const counts = countDeskLoad(columns, rows, responsibleOptions, monthKey);
  const next = { ...counts, subPageId, monthKey };
  if (!deskLoadNeedsPublish(current, next)) return false;
  const base = { pageId: page.id, workspaceId: page.workspaceId, responsibleUserId, updatedBy: uid };
  const published = await publishDeskLoad({ ...base, ...next });
  // Owner, открыв потом этот стол, не перепишет те же цифры ещё раз.
  rememberPublishedSignature(deskLoadSignatureKey(page.id, subPageId), deskLoadSignature({ ...next, responsibleUserId }));
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

/** Finished months from `fromMonthKey` on — a few docs per desk per month. */
export function subscribeDeskLoadHistory(
  workspaceId: string,
  fromMonthKey: string,
  onData: (docs: DeskLoadArchive[]) => void,
  onError?: (error: FirestoreError) => void
) {
  if (!db) {
    onData([]);
    return () => {};
  }
  return onSnapshot(
    query(paths.deskLoadHistory(workspaceId), where("monthKey", ">=", fromMonthKey)),
    (snapshot) => onData(snapshot.docs.map((d) => d.data() as DeskLoadArchive)),
    withErrorReporting(onError)
  );
}

/**
 * Live, but only while «Технари» is open — one listener on a small
 * collection that changes a few times an hour. Polling it would cost far
 * more reads for a screen an ОС keeps open all day.
 */
/**
 * `fromCache` — снимок из памяти SDK (LRU-кэш: при повторной подписке он
 * приходит первым и может быть старым). По такому снимку можно рисовать, но
 * нельзя РЕШАТЬ — пересчёт Owner решал бы «устарело» по кэшу и перечитывал
 * все столы. `includeMetadataChanges` нужен, чтобы переход кэш → сервер без
 * изменений в документах тоже дошёл до подписчика.
 */
export function subscribeDeskLoads(
  workspaceId: string,
  onData: (loads: DeskLoad[], fromCache: boolean) => void,
  onError?: (error: FirestoreError) => void
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
