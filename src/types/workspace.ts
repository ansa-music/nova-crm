import type { Role } from "@/types/role";
import type { StatusOption } from "@/types/page";
import type { TechLoadKind } from "@/types/deskLoad";
import type { OsPaySettings, PaymentMethod } from "@/types/payment";
import type { ScheduleSettings } from "@/types/scheduleSettings";

/**
 * An Owner-defined custom option field — the same idea as the built-in
 * "Статус"/"Ответственный" (one shared list, one badge+dropdown UI), but
 * for whatever the Owner wants to call it: "Приоритет", "Источник",
 * "Отдел", anything. A PageColumn of type "custom" points at one of these
 * via `customFieldId`; the field's own `options` list is what actually
 * populates the dropdown (see src/utils/columnOptions.ts).
 */
export interface CustomFieldDef {
  id: string;
  name: string;
  options: StatusOption[];
}

export type RowsBackend = "firestore" | "supabase";
/**
 * Начало переноса строк — СЕРВЕРНОЕ время (serverTimestamp): по нему правила
 * Firestore держат 15-минутный замок записи, и часы Owner тут не годятся.
 * Старые значения могли быть числом. Читать — `migrationStartMillis()`.
 */
export type RowsMigrationStamp = number | { toMillis(): number } | null;

export interface Workspace {
  id: string;
  name: string;
  icon: string;
  color: string;
  ownerId: string;
  createdAt: number;
  /**
   * Shared, site-wide list of "Ответственный" options. Unlike a status
   * column's `statusOptions` (per-column, set once at creation), this one
   * list is used by EVERY "responsible"-type column across every page on
   * the whole site — add a name here and it's instantly available
   * everywhere. Only the Owner may write it (enforced by the same
   * `allow update: if isOwner(workspaceId)` rule as the rest of this doc);
   * managed from Настройки → Workspace → «Ответственные».
   */
  responsibleOptions?: StatusOption[];
  /**
   * Ники технарей — ОТДЕЛЬНЫЙ от «Ответственного» список, по той же модели,
   * что ники ОС (`value` — личность ника, `label` — как показать, `inactive`
   * — ушёл). В «Ответственный» их класть нельзя: любой столбец «Ответственный»
   * считается ОС-столбцом (`osColumnsOf`), и технари посчитались бы как ОС в
   * заказах, оценках и на дашборде. Пишут Owner и Тимлид (правило документа
   * workspace), ники не переименовываются и не удаляются — только
   * «неактуальные».
   */
  techNickOptions?: StatusOption[];
  /**
   * «Обновить сайт у всех» (кнопка Owner): счётчик растёт на 1 при каждом
   * нажатии, и каждая открытая вкладка, загруженная при меньшем значении,
   * перезагружается (`useAppUpdateCheck`). Счётчик, а не время: часы у всех
   * разные.
   */
  reloadEpoch?: number;
  /**
   * Где живут строки таблиц столов: `"supabase"` — Postgres (`desk_rows`,
   * без суточной квоты), иначе Firestore. Переключает только Owner в
   * «Настройки → Строки таблиц» — вместе с переносом строк туда или обратно
   * (`rowsMigrationService`). Нет поля = Firestore.
   */
  rowsBackend?: RowsBackend;
  /**
   * Заказы заводит ТОЛЬКО ОС со своего стола (просьба Nurba 23.09.2026):
   * у технаря в его столе пропадают «Быстрый заказ» и «Добавить строку», а
   * строки-заказы он и так не правит (это держат политики Supabase).
   * Включает Owner в «Настройки → Строки таблиц».
   */
  osManagedDesks?: boolean;
  /**
   * Способы оплаты заказов ОС с комиссией — «Настройки → Касса», правит
   * только Owner (правило: Тимлиду поле закрыто). Нет поля — способы по
   * умолчанию (`DEFAULT_PAYMENT_METHODS` в utils/payment.ts).
   */
  paymentMethods?: PaymentMethod[];
  /**
   * Премии технарям за места по сумме «Готово» за месяц: [1-е, 2-е, 3-е].
   * Нет поля — 100 000 / 50 000 / 50 000 (просьба Nurba). Правит Owner.
   */
  techBonuses?: number[];
  /** Зарплатная система ОС на «ABS»: % от апсейла, доплата за топ KPI, пороги. Правит Owner. */
  osPay?: OsPaySettings;
  /**
   * «Настройка графика» (Owner): кто ещё правит график, смены команды, норма
   * на смене, кого не показывать. Тимлиду поле закрыто правилом workspace.
   */
  scheduleSettings?: ScheduleSettings;
  /**
   * Идёт перенос строк: пока стоит флаг, строки нигде не правятся — иначе
   * правка, сделанная во время копирования, осталась бы в старом хранилище.
   */
  rowsMigrationAt?: RowsMigrationStamp;
  /**
   * Ники раздела «Другие» на «Команде» — для тех, кто не технарь и не ОС:
   * Owner, Admin, Тимлид без второй роли, Viewer. Своя модель та же, что у
   * `techNickOptions`, и тоже ОТДЕЛЬНЫЙ список: с никами технарей и ОС он не
   * смешивается. Пишут Owner и Тимлид.
   */
  otherNickOptions?: StatusOption[];
  /**
   * Same idea, for "Статус" columns: ONE shared, site-wide list instead of
   * each column keeping its own. Every "Статус" column on every page/
   * subpage shows this list; managed from Настройки → Workspace →
   * «Статусы», Owner-only.
   */
  statusOptions?: StatusOption[];
  /**
   * Optional desk marker (--desk-accent), an HSL triplet. Chrome stays
   * neon cyan from index.css; AccentColorSync never writes --primary/--ring.
   */
  accentColor?: string;
  /**
   * Which page's rows feed the Dashboard's revenue chart / status
   * breakdown. Before this existed the Dashboard guessed by matching page
   * names containing "клиент"/"проект", which broke the moment a page was
   * renamed to anything else — Owner now picks explicitly from Настройки
   * or right on the Dashboard itself.
   */
  dashboardClientsPageId?: string;
  dashboardProjectsPageId?: string;
  /** Owner-defined custom option fields — see CustomFieldDef above. */
  customFields?: CustomFieldDef[];
  /**
   * When true, anyone who opens this workspace's /join/:id link becomes an
   * active `manager` member immediately — no "Запросить доступ" step, no
   * Owner approval click. Off (undefined/false) by default, which keeps the
   * existing join-request-and-approve flow exactly as before. Enforced by a
   * dedicated Firestore rule (see `members/{memberId}` create rules) that
   * hard-locks the self-created member's role to 'manager' and status to
   * 'active' — this flag can never be used to self-grant admin/owner.
   */
  autoApproveJoins?: boolean;
  /**
   * Set once the «Заморозка» status has been added to `statusOptions`
   * automatically — so an Owner who later deletes it on purpose doesn't
   * get it re-added on the next load.
   */
  freezeStatusSeeded?: boolean;
  /**
   * Owner's explicit mapping of status option value → how it counts on
   * «Технари». A status missing here falls back to its label
   * (autoTechLoadKind in src/utils/techLoad.ts).
   */
  techLoadStatusKinds?: Record<string, TechLoadKind>;
  /**
   * 2 = `techLoadStatusKinds` holds only the Owner's deliberate choices.
   * Older maps froze every status's automatic kind at save time — back when
   * «Ждём оплату» still counted as «Занят» — see effectiveTechLoadKinds.
   */
  techLoadStatusKindsVersion?: number;
}

