import { useEffect, useMemo, useSyncExternalStore } from "react";
import { Link } from "react-router";
import { ArrowRightLeft, Send, Undo2 } from "lucide-react";
import { AccessDenied } from "@/components/common/AccessDenied";
import { PageHeader, pageChipClass } from "@/components/common/PageHeader";
import { describeOsDispatch, useCanSeeOsDispatchLog } from "@/hooks/useOsDispatchLogWatch";
import { useUrlState } from "@/hooks/useUrlState";
import { deskNavState, deskRowHref } from "@/utils/deskLinks";
import { toast } from "@/components/ui/sonner";
import {
  loadMoreOsDispatchLog,
  markOsDispatchLogSeen,
  osDispatchLogState,
  subscribeOsDispatchLogState,
  type OsDispatchKind,
  type OsDispatchLogEntry,
} from "@/services/osDispatchLogService";
import { cn } from "@/utils/cn";
import { formatDateTimeManual, timeAgo } from "@/utils/date";
import { formatCurrency } from "@/utils/format";

type Filter = "all" | "today" | OsDispatchKind;
const FILTERS: readonly Filter[] = ["all", "today", "assign", "move", "unassign"];

const KIND_ICON = { assign: Send, move: ArrowRightLeft, unassign: Undo2 } as const;
const KIND_TONE: Record<OsDispatchKind, string> = {
  assign: "bg-primary/15 text-primary",
  move: "bg-warning/15 text-warning",
  unassign: "bg-muted text-muted-foreground",
};

function startOfTodayAlmaty(now: number): number {
  // Алматы — UTC+5 без перехода на летнее время.
  const shifted = now + 5 * 3_600_000;
  return shifted - (shifted % 86_400_000) - 5 * 3_600_000;
}

/**
 * «Выдачи ОС» — мониторинг выборочных выдач заказов для Тимлида и Owner
 * (просьба Nurba 23.09.2026). Сюда попадает каждый заказ, который ОС отдал со
 * своего стола выбранному технарю, смена технаря и снятие заказа. Заказы,
 * отданные через биржу, живут на «Заказах».
 */
export default function OsDispatchPage() {
  const canSee = useCanSeeOsDispatchLog();
  const log = useSyncExternalStore(subscribeOsDispatchLogState, osDispatchLogState);
  // Фильтр — в адресе (`?f=today`): F5 и ссылка коллеге открывают тот же.
  const [filter, setFilter] = useUrlState<Filter>("f", "all", { values: FILTERS });

  // Открыл вкладку — всё, что сейчас в списке, просмотрено; пришло новое,
  // пока вкладка открыта, — тоже.
  useEffect(() => {
    if (canSee && log.loaded && log.unseen > 0) markOsDispatchLogSeen();
  }, [canSee, log.loaded, log.unseen]);

  const todayStart = startOfTodayAlmaty(Date.now());
  // Сразу загружено только живое окно (последние 25), старее — по «Показать
  // ещё». Поэтому при `hasMore` счётчики — «не меньше»: «Сегодня» точен, только
  // если самая старая загруженная выдача уже вчерашняя. Список из кэша (сервер
  // ещё не ответил) — тоже «не меньше»: за время перерыва могли быть выдачи.
  const incomplete = log.hasMore || log.fromCache;
  const oldestLoaded = log.entries.length ? log.entries[log.entries.length - 1].createdAt : 0;
  const todayComplete = !incomplete || (!log.fromCache && oldestLoaded < todayStart);
  const counts = useMemo(() => {
    const c = { all: log.entries.length, today: 0, assign: 0, move: 0, unassign: 0 };
    for (const e of log.entries) {
      if (e.createdAt >= todayStart) c.today += 1;
      c[e.kind] += 1;
    }
    return c;
  }, [log.entries, todayStart]);

  const shown = useMemo(
    () =>
      log.entries.filter((e) =>
        filter === "all" ? true : filter === "today" ? e.createdAt >= todayStart : e.kind === filter
      ),
    [log.entries, filter, todayStart]
  );

  if (!canSee) {
    return <AccessDenied title="Выдачи ОС" reason="Этот раздел — для Тимлида и Owner." backTo={{ to: "/orders", label: "Заказы" }} />;
  }

  const chips: Array<{ id: Filter; label: string; count: number; partial: boolean }> = [
    { id: "all", label: "Все", count: counts.all, partial: incomplete },
    { id: "today", label: "Сегодня", count: counts.today, partial: !todayComplete },
    { id: "assign", label: "Выдал", count: counts.assign, partial: incomplete },
    { id: "move", label: "Передал", count: counts.move, partial: incomplete },
    { id: "unassign", label: "Забрал", count: counts.unassign, partial: incomplete },
  ];

  const loadMore = () => {
    loadMoreOsDispatchLog().catch((error: { code?: string; message?: string }) =>
      toast.error("Не удалось дочитать журнал", { description: error.code || error.message })
    );
  };

  return (
    <div className="mx-auto w-full min-w-0 max-w-4xl p-4 sm:p-8">
      <PageHeader
        eyebrow="Мониторинг"
        title="Выдачи ОС"
        description="Каждый заказ, который ОС отдал со своего стола выбранному технарю, — сразу, как это случилось. Смена технаря и снятие заказа — тоже здесь. Заказы через биржу — на «Заказах»."
        filters={
          <div className="flex flex-wrap gap-2">
            {chips.map((chip) => (
              <button key={chip.id} type="button" className={pageChipClass(filter === chip.id)} onClick={() => setFilter(chip.id)}>
                {chip.label}
                <span className="tabular-nums opacity-70">
                  {chip.count}
                  {chip.partial ? "+" : ""}
                </span>
              </button>
            ))}
          </div>
        }
      />

      {log.error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Журнал не прочитан ({log.error}). Обновите страницу.
        </p>
      ) : !log.loaded ? (
        <p className="text-sm text-muted-foreground">Загружаю…</p>
      ) : shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {filter === "all"
            ? log.fromCache
              ? "Загружаю…"
              : "Выборочных выдач пока не было."
            : (filter === "today" ? !todayComplete : incomplete)
              ? "Среди загруженных выдач таких нет."
              : "Здесь пусто."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((entry) => (
            <DispatchRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
      {log.loaded && log.hasMore && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={log.loadingMore}
            className="min-h-11 rounded-full border border-border px-4 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60 sm:min-h-0 sm:py-1.5"
          >
            {log.loadingMore ? "Загружаю…" : "Показать ещё"}
          </button>
        </div>
      )}
    </div>
  );
}

function DispatchRow({ entry }: { entry: OsDispatchLogEntry }) {
  const Icon = KIND_ICON[entry.kind];
  return (
    <li className="flex min-w-0 items-start gap-3 rounded-xl border border-border bg-card p-3">
      <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", KIND_TONE[entry.kind])}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{describeOsDispatch(entry)}</p>
        <p className="truncate text-sm text-muted-foreground">
          {entry.client || "Без имени"}
          {entry.phone ? ` · ${entry.phone}` : ""}
          {entry.amount ? ` · ${formatCurrency(entry.amount)}` : ""}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground" title={formatDateTimeManual(entry.createdAt)}>
          {timeAgo(entry.createdAt)} ·{" "}
          <Link
            // Вкладки в журнале нет — стол сам найдёт строку по id.
            to={deskRowHref(entry.srcPageId, undefined, entry.srcRowId)}
            state={deskNavState({ to: "/os-dispatch", label: "Выдачи ОС" })}
            className="underline-offset-2 hover:underline"
          >
            стол ОС
          </Link>
        </p>
      </div>
    </li>
  );
}
