import { useState } from "react";
import { Link } from "react-router";
import { AtSign, ChevronRight, Loader2, MessageCircle, PackageCheck, Star, Trash2 } from "lucide-react";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { RatingScorePair } from "@/components/technicians/RatingScore";
import { StarRating } from "@/components/technicians/StarRating";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/utils/cn";
import { formatOrderDate, timeAgo } from "@/utils/date";
import { personLabel } from "@/utils/peopleDesks";
import { getPresenceStatus, PRESENCE_DOT_COLOR, PRESENCE_LABEL } from "@/utils/presence";
import type { StatusBreakdownItem, TechLoadSummary } from "@/utils/techLoad";
import { memberHasRole, rolesLabel, type TechRating, type WorkspaceMember, type WorkspacePage } from "@/types";

export type TechnicianRater =
  | { state: "no-nick" }
  | { state: "not-eligible"; nick: string }
  /** `mine` set: already rated — the stars can change any time. */
  | { state: "can-rate"; nick: string; mine: TechRating | null };

/** One of the viewing ОС's orders at this Технарь, with its status resolved for display. */
export interface TechnicianOrderItem {
  /** Стол, в котором лежит заказ — нужен, чтобы адресовать его оценку. */
  pageId: string;
  rowId: string;
  title: string;
  statusLabel: string;
  /** HSL triplet, or null for «без статуса». */
  statusColor: string | null;
  date: number | null;
  updatedAt: number;
}

/** Orders per ОС on this desk this month — for Owner/Тимлид/Admin. */
export interface TechnicianOsShare {
  osValue: string;
  label: string;
  color: string | null;
  count: number;
}

export interface TechnicianRatingDetail {
  id: string;
  raterLabel: string;
  stars: number;
  updatedAt: number;
}

export interface TechnicianCardProps {
  member: WorkspaceMember;
  isMe: boolean;
  desks: WorkspacePage[];
  /** Owner: desk names open the desk. */
  deskLinks: boolean;
  /** Some status counts as «Ждём оплату»: show its tile. */
  showPayment: boolean;
  busy: boolean;
  summary: TechLoadSummary;
  breakdown: StatusBreakdownItem[];
  /** Newest count among the desks; 0 = nothing counted this month yet. */
  updatedAt: number;
  /** Viewer is an ОС with a nick: their own orders at this Технарь this month. */
  myOrders: { summary: TechLoadSummary; breakdown: StatusBreakdownItem[]; items: TechnicianOrderItem[] } | null;
  /** Management view: which ОС gave this month's orders. */
  osShares: TechnicianOsShare[] | null;
  rating: { average: number | null; count: number };
  /** Вторая шкала: среднее по оценкам отдельных заказов этого технаря. */
  orderRating: { average: number | null; count: number };
  rater: TechnicianRater | null;
  onRate?: (stars: number) => Promise<void>;
  /** Оценка конкретного заказа этим ОС, если она уже стоит. */
  orderStarsOf?: (item: TechnicianOrderItem) => number | null;
  /** Поставить/снять оценку заказу. Есть только у ОС, у которого тут есть заказы. */
  onRateOrder?: (item: TechnicianOrderItem, stars: number) => Promise<void>;
  /** Owner/Тимлид/Admin: who rated what. */
  ratingDetails: TechnicianRatingDetail[] | null;
  onDeleteRating?: (id: string) => void;
}

function ordersWord(n: number) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "заказ";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "заказа";
  return "заказов";
}

const METRICS: { key: keyof TechLoadSummary; label: string; tone: string; box?: string }[] = [
  { key: "busy", label: "В работе", tone: "text-destructive" },
  { key: "rework", label: "Переделка", tone: "text-warning" },
  { key: "freeze", label: "Заморозка", tone: "text-cyan-300" },
  { key: "payment", label: "Ждём оплату", tone: "text-emerald-300", box: "border-emerald-400/45 bg-emerald-400/10" },
  { key: "done", label: "Готово", tone: "text-success" },
];

