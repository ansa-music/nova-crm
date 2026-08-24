import { BrandMark } from "@/components/common/BrandMark";

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="page-surface relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-12">
      <div className="pointer-events-none absolute -left-32 top-[-8rem] h-[28rem] w-[28rem] rounded-full bg-primary/[0.07] blur-3xl" />
      <div className="pointer-events-none absolute bottom-[-6rem] right-[-4rem] h-[22rem] w-[22rem] rounded-full bg-primary/[0.035] blur-3xl" />
      <div className="relative z-10 w-full max-w-[420px] rounded-lg border border-border/70 bg-card/85 p-7 sm:p-8 shadow-[0_24px_80px_-40px_rgb(0_0_0_/_0.55)]">
        <BrandMark className="mb-8" />
        {children}
      </div>
      <p className="pointer-events-none absolute bottom-6 left-0 right-0 text-center font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        Архив · рабочее пространство
      </p>
    </div>
  );
}
