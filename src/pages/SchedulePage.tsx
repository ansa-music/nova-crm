import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  HardHat,
  Headset,
  Loader2,
  Plus,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { PageHeader, pageChipClass } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { ScheduleGrid, ScheduleLegend, type ScheduleRow } from "@/components/schedule/ScheduleGrid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { confirmDialog } from "@/utils/appDialog";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentMonthKey } from "@/hooks/useCurrentMonthKey";
import { useTechSchedules } from "@/hooks/useDeskLoads";
import { usePermissions } from "@/hooks/usePermissions";
import { refreshWorkspaceMembers, useWorkspace } from "@/hooks/useWorkspace";
import { nextMonthKey, previousMonthKey } from "@/services/monthTabService";
import { monthTabNameForKey } from "@/services/subPageService";
import { saveScheduleGroup, subscribeScheduleGroup } from "@/services/scheduleGroupService";
import { setSelfWorkDay } from "@/services/techScheduleService";
import { personLabel } from "@/utils/peopleDesks";
import { ymdInTimeZone } from "@/utils/date";
import {
  DEFAULT_CUSTOM_GROUP_NAME,
  memberHasRole,
  newSchedulePersonId,
  scheduleDayKey,
  scheduleStateOf,
  type ScheduleGroup,
  type SchedulePerson,
  type TechSchedule,
  type WorkspaceMember,
} from "@/types";

/**
 * «График» — один экран на всех, кто работает по сменам. Разделы намеренно
 * разные: у технарей смены про заказы, у ОС — про приём, у руководства свой
 * ритм, и мешать их в один список бесполезно.
 *
 * Человека с двумя ролями показываем ОДИН раз, в самом «рабочем» его
 * разделе: график хранится по uid, и две строки на один документ означали бы,
 * что правка в одной молча меняет вторую.
 */