function StatusBar({ items, total }: { items: StatusBreakdownItem[]; total: number }) {
  if (total <= 0) return null;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted/60" aria-hidden>
      {items.map((item) => (
        <span
          key={item.key}
          title={`${item.label}: ${item.count}`}
          className={cn("h-full", !item.color && "bg-muted-foreground/40")}
          style={{
            width: `${(item.count / total) * 100}%`,
            backgroundColor: item.color ? `hsl(${item.color})` : undefined,
          }}
        />
      ))}
    </div>
  );
}

/**
 * Легенда к полосе загрузки. `limit` держит высоту свёрнутой карточки: сверх
 * лимита рисуется «+N» с подсказкой, а не второй ряд чипов.
 */
function StatusChips({ items, compact, limit }: { items: StatusBreakdownItem[]; compact?: boolean; limit?: number }) {
  const shown = limit ? items.slice(0, limit) : items;
  const rest = limit ? items.slice(limit) : [];
  return (
    <ul className={cn("flex flex-wrap gap-1.5", compact && "gap-1")}>
      {shown.map((item) => (
        <li
          key={item.key}
          className={cn(
            "inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/60 bg-background/40 px-2 py-0.5 text-[11px] leading-4",
            compact && "px-1.5 text-[10.5px]"
          )}
        >
          <span
            className={cn("h-1.5 w-1.5 shrink-0 rounded-full", !item.color && "bg-muted-foreground/60")}
            style={item.color ? { backgroundColor: `hsl(${item.color})` } : undefined}
          />
          <span className="truncate">{item.label}</span>
          <span className="font-mono tabular-nums text-muted-foreground">{item.count}</span>
        </li>
      ))}
      {rest.length > 0 && (
        <li
          title={rest.map((i) => `${i.label}: ${i.count}`).join(", ")}
          className={cn(
            "inline-flex items-center rounded-full border border-border/60 bg-background/40 px-2 py-0.5 text-[11px] leading-4 text-muted-foreground",
            compact && "px-1.5 text-[10.5px]"
          )}
        >
          +{rest.length}
        </li>
      )}
    </ul>
  );
}

function StatusPill({ noDesk, busy }: { noDesk: boolean; busy: boolean }) {
  if (noDesk) {
    return (
      <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium leading-4 text-muted-foreground">
        Без стола
      </span>
    );
  }
  return busy ? (
    <span className="shrink-0 rounded-full border border-destructive/45 bg-destructive/12 px-2 py-0.5 text-[11px] font-medium leading-4 text-destructive">
      Занят
    </span>
  ) : (
    <span className="shrink-0 rounded-full border border-success/45 bg-success/12 px-2 py-0.5 text-[11px] font-medium leading-4 text-success">
      Свободен
    </span>
  );
}

/** Маленькая шкала для визитки: иконка + число, без звёзд. */
function MiniScore({ kind, average }: { kind: "overall" | "orders"; average: number | null }) {
  const orders = kind === "orders";
  const Icon = orders ? PackageCheck : Star;
  if (average === null) return null;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4",
        orders ? "border-violet-400/35 bg-violet-400/10 text-violet-200" : "border-amber-400/35 bg-amber-400/10 text-amber-200"
      )}
      title={orders ? "Средняя оценка за заказы" : "Общая оценка от ОС"}
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span className="font-mono tabular-nums">{average.toFixed(1)}</span>
    </span>
  );
}

/**
 * Визитка Технаря. Ровно то, ради чего на этот экран заходят: кто это,
 * свободен ли, сколько заказов и какие у него оценки. Всё остальное —
 * разбивка по статусам, список заказов, сама простановка оценок — живёт
 * за кликом.
 *
 * Раньше это всё лежало в самой карточке, и десяток технарей превращался в
 * километровую ленту, по которой невозможно быстро сравнить людей между
 * собой — а именно сравнение тут и нужно.
 */
