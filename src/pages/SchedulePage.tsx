import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CalendarRange,
  Check,
  ClipboardPaste,
  Paintbrush,
  ChevronLeft,
  ChevronRight,
  Clock,
  HardHat,
  Headset,
  Loader2,
  Pencil,
  Plus,
  ShieldCheck,
  UserPlus,
  X,
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
import { WeekPasteDialog, type WeekPasteResult } from "@/components/schedule/WeekPasteDialog";
import { WeekTemplateGrid } from "@/components/schedule/WeekTemplateGrid";
import { MyScheduleCard } from "@/components/schedule/MyScheduleCard";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { saveWeekTemplate, subscribeWeekTemplate } from "@/services/scheduleTemplateService";
import { saveScheduleDraft, setCameToWorkDay, setScheduleDay, setScheduleHours } from "@/services/techScheduleService";
import {
  cancelScheduleRequest,
  requestScheduleMark,
  resolveScheduleRequest,
  subscribePendingScheduleRequests,
  subscribeScheduleRequests,
} from "@/services/scheduleRequestService";
import { cn } from "@/utils/cn";
import { personLabel, worksAsTechnician } from "@/utils/peopleDesks";
import { applyParsedCell } from "@/utils/weekTemplate";
import { formatDate, ymdInTimeZone } from "@/utils/date";
import {
  cellsOfEntry,
  DEFAULT_CUSTOM_GROUP_NAME,
  formatScheduleHours,
  memberHasRole,
  newSchedulePersonId,
  normalizeWeekEntry,
  sameScheduleHours,
  sameWeek,
  scheduleDayKey,
  scheduleHoursOf,
  scheduleRequestId,
  scheduleStateOf,
  type ScheduleDayState,
  type ScheduleGroup,
  type ScheduleHours,
  type SchedulePerson,
  type ScheduleRequest,
  type TechSchedule,
  type WeekCell,
  type WeekTemplate,
  type WorkspaceMember,
} from "@/types";

type ScheduleView = "month" | "week";

type Brush = { kind: "off" | "work" | "hours"; from: string; to: string };

const WORK_CELL: WeekCell = { off: false, hours: null };

function sameCell(a: WeekCell, b: WeekCell): boolean {
  return a.off === b.off && sameScheduleHours(a.hours, b.hours);
}

/**
 * «19 сент.» — день запроса вместе с месяцем: в списке руководства теперь
 * бывают запросы и за прошлый месяц, одного числа мало.
 */
