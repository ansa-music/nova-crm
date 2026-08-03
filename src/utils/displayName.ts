/** Prefer the nickname the person picked for themselves; fall back to their full name. */
export function displayNameOf(entity: { nickname?: string; name?: string } | null | undefined): string {
  return entity?.nickname?.trim() || entity?.name?.trim() || "Пользователь";
}
