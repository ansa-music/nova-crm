import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Crown, Loader2, Pause, Play, Plus, Search, Settings2, UserCog, X } from "lucide-react";
import { toast } from "sonner";
import { AccessDenied } from "@/components/common/AccessDenied";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { PageHeader } from "@/components/common/PageHeader";
import { GrokPeoplePicker, GrokPickerShell } from "@/components/grok/GrokPeoplePicker";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Section } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  canManageBigQueue,
  DEFAULT_BIG_THRESHOLD,
  pauseUntil,
  saveBigConfig,
  saveBigQueue,
  setBigQueueEnabled,
  setBigQueuePause,
  shortMoney,
  useBigOrderQueue,
  type BigQueueConfig,
} from "@/services/bigOrderQueueService";
import { cn } from "@/utils/cn";
import { almatyMidnightMillis, almatyNoonMillis, ymdInTimeZone, zonedDateFormat } from "@/utils/date";
import { currencySymbol, formatNumber } from "@/utils/format";
import { personLabel, worksAsTechnician } from "@/utils/peopleDesks";
import type { WorkspaceMember } from "@/types";

const timeFormat = () => zonedDateFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const dayFormat = () => zonedDateFormat("ru-RU", { day: "numeric", month: "short" });

const DAY_MS = 86_400_000;
const PAUSE_MAX_DAYS = 90;

/** Конец N-го дня по часам компании: 1 — до конца сегодня, 3 — сегодня + ещё два. */
function endOfDays(days: number, now = Date.now()): number {
  return almatyMidnightMillis(now) + days * DAY_MS;
}

/** «до снятия» / «до конца дня» / «до 2 окт» — последний день паузы включительно. */
function pauseLabel(until: number | null, now = Date.now()): string {
  if (until === null) return "до снятия";
  if (until <= endOfDays(1, now)) return "до конца дня";
  return `до ${dayFormat().format(until - 1)}`;
}

/**
 * «Заказы от 300к+» (просьба Nurba 28.09.2026). Owner назначает ответственных
 * и порог суммы чека, ответственный расставляет очередь технарей: №1 в
 * приоритете. Заказ с чеком от порога ОС отдаёт только технарю из очереди —
 * окно выдачи само открывается на очереди, выходные и занятость не мешают.
 */
export default function BigOrdersPage() {
  const permissions = usePermissions();
  const { profile } = useAuth();
  const { activeWorkspace, activeWorkspaceId, members } = useWorkspace();
  const supabaseRows = activeWorkspace?.rowsBackend === "supabase";
  const snap = useBigOrderQueue(activeWorkspaceId, Boolean(supabaseRows));
  const isOwner = permissions.isResolved && permissions.actsAsOwner;
  const cfg = snap.data;
  const canManage = canManageBigQueue(profile?.uid, cfg, isOwner);

  if (!permissions.isResolved || !activeWorkspace || (supabaseRows && (snap.status === "idle" || snap.status === "loading"))) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 sm:p-8">
        <Skeleton className="h-8 w-60" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    );
  }
  if (!supabaseRows) {
    return (
      <div className="mx-auto w-full max-w-3xl p-4 sm:p-8">
        <Alert tone="warning">Очередь крупных заказов работает, когда строки таблиц хранятся в Supabase («Настройки → Строки таблиц»).</Alert>
      </div>
    );
  }
  if (snap.status === "missing") {
    return (
      <div className="mx-auto w-full max-w-3xl p-4 sm:p-8">
        <Alert tone="warning">Очередь ещё не включена в базе — Owner должен обновить SQL (плашка сверху).</Alert>
      </div>
    );
  }
  if (!canManage) {
    return <AccessDenied reason="Очередь крупных заказов ведут ответственные, которых назначил Owner." />;
  }
  if (!cfg || !activeWorkspaceId) {
    return (
      <div className="mx-auto w-full max-w-3xl p-4 sm:p-8">
        <Alert tone="error">Не удалось прочитать очередь. Обновите страницу.</Alert>
      </div>
    );
  }
  return <BigOrdersBody ws={activeWorkspaceId} cfg={cfg} members={members} isOwner={isOwner} />;
}

