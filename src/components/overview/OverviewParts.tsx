import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronDown, Crown, Gift, Star, Table2 } from "lucide-react";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { ScoreMeter } from "@/components/technicians/ScoreRating";
import { cn } from "@/utils/cn";
import { formatCurrency, formatNumber } from "@/utils/format";
import { personLabel } from "@/utils/peopleDesks";
import { NO_STATUS_KEY } from "@/utils/techLoad";
import type { OverviewDay, OverviewMonth, OverviewOsShare, OverviewTechnician } from "@/utils/overviewStats";
import { formatScore, type StatusOption, type WorkspaceMember } from "@/types";
import { bonusForPlace } from "@/utils/overviewStats";

const reducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------- formatting

const compactNumber = new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 });

/** «12,4 млн ₸» — for tiles and axes; full value goes to the title/tooltip. */
export function formatMoneyCompact(value: number): string {
  if (!value) return "0 ₸";
  return Math.abs(value) < 10_000 ? formatCurrency(value) : `${compactNumber.format(value).replace(/.$/, "")} ₸`;
}

function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
export const ordersWord = (n: number) => plural(n, "заказ", "заказа", "заказов");
/** Оценки — за заказы: «12 оценённых заказов». */
export const ratingsWord = (n: number) => plural(n, "оценённый заказ", "оценённых заказа", "оценённых заказов");

// ---------------------------------------------------------------- chrome

