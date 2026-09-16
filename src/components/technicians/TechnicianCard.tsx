import { useState } from "react";
import { Link } from "react-router";
import { AtSign, Loader2, MessageCircle, Star, Trash2 } from "lucide-react";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { StarRating } from "@/components/technicians/StarRating";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/utils/cn";
import { timeAgo } from "@/utils/date";
import { personLabel } from "@/utils/peopleDesks";
import { getPresenceStatus, PRESENCE_DOT_COLOR, PRESENCE_LABEL } from "@/utils/presence";
import type { StatusBreakdownItem, TechLoadSummary } from "@/utils/techLoad";
import { memberHasRole, rolesLabel, type TechRating, type WorkspaceMember, type WorkspacePage } from "@/types";

export type TechnicianRater =
  | { state: "no-nick" }
  | { state: "not-eligible"; nick: string }
  /** `mine` set: already rated — the stars can change any time. */
  | { state: "can-rate"; nick: string; mine: TechRating | null };

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
  /** Viewer is an ОС with a nick: their own orders at this Технар this month. */
  myOrders: { summary: TechLoadSummary; breakdown: StatusBreakdownItem[] } | null;
  rating: { average: number | null; count: number };
  rater: TechnicianRater | null;
  onRate?: (stars: number) => Promise<void>;
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

