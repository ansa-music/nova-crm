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
  /**
   * Столы, на которые ТОЛЬКО ЧТО приехал заказ с биржи, — по ним в меню
   * горит зелёным «Мой стол»/«Главная», пока человек не откроет стол.
   * Ставит `useOrderAutoPickup` в момент записи строки, снимает сам стол при
   * открытии. Переживает перезагрузку (persist): заказ никуда не делся, и
   * гасить метку из-за F5 неправильно.
   */
  deskAlerts: string[];
  setTheme: (theme: ThemeMode) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setShortcutsHelpOpen: (open: boolean) => void;
  setTableFullscreen: (fullscreen: boolean) => void;
  setTableImmersive: (immersive: boolean) => void;
  setSelectedPersonKey: (key: string | null) => void;
  markDeskAlert: (pageId: string) => void;
  clearDeskAlert: (pageId: string) => void;
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
      deskAlerts: [],
      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setShortcutsHelpOpen: (shortcutsHelpOpen) => set({ shortcutsHelpOpen }),
      setTableFullscreen: (tableFullscreen) => set({ tableFullscreen }),
      setTableImmersive: (tableImmersive) => set({ tableImmersive }),
      setSelectedPersonKey: (selectedPersonKey) => set({ selectedPersonKey }),
      markDeskAlert: (pageId) =>
        set((s) => (s.deskAlerts.includes(pageId) ? s : { deskAlerts: [...s.deskAlerts, pageId] })),
      clearDeskAlert: (pageId) =>
        set((s) => (s.deskAlerts.includes(pageId) ? { deskAlerts: s.deskAlerts.filter((id) => id !== pageId) } : s)),
    }),
    {
      name: "nova-crm:ui",
      partialize: (s) => ({
        theme: s.theme,
        sidebarCollapsed: s.sidebarCollapsed,
        tableFullscreen: s.tableFullscreen,
        deskAlerts: s.deskAlerts,
      }),
    }
  )
);
