import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Workspace, WorkspaceMember, WorkspacePage } from "@/types";

export type MembersLoadState = "loading" | "ready" | "unconfirmed";

interface WorkspaceState {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  members: WorkspaceMember[];
  pages: WorkspacePage[];
  isLoadingWorkspaces: boolean;
  isLoadingWorkspaceData: boolean;
  membersLoadState: MembersLoadState;
  /**
   * Для какого workspace ПОЛНЫЙ список участников прочитан с сервера (разовое
   * чтение ростера или его обновление). `membersLoadState: "ready"` этого не
   * значит — он ставится и по одному своему документу участника. Нужен тем,
   * кто по списку решает «этого человека больше нет» (сверка прав строк).
   */
  rosterWorkspaceId: string | null;
  setWorkspaces: (workspaces: Workspace[]) => void;
  setActiveWorkspaceId: (id: string | null) => void;
  setMembers: (members: WorkspaceMember[]) => void;
  setPages: (pages: WorkspacePage[]) => void;
  setLoadingWorkspaces: (loading: boolean) => void;
  setLoadingWorkspaceData: (loading: boolean) => void;
  setMembersLoadState: (state: MembersLoadState) => void;
  setRosterWorkspaceId: (id: string | null) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      workspaces: [],
      activeWorkspaceId: null,
      members: [],
      pages: [],
      isLoadingWorkspaces: true,
      isLoadingWorkspaceData: true,
      membersLoadState: "loading",
      rosterWorkspaceId: null,
      setWorkspaces: (workspaces) => set({ workspaces }),
      setActiveWorkspaceId: (activeWorkspaceId) => set({ activeWorkspaceId }),
      setMembers: (members) => set({ members }),
      setPages: (pages) => set({ pages }),
      setLoadingWorkspaces: (isLoadingWorkspaces) => set({ isLoadingWorkspaces }),
      setLoadingWorkspaceData: (isLoadingWorkspaceData) => set({ isLoadingWorkspaceData }),
      setMembersLoadState: (membersLoadState) => set({ membersLoadState }),
      setRosterWorkspaceId: (rosterWorkspaceId) => set({ rosterWorkspaceId }),
    }),
    {
      name: "nova-crm:workspace",
      partialize: (state) => ({ activeWorkspaceId: state.activeWorkspaceId }),
    }
  )
);