export default function SchedulePage() {
  const { profile } = useAuth();
  const permissions = usePermissions();
  const { activeWorkspaceId, members, pages } = useWorkspace();
  const currentMonth = useCurrentMonthKey();
  const [monthKey, setMonthKey] = useState(currentMonth);
  const [busy, setBusy] = useState(false);
  const [group, setGroup] = useState<ScheduleGroup | null>(null);
  const [section, setSection] = useState<string>("all");

  const uid = profile?.uid ?? "";
  const canEdit = permissions.canRetireDesks;
  const schedules = useTechSchedules(activeWorkspaceId, monthKey, permissions.isResolved);
  const byUid = useMemo(() => {
    const map = new Map<string, TechSchedule>();
    for (const s of schedules) map.set(s.uid, s);
    return map;
  }, [schedules]);

  // Чужие member-документы не живые — обновим разово, иначе у только что
  // заведённого человека не будет ни ника, ни фото.
  useEffect(() => {
    if (!activeWorkspaceId) return;
    void refreshWorkspaceMembers(activeWorkspaceId).catch(() => undefined);
  }, [activeWorkspaceId]);

  useEffect(() => {
    setGroup(null);
    if (!activeWorkspaceId) return;
    return subscribeScheduleGroup(activeWorkspaceId, setGroup, () => setGroup(null));
  }, [activeWorkspaceId]);

  const active = useMemo(() => members.filter((m) => m.status === "active" && Boolean(m.uid)), [members]);

  // Кто со столом: роль Технаря ИЛИ он ответственный за живой стол. Второе —
  // ровно про Owner: у него роль owner, но стол есть, и в графике он нужен.
  //
  // Список столов у каждого свой (кому что видно), поэтому человек без роли
  // Технаря, но со столом, у одних попадёт в «Технари», у других — в
  // «Руководство». В графике он есть в любом случае, а это здесь главное.
  const deskOwners = useMemo(
    () => new Set(pages.filter((p) => !p.isDashboard && p.responsibleUserId).map((p) => p.responsibleUserId as string)),
    [pages]
  );

  const groups = useMemo(() => {
    const taken = new Set<string>();
    const take = (list: WorkspaceMember[]) => {
      const out: WorkspaceMember[] = [];
      for (const m of list) {
        if (taken.has(m.uid)) continue;
        taken.add(m.uid);
        out.push(m);
      }
      return out;
    };
    const technicians = take(active.filter((m) => memberHasRole(m, "manager") || deskOwners.has(m.uid)));
    const os = take(active.filter((m) => memberHasRole(m, "os")));
    const leads = take(active.filter((m) => m.role === "teamlead" || m.role === "owner"));
    return { technicians, os, leads };
  }, [active, deskOwners]);

  const rowsOf = (list: WorkspaceMember[]): ScheduleRow[] =>
    list.map((m) => ({
      uid: m.uid,
      label: personLabel(m),
      member: m,
      note: m.role === "owner" ? "Owner" : m.role === "teamlead" ? "Тимлид" : null,
    }));

  const groupName = group?.name?.trim() || DEFAULT_CUSTOM_GROUP_NAME;
  const groupPeople = useMemo(() => group?.people ?? [], [group]);
  const customRows: ScheduleRow[] = useMemo(
    () => groupPeople.map((p) => ({ uid: p.id, label: p.name })),
    [groupPeople]
  );

  const isCurrentMonth = monthKey === currentMonth;
  const todayKey = isCurrentMonth ? scheduleDayKey(ymdInTimeZone(Date.now())) : null;
  const myToday = todayKey ? scheduleStateOf(byUid.get(uid), todayKey) : "work";
  const iAmScheduled = active.some((m) => m.uid === uid);

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

  async function saveGroup(name: string, people: SchedulePerson[]) {
    if (!activeWorkspaceId) return;
    try {
      await saveScheduleGroup({ workspaceId: activeWorkspaceId, name, people, actorUid: uid });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить раздел");
    }
  }

  async function removePerson(row: ScheduleRow) {
    const ok = await confirmDialog({
      title: `Убрать ${row.label}?`,
      description: "Строка исчезнет из графика. Уже проставленные смены останутся в базе — если вернёте человека под тем же именем, они не подтянутся.",
      confirmLabel: "Убрать",
      destructive: true,
    });
    if (!ok) return;
    await saveGroup(groupName, groupPeople.filter((p) => p.id !== row.uid));
  }

  const monthLabel = monthTabNameForKey(monthKey).toLowerCase();
  const sections = [
    { id: "tech", title: "Технари", icon: HardHat, rows: rowsOf(groups.technicians) },
    { id: "os", title: "ОС", icon: Headset, rows: rowsOf(groups.os) },
    { id: "leads", title: "Руководство", icon: ShieldCheck, rows: rowsOf(groups.leads) },
  ].filter((s) => s.rows.length > 0);

  const showCustom = customRows.length > 0 || canEdit;
  const visible = (id: string) => section === "all" || section === id;
  const nothingAtAll = sections.length === 0 && !showCustom;

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
        filters={
          nothingAtAll
            ? undefined
            : [
                <button key="all" type="button" onClick={() => setSection("all")} className={pageChipClass(section === "all")}>
                  Все
                </button>,
                ...sections.map((s) => (
                  <button key={s.id} type="button" onClick={() => setSection(s.id)} className={pageChipClass(section === s.id)}>
                    {s.title}
                    <span className="ml-1 tabular-nums opacity-70">{s.rows.length}</span>
                  </button>
                )),
                ...(showCustom
                  ? [
                      <button
                        key="custom"
                        type="button"
                        onClick={() => setSection("custom")}
                        className={pageChipClass(section === "custom")}
                      >
                        {groupName}
                        {customRows.length > 0 && <span className="ml-1 tabular-nums opacity-70">{customRows.length}</span>}
                      </button>,
                    ]
                  : []),
              ]
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

      {nothingAtAll ? (
        <EmptyState
          eyebrow="График"
          title="Пока некого ставить в график"
          description="Здесь появятся участники со столом, ОС и руководство."
        />
      ) : (
        <div className="flex flex-col gap-6">
          {sections.map(
            (s) =>
              visible(s.id) && (
                <Section key={s.id} icon={s.icon} title={s.title} count={s.rows.length}>
                  <ScheduleGrid
                    workspaceId={activeWorkspaceId ?? ""}
                    monthKey={monthKey}
                    todayKey={todayKey}
                    rows={s.rows}
                    schedules={byUid}
                    canEdit={canEdit && Boolean(activeWorkspaceId)}
                    actorUid={uid}
                  />
                </Section>
              )
          )}

          {showCustom && visible("custom") && (
            <CustomSection
              name={groupName}
              rows={customRows}
              canEdit={canEdit && Boolean(activeWorkspaceId)}
              onRename={(next) => void saveGroup(next, groupPeople)}
              onAdd={(name) => void saveGroup(groupName, [...groupPeople, { id: newSchedulePersonId(), name }])}
            >
              <ScheduleGrid
                workspaceId={activeWorkspaceId ?? ""}
                monthKey={monthKey}
                todayKey={todayKey}
                rows={customRows}
                schedules={byUid}
                canEdit={canEdit && Boolean(activeWorkspaceId)}
                actorUid={uid}
                onRemoveRow={(row) => void removePerson(row)}
              />
            </CustomSection>
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

/**
 * Свой раздел: название задаёт руководство, люди в нём вообще не участники
 * workspace — аккаунта у них нет, роль им не выдают, а смены есть.
 */
function CustomSection({
  name,
  rows,
  canEdit,
  onRename,
  onAdd,
  children,
}: {
  name: string;
  rows: ScheduleRow[];
  canEdit: boolean;
  onRename: (name: string) => void;
  onAdd: (name: string) => void;
  children: React.ReactNode;
}) {
  const [draft, setDraft] = useState(name);
  const [person, setPerson] = useState("");

  // Название могли поменять из другой сессии — черновик следует за ним, пока
  // его не начали править здесь.
  useEffect(() => setDraft(name), [name]);

  function commitName() {
    const next = draft.trim();
    if (!next || next === name) {
      setDraft(name);
      return;
    }
    onRename(next);
  }

  function addPerson() {
    const next = person.trim();
    if (!next) return;
    onAdd(next);
    setPerson("");
  }

  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-xl border border-border/70 bg-card p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <UserPlus className="h-4 w-4 shrink-0 text-primary" />
        {canEdit ? (
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setDraft(name);
            }}
            aria-label="Название раздела"
            className="h-8 w-40 text-sm font-medium"
          />
        ) : (
          <p className="text-sm font-medium">{name}</p>
        )}
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{rows.length}</span>
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={person}
            onChange={(e) => setPerson(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addPerson();
            }}
            placeholder="Имя человека"
            className="h-8 w-48 text-sm"
          />
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={addPerson} disabled={!person.trim()}>
            <Plus className="h-3.5 w-3.5" />
            Добавить
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="py-4 text-[12px] text-muted-foreground">
          Пока пусто. Сюда добавляют тех, кого нет в участниках — смены им ставят так же, как всем.
        </p>
      ) : (
        children
      )}
    </section>
  );
}
