import {
  getCountFromServer,
  getDocFromServer,
  getDocsFromServer,
  increment,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { DESK_ROWS_TABLE, supabaseRows } from "@/lib/supabaseRows";
import { fetchPagesFresh, stripUndefined } from "@/services/pageService";
import { fetchDeskObserverUidsFresh } from "@/services/deskObserverService";
import { fetchMembersFresh } from "@/services/memberService";
import { syncRowAcl, type AclSyncReport } from "@/services/rows/rowAclService";
import { migrationStartMillis } from "@/services/rows/rowsBackend";
import { sbDeleteRows, sbFetchRows, sbPageAccess, sbPutRows } from "@/services/rows/supabaseRowStore";
import type { PageRow, WorkspacePage } from "@/types";
import type { RowsMigrationStamp } from "@/types/workspace";

/**
 * Перенос строк таблиц между Firestore и Supabase — туда и обратно.
 *
 * Делает только Owner (правила Firestore: `rowsBackend`/`rowsMigrationAt`
 * Тимлиду не писать) и только кнопкой в «Настройки → Строки таблиц». Пока
 * идёт перенос, у workspace стоит `rowsMigrationAt`: все сессии перестают
 * править строки (`assertRowsWritable`), иначе правка, сделанная посреди
 * копирования, осталась бы в старом хранилище. Переключение происходит
 * только после сверки: в каждой таблице строк поровну. Не сошлось — хранилище
 * остаётся прежним, и ничего не потеряно: старая копия не трогается.
 */

export interface RowsHealth {
  ok: boolean;
  uid: string | null;
  role: string | null;
  isOwner: boolean;
  seeded: boolean;
  /** Что не так, по-человечески, с номером шага настройки. */
  problem: string | null;
}

function supabaseProblem(error: { message?: string; code?: string; status?: number } | null): string {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  if (code === "PGRST202" || code === "42883" || /rows_whoami/.test(message)) {
    return "В Supabase не накатан SQL (шаг 2): функции rows_* не найдены.";
  }
  if (code === "PGRST301" || code === "PGRST302" || error?.status === 401 || /JWT|No suitable key|signature/i.test(message)) {
    return "Supabase не принимает вход Firebase (шаг 1): включите Third-party Auth → Firebase с проектом nurba-6e70d.";
  }
  if (/fetch|network/i.test(message)) return "Supabase не отвечает — нет связи.";
  return `Supabase ответил ошибкой: ${message || code || "неизвестно"}`;
}

export async function checkRowsHealth(workspaceId: string): Promise<RowsHealth> {
  const { data, error } = await supabaseRows.rpc("rows_whoami", { p_workspace: workspaceId });
  if (error) {
    return { ok: false, uid: null, role: null, isOwner: false, seeded: false, problem: supabaseProblem(error) };
  }
  const who = (data ?? {}) as { uid?: string | null; role?: string | null; isOwner?: boolean; workspaceSeeded?: boolean; live?: boolean };
  const base = {
    uid: who.uid ?? null,
    role: who.role ?? null,
    isOwner: Boolean(who.isOwner),
    seeded: Boolean(who.workspaceSeeded),
  };
  if (!base.uid) {
    return { ok: false, ...base, problem: "Supabase не узнал вход Firebase (шаг 1): токен не принят как пользователь." };
  }
  if (!base.seeded) {
    return { ok: false, ...base, problem: "Workspace ещё не заведён в Supabase (шаг 3): выполните строку SQL ниже." };
  }
  if (typeof who.live !== "boolean") {
    // SQL накатан до появления замка хранилища (rows_set_state) — перенос упал бы на полпути.
    return { ok: false, ...base, problem: "В Supabase старая версия SQL (шаг 2): выполните файл миграции ещё раз — он повторяемый." };
  }
  if (!base.isOwner) {
    return { ok: false, ...base, problem: "В Supabase владельцем workspace записан другой аккаунт — проверьте строку шага 3." };
  }
  return { ok: true, ...base, problem: null };
}

/** SQL для шага 3 — одна строка, её Owner вставляет в SQL-редактор Supabase. */
export function seedSql(workspaceId: string, ownerUid: string): string {
  const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
  return `insert into public.rows_workspaces (workspace_id, owner_id) values (${q(workspaceId)}, ${q(ownerUid)}) on conflict (workspace_id) do update set owner_id = excluded.owner_id;`;
}

export interface MigrationProgress {
  phase: "prepare" | "acl" | "copy" | "verify" | "switch" | "done";
  done: number;
  total: number;
  label: string;
}

export interface MigrationReport {
  tables: number;
  rows: number;
  acl: AclSyncReport | null;
}

interface TableRef {
  page: WorkspacePage;
  /** null — «Основная». */
  tabId: string | null;
  tabName: string;
}

async function listTables(workspaceId: string, pages: readonly WorkspacePage[]): Promise<TableRef[]> {
  const tables: TableRef[] = [];
  for (const page of pages) {
    tables.push({ page, tabId: null, tabName: "Основная" });
    const subs = await getDocsFromServer(paths.subPages(workspaceId, page.id));
    for (const d of subs.docs) {
      const name = typeof d.data().name === "string" ? (d.data().name as string) : d.id;
      tables.push({ page, tabId: d.id, tabName: name });
    }
  }
  return tables;
}

function firestoreRowsRef(workspaceId: string, table: TableRef) {
  return table.tabId
    ? paths.subPageRows(workspaceId, table.page.id, table.tabId)
    : paths.rows(workspaceId, table.page.id);
}

/**
 * Строки, которые приложение ВИДИТ: подписка Firestore идёт с
 * `orderBy("order")`, а такой запрос молча пропускает документы без поля
 * `order`. Переносим и сверяем ровно их — иначе невидимые годами обрывки
 * всплыли бы в таблицах после переноса.
 */
function visibleRowsQuery(workspaceId: string, table: TableRef) {
  return query(firestoreRowsRef(workspaceId, table), orderBy("order", "asc"));
}

/** Время в мс из того, что лежит в старом документе: число, Timestamp или ничего. */
function millisOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return null;
}

