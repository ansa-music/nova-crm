import { runTransaction, setDoc } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { stripUndefined } from "@/services/pageService";
import { fetchSubPages, monthTabNameForKey } from "@/services/subPageService";
import { ymdInTimeZone } from "@/utils/date";
import { worksAsTechnician } from "@/utils/peopleDesks";
import { type SubPage, type WorkspaceMember, type WorkspacePage } from "@/types";

/**
 * Month autopilot. Every Технарь desk works in one tab per calendar month
 * (Asia/Almaty): on the first visit of a new month the tab is created — or
 * an existing hand-made one like «Сентябрь 2026» is adopted — and becomes
 * the tab the desk opens on. Orders in older tabs stay where they are; only
 * the current month's tab counts on the «Технари» screen.
 *
 * Runs client-side (no backend): the Owner's session covers every Технарь
 * desk, a Технарь's own session covers their own desk (useMonthTabAutopilot).
 */

/** "YYYY-MM" of `now` in Asia/Almaty. */
export function currentMonthKey(now: number = Date.now()): string {
  return ymdInTimeZone(now).slice(0, 7);
}

export function nextMonthKey(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
}

export function previousMonthKey(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
}

/**
 * Deterministic doc id — two sessions ensuring the same month at once end up
 * on the same document instead of two «Сентябрь 2026» tabs.
 */
export function monthTabId(monthKey: string): string {
  return `month-${monthKey}`;
}

/**
 * Столы, которые ведёт автопилот: за столом Технарь или Owner
 * (`worksAsTechnician`), либо стол помечен «Стол технаря» руками.
 */
export function isMonthlyDesk(page: WorkspacePage, members: WorkspaceMember[]): boolean {
  if (!page.responsibleUserId || page.isDashboard) return false;
  if (page.technicianDesk) return true;
  return members.some((m) => m.uid === page.responsibleUserId && worksAsTechnician(m));
}

/** The subpage holding the current month's orders, or null if the autopilot hasn't reached this desk this month. */
export function currentMonthSubPageId(page: WorkspacePage, monthKey: string): string | null {
  return page.autoMonthKey === monthKey && page.autoMonthSubPageId ? page.autoMonthSubPageId : null;
}

const MONTH_TOKEN_PATTERNS: RegExp[] = [
  /^январ/,
  /^феврал/,
  /^март/,
  /^апрел/,
  /^ма[йя]$/,
  /^июн/,
  /^июл/,
  /^август/,
  /^сентябр/,
  /^октябр/,
  /^ноябр/,
  /^декабр/,
];

type NameMatch = "with-year" | "without-year" | null;

/**
 * Whether a hand-named tab means this month: «Сентябрь 2026», «сентябрь»,
 * «Сентябрь 26», «Заказы сентябрь». A name naming another month or another
 * year never matches; a name without a year only matches a tab created this
 * month or the month before (someone preparing «Сентябрь» on Aug 31), so
 * last year's «Сентябрь» is never adopted.
 */
function matchMonthName(sub: SubPage, monthKey: string): NameMatch {
  const [year, month] = monthKey.split("-").map(Number);
  const tokens = sub.name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const monthsNamed = new Set<number>();
  for (const token of tokens) {
    MONTH_TOKEN_PATTERNS.forEach((pattern, index) => {
      if (pattern.test(token)) monthsNamed.add(index);
    });
  }
  if (monthsNamed.size !== 1 || !monthsNamed.has(month - 1)) return null;

  const fullYear = tokens.find((t) => /^\d{4}$/.test(t));
  if (fullYear) return Number(fullYear) === year ? "with-year" : null;
  const shortYear = tokens.find((t) => /^\d{2}$/.test(t));
  if (shortYear) return Number(shortYear) === year % 100 ? "with-year" : null;

  const createdAt = createdAtMillis(sub.createdAt);
  const createdMonth = createdAt ? currentMonthKey(createdAt) : "";
  return createdMonth === monthKey || createdMonth === previousMonthKey(monthKey) ? "without-year" : null;
}

