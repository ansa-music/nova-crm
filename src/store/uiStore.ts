import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "light" | "dark" | "system";

interface UiState {
  theme: ThemeMode;
  sidebarCollapsed: boolean;
  shortcutsHelpOpen: boolean;
  /** Hides the sidebar+topbar entirely on a table page, giving it the full
   * viewport — a small floating button brings the chrome back. Persisted
   * so the choice sticks across reloads, same as density/theme. */
  tableFullscreen: boolean;
  setTheme: (theme: ThemeMode) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setShortcutsHelpOpen: (open: boolean) => void;
  setTableFullscreen: (fullscreen: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: "dark",
      sidebarCollapsed: false,
      shortcutsHelpOpen: false,
      tableFullscreen: false,
      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setShortcutsHelpOpen: (shortcutsHelpOpen) => set({ shortcutsHelpOpen }),
      setTableFullscreen: (tableFullscreen) => set({ tableFullscreen }),
    }),
    { name: "nova-crm:ui", partialize: (s) => ({ theme: s.theme, sidebarCollapsed: s.sidebarCollapsed, tableFullscreen: s.tableFullscreen }) }
  )
);