function BigOrdersBody({
  ws,
  cfg,
  members,
  isOwner,
}: {
  ws: string;
  cfg: BigQueueConfig;
  members: WorkspaceMember[];
  isOwner: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [managersOpen, setManagersOpen] = useState(false);
  const [thresholdDraft, setThresholdDraft] = useState<string | null>(null);
  const [dateFor, setDateFor] = useState<string | null>(null);
  const [dateDraft, setDateDraft] = useState("");
  const now = Date.now();

  const byUid = useMemo(() => new Map(members.map((m) => [m.uid, m])), [members]);
  const active = useMemo(() => members.filter((m) => m.status === "active" && m.uid), [members]);
  const queue = cfg.queue.map((uid) => ({ uid, member: byUid.get(uid) ?? null, until: pauseUntil(cfg, uid, now) }));
  const pausedCount = queue.filter((q) => q.until !== undefined).length;
  const priorityUid = queue.find((q) => q.until === undefined)?.uid ?? null;
  const candidates = useMemo(() => {
    const inQueue = new Set(cfg.queue);
    const q = query.trim().toLocaleLowerCase("ru");
    return active
      .filter((m) => worksAsTechnician(m) && !inQueue.has(m.uid))
      .filter((m) => !q || `${personLabel(m)} ${m.name ?? ""} ${m.techNickValue ?? ""}`.toLocaleLowerCase("ru").includes(q))
      .sort((a, b) => personLabel(a).localeCompare(personLabel(b), "ru"));
  }, [active, cfg.queue, query]);

  async function writeQueue(next: string[]) {
    setSaving(true);
    try {
      await saveBigQueue(ws, next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить очередь");
    } finally {
      setSaving(false);
    }
  }

  async function writePause(uid: string, on: boolean, until: number | null = null) {
    setSaving(true);
    try {
      await setBigQueuePause(ws, uid, on, until);
      if (!on) toast.success("Снова в очереди");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить паузу");
    } finally {
      setSaving(false);
    }
  }

  async function writeEnabled(on: boolean) {
    setSaving(true);
    try {
      await setBigQueueEnabled(ws, on);
      toast.success(on ? "Очередь снова работает" : "Очередь на паузе — крупные заказы выдаются как обычно");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось переключить очередь");
    } finally {
      setSaving(false);
    }
  }

  function openDate(uid: string) {
    setDateFor(uid);
    setDateDraft(ymdInTimeZone(Date.now() + DAY_MS));
  }

  function saveDate(uid: string) {
    const [y, m, d] = dateDraft.split("-").map(Number);
    const until = almatyNoonMillis(y, (m ?? 1) - 1, d ?? 1) + 12 * 3_600_000;
    if (!Number.isFinite(until) || until <= Date.now() || until > Date.now() + PAUSE_MAX_DAYS * DAY_MS) {
      toast.error(`Дата — с сегодняшней и не дальше ${PAUSE_MAX_DAYS} дней`);
      return;
    }
    setDateFor(null);
    void writePause(uid, true, until);
  }

  function move(index: number, delta: number) {
    const next = [...cfg.queue];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    void writeQueue(next);
  }

  async function saveThreshold() {
    const value = Math.round(Number(String(thresholdDraft ?? "").replace(/[^\d]/g, "")));
    if (!Number.isFinite(value) || value < 1000) {
      toast.error("Порог — от 1 000");
      return;
    }
    try {
      await saveBigConfig(ws, cfg.managers, value);
      setThresholdDraft(null);
      toast.success(`Порог: ${formatNumber(value)} ${currencySymbol()}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить порог");
    }
  }

  const managerNames = cfg.managers.map((uid) => {
    const m = byUid.get(uid);
    return m ? personLabel(m) : "ушёл из команды";
  });
  const updatedBy = cfg.updatedBy ? byUid.get(cfg.updatedBy) : null;
  const pausedBy = cfg.pausedBy ? byUid.get(cfg.pausedBy) : null;

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-4 p-4 sm:p-6">
      <PageHeader
        className="mb-0"
        eyebrow="Очередь технарей"
        title={`Заказы от ${shortMoney(cfg.threshold)}+`}
        description={`Заказ с чеком (цена + апсейл) от ${formatNumber(cfg.threshold)} ${currencySymbol()} ОС отдаёт только технарю из этой очереди: окно выдачи открывается на ней само. №1 — в приоритете. Выходные и занятость на эту выдачу не действуют.`}
      />

      <div
        className={cn(
          "flex items-center gap-3 rounded-xl border px-4 py-3",
          cfg.enabled ? "border-border bg-card" : "border-warning/40 bg-warning/[0.08]"
        )}
      >
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            cfg.enabled ? "bg-success/15 text-success" : "bg-warning/20 text-warning"
          )}
        >
          {cfg.enabled ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium">{cfg.enabled ? "Очередь работает" : "Очередь на паузе"}</span>
          <span className="text-[12px] text-muted-foreground">
            {cfg.enabled
              ? "Заказ от порога ОС отдаёт только технарю из очереди."
              : `Крупные заказы сейчас выдаются как обычно. Очередь и номера сохранены${pausedBy ? ` · поставил(а) ${personLabel(pausedBy)}` : ""}.`}
          </span>
        </span>
        <Switch
          checked={cfg.enabled}
          disabled={saving}
          onCheckedChange={(on) => void writeEnabled(on)}
          aria-label={cfg.enabled ? "Поставить очередь на паузу" : "Включить очередь"}
        />
      </div>

      {isOwner ? (
        <Section eyebrow="Только Owner" title="Настройка">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-full text-[12px] text-muted-foreground sm:w-auto">Ответственные:</span>
              {managerNames.length ? (
                managerNames.map((name, i) => (
                  <span key={cfg.managers[i]} className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[12.5px]">
                    {name}
                  </span>
                ))
              ) : (
                <span className="text-[12.5px] text-muted-foreground">никого — очередь ведёт только Owner</span>
              )}
              <Button variant="outline" size="sm" className="min-h-11 gap-1.5 sm:min-h-8" onClick={() => setManagersOpen(true)}>
                <UserCog className="h-3.5 w-3.5" /> Изменить
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-full text-[12px] text-muted-foreground sm:w-auto">Порог суммы чека:</span>
              <div className="relative w-40">
                <Input
                  value={thresholdDraft ?? formatNumber(cfg.threshold)}
                  onChange={(e) => setThresholdDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveThreshold();
                    if (e.key === "Escape") setThresholdDraft(null);
                  }}
                  inputMode="numeric"
                  aria-label="Порог суммы чека"
                  className="pr-7 font-mono tabular-nums"
                />
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  {currencySymbol()}
                </span>
              </div>
              {thresholdDraft !== null ? (
                <>
                  <Button size="sm" className="min-h-11 sm:min-h-8" onClick={() => void saveThreshold()}>
                    Сохранить
                  </Button>
                  <Button size="sm" variant="ghost" className="min-h-11 sm:min-h-8" onClick={() => setThresholdDraft(null)}>
                    Отмена
                  </Button>
                </>
              ) : cfg.threshold !== DEFAULT_BIG_THRESHOLD ? (
                <span className="text-[11.5px] text-muted-foreground">по умолчанию {formatNumber(DEFAULT_BIG_THRESHOLD)}</span>
              ) : null}
            </div>
          </div>
        </Section>
      ) : null}

      <Section
        eyebrow={`в очереди ${queue.length}${pausedCount ? ` · на паузе ${pausedCount}` : ""}`}
        title="Очередь"
        action={
          <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Сохраняю…
              </>
            ) : cfg.updatedAt ? (
              <>Сохранено · {timeFormat().format(cfg.updatedAt)}{updatedBy ? ` · ${personLabel(updatedBy)}` : ""}</>
            ) : null}
          </span>
        }
        padded={false}
      >
        {queue.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            Очередь пуста — крупные заказы выдаются как обычно. Добавьте технарей кнопкой ниже.
          </p>
        ) : (
          <ol className="flex flex-col divide-y divide-border">
            {queue.map(({ uid, member, until }, i) => {
              const name = member ? personLabel(member) : "ушёл из команды";
              const paused = until !== undefined;
              const top = cfg.enabled && uid === priorityUid;
              return (
                <li key={uid} className="flex flex-col">
                <div
                  className={cn(
                    "flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 sm:flex-nowrap sm:px-4",
                    top && "bg-warning/[0.06]",
                    paused && "bg-muted/30"
                  )}
                  data-paused={paused ? "true" : undefined}
                >
                  <span
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-mono text-sm font-semibold tabular-nums",
                      top ? "bg-warning/20 text-warning" : "bg-muted text-muted-foreground",
                      paused && "opacity-50"
                    )}
                    aria-label={`№${i + 1}`}
                  >
                    {i + 1}
                  </span>
                  <MemberAvatar
                    id={uid}
                    name={name}
                    photoURL={member?.photoURL}
                    className={cn("h-8 w-8 shrink-0", paused && "opacity-50 grayscale")}
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      <span className={cn("truncate text-sm font-medium", paused && "text-muted-foreground")}>{name}</span>
                      {top ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                          <Crown className="h-3 w-3" /> в приоритете
                        </span>
                      ) : null}
                      {paused ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          <Pause className="h-3 w-3" /> на паузе {pauseLabel(until ?? null, now)}
                        </span>
                      ) : null}
                    </span>
                    {member && member.name && member.name !== name ? (
                      <span className="truncate text-[11.5px] text-muted-foreground">{member.name}</span>
                    ) : null}
                  </span>
                  <span className="flex w-full shrink-0 items-center justify-end gap-0.5 sm:w-auto">
                    {paused ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-11 gap-1 px-2.5 sm:min-h-8"
                        disabled={saving}
                        onClick={() => void writePause(uid, false)}
                      >
                        <Play className="h-3.5 w-3.5" /> Вернуть
                      </Button>
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="min-h-11 gap-1 px-2 text-muted-foreground sm:min-h-8"
                            disabled={saving}
                            aria-label="Пауза"
                          >
                            <Pause className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">Пауза</span>
                            <ChevronDown className="h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          <DropdownMenuItem onSelect={() => void writePause(uid, true, null)}>До снятия</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => void writePause(uid, true, endOfDays(1))}>На сегодня</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => void writePause(uid, true, endOfDays(2))}>
                            На сегодня и завтра
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => void writePause(uid, true, endOfDays(3))}>На 3 дня</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => void writePause(uid, true, endOfDays(7))}>На неделю</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onSelect={() => openDate(uid)}>До даты…</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      data-compact
                      className="h-11 w-11 sm:h-8 sm:w-8"
                      aria-label="Выше"
                      disabled={i === 0 || saving}
                      onClick={() => move(i, -1)}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      data-compact
                      className="h-11 w-11 sm:h-8 sm:w-8"
                      aria-label="Ниже"
                      disabled={i === queue.length - 1 || saving}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      data-compact
                      className="h-11 w-11 text-muted-foreground hover:text-destructive sm:h-8 sm:w-8"
                      aria-label="Убрать из очереди"
                      disabled={saving}
                      onClick={() => void writeQueue(cfg.queue.filter((u) => u !== uid))}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </span>
                </div>
                {dateFor === uid ? (
                  <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-border bg-muted/20 px-3 py-2 sm:px-4">
                    <span className="text-[12px] text-muted-foreground">Пауза по (включительно):</span>
                    <Input
                      type="date"
                      autoFocus
                      value={dateDraft}
                      min={ymdInTimeZone(now)}
                      max={ymdInTimeZone(now + (PAUSE_MAX_DAYS - 1) * DAY_MS)}
                      onChange={(e) => setDateDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveDate(uid);
                        if (e.key === "Escape") setDateFor(null);
                      }}
                      className="w-44"
                      aria-label="Дата конца паузы"
                    />
                    <Button size="sm" className="min-h-11 sm:min-h-8" disabled={!dateDraft} onClick={() => saveDate(uid)}>
                      Поставить
                    </Button>
                    <Button size="sm" variant="ghost" className="min-h-11 sm:min-h-8" onClick={() => setDateFor(null)}>
                      Отмена
                    </Button>
                  </div>
                ) : null}
                </li>
              );
            })}
          </ol>
        )}

        <div className="border-t border-border px-3 py-3 sm:px-4">
          {adding ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setAdding(false);
                        setQuery("");
                      }
                      if (e.key === "Enter" && candidates.length === 1) {
                        void writeQueue([...cfg.queue, candidates[0].uid]);
                        setQuery("");
                      }
                    }}
                    placeholder="Найти технаря"
                    className="pl-8"
                    aria-label="Найти технаря"
                  />
                </div>
                <Button variant="ghost" className="min-h-11 sm:min-h-9" onClick={() => { setAdding(false); setQuery(""); }}>
                  Готово
                </Button>
              </div>
              {candidates.length === 0 ? (
                <p className="py-2 text-[12.5px] text-muted-foreground">
                  {query ? "Никого не нашёл." : "Все технари уже в очереди."}
                </p>
              ) : (
                <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
                  {candidates.map((m) => (
                    <li key={m.uid}>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void writeQueue([...cfg.queue, m.uid])}
                        className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2 text-left hover:bg-accent/60 disabled:opacity-60"
                      >
                        <MemberAvatar id={m.uid} name={personLabel(m)} photoURL={m.photoURL} className="h-7 w-7 shrink-0" />
                        <span className="min-w-0 flex-1 truncate text-sm">{personLabel(m)}</span>
                        <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <Button variant="outline" className="min-h-11 gap-1.5 sm:min-h-9" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> Добавить технаря
            </Button>
          )}
        </div>
      </Section>

      <p className="flex items-start gap-2 text-[12px] text-muted-foreground">
        <Settings2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Очередь видят все, кто выдаёт заказы: полосой над выбором технаря, а у заказа от порога — вместо обычного списка.
        Менять очередь можно в любое время — окна выдачи подхватят её сразу. Технарь на паузе сохраняет свой номер,
        но при выдаче его пропускают; пауза с датой снимается сама.
      </p>

      {managersOpen ? (
        <ManagersPicker
          candidates={active}
          initial={cfg.managers}
          onClose={() => setManagersOpen(false)}
          onSave={async (uids) => {
            await saveBigConfig(ws, uids, cfg.threshold);
            toast.success(uids.length ? `Ответственных: ${uids.length}` : "Ответственных нет — очередь ведёт Owner");
          }}
        />
      ) : null}
    </div>
  );
}

function ManagersPicker({
  candidates,
  initial,
  onClose,
  onSave,
}: {
  candidates: WorkspaceMember[];
  initial: string[];
  onClose: () => void;
  onSave: (uids: string[]) => Promise<void>;
}) {
  const known = useMemo(() => new Set(candidates.map((m) => m.uid)), [candidates]);
  const [selected, setSelected] = useState(() => initial.filter((u) => known.has(u)));
  const [busy, setBusy] = useState(false);
  return (
    <GrokPickerShell
      icon={<UserCog className="h-4 w-4 text-primary" />}
      title="Ответственные за очередь"
      description="Не роль, а доп. право: ответственный ведёт очередь крупных заказов. Роль человека не меняется."
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} className="ml-auto">
            Отмена
          </Button>
          <Button
            disabled={busy || selected.length > 10}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave(selected);
                onClose();
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Не удалось сохранить");
              } finally {
                setBusy(false);
              }
            }}
          >
            Сохранить · {selected.length}
          </Button>
        </>
      }
    >
      <GrokPeoplePicker candidates={candidates} selected={selected} onChange={setSelected} />
    </GrokPickerShell>
  );
}
