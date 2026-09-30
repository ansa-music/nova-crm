import type { PageColumn, PageRow, WorkspaceMember, WorkspacePage } from "@/types";
import { deskHref, deskRowHref } from "@/utils/deskLinks";
import { personLabel } from "@/utils/peopleDesks";

/**
 * Кнопка «открыть стол» у ОС и технаря в ячейках таблиц (просьба Nurba
 * 30.09.2026: «в таблице над технарём кнопка, которая откроет его стол, и с ОС
 * также — везде, во всех вкладках»). Здесь только чистая развязка «ник → чей
 * стол → адрес»: её читают таблица стола (`DataTable`), «Общая таблица» и
 * карточка строки стола ОС.
 *
 * Стол, который зритель открыть не может, в индекс не попадает: кнопка,
 * ведущая на «Доступ ограничен», хуже, чем её отсутствие.
 */

export interface PersonDeskTarget {
  uid: string;
  label: string;
  /** Стол человека (у ОС — `osdesk_{uid}`). */
  pageId: string;
}

export interface PersonDeskIndex {
  /** Значение ника ОС (`osNickValue`) → его стол ОС. */
  osByNick: ReadonlyMap<string, PersonDeskTarget>;
  /** Значение ника технаря (`techNickValue`, живой аккаунт) → его стол. */
  techByNick: ReadonlyMap<string, PersonDeskTarget>;
  /** uid → стол технаря / стол ОС (для «Общей таблицы», где известен uid). */
  techByUid: ReadonlyMap<string, PersonDeskTarget>;
  osByUid: ReadonlyMap<string, PersonDeskTarget>;
  /** Какие столы зритель может открыть (для ссылок прямо на строку). */
  openable: ReadonlySet<string>;
  /** Подпись для memo строк таблицы. */
  signature: string;
}

export interface DeskLink {
  href: string;
  label: string;
}

type MemberLike = Pick<
  WorkspaceMember,
  "uid" | "status" | "osNickValue" | "techNickValue" | "name" | "nickname" | "techNick" | "otherNick" | "osNick" | "role" | "extraRoles"
>;
type PageLike = Pick<
  WorkspacePage,
  "id" | "name" | "responsibleUserId" | "osDesk" | "inactive" | "autoMonthKey" | "technicianDesk" | "isDashboard"
>;

function techDeskRank(p: PageLike): number {
  return p.autoMonthKey || p.technicianDesk ? 0 : 1;
}

export function buildPersonDeskIndex<P extends PageLike>({
  members,
  pages,
  osDesks,
  canAccess,
}: {
  members: readonly MemberLike[];
  pages: readonly P[];
  osDesks: readonly P[];
  canAccess: (page: P) => boolean;
}): PersonDeskIndex {
  const openable = new Set<string>();
  const osDeskById = new Map<string, P>();
  for (const p of osDesks) {
    if (!canAccess(p)) continue;
    osDeskById.set(p.id, p);
    openable.add(p.id);
  }
  // Стол технаря: живой, не стол ОС и не дашборд; месячный — первым.
  const techDeskOf = new Map<string, P>();
  const sorted = [...pages]
    .filter((p) => !p.osDesk && !p.isDashboard && !p.inactive && p.responsibleUserId)
    .sort((a, b) => techDeskRank(a) - techDeskRank(b) || (a.name ?? "").localeCompare(b.name ?? "", "ru"));
  for (const p of pages) if (!p.osDesk && canAccess(p)) openable.add(p.id);
  for (const p of sorted) {
    const uid = p.responsibleUserId as string;
    if (techDeskOf.has(uid) || !canAccess(p)) continue;
    techDeskOf.set(uid, p);
  }

  const osByNick = new Map<string, PersonDeskTarget>();
  const techByNick = new Map<string, PersonDeskTarget>();
  const techByUid = new Map<string, PersonDeskTarget>();
  const osByUid = new Map<string, PersonDeskTarget>();
  const sig: string[] = [];
  for (const m of members) {
    if (!m.uid || m.status !== "active") continue;
    const label = personLabel(m) || "человек";
    const osDesk = osDeskById.get(`osdesk_${m.uid}`);
    if (osDesk) {
      const target = { uid: m.uid, label, pageId: osDesk.id };
      osByUid.set(m.uid, target);
      if (m.osNickValue && !osByNick.has(m.osNickValue)) osByNick.set(m.osNickValue, target);
      sig.push(`o:${m.uid}:${m.osNickValue ?? ""}:${label}`);
    }
    const techDesk = techDeskOf.get(m.uid);
    if (techDesk) {
      const target = { uid: m.uid, label, pageId: techDesk.id };
      techByUid.set(m.uid, target);
      if (m.techNickValue && !techByNick.has(m.techNickValue)) techByNick.set(m.techNickValue, target);
      sig.push(`t:${m.uid}:${m.techNickValue ?? ""}:${techDesk.id}:${label}`);
    }
  }
  sig.sort();
  return { osByNick, techByNick, techByUid, osByUid, openable, signature: `${sig.join("|")}#${[...openable].sort().join(",")}` };
}

function strOf(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

/** Ссылка на стол ОС: строка-источник, если её ведёт он и она нам открыта, иначе его стол. */
export function osDeskLink(
  index: PersonDeskIndex,
  target: PersonDeskTarget,
  row: Pick<PageRow, "osUid" | "srcPageId" | "srcTabId" | "srcRowId"> | null,
  currentPageId?: string | null
): DeskLink | null {
  const label = `Открыть стол ОС ${target.label}`;
  if (row && row.osUid === target.uid && row.srcPageId && row.srcRowId && index.openable.has(row.srcPageId)) {
    if (row.srcPageId === currentPageId) return null;
    return { href: deskRowHref(row.srcPageId, row.srcTabId ?? undefined, row.srcRowId), label };
  }
  if (target.pageId === currentPageId) return null;
  return { href: deskHref(target.pageId), label };
}

/** Ссылка на стол технаря: копия заказа по адресу `mirror*`, если открыта, иначе его стол. */
export function techDeskLink(
  index: PersonDeskIndex,
  target: PersonDeskTarget,
  row: Pick<PageRow, "mirrorPageId" | "mirrorTabId" | "mirrorRowId"> | null,
  currentPageId?: string | null
): DeskLink | null {
  const label = `Открыть стол технаря ${target.label}`;
  if (row?.mirrorPageId && row.mirrorRowId && index.openable.has(row.mirrorPageId)) {
    if (row.mirrorPageId === currentPageId) return null;
    return { href: deskRowHref(row.mirrorPageId, row.mirrorTabId ?? undefined, row.mirrorRowId), label };
  }
  if (target.pageId === currentPageId) return null;
  return { href: deskHref(target.pageId), label };
}

/**
 * Ячейка таблицы → ссылка на стол человека. Только столбцы «Ответственный»
 * (ник ОС) и «Технарь» (ник технаря); пустое значение, неизвестный ник,
 * закрытый стол и текущий стол — `null`.
 */
export function deskLinkForCell(
  index: PersonDeskIndex,
  row: PageRow,
  column: Pick<PageColumn, "type">,
  value: unknown,
  currentPageId?: string | null
): DeskLink | null {
  const v = strOf(value);
  if (!v) return null;
  if (column.type === "responsible") {
    const target = index.osByNick.get(v);
    return target ? osDeskLink(index, target, row, currentPageId) : null;
  }
  if (column.type === "technician") {
    const target = index.techByNick.get(v);
    return target ? techDeskLink(index, target, row, currentPageId) : null;
  }
  return null;
}
