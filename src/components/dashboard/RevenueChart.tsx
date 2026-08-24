import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface RevenueChartProps {
  data: { label: string; value: number }[];
}

export function RevenueChart({ data }: RevenueChartProps) {
  return (
    <Card className="border-border/70 bg-card/70">
      <CardHeader className="pb-2">
        <p className="eyebrow">Динамика</p>
        <CardTitle className="text-base font-medium">Доход по месяцам</CardTitle>
      </CardHeader>
      <CardContent className="h-72 pl-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 24, left: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.36} />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
            <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} width={48} />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 6,
                fontSize: 13,
              }}
              formatter={(value: number) => [new Intl.NumberFormat("ru-RU").format(value), "Доход"]}
            />
            <Area type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2.5} fill="url(#revenueGradient)" />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
