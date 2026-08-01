import { Toaster as Sonner } from "sonner";
import { useUiStore } from "@/store/uiStore";

export function Toaster() {
  const theme = useUiStore((s) => s.theme);
  return (
    <Sonner
      theme={theme === "system" ? "system" : theme}
      className="toaster group"
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-card group-[.toaster]:text-card-foreground group-[.toaster]:border-border group-[.toaster]:shadow-popover group-[.toaster]:rounded-xl",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
    />
  );
}

export { toast } from "sonner";
