export interface AppUser {
  uid: string;
  email: string;
  name: string;
  /**
   * Short display name the person picks for themselves on first sign-in
   * (e.g. "Nurba", "Manager1"). Shown everywhere in place of email/full
   * name once set — access lists, member cards, etc.
   */
  nickname?: string;
  photoURL?: string | null;
  /**
   * Путь загруженной аватарки в бакете `row-files` — нужен, чтобы удалить
   * старый файл при замене и при снятии фото. У аккаунтов, чьё фото пришло
   * из Google, его нет: там `photoURL` чужой и удалять нечего.
   */
  photoPath?: string | null;
  createdAt: number;
  /**
   * Cache of workspace ids this user belongs to, maintained by the client
   * whenever they gain membership (create/accept invite/get approved).
   * Lets the app list "my workspaces" via a plain doc read instead of a
   * collectionGroup query. May lag briefly behind reality (e.g. right after
   * an Owner approves a join request while the requester is offline) — in
   * that case a stale id just fails its own individual workspace read and
   * is quietly dropped from the list, never breaking the whole query.
   */
  workspaceIds?: string[];
}
