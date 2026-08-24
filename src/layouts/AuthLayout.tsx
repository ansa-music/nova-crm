import { BrandMark } from "@/components/common/BrandMark";

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="cyber-grid page-surface relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-12">
      <div className="pointer-events-none absolute -left-32 top-[-8rem] h-[28rem] w-[28rem] rounded-full bg-primary/20 blur-3xl neon-pulse" />
      <div className="pointer-events-none absolute bottom-[-6rem] right-[-4rem] h-[22rem] w-[22rem] rounded-full bg-secondary/20 blur-3xl" />
      <div className="hud-frame relative z-10 w-full max-w-[420px] rounded-lg border border-primary/30 bg-card/80 p-7 shadow-[0_0_48px_-12px_hsl(var(--primary)/0.55),0_0_80px_-24px_hsl(var(--secondary)/0.4)] backdrop-blur-xl sm:p-8">
        <BrandMark className="mb-8" />
        {children}
      </div>
      <p className="pointer-events-none absolute bottom-6 left-0 right-0 text-center font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        Архив · рабочее пространство
      </p>
    </div>
  );
}
