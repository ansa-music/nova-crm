import { useEffect, useRef } from "react";

/** Follows the pointer on the dashboard only — not a custom cursor, table stays untouched. */
export function DeskPointerGlow() {
  const glowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const glow = glowRef.current;
    const host = glow?.parentElement;
    if (!glow || !host) return;
    if (
      window.matchMedia(
        "(prefers-reduced-motion: reduce), (hover: none), (pointer: coarse), (max-width: 767px)"
      ).matches
    ) {
      return;
    }

    function onMove(e: MouseEvent) {
      const node = glow;
      if (!node || !host) return;
      const r = host.getBoundingClientRect();
      node.style.transform = `translate(${e.clientX - r.left}px, ${e.clientY - r.top}px)`;
    }

    host.addEventListener("mousemove", onMove);
    return () => host.removeEventListener("mousemove", onMove);
  }, []);

  return <div ref={glowRef} className="desk-pointer-glow" aria-hidden />;
}
