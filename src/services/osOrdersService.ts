import { onSnapshot, query, setDoc, where, type FirestoreError } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { getDocsResumable, paths, withErrorReporting } from "@/firebase/firestore";
import { supabaseRows } from "@/lib/supabaseRows";
import {
  isSbMissingError,
  markSbTableMissing,
  markSbTablePresent,
  sbBackendOf,
  sbTableRecheckDue,
  sbTablesVersion,
  sbTargetOf,
  type SbBackend,
} from "@/services/sb/sbCollections";
import { readSnapshot, snapshotUid, writeSnapshot } from "@/services/sb/snapshotCache";
import { listenTopic, ringTopic } from "@/services/sb/topicDoorbell";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { joinSharedSubscription } from "@/utils/sharedSubscription";
import type { OsOrderItem, OsOrders } from "@/types";

/*
 * Списки заказов ОС («Технари» → «Ваши заказы»): по документу на стол и ник
 * ОС. Пишет стол рядом со счётчиками (useDeskLoadPublisher, пересчёт Owner),
 * читает только сам ОС (и Owner).
 *
 * Где лежат — решает sbCollections (ключ `osOrders`): строки столов в
 * Supabase и SQL `20260930b_os_orders.sql` вставлен — таблица `os_orders`,
 * иначе Firestore, как было. В Firestore каждая публикация стоила чтение у
 * каждого ОС с открытыми «Технарями»; в Supabase квоты на операции нет, а
 * живость — звонок `nova:{ws}:osorders` (без данных) и дочитывание своим
 * токеном только изменившегося.
 */

export function osOrdersId(pageId: string, osValue: string) {
  return `${pageId}_${osValue}`;
}

/** Тема звонка списков ОС workspace — без данных и без ника (см. topicDoorbell). */
export function osOrdersTopic(workspaceId: string) {
  return `nova:${workspaceId}:osorders`;
}

/**
 * Куда писать списки этого workspace — в момент ЗАПИСИ, по документу
 * workspace из стора (у писателя экрана «Технари» может и не быть, а хук
 * стола хранилища не знает). Чужой или ещё не пришедший workspace — Firestore.
 *
 * Память «таблицы нет» сама не истекает (урок фазы 1): у писателя нет экрана,
 * который переспросил бы базу пробой, поэтому «пора переспросить» = попробовать
 * запись в Supabase. Не легла — publishOsOrders снова пометит «нет» и допишет
 * Firestore; легла — пометит «есть». Без этого устройство с памятью «нет»
 * после вставки SQL писало бы в Firestore вечно.
 */
export function osOrdersBackendOf(workspaceId: string): SbBackend {
  const workspace = useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId);
  if (!workspace) return "firestore";
  const backend = sbBackendOf(workspace, "osOrders");
  if (backend === "firestore" && sbTargetOf(workspace, "osOrders") === "supabase" && sbTableRecheckDue("osOrders")) {
    return "supabase";
  }
  return backend;
}

export interface OsOrdersPublishResult {
  /** Запись легла (Supabase: база не пропустила её как «тот же список»). */
  written: boolean;
  /** Куда запись ушла НА ДЕЛЕ: просили Supabase, а SQL не вставлен — Firestore. */
  backend: SbBackend;
}

/**
 * Overwrites one ОС's order list for a desk. Allowed for whoever may edit the
 * desk's rows with its real responsible person (firestore.rules → osOrders,
 * политики os_orders). `backend` не передан — решает osOrdersBackendOf.
 */
export async function publishOsOrders(
  input: Omit<OsOrders, "updatedAt">,
  backend: SbBackend = osOrdersBackendOf(input.workspaceId)
): Promise<OsOrdersPublishResult> {
  if (backend === "supabase") {
    try {
      const written = await sbPublishOsOrders(input);
      // Отмечаем хранилище только ПОСЛЕ удачной записи: перепроверка «таблицы
      // нет» (раз в 10 минут, пока SQL не вставлен) иначе дважды стирала бы
      // память подписей (supabase → firestore), и каждый стол переписывал бы
      // все свои списки в Firestore — лишние записи и чтения у всех ОС.
      noteWriteBackend("supabase");
      return { written, backend: "supabase" };
    } catch (error) {
      // SQL ещё не вставлен — молча по-старому. Отказ прав и сеть — наверх:
      // хук стола повторит запись со следующим снимком строк.
      if (!isSbMissingError(error)) throw error;
      markSbTableMissing("osOrders");
    }
  }
  noteWriteBackend("firestore");
  if (!db) return { written: false, backend: "firestore" };
  await setDoc(paths.osOrders(input.workspaceId, osOrdersId(input.pageId, input.osValue)), {
    ...input,
    updatedAt: Date.now(),
  });
  return { written: true, backend: "firestore" };
}