export type MemberStatus = "active" | "invited";

export interface WorkspaceMember {
  uid: string;
  email: string;
  name: string;
  nickname?: string;
  photoURL?: string | null;
  role: Role;
  /**
   * Add-on roles on top of `role` (EXTRA_ROLES: Технарь, ОС) — e.g. a Тимлид
   * who is also a Технарь opens desk tables like any Технарь. Written only by
   * the Owner or a Тимлид, and a Тимлид never on their own doc.
   */
  extraRoles?: Role[];
  status: MemberStatus;
  invitedAt: number;
  invitedBy: string;
  joinedAt?: number;
  /** Present only while status === 'invited'; used as the accept-invite token. */
  inviteToken?: string;
  /** Self-reported heartbeat timestamp, refreshed periodically while the app is open. Drives the online/away/offline indicator. */
  lastActiveAt?: number;
  /**
   * Purely personal, client-display preference: page ids this member has
   * chosen to hide from their OWN sidebar. Never affects anyone else's
   * access or visibility — an Owner still has full real access to a page
   * they've hidden for themselves, it's just tucked away behind "Показать
   * скрытые" in the sidebar. Self-writable (see the member self-service
   * rule in firestore.rules) since it carries no security weight.
   */
  hiddenPageIds?: string[];
  /**
   * Optional simulated role for testing/UX purposes ONLY — see
   * "Переключение режима привилегий". This is a self-writable, client-
   * visible field and MUST NEVER be trusted by Firestore Rules or any
   * server-side permission check: those always read `role` (above), which
   * only the Owner can change. `activeRole` only affects what the CLIENT
   * shows/attempts; the real Firestore-level access for this account is
   * always governed by `role`. Firestore Rules additionally cap which
   * values a member may set here to those their real `role` is allowed to
   * simulate (Owner: any; Admin: admin/manager/viewer; Manager/Viewer: not
   * allowed to set this field at all) — see the self-service member update
   * rule. Absent/null means "not simulating — use my real role".
   */
  activeRole?: Role | null;
  /**
   * ОС nick, given by a Тимлид (or the Owner) — never self-writable. It lives
   * in the shared «Ответственный» list as the option `osNickValue`, so a
   * Технарь picks it in the order's ОС column; the ОС rates Технари by it.
   * The option's label is the source of truth for display (Owner may rename
   * it in Настройки); `osNick` is the label as last saved.
   */
  osNick?: string;
  osNickValue?: string;
  /**
   * Ник технаря — как у ОС, но из списка `workspace.techNickOptions`. Ставит
   * его Тимлид или Owner (на «Команде» или при одобрении
   * заявки), сам технарь — никогда. С ником технарь РАБОТАЕТ под ним: его
   * показывают так везде (`displayNameOf`/`personLabel` берут `techNick`
   * первым). `techNick` — подпись ника на момент закрепления (ники не
   * переименовываются, так что она и есть текущая).
   */
  techNick?: string;
  techNickValue?: string;
  /**
   * Ник из раздела «Другие» (`workspace.otherNickOptions`) — у Owner, Admin,
   * Тимлида без второй роли, Viewer. Показывается так же, как ник технаря
   * (`displayNameOf`/`personLabel`), ставит только руководство; ник Owner —
   * только сам Owner (Тимлид записи об Owner не правит).
   */
  otherNick?: string;
  otherNickValue?: string;
}

