import { useId } from "react";

interface SparklineProps {
  points: number[];
  /** HSL triplet, e.g. "189 100% 72%" — та же конвенция, что StatusOption.color / WorkspacePage.accentColor. */
  color: string;
  width?: number;
  height?: number;
}

export function Sparkline({ points, color, width = 64, height = 28 }: SparklineProps) {
  const gradientId = useId();
  if (points.length < 2) return <svg width={width} height={height} aria-hidden="true" />;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const stepX = width / (points.length - 1);
  const coords = points.map((p, i) => {
    const x = i * stepX;
    const y = height - ((p - min) / range) * (height - 4) - 2;
    return [x, y] as const;
  });
  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const [lastX, lastY] = coords[coords.length - 1];

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={`hsl(${color})`} stopOpacity="0.32" />
          <stop offset="1" stopColor={`hsl(${color})`} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={line} fill="none" stroke={`hsl(${color})`} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r="2.3" fill={`hsl(${color})`} />
    </svg>
  );
}