/**
 * Документ строки Firestore → строка для Supabase. Даты старых строк бывают
 * Timestamp (serverTimestamp) или отсутствуют: `rowToRecord` поставил бы им
 * «сейчас», и месячные сводки посчитали бы старые заказы сегодняшними.
 */
export function firestoreDocToRow(id: string, data: Record<string, unknown>): PageRow | null {
  const order = data.order;
  if (typeof order !== "number" || !Number.isFinite(order)) return null;
  const updatedAt = millisOf(data.updatedAt);
  const createdAt = millisOf(data.createdAt) ?? updatedAt ?? 0;
  const row = { ...(data as unknown as PageRow), id, order, createdAt, updatedAt: updatedAt ?? createdAt };
  const filledAt = millisOf(data.filledAt);
  if (filledAt === null) delete row.filledAt;
  else row.filledAt = filledAt;
  return row;
}

async function supabaseCount(workspaceId: string, table: TableRef): Promise<number> {
  const { count, error } = await supabaseRows
    .from(DESK_ROWS_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("page_id", table.page.id)
    .eq("tab_id", table.tabId ?? "");
  if (error) throw new Error(`Supabase не посчитал строки «${table.page.name} / ${table.tabName}»: ${error.message}`);
  return count ?? 0;
}

function tableLabel(table: TableRef) {
  return `${table.page.name} / ${table.tabName}`;
}

async function setMigrationFlag(workspaceId: string, on: boolean) {
  // Серверное время: по нему правила держат 15-минутный замок (rowsMigrating).
  await updateDoc(paths.workspace(workspaceId), { rowsMigrationAt: on ? serverTimestamp() : null });
}

/**
 * Состояние хранилища строк в Supabase (`rows_set_state`, только Owner):
 * `live` — строки правят все по своим правам; неживое — запись закрыта всем,
 * а во время переноса (`migrating`, 15 минут) — открыта только Owner для
 * копирования. Так поздняя правка со старой вкладки в «чужое» хранилище
 * отказывает громко, а не теряется молча — зеркало замка в firestore.rules.
 */
async function setSupabaseState(workspaceId: string, live: boolean, migrating: boolean) {
  const { error } = await supabaseRows.rpc("rows_set_state", { p_workspace: workspaceId, p_live: live, p_migrating: migrating });
  if (error) throw new Error(`Supabase не переключил состояние хранилища: ${error.message}`);
}

/**
 * «Заказы ведёт ОС» в Supabase (`rows_set_os_managed`, только Owner).
 *
 * Тот же флаг, что `workspace.osManagedDesks` в Firestore, но правило держит
 * именно он: в Firestore флаг только прячет кнопки, а замок на правку статуса
 * стоит триггером `desk_rows_os_managed`. Поэтому переключаем СНАЧАЛА базу:
 * не переключилась — в интерфейсе ничего не меняем, иначе человек увидел бы
 * «включено», а технарь продолжал бы ставить себе «Успешку».
 */
export async function setSupabaseOsManaged(workspaceId: string, on: boolean): Promise<void> {
  const { error } = await supabaseRows.rpc("rows_set_os_managed", { p_workspace: workspaceId, p_on: on });
  if (!error) return;
  // Функции ещё нет — SQL не накатан (деплой без секрета Supabase).
  if (error.code === "42883" || /rows_set_os_managed/i.test(error.message ?? "")) {
    throw new Error("В Supabase ещё нет этой функции — накатите SQL («Скопировать SQL» выше) и повторите");
  }
  throw new Error(`Supabase не переключил «заказы ведёт ОС»: ${error.message}`);
}

/** Флаг «заказы ведёт ОС» из Supabase; null — функции ещё нет (старый SQL). */
export async function fetchSupabaseOsManaged(workspaceId: string): Promise<boolean | null> {
  const { data, error } = await supabaseRows.rpc("rows_is_os_managed", { p_workspace: workspaceId });
  if (error) return null;
  return typeof data === "boolean" ? data : null;
}

/** Столько живёт замок переноса — как `rowsMigrating()` в firestore.rules. */
const MIGRATION_LOCK_MS = 15 * 60 * 1000;
/** Как часто продлеваем замок, пока идёт копирование. */
const LOCK_REFRESH_MS = 4 * 60 * 1000;
/**
 * Дольше этого без ПОДТВЕРЖДЁННОГО продления — переключать хранилище нельзя.
 * Замок живёт 15 минут, а перенос десятка столов на медленной сети идёт
 * дольше: он отпустил бы чужие сессии, те дописали бы строки в старое
 * хранилище, и переключение похоронило бы эти правки.
 */
const LOCK_MAX_GAP_MS = 12 * 60 * 1000;
/**
 * Предел на весь перенос. Продление замка держит правку закрытой у ВСЕХ, и
 * зависший запрос (сеть отвалилась на половине стола) иначе запирал бы людей
 * бесконечно — раньше их спасало то, что замок протухал сам через 15 минут.
 * По истечении срока замок снимаем, а переключение хранилища запрещаем.
 */
const MIGRATION_MAX_MS = 20 * 60 * 1000;

/**
 * Держит замок переноса живым, пока копируем, и умеет сказать, не было ли
 * дыры. Продлеваем ОБА замка: `rowsMigrationAt` в Firestore и `migrating`
 * в Supabase (`migrating_until` там тоже на 15 минут).
 */
function startMigrationLockKeeper(workspaceId: string, supabaseState: { live: boolean; migrating: boolean } | null) {
  const startedAt = Date.now();
  let lastOkAt = startedAt;
  let expired = false;
  let timer = 0;
  const tick = async () => {
    // Перенос висит дольше разумного — отпускаем людей: пусть лучше правят
    // в прежнем хранилище, чем сидят с запретом, пока не закроют вкладку.
    if (Date.now() - startedAt >= MIGRATION_MAX_MS) {
      expired = true;
      window.clearInterval(timer);
      await setMigrationFlag(workspaceId, false).catch(() => undefined);
      return;
    }
    try {
      await setMigrationFlag(workspaceId, true);
      if (supabaseState) await setSupabaseState(workspaceId, supabaseState.live, supabaseState.migrating);
      lastOkAt = Date.now();
    } catch {
      // Не продлилось — попробуем на следующем тике; затянувшийся провал
      // поймает assertFresh перед самым переключением.
    }
  };
  timer = window.setInterval(() => void tick(), LOCK_REFRESH_MS);
  return {
    stop: () => window.clearInterval(timer),
    assertFresh() {
      if (expired) {
        throw new Error(
          "Перенос идёт дольше 20 минут — похоже, он завис. Правку строк всем вернули, хранилище НЕ переключено, данные на месте. Повторите перенос."
        );
      }
      if (Date.now() - lastOkAt <= LOCK_MAX_GAP_MS) return;
      throw new Error(
        "Перенос затянулся, и запрет на правку мог отпустить чужие вкладки — хранилище НЕ переключено, данные на месте. Повторите перенос."
      );
    },
  };
}

/**
 * Держит замок Supabase равным Firestore: строки там (`rowsBackend:
 * "supabase"`) и перенос не идёт — хранилище обязано быть живым. Нужна, если
 * workspace перенесли ДО появления замка: повторный накат SQL добавил
 * `live = false`, и запись строк встала бы у всех. Зовёт сессия Owner.
 *
 * Решает по документу workspace С СЕРВЕРА, прочитанному ПОСЛЕ ответа
 * Supabase: откат сначала пишет флаг переноса и только потом запирает
 * Supabase, поэтому «неживое» без флага в свежем документе — точно не откат.
 */
export async function reconcileSupabaseLive(workspaceId: string): Promise<boolean> {
  if (!db) return false;
  const { data, error } = await supabaseRows.rpc("rows_whoami", { p_workspace: workspaceId });
  if (error) return false;
  const who = (data ?? {}) as { isOwner?: boolean; workspaceSeeded?: boolean; live?: boolean };
  if (!who.isOwner || !who.workspaceSeeded || who.live !== false) return false;
  const snap = await getDocFromServer(paths.workspace(workspaceId));
  const ws = snap.data() as { rowsBackend?: string; rowsMigrationAt?: RowsMigrationStamp } | undefined;
  if (ws?.rowsBackend !== "supabase") return false;
  const started = migrationStartMillis(ws.rowsMigrationAt);
  if (typeof started === "number" && Date.now() - started < MIGRATION_LOCK_MS) return false;
  await setSupabaseState(workspaceId, true, false);
  return true;
}

/**
 * Флаг «заказы ведёт ОС» в Supabase догоняет Firestore.
 *
 * Их два (документ workspace и `rows_workspaces.os_managed`), и разъехаться
 * они могут штатно: Owner включил переключатель до того, как накатили SQL.
 * Сессия Owner сверяет их при загрузке — молчащий замок хуже отсутствующего.
 */
export async function reconcileSupabaseOsManaged(workspaceId: string, wanted: boolean): Promise<boolean> {
  const current = await fetchSupabaseOsManaged(workspaceId);
  if (current === null || current === wanted) return false;
  await setSupabaseOsManaged(workspaceId, wanted);
  return true;
}

async function assertHealthy(workspaceId: string) {
  const health = await checkRowsHealth(workspaceId);
  if (!health.ok) throw new Error(health.problem ?? "Supabase не готов");
}

export interface MigrateInput {
  workspaceId: string;
  ownerId: string;
  me: string;
  /** Все столы — активные, неактуальные и столы ОС. */
  pages: readonly WorkspacePage[];
  onProgress?: (progress: MigrationProgress) => void;
}

/**
 * Firestore → Supabase. Читает каждую строку Firestore ОДИН раз (это
 * последний большой расход квоты чтений), кладёт в Supabase, сверяет
 * количество и только тогда переключает хранилище.
 */
export async function migrateRowsToSupabase(input: MigrateInput): Promise<MigrationReport> {
  if (!db) throw new Error("Firebase не настроен");
  const { workspaceId } = input;
  const progress = (p: MigrationProgress) => input.onProgress?.(p);

  progress({ phase: "prepare", done: 0, total: 1, label: "Проверяю Supabase" });
  await assertHealthy(workspaceId);
  await setMigrationFlag(workspaceId, true);
  let lock: ReturnType<typeof startMigrationLockKeeper> | null = null;
  try {
    // Пока копируем — хранилище неживое, писать в него может только Owner.
    await setSupabaseState(workspaceId, false, true);
    lock = startMigrationLockKeeper(workspaceId, { live: false, migrating: true });
    progress({ phase: "acl", done: 0, total: 1, label: "Переношу права доступа" });
    // Участники и наблюдатели — свежим чтением с сервера, не из памяти вкладки.
    const [members, observers] = await Promise.all([
      fetchMembersFresh(workspaceId),
      fetchDeskObserverUidsFresh(workspaceId),
    ]);
    const acl = await syncRowAcl({
      workspaceId,
      ownerId: input.ownerId,
      me: input.me,
      realRole: "owner",
      members,
      pages: await fetchPagesFresh(workspaceId),
      observers,
      force: true,
    });
    if (acl.errors.length) throw new Error(`Права доступа не перенеслись: ${acl.errors.slice(0, 3).join("; ")}`);

    // Столы — СВЕЖИМ списком с сервера, а не тем, что лежит в памяти вкладки:
    // неполный список молча стал бы эталоном, и не попавшие в него столы
    // открылись бы у всех пустыми (копия в Firestore к тому моменту замёрзла).
    const pages = await fetchPagesFresh(workspaceId);
    const tables = await listTables(workspaceId, pages);
    const expected = new Map<TableRef, number>();
    let rows = 0;
    for (let i = 0; i < tables.length; i += 1) {
      const table = tables[i];
      progress({ phase: "copy", done: i, total: tables.length, label: `Копирую «${tableLabel(table)}»` });
      const snap = await getDocsFromServer(visibleRowsQuery(workspaceId, table));
      const list = snap.docs
        .map((d) => firestoreDocToRow(d.id, d.data()))
        .filter((row): row is PageRow => row !== null);
      // Supabase приводим РОВНО к Firestore: остатки прошлой попытки убираем.
      await sbDeleteRows(workspaceId, table.page.id, table.tabId);
      await sbPutRows(workspaceId, table.page.id, table.tabId, list);
      expected.set(table, list.length);
      rows += list.length;
    }

    const mismatches: string[] = [];
    let i = 0;
    for (const [table, want] of expected) {
      progress({ phase: "verify", done: i++, total: expected.size, label: `Сверяю «${tableLabel(table)}»` });
      const got = await supabaseCount(workspaceId, table);
      if (got !== want) mismatches.push(`«${tableLabel(table)}»: в Firestore ${want}, в Supabase ${got}`);
    }
    if (mismatches.length) {
      throw new Error(`Строки не сошлись — хранилище НЕ переключено: ${mismatches.slice(0, 5).join("; ")}`);
    }

    progress({ phase: "switch", done: 0, total: 1, label: "Переключаю хранилище" });
    lock.assertFresh();
    await setSupabaseState(workspaceId, true, false);
    // reloadEpoch — перезагрузить все открытые вкладки: старый код на них
    // писал бы строки в Firestore (правила такую запись теперь отклоняют).
    await updateDoc(paths.workspace(workspaceId), {
      rowsBackend: "supabase",
      rowsMigrationAt: null,
      reloadEpoch: increment(1),
    });
    progress({ phase: "done", done: 1, total: 1, label: "Готово" });
    return { tables: tables.length, rows, acl };
  } catch (error) {
    // Строки остаются в Firestore — Supabase снова закрыт для записи.
    await setSupabaseState(workspaceId, false, false).catch(() => undefined);
    await setMigrationFlag(workspaceId, false).catch(() => undefined);
    throw error;
  } finally {
    lock?.stop();
  }
}

/**
 * Supabase → Firestore (откат). Копия в Firestore приводится РОВНО к Supabase:
 * строки пишутся целиком, а строки, удалённые за время жизни в Supabase,
 * удаляются и из Firestore — иначе они воскресли бы. Правила пускают это
 * только Owner (`rowsWritableHere`).
 */
export async function migrateRowsToFirestore(input: Omit<MigrateInput, "me" | "ownerId">): Promise<MigrationReport> {
  if (!db) throw new Error("Firebase не настроен");
  const database = db;
  const { workspaceId } = input;
  const progress = (p: MigrationProgress) => input.onProgress?.(p);

  progress({ phase: "prepare", done: 0, total: 1, label: "Проверяю Supabase" });
  await assertHealthy(workspaceId);
  await setMigrationFlag(workspaceId, true);
  let lock: ReturnType<typeof startMigrationLockKeeper> | null = null;
  try {
    // Supabase замерзает ДО копирования: поздняя правка сессии, которая ещё не
    // узнала о переносе, отказывает громко, а не пропадает в брошенном хранилище.
    await setSupabaseState(workspaceId, false, false);
    // Замок Supabase здесь уже не «перенос», а «закрыто», продлевать нечего —
    // держим только запрет правки строк в Firestore.
    lock = startMigrationLockKeeper(workspaceId, null);
    const tables = await listTables(workspaceId, await fetchPagesFresh(workspaceId));
    const expected = new Map<TableRef, number>();
    let rows = 0;
    const CHUNK = 450;
    for (let i = 0; i < tables.length; i += 1) {
      const table = tables[i];
      progress({ phase: "copy", done: i, total: tables.length, label: `Возвращаю «${tableLabel(table)}»` });
      const list = await sbFetchRows(workspaceId, table.page.id, table.tabId);
      // Прочитали ВСЁ, что есть в Supabase? Выборка идёт страницами, а
      // «максимум строк на запрос» в настройках Supabase можно поставить
      // меньше нашей страницы — тогда длинный стол прочитался бы наполовину,
      // остальное удалилось бы из Firestore как «лишнее», а сверка сошлась бы
      // сама с собой. Сверяем с честным счётчиком ДО единого удаления.
      const total = await supabaseCount(workspaceId, table);
      if (list.length !== total) {
        throw new Error(
          `«${tableLabel(table)}»: Supabase отдал ${list.length} строк из ${total} — перенос остановлен, в Firestore ничего не изменено.`
        );
      }
      const keep = new Set(list.map((row) => row.id));
      // Удаляем только ВИДИМЫЕ строки, которых нет в Supabase: документы без
      // `order` приложение не показывало и туда не переносило — их не трогаем.
      const existing = await getDocsFromServer(visibleRowsQuery(workspaceId, table));
      // Пустой ответ Supabase — это и «строк нет», и «их скрыла политика»
      // (RLS отказа не называет). Стереть из-за этого живую копию Firestore
      // нельзя: сверка потом подтвердила бы ноль нолём.
      if (list.length === 0 && existing.size > 0) {
        const access = await sbPageAccess(workspaceId, table.page.id).catch(() => null);
        throw new Error(
          access?.canRead
            ? `«${tableLabel(table)}»: в Supabase ноль строк, а в Firestore ${existing.size} — перенос остановлен, ничего не удалено.`
            : `«${tableLabel(table)}»: Supabase не отдал строки этого стола (права в копии не доехали) — перенос остановлен, ничего не удалено.`
        );
      }
      type Op = { kind: "set"; ref: ReturnType<typeof paths.row>; data: PageRow } | { kind: "delete"; ref: ReturnType<typeof paths.row> };
      const ops: Op[] = [
        ...list.map(
          (row): Op => ({
            kind: "set",
            ref: table.tabId
              ? paths.subPageRow(workspaceId, table.page.id, table.tabId, row.id)
              : paths.row(workspaceId, table.page.id, row.id),
            data: stripUndefined(row),
          })
        ),
        ...existing.docs.filter((d) => !keep.has(d.id)).map((d): Op => ({ kind: "delete", ref: d.ref })),
      ];
      for (let start = 0; start < ops.length; start += CHUNK) {
        const batch = writeBatch(database);
        for (const op of ops.slice(start, start + CHUNK)) {
          if (op.kind === "set") batch.set(op.ref, op.data);
          else batch.delete(op.ref);
        }
        await batch.commit();
      }
      expected.set(table, list.length);
      rows += list.length;
    }

    const mismatches: string[] = [];
    let i = 0;
    for (const [table, want] of expected) {
      progress({ phase: "verify", done: i++, total: expected.size, label: `Сверяю «${tableLabel(table)}»` });
      const got = (await getCountFromServer(visibleRowsQuery(workspaceId, table))).data().count;
      if (got !== want) mismatches.push(`«${tableLabel(table)}»: в Supabase ${want}, в Firestore ${got}`);
    }
    if (mismatches.length) {
      throw new Error(`Строки не сошлись — хранилище НЕ переключено: ${mismatches.slice(0, 5).join("; ")}`);
    }

    progress({ phase: "switch", done: 0, total: 1, label: "Переключаю хранилище" });
    lock.assertFresh();
    await updateDoc(paths.workspace(workspaceId), {
      rowsBackend: "firestore",
      rowsMigrationAt: null,
      reloadEpoch: increment(1),
    });
    progress({ phase: "done", done: 1, total: 1, label: "Готово" });
    return { tables: tables.length, rows, acl: null };
  } catch (error) {
    // Откат не удался — строки по-прежнему живут в Supabase: открыть его обратно.
    await setSupabaseState(workspaceId, true, false).catch(() => undefined);
    await setMigrationFlag(workspaceId, false).catch(() => undefined);
    throw error;
  } finally {
    lock?.stop();
  }
}

/** Снять зависший флаг переноса (вкладку закрыли посреди копирования). */
export async function clearRowsMigrationFlag(workspaceId: string) {
  await setMigrationFlag(workspaceId, false);
}
