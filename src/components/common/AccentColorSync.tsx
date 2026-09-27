import { useEffect } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";

export const ACCENT_PRESETS = [
  { label: "Циан", value: "189 100% 72%" },
  { label: "Бронза", value: "36 47% 60%" },
  { label: "Фиолетовый", value: "270 91% 75%" },
  { label: "Изумруд", value: "164 78% 48%" },
  { label: "Янтарный", value: "42 96% 62%" },
  { label: "Малина", value: "340 82% 62%" },
] as const;

/**
 * Workspace accent is a desk marker (--desk-accent) only. Главный цвет сайта
 * (--primary/--ring) ведёт «Конструктор сайта» (`useSiteConfigBridge`) — здесь
 * его больше не снимаем, иначе смена цвета стола стирала бы цвет компании.
 */
export function AccentColorSync() {
  const { activeWorkspace } = useWorkspace();

  useEffect(() => {
    const root = document.documentElement;
    if (activeWorkspace?.accentColor) {
      root.style.setProperty("--desk-accent", activeWorkspace.accentColor);
    } else {
      root.style.removeProperty("--desk-accent");
    }
  }, [activeWorkspace?.accentColor]);

  return null;
}
