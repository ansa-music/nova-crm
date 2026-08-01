export function downloadCsv(filename: string, header: string[], rows: string[][]) {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const csv = [header.map(escape).join(";"), ...rows.map((r) => r.map(escape).join(";"))].join(
    "\n"
  );
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
