import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownAZ, Check, Loader2, Search, SlidersHorizontal, UserX } from "lucide-react";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { pageChipClass } from "@/components/common/PageHeader";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useCurrentMonthKey } from "@/hooks/useCurrentMonthKey";
import { useDeskLoads, useTechSchedules } from "@/hooks/useDeskLoads";
import { useWorkspace } from "@/hooks/useWorkspace";
import { currentMonthSubPageId } from "@/services/monthTabService";
import { techTargetProblem } from "@/services/rows/osOrderMirror";
import { cn } from "@/utils/cn";
import { DEFAULT_STATUS_OPTIONS } from "@/utils/columnOptions";
import { ymdInTimeZone } from "@/utils/date";
import { personLabel, worksAsTechnician } from "@/utils/peopleDesks";
import { effectiveTechLoadKinds, summarizeDeskLoad } from "@/utils/techLoad";
import { formatScheduleHours, scheduleDayKey, scheduleHoursOf, scheduleStateOf, type TechSchedule } from "@/types";

type Availability = "free" | "busy" | "absent" | "blocked";
type Filter = "all" | "free" | "busy" | "absent";
type Sort = "smart" | "name" | "load";

export interface TechPick {
  uid: string;
  nick: string;
  name: string;
}

interface TechCard extends TechPick {
  photoURL: string | null;
  availability: Availability;
  /** Заказов «в работе» в этом месяце. */
  inWork: number;
  /** Всего заказов в этом месяце. */
  total: number;
  /** «Выходной», «Отпросился», «Смена 12:00–15:00». */
  todayNote: string | null;
  /** Почему заказ ему не отдать (нет стола, вкладки и т. п.). */
  problem: string | null;
  mark: string | null;
}

const RANK: Record<Availability, number> = { free: 0, busy: 1, absent: 2, blocked: 3 };
const SORT_KEY = "nova:tech-picker-sort";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "Все" },
  { id: "free", label: "Свободны" },
  { id: "busy", label: "Заняты" },
  { id: "absent", label: "Сегодня нет" },
];

const SORTS: Array<{ id: Sort; label: string }> = [
  { id: "smart", label: "По занятости" },
  { id: "load", label: "Меньше заказов" },
  { id: "name", label: "По имени" },
];

function readSort(): Sort {
  try {
    const v = localStorage.getItem(SORT_KEY);
    return v === "name" || v === "load" ? v : "smart";
  } catch {
    return "smart";
  }
}

/**
 * Выбор технаря НА ВЕСЬ ЭКРАН (просьба Nurba 23.09.2026: «среди большого
 * количества технарей трудно искать нужного»). Поиск по имени и нику,
 * фильтры «Свободны / Заняты / Сегодня нет», сортировка (запоминается) и
 * карточка на человека: сколько заказов в работе, смена или выходной
 * сегодня, почему ему нельзя отдать заказ.
 *
 * Занятость и график — те же агрегаты и правила, что у «Заказов» и
 * «Технарей» (deskLoad + techSchedule): «занят» на трёх экранах значит одно
 * и то же. Подписки живут, только пока окно открыто.
 */
