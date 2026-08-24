import { useRef, type ReactNode } from "react";
import { useLocation } from "react-router";
import { deskEase, gsap, useGSAP } from "@/lib/gsap";

export function PageShell({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useGSAP(
    () => {
      if (!ref.current) return;
      if (
        window.matchMedia(
          "(prefers-reduced-motion: reduce), (hover: none), (pointer: coarse), (max-width: 1023px)"
        ).matches
      ) {
        return;
      }
      gsap.fromTo(
        ref.current,
        { opacity: 0, y: 8, scale: 0.992 },
        { opacity: 1, y: 0, scale: 1, duration: 0.3, ease: deskEase }
      );
    },
    { scope: ref, dependencies: [location.pathname] }
  );

  return (
    <div ref={ref} className="h-full origin-top">
      {children}
    </div>
  );
}
