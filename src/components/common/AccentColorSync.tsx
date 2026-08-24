import { useEffect } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";

export const ACCENT_PRESETS = [
  { label: "Бронза", value: "36 47% 60%" },
  { label: "Циан", value: "189 100% 72%" },
  { label: "Фиолетовый", value: "270 91% 75%" },
  { label: "Изумруд", value: "164 78% 48%" },
  { label: "Янтарный", value: "42 96% 62%" },
  { label: "Малина", value: "340 82% 62%" },
] as const;

/** Mount once near the app root. Workspace accent is a marker only — chrome stays bronze. */
export function AccentColorSync() {
  const { activeWorkspace } = useWorkspace();

  useEffect(() => {
    const root = document.documentElement;
    if (activeWorkspace?.accentColor) {
      root.style.setProperty("--desk-accent", activeWorkspace.accentColor);
    } else {
      root.style.removeProperty("--desk-accent");
    }
    root.style.removeProperty("--primary");
    root.style.removeProperty("--ring");
  }, [activeWorkspace?.accentColor]);

  return null;
}
