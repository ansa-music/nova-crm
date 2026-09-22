import { getDoc, setDoc } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { generateId } from "@/utils/id";
import { stripUndefined } from "@/services/pageService";
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
  { key: "phone", label: "Номер", type: "phone", width: 150 },
  { key: "price", label: "Цена", type: "currency", width: 130 },
  { key: "upsell", label: "Апсейл", type: "currency", width: 130 },
  { key: "note", label: "Примечание", type: "text", width: 240 },
  // Ник ТЕХНАРЯ, а не «Ответственный»: столбцы «Ответственный» везде читаются
  // как ник ОС (osColumnsOf), и технарь оттуда попал бы в счётчики ОС.
  { key: "technician", label: "Технарь", type: "technician", width: 170 },
  { key: "link", label: "Ссылка", type: "url", width: 190 },
];

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
  return page;
}