function requestDateLabel(request: ScheduleRequest): string {
  const [year, month] = request.monthKey.split("-").map(Number);
  const day = Number(request.dayKey);
  if (!year || !month || !day) return request.dayKey;
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, day))
  );
}

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
  const [requests, setRequests] = useState<ScheduleRequest[]>([]);
  const [hoursTarget, setHoursTarget] = useState<{ row: ScheduleRow; dayKey: string; hours: ScheduleHours | null } | null>(null);
  const [requestBusy, setRequestBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Map<string, ScheduleDayState>>(new Map());
  const [hoursDraft, setHoursDraft] = useState<Map<string, ScheduleHours | null>>(new Map());
  const [saving, setSaving] = useState(false);
  // «График» ВСЕГДА открывается на «Неделе» — постоянном распорядке (см.
  // types/scheduleTemplate.ts): так просил Nurba. Выбор «Месяц» не
  // запоминаем — иначе у того, кто хоть раз открыл месяц, неделя по
  // умолчанию пропала бы навсегда.
  const [view, setViewState] = useState<ScheduleView>("week");
  const [template, setTemplate] = useState<WeekTemplate | null>(null);
  const [templateLoaded, setTemplateLoaded] = useState(false);
  const [templateFailed, setTemplateFailed] = useState(false);
  const [templateAttempt, setTemplateAttempt] = useState(0);
  const [weekEditing, setWeekEditing] = useState(false);
  // Черновик недели хранит ТОЛЬКО тронутые дни (человек → день недели → клетка),
  // а не снимок всей недели: иначе сохранение молча откатывало бы дни, которые
  // за это время поменял другой руководитель.
  const [weekDraft, setWeekDraft] = useState<Map<string, Record<string, WeekCell>>>(new Map());
  const [brush, setBrush] = useState<Brush>({ kind: "off", from: "12:00", to: "" });
  const [paste, setPaste] = useState<{ text: string } | null>(null);
  const [weekSaving, setWeekSaving] = useState(false);

  const uid = profile?.uid ?? "";
  const canEdit = permissions.canRetireDesks && Boolean(activeWorkspaceId);
  const {
    schedules,
    loaded: schedulesLoaded,
    failed: schedulesFailed,
    retry: retrySchedules,
  } = useTechSchedules(activeWorkspaceId, monthKey, permissions.isResolved);
  // Править можно только поверх ПРОЧИТАННОГО графика: до первого снимка
  // (и при отказе) база выглядит пустой, и шаблон недели или меню дня
  // сравнивали бы правку с пустотой — «отпросился» и «пришёл» затирались.
  const scheduleReady = schedulesLoaded && !schedulesFailed;
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

  useEffect(() => {
    setRequests([]);
    // Руководство запросы видит через pendingAll ниже; месячная выборка нужна
    // только тем, кто подаёт запрос сам (свой запрос за открытый месяц).
    // Лишний постоянный слушатель на Spark нам ни к чему.
    if (!activeWorkspaceId || canEdit) return;
    return subscribeScheduleRequests(activeWorkspaceId, monthKey, setRequests, () => setRequests([]));
  }, [activeWorkspaceId, monthKey, canEdit]);

  // Руководству — все ожидающие запросы, какого бы месяца они ни были. Второй
  // слушатель только у Owner/Тимлида и только пока открыт «График».
  const [pendingAll, setPendingAll] = useState<ScheduleRequest[]>([]);
  useEffect(() => {
    setPendingAll([]);
    if (!activeWorkspaceId || !canEdit) return;
    return subscribePendingScheduleRequests(activeWorkspaceId, setPendingAll, () => setPendingAll([]));
  }, [activeWorkspaceId, canEdit]);

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
  const myName = personLabel(active.find((m) => m.uid === uid) ?? null) || "Вы";
  const todayLabel = formatDate(Date.now(), "d MMMM, EEEE");
  const pendingRequests = useMemo(
    () =>
      (canEdit ? pendingAll : requests.filter((r) => r.status === "pending")).slice().sort(
        (a, b) => a.monthKey.localeCompare(b.monthKey) || Number(a.dayKey) - Number(b.dayKey)
      ),
    [canEdit, pendingAll, requests]
  );
  const myRequest = todayKey ? requests.find((r) => r.id === scheduleRequestId(uid, monthKey, todayKey)) ?? null : null;

  /** Клик в режиме правки: только «выходной ↔ рабочий», ничего больше. */
  const toggleDraft = useCallback(
    (row: ScheduleRow, dayKey: string) => {
      if (!scheduleReady) return;
      setDraft((prev) => {
        const next = new Map(prev);
        const key = draftKey(row.uid, dayKey);
        const stored = scheduleStateOf(byUid.get(row.uid), dayKey);
        const shown = next.get(key) ?? stored;
        // Клик переключает выходной, а «вернуть» значит вернуть ИСХОДНОЕ. Для
        // «отпросился» это само «отпросился», а не «рабочий»: иначе два
        // случайных касания (О → В → пусто) молча стирали согласование, и
        // обратно к «О» по клику было не прийти. Сделать такой день рабочим
        // — осознанное действие, оно есть в меню дня («Обычный рабочий»).
        const wanted: ScheduleDayState = shown === "off" ? (stored === "excused" ? "excused" : "work") : "off";
        // Вернулись к тому, что уже лежит в базе — писать этот день не за чем.
        if (wanted === stored) next.delete(key);
        else next.set(key, wanted);
        return next;
      });
    },
    [byUid, scheduleReady]
  );

  async function saveDraft() {
    const total = draft.size + hoursDraft.size;
    if (!activeWorkspaceId || total === 0) {
      setEditing(false);
      setDraft(new Map());
      setHoursDraft(new Map());
      return;
    }
    const byPerson = new Map<string, { days: Record<string, ScheduleDayState>; hours: Record<string, ScheduleHours | null> }>();
    const bucket = (personUid: string) => {
      const found = byPerson.get(personUid) ?? { days: {}, hours: {} };
      byPerson.set(personUid, found);
      return found;
    };
    for (const [key, state] of draft) {
      const [personUid, dayKey] = key.split(":");
      bucket(personUid).days[dayKey] = state;
    }
    let sent = draft.size;
    for (const [key, value] of hoursDraft) {
      const [personUid, dayKey] = key.split(":");
      // Часы ложатся только на день, который ПОСЛЕ сохранения будет рабочим.
      // Шаблон ставит часы на будни, а человек потом руками возвращает
      // какой-то будний день к исходному «В» — черновик дня удаляется, а
      // часы оставались и писались под выходной, невидимые до тех пор, пока
      // день снова не сделают рабочим.
      const schedule = byUid.get(personUid);
      const finalState = draft.get(key) ?? scheduleStateOf(schedule, dayKey);
      if (finalState !== "work") {
        if (!scheduleHoursOf(schedule, dayKey)) continue;
        bucket(personUid).hours[dayKey] = null;
      } else {
        bucket(personUid).hours[dayKey] = value;
      }
      sent += 1;
    }
    setSaving(true);
    try {
      await saveScheduleDraft({
        workspaceId: activeWorkspaceId,
        monthKey,
        actorUid: uid,
        changes: Array.from(byPerson, ([personUid, value]) => ({ uid: personUid, ...value })),
      });
      toast.success(`График сохранён · изменений: ${sent}`);
      setDraft(new Map());
      setHoursDraft(new Map());
      setEditing(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить график");
    } finally {
      setSaving(false);
    }
  }

  async function cancelDraft() {
    const total = draft.size + hoursDraft.size;
    if (total > 0) {
      const ok = await confirmDialog({
        title: "Выйти без сохранения?",
        description: `Несохранённых изменений: ${total}. Они не попадут в график.`,
        confirmLabel: "Выйти",
        destructive: true,
      });
      if (!ok) return;
    }
    setDraft(new Map());
    setHoursDraft(new Map());
    setEditing(false);
  }

  /** Меню дня в обычном виде — разовая отметка, пишется сразу. */
  async function pickDay(row: ScheduleRow, dayKey: string, action: ScheduleDayAction) {
    if (!activeWorkspaceId) return;
    try {
      if (action === "hours") {
        setHoursTarget({ row, dayKey, hours: scheduleHoursOf(byUid.get(row.uid), dayKey) });
      } else if (action === "clear-hours") {
        await setScheduleHours({
          workspaceId: activeWorkspaceId,
          uid: row.uid,
          monthKey,
          dayKey,
          hours: null,
          actorUid: uid,
        });
      } else if (action === "came" || action === "not-came") {
        const schedule = byUid.get(row.uid);
        const baseState = schedule?.days?.[dayKey];
        await setCameToWorkDay({
          workspaceId: activeWorkspaceId,
          uid: row.uid,
          monthKey,
          dayKey,
          came: action === "came",
          // Без «пришёл» день вернётся к выходному или «отпросился» — часы
          // такому дню не положены.
          clearHours: action === "not-came" && baseState != null && Boolean(schedule?.hours?.[dayKey]),
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

  async function saveHours(hours: ScheduleHours | null) {
    if (!activeWorkspaceId || !hoursTarget) return;
    try {
      await setScheduleHours({
        workspaceId: activeWorkspaceId,
        uid: hoursTarget.row.uid,
        monthKey,
        dayKey: hoursTarget.dayKey,
        hours,
        actorUid: uid,
      });
      setHoursTarget(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить часы");
    }
  }

  /** «Я вышел в выходной» — запрос руководству, а не правка графика. */
  async function askForMark() {
    if (!activeWorkspaceId || !todayKey) return;
    setRequestBusy(true);
    try {
      await requestScheduleMark({
        workspaceId: activeWorkspaceId,
        uid,
        name: personLabel(members.find((m) => m.uid === uid) ?? null) || profile?.email || "—",
        monthKey,
        dayKey: todayKey,
      });
      toast.success("Запрос отправлен — Тимлид подтвердит отметку");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось отправить запрос");
    } finally {
      setRequestBusy(false);
    }
  }

  async function withdrawRequest(request: ScheduleRequest) {
    if (!activeWorkspaceId) return;
    setRequestBusy(true);
    try {
      await cancelScheduleRequest(activeWorkspaceId, request.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось отозвать запрос");
    } finally {
      setRequestBusy(false);
    }
  }

  async function resolveRequest(request: ScheduleRequest, approve: boolean) {
    if (!activeWorkspaceId) return;
    try {
      await resolveScheduleRequest({ workspaceId: activeWorkspaceId, request, approve, actorUid: uid });
      toast.success(approve ? `${request.name} отмечен(а) на ${request.dayKey}` : "Запрос отклонён");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось обработать запрос");
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

  function setView(next: ScheduleView) {
    if (editing || weekEditing) return;
    setViewState(next);
  }

  // Неделю слушаем только пока она открыта: лишний постоянный слушатель на
  // Spark ни к чему, а «Месяц» её не читает.
  useEffect(() => {
    setTemplate(null);
    setTemplateLoaded(false);
    setTemplateFailed(false);
    if (!activeWorkspaceId || view !== "week") return;
    return subscribeWeekTemplate(
      activeWorkspaceId,
      (next, fromServer) => {
        setTemplate(next);
        if (fromServer) {
          setTemplateLoaded(true);
          setTemplateFailed(false);
        }
      },
      () => setTemplateFailed(true)
    );
  }, [activeWorkspaceId, view, templateAttempt]);

  // Править неделю — только поверх ПРОЧИТАННОЙ с сервера: сохранение сравнивает
  // месяц с прошлой неделей, и пустая неделя из кэша сочла бы руками
  // поставленные выходные частью распорядка.
  const templateReady = templateLoaded && !templateFailed;
  const storedWeek = useMemo(() => {
    const map = new Map<string, Record<string, WeekCell>>();
    for (const [personId, entry] of Object.entries(template?.people ?? {})) map.set(personId, cellsOfEntry(entry));
    return map;
  }, [template]);
  const emptyWeek = useMemo(() => cellsOfEntry(null), []);
  const storedCells = useCallback((personId: string) => storedWeek.get(personId) ?? emptyWeek, [storedWeek, emptyWeek]);
  const weekCellsOfId = useCallback(
    (personId: string): Record<string, WeekCell> => ({ ...storedCells(personId), ...(weekDraft.get(personId) ?? {}) }),
    [weekDraft, storedCells]
  );
  const weekCellsOf = useCallback((row: ScheduleRow) => weekCellsOfId(row.uid), [weekCellsOfId]);
  const weekPending = useCallback(
    (row: ScheduleRow, dow: number) => Boolean(weekDraft.get(row.uid)?.[String(dow)]),
    [weekDraft]
  );
  const todayYmd = ymdInTimeZone(Date.now());
  const todayDow = new Date(`${todayYmd}T00:00:00Z`).getUTCDay();
  const brushHoursValid = brush.kind !== "hours" || (Boolean(brush.from) && (!brush.to || brush.from < brush.to));
  const brushCell: WeekCell =
    brush.kind === "off"
      ? { off: true, hours: null }
      : brush.kind === "hours"
        ? { off: false, hours: { from: brush.from, to: brush.to } }
        : WORK_CELL;

  /**
   * Положить в черновик тронутые дни. День, вернувшийся к сохранённому, из
   * черновика уходит, человек без тронутых дней — тоже.
   */
  const putWeekCells = useCallback(
    (updates: Array<{ personId: string; cells: Record<string, WeekCell> }>) => {
      setWeekDraft((prev) => {
        const next = new Map(prev);
        for (const { personId, cells } of updates) {
          const stored = storedCells(personId);
          const merged: Record<string, WeekCell> = { ...(next.get(personId) ?? {}), ...cells };
          for (const [dow, cell] of Object.entries(merged)) {
            if (sameCell(cell, stored[dow] ?? WORK_CELL)) delete merged[dow];
          }
          if (Object.keys(merged).length === 0) next.delete(personId);
          else next.set(personId, merged);
        }
        return next;
      });
    },
    [storedCells]
  );

  const weekLocked = !templateReady || weekSaving;

  /**
   * Повторный клик той же кистью ВОЗВРАЩАЕТ клетку к сохранённому, а не
   * делает её «работой»: иначе промах по столбцу «Вс» и клик для отмены
   * стирали людям их настоящие выходные и смены. Если сохранённое и есть
   * кисть — тогда да, в рабочий день.
   */
  function toggleBack(personId: string, dow: string): WeekCell {
    const stored = storedCells(personId)[dow] ?? WORK_CELL;
    return sameCell(stored, brushCell) ? WORK_CELL : stored;
  }

  function paintCell(row: ScheduleRow, dow: number) {
    if (weekLocked || !brushHoursValid) return;
    const key = String(dow);
    const current = weekCellsOf(row)[key] ?? WORK_CELL;
    const value = sameCell(current, brushCell) && brush.kind !== "work" ? toggleBack(row.uid, key) : brushCell;
    putWeekCells([{ personId: row.uid, cells: { [key]: value } }]);
  }

  /** Клик по дню недели — вся колонка раздела. Если она уже вся такая — возвращаем как было. */
  function paintColumn(rows: ScheduleRow[], dow: number) {
    if (weekLocked || !brushHoursValid || rows.length === 0) return;
    const key = String(dow);
    const allSame = rows.every((row) => sameCell(weekCellsOf(row)[key] ?? WORK_CELL, brushCell));
    putWeekCells(
      rows.map((row) => ({
        personId: row.uid,
        cells: { [key]: allSame && brush.kind !== "work" ? toggleBack(row.uid, key) : brushCell },
      }))
    );
  }

  function applyPaste(result: WeekPasteResult[]) {
    if (weekLocked) return;
    putWeekCells(
      result.map(({ personId, cells: parsed }) => {
        const current = weekCellsOfId(personId);
        const cells: Record<string, WeekCell> = {};
        // Только распознанные клетки: пустая и непонятная оставляют день как был.
        for (const [dow, cell] of Object.entries(parsed)) {
          if (cell.kind === "off" || cell.kind === "work" || cell.kind === "hours") {
            cells[dow] = applyParsedCell(current[dow] ?? WORK_CELL, cell);
          }
        }
        return { personId, cells };
      })
    );
    setPaste(null);
    setWeekEditing(true);
    // Вставка задевает людей из всех разделов — показываем все, чтобы
    // изменённые строки нельзя было не увидеть из-за фильтра.
    setSection("all");
    toast.success(`Перенесли неделю ${result.length} чел. — проверьте и нажмите «Сохранить»`);
  }

  // Ctrl+V с таблицей из Google Sheets прямо на неделе — без поиска кнопки.
  // Поля ввода не трогаем: там вставка своя.
  useEffect(() => {
    if (view !== "week" || !canEdit || paste || weekSaving) return;
    function onPaste(event: ClipboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (!text.includes("\t")) return;
      event.preventDefault();
      if (!templateReady) {
        toast.error("Неделя ещё загружается — вставьте через секунду");
        return;
      }
      setPaste({ text });
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [view, canEdit, paste, templateReady, weekSaving]);

  async function saveWeek() {
    if (!activeWorkspaceId || !templateReady || weekSaving) return;
    // Неделя = сохранённая СЕЙЧАС + тронутые дни: чужие правки других дней,
    // пришедшие за время редактирования, не откатываются.
    const changes = Array.from(weekDraft.keys(), (personId) => ({
      personId,
      entry: normalizeWeekEntry(weekCellsOfId(personId)),
    })).filter((change) => !sameWeek(change.entry, template?.people?.[change.personId]));
    if (changes.length === 0) {
      setWeekDraft(new Map());
      setWeekEditing(false);
      return;
    }
    setWeekSaving(true);
    // Месяц и день — из ОДНОГО чтения часов в момент сохранения: ключ месяца
    // из хука обновляется раз в минуту, и в первую минуту 1-го числа пара
    // «прошлый месяц + день 1» переписала бы весь прошлый месяц.
    const nowYmd = ymdInTimeZone(Date.now());
    try {
      const result = await saveWeekTemplate({
        workspaceId: activeWorkspaceId,
        actorUid: uid,
        previous: template,
        changes,
        window: { currentMonth: nowYmd.slice(0, 7), today: Number(nowYmd.slice(8, 10)) },
      });
      toast.success(
        result.days > 0
          ? `Неделя сохранена · людей: ${result.people}, дней в графике изменено: ${result.days}`
          : `Неделя сохранена · людей: ${result.people}`
      );
      setWeekDraft(new Map());
      setWeekEditing(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить неделю");
    } finally {
      setWeekSaving(false);
    }
  }

  async function cancelWeek() {
    if (weekDraft.size > 0) {
      const ok = await confirmDialog({
        title: "Выйти без сохранения?",
        description: `Изменена неделя у ${weekDraft.size} чел. Это не попадёт в график.`,
        confirmLabel: "Выйти",
        destructive: true,
      });
      if (!ok) return;
    }
    setWeekDraft(new Map());
    setWeekEditing(false);
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

  /** Есть ли смотрящий в самом графике (Viewer и Admin без стола туда не попадают). */
  const inSchedule = sections.some((s) => s.rows.some((row) => row.uid === uid));

  /** Кого предлагать при вставке недели: все строки графика, во всех разделах. */
  const patternRows = useMemo(
    () => [...sections.flatMap((s) => s.rows), ...customRows],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, customRows]
  );

  const gridProps = {
    monthKey,
    todayKey,
    schedules: byUid,
    meUid: uid,
    canEdit: canEdit && scheduleReady,
    editing,
    draft,
    hoursDraft,
    onToggleDraft: toggleDraft,
    onPickDay: (row: ScheduleRow, dayKey: string, action: ScheduleDayAction) => void pickDay(row, dayKey, action),
  };

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl p-5 sm:p-8 lg:p-10">
      <PageHeader
        eyebrow="Студия"
        title="График"
        description={
          view === "week"
            ? !canEdit
              ? "Постоянная неделя команды: у кого какие выходные и смены. Разовые выходные и отгулы — во вкладке «Месяц»."
              : weekEditing
                ? "Выберите кисть и кликайте по клеткам, клик по дню недели — весь столбец. Можно вставить таблицу из Google Sheets (Ctrl+V). В график уйдёт по «Сохранить»."
                : "Постоянная неделя каждого: выходные и смены по дням недели. Ставится один раз и сама раскладывается в график — на этот и следующий месяц."
            : !canEdit
            ? "Кто работает, у кого выходной и кто отпросился. График ведёт Тимлид."
            : editing
              ? "Режим правки: клик по дню ставит и снимает выходной. Ничего не уйдёт в базу, пока не нажмёте «Сохранить»."
              : "Кто работает, у кого выходной и кто отпросился. Клик по дню — меню: пришёл в рабочий день, отпросился, выходной."
        }
        actions={
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            <div className="mr-1 inline-flex rounded-lg border border-border p-0.5" role="tablist" aria-label="Вид графика">
              {(["month", "week"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  disabled={editing || weekEditing}
                  onClick={() => setView(v)}
                  className={cn(
                    "min-h-10 rounded-md px-3 text-[12px] transition-colors disabled:opacity-50 sm:min-h-8",
                    view === v ? "bg-primary/15 font-medium text-primary" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {v === "month" ? "Месяц" : "Неделя"}
                </button>
              ))}
            </div>
            {view === "month" && (
            <>
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
            </>
            )}
            {canEdit && view === "week" &&
              (weekEditing ? (
                <>
                  <Button
                    size="sm"
                    className="min-h-11 gap-1.5 sm:min-h-0"
                    disabled={weekSaving || !templateReady}
                    onClick={() => void saveWeek()}
                  >
                    {weekSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Сохранить
                    {weekDraft.size > 0 && <span className="tabular-nums opacity-80">{weekDraft.size}</span>}
                  </Button>
                  <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-0" disabled={weekSaving} onClick={() => void cancelWeek()}>
                    Отмена
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11 gap-1.5 sm:min-h-0"
                  disabled={!templateReady}
                  title={templateReady ? undefined : "Неделя ещё не загрузилась"}
                  onClick={() => setWeekEditing(true)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Изменить неделю
                </Button>
              ))}
            {canEdit && view === "month" &&
              (editing ? (
                <>
                  <Button size="sm" className="min-h-11 gap-1.5 sm:min-h-0" disabled={saving || !scheduleReady} onClick={() => void saveDraft()}>
                    {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Сохранить
                    {draft.size + hoursDraft.size > 0 && (
                      <span className="tabular-nums opacity-80">{draft.size + hoursDraft.size}</span>
                    )}
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
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11 gap-1.5 sm:min-h-0"
                  disabled={!scheduleReady}
                  title={scheduleReady ? undefined : "График ещё не загрузился"}
                  onClick={() => setEditing(true)}
                >
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

      {/* Сегодняшняя дата по Алматы и своё состояние на сегодня: график
          открывают ровно чтобы это узнать, а искать себя в сетке на 31
          колонку глазами — то, на что и жаловались. */}
      {/* Свой график — крупно и ОТДЕЛЬНО от общей сетки: «График» открывают,
          чтобы узнать «когда у меня смена», а искать себя глазами в таблице на
          30 человек — то, на что и жаловались. Кого в графике нет (Viewer,
          Admin без стола), тем остаётся просто сегодняшняя дата. */}
      {inSchedule && activeWorkspaceId ? (
        <MyScheduleCard workspaceId={activeWorkspaceId} uid={uid} name={myName} todayYmd={todayYmd} />
      ) : (
        isCurrentMonth && (
          <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-primary/35 bg-primary/[0.07] px-2.5 py-1 font-medium text-primary">
              <CalendarDays className="h-3.5 w-3.5 shrink-0" />
              Сегодня {todayLabel}
            </span>
          </div>
        )
      )}

      {editing && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-primary/35 bg-primary/[0.07] px-3 py-2.5 text-[12px]">
          <Pencil className="h-3.5 w-3.5 shrink-0 text-primary" />
          <p className="min-w-0 flex-1">
            Отмечаете выходные на {monthLabel}. Изменений:{" "}
            <span className="font-medium tabular-nums">{draft.size + hoursDraft.size}</span> — они уйдут в график одним
            сохранением. Месяц пока не листается. Здесь — разовые исключения; постоянные выходные по дням недели
            ставятся во вкладке «Неделя» и раскладываются на месяцы сами.
          </p>
        </div>
      )}

      {view === "week" && weekEditing && (
        <div className="mb-4 flex flex-col gap-2 rounded-xl border border-primary/35 bg-primary/[0.07] px-3 py-2.5 text-[12px]">
          <div className="flex flex-wrap items-center gap-1.5">
            <Paintbrush className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="mr-1 font-medium">Кисть</span>
            {(
              [
                ["off", "Выходной"],
                ["work", "Рабочий"],
                ["hours", "Смена с/до"],
              ] as const
            ).map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                onClick={() => setBrush((prev) => ({ ...prev, kind }))}
                className={pageChipClass(brush.kind === kind)}
              >
                {label}
              </button>
            ))}
            {brush.kind === "hours" && (
              <span className="inline-flex items-center gap-1">
                <Input
                  type="time"
                  aria-label="Смена с"
                  value={brush.from}
                  onChange={(e) => setBrush((prev) => ({ ...prev, from: e.target.value }))}
                  className="h-9 w-[6.5rem]"
                />
                <span className="text-muted-foreground">до</span>
                <Input
                  type="time"
                  aria-label="Смена до (можно пусто)"
                  value={brush.to}
                  onChange={(e) => setBrush((prev) => ({ ...prev, to: e.target.value }))}
                  className="h-9 w-[6.5rem]"
                />
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              className="ml-auto min-h-11 gap-1.5 sm:min-h-0"
              disabled={weekLocked}
              onClick={() => setPaste({ text: "" })}
            >
              <ClipboardPaste className="h-3.5 w-3.5" />
              Вставить из таблицы
            </Button>
          </div>
          <p className="text-muted-foreground">
            {brush.kind === "hours" && !brushHoursValid
              ? "Начало смены должно быть раньше конца. «До» можно оставить пустым — будет «с 12:00»."
              : `Клик по клетке — кисть, повторный клик снимает. Клик по дню недели — весь столбец раздела. Изменена неделя у ${weekDraft.size} чел.`}
          </p>
        </div>
      )}

      {view === "week" && templateFailed && (
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          <span className="min-w-0 flex-1">Неделя не загрузилась — показана пустой, правка выключена.</span>
          <button
            type="button"
            onClick={() => setTemplateAttempt((n) => n + 1)}
            className="min-h-11 shrink-0 font-medium underline underline-offset-2 sm:min-h-0"
          >
            Повторить
          </button>
        </div>
      )}

      {view === "month" && schedulesFailed && (
        <div className="mb-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
            <span className="min-w-0 flex-1">График не загрузился — показано пустым, правка выключена.</span>
            <button
              type="button"
              onClick={retrySchedules}
              className="min-h-11 shrink-0 font-medium underline underline-offset-2 sm:min-h-0"
            >
              Повторить
            </button>
          </div>
        </div>
      )}

      {!editing && canEdit && pendingRequests.length > 0 && (
        <div className="mb-4 flex flex-col gap-2 rounded-xl border border-primary/35 bg-primary/[0.06] p-3">
          <p className="text-[12px] font-medium">
            Просят отметить выход <span className="tabular-nums opacity-70">{pendingRequests.length}</span>
          </p>
          {pendingRequests.map((request) => (
            // Дата — ПЕРВОЙ и без обрезки: раньше она стояла в конце строки, и
            // на телефоне две кнопки съедали место — Тимлид подтверждал
            // вслепую, не видя, за какой день ставит отметку.
            <div key={request.id} className="flex flex-col gap-2 text-[12px] sm:flex-row sm:items-center">
              <p className="min-w-0 flex-1">
                <span className="font-semibold tabular-nums">{requestDateLabel(request)}</span>
                <span className="text-muted-foreground"> · </span>
                {request.name} — работал(а)
              </p>
              <div className="flex gap-2">
                <Button size="sm" className="min-h-11 flex-1 gap-1.5 sm:h-8 sm:min-h-0 sm:flex-none" onClick={() => void resolveRequest(request, true)}>
                  <Check className="h-3.5 w-3.5" />
                  Отметить
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-h-11 flex-1 gap-1.5 sm:h-8 sm:min-h-0 sm:flex-none"
                  onClick={() => void resolveRequest(request, false)}
                >
                  <X className="h-3.5 w-3.5" />
                  Отклонить
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!editing && !weekEditing && iAmScheduled && scheduleReady && myToday !== "work" && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-warning/35 bg-warning/[0.08] px-3 py-2.5 text-[12px]">
          <p className="min-w-0 flex-1">
            {myToday === "off" ? "Сегодня у вас выходной" : "Сегодня вы отпросились"} — отклики на заказы закрыты.
            {!canEdit && " График правит Тимлид, но можно попросить отметить выход."}
          </p>
          {!canEdit && myRequest?.status === "pending" && (
            <>
              <span className="shrink-0 rounded-md bg-muted px-2 py-1">Запрос отправлен</span>
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11 sm:min-h-0"
                disabled={requestBusy}
                onClick={() => void withdrawRequest(myRequest)}
              >
                Отозвать
              </Button>
            </>
          )}
          {!canEdit && myRequest?.status !== "pending" && (
            <Button size="sm" className="min-h-11 gap-1.5 sm:min-h-0" disabled={requestBusy} onClick={() => void askForMark()}>
              {requestBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Я вышел — прошу отметить
            </Button>
          )}
          {!canEdit && myRequest?.status === "declined" && (
            <span className="shrink-0 text-muted-foreground">прошлый запрос отклонён</span>
          )}
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
                  {view === "week" ? (
                    <WeekTemplateGrid
                      rows={s.rows}
                      cellsOf={weekCellsOf}
                      isPending={weekPending}
                      meUid={uid}
                      todayDow={todayDow}
                      editing={weekEditing && !weekSaving}
                      onCellClick={paintCell}
                      onColumnClick={(dow) => paintColumn(s.rows, dow)}
                    />
                  ) : (
                    <ScheduleGrid {...gridProps} rows={s.rows} />
                  )}
                </Section>
              )
          )}

          {showCustom && (editing || visible("custom")) && (
            <CustomSection
              name={groupName}
              rows={customRows}
              canEdit={canEdit && !editing && !weekEditing}
              onRename={(next) => void saveGroup(next, groupPeople)}
              onAdd={(name) => void saveGroup(groupName, [...groupPeople, { id: newSchedulePersonId(), name }])}
            >
              {view === "week" ? (
                <WeekTemplateGrid
                  rows={customRows}
                  cellsOf={weekCellsOf}
                  isPending={weekPending}
                  meUid={uid}
                  todayDow={todayDow}
                  editing={weekEditing && !weekSaving}
                  onCellClick={paintCell}
                  onColumnClick={(dow) => paintColumn(customRows, dow)}
                />
              ) : (
                <ScheduleGrid {...gridProps} rows={customRows} onRemoveRow={(row) => void removePerson(row)} />
              )}
            </CustomSection>
          )}

          {view === "week" ? (
            <p className="flex items-start gap-1.5 text-[11px] leading-4 text-muted-foreground">
              <CalendarRange className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>
                Неделя сама раскладывается во вкладку «Месяц»: с сегодняшнего дня и на весь следующий месяц, а 1-го числа —
                ещё на месяц вперёд. Выходные и смены, поставленные в месяце руками, «отпросился» и «пришёл» она не
                перетирает.
              </span>
            </p>
          ) : (
            <ScheduleLegend />
          )}

          {view === "month" && !isCurrentMonth && (
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5 shrink-0" />
              Открыт не текущий месяц — «сегодня» в сетке не подсвечено.
            </p>
          )}
        </div>
      )}

      {paste && (
        <WeekPasteDialog
          rows={patternRows}
          initialText={paste.text}
          onClose={() => setPaste(null)}
          onApply={applyPaste}
        />
      )}

      {hoursTarget && (
        <HoursDialog
          target={hoursTarget}
          monthLabel={monthLabel}
          onClose={() => setHoursTarget(null)}
          onSave={(hours) => void saveHours(hours)}
        />
      )}
    </div>
  );
}

/**
 * Часы гибридной смены. Отдельный диалог, а не поле в меню: время вводят
 * двумя полями, и промахнуться пальцем по такому меню было бы легко.
 */
function HoursDialog({
  target,
  monthLabel,
  onClose,
  onSave,
}: {
  target: { row: ScheduleRow; dayKey: string; hours: ScheduleHours | null };
  monthLabel: string;
  onClose: () => void;
  onSave: (hours: ScheduleHours | null) => void;
}) {
  const [from, setFrom] = useState(target.hours?.from ?? "12:00");
  const [to, setTo] = useState(target.hours ? target.hours.to : "15:00");
  // «До» можно оставить пустым — «с 12:45» без конца смены, как в недельной таблице.
  const valid = Boolean(from) && (!to || from < to);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4 shrink-0 text-primary" />
            Смена с/до
          </DialogTitle>
          <DialogDescription>
            {target.row.label} · {target.dayKey} {monthLabel}. День остаётся рабочим — заказы брать можно.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-[12px] text-muted-foreground">
            С
            <Input type="time" value={from} onChange={(e) => setFrom(e.target.value)} className="h-10" />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-[12px] text-muted-foreground">
            До
            <Input type="time" value={to} onChange={(e) => setTo(e.target.value)} className="h-10" />
          </label>
        </div>
        {!valid ? (
          <p className="text-[11px] text-destructive">Начало должно быть раньше конца.</p>
        ) : (
          <p className="text-[11px] text-muted-foreground">«До» можно оставить пустым — будет «с {from}».</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button className="min-h-11 sm:min-h-0" disabled={!valid} onClick={() => onSave({ from, to })}>
            Сохранить
          </Button>
          {target.hours && (
            <Button variant="ghost" className="min-h-11 sm:min-h-0" onClick={() => onSave(null)}>
              Убрать часы
            </Button>
          )}
          <Button variant="ghost" className="ml-auto min-h-11 sm:min-h-0" onClick={onClose}>
            Отмена
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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
