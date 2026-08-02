/**
 * Only this account may create new workspaces. Everyone else who lands on
 * the app without a workspace must be invited or approved via a join link
 * (see JoinWorkspacePage) — self-service workspace creation is intentionally
 * closed off to prevent random signed-in users from spinning up their own.
 */
export const WORKSPACE_ADMIN_EMAIL = "nurpro2005@gmail.com";

export function isWorkspaceAdmin(email: string | null | undefined): boolean {
  return (email ?? "").trim().toLowerCase() === WORKSPACE_ADMIN_EMAIL;
}
