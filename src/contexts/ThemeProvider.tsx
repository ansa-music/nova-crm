import { useEffect } from "react";
import { useUiStore } from "@/store/uiStore";

/** Always navy. Light/cream is not a site look — chrome stays dark. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const uiSkin = useUiStore((s) => s.uiSkin);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("dark");
    root.style.colorScheme = "dark";
  }, []);

  // NOVA Signature — личный выбор: атрибут на <html>, токены под ним в index.css.
  // У «классики» атрибута нет вовсе — страница байт в байт прежняя.
  useEffect(() => {
    const root = document.documentElement;
    if (uiSkin === "signature") root.dataset.ui = "signature";
    else delete root.dataset.ui;
  }, [uiSkin]);

  return <>{children}</>;
}
