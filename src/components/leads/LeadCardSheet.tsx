import { Link } from "react-router";
import { ExternalLink, Lock, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/table/StatusBadge";
import { ClientCardSection } from "@/components/table/ClientCardSection";
import { TechBadge } from "@/components/os/TechBadge";
import { PaymentChip } from "@/components/cashbox/PaymentChip";
import { EditableText, OsPicker } from "@/components/leads/LeadCells";
import { LeadOrderHistory, type LeadHistoryContext } from "@/components/leads/LeadHistory";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { DeskLinkButton } from "@/components/common/DeskLinkButton";
import type { DeskLink } from "@/utils/personDeskLinks";
import type { LeadOrder } from "@/services/leadBoardService";
import { deskNavState, deskRowHref } from "@/utils/deskLinks";
import { formatNumber } from "@/utils/format";
import { formatFullDate } from "@/utils/osDates";
import type { TechIdentity } from "@/utils/techIdentity";
import type { PageRow, PaymentMethod, StatusOption, WorkspaceMember } from "@/types";

type RowExtras = NonNullable<PageRow["extras"]>;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-2 border-b border-border/60 py-1.5 last:border-b-0">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * Карточка заказа «Общей таблицы»: визитка клиента (та же, что в столе),
 * статус, суммы, ОС (сменить — строка переедет), технарь и его статус,
 * ссылка на строку в столе и история заказа.
 */
export function LeadCardSheet({
  order,
  onClose,
  workspaceId,
  statusOptions,
  os,
  osMembers,
  tech,
  techDeskHidden = false,
  historyCtx,
  historyVersion,
  onCell,
  onPay,
  methods,
  onExtras,
  onMoveOs,
  onDelete,
  osLink = null,
  techLink = null,
}: {
  order: LeadOrder | null;
  onClose: () => void;
  workspaceId: string;
  statusOptions: readonly StatusOption[];
  os: WorkspaceMember | null;
  osMembers: readonly WorkspaceMember[];
  tech: TechIdentity | null;
  /** Стол технаря закрыт «только для Owner», а смотрит не Owner: копии не видно, стол не открыть. */
  techDeskHidden?: boolean;
  /** «Стол ОС ↗» / «Стол технаря ↗» — см. `utils/personDeskLinks.ts`. */
  osLink?: DeskLink | null;
  techLink?: DeskLink | null;
  historyCtx: LeadHistoryContext;
  historyVersion: number;
  onCell: (order: LeadOrder, key: string, value: string) => Promise<void>;
  onPay: (order: LeadOrder, colKey: string, method: PaymentMethod | null) => void;
  methods: readonly PaymentMethod[];
  onExtras: (order: LeadOrder, extras: RowExtras | null) => Promise<void>;
  onMoveOs: (order: LeadOrder, member: WorkspaceMember) => void;
  /** «Удалить заказ» — со стола ОС, копию у технаря и заказ на «Заказах» (подтверждение — у страницы). */
  onDelete?: (order: LeadOrder) => void;
}) {
  const mobile = useIsMobile();
  const k = order?.keys;
  return (
    <Sheet open={Boolean(order)} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side={mobile ? "bottom" : "right"} className="flex w-full flex-col gap-3 overflow-y-auto sm:w-[min(30rem,92vw)] sm:max-w-[30rem]">
        {order && k ? (
          <>
            <SheetHeader className="text-left">
              <SheetTitle className="truncate pr-8">{order.client || "Без имени"}</SheetTitle>
              <p className="text-[12px] text-muted-foreground">
                {order.kind === "os" ? "Заказ со стола ОС" : "Заказ со стола технаря"} · {formatFullDate(order.dateMs)}
              </p>
            </SheetHeader>

            <ClientCardSection
              key={order.key}
              rowId={order.row.id}
              initial={(order.row.extras ?? {}) as RowExtras}
              canEdit
              pageId={order.pageId}
              onSave={(next) => onExtras(order, next)}
            />

            <div className="rounded-lg border border-border px-3 py-1">
              <Field label="Имя">
                <EditableText value={order.client} ariaLabel="Имя клиента" onCommit={(v) => onCell(order, k.client, v)} />
              </Field>
              <Field label="Номер">
                <EditableText value={order.phone} ariaLabel="Номер" inputMode="tel" disabled={!k.phone} onCommit={(v) => onCell(order, k.phone, v)} />
              </Field>
              <Field label="Статус">
                <Select value={order.status || "__none"} onValueChange={(v) => void onCell(order, k.status, v === "__none" ? "" : v)}>
                  <SelectTrigger className="h-8" aria-label="Статус">
                    <SelectValue>
                      {order.status ? <StatusBadge value={order.status} options={[...statusOptions]} className="max-w-none" /> : <span className="text-muted-foreground">без статуса</span>}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {statusOptions.filter((o) => !o.inactive || o.value === order.status).map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        <StatusBadge value={o.value} options={[...statusOptions]} className="max-w-none" />
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={order.kind === "os" ? "Цена" : "Сумма"}>
                <EditableText
                  value={order.price === null ? "" : String(order.price)}
                  display={order.price === null ? "" : formatNumber(order.price)}
                  ariaLabel="Цена"
                  inputMode="decimal"
                  align="right"
                  disabled={!k.price}
                  onCommit={(v) => onCell(order, k.price, v)}
                />
              </Field>
              {order.kind === "os" ? (
                <Field label="Оплата цены">
                  <PaymentChip row={order.row} colKey={k.price} methods={methods} canEdit onPick={(m) => onPay(order, k.price, m)} />
                </Field>
              ) : null}
              {order.kind === "os" ? (
                <>
                  <Field label="Апсейл">
                    <EditableText
                      value={order.upsell === null ? "" : String(order.upsell)}
                      display={order.upsell === null ? "" : formatNumber(order.upsell)}
                      ariaLabel="Апсейл"
                      inputMode="decimal"
                      align="right"
                      onCommit={(v) => onCell(order, k.upsell, v)}
                    />
                  </Field>
                  <Field label="Оплата апсейла">
                    <PaymentChip row={order.row} colKey={k.upsell} methods={methods} canEdit onPick={(m) => onPay(order, k.upsell, m)} />
                  </Field>
                  <Field label="Итого">
                    <span className="block px-1.5 text-right font-mono text-[12.5px] tabular-nums">{order.total === null ? "—" : formatNumber(order.total)}</span>
                  </Field>
                </>
              ) : null}
              <Field label="ОС">
                <div className="flex min-w-0 items-center gap-1">
                  <div className="min-w-0 flex-1">
                    <OsPicker current={os} osMembers={osMembers} disabled={order.kind !== "os"} onPick={(m) => onMoveOs(order, m)} />
                  </div>
                  <DeskLinkButton link={osLink} withText="Стол" />
                </div>
              </Field>
              <Field label="Технарь">
                <div className="flex min-w-0 items-center gap-2 px-1.5">
                  {tech ? (
                    <TechBadge identity={tech} />
                  ) : (
                    <span className="text-[12.5px] text-muted-foreground">{techDeskHidden ? "стол технаря закрыт Owner" : "не выдан"}</span>
                  )}
                  {tech && techDeskHidden ? (
                    <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                      <Lock className="h-3 w-3" aria-hidden />
                      стол закрыт Owner
                    </span>
                  ) : null}
                  {order.techStatus && order.kind === "os" ? (
                    <span className="ml-auto shrink-0" title="Статус у технаря">
                      <StatusBadge value={order.techStatus} options={[...statusOptions]} className="max-w-none" />
                    </span>
                  ) : null}
                  <DeskLinkButton link={techLink} withText="Стол" className={order.techStatus && order.kind === "os" ? undefined : "ml-auto"} />
                </div>
              </Field>
              {k.link ? (
                <Field label="Ссылка">
                  <EditableText value={String(order.row.cells[k.link] ?? "")} ariaLabel="Ссылка" inputMode="url" onCommit={(v) => onCell(order, k.link, v)} />
                </Field>
              ) : null}
              {k.note ? (
                <Field label="Примечание">
                  <EditableText value={String(order.row.cells[k.note] ?? "")} ariaLabel="Примечание" onCommit={(v) => onCell(order, k.note, v)} />
                </Field>
              ) : null}
            </div>

            {order.kind === "tech" && techDeskHidden ? null : (
              <Link
                to={deskRowHref(order.pageId, order.tabId || null, order.row.id)}
                state={deskNavState({ to: "/leads", label: "Общая таблица" })}
                className="inline-flex items-center gap-1.5 self-start text-[13px] text-primary hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {order.kind === "os" ? "Открыть на столе ОС" : "Открыть на столе технаря"}
              </Link>
            )}

            <div className="flex flex-col gap-1">
              <h3 className="text-[12px] font-medium uppercase tracking-[0.12em] text-muted-foreground">История заказа</h3>
              <LeadOrderHistory workspaceId={workspaceId} order={order} ctx={historyCtx} version={historyVersion} />
            </div>

            {onDelete ? (
              <Button
                variant="outline"
                className="mt-1 min-h-11 gap-1.5 self-start border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive sm:min-h-9"
                onClick={() => onDelete(order)}
              >
                <Trash2 className="h-4 w-4" /> Удалить заказ
              </Button>
            ) : null}
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
