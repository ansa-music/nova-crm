import { useEffect, useMemo, useState } from "react";
import { ExternalLink, FileSpreadsheet, Link2, RefreshCw } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { pageChipClass } from "@/components/common/PageHeader";
import { refreshAbsSheet, type AbsSheetState } from "@/services/absSheetService";
import { buildSheetGrid, paintOf, type SheetTab } from "@/utils/absSheet";
import { cn } from "@/utils/cn";
import { formatDate, timeAgo } from "@/utils/date";

/** Высота строки — одна на всю сетку: по ней закреплённые строки липнут сверху. */
const ROW_H = 30;
/** Скрипт выходит на связь раз в 30 минут; дольше часа тишины — Owner'у стоит проверить. */
const SILENT_MS = 70 * 60_000;

function tabMemoryKey(ws: string) {
  return `nova:abs-sheet-tab:${ws}`;
}

function readTabMemory(ws: string): string | null {
  try {
    return localStorage.getItem(tabMemoryKey(ws));
  } catch {
    return null;
  }
}

function writeTabMemory(ws: string, name: string) {
  try {
    localStorage.setItem(tabMemoryKey(ws), name);
  } catch {
    /* память выбора — удобство, не данные */
  }
}

/** Часы для «N минут назад» — раз в 30 с. */
function useNow(stepMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(t);
  }, [stepMs]);
  return now;
}

/**
 * ABS → «Таблица»: листы Google-таблицы фин. отчёта как они есть — значения,
 * цвета строк, объединения, закреплённые строки и столбцы. Белый фон таблицы
 * становится фоном Nova (тёмная тема не превращается в белый лист), цветные
 * заливки остаются. Таблица прокручивается внутри рамки, страница — нет.
 */