/*
 * Память «этот браузер уже записал такой список» (`nova:osorders-sig:…`,
 * useDeskLoadPublisher) общая на оба хранилища: ключ задаёт хук стола, а он
 * хранилища не знает. После смены хранилища она закрыла бы первую запись в
 * НОВОЕ (список, записанный в Firestore, не попал бы в Supabase до следующей
 * правки, и наоборот после отката). Поэтому при смене хранилища записи этот
 * браузер свою память списков забывает: лишняя запись дешевле пропавшего
 * списка. Пока пропущенное не переписано, читатель в режиме Supabase
 * подмешивает такие столы из Firestore (FS_FILL_SNAPSHOT ниже).
 */
const WRITE_BACKEND_KEY = "nova:osorders-backend";
const SIGNATURE_PREFIX = "nova:osorders-sig:";

/** Каждый раз из localStorage, без памяти на модуле: хранилище могла сменить соседняя вкладка. */
function noteWriteBackend(backend: SbBackend) {
  try {
    const previous = window.localStorage.getItem(WRITE_BACKEND_KEY);
    if (previous === backend) return;
    window.localStorage.setItem(WRITE_BACKEND_KEY, backend);
    if (!previous) return;
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(SIGNATURE_PREFIX)) doomed.push(key);
    }
    for (const key of doomed) window.localStorage.removeItem(key);
  } catch {
    /* без localStorage и памяти подписей нет */
  }
}

// ---------------------------------------------------------------------
// Supabase (supabase/migrations/20260930b_os_orders.sql).
// ---------------------------------------------------------------------

const OS_ORDERS_TABLE = "os_orders";
const OS_ORDERS_COLUMNS = "workspace_id,page_id,os_value,responsible_uid,month_key,sub_page_id,orders,updated_by,rev,server_at";

interface OsOrdersRow {
  workspace_id: string;
  page_id: string;
  os_value: string;
  responsible_uid: string;
  month_key: string;
  sub_page_id: string;
  orders: OsOrderItem[] | null;
  updated_by: string | null;
  rev: number | string;
  server_at: string;
}

function sbError(error: { code?: string; message?: string }): Error {
  return Object.assign(new Error(error.message || "Supabase: запрос не прошёл"), { code: error.code ?? "" });
}

