import { useCallback, useMemo, useState } from "react";
import { ArrowDown, ArrowDownUp, ArrowUp, Check, ChevronDown, ChevronRight, History, IdCard, Layers, Loader2, Lock, Plus, RefreshCw, Search, Sparkles, Wrench } from "lucide-react";
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
import { EditableText, LeadStatusPicker, OsLabel, OsPicker, PersonPill } from "@/components/leads/LeadCells";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  leadDeadlineOf,
  leadIsClosed,
  leadStats,
  leadStatusOf,
  leadTablesFor,
  leadTechDeskHidden,
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
import { formatDayMonth, formatFullDate, osDateSlots } from "@/utils/osDates";
import { almatyMidnightMillis } from "@/utils/date";
import { deskRowHref } from "@/utils/deskLinks";
import { buildPersonDeskIndex, osDeskLink, techDeskLink, type DeskLink, type PersonDeskIndex } from "@/utils/personDeskLinks";
import { DeskLinkButton } from "@/components/common/DeskLinkButton";
import { OsDatesCell } from "@/components/os/OsDatesCell";
import { periodShortLabel, recentPeriodKeys } from "@/utils/periods";
import { paymentMethodsOf, paymentPatch } from "@/utils/payment";
import { effectiveTechLoadKinds } from "@/utils/techLoad";
import { LEAD_BY_KEY } from "@/utils/reservedCellKeys";
import {
  LEAD_SORTS,
  LEAD_SORT_LABELS,
  LEAD_SORT_SECTIONS,
  leadComparator,
  nextSortForColumn,
  rememberLeadSort,
  rememberedLeadSort,
  sortColumnOf,
  type LeadSort,
  type LeadSortColumn,
} from "@/utils/leadSort";
import { personLabel } from "@/utils/peopleDesks";
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
  /** Плоский список без группировки: заголовок группы не рисуется. */
  flat?: boolean;
  value: string;
  label: string;
  color: string | null;
  orders: LeadOrder[];
  sum: number;
}

