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

/** True if `role` has at least the privilege level of `min`. */
export function roleAtLeast(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}
