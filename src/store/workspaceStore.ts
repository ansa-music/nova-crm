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
  setWorkspaces: (workspaces: Workspace[]) => void;
  setActiveWorkspaceId: (id: string | null) => void;
  setMembers: (members: WorkspaceMember[]) => void;
  setPages: (pages: WorkspacePage[]) => void;
  setLoadingWorkspaces: (loading: boolean) => void;
  setLoadingWorkspaceData: (loading: boolean) => void;
  setMembersLoadState: (state: MembersLoadState) => void;
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
      setWorkspaces: (workspaces) => set({ workspaces }),
      setActiveWorkspaceId: (activeWorkspaceId) => set({ activeWorkspaceId }),
      setMembers: (members) => set({ members }),
      setPages: (pages) => set({ pages }),
      setLoadingWorkspaces: (isLoadingWorkspaces) => set({ isLoadingWorkspaces }),
      setLoadingWorkspaceData: (isLoadingWorkspaceData) => set({ isLoadingWorkspaceData }),
      setMembersLoadState: (membersLoadState) => set({ membersLoadState }),
    }),
    {
      name: "nova-crm:workspace",
      partialize: (state) => ({ activeWorkspaceId: state.activeWorkspaceId }),
    }
  )
);
