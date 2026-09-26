import { Check, X } from "lucide-react";
import { Toaster as Sonner } from "sonner";
import { useIsMobile } from "@/hooks/useMediaQuery";

/* Иконка тоста — плоский квадратик в тоне события, без свечения. */
function HudToastIcon({ kind }: { kind: "success" | "error" }) {
  const ok = kind === "success";
  return (
    <span
      aria-hidden
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[2px] border"
      style={{
        borderColor: ok ? "hsl(var(--primary) / 0.72)" : "hsl(var(--destructive) / 0.72)",
        background: ok ? "hsl(var(--primary) / 0.12)" : "hsl(var(--destructive) / 0.12)",
        color: ok ? "hsl(var(--primary))" : "hsl(var(--destructive))",
      }}
    >
      {ok ? <Check className="h-3 w-3" strokeWidth={2.6} /> : <X className="h-3 w-3" strokeWidth={2.6} />}
    </span>
  );
}

export function Toaster() {
  // Телефон: сверху, как системные уведомления iPhone. Снизу тост закрывал
  // нижнюю панель, итоги стола и кнопки карточки строки.
  const mobile = useIsMobile();
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      position={mobile ? "top-center" : "bottom-right"}
      mobileOffset={{ top: "calc(env(safe-area-inset-top) + 8px)" }}
      icons={{
        success: <HudToastIcon kind="success" />,
        error: <HudToastIcon kind="error" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-card group-[.toaster]:text-card-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg group-[.toaster]:rounded-xl",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
    />
  );
}

export { toast } from "sonner";
