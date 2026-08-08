// PATH: src/hooks/useAppBootstrap.ts  (NEW FILE)
import { useMemo } from "react";
import { useAuthStore } from "@/store/authStore";
import { useBootstrapStore } from "@/store/bootstrapStore";
import { useWorkspaceStore } from "@/store/workspaceStore";

export type BootstrapPhase =
  | "auth"
  | "unauthenticated"
  | "profile"
  | "workspaces"
  | "no-workspace"
  | "workspace-data"
  | "ready";

const LOADING_PHASES: BootstrapPhase[] = ["auth", "profile", "workspaces", "workspace-data"];

/**
 * Derives ONE ordered phase from the bootstrap flags. Every guard, layout and
 * page branches on this instead of on individual `isLoading*` booleans. That's
 * what enforces the strict order
 *   user -> profile -> workspace -> members/role -> pages -> current page
 * and makes it structurally impossible to render "нет доступа" or
 * "создайте workspace" while the answer is still unknown.
 */
export function useAppBootstrap() {
  const firebaseUser = useAuthStore((s) => s.firebaseUser);
  const profile = useAuthStore((s) => s.profile);

  const authResolved = useBootstrapStore((s) => s.authResolved);
  const profileResolved = useBootstrapStore((s) => s.profileResolved);
  const workspaceListResolved = useBootstrapStore((s) => s.workspaceListResolved);
  const resolvedDataWorkspaceId = useBootstrapStore((s) => s.resolvedDataWorkspaceId);

  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  const phase: BootstrapPhase = useMemo(() => {
    if (!authResolved) return "auth";
    if (!firebaseUser) return "unauthenticated";
    if (!profileResolved || !profile) return "profile";
    if (!workspaceListResolved) return "workspaces";
    if (workspaces.length === 0) return "no-workspace";

    // A persisted activeWorkspaceId from localStorage is NOT trusted until the
    // live list confirms we still belong to it.
    const confirmed = workspaces.some((w) => w.id === activeWorkspaceId);
    if (!confirmed) return "workspaces";

    if (resolvedDataWorkspaceId !== activeWorkspaceId) return "workspace-data";
    return "ready";
  }, [
    authResolved,
    firebaseUser,
    profileResolved,
    profile,
    workspaceListResolved,
    workspaces,
    activeWorkspaceId,
    resolvedDataWorkspaceId,
  ]);

  return {
    phase,
    isReady: phase === "ready",
    isLoading: LOADING_PHASES.includes(phase),
    isAuthenticated: Boolean(firebaseUser) && authResolved,
    hasNoWorkspace: phase === "no-workspace",
  };
}
