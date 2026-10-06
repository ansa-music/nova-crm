import { useSyncExternalStore } from "react";
import { currentSiteConfig, subscribeSiteConfig } from "@/config/siteTerms";
import { useWorkspaceStore } from "@/store/workspaceStore";
import type { CustomFieldDef, StatusOption, Workspace } from "@/types";
import type { TechLoadKind } from "@/types/deskLoad";
import type { Role } from "@/types/role";
import type { SiteConfig, SiteDeskTemplate } from "@/types/siteConfig";

/**
 * Воркспейс «NOVA Studio» (просьба Nurba 06.10.2026): маленькая команда, которая
 * пишет рефераты, курсовые, презентации и т. п. Всё особое поведение включает
 * `workspace.site.profile === "studio"`, вид — `workspace.site.theme.fx ===
 * "cosmos"`. Нет поля — обычная Nova, другие компании ничего не замечают.
 *
 * ДВА вида проверки:
 * - `useStudioMode()` / `studioMode()` — живое хранилище Конструктора, ВКЛЮЧАЯ
 *   несохранённый черновик (предпросмотр). Годится ТОЛЬКО для вида: подписи,
 *   скрытые кнопки, списки ролей.
 * - `useStudioSaved()` / `studioSavedFor(id)` — СОХРАНЁННЫЙ документ
 *   workspace. Всё, что ПИШЕТ (столы, доступ к Telegram, поля заказа), — только
 *   по нему: черновик JSON в чужой компании не должен ничего записать.
 */

// ---------------------------------------------------------------------
// Признак.
// ---------------------------------------------------------------------

export function isStudioSite(site: SiteConfig | null | undefined): boolean {
  return site?.profile === "studio";
}

/** По документу workspace — для экранов, где он не активный (заявка на вход). */
export function isStudioWorkspace(workspace: { site?: SiteConfig } | null | undefined): boolean {
  return isStudioSite(workspace?.site);
}

const studioSnapshot = (): boolean => isStudioSite(currentSiteConfig());

/** Активный workspace — студия (с черновиком; только для вида). Перерисовка — лишь когда флаг сменился. */
export function useStudioMode(): boolean {
  return useSyncExternalStore(subscribeSiteConfig, studioSnapshot, studioSnapshot);
}

/** Активный workspace — студия (с черновиком; только для вида), вне React. */
export function studioMode(): boolean {
  return studioSnapshot();
}

/** Сохранённый флаг активного workspace — для всего, что пишет. */
export function useStudioSaved(): boolean {
  return useWorkspaceStore((s) => isStudioSite(s.workspaces.find((w) => w.id === s.activeWorkspaceId)?.site));
}

/** Сохранённый флаг workspace по id — для сервисов, которые пишут. */
export function studioSavedFor(workspaceId: string | null | undefined): boolean {
  if (!workspaceId) return false;
  return isStudioSite(useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId)?.site);
}

export function isCosmosSite(site: SiteConfig | null | undefined): boolean {
  return site?.theme?.fx === "cosmos";
}

/** Какие роли можно выдавать в студии (Owner остаётся как есть). */
export const STUDIO_ASSIGNABLE_ROLES: readonly Role[] = ["manager"];

/** Детерминированный id: повторная попытка создания попадает в тот же workspace. */
export function studioWorkspaceId(uid: string): string {
  return `ws_${uid}_novastudio`;
}

export const STUDIO_NAME = "NOVA Studio";

// ---------------------------------------------------------------------
// Пресет.
// ---------------------------------------------------------------------

/** Свои поля: тип работы и банк оплаты (только Казахстан, без процентов). */
export const STUDIO_WORK_TYPE_FIELD_ID = "work_type";
export const STUDIO_PAY_BANK_FIELD_ID = "pay_bank";

export const STUDIO_CUSTOM_FIELDS: CustomFieldDef[] = [
  {
    id: STUDIO_WORK_TYPE_FIELD_ID,
    name: "Тип работы",
    options: [
      { value: "referat", label: "Реферат", color: "217 80% 64%" },
      { value: "kursovaya", label: "Курсовая", color: "190 75% 55%" },
      { value: "diplom", label: "Дипломная", color: "160 55% 50%" },
      { value: "presentation", label: "Презентация", color: "330 70% 66%" },
      { value: "essay", label: "Эссе", color: "200 40% 62%" },
      { value: "report", label: "Доклад", color: "120 40% 55%" },
      { value: "practice", label: "Отчёт по практике", color: "250 45% 70%" },
      { value: "control", label: "Контрольная", color: "180 35% 55%" },
      { value: "article", label: "Статья", color: "95 45% 52%" },
      { value: "other", label: "Другое", color: "240 5% 62%" },
    ],
  },
  {
    id: STUDIO_PAY_BANK_FIELD_ID,
    name: "Оплата",
    options: [
      { value: "kaspi", label: "Kaspi", color: "0 80% 60%" },
      { value: "halyk", label: "Halyk", color: "150 60% 42%" },
      { value: "freedom", label: "Freedom", color: "95 55% 48%" },
      { value: "jusan", label: "Jusan", color: "24 90% 58%" },
      { value: "bcc", label: "BCC", color: "205 70% 55%" },
      { value: "forte", label: "Forte", color: "330 55% 55%" },
      { value: "cash", label: "Наличные", color: "45 70% 55%" },
    ],
  },
];

/**
 * Статусы. Value — стандартные там, где они есть (`new`, `in_progress`, `done`,
 * `cancelled`). «Утверждение темы» — `approval`: как и «Утверждение» в Nova, оно
 * человека НЕ занимает (это правило движка, картой не меняется). «Готово»
 * обязано содержать «готов».
 */
