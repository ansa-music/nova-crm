import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  HardHat,
  Headset,
  Loader2,
  MoreHorizontal,
  Pencil,
  Redo2,
  Search,
  Settings2,
  ShieldCheck,
  Undo2,
  UserPlus,
  X,
} from "lucide-react";
import { PageHeader, pageChipClass } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { WeekPasteDialog, type WeekPasteResult } from "@/components/schedule/WeekPasteDialog";
import { PersonWeekDialog } from "@/components/schedule/PersonWeekDialog";
import { MyScheduleCard } from "@/components/schedule/MyScheduleCard";
import { PersonMonthDialog } from "@/components/schedule/PersonMonthDialog";
import { ScheduleDayView, TodayOnShift, type DaySection } from "@/components/schedule/ScheduleDayView";
import { ScheduleSettingsDialog } from "@/components/schedule/ScheduleSettingsDialog";
import { ScheduleSheet, type SheetCell, type SheetColumn, type SheetSection } from "@/components/schedule/ScheduleSheet";
import { SchedulePalette, type PaletteAction } from "@/components/schedule/SchedulePalette";
import { useGridSelection } from "@/components/schedule/useGridSelection";
import { useWeekTemplateWriter } from "@/components/schedule/useWeekTemplateWriter";
import { useScheduleDensity, type ScheduleDensity } from "@/components/schedule/scheduleDensity";
import {
  CELL_KIND_LABEL,
  CELL_KIND_LOOK,
  dayLabel,
  daysOfMonth,
  isWeekend,
  shiftStart,
  weekdayOf,
  WEEKDAY_EVERY,
  WEEKDAY_LETTERS,
  type CellKind,
  type ScheduleRow,
} from "@/components/schedule/scheduleShared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { confirmDialog, promptDialog } from "@/utils/appDialog";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentMonthKey } from "@/hooks/useCurrentMonthKey";
import { useTechSchedules } from "@/hooks/useDeskLoads";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useMembersRefresh } from "@/hooks/useMembersRefresh";
import { usePermissions } from "@/hooks/usePermissions";
import { useUrlState } from "@/hooks/useUrlState";
import { useWorkspace } from "@/hooks/useWorkspace";
import { nextMonthKey, previousMonthKey } from "@/services/monthTabService";
import { monthTabNameForKey } from "@/services/subPageService";
import { saveScheduleGroup, subscribeScheduleGroup } from "@/services/scheduleGroupService";
import { LAY_MONTHS_MAX, subscribeWeekTemplate } from "@/services/scheduleTemplateService";
import { useScheduleBackend } from "@/services/scheduleStore";
import { saveScheduleDraft } from "@/services/techScheduleService";
import {
  cancelScheduleRequest,
  requestScheduleMark,
  resolveScheduleRequest,
  subscribePendingScheduleRequests,
  subscribeMyScheduleRequests,
} from "@/services/scheduleRequestService";
import { cn } from "@/utils/cn";
import { formatCount } from "@/utils/format";
import { personLabel, worksAsTechnician } from "@/utils/peopleDesks";
import { pushUndoCommand, redo, undo, useUndoState, type UndoCommand } from "@/utils/undoStore";
import { applyParsedCell, frequentShifts, matchesPersonQuery } from "@/utils/weekTemplate";
import { formatDate, ymdInTimeZone } from "@/utils/date";
import {
  monthCellKind,
  monthCellsToWeekCells,
  monthSelectionKinds,
  planMonthEdit,
  planMonthRestore,
  planWeekEdit,
  splitCellKey,
  weekActionOf,
  cellKey,
  type MonthCellRef,
  type WeekAction,
  type WeekCellRef,
  type WeekPersonChange,
} from "@/utils/scheduleEdit";
import {
  cellsOfEntry,
  DEFAULT_CUSTOM_GROUP_NAME,
  hasWeek,
  formatScheduleHours,
  memberHasRole,
  mergeShiftPresets,
  newSchedulePersonId,
  normalizeWeekEntry,
  scheduleDayKey,
  scheduleHoursOf,
  scheduleRequestId,
  scheduleSettingsOf,
  scheduleStateOf,
  sameWeek,
  WEEK_DOW_SHORT,
  WEEK_DOWS,
  type ScheduleGroup,
  type ScheduleHours,
  type SchedulePerson,
  type ScheduleRequest,
  type TechSchedule,
  type WeekCell,
  type WeekTemplate,
  type WorkspaceMember,
} from "@/types";
import type { ScheduleBulkAction, ScheduleBulkPlan } from "@/utils/scheduleBulk";

type ScheduleView = "week" | "month" | "day";

const VIEWS: readonly ScheduleView[] = ["week", "month", "day"];
const VIEW_LABELS: Record<ScheduleView, string> = { week: "Неделя", month: "Месяц", day: "День" };

const DENSITY_OPTIONS: Array<{ value: ScheduleDensity; title: string; className: string }> = [
  { value: "compact", title: "Мелко — больше дней на экране", className: "text-[11px]" },
  { value: "normal", title: "Обычно", className: "text-[14px]" },
  { value: "large", title: "Крупно — чтобы не щуриться", className: "text-[18px]" },
];

const WORK_CELL: WeekCell = { off: false, hours: null };
const CELLS_FORMS = ["клетка", "клетки", "клеток"] as const;

/**
 * «19 сент.» — день запроса вместе с месяцем: в списке руководства бывают
 * запросы и за прошлый месяц, одного числа мало.
 */
function requestDateLabel(request: ScheduleRequest): string {
  const [year, month] = request.monthKey.split("-").map(Number);
  const day = Number(request.dayKey);
  if (!year || !month || !day) return request.dayKey;
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, day))
  );
}

function actionText(action: PaletteAction | ScheduleBulkAction, shift: ScheduleHours | null): string {
  if (action === "hours") return shift ? `Смена ${formatScheduleHours(shift)}` : "Смена";
  if (action === "came") return "Пришёл в выходной";
  if (action === "clear-hours") return "Часы сняты";
  if (action === "restore") return "Как в постоянной неделе";
  return CELL_KIND_LABEL[action];
}

/** «по субботам» — дни недели выделения в подписи «Повторять …». */
function everyLabel(dows: string[]): string {
  if (dows.length === 1) return WEEKDAY_EVERY[dows[0]] ?? "каждую неделю";
  const order = WEEK_DOWS.map(String);
  return `каждую неделю: ${dows
    .slice()
    .sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map((dow) => WEEK_DOW_SHORT[Number(dow)].toLowerCase())
    .join(", ")}`;
}

const MIXED_ORDER: Array<[CellKind, string]> = [
  ["off", "вых."],
  ["excused", "отпр."],
  ["hours", "смена"],
  ["came", "пришёл"],
  ["work", "раб."],
];

/** «вых. 3 · раб. 5» — что стоит в выделении, если там по-разному. */
function mixedText(kinds: Map<CellKind, number>): string {
  return MIXED_ORDER.filter(([kind]) => kinds.get(kind))
    .map(([kind, label]) => `${label} ${kinds.get(kind)}`)
    .join(" · ");
}

/**
 * Правки графика в общем стеке отмены. Стек один на приложение: под правками
 * графика лежат правки таблиц, и «Отменить» у сетки должна гаснуть, как
 * только следующей отменилась бы чужая правка. На модуле, а не в состоянии
 * страницы: ушли на стол и вернулись — последнюю правку графика всё ещё
 * можно отменить кнопкой.
 */
const scheduleCommands = new WeakSet<UndoCommand>();

function pushScheduleCommand(command: UndoCommand) {
  scheduleCommands.add(command);
  pushUndoCommand(command);
}

function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/**
 * Дотянуть сетку до клетки, к которой ушли стрелкой. Сетка прокручивается
 * своим окном (на телефоне по вертикали — страница), а имена и шапка с
 * числами закреплены поверх: обычный scrollIntoView прятал бы клетку под ними.
 */
