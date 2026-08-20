import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "light" | "dark" | "system";

interface UiState {
  theme: ThemeMode;
  sidebarCollapsed: boolean;
  shortcutsHelpOpen: boolean;
  setTheme: (theme: ThemeMode) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setShortcutsHelpOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: "dark",
      sidebarCollapsed: false,
      shortcutsHelpOpen: false,
      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setShortcutsHelpOpen: (shortcutsHelpOpen) => set({ shortcutsHelpOpen }),
    }),
    { name: "nova-crm:ui", partialize: (s) => ({ theme: s.theme, sidebarCollapsed: s.sidebarCollapsed }) }
  )
);