export function Panel({
  eyebrow,
  title,
  action,
  children,
  className,
}: {
  eyebrow?: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-2xl border border-border/70 bg-card/70 p-4 sm:p-5", className)}>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {eyebrow && <p className="eyebrow text-primary">{eyebrow}</p>}
          <h2 className="text-base font-medium leading-6">{title}</h2>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="flex shrink-0 rounded-lg border border-border p-0.5" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-[11px] font-medium transition-colors",
            value === option.value ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- stat tiles

export function StatTile({
  label,
  value,
  title,
  sub,
  meter,
  accent,
}: {
  label: string;
  value: ReactNode;
  /** Full value on hover when `value` is compact. */
  title?: string;
  sub?: ReactNode;
  /** 0..1 — a same-hue meter under the value. */
  meter?: number | null;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1.5 rounded-2xl border bg-card/70 p-4",
        accent ? "border-primary/40 shadow-[0_0_0_1px_hsl(var(--primary)/0.12)]" : "border-border/70"
      )}
    >
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="truncate text-[1.3rem] font-semibold leading-none tracking-[-0.02em] sm:text-[1.6rem]" title={title}>
        {value}
      </p>
      {meter !== undefined && meter !== null && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-primary/15" aria-hidden>
          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(1, meter)) * 100}%` }} />
        </div>
      )}
      {sub && <p className="line-clamp-2 text-[11px] leading-4 text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- leaders

function PlaceBadge({ place }: { place: number }) {
  return (
    <span
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] font-semibold tabular-nums",
        place === 1 && "border-amber-300/60 bg-amber-300/15 text-amber-200",
        place === 2 && "border-slate-300/50 bg-slate-300/10 text-slate-200",
        place === 3 && "border-orange-400/50 bg-orange-400/10 text-orange-200",
        place > 3 && "border-border text-muted-foreground"
      )}
      aria-label={`${place} место`}
    >
      {place}
    </span>
  );
}

function Person({ tech, me, sub }: { tech: OverviewTechnician; me: boolean; sub?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5">
      <MemberAvatar
        id={tech.member.uid}
        name={tech.member.name}
        nickname={tech.member.nickname}
        photoURL={tech.member.photoURL}
        className="h-8 w-8 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium leading-5">
          <span className="truncate">{personLabel(tech.member) || tech.member.email}</span>
          {me && <span className="shrink-0 rounded-full bg-primary/15 px-1.5 text-[10px] leading-4 text-primary">ты</span>}
        </p>
        {sub && <p className="truncate text-[11px] leading-4 text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

export function LeadersRow({
  byDone,
  byRating,
  byOrders,
  myUid,
}: {
  byDone: OverviewTechnician | null;
  byRating: OverviewTechnician | null;
  byOrders: OverviewTechnician | null;
  myUid: string;
}) {
  const cards = [
    byDone && byDone.doneTotal > 0
      ? { key: "done", title: "Больше всего «Готово»", tech: byDone, value: formatMoneyCompact(byDone.doneTotal), full: formatCurrency(byDone.doneTotal) }
      : null,
    byRating
      ? {
          key: "rating",
          title: "Лучшая оценка заказов",
          tech: byRating,
          value: `${formatScore(byRating.ratingAvg ?? 0)} / 10`,
          full: `${byRating.ratingCount} ${ratingsWord(byRating.ratingCount)}`,
        }
      : null,
    byOrders && byOrders.summary.total > 0
      ? { key: "orders", title: "Больше всего заказов", tech: byOrders, value: formatNumber(byOrders.summary.total), full: ordersWord(byOrders.summary.total) }
      : null,
  ].filter(Boolean) as { key: string; title: string; tech: OverviewTechnician; value: string; full: string }[];
  if (cards.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {cards.map((card) => (
        <div
          key={card.key}
          className="relative flex items-center gap-3 overflow-hidden rounded-2xl border border-amber-300/25 bg-gradient-to-br from-amber-300/[0.07] via-card/70 to-card/70 p-4"
        >
          <div className="relative shrink-0">
            <MemberAvatar
              id={card.tech.member.uid}
              name={card.tech.member.name}
              nickname={card.tech.member.nickname}
              photoURL={card.tech.member.photoURL}
              className="h-11 w-11 ring-2 ring-amber-300/40"
            />
            <Crown className="absolute -right-1.5 -top-2 h-4 w-4 rotate-12 fill-amber-300 text-amber-300" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-muted-foreground">{card.title}</p>
            <p className="truncate text-sm font-medium">
              {personLabel(card.tech.member) || card.tech.member.email}
              {card.tech.member.uid === myUid ? " · ты" : ""}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-lg font-semibold leading-none">{card.value}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">{card.full}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

const LEADERBOARD_PREVIEW = 8;

/** «+100 000 ₸» — премия за место (зелёная: это деньги человеку, а не касса). */
export function BonusChip({ amount, className }: { amount: number; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-success/40 bg-success/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-success tabular-nums",
        className
      )}
      title={`Премия к зарплате: ${formatCurrency(amount)}`}
    >
      <Gift className="h-3 w-3 shrink-0" />+{formatMoneyCompact(amount)}
    </span>
  );
}

export function DoneLeaderboard({
  ranked,
  myUid,
  bonuses = [],
}: {
  ranked: OverviewTechnician[];
  myUid: string;
  /** Премии за 1–3 место (workspace.techBonuses). */
  bonuses?: readonly number[];
}) {
  const [open, setOpen] = useState(false);
  const leader = ranked[0]?.doneTotal ?? 0;
  const shown = open ? ranked : ranked.slice(0, LEADERBOARD_PREVIEW);
  const anyBonus = bonuses.some((b) => b > 0);
  return (
    <Panel
      eyebrow="Рейтинг · касса технарей"
      title="По сумме «Готово»"
      action={
        anyBonus ? (
          <span className="text-[11px] text-muted-foreground" title="Премии получают первые три места по итогам месяца">
            топ-3 — премия
          </span>
        ) : undefined
      }
    >
      {ranked.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Пока нет технарей со столами.</p>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {shown.map((tech, i) => {
            const share = tech.grandTotal > 0 ? Math.round((tech.doneTotal / tech.grandTotal) * 100) : null;
            return (
              <li
                key={tech.member.uid}
                className={cn("rounded-xl px-2 py-1.5", tech.member.uid === myUid && "bg-primary/[0.07] ring-1 ring-primary/25")}
              >
                <div className="flex items-center gap-2.5">
                  <PlaceBadge place={i + 1} />
                  <Person
                    tech={tech}
                    me={tech.member.uid === myUid}
                    sub={`${formatNumber(tech.summary.total)} ${ordersWord(tech.summary.total)}${share !== null ? ` · ${share}% от общей суммы` : ""}`}
                  />
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <p className="text-right text-sm font-semibold tabular-nums" title={formatCurrency(tech.doneTotal)}>
                      {formatMoneyCompact(tech.doneTotal)}
                    </p>
                    {bonusForPlace(bonuses, i, tech.doneTotal) > 0 ? (
                      <BonusChip amount={bonusForPlace(bonuses, i, tech.doneTotal)} />
                    ) : null}
                  </div>
                </div>
                <div className="ml-[34px] mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted/60" aria-hidden>
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-500"
                    style={{ width: `${leader > 0 ? Math.max(tech.doneTotal > 0 ? 2 : 0, (tech.doneTotal / leader) * 100) : 0}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {ranked.length > LEADERBOARD_PREVIEW && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-3 inline-flex items-center gap-1 self-start text-xs font-medium text-primary hover:underline"
        >
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
          {open ? "Свернуть" : `Показать всех ${ranked.length}`}
        </button>
      )}
    </Panel>
  );
}

