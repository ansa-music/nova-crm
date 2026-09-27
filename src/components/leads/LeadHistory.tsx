import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchOrderEvents, fetchRecentEvents, type LeadEvent, type LeadOrder } from "@/services/leadBoardService";
import { formatDate } from "@/utils/date";
import { firestoreErrorText } from "@/utils/dbError";
import { personLabel } from "@/utils/peopleDesks";
import { resolveTechIdentity } from "@/utils/techIdentity";
import type { StatusOption, WorkspaceMember, WorkspacePage } from "@/types";

export interface LeadHistoryContext {
  members: readonly WorkspaceMember[];
  statusOptions: readonly StatusOption[];
  techNickOptions: readonly StatusOption[];
  pagesById: ReadonlyMap<string, WorkspacePage>;
}

function who(uid: string | null, ctx: LeadHistoryContext): string {
  if (!uid) return "система";
  const m = ctx.members.find((x) => x.uid === uid);
  return personLabel(m) || "бывший участник";
}

function statusLabel(value: string | null, ctx: LeadHistoryContext): string {
  if (!value) return "без статуса";
  return ctx.statusOptions.find((o) => o.value === value)?.label ?? value;
}

function techLabel(nick: string | null, ctx: LeadHistoryContext): string {
  if (!nick) return "никого";
  return resolveTechIdentity(nick, ctx.members, ctx.techNickOptions)?.label ?? nick;
}

function deskOwnerLabel(pageId: string | null, ctx: LeadHistoryContext): string {
  if (!pageId) return "";
  const page = ctx.pagesById.get(pageId);
  return page?.responsibleUserId ? who(page.responsibleUserId, ctx) : "";
}

function money(v: string | null): string {
  return v && v.trim() ? v : "—";
}

/** Одна строка истории по-русски: «статус: Утверждение → В работе». */
export function eventText(e: LeadEvent, ctx: LeadHistoryContext): string {
  switch (e.kind) {
    case "created":
      return e.newValue ? `завёл заказ · ${statusLabel(e.newValue, ctx)}` : "завёл заказ";
    case "status":
      return `${e.field === "tech" ? "статус у технаря" : "статус"}: ${statusLabel(e.oldValue, ctx)} → ${statusLabel(e.newValue, ctx)}`;
    case "tech":
      return `технарь: ${techLabel(e.oldValue, ctx)} → ${techLabel(e.newValue, ctx)}`;
    case "issued": {
      const to = deskOwnerLabel(e.newValue, ctx);
      return to ? `заказ уехал к технарю ${to}` : "заказ уехал к технарю";
    }
    case "unissued": {
      const from = deskOwnerLabel(e.oldValue, ctx);
      return from ? `заказ снят с технаря ${from}` : "заказ снят с технаря";
    }
    case "amount":
      return `${e.field === "upsell" ? "апсейл" : "цена"}: ${money(e.oldValue)} → ${money(e.newValue)}`;
    case "carried":
      return "перенесён в новый период";
    case "deleted":
      return "строка удалена";
    case "os":
      return `ОС: ${who(e.oldValue, ctx)} → ${who(e.newValue, ctx)}`;
    default:
      return e.kind;
  }
}

function EventLine({ e, ctx, title }: { e: LeadEvent; ctx: LeadHistoryContext; title?: string }) {
  return (
    <div className="flex gap-3 py-2 text-[13px]">
      <span className="w-[5.5rem] shrink-0 font-mono text-[11.5px] tabular-nums text-muted-foreground">{formatDate(e.at, "dd.MM HH:mm")}</span>
      <span className="min-w-0 flex-1">
        {title ? <span className="mr-1 font-medium text-foreground">{title} ·</span> : null}
        <span className="text-foreground/90">{eventText(e, ctx)}</span>
        <span className="text-muted-foreground"> — {who(e.actorUid, ctx)}</span>
      </span>
    </div>
  );
}

/** История одного заказа: кто завёл, статусы, технари, ОС, суммы. */
export function LeadOrderHistory({ workspaceId, order, ctx, version }: { workspaceId: string; order: LeadOrder; ctx: LeadHistoryContext; version: number }) {
  const [events, setEvents] = useState<LeadEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetchOrderEvents(workspaceId, order.orderKey)
      .then((list) => !cancelled && setEvents(list))
      .catch((e) => !cancelled && setError(firestoreErrorText(e, "Не удалось прочитать историю")));
    return () => {
      cancelled = true;
    };
  }, [workspaceId, order.orderKey, version]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!events) return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  if (events.length === 0) {
    return <p className="text-[13px] text-muted-foreground">История пишется с 27.09.2026 — у этого заказа изменений после этого ещё не было.</p>;
  }
  return (
    <ul className="flex flex-col divide-y divide-border/60">
      {events.map((e) => (
        <li key={e.id}>
          <EventLine e={e} ctx={ctx} />
        </li>
      ))}
    </ul>
  );
}

/** Лента последних изменений по всем заказам, новые сверху. */
export function LeadFeed({
  workspaceId,
  ctx,
  orders,
  onOpen,
}: {
  workspaceId: string;
  ctx: LeadHistoryContext;
  orders: readonly LeadOrder[];
  onOpen: (order: LeadOrder) => void;
}) {
  const [events, setEvents] = useState<LeadEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const byKey = useMemo(() => {
    const map = new Map<string, LeadOrder>();
    for (const o of orders) map.set(o.orderKey, o);
    return map;
  }, [orders]);

  const load = async (before: number | null) => {
    setLoading(true);
    try {
      const list = await fetchRecentEvents(workspaceId, before, 50);
      setEvents((prev) => (before ? [...prev, ...list] : list));
      setMore(list.length === 50);
      setError(null);
    } catch (e) {
      setError(firestoreErrorText(e, "Не удалось прочитать историю"));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  return (
    <div className="flex flex-col gap-2">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <ul className="flex flex-col divide-y divide-border/60">
        {events.map((e) => {
          const order = byKey.get(e.orderKey);
          return (
            <li key={e.id}>
              <button
                type="button"
                className="block w-full rounded-md px-1 text-left hover:bg-accent/40 disabled:cursor-default disabled:hover:bg-transparent"
                disabled={!order}
                onClick={() => order && onOpen(order)}
              >
                <EventLine e={e} ctx={ctx} title={order?.client || "заказ"} />
              </button>
            </li>
          );
        })}
      </ul>
      {events.length === 0 && !loading && !error ? <p className="text-[13px] text-muted-foreground">Изменений пока нет.</p> : null}
      {more && events.length > 0 ? (
        <Button variant="outline" size="sm" disabled={loading} onClick={() => void load(events[events.length - 1]?.id ?? null)}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Показать ещё"}
        </Button>
      ) : null}
    </div>
  );
}
