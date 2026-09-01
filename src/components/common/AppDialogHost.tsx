import { useEffect, useRef, useState } from "react";
import { AlertTriangle, HelpCircle, PencilLine } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { settleActiveDialog, useAppDialogStore } from "@/utils/appDialog";
import { cn } from "@/utils/cn";

/**
 * Renders whichever confirm/prompt dialog is currently requested through
 * `confirmDialog()` / `promptDialog()` (src/utils/appDialog.ts). Mounted
 * once in AppLayout; nothing else needs to know it exists.
 */
export function AppDialogHost() {
  const active = useAppDialogStore((s) => s.active);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  const isPrompt = active?.kind === "prompt";
  const promptOptions = active?.kind === "prompt" ? active.options : null;
  const confirmOptions = active?.kind === "confirm" ? active.options : null;

  useEffect(() => {
    if (!active) return;
    setError(null);
    setValue(active.kind === "prompt" ? active.options.defaultValue ?? "" : "");
    // Focus + select the input after the dialog's open animation mounts it.
    const t = window.setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      if (el instanceof HTMLInputElement) el.select();
    }, 40);
    return () => window.clearTimeout(t);
  }, [active]);

  function submitPrompt() {
    if (!promptOptions) return;
    const message = promptOptions.validate?.(value);
    if (message) {
      setError(message);
      return;
    }
    settleActiveDialog(value);
  }

  const destructive = Boolean(confirmOptions?.destructive);
  const confirmLabel = active?.options.confirmLabel ?? (isPrompt ? "Сохранить" : destructive ? "Удалить" : "Подтвердить");
  const cancelLabel = active?.options.cancelLabel ?? "Отмена";
  const remaining =
    promptOptions?.maxLength !== undefined ? promptOptions.maxLength - value.length : null;

  return (
    <Dialog open={Boolean(active)} onOpenChange={(open) => !open && settleActiveDialog(isPrompt ? null : false)}>
      <DialogContent
        className={cn("sm:max-w-md", destructive && "border-destructive/40")}
        onOpenAutoFocus={(e: Event) => {
          // We focus the input ourselves (see effect) so a prompt's text is
          // preselected; for confirms let Radix focus the first button.
          if (isPrompt) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-start gap-2.5 leading-snug">
            <span
              className={cn(
                "mt-[-2px] flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                destructive ? "bg-destructive/15 text-destructive" : "bg-primary/12 text-primary"
              )}
            >
              {isPrompt ? (
                <PencilLine className="h-3.5 w-3.5" />
              ) : destructive ? (
                <AlertTriangle className="h-3.5 w-3.5" />
              ) : (
                <HelpCircle className="h-3.5 w-3.5" />
              )}
            </span>
            <span className="min-w-0 pt-1">{active?.options.title}</span>
          </DialogTitle>
          {active?.options.description ? (
            <DialogDescription className="pl-[38px]">{active.options.description}</DialogDescription>
          ) : (
            <DialogDescription className="sr-only">
              {isPrompt ? "Введите значение" : "Подтвердите действие"}
            </DialogDescription>
          )}
        </DialogHeader>

        {isPrompt && promptOptions && (
          <div className="flex flex-col gap-1.5">
            {promptOptions.label && <Label htmlFor="app-dialog-prompt-input">{promptOptions.label}</Label>}
            {promptOptions.multiline ? (
              <Textarea
                id="app-dialog-prompt-input"
                ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                rows={4}
                value={value}
                maxLength={promptOptions.maxLength}
                placeholder={promptOptions.placeholder}
                onChange={(e) => {
                  setValue(e.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    submitPrompt();
                  }
                }}
              />
            ) : (
              <Input
                id="app-dialog-prompt-input"
                ref={inputRef as React.RefObject<HTMLInputElement>}
                value={value}
                maxLength={promptOptions.maxLength}
                placeholder={promptOptions.placeholder}
                autoComplete="off"
                onChange={(e) => {
                  setValue(e.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submitPrompt();
                  }
                }}
              />
            )}
            <div className="flex min-h-4 items-center justify-between gap-2 text-[11px]">
              <span className={cn("min-w-0 truncate", error ? "text-destructive" : "text-transparent")}>
                {error ?? "·"}
              </span>
              {remaining !== null && (
                <span className={cn("tabular-nums text-muted-foreground", remaining < 0 && "text-destructive")}>
                  {value.length}/{promptOptions.maxLength}
                </span>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => settleActiveDialog(isPrompt ? null : false)}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={() => (isPrompt ? submitPrompt() : settleActiveDialog(true))}
            autoFocus={!isPrompt && !destructive}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
