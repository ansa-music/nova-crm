import { useEffect } from "react";

/** Always navy. Light/cream is not a site look — chrome stays dark. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("dark");
    root.style.colorScheme = "dark";
  }, []);

  return <>{children}</>;
}