function revealCell(scroller: HTMLElement, cell: HTMLElement) {
  const pad = 6;
  if (scroller.scrollHeight > scroller.clientHeight + 1) {
    const box = scroller.getBoundingClientRect();
    const rect = cell.getBoundingClientRect();
    const headH = scroller.querySelector("thead")?.getBoundingClientRect().height ?? 0;
    if (rect.top < box.top + headH) scroller.scrollTop -= box.top + headH - rect.top + pad;
    else if (rect.bottom > box.top + scroller.clientHeight) scroller.scrollTop += rect.bottom - box.top - scroller.clientHeight + pad;
  } else {
    cell.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  const box = scroller.getBoundingClientRect();
  const rect = cell.getBoundingClientRect();
  const nameW = scroller.querySelector("thead th")?.getBoundingClientRect().width ?? 0;
  if (rect.left < box.left + nameW) scroller.scrollLeft -= box.left + nameW - rect.left + pad;
  else if (rect.right > box.left + scroller.clientWidth) scroller.scrollLeft += rect.right - box.left - scroller.clientWidth + pad;
}

/**
 * «График» — один экран на всех, кто работает по сменам: Технари, ОС,
 * Руководство и свой раздел (подрядчики без аккаунта).
 *
 * Правится ПРЯМО В СЕТКЕ, как таблица в Google Sheets, где руководство его и
 * вело: клик по клетке (протяжка — несколько, клик по дню — весь столбец) →
 * палитра «Выходной / Рабочий / Отпросился / Пришёл / смена» → записано
 * сразу. Режимов «Редактировать»/«Сохранить» больше нет: их забывали, и
 * правки терялись. Вернуть — Ctrl+Z или «Отменить» в панели сетки.
 *
 * «Неделя» — постоянный распорядок: сам раскладывается в «Месяц» с
 * сегодняшнего дня. «Месяц» — конкретные даты: отпуск, «поменялись»,
 * «отпросился». Из месяца выходной можно сразу сделать постоянным —
 * «Повторять каждую субботу» в палитре.
 *
 * Правит график Owner, Тимлид и те, кого Owner назначил в «Настройке
 * графика»; остальные смотрят (клик по клетке — что в ней стоит).
 */
export default function SchedulePage() {
  const { profile } = useAuth();
  const permissions = usePermissions();
  const { activeWorkspaceId, activeWorkspace, members, pages } = useWorkspace();
  const currentMonth = useCurrentMonthKey();
  const mobile = useIsMobile();
  const [monthKey, setMonthKey] = useState(currentMonth);
  const [group, setGroup] = useState<ScheduleGroup | null>(null);
  const [section, setSection] = useState<string>("all");
  const [requests, setRequests] = useState<ScheduleRequest[]>([]);
  const [requestBusy, setRequestBusy] = useState(false);
  // «График» открывается на «Неделе» (просьба Nurba): вид — в адресе, и
  // пункт меню без параметра всегда ведёт на неделю.
  const [view, setView] = useUrlState<ScheduleView>("v", "week", { values: VIEWS });
  const [template, setTemplate] = useState<WeekTemplate | null>(null);
  const [templateLoaded, setTemplateLoaded] = useState(false);
  const [templateFailed, setTemplateFailed] = useState(false);
  const [templateAttempt, setTemplateAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [personTarget, setPersonTarget] = useState<ScheduleRow | null>(null);
  const [personMonth, setPersonMonth] = useState<ScheduleRow | null>(null);
  const [paste, setPaste] = useState<{ text: string } | null>(null);
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [density, setDensity] = useScheduleDensity();
  const searchRef = useRef<HTMLInputElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  // «День»: чей день открыт в палитре (чип человека).
  const [dayTarget, setDayTarget] = useState<{ uid: string; anchor: HTMLElement } | null>(null);
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  const [savingCount, setSavingCount] = useState(0);
  const [lastDone, setLastDone] = useState<string | null>(null);
  const undoState = useUndoState();

  const uid = profile?.uid ?? "";
  const settings = useMemo(() => scheduleSettingsOf(activeWorkspace), [activeWorkspace]);
  const isRealOwner = permissions.actsAsOwner;
  // Правит график руководство и те, кого Owner назначил в «Настройке графика»
  // (правило `isScheduleEditor` смотрит тот же список).
  const canEdit =
    (permissions.canRetireDesks || (permissions.isResolved && Boolean(uid) && settings.editors.includes(uid))) &&
    Boolean(activeWorkspaceId);
  const {
    schedules,
    loaded: schedulesLoaded,
    failed: schedulesFailed,
    retry: retrySchedules,
  } = useTechSchedules(activeWorkspaceId, monthKey, permissions.isResolved);
  // Править можно только поверх ПРОЧИТАННОГО с сервера графика: до первого
  // снимка база выглядит пустой, и правка сравнивалась бы с пустотой.
  const scheduleReady = schedulesLoaded && !schedulesFailed;
  const byUid = useMemo(() => {
    const map = new Map<string, TechSchedule>();
    for (const s of schedules) map.set(s.uid, s);
    return map;
  }, [schedules]);

  // Чужие member-документы не живые — обновим, иначе у только что
  // заведённого человека не будет ни ника, ни фото.
  useMembersRefresh(activeWorkspaceId, true, false);

  // Где график: Supabase (после переноса) или Firestore — переподписка при смене.
  const scheduleBackend = useScheduleBackend(activeWorkspaceId);

  useEffect(() => {
    setGroup(null);
    if (!activeWorkspaceId || !scheduleBackend) return;
    return subscribeScheduleGroup(activeWorkspaceId, setGroup, () => setGroup(null), scheduleBackend);
  }, [activeWorkspaceId, scheduleBackend]);

  useEffect(() => {
    setRequests([]);
    // Свои запросы за открытый месяц — только у тех, кто подаёт запрос сам.
    if (!activeWorkspaceId || canEdit || !uid || !scheduleBackend) return;
    return subscribeMyScheduleRequests(activeWorkspaceId, uid, monthKey, setRequests, () => setRequests([]), scheduleBackend);
  }, [activeWorkspaceId, monthKey, canEdit, uid, scheduleBackend]);

  // Руководству — все ожидающие запросы, какого бы месяца они ни были.
  const [pendingAll, setPendingAll] = useState<ScheduleRequest[]>([]);
  useEffect(() => {
    setPendingAll([]);
    if (!activeWorkspaceId || !canEdit || !scheduleBackend) return;
    return subscribePendingScheduleRequests(activeWorkspaceId, setPendingAll, () => setPendingAll([]), scheduleBackend);
  }, [activeWorkspaceId, canEdit, scheduleBackend]);

  // Неделю слушаем, пока она открыта, а у тех, кто правит, — и в месяце:
  // оттуда выходной можно сделать постоянным («Повторять каждую субботу»).
  const needTemplate = view === "week" || canEdit;
  useEffect(() => {
    setTemplate(null);
    setTemplateLoaded(false);
    setTemplateFailed(false);
    if (!activeWorkspaceId || !needTemplate || !scheduleBackend) return;
    return subscribeWeekTemplate(
      activeWorkspaceId,
      (next, fromServer) => {
        setTemplate(next);
        if (fromServer) {
          setTemplateLoaded(true);
          setTemplateFailed(false);
        }
      },
      () => setTemplateFailed(true),
      scheduleBackend
    );
  }, [activeWorkspaceId, needTemplate, templateAttempt, scheduleBackend]);
  // Править неделю — только поверх ПРОЧИТАННОЙ с сервера: раскладка сравнивает
  // месяц с прошлой неделей, и пустая неделя из кэша сочла бы поставленные
  // руками выходные частью распорядка.
  const templateReady = templateLoaded && !templateFailed;

  const weekWriter = useWeekTemplateWriter({ workspaceId: activeWorkspaceId, actorUid: uid });
  const storedWeek = useMemo(() => {
    const map = new Map<string, Record<string, WeekCell>>();
    for (const [personId, entry] of Object.entries(template?.people ?? {})) map.set(personId, cellsOfEntry(entry));
    return map;
  }, [template]);
  const emptyWeek = useMemo(() => cellsOfEntry(null), []);
  /** Неделя человека на экране: сохранённая, поверх — записи в пути. */
  const weekCellsOfId = useCallback(
    (personId: string): Record<string, WeekCell> => weekWriter.overlay.get(personId) ?? storedWeek.get(personId) ?? emptyWeek,
    [weekWriter.overlay, storedWeek, emptyWeek]
  );

  const active = useMemo(() => members.filter((m) => m.status === "active" && Boolean(m.uid)), [members]);

  // Столы — запасной путь: кто работает за столом, решает `worksAsTechnician`
  // (Технарь или Owner), а человек со столом без роли — тоже «Технари».
  const deskOwners = useMemo(
    () => new Set(pages.filter((p) => !p.isDashboard && p.responsibleUserId).map((p) => p.responsibleUserId as string)),
    [pages]
  );

  // Человек стоит ОДИН раз — в первом подходящем разделе: график хранится по
  // uid, и две строки на один документ означали бы, что правка в одной молча
  // меняет вторую.
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

  // По содержимому, а не по массиву: настройка пересобирается на каждый снимок
  // документа workspace, и сетка перестраивалась бы без повода.
  const hiddenKey = settings.hidden.join(",");
  const hiddenSet = useMemo(() => new Set(hiddenKey ? hiddenKey.split(",") : []), [hiddenKey]);
  const rowsOfMembers = useCallback(
    (list: WorkspaceMember[], withHidden = false): ScheduleRow[] =>
      list
        .map((m) => ({
          uid: m.uid,
          label: personLabel(m),
          member: m,
          note: m.role === "owner" ? "Owner" : m.role === "teamlead" ? "Тимлид" : null,
        }))
        .filter((row) => withHidden || !hiddenSet.has(row.uid))
        // По алфавиту: человека ищут глазами по имени.
        .sort((a, b) => a.label.localeCompare(b.label, "ru")),
    [hiddenSet]
  );

  const groupName = group?.name?.trim() || DEFAULT_CUSTOM_GROUP_NAME;
  const groupPeople = useMemo(() => group?.people ?? [], [group]);
  const allCustomRows: ScheduleRow[] = useMemo(
    () => groupPeople.map((p) => ({ uid: p.id, label: p.name })).sort((a, b) => a.label.localeCompare(b.label, "ru")),
    [groupPeople]
  );
  const customRows = useMemo(() => allCustomRows.filter((row) => !hiddenSet.has(row.uid)), [allCustomRows, hiddenSet]);
  const customIds = useMemo(() => new Set(allCustomRows.map((row) => row.uid)), [allCustomRows]);

  const isCurrentMonth = monthKey === currentMonth;
  const todayYmd = ymdInTimeZone(Date.now());
  const todayDow = new Date(`${todayYmd}T00:00:00Z`).getUTCDay();
  const todayKey = isCurrentMonth ? scheduleDayKey(todayYmd) : null;
  const myToday = todayKey ? scheduleStateOf(byUid.get(uid), todayKey) : "work";
  const iAmScheduled = active.some((m) => m.uid === uid);
  const myName = personLabel(active.find((m) => m.uid === uid) ?? null) || "Вы";
  const pendingRequests = useMemo(
    () =>
      (canEdit ? pendingAll : requests.filter((r) => r.status === "pending"))
        .slice()
        .sort((a, b) => a.monthKey.localeCompare(b.monthKey) || Number(a.dayKey) - Number(b.dayKey)),
    [canEdit, pendingAll, requests]
  );
  const myRequest = todayKey ? requests.find((r) => r.id === scheduleRequestId(uid, monthKey, todayKey)) ?? null : null;

  // --- разделы -----------------------------------------------------------

  const baseSections = useMemo(
    () =>
      [
        { id: "tech", title: "Технари", icon: HardHat, rows: rowsOfMembers(groups.technicians), min: settings.minOnShift.tech },
        { id: "os", title: "ОС", icon: Headset, rows: rowsOfMembers(groups.os), min: settings.minOnShift.os },
        { id: "leads", title: "Руководство", icon: ShieldCheck, rows: rowsOfMembers(groups.leads), min: 0 },
      ].filter((s) => s.rows.length > 0),
    [groups, rowsOfMembers, settings.minOnShift.tech, settings.minOnShift.os]
  );
  const showCustom = customRows.length > 0 || canEdit;
  const nothingAtAll = baseSections.length === 0 && !showCustom;
  const visible = (id: string) => section === "all" || section === id;
  const searching = query.trim().length > 0;
  const matchRow = useCallback(
    (row: ScheduleRow) => matchesPersonQuery(query, [row.label, row.member?.name, row.member?.nickname]),
    [query]
  );

  // Пункты меню своего раздела зовут СВЕЖИЕ функции: само меню собирается
  // внутри useMemo разделов и могло бы держать старый список людей.
  const customActionsRef = useRef({ add: () => {}, rename: () => {} } as { add: () => void; rename: () => void });
  const customMenu = canEdit ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Раздел «${groupName}»: добавить человека, переименовать`}
          className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem onSelect={() => customActionsRef.current.add()}>
          <UserPlus className="h-4 w-4" /> Добавить человека…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => customActionsRef.current.rename()}>
          <Pencil className="h-4 w-4" /> Переименовать раздел…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : undefined;

  const sheetSections: SheetSection[] = useMemo(() => {
    const out: SheetSection[] = [];
    for (const s of baseSections) {
      if (!visible(s.id)) continue;
      out.push({ ...s, rows: searching ? s.rows.filter(matchRow) : s.rows });
    }
    if (showCustom && visible("custom")) {
      const rows = searching ? customRows.filter(matchRow) : customRows;
      if (rows.length > 0 || (!searching && canEdit)) {
        out.push({
          id: "custom",
          title: groupName,
          icon: UserPlus,
          rows,
          min: 0,
          menu: customMenu,
          emptyText: "Пока пусто. Сюда добавляют тех, кого нет в участниках: «⋯» → «Добавить человека».",
        });
      }
    }
    return out;
    // customMenu пересоздаётся на каждый рендер, но от него зависит только кнопка.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseSections, section, searching, matchRow, showCustom, customRows, canEdit, groupName]);

  const flatRows = useMemo(() => sheetSections.flatMap((s) => s.rows), [sheetSections]);
  const foundCount = flatRows.length;
  const rowIds = useMemo(() => flatRows.map((row) => row.uid), [flatRows]);
  const rowById = useMemo(() => new Map(flatRows.map((row) => [row.uid, row])), [flatRows]);

  /** Кого предлагать при вставке недели и в «Как у …»: все строки графика, во всех разделах. */
  const patternRows = useMemo(() => [...baseSections.flatMap((s) => s.rows), ...customRows], [baseSections, customRows]);

  // Смены команды из «Настройки графика» — первыми, дальше самые частые.
  const weekPresets = useMemo(
    () =>
      mergeShiftPresets(
        settings.presets,
        frequentShifts(patternRows.flatMap((row) => WEEK_DOWS.map((dow) => weekCellsOfId(row.uid)[String(dow)]?.hours ?? null)))
      ),
    [patternRows, weekCellsOfId, settings.presets]
  );
  const monthPresets = useMemo(
    () =>
      mergeShiftPresets(
        settings.presets,
        frequentShifts([...byUid.values()].flatMap((schedule) => Object.values(schedule.hours ?? {})))
      ),
    [byUid, settings.presets]
  );

  /** Все строки графика с учётом скрытых — для «Не показывать» в настройке. */
  const settingsPeople = useMemo(() => {
    const seen = new Set<string>();
    const out: ScheduleRow[] = [];
    for (const row of [
      ...rowsOfMembers(groups.technicians, true),
      ...rowsOfMembers(groups.os, true),
      ...rowsOfMembers(groups.leads, true),
      ...allCustomRows,
    ]) {
      if (seen.has(row.uid)) continue;
      seen.add(row.uid);
      out.push(row);
    }
    return out;
  }, [groups, rowsOfMembers, allCustomRows]);

  // --- столбцы и клетки ------------------------------------------------------

  const monthDays = useMemo(() => daysOfMonth(monthKey), [monthKey]);
  const monthColumns: SheetColumn[] = useMemo(
    () =>
      monthDays.map((d) => ({
        id: d,
        top: d,
        sub: WEEKDAY_LETTERS[weekdayOf(monthKey, d)],
        weekend: isWeekend(monthKey, d),
        today: d === todayKey,
        past: todayKey !== null && Number(d) < Number(todayKey),
      })),
    [monthDays, monthKey, todayKey]
  );
  const weekColumns: SheetColumn[] = useMemo(
    () =>
      WEEK_DOWS.map((dow) => ({
        id: String(dow),
        top: WEEK_DOW_SHORT[dow],
        weekend: dow === 0 || dow === 6,
        today: dow === todayDow,
        past: false,
      })),
    [todayDow]
  );
  const columns = view === "week" ? weekColumns : monthColumns;
  const colIds = useMemo(() => columns.map((c) => c.id), [columns]);

  const monthCellOf = useCallback(
    (row: ScheduleRow, column: SheetColumn): SheetCell => {
      const schedule = byUid.get(row.uid) ?? null;
      const kind = monthCellKind(schedule, column.id);
      const hours = kind === "hours" || kind === "came" ? scheduleHoursOf(schedule, column.id) : null;
      const text = kind === "off" ? "В" : kind === "excused" ? "О" : kind === "came" ? "✓" : hours ? shiftStart(hours) : "";
      const what = kind === "hours" && hours ? `смена ${formatScheduleHours(hours)}` : CELL_KIND_LABEL[kind].toLowerCase();
      return {
        kind,
        text,
        title: `${row.label} · ${dayLabel(monthKey, column.id)} — ${what}${kind === "came" && hours ? ` · ${formatScheduleHours(hours)}` : ""}`,
      };
    },
    [byUid, monthKey]
  );
  const weekCellOf = useCallback(
    (row: ScheduleRow, column: SheetColumn): SheetCell => {
      const cell = weekCellsOfId(row.uid)[column.id] ?? WORK_CELL;
      const kind: CellKind = cell.off ? "off" : cell.hours ? "hours" : "work";
      const text = cell.off ? "вых" : cell.hours ? formatScheduleHours(cell.hours) : "";
      const what = cell.off ? "выходной" : cell.hours ? `смена ${formatScheduleHours(cell.hours)}` : "рабочий весь день";
      return { kind, text, title: `${row.label} · ${WEEK_DOW_SHORT[Number(column.id)]} — ${what}` };
    },
    [weekCellsOfId]
  );
  const countOf = useCallback(
    (sec: SheetSection, column: SheetColumn) =>
      view === "week"
        ? sec.rows.filter((row) => !weekCellsOfId(row.uid)[column.id]?.off).length
        : sec.rows.filter((row) => scheduleStateOf(byUid.get(row.uid) ?? null, column.id) === "work").length,
    [view, weekCellsOfId, byUid]
  );
  const totalOf = useCallback(
    (row: ScheduleRow) =>
      view === "week"
        ? WEEK_DOWS.filter((dow) => weekCellsOfId(row.uid)[String(dow)]?.off).length
        : monthDays.filter((d) => scheduleStateOf(byUid.get(row.uid) ?? null, d) === "off").length,
    [view, weekCellsOfId, monthDays, byUid]
  );

  // --- выделение и палитра ---------------------------------------------------

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  // Строки и столбцы — по содержимому: снимки участников и workspace
  // пересобирают массивы, а выделение от этого сбрасываться не должно.
  const gridSig = `${view}|${monthKey}|${rowIds.join(",")}|${colIds.join(",")}`;
  const selection = useGridSelection({
    rowIds,
    colIds,
    resetKey: gridSig,
    dragEnabled: canEdit,
    onCommit: openPalette,
    onGestureStart: closePalette,
  });

  // Закрыть палитру при смене вида/месяца/строк — вместе с выделением.
  useEffect(() => {
    setPaletteOpen(false);
    setDayTarget(null);
  }, [gridSig]);

  // Палитра привязана к клетке, от которой сейчас ходят стрелки. Ушли
  // стрелкой — сетка дотягивается до клетки, и фокус клавиатуры (если он был
  // в сетке) переходит за ней: Enter жмёт именно её.
  const revealRef = useRef(false);
  useLayoutEffect(() => {
    if (view === "day") return;
    const focus = selection.focus;
    if (!focus) {
      setAnchorEl(null);
      return;
    }
    const scroller = scrollerRef.current;
    const el = scroller?.querySelector<HTMLElement>(`[data-cell][data-r="${focus.row}"][data-c="${focus.col}"]`) ?? null;
    if (el && scroller && revealRef.current) {
      revealRef.current = false;
      revealCell(scroller, el);
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== el && active.closest("[data-cell]")) el.focus({ preventScroll: true });
    }
    setAnchorEl(el);
  }, [view, selection.focus, paletteOpen]);

  const selectedCells = useMemo(() => [...selection.selected].map(splitCellKey), [selection.selected]);
  const monthTarget: MonthCellRef[] = useMemo(() => {
    if (view === "day") return dayTarget ? [{ uid: dayTarget.uid, dayKey: dayKeyOfDayView() }] : [];
    if (view !== "month") return [];
    return selectedCells.map(([rowId, colId]) => ({ uid: rowId, dayKey: colId }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selectedCells, dayTarget, pickedDay, monthKey]);
  const weekTarget: WeekCellRef[] = useMemo(
    () => (view === "week" ? selectedCells.map(([rowId, colId]) => ({ personId: rowId, dow: colId })) : []),
    [view, selectedCells]
  );

  const markPending = useCallback((keys: string[], on: boolean) => {
    setPendingKeys((prev) => {
      const next = new Set(prev);
      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }, []);

  /** Записать правку и положить её в «Отменить»: запись сразу, без «Сохранить». */
  async function runEdit(input: {
    label: string;
    keys: string[];
    apply: () => Promise<void>;
    revert: () => Promise<void>;
  }) {
    markPending(input.keys, true);
    setSavingCount((n) => n + 1);
    try {
      await input.apply();
      pushScheduleCommand({
        undo: async () => {
          setSavingCount((n) => n + 1);
          try {
            await input.revert();
            setLastDone(`Отменено: ${input.label}`);
          } finally {
            setSavingCount((n) => n - 1);
          }
        },
        redo: async () => {
          setSavingCount((n) => n + 1);
          try {
            await input.apply();
            setLastDone(input.label);
          } finally {
            setSavingCount((n) => n - 1);
          }
        },
      });
      setLastDone(input.label);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить график");
    } finally {
      markPending(input.keys, false);
      setSavingCount((n) => n - 1);
    }
  }

  async function applyMonth(cells: MonthCellRef[], action: ScheduleBulkAction, shift: ScheduleHours | null, weekly: boolean) {
    if (!activeWorkspaceId || !canEdit || cells.length === 0) return;
    if (!scheduleReady) {
      toast.error("График ещё загружается — подождите секунду");
      return;
    }
    if (weekWriter.busy) {
      // Постоянная неделя ещё раскладывается по месяцу: правка, посчитанная
      // сейчас, считалась бы от месяца ДО раскладки и легла бы не туда.
      toast("Секунду — сохраняю постоянную неделю");
      return;
    }
    const workspaceId = activeWorkspaceId;
    const writeMonth = monthKey;
    const plan = planMonthEdit(byUid, cells, action, shift);
    const weekAction = weekly ? weekActionOf(action) : null;
    const wplan =
      weekAction && templateReady ? planWeekEdit(weekCellsOfId, monthCellsToWeekCells(writeMonth, cells), weekAction, shift) : null;
    const weekChanges = wplan?.changes ?? [];
    if (plan.touched === 0 && weekChanges.length === 0) {
      setLastDone("Уже так — ничего не поменялось");
      return;
    }
    const what = actionText(action, shift);
    const label = weekChanges.length > 0 ? `${what} — ${everyLabel([...new Set(monthCellsToWeekCells(writeMonth, cells).map((c) => c.dow))])}` : `${what} · ${formatCount(Math.max(plan.touched, 1), CELLS_FORMS)}`;
    const write = (changes: typeof plan.changes, week: WeekPersonChange[] | null) =>
      week && week.length > 0
        ? weekWriter.save({
            changes: week,
            extra: [{ monthKey: writeMonth, changes }],
            throughMonth: writeMonth >= currentMonth ? writeMonth : undefined,
          })
        : saveScheduleDraft({ workspaceId, monthKey: writeMonth, actorUid: uid, changes });
    await runEdit({
      label,
      keys: cells.map((cell) => cellKey(cell.uid, cell.dayKey)),
      apply: () => write(plan.changes, weekChanges),
      revert: () => write(plan.undo, wplan?.undo ?? null),
    });
  }

  async function applyWeek(cells: WeekCellRef[], action: WeekAction, shift: ScheduleHours | null) {
    if (!activeWorkspaceId || !canEdit || cells.length === 0) return;
    if (!templateReady) {
      toast.error("Неделя ещё загружается — подождите секунду");
      return;
    }
    const wplan = planWeekEdit(weekCellsOfId, cells, action, shift);
    if (wplan.changes.length === 0) {
      setLastDone("Уже так — ничего не поменялось");
      return;
    }
    await runEdit({
      label: `${actionText(action, shift)} · ${formatCount(wplan.touched, CELLS_FORMS)} недели`,
      keys: cells.map((cell) => cellKey(cell.personId, cell.dow)),
      apply: () => weekWriter.save({ changes: wplan.changes }),
      revert: () => weekWriter.save({ changes: wplan.undo }),
    });
  }

  async function applyMonthRestore(cells: MonthCellRef[]) {
    if (!activeWorkspaceId || !canEdit || cells.length === 0) return;
    if (!scheduleReady || !templateReady) {
      toast.error("График ещё загружается — подождите секунду");
      return;
    }
    if (weekWriter.busy) {
      toast("Секунду — сохраняю постоянную неделю");
      return;
    }
    const workspaceId = activeWorkspaceId;
    const writeMonth = monthKey;
    const plan = planMonthRestore(byUid, cells, writeMonth, weekCellsOfId);
    if (plan.touched === 0) {
      setLastDone("Уже как в постоянной неделе");
      return;
    }
    await runEdit({
      label: `Как в постоянной неделе · ${formatCount(plan.touched, CELLS_FORMS)}`,
      keys: cells.map((cell) => cellKey(cell.uid, cell.dayKey)),
      apply: () => saveScheduleDraft({ workspaceId, monthKey: writeMonth, actorUid: uid, changes: plan.changes }),
      revert: () => saveScheduleDraft({ workspaceId, monthKey: writeMonth, actorUid: uid, changes: plan.undo }),
    });
  }

  function applyPalette(action: PaletteAction, opts: { shift: ScheduleHours | null; weekly: boolean }) {
    setPaletteOpen(false);
    if (action === "restore") {
      if (view !== "week") void applyMonthRestore(monthTarget);
      if (view === "day") setDayTarget(null);
      return;
    }
    if (view === "week") {
      if (action === "excused" || action === "came") return;
      void applyWeek(weekTarget, action, opts.shift);
    } else {
      void applyMonth(monthTarget, action, opts.shift, opts.weekly);
    }
    if (view === "day") setDayTarget(null);
  }

  function selectColumn(ids: string[], colIndex: number) {
    const colId = colIds[colIndex];
    if (!colId || ids.length === 0) return;
    // Палитра встаёт у первой ВИДИМОЙ клетки столбца: сетка могла быть
    // пролистана вниз, и первая строка давно ушла под шапку.
    const indexes = ids.map((id) => rowIds.indexOf(id)).filter((r) => r >= 0);
    let focusRow = indexes[0] ?? 0;
    const scroller = scrollerRef.current;
    if (scroller) {
      const box = scroller.getBoundingClientRect();
      const headH = scroller.querySelector("thead")?.getBoundingClientRect().height ?? 0;
      const top = Math.max(box.top + headH, 0);
      const bottom = Math.min(box.top + scroller.clientHeight, window.innerHeight);
      for (const r of indexes) {
        const rect = scroller.querySelector(`[data-cell][data-r="${r}"][data-c="${colIndex}"]`)?.getBoundingClientRect();
        if (rect && rect.top >= top - 1 && rect.bottom <= bottom + 1) {
          focusRow = r;
          break;
        }
      }
    }
    selection.setKeys(
      ids.map((id) => cellKey(id, colId)),
      { row: focusRow, col: colIndex }
    );
    setPaletteOpen(true);
  }

  // Клавиши: стрелки ходят по сетке, В/Р/О/П ставят (по физической клавише —
  // `e.code`, чтобы работало и на английской раскладке), Delete — рабочий.
  useEffect(() => {
    if (view === "day") return;
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const dialog = target?.closest("[role='dialog']");
      if (dialog && !dialog.closest("[data-schedule-palette]")) return;
      if (target?.closest("[role='menu'], [role='listbox']")) return;
      if (selection.selected.size === 0) return;
      const arrows: Record<string, [number, number]> = {
        ArrowUp: [-1, 0],
        ArrowDown: [1, 0],
        ArrowLeft: [0, -1],
        ArrowRight: [0, 1],
      };
      if (arrows[event.key]) {
        event.preventDefault();
        setPaletteOpen(false);
        revealRef.current = true;
        selection.move(arrows[event.key][0], arrows[event.key][1], event.shiftKey);
        return;
      }
      if (event.key === "Escape") {
        if (paletteOpen) return; // палитру закроет сама всплывашка
        selection.clear();
        return;
      }
      if (event.key === "Enter") {
        // Enter открывает палитру выделения, только если фокус нигде (или на
        // выделенной клетке). На кнопке («Неделя», «Отменить», имя, кнопка
        // палитры) Enter — это нажатие ЭТОЙ кнопки; на невыделенной клетке —
        // её выбор, его сделает сам клик.
        const cellEl = target?.closest<HTMLElement>("[data-cell]");
        const onPage = !target || target === document.body || target === document.documentElement;
        if (cellEl) {
          const row = rowIds[Number(cellEl.dataset.r)];
          const col = colIds[Number(cellEl.dataset.c)];
          if (row === undefined || col === undefined || !selection.selected.has(cellKey(row, col))) return;
        } else if (!onPage) {
          return;
        }
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (!canEdit) return;
      const byCode: Record<string, ScheduleBulkAction> =
        view === "week"
          ? { KeyD: "off", KeyH: "work", Delete: "work", Backspace: "work" }
          : { KeyD: "off", KeyH: "work", KeyJ: "excused", KeyG: "came", Delete: "work", Backspace: "work" };
      const action = byCode[event.code] ?? byCode[event.key];
      if (!action) return;
      event.preventDefault();
      setPaletteOpen(false);
      if (view === "week") void applyWeek(weekTarget, action as WeekAction, null);
      else void applyMonth(monthTarget, action, null, false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  // «/» — сразу в поиск человека, как в остальных разделах с поиском.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], [role='dialog']")) return;
      event.preventDefault();
      searchRef.current?.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Ctrl+V с таблицей из Google Sheets прямо на неделе — без поиска кнопки.
  useEffect(() => {
    if (view !== "week" || !canEdit || paste) return;
    function onPaste(event: ClipboardEvent) {
      const target = event.target instanceof Element ? event.target : null;
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
  }, [view, canEdit, paste, templateReady]);

  // --- «День» ---------------------------------------------------------------

  // «День»: открытый день месяца. Сегодня — если открыт текущий месяц.
  const monthDayCount = monthDays.length;
  function dayKeyOfDayView() {
    return pickedDay && Number(pickedDay) <= monthDayCount ? pickedDay : todayKey ?? "1";
  }
  const dayKey = dayKeyOfDayView();
  const daySections: DaySection[] = sheetSections
    .filter((s) => s.rows.length > 0)
    .map((s) => ({ id: s.id, title: s.title, icon: s.icon, rows: s.rows, min: s.min }));

  // --- палитра: что показать ---------------------------------------------------

  const palette = useMemo(() => {
    const isWeek = view === "week";
    if (isWeek) {
      const cells = weekTarget;
      if (cells.length === 0) return null;
      const people = new Set(cells.map((c) => c.personId));
      const single = cells.length === 1 ? cells[0] : null;
      const singleRow = people.size === 1 ? rowById.get(cells[0].personId) ?? null : null;
      const kinds = new Map<CellKind, number>();
      for (const c of cells) {
        const cell = weekCellsOfId(c.personId)[c.dow] ?? WORK_CELL;
        const kind: CellKind = cell.off ? "off" : cell.hours ? "hours" : "work";
        kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
      }
      const current = kinds.size === 1 ? [...kinds.keys()][0] : null;
      const shiftNow = single ? weekCellsOfId(single.personId)[single.dow]?.hours ?? null : null;
      return {
        title: single
          ? `${singleRow?.label ?? "—"} · ${WEEKDAY_EVERY[single.dow]}`
          : `${singleRow ? `${singleRow.label} · ` : ""}${formatCount(cells.length, CELLS_FORMS)}${people.size > 1 ? ` · ${people.size} чел.` : ""}`,
        subtitle: current
          ? `Сейчас: ${current === "hours" && shiftNow ? `смена ${formatScheduleHours(shiftNow)}` : current === "work" ? "рабочий весь день" : "выходной"}`
          : `Сейчас: ${mixedText(kinds)}`,
        current,
        currentShift: shiftNow,
        cameAvailable: false,
        restore: null,
        weekly: null,
        blocked: templateReady ? null : "Неделя ещё загружается — подождите секунду.",
        extraLink:
          singleRow && canEdit
            ? { label: `Вся неделя · ${singleRow.label}`, onClick: () => { setPaletteOpen(false); openPerson(singleRow); } }
            : singleRow
              ? { label: `Весь месяц · ${singleRow.label}`, onClick: () => { setPaletteOpen(false); setPersonMonth(singleRow); } }
              : null,
      };
    }
    const cells = monthTarget;
    if (cells.length === 0) return null;
    const people = new Set(cells.map((c) => c.uid));
    const single = cells.length === 1 ? cells[0] : null;
    const rowOf = (id: string) => rowById.get(id) ?? patternRows.find((row) => row.uid === id) ?? null;
    const singleRow = people.size === 1 ? rowOf(cells[0].uid) : null;
    const kinds = monthSelectionKinds(byUid, cells);
    const current = kinds.size === 1 ? [...kinds.keys()][0] : null;
    const shiftNow = single ? scheduleHoursOf(byUid.get(single.uid), single.dayKey) : null;
    const cameAvailable = cells.some((c) => {
      const kind = monthCellKind(byUid.get(c.uid) ?? null, c.dayKey);
      return kind === "off" || kind === "excused";
    });
    const dows = [...new Set(monthCellsToWeekCells(monthKey, cells).map((c) => c.dow))];
    const ahead = monthsBetween(currentMonth, monthKey);
    const weeklyReason =
      monthKey < currentMonth
        ? "Прошедший месяц: постоянная неделя действует с сегодняшнего дня"
        : ahead >= LAY_MONTHS_MAX
          ? "Слишком далеко вперёд — поставьте во вкладке «Неделя»"
          : !templateReady
            ? "Неделя ещё загружается"
            : null;
    // Что по постоянной неделе в этот день — чтобы было видно, разовое это
    // или «так каждую неделю».
    let weekNote = "";
    if (single && templateReady) {
      const dow = String(weekdayOf(monthKey, single.dayKey));
      const weekCell = weekCellsOfId(single.uid)[dow] ?? WORK_CELL;
      weekNote = weekCell.off
        ? ` · по неделе: выходной ${WEEKDAY_EVERY[dow].replace(/^кажд\S+ /, "в ")}`
        : weekCell.hours
          ? ` · по неделе: смена ${formatScheduleHours(weekCell.hours)}`
          : "";
    }
    const describe = (kind: CellKind) =>
      kind === "hours" && shiftNow ? `смена ${formatScheduleHours(shiftNow)}` : CELL_KIND_LABEL[kind].toLowerCase();
    // «Как в постоянной неделе» — у кого неделя вообще задана.
    const withWeek = templateReady && cells.some((c) => hasWeek(template?.people?.[c.uid]));
    return {
      title: single
        ? `${singleRow?.label ?? "—"} · ${dayLabel(monthKey, single.dayKey)}`
        : `${singleRow ? `${singleRow.label} · ` : ""}${formatCount(cells.length, CELLS_FORMS)}${people.size > 1 ? ` · ${people.size} чел.` : ""}`,
      subtitle: current ? `Сейчас: ${describe(current)}${weekNote}` : `Сейчас: ${mixedText(kinds)}`,
      current,
      currentShift: shiftNow,
      cameAvailable,
      restore: withWeek ? { touched: planMonthRestore(byUid, cells, monthKey, weekCellsOfId).touched } : null,
      weekly: { label: everyLabel(dows), disabledReason: weeklyReason },
      blocked: scheduleReady ? null : "График ещё загружается — подождите секунду.",
      extraLink: singleRow
        ? { label: `Весь месяц · ${singleRow.label}`, onClick: () => { setPaletteOpen(false); setDayTarget(null); setPersonMonth(singleRow); } }
        : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, weekTarget, monthTarget, weekCellsOfId, byUid, rowById, patternRows, monthKey, currentMonth, templateReady, scheduleReady, canEdit, template]);

  const paletteKey = `${view}|${monthKey}|${[...selection.selected].join(",")}|${dayTarget?.uid ?? ""}|${dayKey}`;
  const paletteShown = paletteOpen && palette !== null && (view !== "day" || dayTarget !== null);

  // --- действия страницы -------------------------------------------------------

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
      toast.success(approve ? `${request.name} отмечен(а) на ${requestDateLabel(request)}` : "Запрос отклонён");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось обработать запрос");
    }
  }

  async function saveGroup(name: string, people: SchedulePerson[]): Promise<boolean> {
    if (!activeWorkspaceId) return false;
    try {
      await saveScheduleGroup({ workspaceId: activeWorkspaceId, name, people, actorUid: uid });
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить раздел");
      return false;
    }
  }

  async function addCustomPerson() {
    const name = await promptDialog({
      title: `Добавить в «${groupName}»`,
      description: "Для тех, кого нет в участниках: подрядчики, кто пришёл на месяц. Смены им ставят так же, как всем.",
      label: "Имя",
      placeholder: "Например, Асхат (монтаж)",
      confirmLabel: "Добавить",
      maxLength: 60,
      validate: (value) => (value.trim() ? null : "Напишите имя"),
    });
    const next = name?.trim();
    if (!next) return;
    if (await saveGroup(groupName, [...groupPeople, { id: newSchedulePersonId(), name: next }])) {
      toast.success(`${next} — в разделе «${groupName}»`);
    }
  }

  async function renameCustomSection() {
    const name = await promptDialog({
      title: "Название раздела",
      label: "Название",
      defaultValue: groupName,
      confirmLabel: "Сохранить",
      maxLength: 40,
      validate: (value) => (value.trim() ? null : "Напишите название"),
    });
    const next = name?.trim();
    if (!next || next === groupName) return;
    await saveGroup(next, groupPeople);
  }

  customActionsRef.current = { add: () => void addCustomPerson(), rename: () => void renameCustomSection() };

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
    setMonthKey(next);
  }

  /** Имя: неделя человека у того, кто её правит (в «Неделе»), иначе — весь месяц крупно. */
  function openPerson(row: ScheduleRow) {
    if (!canEdit || !templateReady) return;
    setPersonTarget(row);
  }
  const onNameClick = useCallback(
    (row: ScheduleRow) => {
      setPaletteOpen(false);
      if (view === "week" && canEdit) {
        if (templateReady) setPersonTarget(row);
      } else {
        setPersonMonth(row);
      }
    },
    [view, canEdit, templateReady]
  );

  async function saveWeekOf(row: ScheduleRow, cells: Record<string, WeekCell>) {
    setPersonTarget(null);
    const before = weekCellsOfId(row.uid);
    const change: WeekPersonChange = { personId: row.uid, cells, entry: normalizeWeekEntry(cells) };
    const back: WeekPersonChange = { personId: row.uid, cells: before, entry: normalizeWeekEntry(before) };
    await runEdit({
      label: `Неделя · ${row.label}`,
      keys: WEEK_DOWS.map((dow) => cellKey(row.uid, String(dow))),
      apply: () => weekWriter.save({ changes: [change] }),
      revert: () => weekWriter.save({ changes: [back] }),
    });
  }

  async function applyPaste(result: WeekPasteResult[]) {
    if (!templateReady) return;
    // В таблице руководства есть те, у кого аккаунта ещё нет: заводим их в
    // своём разделе и тем же именем ставим ник ОС — при закреплении ника
    // строка графика переедет на аккаунт.
    const additions = result.filter((r) => !r.personId && r.newName?.trim());
    const newIdByName = new Map<string, string>();
    if (additions.length > 0) {
      const people = [...groupPeople];
      for (const add of additions) {
        const name = add.newName!.trim();
        if (newIdByName.has(name)) continue;
        const id = newSchedulePersonId();
        newIdByName.set(name, id);
        people.push({ id, name, osNick: name });
      }
      if (!(await saveGroup(groupName, people))) return;
      toast.success(`Завели в разделе «${groupName}»: ${newIdByName.size}`);
    }
    const changes: WeekPersonChange[] = [];
    const back: WeekPersonChange[] = [];
    for (const { personId, newName, cells: parsed } of result) {
      const id = personId || newIdByName.get((newName ?? "").trim()) || "";
      if (!id) continue;
      const before = weekCellsOfId(id);
      const after: Record<string, WeekCell> = { ...before };
      // Только распознанные клетки: пустая и непонятная оставляют день как был.
      for (const [dow, cell] of Object.entries(parsed)) {
        if (cell.kind === "off" || cell.kind === "work" || cell.kind === "hours") {
          after[dow] = applyParsedCell(before[dow] ?? WORK_CELL, cell);
        }
      }
      const entry = normalizeWeekEntry(after);
      if (sameWeek(entry, normalizeWeekEntry(before))) continue;
      changes.push({ personId: id, cells: after, entry });
      back.push({ personId: id, cells: before, entry: normalizeWeekEntry(before) });
    }
    setPaste(null);
    setSection("all");
    setQuery("");
    if (changes.length === 0) {
      toast.success("Неделя и так такая — ничего не поменялось");
      return;
    }
    await runEdit({
      label: `Неделя из таблицы · ${changes.length} чел.`,
      keys: changes.flatMap((c) => WEEK_DOWS.map((dow) => cellKey(c.personId, String(dow)))),
      apply: () => weekWriter.save({ changes }),
      revert: () => weekWriter.save({ changes: back }),
    });
  }

  /**
   * Пакет из окна «Месяц человека» — один batch. Возвращает «Отменить»: окно
   * показывает её у себя (тост под затемнением окна не нажать).
   */
  async function applyPersonBulk(row: ScheduleRow, plan: ScheduleBulkPlan): Promise<() => Promise<void>> {
    if (!activeWorkspaceId || plan.touched.length === 0) return async () => {};
    const workspaceId = activeWorkspaceId;
    const writeMonth = monthKey;
    const write = (change: typeof plan.change) =>
      saveScheduleDraft({ workspaceId, monthKey: writeMonth, actorUid: uid, changes: [{ uid: row.uid, ...change }] });
    let undone = false;
    const undoOnce = async () => {
      if (undone) return;
      undone = true;
      try {
        await write(plan.undo);
        toast.success("Отменено");
      } catch (error) {
        undone = false;
        toast.error(error instanceof Error ? error.message : "Не удалось отменить");
        throw error;
      }
    };
    try {
      await write(plan.change);
      pushScheduleCommand({ undo: () => write(plan.undo), redo: () => write(plan.change) });
      setLastDone(`${row.label}: изменено дней — ${plan.touched.length}`);
      return undoOnce;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось изменить график");
      throw error;
    }
  }

  const monthLabel = monthTabNameForKey(monthKey).toLowerCase();
  // Кнопки — только для своих правок: Ctrl+Z с клавиатуры или отмена на
  // другом экране их тоже двигают, поэтому смотрим на вершину стека.
  const canUndoHere = undoState.undoTop !== null && scheduleCommands.has(undoState.undoTop);
  const canRedoHere = undoState.redoTop !== null && scheduleCommands.has(undoState.redoTop);

  const description =
    view === "day"
      ? canEdit
        ? "Кто работает в выбранный день. Нажмите на человека — выходной, отпросился, смена."
        : "Кто работает в выбранный день, у кого смена с/до и кого нет."
      : view === "week"
        ? canEdit
          ? "Постоянная неделя каждого. Нажмите на клетку и выберите, что поставить — сохранится сразу и само разложится в «Месяц»."
          : "Постоянная неделя команды: у кого какие выходные и смены. Разовые выходные — во вкладке «Месяц»."
        : canEdit
          ? "Конкретные даты: отпуск, отгул, «поменялись». Нажмите на клетку и выберите, что поставить — сохранится сразу."
          : "Кто работает, у кого выходной и кто отпросился. График ведёт руководство.";

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1600px] px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
      <PageHeader
        eyebrow="Студия"
        title="График"
        // На телефоне описание — лишние три строки над сеткой: как править,
        // и так написано строкой прямо над клетками.
        description={mobile ? undefined : description}
        className="mb-4"
        actions={
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <div className="inline-flex rounded-lg border border-border p-0.5" role="tablist" aria-label="Вид графика">
              {VIEWS.map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => setView(v)}
                  className={cn(
                    "min-h-10 rounded-md px-3 text-[13px] transition-colors sm:min-h-8",
                    view === v ? "bg-primary/15 font-medium text-primary" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {VIEW_LABELS[v]}
                </button>
              ))}
            </div>
            {view !== "week" && (
              // Стрелки и месяц — одной группой: на телефоне шапка переносится.
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 sm:h-8 sm:w-8"
                  aria-label="Предыдущий месяц"
                  onClick={() => goToMonth(previousMonthKey(monthKey))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="min-w-[8rem] text-center text-sm font-medium">{monthLabel}</span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 sm:h-8 sm:w-8"
                  aria-label="Следующий месяц"
                  onClick={() => goToMonth(nextMonthKey(monthKey))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                {!isCurrentMonth && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-10 sm:min-h-0"
                    onClick={() => {
                      setMonthKey(currentMonth);
                      setPickedDay(null);
                    }}
                  >
                    Сегодня
                  </Button>
                )}
              </div>
            )}
            {isRealOwner && activeWorkspaceId && (
              <Button
                variant="outline"
                size="sm"
                className="min-h-10 gap-1.5 sm:min-h-8"
                onClick={() => setSettingsOpen(true)}
                title="Кто ещё правит график, смены команды, норма на смене, кого не показывать"
              >
                <Settings2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Настройка</span>
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
                ...baseSections.map((s) => (
                  <button key={s.id} type="button" onClick={() => setSection(s.id)} className={pageChipClass(section === s.id)}>
                    {s.title}
                    <span className="ml-1 tabular-nums opacity-70">{s.rows.length}</span>
                  </button>
                )),
                ...(showCustom
                  ? [
                      <button key="custom" type="button" onClick={() => setSection("custom")} className={pageChipClass(section === "custom")}>
                        {groupName}
                        {customRows.length > 0 && <span className="ml-1 tabular-nums opacity-70">{customRows.length}</span>}
                      </button>,
                    ]
                  : []),
              ]
        }
      />

      <div className="mb-4 flex flex-col gap-3">
        {/* Свой график — крупно и отдельно от общей сетки. У руководства свёрнут:
            сюда оно приходит заполнять, а не смотреть свои смены. */}
        {iAmScheduled && activeWorkspaceId && patternRows.some((row) => row.uid === uid) ? (
          <MyScheduleCard workspaceId={activeWorkspaceId} uid={uid} name={myName} todayYmd={todayYmd} defaultOpen={!canEdit} />
        ) : (
          isCurrentMonth && (
            <span className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-primary/35 bg-primary/[0.07] px-2.5 py-1 text-[12px] font-medium text-primary">
              <CalendarDays className="h-3.5 w-3.5 shrink-0" />
              Сегодня {formatDate(Date.now(), "d MMMM, EEEE")}
            </span>
          )
        )}

        {/* Кто сегодня на смене — одной строкой: руководство открывает «График»
            ровно за этим. Тап — вид «День» на сегодня. */}
        {view !== "day" && isCurrentMonth && scheduleReady && todayKey && (
          <TodayOnShift
            sections={baseSections}
            schedules={byUid}
            todayKey={todayKey}
            onOpen={() => {
              setPickedDay(null);
              setView("day");
            }}
          />
        )}

        {canEdit && pendingRequests.length > 0 && (
          <div className="flex flex-col gap-2 rounded-xl border border-primary/35 bg-primary/[0.06] p-3">
            <p className="text-[12px] font-medium">
              Просят отметить выход <span className="tabular-nums opacity-70">{pendingRequests.length}</span>
            </p>
            {pendingRequests.map((request) => (
              // Дата — ПЕРВОЙ и без обрезки: на телефоне кнопки съедали место, и
              // Тимлид подтверждал вслепую, не видя, за какой день ставит отметку.
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

        {iAmScheduled && scheduleReady && myToday !== "work" && !canEdit && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-warning/35 bg-warning/[0.08] px-3 py-2.5 text-[12px]">
            <p className="min-w-0 flex-1">
              {myToday === "off" ? "Сегодня у вас выходной" : "Сегодня вы отпросились"} — отклики на заказы закрыты. График
              правит Тимлид, но можно попросить отметить выход.
            </p>
            {myRequest?.status === "pending" ? (
              <>
                <span className="shrink-0 rounded-md bg-muted px-2 py-1">Запрос отправлен</span>
                <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-0" disabled={requestBusy} onClick={() => void withdrawRequest(myRequest)}>
                  Отозвать
                </Button>
              </>
            ) : (
              <Button size="sm" className="min-h-11 gap-1.5 sm:min-h-0" disabled={requestBusy} onClick={() => void askForMark()}>
                {requestBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Я вышел — прошу отметить
              </Button>
            )}
            {myRequest?.status === "declined" && <span className="shrink-0 text-muted-foreground">прошлый запрос отклонён</span>}
          </div>
        )}

        {view === "week" && templateFailed && (
          <FailBanner text="Неделя не загрузилась — показана пустой, правка выключена." onRetry={() => setTemplateAttempt((n) => n + 1)} />
        )}
        {view !== "week" && schedulesFailed && (
          <FailBanner text="График не загрузился — показан пустым, правка выключена." onRetry={retrySchedules} />
        )}
      </div>

      {nothingAtAll ? (
        <EmptyState eyebrow="График" title="Пока некого ставить в график" description="Здесь появятся участники со столом, ОС и руководство." />
      ) : (
        <section className="min-w-0 rounded-xl border border-border/70 bg-card">
          {/* Панель сетки: поиск, что уже записано и «Отменить», масштаб. */}
          <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
            {/* На телефоне поиск — во всю строку: рядом с кнопками от него
                оставалось «Най». */}
            <div className="relative min-w-0 flex-1 basis-full sm:max-w-[16rem] sm:basis-auto">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setQuery("");
                  // Один найденный — Enter открывает его: неделю у того, кто её
                  // правит, иначе весь месяц человека.
                  if (e.key === "Enter" && foundCount === 1) onNameClick(flatRows[0]);
                }}
                placeholder={mobile ? "Найти человека" : "Найти человека  /"}
                aria-label="Найти человека в графике"
                className="h-9 pl-8 pr-8 text-[13px]"
              />
              {searching && (
                <button
                  type="button"
                  aria-label="Очистить поиск"
                  onClick={() => setQuery("")}
                  className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {searching && (
              <span className="text-[12px] text-muted-foreground">
                найдено: <span className="font-medium tabular-nums text-foreground">{foundCount}</span>
              </span>
            )}
            {!searching && view !== "day" && <Legend mode={view === "week" ? "week" : "month"} className="hidden lg:flex" />}
            <div className="ml-auto flex items-center gap-1.5">
              {canEdit && (
                <SaveStatus
                  saving={savingCount > 0 || weekWriter.busy}
                  text={lastDone}
                  canUndo={canUndoHere}
                  canRedo={canRedoHere}
                  onUndo={() => void undo()}
                  onRedo={() => void redo()}
                />
              )}
              {canEdit && view === "week" && (
                // Вставка из Google Sheets — дело компьютера; на телефоне кнопка
                // только отнимала место у поиска.
                <Button
                  variant="outline"
                  size="sm"
                  className="hidden h-9 gap-1.5 sm:inline-flex"
                  disabled={!templateReady}
                  onClick={() => setPaste({ text: "" })}
                  title="Вставить неделю из Google Sheets / Excel (или просто Ctrl+V)"
                >
                  <ClipboardPaste className="h-3.5 w-3.5" />
                  <span className="hidden md:inline">Из таблицы</span>
                </Button>
              )}
              <div className="inline-flex items-center rounded-lg border border-border p-0.5" role="group" aria-label="Масштаб графика">
                {DENSITY_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    title={option.title}
                    aria-label={option.title}
                    aria-pressed={density === option.value}
                    onClick={() => setDensity(option.value)}
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-md font-semibold leading-none transition-colors",
                      option.className,
                      density === option.value ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    A
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* На узком экране обозначения — отдельной строкой: в панели им места нет,
              а подсказки по наведению на телефоне не бывает. */}
          {view !== "day" && !(searching && foundCount === 0) && (
            <div className="border-b border-border/60 px-3 py-1.5 lg:hidden">
              <Legend mode={view === "week" ? "week" : "month"} className="flex" />
            </div>
          )}

          {canEdit && view !== "day" && (
            <p className="border-b border-border/60 px-3 py-1.5 text-[11px] leading-4 text-muted-foreground">
              {mobile ? (
                view === "week" ? (
                  "Нажмите на клетку, чтобы поменять. Нажмите на имя — вся неделя человека в одном окне."
                ) : (
                  "Нажмите на клетку, чтобы поменять. Нажмите на имя — весь месяц человека."
                )
              ) : (
                <>
                  <b className="font-medium text-foreground/80">Клик</b> по клетке — выбрать, что поставить ·{" "}
                  <b className="font-medium text-foreground/80">протяните</b> мышью — несколько клеток · клик по{" "}
                  {view === "week" ? "дню недели" : "числу"} — весь столбец · клавиши{" "}
                  <Kbd>В</Kbd> <Kbd>Р</Kbd>
                  {view === "month" && (
                    <>
                      {" "}
                      <Kbd>О</Kbd> <Kbd>П</Kbd>
                    </>
                  )}{" "}
                  — сразу поставить · <Kbd>Ctrl+Z</Kbd> — отменить
                </>
              )}
            </p>
          )}

          {searching && foundCount === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">Никого не нашли по «{query.trim()}».</p>
          ) : view === "day" ? (
            <div className="p-3 sm:p-4">
              <ScheduleDayView
                monthKey={monthKey}
                dayKey={dayKey}
                todayKey={todayKey}
                sections={daySections}
                schedules={byUid}
                canEdit={canEdit && scheduleReady}
                density={density}
                selectedUid={paletteOpen ? dayTarget?.uid ?? null : null}
                onSelectDay={(d) => {
                  setPickedDay(d);
                  setPaletteOpen(false);
                  setDayTarget(null);
                }}
                onPickPerson={(row, anchor) => {
                  setDayTarget({ uid: row.uid, anchor });
                  setAnchorEl(anchor);
                  setPaletteOpen(true);
                }}
                onOpenPerson={(row) => setPersonMonth(row)}
              />
            </div>
          ) : (
            <ScheduleSheet
              mode={view === "week" ? "week" : "month"}
              columns={columns}
              sections={sheetSections}
              cellOf={view === "week" ? weekCellOf : monthCellOf}
              countOf={countOf}
              totalOf={totalOf}
              totalHead={
                view === "week"
                  ? { label: "Вых", title: "Выходных в неделю" }
                  : { label: "Вых", title: "Выходных за месяц" }
              }
              density={density}
              meUid={uid}
              canEdit={canEdit && (view === "week" ? templateReady : scheduleReady)}
              selection={selection}
              pending={pendingKeys}
              onSelectColumn={selectColumn}
              onOpenPerson={onNameClick}
              onRemoveRow={(row) => void removePerson(row)}
              removableIds={customIds}
              personHint={view === "week" && canEdit ? "вся неделя в одном окне" : "весь месяц крупно"}
              scrollerRef={scrollerRef}
              scrollToColumn={view === "month" ? todayKey : null}
            />
          )}

          {view === "week" && (
            <p className="border-t border-border/60 px-3 py-2 text-[11px] leading-4 text-muted-foreground">
              Неделя сама раскладывается во вкладку «Месяц»: с сегодняшнего дня и на весь следующий месяц, а 1-го числа — ещё
              на месяц вперёд. Выходные и смены, поставленные в месяце на конкретную дату, «отпросился» и «пришёл» она не
              перетирает.
            </p>
          )}
        </section>
      )}

      {palette && paletteShown && (
        <SchedulePalette
          key={paletteKey}
          open
          onClose={() => {
            setPaletteOpen(false);
            if (view === "day") setDayTarget(null);
          }}
          anchor={anchorEl}
          mobile={mobile}
          mode={view === "week" ? "week" : "month"}
          title={palette.title}
          subtitle={palette.subtitle}
          canEdit={canEdit}
          blocked={palette.blocked}
          current={palette.current}
          cameAvailable={palette.cameAvailable}
          presets={view === "week" ? weekPresets : monthPresets}
          currentShift={palette.currentShift}
          weekly={palette.weekly}
          onApply={applyPalette}
          extraLink={palette.extraLink}
          restore={canEdit ? palette.restore : null}
        />
      )}

      {paste && (
        <WeekPasteDialog
          workspaceId={activeWorkspaceId ?? ""}
          rows={patternRows}
          currentOf={weekCellsOfId}
          initialText={paste.text}
          onClose={() => setPaste(null)}
          canAddPeople={canEdit}
          onApply={(result) => void applyPaste(result)}
        />
      )}

      {personTarget && (
        <PersonWeekDialog
          row={personTarget}
          cells={weekCellsOfId(personTarget.uid)}
          stored={storedWeek.get(personTarget.uid) ?? emptyWeek}
          presets={weekPresets}
          others={patternRows
            .filter((row) => row.uid !== personTarget.uid)
            .map((row) => ({ row, cells: weekCellsOfId(row.uid) }))}
          onClose={() => setPersonTarget(null)}
          onApply={(cells) => void saveWeekOf(personTarget, cells)}
        />
      )}

      {personMonth && (
        <PersonMonthDialog
          row={personMonth}
          monthKey={monthKey}
          monthLabel={monthLabel}
          todayKey={todayKey}
          schedule={byUid.get(personMonth.uid) ?? null}
          ready={scheduleReady}
          canEdit={canEdit}
          presets={monthPresets}
          onMonth={(direction) => goToMonth(direction < 0 ? previousMonthKey(monthKey) : nextMonthKey(monthKey))}
          onApply={(plan) => applyPersonBulk(personMonth, plan)}
          onClose={() => setPersonMonth(null)}
        />
      )}

      {settingsOpen && activeWorkspaceId && (
        <ScheduleSettingsDialog
          workspaceId={activeWorkspaceId}
          settings={activeWorkspace?.scheduleSettings}
          members={active}
          people={settingsPeople}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px] font-medium text-foreground/80">{children}</kbd>
  );
}

function FailBanner({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
      <span className="min-w-0 flex-1">{text}</span>
      <button type="button" onClick={onRetry} className="min-h-11 shrink-0 font-medium underline underline-offset-2 sm:min-h-0">
        Повторить
      </button>
    </div>
  );
}

/** Обозначения — теми же цветами, что клетки, поэтому отдельная легенда внизу не нужна. */
function Legend({ mode, className }: { mode: "month" | "week"; className?: string }) {
  const items: Array<{ kind: CellKind; text: string; label: string }> =
    mode === "week"
      ? [
          { kind: "work", text: "", label: "рабочий" },
          { kind: "off", text: "вых", label: "выходной" },
          { kind: "hours", text: "12–15", label: "смена с/до" },
        ]
      : [
          { kind: "work", text: "", label: "рабочий" },
          { kind: "off", text: "В", label: "выходной" },
          { kind: "excused", text: "О", label: "отпросился" },
          { kind: "hours", text: "12", label: "смена с 12" },
          { kind: "came", text: "✓", label: "пришёл в выходной" },
        ];
  return (
    <div className={cn("flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground", className)}>
      {items.map((item) => (
        <span key={item.kind} className="inline-flex items-center gap-1.5">
          <span
            className={cn(
              "flex h-5 min-w-5 items-center justify-center rounded-[4px] border px-1 font-mono text-[10px] font-semibold leading-none",
              CELL_KIND_LOOK[item.kind]
            )}
          >
            {item.text}
          </span>
          {item.label}
        </span>
      ))}
    </div>
  );
}

/** Что уже записано и «Отменить» — прямо у сетки: режима «Сохранить» больше нет. */
function SaveStatus({
  saving,
  text,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  saving: boolean;
  text: string | null;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      {/* На телефоне — только значок: подпись не помещается рядом с поиском. */}
      {(saving || text) && (
        <span
          className={cn("flex h-9 w-6 items-center justify-center sm:hidden", saving ? "text-muted-foreground" : "text-success")}
          title={saving ? "Сохраняю…" : text ?? undefined}
          aria-hidden
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        </span>
      )}
      <span
        className={cn(
          "sr-only min-w-0 max-w-[18rem] items-center gap-1.5 truncate text-[12px] sm:not-sr-only sm:inline-flex",
          saving ? "text-muted-foreground" : "text-success"
        )}
        aria-live="polite"
      >
        {saving ? (
          <>
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> Сохраняю…
          </>
        ) : text ? (
          <>
            <Check className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{text}</span>
          </>
        ) : null}
      </span>
      <Button
        variant="ghost"
        size="icon"
        data-compact
        className="h-9 w-9"
        disabled={!canUndo}
        onClick={onUndo}
        title="Отменить (Ctrl+Z)"
        aria-label="Отменить"
      >
        <Undo2 className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        data-compact
        className="h-9 w-9"
        disabled={!canRedo}
        onClick={onRedo}
        title="Вернуть (Ctrl+Shift+Z)"
        aria-label="Вернуть"
      >
        <Redo2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
