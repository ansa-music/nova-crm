import { getDoc, setDoc } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { generateId } from "@/utils/id";
import { ensureNewDeskAcl, stripUndefined, updatePageColumns, updatePageMainTab } from "@/services/pageService";
import { ensureMonthTab } from "@/services/monthTabService";
import { currentPeriodKeyOf, periodSettingsOf } from "@/services/periodService";
import { periodLabel } from "@/utils/periods";
import { OS_DATES_COLUMN_KEY, type OsDeskKeys } from "@/utils/osDeskKeys";
import { findInProgressStatusOption, isApprovalStatusValue } from "@/utils/columnOptions";
import { mirrorAddressOf } from "@/utils/osDispatchPlan";
import { OS_LOST_FOR_KEY, OS_STATUS_SENT_KEY } from "@/utils/reservedCellKeys";
import {
  findTechTarget,
  mirrorRowId,
  pushOrderToTech,
  sbDeskRowExists,
  techTargetProblem,
  techUidByNick,
} from "@/services/rows/osOrderMirror";
import { personLabel } from "@/utils/peopleDesks";

/** Ширина «Дат»: без времени хватает 92 px (первая версия со временем была 112). */
const OS_DATES_COLUMN_WIDTH = 92;
const OS_DATES_COLUMN_WIDTH_V1 = 112;
/**
 * Ширина «Технаря»: в ячейке теперь бейдж технаря (аватар, ник) и чип
 * действия рядом («Отдать», «Не доехал») — в прежние 170 px они не влезали.
 */
const OS_TECH_COLUMN_WIDTH = 190;
const OS_TECH_COLUMN_WIDTH_V1 = 170;
import type { PageColumn, PageRow, StatusOption, WorkspaceMember, WorkspacePage } from "@/types";

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

/**
 * Столбцы стола ОС — те, что просил Nurba. Порядок с 24.09.2026: «Статус» и
 * «Технарь» сразу за «Датами» (жалоба «непонятно, кто технарь»): «Технарь»
 * стоял девятым из десяти, за 240-пиксельным «Примечанием», и на ноутбуке
 * 1440 px целиком уезжал за правый край — вместе с кнопкой выдачи.
 */
export const OS_DESK_COLUMNS: Array<Pick<PageColumn, "key" | "label" | "type" | "width">> = [
  { key: "client", label: "Имя", type: "text", width: 200 },
  // Когда заказ получен и когда выдан технарю (просьба Nurba 24.09.2026):
  // две крошечные строки, только дата, сразу за именем — видно всегда, места
  // почти не занимает. Сама ячейка пустая и закрыта: её рисует стол
  // (`OsDatesCell`), а даты лежат служебными ячейками строки (utils/osDates.ts).
  { key: OS_DATES_COLUMN_KEY, label: "Даты", type: "text", width: OS_DATES_COLUMN_WIDTH },
  // Статус заказа ведёт ОС и ведёт его ОТСЮДА: правка уезжает в строку
  // технаря (useOsDeskDispatch). Сам заказ по-прежнему считается по строке
  // технаря — «Технари», дашборд и оценки читают её, а не этот столбец.
  { key: "status", label: "Статус", type: "status", width: 150 },
  // Ник ТЕХНАРЯ, а не «Ответственный»: столбцы «Ответственный» везде читаются
  // как ник ОС (osColumnsOf), и технарь оттуда попал бы в счётчики ОС. Рядом
  // со статусом: от статуса зависит, выдан заказ или ещё нет.
  { key: "technician", label: "Технарь", type: "technician", width: OS_TECH_COLUMN_WIDTH },
  { key: "phone", label: "Номер", type: "phone", width: 150 },
  { key: "price", label: "Цена", type: "currency", width: 180 },
  { key: "upsell", label: "Апсейл", type: "currency", width: 180 },
  // Касса: цена и апсейл за вычетом комиссии их способов оплаты (utils/payment).
  // Столбец только для чтения — его пишет стол ОС сам (useOsTotalsKeeper), и
  // именно эта сумма уезжает технарю как цена заказа.
  { key: "total", label: "Итого", type: "currency", width: 140 },
  { key: "note", label: "Примечание", type: "text", width: 240 },
  { key: "link", label: "Ссылка", type: "url", width: 190 },
];

/**
 * Прежний порядок столбцов стола ОС (до 24.09.2026), ключ в ключ. Только стол
 * с РОВНО таким порядком переставляется на новый (`missingOsDeskColumns`):
 * стол, где ОС переставил или добавил столбцы сам, не трогаем.
 */
