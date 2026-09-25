import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { ArrowLeftRight, Check, Loader2, PenLine, RefreshCw, Search, Send, ShieldCheck, Undo2, Users } from "lucide-react";
import { AccessDenied } from "@/components/common/AccessDenied";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { PageHeader } from "@/components/common/PageHeader";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Section } from "@/components/ui/section";
import { toast } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { usesSupabaseRows } from "@/services/rows/rowsBackend";
import { deskModeOf, setDeskMode, useDeskModeSupported, type DeskMode } from "@/services/rows/deskMode";
import { setDeskTechEditable } from "@/services/rows/osExempt";
import { CarryOverSection } from "@/components/desks/CarryOverSection";
import {
  adoptOrdersToOsDesks,
  countDeskOrders,
  releaseAllOrders,
  releaseDeskOrders,
  type DeskOrderCounts,
  type OsAdoptionProgress,
  type OsAdoptionReport,
} from "@/services/rows/osOrderAdoption";
import { confirmDialog } from "@/utils/appDialog";
import { cn } from "@/utils/cn";
import { firestoreErrorText } from "@/utils/dbError";
import { deskHref, deskNavState } from "@/utils/deskLinks";
import { personLabel, worksAsTechnician } from "@/utils/peopleDesks";
import type { WorkspaceMember, WorkspacePage } from "@/types";

/**
 * «Правка столов» — отдельная вкладка ТОЛЬКО для Owner (просьба Nurba
 * 24.09.2026): кто заполняет столы технарей — всем разом и выборочно, — и
 * перенос заказов между технарями и ОС в обе стороны.
 *
 * Правило держит база (`desk_rows_guard`/`desk_rows_os_managed`,
 * 20261001_tech_fill.sql), а не эта страница: здесь только переключатели.
 * Счётчики заказов читаются из Supabase (строки стола), квоту Firestore они не
 * тратят.
 */

const MODES: { mode: DeskMode; title: string; text: string }[] = [
  {
    mode: "os",
    title: "Заказы ведёт ОС",
    text: "Технарь правит только ссылку на работу и примечание. Статус и сумму меняет ОС, «Успешку» технарь просит.",
  },
  {
    mode: "tech",
    title: "Технари заполняют сами",
    text: "Каждый технарь заполняет свой стол целиком — и свои строки, и заказы, которые выдал ОС. Статус, поставленный технарём, сам уезжает к ОС.",
  },
  {
    mode: "mixed",
    title: "Смешанный (как было)",
    text: "Свои строки технарь правит сам, а заказы, выданные ОС, — только ОС.",
  },
];

interface DeskItem {
  page: WorkspacePage;
  member: WorkspaceMember;
  name: string;
}

type CountState = { status: "loading" } | { status: "error"; message: string } | { status: "ok"; counts: DeskOrderCounts };

/** Сколько столов считать одновременно: 20 запросов разом Supabase не нужны. */
const COUNT_CONCURRENCY = 4;