export function RatingLeaderboard({
  ranked,
  unrated,
  myUid,
}: {
  ranked: OverviewTechnician[];
  unrated: OverviewTechnician[];
  myUid: string;
}) {
  const [open, setOpen] = useState(false);
  const shown = open ? ranked : ranked.slice(0, LEADERBOARD_PREVIEW);
  return (
    <Panel eyebrow="Рейтинг" title="По оценкам заказов">
      {ranked.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Оценок пока нет. ОС ставят оценку от 1 до 10 каждому своему заказу — в карточке заказа на своём столе или на «Технари».
        </p>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {shown.map((tech, i) => (
            <li
              key={tech.member.uid}
              className={cn(
                "flex items-center gap-2.5 rounded-xl px-2 py-1.5",
                tech.member.uid === myUid && "bg-primary/[0.07] ring-1 ring-primary/25"
              )}
            >
              <PlaceBadge place={i + 1} />
              <Person
                tech={tech}
                me={tech.member.uid === myUid}
                sub={`${tech.ratingCount} ${ratingsWord(tech.ratingCount)}`}
              />
              <div className="flex shrink-0 items-center gap-2">
                <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400 sm:hidden" aria-hidden />
                <ScoreMeter average={tech.ratingAvg} count={tech.ratingCount} size="sm" />
              </div>
            </li>
          ))}
        </ol>
      )}
      {ranked.length > LEADERBOARD_PREVIEW && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-3 inline-flex items-center gap-1 self-start text-xs font-medium text-primary hover:underline"
        >
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
          {open ? "Свернуть" : `Показать всех ${ranked.length}`}
        </button>
      )}
      {unrated.length > 0 && (
        <p className="mt-3 border-t border-border/50 pt-2.5 text-[11px] leading-4 text-muted-foreground">
          Без оценок: {unrated.map((t) => personLabel(t.member) || t.member.email).join(", ")}
        </p>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- daily chart

function DayTooltip({
  active,
  payload,
  monthName,
}: {
  active?: boolean;
  payload?: { payload: OverviewDay }[];
  monthName: string;
}) {
  if (!active || !payload?.length) return null;
  const day = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg">
      <p className="text-muted-foreground">
        {day.day} {monthName}
      </p>
      <p className="mt-0.5 text-sm font-semibold">
        {formatNumber(day.count)} {ordersWord(day.count)}
      </p>
      <p className="text-foreground/90">{formatCurrency(day.sum)}</p>
    </div>
  );
}

const axisTick = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };

