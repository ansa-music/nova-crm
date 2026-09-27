import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import {
  CalendarCheck2,
  CirclePlay,
  EyeOff,
  Flag,
  HardHat,
  Lock,
  RefreshCw,
  Settings2,
  ShieldCheck,
  UserCog,
  UserRound,
  UserX,
  X,
} from "lucide-react";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { PageHeader, pageChipClass } from "@/components/common/PageHeader";
import { StatsModeSwitch } from "@/components/chat/ChatModeSwitch";
import { GrokPeoplePicker, GrokPickerShell } from "@/components/grok/GrokPeoplePicker";
import { ScorePicker } from "@/components/technicians/ScoreRating";
import { WEEKLY_TONE, WeeklySparkline } from "@/components/technicians/WeeklyScore";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  cancelRatingRound,
  DIRECTION_ON,
  DIRECTION_TEXT,
  finishRatingRound,
  isWeeklyOs,
  isWeeklyTech,
  mineKey,
  rateWeekly,
  refreshWeeklyRating,
  roundLabel,
  setRatingManagers,
  setWeeklyRatingConfig,
  startRatingRound,
  useWeeklyRating,
  weeklyScoreOf,
  weeklyTargets,
  type RatingRound,
  type WeeklyDirection,
  type WeeklyRatingState,
  type WeeklyResults,
} from "@/services/weeklyRatingService";
import { confirmDialog } from "@/utils/appDialog";
import { cn } from "@/utils/cn";
import { zonedDateFormat } from "@/utils/date";
import { myDisplayName } from "@/utils/displayName";
import { personLabel } from "@/utils/peopleDesks";
import { formatScore, type WorkspaceMember } from "@/types";

const byName = (a: WorkspaceMember, b: WorkspaceMember) => personLabel(a).localeCompare(personLabel(b), "ru");

const TAB_DIRECTION: Record<"tech" | "os", WeeklyDirection> = { tech: "os_tech", os: "tech_os" };

function openedText(round: RatingRound) {
  return zonedDateFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    .format(new Date(round.openedAt))
    .replace(/\./g, "");
}

/**
 * «Оценка недели» (просьба Nurba 27.09.2026). Две вкладки: «Технари» — их
 * оценивают ОС, «ОС» — их оценивают технари. Оценку открывает управляющий
 * оценками (Owner или тот, кому он дал право) кнопкой «Еженедельная оценка»,
 * всем оценивающим уходит уведомление; «Завершить» — и появляется итог.
 * Анонимность держит база (SQL 20261033): чужих оценок экран не получает.
 */
