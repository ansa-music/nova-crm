import type { OsAdoptionReport } from "@/services/rows/osOrderAdoption";
import type { OwnRowWrite } from "@/services/rows/supabaseRowStore";
import type { WorkspaceMember, WorkspacePage } from "@/types";

/**
 * Страховка подхвата — сессия настоящего Owner (жалоба Nurba 13.10.2026: «в
 * столе тех добавил заказ — у ОС не появился»). Подхват делает вкладка САМОГО
 * ОС (`useOsOrderClaims`), и пока его нет в сети, заказ с его ником на его
 * стол не попадал. Owner вправе писать в любые столы — его вкладка передаёт
 * такие заказы сама тем же кодом, что кнопка «Передать ОС», но в авто-режиме
 * (`auto` в `adoptOrdersToOsDesks`: без возвращённых технарю, без
 * недописанных строк и без заказов тому, кто ОС уже не работает):
 * - своя запись в стол (клиент или ник ОС) — этот стол, когда строка отлежится;
 * - чужой «звонок» `OS_CLAIM_TOPIC` с id стола — ЭТОТ стол, через
 *   `BACKUP_RING_MS` (сначала шанс вкладке самого ОС).
 *
 * Проверяется только названный стол и только его несвязанные строки с ником
 * ОС — не все столы подряд: первая версия по каждому звонку читала вкладки
 * всех технарей целиком, а трафик Supabase на бесплатном тарифе — 5 ГБ в
 * месяц. Звонок без id стола (вкладка на прежнем коде) не обрабатывается.
 *
 * Здесь только расписание — без React и без базы: хук
 * `useOwnerOsAdoptBackup` подставляет настоящие зависимости, проверки — свои.
 */
export const BACKUP_RING_MS = 45_000;
export const BACKUP_RETRY_MS = 8_000;
/**
 * Сколько раз подряд ждём, пока строку допишут: дальше стол отпускаем до
 * следующей записи или звонка (часы технаря могут спешить, и «только что
 * правили» тогда длилось бы часами).
 */
export const BACKUP_WAIT_TRIES = 12;
/** Столов за один заход — остальные следующим (заходы идут подряд). */
export const BACKUP_PAGES_PER_RUN = 4;

export interface OsAdoptBackupDeps {
  workspaceId: string;
  /** Столы из памяти вкладки (все, включая столы ОС) — на момент вызова. */
  pages: () => readonly WorkspacePage[];
  members: () => readonly WorkspaceMember[];
  adopt: (input: {
    workspaceId: string;
    members: readonly WorkspaceMember[];
    pageIds: readonly string[];
    auto: { now: number; pages: readonly WorkspacePage[] };
  }) => Promise<OsAdoptionReport>;
  /** Свои удачные записи строк (`onOwnRowWrite`). */
  onOwnWrite: (listener: (event: OwnRowWrite) => void) => () => void;
  /** Звонки `OS_CLAIM_TOPIC`; заметки — id столов. */
  listenRing: (onRing: (notes?: readonly string[]) => void) => () => void;
  /** Заказы переданы — сказать человеку. */
  onAdopted: (count: number) => void;
  /** Свой стол, а заказ не ушёл — причина (вызывается один раз на причину). */
  onWhy: (text: string) => void;
  /** Для проверок: свои задержки. */
  ringMs?: number;
  retryMs?: number;
}

