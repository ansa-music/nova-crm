export type Role = "owner" | "admin" | "manager" | "viewer";

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  viewer: "Viewer",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: "Полный доступ: workspace, участники, права, история",
  admin: "Создание и редактирование страниц, управление пользователями",
  manager: "Редактирование только разрешённых страниц",
  viewer: "Только просмотр",
};

export const ROLE_RANK: Record<Role, number> = {
  owner: 4,
  admin: 3,
  manager: 2,
  viewer: 1,
};

export const ALL_ROLES: Role[] = ["owner", "admin", "manager", "viewer"];

/** True if `role` has at least the privilege level of `min`. */
export function roleAtLeast(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}
