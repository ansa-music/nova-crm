// PATH: src/components/common/AppBootScreen.tsx  (NEW FILE)
import { Skeleton } from "@/components/ui/skeleton";
import type { BootstrapPhase } from "@/hooks/useAppBootstrap";

const PHASE_LABEL: Partial<Record<BootstrapPhase, string>> = {
  auth: "Проверяем вход...",
  profile: "Загружаем профиль...",
  workspaces: "Открываем рабочее пространство...",
  "workspace-data": "Загружаем страницы и доступы...",
};

/**
 * One shared boot screen for every pre-ready phase. Deliberately identical in
 * layout to the app shell skeleton so the transition to the real UI doesn't
 * jump — and it always says WHAT it's waiting on instead of showing a blank
 * screen the user can only escape with F5.
 */
export function AppBootScreen({ phase }: { phase: BootstrapPhase }) {
  return (
    <div
      className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-background"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex w-56 flex-col gap-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <p className="text-xs text-muted-foreground">{PHASE_LABEL[phase] ?? "Загрузка..."}</p>
    </div>
  );
}
