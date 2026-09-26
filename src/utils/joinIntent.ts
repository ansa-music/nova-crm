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

/**
 * Код приглашения КОМПАНИИ (`/start?code=…`, SaaS этап 2) — переживает вход
 * через Google-редирект, как заявка в workspace. Сильнее заявки: человек
 * пришёл заводить свою компанию, а не проситься в чужую.
 */
const COMPANY_KEY = "nova-crm:company-code";

export function rememberCompanyCode(code: string) {
  const value = code.trim().toUpperCase();
  if (!value) return;
  try {
    sessionStorage.setItem(COMPANY_KEY, value);
  } catch {
    /* private mode */
  }
  try {
    localStorage.setItem(COMPANY_KEY, value);
  } catch {
    /* private mode */
  }
}

export function getCompanyCode(): string | null {
  try {
    const session = sessionStorage.getItem(COMPANY_KEY);
    if (session) return session;
  } catch {
    /* ignore */
  }
  try {
    return localStorage.getItem(COMPANY_KEY);
  } catch {
    return null;
  }
}

export function clearCompanyCode() {
  try {
    sessionStorage.removeItem(COMPANY_KEY);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(COMPANY_KEY);
  } catch {
    /* ignore */
  }
}

/** `/start?code=…` до входа — запомнить код. */
export function rememberCompanyIntentFromLocation(pathname: string, search: string) {
  if (!pathname.startsWith("/start")) return;
  const code = new URLSearchParams(search).get("code");
  if (code) rememberCompanyCode(code);
  else rememberCompanyCode("-");
}

/** Куда вести после входа, если человек шёл регистрировать компанию. */
export function companyStartPath(): string | null {
  const code = getCompanyCode();
  if (!code) return null;
  return code === "-" ? "/start" : `/start?code=${encodeURIComponent(code)}`;
}

export function joinPathAfterLogin(from: string | undefined): string {
  if (from && from.startsWith("/start")) return from;
  const company = companyStartPath();
  if (company) return company;
  if (from && from.startsWith("/join/")) return from;
  const stored = getJoinIntent();
  if (stored) return `/join/${stored}`;
  if (from && from !== "/login") return from;
  return "/";
}
