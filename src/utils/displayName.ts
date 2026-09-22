/**
 * Как показать человека. Ник технаря (его выдаёт Тимлид, см.
 * `WorkspaceMember.techNick`) идёт первым: технарь работает под ним. Дальше
 * — ник, который человек выбрал себе сам, и полное имя.
 */
export function displayNameOf(
  entity: { techNick?: string; nickname?: string; name?: string } | null | undefined
): string {
  return entity?.techNick?.trim() || entity?.nickname?.trim() || entity?.name?.trim() || "Пользователь";
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
  members: Array<{ uid: string; techNick?: string }> | null | undefined
): string {
  const me = profile?.uid ? members?.find((m) => m.uid === profile.uid) : null;
  return displayNameOf(me?.techNick ? { ...profile, techNick: me.techNick } : profile);
}