export default function WeeklyRatingPage() {
  const { activeWorkspaceId, members } = useWorkspace();
  const permissions = usePermissions();
  const { profile } = useAuth();
  const uid = profile?.uid ?? "";
  const snap = useWeeklyRating(activeWorkspaceId, permissions.isResolved);
  const [params, setParams] = useSearchParams();
  const tab: "tech" | "os" = params.get("v") === "os" ? "os" : "tech";
  const direction = TAB_DIRECTION[tab];
  const setTab = (v: "tech" | "os") => setParams(v === "tech" ? {} : { v }, { replace: true });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const state = snap.state;
  const manager = Boolean(state?.isManager);
  const sender = useMemo(() => ({ uid, name: myDisplayName(profile, members) }), [uid, profile, members]);

  const header = (
    <PageHeader
      className="mb-0"
      eyebrow="Оценка"
      title="Оценка недели"
      description="ОС оценивают технарей, технари — ОС, от 1 до 10. Анонимно: никто не видит, кто и сколько поставил, — только средний балл после завершения."
      actions={
        manager ? (
          <Button variant="outline" size="sm" aria-pressed={settingsOpen} onClick={() => setSettingsOpen((v) => !v)}>
            <Settings2 className="h-4 w-4" />
            Настройка
          </Button>
        ) : null
      }
    />
  );

  if (!permissions.isResolved || snap.status === "idle" || (snap.status === "loading" && !state)) {
    return (
      <Shell>
        <StatsModeSwitch />
        {header}
        <Skeleton className="h-14 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </Shell>
    );
  }

  if (!state || !activeWorkspaceId) {
    return (
      <Shell>
        <StatsModeSwitch />
        {header}
        {snap.status === "missing" ? (
          <Alert tone="warning" title="Оценка ещё не включена в базе">
            Она заработает после ближайшего обновления сайта (SQL накатывается при выкладке).
          </Alert>
        ) : (
          <Alert
            tone="error"
            title="Не удалось загрузить оценки"
            action={
              <Button variant="outline" size="sm" onClick={() => void refreshWeeklyRating(activeWorkspaceId ?? "")}>
                <RefreshCw className="h-3.5 w-3.5" /> Повторить
              </Button>
            }
          >
            Проверьте связь и попробуйте ещё раз.
          </Alert>
        )}
      </Shell>
    );
  }

  const on = state[DIRECTION_ON[direction]];
  const round = state.open[direction];
  const targets = weeklyTargets(members, direction, uid, state.excluded).sort(byName);

  return (
    <Shell>
      <StatsModeSwitch />
      {header}
      {manager && settingsOpen ? (
        <SettingsPanel ws={activeWorkspaceId} state={state} members={members} onClose={() => setSettingsOpen(false)} />
      ) : null}

      <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Кого оцениваем">
        {(["tech", "os"] as const).map((t) => {
          const d = TAB_DIRECTION[t];
          const text = DIRECTION_TEXT[d];
          const r = state.open[d];
          const left = r && state.canRate[d]
            ? weeklyTargets(members, d, uid, state.excluded).filter((m) => !(mineKey(r.id, m.uid) in state.mine)).length
            : 0;
          const active = t === tab;
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t)}
              className={cn(
                "flex min-h-14 min-w-0 items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors",
                active ? "border-primary/50 bg-primary/10" : "border-border bg-card hover:bg-accent",
                !state[DIRECTION_ON[d]] && "opacity-60"
              )}
            >
              {t === "tech" ? (
                <HardHat className={cn("h-5 w-5 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
              ) : (
                <UserRound className={cn("h-5 w-5 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
              )}
              <span className="min-w-0 flex-1">
                <span className={cn("block text-sm font-semibold", active && "text-primary")}>{text.tab}</span>
                <span className="block truncate text-[11px] text-muted-foreground">оценивают {text.who}</span>
              </span>
              {left > 0 ? (
                <span className="shrink-0 rounded-full bg-primary px-1.5 font-mono text-[10px] font-semibold leading-4 text-primary-foreground">
                  {left}
                </span>
              ) : r ? (
                <span className="shrink-0 rounded-full border border-success/40 px-1.5 text-[10px] leading-4 text-success">идёт</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {!on ? (
        <Alert tone="info" icon={<Lock className="h-4 w-4" />} title={`${DIRECTION_TEXT[direction].title} выключена`}>
          {manager ? "Включить можно в «Настройке»." : "Её выключили управляющие оценками."}
        </Alert>
      ) : null}

      {on && manager ? (
        <RoundControl ws={activeWorkspaceId} state={state} direction={direction} round={round} sender={sender} />
      ) : null}

      {on && round && state.canRate[direction] ? (
        <RateSection ws={activeWorkspaceId} state={state} direction={direction} round={round} targets={targets} />
      ) : on && round && !manager ? (
        <Alert tone="info" icon={<CalendarCheck2 className="h-4 w-4" />} title="Идёт оценка">
          {DIRECTION_TEXT[direction].who[0].toUpperCase() + DIRECTION_TEXT[direction].who.slice(1)} оценивают{" "}
          {DIRECTION_TEXT[direction].whom}. Итоги появятся, когда оценку завершат.
        </Alert>
      ) : on && !round && !manager ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-3 text-center text-sm text-muted-foreground">
          Сейчас оценка не идёт — её откроет управляющий оценками, придёт уведомление.
        </p>
      ) : null}

      <ResultsSection results={snap.results} members={members} direction={direction} myUid={uid} privileged={manager} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-4 p-4 sm:p-8">{children}</div>;
}

// ---------------------------------------------------------------------
// Раунд: открыть / завершить / отменить (управляющий).
// ---------------------------------------------------------------------

function RoundControl({
  ws,
  state,
  direction,
  round,
  sender,
}: {
  ws: string;
  state: WeeklyRatingState;
  direction: WeeklyDirection;
  round: RatingRound | null;
  sender: { uid: string; name: string };
}) {
  const [busy, setBusy] = useState(false);
  const text = DIRECTION_TEXT[direction];
  const progress = state.progress[direction];

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось");
    } finally {
      setBusy(false);
    }
  };

  if (!round) {
    return (
      <Section eyebrow="Управление оценками" title={`${text.title}: сейчас не идёт`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">
            Нажмите — {text.who} получат уведомление и смогут оценить {text.whom}. Итоги появятся, когда вы нажмёте «Завершить».
          </p>
          <Button
            disabled={busy}
            className="min-h-11 shrink-0 sm:min-h-9"
            onClick={() =>
              void run(async () => {
                const res = await startRatingRound(ws, direction, sender);
                toast.success(res.already ? "Оценка уже идёт" : "Еженедельная оценка открыта", {
                  description: res.already ? undefined : `Уведомление ушло: ${res.notified}`,
                });
              })
            }
          >
            <CirclePlay className="h-4 w-4" />
            Еженедельная оценка
          </Button>
        </div>
      </Section>
    );
  }

  const pct = progress && progress.raters > 0 ? Math.min(1, progress.rated / progress.raters) : 0;
  return (
    <Section eyebrow="Управление оценками" title={`${text.title} идёт · с ${openedText(round)}`}>
      <div className="flex flex-col gap-3">
        {progress ? (
          <div className="flex items-center gap-3">
            <span className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
              <span className={cn("absolute inset-y-0 left-0 rounded-full", WEEKLY_TONE.meter)} style={{ width: `${pct * 100}%` }} />
            </span>
            <span className="shrink-0 text-sm tabular-nums">
              оценили <b>{progress.rated}</b> из {progress.raters}
            </span>
          </div>
        ) : null}
        <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary" />
          Кто именно и сколько поставил — не видно никому, и вам тоже.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy}
            className="min-h-11 sm:min-h-9"
            onClick={() =>
              void run(async () => {
                const ok = await confirmDialog({
                  title: "Завершить оценку и показать итоги?",
                  description: "После завершения оценки больше не принимаются, а средние баллы увидят все.",
                  confirmLabel: "Завершить",
                });
                if (!ok) return;
                await finishRatingRound(ws, round, sender);
                toast.success("Оценка завершена — итоги видны");
              })
            }
          >
            <Flag className="h-4 w-4" />
            Завершить и показать итоги
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            className="min-h-11 sm:min-h-9"
            onClick={() =>
              void run(async () => {
                const ok = await confirmDialog({
                  title: "Отменить оценку?",
                  description: "Поставленные в ней баллы сотрутся, итогов не будет.",
                  confirmLabel: "Отменить оценку",
                  destructive: true,
                });
                if (!ok) return;
                await cancelRatingRound(ws, round);
                toast.success("Оценка отменена");
              })
            }
          >
            <X className="h-4 w-4" />
            Отменить
          </Button>
        </div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------
// Настройка (управляющий): направления, показ итогов, порог, исключённые;
// Owner — ещё и кто управляет оценками.
// ---------------------------------------------------------------------

function SettingsPanel({
  ws,
  state,
  members,
  onClose,
}: {
  ws: string;
  state: WeeklyRatingState;
  members: WorkspaceMember[];
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState<"excluded" | "managers" | null>(null);
  const save = async (patch: Parameters<typeof setWeeklyRatingConfig>[1], done: string) => {
    setBusy(true);
    try {
      await setWeeklyRatingConfig(ws, patch);
      toast.success(done);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };
  const people = useMemo(() => members.filter((m) => m.uid && m.status !== "invited").sort(byName), [members]);
  const participants = useMemo(() => people.filter((m) => isWeeklyTech(m) || isWeeklyOs(m)), [people]);
  const managerCandidates = useMemo(() => people.filter((m) => m.role !== "owner"), [people]);

  return (
    <Section
      eyebrow="Управление оценками"
      title="Настройка оценки"
      action={
        <Button variant="ghost" size="icon" aria-label="Закрыть настройку" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <ToggleRow
          label="Оценка технарей"
          hint="ОС оценивают технарей"
          checked={state.rateTechs}
          disabled={busy}
          onChange={(v) => void save({ rateTechs: v }, v ? "Оценка технарей включена" : "Оценка технарей выключена")}
        />
        <ToggleRow
          label="Оценка ОС"
          hint="технари оценивают ОС"
          checked={state.rateOs}
          disabled={busy}
          onChange={(v) => void save({ rateOs: v }, v ? "Оценка ОС включена" : "Оценка ОС выключена")}
        />
        <ToggleRow
          label="Показывать итоги"
          hint={state.visible ? "средний балл видят все: здесь, в ABS и на «Технарях»" : "итоги скрыты — видят только Owner и управляющие"}
          checked={state.visible}
          disabled={busy}
          onChange={(v) => void save({ visible: v }, v ? "Итоги снова видны всем" : "Итоги скрыты")}
        />
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <span className="mr-1 text-sm">Показывать балл, если оценили не меньше</span>
          {[2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              disabled={busy}
              aria-pressed={state.minRaters === n}
              className={pageChipClass(state.minRaters === n)}
              onClick={() => state.minRaters !== n && void save({ minRaters: n }, `Порог: ${n} оценивших`)}
            >
              {n}
            </button>
          ))}
          <p className="basis-full text-[11px] text-muted-foreground">
            При 2 каждый из двоих оценивших вычислит балл другого — поэтому по умолчанию 3.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          <Button variant="outline" size="sm" className="min-h-11 sm:min-h-9" onClick={() => setPicker("excluded")}>
            <UserX className="h-4 w-4" />
            Не участвуют · {state.excluded.length}
          </Button>
          {state.isOwner ? (
            <Button variant="outline" size="sm" className="min-h-11 sm:min-h-9" onClick={() => setPicker("managers")}>
              <UserCog className="h-4 w-4" />
              Управляющие оценками · {state.managers.length}
            </Button>
          ) : null}
        </div>
        {state.isOwner ? (
          <p className="text-[11px] text-muted-foreground">
            Управляющий оценками — не роль, а право: открывать и завершать оценку и менять эту настройку. Назначает только Owner.
          </p>
        ) : null}
      </div>

      {picker ? (
        <PeopleDialog
          key={picker}
          title={picker === "excluded" ? "Кто не участвует в оценке" : "Управляющие оценками"}
          description={
            picker === "excluded"
              ? "Отмеченные не оценивают и их не оценивают."
              : "Отмеченные открывают «Еженедельную оценку», завершают её и меняют настройку. Роль у них не меняется."
          }
          icon={picker === "excluded" ? <UserX className="h-4 w-4 text-primary" /> : <UserCog className="h-4 w-4 text-primary" />}
          candidates={picker === "excluded" ? participants : managerCandidates}
          initial={picker === "excluded" ? state.excluded : state.managers}
          onClose={() => setPicker(null)}
          onSave={async (next) => {
            if (picker === "excluded") await setWeeklyRatingConfig(ws, { excluded: next });
            else await setRatingManagers(ws, next);
            toast.success("Сохранено");
          }}
        />
      ) : null}
    </Section>
  );
}

function PeopleDialog({
  title,
  description,
  icon,
  candidates,
  initial,
  onClose,
  onSave,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  candidates: WorkspaceMember[];
  initial: string[];
  onClose: () => void;
  onSave: (next: string[]) => Promise<void>;
}) {
  const known = useMemo(() => new Set(candidates.map((m) => m.uid)), [candidates]);
  const [selected, setSelected] = useState(() => initial.filter((u) => known.has(u)));
  const [busy, setBusy] = useState(false);
  return (
    <GrokPickerShell
      icon={icon}
      title={title}
      description={description}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} className="ml-auto">
            Отмена
          </Button>
          <Button
            disabled={busy}
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

function ToggleRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-[12px] text-muted-foreground">{hint}</span>
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={label} />
    </label>
  );
}

// ---------------------------------------------------------------------
// Мои оценки в открытом раунде.
// ---------------------------------------------------------------------

function RateSection({
  ws,
  state,
  direction,
  round,
  targets,
}: {
  ws: string;
  state: WeeklyRatingState;
  direction: WeeklyDirection;
  round: RatingRound;
  targets: WorkspaceMember[];
}) {
  const rated = targets.filter((m) => mineKey(round.id, m.uid) in state.mine).length;
  const title = direction === "os_tech" ? "Оцените технарей" : "Оцените ОС";
  const rate = (target: string, score: number | null) => {
    rateWeekly(ws, round.id, target, score).catch((error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить оценку")
    );
  };
  return (
    <Section
      eyebrow={`Ваши оценки · с ${openedText(round)}`}
      title={title}
      action={
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 font-mono text-[11px] tabular-nums",
            rated === targets.length && targets.length > 0 ? "border-success/40 text-success" : "border-border text-muted-foreground"
          )}
        >
          {rated} из {targets.length}
        </span>
      }
      padded={false}
    >
      {targets.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          {direction === "os_tech" ? "Технарей для оценки нет." : "ОС для оценки нет."}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {targets.map((m) => {
            const value = state.mine[mineKey(round.id, m.uid)] ?? null;
            return (
              <li key={m.uid} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
                <div className="flex min-w-0 items-center gap-2.5 sm:w-52 sm:shrink-0 sm:pt-0.5">
                  <MemberAvatar id={m.uid} name={m.name} nickname={m.nickname} photoURL={m.photoURL} className="h-8 w-8 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{personLabel(m)}</span>
                  {value === null ? (
                    <span className="shrink-0 rounded-full border border-dashed border-warning/50 px-1.5 text-[10px] leading-4 text-warning sm:hidden">
                      не оценён
                    </span>
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <ScorePicker value={value} onChange={(score) => rate(m.uid, score)} label={`Оценка: ${personLabel(m)}`} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground">
        Оценку можно менять, пока её не завершили. Средний балл появится после завершения — без имён. Повторное нажатие на выбранный балл снимает оценку.
      </p>
    </Section>
  );
}

// ---------------------------------------------------------------------
// Итоги последнего завершённого раунда направления.
// ---------------------------------------------------------------------

function ResultsSection({
  results,
  members,
  direction,
  myUid,
  privileged,
}: {
  results: WeeklyResults | null;
  members: WorkspaceMember[];
  direction: WeeklyDirection;
  myUid: string;
  privileged: boolean;
}) {
  const lastRound = results?.rounds.find((r) => r.direction === direction) ?? null;
  const people = useMemo(
    () => members.filter((m) => m.uid && m.status !== "invited" && (direction === "os_tech" ? isWeeklyTech(m) : isWeeklyOs(m))),
    [members, direction]
  );
  const rows = useMemo(() => {
    const scored = people.map((m) => ({ member: m, score: weeklyScoreOf(results, direction, m.uid) }));
    return scored.sort((a, b) => {
      if (a.score && b.score) return b.score.avg - a.score.avg || b.score.count - a.score.count;
      if (a.score) return -1;
      if (b.score) return 1;
      return byName(a.member, b.member);
    });
  }, [people, results, direction]);

  if (!results) return null;
  const text = DIRECTION_TEXT[direction];
  if (results.hidden && !privileged) {
    return (
      <Alert tone="info" icon={<EyeOff className="h-4 w-4" />} title="Итоги скрыты">
        Управляющие оценками скрыли средние баллы.
      </Alert>
    );
  }
  if (!lastRound) {
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        Итогов пока нет — они появятся после первой завершённой оценки.
      </p>
    );
  }

  let place = 0;
  return (
    <Section
      eyebrow={`Итоги · ${roundLabel(lastRound)}`}
      title={direction === "os_tech" ? "Технари — оценка от ОС" : "ОС — оценка от технарей"}
      padded={false}
    >
      {results.hidden ? (
        <Alert tone="warning" icon={<EyeOff className="h-4 w-4" />} className="m-3" title="Итоги скрыты от всех — видят только Owner и управляющие">
          Включите «Показывать итоги» в настройке, чтобы средний балл снова был виден команде.
        </Alert>
      ) : null}
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">Некого показывать.</p>
      ) : (
        <ol className="divide-y divide-border">
          {rows.map(({ member, score }) => {
            if (score) place += 1;
            const me = member.uid === myUid;
            return (
              <li key={member.uid} className={cn("flex min-w-0 items-center gap-3 px-4 py-2.5", me && "bg-primary/[0.06]", !score && "opacity-70")}>
                <span className="w-5 shrink-0 text-center font-mono text-xs text-muted-foreground tabular-nums">{score ? place : "—"}</span>
                <MemberAvatar id={member.uid} name={member.name} nickname={member.nickname} photoURL={member.photoURL} className="h-8 w-8 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {personLabel(member)}
                    {me ? <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">вы</span> : null}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {score
                      ? `оценили ${score.count}${score.avg4 !== null ? ` · за 4 оценки ${formatScore(score.avg4)}` : ""}${
                          score.delta ? ` · ${score.delta > 0 ? "+" : "−"}${formatScore(Math.abs(score.delta))} к прошлой` : ""
                        }`
                      : `мало оценок — нужно от ${results.minRaters}`}
                  </p>
                </div>
                {score ? <WeeklySparkline history={score.history} className="hidden sm:inline-flex" /> : null}
                <span className="flex w-20 shrink-0 flex-col items-end gap-1">
                  {score ? (
                    <>
                      <span className="font-mono text-base font-semibold leading-none tabular-nums">
                        {formatScore(score.avg)}
                        <span className="text-[10px] font-normal text-muted-foreground">/10</span>
                      </span>
                      <span className="relative h-1.5 w-16 overflow-hidden rounded-full bg-muted" aria-hidden>
                        <span className={cn("absolute inset-y-0 left-0 rounded-full", WEEKLY_TONE.meter)} style={{ width: `${score.avg * 10}%` }} />
                      </span>
                    </>
                  ) : (
                    <span className="text-[11px] text-muted-foreground/70">—</span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <p className="flex items-start gap-1.5 border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground">
        <CalendarCheck2 className="mt-px h-3.5 w-3.5 shrink-0" />
        {text.who[0].toUpperCase() + text.who.slice(1)} оценивали {text.whom}. Балл показывается, только если оценили не меньше{" "}
        {results.minRaters} человек, — так нельзя вычислить, кто сколько поставил.
      </p>
    </Section>
  );
}
