import type { PageColumn, PageRow } from "@/types";

export type QuickOrderInput = {
  client: string;
  number: string;
  os: string;
  check: string;
  persons: string;
  minutes: string;
};

function normLabel(label: string) {
  return label.trim().toLowerCase();
}

function firstMatch(columns: PageColumn[], re: RegExp): PageColumn | undefined {
  return columns.find((c) => re.test(normLabel(c.label)));
}

export function findQuickOrderColumns(visible: PageColumn[]) {
  const client = firstMatch(visible, /клиент|назван|имя/) ?? visible.find((c) => c.type === "text");
  const number = firstMatch(visible, /номер|тел|phone/);
  const os = firstMatch(visible, /^ос$|\bos\b/);
  const receipt = visible.find((c) => c.type === "currency") ?? firstMatch(visible, /цена|сумм|чек/);
  const persons = firstMatch(visible, /перс|персонаж/);
  const minutes = firstMatch(visible, /мин/);
  return { client, number, os, receipt, persons, minutes };
}

export function parseOptionalNumber(raw: string): number | null {
  const t = raw.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function buildQuickOrderRow(
  allColumns: PageColumn[],
  visible: PageColumn[],
  input: QuickOrderInput
): {
  cells: Record<string, string | number | null>;
  extras?: PageRow["extras"];
  nameKey: string | null;
} {
  const cols = findQuickOrderColumns(visible);
  const cells: Record<string, string | number | null> = {};
  for (const c of allColumns) cells[c.key] = "";

  const client = input.client.trim();
  const number = input.number.trim();
  const os = input.os.trim();
  const check = parseOptionalNumber(input.check);
  if (cols.client) cells[cols.client.key] = client;
  if (cols.number && number) cells[cols.number.key] = number;
  if (cols.os && os) cells[cols.os.key] = os;
  if (cols.receipt && check != null) cells[cols.receipt.key] = check;

  const persons = parseOptionalNumber(input.persons);
  const minutes = parseOptionalNumber(input.minutes);
  if (cols.persons && persons != null) cells[cols.persons.key] = persons;
  if (cols.minutes && minutes != null) cells[cols.minutes.key] = minutes;

  const extras: NonNullable<PageRow["extras"]> = {};
  if (persons != null) extras.persons = persons;
  if (minutes != null) extras.minutes = minutes;
  const hasExtras = extras.persons != null || extras.minutes != null;

  return {
    cells,
    extras: hasExtras ? extras : undefined,
    nameKey: cols.client?.key ?? null,
  };
}

export function formatRowExtrasHint(extras?: PageRow["extras"] | null): string | null {
  if (!extras) return null;
  const parts: string[] = [];
  if (extras.persons != null) parts.push(`${extras.persons} перс`);
  if (extras.minutes != null) parts.push(`${extras.minutes} мин`);
  return parts.length ? parts.join(" · ") : null;
}
