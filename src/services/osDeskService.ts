import { getDoc, setDoc } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { generateId } from "@/utils/id";
import { ensureNewDeskAcl, stripUndefined, updatePageColumns, updatePageMainTab } from "@/services/pageService";
import { currentMonthKey, ensureMonthTab } from "@/services/monthTabService";
import { monthTabNameForKey } from "@/services/subPageService";
import { OS_DATES_COLUMN_KEY } from "@/utils/osDeskKeys";
import type { PageColumn, WorkspacePage } from "@/types";

/**
 * «Стол ОС» — личная таблица ОС.
 *
 * Своя функция, а не обычный стол: у технаря таблица про ВЫПОЛНЕНИЕ заказа
 * (статус, сумма, кто ОС), у ОС — про ПРОДАЖУ, и две суммы вместо одной
 * (цена и апсейл). Поэтому и набор столбцов фиксированный, и признак
 * `osDesk` — чтобы такой стол не попал ни в «Столы», ни на дашборд, ни в
 * «Технари», ни в месячные вкладки.
 *
 * Лежит всё равно в `pages`: движок таблицы, вкладки, файлы, визитка, права
 * на строки — всё это уже написано и проверено там, и второй такой же
 * механизм рядом разошёлся бы с первым за месяц.
 */

/** Столбцы стола ОС — ровно те, что просил Nurba, в его порядке. */
export const OS_DESK_COLUMNS: Array<Pick<PageColumn, "key" | "label" | "type" | "width">> = [
  { key: "client", label: "Имя", type: "text", width: 200 },
  // Когда заказ получен и когда выдан технарю (просьба Nurba 24.09.2026):
  // две крошечные строки, сразу за именем — видно всегда, места почти не
  // занимает. Ячейка пустая и только для чтения: рисует её стол сам
  // (utils/osDates.ts, `OsDatesCell`) по дате строки и `osIssuedAt`.
  { key: OS_DATES_COLUMN_KEY, label: "Даты", type: "text", width: 112 },
  { key: "phone", label: "Номер", type: "phone", width: 150 },
  { key: "price", label: "Цена", type: "currency", width: 180 },
  { key: "upsell", label: "Апсейл", type: "currency", width: 180 },
  // Касса: цена и апсейл за вычетом комиссии их способов оплаты (utils/payment).
  // Столбец только для чтения — его пишет стол ОС сам (useOsTotalsKeeper), и
  // именно эта сумма уезжает технарю как цена заказа.
  { key: "total", label: "Итого", type: "currency", width: 140 },
  // Статус заказа ведёт ОС и ведёт его ОТСЮДА: правка уезжает в строку
  // технаря (useOsStatusSync). Сам заказ по-прежнему считается по строке
  // технаря — «Технари», дашборд и оценки читают её, а не этот столбец.
  { key: "status", label: "Статус", type: "status", width: 150 },
  { key: "note", label: "Примечание", type: "text", width: 240 },
  // Ник ТЕХНАРЯ, а не «Ответственный»: столбцы «Ответственный» везде читаются
  // как ник ОС (osColumnsOf), и технарь оттуда попал бы в счётчики ОС.
  { key: "technician", label: "Технарь", type: "technician", width: 170 },
  { key: "link", label: "Ссылка", type: "url", width: 190 },
];

export { OS_DESK_KEYS, resolveOsDeskKeys, type OsDeskKeys } from "@/utils/osDeskKeys";

/**
 * Id выводится из uid, поэтому стол ОС у человека ровно один: повторный
 * `create` того же документа Firestore отклонит сам, без отдельного
 * документа-заявки, как у квоты Технаря.
 */
export function osDeskId(uid: string): string {
  return `osdesk_${uid}`;
}

export function isOsDeskId(pageId: string): boolean {
  return pageId.startsWith("osdesk_");
}

/**
 * Столбцы, которых нет у столов ОС, заведённых раньше: «Статус» (ставится
 * перед «Примечанием»), «Итого» (сразу после «Апсейла») и «Даты» (сразу за
 * именем; нет «Имени» — первым). Ячейки не
 * трогаются — у старых строк статус пустой, а «Итого» досчитает сам стол.
 * Возвращает null, если добавлять нечего (писать документ не нужно).
 */