export default function DeskEditingPage() {
  const permissions = usePermissions();
  const { activeWorkspaceId, activeWorkspace, pages, members } = useWorkspace();
  const isOwner = permissions.actsAsOwner;
  const mode = deskModeOf(activeWorkspace);
  const onSupabase = activeWorkspaceId ? usesSupabaseRows(activeWorkspaceId) : false;
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [counts, setCounts] = useState<Map<string, CountState>>(new Map());
  const [progress, setProgress] = useState<OsAdoptionProgress | null>(null);
  const [report, setReport] = useState<OsAdoptionReport | null>(null);
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const supported = useDeskModeSupported(activeWorkspaceId);

  const desks = useMemo<DeskItem[]>(() => {
    return pages
      .filter((p) => !p.osDesk && !p.isDashboard && !p.inactive && p.responsibleUserId)
      .map((page) => {
        const member = members.find((m) => m.uid === page.responsibleUserId);
        return member ? { page, member, name: personLabel(member) || page.name } : null;
      })
      .filter((d): d is DeskItem => Boolean(d && d.member.status === "active" && worksAsTechnician(d.member) && d.member.role !== "owner"))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [pages, members]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return desks;
    return desks.filter((d) => `${d.name} ${d.page.name} ${d.member.techNickValue ?? ""}`.toLowerCase().includes(q));
  }, [desks, query]);

  const exemptCount = desks.filter((d) => d.page.techEditable).length;

  // Счётчики заказов по столам. Ключ — набор столов: новый стол посчитается,
  // а переименование или отметка «заполняет сам» не перечитывают все столы.
  const deskKey = desks.map((d) => d.page.id).join("|");
  const desksRef = useRef(desks);
  desksRef.current = desks;
  const loadCounts = useCallback(
    async (onlyPageIds?: string[]) => {
      if (!activeWorkspaceId || !onSupabase) return;
      const targets = desksRef.current.filter((d) => !onlyPageIds || onlyPageIds.includes(d.page.id));
      setCounts((prev) => {
        const next = new Map(prev);
        for (const d of targets) next.set(d.page.id, { status: "loading" });
        return next;
      });
      let cursor = 0;
      const worker = async () => {
        while (cursor < targets.length) {
          const d = targets[cursor++];
          let state: CountState;
          try {
            state = { status: "ok", counts: await countDeskOrders(activeWorkspaceId, d.page) };
          } catch (error) {
            state = { status: "error", message: error instanceof Error ? error.message : String(error) };
          }
          setCounts((prev) => new Map(prev).set(d.page.id, state));
        }
      };
      await Promise.all(Array.from({ length: Math.min(COUNT_CONCURRENCY, targets.length) }, worker));
    },
    [activeWorkspaceId, onSupabase]
  );
  useEffect(() => {
    if (isOwner) void loadCounts();
  }, [isOwner, deskKey, loadCounts]);

  if (!permissions.isResolved) return null;
  if (!isOwner || !activeWorkspaceId) {
    return <AccessDenied reason="Кто заполняет столы технарей, решает только Owner." />;
  }
  const workspaceId = activeWorkspaceId;

  async function chooseMode(next: DeskMode) {
    if (next === mode) return;
    const chosen = MODES.find((m) => m.mode === next);
    const ok = await confirmDialog({
      title: `Режим «${chosen?.title}»?`,
      description: `${chosen?.text} Действует сразу у всех технарей; столы, отмеченные «Заполняет сам», остаются открыты в любом режиме.`,
      confirmLabel: "Включить",
    });
    if (!ok) return;
    setBusy("__mode");
    try {
      await setDeskMode(workspaceId, next);
      toast.success(`Режим: ${chosen?.title}`);
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось переключить режим"));
    } finally {
      setBusy(null);
    }
  }

  async function toggleFills(d: DeskItem, next: boolean) {
    setBusy(d.page.id);
    try {
      await setDeskTechEditable(workspaceId, d.page.id, next);
      toast.success(next ? `${d.name} заполняет свой стол сам` : `${d.name}: стол снова по общему режиму`);
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось сохранить"));
    } finally {
      setBusy(null);
    }
  }

  async function adoptDesk(d: DeskItem) {
    const ok = await confirmDialog({
      title: `Передать ОС заказы «${d.name}»?`,
      description:
        "Заказы текущего месяца с ником ОС появятся в столах этих ОС, а у технаря станут заказами ОС: дальше статус и сумму меняет ОС " +
        (d.page.techEditable || mode === "tech" ? "(технарь, пока заполняет сам, тоже может)." : "(технарь — только ссылку и примечание).") +
        " Строки без ника ОС остаются у технаря.",
      confirmLabel: "Передать",
    });
    if (!ok) return;
    setBusy(`adopt:${d.page.id}`);
    setReport(null);
    setLastMessage(null);
    try {
      const result = await adoptOrdersToOsDesks({ workspaceId, members, pageIds: [d.page.id] });
      setReport(result);
      if (result.errors.length) toast.error("Передано с ошибками — подробности ниже");
      else toast.success(`ОС получили заказов: ${result.adopted}`);
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось передать"));
    } finally {
      setBusy(null);
      void loadCounts([d.page.id]);
    }
  }

  async function releaseDesk(d: DeskItem) {
    const willOpen = mode === "os" && !d.page.techEditable;
    const ok = await confirmDialog({
      title: `Вернуть заказы технарю «${d.name}»?`,
      description:
        "Заказы, которые ведёт ОС, станут обычными строками технаря — по всем месяцам его стола. У ОС строки останутся, но этому технарю ОС их больше не пересылает." +
        (willOpen ? " Чтобы технарь мог их править, его стол станет «Заполняет сам»." : ""),
      confirmLabel: "Вернуть",
      destructive: true,
    });
    if (!ok) return;
    setBusy(`release:${d.page.id}`);
    setReport(null);
    setLastMessage(null);
    try {
      const released = await releaseDeskOrders(workspaceId, d.page, d.member.techNickValue ?? "");
      if (willOpen && released > 0) await setDeskTechEditable(workspaceId, d.page.id, true);
      toast.success(released ? `Технарю вернулось заказов: ${released}` : "Заказов под управлением ОС у этого стола нет");
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось вернуть"));
    } finally {
      setBusy(null);
      void loadCounts([d.page.id]);
    }
  }

  async function adoptAll() {
    const ok = await confirmDialog({
      title: "Передать ОС заказы ВСЕХ технарей?",
      description:
        "У каждого заказа текущего месяца с ником ОС появится строка в столе этого ОС, а у технаря он станет заказом ОС. Строки без ника ОС и прошлые месяцы не трогаются. Повтор ничего не размножает.",
      confirmLabel: "Передать всё",
    });
    if (!ok) return;
    setBusy("__adoptAll");
    setReport(null);
    setLastMessage(null);
    try {
      const result = await adoptOrdersToOsDesks({ workspaceId, members, onProgress: setProgress });
      setReport(result);
      if (result.errors.length) toast.error("Передано с ошибками — подробности ниже");
      else toast.success(`ОС получили заказов: ${result.adopted}`);
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось передать"));
    } finally {
      setProgress(null);
      setBusy(null);
      void loadCounts();
    }
  }

  async function releaseAll() {
    const ok = await confirmDialog({
      title: "Вернуть технарям ВСЕ заказы ОС?",
      description:
        "Все заказы, которые ведёт ОС, станут обычными строками технарей — по всем месяцам. Строки в столах ОС не удаляются. Чтобы технари могли их править, выберите режим «Технари заполняют сами» или отметьте столы ниже.",
      confirmLabel: "Вернуть всё",
      destructive: true,
    });
    if (!ok) return;
    setBusy("__releaseAll");
    setReport(null);
    setLastMessage(null);
    try {
      const result = await releaseAllOrders({ workspaceId, members, onProgress: setProgress });
      setLastMessage(
        `Технарям вернулось заказов: ${result.released}` + (result.errors.length ? ` · ошибки: ${result.errors.join(" · ")}` : "")
      );
      if (result.errors.length) toast.error("Вернулось не всё — подробности ниже");
      else toast.success(`Технарям вернулось заказов: ${result.released}`);
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось вернуть"));
    } finally {
      setProgress(null);
      setBusy(null);
      void loadCounts();
    }
  }

  const disabled = busy !== null;

  return (
    <div className="mx-auto w-full min-w-0 max-w-4xl space-y-4 p-4 sm:p-8">
      <PageHeader
        eyebrow="Столы · только Owner"
        title="Правка столов"
        description="Кто заполняет столы технарей — всем разом или выборочно — и перенос заказов между технарями и ОС."
      />

      {!onSupabase && (
        <Alert tone="warning" title="Строки столов пока в Firestore">
          Режим и отметки работают, но перенос заказов и счётчики доступны, когда строки живут в Supabase («Настройки →
          Строки таблиц»).
        </Alert>
      )}

      {onSupabase && supported === false && (
        <Alert tone="warning" title="В Supabase ещё нет обновления для «заполняют сами»">
          Пока SQL не вставлен, «Заполняет сам» открывает технарю только его собственные строки, а заказы, выданные ОС,
          остаются запертыми; режим «Технари заполняют сами» не включится. Вставьте SQL — жёлтая плашка сверху или
          «Настройки → Строки таблиц → Скопировать SQL».
        </Alert>
      )}

      <Section eyebrow="Для всех" title="Кто заполняет столы технарей" padded={false}>
        <div className="grid gap-2 p-3 sm:grid-cols-3">
          {MODES.map((m) => {
            const active = m.mode === mode;
            return (
              <button
                key={m.mode}
                type="button"
                onClick={() => void chooseMode(m.mode)}
                disabled={disabled}
                aria-pressed={active}
                className={cn(
                  "flex min-h-11 flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-colors disabled:opacity-60",
                  active ? "border-primary/40 bg-primary/12" : "border-border hover:bg-accent"
                )}
              >
                <span className={cn("flex items-center gap-1.5 text-[13px] font-medium", active && "text-primary")}>
                  {active ? <Check className="h-3.5 w-3.5" /> : <span className="h-3.5 w-3.5" />}
                  {m.title}
                </span>
                <span className="text-xs leading-5 text-muted-foreground">{m.text}</span>
              </button>
            );
          })}
        </div>
        {busy === "__mode" && (
          <p className="flex items-center gap-2 px-4 pb-3 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Переключаю…
          </p>
        )}
      </Section>

      <Section
        eyebrow="Выборочно"
        title={`Технари · заполняют сами: ${mode === "tech" ? `все ${desks.length}` : `${exemptCount} из ${desks.length}`}`}
        padded={false}
        action={
          onSupabase ? (
            <Button variant="ghost" size="sm" className="min-h-11 gap-1.5 sm:min-h-0" onClick={() => void loadCounts()} disabled={disabled}>
              <RefreshCw className="h-3.5 w-3.5" /> Пересчитать
            </Button>
          ) : null
        }
      >
        <div className="border-b border-border p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Найти технаря или стол" className="h-10 pl-8" />
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            «Заполняет сам» открывает технарю весь его стол в любом режиме — и заказы, которые выдал ОС. «Передать ОС» уводит
            его заказы текущего месяца с ником ОС в столы ОС; «Вернуть» делает заказы ОС обычными строками технаря.
          </p>
        </div>
        {shown.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {desks.length === 0 ? "Столов технарей пока нет." : "Никого не нашёл."}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {shown.map((d) => {
              const state = counts.get(d.page.id);
              const fillsByMode = mode === "tech";
              const fills = fillsByMode || Boolean(d.page.techEditable);
              const c = state?.status === "ok" ? state.counts : null;
              return (
                <li key={d.page.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:gap-3">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <MemberAvatar id={d.member.uid} name={d.name} photoURL={d.member.photoURL} className="h-9 w-9 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                        {d.name}
                        {fills && (
                          <span className="rounded-md bg-primary/12 px-1.5 py-0.5 text-[10px] font-medium text-primary">заполняет сам</span>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        <Link to={deskHref(d.page.id)} state={deskNavState({ to: "/desk-editing", label: "Правка столов" })} className="hover:text-foreground hover:underline">
                          {d.page.name}
                        </Link>
                        {" · "}
                        {!onSupabase ? (
                          "—"
                        ) : !state || state.status === "loading" ? (
                          "считаю…"
                        ) : state.status === "error" ? (
                          <span className="text-destructive">не прочиталось</span>
                        ) : c?.noMonthTab ? (
                          "нет вкладки этого месяца"
                        ) : (
                          <span className="font-mono tabular-nums">
                            заказов {c?.total ?? 0} · ведёт ОС {c?.managed ?? 0}
                            {c?.adoptable === null ? "" : ` · можно передать ${c?.adoptable ?? 0}`}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pl-12 sm:pl-0">
                    <label className="flex min-h-11 items-center gap-2 text-xs text-muted-foreground sm:min-h-0">
                      {busy === d.page.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      <Switch
                        checked={Boolean(d.page.techEditable)}
                        onCheckedChange={(v) => void toggleFills(d, v)}
                        disabled={disabled}
                        aria-label={`${d.name} заполняет свой стол сам`}
                      />
                      Заполняет сам
                    </label>
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11 gap-1.5 sm:min-h-0"
                      disabled={disabled || !onSupabase || c?.adoptable === 0 || Boolean(c?.noMonthTab)}
                      onClick={() => void adoptDesk(d)}
                      title="Заказы текущего месяца с ником ОС — в столы ОС"
                    >
                      {busy === `adopt:${d.page.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      Передать ОС
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11 gap-1.5 sm:min-h-0"
                      disabled={disabled || !onSupabase || c?.managed === 0}
                      onClick={() => void releaseDesk(d)}
                      title="Заказы ОС — обычными строками технаря"
                    >
                      {busy === `release:${d.page.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                      Вернуть
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section eyebrow="Для всех" title="Перенос заказов между технарями и ОС">
        <div className="flex flex-wrap gap-2">
          <Button className="min-h-11 gap-1.5 sm:min-h-0" onClick={() => void adoptAll()} disabled={disabled || !onSupabase}>
            {busy === "__adoptAll" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeftRight className="h-4 w-4" />}
            Технари → ОС: передать все заказы
          </Button>
          <Button variant="outline" className="min-h-11 gap-1.5 sm:min-h-0" onClick={() => void releaseAll()} disabled={disabled || !onSupabase}>
            {busy === "__releaseAll" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
            ОС → технари: вернуть все заказы
          </Button>
        </div>
        {progress && (
          <p className="mt-3 text-sm text-muted-foreground">
            {progress.done} / {progress.total} · {progress.label}
          </p>
        )}
        {lastMessage && <p className="mt-3 text-sm text-muted-foreground">{lastMessage}</p>}
        {report && (
          <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
            <li>
              ОС получили заказов: <span className="font-medium text-foreground">{report.adopted}</span> · столов просмотрено:{" "}
              {report.desks} из {report.deskTotal}
            </li>
            {report.alreadyManaged > 0 && <li>Уже были у ОС: {report.alreadyManaged}</li>}
            {report.createdOsDesks > 0 && <li>Заведено столов ОС: {report.createdOsDesks}</li>}
            {report.skippedNoOs > 0 && <li>Без ника ОС — остались у технаря: {report.skippedNoOs}</li>}
            {report.skippedNoAccount > 0 && (
              <li>
                Ник ОС без аккаунта — пропущено: {report.skippedNoAccount}
                {report.unknownOsNicks.length > 0 && (
                  <>
                    {" "}
                    (<span className="text-foreground">{report.unknownOsNicks.join(", ")}</span> — закрепите ник за человеком на
                    «Команде» и повторите)
                  </>
                )}
              </li>
            )}
            {report.errors.map((e, i) => (
              <li key={i} className="text-destructive">
                {e}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 flex items-start gap-1.5 text-xs leading-5 text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Правило держит база: даже с открытым столом технарь не снимает с заказа метку ОС и не меняет его служебные поля, а
          удалить заказ ОС может только ОС или Owner.
        </p>
      </Section>

      <CarryOverSection
        workspaceId={workspaceId}
        desks={desks}
        members={members}
        workspace={activeWorkspace}
        uid={permissions.uid}
        disabled={disabled}
      />

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <PenLine className="h-3.5 w-3.5" /> Кнопка «Правка столов» на «Столах» и «Технарях» ведёт сюда.
      </p>
    </div>
  );
}
