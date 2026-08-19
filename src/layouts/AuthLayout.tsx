export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
      <div className="relative z-10 flex w-full flex-col items-center">{children}</div>
    </div>
  );
}