export const STUDIO_STATUS_OPTIONS: StatusOption[] = [
  { value: "new", label: "Новый", color: "217 91% 60%" },
  { value: "approval", label: "Утверждение темы", color: "40 30% 62%" },
  { value: "in_progress", label: "В работе", color: "38 92% 50%" },
  { value: "rework", label: "Правки", color: "12 85% 62%" },
  { value: "payment", label: "Ждём оплату", color: "190 80% 50%" },
  { value: "done", label: "Готово", color: "142 71% 45%" },
  { value: "freeze", label: "Заморозка", color: "205 15% 60%" },
  { value: "cancelled", label: "Отмена", color: "240 4% 60%" },
];

/**
 * Кто занят: «Новый», «В работе» и «Правки» — занят (работа идёт), «Ждём оплату»
 * — ждёт денег, «Готово»/«Отмена» — свободен. В студии отклик на «Рандоме»
 * открыт всем (claimScope "all"), так что занятость не мешает откликаться — она
 * решает только режим «Свободные».
 */
export const STUDIO_TECH_LOAD_KINDS: Record<string, TechLoadKind> = {
  new: "busy",
  in_progress: "busy",
  rework: "busy",
  payment: "payment",
  done: "free",
  freeze: "freeze",
  cancelled: "free",
};

/**
 * Шаблон стола. Порядок важен:
 * - первый столбец «Клиент» закреплён и при первом заполнении сам ставит сегодня в «Дату заказа»;
 * - «Телефон / Telegram» узнаётся заездом заказа с «Рандома» по «тел»;
 * - первая дата — дата заказа (дашборд, «Заказы по дням»), «Дедлайн» узнаётся по названию;
 * - первый `currency` — сумма (касса); «Предоплата» — `number`, иначе удвоила бы итоги шапки;
 * - «Оригинальность» — текст (у чисел внизу считалась бы СУММА процентов);
 * - столбца `responsible` нет: любой такой столбец Nova считает столбцом ОС.
 */
export const STUDIO_DESK_COLUMNS: SiteDeskTemplate["columns"] = [
  { key: "client", label: "Клиент", type: "text", width: 180 },
  { key: "contact", label: "Телефон / Telegram", type: "text", width: 160 },
  { key: "orderDate", label: "Дата заказа", type: "date", width: 120 },
  { key: "workType", label: "Тип работы", type: "custom", width: 150, customFieldId: STUDIO_WORK_TYPE_FIELD_ID },
  { key: "topic", label: "Тема", type: "text", width: 240 },
  { key: "subject", label: "Предмет", type: "text", width: 140 },
  { key: "volume", label: "Объём (стр./слайдов)", type: "number", width: 120 },
  { key: "deadline", label: "Дедлайн", type: "date", width: 120 },
  { key: "status", label: "Статус", type: "status", width: 150 },
  { key: "amount", label: "Сумма", type: "currency", width: 120 },
  { key: "prepaid", label: "Предоплата", type: "number", width: 120 },
  { key: "payBank", label: "Оплата", type: "custom", width: 120, customFieldId: STUDIO_PAY_BANK_FIELD_ID },
  { key: "originality", label: "Оригинальность", type: "text", width: 120 },
  { key: "files", label: "Файлы / ссылка", type: "url", width: 160 },
  { key: "note", label: "Комментарий", type: "text", width: 220 },
];

/**
 * Главный цвет — оранжевый NOVA Studio, чуть сдвинутый от красного: #FF5A2A
 * (14°) стоял вплотную к `--destructive` (8°). Не фиолет (метка заказа с биржи)
 * и не янтарь (`--warning` 42°, новый заказ). Под «космосом» `--destructive`
 * ещё и уводится к 352°.
 */
export const STUDIO_PRIMARY_HSL = "20 100% 60%";

export const STUDIO_SITE: SiteConfig = {
  profile: "studio",
  brand: { name: STUDIO_NAME, mark: "NS" },
  theme: { primary: STUDIO_PRIMARY_HSL, fx: "cosmos" },
  terms: {
    technician: { one: "Менеджер", many: "Менеджеры" },
    studio: { one: STUDIO_NAME, many: STUDIO_NAME },
  },
  roles: { manager: "Менеджер" },
  nav: {
    labels: { orders: "Рандом", dashboard: "Дашборд" },
    hidden: ["leads", "big-orders", "desk-editing", "team"],
    // Owner своего стола не держит («Рандом» не отдаёт заказы отошедшему Owner) — дом на «Столах».
    home: { owner: "/desks" },
  },
  modules: {
    osDesk: false,
    grok: false,
    reports: false,
    technicians: false,
    schedule: false,
    chat: false,
    announcements: false,
    prompts: false,
    people: false,
  },
  deskTemplate: { columns: STUDIO_DESK_COLUMNS },
};

/**
 * Настройки нового workspace студии (кроме управляющих полей). Пишутся в
 * документ при создании; первая сессия Owner переносит их в Supabase вместе с
 * остальными настройками, как у любой новой компании.
 */
export const STUDIO_SETTINGS = {
  site: STUDIO_SITE,
  statusOptions: STUDIO_STATUS_OPTIONS,
  customFields: STUDIO_CUSTOM_FIELDS,
  techLoadStatusKinds: STUDIO_TECH_LOAD_KINDS,
  techLoadStatusKindsVersion: 2,
  /** Без премий за места (просьба: «проценты и т. п. не учитывать»). */
  techBonuses: [0, 0, 0],
  /** «Заморозка» уже в списке — Owner-сессия её не дописывает. */
  freezeStatusSeeded: true,
  /** Целые месяцы; незавершённые заказы сами переезжают в новый месяц. */
  periods: { splitDay: 15, from: "", until: "", autoCarry: true },
} satisfies Partial<Workspace>;
