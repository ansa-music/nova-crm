export interface AppUser {
  uid: string;
  email: string;
  name: string;
  photoURL?: string | null;
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
