import { isDoneStatusLabel } from "@/utils/columnOptions";
import { memberHasRole } from "@/types/role";
import { NO_STATUS_KEY, summarizeDeskLoad, type TechLoadSummary } from "@/utils/techLoad";
import type { DeskLoad, OsKpiTier, OsPaySettings, StatusOption, TechLoadKind, WorkspaceMember, WorkspacePage } from "@/types";

/**
 * «ABS система» — касса и зарплатные доплаты за текущий месяц (просьба Nurba
 * 23.09.2026). Чистые функции: страница только подаёт данные.
 *
 * ОС — по KPI: какая доля его заказов уже в «Готово» («Успешка» и прочие
 * статусы, чьё название читается как «готово», — то же правило, что у кассы
 * технарей). Считается по счётчикам столов технарей (`deskLoad.osStatusCounts`
 * по нику ОС) — это все заказы ОС этого месяца, и те, что пришли со стола ОС,
 * и старые, заведённые технарями с его ником.
 */

function optionOf(raw: string, options: StatusOption[]): StatusOption | undefined {
  return options.find((o) => o.value === raw) ?? options.find((o) => o.label === raw);
}

/** Сколько заказов в «Готово» — по названию статуса, как касса «Готово» у технарей. */
export function doneCountFromStatusCounts(counts: Record<string, number> | undefined, options: StatusOption[]): number {
  let n = 0;
  for (const [raw, count] of Object.entries(counts ?? {})) {
    if (raw === NO_STATUS_KEY) continue;
    const option = optionOf(raw, options);
    if (isDoneStatusLabel(option?.label ?? raw)) n += count;
  }
  return n;
}

export interface OsKpiInput {
  members: WorkspaceMember[];
  /** Активные столы (useWorkspace().pages) — счётчики неактуальных не в счёт. */
  pages: WorkspacePage[];
  loads: DeskLoad[];
  monthKey: string;
  currentTabOf: (desk: WorkspacePage) => string | null;
  statusOptions: StatusOption[];
  kinds: Record<string, TechLoadKind> | undefined;
  /** Апсейл за месяц за вычетом комиссии — по uid ОС (сводка его стола ОС); нет — 0. */
  upsellNetOf: (uid: string) => number | null;
  /** Грязный апсейл (как вписан) — для подсказки. */
  upsellGrossOf: (uid: string) => number | null;
  settings: OsPaySettings;
}

export interface OsAbsRow {
  member: WorkspaceMember;
  osValue: string;
  summary: TechLoadSummary;
  /** Заказов в «Готово» по названию статуса. */
  done: number;
  /** KPI, % (0–100); null — заказов нет. */
  kpiPct: number | null;
  /** Хватает ли заказов, чтобы KPI шёл в топ и пороги. */
  kpiEligible: boolean;
  upsellNet: number | null;
  upsellGross: number | null;
  /** % от апсейла после комиссии. */
  upsellPay: number;
  /** Добитый порог KPI (самый высокий). */
  tier: OsKpiTier | null;
  /** Доп. оклад за 1-е место по KPI. */
  kpiTopPay: number;
  /** Итого доплат за месяц. */
  totalPay: number;
  kpiPlace: number | null;
  upsellPlace: number | null;
}

const round = (n: number) => Math.round(n);

export function buildOsAbs(input: OsKpiInput): OsAbsRow[] {
  const { settings } = input;
  const perOs = new Map<string, { counts: Record<string, number>; total: number }>();
  for (const desk of input.pages) {
    if (desk.osDesk) continue;
    const load = input.loads.find((l) => l.pageId === desk.id);
    const tab = input.currentTabOf(desk);
    if (!load || !tab || load.monthKey !== input.monthKey || load.subPageId !== tab) continue;
    for (const [osValue, counts] of Object.entries(load.osStatusCounts ?? {})) {
      const acc = perOs.get(osValue) ?? { counts: {}, total: 0 };
      for (const [raw, n] of Object.entries(counts)) {
        acc.counts[raw] = (acc.counts[raw] ?? 0) + n;
        acc.total += n;
      }
      perOs.set(osValue, acc);
    }
  }

  const osMembers = input.members.filter((m) => m.status === "active" && m.uid && m.osNickValue && memberHasRole(m, "os"));
  const rows: OsAbsRow[] = osMembers.map((member) => {
    const osValue = member.osNickValue as string;
    const acc = perOs.get(osValue) ?? { counts: {}, total: 0 };
    const summary = summarizeDeskLoad({ total: acc.total, statusCounts: acc.counts }, input.statusOptions, input.kinds);
    const done = doneCountFromStatusCounts(acc.counts, input.statusOptions);
    const kpiPct = acc.total > 0 ? Math.round((done / acc.total) * 1000) / 10 : null;
    const kpiEligible = acc.total > 0 && acc.total >= settings.kpiMinOrders;
    const upsellNet = input.upsellNetOf(member.uid);
    const upsellGross = input.upsellGrossOf(member.uid);
    const upsellPay = round(((upsellNet ?? 0) * settings.upsellPct) / 100);
    const tier =
      kpiEligible && kpiPct !== null
        ? [...settings.kpiTiers].sort((a, b) => b.minPct - a.minPct).find((t) => kpiPct >= t.minPct) ?? null
        : null;
    return {
      member,
      osValue,
      summary,
      done,
      kpiPct,
      kpiEligible,
      upsellNet,
      upsellGross,
      upsellPay,
      tier,
      kpiTopPay: 0,
      totalPay: 0,
      kpiPlace: null,
      upsellPlace: null,
    };
  });

  // Топ по KPI: только те, у кого заказов не меньше порога; при равенстве — у кого больше «Готово».
  const byKpi = rows
    .filter((r) => r.kpiEligible && r.kpiPct !== null)
    .sort((a, b) => (b.kpiPct ?? 0) - (a.kpiPct ?? 0) || b.done - a.done || b.summary.total - a.summary.total);
  byKpi.forEach((r, i) => (r.kpiPlace = i + 1));
  if (byKpi[0] && settings.kpiTopBonus > 0 && (byKpi[0].kpiPct ?? 0) > 0) byKpi[0].kpiTopPay = settings.kpiTopBonus;

  const byUpsell = rows.filter((r) => (r.upsellNet ?? 0) > 0).sort((a, b) => (b.upsellNet ?? 0) - (a.upsellNet ?? 0));
  byUpsell.forEach((r, i) => (r.upsellPlace = i + 1));

  for (const r of rows) r.totalPay = r.upsellPay + (r.tier?.amount ?? 0) + r.kpiTopPay;
  return rows;
}

/** Порядок таблицы ОС: по KPI (в топе), потом остальные по заказам. */
export function sortOsAbs(rows: OsAbsRow[]): OsAbsRow[] {
  return [...rows].sort(
    (a, b) =>
      (a.kpiPlace ?? Infinity) - (b.kpiPlace ?? Infinity) ||
      b.summary.total - a.summary.total ||
      (a.member.nickname || a.member.name).localeCompare(b.member.nickname || b.member.name, "ru")
  );
}
