export type Role = "owner" | "teamlead" | "admin" | "manager" | "os" | "viewer";

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  teamlead: "Тимлид",
  admin: "Admin",
  manager: "Технар",
  os: "ОС",
  viewer: "Viewer",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: "Полный доступ: workspace, участники, права, история",
  teamlead:
    "Ведёт людей: участники, заявки, роли, доступы к столам, настройки, объявления. Таблицы столов не видит. Не может удалить workspace и менять Owner.",
  admin: "Создание и редактирование своих столов. Пользователей ведёт Owner.",
  manager: "Редактирование только разрешённых страниц",
  os: "Без своего стола. Видит «Технари»: кто из технарей свободен и сколько у них заказов.",
  viewer: "Только просмотр",
};

export const ROLE_RANK: Record<Role, number> = {
  owner: 5,
  teamlead: 4,
  admin: 3,
  manager: 2,
  os: 1,
  viewer: 1,
};

export const ALL_ROLES: Role[] = ["owner", "teamlead", "admin", "manager", "os", "viewer"];

/**
 * Roles a person can hold on top of their main one — Owner + Технар,
 * Тимлид + Технар, Тимлид + ОС. Rights add up; the main role stays the one
 * that decides people/settings access (firestore.rules reads `role` for that
 * and `extraRoles` only for desks, Грок and ratings).
 */
export const EXTRA_ROLES: Role[] = ["manager", "os"];

type RoleHolder = { role: Role; extraRoles?: readonly Role[] | null };

/** Main role first, then the valid add-ons (never the main role twice). */
export function rolesOf(member: RoleHolder | null | undefined): Role[] {
  if (!member) return [];
  const roles: Role[] = [member.role];
  for (const role of member.extraRoles ?? []) {
    if (EXTRA_ROLES.includes(role) && !roles.includes(role)) roles.push(role);
  }
  return roles;
}

export function memberHasRole(member: RoleHolder | null | undefined, role: Role): boolean {
  return rolesOf(member).includes(role);
}

/** «Тимлид + Технар». */
export function rolesLabel(member: RoleHolder | null | undefined): string {
  return rolesOf(member)
    .map((role) => ROLE_LABELS[role])
    .join(" + ");
}

/** True if `role` has at least the privilege level of `min`. */
export function roleAtLeast(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}
