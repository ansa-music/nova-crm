/**
 * `responsible` — ник ОС (общий список `workspace.responsibleOptions`),
 * `technician` — ник ТЕХНАРЯ (`workspace.techNickOptions`). Это РАЗНЫЕ типы
 * намеренно: любой столбец `responsible` считается ОС-столбцом
 * (`osColumnsOf` в utils/techLoad.ts), и технари, положенные туда, посчитались
 * бы как ОС в заказах, оценках и на дашборде.
 */
export type ColumnType = "text" | "number" | "currency" | "status" | "responsible" | "technician" | "custom" | "date" | "email" | "phone" | "url";

export interface StatusOption {
  value: string;
  label: string;
  color: string; // hex or hsl token used for the badge
  /**
   * Вариант уведён в «неактуальные»: ОС ушёл, статус больше не используют.
   * Из списка он НЕ удаляется — на нём висят заказы прошлых месяцев, а
   * подпись и цвет резолвятся именно отсюда (`StatusBadge` без варианта
   * рисует «—»). Меняется только одно: в выпадашках его не предлагают,
   * пока человек сам не раскроет «Неактуальные».
   */
  inactive?: boolean;
}

export interface PageColumn {
  id: string;
  key: string;
  label: string;
  type: ColumnType;
  width: number;
  order: number;
  /**
   * DEAD for type "status" as of the fix that made statuses fully
   * workspace-wide again — `getColumnOptions()` never reads this field for
   * a status column anymore, only `Workspace.statusOptions`. A status
   * column may still carry a stale value here from before that fix (or a
   * legacy write); it's inert and safe to ignore. Never write to it for a
   * new/changed status column — always go through
   * `updateStatusOptions(workspaceId, options)` instead.
   * Columns of type "responsible" never used this either: their options
   * come from the single, workspace-wide `Workspace.responsibleOptions`
   * list (managed by the Owner in Настройки → Workspace), so every
   * "Ответственный" column on the site always shows the same shared,
   * site-wide list. See `src/utils/columnOptions.ts`.
   */
  statusOptions?: StatusOption[];
  /**
   * Only meaningful for type "custom" — which of the workspace's
   * Owner-defined custom fields (`Workspace.customFields`) this column
   * shows. Same shared-list pattern as "responsible": the options live on
   * the workspace, not the column.
   */
  customFieldId?: string;
  /** When true, the column stays in schema but is hidden in the table. */
  hidden?: boolean;
}

export type PageIconName =
  | "Users"
  | "Briefcase"
  | "Wallet"
  | "UserCog"
  | "LayoutGrid"
  | "Building2"
  | "Target"
  | "ClipboardList"
  | "Rocket"
  | "Star";

/** Ключи столбцов месячной вкладки по ролям — см. WorkspacePage.osFieldKeys. */
export interface OsFieldKeys {
  /** Для какой вкладки посчитана: ключи столбцов у вкладок разные. */
  tabId: string;
  client?: string;
  phone?: string;
  price?: string;
  status?: string;
  os?: string;
  link?: string;
  date?: string;
  deadline?: string;
  persons?: string;
  minutes?: string;
  /** Когда посчитана — чтобы видеть несвежую карту. */
  at: number;
}

