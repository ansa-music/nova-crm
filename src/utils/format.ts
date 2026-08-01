export function formatCurrency(value: number, currency = "KZT"): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value || 0);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value || 0);
}

export function parseNumeric(value: string): number {
  const digits = value.replace(/[^\d.-]/g, "");
  return parseFloat(digits) || 0;
}
