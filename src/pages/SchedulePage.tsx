import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, HardHat, Headset, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { ScheduleGrid, ScheduleLegend } from "@/components/schedule/ScheduleGrid";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentMonthKey } from "@/hooks/useCurrentMonthKey";
import { useTechSchedules } from "@/hooks/useDeskLoads";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { nextMonthKey, previousMonthKey } from "@/services/monthTabService";
import { monthTabNameForKey } from "@/services/subPageService";
import { setSelfWorkDay } from "@/services/techScheduleService";
import { ymdInTimeZone } from "@/utils/date";
import { memberHasRole, scheduleDayKey, scheduleStateOf, type TechSchedule } from "@/types";

/**
 * «График» — отдельный раздел на всех, кто работает по сменам: и технари, и
 * ОС. Выходные и «отпросился» ставят Owner и Тимлид, каждый остальной свой
 * график только смотрит и может сказать «вышел на смену» на сегодня.
 *
 * Людей с двумя ролями (Тимлид + Технарь, Технарь + ОС) показываем ОДИН раз,
 * в секции технарей: график хранится по uid, и две строки на один документ
 * означали бы, что правка в одной молча меняет вторую.
 */
export default function SchedulePage() {
  const { profile } = useAuth();
  const permissions = usePermissions();
  const { activeWorkspaceId, members } = useWorkspace();
  const currentMonth = useCurrentMonthKey();
  const [monthKey, setMonthKey] = useState(currentMonth);
  const [busy, setBusy] = useState(false);

  const uid = profile?.uid ?? "";
  const canEdit = permissions.canRetireDesks;
  const schedules = useTechSchedules(activeWorkspaceId, monthKey, permissions.isResolved);
  const byUid = useMemo(() => {
    const map = new Map<string, TechSchedule>();
    for (const s of schedules) map.set(s.uid, s);
    return map;
  }, [schedules]);

  const active = useMemo(() => members.filter((m) => m.status === "active" && Boolean(m.uid)), [members]);
  const technicians = useMemo(() => active.filter((m) => memberHasRole(m, "manager")), [active]);
  // ОС, которые НЕ технари: у человека с обеими ролями один график, и вторая
  // строка была бы тем же документом под другим заголовком.
  const osOnly = useMemo(
    () => active.filter((m) => memberHasRole(m, "os") && !memberHasRole(m, "manager")),
    [active]
  );

  const isCurrentMonth = monthKey === currentMonth;
  const todayKey = isCurrentMonth ? scheduleDayKey(ymdInTimeZone(Date.now())) : null;
  const myToday = todayKey ? scheduleStateOf(byUid.get(uid), todayKey) : "work";
  const iAmScheduled = active.some((m) => m.uid === uid && (memberHasRole(m, "manager") || memberHasRole(m, "os")));

  async function goOnShift() {
    if (!activeWorkspaceId || !todayKey) return;
    setBusy(true);
    try {
      await setSelfWorkDay({ workspaceId: activeWorkspaceId, uid, monthKey, dayKey: todayKey, working: true });
      toast.success("Вы на смене — отклики на заказы открыты");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось выйти на смену");
    } finally {
      setBusy(false);
    }
  }

  const monthLabel = monthTabNameForKey(monthKey).toLowerCase();

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl p-5 sm:p-8 lg:p-10">
      <PageHeader
        eyebrow="Студия"
        title="График"
        description={
          canEdit
            ? "Кто работает, у кого выходной и кто отпросился. Клик по дню: рабочий → выходной → отпросился."
            : "Кто работает, у кого выходной и кто отпросился. Выходные ставит Тимлид."
        }
        actions={
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-11 w-11 sm:h-9 sm:w-9"
              aria-label="Предыдущий месяц"
              onClick={() => setMonthKey(previousMonthKey(monthKey))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[8.5rem] text-center text-sm font-medium">{monthLabel}</span>
            <Button
              variant="outline"
              size="icon"
              className="h-11 w-11 sm:h-9 sm:w-9"
              aria-label="Следующий месяц"
              onClick={() => setMonthKey(nextMonthKey(monthKey))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            {!isCurrentMonth && (
              <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-0" onClick={() => setMonthKey(currentMonth)}>
                Сегодня
              </Button>
            )}
          </div>
        }
      />

      {iAmScheduled && myToday !== "work" && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-warning/35 bg-warning/[0.08] px-3 py-2.5">
          <p className="min-w-0 flex-1 text-[12px]">
            {myToday === "off" ? "Сегодня у вас выходной" : "Сегодня вы отпросились"} — отклики на заказы закрыты.
          </p>
          <Button size="sm" className="min-h-11 sm:min-h-0" onClick={() => void goOnShift()} disabled={busy}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Вышел на смену
          </Button>
        </div>
      )}

      {technicians.length === 0 && osOnly.length === 0 ? (
        <EmptyState
          eyebrow="График"
          title="Пока некого ставить в график"
          description="Здесь появятся участники с ролью «Технарь» или «ОС»."
        />
      ) : (
        <div className="flex flex-col gap-6">
          <Section icon={HardHat} title="Технари" count={technicians.length}>
            <ScheduleGrid
              workspaceId={activeWorkspaceId ?? ""}
              monthKey={monthKey}
              todayKey={todayKey}
              people={technicians}
              schedules={byUid}
              canEdit={canEdit && Boolean(activeWorkspaceId)}
              actorUid={uid}
            />
          </Section>

          {osOnly.length > 0 && (
            <Section icon={Headset} title="ОС" count={osOnly.length}>
              <ScheduleGrid
                workspaceId={activeWorkspaceId ?? ""}
                monthKey={monthKey}
                todayKey={todayKey}
                people={osOnly}
                schedules={byUid}
                canEdit={canEdit && Boolean(activeWorkspaceId)}
                actorUid={uid}
              />
            </Section>
          )}

          <ScheduleLegend />

          {!isCurrentMonth && (
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5 shrink-0" />
              Смотрите не текущий месяц — «Вышел на смену» доступен только на сегодня.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: typeof HardHat;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-xl border border-border/70 bg-card p-3 sm:p-4">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Icon className="h-4 w-4 shrink-0 text-primary" />
        {title}
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{count}</span>
      </p>
      {children}
    </section>
  );
}