const OS_DESK_LEGACY_ORDER = ["client", OS_DATES_COLUMN_KEY, "phone", "price", "upsell", "total", "status", "note", "technician", "link"];
/** Новый порядок тех же ключей — из `OS_DESK_COLUMNS`. */
const OS_DESK_ORDER = OS_DESK_COLUMNS.map((c) => c.key);

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
 * Стол (и вкладка месяца) с прежним порядком столбцов ключ в ключ получает
 * новый порядок: «Статус» и «Технарь» сразу за «Датами». Любой другой
 * порядок — дело рук ОС, его не трогаем.
 * Порядок — тот, что ВИДЕН (как сортирует таблица: по `order`, при равенстве
 * по месту в массиве), а не порядок массива: перетаскивание и «сдвинуть
 * столбец» пишут только `order` (`applyColumnLayout`), массив остаётся
 * прежним, и перетащенный стол выглядел «нетронутым» — порядок ОС
 * сбрасывался на наш при следующем открытии.
 * Возвращает null, если добавлять нечего (писать документ не нужно).
 */
export function missingOsDeskColumns(existingColumns: PageColumn[]): PageColumn[] | null {
  let cols = columnsInDisplayOrder(existingColumns);
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
    const dates: PageColumn = { id: generateId("col"), key: OS_DATES_COLUMN_KEY, label: "Даты", type: "text", width: OS_DATES_COLUMN_WIDTH, order: 0 };
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
    // «Даты» стали без времени — нетронутый столбец сужаем.
    if (c.key === OS_DATES_COLUMN_KEY && c.width === OS_DATES_COLUMN_WIDTH_V1) {
      changed = true;
      return { ...c, width: OS_DATES_COLUMN_WIDTH };
    }
    // В «Технаре» теперь бейдж и чип рядом — нетронутый столбец шире.
    if (c.key === "technician" && c.type === "technician" && c.width === OS_TECH_COLUMN_WIDTH_V1) {
      changed = true;
      return { ...c, width: OS_TECH_COLUMN_WIDTH };
    }
    return c;
  });
  // Прежний порядок ключ в ключ — «Статус» и «Технарь» к «Датам». Порядок
  // решается ПОСЛЕ дописывания: старый стол без «Итого»/«Дат» после него как
  // раз приходит к прежнему полному набору.
  const keys = cols.map((c) => c.key);
  if (keys.length === OS_DESK_LEGACY_ORDER.length && keys.every((k, i) => k === OS_DESK_LEGACY_ORDER[i])) {
    const byKey = new Map(cols.map((c) => [c.key, c]));
    cols = OS_DESK_ORDER.map((k) => byKey.get(k)!);
    changed = true;
  }
  return changed ? cols.map((c, i) => ({ ...c, order: i })) : null;
}

/** Столбцы в порядке показа — как `compareColumnsBySchema` в DataTable. */
function columnsInDisplayOrder(columns: readonly PageColumn[]): PageColumn[] {
  const at = (c: PageColumn, i: number) => (typeof c.order === "number" && Number.isFinite(c.order) ? c.order : i);
  return columns
    .map((column, index) => ({ column, index }))
    .sort((a, b) => at(a.column, a.index) - at(b.column, b.index) || a.index - b.index)
    .map(({ column }) => column);
}

/** Отказ «Выдать заново»: заказ вернули технарю, его строка на месте. */
export const OS_RETURNED_REISSUE_ERROR =
  "Заказ вернули технарю на «Правке столов» — его строка осталась у него в столе, новая копия была бы дублем. Вернуть заказ под ОС может Owner: «Правка столов» → «Передать ОС»";

/**
 * Лежит ли ещё в столе технаря строка этого заказа, который Owner вернул
 * технарю («Правка столов» → «Вернуть»): `releaseDeskOrders` снимает с неё
 * метку ОС, но строку (и её id) оставляет. Ищем по ВСЕМ его столам и вкладкам
 * одним запросом: копию, заведённую ОС (`os_<источник>`), и — у источника
 * `adopt_…` — собственную строку технаря. Ошибка чтения — исключение: «не
 * узнали» не значит «строки нет».
 */
export async function returnedRowOnTechDesk(input: {
  workspaceId: string;
  row: Pick<PageRow, "id">;
  techUid: string;
  pages: readonly WorkspacePage[];
  /** Стол, куда собирались писать (на случай, если его нет в `pages`). */
  targetPageId?: string | null;
}): Promise<boolean> {
  const desks = input.pages
    .filter((p) => !p.osDesk && !p.isDashboard && p.responsibleUserId === input.techUid)
    .map((p) => p.id);
  if (input.targetPageId) desks.push(input.targetPageId);
  const ids = [mirrorRowId(input.row.id)];
  if (input.row.id.startsWith("adopt_") && input.row.id.length > "adopt_".length) {
    ids.push(input.row.id.slice("adopt_".length));
  }
  return sbDeskRowExists(input.workspaceId, desks, ids);
}

/**
 * Выдать (или обновить) заказ строки стола ОС её технарю сейчас — кнопкой, а
 * не проходом стола: карточка строки («Обновить у технаря», «Выдать заново»)
 * и тост «Не доехал» у заказа, копию которого удалили у технаря. Одна
 * функция на оба места, чтобы ручная выдача не разошлась с проходом.
 * Бросает ошибку с причиной, если отдать некому (нет аккаунта, стола, карты
 * столбцов), если заказ ещё на «Утверждении» (он технарю не уходит «ни сам,
 * ни кнопкой») и если заказ вернули технарю, а его строка у него на месте
 * (новая копия была бы дублем, а в той же вкладке — вечным отказом прав).
 */
