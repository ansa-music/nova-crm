import { doc, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { rearchiveDeskLoad, refreshDeskLoadFromRows } from "@/services/deskLoadService";
import { findMonthTab, isMonthlyDesk } from "@/services/monthTabService";
import { stripUndefined } from "@/services/pageService";
import { periodSettingsOf } from "@/services/periodService";
import { fetchPagesFresh } from "@/services/pageService";
import { assertRowsWritable, usesSupabaseRows } from "@/services/rows/rowsBackend";
import { sbCarryOverRows, type CarryOverResult } from "@/services/rows/supabaseRowStore";
import { fetchSubPageRows, fetchSubPages } from "@/services/subPageService";
import type { SbBackend } from "@/services/sb/sbCollections";
import { carryDefaultIds, classifyCarryCandidates, type CarryGroups } from "@/utils/carryOver";
import { countDeskLoad } from "@/utils/techLoad";
import { previousPeriodKey, periodOfTabId } from "@/utils/periods";
import type { PageRow, StatusOption, SubPage, TechLoadKind, WorkspaceMember, WorkspacePage } from "@/types";

/**
 * Перенос незавершённых заказов в новый период (просьба Nurba 26.09.2026).
 *
 * Строки ПЕРЕЕЗЖАЮТ целиком: в Supabase — `rows_carry_over` (тот же id, все
 * поля; адреса копий чинит база), в Firestore — пачка «записать в новую
 * вкладку + удалить в старой». Старый период после переноса пересчитывается
 * по оставшимся строкам (`rearchiveDeskLoad`) — иначе его архив считал бы
 * перенесённые заказы как «в работе», и в KPI ОС они попадали бы дважды.
 */

export interface CarryCandidates {
  groups: CarryGroups;
  all: PageRow[];
}

const candidateCache = new Map<string, Promise<CarryCandidates>>();

function cacheKey(workspaceId: string, pageId: string, tabId: string) {
  return `${workspaceId}:${pageId}:${tabId}`;
}

export function dropCarryCandidates(workspaceId: string, pageId: string, tabId?: string) {
  for (const key of [...candidateCache.keys()]) {
    if (key.startsWith(`${workspaceId}:${pageId}:`) && (!tabId || key.endsWith(`:${tabId}`))) candidateCache.delete(key);
  }
}

/** Что осталось в прошлой вкладке — раз на стол+вкладку на сессию (сброс после переноса). */
export function listCarryCandidates(input: {
  workspaceId: string;
  page: WorkspacePage;
  fromTab: SubPage;
  statusOptions: readonly StatusOption[];
  kinds: Record<string, TechLoadKind> | undefined;
  force?: boolean;
}): Promise<CarryCandidates> {
  const key = cacheKey(input.workspaceId, input.page.id, input.fromTab.id);
  const hit = candidateCache.get(key);
  if (hit && !input.force) return hit;
  const promise = (async () => {
    const all = await fetchSubPageRows(input.workspaceId, input.page.id, input.fromTab.id);
    return { all, groups: classifyCarryCandidates(all, input.fromTab.columns ?? input.page.columns ?? [], input.statusOptions, input.kinds) };
  })().catch((error) => {
    candidateCache.delete(key);
    throw error;
  });
  candidateCache.set(key, promise);
  return promise;
}

export interface CarryOverInput {
  workspaceId: string;
  page: WorkspacePage;
  fromTab: SubPage;
  toTab: SubPage;
  /** Что переносим. */
  rows: PageRow[];
  /** Все строки старой вкладки — по оставшимся пересчитывается её архив. */
  allFromRows: PageRow[];
  /** Ключ старого периода («2026-09») — под ним лежит архив счётчиков. */
  oldPeriodKey: string;
  responsibleOptions: readonly StatusOption[];
  uid: string;
  /** Где живут счётчики столов (useSbBackend(ws, "deskLoads")); null — неизвестно, переархив пропускается. */
  deskLoadBackend: SbBackend | null;
  /** Строки целевой вкладки, если уже загружены (порядок в Firestore-ветке). */
  toTabRows?: PageRow[];
}

/** Перенос выбранных строк + переархив старого периода. */
export async function carryOverRows(input: CarryOverInput): Promise<CarryOverResult> {
  const { workspaceId, page, fromTab, toTab } = input;
  if (input.rows.length === 0) return { moved: [], skipped: [] };
  assertRowsWritable(workspaceId);
  let result: CarryOverResult;
  if (usesSupabaseRows(workspaceId)) {
    result = await sbCarryOverRows(workspaceId, page.id, fromTab.id, toTab.id, input.rows);
  } else {
    result = await carryOverFirestore(input);
  }
  const movedSet = new Set(result.moved);
  // Биржевой заказ помнит адрес своей строки — best-effort, правило пускает
  // назначенного технаря менять только вкладку/строку у взятого заказа.
  await Promise.all(
    input.rows
      .filter((r) => movedSet.has(r.id) && r.orderId)
      .map((r) =>
        db
          ? updateDoc(paths.order(workspaceId, r.orderId as string), { takenSubPageId: toTab.id, takenRowId: r.id, updatedAt: Date.now() }).catch(
              () => undefined
            )
          : Promise.resolve()
      )
  );
  dropCarryCandidates(workspaceId, page.id);
  if (movedSet.size > 0 && input.deskLoadBackend) {
    const remaining = input.allFromRows.filter((r) => !movedSet.has(r.id));
    const counts = countDeskLoad(fromTab.columns ?? page.columns ?? [], remaining, [...input.responsibleOptions], input.oldPeriodKey, periodSettingsOf(workspaceId));
    await rearchiveDeskLoad(
      {
        workspaceId,
        pageId: page.id,
        monthKey: input.oldPeriodKey,
        subPageId: fromTab.id,
        counts,
        responsibleUserId: page.responsibleUserId ?? "",
        uid: input.uid,
      },
      input.deskLoadBackend
    ).catch((error) => console.warn("Переархив прошлого периода не удался:", error));
  }
  return result;
}

const FS_CHUNK = 250;

/** Firestore: та же строка под новой вкладкой, старая удаляется — пачками по 250 пар. */
async function carryOverFirestore(input: CarryOverInput): Promise<CarryOverResult> {
  if (!db) throw new Error("Firebase не настроен");
  const { workspaceId, page, fromTab, toTab } = input;
  const existing = new Set((input.toTabRows ?? (await fetchSubPageRows(workspaceId, page.id, toTab.id))).map((r) => r.id));
  let nextOrder = (input.toTabRows ?? []).reduce((max, r) => Math.max(max, r.order ?? 0), -1) + 1;
  const moved: string[] = [];
  const skipped: string[] = [];
  const now = Date.now();
  const todo = input.rows.filter((r) => {
    if (existing.has(r.id)) {
      skipped.push(r.id);
      return false;
    }
    return true;
  });
  for (let i = 0; i < todo.length; i += FS_CHUNK) {
    const batch = writeBatch(db);
    const slice = todo.slice(i, i + FS_CHUNK);
    for (const row of slice) {
      // id, deskPageId, tabId — не поля документа.
      const { id, deskPageId: _desk, tabId: _tab, ...data } = row;
      void _desk;
      void _tab;
      batch.set(
        doc(paths.subPageRows(workspaceId, page.id, toTab.id), id),
        stripUndefined({ ...data, pageId: toTab.id, order: nextOrder++, carriedFrom: fromTab.id, carriedAt: now, updatedAt: now })
      );
      batch.delete(paths.subPageRow(workspaceId, page.id, fromTab.id, id));
    }
    await batch.commit();
    moved.push(...slice.map((r) => r.id));
  }
  return { moved, skipped };
}

export interface CarryAllReport {
  desks: number;
  moved: number;
  skipped: number;
  noTab: number;
  errors: string[];
}

/**
 * Owner: перенести незавершённые у ВСЕХ столов технарей — из вкладки
 * прошлого периода в вкладку текущего (обе должны уже существовать).
 */
export async function carryOverAll(input: {
  workspaceId: string;
  members: readonly WorkspaceMember[];
  currentKey: string;
  statusOptions: readonly StatusOption[];
  kinds: Record<string, TechLoadKind> | undefined;
  responsibleOptions: readonly StatusOption[];
  uid: string;
  deskLoadBackend: SbBackend | null;
  pageIds?: string[];
  onProgress?: (done: number, total: number) => void;
}): Promise<CarryAllReport> {
  const settings = periodSettingsOf(input.workspaceId);
  const prevKey = previousPeriodKey(input.currentKey, settings);
  const pages = await fetchPagesFresh(input.workspaceId);
  const only = input.pageIds ? new Set(input.pageIds) : null;
  const desks = pages.filter(
    (p) => !p.osDesk && !p.inactive && !p.isDashboard && p.responsibleUserId && isMonthlyDesk(p, [...input.members]) && (!only || only.has(p.id))
  );
  const report: CarryAllReport = { desks: desks.length, moved: 0, skipped: 0, noTab: 0, errors: [] };
  let cursor = 0;
  let done = 0;
  const worker = async () => {
    while (cursor < desks.length) {
      const page = desks[cursor++];
      try {
        const subs = await fetchSubPages(input.workspaceId, page.id);
        const toTab = findMonthTab(subs, input.currentKey);
        const fromTab = findMonthTab(subs, prevKey);
        if (!toTab || !fromTab || toTab.isArchived || fromTab.id === toTab.id) {
          report.noTab += 1;
        } else {
          const candidates = await listCarryCandidates({ workspaceId: input.workspaceId, page, fromTab, statusOptions: input.statusOptions, kinds: input.kinds, force: true });
          const ids = carryDefaultIds(candidates.groups);
          const rows = candidates.all.filter((r) => ids.has(r.id));
          if (rows.length > 0) {
            const result = await carryOverRows({
              workspaceId: input.workspaceId,
              page,
              fromTab,
              toTab,
              rows,
              allFromRows: candidates.all,
              oldPeriodKey: periodOfTabId(fromTab.id) ?? fromTab.monthKey ?? prevKey,
              responsibleOptions: input.responsibleOptions,
              uid: input.uid,
              deskLoadBackend: input.deskLoadBackend,
            });
            report.moved += result.moved.length;
            report.skipped += result.skipped.length;
            if (result.moved.length > 0 && input.deskLoadBackend) {
              await refreshDeskLoadFromRows(page, input.currentKey, input.uid, undefined, [...input.responsibleOptions], input.deskLoadBackend).catch(() => false);
            }
          }
        }
      } catch (error) {
        report.errors.push(`${page.name}: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        done += 1;
        input.onProgress?.(done, desks.length);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, desks.length) }, worker));
  return report;
}
