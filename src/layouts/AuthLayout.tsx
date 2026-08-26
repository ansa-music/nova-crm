import { BrandMark } from "@/components/common/BrandMark";

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-12">
      <div className="pointer-events-none absolute inset-0 z-0" aria-hidden>
        <div
          className="absolute inset-0 opacity-[0.22]"
          style={{
            backgroundImage:
              "linear-gradient(hsl(var(--primary) / 0.22) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--primary) / 0.18) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
            maskImage: "radial-gradient(ellipse at 50% 42%, black 18%, transparent 72%)",
            WebkitMaskImage: "radial-gradient(ellipse at 50% 42%, black 18%, transparent 72%)",
          }}
        />
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, transparent 0, transparent 2px, hsl(var(--foreground) / 0.45) 3px)",
          }}
        />
      </div>
      <div className="relative z-10 w-full max-w-[420px] rounded-md border border-border bg-card/95 p-7 sm:p-8">
        <BrandMark className="mb-8" />
        {children}
      </div>
      <p className="pointer-events-none absolute bottom-6 left-0 right-0 z-10 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        Архив · рабочее пространство
      </p>
    </div>
  );
}
