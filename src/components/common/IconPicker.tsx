import { PAGE_ICON_MAP, PAGE_ICON_NAMES } from "@/utils/pageIcons";
import { cn } from "@/utils/cn";
import type { PageIconName } from "@/types";

interface IconPickerProps {
  value: PageIconName;
  onChange: (icon: PageIconName) => void;
  color?: string;
}

export function IconPicker({ value, onChange, color = "243 75% 59%" }: IconPickerProps) {
  return (
    <div className="grid grid-cols-5 gap-2">
      {PAGE_ICON_NAMES.map((name) => {
        const Icon = PAGE_ICON_MAP[name];
        const active = value === name;
        return (
          <button
            key={name}
            type="button"
            onClick={() => onChange(name)}
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-lg border transition-all",
              active ? "border-transparent ring-2 ring-offset-2 ring-offset-background" : "border-border hover:bg-accent"
            )}
            style={
              active
                ? { backgroundColor: `hsl(${color} / 0.15)`, color: `hsl(${color})`, boxShadow: `0 0 0 2px hsl(${color})` }
                : undefined
            }
          >
            <Icon className="h-4.5 w-4.5" />
          </button>
        );
      })}
    </div>
  );
}