/**
 * «Общая таблица» (Тимлид+ и Owner): все заказы периода по всем ОС и
 * технарям одной таблицей, по статусам — как у ОС. Столбцы — как в таблице
 * Nurba: Имя (визитка) · Даты · Номер · Сумма · Апсейл · Менеджер ОС · Статус ·
 * Дата сдачи · Технарь; у ОС и технаря — «↗ открыть стол». Правка — прямо в клетке, ОС — выбором
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
  return <LeadBoard workspaceId={activeWorkspaceId} viewerIsOwner={permissions.actsAsOwner} />;
}

function LeadBoard({ workspaceId, viewerIsOwner }: { workspaceId: string; viewerIsOwner: boolean }) {
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
  // Порядок: в адресе (`?sort=`), а умолчание — последний выбор этого человека
  // (нет выбора — «Новые сверху»). Умолчание фиксируется при входе на экран.
  const [sortDefault] = useState<LeadSort>(() => rememberedLeadSort());
  const [sort, setSortRaw] = useUrlState<LeadSort>("sort", sortDefault, { values: LEAD_SORTS });
  const setSort = useCallback(
    (next: LeadSort) => {
      rememberLeadSort(next);
      setSortRaw(next);
    },
    [setSortRaw]
  );
  const [groupParam, setGroupParam] = useUrlState<"1" | "0">("g", "1", { values: ["1", "0"] });
  const grouped = groupParam === "1";

  // Столы «только для Owner» — только у Owner (Тимлиду+ их строки закрыты базой).
  const tables = useMemo(() => leadTablesFor(period, osDesks, pages, viewerIsOwner), [period, osDesks, pages, viewerIsOwner]);
  const allDesks = useMemo(() => {
    const map = new Map<string, WorkspacePage>();
    for (const p of [...allPages, ...osDesks]) map.set(p.id, p);
    return [...map.values()];
  }, [allPages, osDesks]);
  const pagesById = useMemo(() => new Map(allDesks.map((p) => [p.id, p])), [allDesks]);
  const techHiddenOf = useCallback((o: LeadOrder) => leadTechDeskHidden(o, pagesById, viewerIsOwner), [pagesById, viewerIsOwner]);
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

  // Цвета пилюль «Менеджер ОС» и «Технарь» — варианты их ников.
  const responsibleOptions = activeWorkspace?.responsibleOptions;
  const osColorOf = useCallback(
    (o: LeadOrder): string | null => {
      const m = o.osUid ? memberByUid.get(o.osUid) : null;
      return (m?.osNickValue && responsibleOptions?.find((x) => x.value === m.osNickValue)?.color) || null;
    },
    [memberByUid, responsibleOptions]
  );
  const techColorOf = useCallback(
    (o: LeadOrder): string | null => {
      const t = techOf(o);
      return (t?.nick && techNickOptions.find((x) => x.value === t.nick)?.color) || null;
    },
    [techOf, techNickOptions]
  );
  // «↗ открыть стол» у ОС и технаря — на строку заказа, если стол открыт.
  const canAccessDesk = usePermissions().canAccessPage;
  const deskIndex = useMemo(
    () => buildPersonDeskIndex({ members, pages: allDesks, osDesks: allDesks.filter((p) => p.osDesk), canAccess: canAccessDesk }),
    [members, allDesks, canAccessDesk]
  );
  const osLinkOf = useCallback(
    (o: LeadOrder) => leadOsLink(o, deskIndex, o.osUid ? (memberByUid.get(o.osUid) ?? null) : null),
    [deskIndex, memberByUid]
  );
  const techLinkOf = useCallback(
    (o: LeadOrder) => leadTechLink(o, deskIndex, techOf(o), techHiddenOf(o)),
    [deskIndex, techOf, techHiddenOf]
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

  const comparator = useMemo(() => {
    const approval = approvalStatusValue([...statusOptions]);
    const rankOrder = [approval, ...statusOptions.map((o) => o.value).filter((v) => v !== approval)];
    return leadComparator(sort, {
      osLabel: (o) => {
        const m = o.osUid ? memberByUid.get(o.osUid) : null;
        return m ? personLabel(m) : "";
      },
      techLabel: (o) => techOf(o)?.label ?? "",
      statusRank: (o) => {
        const v = leadStatusOf(o, statusOptions);
        const i = rankOrder.indexOf(v || approval);
        return i < 0 ? rankOrder.length : i;
      },
    });
  }, [sort, statusOptions, memberByUid, techOf]);
  const groups = useMemo(() => buildGroups(visible, statusOptions, comparator, grouped), [visible, statusOptions, comparator, grouped]);
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
        title: `Передать заказ «${order.client || "без имени"}» ОС ${personLabel(member)}?`,
        description: order.copy
          ? "Строка переедет на стол нового ОС, заказ у технаря останется у него, но его будет вести новый ОС."
          : "Строка переедет на стол нового ОС. Он получит уведомление.",
        confirmLabel: "Передать",
      });
      if (!ok || !profile) return;
      try {
        await moveLeadOs({ workspaceId, order, toOs: member, osDesks, fromUid: profile.uid, fromName });
        toast.success(`Заказ у ОС ${personLabel(member)}`);
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
    <div className="mx-auto flex w-full min-w-0 max-w-[1560px] flex-col gap-3 p-4 sm:p-6">
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
        <SortMenu sort={sort} onSort={setSort} className={mobile ? "min-w-0 flex-1 justify-start" : undefined} />
        <button
          type="button"
          className={cn(pageChipClass(grouped), "h-9 gap-1.5")}
          aria-pressed={grouped}
          onClick={() => setGroupParam(grouped ? "0" : "1")}
          title={grouped ? "Показать одним списком" : "Разложить по статусам"}
        >
          <Layers className="h-3.5 w-3.5" /> {mobile ? "Группы" : "Группы по статусу"}
        </button>
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
                    <LeadMobileCard key={o.key} order={o} os={o.osUid ? (memberByUid.get(o.osUid) ?? null) : null} tech={techOf(o)} techHidden={techHiddenOf(o)} statusOptions={statusOptions} onOpen={() => setOpenKey(o.key)} osColor={osColorOf(o)} techColor={techColorOf(o)} />
                  ))}
            </section>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <div className="min-w-[1260px]">
            <div className={cn(GRID, "sticky top-0 z-10 h-9 border-b-2 border-primary/40 bg-muted text-[11px] font-semibold uppercase tracking-[0.04em] text-foreground/80")}>
              <SortHead column="client" sort={sort} onSort={setSort} label="Имя" />
              <span className="px-2">Даты</span>
              <span className="px-2">Номер</span>
              <SortHead column="sum" sort={sort} onSort={setSort} label="Сумма" align="right" />
              <SortHead column="upsell" sort={sort} onSort={setSort} label="Апсейл" align="right" />
              <SortHead column="os" sort={sort} onSort={setSort} label="Менеджер ОС" />
              <SortHead column="status" sort={sort} onSort={setSort} label="Статус" />
              <SortHead column="deadline" sort={sort} onSort={setSort} label="Дата сдачи" />
              <SortHead column="tech" sort={sort} onSort={setSort} label="Технарь" />
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
                        techHidden={techHiddenOf(o)}
                        osMembers={osMembers}
                        statusOptions={statusOptions}
                        onOpen={() => setOpenKey(o.key)}
                        onCell={onCell}
                        onPay={onPay}
                        methods={methods}
                        onMoveOs={onMoveOs}
                        osColor={osColorOf(o)}
                        techColor={techColorOf(o)}
                        osLink={osLinkOf(o)}
                        techLink={techLinkOf(o)}
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
        techDeskHidden={openOrder ? techHiddenOf(openOrder) : false}
        osLink={openOrder ? osLinkOf(openOrder) : null}
        techLink={openOrder ? techLinkOf(openOrder) : null}
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

/** Стол ОС заказа: у заказа ОС — сама строка-источник, у строки технаря — его заказ на столе ОС. */
function leadOsLink(o: LeadOrder, index: PersonDeskIndex, os: WorkspaceMember | null): DeskLink | null {
  if (!o.osUid) return null;
  const label = `Открыть стол ОС ${os ? personLabel(os) : ""}`.trim();
  if (o.kind === "os") return index.openable.has(o.pageId) ? { href: deskRowHref(o.pageId, o.tabId || null, o.row.id), label } : null;
  const target = index.osByUid.get(o.osUid);
  return target ? osDeskLink(index, target, o.row) : null;
}