export function TechPickerSheet({
  open,
  title = "Выберите технаря",
  description,
  selectedNick,
  busy = false,
  allowClear = false,
  onPick,
  onClear,
  onClose,
  requireNick = true,
  problemOf,
  markOf,
  onlyUids,
}: {
  open: boolean;
  title?: string;
  description?: string;
  /** Уже выбранный — подсвечен. */
  selectedNick?: string | null;
  /** Идёт запись — карточки не нажимаются. */
  busy?: boolean;
  /** Показать «Без технаря» (снять заказ). */
  allowClear?: boolean;
  onPick: (tech: TechPick) => void;
  onClear?: () => void;
  onClose: () => void;
  /**
   * Нужен ли ник технаря (стол ОС пишет его в строку). На «Заказах» ник не
   * нужен — там свой запрет: `problemOf`.
   */
  requireNick?: boolean;
  /** Своя причина «нельзя отдать» вместо проверки стола для заказа ОС. */
  problemOf?: (uid: string) => string | null;
  /** Метка на карточке — например «откликнулся». */
  markOf?: (uid: string) => string | null;
  /** Показывать только этих людей (кандидаты заказа на «Заказах»). */
  onlyUids?: ReadonlySet<string>;
}) {
  const { activeWorkspaceId, activeWorkspace, members, pages } = useWorkspace();
  const monthKey = useCurrentMonthKey();
  const { loads } = useDeskLoads(activeWorkspaceId, open);
  const { schedules } = useTechSchedules(activeWorkspaceId, monthKey, open);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>(readSort);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setFilter("all");
  }, [open]);

  function changeSort(next: Sort) {
    setSort(next);
    try {
      localStorage.setItem(SORT_KEY, next);
    } catch {
      /* удобство — не данные */
    }
  }

  const cards = useMemo<TechCard[]>(() => {
    const statusOptions = activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS;
    const kinds = effectiveTechLoadKinds(activeWorkspace);
    const todayKey = scheduleDayKey(ymdInTimeZone(Date.now()));
    const scheduleByUid = new Map<string, TechSchedule>(schedules.map((s) => [s.uid, s]));
    const loadByPage = new Map((loads ?? []).map((l) => [l.pageId, l]));
    return members
      .filter((m) =>
        onlyUids
          ? m.status === "active" && onlyUids.has(m.uid)
          : m.status === "active" && m.uid && (m.techNickValue || !requireNick) && worksAsTechnician(m)
      )
      .map((m) => {
        const page = pages.find((p) => p.responsibleUserId === m.uid && !p.inactive && !p.osDesk && !p.isDashboard);
        const load = page ? loadByPage.get(page.id) : undefined;
        const tab = page ? currentMonthSubPageId(page, monthKey) : null;
        const fresh = Boolean(load && tab && load.monthKey === monthKey && load.subPageId === tab);
        const summary = fresh && load ? summarizeDeskLoad(load, statusOptions, kinds) : null;
        const schedule = scheduleByUid.get(m.uid);
        const state = scheduleStateOf(schedule, todayKey);
        const hours = scheduleHoursOf(schedule, todayKey);
        const problem = problemOf ? problemOf(m.uid) : techTargetProblem(pages, m.uid);
        const inWork = summary?.busy ?? 0;
        const availability: Availability = problem ? "blocked" : state !== "work" ? "absent" : inWork > 0 ? "busy" : "free";
        const todayNote =
          state === "off" ? "Выходной" : state !== "work" ? "Отпросился" : hours ? `Смена ${formatScheduleHours(hours)}` : null;
        return {
          uid: m.uid,
          nick: m.techNickValue ?? "",
          name: personLabel(m) || m.techNickValue || m.email || m.uid,
          mark: markOf?.(m.uid) ?? null,
          photoURL: m.photoURL ?? null,
          availability,
          inWork,
          total: summary?.total ?? 0,
          todayNote,
          problem,
        };
      });
  }, [members, pages, loads, schedules, monthKey, activeWorkspace, requireNick, problemOf, markOf, onlyUids]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: cards.length, free: 0, busy: 0, absent: 0 };
    for (const card of cards) {
      if (card.availability === "free") c.free += 1;
      else if (card.availability === "busy") c.busy += 1;
      else if (card.availability === "absent") c.absent += 1;
    }
    return c;
  }, [cards]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const matches = (card: TechCard) => {
      if (!words.length) return true;
      const hay = `${card.name} ${card.nick}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    };
    const byName = (a: TechCard, b: TechCard) => a.name.localeCompare(b.name, "ru");
    const list = cards.filter((c) => (filter === "all" ? true : c.availability === filter) && matches(c));
    if (sort === "name") return list.sort(byName);
    if (sort === "load") return list.sort((a, b) => a.inWork - b.inWork || a.total - b.total || byName(a, b));
    return list.sort((a, b) => RANK[a.availability] - RANK[b.availability] || a.inWork - b.inWork || byName(a, b));
  }, [cards, query, filter, sort]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent
        className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-[92vh] sm:max-h-[92vh] sm:w-[calc(100%-3rem)] sm:max-w-6xl sm:rounded-xl"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          searchRef.current?.focus();
        }}
      >
        <div className="flex flex-col gap-3 border-b border-border/70 px-4 pb-3 pt-4 sm:px-6 sm:pt-5">
          <div className="pr-10">
            <DialogTitle className="font-serif text-xl font-medium tracking-tight sm:text-2xl">{title}</DialogTitle>
            <DialogDescription className="mt-0.5 text-sm">
              {description ?? "Свободные и без заказов — сверху. Поиск — по имени и нику."}
            </DialogDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  const pickable = shown.filter((c) => c.availability !== "blocked");
                  if (e.key === "Enter" && pickable.length === 1 && !busy) {
                    e.preventDefault();
                    onPick(pickable[0]);
                  }
                }}
                placeholder="Найти технаря"
                className="h-11 pl-9 text-base sm:h-10 sm:text-sm"
              />
            </div>
            <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
              {sort === "name" ? (
                <ArrowDownAZ className="hidden h-4 w-4 sm:block" />
              ) : (
                <SlidersHorizontal className="hidden h-4 w-4 sm:block" />
              )}
              <select
                value={sort}
                onChange={(e) => changeSort(e.target.value as Sort)}
                className="h-11 max-w-[9.5rem] rounded-md border border-border bg-background px-2 text-sm text-foreground sm:h-10 sm:max-w-none"
                aria-label="Сортировка"
              >
                {SORTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={cn(pageChipClass(filter === f.id), "shrink-0 whitespace-nowrap")}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
                <span className="tabular-nums opacity-70">{counts[f.id]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {allowClear && onClear && selectedNick ? (
            <button
              type="button"
              disabled={busy}
              onClick={onClear}
              className="mb-3 flex min-h-11 w-full items-center gap-2 rounded-xl border border-dashed border-border px-3 text-sm text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive"
            >
              <UserX className="h-4 w-4" />
              Без технаря — забрать заказ
            </button>
          ) : null}
          {shown.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              {cards.length === 0 ? "Технарей с ником пока нет — ники закрепляют на «Команде»." : "Никого не нашёл."}
            </p>
          ) : (
            <ul className="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(230px,1fr))]">
              {shown.map((card) => (
                <li key={card.uid}>
                  <TechCardButton card={card} selected={card.nick === selectedNick} disabled={busy} onPick={() => onPick(card)} />
                </li>
              ))}
            </ul>
          )}
        </div>
        {busy ? (
          <div className="flex items-center justify-center gap-2 border-t border-border/70 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Сохраняю…
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

const BADGE: Record<Availability, { label: (c: TechCard) => string; tone: string }> = {
  free: { label: () => "Свободен", tone: "bg-success/15 text-success" },
  busy: { label: (c) => `В работе · ${c.inWork}`, tone: "bg-warning/15 text-warning" },
  absent: { label: (c) => (c.todayNote ?? "Сегодня нет").toUpperCase(), tone: "bg-destructive/15 text-destructive" },
  blocked: { label: () => "Нельзя отдать", tone: "bg-muted text-muted-foreground" },
};

function TechCardButton({
  card,
  selected,
  disabled,
  onPick,
}: {
  card: TechCard;
  selected: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  const blocked = card.availability === "blocked";
  const badge = BADGE[card.availability];
  return (
    <button
      type="button"
      disabled={disabled || blocked}
      onClick={onPick}
      title={card.problem ?? undefined}
      className={cn(
        "group flex h-full min-h-[84px] w-full min-w-0 items-start gap-3 rounded-xl border p-3 text-left transition-all",
        selected
          ? "border-primary bg-primary/10 ring-1 ring-primary/40"
          : "border-border bg-card hover:-translate-y-px hover:border-primary/50 hover:shadow-md",
        card.availability === "absent" && !selected && "bg-muted/40",
        blocked && "cursor-not-allowed opacity-60 hover:translate-y-0 hover:shadow-none"
      )}
    >
      <MemberAvatar id={card.uid} name={card.name} photoURL={card.photoURL} className="h-10 w-10 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-semibold">{card.name}</span>
          {selected ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
          {card.mark ? (
            <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">{card.mark}</span>
          ) : null}
        </span>
        <span className={cn("w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide", badge.tone)}>
          {badge.label(card)}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {blocked
            ? card.problem
            : [card.availability !== "absent" ? card.todayNote : null, card.total ? `за месяц ${card.total}` : "в этом месяце без заказов"]
                .filter(Boolean)
                .join(" · ")}
        </span>
      </span>
    </button>
  );
}
