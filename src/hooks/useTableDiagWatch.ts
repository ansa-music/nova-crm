import { useRef } from "react";
import { diag, isTableDiagEnabled } from "@/utils/tableDiag";

function describe(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value.length > 40 ? `${value.slice(0, 40)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.length}]`;
  return "{…}";
}

/**
 * Диагностика стола (`?diag=table`): что из входных данных страницы стола
 * сменилось на этом рендере. Объекты сравниваются по ссылке — новый объект
 * с тем же содержимым тоже считается («снимок пересобрал столы»), именно такие
 * и заставляют таблицу перерисовываться без видимой причины.
 */
export function useTableDiagWatch(label: string, values: Record<string, unknown>) {
  const prev = useRef<Record<string, unknown> | null>(null);
  if (!isTableDiagEnabled()) {
    prev.current = null;
    return;
  }
  diag(`render:${label}`);
  const before = prev.current;
  if (before) {
    for (const key of Object.keys(values)) {
      const a = before[key];
      const b = values[key];
      if (Object.is(a, b)) continue;
      diag(`change:${label}.${key}`, `${describe(a)} → ${describe(b)}`);
    }
  }
  prev.current = values;
}
