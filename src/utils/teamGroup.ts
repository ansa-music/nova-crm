import type { NickKind } from "@/services/memberService";
import { memberHasRole, type Role, type WorkspaceMember } from "@/types";

/**
 * Раздел «Команды», в котором стоит человек. Ровно один: у кого роль
 * Технаря (основная или вторая) — «Технари», у кого ОС — «ОС», остальные —
 * «Другие». Owner и Admin ВСЕГДА в «Других», даже с второй ролью Технаря:
 * так просил Nurba — технари это те, кого руководство ведёт как технарей.
 *
 * Модуль намеренно не импортирует сервисы (только типы): им пользуется
 * `displayName.ts`, а сервис участников сам импортирует `displayName.ts`.
 */
export type TeamGroup = "tech" | "os" | "other";

export const TEAM_GROUPS: TeamGroup[] = ["tech", "os", "other"];

export const TEAM_GROUP_LABEL: Record<TeamGroup, string> = {
  tech: "Технари",
  os: "ОС",
  other: "Другие",
};

type RoleHolder = { role: Role; extraRoles?: readonly Role[] | null };

export function teamGroupOf(member: RoleHolder): TeamGroup {
  if (member.role === "owner" || member.role === "admin") return "other";
  if (memberHasRole(member, "manager")) return "tech";
  if (memberHasRole(member, "os")) return "os";
  return "other";
}

/**
 * Работает ли человек за столом технаря: роль Технаря (основная или вторая)
 * или Owner — то же правило, что `worksAsTechnician` в `peopleDesks.ts`
 * (тот модуль импортирует этот, поэтому правило повторено здесь).
 */
export function worksAtTechDesk(member: RoleHolder): boolean {
  return member.role === "owner" || memberHasRole(member, "manager");
}

/**
 * Технарь, который стоит в ДРУГОМ разделе (Owner, Admin + Технарь). Раздел
 * у него «Другие», но он и технарь: в разделе «Технари» он тоже показан (со
 * своим ником технаря), и ник технаря у него — не «не по роли».
 */
export function alsoInTechGroup(member: RoleHolder): boolean {
  return teamGroupOf(member) !== "tech" && worksAtTechDesk(member);
}

/** Ник, который положен разделу: у каждого раздела свой список. */
export const GROUP_NICK_KIND: Record<TeamGroup, NickKind> = {
  tech: "tech",
  os: "os",
  other: "other",
};

const NICK_VALUE_FIELD: Record<NickKind, "osNickValue" | "techNickValue" | "otherNickValue"> = {
  os: "osNickValue",
  tech: "techNickValue",
  other: "otherNickValue",
};

function hasNick(member: Partial<WorkspaceMember>, kind: NickKind): boolean {
  return Boolean(member[NICK_VALUE_FIELD[kind]]);
}

/**
 * Какие ники человеку положены. Первый — ник его раздела. Ник ОС — ещё и
 * ФУНКЦИЯ (по нему считаются заказы и оценки ОС), поэтому он положен всем с
 * ролью ОС, даже если человек стоит в другом разделе (Admin + ОС).
 */
export function nickKindsFor(member: RoleHolder): NickKind[] {
  const kinds: NickKind[] = [GROUP_NICK_KIND[teamGroupOf(member)]];
  if (memberHasRole(member, "os") && !kinds.includes("os")) kinds.push("os");
  return kinds;
}

/**
 * Какие чипы ников рисовать у человека: положенные ему плюс те, что у него
 * УЖЕ есть вне раздела (перевели из Технарей в Admin, или ник технаря у
 * Owner со времён, когда Owner стоял в технарях) — открепить их можно
 * только отсюда.
 */
export function nickKindsShownFor(member: WorkspaceMember): NickKind[] {
  const kinds = nickKindsFor(member);
  for (const kind of ["os", "tech", "other"] as const) {
    if (!kinds.includes(kind) && hasNick(member, kind)) kinds.push(kind);
  }
  return kinds;
}

/** Каких положенных ников у человека нет (для счётчика «без ника»). */
export function missingNickKinds(member: WorkspaceMember): NickKind[] {
  return nickKindsFor(member).filter((kind) => !hasNick(member, kind));
}

/**
 * Живой участник, которому этот ник МОЖНО держать (приглашённые без uid —
 * нет). Шире `nickKindsFor`: ник технаря законен у всех, кто работает за
 * столом, даже если их раздел «Другие» (Owner, Admin + Технарь), — но
 * «без ника» им за его отсутствие не пишем: подписывает ник их раздела.
 */
export function canHoldNick(kind: NickKind, member: WorkspaceMember): boolean {
  if (member.status !== "active" || !member.uid) return false;
  if (kind === "tech" && worksAtTechDesk(member)) return true;
  return nickKindsFor(member).includes(kind);
}

/**
 * Тимлид не трогает ни свой ник, ни записи Owner — так держат правила
 * members. Owner правит всё.
 */
export function nickLockedFor(member: Pick<WorkspaceMember, "uid" | "role">, meUid: string, viewerIsOwner: boolean): boolean {
  if (viewerIsOwner) return false;
  return member.uid === meUid || member.role === "owner";
}

export function nickLockReason(member: Pick<WorkspaceMember, "role">): string {
  return member.role === "owner" ? "Ник Owner закрепляет сам Owner" : "Свой ник закрепляет Owner или другой Тимлид";
}

/** Всё, из чего складывается рабочий ник человека. */
export type NickHolder = {
  techNick?: string;
  otherNick?: string;
  /** Ник ОС (подпись варианта «Ответственный»); в счёт только при `osNickValue`. */
  osNick?: string;
  osNickValue?: string;
  role?: Role;
  extraRoles?: readonly Role[] | null;
};

/**
 * Рабочий ник для подписи человека — ВЕЗДЕ и у всех (просьба Nurba
 * 25.09.2026: «сделай всегда отображение по нику везде и у всех»). Первым —
 * ник ЕГО раздела: технарь — ник технаря, ОС — ник ОС, «Другие» — ник
 * «Другие» (у одного человека их бывает несколько: Owner держал ник технаря,
 * пока стоял в технарях, — без этого новый ник ничего бы не менял, пока
 * старый не открепят). Нет ника раздела — любой другой выданный ник. Без
 * роли (профиль `users/{uid}`) — ник технаря, «Другие», ОС по порядку.
 *
 * Ник ОС раньше в подпись не шёл («ключ заказов, а не подпись») — теперь
 * идёт: ОС работает под ним. Подпись ника ОС сохранена на участнике
 * (`osNick`) и не переименовывается; считается только при закреплённом
 * `osNickValue`, чтобы откреплённый ник не всплывал подписью.
 */
export function workNickOf(entity: NickHolder | null | undefined): string {
  const tech = entity?.techNick?.trim() || "";
  const other = entity?.otherNick?.trim() || "";
  const os = entity?.osNickValue ? entity.osNick?.trim() || "" : "";
  if (entity?.role) {
    const group = teamGroupOf({ role: entity.role, extraRoles: entity.extraRoles });
    const own = group === "tech" ? tech : group === "os" ? os : other;
    if (own) return own;
  }
  return tech || other || os;
}