export function AbsSheetView({
  workspaceId,
  state,
  isOwner,
  isLead,
  onSetup,
}: {
  workspaceId: string;
  state: AbsSheetState;
  isOwner: boolean;
  isLead: boolean;
  onSetup: () => void;
}) {
  const now = useNow();
  const tabs = state.sheet?.tabs ?? [];
  const [picked, setPicked] = useState<string | null>(() => readTabMemory(workspaceId));
  const tab: SheetTab | null = tabs.find((t) => t.name === picked) ?? tabs[0] ?? null;
  const [refreshing, setRefreshing] = useState(false);

  if (state.status === "idle" || state.status === "loading") {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  if (state.status === "missing") {
    return (
      <EmptyState
        bordered
        icon={<FileSpreadsheet />}
        title="Таблица в ABS ещё не включена в базе"
        description={isOwner ? "Вставьте свежий SQL (плашка сверху) — или он сам накатится со следующим деплоем." : "Скоро заработает."}
      />
    );
  }

  if (state.status === "error" && !state.sheet) {
    return (
      <Alert
        tone="error"
        title="Не удалось загрузить таблицу"
        action={
          <Button size="sm" variant="outline" onClick={() => void refreshAbsSheet(workspaceId)}>
            Повторить
          </Button>
        }
      >
        Проверьте связь и попробуйте ещё раз.
      </Alert>
    );
  }

  if (!state.allowed) {
    return <EmptyState bordered icon={<FileSpreadsheet />} title="Таблица открыта только руководству" description="Так решил Owner." />;
  }

  if (!state.connected) {
    return (
      <EmptyState
        bordered
        icon={<FileSpreadsheet />}
        title={isOwner ? "Подключите Google-таблицу" : "Таблица ещё не подключена"}
        description={
          isOwner
            ? "Листы фин. отчёта появятся здесь и будут обновляться сами — через секунды после правки в таблице. Таблица при этом остаётся закрытой."
            : "Owner подключит Google-таблицу фин. отчёта — и она будет здесь, с обновлением в реальном времени."
        }
        action={
          isOwner ? (
            <Button onClick={onSetup}>
              <Link2 className="h-4 w-4" />
              Подключить таблицу
            </Button>
          ) : undefined
        }
      />
    );
  }

  if (!state.sheet || !tab) {
    return (
      <EmptyState
        bordered
        icon={<FileSpreadsheet />}
        title="Ждём первую передачу из таблицы"
        description={
          isOwner
            ? "Вставьте скрипт в таблицу и запустите novaSetup — листы появятся здесь сами."
            : "Owner подключает таблицу — листы появятся здесь сами."
        }
        action={
          isOwner ? (
            <Button variant="outline" onClick={onSetup}>
              Подключение
            </Button>
          ) : undefined
        }
      />
    );
  }

  const silent = state.seenAt !== null && now - state.seenAt > SILENT_MS;
  const sheetUrl = state.sheet.id
    ? `https://docs.google.com/spreadsheets/d/${state.sheet.id}/edit${tab.gid !== null ? `#gid=${tab.gid}` : ""}`
    : null;

  const refresh = async () => {
    setRefreshing(true);
    try {
      await refreshAbsSheet(workspaceId);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-3" data-abs-sheet>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {tabs.length > 1 && (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5" role="tablist" aria-label="Листы таблицы">
            {tabs.map((t) => (
              <button
                key={t.name}
                type="button"
                role="tab"
                aria-selected={t.name === tab.name}
                className={pageChipClass(t.name === tab.name)}
                onClick={() => {
                  setPicked(t.name);
                  writeTabMemory(workspaceId, t.name);
                }}
              >
                {t.name}
              </button>
            ))}
          </div>
        )}
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" data-abs-sheet-updated>
          <span
            className={cn("inline-block h-2 w-2 shrink-0 rounded-full", silent ? "bg-warning" : "bg-success")}
            aria-hidden
          />
          {state.pushedAt ? (
            <span title={formatDate(state.pushedAt)}>
              Обновлено {formatDate(state.pushedAt, "d MMM, HH:mm")} · {timeAgo(Math.min(state.pushedAt, now))}
            </span>
          ) : (
            <span>Обновляется само</span>
          )}
        </p>
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={refreshing} aria-label="Обновить">
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          </Button>
          {sheetUrl && isLead && (
            <a
              href={sheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs hover:bg-accent"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Открыть в Google Таблицах
            </a>
          )}
          {isOwner && (
            <Button size="sm" variant="outline" onClick={onSetup}>
              Подключение
            </Button>
          )}
        </div>
      </div>

      {isOwner && silent && state.seenAt && (
        <Alert tone="warning" title={`Скрипт таблицы последний раз выходил на связь ${timeAgo(state.seenAt)}`}>
          Он выходит на связь хотя бы раз в 30 минут. Откройте таблицу → Расширения → Apps Script → «Триггеры» и
          проверьте, что они на месте, или запустите novaSetup ещё раз.
        </Alert>
      )}

      <SheetTable key={tab.name} tab={tab} />
    </div>
  );
}

function SheetTable({ tab }: { tab: SheetTab }) {
  const grid = useMemo(() => buildSheetGrid(tab), [tab]);
  // Закреплённые столбцы липнут слева: отступ — сумма ширин видимых столбцов до них.
  const leftOf = useMemo(() => {
    const out = new Map<number, number>();
    let x = 0;
    grid.cols.forEach((c, i) => {
      if (i < grid.frozenCols) out.set(c.col, x);
      x += c.width;
    });
    return out;
  }, [grid]);
  const totalWidth = grid.cols.reduce((n, c) => n + c.width, 0);

  if (grid.rows.length === 0 || grid.cols.length === 0) {
    return <EmptyState bordered title="Лист пуст" description="В таблице на этом листе пока нет данных." />;
  }

  return (
    <div
      className="max-h-[calc(100dvh-15rem)] min-h-40 w-fit max-w-full overflow-auto rounded-xl border border-border bg-card"
      data-abs-sheet-table
    >
      <table
        className="border-separate border-spacing-0 text-[13px] leading-tight"
        style={{ tableLayout: "fixed", width: totalWidth }}
      >
        <colgroup>
          {grid.cols.map((c) => (
            <col key={c.col} style={{ width: c.width }} />
          ))}
        </colgroup>
        <tbody>
          {grid.rows.map((row, ri) => {
            const frozenRow = ri < grid.frozenRows;
            return (
              <tr key={row.row} style={{ height: ROW_H }}>
                {row.cells.map((cell) => {
                  const paint = paintOf(cell.style);
                  const left = leftOf.get(cell.col);
                  const sticky = frozenRow || left !== undefined;
                  const align = cell.style.align === "r" ? "right" : cell.style.align === "c" ? "center" : "left";
                  return (
                    <td
                      key={cell.col}
                      rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                      colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
                      title={cell.text.length > 14 ? cell.text : undefined}
                      className={cn(
                        "overflow-hidden text-ellipsis whitespace-nowrap border-b border-r border-border/60 px-2 tabular-nums",
                        sticky && "sticky",
                        sticky && !paint.background && "bg-card"
                      )}
                      style={{
                        height: ROW_H * cell.rowSpan,
                        textAlign: align,
                        background: paint.background ?? undefined,
                        color: paint.color ?? undefined,
                        fontWeight: cell.style.bold ? 600 : undefined,
                        fontStyle: cell.style.italic ? "italic" : undefined,
                        top: frozenRow ? ri * ROW_H : undefined,
                        left,
                        zIndex: frozenRow && left !== undefined ? 3 : sticky ? 2 : undefined,
                      }}
                    >
                      {cell.text}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
