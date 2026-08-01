export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-primary/30 blur-[120px]" />
        <div className="absolute -right-24 top-1/3 h-80 w-80 rounded-full bg-purple-500/25 blur-[120px]" />
        <div className="absolute bottom-[-10rem] left-1/3 h-96 w-96 rounded-full bg-sky-400/20 blur-[120px]" />
      </div>
      <div className="relative z-10 flex w-full flex-col items-center">{children}</div>
    </div>
  );
}
