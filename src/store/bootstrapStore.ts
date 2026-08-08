// PATH: src/store/bootstrapStore.ts  (NEW FILE)
import { create } from "zustand";

/**
 * Single source of truth for "how far has the app finished booting".
 *
 * Root cause this replaces: readiness used to be inferred from three
 * independent `isLoading*` flags in three different stores. Right after auth
 * resolves, React renders the layout BEFORE the workspace effect has run, so
 * `isLoadingWorkspaces` is still its stale default while `workspaces` is still
 * empty -> one render of "создайте workspace" / "нет доступа", which a manual
 * F5 appeared to "fix".
 *
 * These flags are only ever set to true by the bootstrap hooks once real data
 * (or a definitively handled error) has arrived. Nothing here is time-based:
 * no setTimeout, no retry, no reload.
 */
interface BootstrapState {
  /** Firebase Auth reported at least once (signed in OR definitively signed out). */
  authResolved: boolean;
  /** users/{uid} profile has been read (or we know there is no user). */
  profileResolved: boolean;
  /** The "which workspaces do I belong to" subscription emitted its first real answer. */
  workspaceListResolved: boolean;
  /**
   * Id of the workspace whose members + pages finished their FIRST load.
   * Keyed by id rather than a boolean so switching workspaces can never be
   * reported as "ready" using the previous workspace's data.
   */
  resolvedDataWorkspaceId: string | null;

  setAuthResolved: (value: boolean) => void;
  setProfileResolved: (value: boolean) => void;
  setWorkspaceListResolved: (value: boolean) => void;
  setResolvedDataWorkspaceId: (workspaceId: string | null) => void;
  /** Called on sign-out so the next account boots from a clean slate. */
  resetBootstrap: () => void;
}

export const useBootstrapStore = create<BootstrapState>((set) => ({
  authResolved: false,
  profileResolved: false,
  workspaceListResolved: false,
  resolvedDataWorkspaceId: null,

  setAuthResolved: (authResolved) => set({ authResolved }),
  setProfileResolved: (profileResolved) => set({ profileResolved }),
  setWorkspaceListResolved: (workspaceListResolved) => set({ workspaceListResolved }),
  setResolvedDataWorkspaceId: (resolvedDataWorkspaceId) => set({ resolvedDataWorkspaceId }),
  resetBootstrap: () =>
    set({ profileResolved: false, workspaceListResolved: false, resolvedDataWorkspaceId: null }),
}));