function ratingsWord(n: number) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "оценка";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "оценки";
  return "оценок";
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
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted/60" aria-hidden>
      {items.map((item) => (
        <span
          key={item.key}
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

function StatusChips({ items, compact }: { items: StatusBreakdownItem[]; compact?: boolean }) {
  return (
    <ul className={cn("flex flex-wrap gap-1.5", compact && "gap-1")}>
      {items.map((item) => (
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
    </ul>
  );
}

/** «Визитка» Технара on «Технари»: state, this month's orders by status, rating. */
export function TechnicianCard({
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
  rating,
  rater,
  onRate,
  ratingDetails,
  onDeleteRating,
}: TechnicianCardProps) {
  const [saving, setSaving] = useState<number | null>(null);
  const presence = member.lastActiveAt ? getPresenceStatus(member.lastActiveAt) : "offline";
  const name = personLabel(member) || member.email || "—";
  const noDesk = desks.length === 0;
  const counted = updatedAt > 0;

  async function handleRate(stars: number) {
    if (!onRate || saving !== null) return;
    setSaving(stars);
    try {
      await onRate(stars);
    } finally {
      setSaving(null);
    }
  }

  return (
    <article
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-2xl border border-border/70 bg-card/70 shadow-[0_0_0_1px_hsl(var(--primary)/0.06)]",
        isMe && "border-primary/45"
      )}
    >
      <header className="flex items-start gap-3 px-4 pb-3 pt-4">
        <div className="relative shrink-0">
          <MemberAvatar
            id={member.uid}
            name={member.name}
            nickname={member.nickname}
            photoURL={member.photoURL}
            className="h-12 w-12 ring-1 ring-primary/30"
          />
          <span
            className={cn(
              "absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-card",
              PRESENCE_DOT_COLOR[presence]
            )}
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
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px]">
            <StarRating value={rating.average} size="sm" label="Средняя оценка" />
            {rating.count > 0 && rating.average !== null ? (
              <span className="whitespace-nowrap text-muted-foreground">
                <span className="font-mono font-medium tabular-nums text-foreground">{rating.average.toFixed(1)}</span>
                {" · "}
                {rating.count} {ratingsWord(rating.count)}
              </span>
            ) : (
              <span className="text-muted-foreground">оценок нет</span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {noDesk ? (
            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium leading-4 text-muted-foreground">
              Без стола
            </span>
          ) : busy ? (
            <span className="rounded-full border border-destructive/45 bg-destructive/12 px-2 py-0.5 text-[11px] font-medium leading-4 text-destructive">
              Занят
            </span>
          ) : (
            <span className="rounded-full border border-success/45 bg-success/12 px-2 py-0.5 text-[11px] font-medium leading-4 text-success">
              Свободен
            </span>
          )}
          <p className="text-right leading-none">
            <span className="font-mono text-xl tabular-nums">{summary.total}</span>
            <span className="ml-1 text-[10px] text-muted-foreground">{ordersWord(summary.total)}</span>
          </p>
        </div>
      </header>

      <div className={cn("grid px-4", showPayment ? "grid-cols-5 gap-1" : "grid-cols-4 gap-1.5")}>
        {METRICS.filter((metric) => showPayment || metric.key !== "payment").map((metric) => {
          const value = summary[metric.key];
          return (
            <div
              key={metric.key}
              className={cn(
                "flex min-w-0 flex-col items-center rounded-lg border border-border/60 bg-background/40 px-0.5 py-1.5 text-center",
                value > 0 && metric.box
              )}
            >
              <p className={cn("font-mono text-lg leading-none tabular-nums", value > 0 ? metric.tone : "text-muted-foreground/50")}>
                {value}
              </p>
              <p
                className={cn(
                  "mt-1 flex min-h-[1.5rem] w-full items-start justify-center break-words leading-3",
                  showPayment ? "text-[9.5px]" : "text-[10px]",
                  value > 0 && metric.box ? metric.tone : "text-muted-foreground"
                )}
              >
                {metric.label}
              </p>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-2 px-4 pt-3">
        {summary.total > 0 ? (
          <>
            <StatusBar items={breakdown} total={summary.total} />
            <StatusChips items={breakdown} />
          </>
        ) : (
          <p className="text-[12px] text-muted-foreground">
            {noDesk ? "Заказы появятся, когда у технаря будет стол." : "В этом месяце заказов нет."}
          </p>
        )}
      </div>

      {myOrders && (
        <div className="mx-4 mt-3 rounded-xl border border-primary/25 bg-primary/[0.06] px-3 py-2">
          <p className="flex items-center justify-between gap-2 text-[11px] font-medium text-primary">
            <span>Ваши заказы в этом месяце</span>
            <span className="font-mono tabular-nums">{myOrders.summary.total}</span>
          </p>
          {myOrders.summary.total > 0 ? (
            <div className="mt-1.5">
              <StatusChips items={myOrders.breakdown} compact />
            </div>
          ) : (
            <p className="mt-0.5 text-[11px] text-muted-foreground">У этого технаря пока нет ваших заказов.</p>
          )}
        </div>
      )}

      {rater && (
        <div className="mx-4 mt-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.05] px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <p className="text-[11px] font-medium text-amber-300">
              {rater.state === "can-rate" && rater.mine ? "Ваша оценка" : "Оценить технаря"}
            </p>
            <div className="flex items-center gap-1">
              {saving !== null && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              <StarRating
                value={saving ?? (rater.state === "can-rate" ? rater.mine?.stars ?? null : null)}
                onChange={(stars) => void handleRate(stars)}
                disabled={rater.state !== "can-rate" || saving !== null}
                label={`Оценка для ${name}`}
              />
            </div>
          </div>
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
            {rater.state === "no-nick"
              ? "Оценки откроются, когда Тимлид выдаст вам ник ОС."
              : rater.state === "not-eligible"
                ? `Оценить можно, если за последние 30 дней у технаря был ваш заказ — ник «${rater.nick}» в столбце ОС.`
                : rater.mine
                  ? `Поставлена ${timeAgo(rater.mine.updatedAt)} · поменять можно в любое время.`
                  : "Одна оценка от вас — поменять её можно в любое время."}
          </p>
        </div>
      )}

      <footer className="mt-auto flex items-center gap-2 px-4 pb-3 pt-3 text-[11px] text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">
          {noDesk ? "Стол не назначен" : counted ? `обновлено ${timeAgo(updatedAt)}` : "в этом месяце стол ещё не открывали"}
        </span>
        {ratingDetails && ratingDetails.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-border/70 px-2 text-[11px] font-medium text-foreground hover:bg-accent"
              >
                <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                Оценки
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-3">
              <p className="mb-2 text-xs font-medium">Оценки от ОС</p>
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
            </PopoverContent>
          </Popover>
        )}
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
    </article>
  );
}
