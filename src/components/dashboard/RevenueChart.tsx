import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/utils/format";

interface RevenueChartProps {
  data: { label: string; value: number }[];
}

function GlassTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-sm border border-primary/40 bg-card px-3 py-2 text-[12px] shadow-[0_0_24px_hsl(var(--primary)/0.28)] ">
      <p className="text-muted-foreground">{label}</p>
      <p className="font-mono tabular text-primary">{formatCurrency(payload[0].value)}</p>
    </div>
  );
}

export function RevenueChart({ data }: RevenueChartProps) {
  return (
    <Card className="desk-chart hud-frame lift-card overflow-hidden border-primary/25 bg-card/92 ">
      <CardHeader className="pb-2">
        <p className="eyebrow text-primary">С листа</p>
        <CardTitle className="text-base font-medium">По дате заказа с листа</CardTitle>
      </CardHeader>
      <CardContent className="h-72 pl-0 pr-3">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 16, left: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="orderDateGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.42} />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            />
            <Tooltip content={<GlassTooltip />} />
            <Area
              type="monotone"
              dataKey="value"
              isAnimationActive={!window.matchMedia("(prefers-reduced-motion: reduce)").matches}
              animationDuration={800}
              stroke="hsl(var(--primary))"
              strokeWidth={2.25}
              fill="url(#orderDateGradient)"
              activeDot={{ r: 5, fill: "hsl(var(--primary))", stroke: "#0B0F19", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