export function missingOsDeskColumns(existingColumns: PageColumn[]): PageColumn[] | null {
  let cols = existingColumns;
  let changed = false;
  if (!cols.some((c) => c.type === "status")) {
    const noteIndex = cols.findIndex((c) => c.key === "note");
    const status: PageColumn = { id: generateId("col"), key: "status", label: "Статус", type: "status", width: 150, order: 0 };
    cols = noteIndex === -1 ? [...cols, status] : [...cols.slice(0, noteIndex), status, ...cols.slice(noteIndex)];
    changed = true;
  }
  if (!cols.some((c) => c.key === "total" || /^итог/i.test((c.label ?? "").trim()))) {
    const after = cols.findIndex((c) => c.key === "upsell");
    const total: PageColumn = { id: generateId("col"), key: "total", label: "Итого", type: "currency", width: 140, order: 0 };
    cols = after === -1 ? [...cols, total] : [...cols.slice(0, after + 1), total, ...cols.slice(after + 1)];
    changed = true;
  }
  // «Даты» (получен / выдан) — сразу за именем клиента.
  if (!cols.some((c) => c.key === OS_DATES_COLUMN_KEY)) {
    const after = cols.findIndex((c) => c.key === "client");
    const dates: PageColumn = { id: generateId("col"), key: OS_DATES_COLUMN_KEY, label: "Даты", type: "text", width: 112, order: 0 };
    cols = [...cols.slice(0, after + 1), dates, ...cols.slice(after + 1)];
    changed = true;
  }
  // «Цена» и «Апсейл» шире: в ячейке теперь ещё и способ оплаты («Lavatop
  // −8 %»), и в прежние 130 px он не помещался. Только нетронутую ширину —
  // растянутый руками столбец не трогаем.
  cols = cols.map((c) => {
    if ((c.key === "price" || c.key === "upsell") && c.width === 130) {
      changed = true;
      return { ...c, width: 180 };
    }
    return c;
  });
  return changed ? cols.map((c, i) => ({ ...c, order: i })) : null;
}

/** Дописать недостающие столбцы главной вкладке стола ОС. */
export async function ensureOsDeskColumns(workspaceId: string, pageId: string, existingColumns: PageColumn[]): Promise<PageColumn[]> {
  const next = missingOsDeskColumns(existingColumns);
  if (!next) return existingColumns;
  await updatePageColumns(workspaceId, pageId, next);
  return next;
}

export function findOsDeskOf(pages: WorkspacePage[], uid: string | null | undefined): WorkspacePage | null {
  if (!uid) return null;
  const id = osDeskId(uid);
  return pages.find((p) => p.id === id) ?? null;
}

interface EnsureOsDeskInput {
  workspaceId: string;
  uid: string;
  /** Имя стола — ник ОС или имя человека; видно только ему самому и Owner. */
  name: string;
}

/** Открывает стол ОС, создавая его при первом заходе. */
export async function ensureOsDesk({ workspaceId, uid, name }: EnsureOsDeskInput): Promise<WorkspacePage> {
  if (!db) throw new Error("Firebase не настроен");
  const id = osDeskId(uid);
  const ref = paths.page(workspaceId, id);
  const existing = await getDoc(ref);
  if (existing.exists()) return { id, ...existing.data() } as WorkspacePage;

  const now = Date.now();
  const page: WorkspacePage = {
    id,
    workspaceId,
    name: name.trim() ? `Стол ОС · ${name.trim()}` : "Стол ОС",
    icon: "ClipboardList",
    color: "189 100% 72%",
    order: 0,
    // Сам себе ответственный — именно это право и пускает его к строкам:
    // правила для строк смотрят canAccessPage/canEditPage, а роль ОС там ни
    // при чём. Список allowedUsers пустой: делиться столом ОС незачем.
    responsibleUserId: uid,
    allowedUsers: [uid],
    editableUsers: [],
    // Стол скрыт так же, как у технаря: кроме него самого и Owner, строк не
    // видит никто.
    hiddenByResponsible: true,
    osDesk: true,
    columns: OS_DESK_COLUMNS.map((c, i) => stripUndefined({ ...c, id: generateId("col"), order: i })),
    // Месячных вкладок у стола ОС нет (автопилот обслуживает только технарей),
    // поэтому открывается он на «Основной» — иначе у него не было бы ни одной
    // видимой вкладки.
    hideMainTab: false,
    createdAt: now,
    updatedAt: now,
    createdBy: uid,
  };
  await setDoc(ref, stripUndefined(page));
  await ensureNewDeskAcl(workspaceId, page);
  return page;
}

/**
 * Стол ОС живёт по месяцам, как стол технаря, но БЕЗ лишних сущностей.
 *
 * Просьба Nurba 23.09.2026: «у ОС стол стоит как Основная, а должно быть
 * название Сентябрь и автоматом в следующий месяц уходить — не создавай
 * новую страницу, только переименуй основную».
 *
 * Поэтому:
 * - первый раз просто НАЗЫВАЕМ главную вкладку текущим месяцем — ни стола,
 *   ни вкладки не заводим, заказы остаются на месте;
 * - в новом месяце заводим ВКЛАДКУ (не стол) и делаем её открываемой по
 *   умолчанию, а прошлый месяц остаётся под своим именем — туда можно
 *   вернуться, и его заказы не смешиваются с новыми.
 *
 * Зовётся из сессии хозяина стола (и Owner), один раз за заход.
 */
export async function ensureOsDeskMonth(page: WorkspacePage, uid: string): Promise<void> {
  const monthKey = currentMonthKey();
  if (!page.mainTabMonthKey) {
    await updatePageMainTab(page.workspaceId, page.id, { name: monthTabNameForKey(monthKey), monthKey });
    return;
  }
  // Месяц главной вкладки или последней заведённой совпал с нынешним —
  // делать нечего.
  if (page.mainTabMonthKey === monthKey || page.autoMonthKey === monthKey) return;
  await ensureMonthTab(page, monthKey, uid);
}
