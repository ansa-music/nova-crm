import { useState } from "react";
import { Link } from "react-router";
import { AtSign, ChevronRight, MessageCircle, Star, Trash2 } from "lucide-react";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { ScoreChip, ScoreMeter, ScoreRateButton, SCORE_TONE } from "@/components/technicians/ScoreRating";
import { usePresenceMap } from "@/hooks/usePresenceMap";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { cn } from "@/utils/cn";
import { formatOrderDate, timeAgo } from "@/utils/date";
import { personLabel } from "@/utils/peopleDesks";
import { getPresenceStatus, PRESENCE_DOT_COLOR, PRESENCE_LABEL } from "@/utils/presence";
import type { StatusBreakdownItem, TechLoadSummary } from "@/utils/techLoad";
import { memberHasRole, rolesLabel, type WorkspaceMember, type WorkspacePage } from "@/types";

/** One of the viewing ОС's orders at this Технарь, with its status resolved for display. */
export interface TechnicianOrderItem {
  /** Стол и вкладка, в которых лежит заказ — адрес его оценки. */
  pageId: string;
  tabId: string;
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

/** Owner: кто какой заказ как оценил (в оценке — название заказа). */
export interface TechnicianRatingDetail {
  id: string;
  raterLabel: string;
  title: string;
  score: number;
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
  /** Средняя оценка заказов технаря за месяц (1–10) и сколько заказов оценено. */
  rating: { average: number | null; count: number };
  /** Оценка конкретного заказа этим ОС, если она уже стоит. */
  orderScoreOf?: (item: TechnicianOrderItem) => number | null;
  /** Поставить/сменить (1–10) или снять (null) оценку заказа. Только у ОС с заказами здесь. */
  onRateOrder?: (item: TechnicianOrderItem, score: number | null) => Promise<void>;
  /**
   * Сегодня по графику человек не работает: карточка гаснет и получает
   * заметную метку. Занятость по заказам тут ни при чём — «Свободен» у того,
   * кого сегодня нет, читался как «можно отдать заказ».
   */
  dayOff: { state: "off" | "excused"; hours?: string | null } | null;
  /** Сегодняшняя смена с/до, если она короче дня. */
  todayHours?: string | null;
  /** Owner: кто какой заказ как оценил. */
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

function StatusPill({
  noDesk,
  busy,
  dayOff,
}: {
  noDesk: boolean;
  busy: boolean;
  dayOff: { state: "off" | "excused" } | null;
}) {
  // Выходной важнее занятости: человека сегодня просто нет.
  if (dayOff) {
    return (
      <span className="shrink-0 rounded-full border border-destructive/50 bg-destructive/15 px-2 py-0.5 text-[11px] font-semibold uppercase leading-4 tracking-wide text-destructive">
        {dayOff.state === "off" ? "Выходной" : "Отпросился"}
      </span>
    );
  }
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
  const { member, isMe, desks, busy, summary, breakdown, myOrders, rating, orderScoreOf, onRateOrder, dayOff, todayHours } = props;
  // «В сети» — max(Firestore, Supabase). Выборка общая на вкладку (кэш в
  // presenceService), десяток карточек не множит запросы.
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const presenceAt = usePresenceMap(workspaceId);
  const lastActiveAt = presenceAt(member);
  const presence = lastActiveAt ? getPresenceStatus(lastActiveAt) : "offline";
  const name = personLabel(member) || member.email || "—";
  const noDesk = desks.length === 0;
  const mineCount = myOrders?.summary.total ?? 0;
  // «оценить N» — единственная подсказка на визитке о том, что за кликом
  // есть действие, а не только цифры: заказы этого ОС без оценки.
  const toRate = onRateOrder ? (myOrders?.items ?? []).filter((item) => (orderScoreOf?.(item) ?? null) === null).length : 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Открыть карточку: ${name}`}
        className={cn(
          "group flex h-full w-full flex-col gap-3 rounded-2xl border border-border/70 bg-card/70 p-4 text-left transition-colors",
          "hover:border-primary/45 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isMe && "border-primary/45",
          // Сегодня человека нет — карточка гаснет целиком, чтобы в сетке её
          // было видно как «не сегодня», а не только по метке в углу.
          // Без `grayscale`: он гасил и саму метку «Выходной», а она должна
          // остаться красной и заметной.
          dayOff && "border-border/40 bg-muted/30 opacity-70 hover:opacity-100"
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
                lastActiveAt
                  ? `${PRESENCE_LABEL[presence]} · заходил(а) ${timeAgo(lastActiveAt)}`
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
            {todayHours && !dayOff && (
              <p className="mt-0.5 truncate text-[11px] text-primary">Сегодня {todayHours}</p>
            )}
          </div>

          <StatusPill noDesk={noDesk} busy={busy} dayOff={props.dayOff} />
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
          <ScoreChip
            average={rating.count > 0 ? rating.average : null}
            title={`Средняя оценка за заказы, из 10 · оценено ${rating.count} ${ordersWord(rating.count)}`}
          />
          {mineCount > 0 && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/35 bg-primary/10 px-2 py-0.5 text-[11px] font-medium leading-4 text-primary">
              {mineCount} ваших
            </span>
          )}
          {toRate > 0 && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-amber-400/50 px-2 py-0.5 text-[11px] font-medium leading-4 text-amber-200">
              <Star className="h-3 w-3" /> оценить {toRate}
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
  dayOff,
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
  orderScoreOf,
  onRateOrder,
  ratingDetails,
  onDeleteRating,
  open,
  onOpenChange,
}: TechnicianCardProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const name = personLabel(member) || member.email || "—";
  const noDesk = desks.length === 0;
  const counted = updatedAt > 0;
  const filledMetrics = METRICS.filter(
    (metric) => (showPayment || metric.key !== "payment") && summary[metric.key] > 0
  );

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
            <StatusPill noDesk={noDesk} busy={busy} dayOff={dayOff} />
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <section className="flex flex-col gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-background/40 px-3 py-2">
              <Star className={cn("h-4 w-4 shrink-0", rating.count > 0 ? SCORE_TONE.text : "text-muted-foreground/60")} />
              <span className="text-[12px] font-medium">Оценка за заказы</span>
              <ScoreMeter average={rating.average} count={rating.count} className="ml-auto" />
              {rating.count > 0 && (
                <span className="w-full text-[11px] text-muted-foreground">
                  оценено {rating.count} {ordersWord(rating.count)} в этом месяце · шкала 1–10
                </span>
              )}
            </div>
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
                      <span className="min-w-0 flex-1 basis-full truncate sm:basis-0" title={item.title || undefined}>
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
                          без даты кнопка иначе съезжает влево и колонка
                          оценок перестаёт быть колонкой. */}
                      <span className="ml-auto flex shrink-0 items-center justify-end">
                        {onRateOrder ? (
                          <ScoreRateButton
                            value={orderScoreOf?.(item) ?? null}
                            onRate={(score) => onRateOrder(item, score)}
                            label={`Заказ «${item.title || "без названия"}»`}
                          />
                        ) : (
                          <ScoreChip average={orderScoreOf?.(item) ?? null} />
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {onRateOrder && myOrders.items.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Оценка за каждый заказ — от 1 до 10. Нажмите «Оценить» или балл, чтобы поставить или поменять.
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
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Оценки заказов</p>
              <ul className="flex flex-col gap-1.5">
                {ratingDetails.map((detail) => (
                  <li key={detail.id} className="flex items-center gap-2 text-xs">
                    <AtSign className="h-3 w-3 shrink-0 text-amber-300" />
                    <span className="min-w-0 flex-1 truncate" title={detail.title || undefined}>
                      <span className="text-muted-foreground">{detail.raterLabel}</span>
                      {detail.title ? ` · ${detail.title}` : ""}
                    </span>
                    <ScoreChip average={detail.score} title={`${detail.score} из 10`} />
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