/** Стол технаря: копия заказа у него (или сама строка без ОС), иначе его стол. */
function leadTechLink(o: LeadOrder, index: PersonDeskIndex, tech: TechIdentity | null, techHidden: boolean): DeskLink | null {
  if (techHidden) return null;
  const label = `Открыть стол технаря ${tech?.label ?? ""}`.trim();
  if (o.kind === "tech") return index.openable.has(o.pageId) ? { href: deskRowHref(o.pageId, o.tabId || null, o.row.id), label } : null;
  if (o.copy?.deskPageId && index.openable.has(o.copy.deskPageId)) {
    return { href: deskRowHref(o.copy.deskPageId, o.copy.tabId || null, o.copy.id), label };
  }
  const uid = o.techUid ?? tech?.uid ?? null;
  const target = uid ? index.techByUid.get(uid) : undefined;
  return target ? techDeskLink(index, target, o.row) : null;
}

// Порядок — как в таблице Nurba: Имя · Даты · Номер · Сумма · Апсейл ·
// Менеджер ОС · Статус · Дата сдачи · Технарь (+ история).
const GRID =
  "grid grid-cols-[minmax(11rem,1.4fr)_5rem_minmax(7rem,0.8fr)_8.75rem_8.75rem_minmax(8.5rem,1fr)_9rem_7rem_minmax(11rem,1.3fr)_2.25rem] items-center";

function buildGroups(
  orders: readonly LeadOrder[],
  options: readonly StatusOption[],
  cmp: (a: LeadOrder, b: LeadOrder) => number,
  grouped: boolean
): Group[] {
  if (!grouped) {
    const list = [...orders].sort(cmp);
    return list.length
      ? [{ flat: true, value: "__all", label: "Все", color: null, orders: list, sum: list.reduce((s, o) => s + (o.total ?? 0), 0) }]
      : [];
  }
  const approval = approvalStatusValue([...options]);
  const byValue = new Map<string, LeadOrder[]>();
  for (const o of orders) {
    let value = leadStatusOf(o, options);
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
    list.sort(cmp);
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
  if (group.flat) return null;
  const Icon = collapsed ? ChevronRight : ChevronDown;
  const color = group.color ? `hsl(${group.color})` : "hsl(var(--muted-foreground))";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      className="flex h-9 w-full items-center gap-2 border-b border-l-[3px] border-b-border px-2 text-left text-[13px] font-medium sm:rounded-none"
      style={{ borderLeftColor: color, backgroundColor: group.color ? `hsl(${group.color} / 0.10)` : undefined }}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span style={{ color }}>{group.label}</span>
      <span
        className="rounded-full px-1.5 font-mono text-[11px] tabular-nums"
        style={{ backgroundColor: group.color ? `hsl(${group.color} / 0.18)` : "hsl(var(--muted))", color }}
      >
        {group.orders.length}
      </span>
      <span className="ml-auto font-mono text-[12px] tabular-nums text-muted-foreground">{group.sum ? formatNumber(group.sum) : ""}</span>
    </button>
  );
}

