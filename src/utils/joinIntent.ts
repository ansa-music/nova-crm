/** Survives Google signInWithRedirect, which drops react-router location.state. */
const KEY = "nova-crm:join-workspace";

/** Production workspace used when a new user opens the site without an invite URL. */
export const FALLBACK_JOIN_WORKSPACE_ID = "ws_zokgevudmsbfnq88";

export function rememberJoinIntent(workspaceId: string) {
  const id = workspaceId.trim();
  if (!id) return;
  try {
    sessionStorage.setItem(KEY, id);
  } catch {
    /* private mode */
  }
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* private mode */
  }
}

export function rememberJoinIntentFromPath(pathname: string) {
  const match = pathname.match(/^\/join\/([^/]+)/);
  if (match?.[1]) rememberJoinIntent(decodeURIComponent(match[1]));
}

export function getJoinIntent(): string | null {
  try {
    const session = sessionStorage.getItem(KEY);
    if (session) return session;
  } catch {
    /* ignore */
  }
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearJoinIntent() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function joinPathAfterLogin(from: string | undefined): string {
  if (from && from.startsWith("/join/")) return from;
  const stored = getJoinIntent();
  if (stored) return `/join/${stored}`;
  if (from && from !== "/login") return from;
  return "/";
}
