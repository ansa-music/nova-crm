/** Parse a spreadsheet clipboard (Excel / Sheets TSV, including a single cell). */
export function parseClipboardMatrix(text: string): string[][] {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const trimmedEnd = normalized.replace(/\n+$/, "");
  if (!trimmedEnd) return [[""]];

  const unquotedSingle =
    trimmedEnd.startsWith('"') &&
    trimmedEnd.endsWith('"') &&
    !trimmedEnd.slice(1, -1).includes("\t") &&
    countUnescapedQuotes(trimmedEnd) === 2;
  if (unquotedSingle) {
    return [[trimmedEnd.slice(1, -1).replace(/""/g, '"')]];
  }

  if (!trimmedEnd.includes("\t") && !trimmedEnd.includes("\n")) {
    return [[trimmedEnd]];
  }

  return parseTsv(trimmedEnd);
}

function countUnescapedQuotes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"') n += 1;
  }
  return n;
}

function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === "\t") {
      row.push(cell);
      cell = "";
      i += 1;
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}