export interface WorkspacePage {
  id: string;
  workspaceId: string;
  name: string;
  icon: PageIconName;
  color: string;
  order: number;
  /**
   * Explicit allow-list of member uids who may see/open this page. The
   * workspace Owner always has access regardless of this list (enforced in
   * both client permission checks and Firestore rules) — everyone else,
   * including Admins, sees a page only if their uid is listed here.
   */
  allowedUsers: string[];
  /**
   * Subset of `allowedUsers` who may also EDIT the page's data (not just
   * view it). Being in `allowedUsers` alone now only grants read access —
   * edit rights are a separate, explicit grant on top of that, managed by
   * the Owner or this page's responsible person. Owner and the responsible
   * person can always edit regardless of this list.
   */
  editableUsers?: string[];
  /**
   * The one member (besides Owner) responsible for this page. Only the
   * Owner may assign/change who this is (via EditPageDialog). The
   * responsible person — and only them, besides the Owner — may then flip
   * `hiddenByResponsible` themselves, controlling whether everyone else in
   * `allowedUsers` can currently see the page. Owner and the responsible
   * person can always see it regardless of this flag.
   */
  responsibleUserId?: string | null;
  /**
   * When true, the page is hidden from everyone except the Owner and
   * `responsibleUserId`, even if their uid is in `allowedUsers`. Toggled
   * exclusively by the responsible person, not the Owner.
   */
  hiddenByResponsible?: boolean;
  /**
   * «Неактуальные столы» — a desk retired instead of deleted. Only the Owner
   * and a Тимлид flip it (setPageInactive; rules keep the responsible person
   * out). `useWorkspace().pages` leaves these out, so they drop off «Столы»,
   * the dashboard, «Технари» and month tabs; tabs and rows stay untouched.
   */
  inactive?: boolean;
  inactiveAt?: number | null;
  inactiveBy?: string | null;
  /**
   * «Стол ОС» — личная таблица ОС, к работе технарей отношения не имеющая.
   * Живёт в той же коллекции `pages` (весь движок таблицы, вкладок и прав
   * уже там), но ВЕЗДЕ отделён: `useWorkspace().pages` его не отдаёт, поэтому
   * он не попадает ни в «Столы», ни на дашборд, ни в «Технари», ни в месячные
   * вкладки, ни в квоту Технаря. Создаётся с фиксированным id
   * `osdesk_{uid}` — один на человека, второй просто не создастся.
   */
  osDesk?: boolean;
  /** Reserved for a future public/private page toggle. Not yet enforced anywhere — always treat as "public" until wired up. */
  visibility?: "public" | "private";
  /** Uids explicitly allowed into this page's Personal Space (Reports/Finance/Notes), beyond the Owner and responsibleUserId who always have it. */
  personalZoneAllowedUsers?: string[];
  /**
   * Which tab opens by default when someone navigates to this page —
   * a subpage id, or undefined/null for "Основная" (the page's own main
   * table). Set from the tab bar itself ("Сделать открываемой по
   * умолчанию") by whoever can manage the page.
   */
  defaultSubPageId?: string | null;
  /**
   * Month autopilot (see src/services/monthTabService.ts): the "YYYY-MM"
   * Almaty month whose tab was last ensured on this desk, and that tab's
   * subpage id. When `autoMonthKey` equals the current month, the tab
   * already exists and was made default once — the autopilot never
   * touches this desk again until the month changes, so a manual default
   * picked afterwards sticks. Only orders in `autoMonthSubPageId` count
   * toward the current month on the «Технари» screen.
   */
  autoMonthKey?: string;
  autoMonthSubPageId?: string;
  /**
   * Карта «роль → ключ столбца» текущей месячной вкладки.
   *
   * Нужна ОС: заказ он ведёт у себя, а строка живёт в столе технаря, и
   * ключи столбцов там у каждой вкладки свои. Подвкладки ЧУЖОГО стола ОС не
   * прочитает (правило чтения подвкладок — `canAccessPage`), а документ
   * стола читает любой участник — значит карта обязана лежать здесь.
   * Подбирать ключи регэкспами на каждой записи нельзя: переименовали
   * столбец — и зеркало молча начало писать мимо (этим уже ломался ник ОС).
   *
   * Пишет сессия владельца стола (`useOsFieldKeysPublisher`) и только при
   * настоящей смене состава столбцов.
   */
  osFieldKeys?: OsFieldKeys;
  /** «Основная» keeps a hand-made row order — see DataTable.manualRowOrder. */
  rowOrder?: "manual";
  /**
   * Owner switch: treat this desk like a Технарь's even though its
   * responsible person isn't one (e.g. the Owner's own desk) — month tabs
   * and a row on «Технари». Desks of real Технари don't need it.
   */
  technicianDesk?: boolean;
  /**
   * New desks hide the "Основная" tab (page rows). Set only at create time.
   * Older desks omit this and keep Основная plus their existing rows.
   */
  hideMainTab?: boolean;
  /**
   * Personal monthly revenue target for whoever is responsible for this
   * page — purely a personal-motivation number shown as a progress bar on
   * their own Dashboard landing, editable by them or the Owner. Not used
   * anywhere else (grouping, filtering, aggregates).
   */
  monthlyGoal?: number;
  /**
   * Per-page accent color override (same HSL-triplet convention as the
   * site-wide Workspace.accentColor) — scoped ONLY to this page's own
   * view, so a manager can make "their" page feel distinct without
   * touching the site-wide accent everyone else sees. Settable by the
   * page's responsible person or the Owner.
   */
  accentColor?: string;
  /**
   * Optional dashboard cover photo for this desk (not a row attachment).
   * Stored in Supabase `row-files` under `{workspaceId}/covers/{pageId}/…`.
   */
  coverUrl?: string;
  coverPath?: string;
  columns: PageColumn[];
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  isDashboard?: boolean;
}

