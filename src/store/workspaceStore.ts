import { create } from "zustand";
import { persist } from "zustand/middleware";
import { WORKSPACE_CONTROL_KEYS, type Workspace, type WorkspaceMember, type WorkspacePage } from "@/types";

export type MembersLoadState = "loading" | "ready" | "unconfirmed";

/** Настройки workspace из Supabase (после переезда ядра) — по workspace. */
type SettingsMap = Record<string, Record<string, unknown> | undefined>;

interface WorkspaceState {
  /** Объединённые документы: управляющие поля из Firestore + настройки из Supabase (если переехали). */
  workspaces: Workspace[];
  /** Документы Firestore как есть. */
  rawWorkspaces: Workspace[];
  settingsById: SettingsMap;
  activeWorkspaceId: string | null;
  members: WorkspaceMember[];
  pages: WorkspacePage[];
  isLoadingWorkspaces: boolean;
  isLoadingWorkspaceData: boolean;
  membersLoadState: MembersLoadState;
  setWorkspaces: (workspaces: Workspace[]) => void;
  /** Настройки из Supabase для одного workspace; null — настройки снова читаются из Firestore. */
  setWorkspaceSettings: (workspaceId: string, settings: Record<string, unknown> | null) => void;
  setActiveWorkspaceId: (id: string | null) => void;
  setMembers: (members: WorkspaceMember[]) => void;
  setPages: (pages: WorkspacePage[]) => void;
  setLoadingWorkspaces: (loading: boolean) => void;
  setLoadingWorkspaceData: (loading: boolean) => void;
  setMembersLoadState: (state: MembersLoadState) => void;
}

const CONTROL = new Set<string>(WORKSPACE_CONTROL_KEYS);

/**
 * Управляющие поля — из Firestore, всё остальное — из Supabase, когда
 * настройки переехали. Именно «вместо», а не «поверх»: поле, снятое в
 * Supabase, иначе всплывало бы из устаревшего документа Firestore.
 */
export function mergeWorkspace(raw: Workspace, settings: Record<string, unknown> | undefined): Workspace {
  if (!settings) return raw;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) if (CONTROL.has(key)) out[key] = value;
  for (const [key, value] of Object.entries(settings)) if (!CONTROL.has(key)) out[key] = value;
  out.id = raw.id;
  return out as unknown as Workspace;
}

function mergeAll(raw: Workspace[], settings: SettingsMap): Workspace[] {
  return raw.map((w) => mergeWorkspace(w, settings[w.id]));
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      workspaces: [],
      rawWorkspaces: [],
      settingsById: {},
      activeWorkspaceId: null,
      members: [],
      pages: [],
      isLoadingWorkspaces: true,
      isLoadingWorkspaceData: true,
      membersLoadState: "loading",
      setWorkspaces: (rawWorkspaces) => {
        const known = new Set(rawWorkspaces.map((w) => w.id));
        const settingsById: SettingsMap = {};
        for (const [id, s] of Object.entries(get().settingsById)) if (known.has(id) && s) settingsById[id] = s;
        set({ rawWorkspaces, settingsById, workspaces: mergeAll(rawWorkspaces, settingsById) });
      },
      setWorkspaceSettings: (workspaceId, settings) => {
        const prev = get().settingsById;
        if ((settings === null && !prev[workspaceId]) || (settings !== null && prev[workspaceId] === settings)) return;
        const settingsById: SettingsMap = { ...prev };
        if (settings === null) delete settingsById[workspaceId];
        else settingsById[workspaceId] = settings;
        set({ settingsById, workspaces: mergeAll(get().rawWorkspaces, settingsById) });
      },
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
