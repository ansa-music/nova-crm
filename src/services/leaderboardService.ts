import { documentId, getDocs, onSnapshot, query, setDoc, where } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { getDocsResumable, paths } from "@/firebase/firestore";
import { currentMonthSubPageId, isMonthlyDesk } from "@/services/monthTabService";
import { sbBackendOf } from "@/services/sb/sbCollections";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { doneSumFromStatusSums } from "@/utils/overviewStats";
import type { DeskLoad, LeaderboardEntry, StatusOption, Workspace, WorkspaceMember, WorkspacePage } from "@/types";

export type LeaderboardEntryDraft = Omit<LeaderboardEntry, "updatedAt">;

/**
 * Called by the page's own responsible person (or Owner) whenever their
 * dashboard recomputes their totals — keeps their own leaderboard entry
 * fresh as a side effect of them simply looking at their own numbers. There
 * is no server-side job keeping this up to date: if someone never opens
 * their dashboard, their entry goes stale. Acceptable trade-off for a
 * client-only app with no backend functions.
 */
export async function updateLeaderboardEntry(workspaceId: string, entry: LeaderboardEntryDraft) {
  if (!db) return;
  await setDoc(paths.leaderboardEntry(workspaceId, entry.pageId), { ...entry, updatedAt: Date.now() });
}

/**
 * Что эта вкладка браузера уже записала в leaderboard:
 * `${workspaceId}/${pageId}` → подпись чисел. На модуле, а не в
 * компоненте: раньше КАЖДЫЙ пересчёт «Дашборда» (а их несколько за один
 * заход — строки столов приходят партиями) переписывал запись КАЖДОГО
 * стола, у Owner — всех столов, даже если ни одна цифра не сдвинулась.
 * На Spark (20 000 записей в сутки) это тысячи пустых записей в день.
 *
 * Память живёт ограниченно (MEMORY_TRUST_MS), как у deskLoad: вкладку
 * Owner теперь не перезагружают днями, а запись мог с тех пор переписать
 * сам технарь. Цифры вернулись к тем, что писала эта вкладка, — и вечная
 * память навсегда оставила бы в базе чужое промежуточное значение.
 */
const lastPublished = new Map<string, { signature: string; at: number }>();
const MEMORY_TRUST_MS = 90 * 60_000;
/**
 * Та же память — в localStorage: на модуле она жила до перезагрузки, и
 * каждый F5 или автообновление после деплоя у Owner переписывали записи ВСЕХ
 * столов (замер на стенде: +20 записей на каждую перезагрузку дашборда), а
 * каждая такая запись ещё и расходилась чтением по всем открытым «Столам».
 */
const STORAGE_KEY = "nova:leaderboard-published";
let restored = false;
function restoreMemory() {
  if (restored) return;
  restored = true;
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, { signature: string; at: number }>;
    const cutoff = Date.now() - MEMORY_TRUST_MS;
    for (const [key, value] of Object.entries(raw)) {
      if (value && typeof value.signature === "string" && Number(value.at) > cutoff && !lastPublished.has(key)) {
        lastPublished.set(key, { signature: value.signature, at: Number(value.at) });
      }
    }
  } catch {
    /* нет хранилища — память только этой вкладки */
  }
}
function persistMemory() {
  try {
    const cutoff = Date.now() - MEMORY_TRUST_MS;
    const out: Record<string, { signature: string; at: number }> = {};
    for (const [key, value] of lastPublished) if (value.at > cutoff) out[key] = value;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
  } catch {
    /* см. restoreMemory */
  }
}

function entrySignature(entry: LeaderboardEntryDraft): string {
  // responsibleUserId — сверх чисел: стол передали другому, цифры те же, а
  // запись должна назвать нового ответственного.
  return JSON.stringify([
    entry.doneTotal,
    entry.grandTotal,
    entry.percent,
    entry.openCount ?? null,
    entry.doneCount ?? null,
    entry.pageName,
    entry.responsibleUserId,
  ]);
}

/**
 * Пишет только те записи, чьи числа отличаются от уже записанных этой
 * вкладкой. Best-effort: упавшая запись забывается, чтобы следующий
 * пересчёт попробовал её снова.
 */
export async function publishLeaderboardEntries(workspaceId: string, entries: LeaderboardEntryDraft[]) {
  restoreMemory();
  const state = useWorkspaceStore.getState();
  const workspace = state.workspaces.find((w) => w.id === workspaceId);
  // Счётчики в Supabase — обложки столов технарей считаются из них
  // (leaderboardFromDeskLoads), и запись таких столов в Firestore не нужна:
  // каждая расходилась чтением по всем открытым «Столам». Пишем только столы,
  // у которых счётчиков нет (не столы технарей), — их обложкам больше неоткуда
  // взять цифры.
  const derived = state.activeWorkspaceId === workspaceId && leaderboardDerived(workspace);
  const pagesById = derived ? new Map(state.pages.map((p) => [p.id, p])) : null;
  const written = pagesById
    ? entries.filter((entry) => !derivableDesk(pagesById.get(entry.pageId), state.members))
    : entries;
  await Promise.all(
    written.map(async (entry) => {
      const key = `${workspaceId}/${entry.pageId}`;
      const signature = entrySignature(entry);
      const previous = lastPublished.get(key);
      if (previous?.signature === signature && Date.now() - previous.at < MEMORY_TRUST_MS) return;
      // Отмечаем до ответа сервера, чтобы второй пересчёт, пока эта запись
      // в пути, не отправил её же ещё раз.
      const mark = { signature, at: Date.now() };
      lastPublished.set(key, mark);
      try {
        await updateLeaderboardEntry(workspaceId, entry);
        persistMemory();
      } catch {
        if (lastPublished.get(key) !== mark) return;
        if (previous === undefined) lastPublished.delete(key);
        else lastPublished.set(key, previous);
      }
    })
  );
}

