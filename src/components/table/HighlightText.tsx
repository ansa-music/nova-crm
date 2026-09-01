import { Fragment } from "react";

interface HighlightTextProps {
  text: string;
  query: string;
  className?: string;
}

/**
 * Wraps every case-insensitive occurrence of `query` inside `text` in a
 * <mark>, so a table search visibly shows WHY a row matched instead of just
 * filtering silently. Plain text passthrough when the query is empty.
 */
export function HighlightText({ text, query, className }: HighlightTextProps) {
  const q = query.trim();
  if (!q || !text) return <>{text}</>;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const parts: { s: string; hit: boolean }[] = [];
  let i = 0;
  while (i < text.length) {
    const idx = lower.indexOf(needle, i);
    if (idx === -1) {
      parts.push({ s: text.slice(i), hit: false });
      break;
    }
    if (idx > i) parts.push({ s: text.slice(i, idx), hit: false });
    parts.push({ s: text.slice(idx, idx + needle.length), hit: true });
    i = idx + needle.length;
  }
  return (
    <>
      {parts.map((p, n) =>
        p.hit ? (
          <mark key={n} className={className ?? "table-search-mark"}>
            {p.s}
          </mark>
        ) : (
          <Fragment key={n}>{p.s}</Fragment>
        )
      )}
    </>
  );
}
