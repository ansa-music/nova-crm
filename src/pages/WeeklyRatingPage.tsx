import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { CalendarCheck2, EyeOff, HardHat, Lock, RefreshCw, ShieldCheck, UserRound } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { PageHeader, pageChipClass } from "@/components/common/PageHeader";
import { StatsModeSwitch } from "@/components/chat/ChatModeSwitch";
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
  mineKey,
  rangeLabel,
  rateWeekly,
  refreshWeeklyRating,
  setWeeklyRatingConfig,
  useWeeklyRating,
  weekLabel,
  weeklyScoreOf,
  weeklyTargets,
  isWeeklyOs,
  isWeeklyTech,
  type WeeklyDirection,
  type WeeklyRatingState,
  type WeeklyResults,
} from "@/services/weeklyRatingService";
import { cn } from "@/utils/cn";
import { personLabel } from "@/utils/peopleDesks";
import { formatScore, type WorkspaceMember } from "@/types";

type View = "tech" | "os";

const byName = (a: WorkspaceMember, b: WorkspaceMember) => personLabel(a).localeCompare(personLabel(b), "ru");

/**
 * «Оценка недели» (просьба Nurba 27.09.2026): ОС раз в неделю оценивают
 * технарей, технари — ОС, по 10-балльной шкале, анонимно. Итоги — средний
 * балл закрытой недели; они же рядом с ABS и на визитке технаря.
 * Анонимность держит база (SQL 20261032): чужих оценок экран не получает.
 */
