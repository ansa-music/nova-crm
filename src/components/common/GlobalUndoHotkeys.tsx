import { useEffect } from "react";
import { redo, undo } from "@/utils/undoStore";

/**
 * Deliberately uses e.code (the physical key position: "KeyZ"/"KeyY"), NOT
 * e.key. e.key reflects whatever character the current keyboard LAYOUT
 * produces — on a Cyrillic/Russian layout, the physical Z key produces the
 * character "я", not "z", so a check like `e.key.toLowerCase() === "z"`
 * silently never matches for that layout at all. e.code is layout-
 * independent, which is what a keyboard-shortcut check should always use.
 */
export function GlobalUndoHotkeys() {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isCtrl = e.ctrlKey || e.metaKey;
      if (!isCtrl || (e.code !== "KeyZ" && e.code !== "KeyY")) return;

      // Never hijack native undo inside an actual text field (chat message,
      // a dialog's input, a cell currently being edited, etc) — that field
      // should keep its own browser-native undo.
      const active = document.activeElement as HTMLElement | null;
      const tag = (active?.tagName ?? "").toLowerCase();
      const isTextField = tag === "input" || tag === "textarea" || Boolean(active?.isContentEditable);
      if (isTextField) return;

      e.preventDefault();
      if (e.code === "KeyZ" && !e.shiftKey) undo();
      else redo();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return null;
}
