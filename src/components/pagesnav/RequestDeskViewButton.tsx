import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/utils/cn";
import type { ViewRequest, WorkspacePage } from "@/types";

export function RequestDeskViewButton({
  page,
  mine,
  canOpen,
  onRequest,
  className,
}: {
  page: WorkspacePage;
  mine: ViewRequest | null;
  canOpen?: boolean;
  onRequest: () => Promise<unknown>;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const approved = mine?.status === "approved";
  const pending = mine?.status === "pending";

  if (canOpen && approved) {
    return (
      <span
        className={cn(
          "inline-flex min-h-11 w-full items-center justify-center rounded-sm border border-primary/50 bg-primary/15 text-xs font-medium text-primary shadow-glow",
          className
        )}
      >
        Разрешено
      </span>
    );
  }

  if (canOpen) {
    return null;
  }

  const label = pending ? "Запрос отправлен" : "Запросить просмотр";

  return (
    <Button
      type="button"
      size="sm"
      variant={pending ? "secondary" : "default"}
      disabled={pending || busy}
      className={className ?? "min-h-11 w-full"}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (pending) return;
        setBusy(true);
        try {
          await onRequest();
          toast.success("Запрос отправлен");
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Не удалось отправить запрос");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Отправка…" : label}
    </Button>
  );
}
