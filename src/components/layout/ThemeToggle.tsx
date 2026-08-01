import { Check, Laptop, Moon, Sun } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useUiStore, type ThemeMode } from "@/store/uiStore";

const OPTIONS: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Светлая", icon: Sun },
  { value: "dark", label: "Тёмная", icon: Moon },
  { value: "system", label: "Системная", icon: Laptop },
];

export function ThemeToggle() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const CurrentIcon = OPTIONS.find((o) => o.value === theme)?.icon ?? Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" title="Тема оформления">
          <CurrentIcon className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {OPTIONS.map((opt) => (
          <DropdownMenuItem key={opt.value} onClick={() => setTheme(opt.value)}>
            <opt.icon className="h-4 w-4" />
            {opt.label}
            {theme === opt.value && <Check className="ml-auto h-3.5 w-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
