import {
  getCountFromServer,
  getDocsFromServer,
  increment,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { DESK_ROWS_TABLE, supabaseRows } from "@/lib/supabaseRows";
import { stripUndefined } from "@/services/pageService";
import { fetchDeskObservers } from "@/services/deskObserverService";
import { syncRowAcl, type AclSyncReport } from "@/services/rows/rowAclService";
import { sbDeleteRows, sbFetchRows, sbPutRows } from "@/services/rows/supabaseRowStore";
import type { PageRow, WorkspaceMember, WorkspacePage } from "@/types";

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
  const who = (data ?? {}) as { uid?: string | null; role?: string | null; isOwner?: boolean; workspaceSeeded?: boolean };
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

async function assertHealthy(workspaceId: string) {
  const health = await checkRowsHealth(workspaceId);
  if (!health.ok) throw new Error(health.problem ?? "Supabase не готов");
}

export interface MigrateInput {
  workspaceId: string;
  ownerId: string;
  me: string;
  members: readonly WorkspaceMember[];
  rosterComplete: boolean;
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
  try {
    progress({ phase: "acl", done: 0, total: 1, label: "Переношу права доступа" });
    const observers = (await fetchDeskObservers(workspaceId)).map((o) => o.uid);
    const acl = await syncRowAcl({
      workspaceId,
      ownerId: input.ownerId,
      me: input.me,
      realRole: "owner",
      members: input.members,
      rosterComplete: input.rosterComplete,
      pages: input.pages,
      observers,
      force: true,
    });
    if (acl.errors.length) throw new Error(`Права доступа не перенеслись: ${acl.errors.slice(0, 3).join("; ")}`);

    const tables = await listTables(workspaceId, input.pages);
    const expected = new Map<TableRef, number>();
    let rows = 0;
    for (let i = 0; i < tables.length; i += 1) {
      const table = tables[i];
      progress({ phase: "copy", done: i, total: tables.length, label: `Копирую «${tableLabel(table)}»` });
      const snap = await getDocsFromServer(firestoreRowsRef(workspaceId, table));
      const list = snap.docs.map((d) => ({ ...(d.data() as PageRow), id: d.id }));
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
    await setMigrationFlag(workspaceId, false).catch(() => undefined);
    throw error;
  }
}

/**
 * Supabase → Firestore (откат). Копия в Firestore приводится РОВНО к Supabase:
 * строки пишутся целиком, а строки, удалённые за время жизни в Supabase,
 * удаляются и из Firestore — иначе они воскресли бы. Правила пускают это
 * только Owner (`rowsWritableHere`).
 */
export async function migrateRowsToFirestore(input: Omit<MigrateInput, "members" | "rosterComplete" | "me" | "ownerId">): Promise<MigrationReport> {
  if (!db) throw new Error("Firebase не настроен");
  const database = db;
  const { workspaceId } = input;
  const progress = (p: MigrationProgress) => input.onProgress?.(p);

  progress({ phase: "prepare", done: 0, total: 1, label: "Проверяю Supabase" });
  await assertHealthy(workspaceId);
  await setMigrationFlag(workspaceId, true);
  try {
    const tables = await listTables(workspaceId, input.pages);
    const expected = new Map<TableRef, number>();
    let rows = 0;
    const CHUNK = 450;
    for (let i = 0; i < tables.length; i += 1) {
      const table = tables[i];
      progress({ phase: "copy", done: i, total: tables.length, label: `Возвращаю «${tableLabel(table)}»` });
      const list = await sbFetchRows(workspaceId, table.page.id, table.tabId);
      const keep = new Set(list.map((row) => row.id));
      const existing = await getDocsFromServer(firestoreRowsRef(workspaceId, table));
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
      const got = (await getCountFromServer(firestoreRowsRef(workspaceId, table))).data().count;
      if (got !== want) mismatches.push(`«${tableLabel(table)}»: в Supabase ${want}, в Firestore ${got}`);
    }
    if (mismatches.length) {
      throw new Error(`Строки не сошлись — хранилище НЕ переключено: ${mismatches.slice(0, 5).join("; ")}`);
    }

    progress({ phase: "switch", done: 0, total: 1, label: "Переключаю хранилище" });
    await updateDoc(paths.workspace(workspaceId), {
      rowsBackend: "firestore",
      rowsMigrationAt: null,
      reloadEpoch: increment(1),
    });
    progress({ phase: "done", done: 1, total: 1, label: "Готово" });
    return { tables: tables.length, rows, acl: null };
  } catch (error) {
    await setMigrationFlag(workspaceId, false).catch(() => undefined);
    throw error;
  }
}

/** Снять зависший флаг переноса (вкладку закрыли посреди копирования). */
export async function clearRowsMigrationFlag(workspaceId: string) {
  await setMigrationFlag(workspaceId, false);
}
