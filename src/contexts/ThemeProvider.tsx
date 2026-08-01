import { useEffect } from "react";
import { useUiStore } from "@/store/uiStore";

function applyTheme(theme: "light" | "dark") {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
}

/** Watches the persisted theme preference (and system preference, when 'system')
 *  and keeps the `dark` class on <html> in sync. Mount once near the app root. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useUiStore((s) => s.theme);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    function sync() {
      if (theme === "system") {
        applyTheme(media.matches ? "dark" : "light");
      } else {
        applyTheme(theme);
      }
    }

    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [theme]);

  return <>{children}</>;
}
