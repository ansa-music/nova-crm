import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ExternalLink, FileSpreadsheet, Link2, Plus, RefreshCw, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/EmptyState";
import { PageHeader, pageChipClass } from "@/components/common/PageHeader";
import { OsSheetAddRowDialog } from "@/components/ossheet/OsSheetAddRowDialog";
import { OsSheetGrid } from "@/components/ossheet/OsSheetGrid";
import { OsSheetSetupDialog } from "@/components/ossheet/OsSheetSetupDialog";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAmountsHidden } from "@/hooks/useAmountsHidden";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  dismissOsSheetEdit,
  editOsSheetCells,
  effectiveValue,
  osSheetErrorText,
  refreshOsSheet,
  retryOsSheetEdit,
  useOsSheet,
  type CellEditInput,
  type LocalEdit,
  type OsSheetSnapshot,
} from "@/services/osSheetService";
import { cn } from "@/utils/cn";
import { formatDate, timeAgo } from "@/utils/date";
import { myDisplayName } from "@/utils/displayName";
import { columnTitle, osEditReasonText, type OsSheetTab } from "@/utils/osSheet";
import { hasFullAccess } from "@/utils/permissions";
import { pushUndoCommand } from "@/utils/undoStore";

/** Скрипт выходит на связь раз в минуту; дольше 10 минут тишины — правки не доходят. */
const SILENT_MS = 10 * 60_000;

function tabMemoryKey(ws: string) {
  return `nova:os-sheet-tab:${ws}`;
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

function useNow(stepMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(t);
  }, [stepMs]);
  return now;
}

/**
 * «Таблица ОС» (просьба 20.10.2026: «такую таблицу для ОС — редактируемую
 * сразу с сайта»): Google-таблица ОС (реестр продаж) прямо в Nova. ОС и
 * руководство правят ячейки и добавляют строки — правки уходят в саму
 * Google-таблицу через её скрипт (services/osSheetService.ts), формулы и
 * цвета приходят обратно оттуда. Подключает Owner (окно «Подключение»).
 *
 * При «Скрыть суммы» таблица (в ней деньги) открыта только руководству —
 * как «Таблица» в ABS.
 */
