import { useState } from "react";
import { Clock, Lock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JoinAccountBar } from "@/components/members/JoinAccountBar";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { tenantActive, trialDaysLeft, type TenantInfo } from "@/hooks/useTenantInfo";

function fmtDay(ms: number): string {
  return new Date(ms).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

/**
 * Экран «компания не действует» (SaaS этап 2): приостановлена или пробный
 * период кончился. Данные целы; запись и так закрыта базой — экран лишь
 * говорит это прямо, вместо череды «не удалось сохранить».
 */
export function TenantBlockedScreen({ info, workspaceName, email, isOwner }: {
  info: TenantInfo;
  workspaceName: string;
  email: string | null | undefined;
  isOwner: boolean;
}) {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActiveWorkspaceId = useWorkspaceStore((s) => s.setActiveWorkspaceId);
  const others = workspaces.filter((w) => w.id !== activeId);
  const suspended = info.status === "suspended";

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-6">
      <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-xl border border-border bg-card p-6 text-center shadow-sm sm:p-8">
        <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
          {suspended ? <Lock className="h-7 w-7" /> : <Clock className="h-7 w-7" />}
        </span>
        <div>
          <p className="eyebrow mb-1">{workspaceName}</p>
          <h1 className="font-serif text-2xl font-light">
            {suspended ? "Доступ к компании приостановлен" : "Пробный период закончился"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Все данные сохранены.{" "}
            {isOwner
              ? "Чтобы продолжить работу, свяжитесь с Nova — доступ откроется сразу после продления."
              : "Чтобы продолжить, руководителю компании нужно продлить доступ в Nova."}
          </p>
        </div>
        {others.length > 0 ? (
          <div className="flex w-full flex-col gap-2">
            <p className="text-[12px] text-muted-foreground">Другие ваши компании:</p>
            {others.map((w) => (
              <Button key={w.id} variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setActiveWorkspaceId(w.id)}>
                {w.name}
              </Button>
            ))}
          </div>
        ) : null}
        <JoinAccountBar email={email} />
      </div>
    </div>
  );
}

const DISMISS_KEY = "nova:trial-banner-hidden";

/** Плашка Owner: пробный период кончается (≤ 7 дней). Скрыть — до конца дня. */
export function TrialBanner({ info }: { info: TenantInfo }) {
  const [hidden, setHidden] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === new Date().toDateString();
    } catch {
      return false;
    }
  });
  const left = trialDaysLeft(info);
  if (hidden || left === null || left > 7 || !tenantActive(info) || info.trialUntil === null) return null;
  return (
    <div className="flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-1.5 text-[12.5px] text-warning">
      <Clock className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        Пробный период до {fmtDay(info.trialUntil)} · {left === 0 ? "последний день" : `осталось ${left} дн.`} — для продления
        свяжитесь с Nova
      </span>
      <button
        type="button"
        aria-label="Скрыть до завтра"
        className="flex h-6 w-6 items-center justify-center rounded hover:bg-warning/15"
        onClick={() => {
          try {
            sessionStorage.setItem(DISMISS_KEY, new Date().toDateString());
          } catch {
            /* без хранилища — просто скрыть */
          }
          setHidden(true);
        }}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
