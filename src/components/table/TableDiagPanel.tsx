import { useEffect, useState, useSyncExternalStore } from "react";
import { useLocation } from "react-router";
import { usePermissions } from "@/hooks/usePermissions";
import {
  clearTableDiag,
  diag,
  disableTableDiag,
  subscribeTableDiag,
  summarizeTableDiag,
  syncTableDiagFlag,
  tableDiagEnabledSnapshot,
  type DiagSummary,
} from "@/utils/tableDiag";

const WINDOW_MS = 10_000;

function nodeLabel(node: Node | null | undefined): string {
  if (!node || node.nodeType !== 1) return "?";
  const el = node as Element;
  const cls = typeof el.className === "string" ? el.className.split(/\s+/).filter(Boolean).slice(0, 3).join(".") : "";
  return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}`;
}

/**
 * Плашка диагностики стола (`?diag=table`, см. utils/tableDiag.ts): что
 * происходит на экране за последние 10 с — перерисовки, сдвиги вёрстки,
 * вставки таблицы и скелета, приход строк, запросы в сеть. «Скопировать»
 * кладёт в буфер текст, который человек присылает в чат. В базу не пишет.
 */
export function TableDiagPanel() {
  const location = useLocation();
  const enabled = useSyncExternalStore(subscribeTableDiag, tableDiagEnabledSnapshot, tableDiagEnabledSnapshot);

  useEffect(() => {
    syncTableDiagFlag(new URLSearchParams(location.search).get("diag"));
  }, [location.search]);

  if (!enabled) return null;
  return <PanelBody />;
}

function PanelBody() {
  const permissions = usePermissions();
  const location = useLocation();
  const [rows, setRows] = useState<DiagSummary[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    diag("nav", location.pathname + location.search);
  }, [location.pathname, location.search]);

  // Что меняется в DOM: вставки таблицы и скелета, общее число мутаций.
  useEffect(() => {
    let mutations = 0;
    const mo = new MutationObserver((list) => {
      for (const m of list) {
        if ((m.target as Element)?.closest?.("[data-table-diag]")) continue;
        mutations += 1;
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          const el = n as Element;
          if (el.matches("table") || el.querySelector("table")) diag("dom:table-inserted", nodeLabel(el));
          if (el.matches(".animate-pulse") || el.querySelector(".animate-pulse")) diag("dom:skeleton-inserted", nodeLabel(el));
        }
        if (m.type === "attributes" && m.attributeName) diag(`dom:attr:${m.attributeName}`, nodeLabel(m.target));
      }
    });
    mo.observe(document.body, { subtree: true, childList: true, attributes: true });
    const tick = window.setInterval(() => {
      if (mutations > 0) diag("dom:mutations/s", String(mutations));
      mutations = 0;
    }, 1000);
    return () => {
      mo.disconnect();
      window.clearInterval(tick);
    };
  }, []);

  // Сдвиги вёрстки (Layout Instability API, Chrome) и запросы в сеть.
  useEffect(() => {
    const observers: PerformanceObserver[] = [];
    try {
      const ls = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & { value?: number; sources?: Array<{ node?: Node | null }> };
          const nodes = (shift.sources ?? []).map((s) => s.node).filter((n): n is Node => Boolean(n));
          // Сдвиги самой плашки (она растёт, когда появляются строки) — не в счёт.
          if (nodes.length > 0 && nodes.every((n) => (n as Element).closest?.("[data-table-diag]"))) continue;
          const src = nodes.map((n) => nodeLabel(n)).slice(0, 3).join(" | ");
          diag("layout-shift", `${(shift.value ?? 0).toFixed(4)} ${src}`);
        }
      });
      ls.observe({ type: "layout-shift", buffered: false });
      observers.push(ls);
    } catch {
      /* не Chrome — без сдвигов */
    }
    try {
      const net = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          try {
            const url = new URL(entry.name);
            if (url.origin === window.location.origin) continue;
            const path = url.pathname.replace(/\/[A-Za-z0-9_-]{20,}/g, "/…");
            diag(`net:${url.hostname.split(".")[0]}${path}`.slice(0, 90));
          } catch {
            /* не адрес */
          }
        }
      });
      net.observe({ type: "resource", buffered: false });
      observers.push(net);
    } catch {
      /* без Resource Timing */
    }
    return () => observers.forEach((o) => o.disconnect());
  }, []);

  useEffect(() => {
    const update = () => setRows(summarizeTableDiag(WINDOW_MS));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, []);

  function copy() {
    const text = JSON.stringify(
      {
        at: new Date().toISOString(),
        url: location.pathname + location.search,
        role: permissions.role,
        realRole: permissions.realRole,
        simulating: permissions.isSimulating,
        viewport: `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`,
        ua: navigator.userAgent,
        last30s: summarizeTableDiag(30_000),
      },
      null,
      1
    );
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => window.prompt("Скопируйте текст диагностики", text));
  }

  return (
    <div
      data-table-diag
      className="fixed bottom-2 left-2 z-[500] w-[340px] max-w-[calc(100vw-1rem)] rounded-lg border border-warning/40 bg-popover/95 p-2 font-mono text-[10.5px] leading-tight text-foreground shadow-lg"
    >
      <div className="mb-1 flex items-center gap-1.5">
        <span className="font-semibold text-warning">Диагностика стола · 10 с</span>
        <span className="ml-auto" />
        <button type="button" className="rounded border border-border px-1.5 py-0.5 hover:bg-accent" onClick={copy}>
          {copied ? "Скопировано" : "Скопировать"}
        </button>
        <button type="button" className="rounded border border-border px-1.5 py-0.5 hover:bg-accent" onClick={clearTableDiag}>
          Сброс
        </button>
        <button type="button" className="rounded border border-border px-1.5 py-0.5 hover:bg-accent" onClick={disableTableDiag}>
          ✕
        </button>
      </div>
      <div className="max-h-[40vh] overflow-auto">
        {rows.length === 0 ? (
          <p className="text-muted-foreground">Тихо — ничего не происходит.</p>
        ) : (
          rows.slice(0, 30).map((row) => (
            <div key={row.name} className="flex gap-2 border-t border-border/40 py-0.5 first:border-t-0">
              <span className="w-8 shrink-0 text-right tabular-nums text-warning">{row.count}</span>
              <span className="min-w-0 flex-1 break-all">
                {row.name}
                {row.details.length > 0 && (
                  <span className="block text-muted-foreground">{row.details[row.details.length - 1]}</span>
                )}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