export async function fetchLeaderboard(workspaceId: string): Promise<LeaderboardEntry[]> {
  if (!db) return [];
  const snap = await getDocs(paths.leaderboard(workspaceId));
  return snap.docs.map((d) => d.data() as LeaderboardEntry);
}

// ---------------------------------------------------------------------
// Режим «счётчики в Supabase»: leaderboard выводится из desk_loads.
// ---------------------------------------------------------------------

/**
 * Обложки «Столов» берут цифры из счётчиков столов, а не из коллекции
 * leaderboard, когда счётчики живут в Supabase (ключ `deskLoads` в
 * sbCollections, с памятью «таблицы нет»). Поля записи — «Общий», «Готово»
 * и процент — те же, что в счётчиках (`grandTotal`, `statusSums` по сырому
 * статусу; «Готово» — по названию статуса, как на дашборде). Режим Firestore —
 * как было: пишет дашборд, читают «Столы».
 */
export function leaderboardDerived(workspace: Pick<Workspace, "rowsBackend" | "sbCollections"> | null | undefined): boolean {
  return Boolean(workspace) && sbBackendOf(workspace, "deskLoads") === "supabase";
}

/**
 * Стол, чьи цифры есть в счётчиках: стол технаря (месячные вкладки, их
 * публикует useDeskLoadPublisher и пересчёт Owner). Неизвестный стол — нет:
 * лучше лишняя запись, чем пропавшая обложка.
 */
export function derivableDesk(page: WorkspacePage | undefined, members: WorkspaceMember[]): boolean {
  return Boolean(page) && isMonthlyDesk(page as WorkspacePage, members);
}

/**
 * Записи leaderboard из счётчиков — только текущего месяца и только той
 * вкладки, что сейчас месячная у стола (как «Технари»: чужая вкладка — не
 * этот месяц). Стола без таких счётчиков в ответе нет: «не знаем», а не 0 %.
 */
export function leaderboardFromDeskLoads(
  loads: readonly DeskLoad[],
  pages: readonly WorkspacePage[],
  statusOptions: StatusOption[],
  monthKey: string
): LeaderboardEntry[] {
  const loadByPage = new Map(loads.map((load) => [load.pageId, load]));
  const out: LeaderboardEntry[] = [];
  for (const page of pages) {
    const load = loadByPage.get(page.id);
    const subPageId = currentMonthSubPageId(page, monthKey);
    if (!load || !subPageId || load.monthKey !== monthKey || load.subPageId !== subPageId) continue;
    const grandTotal = Number(load.grandTotal ?? 0) || 0;
    const doneTotal = doneSumFromStatusSums(load.statusSums, statusOptions);
    const doneCount = doneSumFromStatusSums(load.statusCounts, statusOptions);
    out.push({
      pageId: page.id,
      pageName: page.name,
      responsibleUserId: load.responsibleUserId || page.responsibleUserId || "",
      doneTotal,
      grandTotal,
      percent: grandTotal > 0 ? Math.round((doneTotal / grandTotal) * 100) : 0,
      openCount: Math.max(0, Number(load.total ?? 0) - doneCount),
      doneCount,
      updatedAt: load.updatedAt,
    });
  }
  return out;
}

/**
 * Старые записи leaderboard для столов, которых нет в счётчиках, — РАЗОВО и
 * только этих столов (`documentId in`, по 30), без живой подписки: их пишут
 * редко (стол не технаря), а подписка на всю коллекцию стоила чтение на
 * каждую запись любого стола. Кэш на модуле — 15 минут на workspace и набор.
 */
const LEGACY_TTL_MS = 15 * 60_000;
const legacyCache = new Map<string, { at: number; value: Promise<LeaderboardEntry[]> }>();

export function fetchLeaderboardEntries(workspaceId: string, pageIds: readonly string[]): Promise<LeaderboardEntry[]> {
  if (!db || pageIds.length === 0) return Promise.resolve([]);
  const ids = [...new Set(pageIds)].sort();
  const key = `${workspaceId}|${ids.join(",")}`;
  const cached = legacyCache.get(key);
  if (cached && Date.now() - cached.at < LEGACY_TTL_MS) return cached.value;
  const value = (async () => {
    const out: LeaderboardEntry[] = [];
    for (let i = 0; i < ids.length; i += 30) {
      const snap = await getDocsResumable(query(paths.leaderboard(workspaceId), where(documentId(), "in", ids.slice(i, i + 30))));
      for (const d of snap.docs) out.push({ ...(d.data() as LeaderboardEntry), pageId: d.id });
    }
    return out;
  })();
  legacyCache.set(key, { at: Date.now(), value });
  // Отказ не кэшируем: следующий заход «Столов» спросит снова.
  value.catch(() => {
    if (legacyCache.get(key)?.value === value) legacyCache.delete(key);
  });
  return value;
}

export function subscribeLeaderboard(
  workspaceId: string,
  cb: (rows: LeaderboardEntry[]) => void
) {
  if (!db) {
    cb([]);
    return () => {};
  }
  return onSnapshot(paths.leaderboard(workspaceId), (snap) => {
    cb(snap.docs.map((d) => d.data() as LeaderboardEntry));
  });
}