export function DailyChart({ days, today, monthName }: { days: OverviewDay[]; today: number; monthName: string }) {
  const [metric, setMetric] = useState<"count" | "sum">("count");
  const [asTable, setAsTable] = useState(false);
  const hasData = days.some((d) => d.count > 0);
  return (
    <Panel
      eyebrow="Динамика"
      title={metric === "count" ? "Заказы по дням" : "Сумма заказов по дням"}
      action={
        <div className="flex items-center gap-2">
          <Segmented
            label="Показатель"
            value={metric}
            onChange={setMetric}
            options={[
              { value: "count", label: "Штуки" },
              { value: "sum", label: "Сумма" },
            ]}
          />
          <button
            type="button"
            onClick={() => setAsTable((v) => !v)}
            aria-pressed={asTable}
            title={asTable ? "Показать график" : "Показать таблицей"}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg border border-border transition-colors",
              asTable ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Table2 className="h-3.5 w-3.5" />
          </button>
        </div>
      }
    >
      {!hasData ? (
        <p className="py-16 text-center text-sm text-muted-foreground">В этом месяце заказов пока нет.</p>
      ) : asTable ? (
        <div className="max-h-64 overflow-y-auto rounded-lg border border-border/60">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card text-left text-[11px] text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">День</th>
                <th className="px-3 py-2 text-right font-medium">Заказов</th>
                <th className="px-3 py-2 text-right font-medium">Сумма</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {days
                .filter((d) => d.count > 0)
                .map((d) => (
                  <tr key={d.day}>
                    <td className="px-3 py-1.5">
                      {d.day} {monthName}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{d.count}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatCurrency(d.sum)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-60 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={days} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="18%">
              <CartesianGrid vertical={false} stroke="hsl(var(--border) / 0.45)" />
              <XAxis
                dataKey="day"
                tickLine={false}
                axisLine={{ stroke: "hsl(var(--border))" }}
                tick={axisTick}
                interval="preserveStartEnd"
                minTickGap={10}
              />
              <YAxis
                width={metric === "sum" ? 56 : 32}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                tick={axisTick}
                tickFormatter={(v: number) => (metric === "sum" ? compactNumber.format(v) : formatNumber(v))}
              />
              <Tooltip cursor={{ fill: "hsl(var(--primary) / 0.08)" }} content={<DayTooltip monthName={monthName} />} />
              <Bar dataKey={metric} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={!reducedMotion} animationDuration={600}>
                {days.map((d) => (
                  <Cell
                    key={d.day}
                    fill={d.day === today ? "hsl(var(--primary))" : "hsl(var(--primary) / 0.5)"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {hasData && !asTable && (
        <p className="mt-2 text-[11px] text-muted-foreground">Ярче — сегодня. По дате заказа, а если её нет — по дню, когда строку создали.</p>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- monthly chart

function MonthTooltip({ active, payload }: { active?: boolean; payload?: { payload: OverviewMonth & { label: string } }[] }) {
  if (!active || !payload?.length) return null;
  const month = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg">
      <p className="text-muted-foreground">
        {month.label}
        {month.current ? " · идёт" : ""}
      </p>
      <p className="mt-0.5 text-sm font-semibold">{formatCurrency(month.doneTotal)} готово</p>
      <p className="text-foreground/90">
        {formatNumber(month.orders)} {ordersWord(month.orders)} · {formatCurrency(month.grandTotal)}
      </p>
    </div>
  );
}

export function MonthlyChart({ months }: { months: OverviewMonth[] }) {
  const [metric, setMetric] = useState<"doneTotal" | "orders">("doneTotal");
  const data = months.map((m) => {
    const [year, month] = m.monthKey.split("-").map(Number);
    const label = new Intl.DateTimeFormat("ru-RU", { month: "short", timeZone: "UTC" })
      .format(new Date(Date.UTC(year, month - 1, 15)))
      .replace(".", "");
    return { ...m, label };
  });
  const pastWithData = months.filter((m) => !m.current && (m.orders > 0 || m.doneTotal > 0)).length;
  return (
    <Panel
      eyebrow="По месяцам"
      title={metric === "doneTotal" ? "«Готово» за месяц" : "Заказов за месяц"}
      action={
        <Segmented
          label="Показатель"
          value={metric}
          onChange={setMetric}
          options={[
            { value: "doneTotal", label: "Готово" },
            { value: "orders", label: "Заказы" },
          ]}
        />
      }
    >
      <div className="h-52 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="hsl(var(--border) / 0.45)" />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "hsl(var(--border))" }} tick={axisTick} />
            <YAxis
              width={metric === "doneTotal" ? 56 : 32}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              tick={axisTick}
              tickFormatter={(v: number) => (metric === "doneTotal" ? compactNumber.format(v) : formatNumber(v))}
            />
            <Tooltip cursor={{ fill: "hsl(var(--primary) / 0.08)" }} content={<MonthTooltip />} />
            <Bar dataKey={metric} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={!reducedMotion} animationDuration={600}>
              {data.map((m) => (
                <Cell key={m.monthKey} fill={m.current ? "hsl(var(--primary))" : "hsl(var(--primary) / 0.5)"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {pastWithData === 0
          ? "Прошлые месяцы появятся после смены месяца: итог каждого стола сохраняется, когда начинается новый."
          : "Ярче — текущий месяц, он ещё идёт."}
      </p>
    </Panel>
  );
}

// ---------------------------------------------------------------- load by technician

/**
 * Stack order and colors checked together on the dark card surface (dataviz
 * validator: lightness band, normal-vision ΔE ≥ 15 for every neighbour; CVD in
 * the warn band, so the 2px gaps, legend and tooltips carry identity too).
 */
export const LOAD_SEGMENTS: { kind: keyof Pick<OverviewTechnician["summary"], "busy" | "payment" | "freeze" | "rework" | "done">; label: string; color: string }[] = [
  { kind: "busy", label: "В работе", color: "#e66767" },
  { kind: "payment", label: "Ждём оплату", color: "#199e70" },
  { kind: "freeze", label: "Заморозка", color: "#3987e5" },
  { kind: "rework", label: "Переделка", color: "#c98500" },
  { kind: "done", label: "Готово", color: "#008300" },
];

export function LoadChart({
  technicians,
  showPayment,
  myUid,
  linkDesks,
}: {
  technicians: OverviewTechnician[];
  showPayment: boolean;
  myUid: string;
  linkDesks: boolean;
}) {
  const segments = LOAD_SEGMENTS.filter((s) => showPayment || s.kind !== "payment");
  const rows = technicians
    .filter((t) => t.desks.length > 0)
    .map((t) => ({ tech: t, shown: segments.reduce((n, s) => n + t.summary[s.kind], 0) }))
    .sort((a, b) => b.tech.summary.busy - a.tech.summary.busy || b.shown - a.shown);
  const max = Math.max(1, ...rows.map((r) => r.shown));
  const totals = Object.fromEntries(segments.map((s) => [s.kind, technicians.reduce((n, t) => n + t.summary[s.kind], 0)]));
  return (
    <Panel eyebrow="Кто чем занят" title="Загрузка технарей">
      <ul className="mb-3 flex flex-wrap gap-x-3 gap-y-1" aria-label="Легенда">
        {segments.map((s) => (
          <li key={s.kind} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: s.color }} aria-hidden />
            {s.label}
            <span className="tabular-nums text-foreground/80">{totals[s.kind]}</span>
          </li>
        ))}
      </ul>
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Пока нет технарей со столами.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map(({ tech, shown }) => {
            const name = personLabel(tech.member) || tech.member.email;
            return (
              <li key={tech.member.uid} className="grid grid-cols-[minmax(0,7.5rem)_1fr_2.25rem] items-center gap-2 sm:grid-cols-[minmax(0,10rem)_1fr_2.5rem]">
                <span className={cn("truncate text-xs", tech.member.uid === myUid ? "font-medium text-primary" : "text-foreground/90")}>
                  {linkDesks && tech.desks[0] ? (
                    <Link to={`/page/${tech.desks[0].id}`} className="hover:underline">
                      {name}
                    </Link>
                  ) : (
                    name
                  )}
                </span>
                <div className="flex h-3.5 min-w-0 items-stretch gap-[2px]" style={{ width: `${Math.max(shown > 0 ? 4 : 0, (shown / max) * 100)}%` }}>
                  {segments.map((s) => {
                    const value = tech.summary[s.kind];
                    if (!value) return null;
                    return (
                      <span
                        key={s.kind}
                        className="h-full min-w-[3px] first:rounded-l-[4px] last:rounded-r-[4px]"
                        style={{ flexGrow: value, flexBasis: 0, backgroundColor: s.color }}
                        title={`${name} · ${s.label}: ${value}`}
                      />
                    );
                  })}
                  {shown === 0 && <span className="h-full w-full rounded-[4px] bg-muted/60" title={`${name}: заказов нет`} />}
                </div>
                <span className="text-right text-xs tabular-nums text-muted-foreground">{tech.summary.total}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- statuses

export function StatusBars({
  statusCounts,
  statusOptions,
  total,
}: {
  statusCounts: Record<string, number>;
  statusOptions: StatusOption[];
  total: number;
}) {
  const rows: { key: string; label: string; color: string | null; count: number; rank: number }[] = [];
  for (const [raw, count] of Object.entries(statusCounts)) {
    if (!count) continue;
    if (raw === NO_STATUS_KEY) {
      rows.push({ key: raw, label: "Без статуса", color: null, count, rank: 999 });
      continue;
    }
    const lower = raw.toLowerCase();
    const option = statusOptions.find((o) => o.value === raw) ?? statusOptions.find((o) => o.label.toLowerCase() === lower);
    const key = option?.value ?? raw;
    const existing = rows.find((r) => r.key === key);
    if (existing) existing.count += count;
    else rows.push({ key, label: option?.label ?? raw, color: option?.color ?? null, count, rank: option ? statusOptions.indexOf(option) : 998 });
  }
  rows.sort((a, b) => a.rank - b.rank);
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Panel eyebrow="Статусы" title="Все заказы месяца">
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Заказов пока нет.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.key} className="grid grid-cols-[minmax(0,7rem)_1fr_4.5rem] items-center gap-2">
              <span className="flex min-w-0 items-center gap-1.5 text-xs text-foreground/90">
                <span
                  className={cn("h-2 w-2 shrink-0 rounded-full", !row.color && "bg-muted-foreground/60")}
                  style={row.color ? { backgroundColor: `hsl(${row.color})` } : undefined}
                  aria-hidden
                />
                <span className="truncate">{row.label}</span>
              </span>
              <div className="h-2.5 min-w-0 rounded-[4px] bg-muted/40">
                <div
                  className={cn("h-full rounded-[4px]", !row.color && "bg-muted-foreground/50")}
                  style={{ width: `${(row.count / max) * 100}%`, backgroundColor: row.color ? `hsl(${row.color})` : undefined }}
                  title={`${row.label}: ${row.count}`}
                />
              </div>
              <span className="text-right text-xs tabular-nums">
                {row.count}
                <span className="ml-1 text-muted-foreground">{total > 0 ? `${Math.round((row.count / total) * 100)}%` : ""}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- ОС

const OS_PREVIEW = 8;

export function OsBars({ os, myOsValue }: { os: OverviewOsShare[]; myOsValue: string | null }) {
  const head = os.slice(0, OS_PREVIEW);
  const rest = os.slice(OS_PREVIEW);
  const rows = rest.length
    ? [...head, { osValue: "__rest__", label: `Другие (${rest.length})`, color: null, count: rest.reduce((n, r) => n + r.count, 0) }]
    : head;
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Panel eyebrow="ОС" title="Кто больше дал заказов">
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Пока нет заказов с ником ОС — технари ставят ник в столбце «ОС».
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const mine = row.osValue === myOsValue;
            return (
              <li key={row.osValue} className="grid grid-cols-[minmax(0,7rem)_1fr_2.5rem] items-center gap-2">
                <span className={cn("truncate text-xs", mine ? "font-medium text-primary" : "text-foreground/90")}>
                  {row.label}
                  {mine ? " · вы" : ""}
                </span>
                <div className="h-2.5 min-w-0 rounded-[4px] bg-muted/40">
                  <div
                    className="h-full rounded-[4px]"
                    style={{
                      width: `${(row.count / max) * 100}%`,
                      backgroundColor: mine ? "hsl(var(--primary))" : "hsl(var(--secondary) / 0.75)",
                    }}
                    title={`${row.label}: ${row.count}`}
                  />
                </div>
                <span className="text-right text-xs tabular-nums">{row.count}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}


export interface BonusTopEntry {
  member: WorkspaceMember;
  doneTotal: number;
  bonus: number;
}

/**
 * Итог премий за прошлый месяц: кто занял 1–3 место по «Готово» и сколько
 * ему к зарплате. Считается по архиву месяца, поэтому 1-го числа не пропадает,
 * как и итог оценок рядом.
 */
export function BonusTop({ monthLabel, entries }: { monthLabel: string; entries: BonusTopEntry[] }) {
  if (entries.length === 0) return null;
  const total = entries.reduce((sum, e) => sum + e.bonus, 0);
  return (
    <section className="rounded-2xl border border-success/30 bg-success/[0.06] p-4">
      <header className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Gift className="h-4 w-4 text-success" />
          Премии за {monthLabel}
        </p>
        <span className="text-xs text-muted-foreground">
          всего <span className="font-semibold text-foreground tabular-nums">{formatCurrency(total)}</span>
        </span>
      </header>
      <ol className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(min(100%,220px),1fr))]">
        {entries.map((entry, index) => (
          <li key={entry.member.uid} className="flex min-w-0 items-center gap-2 rounded-xl border border-border/60 bg-card/60 px-2.5 py-2">
            <PlaceBadge place={index + 1} />
            <MemberAvatar
              id={entry.member.uid}
              name={entry.member.name}
              nickname={entry.member.nickname}
              photoURL={entry.member.photoURL}
              className="h-7 w-7 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{personLabel(entry.member)}</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <span className="whitespace-nowrap text-[11px] text-muted-foreground tabular-nums" title={formatCurrency(entry.doneTotal)}>
                  «Готово» {formatMoneyCompact(entry.doneTotal)}
                </span>
                <BonusChip amount={entry.bonus} />
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
