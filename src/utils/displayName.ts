import type { Role } from "@/types";
import { workNickOf } from "@/utils/teamGroup";

type NickedEntity = {
  techNick?: string;
  otherNick?: string;
  role?: Role;
  extraRoles?: readonly Role[] | null;
  nickname?: string;
  name?: string;
};

/**
 * Как показать человека. Рабочий ник, выданный руководством (ник технаря —
 * `WorkspaceMember.techNick`, или ник раздела «Другие» — `otherNick`), идёт
 * первым: человек работает под ним (если есть оба — ник его раздела,
 * `workNickOf`). Дальше — ник, который человек выбрал себе сам, и полное
 * имя. Ник ОС сюда не входит: это ключ заказов, а не подпись.
 */
export function displayNameOf(entity: NickedEntity | null | undefined): string {
  return workNickOf(entity) || entity?.nickname?.trim() || entity?.name?.trim() || "Пользователь";
}

/**
 * Имя человека как такового — без ника технаря. Для экранов, где ник и
 * есть предмет разговора («Ники», «занят: …», «уже закреплён за …»):
 * там подпись по нику дала бы «Sako … Sako», и не понять, чей он.
 */
export function realNameOf(entity: { nickname?: string; name?: string; email?: string } | null | undefined): string {
  return entity?.nickname?.trim() || entity?.name?.trim() || entity?.email?.trim() || "Пользователь";
}

/**
 * Как подписать МОИ действия в этом workspace (отклик на заказ, запрос,
 * история). Ник технаря живёт на member-документе, а не в профиле
 * `users/{uid}`, — без этого у одного технаря в одном заказе было бы два
 * имени: «Откликнулись: Нурлан», а «Отдан: Sako».
 */
export function myDisplayName(
  profile: { uid?: string; nickname?: string; name?: string } | null | undefined,
  members:
    | Array<{ uid: string; techNick?: string; otherNick?: string; role?: Role; extraRoles?: readonly Role[] | null }>
    | null
    | undefined
): string {
  const me = profile?.uid ? members?.find((m) => m.uid === profile.uid) : null;
  return displayNameOf(
    me ? { ...profile, techNick: me.techNick, otherNick: me.otherNick, role: me.role, extraRoles: me.extraRoles } : profile
  );
}
