import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { ArrowRight, Check, Crown, Target } from "lucide-react";
import { MetricCard } from "@/components/ui/metric-card";
import { useCurrentMonthKey } from "@/hooks/useCurrentMonthKey";
import { useDeskLoads } from "@/hooks/useDeskLoads";
import { useWorkspace } from "@/hooks/useWorkspace";
import { currentMonthSubPageId } from "@/services/monthTabService";
import { almatyMonthStartMillis, fetchOsDeskMonthStats, type OsDeskMonthStats } from "@/services/osDeskStatsService";
import { monthTabNameForKey } from "@/services/subPageService";
import type { OsDeskKeys } from "@/services/osDeskService";
import { buildOsAbs, monthUpsellOverlay, nextKpiTier, splitPercent } from "@/utils/absStats";
import { isBlankRow } from "@/utils/blankRow";
import { cn } from "@/utils/cn";
import { DEFAULT_STATUS_OPTIONS } from "@/utils/columnOptions";
import { formatCurrency, formatNumber } from "@/utils/format";
import { parseLooseNumber } from "@/utils/numberInput";
import { formatDayMonth, osDateSlots, slotShown } from "@/utils/osDates";
import { netOf, osPayOf } from "@/utils/payment";
import { effectiveTechLoadKinds } from "@/utils/techLoad";
import type { PageRow, WorkspacePage } from "@/types";

/** Апсейл одной строки стола ОС — для списка «откуда проценты». */
interface UpsellEntry {
  id: string;
  client: string;
  gross: number;
  net: number;
  pay: number;
  at: number | null;
}

/**
 * Статистика СТОЛА ОС (просьба Nurba 25.09.2026: «кнопка «Статистика» на
 * видном месте; у технарей — как было, у ОС — по KPI и 8 % от апсейлов»).
 *
 * Цифры месяца — по тем же правилам, что «ABS система», чтобы две страницы
 * не спорили:
 * - KPI, место, пороги, доп. оклад — `buildOsAbs` по счётчикам столов
 *   технарей (`deskLoad.osStatusCounts` по нику ОС) за текущий месяц;
 * - апсейл месяца — как `fetchOsDeskMonthStats`: все вкладки стола, строки,
 *   заведённые или заполненные в этом месяце, после комиссии способа оплаты.
 *   Открытая вкладка — ЖИВАЯ (`monthUpsellOverlay`): вписал апсейл — процент
 *   пересчитался сразу, не дожидаясь сводки;
 * - процент — `osPay.upsellPct` (по умолчанию 8), итог округляется один раз.
 * Ниже — апсейлы ОТКРЫТОЙ вкладки списком (с процентом каждой строки,
 * сходящимся с итогом списка), подписанные её именем: на прошлой вкладке это
 * прошлый месяц, в деньги текущего он не входит.
 */
