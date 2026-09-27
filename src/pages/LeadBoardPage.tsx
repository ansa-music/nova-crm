import { useCallback, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, History, IdCard, Loader2, Plus, RefreshCw, Search, Sparkles } from "lucide-react";
import { AccessDenied } from "@/components/common/AccessDenied";
import { PageHeader, pageChipClass } from "@/components/common/PageHeader";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { StatusBadge } from "@/components/table/StatusBadge";
import { TechBadge } from "@/components/os/TechBadge";
import { EditableText, OsLabel, OsPicker } from "@/components/leads/LeadCells";
import { LeadCardSheet } from "@/components/leads/LeadCardSheet";
import { LeadFeed, type LeadHistoryContext } from "@/components/leads/LeadHistory";
import { NewLeadDialog } from "@/components/leads/NewLeadDialog";
import { PaymentChip } from "@/components/cashbox/PaymentChip";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentPeriodKey, usePeriodSettings } from "@/hooks/useCurrentPeriodKey";
import { useLeadBoard } from "@/hooks/useLeadBoard";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { usePermissions } from "@/hooks/usePermissions";
import { useUrlState } from "@/hooks/useUrlState";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  leadStats,
  leadTablesFor,
  moveLeadOs,
  osMembersOf,
  patchLeadCells,
  patchLeadExtras,
  type LeadOrder,
  type LeadStats,
} from "@/services/leadBoardService";
import { confirmDialog } from "@/utils/appDialog";
import { cn } from "@/utils/cn";
import { approvalStatusValue, getColumnOptions, isApprovalStatusValue } from "@/utils/columnOptions";
import { firestoreErrorText } from "@/utils/dbError";
import { myDisplayName } from "@/utils/displayName";
import { formatCount, formatNumber } from "@/utils/format";
import { normalizeNumericInput } from "@/utils/numberInput";
import { formatDayMonth } from "@/utils/osDates";
import { periodShortLabel, recentPeriodKeys } from "@/utils/periods";
import { paymentMethodsOf, paymentPatch } from "@/utils/payment";
import { effectiveTechLoadKinds } from "@/utils/techLoad";
import { LEAD_BY_KEY } from "@/utils/reservedCellKeys";
import { resolveTechIdentity, techIdentityOfUid, type TechIdentity } from "@/utils/techIdentity";
import type { PageColumn, PageRow, PaymentMethod, StatusOption, WorkspaceMember, WorkspacePage } from "@/types";

type RowExtras = NonNullable<PageRow["extras"]>;

const FILTERS = ["all", "open", "issued", "noos"] as const;
type Filter = (typeof FILTERS)[number];
const FILTER_LABELS: Record<Filter, string> = { all: "Все", open: "Не выданы", issued: "Выданы", noos: "Без ОС" };
const STATUS_COLUMN = { key: "status", type: "status" } as PageColumn;
const NO_STATUS = "__none";

function isIssued(o: LeadOrder): boolean {
  return o.kind === "os" ? Boolean(o.copy || o.techNick) : Boolean(o.techUid);
}

function matchesFilter(o: LeadOrder, f: Filter): boolean {
  if (f === "open") return o.kind === "os" && !isIssued(o);
  if (f === "issued") return isIssued(o) && (o.kind === "os" || Boolean(o.osUid));
  if (f === "noos") return o.kind === "tech" && !o.osUid;
  return true;
}

interface Group {
  value: string;
  label: string;
  color: string | null;
  orders: LeadOrder[];
  sum: number;
}

/**
 * «Общая таблица» (Тимлид+ и Owner): все заказы периода по всем ОС и
 * технарям одной таблицей, по статусам — как у ОС. Имя (визитка) · Номер ·
 * ОС · Тех · Сумма · Апсейл · Дата. Правка — прямо в клетке, ОС — выбором
 * (строка переезжает на его стол), новый клиент — «+ Клиент», история заказа
 * и лента изменений — из `order_events`. Всё — в Supabase, вживую.
 */
