import { Minimize2 } from "lucide-react";
import { useUiStore } from "@/store/uiStore";

/** Always-visible exit for fullscreen / phone immersive table chrome. */
export function TableChromeExit({ label }: { label: string }) {
  const setTableFullscreen = useUiStore((s) => s.setTableFullscreen);
  const setTableImmersive = useUiStore((s) => s.setTableImmersive);

  function exit() {
    setTableFullscreen(false);
    setTableImmersive(false);
  }

  return (
    <div className="sticky top-0 z-[60] flex h-12 shrink-0 items-center border-b border-primary/35 bg-background px-2 pt-[env(safe-area-inset-top,0px)]">
      <button
        type="button"
        onClick={exit}
        title={`${label} (Esc)`}
        className="inline-flex h-11 min-h-[44px] min-w-[44px] items-center gap-2 rounded-sm border border-primary/55 bg-primary/12 px-3 text-[13px] font-medium text-primary transition-colors hover:bg-primary/18 active:scale-[0.97] active:bg-primary/24 motion-reduce:active:scale-100"
      >
        <Minimize2 className="h-4 w-4 shrink-0" />
        {label}
      </button>
    </div>
  );
}