export default function OsSheetPage() {
  const { activeWorkspaceId, members } = useWorkspace();
  const permissions = usePermissions();
  const { profile } = useAuth();
  const amountsHidden = useAmountsHidden();
  const isOwner = permissions.actsAsOwner;
  const isLead = permissions.isResolved && hasFullAccess(permissions.role);
  const hiddenByAmounts = amountsHidden && !isLead;
  const ws = activeWorkspaceId ?? "";
  const snap = useOsSheet(activeWorkspaceId, permissions.isResolved && !hiddenByAmounts, true);
  const { state } = snap;
  const now = useNow();
  const [setupOpen, setSetupOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [picked, setPicked] = useState<string | null>(() => (ws ? readTabMemory(ws) : null));
  const tabs = state.data?.tabs ?? [];
  const tab: OsSheetTab | null = tabs.find((t) => t.meta.name === picked) ?? tabs[0] ?? null;
  const myName = useMemo(() => myDisplayName(profile, members), [profile, members]);
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const failed = snap.edits.filter((e) => e.status === "failed");
  const waiting = snap.edits.filter((e) => e.status !== "failed").length;

  const refresh = async () => {
    if (!ws) return;
    setRefreshing(true);
    try {
      await refreshOsSheet(ws);
    } finally {
      setRefreshing(false);
    }
  };

  const onEdit = (target: OsSheetTab, cells: CellEditInput[]) => {
    if (!ws) return;
    const before = cells.map((cell) => ({ ...cell, value: effectiveValue(snap, target, cell.r, cell.c) }));
    const run = (list: CellEditInput[]) => {
      // Лист берём свежий: строки могли обновиться, пока правка ждала.
      const fresh = currentTab(target.meta.name, snapRef.current) ?? target;
      return editOsSheetCells(ws, fresh, list).catch((e) => {
        toast.error(osSheetErrorText(e));
      });
    };
    void editOsSheetCells(ws, target, cells)
      .then(() => pushUndoCommand({ undo: () => run(before), redo: () => run(cells) }))
      .catch((e) => toast.error(osSheetErrorText(e)));
  };

  const header = (
    <PageHeader
      eyebrow="ОС · Google-таблица"
      title="Таблица ОС"
      description={
        state.title
          ? `«${state.title}» — правки уходят в саму таблицу, формулы и цвета приходят оттуда.`
          : "Google-таблица ОС прямо здесь: правки уходят в саму таблицу, формулы и цвета приходят оттуда."
      }
      actions={
        <div className="flex flex-wrap items-center gap-1.5">
          {state.canEdit && tab && (
            <Button size="sm" onClick={() => setAddOpen(true)} data-os-sheet-add-open>
              <Plus className="h-4 w-4" />
              Новая строка
            </Button>
          )}
          {state.data?.id && isLead && (
            <a
              href={`https://docs.google.com/spreadsheets/d/${state.data.id}/edit${tab?.meta.gid != null ? `#gid=${tab.meta.gid}` : ""}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs hover:bg-accent"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Открыть в Google Таблицах
            </a>
          )}
          {isOwner && (
            <Button size="sm" variant="outline" onClick={() => setSetupOpen(true)}>
              Подключение
            </Button>
          )}
        </div>
      }
    />
  );

  let body: ReactNode;
  if (hiddenByAmounts) {
    body = <EmptyState bordered icon={<FileSpreadsheet />} title="Суммы скрыты" description="Пока Owner скрывает суммы, таблица ОС открыта только руководству." />;
  } else if (state.status === "idle" || state.status === "loading" || !permissions.isResolved) {
    body = (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  } else if (state.status === "missing") {
    body = (
      <EmptyState
        bordered
        icon={<FileSpreadsheet />}
        title="Таблица ОС ещё не включена в базе"
        description={isOwner ? "Вставьте свежий SQL (плашка сверху) — или он сам накатится со следующим деплоем." : "Скоро заработает."}
      />
    );
  } else if (state.status === "error" && !state.data) {
    body = (
      <Alert
        tone="error"
        title="Не удалось загрузить таблицу"
        action={
          <Button size="sm" variant="outline" onClick={() => void refresh()}>
            Повторить
          </Button>
        }
      >
        Проверьте связь и попробуйте ещё раз.
      </Alert>
    );
  } else if (!state.allowed) {
    body = <EmptyState bordered icon={<FileSpreadsheet />} title="Таблица ОС открыта только ОС и руководству" description="Так решил Owner." />;
  } else if (!state.connected) {
    body = (
      <EmptyState
        bordered
        icon={<FileSpreadsheet />}
        title={isOwner ? "Подключите Google-таблицу ОС" : "Таблица ещё не подключена"}
        description={
          isOwner
            ? "Листы появятся здесь и будут обновляться сами, а ОС смогут править их прямо из Nova — правки уходят в саму таблицу."
            : "Owner подключит Google-таблицу ОС — и её можно будет править прямо здесь."
        }
        action={
          isOwner ? (
            <Button onClick={() => setSetupOpen(true)}>
              <Link2 className="h-4 w-4" />
              Подключить таблицу
            </Button>
          ) : undefined
        }
      />
    );
  } else if (!tab) {
    body = (
      <EmptyState
        bordered
        icon={<FileSpreadsheet />}
        title="Ждём первую передачу из таблицы"
        description={isOwner ? "Вставьте скрипт в таблицу и запустите novaSetup — листы появятся здесь сами." : "Owner подключает таблицу — листы появятся здесь сами."}
        action={
          isOwner ? (
            <Button variant="outline" onClick={() => setSetupOpen(true)}>
              Подключение
            </Button>
          ) : undefined
        }
      />
    );
  } else {
    const silent = state.seenAt !== null && now - state.seenAt > SILENT_MS;
    body = (
      <div className="flex min-w-0 flex-col gap-3" data-os-sheet>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {tabs.length > 1 && (
            <div className="flex min-w-0 flex-wrap items-center gap-1.5" role="tablist" aria-label="Листы таблицы">
              {tabs.map((t) => (
                <button
                  key={t.meta.name}
                  type="button"
                  role="tab"
                  aria-selected={t.meta.name === tab.meta.name}
                  className={pageChipClass(t.meta.name === tab.meta.name)}
                  onClick={() => {
                    setPicked(t.meta.name);
                    writeTabMemory(ws, t.meta.name);
                  }}
                >
                  {t.meta.name}
                </button>
              ))}
            </div>
          )}
          <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground" data-os-sheet-updated>
            <span className={cn("inline-block h-2 w-2 shrink-0 rounded-full", silent ? "bg-warning" : "bg-success")} aria-hidden />
            {state.pushedAt ? (
              <span title={formatDate(state.pushedAt)}>
                Обновлено {formatDate(state.pushedAt, "d MMM, HH:mm")} · {timeAgo(Math.min(state.pushedAt, now))}
              </span>
            ) : (
              <span>Обновляется само</span>
            )}
            {waiting > 0 && <span className="text-primary">· отправляется в таблицу: {waiting}</span>}
            {!state.canEdit && <span>· только просмотр</span>}
          </p>
          <div className="ml-auto flex items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={refreshing} aria-label="Обновить">
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            </Button>
          </div>
        </div>

        {silent && state.seenAt && (
          <Alert tone="warning" title={`Скрипт таблицы последний раз выходил на связь ${timeAgo(state.seenAt)}`}>
            {state.canEdit ? "Правки из Nova ждут его в очереди и лягут в таблицу, когда он вернётся. " : ""}
            {isOwner
              ? "Откройте таблицу → Расширения → Apps Script → «Триггеры» и проверьте, что они на месте, или запустите novaSetup ещё раз."
              : "Owner уже может проверить подключение."}
          </Alert>
        )}

        {failed.length > 0 && <FailedEdits ws={ws} edits={failed} snap={snap} />}

        <OsSheetGrid key={tab.meta.name} tab={tab} snap={snap} canEdit={state.canEdit} onEdit={(cells) => onEdit(tab, cells)} />

        <PendingRows edits={snap.edits.filter((e) => e.add && e.status !== "failed" && e.tab === tab.meta.name)} tab={tab} />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {header}
      {body}
      {isOwner && ws && <OsSheetSetupDialog workspaceId={ws} open={setupOpen} onOpenChange={setSetupOpen} />}
      {tab && ws && state.canEdit && (
        <OsSheetAddRowDialog workspaceId={ws} tab={tab} myName={myName} open={addOpen} onOpenChange={setAddOpen} />
      )}
    </div>
  );
}

/** Лист из последнего снимка — для отмены правки (Ctrl+Z), которая сработает позже. */
function currentTab(name: string, snap: OsSheetSnapshot | null): OsSheetTab | null {
  return snap?.state.data?.tabs.find((t) => t.meta.name === name) ?? null;
}

function describeEdit(edit: LocalEdit, snap: OsSheetSnapshot): string {
  const tab = snap.state.data?.tabs.find((t) => t.meta.name === edit.tab);
  if (edit.add) {
    const first = edit.add.find(([, v]) => v.trim())?.[1] ?? "";
    return `Новая строка${first ? ` «${first}»` : ""}`;
  }
  const col = tab && edit.c !== null ? columnTitle(tab, edit.c) : "Ячейка";
  return `${col}, строка ${(edit.r ?? 0) + 1}: «${edit.value || "пусто"}»`;
}

function FailedEdits({ ws, edits, snap }: { ws: string; edits: LocalEdit[]; snap: OsSheetSnapshot }) {
  return (
    <Alert tone="error" title={`Не легло в таблицу: ${edits.length}`} data-os-sheet-failed>
      <ul className="mt-1 flex flex-col gap-1">
        {edits.slice(0, 8).map((e) => (
          <li key={e.key} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="min-w-0">
              {describeEdit(e, snap)} — {osEditReasonText(e.reason)}
            </span>
            <span className="ml-auto flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2"
                onClick={() => void retryOsSheetEdit(ws, e.key).catch((err) => toast.error(osSheetErrorText(err)))}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Повторить
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => dismissOsSheetEdit(ws, e.key)} aria-label="Скрыть">
                <X className="h-3.5 w-3.5" />
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </Alert>
  );
}

/** Новые строки, которые ещё едут в таблицу. */
function PendingRows({ edits, tab }: { edits: LocalEdit[]; tab: OsSheetTab }) {
  if (edits.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-dashed border-primary/40 bg-primary/5 px-3 py-2 text-sm" data-os-sheet-pending-rows>
      {edits.map((e) => (
        <p key={e.key} className="flex min-w-0 items-center gap-2 text-muted-foreground">
          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary" aria-hidden />
          <span className="truncate">
            Новая строка отправляется в таблицу:{" "}
            {(e.add ?? [])
              .slice(0, 4)
              .map(([c, v]) => `${columnTitle(tab, c)} — ${v}`)
              .join(" · ")}
          </span>
        </p>
      ))}
    </div>
  );
}
