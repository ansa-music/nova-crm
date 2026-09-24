import { memo, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useNavTargets } from "@/hooks/useNavModel";

const CHORD_MS = 800;

function isTypingTarget(el: EventTarget | null): boolean {
  const active = (el as HTMLElement | null) ?? (document.activeElement as HTMLElement | null);
  if (!active) return false;
  const tag = (active.tagName ?? "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || Boolean(active.isContentEditable);
}

/**
 * Linear/Gmail-style G-then-letter, using e.code (layout-independent).
 * Bare KeyG (no ctrl/meta/alt) arms a short window; second key navigates.
 * Does not steal Ctrl+K / undo (those use modifiers).
 * «Дом» (G D) и «свой стол» (G S / G P) — из навигационной модели, той же,
 * что у меню и нижней панели. Берёт только два адреса (`useNavTargets`), а не
 * всю модель: бейджи меню аккорды не перерисовывают.
 */
export const GoChordHotkeys = memo(function GoChordHotkeys() {
  const navigate = useNavigate();
  const targets = useNavTargets();
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<number | null>(null);
  // Слушатель клавиш живёт дольше рендера — адреса читаем через ref.
  const targetsRef = useRef({ home: targets.homeTo, desk: targets.myDeskTo });
  targetsRef.current = { home: targets.homeTo, desk: targets.myDeskTo };

  function disarm() {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setArmed(false);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) {
        if (armed) disarm();
        return;
      }

      if (!armed) {
        if (e.code !== "KeyG" || e.repeat) return;
        e.preventDefault();
        setArmed(true);
        if (timerRef.current) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => {
          setArmed(false);
          timerRef.current = null;
        }, CHORD_MS);
        return;
      }

      e.preventDefault();
      const code = e.code;
      disarm();
      if (code === "KeyD") {
        navigate(targetsRef.current.home);
        return;
      }
      if (code === "KeyS" || code === "KeyP") {
        navigate(targetsRef.current.desk);
        return;
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [armed, navigate]);

  if (!armed) return null;

  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[80] -translate-x-1/2 rounded-md border border-border bg-card px-3 py-1.5 font-mono text-[12px] text-muted-foreground">
      G …
    </div>
  );
});