function millis(value: string | null | undefined): number {
  const ms = value ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

/** Строка таблицы → тот же OsOrders, что из Firestore; `updatedAt` — СЕРВЕРНОЕ время записи. */
function rowToOsOrders(row: OsOrdersRow): OsOrders {
  return {
    pageId: row.page_id,
    workspaceId: row.workspace_id,
    responsibleUserId: row.responsible_uid,
    osValue: row.os_value,
    monthKey: row.month_key,
    subPageId: row.sub_page_id,
    orders: Array.isArray(row.orders) ? row.orders : [],
    updatedAt: millis(row.server_at),
    updatedBy: row.updated_by ?? "",
  };
}

/**
 * upsert одного списка. «Тот же список той же вкладки моложе 90 минут» и
 * «прошлый месяц поверх нового» база пропускает сама (os_orders_guard):
 * 0 строк — звонить некому.
 */
async function sbPublishOsOrders(input: Omit<OsOrders, "updatedAt">): Promise<boolean> {
  const { data, error } = await supabaseRows
    .from(OS_ORDERS_TABLE)
    .upsert(
      {
        workspace_id: input.workspaceId,
        page_id: input.pageId,
        os_value: input.osValue,
        responsible_uid: input.responsibleUserId,
        month_key: input.monthKey,
        sub_page_id: input.subPageId,
        orders: input.orders ?? [],
        updated_by: input.updatedBy,
      },
      { onConflict: "workspace_id,page_id,os_value" }
    )
    .select("rev");
  if (error) throw sbError(error);
  markSbTablePresent("osOrders");
  const written = Array.isArray(data) && data.length > 0;
  if (written) ringTopic(osOrdersTopic(input.workspaceId));
  return written;
}

// ---------------------------------------------------------------------
// Чтение: свои списки ОС.
// ---------------------------------------------------------------------

type OsOrdersFeed =
  | { kind: "data"; docs: OsOrders[]; fromCache: boolean }
  | { kind: "error"; error: unknown }
  | { kind: "missing" }
  /**
   * Таблица есть, но копия прав меня не знает или ник в ней не тот (сверка
   * руководства ещё не довела osNickValue) — RLS отдаёт пустоту, и она была бы
   * ложью «заказов нет». Читать Firestore, «таблицы нет» не помечать.
   */
  | { kind: "notSynced" };

/** Запас курсора — как у счётчиков (deskLoadService: CURSOR_SAFETY_MS). */
const CURSOR_SAFETY_MS = 15_000;
/** Склейка звонков: серия публикаций разных столов — одна дельта. */
const RING_SETTLE_MS = 2_000;
/** Без звонка (канал не поднялся) — опрос на видимой вкладке. */
const POLL_MS = 60_000;
const RETRY_MS = [3_000, 10_000, 30_000];
/** Общая подписка живёт ещё минуту после ухода экрана. */
const SHARED_LINGER_MS = 60_000;

/*
 * Списки, которых в os_orders ещё нет. «Авто» включает Supabase в ту минуту,
 * когда Nurba вставил SQL, а таблица пустая: строки появляются у столов,
 * которые открыли технари, или после пересчёта Owner. Ещё пробел даёт память
 * подписей стола (см. noteWriteBackend) и вкладки на старом коде (пишут
 * Firestore до перезагрузки). Такие столы подмешиваются из Firestore — одним
 * узким getDocsResumable (`osValue == мой ник`, единицы документов): в первый
 * раз в браузере, дальше не чаще раза в час и только пока у текущего месяца
 * есть пробел (и раз в сутки на всякий случай). Supabase побеждает, если там
 * тот же или более новый месяц.
 */
const FS_FILL_EVERY_MS = 60 * 60_000;
const FS_FILL_SAFETY_MS = 24 * 60 * 60_000;
/** Первая выдача с сервера ждёт подмешивание не дольше — Firestore может висеть. */
const FS_FILL_WAIT_MS = 10_000;

function snapshotName(osValue: string) {
  return `osOrders:${osValue}`;
}

function fillSnapshotName(osValue: string) {
  return `osOrders:fsfill:${osValue}`;
}

/** Решение слияния — чистая функция: Supabase, а стол, которого там нет (или там месяц старее), — из Firestore. */
export function mergeOsOrdersFill(fresh: OsOrders[], fill: OsOrders[]): OsOrders[] {
  const byPage = new Map(fresh.map((doc) => [doc.pageId, doc]));
  for (const doc of fill) {
    const known = byPage.get(doc.pageId);
    if (!known || (doc.monthKey ?? "") > (known.monthKey ?? "")) byPage.set(doc.pageId, doc);
  }
  return [...byPage.values()].sort((a, b) => a.pageId.localeCompare(b.pageId));
}

/** Есть ли пробел: документ Firestore самого нового месяца, которого нет (или он новее) в Supabase. */
export function osOrdersFillHasHoles(fresh: OsOrders[], fill: OsOrders[]): boolean {
  let newest = "";
  for (const doc of fresh) if ((doc.monthKey ?? "") > newest) newest = doc.monthKey;
  for (const doc of fill) if ((doc.monthKey ?? "") > newest) newest = doc.monthKey;
  const byPage = new Map(fresh.map((doc) => [doc.pageId, doc]));
  return fill.some((doc) => doc.monthKey === newest && (byPage.get(doc.pageId)?.monthKey ?? "") < newest);
}

function startSbOsOrders(workspaceId: string, osValue: string, emit: (feed: OsOrdersFeed) => void): () => void {
  let stopped = false;
  let serverSynced = false;
  const byPage = new Map<string, { row: OsOrdersRow; rev: number; at: number }>();
  let inFlight = false;
  let again = false;
  let failures = 0;
  let ringTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const cached = readSnapshot<OsOrders[]>(workspaceId, snapshotName(osValue));
  if (cached) {
    // Снимок — сразу, но после возврата из subscribe: подписчик ещё не готов.
    queueMicrotask(() => {
      if (!stopped && !serverSynced) emit({ kind: "data", docs: cached.value, fromCache: true });
    });
  }

  const fillCached = readSnapshot<OsOrders[]>(workspaceId, fillSnapshotName(osValue));
  let fsFill: OsOrders[] = fillCached?.value ?? [];
  let fsFillAt = fillCached?.savedAt ?? 0;
  let fsFillRunning: Promise<void> | null = null;

  function freshDocs(): OsOrders[] {
    return [...byPage.values()].map((entry) => rowToOsOrders(entry.row));
  }

  function fillDue(): boolean {
    if (!db || fsFillRunning) return false;
    if (fsFillAt === 0) return true;
    const age = Date.now() - fsFillAt;
    if (age < FS_FILL_EVERY_MS) return false;
    return age >= FS_FILL_SAFETY_MS || osOrdersFillHasHoles(freshDocs(), fsFill);
  }

  function runFill(): Promise<void> {
    if (fsFillRunning) return fsFillRunning;
    fsFillRunning = (async () => {
      try {
        const snapshot = await getDocsResumable(query(paths.osOrdersAll(workspaceId), where("osValue", "==", osValue)));
        fsFill = snapshot.docs.map((d) => d.data() as OsOrders);
        fsFillAt = Date.now();
        writeSnapshot(workspaceId, fillSnapshotName(osValue), fsFill);
      } catch (error) {
        // Не вышло — подмешиваем прежнее (если было) и пробуем через час.
        fsFillAt = Date.now();
        console.warn("Не удалось дочитать заказы ОС из Firestore:", error);
      } finally {
        fsFillRunning = null;
      }
    })();
    return fsFillRunning;
  }

  /**
   * Первая выдача пуста — а знает ли копия прав мой ник? Сверка руководства
   * могла ещё не довести osNickValue (выдали только что, Owner и Тимлид не в
   * сети). Нет записи участника или ник другой — это не «заказов нет».
   * Ошибка самой проверки — считаем, что всё в порядке (пусть решит заливка).
   */
  async function notSynced(): Promise<boolean> {
    const uid = snapshotUid();
    if (!uid) return false;
    try {
      const { data, error } = await supabaseRows
        .from("rows_members")
        .select("os_nick_value")
        .eq("workspace_id", workspaceId)
        .eq("uid", uid)
        .maybeSingle();
      if (error) return false;
      const nick = (data as { os_nick_value?: unknown } | null)?.os_nick_value;
      return !data || nick !== osValue;
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
    const docs = mergeOsOrdersFill(freshDocs(), fsFill);
    writeSnapshot(workspaceId, snapshotName(osValue), docs);
    emit({ kind: "data", docs, fromCache: false });
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
      // Первая выборка — целиком (своих списков единицы); дальше — только
      // новее курсора и без тех, что уже есть: у ОС строк мало, курсор
      // растёт медленно, а список — до 150 заказов, и каждый звонок иначе
      // заново качал бы его целиком.
      const after = serverSynced ? cursor() : 0;
      let changed = !serverSynced;
      let request = supabaseRows
        .from(OS_ORDERS_TABLE)
        .select(OS_ORDERS_COLUMNS)
        .eq("workspace_id", workspaceId)
        .eq("os_value", osValue);
      if (serverSynced) {
        if (after > 0) request = request.gt("rev", after);
        const known = [...byPage.values()].map((entry) => entry.rev).filter((rev) => rev > after);
        if (known.length > 0) request = request.not("rev", "in", `(${known.join(",")})`);
      }
      const { data, error } = await request.order("rev", { ascending: true }).limit(1000);
      if (stopped) return;
      if (error) throw error;
      for (const row of (data ?? []) as OsOrdersRow[]) {
        const rev = Number(row.rev);
        const known = byPage.get(row.page_id);
        // Дубли из запаса курсора и обгоны — по rev, а не по времени прихода.
        if (known && known.rev >= rev) continue;
        byPage.set(row.page_id, { row, rev, at: millis(row.server_at) });
        changed = true;
      }
      markSbTablePresent("osOrders");
      if (!serverSynced) {
        if (byPage.size === 0 && (await notSynced())) {
          if (stopped) return;
          stop();
          emit({ kind: "notSynced" });
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
        markSbTableMissing("osOrders");
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
    // Свёрнутая вкладка не качает — дочитает при возврате.
    if (stopped || !visible() || ringTimer) return;
    ringTimer = setTimeout(() => {
      ringTimer = null;
      void fetchRows();
    }, RING_SETTLE_MS);
  }

  const stopListening = listenTopic(osOrdersTopic(workspaceId), onRing);
  const pollTimer = setInterval(() => {
    if (visible() && serverSynced) void fetchRows();
  }, POLL_MS);
  // Возврат на вкладку — сразу дельта: минуту опроса на телефоне не ждать.
  const onVisibility = () => {
    if (visible() && serverSynced) void fetchRows();
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

function fsSubscribeMyOsOrders(
  workspaceId: string,
  osValue: string,
  onData: (docs: OsOrders[], fromCache: boolean) => void,
  onError?: (error: FirestoreError) => void
) {
  if (!db) {
    onData([], false);
    return () => {};
  }
  return onSnapshot(
    query(paths.osOrdersAll(workspaceId), where("osValue", "==", osValue)),
    (snapshot) => onData(snapshot.docs.map((d) => d.data() as OsOrders), snapshot.metadata.fromCache),
    withErrorReporting(onError)
  );
}

/**
 * The signed-in ОС's own order lists across every desk — live while
 * «Технари» is open. The rule lets an ОС read only docs whose osValue is
 * their nick, so the query filters on exactly that field.
 *
 * `backend` решает экран (useSbBackend, ключ `osOrders`). Supabase: снимок
 * из localStorage (`fromCache = true` — рисовать можно, решать нельзя), затем
 * выборка, затем по звонку `nova:{ws}:osorders` — дельта; без звонка — опрос
 * раз в минуту на видимой вкладке. Нет таблицы (SQL не вставлен) или копия
 * прав ещё не знает мой ник — молча Firestore, как было.
 */
export function subscribeMyOsOrders(
  workspaceId: string,
  osValue: string,
  onData: (docs: OsOrders[], fromCache: boolean) => void,
  onError?: (error: unknown) => void,
  backend: SbBackend = "firestore"
) {
  if (backend !== "supabase") return fsSubscribeMyOsOrders(workspaceId, osValue, onData, onError);
  let left = false;
  let fallback: (() => void) | null = null;
  let leave: (() => void) | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  // Ник ОС ещё не в копии прав (только что выдали; SQL вставили, а сверка
  // руководства ещё не прошла) — пока показываем Firestore, но НЕ навсегда:
  // писатели в режиме Supabase в Firestore больше не пишут, и экран застыл бы
  // на старых списках. Раз в 2 минуты пробуем Supabase снова (новым ключом —
  // прежняя общая подписка остановлена и ещё «задерживается»), а первый ответ
  // сервера снимает запасную подписку.
  const join = () => {
    attempt += 1;
    leave = joinSharedSubscription<OsOrdersFeed>(
      `osOrders:sb:${workspaceId}:${osValue}:${snapshotUid() ?? ""}:${sbTablesVersion()}:${attempt}`,
      (emit) => startSbOsOrders(workspaceId, osValue, emit),
      (feed) => {
        if (left) return;
        if (feed.kind === "notSynced") {
          const drop = leave;
          leave = null;
          // Не отписываемся изнутри рассылки общей подписки — на следующем такте.
          queueMicrotask(() => drop?.());
          if (!fallback) fallback = fsSubscribeMyOsOrders(workspaceId, osValue, onData, onError);
          if (retryTimer === null) {
            retryTimer = setTimeout(() => {
              retryTimer = null;
              if (!left) join();
            }, NOT_SYNCED_RETRY_MS);
          }
          return;
        }
        if (feed.kind === "error") {
          if (!fallback) onError?.(feed.error);
          return;
        }
        if (feed.kind === "missing") {
          // Таблицы нет (SQL не вставлен) — Firestore до конца жизни экрана;
          // следующий экран сам выберет Firestore по памяти «таблицы нет».
          if (!fallback) fallback = fsSubscribeMyOsOrders(workspaceId, osValue, onData, onError);
          return;
        }
        if (fallback) {
          // Пока жив запасной Firestore, снимок из кэша не смешиваем с ним;
          // ответ сервера — Supabase снова видит мои списки.
          if (feed.fromCache) return;
          fallback();
          fallback = null;
        }
        onData(feed.docs, feed.fromCache);
      },
      SHARED_LINGER_MS
    );
  };
  join();
  return () => {
    left = true;
    leave?.();
    fallback?.();
    if (retryTimer !== null) clearTimeout(retryTimer);
  };
}

/** Как часто экран ОС переспрашивает Supabase, пока ник не доехал в копию прав. */
const NOT_SYNCED_RETRY_MS = 2 * 60_000;
