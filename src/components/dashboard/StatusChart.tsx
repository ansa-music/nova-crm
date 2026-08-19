import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface StatusChartProps {
  title: string;
  data: { name: string; value: number; color: string }[];
}

export function StatusChart({ title, data }: StatusChartProps) {
  const hasData = data.some((d) => d.value > 0);
  return (
    <Card className="border-white/80 bg-card/90 shadow-card dark:border-border">
      <CardHeader className="pb-2">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Воронка</p>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent className="h-72">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3}>
                {data.map((entry) => (
                  <Cell key={entry.name} fill={`hsl(${entry.color})`} stroke="transparent" />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 13,
                }}
              />
              <Legend
                verticalAlign="bottom"
                iconType="circle"
                iconSize={8}
                formatter={(value) => <span className="text-xs text-muted-foreground">{value}</span>}
              />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Пока нет данных
          </div>
        )}
      </CardContent>
    </Card>
  );
}
