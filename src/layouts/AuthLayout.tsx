import { BrandMark } from "@/components/common/BrandMark";
import { DeskPointerGlow } from "@/components/dashboard/DeskPointerGlow";

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="cyber-grid relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-12">
      <DeskPointerGlow />
      <div className="hud-frame neon-pulse relative z-10 w-full max-w-[420px] rounded-md border border-primary/45 bg-card/95 p-7 shadow-[0_0_32px_-10px_hsl(var(--primary)/0.55)] sm:p-8">
        <BrandMark className="mb-8" />
        {children}
      </div>
      <p className="pointer-events-none absolute bottom-6 left-0 right-0 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        Архив · рабочее пространство
      </p>
    </div>
  );
}
