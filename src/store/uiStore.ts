import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "light" | "dark" | "system";

export type SidebarMode = "open" | "hover" | "rail";

/** Оформление интерфейса: `classic` — прежняя Nova, `signature` — NOVA Signature. */
export type UiSkin = "classic" | "signature";

interface UiState {
  theme: ThemeMode;
  /**
   * Левое меню по умолчанию — рейка 64px, которая раскрывается по наведению;
   * `true` — человек закрепил широкое меню (248px) и оно стоит в потоке.
   * `null` — человек ещё не выбирал, и умолчание решает Sidebar по устройству:
   * мышь → рейка, тач-планшет ≥1024 (iPad landscape) → закреплено, потому что
   * раскрытие по наведению там не работает и рейка была бы пятнадцатью
   * иконками без подписей. Хранить решение здесь нельзя — мышь к планшету
   * подключают и отключают, а persist пережил бы это.
   * Поле названо заново, а не как старое `sidebarCollapsed`: то персистилось
   * в localStorage со значением `false` у всех, и смена дефолта на «свёрнуто»
   * ни у кого не сработала бы — сохранённое перебивает дефолт.
   */
  sidebarPinned: boolean | null;
  /**
   * Вид десктопного меню (просьба Nurba 25.09.2026 — три положения):
   * `open` — закреплено открытым, `hover` — рейка, раскрывается под мышью,
   * `rail` — закреплено узким, не раскрывается. `null` — человек не выбирал:
   * берётся старое `sidebarPinned` (true → open, false → hover), иначе
   * умолчание по устройству (см. Sidebar).
   */
  sidebarMode: SidebarMode | null;
  /**
   * Личный выбор оформления (на устройство). По умолчанию `classic`: пока
   * человек сам не включил NOVA Signature, сайт выглядит и работает как раньше.
   * Данных и прав выбор не касается — только токены темы и группировка меню.
   */
  uiSkin: UiSkin;
  /** Человек закрыл плашку «Новая версия дизайна» — больше не показываем. */
  skinPromoDismissed: boolean;
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
  /**
   * Явный выбор человека (кнопка «Закрепить / Свернуть»). Переключателя
   * «наоборот» тут нет намеренно: при `null` магазин не знает, что сейчас
   * показано — эффективное значение считает Sidebar и передаёт его сюда.
   */
  setSidebarPinned: (pinned: boolean) => void;
  setSidebarMode: (mode: SidebarMode) => void;
  setUiSkin: (skin: UiSkin) => void;
  dismissSkinPromo: () => void;
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
      sidebarPinned: null,
      sidebarMode: null,
      uiSkin: "classic",
      skinPromoDismissed: false,
      shortcutsHelpOpen: false,
      tableFullscreen: false,
      tableImmersive: false,
      selectedPersonKey: null,
      deskAlerts: [],
      setTheme: (theme) => set({ theme }),
      setSidebarPinned: (sidebarPinned) => set({ sidebarPinned }),
      setSidebarMode: (sidebarMode) => set({ sidebarMode }),
      setUiSkin: (uiSkin) => set({ uiSkin }),
      dismissSkinPromo: () => set({ skinPromoDismissed: true }),
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
      // Старый ключ `sidebarCollapsed` в сохранённом состоянии просто
      // игнорируется: в partialize его нет, при следующей записи он исчезнет.
      // `tableFullscreen` тоже не сохраняем: после F5 человек попадал в стол
      // без меню и не понимал, куда оно делось — полный экран живёт сессию.
      partialize: (s) => ({
        theme: s.theme,
        sidebarPinned: s.sidebarPinned,
        sidebarMode: s.sidebarMode,
        uiSkin: s.uiSkin,
        skinPromoDismissed: s.skinPromoDismissed,
        deskAlerts: s.deskAlerts,
      }),
    }
  )
);