export interface RowAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  path: string;
  publicUrl: string;
  createdAt: number;
}

export interface PageRow {
  id: string;
  pageId: string;
  cells: Record<string, string | number | null>;
  /** Optional file list. Never stored inside cells. */
  attachments?: RowAttachment[];
  order: number;
  height?: number;
  createdAt: number;
  updatedAt: number;
  /**
   * Когда пустая строка-слот (`isBlankRow`) впервые получила значение. Слот
   * заводится заранее (Enter на последней строке, «Добавить строку»), и
   * `createdAt` у него — время слота, а не заказа: без этого поля заказ,
   * вписанный утром в слот, заведённый вчера, считался бы вчерашним
   * («Столы ОС»: сегодня / за месяц). Пишет `DataTable` при первом
   * заполнении; дата заказа = max(createdAt, filledAt).
   */
  filledAt?: number;
  /**
   * «Визитка клиента» — optional details that aren't table columns: how
   * many characters, how many minutes, free-form wishes. See utils/rowExtras.
   */
  extras?: {
    persons?: number | null;
    minutes?: number | null;
    note?: string | null;
    /** Ссылка на клиента (соцсеть/сайт) — открывается прямо из визитки. */
    link?: string | null;
    /**
     * Дедлайн сдачи (мс). Живёт в визитке, а не только в столбце: столбец
     * «Дедлайн» есть не у каждого стола, а срок терять нельзя.
     */
    deadline?: number | null;
  };
  /**
   * Заказ с «Заказов», из которого выросла строка. Метка постоянная, в
   * отличие от `highlight`: подсветку технарь снимает, а знать «это пришло
   * с биржи, а не заведено руками» нужно и через месяц.
   */
  orderId?: string;
  /**
   * Строка подсвечена как новая — ставится, когда заказ с «Заказов» сам
   * ложится в стол технаря. Снимает подсветку только сам технарь (чип
   * «N новых» в тулбаре или пункт в меню строки), поэтому заказ нельзя
   * пропустить, даже если он приехал, пока стол был закрыт.
   */
  highlight?: boolean;
}

/**
 * An independent inner tab inside a WorkspacePage — e.g. "Финка" can have
 * subpages "Январь", "Февраль", etc. Purely additive to the existing model:
 * the page's own original table/rows/columns are untouched and keep working
 * exactly as before; subpages are extra, optional, nested tables under it.
 * Access follows the parent page's allowedUsers — there's no separate
 * per-subpage permission list.
 */
export interface SubPage {
  id: string;
  pageId: string;
  workspaceId: string;
  name: string;
  color: string;
  icon: PageIconName;
  order: number;
  isArchived?: boolean;
  /** "YYYY-MM" — set on month tabs created by the month autopilot. */
  monthKey?: string;
  /** This tab keeps a hand-made row order — see DataTable.manualRowOrder. */
  rowOrder?: "manual";
  /**
   * When set, this subpage is a Personal Space monthly report — NOT an
   * ordinary shared subpage. It must never be visible to a regular page
   * viewer just because they can see the parent page; see
   * `canAccessSubPage` in firestore.rules and the personalOwnerUid /
   * personalAllowedUsers checks there.
   */
  personalOwnerUid?: string;
  personalAllowedUsers?: string[];
  columns: PageColumn[];
  createdAt: number;
  updatedAt: number;
  createdBy: string;
}
