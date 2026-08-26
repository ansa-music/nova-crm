import { GROK_LOGIN_METHODS, type GrokLoginMethod } from "@/types/grokAccount";
import { cn } from "@/utils/cn";

export function LoginMethodPicker({
  value,
  onChange,
}: {
  value: GrokLoginMethod;
  onChange: (next: GrokLoginMethod) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {GROK_LOGIN_METHODS.map((method) => (
        <button
          key={method.id}
          type="button"
          onClick={() => onChange(method.id)}
          className={cn(
            "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
            value === method.id
              ? "border-primary/50 bg-primary/15 text-primary"
              : "border-border bg-background/40 text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
        >
          {method.label}
        </button>
      ))}
    </div>
  );
}
