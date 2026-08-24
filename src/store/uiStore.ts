import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "light" | "dark" | "system";

interface UiState {
  theme: ThemeMode;
  sidebarCollapsed: boolean;
  shortcutsHelpOpen: boolean;
  tableFullscreen: boolean;
  tableImmersive: boolean;
  /** Session-only: which person is selected on the home rail/hero. */
  selectedPersonKey: string | null;
  setTheme: (theme: ThemeMode) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setShortcutsHelpOpen: (open: boolean) => void;
  setTableFullscreen: (fullscreen: boolean) => void;
  setTableImmersive: (immersive: boolean) => void;
  setSelectedPersonKey: (key: string | null) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: "dark",
      sidebarCollapsed: false,
      shortcutsHelpOpen: false,
      tableFullscreen: false,
      tableImmersive: false,
      selectedPersonKey: null,
      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setShortcutsHelpOpen: (shortcutsHelpOpen) => set({ shortcutsHelpOpen }),
      setTableFullscreen: (tableFullscreen) => set({ tableFullscreen }),
      setTableImmersive: (tableImmersive) => set({ tableImmersive }),
      setSelectedPersonKey: (selectedPersonKey) => set({ selectedPersonKey }),
    }),
    {
      name: "nova-crm:ui",
      partialize: (s) => ({
        theme: s.theme,
        sidebarCollapsed: s.sidebarCollapsed,
        tableFullscreen: s.tableFullscreen,
      }),
    }
  )
);