/** Заголовок столбца, который сортирует: первый клик — его порядок, повторный — обратный. */
function SortHead({
  column,
  sort,
  onSort,
  label,
  align = "left",
}: {
  column: LeadSortColumn;
  sort: LeadSort;
  onSort: (next: LeadSort) => void;
  label: string;
  align?: "left" | "right";
}) {
  const active = sortColumnOf(sort);
  const on = active.column === column;
  const Arrow = !on ? ArrowDownUp : active.dir === "desc" ? ArrowDown : ArrowUp;
  return (
    <button
      type="button"
      onClick={() => onSort(nextSortForColumn(column, sort))}
      aria-sort={on ? (active.dir === "desc" ? "descending" : "ascending") : "none"}
      title={on ? LEAD_SORT_LABELS[sort] : "Сортировать"}
      className={cn(
        "group flex h-8 min-w-0 items-center gap-1 px-2 uppercase hover:text-foreground",
        align === "right" && "justify-end",
        on && "text-primary"
      )}
    >
      <span className="truncate">{label}</span>
      <Arrow className={cn("h-3 w-3 shrink-0", on ? "opacity-100" : "opacity-0 group-hover:opacity-60")} aria-hidden />
    </button>
  );
}

/** «Порядок: …» — все виды сортировки списком. */
function SortMenu({ sort, onSort, className }: { sort: LeadSort; onSort: (next: LeadSort) => void; className?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={cn(pageChipClass(sort !== "new-top"), "h-9 gap-1.5", className)} aria-label="Порядок строк">
          <ArrowDownUp className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Порядок: {LEAD_SORT_LABELS[sort]}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[14rem]">
        {LEAD_SORT_SECTIONS.map((section, i) => (
          <div key={section.title}>
            {i > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{section.title}</DropdownMenuLabel>
            {section.sorts.map((key) => (
              <DropdownMenuItem key={key} onSelect={() => onSort(key)}>
                {LEAD_SORT_LABELS[key]}
                {key === sort ? <Check className="ml-auto h-3.5 w-3.5" /> : null}
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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

/**
 * Технарь и его статус. Статус у технаря — точкой, а словом только когда он
 * РАСХОДИТСЯ со статусом заказа (иначе он дублировал бы столбец «Статус» и
 * обрезался до «Гото…»).
 */
function TechStatusMark({ order, statusOptions, full }: { order: LeadOrder; statusOptions: readonly StatusOption[]; full?: boolean }) {
  if (order.kind !== "os" || !order.techStatus) return null;
  const option = statusOptions.find((o) => o.value === order.techStatus);
  const label = option?.label ?? order.techStatus;
  const color = option ? `hsl(${option.color})` : "hsl(var(--muted-foreground))";
  const differs = order.techStatus !== leadStatusOf(order, statusOptions);
  if (!differs) {
    return full ? null : <span className="ml-auto h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} title={`У технаря: ${label}`} aria-label={`У технаря: ${label}`} />;
  }
  return (
    <span className="ml-auto inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px]" title={`У технаря: ${label}`}>
      {full ? <span className="text-muted-foreground">у технаря:</span> : <Wrench className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="у технаря" />}
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      <span style={{ color }}>{label}</span>
    </span>
  );
}

/** Стол технаря закрыт «только для Owner» — копии не видно, «не выдан» было бы неправдой. */
const TECH_DESK_HIDDEN_LABEL = "стол технаря закрыт Owner";

function HiddenDeskMark() {
  return (
    <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground" title={TECH_DESK_HIDDEN_LABEL}>
      <Lock className="h-3 w-3" aria-label={TECH_DESK_HIDDEN_LABEL} />
    </span>
  );
}

function TechCell({
  order,
  tech,
  techHidden,
  statusOptions,
  color,
}: {
  order: LeadOrder;
  tech: TechIdentity | null;
  techHidden: boolean;
  statusOptions: readonly StatusOption[];
  /** Цвет пилюли — варианта ника технаря; `undefined` — без пилюли. */
  color?: string | null;
}) {
  if (!tech) {
    if (techHidden) {
      return (
        <span className="flex min-w-0 items-center gap-1 px-1.5 text-[12px] text-muted-foreground" title={TECH_DESK_HIDDEN_LABEL}>
          <Lock className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">{TECH_DESK_HIDDEN_LABEL}</span>
        </span>
      );
    }
    return <span className="px-1.5 text-[12.5px] text-muted-foreground">{order.kind === "os" ? "не выдан" : "—"}</span>;
  }
  return (
    <span className="flex min-w-0 items-center gap-2 px-1.5">
      {color !== undefined ? (
        <PersonPill color={color} className="shrink">
          <TechBadge identity={tech} />
        </PersonPill>
      ) : (
        <span className="min-w-0 truncate">
          <TechBadge identity={tech} />
        </span>
      )}
      {order.kind === "os" && order.techStatus ? (
        <TechStatusMark order={order} statusOptions={statusOptions} />
      ) : techHidden ? (
        <HiddenDeskMark />
      ) : order.kind === "os" && !order.copy ? (
        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground" title="Технарь выбран, заказ едет к нему">едет</span>
      ) : null}
    </span>
  );
}

/** Столбец «Статус»: пилюля целиком и выбор другого. */
function StatusCell({ order, statusOptions, onCell }: { order: LeadOrder; statusOptions: readonly StatusOption[]; onCell: (order: LeadOrder, key: string, value: string) => Promise<void> }) {
  const effective = leadStatusOf(order, statusOptions);
  const shown = effective || (order.kind === "os" ? approvalStatusValue([...statusOptions]) : "");
  return (
    <LeadStatusPicker
      value={shown}
      options={statusOptions}
      derived={effective !== order.status}
      disabled={!order.keys.status}
      onPick={(v) => void onCell(order, order.keys.status, v)}
    />
  );
}

function LeadRow({
  order,
  zebra,
  os,
  tech,
  techHidden,
  osMembers,
  statusOptions,
  onOpen,
  onCell,
  onPay,
  methods,
  onMoveOs,
  osColor,
  techColor,
  osLink,
  techLink,
}: {
  order: LeadOrder;
  zebra: boolean;
  os: WorkspaceMember | null;
  tech: TechIdentity | null;
  techHidden: boolean;
  osMembers: readonly WorkspaceMember[];
  statusOptions: readonly StatusOption[];
  onOpen: () => void;
  onCell: (order: LeadOrder, key: string, value: string) => Promise<void>;
  onPay: (order: LeadOrder, colKey: string, method: PaymentMethod | null) => void;
  methods: readonly PaymentMethod[];
  onMoveOs: (order: LeadOrder, member: WorkspaceMember) => void;
  osColor: string | null;
  techColor: string | null;
  osLink: DeskLink | null;
  techLink: DeskLink | null;
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
      <div className="min-w-0 px-2">
        <LeadDatesCell order={order} />
      </div>
      <div className="min-w-0 px-1">
        <EditableText value={order.phone} ariaLabel="Номер" inputMode="tel" disabled={!k.phone} onCommit={(v) => onCell(order, k.phone, v)} />
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
      <div className="flex min-w-0 items-center gap-0.5 px-1">
        <div className="min-w-0">
          <OsPicker current={os} osMembers={osMembers} disabled={order.kind !== "os"} onPick={(m) => onMoveOs(order, m)} pill={{ color: osColor }} />
        </div>
        <DeskLinkButton link={osLink} />
      </div>
      <div className="min-w-0 px-0.5">
        <StatusCell order={order} statusOptions={statusOptions} onCell={onCell} />
      </div>
      <div className="min-w-0 px-1">
        <DeadlineCell order={order} statusOptions={statusOptions} onOpen={onOpen} />
      </div>
      <div className="flex min-w-0 items-center gap-0.5 pr-1">
        <div className="min-w-0">
          <TechCell order={order} tech={tech} techHidden={techHidden} statusOptions={statusOptions} color={techColor} />
        </div>
        <DeskLinkButton link={techLink} />
      </div>
      <button type="button" aria-label="История заказа" title="История заказа" className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" onClick={onOpen}>
        <History className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** «Даты»: ↓ получен и ➤ выдан, как на столе ОС (только показ). У заказа без ОС — одна дата. */
function LeadDatesCell({ order }: { order: LeadOrder }) {
  if (order.kind !== "os") {
    return <span className="font-mono text-[12px] tabular-nums text-muted-foreground">{order.dateMs ? formatDayMonth(order.dateMs) : "—"}</span>;
  }
  const slots = osDateSlots(order.row, { upsellKey: order.keys.upsell || "upsell", mirrorCreatedAt: order.copy?.createdAt ?? null });
  return <OsDatesCell info={{ received: slots.received, issued: slots.issued }} />;
}

/** «Дата сдачи» — дедлайн из визитки; прошёл, а заказ не закрыт — красным. Нажатие открывает визитку. */
function DeadlineCell({ order, statusOptions, onOpen }: { order: LeadOrder; statusOptions: readonly StatusOption[]; onOpen: () => void }) {
  const deadline = leadDeadlineOf(order);
  const overdue = deadline !== null && deadline < almatyMidnightMillis(Date.now()) && !leadIsClosed(order, statusOptions);
  return (
    <button
      type="button"
      onClick={onOpen}
      title={deadline !== null ? `Сдать до ${formatFullDate(deadline)}${overdue ? " — срок прошёл" : ""}` : "Срок сдачи — в визитке клиента"}
      className={cn(
        "flex h-7 w-full items-center rounded-md px-1.5 font-mono text-[12px] tabular-nums hover:bg-accent/60",
        deadline === null ? "text-muted-foreground/50" : overdue ? "font-semibold text-destructive" : "text-foreground"
      )}
    >
      {deadline === null ? "—" : formatDayMonth(deadline)}
    </button>
  );
}

function LeadMobileCard({
  order,
  os,
  tech,
  techHidden,
  statusOptions,
  onOpen,
  osColor,
  techColor,
}: {
  order: LeadOrder;
  os: WorkspaceMember | null;
  tech: TechIdentity | null;
  techHidden: boolean;
  statusOptions: readonly StatusOption[];
  onOpen: () => void;
  osColor: string | null;
  techColor: string | null;
}) {
  const deadline = leadDeadlineOf(order);
  const overdue = deadline !== null && deadline < almatyMidnightMillis(Date.now()) && !leadIsClosed(order, statusOptions);
  return (
    <button type="button" onClick={onOpen} className="flex w-full min-w-0 flex-col gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5 text-left">
      <div className="flex min-w-0 items-center gap-2">
        <IdCard className="h-4 w-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{order.client || "без имени"}</span>
        <span className="shrink-0 font-mono text-[13px] tabular-nums">{order.total === null ? "—" : formatNumber(order.total)}</span>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <MobileStatusPill order={order} statusOptions={statusOptions} />
        <TechStatusMark order={order} statusOptions={statusOptions} full />
      </div>
      <div className="flex min-w-0 items-center gap-2 text-[12px] text-muted-foreground">
        <span className="truncate">{order.phone || "без номера"}</span>
        {deadline !== null ? (
          <span className={cn("shrink-0 font-mono tabular-nums", overdue && "font-semibold text-destructive")}>до {formatDayMonth(deadline)}</span>
        ) : null}
        <span className="ml-auto shrink-0 font-mono tabular-nums">{order.dateMs ? formatDayMonth(order.dateMs) : ""}</span>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 max-w-[45%]">
          {os ? (
            <PersonPill color={osColor}>
              <OsLabel member={os} />
            </PersonPill>
          ) : (
            <OsLabel member={os} />
          )}
        </span>
        <span className="text-muted-foreground">→</span>
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {tech ? (
            <PersonPill color={techColor}>
              <TechBadge identity={tech} />
            </PersonPill>
          ) : (
            <span className="text-[12.5px] text-muted-foreground">{techHidden ? TECH_DESK_HIDDEN_LABEL : "не выдан"}</span>
          )}
          {tech && techHidden ? <HiddenDeskMark /> : null}
        </span>
      </div>
    </button>
  );
}

function MobileStatusPill({ order, statusOptions }: { order: LeadOrder; statusOptions: readonly StatusOption[] }) {
  const effective = leadStatusOf(order, statusOptions);
  const shown = effective || (order.kind === "os" ? approvalStatusValue([...statusOptions]) : "");
  if (!shown || !statusOptions.some((o) => o.value === shown)) {
    return <span className="rounded-full border border-dashed border-border px-2.5 py-[3px] text-[11px] text-muted-foreground">без статуса</span>;
  }
  return <StatusBadge value={shown} options={[...statusOptions]} className="max-w-none shrink-0" />;
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
