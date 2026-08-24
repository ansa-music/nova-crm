import { useRef } from "react";
import { BrandMark } from "@/components/common/BrandMark";
import { deskEase, gsap, useGSAP } from "@/lib/gsap";
import type { BootstrapPhase } from "@/hooks/useAppBootstrap";

const PHASE_LABEL: Partial<Record<BootstrapPhase, string>> = {
  auth: "Проверяем вход…",
  profile: "Загружаем профиль…",
  workspaces: "Открываем рабочее пространство…",
  "workspace-data": "Загружаем страницы и доступы…",
};

const PHASE_ORDER: BootstrapPhase[] = ["auth", "profile", "workspaces", "workspace-data"];

export function AppBootScreen({ phase }: { phase: BootstrapPhase }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const step = Math.max(0, PHASE_ORDER.indexOf(phase));
  const progress = ((step + 1) / PHASE_ORDER.length) * 100;

  useGSAP(
    () => {
      if (!rootRef.current) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      gsap.fromTo(
        rootRef.current.querySelector(".boot-card"),
        { opacity: 0, y: 8 },
        { opacity: 1, y: 0, duration: 0.32, ease: deskEase }
      );
    },
    { scope: rootRef }
  );

  useGSAP(
    () => {
      if (!barRef.current) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        barRef.current.style.width = `${progress}%`;
        return;
      }
      gsap.to(barRef.current, { width: `${progress}%`, duration: 0.28, ease: deskEase });
    },
    { scope: rootRef, dependencies: [progress] }
  );

  return (
    <div
      ref={rootRef}
      className="cyber-grid flex h-screen w-full flex-col items-center justify-center gap-8 bg-background"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="boot-card hud-frame neon-pulse flex w-full max-w-[360px] flex-col items-center gap-6 rounded-md border border-primary/45 bg-card/95 px-8 py-10">
        <BrandMark />
        <div className="h-px w-40 overflow-hidden bg-border">
          <div ref={barRef} className="h-full bg-primary shadow-[0_0_18px_hsl(var(--primary))]" style={{ width: "12%" }} />
        </div>
        <p className="eyebrow">{PHASE_LABEL[phase] ?? "Загрузка…"}</p>
      </div>
    </div>
  );
}
