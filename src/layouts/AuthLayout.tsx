import { BrandMark } from "@/components/common/BrandMark";

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-12">
      <div className="relative z-10 w-full max-w-[420px] rounded-md border border-border bg-card/95 p-7 sm:p-8">
        <BrandMark className="mb-8" />
        {children}
      </div>
      <p className="pointer-events-none absolute bottom-6 left-0 right-0 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        Архив · рабочее пространство
      </p>
    </div>
  );
}