export async function pushOsRowToTech(input: {
  workspaceId: string;
  osUid: string;
  osNickValue: string;
  row: PageRow;
  pageId: string;
  subPageId: string | null;
  keys: OsDeskKeys;
  /** Копия у технаря (`useMyOrderRows().bySource`), если заказ уже выдан. */
  mirror: PageRow | null;
  pages: readonly WorkspacePage[];
  members: readonly WorkspaceMember[];
  statusOptions: readonly StatusOption[];
}): Promise<{ techName: string; updated: boolean }> {
  const { row, keys, mirror } = input;
  const techNick = String(row.cells[keys.technician] ?? "").trim();
  const techUid = techUidByNick(input.members, techNick);
  const preferPage = mirror?.deskPageId ?? row.mirrorPageId;
  const problem = techTargetProblem([...input.pages], techUid, preferPage);
  const target = techUid ? findTechTarget([...input.pages], techUid, preferPage) : null;
  if (!target || !techUid) throw new Error(problem ?? "Не удалось определить стол технаря");
  const ownStatus = String(row.cells[keys.status] ?? "").trim();
  const status = ownStatus || (mirror?.statusKey ? String(mirror.cells[mirror.statusKey] ?? "").trim() : "");
  const pushStatus = status || findInProgressStatusOption([...input.statusOptions])?.value || "";
  const at = mirrorAddressOf(row, mirror);
  if (!at) {
    // Заказ ещё не у технаря. На «Утверждении» (пустой статус — тоже) он не
    // уходит ни проходом, ни кнопкой: сначала «Отдать».
    if (isApprovalStatusValue(ownStatus, input.statusOptions)) {
      throw new Error("Заказ на «Утверждении» — сначала «Отдать» в столбце «Технарь»");
    }
    // Связь оборвана (`osLostFor`): копию удалили — выдать заново можно; а
    // если Owner вернул заказ технарю, его строка лежит у него — не дублируем.
    if (String(row.cells[OS_LOST_FOR_KEY] ?? "").trim()) {
      let returned: boolean;
      try {
        returned = await returnedRowOnTechDesk({
          workspaceId: input.workspaceId,
          row,
          techUid,
          pages: input.pages,
          targetPageId: target.page.id,
        });
      } catch {
        throw new Error("Не удалось проверить стол технаря — заказ не выдан, повторите позже");
      }
      if (returned) throw new Error(OS_RETURNED_REISSUE_ERROR);
    }
  }
  await pushOrderToTech({
    workspaceId: input.workspaceId,
    osUid: input.osUid,
    osNickValue: input.osNickValue,
    source: row,
    srcPageId: input.pageId,
    srcTabId: input.subPageId,
    osColumns: { client: keys.client, phone: keys.phone, price: keys.price, upsell: keys.upsell, note: keys.note, link: keys.link },
    target,
    techUid,
    // Та же дата заказа, что у автопрохода: max(createdAt, filledAt). Слот
    // стола ОС заводят заранее и заполняют через дни — по одному createdAt
    // выданная заново копия легла бы у технаря днём заведения слота.
    dateMs: Math.max(row.createdAt || 0, row.filledAt || 0) || 0,
    // Заказ уже в столе технаря (выдан раньше или перенесён) — правим ту же
    // строку в ТОЙ ЖЕ вкладке, а не заводим рядом вторую (на переломе месяца
    // вкладка копии — не текущая).
    mirrorRowId: at?.rowId,
    mirrorTabId: at?.tabId,
    // Копия на руках — статус под ЕЁ ключом и её опорные поля (см. JSDoc
    // pushOrderToTech); ключ «Статуса» стола ОС — для переноса статуса базой.
    copy: mirror ?? undefined,
    osStatusKey: keys.status,
    status: pushStatus,
    // Ручная выдача — это и перевыдача после удаления копии: метку «копию
    // удалили» снимаем, синхронизированный статус запоминаем.
    sourceCells: { [OS_STATUS_SENT_KEY]: pushStatus, [OS_LOST_FOR_KEY]: "" },
  });
  const member = input.members.find((m) => m.uid === techUid);
  return { techName: personLabel(member) || "технарь", updated: Boolean(mirror) };
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
  const monthKey = currentPeriodKeyOf(page.workspaceId);
  if (!page.mainTabMonthKey) {
    await updatePageMainTab(page.workspaceId, page.id, { name: periodLabel(monthKey, periodSettingsOf(page.workspaceId)), monthKey });
    return;
  }
  // Месяц главной вкладки или последней заведённой совпал с нынешним —
  // делать нечего.
  if (page.mainTabMonthKey === monthKey || page.autoMonthKey === monthKey) return;
  await ensureMonthTab(page, monthKey, uid);
}
