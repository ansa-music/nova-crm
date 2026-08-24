import { useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Sector, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface StatusChartProps {
  title: string;
  data: { name: string; value: number; color: string }[];
}

function sliceFill(color: string): string {
  const trimmed = color.trim();
  if (trimmed.startsWith("#") || trimmed.startsWith("hsl") || trimmed.startsWith("rgb")) return trimmed;
  return `hsl(${trimmed})`;
}

function GlassTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { name: string; value: number }[];
}) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2 text-[12px] shadow-sm">
      <p className="font-medium text-foreground">{item.name}</p>
      <p className="font-mono tabular text-primary">{item.value}</p>
    </div>
  );
}

function ActiveSlice(props: {
  cx?: number;
  cy?: number;
  innerRadius?: number;
  outerRadius?: number;
  startAngle?: number;
  endAngle?: number;
  fill?: string;
}) {
  const { cx = 0, cy = 0, innerRadius = 0, outerRadius = 0, startAngle = 0, endAngle = 0, fill } = props;
  return (
    <Sector
      cx={cx}
      cy={cy}
      innerRadius={innerRadius}
      outerRadius={outerRadius + 6}
      startAngle={startAngle}
      endAngle={endAngle}
      fill={fill}
      stroke="hsl(var(--border))"
      strokeWidth={1}
    />
  );
}

export function StatusChart({ title, data }: StatusChartProps) {
  const visible = data.filter((d) => d.value > 0);
  const hasData = visible.length > 0;
  const [activeIndex, setActiveIndex] = useState<number | undefined>(undefined);
  const total = visible.reduce((sum, d) => sum + d.value, 0);

  return (
    <Card className="desk-chart overflow-hidden rounded-2xl border-border bg-card">
      <CardHeader className="pb-2">
        <p className="eyebrow text-primary">Как идут статусы</p>
        <CardTitle className="text-base font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="h-72">
        {hasData ? (
          <div className="flex h-full flex-col">
            <div className="min-h-0 flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={visible}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={54}
                    outerRadius={82}
                    isAnimationActive={!window.matchMedia("(prefers-reduced-motion: reduce)").matches}
                    animationDuration={700}
                    paddingAngle={3}
                    stroke="transparent"
                    activeIndex={activeIndex}
                    activeShape={ActiveSlice}
                    onMouseEnter={(_, index) => setActiveIndex(index)}
                    onMouseLeave={() => setActiveIndex(undefined)}
                    cursor="pointer"
                  >
                    {visible.map((entry) => (
                      <Cell
                        key={entry.name}
                        fill={sliceFill(entry.color)}
                        opacity={activeIndex === undefined || visible[activeIndex]?.name === entry.name ? 1 : 0.35}
                      />
                    ))}
                  </Pie>
                  <Tooltip content={<GlassTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="mt-1 flex flex-wrap justify-center gap-x-3 gap-y-1 px-1 pb-1">
              {visible.map((entry, i) => (
                <li key={entry.name}>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                    onMouseEnter={() => setActiveIndex(i)}
                    onMouseLeave={() => setActiveIndex(undefined)}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: sliceFill(entry.color) }}
                    />
                    {entry.name}
                    <span className="font-mono tabular">{entry.value}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="text-center font-mono text-[10px] tabular text-muted-foreground">{total} записей</p>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Пока пусто</div>
        )}
      </CardContent>
    </Card>
  );
}
