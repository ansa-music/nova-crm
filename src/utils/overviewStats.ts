import { isDoneStatusLabel } from "@/utils/columnOptions";
import {
  addTechLoad,
  EMPTY_TECH_LOAD,
  NO_STATUS_KEY,
  summarizeDeskLoad,
  type TechLoadSummary,
} from "@/utils/techLoad";
import {
  memberHasRole,
  type DeskLoad,
  type DeskLoadArchive,
  type StatusOption,
  type TechLoadKind,
  type TechRating,
  type WorkspaceMember,
  type WorkspacePage,
} from "@/types";

/**
 * «Общий дашборд» numbers. Everything here comes from the aggregates every
 * member may read — DeskLoad (this month's counts and sums per desk),
 * DeskLoadArchive (finished months) and ratings — never from rows, so a
 * Тимлид, an ОС or a Viewer sees the same dashboard as the Owner.
 */

export interface OverviewTechnician {
  member: WorkspaceMember;
  desks: WorkspacePage[];
  /** Some desk of theirs has counts for this month's tab. */
  counted: boolean;
  summary: TechLoadSummary;
  grandTotal: number;
  /** «Готово» money — statuses whose label reads as done, like the table's «Готово» total. */
  doneTotal: number;
  busy: boolean;
  ratingAvg: number | null;
  ratingCount: number;
  updatedAt: number;
}

export interface OverviewDay {
  day: number;
  count: number;
  sum: number;
}

export interface OverviewOsShare {
  osValue: string;
  label: string;
  color: string | null;
  count: number;
}

export interface OverviewData {
  technicians: OverviewTechnician[];
  totals: {
    orders: number;
    grandTotal: number;
    doneTotal: number;
    summary: TechLoadSummary;
    ratingAvg: number | null;
    ratingCount: number;
    techs: number;
    freeTechs: number;
    busyTechs: number;
    avgCheck: number | null;
    today: { orders: number; sum: number };
    week: { orders: number; sum: number };
    updatedAt: number;
  };
  statusCounts: Record<string, number>;
  statusSums: Record<string, number>;
  days: OverviewDay[];
  os: OverviewOsShare[];
}

/** Технари (main or add-on role) plus anyone whose desk is marked «Стол технаря», with the desks that count for them. */
export function technicianDesks(
  members: WorkspaceMember[],
  pages: WorkspacePage[]
): { member: WorkspaceMember; desks: WorkspacePage[] }[] {
  const flaggedOwners = new Set(pages.filter((p) => p.technicianDesk && p.responsibleUserId).map((p) => p.responsibleUserId));
  return members
    .filter((m) => m.status === "active" && (memberHasRole(m, "manager") || flaggedOwners.has(m.uid)))
    .map((member) => ({
      member,
      desks: pages
        .filter(
          (p) =>
            p.responsibleUserId === member.uid &&
            !p.isDashboard &&
            (memberHasRole(member, "manager") || Boolean(p.technicianDesk))
        )
        .sort((a, b) => a.order - b.order),
    }));
}

function findOption(raw: string, statusOptions: StatusOption[]) {
  const lower = raw.toLowerCase();
  return statusOptions.find((o) => o.value === raw) ?? statusOptions.find((o) => o.label.toLowerCase() === lower);
}

/** «Готово» money out of per-status sums, judged by the status label the way the table's totals bar does. */
export function doneSumFromStatusSums(statusSums: Record<string, number> | undefined, statusOptions: StatusOption[]): number {
  let done = 0;
  for (const [raw, sum] of Object.entries(statusSums ?? {})) {
    if (raw === NO_STATUS_KEY || !sum) continue;
    const option = findOption(raw, statusOptions);
    if (isDoneStatusLabel(option?.label ?? raw) || (option?.value ?? raw) === "done") done += sum;
  }
  return done;
}

function addRecord(into: Record<string, number>, from: Record<string, number> | undefined) {
  for (const [key, n] of Object.entries(from ?? {})) into[key] = (into[key] ?? 0) + n;
}