/** Запустить страховку; возвращает «остановить». */
export function startOsAdoptBackup(deps: OsAdoptBackupDeps): () => void {
  const ringMs = deps.ringMs ?? BACKUP_RING_MS;
  const retryMs = deps.retryMs ?? BACKUP_RETRY_MS;
  /** Столы, которые ждут передачи: id → не раньше какого момента смотреть. */
  const due = new Map<string, number>();
  /** Столы, тронутые своей записью: по ним говорим, почему заказ не ушёл. */
  const own = new Set<string>();
  /** Сколько заходов подряд стол «ещё дописывают». */
  const waits = new Map<string, number>();
  const toldWhy = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let timerAt = 0;
  let running = false;
  let disposed = false;

  /** Стол технаря с опубликованной картой столбцов — только такие и смотрим. */
  const deskOf = (pageId: string) => {
    const page = deps.pages().find((p) => p.id === pageId);
    return page && !page.osDesk && !page.isDashboard && !page.inactive && page.osFieldKeys?.os ? page : null;
  };

  const arm = () => {
    if (disposed || due.size === 0) return;
    const at = Math.min(...due.values());
    if (timer !== null && timerAt <= at) return;
    if (timer !== null) clearTimeout(timer);
    timerAt = at;
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, Math.max(0, at - Date.now()));
  };

  const mark = (pageId: string, delayMs: number, fresh = true) => {
    // Новая запись или звонок — счёт ожиданий начинается заново.
    if (fresh) waits.delete(pageId);
    const at = Date.now() + delayMs;
    const prev = due.get(pageId);
    if (prev === undefined || at < prev) due.set(pageId, at);
    arm();
  };

  async function run() {
    // Идёт заход — по его окончании таймер взведётся заново.
    if (disposed || running) return;
    const now = Date.now();
    const pageIds = [...due]
      .filter(([, at]) => at <= now)
      .map(([id]) => id)
      .slice(0, BACKUP_PAGES_PER_RUN);
    if (pageIds.length === 0) {
      arm();
      return;
    }
    for (const id of pageIds) due.delete(id);
    const tellWhy = pageIds.every((id) => own.has(id));
    for (const id of pageIds) own.delete(id);
    running = true;
    try {
      const report = await deps.adopt({
        workspaceId: deps.workspaceId,
        members: deps.members(),
        pageIds,
        auto: { now: Date.now(), pages: deps.pages() },
      });
      if (disposed) return;
      if (report.adopted > 0) deps.onAdopted(report.adopted);
      const waiting = report.waiting ?? 0;
      // Свой стол, а заказ не ушёл — сказать почему (один раз на причину).
      if (tellWhy && report.adopted === 0 && waiting === 0) {
        const why =
          report.errors[0] ??
          (report.unknownOsNicks.length > 0
            ? "Ник ОС из строки не закреплён за аккаунтом с ролью ОС — закрепите его на «Команде»"
            : "");
        if (why && !toldWhy.has(why)) {
          toldWhy.add(why);
          deps.onWhy(why);
        }
      }
      // Строку ещё дописывают (или заказов больше, чем берём за заход) — зайдём снова.
      for (const id of pageIds) {
        if (waiting === 0) {
          waits.delete(id);
          continue;
        }
        const tries = (waits.get(id) ?? 0) + 1;
        if (tries > BACKUP_WAIT_TRIES) {
          waits.delete(id);
          continue;
        }
        waits.set(id, tries);
        if (tellWhy) own.add(id);
        mark(id, retryMs, false);
      }
    } catch (error) {
      console.warn("[os-adopt-backup] передача не удалась", error);
    } finally {
      running = false;
      arm();
    }
  }

  const stopWrites = deps.onOwnWrite((event) => {
    if (event.workspaceId !== deps.workspaceId) return;
    const page = deskOf(event.pageId);
    const keys = page?.osFieldKeys;
    if (!page || !keys?.os) return;
    if ((keys.tabId ?? "") !== event.tab) return;
    if (!event.cellKeys.includes(keys.os) && !(keys.client && event.cellKeys.includes(keys.client))) return;
    own.add(page.id);
    mark(page.id, retryMs);
  });
  const stopRing = deps.listenRing((notes) => {
    // Свой же звонок по своему столу уже учтён выше (срок раньше) — `mark` его не сдвинет.
    for (const pageId of notes ?? []) if (deskOf(pageId)) mark(pageId, ringMs);
  });

  return () => {
    disposed = true;
    if (timer !== null) clearTimeout(timer);
    stopWrites();
    stopRing();
  };
}
