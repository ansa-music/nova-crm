import { useEffect } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";

export const ACCENT_PRESETS = [
  { label: "Вермилион", value: "13 100% 57%" },
  { label: "Синий", value: "217 91% 60%" },
  { label: "Зелёный", value: "152 60% 40%" },
  { label: "Фиолетовый", value: "262 70% 60%" },
  { label: "Янтарный", value: "38 92% 50%" },
] as const;

/** Mount once near the app root. Resets to the default (index.css value) whenever no workspace override is set. */
export function AccentColorSync() {
  const { activeWorkspace } = useWorkspace();

  useEffect(() => {
    const root = document.documentElement;
    if (activeWorkspace?.accentColor) {
      root.style.setProperty("--primary", activeWorkspace.accentColor);
      root.style.setProperty("--ring", activeWorkspace.accentColor);
    } else {
      root.style.removeProperty("--primary");
      root.style.removeProperty("--ring");
    }
  }, [activeWorkspace?.accentColor]);

  return null;
}
