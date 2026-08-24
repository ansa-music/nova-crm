import { useMemo, useRef } from "react";
import { deskEase, gsap, useGSAP } from "@/lib/gsap";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/utils/format";

export interface DeskBarDatum {
  id: string;
  name: string;
  person: string;
  doneTotal: number;
}

function GlassTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: DeskBarDatum }[];
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-md border border-primary/35 bg-card px-3 py-2">
      <p className="text-[12px] font-medium text-foreground">{row.person || row.name}</p>
      <p className="text-[11px] text-muted-foreground">{row.name}</p>
      <p className="mt-1 font-mono text-[12px] tabular text-primary">{formatCurrency(row.doneTotal)}</p>
    </div>
  );
}

interface DeskChartProps {
  data: DeskBarDatum[];
  activeId?: string | null;
  onHover?: (id: string | null) => void;
  onSelect?: (id: string) => void;
}

export function DeskChart({ data, activeId, onHover, onSelect }: DeskChartProps) {
  const hasData = data.some((d) => d.doneTotal > 0);
  const chartData = useMemo(
    () =>
      data.map((d) => ({
        ...d,
        label: d.person || d.name,
      })),
    [data]
  );

  const chartRef = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const id = window.requestAnimationFrame(() => {
        const bars = chartRef.current?.querySelectorAll(".recharts-bar-rectangle");
        if (!bars?.length) return;
        gsap.fromTo(
          bars,
          { scaleY: 0, transformOrigin: "50% 100%" },
          { scaleY: 1, duration: 0.55, stagger: 0.07, ease: deskEase }
        );
      });
      return () => window.cancelAnimationFrame(id);
    },
    { scope: chartRef, dependencies: [chartData] }
  );

  return (
    <Card className="desk-chart overflow-hidden rounded-xl border-primary/28 bg-card">
      <CardHeader className="pb-2">
        <p className="eyebrow text-primary">Диаграмма</p>
        <CardTitle className="text-base font-medium">Готово по столам</CardTitle>
      </CardHeader>
      <CardContent ref={chartRef} className="h-72 pl-0 pr-3">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 8, right: 8, left: 4, bottom: 4 }}
              onMouseLeave={() => onHover?.(null)}
            >
              <defs>
                <linearGradient id="deskBarFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.95} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.28} />
                </linearGradient>
                <linearGradient id="deskBarActive" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={1} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.55} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                interval={0}
                tick={{ fontSize: 11, fill: "hsl(210 22% 82%)" }}
                tickFormatter={(v: string) => (v.length > 12 ? v.slice(0, 11) + "..." : v)}
              />
              <YAxis hide />
              <Tooltip cursor={{ fill: "hsl(var(--primary) / 0.06)" }} content={<GlassTooltip />} />
              <Bar
                dataKey="doneTotal"
                radius={[2, 2, 0, 0]}
                maxBarSize={48}
                cursor="pointer"
                isAnimationActive={!window.matchMedia("(prefers-reduced-motion: reduce)").matches}
                animationDuration={700}
                onMouseEnter={(entry: DeskBarDatum) => onHover?.(entry.id)}
                onClick={(entry: DeskBarDatum) => onSelect?.(entry.id)}
              >
                {chartData.map((entry) => {
                  const lit = !activeId || activeId === entry.id;
                  const focused = activeId === entry.id;
                  return (
                    <Cell
                      key={entry.id}
                      fill={focused ? "url(#deskBarActive)" : "url(#deskBarFill)"}
                      fillOpacity={lit ? 1 : 0.28}
                      stroke={focused ? "hsl(var(--primary))" : "transparent"}
                      strokeWidth={focused ? 1.5 : 0}
                      style={{
                        cursor: "pointer",
                      }}
                    />
                  );
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center px-5 text-sm text-muted-foreground">
            Пока нет суммы «Готово» на столах.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface GoalVsDoneChartProps {
  doneTotal: number;
  goal: number;
}

function GoalTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
}) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  return (
    <div className="rounded-md border border-primary/35 bg-card px-3 py-2 text-[12px]">
      <p className="text-muted-foreground">{item.name}</p>
      <p className="font-mono tabular text-primary">{formatCurrency(item.value)}</p>
    </div>
  );
}

export function GoalVsDoneChart({ doneTotal, goal }: GoalVsDoneChartProps) {
  const data = [
    { name: "Готово", value: doneTotal, fill: "hsl(var(--success))" },
    { name: "Цель", value: goal, fill: "hsl(var(--primary))" },
  ];
  const percent = goal > 0 ? Math.min(100, Math.round((doneTotal / goal) * 100)) : 0;

  return (
    <Card className="desk-chart overflow-hidden rounded-xl border-primary/28 bg-card">
      <CardHeader className="pb-2">
        <p className="eyebrow text-primary">Цель</p>
        <CardTitle className="text-base font-medium">Готово и цель на месяц</CardTitle>
      </CardHeader>
      <CardContent className="h-64 pl-0 pr-3">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="name"
              tickLine={false}
              axisLine={false}
              width={72}
              tick={{ fontSize: 12, fill: "hsl(210 22% 82%)" }}
            />
            <Tooltip cursor={{ fill: "hsl(var(--primary) / 0.06)" }} content={<GoalTooltip />} />
            <Bar dataKey="value" radius={[0, 2, 2, 0]} maxBarSize={28} cursor="pointer">
              {data.map((entry) => (
                <Cell key={entry.name} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <p className="-mt-2 pr-3 text-right font-mono text-[11px] tabular text-muted-foreground">{percent}% к цели</p>
      </CardContent>
    </Card>
  );
}