export default function WeeklyRatingPage() {
  const { activeWorkspaceId, members } = useWorkspace();
  const permissions = usePermissions();
  const { profile } = useAuth();
  const uid = profile?.uid ?? "";
  const snap = useWeeklyRating(activeWorkspaceId, permissions.isResolved);
  const [params, setParams] = useSearchParams();
  const view: View = params.get("v") === "os" ? "os" : "tech";
  const setView = (v: View) => setParams(v === "tech" ? {} : { v }, { replace: true });
  const state = snap.state;
  const ownerControls = Boolean(state?.isOwner && permissions.actsAsOwner);

  const header = (
    <PageHeader
      className="mb-0"
      eyebrow={state ? `Неделя ${rangeLabel(state.weekStart, state.weekEnd)}` : "Неделя"}
      title="Оценка недели"
      description="ОС оценивают технарей, технари — ОС, от 1 до 10. Анонимно: никто не видит, кто и сколько поставил, — только средний балл после конца недели."
    />
  );

  if (!permissions.isResolved || snap.status === "idle" || (snap.status === "loading" && !state)) {
    return (
      <Shell>
        <StatsModeSwitch />
        {header}
        <Skeleton className="h-40 rounded-xl" />
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
          <Alert tone="warning" title="Оценка недели ещё не включена в базе">
            Она заработает после ближайшего обновления сайта (SQL накатывается при выкладке). Если плашка висит долго — Owner вставляет свежий SQL в «Настройки → Строки таблиц».
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

  const rateDirections = (["os_tech", "tech_os"] as WeeklyDirection[]).filter((d) => state.canRate[d]);

  return (
    <Shell>
      <StatsModeSwitch />
      {header}
      {ownerControls ? <OwnerPanel ws={activeWorkspaceId} state={state} /> : null}

      {rateDirections.length > 0 ? (
        state.enabled ? (
          rateDirections.map((dir) => (
            <RateSection key={dir} ws={activeWorkspaceId} state={state} direction={dir} targets={weeklyTargets(members, dir, uid).sort(byName)} />
          ))
        ) : (
          <Alert tone="info" icon={<Lock className="h-4 w-4" />} title="Сбор оценок выключен">
            Owner выключил оценку недели. Когда включит — здесь появится список.
          </Alert>
        )
      ) : null}

      <ResultsSection
        results={snap.results}
        members={members}
        view={view}
        setView={setView}
        myUid={uid}
        ownerSees={ownerControls}
      />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-4 p-4 sm:p-8">{children}</div>;
}

// ---------------------------------------------------------------------
// Выключатели Owner.
// ---------------------------------------------------------------------

function OwnerPanel({ ws, state }: { ws: string; state: WeeklyRatingState }) {
  const [busy, setBusy] = useState<string | null>(null);
  const save = async (key: string, patch: Parameters<typeof setWeeklyRatingConfig>[1], done: string) => {
    setBusy(key);
    try {
      await setWeeklyRatingConfig(ws, patch);
      toast.success(done);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить");
    } finally {
      setBusy(null);
    }
  };
  const p = state.progress;
  return (
    <Section eyebrow="Только Owner" title="Настройка оценки">
      <div className="flex flex-col gap-3">
        <ToggleRow
          label="Сбор оценок"
          hint={state.enabled ? "ОС и технари ставят оценки за эту неделю" : "выключен — оценить нельзя, итоги прошлых недель остаются"}
          checked={state.enabled}
          disabled={busy !== null}
          onChange={(v) => void save("enabled", { enabled: v }, v ? "Сбор оценок включён" : "Сбор оценок выключен")}
        />
        <ToggleRow
          label="Показывать итоги"
          hint={state.visible ? "средний балл видят все: здесь, в ABS и на «Технарях»" : "итоги скрыты от всех — видите только вы"}
          checked={state.visible}
          disabled={busy !== null}
          onChange={(v) => void save("visible", { visible: v }, v ? "Итоги снова видны всем" : "Итоги скрыты")}
        />
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <span className="mr-1 text-sm">Показывать балл, если оценили не меньше</span>
          {[2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              disabled={busy !== null}
              aria-pressed={state.minRaters === n}
              className={pageChipClass(state.minRaters === n)}
              onClick={() => state.minRaters !== n && void save("min", { minRaters: n }, `Порог: ${n} оценивших`)}
            >
              {n}
            </button>
          ))}
          <p className="basis-full text-[11px] text-muted-foreground">
            При 2 каждый из двоих оценивших вычислит балл другого — поэтому по умолчанию 3.
          </p>
        </div>
        {p ? (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-3 text-[12px] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            Уже оценили на этой неделе: ОС — {p.os_tech.rated} из {p.os_tech.raters}, технари — {p.tech_os.rated} из {p.tech_os.raters}. Кто именно и сколько — не видно никому.
          </p>
        ) : null}
      </div>
    </Section>
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
// Мои оценки.
// ---------------------------------------------------------------------

function RateSection({
  ws,
  state,
  direction,
  targets,
}: {
  ws: string;
  state: WeeklyRatingState;
  direction: WeeklyDirection;
  targets: WorkspaceMember[];
}) {
  const rated = targets.filter((m) => mineKey(direction, m.uid) in state.mine).length;
  const title = direction === "os_tech" ? "Оцените технарей" : "Оцените ОС";
  const rate = (target: string, score: number | null) => {
    rateWeekly(ws, direction, target, score).catch((error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить оценку")
    );
  };
  return (
    <Section
      eyebrow={`Ваши оценки · ${rangeLabel(state.weekStart, state.weekEnd)}`}
      title={title}
      action={
        <span className={cn("rounded-full border px-2 py-0.5 font-mono text-[11px] tabular-nums", rated === targets.length && targets.length > 0 ? "border-success/40 text-success" : "border-border text-muted-foreground")}>
          {rated} из {targets.length}
        </span>
      }
      padded={false}
    >
      {targets.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          {direction === "os_tech" ? "Технарей в команде пока нет." : "ОС в команде пока нет."}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {targets.map((m) => {
            const value = state.mine[mineKey(direction, m.uid)] ?? null;
            return (
              <li key={m.uid} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
                <div className="flex min-w-0 items-center gap-2.5 sm:w-52 sm:shrink-0 sm:pt-0.5">
                  <MemberAvatar id={m.uid} name={m.name} nickname={m.nickname} photoURL={m.photoURL} className="h-8 w-8 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{personLabel(m)}</span>
                  {value === null ? (
                    <span className="shrink-0 rounded-full border border-dashed border-warning/50 px-1.5 text-[10px] leading-4 text-warning sm:hidden">не оценён</span>
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
        Оценку можно менять до конца недели (воскресенье). Средний балл появится в понедельник — без имён. Повторное нажатие на выбранный балл снимает оценку.
      </p>
    </Section>
  );
}

// ---------------------------------------------------------------------
// Итоги.
// ---------------------------------------------------------------------

function ResultsSection({
  results,
  members,
  view,
  setView,
  myUid,
  ownerSees,
}: {
  results: WeeklyResults | null;
  members: WorkspaceMember[];
  view: View;
  setView: (v: View) => void;
  myUid: string;
  ownerSees: boolean;
}) {
  const direction: WeeklyDirection = view === "tech" ? "os_tech" : "tech_os";
  const people = useMemo(
    () => members.filter((m) => m.uid && m.status !== "invited" && (view === "tech" ? isWeeklyTech(m) : isWeeklyOs(m))),
    [members, view]
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

  const lastWeek = results?.weeks[0];
  const chips = (
    <div className="flex flex-wrap gap-2">
      <button type="button" className={pageChipClass(view === "tech")} onClick={() => setView("tech")}>
        <HardHat className="h-3.5 w-3.5" /> Технари
      </button>
      <button type="button" className={pageChipClass(view === "os")} onClick={() => setView("os")}>
        <UserRound className="h-3.5 w-3.5" /> ОС
      </button>
    </div>
  );

  if (!results) return null;
  if (results.hidden && !ownerSees) {
    return (
      <EmptyState
        eyebrow="Итоги"
        title="Итоги скрыты"
        description="Owner скрыл средние баллы недели. Ставить оценки при этом можно, если сбор включён."
      />
    );
  }

  let place = 0;
  return (
    <Section
      eyebrow={lastWeek ? `Итоги недели ${weekLabel(lastWeek)}` : "Итоги"}
      title={view === "tech" ? "Технари — оценка от ОС" : "ОС — оценка от технарей"}
      action={chips}
      padded={false}
    >
      {results.hidden ? (
        <Alert tone="warning" icon={<EyeOff className="h-4 w-4" />} className="m-3" title="Итоги скрыты от всех — видите только вы">
          Включите «Показывать итоги», чтобы средний балл снова был виден команде.
        </Alert>
      ) : null}
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">Пока некого показывать.</p>
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
                      ? `оценили ${score.count}${score.avg4 !== null ? ` · за 4 недели ${formatScore(score.avg4)}` : ""}${
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
        Средний балл прошлой недели. Балл показывается, только если оценили не меньше {results.minRaters} человек, — так нельзя вычислить, кто сколько поставил.
      </p>
    </Section>
  );
}
