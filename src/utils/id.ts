export function generateId(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

/**
 * Id нового стола: `page_{uidСоздателя}_{случайное}`.
 *
 * uid в id — это доказательство «стол мой» для базы строк в Supabase: там
 * запись о правах стола создатель заводит сам, и политика пускает только стол
 * со СВОИМ uid в id (см. `rows_page_acl_insert` в
 * supabase/migrations/20260923_desk_rows.sql). Со случайным id любой технарь,
 * увидев id нового чужого стола раньше сверки прав, мог бы объявить себя его
 * ответственным. Старые столы id не меняют — их записи заводит Owner при переносе.
 */
export function generateDeskId(creatorUid: string): string {
  return generateId(`page_${creatorUid}`);
}