/** Plain ms, or null when unknown — never "now", or a dateless legacy tab would look freshly made. */
function createdAtMillis(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  const ts = value as { toMillis?: () => number } | null;
  if (ts && typeof ts.toMillis === "function") return ts.toMillis();
  return null;
}

function isOrdinaryTab(sub: SubPage): boolean {
  return !sub.personalOwnerUid;
}

/** Existing tab for this month, most trustworthy signal first. */
export function findMonthTab(subPages: SubPage[], monthKey: string): SubPage | null {
  const ordinary = subPages.filter(isOrdinaryTab);
  const byId = ordinary.find((s) => s.id === monthTabId(monthKey));
  if (byId) return byId;
  const byKey = ordinary.find((s) => s.monthKey === monthKey && !s.isArchived);
  if (byKey) return byKey;

  const newestFirst = ordinary
    .filter((s) => !s.isArchived)
    .sort((a, b) => (createdAtMillis(b.createdAt) ?? 0) - (createdAtMillis(a.createdAt) ?? 0));
  return (
    newestFirst.find((s) => matchMonthName(s, monthKey) === "with-year") ??
    newestFirst.find((s) => matchMonthName(s, monthKey) === "without-year") ??
    null
  );
}

/** Columns for a new month: the tab the desk opens on now, else its last tab, else «Основная». */
function columnSource(page: WorkspacePage, subPages: SubPage[]): SubPage | null {
  const visible = subPages
    .filter((s) => isOrdinaryTab(s) && !s.isArchived)
    .sort((a, b) => a.order - b.order);
  const def = page.defaultSubPageId ? visible.find((s) => s.id === page.defaultSubPageId) : undefined;
  if (def) return def;
  if (page.hideMainTab) return visible[visible.length - 1] ?? null;
  return null;
}

async function createMonthTabOnce(page: WorkspacePage, subPages: SubPage[], monthKey: string, uid: string): Promise<SubPage> {
  if (!db) throw new Error("Firebase не настроен");
  const firestore = db;
  const id = monthTabId(monthKey);
  const source = columnSource(page, subPages);
  const now = Date.now();
  const tab: SubPage = {
    id,
    pageId: page.id,
    workspaceId: page.workspaceId,
    name: monthTabNameForKey(monthKey),
    color: source?.color ?? page.color,
    icon: source?.icon ?? page.icon,
    order: subPages.reduce((max, s) => Math.max(max, s.order ?? 0), -1) + 1,
    isArchived: false,
    monthKey,
    columns: source?.columns ?? page.columns,
    createdAt: now,
    updatedAt: now,
    createdBy: uid,
  };
  const ref = paths.subPage(page.workspaceId, page.id, id);
  return runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists()) return { ...(snap.data() as SubPage), id };
    tx.set(ref, stripUndefined(tab));
    return tab;
  });
}

/** Records the month on the desk and makes its tab the default — one page-doc write. */
export async function markMonthTab(workspaceId: string, pageId: string, subPageId: string, monthKey: string) {
  if (!db) return;
  await setDoc(
    paths.page(workspaceId, pageId),
    { defaultSubPageId: subPageId, autoMonthKey: monthKey, autoMonthSubPageId: subPageId, updatedAt: Date.now() },
    { merge: true }
  );
}

/** Finds or creates this month's tab on a desk and makes it the default. Returns the tab id. */
export async function ensureMonthTab(page: WorkspacePage, monthKey: string, uid: string): Promise<string> {
  const subPages = await fetchSubPages(page.workspaceId, page.id);
  const tab = findMonthTab(subPages, monthKey) ?? (await createMonthTabOnce(page, subPages, monthKey, uid));
  await markMonthTab(page.workspaceId, page.id, tab.id, monthKey);
  return tab.id;
}