export function TechnicianCard(props: TechnicianCardProps) {
  const [open, setOpen] = useState(false);
  const { member, isMe, desks, busy, summary, breakdown, myOrders, rating, orderRating, rater } = props;
  const presence = member.lastActiveAt ? getPresenceStatus(member.lastActiveAt) : "offline";
  const name = personLabel(member) || member.email || "—";
  const noDesk = desks.length === 0;
  const mineCount = myOrders?.summary.total ?? 0;
  // Кружок «можно оценить» — единственная подсказка на визитке о том, что
  // за кликом есть действие, а не только цифры.
  const canRate = rater?.state === "can-rate";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Открыть карточку: ${name}`}
        className={cn(
          "group flex h-full w-full flex-col gap-3 rounded-2xl border border-border/70 bg-card/70 p-4 text-left transition-colors",
          "hover:border-primary/45 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isMe && "border-primary/45"
        )}
      >
        <div className="flex min-w-0 items-start gap-3">
          <div className="relative shrink-0">
            <MemberAvatar
              id={member.uid}
              name={member.name}
              nickname={member.nickname}
              photoURL={member.photoURL}
              className="h-11 w-11 ring-1 ring-primary/30"
            />
            <span
              className={cn("absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-card", PRESENCE_DOT_COLOR[presence])}
              title={
                member.lastActiveAt
                  ? `${PRESENCE_LABEL[presence]} · заходил(а) ${timeAgo(member.lastActiveAt)}`
                  : PRESENCE_LABEL[presence]
              }
            />
          </div>

          <div className="min-w-0 flex-1">
            <p className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[15px] font-semibold leading-5">{name}</span>
              {isMe && (
                <span className="shrink-0 rounded-full bg-primary/15 px-1.5 text-[10px] font-medium leading-4 text-primary">ты</span>
              )}
            </p>
            <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
              {memberHasRole(member, "manager") ? rolesLabel(member) : "Стол технаря"}
              {" · "}
              {noDesk ? "стола нет" : desks.map((desk) => desk.name).join(", ")}
            </p>
          </div>

          <StatusPill noDesk={noDesk} busy={busy} />
        </div>

        {/* Полоска статусов и на свёрнутой карточке: в сетке сразу видно, у
            кого что в работе, а не только «6 заказов». Легенда рядом — без неё
            цвета приходилось угадывать, а на телефоне и навести нечем; полная
            разбивка со всеми статусами остаётся в развёрнутой карточке. */}
        {summary.total > 0 && breakdown.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <StatusBar items={breakdown} total={summary.total} />
            <StatusChips items={breakdown} compact limit={3} />
          </div>
        )}

        <div className="mt-auto flex min-w-0 flex-wrap items-center gap-1.5">
          <span
            className={cn(
              "inline-flex shrink-0 items-baseline gap-1 rounded-full border border-border/60 bg-background/40 px-2 py-0.5 leading-4",
              summary.total === 0 && "text-muted-foreground"
            )}
          >
            <span className="font-mono text-[13px] font-semibold tabular-nums">{summary.total}</span>
            <span className="text-[10px] text-muted-foreground">{ordersWord(summary.total)}</span>
          </span>
          <MiniScore kind="overall" average={rating.average} />
          <MiniScore kind="orders" average={orderRating.average} />
          {mineCount > 0 && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/35 bg-primary/10 px-2 py-0.5 text-[11px] font-medium leading-4 text-primary">
              {mineCount} ваших
            </span>
          )}
          {canRate && !rater.mine && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-400/35 bg-amber-400/10 px-2 py-0.5 text-[11px] font-medium leading-4 text-amber-200">
              <Star className="h-3 w-3" /> оценить
            </span>
          )}
          <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
        </div>
      </button>

      <TechnicianDialog {...props} open={open} onOpenChange={setOpen} />
    </>
  );
}

function TechnicianDialog({
  member,
  isMe,
  desks,
  deskLinks,
  showPayment,
  busy,
  summary,
  breakdown,
  updatedAt,
  myOrders,
  osShares,
  rating,
  orderRating,
  rater,
  onRate,
  orderStarsOf,
  onRateOrder,
  ratingDetails,
  onDeleteRating,
  open,
  onOpenChange,
}: TechnicianCardProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [saving, setSaving] = useState<number | null>(null);
  const [savingOrder, setSavingOrder] = useState<string | null>(null);
  const name = personLabel(member) || member.email || "—";
  const noDesk = desks.length === 0;
  const counted = updatedAt > 0;
  const filledMetrics = METRICS.filter(
    (metric) => (showPayment || metric.key !== "payment") && summary[metric.key] > 0
  );

  async function handleRate(stars: number) {
    if (!onRate || saving !== null) return;
    setSaving(stars);
    try {
      await onRate(stars);
    } finally {
      setSaving(null);
    }
  }

  async function handleRateOrder(item: TechnicianOrderItem, stars: number) {
    if (!onRateOrder || savingOrder) return;
    setSavingOrder(item.rowId);
    try {
      await onRateOrder(item, stars);
    } finally {
      setSavingOrder(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex min-w-0 items-center gap-3">
            <MemberAvatar
              id={member.uid}
              name={member.name}
              nickname={member.nickname}
              photoURL={member.photoURL}
              className="h-10 w-10 shrink-0 ring-1 ring-primary/30"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{name}</span>
              <span className="block truncate text-[12px] font-normal text-muted-foreground">
                {memberHasRole(member, "manager") ? rolesLabel(member) : "Стол технаря"}
                {" · "}
                {noDesk
                  ? "стола нет"
                  : desks.map((desk, i) => (
                      <span key={desk.id}>
                        {i > 0 ? ", " : ""}
                        {deskLinks ? (
                          <Link to={`/page/${desk.id}`} className="hover:text-foreground hover:underline">
                            {desk.name}
                          </Link>
                        ) : (
                          desk.name
                        )}
                      </span>
                    ))}
              </span>
            </span>
            <StatusPill noDesk={noDesk} busy={busy} />
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <section className="flex flex-col gap-2">
            <RatingScorePair overall={rating} orders={orderRating} />

            {/* Приглашение оценить — заметная плашка. Отказ («нет ника», «нет
                свежего заказа») плашкой быть не должен: янтарная рамка зовёт
                нажать на то, что нажать нельзя. */}
            {rater && rater.state !== "can-rate" && (
              <p className="text-[11px] leading-4 text-muted-foreground">
                {rater.state === "no-nick"
                  ? "Оценки откроются, когда Тимлид выдаст вам ник ОС."
                  : `Оценка откроется после вашего заказа у этого технаря — ник «${rater.nick}» в столбце ОС.`}
              </p>
            )}

            {rater && rater.state === "can-rate" && (
              <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.05] px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <p className="text-[11px] font-medium text-amber-300">
                    {rater.mine ? "Ваша общая оценка" : "Оценить технаря"}
                  </p>
                  <div className="flex items-center gap-1">
                    {saving !== null && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                    <StarRating
                      value={saving ?? rater.mine?.stars ?? null}
                      onChange={(stars) => void handleRate(stars)}
                      disabled={saving !== null}
                      label={`Оценка для ${name}`}
                    />
                  </div>
                </div>
                <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                  {rater.mine
                    ? `Поставлена ${timeAgo(rater.mine.updatedAt)} · поменять можно до конца месяца.`
                    : "Одна оценка от вас за месяц — поменять её можно в любое время."}
                </p>
              </div>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Заказы за месяц</p>
            {summary.total > 0 ? (
              <>
                {filledMetrics.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {filledMetrics.map((metric) => (
                      <div
                        key={metric.key}
                        className={cn(
                          "flex min-w-[58px] max-w-[104px] flex-1 flex-col items-center rounded-lg border border-border/60 bg-background/40 px-1 py-1.5 text-center",
                          metric.box
                        )}
                      >
                        <p className={cn("font-mono text-lg leading-none tabular-nums", metric.tone)}>{summary[metric.key]}</p>
                        <p className={cn("mt-1 break-words text-[10px] leading-3", metric.box ? metric.tone : "text-muted-foreground")}>
                          {metric.label}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                <StatusBar items={breakdown} total={summary.total} />
                <StatusChips items={breakdown} />
              </>
            ) : (
              <p className="text-[12px] text-muted-foreground">
                {noDesk ? "Заказы появятся, когда у технаря будет стол." : "В этом месяце заказов нет."}
              </p>
            )}
          </section>

          {/* Оценка каждого выполненного заказа. Ставит её только ОС и
              только в своих заказах — список и есть доказательство права:
              чужих заказов тут не бывает (см. osOrders в firestore.rules). */}
          {myOrders && (
            <section className="flex flex-col gap-2">
              <p className="flex items-center justify-between gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <span>Ваши заказы</span>
                <span className="font-mono tabular-nums">{myOrders.summary.total}</span>
              </p>
              {myOrders.items.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">
                  {myOrders.summary.total > 0
                    ? "Список появится, когда технарь откроет свой стол."
                    : "У этого технаря пока нет ваших заказов."}
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-border/50 rounded-xl border border-border/60">
                  {myOrders.items.map((item) => (
                    <li key={item.rowId} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-[12px]">
                      <span className="min-w-0 flex-1 truncate" title={item.title || undefined}>
                        {item.title || <span className="italic text-muted-foreground">Без названия</span>}
                      </span>
                      <span
                        className={cn(
                          "inline-flex shrink-0 items-center gap-1 truncate rounded-full border px-1.5 py-px text-[10px] font-medium leading-4",
                          !item.statusColor && "border-border/60 text-muted-foreground"
                        )}
                        style={
                          item.statusColor
                            ? {
                                backgroundColor: `hsl(${item.statusColor} / 0.16)`,
                                color: `hsl(${item.statusColor})`,
                                borderColor: `hsl(${item.statusColor} / 0.3)`,
                              }
                            : undefined
                        }
                      >
                        <span className="truncate">{item.statusLabel}</span>
                      </span>
                      {item.date !== null && (
                        <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                          {formatOrderDate(item.date)}
                        </span>
                      )}
                      {/* ml-auto, а не просто «следующий элемент»: у заказа
                          без даты звёзды иначе съезжают влево и колонка
                          оценок перестаёт быть колонкой. */}
                      <span className="ml-auto flex shrink-0 items-center justify-end gap-1">
                        {savingOrder === item.rowId && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                        <StarRating
                          value={orderStarsOf?.(item) ?? null}
                          onChange={onRateOrder ? (stars) => void handleRateOrder(item, stars) : undefined}
                          disabled={savingOrder !== null}
                          size="sm"
                          tone="violet"
                          label={`Оценка заказа «${item.title || "без названия"}»`}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {onRateOrder && myOrders.items.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Нажмите на звёзды, чтобы оценить заказ. Клик по той же звезде снимает оценку.
                </p>
              )}
            </section>
          )}

          {osShares && osShares.length > 0 && (
            <section className="flex flex-col gap-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Заказы по ОС</p>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                {osShares.map((share) => (
                  <span
                    key={share.osValue}
                    className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/40 px-2 py-0.5 leading-4"
                  >
                    <AtSign className="h-3 w-3 shrink-0" style={share.color ? { color: `hsl(${share.color})` } : undefined} />
                    <span className="truncate">{share.label}</span>
                    <span className="font-mono tabular-nums text-muted-foreground">{share.count}</span>
                  </span>
                ))}
              </div>
            </section>
          )}

          {ratingDetails && ratingDetails.length > 0 && (
            <section className="flex flex-col gap-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Оценки от ОС</p>
              <ul className="flex flex-col gap-1.5">
                {ratingDetails.map((detail) => (
                  <li key={detail.id} className="flex items-center gap-2 text-xs">
                    <AtSign className="h-3 w-3 shrink-0 text-amber-300" />
                    <span className="min-w-0 flex-1 truncate">{detail.raterLabel}</span>
                    <StarRating value={detail.stars} size="sm" />
                    <span className="w-16 shrink-0 truncate text-right text-[10px] text-muted-foreground" title={timeAgo(detail.updatedAt)}>
                      {timeAgo(detail.updatedAt)}
                    </span>
                    {onDeleteRating && (
                      <button
                        type="button"
                        onClick={() => onDeleteRating(detail.id)}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                        title="Удалить оценку"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <footer className="flex items-center gap-2 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
            <span className="min-w-0 flex-1 truncate">
              {noDesk ? "Стол не назначен" : counted ? `обновлено ${timeAgo(updatedAt)}` : "в этом месяце стол ещё не открывали"}
            </span>
            {!isMe && (
              <Link
                to={`/messages/${member.uid}`}
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-primary/40 px-2.5 text-[11px] font-medium text-primary hover:bg-primary/10"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                Написать
              </Link>
            )}
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  );
}
