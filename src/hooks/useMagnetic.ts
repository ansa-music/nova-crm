import { useEffect, useRef } from "react";
import { deskEase, gsap } from "@/lib/gsap";

/** Gentle magnetic pull on chrome buttons. Skips prefers-reduced-motion. */
export function useMagnetic<T extends HTMLElement = HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    function onMove(e: globalThis.MouseEvent) {
      const node = el as T;
      const r = node.getBoundingClientRect();
      const x = e.clientX - r.left - r.width / 2;
      const y = e.clientY - r.top - r.height / 2;
      gsap.to(node, { x: x * 0.16, y: y * 0.16, duration: 0.28, ease: deskEase, overwrite: "auto" });
    }
    function onLeave() {
      gsap.to(el, { x: 0, y: 0, duration: 0.34, ease: deskEase, overwrite: "auto" });
    }

    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
      gsap.set(el, { x: 0, y: 0 });
    };
  }, []);

  return ref;
}
