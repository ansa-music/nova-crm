import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Crown, Loader2, Plus, Search, Settings2, UserCog, X } from "lucide-react";
import { toast } from "sonner";
import { AccessDenied } from "@/components/common/AccessDenied";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { PageHeader } from "@/components/common/PageHeader";
import { GrokPeoplePicker, GrokPickerShell } from "@/components/grok/GrokPeoplePicker";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Section } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  canManageBigQueue,
  DEFAULT_BIG_THRESHOLD,
  saveBigConfig,
  saveBigQueue,
  shortMoney,
  useBigOrderQueue,
  type BigQueueConfig,
} from "@/services/bigOrderQueueService";
import { cn } from "@/utils/cn";
import { zonedDateFormat } from "@/utils/date";
import { currencySymbol, formatNumber } from "@/utils/format";
import { personLabel, worksAsTechnician } from "@/utils/peopleDesks";
import type { WorkspaceMember } from "@/types";

const timeFormat = () => zonedDateFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

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

  const byUid = useMemo(() => new Map(members.map((m) => [m.uid, m])), [members]);
  const active = useMemo(() => members.filter((m) => m.status === "active" && m.uid), [members]);
  const queue = cfg.queue.map((uid) => ({ uid, member: byUid.get(uid) ?? null }));
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

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-4 p-4 sm:p-6">
      <PageHeader
        className="mb-0"
        eyebrow="Очередь технарей"
        title={`Заказы от ${shortMoney(cfg.threshold)}+`}
        description={`Заказ с чеком (цена + апсейл) от ${formatNumber(cfg.threshold)} ${currencySymbol()} ОС отдаёт только технарю из этой очереди: окно выдачи открывается на ней само. №1 — в приоритете. Выходные и занятость на эту выдачу не действуют.`}
      />

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
        eyebrow={`${queue.length} в очереди`}
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
            {queue.map(({ uid, member }, i) => {
              const name = member ? personLabel(member) : "ушёл из команды";
              return (
                <li key={uid} className={cn("flex min-h-14 items-center gap-3 px-3 py-2 sm:px-4", i === 0 && "bg-warning/[0.06]")}>
                  <span
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-mono text-sm font-semibold tabular-nums",
                      i === 0 ? "bg-warning/20 text-warning" : "bg-muted text-muted-foreground"
                    )}
                    aria-label={`№${i + 1}`}
                  >
                    {i + 1}
                  </span>
                  <MemberAvatar id={uid} name={name} photoURL={member?.photoURL} className="h-8 w-8 shrink-0" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{name}</span>
                      {i === 0 ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                          <Crown className="h-3 w-3" /> в приоритете
                        </span>
                      ) : null}
                    </span>
                    {member && member.name && member.name !== name ? (
                      <span className="truncate text-[11.5px] text-muted-foreground">{member.name}</span>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 items-center gap-0.5">
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
        Менять очередь можно в любое время — окна выдачи подхватят её сразу.
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
