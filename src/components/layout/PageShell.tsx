import { useRef, type ReactNode } from "react";
import { useLocation } from "react-router";
import { deskEase, gsap, useGSAP } from "@/lib/gsap";

export function PageShell({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useGSAP(
    () => {
      if (!ref.current) return;
      gsap.fromTo(
        ref.current,
        { opacity: 0, y: 6 },
        { opacity: 1, y: 0, duration: 0.28, ease: deskEase }
      );
    },
    { scope: ref, dependencies: [location.pathname] }
  );

  return (
    <div ref={ref} className="h-full">
      {children}
    </div>
  );
}
