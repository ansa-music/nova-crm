import { workNickOf, type NickHolder } from "@/utils/teamGroup";

type NickedEntity = NickHolder & {
  nickname?: string;
  name?: string;
};

/**
 * Как показать человека — ПО НИКУ, везде и у всех (просьба Nurba
 * 25.09.2026). Рабочий ник, выданный руководством (ник технаря, ник ОС или
 * ник «Другие» — ник его раздела первым, `workNickOf`), идёт первым: человек
 * работает под ним. Нет выданного — ник, который человек выбрал себе сам, и
 * только потом полное имя.
 */
export function displayNameOf(entity: NickedEntity | null | undefined): string {
  return workNickOf(entity) || entity?.nickname?.trim() || entity?.name?.trim() || "Пользователь";
}

/**
 * Имя человека как такового — без рабочего ника. Для экранов, где ник и
 * есть предмет разговора («Ники», «занят: …», «уже закреплён за …»):
 * там подпись по нику дала бы «Sako … Sako», и не понять, чей он.
 */
export function realNameOf(entity: { nickname?: string; name?: string; email?: string } | null | undefined): string {
  return entity?.nickname?.trim() || entity?.name?.trim() || entity?.email?.trim() || "Пользователь";
}

/**
 * Как подписать МОИ действия в этом workspace (сообщение, отклик на заказ,
 * запрос, история). Рабочие ники живут на member-документе, а не в профиле
 * `users/{uid}`, — без этого у одного человека в одном заказе было бы два
 * имени: «Откликнулись: Нурлан», а «Отдан: Sako».
 */
export function myDisplayName(
  profile: { uid?: string; nickname?: string; name?: string } | null | undefined,
  members: Array<NickHolder & { uid: string }> | null | undefined
): string {
  const me = profile?.uid ? members?.find((m) => m.uid === profile.uid) : null;
  return displayNameOf(
    me
      ? {
          ...profile,
          techNick: me.techNick,
          otherNick: me.otherNick,
          osNick: me.osNick,
          osNickValue: me.osNickValue,
          role: me.role,
          extraRoles: me.extraRoles,
        }
      : profile
  );
}