export default function LeadBoardPage() {
  const permissions = usePermissions();
  const { activeWorkspace, activeWorkspaceId } = useWorkspace();
  if (!permissions.isResolved || !activeWorkspace) {
    return (
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-5 sm:p-8">
        <Skeleton className="h-8 w-60" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }
  if (!permissions.canLeadBoard) {
    return <AccessDenied reason="«Общая таблица» открыта только Owner и роли «Тимлид+»." />;
  }
  if (activeWorkspace.rowsBackend !== "supabase" || !activeWorkspaceId) {
    return (
      <div className="mx-auto w-full max-w-3xl p-5 sm:p-8">
        <Alert tone="warning">«Общая таблица» работает, когда строки таблиц хранятся в Supabase («Настройки → Строки таблиц»).</Alert>
      </div>
    );
  }
  return <LeadBoard workspaceId={activeWorkspaceId} />;
}

function LeadBoard({ workspaceId }: { workspaceId: string }) {
  const { activeWorkspace, members, pages, allPages, osDesks } = useWorkspace();
  const { profile } = useAuth();
  const mobile = useIsMobile();
  const currentKey = useCurrentPeriodKey();
  const periods = usePeriodSettings();
  const periodKeys = useMemo(() => recentPeriodKeys(currentKey, 3, periods).reverse(), [currentKey, periods]);
  const [rawPeriod, setPeriod] = useUrlState<string>("p", currentKey);
  const period = periodKeys.includes(rawPeriod) ? rawPeriod : currentKey;
  const [filter, setFilter] = useUrlState<Filter>("f", "all", { values: FILTERS });
  const [osFilter, setOsFilter] = useUrlState<string>("os", "");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [feedOpen, setFeedOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  const tables = useMemo(() => leadTablesFor(period, osDesks, pages), [period, osDesks, pages]);
  const allDesks = useMemo(() => {
    const map = new Map<string, WorkspacePage>();
    for (const p of [...allPages, ...osDesks]) map.set(p.id, p);
    return [...map.values()];
  }, [allPages, osDesks]);
  const pagesById = useMemo(() => new Map(allDesks.map((p) => [p.id, p])), [allDesks]);
  const board = useLeadBoard({ workspaceId, tables, pages: allDesks, enabled: true });

  const statusOptions = useMemo(() => getColumnOptions(STATUS_COLUMN, activeWorkspace), [activeWorkspace]);
  const techNickOptions = activeWorkspace?.techNickOptions ?? [];
  const osMembers = useMemo(() => osMembersOf(members), [members]);
  const memberByUid = useMemo(() => new Map(members.map((m) => [m.uid, m])), [members]);
  const historyCtx: LeadHistoryContext = useMemo(
    () => ({ members, statusOptions, techNickOptions, pagesById }),
    [members, statusOptions, techNickOptions, pagesById]
  );
  const fromName = myDisplayName(profile, members);

  const techOf = useCallback(
    (o: LeadOrder): TechIdentity | null => {
      if (o.techNick) {
        const byNick = resolveTechIdentity(o.techNick, members, techNickOptions);
        if (byNick) return byNick;
      }
      return o.techUid ? techIdentityOfUid(o.techUid, null, members, techNickOptions) : null;
    },
    [members, techNickOptions]
  );

  const q = query.trim().toLocaleLowerCase("ru");
  const visible = useMemo(
    () =>
      board.orders.filter((o) => {
        if (!matchesFilter(o, filter)) return false;
        if (osFilter && o.osUid !== osFilter) return false;
        if (!q) return true;
        const hay = `${o.client} ${o.phone} ${String(o.row.cells[o.keys.note] ?? "")}`.toLocaleLowerCase("ru");
        return hay.includes(q) || o.phone.replace(/\D/g, "").includes(q.replace(/\D/g, "") || "\u0000");
      }),
    [board.orders, filter, osFilter, q]
  );

  const groups = useMemo(() => buildGroups(visible, statusOptions), [visible, statusOptions]);
  const totals = useMemo(() => {
    let sum = 0;
    let open = 0;
    for (const o of visible) {
      sum += o.total ?? 0;
      if (o.kind === "os" && !isIssued(o)) open += 1;
    }
    return { sum, open };
  }, [visible]);
  const kinds = useMemo(() => effectiveTechLoadKinds(activeWorkspace), [activeWorkspace]);
  const stats = useMemo(() => leadStats(visible, statusOptions, kinds), [visible, statusOptions, kinds]);
  const methods = useMemo(() => paymentMethodsOf(activeWorkspace), [activeWorkspace]);

  const openOrder = openKey ? (board.orders.find((o) => o.key === openKey) ?? null) : null;

  const onCells = useCallback(
    async (order: LeadOrder, cells: Record<string, string | number | null>) => {
      board.patchLocal(order.key, cells);
      try {
        await patchLeadCells(workspaceId, order, cells);
      } catch (e) {
        toast.error("Не сохранилось", { description: firestoreErrorText(e, "Попробуйте ещё раз") });
        board.refresh();
      }
    },
    [board, workspaceId]
  );
  const onCell = useCallback(
    async (order: LeadOrder, key: string, raw: string) => {
      if (!key) return;
      const money = key === order.keys.price || key === order.keys.upsell;
      const value = money && raw ? normalizeNumericInput(raw) : raw;
      await onCells(order, { [key]: value });
    },
    [onCells]
  );
  const onPay = useCallback(
    (order: LeadOrder, colKey: string, method: PaymentMethod | null) => void onCells(order, paymentPatch(colKey, method)),
    [onCells]
  );

  const onExtras = useCallback(
    async (order: LeadOrder, extras: RowExtras | null) => {
      try {
        await patchLeadExtras(workspaceId, order, extras);
      } catch (e) {
        toast.error("Визитка не сохранилась", { description: firestoreErrorText(e, "Попробуйте ещё раз") });
        throw e;
      }
    },
    [workspaceId]
  );

  const onMoveOs = useCallback(
    async (order: LeadOrder, member: WorkspaceMember) => {
      const ok = await confirmDialog({
        title: `Передать заказ «${order.client || "без имени"}» ОС ${member.osNick || member.nickname || member.name}?`,
        description: order.copy
          ? "Строка переедет на стол нового ОС, заказ у технаря останется у него, но его будет вести новый ОС."
          : "Строка переедет на стол нового ОС. Он получит уведомление.",
        confirmLabel: "Передать",
      });
      if (!ok || !profile) return;
      try {
        await moveLeadOs({ workspaceId, order, toOs: member, osDesks, fromUid: profile.uid, fromName });
        toast.success(`Заказ у ОС ${member.osNick || member.nickname || member.name}`);
        setOpenKey(null);
        board.refresh();
      } catch (e) {
        toast.error("Не передан", { description: firestoreErrorText(e, "Попробуйте ещё раз") });
      }
    },
    [board, fromName, osDesks, profile, workspaceId]
  );

  const toggleGroup = (value: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-7xl flex-col gap-3 p-4 sm:p-6">
      <PageHeader
        className="mb-0"
        eyebrow="Тимлид+ · все заказы периода"
        title="Общая таблица"
        description="Все заказы всех ОС и технарей вживую: правьте прямо в клетке, передавайте другому ОС, заводите новых клиентов."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="min-h-11 gap-1.5 sm:min-h-9" onClick={() => setFeedOpen(true)}>
              <History className="h-4 w-4" /> Лента изменений
            </Button>
            <Button className="min-h-11 gap-1.5 sm:min-h-9" onClick={() => setNewOpen(true)} disabled={osMembers.length === 0}>
              <Plus className="h-4 w-4" /> Клиент
            </Button>
          </div>
        }
        filters={
          <>
            {periodKeys.map((key) => (
              <button key={key} type="button" className={pageChipClass(period === key)} onClick={() => setPeriod(key)}>
                {periodShortLabel(key, periods)}
                {key === currentKey ? <span className="text-[10px] uppercase tracking-wide opacity-70">идёт</span> : null}
              </button>
            ))}
            <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />
            {FILTERS.map((f) => (
              <button key={f} type="button" className={pageChipClass(filter === f)} onClick={() => setFilter(f)}>
                {FILTER_LABELS[f]}
              </button>
            ))}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Клиент или номер" className="pl-8" aria-label="Поиск" />
        </div>
        <Select value={osFilter || "__all"} onValueChange={(v) => setOsFilter(v === "__all" ? "" : v)}>
          <SelectTrigger className="h-9 w-auto min-w-[9rem]" aria-label="ОС">
            <SelectValue placeholder="Все ОС" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Все ОС</SelectItem>
            {osMembers.map((m) => (
              <SelectItem key={m.uid} value={m.uid}>
                <OsLabel member={m} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-3 font-mono text-[12.5px] tabular-nums text-muted-foreground">
          <span>{formatCount(visible.length, ["заказ", "заказа", "заказов"])}</span>
          {totals.open > 0 ? <span className="text-warning">не выдано {totals.open}</span> : null}
          <span className="text-foreground">{formatNumber(totals.sum)}</span>
          <button type="button" aria-label="Обновить" className="rounded-md p-1 hover:bg-accent" onClick={board.refresh}>
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {board.loaded && visible.length > 0 ? <LeadStatsStrip stats={stats} /> : null}

      {board.error ? (
        <Alert tone="error">
          {firestoreErrorText(board.error, "Не удалось прочитать общую таблицу")}{" "}
          <button type="button" className="underline" onClick={board.refresh}>
            Повторить
          </button>
        </Alert>
      ) : null}

      {!board.loaded ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Читаю заказы всех столов…
        </div>
      ) : groups.length === 0 ? (
        <p className="rounded-xl border border-border px-4 py-10 text-center text-sm text-muted-foreground">
          {board.orders.length === 0 ? "За этот период заказов нет." : "Под фильтр ничего не подошло."}
        </p>
      ) : mobile ? (
        <div className="flex flex-col gap-3">
          {groups.map((g) => (
            <section key={g.value} className="flex flex-col gap-1.5">
              <GroupHeader group={g} collapsed={collapsed.has(g.value)} onToggle={() => toggleGroup(g.value)} />
              {collapsed.has(g.value)
                ? null
                : g.orders.map((o) => (
                    <LeadMobileCard key={o.key} order={o} os={o.osUid ? (memberByUid.get(o.osUid) ?? null) : null} tech={techOf(o)} statusOptions={statusOptions} onOpen={() => setOpenKey(o.key)} />
                  ))}
            </section>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <div className="min-w-[1120px]">
            <div className={cn(GRID, "sticky top-0 z-10 h-8 border-b border-border bg-card text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground")}>
              <span className="px-2">Имя</span>
              <span className="px-2">Номер</span>
              <span className="px-2">ОС</span>
              <span className="px-2">Тех</span>
              <span className="px-2 text-right">Сумма</span>
              <span className="px-2 text-right">Апсейл</span>
              <span className="px-2">Дата</span>
              <span />
            </div>
            {groups.map((g) => (
              <div key={g.value}>
                <GroupHeader group={g} collapsed={collapsed.has(g.value)} onToggle={() => toggleGroup(g.value)} />
                {collapsed.has(g.value)
                  ? null
                  : g.orders.map((o, i) => (
                      <LeadRow
                        key={o.key}
                        order={o}
                        zebra={i % 2 === 1}
                        os={o.osUid ? (memberByUid.get(o.osUid) ?? null) : null}
                        tech={techOf(o)}
                        osMembers={osMembers}
                        statusOptions={statusOptions}
                        onOpen={() => setOpenKey(o.key)}
                        onCell={onCell}
                        onPay={onPay}
                        methods={methods}
                        onMoveOs={onMoveOs}
                      />
                    ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <LeadCardSheet
        order={openOrder}
        onClose={() => setOpenKey(null)}
        workspaceId={workspaceId}
        statusOptions={statusOptions}
        os={openOrder?.osUid ? (memberByUid.get(openOrder.osUid) ?? null) : null}
        osMembers={osMembers}
        tech={openOrder ? techOf(openOrder) : null}
        historyCtx={historyCtx}
        historyVersion={openOrder?.row.updatedAt ?? 0}
        onCell={onCell}
        onPay={onPay}
        methods={methods}
        onExtras={onExtras}
        onMoveOs={onMoveOs}
      />

      <Sheet open={feedOpen} onOpenChange={setFeedOpen}>
        <SheetContent side={mobile ? "bottom" : "right"} className="flex w-full flex-col gap-3 overflow-y-auto sm:w-[min(32rem,92vw)] sm:max-w-[32rem]">
          <SheetHeader className="text-left">
            <SheetTitle>Лента изменений</SheetTitle>
            <p className="text-[12px] text-muted-foreground">Кто, когда и что менял в заказах: статусы, технари, ОС, суммы.</p>
          </SheetHeader>
          {feedOpen ? (
            <LeadFeed
              workspaceId={workspaceId}
              ctx={historyCtx}
              orders={board.orders}
              onOpen={(o) => {
                setFeedOpen(false);
                setOpenKey(o.key);
              }}
            />
          ) : null}
        </SheetContent>
      </Sheet>

      {profile ? (
        <NewLeadDialog
          open={newOpen}
          onOpenChange={setNewOpen}
          workspaceId={workspaceId}
          osMembers={osMembers}
          osDesks={osDesks}
          statusOptions={statusOptions}
          fromUid={profile.uid}
          fromName={fromName}
          defaultOsUid={osFilter || null}
          methods={methods}
          onCreated={board.refresh}
        />
      ) : null}
    </div>
  );
}

const GRID =
  "grid grid-cols-[minmax(13rem,1.7fr)_minmax(8rem,1fr)_minmax(8.5rem,1fr)_minmax(10rem,1.2fr)_11rem_11rem_4.5rem_2.25rem] items-center";

function buildGroups(orders: readonly LeadOrder[], options: readonly StatusOption[]): Group[] {
  const approval = approvalStatusValue([...options]);
  const byValue = new Map<string, LeadOrder[]>();
  for (const o of orders) {
    let value = o.status;
    if (o.kind === "os" && isApprovalStatusValue(value, options)) value = approval;
    if (!value) value = NO_STATUS;
    const list = byValue.get(value) ?? [];
    list.push(o);
    byValue.set(value, list);
  }
  const order: string[] = [approval, ...options.map((o) => o.value).filter((v) => v !== approval)];
  for (const v of byValue.keys()) if (!order.includes(v) && v !== NO_STATUS) order.push(v);
  order.push(NO_STATUS);
  const out: Group[] = [];
  for (const value of order) {
    const list = byValue.get(value);
    if (!list?.length) continue;
    list.sort((a, b) => a.enteredAt - b.enteredAt || a.key.localeCompare(b.key));
    const option = options.find((o) => o.value === value);
    out.push({
      value,
      label: value === NO_STATUS ? "Без статуса" : (option?.label ?? value),
      color: option?.color ?? null,
      orders: list,
      sum: list.reduce((s, o) => s + (o.total ?? 0), 0),
    });
  }
  return out;
}

function GroupHeader({ group, collapsed, onToggle }: { group: Group; collapsed: boolean; onToggle: () => void }) {
  const Icon = collapsed ? ChevronRight : ChevronDown;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      className="flex h-8 w-full items-center gap-2 border-b border-border px-2 text-left text-[12.5px] font-medium sm:rounded-none"
      style={group.color ? { backgroundColor: `hsl(${group.color} / 0.10)` } : undefined}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: group.color ? `hsl(${group.color})` : "hsl(var(--muted-foreground))" }} aria-hidden />
      <span style={group.color ? { color: `hsl(${group.color})` } : undefined}>{group.label}</span>
      <span className="text-muted-foreground">· {group.orders.length}</span>
      <span className="ml-auto font-mono text-[12px] tabular-nums text-muted-foreground">{group.sum ? formatNumber(group.sum) : ""}</span>
    </button>
  );
}

function ClientButton({ order, onOpen }: { order: LeadOrder; onOpen: () => void }) {
  const fromLead = Boolean(order.row.cells[LEAD_BY_KEY]);
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Открыть карточку клиента"
      className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left text-[13px] hover:bg-accent/60"
    >
      <span className="flex h-6 w-7 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary ring-1 ring-primary/30">
        <IdCard className="h-3.5 w-3.5" />
      </span>
      <span className="truncate">{order.client || <span className="text-muted-foreground">без имени</span>}</span>
      {fromLead ? (
        <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded bg-primary/10 px-1 text-[10px] uppercase tracking-wide text-primary" title="Завёл Тимлид+">
          <Sparkles className="h-3 w-3" /> лид
        </span>
      ) : null}
    </button>
  );
}

function TechCell({ order, tech, statusOptions }: { order: LeadOrder; tech: TechIdentity | null; statusOptions: readonly StatusOption[] }) {
  if (!tech) {
    return <span className="px-1.5 text-[12.5px] text-muted-foreground">{order.kind === "os" ? "не выдан" : "—"}</span>;
  }
  return (
    <span className="flex min-w-0 items-center gap-2 px-1.5">
      <TechBadge identity={tech} />
      {order.kind === "os" && order.techStatus ? (
        <span className="ml-auto min-w-0 shrink" title="Статус у технаря">
          <StatusBadge value={order.techStatus} options={[...statusOptions]} variant="plain" />
        </span>
      ) : order.kind === "os" && !order.copy ? (
        <span className="ml-auto text-[11px] text-muted-foreground" title="Технарь выбран, заказ едет к нему">едет</span>
      ) : null}
    </span>
  );
}

function LeadRow({
  order,
  zebra,
  os,
  tech,
  osMembers,
  statusOptions,
  onOpen,
  onCell,
  onPay,
  methods,
  onMoveOs,
}: {
  order: LeadOrder;
  zebra: boolean;
  os: WorkspaceMember | null;
  tech: TechIdentity | null;
  osMembers: readonly WorkspaceMember[];
  statusOptions: readonly StatusOption[];
  onOpen: () => void;
  onCell: (order: LeadOrder, key: string, value: string) => Promise<void>;
  onPay: (order: LeadOrder, colKey: string, method: PaymentMethod | null) => void;
  methods: readonly PaymentMethod[];
  onMoveOs: (order: LeadOrder, member: WorkspaceMember) => void;
}) {
  const k = order.keys;
  const payChip = (colKey: string) =>
    order.kind === "os" && colKey ? (
      <span className="shrink-0">
        <PaymentChip row={order.row} colKey={colKey} methods={methods} canEdit compact onPick={(m) => onPay(order, colKey, m)} />
      </span>
    ) : null;
  return (
    <div
      className={cn(GRID, "h-9 border-b border-border/60 hover:bg-accent/30", zebra && "bg-muted/20")}
      style={{ contentVisibility: "auto", containIntrinsicSize: "36px" }}
    >
      <div className="flex min-w-0 px-1">
        <ClientButton order={order} onOpen={onOpen} />
      </div>
      <div className="min-w-0 px-1">
        <EditableText value={order.phone} ariaLabel="Номер" inputMode="tel" disabled={!k.phone} onCommit={(v) => onCell(order, k.phone, v)} />
      </div>
      <div className="min-w-0 px-1">
        <OsPicker current={os} osMembers={osMembers} disabled={order.kind !== "os"} onPick={(m) => onMoveOs(order, m)} />
      </div>
      <div className="min-w-0">
        <TechCell order={order} tech={tech} statusOptions={statusOptions} />
      </div>
      <div className="flex min-w-0 items-center gap-0.5 px-1">
        {payChip(k.price)}
        <EditableText
          value={order.price === null ? "" : String(order.price)}
          display={order.price === null ? "" : formatNumber(order.price)}
          ariaLabel="Сумма"
          inputMode="decimal"
          align="right"
          disabled={!k.price}
          onCommit={(v) => onCell(order, k.price, v)}
        />
      </div>
      <div className="flex min-w-0 items-center gap-0.5 px-1">
        {payChip(k.upsell)}
        <EditableText
          value={order.upsell === null ? "" : String(order.upsell)}
          display={order.upsell === null ? "" : formatNumber(order.upsell)}
          ariaLabel="Апсейл"
          inputMode="decimal"
          align="right"
          disabled={order.kind !== "os"}
          onCommit={(v) => onCell(order, k.upsell, v)}
        />
      </div>
      <span className="px-2 font-mono text-[12px] tabular-nums text-muted-foreground">{order.dateMs ? formatDayMonth(order.dateMs) : "—"}</span>
      <button type="button" aria-label="История заказа" title="История заказа" className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" onClick={onOpen}>
        <History className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function LeadMobileCard({
  order,
  os,
  tech,
  statusOptions,
  onOpen,
}: {
  order: LeadOrder;
  os: WorkspaceMember | null;
  tech: TechIdentity | null;
  statusOptions: readonly StatusOption[];
  onOpen: () => void;
}) {
  return (
    <button type="button" onClick={onOpen} className="flex w-full min-w-0 flex-col gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5 text-left">
      <div className="flex min-w-0 items-center gap-2">
        <IdCard className="h-4 w-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{order.client || "без имени"}</span>
        <span className="shrink-0 font-mono text-[13px] tabular-nums">{order.total === null ? "—" : formatNumber(order.total)}</span>
      </div>
      <div className="flex min-w-0 items-center gap-2 text-[12px] text-muted-foreground">
        <span className="truncate">{order.phone || "без номера"}</span>
        <span className="ml-auto shrink-0 font-mono tabular-nums">{order.dateMs ? formatDayMonth(order.dateMs) : ""}</span>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 max-w-[45%]">
          <OsLabel member={os} />
        </span>
        <span className="text-muted-foreground">→</span>
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {tech ? <TechBadge identity={tech} /> : <span className="text-[12.5px] text-muted-foreground">не выдан</span>}
          {order.techStatus && order.kind === "os" ? (
            <span className="ml-auto min-w-0">
              <StatusBadge value={order.techStatus} options={[...statusOptions]} variant="plain" />
            </span>
          ) : null}
        </span>
      </div>
    </button>
  );
}

function pct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

/** Сводка по видимым заказам: сколько в работе, касса грязная и чистая, апсейл, KPI. */
function LeadStatsStrip({ stats }: { stats: LeadStats }) {
  const tiles: Array<{ label: string; value: string; sub?: string; tone?: string }> = [
    { label: "Заказов", value: String(stats.count), sub: stats.approval ? `на утверждении ${stats.approval}` : undefined },
    { label: "В работе", value: String(stats.inWork), sub: [stats.payment ? `ждём оплату ${stats.payment}` : "", stats.freeze ? `заморозка ${stats.freeze}` : ""].filter(Boolean).join(" · ") || undefined },
    { label: "Готово", value: String(stats.done), sub: stats.cancelled ? `отменено ${stats.cancelled}` : undefined, tone: "text-success" },
    { label: "Грязная касса", value: formatNumber(stats.gross), sub: "цена + апсейл до комиссии" },
    { label: "Чистая касса", value: formatNumber(stats.net), sub: `после комиссии · в «Готово» ${formatNumber(stats.doneNet)}` },
    { label: "Апсейл", value: formatNumber(stats.upsell), sub: `${formatCount(stats.upsellCount, ["заказ", "заказа", "заказов"])}` },
    { label: "Апсейл готово", value: formatNumber(stats.upsellDone), sub: "апсейл заказов в «Готово»", tone: "text-success" },
    { label: "KPI общий", value: pct(stats.kpi), sub: "«Готово» из всех, без отменённых", tone: "text-primary" },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
      {tiles.map((t) => (
        <div key={t.label} className="min-w-0 rounded-xl border border-border bg-card px-3 py-2">
          <p className="text-[10.5px] font-medium uppercase leading-tight tracking-[0.08em] text-muted-foreground">{t.label}</p>
          <p className={cn("font-mono text-[1.15rem] tabular-nums leading-tight", t.tone)}>{t.value}</p>
          {t.sub ? <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground" title={t.sub}>{t.sub}</p> : null}
        </div>
      ))}
    </div>
  );
}