export function OsDeskStats({
  page,
  rows,
  keys,
  tabId,
  tabLabel,
}: {
  page: WorkspacePage;
  rows: PageRow[];
  keys: OsDeskKeys;
  /** Открытая вкладка (null — «Основная»). */
  tabId: string | null;
  /** Подпись открытой вкладки («Сентябрь 2026»). */
  tabLabel: string;
}) {
  const { activeWorkspace, activeWorkspaceId, members, pages } = useWorkspace();
  const monthKey = useCurrentMonthKey();
  const { loads, failed } = useDeskLoads(activeWorkspaceId, true);
  const settings = useMemo(() => osPayOf(activeWorkspace), [activeWorkspace]);
  const kinds = useMemo(() => effectiveTechLoadKinds(activeWorkspace), [activeWorkspace]);
  const statusOptions = activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS;
  const osUid = page.responsibleUserId ?? "";

  // Сводка месяца по всем вкладкам стола — тот же кэш, что у «ABS» и «Столов ОС».
  const [monthStats, setMonthStats] = useState<OsDeskMonthStats | "error" | null>(null);
  useEffect(() => {
    if (!activeWorkspaceId) return;
    let cancelled = false;
    setMonthStats(null);
    fetchOsDeskMonthStats(activeWorkspaceId, page)
      .then((s) => !cancelled && setMonthStats(s))
      .catch(() => !cancelled && setMonthStats("error"));
    return () => {
      cancelled = true;
    };
    // Стол читаем при открытии и смене месяца, не на каждый снимок документа стола.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId, page.id, monthKey]);

  // Открытая вкладка: живые апсейлы — все (для списка) и только этого месяца
  // (для денег месяца, по правилу «ABS»: max(createdAt, filledAt) с 1-го числа).
  const tabUpsells = useMemo(() => {
    const monthStart = almatyMonthStartMillis();
    const list: Omit<UpsellEntry, "pay">[] = [];
    const live = { net: 0, gross: 0 };
    for (const row of rows) {
      if (isBlankRow(row)) continue;
      const gross = parseLooseNumber(String(row.cells[keys.upsell] ?? "")) ?? 0;
      // Возврат (минус) тоже в счёт — как на «ABS».
      if (gross === 0) continue;
      const net = netOf(row, keys.upsell);
      if (Math.max(row.createdAt ?? 0, row.filledAt ?? 0) >= monthStart) {
        live.net += net;
        live.gross += gross;
      }
      list.push({
        id: row.id,
        client: String(row.cells[keys.client] ?? "").trim() || "Без имени",
        gross,
        net,
        at: slotShown(osDateSlots(row, { upsellKey: keys.upsell }).upsell),
      });
    }
    const split = splitPercent(
      list.map((u) => u.net),
      settings.upsellPct
    );
    const entries: UpsellEntry[] = list.map((u, i) => ({ ...u, pay: split.rows[i] }));
    // Новые сверху: по дате апсейла, без даты — в конце.
    entries.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
    const tabNet = list.reduce((sum, u) => sum + u.net, 0);
    return { entries, listPay: split.total, tabNet, live };
    // monthKey — чтобы граница месяца сдвинулась 1-го числа без перезагрузки.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, keys.upsell, keys.client, settings.upsellPct, monthKey]);

  const month = monthUpsellOverlay({
    stats: monthStats && monthStats !== "error" ? monthStats : null,
    tabKey: tabId ?? "",
    live: tabUpsells.live,
  });

  const abs = useMemo(() => {
    const all = buildOsAbs({
      members,
      pages,
      loads: loads ?? [],
      monthKey,
      currentTabOf: (desk) => currentMonthSubPageId(desk, monthKey),
      statusOptions,
      kinds,
      settings,
      upsellNetOf: (uid) => (uid === osUid ? month.net : null),
      upsellGrossOf: (uid) => (uid === osUid ? month.gross : null),
    });
    return { mine: all.find((r) => r.member.uid === osUid) ?? null, ranked: all.filter((r) => r.kpiPlace !== null).length };
  }, [members, pages, loads, monthKey, statusOptions, kinds, settings, osUid, month.net, month.gross]);

  const mine = abs.mine;
  const upsellPay = Math.round((month.net * settings.upsellPct) / 100);
  // Счётчики столов ещё не пришли или не прочитались — это «не знаем», а не «заказов нет».
  const loadsLoading = loads === null && !failed;
  const loadsFailed = loads === null && failed;
  const totalPay = mine && !loadsLoading && !loadsFailed ? mine.totalPay : upsellPay;
  const monthName = monthTabNameForKey(monthKey);
  const monthLower = monthName.toLowerCase();
  const next = mine && mine.kpiEligible && !loadsFailed ? nextKpiTier(mine, settings) : null;
  const tiers = [...settings.kpiTiers].sort((a, b) => a.minPct - b.minPct);
  const statsPending = monthStats === null;
  const statsFailed = monthStats === "error";

  const kpiValue = loadsLoading ? "…" : loadsFailed ? "—" : mine && mine.kpiPct !== null ? `${mine.kpiPct}%` : "—";
  const kpiSub = loadsLoading
    ? "загружаю цифры столов…"
    : loadsFailed
      ? "не удалось прочитать заказы — обновите страницу"
      : !mine
        ? "у ОС нет ника — KPI не считается"
        : mine.summary.total === 0
          ? `заказов за ${monthLower} пока нет`
          : `${formatNumber(mine.done)} из ${formatNumber(mine.summary.total)} в «Готово»${
              mine.kpiEligible ? "" : ` · в KPI — от ${settings.kpiMinOrders} заказов`
            }`;
  const upsellScope = statsFailed
    ? "только открытая вкладка — сводка стола не прочиталась"
    : statsPending
      ? "считаю по всем вкладкам…"
      : month.gross !== month.net
        ? `вписано ${formatCurrency(month.gross)} · все вкладки`
        : "все вкладки стола";
  const payParts = [
    `${settings.upsellPct}% апсейла ${formatCurrency(upsellPay)}`,
    loadsFailed ? "KPI не прочитан" : null,
    !loadsFailed && mine?.tier ? `порог ${mine.tier.minPct}% ${formatCurrency(mine.tier.amount)}` : null,
    !loadsFailed && mine && mine.kpiTopPay > 0 ? `топ-1 KPI ${formatCurrency(mine.kpiTopPay)}` : null,
  ].filter(Boolean);

  return (
    <div className="border-b border-border p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-xs text-muted-foreground">Статистика ОС · {monthLower}: KPI и ваш процент с апсейла</p>
        <Link to="/abs?v=os" className="ml-auto inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline">
          Все ОС в ABS <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <MetricCard
          label="KPI · доля «Готово»"
          value={kpiValue}
          sub={kpiSub}
          meter={!loadsFailed && mine && mine.kpiPct !== null ? mine.kpiPct / 100 : undefined}
          tone="primary"
          size="sm"
        />
        <MetricCard label={`Апсейл за ${monthLower}`} value={formatCurrency(month.net)} sub={`после комиссии · ${upsellScope}`} size="sm" />
        <MetricCard label={`${settings.upsellPct}% от апсейла`} value={formatCurrency(upsellPay)} sub="в зарплату ОС" tone="success" size="sm" />
        <MetricCard
          label="Доплаты за месяц"
          value={loadsLoading ? "…" : formatCurrency(totalPay)}
          sub={payParts.join(" + ")}
          tone="success"
          size="sm"
        />
      </div>

      {/* Пороги KPI и место — одной строкой: сколько ещё закрыть до следующего. */}
      {!loadsFailed ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Target className="h-3.5 w-3.5" /> Пороги KPI:
          </span>
          {tiers.length === 0 ? (
            <span className="text-muted-foreground">не заданы (Owner: «Настройки → Касса»)</span>
          ) : (
            tiers.map((t) => {
              const reached = Boolean(mine?.kpiEligible && (mine.kpiPct ?? 0) >= t.minPct);
              return (
                <span
                  key={t.id}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 tabular-nums",
                    reached ? "border-success/40 bg-success/10 text-success" : "border-border text-muted-foreground"
                  )}
                >
                  {reached ? <Check className="h-3 w-3" /> : null}
                  от {t.minPct}% → {formatCurrency(t.amount)}
                </span>
              );
            })
          )}
          {next ? (
            <span className="text-foreground/85">
              до «от {next.tier.minPct}%» — ещё {formatNumber(next.needDone)} в «Готово»
            </span>
          ) : null}
          {mine?.kpiPlace ? (
            <span className="ml-auto inline-flex items-center gap-1 text-muted-foreground">
              <Crown className={cn("h-3.5 w-3.5", mine.kpiPlace === 1 && "text-warning")} />
              место по KPI: {mine.kpiPlace} из {abs.ranked}
              {settings.kpiTopBonus > 0 ? ` · 1-е место +${formatCurrency(settings.kpiTopBonus)}` : ""}
            </span>
          ) : null}
        </div>
      ) : null}

      {tabUpsells.entries.length > 0 ? (
        <details className="group mt-3 rounded-lg border border-border">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground">
            <span>
              Апсейлы во вкладке «{tabLabel}» · {tabUpsells.entries.length}
            </span>
            <span className="tabular-nums">
              {formatCurrency(tabUpsells.tabNet)} → {settings.upsellPct}% ={" "}
              <span className="font-medium text-success">{formatCurrency(tabUpsells.listPay)}</span>
            </span>
          </summary>
          <ul className="max-h-56 divide-y divide-border overflow-y-auto border-t border-border scrollbar-thin">
            {tabUpsells.entries.map((u) => (
              <li key={u.id} className="flex items-center gap-3 px-3 py-1.5 text-xs">
                <span className="w-11 shrink-0 font-mono tabular-nums text-muted-foreground">{u.at ? formatDayMonth(u.at) : "—"}</span>
                <span className="min-w-0 flex-1 truncate">{u.client}</span>
                <span className="font-mono tabular-nums" title={u.gross !== u.net ? `вписано ${formatCurrency(u.gross)}` : undefined}>
                  {formatCurrency(u.net)}
                </span>
                <span className={cn("w-24 shrink-0 text-right font-mono tabular-nums", u.pay >= 0 ? "text-success" : "text-destructive")}>
                  {u.pay > 0 ? "+" : ""}
                  {formatCurrency(u.pay)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