export type JoinRequestStatus = "pending" | "approved" | "rejected";

/**
 * Someone who followed a workspace's shareable join link and asked to be let
 * in, before an Owner has approved them as an actual member. Anyone signed
 * in may create their own request doc; only the workspace Owner can read the
 * list, approve (which creates a real WorkspaceMember), or reject it.
 */
export interface JoinRequest {
  id: string;
  uid: string;
  email: string;
  name: string;
  photoURL?: string | null;
  workspaceId: string;
  status: JoinRequestStatus;
  requestedAt: number;
  /**
   * Кем человек просится: Технарь или ОС. Новый пользователь приходит БЕЗ
   * роли — роли «никто» у участника не бывает (Viewer — полноправный
   * участник), поэтому до одобрения он просто не участник, а его выбор
   * лежит здесь. Тимлид или выше одобряет как есть или меняет роль и ник.
   */
  requestedRole?: JoinRequestRole;
  /** Ник, под которым человек уже работал (если есть), — как он его написал. */
  requestedNick?: string;
  /** Что в итоге выдали — для истории и для экрана самого человека. */
  approvedRole?: Role;
  approvedNick?: string | null;
  resolvedAt?: number;
  resolvedBy?: string;
}

/** Роли, которые можно запросить при входе. */
export type JoinRequestRole = "manager" | "os";