export function buildOverview(input: {
  members: WorkspaceMember[];
  pages: WorkspacePage[];
  loads: DeskLoad[];
  ratings: TechRating[];
  monthKey: string;
  statusOptions: StatusOption[];
  kinds: Record<string, TechLoadKind> | undefined;
  responsibleOptions: StatusOption[];
  /** This month's tab id of a desk, or null (monthTabService.currentMonthSubPageId). */
  currentTabOf: (desk: WorkspacePage) => string | null;
  /** Day of the month today (Asia/Almaty) and the month's length. */
  today: number;
  daysInMonth: number;
}): OverviewData {
  const { loads, ratings, monthKey, statusOptions, kinds } = input;
  const loadByPage = new Map(loads.map((l) => [l.pageId, l]));
  const statusCounts: Record<string, number> = {};
  const statusSums: Record<string, number> = {};
  const dayCounts: Record<string, number> = {};
  const daySums: Record<string, number> = {};
  const osCounts: Record<string, number> = {};
  let updatedAt = 0;

  const technicians: OverviewTechnician[] = technicianDesks(input.members, input.pages).map(({ member, desks }) => {
    let summary = EMPTY_TECH_LOAD;
    let grandTotal = 0;
    let doneTotal = 0;
    let counted = false;
    let techUpdatedAt = 0;
    for (const desk of desks) {
      const load = loadByPage.get(desk.id);
      const tab = input.currentTabOf(desk);
      if (!load || !tab || load.monthKey !== monthKey || load.subPageId !== tab) continue;
      counted = true;
      summary = addTechLoad(summary, summarizeDeskLoad(load, statusOptions, kinds));
      grandTotal += load.grandTotal ?? 0;
      doneTotal += doneSumFromStatusSums(load.statusSums, statusOptions);
      addRecord(statusCounts, load.statusCounts);
      addRecord(statusSums, load.statusSums);
      addRecord(dayCounts, load.dayCounts);
      addRecord(daySums, load.daySums);
      addRecord(osCounts, load.osCounts);
      techUpdatedAt = Math.max(techUpdatedAt, load.updatedAt ?? 0);
    }
    updatedAt = Math.max(updatedAt, techUpdatedAt);
    const mine = ratings.filter((r) => r.technicianUid === member.uid);
    return {
      member,
      desks,
      counted,
      summary,
      grandTotal,
      doneTotal,
      busy: summary.busy > 0,
      ratingAvg: mine.length ? mine.reduce((n, r) => n + r.stars, 0) / mine.length : null,
      ratingCount: mine.length,
      updatedAt: techUpdatedAt,
    };
  });

  const summary = technicians.reduce((acc, t) => addTechLoad(acc, t.summary), EMPTY_TECH_LOAD);
  const grandTotal = technicians.reduce((n, t) => n + t.grandTotal, 0);
  const doneTotal = technicians.reduce((n, t) => n + t.doneTotal, 0);
  const techUids = new Set(technicians.map((t) => t.member.uid));
  const techRatings = ratings.filter((r) => techUids.has(r.technicianUid));
  const withDesk = technicians.filter((t) => t.desks.length > 0);

  const days: OverviewDay[] = Array.from({ length: input.daysInMonth }, (_, i) => {
    const key = String(i + 1).padStart(2, "0");
    return { day: i + 1, count: dayCounts[key] ?? 0, sum: daySums[key] ?? 0 };
  });
  const lastWeek = days.filter((d) => d.day <= input.today && d.day > input.today - 7);
  const todayRow = days[input.today - 1];

  const os: OverviewOsShare[] = Object.entries(osCounts)
    .filter(([, count]) => count > 0)
    .map(([osValue, count]) => {
      const option = input.responsibleOptions.find((o) => o.value === osValue);
      return { osValue, label: option?.label ?? osValue, color: option?.color ?? null, count };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ru"));

  return {
    technicians,
    totals: {
      orders: summary.total,
      grandTotal,
      doneTotal,
      summary,
      ratingAvg: techRatings.length ? techRatings.reduce((n, r) => n + r.stars, 0) / techRatings.length : null,
      ratingCount: techRatings.length,
      techs: withDesk.length,
      freeTechs: withDesk.filter((t) => !t.busy).length,
      busyTechs: withDesk.filter((t) => t.busy).length,
      avgCheck: summary.total > 0 && grandTotal > 0 ? grandTotal / summary.total : null,
      today: { orders: todayRow?.count ?? 0, sum: todayRow?.sum ?? 0 },
      week: {
        orders: lastWeek.reduce((n, d) => n + d.count, 0),
        sum: lastWeek.reduce((n, d) => n + d.sum, 0),
      },
      updatedAt,
    },
    statusCounts,
    statusSums,
    days,
    os,
  };
}

/** "YYYY-MM" keys of the last `count` months ending with `monthKey`, oldest first. */
export function recentMonthKeys(monthKey: string, count: number): string[] {
  const [year, month] = monthKey.split("-").map(Number);
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(year, month - 1 - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

export interface OverviewMonth {
  monthKey: string;
  orders: number;
  grandTotal: number;
  doneTotal: number;
  /** This month is still running. */
  current: boolean;
}

/**
 * Month-by-month totals: finished months from the archive, the running one
 * from live counts. Only desks that still count as technician desks, so a
 * desk that stopped being one doesn't inflate old months either.
 */
export function monthlySeries(input: {
  monthKeys: string[];
  currentMonthKey: string;
  history: DeskLoadArchive[];
  currentTotals: { orders: number; grandTotal: number; doneTotal: number };
  deskIds: Set<string>;
  statusOptions: StatusOption[];
}): OverviewMonth[] {
  const latest = new Map<string, DeskLoadArchive>();
  for (const doc of input.history) {
    if (!input.deskIds.has(doc.pageId)) continue;
    const key = `${doc.pageId}_${doc.monthKey}`;
    const prev = latest.get(key);
    if (!prev || (doc.archivedAt ?? 0) > (prev.archivedAt ?? 0)) latest.set(key, doc);
  }
  return input.monthKeys.map((monthKey) => {
    if (monthKey === input.currentMonthKey) return { monthKey, current: true, ...input.currentTotals };
    let orders = 0;
    let grandTotal = 0;
    let doneTotal = 0;
    for (const doc of latest.values()) {
      if (doc.monthKey !== monthKey) continue;
      orders += doc.total ?? 0;
      grandTotal += doc.grandTotal ?? 0;
      doneTotal += doneSumFromStatusSums(doc.statusSums, input.statusOptions);
    }
    return { monthKey, current: false, orders, grandTotal, doneTotal };
  });
}

/** Place in a ranking (1-based) of `uid`, or null when not ranked. */
export function placeOf<T extends { member: WorkspaceMember }>(ranked: T[], uid: string): number | null {
  const index = ranked.findIndex((t) => t.member.uid === uid);
  return index < 0 ? null : index + 1;
}

/** By «Готово» money, then orders, then name — every technician with a desk. */
export function rankByDone(technicians: OverviewTechnician[]): OverviewTechnician[] {
  return technicians
    .filter((t) => t.desks.length > 0)
    .slice()
    .sort(
      (a, b) =>
        b.doneTotal - a.doneTotal ||
        b.summary.total - a.summary.total ||
        (a.member.nickname || a.member.name).localeCompare(b.member.nickname || b.member.name, "ru")
    );
}

/** By average stars, then how many rated — only technicians with at least one rating. */
export function rankByRating(technicians: OverviewTechnician[]): OverviewTechnician[] {
  return technicians
    .filter((t) => t.ratingCount > 0 && t.ratingAvg !== null)
    .slice()
    .sort((a, b) => (b.ratingAvg ?? 0) - (a.ratingAvg ?? 0) || b.ratingCount - a.ratingCount);
}
