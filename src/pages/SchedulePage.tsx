import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  HardHat,
  Headset,
  Loader2,
  Pencil,
  Plus,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { PageHeader, pageChipClass } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import {
  draftKey,
  ScheduleGrid,
  ScheduleLegend,
  type ScheduleDayAction,
  type ScheduleRow,
} from "@/components/schedule/ScheduleGrid";
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
import { saveScheduleDraft, setCameToWorkDay, setScheduleDay } from "@/services/techScheduleService";
import { personLabel, worksAsTechnician } from "@/utils/peopleDesks";
import { ymdInTimeZone } from "@/utils/date";
import {
  DEFAULT_CUSTOM_GROUP_NAME,
  memberHasRole,
  newSchedulePersonId,
  scheduleDayKey,
  scheduleStateOf,
  type ScheduleDayState,
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
 * Правит график ТОЛЬКО Owner и Тимлид, и правит осознанно: выходные на месяц
 * вперёд — в режиме правки с явным «Сохранить», разовые отметки («пришёл в
 * рабочий день», «отпросился») — через меню дня. Технарь и ОС свой график
 * только смотрят.
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
  const [group, setGroup] = useState<ScheduleGroup | null>(null);
  const [section, setSection] = useState<string>("all");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Map<string, ScheduleDayState>>(new Map());
  const [saving, setSaving] = useState(false);

  const uid = profile?.uid ?? "";
  const canEdit = permissions.canRetireDesks && Boolean(activeWorkspaceId);
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

  // Столы нужны как запасной путь: кто работает за столом, решает
  // `worksAsTechnician` (Технарь или Owner) — он одинаков у всех, а список
  // столов у каждого свой. Без этого человек с чужим столом, но без роли,
  // у одних попадал бы в «Технари», у других — в «Руководство».
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
    const technicians = take(active.filter((m) => worksAsTechnician(m) || deskOwners.has(m.uid)));
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

  /** Клик в режиме правки: только «выходной ↔ рабочий», ничего больше. */
  const toggleDraft = useCallback(
    (row: ScheduleRow, dayKey: string) => {
      setDraft((prev) => {
        const next = new Map(prev);
        const key = draftKey(row.uid, dayKey);
        const stored = scheduleStateOf(byUid.get(row.uid), dayKey);
        const shown = next.get(key) ?? stored;
        const wanted: ScheduleDayState = shown === "off" ? "work" : "off";
        // Вернулись к тому, что уже лежит в базе — писать этот день не за чем.
        if (wanted === stored) next.delete(key);
        else next.set(key, wanted);
        return next;
      });
    },
    [byUid]
  );

  async function saveDraft() {
    if (!activeWorkspaceId || draft.size === 0) {
      setEditing(false);
      setDraft(new Map());
      return;
    }
    const byPerson = new Map<string, Record<string, ScheduleDayState>>();
    for (const [key, state] of draft) {
      const [personUid, dayKey] = key.split(":");
      const days = byPerson.get(personUid) ?? {};
      days[dayKey] = state;
      byPerson.set(personUid, days);
    }
    setSaving(true);
    try {
      await saveScheduleDraft({
        workspaceId: activeWorkspaceId,
        monthKey,
        actorUid: uid,
        changes: Array.from(byPerson, ([personUid, days]) => ({ uid: personUid, days })),
      });
      toast.success(`График сохранён · дней изменено: ${draft.size}`);
      setDraft(new Map());
      setEditing(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить график");
    } finally {
      setSaving(false);
    }
  }

  async function cancelDraft() {
    if (draft.size > 0) {
      const ok = await confirmDialog({
        title: "Выйти без сохранения?",
        description: `Несохранённых дней: ${draft.size}. Они не попадут в график.`,
        confirmLabel: "Выйти",
        destructive: true,
      });
      if (!ok) return;
    }
    setDraft(new Map());
    setEditing(false);
  }

  /** Меню дня в обычном виде — разовая отметка, пишется сразу. */
  async function pickDay(row: ScheduleRow, dayKey: string, action: ScheduleDayAction) {
    if (!activeWorkspaceId) return;
    try {
      if (action === "came" || action === "not-came") {
        await setCameToWorkDay({
          workspaceId: activeWorkspaceId,
          uid: row.uid,
          monthKey,
          dayKey,
          came: action === "came",
          actorUid: uid,
        });
      } else {
        await setScheduleDay({
          workspaceId: activeWorkspaceId,
          uid: row.uid,
          monthKey,
          dayKey,
          state: action,
          actorUid: uid,
        });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось изменить график");
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
      description:
        "Строка исчезнет из графика. Уже проставленные смены останутся в базе — если вернёте человека под тем же именем, они не подтянутся.",
      confirmLabel: "Убрать",
      destructive: true,
    });
    if (!ok) return;
    await saveGroup(groupName, groupPeople.filter((p) => p.id !== row.uid));
  }

  function goToMonth(next: string) {
    // В режиме правки месяц не листаем: черновик привязан к нему, и соседний
    // месяц молча сохранил бы чужие дни.
    if (editing) return;
    setMonthKey(next);
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

  const gridProps = {
    monthKey,
    todayKey,
    schedules: byUid,
    canEdit,
    editing,
    draft,
    onToggleDraft: toggleDraft,
    onPickDay: (row: ScheduleRow, dayKey: string, action: ScheduleDayAction) => void pickDay(row, dayKey, action),
  };

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl p-5 sm:p-8 lg:p-10">
      <PageHeader
        eyebrow="Студия"
        title="График"
        description={
          !canEdit
            ? "Кто работает, у кого выходной и кто отпросился. График ведёт Тимлид."
            : editing
              ? "Режим правки: клик по дню ставит и снимает выходной. Ничего не уйдёт в базу, пока не нажмёте «Сохранить»."
              : "Кто работает, у кого выходной и кто отпросился. Клик по дню — меню: пришёл в рабочий день, отпросился, выходной."
        }
        actions={
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-11 w-11 sm:h-9 sm:w-9"
              aria-label="Предыдущий месяц"
              disabled={editing}
              onClick={() => goToMonth(previousMonthKey(monthKey))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[8.5rem] text-center text-sm font-medium">{monthLabel}</span>
            <Button
              variant="outline"
              size="icon"
              className="h-11 w-11 sm:h-9 sm:w-9"
              aria-label="Следующий месяц"
              disabled={editing}
              onClick={() => goToMonth(nextMonthKey(monthKey))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            {!isCurrentMonth && !editing && (
              <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-0" onClick={() => setMonthKey(currentMonth)}>
                Сегодня
              </Button>
            )}
            {canEdit &&
              (editing ? (
                <>
                  <Button size="sm" className="min-h-11 gap-1.5 sm:min-h-0" disabled={saving} onClick={() => void saveDraft()}>
                    {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Сохранить
                    {draft.size > 0 && <span className="tabular-nums opacity-80">{draft.size}</span>}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-11 sm:min-h-0"
                    disabled={saving}
                    onClick={() => void cancelDraft()}
                  >
                    Отмена
                  </Button>
                </>
              ) : (
                <Button variant="outline" size="sm" className="min-h-11 gap-1.5 sm:min-h-0" onClick={() => setEditing(true)}>
                  <Pencil className="h-3.5 w-3.5" />
                  Редактировать
                </Button>
              ))}
          </div>
        }
        filters={
          nothingAtAll || editing
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

      {editing && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-primary/35 bg-primary/[0.07] px-3 py-2.5 text-[12px]">
          <Pencil className="h-3.5 w-3.5 shrink-0 text-primary" />
          <p className="min-w-0 flex-1">
            Отмечаете выходные на {monthLabel}. Изменений: <span className="font-medium tabular-nums">{draft.size}</span> — они
            уйдут в график одним сохранением. Месяц пока не листается.
          </p>
        </div>
      )}

      {!editing && iAmScheduled && myToday !== "work" && (
        <div className="mb-4 rounded-xl border border-warning/35 bg-warning/[0.08] px-3 py-2.5 text-[12px]">
          {myToday === "off" ? "Сегодня у вас выходной" : "Сегодня вы отпросились"} — отклики на заказы закрыты.
          {!canEdit && " Отметить выход может Тимлид."}
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
              (editing || visible(s.id)) && (
                <Section key={s.id} icon={s.icon} title={s.title} count={s.rows.length}>
                  <ScheduleGrid {...gridProps} rows={s.rows} />
                </Section>
              )
          )}

          {showCustom && (editing || visible("custom")) && (
            <CustomSection
              name={groupName}
              rows={customRows}
              canEdit={canEdit && !editing}
              onRename={(next) => void saveGroup(next, groupPeople)}
              onAdd={(name) => void saveGroup(groupName, [...groupPeople, { id: newSchedulePersonId(), name }])}
            >
              <ScheduleGrid {...gridProps} rows={customRows} onRemoveRow={(row) => void removePerson(row)} />
            </CustomSection>
          )}

          <ScheduleLegend />

          {!isCurrentMonth && (
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5 shrink-0" />
              Открыт не текущий месяц — «сегодня» в сетке не подсвечено.
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
  const [draftName, setDraftName] = useState(name);
  const [person, setPerson] = useState("");

  // Название могли поменять из другой сессии — черновик следует за ним, пока
  // его не начали править здесь.
  useEffect(() => setDraftName(name), [name]);

  function commitName() {
    const next = draftName.trim();
    if (!next || next === name) {
      setDraftName(name);
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
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setDraftName(name);
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
